import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FilaExportada } from './exportar.js';
import type { FilaEventoSitio, FilaMedicionSitio, FilaTramaSitio } from './exportar-sitio.js';
import { Pool, type PoolClient } from 'pg';
import { POOL } from '../db/db.module.js';
import { errorDeCliente } from '../db/cliente.js';
import { porcentaje } from './escala.js';
import { isoUs } from '../db/iso-us.js';
import { Intervalo } from './validacion.js';
import { Cursor, FiltroInventario, SQL_EN_LINEA, SQL_ESPERA_HASTA, SQL_ESTADO_VISUAL, SQL_ORDEN_ATENCION, entrega, patronBusqueda } from './tablero.js';

// Consultas de lectura. SQL explícito y parametrizado ($1, $2…): se lee, se audita, se explica.
// Las fechas salen como Date → JSON las serializa en ISO 8601 con 'Z' (UTC), regla 5 de docs/13.
// Cuando la fecha va DENTRO de un JSON armado en SQL (json_agg/json_build_object) se usa iso_utc():
// sin ella Postgres emite '+00:00' y la API mezclaría dos formatos.
// Intervalo observado (docs/19 §4, incremento 1, punto 3): la mediana, en segundos enteros, de las diferencias entre los
// instantes de recepción (`trama.recibido_en` truncado al segundo, distintos) de las últimas 20 tramas del dispositivo; nulo con
// menos de 3 instantes (menos de 2 diferencias). Sobre `trama` (una fila por mensaje con al menos una lectura guardada) y su índice
// (dispositivo_id, recibido_en DESC): lee 20 filas, no el historial. La trama vence a los 30 días (RETENCION_TRAMA_DIAS): un
// dispositivo callado desde antes da nulo. Informa, no decide: la alarma de silencio sigue usando el intervalo esperado.
// Va como subconsulta de la ficha: ninguna ida más a la base por petición.
export const SQL_INTERVALO_OBSERVADO = `(
             SELECT CASE WHEN count(*) >= 2 THEN round(percentile_cont(0.5) WITHIN GROUP (ORDER BY w.dif))::int END
               FROM (SELECT extract(epoch FROM u.t - lag(u.t) OVER (ORDER BY u.t)) AS dif
                       FROM (SELECT DISTINCT date_trunc('second', x.recibido_en) AS t
                               FROM (SELECT tr.recibido_en FROM trama tr
                                      WHERE tr.dispositivo_id = d.id
                                      ORDER BY tr.recibido_en DESC LIMIT 20) x) u) w
              WHERE w.dif IS NOT NULL)`;

// La última lectura de un canal `c`: la de la ficha (GET /dispositivos/{id}) y la de «Ahora» (GET /sitios/{id}/ahora, docs/19 §4, L6), una
// sola forma: `{valor, tiempo}` o null, por el índice único (canal_id, tiempo) de `medicion` (lee una fila). El % lo pone porcentaje().
export const SQL_ULTIMA_MEDICION = `(SELECT json_build_object('valor', x.valor, 'tiempo', iso_utc(x.tiempo)) FROM medicion x
               WHERE x.canal_id = c.id ORDER BY x.tiempo DESC LIMIT 1)`;

// Prefijo del ORDER BY del inventario por `orden` (lista cerrada de tablero.ts: nunca texto del cliente). `atencion`: el orden de docs/19 §4
// (ORDEN_ATENCION: sin señal, alerta, normal, esperando, inactivo) y, dentro, por nombre (y después el de siempre, para que el orden sea total).
const ORDEN_SQL: Readonly<Record<NonNullable<FiltroInventario['orden']>, string>> = {
  nombre: '',
  entrega: "(CASE WHEN inv.estado_visual = 'esperando' THEN NULL ELSE inv.entrega_orden END) ASC NULLS LAST, ",
  atencion: `${SQL_ORDEN_ATENCION('inv.estado_visual')}, inv.nombre, `,
};

// La entrega de una fila del inventario (punto 65 vii): nula si no está activo (RF-22) o si espera su primera trama (docs/19 §2: aún no se
// le exige reportar); si no, entrega() desde lo más tardío entre la ventana de 24 h y su entrada en servicio.
export function entregaDeFila(x: { estado: string; estado_visual: string; recibidas_24h: number; en_servicio_desde: Date; intervalo_esperado_s: number }, ahora: Date): number | null {
  if (x.estado !== 'activo' || x.estado_visual === 'esperando') return null;
  const ventana = new Date(ahora.getTime() - 24 * 3600 * 1000);
  return entrega(x.recibidas_24h, ventana, ahora, x.en_servicio_desde, x.intervalo_esperado_s, ventana).porcentaje;
}

@Injectable()
export class ConsultaService {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  // Un dispositivo está "en línea" si su último mensaje cae dentro de 2 × su intervalo esperado, contado desde el más reciente entre ese
  // mensaje y su entrada en servicio (mismo criterio que el supervisor: un mensaje perdido no es una caída; dos seguidos, sí).
  // `sitios`: el alcance de quien pregunta (docs/20 §5; docs/10 §8.4 punto 36), en el WHERE; null = todos (usuario del sistema).
  async dispositivos(sitios: string[] | null = null) {
    return (await this.inventario(sitios, {})).filas;
  }

  // Inventario v2 (docs/19 §4, C; docs/10 §8.4 punto 65): filtros `sitio, zona, via, estado, q` y, si se pide, `limite` y
  // `desplazamiento` (punto 58 iii: desplazamiento con total en las listas chicas). El total va aparte (cabecera X-Total): la forma de la
  // respuesta no cambia. Por fila suma `estado_visual` (la regla de docs/19 §2 en SQL, para filtrar y paginar aquí) y `entrega` (% de las
  // últimas 24 h, HU-15; nulo si no hay una trama esperada completa en la ventana). Una consulta: el total sale de `count(*) OVER ()`.
  async inventario(sitios: string[] | null, f: FiltroInventario): Promise<{ filas: Record<string, unknown>[]; total: number }> {
    const p: unknown[] = [sitios, f.sitio ?? null, f.zona ?? null, f.via ?? null, f.estado ?? null, f.q === undefined ? null : patronBusqueda(f.q)];
    let pagina = '';
    if (f.limite !== undefined) {
      p.push(f.limite, f.desplazamiento ?? 0);
      pagina = `LIMIT $${p.length - 1} OFFSET $${p.length}`;
    }
    const r = await this.pool.query<Record<string, unknown> & { total: string; recibidas_24h: number; en_servicio_desde: Date; intervalo_esperado_s: number; estado: string; estado_visual: string }>(`
      WITH inv AS (
      SELECT d.id, d.id_fisico, d.nombre, d.estado, d.via, d.formato, d.intervalo_esperado_s,
             e.visto_por_ultima_vez,
             ${SQL_EN_LINEA} AS en_linea,
             -- Desde el 18/11/2026 (docs/19 §2): desde cuándo se espera que reporte y, si aún no envió nada, hasta cuándo espera su primera trama.
             d.en_servicio_desde,
             CASE WHEN e.visto_por_ultima_vez IS NULL THEN ${SQL_ESPERA_HASTA} END AS espera_hasta,
             z.nombre AS zona, s.nombre AS sitio, s.zona_horaria,
             -- Identidades para filtrar (docs/19 P2): el código del sitio es único y el id de la zona también; los nombres pueden repetirse.
             s.codigo AS sitio_codigo, z.id AS zona_id,
             (SELECT count(*)::int FROM condicion c WHERE c.dispositivo_id = d.id AND c.cerrada_en IS NULL) AS condiciones_abiertas,
             (SELECT coalesce(json_agg(json_build_object('id', c.id, 'magnitud', c.magnitud_codigo, 'unidad', m.unidad_canonica) ORDER BY c.magnitud_codigo), '[]'::json)
                FROM canal c JOIN magnitud m ON m.codigo = c.magnitud_codigo WHERE c.dispositivo_id = d.id) AS canales,
             ${SQL_ESTADO_VISUAL} AS estado_visual,
             -- Entrega (punto 65 vii): tramas de las últimas 24 h, contadas UNA vez por dispositivo (el LATERAL de abajo, por el índice
             -- (dispositivo_id, recibido_en DESC)); el % lo calcula entrega(). Antes se contaban dos veces (dos subplanes): docs/16 §61.
             t24.n AS recibidas_24h,
             -- Solo para ordenar por entrega en la base (la página se corta aquí): la misma regla que entregaDeFila(), con la ventana de 24 h
             -- que empieza en la entrada en servicio si es posterior; nulo si no está activo o si no hay una trama esperada completa (quien
             -- espera su primera trama queda nulo en el ORDER BY, ORDEN_SQL, por su estado visual). El valor que se devuelve lo calcula
             -- entregaDeFila(); la prueba de humo comprueba que el orden y los valores coinciden. NULLIF: un intervalo 0 no divide (la base
             -- lo impide desde la migración 23, ck_dispositivo_intervalo_esperado_s).
             (SELECT CASE WHEN d.estado = 'activo' AND w.esperadas >= 1
                          THEN least(100, round(1000.0 * t24.n / w.esperadas) / 10) END
                FROM (SELECT floor(extract(epoch FROM now() - greatest(now() - INTERVAL '24 hours', d.en_servicio_desde)) / NULLIF(d.intervalo_esperado_s, 0)) AS esperadas) w) AS entrega_orden
        FROM dispositivo d
        LEFT JOIN LATERAL (SELECT count(*)::int AS n FROM trama t WHERE t.dispositivo_id = d.id AND t.recibido_en >= now() - INTERVAL '24 hours') t24 ON true
        LEFT JOIN estado_dispositivo e ON e.dispositivo_id = d.id
        JOIN zona z ON z.id = d.zona_id
        JOIN sitio s ON s.id = z.sitio_id
       WHERE ($1::uuid[] IS NULL OR s.id = ANY($1::uuid[]))
         AND ($2::uuid IS NULL OR s.id = $2::uuid)
         AND ($3::uuid IS NULL OR z.id = $3::uuid)
         AND ($4::text IS NULL OR d.via = $4::text)
         AND ($6::text IS NULL OR d.id_fisico ILIKE $6::text OR d.nombre ILIKE $6::text))
      SELECT inv.*, count(*) OVER () AS total FROM inv
       WHERE $5::text IS NULL OR inv.estado_visual = $5::text
       ORDER BY ${ORDEN_SQL[f.orden ?? 'nombre']}inv.sitio, inv.zona, inv.nombre, inv.id ${pagina}`, p);
    let total = r.rows[0] === undefined ? 0 : Number(r.rows[0].total);
    // Una página más allá del final no trae filas de donde leer el total: solo en ese caso se cuenta aparte, con los mismos filtros.
    if (r.rows.length === 0 && (f.desplazamiento ?? 0) > 0) total = (await this.inventario(sitios, { ...f, limite: undefined, desplazamiento: undefined })).total;
    const ahora = new Date();
    const filas = r.rows.map((x) => {
      const { total: _total, recibidas_24h: _recibidas, entrega_orden: _orden, ...resto } = x;
      void _total; void _orden; void _recibidas;
      // En mantenimiento o de baja (RF-22) o esperando su primera trama, sin tramas esperadas: entrega nula, como en el resumen.
      return { ...resto, entrega: entregaDeFila(x, ahora) };
    });
    return { filas, total };
  }

  async dispositivo(id: string) {
    const d = await this.pool.query(`
      SELECT d.id, d.id_fisico, d.nombre, d.estado, d.via, d.formato, d.intervalo_esperado_s, e.visto_por_ultima_vez, d.creado_en,
             -- Marca del bloqueo optimista de PATCH /dispositivos/{id} (Etapa 4; docs/10 §8.4 punto 28), con microsegundos, como texto.
             ${isoUs('d.actualizado_en')} AS actualizado_en,
             ${SQL_EN_LINEA} AS en_linea,
             d.en_servicio_desde, CASE WHEN e.visto_por_ultima_vez IS NULL THEN ${SQL_ESPERA_HASTA} END AS espera_hasta,
             z.nombre AS zona, s.nombre AS sitio, s.zona_horaria, s.codigo AS sitio_codigo, z.id AS zona_id,
             ${SQL_INTERVALO_OBSERVADO} AS intervalo_observado_s
        FROM dispositivo d LEFT JOIN estado_dispositivo e ON e.dispositivo_id = d.id
        JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id
       WHERE d.id = $1`, [id]);
    if (!d.rows[0]) throw new NotFoundException('dispositivo no encontrado');

    const canales = await this.pool.query(`
      SELECT c.id, c.magnitud_codigo AS magnitud, m.nombre AS magnitud_nombre, m.unidad_canonica AS unidad, c.etiqueta,
             c.escala_cero, c.escala_cien,
             -- Marca del bloqueo optimista de PATCH /canales/{id} (punto 51): con microsegundos, como texto, para devolverla tal cual.
             ${isoUs('c.actualizado_en')} AS actualizado_en,
             (SELECT json_agg(json_build_object('id', r.id, 'umbral_alto', r.umbral_alto, 'umbral_bajo', r.umbral_bajo, 'histeresis', r.histeresis,
                                     'retardo_s', r.retardo_s) ORDER BY r.id)
                FROM regla_umbral r WHERE r.canal_id = c.id) AS reglas,
             ${SQL_ULTIMA_MEDICION} AS ultima_medicion
        FROM canal c JOIN magnitud m ON m.codigo = c.magnitud_codigo
       WHERE c.dispositivo_id = $1 ORDER BY c.magnitud_codigo`, [id]);

    const condiciones = await this.pool.query(`
      SELECT id, tipo, regla_id, abierta_en, cerrada_en FROM condicion
       WHERE dispositivo_id = $1 AND cerrada_en IS NULL ORDER BY abierta_en DESC`, [id]);

    // El % de la última medición, con la calibración del canal (punto 51); sin calibración, null.
    const conPorcentaje = canales.rows.map((k: { escala_cero: number | null; escala_cien: number | null; ultima_medicion: { valor: number } | null }) => ({
      ...k,
      ultima_medicion: k.ultima_medicion && { ...k.ultima_medicion, porcentaje: porcentaje(k.ultima_medicion.valor, k.escala_cero, k.escala_cien) },
    }));
    return { ...d.rows[0], canales: conPorcentaje, condiciones_abiertas: condiciones.rows };
  }

  // Histórico agregado por la base de datos con time_bucket EN LA ZONA DEL SITIO (docs/13, regla 4).
  // Devuelve el formato columnar que uPlot consume directo: tiempos en segundos Unix y valores.
  // Rango semiabierto [desde, hasta) — regla 8.
  async historico(canalId: string, desde: Date, hasta: Date, intervalo: Intervalo) {
    const c = await this.pool.query<{ zona_horaria: string; magnitud: string; unidad: string; escala_cero: number | null; escala_cien: number | null }>(`
      SELECT s.zona_horaria, c.magnitud_codigo AS magnitud, m.unidad_canonica AS unidad, c.escala_cero, c.escala_cien
        FROM canal c JOIN magnitud m ON m.codigo = c.magnitud_codigo
        JOIN dispositivo d ON d.id = c.dispositivo_id JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id
       WHERE c.id = $1`, [canalId]);
    if (!c.rows[0]) throw new NotFoundException('canal no encontrado');
    const { zona_horaria, magnitud, unidad, escala_cero, escala_cien } = c.rows[0];
    const calibrado = escala_cero !== null && escala_cien !== null;

    // El intervalo viene de una lista cerrada (validacion.ts), por eso puede ir como parámetro ::interval.
    const r = await this.pool.query<{ t: string; v: number; mn: number; mx: number; n: number }>(`
      SELECT extract(epoch FROM time_bucket($4::interval, tiempo, $5))::bigint AS t,
             round(avg(valor)::numeric, 3)::float AS v,
             round(min(valor)::numeric, 3)::float AS mn,
             round(max(valor)::numeric, 3)::float AS mx,
             count(*)::int AS n
        FROM medicion
       WHERE canal_id = $1 AND tiempo >= $2 AND tiempo < $3
       GROUP BY 1 ORDER BY 1`, [canalId, desde, hasta, intervalo, zona_horaria]);

    return {
      canal_id: canalId, magnitud, unidad, zona_horaria, intervalo,
      desde, hasta, puntos: r.rows.length,
      tiempos: r.rows.map((x) => Number(x.t)),
      valores: r.rows.map((x) => x.v),
      // Tablero v2 (docs/19 §4, D3): el mínimo y el máximo de cada cubo, para la banda mín–máx (campos nuevos; nada cambia de forma).
      minimos: r.rows.map((x) => x.mn),
      maximos: r.rows.map((x) => x.mx),
      muestras: r.rows.map((x) => x.n),
      // Punto 51: el % de cada promedio, con la calibración del canal; sin calibración, null (no un arreglo de nulos).
      escala: calibrado ? { cero: escala_cero, cien: escala_cien } : null,
      porcentajes: calibrado ? r.rows.map((x) => porcentaje(x.v, escala_cero, escala_cien)) : null,
    };
  }

  // `dispositivoId` (opcional, ya validado como UUID por el controlador): solo las de ese dispositivo (ficha del panel, docs/19 P3).
  // `sitios`: alcance de quien pregunta (null = todos), por el sitio de la zona del dispositivo.
  // `cursor` (docs/10 §8.4 punto 58): la página siguiente por clave, (abierta_en, id) < cursor, con el índice idx_condicion_abierta_en_id
  // (migración 23). `clave_t` (abierta_en con microsegundos) viaja solo hasta el controlador, que arma X-Siguiente y lo quita.
  // `ventana` (Etapa 4; la ficha dibuja las condiciones del canal dentro del gráfico, docs/19 §4, D4): las que se superponen con
  // [desde, hasta): abiertas antes de `hasta` y cerradas después de `desde` (o aún abiertas).
  async condiciones(abiertas: boolean | undefined, lim: number, dispositivoId?: string, sitios: string[] | null = null, cursor?: Cursor, ventana?: { desde?: Date; hasta?: Date }) {
    const condiciones: string[] = [];
    const parametros: unknown[] = [lim];
    if (ventana?.hasta !== undefined) {
      parametros.push(ventana.hasta);
      condiciones.push(`c.abierta_en < $${parametros.length}::timestamptz`);
    }
    if (ventana?.desde !== undefined) {
      parametros.push(ventana.desde);
      condiciones.push(`(c.cerrada_en IS NULL OR c.cerrada_en >= $${parametros.length}::timestamptz)`);
    }
    if (cursor !== undefined) {
      parametros.push(cursor.t, cursor.id);
      condiciones.push(`(c.abierta_en, c.id) < ($${parametros.length - 1}::timestamptz, $${parametros.length}::uuid)`);
    }
    if (sitios !== null) {
      parametros.push(sitios);
      condiciones.push(`z.sitio_id = ANY($${parametros.length}::uuid[])`);
    }
    if (abiertas !== undefined) condiciones.push(abiertas ? 'c.cerrada_en IS NULL' : 'c.cerrada_en IS NOT NULL');
    if (dispositivoId !== undefined) {
      parametros.push(dispositivoId);
      condiciones.push(`c.dispositivo_id = $${parametros.length}`);
    }
    const filtro = condiciones.length === 0 ? '' : `WHERE ${condiciones.join(' AND ')}`;
    const r = await this.pool.query(`
      SELECT c.id, c.tipo, c.abierta_en, c.cerrada_en,
             extract(epoch FROM coalesce(c.cerrada_en, now()) - c.abierta_en)::int AS duracion_s,
             d.id AS dispositivo_id, d.id_fisico, d.nombre AS dispositivo, s.nombre AS sitio,
             r.umbral_alto, r.umbral_bajo, ca.magnitud_codigo AS magnitud,
             ${isoUs('c.abierta_en')} AS clave_t
        FROM condicion c
        JOIN dispositivo d ON d.id = c.dispositivo_id
        JOIN zona z ON z.id = d.zona_id
        JOIN sitio s ON s.id = z.sitio_id
        LEFT JOIN regla_umbral r ON r.id = c.regla_id
        LEFT JOIN canal ca ON ca.id = r.canal_id
        ${filtro}
       ORDER BY c.abierta_en DESC, c.id DESC LIMIT $1`, parametros);
    return r.rows as (Record<string, unknown> & { id: string; clave_t: string })[];
  }

  // Identidad mínima de un dispositivo para la exportación (404 si no existe).
  async identidad(dispositivoId: string): Promise<{ id_fisico: string }> {
    const r = await this.pool.query<{ id_fisico: string }>('SELECT id_fisico FROM dispositivo WHERE id = $1', [dispositivoId]);
    if (!r.rows[0]) throw new NotFoundException('dispositivo no encontrado');
    return r.rows[0];
  }

  // Mediciones crudas de un dispositivo en [desde, hasta), por tandas (RF-34): nunca todo el rango en memoria. Paginación por
  // clave (tiempo, canal_id): el tiempo viaja y vuelve como TEXTO exacto de la base (microsegundos); si pasara por un Date de
  // JavaScript (milisegundos), la última fila de cada tanda se repetiría en la siguiente. Una conexión propia con un tope de
  // 30 s por consulta, para que una exportación larga no se quede con el pool de la recepción; el plan de la consulta se mide
  // en el banco antes de afirmar nada sobre índices (pendiente). El llamador escribe cada fila al flujo de salida.
  async *mediciones(dispositivoId: string, desde: Date, hasta: Date, tanda = 10_000): AsyncGenerator<FilaExportada> {
    // Una exportación larga tiene su cliente prestado minutos: si la base corta la conexión a mitad, falla esta descarga y no el proceso.
    const { cliente, devolver } = await this.prestarCliente(30_000);
    try {
      let ultimoTiempo: string | null = null;
      let ultimoCanal: string | null = null;
      for (;;) {
        const r = await cliente.query<FilaExportada>(
          `SELECT to_char(m.tiempo AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS tiempo_utc,
                  c.magnitud_codigo AS magnitud, m.valor, m.unidad, m.canal_id
             FROM medicion m JOIN canal c ON c.id = m.canal_id
            WHERE c.dispositivo_id = $1 AND m.tiempo >= $2 AND m.tiempo < $3
              AND ($4::text IS NULL OR (m.tiempo, m.canal_id) > ($4::timestamptz, $5::uuid))
            ORDER BY m.tiempo, m.canal_id LIMIT $6`,
          [dispositivoId, desde, hasta, ultimoTiempo, ultimoCanal, tanda],
        );
        const filas: FilaExportada[] = r.rows;
        for (const fila of filas) yield fila;
        if (filas.length < tanda) return;
        const ultima = filas[filas.length - 1];
        if (ultima === undefined) return;
        ultimoTiempo = ultima.tiempo_utc;
        ultimoCanal = ultima.canal_id;
      }
    } finally {
      await devolver();
    }
  }

  // Un cliente prestado del pool para una consulta larga, con su tope por consulta (statement_timeout, en milisegundos). Si la base corta
  // la conexión mientras está prestado, el evento 'error' se guarda y el cliente se devuelve con ese error, `release(err)`, para que
  // pg-pool lo descarte en vez de dejar en el pool una conexión rota (revisión del 19/11/2026); lo mismo si falla el RESET final.
  private async prestarCliente(topeMs: number): Promise<{ cliente: PoolClient; devolver: () => Promise<void> }> {
    if (!Number.isInteger(topeMs) || topeMs <= 0) throw new Error(`tope de consulta inválido: ${topeMs}`);
    const cliente = await this.pool.connect();
    let roto: Error | undefined;
    const alError = (e: Error): void => { roto = e; errorDeCliente(e); };
    cliente.on('error', alError);
    const devolver = async (): Promise<void> => {
      const fallaReset = roto === undefined ? await cliente.query('RESET statement_timeout').then(() => undefined, (e: unknown) => e as Error) : undefined;
      cliente.off('error', alError);
      cliente.release(roto ?? fallaReset);
    };
    try {
      await cliente.query(`SET statement_timeout TO ${topeMs}`);
    } catch (e) {
      cliente.off('error', alError);
      cliente.release(roto ?? (e as Error));
      throw e;
    }
    return { cliente, devolver };
  }

  // ── Exportación por sitio (HU-08; docs/19 §4, bloque R, puntos 1, 3 y 5; 19/11/2026) ──────────────────────────────────────────────
  // Una conexión propia por descarga, con 30 s de tope por consulta (prestarCliente, como mediciones()): las tres fuentes corren en ella,
  // una tras otra; la estimación toma otra, con 10 s. Las consultas van por canal (mediciones) y por dispositivo (tramas y eventos), con paginación por clave
  // dentro de cada uno, para que cada tanda use los índices que ya existen (uq_medicion_canal_tiempo, idx_trama_dispositivo_id,
  // idx_evento_dispositivo_ocurrido_en_id) y el costo crezca con los datos del sitio, no con los de toda la instalación (planes medidos
  // con EXPLAIN (ANALYZE, BUFFERS) en docs/16 §89). Todos los dispositivos del sitio en cualquier estado: un equipo no cambia de sitio, solo
  // de zona dentro del mismo (configuracion.service.ts), así que su sitio actual basta para RF-41.
  // `topeMs`: 30 s para la exportación; la estimación pasa 10 s (sitios.controller.ts).
  async conConexionExportacion<T>(fn: (c: PoolClient) => Promise<T>, topeMs = 30_000): Promise<T> {
    const { cliente, devolver } = await this.prestarCliente(topeMs);
    try {
      return await fn(cliente);
    } finally {
      await devolver();
    }
  }

  // Código y nombre del sitio, para el nombre del archivo y su cabecera (404 si no existe: el controlador ya lo comprobó con exigirSitio).
  async sitioExportable(sitioId: string): Promise<{ codigo: string; nombre: string }> {
    const r = await this.pool.query<{ codigo: string; nombre: string }>('SELECT codigo, nombre FROM sitio WHERE id = $1', [sitioId]);
    if (!r.rows[0]) throw new NotFoundException('sitio no encontrado');
    return r.rows[0];
  }

  private async dispositivosDelSitio(c: Pick<PoolClient, 'query'>, sitioId: string): Promise<{ id: string; id_fisico: string }[]> {
    return (await c.query<{ id: string; id_fisico: string }>(
      'SELECT d.id, d.id_fisico FROM dispositivo d JOIN zona z ON z.id = d.zona_id WHERE z.sitio_id = $1 ORDER BY d.id_fisico', [sitioId])).rows;
  }

  // Mediciones del sitio, canal por canal (por dispositivo y magnitud), y dentro de cada canal por tiempo: (canal_id, tiempo) es único
  // (migración 06), así que la clave de la página es el tiempo, que viaja como texto exacto de la base (microsegundos).
  async *medicionesSitio(c: Pick<PoolClient, 'query'>, sitioId: string, desde: Date, hasta: Date, tanda = 10_000): AsyncGenerator<FilaMedicionSitio> {
    const canales = await c.query<{ id: string; id_fisico: string; magnitud: string }>(
      `SELECT ca.id, d.id_fisico, ca.magnitud_codigo AS magnitud
         FROM canal ca JOIN dispositivo d ON d.id = ca.dispositivo_id JOIN zona z ON z.id = d.zona_id
        WHERE z.sitio_id = $1 ORDER BY d.id_fisico, ca.magnitud_codigo`, [sitioId]);
    for (const k of canales.rows) {
      let ultimo: string | null = null;
      for (;;) {
        const r: { rows: { tiempo_utc: string; valor: number; unidad: string }[] } = await c.query(
          `SELECT ${isoUs('m.tiempo')} AS tiempo_utc, m.valor, m.unidad
             FROM medicion m
            WHERE m.canal_id = $1 AND m.tiempo >= $2 AND m.tiempo < $3 AND ($4::timestamptz IS NULL OR m.tiempo > $4::timestamptz)
            ORDER BY m.tiempo LIMIT $5`, [k.id, desde, hasta, ultimo, tanda]);
        for (const x of r.rows) yield { tiempo_utc: x.tiempo_utc, id_fisico: k.id_fisico, magnitud: k.magnitud, valor: x.valor, unidad: x.unidad, canal_id: k.id };
        const ult = r.rows[r.rows.length - 1];
        if (r.rows.length < tanda || ult === undefined) break;
        ultimo = ult.tiempo_utc;
      }
    }
  }

  // Tramas aceptadas del sitio, dispositivo por dispositivo y por (recibido_en, id). La huella y el tamaño los calcula la base sobre los
  // bytes guardados; la carga va en base64 sin los saltos de línea que encode() pone cada 76 caracteres. Tandas chicas: una trama pesa
  // hasta 64 KiB (87 384 caracteres en base64), y 250 son ≈ 22 MB en el peor caso. La condición `recibido_en >= clave` acota el recorrido
  // del índice (que no tiene `id`): sin ella, cada página volvería a leer desde `desde`.
  async *tramasSitio(c: Pick<PoolClient, 'query'>, sitioId: string, desde: Date, hasta: Date, tanda = 250): AsyncGenerator<FilaTramaSitio> {
    for (const d of await this.dispositivosDelSitio(c, sitioId)) {
      let clave: { t: string; id: string } | null = null;
      for (;;) {
        const r: { rows: (Omit<FilaTramaSitio, 'id_fisico'> & { id: string })[] } = await c.query(
          `SELECT ${isoUs('t.recibido_en')} AS recibido_en_utc, t.id, t.topico, t.adaptador, octet_length(t.payload) AS bytes,
                  encode(sha256(t.payload), 'hex') AS sha256, translate(encode(t.payload, 'base64'), E'\n', '') AS payload_base64
             FROM trama t
            WHERE t.dispositivo_id = $1 AND t.recibido_en >= $2 AND t.recibido_en < $3
              AND ($4::timestamptz IS NULL OR (t.recibido_en >= $4::timestamptz AND (t.recibido_en, t.id) > ($4::timestamptz, $5::uuid)))
            ORDER BY t.recibido_en, t.id LIMIT $6`, [d.id, desde, hasta, clave?.t ?? null, clave?.id ?? null, tanda]);
        for (const x of r.rows) {
          yield { recibido_en_utc: x.recibido_en_utc, id_fisico: d.id_fisico, topico: x.topico, adaptador: x.adaptador, bytes: x.bytes, sha256: x.sha256, payload_base64: x.payload_base64 };
        }
        const ult = r.rows[r.rows.length - 1];
        if (r.rows.length < tanda || ult === undefined) break;
        clave = { t: ult.recibido_en_utc, id: ult.id };
      }
    }
  }

  // Eventos del ciclo de vida de los dispositivos del sitio (los de GET /eventos, RF-33), por (ocurrido_en, id) con el índice de la
  // migración 23. Sin `usuario_id`: quién lo hizo es un dato personal y se queda en «Actividad» (docs/21; bloque R, punto 1).
  async *eventosSitio(c: Pick<PoolClient, 'query'>, sitioId: string, desde: Date, hasta: Date, tanda = 10_000): AsyncGenerator<FilaEventoSitio> {
    for (const d of await this.dispositivosDelSitio(c, sitioId)) {
      let clave: { t: string; id: string } | null = null;
      for (;;) {
        const r: { rows: { ocurrido_en_utc: string; id: string; tipo: string; detalle: unknown }[] } = await c.query(
          `SELECT ${isoUs('e.ocurrido_en')} AS ocurrido_en_utc, e.id, e.tipo, e.detalle
             FROM evento e
            WHERE e.dispositivo_id = $1 AND e.ocurrido_en >= $2 AND e.ocurrido_en < $3
              AND ($4::timestamptz IS NULL OR (e.ocurrido_en >= $4::timestamptz AND (e.ocurrido_en, e.id) > ($4::timestamptz, $5::uuid)))
            ORDER BY e.ocurrido_en, e.id LIMIT $6`, [d.id, desde, hasta, clave?.t ?? null, clave?.id ?? null, tanda]);
        for (const x of r.rows) yield { ocurrido_en_utc: x.ocurrido_en_utc, id_fisico: d.id_fisico, tipo: x.tipo, detalle: x.detalle };
        const ult = r.rows[r.rows.length - 1];
        if (r.rows.length < tanda || ult === undefined) break;
        clave = { t: ult.ocurrido_en_utc, id: ult.id };
      }
    }
  }

  // Estimación antes de descargar (bloque R, punto 5): cuántas filas trae cada conjunto, contadas con tope. El LIMIT de adentro corta cada
  // canal o dispositivo y el de afuera, el total: ninguna cuenta recorre más de `tope + 1` entradas del índice. `tramas_desde`: la trama más
  // antigua del rango (las tramas vencen a los RETENCION_TRAMA_DIAS), o null si no hay.
  async estimarSitio(c: Pick<PoolClient, 'query'>, sitioId: string, desde: Date, hasta: Date, tope: number) {
    const contar = async (sql: string): Promise<number> => (await c.query<{ n: number }>(sql, [sitioId, desde, hasta, tope + 1])).rows[0]?.n ?? 0;
    const mediciones = await contar(`
      SELECT count(*)::int AS n FROM (
        SELECT 1 FROM canal ca JOIN dispositivo d ON d.id = ca.dispositivo_id JOIN zona z ON z.id = d.zona_id
         CROSS JOIN LATERAL (SELECT 1 FROM medicion m WHERE m.canal_id = ca.id AND m.tiempo >= $2 AND m.tiempo < $3 LIMIT $4) x
         WHERE z.sitio_id = $1 LIMIT $4) y`);
    const tramas = await contar(`
      SELECT count(*)::int AS n FROM (
        SELECT 1 FROM dispositivo d JOIN zona z ON z.id = d.zona_id
         CROSS JOIN LATERAL (SELECT 1 FROM trama t WHERE t.dispositivo_id = d.id AND t.recibido_en >= $2 AND t.recibido_en < $3 LIMIT $4) x
         WHERE z.sitio_id = $1 LIMIT $4) y`);
    const eventos = await contar(`
      SELECT count(*)::int AS n FROM (
        SELECT 1 FROM dispositivo d JOIN zona z ON z.id = d.zona_id
         CROSS JOIN LATERAL (SELECT 1 FROM evento e WHERE e.dispositivo_id = d.id AND e.ocurrido_en >= $2 AND e.ocurrido_en < $3 LIMIT $4) x
         WHERE z.sitio_id = $1 LIMIT $4) y`);
    const primera = await c.query<{ t: Date | null }>(`
      SELECT min(x.t) AS t FROM dispositivo d JOIN zona z ON z.id = d.zona_id
       CROSS JOIN LATERAL (SELECT t.recibido_en AS t FROM trama t WHERE t.dispositivo_id = d.id AND t.recibido_en >= $2 AND t.recibido_en < $3
                            ORDER BY t.recibido_en LIMIT 1) x
       WHERE z.sitio_id = $1`, [sitioId, desde, hasta]);
    return { mediciones, tramas, eventos, tramasDesde: primera.rows[0]?.t ?? null };
  }

  // La carga cruda se devuelve acotada: es para diagnosticar, no para reprocesar. payload_legible (migración 09)
  // da texto si es UTF-8 y hexadecimal si no: antes, una sola trama binaria hacía fallar la consulta entera.
  // El detalle dice el porqué concreto («temperatura: 500 Cel fuera del rango físico [-40, 85]»).
  // `dispositivoId` (opcional, UUID validado): solo lo rechazado de ese dispositivo (las de `no_registrado` no tienen dueño).
  // `sitios`: alcance de quien pregunta (null = todos). Una trama se atribuye al sitio de su dispositivo y, si no se identificó
  // (no_registrado, malformada sin emisor), al sitio cuyo código va en el tópico (`sitio/<codigo>/…`): el sitio al que iba dirigida
  // (decidido al implementar, 08/11/2026). Lo que no calza con ningún sitio solo lo ve el usuario del sistema.
  // `cursor`: como en condiciones, por (recibido_en, id) con idx_cuarentena_recibido_en_id (migración 23).
  async cuarentena(lim: number, dispositivoId?: string, sitios: string[] | null = null, cursor?: Cursor) {
    const condiciones: string[] = [];
    const parametros: unknown[] = [lim];
    if (cursor !== undefined) {
      parametros.push(cursor.t, cursor.id);
      condiciones.push(`(q.recibido_en, q.id) < ($${parametros.length - 1}::timestamptz, $${parametros.length}::uuid)`);
    }
    if (dispositivoId !== undefined) {
      parametros.push(dispositivoId);
      condiciones.push(`q.dispositivo_id = $${parametros.length}`);
    }
    if (sitios !== null) {
      parametros.push(sitios);
      condiciones.push(`coalesce(z.sitio_id, st.id) = ANY($${parametros.length}::uuid[])`);
    }
    const filtro = condiciones.length === 0 ? '' : `WHERE ${condiciones.join(' AND ')}`;
    const r = await this.pool.query(`
      SELECT q.id, q.origen, q.topico, q.motivo, q.detalle, d.id_fisico AS dispositivo, q.recibido_en,
             p.texto AS payload, p.formato AS payload_formato, ${isoUs('q.recibido_en')} AS clave_t
        FROM cuarentena q
        LEFT JOIN dispositivo d ON d.id = q.dispositivo_id
        LEFT JOIN zona z ON z.id = d.zona_id
        LEFT JOIN sitio st ON q.dispositivo_id IS NULL AND st.codigo = split_part(q.topico, '/', 2)
        CROSS JOIN LATERAL payload_legible(q.payload_crudo, 200) p
        ${filtro}
       ORDER BY q.recibido_en DESC, q.id DESC LIMIT $1`, parametros);
    return r.rows as (Record<string, unknown> & { id: string; clave_t: string })[];
  }
}
