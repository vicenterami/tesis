import { BadRequestException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { POOL } from '../db/db.module.js';
import { isoUs } from '../db/iso-us.js';
import {
  CUBOS_CHISPA, CanalConUltima, Cursor, Entrega, FilaCubo, FilaMagnitud, HISTORICO_SITIO, SQL_EN_LINEA, SQL_ESTADO_VISUAL, SQL_HISTORICO_SITIO,
  SQL_LECTURA_VIGENTE, TENDENCIA, alinear,
  armarChispas, elegirCanales, entrega, esSalud, porMagnitud, sqlLimiteVigencia, ventanaChispa,
} from './tablero.js';
import { AvisosAcotados } from '../arranque.js';
import { errorDeCliente } from '../db/cliente.js';
import { SQL_ULTIMA_MEDICION } from './consulta.service.js';
import { porcentaje } from './escala.js';
import { Intervalo } from './validacion.js';
import { PLAZOS, leerEntero } from '../retencion/retencion.service.js';

// Lecturas del tablero v2 (docs/19 §4, bloque «Tablero v2», I; docs/10 §8.4 punto 65). SQL explícito y parametrizado, como el resto de
// la consulta; el alcance por sitio lo resuelve el controlador (permitir) y, en las listas, va en el WHERE (punto 36).

// Retención de `trama` (RETENCION_TRAMA_DIAS): antes de ese horizonte no hay con qué contar la entrega. La misma fila de límites y la misma
// lectura que RetencionService (por defecto 30, mínimo 7, y un valor inválido es error, no un 30 en silencio: el arranque ya lo rechazó).
const PLAZO_TRAMA = PLAZOS.find((p) => p.tabla === 'trama');
export function diasRetencionTrama(valor = process.env.RETENCION_TRAMA_DIAS): number {
  if (PLAZO_TRAMA === undefined || PLAZO_TRAMA.porDefecto === null) throw new Error('falta el plazo de retención de trama en PLAZOS');
  return leerEntero(valor, { ...PLAZO_TRAMA, porDefecto: PLAZO_TRAMA.porDefecto });
}

// La entrega del resumen (punto 65 vii): por dispositivo activo, con entrega(), de peor a mejor; solo los MAX_ENTREGA_RESUMEN peores (el
// panel muestra diez y «ver todos» va al inventario con orden=entrega) y `total_activos`, cuántos hay. El horizonte de retención se mide
// desde AHORA, no desde `hasta`: una ventana pasada que cae entera antes de él no tiene tramas con qué contar y da nulo, no 0 %.
export const MAX_ENTREGA_RESUMEN = 50;
export interface BaseEntrega { id: string; nombre: string; recibidas: number; creado_en: string; intervalo_esperado_s: number }
export function entregasDelResumen(base: readonly BaseEntrega[], desde: Date, hasta: Date, ahora = new Date(), dias = diasRetencionTrama()) {
  const retencion = new Date(ahora.getTime() - dias * 86_400_000);
  const todas = base
    .map((x) => ({ id: x.id, nombre: x.nombre, ...entrega(x.recibidas, desde, hasta, new Date(x.creado_en), x.intervalo_esperado_s, retencion) }))
    .sort(peorPrimero);
  return { entrega: todas.slice(0, MAX_ENTREGA_RESUMEN), total_activos: todas.length };
}

export interface SitioDeSesion {
  id: string; codigo: string; nombre: string; zona_horaria: string; rol: string; zonas: { id: string; nombre: string }[];
}

@Injectable()
export class TableroService {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  // GET /sitios: los sitios activos del alcance (null = todos, el usuario del sistema) con sus zonas; el rol lo pone el controlador.
  async sitios(alcance: string[] | null): Promise<Omit<SitioDeSesion, 'rol'>[]> {
    const r = await this.pool.query<Omit<SitioDeSesion, 'rol'>>(`
      SELECT s.id, s.codigo, s.nombre, s.zona_horaria,
             (SELECT coalesce(json_agg(json_build_object('id', z.id, 'nombre', z.nombre) ORDER BY z.nombre), '[]'::json)
                FROM zona z WHERE z.sitio_id = s.id) AS zonas
        FROM sitio s
       WHERE s.activo AND ($1::uuid[] IS NULL OR s.id = ANY($1::uuid[]))
       ORDER BY s.nombre`, [alcance]);
    return r.rows;
  }

  // GET /sitios/{id}/resumen (docs/19 §4, B2–B4; punto 65 iii): UNA consulta por petición, sin tabla materializada. Conteos por estado
  // visual (la misma regla SQL que el inventario), salud = en línea ÷ supervisados (los no inactivos), condiciones abiertas por tipo, tramas
  // recibidas (`trama`) y rechazadas (`cuarentena`, atribuidas al sitio como en GET /cuarentena) por cubo de la resolución del rango, los
  // diez que requieren atención (sin señal primero, después alerta, por nombre), las magnitudes medidas y, por dispositivo activo, lo que
  // hace falta para la entrega (el % lo calcula entrega(), la misma función que el inventario).
  async resumen(sitioId: string, desde: Date, hasta: Date, intervalo: Intervalo) {
    const r = await this.pool.query<{ sitio: Record<string, unknown> | null; r: Record<string, unknown> & { entrega_base: BaseEntrega[] } }>(`
      WITH s AS (SELECT id, codigo, nombre, zona_horaria FROM sitio WHERE id = $1),
      dev AS (
        SELECT d.id, d.nombre, d.estado, d.intervalo_esperado_s, d.creado_en, e.visto_por_ultima_vez,
               ${SQL_EN_LINEA} AS en_linea, ${SQL_ESTADO_VISUAL} AS estado_visual,
               (SELECT coalesce(array_agg(DISTINCT cv.tipo), '{}') FROM condicion cv WHERE cv.dispositivo_id = d.id AND cv.cerrada_en IS NULL) AS tipos
          FROM dispositivo d JOIN zona z ON z.id = d.zona_id LEFT JOIN estado_dispositivo e ON e.dispositivo_id = d.id
         WHERE z.sitio_id = $1),
      tr AS (SELECT t.dispositivo_id, t.recibido_en FROM trama t
              WHERE t.dispositivo_id IN (SELECT id FROM dev) AND t.recibido_en >= $2 AND t.recibido_en < $3),
      rq AS (SELECT q.recibido_en FROM cuarentena q
               LEFT JOIN dispositivo dq ON dq.id = q.dispositivo_id LEFT JOIN zona zq ON zq.id = dq.zona_id
              WHERE q.recibido_en >= $2 AND q.recibido_en < $3
                AND (zq.sitio_id = $1 OR (q.dispositivo_id IS NULL AND split_part(q.topico, '/', 2) = (SELECT codigo FROM s)))),
      cub AS (SELECT b, sum(rc)::int AS recibidas, sum(rx)::int AS rechazadas FROM (
                SELECT time_bucket($4::interval, recibido_en, (SELECT zona_horaria FROM s)) AS b, 1 AS rc, 0 AS rx FROM tr
                UNION ALL
                SELECT time_bucket($4::interval, recibido_en, (SELECT zona_horaria FROM s)), 0, 1 FROM rq) u
              GROUP BY b)
      SELECT (SELECT row_to_json(s) FROM s) AS sitio, json_build_object(
        'dispositivos', (SELECT json_build_object(
            'total', count(*)::int,
            'normal', (count(*) FILTER (WHERE estado_visual = 'normal'))::int,
            'alerta', (count(*) FILTER (WHERE estado_visual = 'alerta'))::int,
            'sin_senal', (count(*) FILTER (WHERE estado_visual = 'sin_senal'))::int,
            'inactivo', (count(*) FILTER (WHERE estado_visual = 'inactivo'))::int) FROM dev),
        'salud', (SELECT json_build_object(
            'reportan', (count(*) FILTER (WHERE estado_visual <> 'inactivo' AND en_linea IS TRUE))::int,
            'supervisados', (count(*) FILTER (WHERE estado_visual <> 'inactivo'))::int) FROM dev),
        'condiciones_abiertas', (SELECT coalesce(json_agg(json_build_object('tipo', k.tipo, 'n', k.n) ORDER BY k.n DESC, k.tipo), '[]'::json)
            FROM (SELECT c.tipo, count(*)::int AS n FROM condicion c
                   WHERE c.cerrada_en IS NULL AND c.dispositivo_id IN (SELECT id FROM dev) GROUP BY c.tipo) k),
        'tramas', json_build_object(
            'recibidas', (SELECT count(*)::int FROM tr),
            'rechazadas', (SELECT count(*)::int FROM rq),
            'cubos', (SELECT coalesce(json_agg(json_build_object('tiempo', extract(epoch FROM b)::bigint, 'recibidas', recibidas, 'rechazadas', rechazadas) ORDER BY b), '[]'::json) FROM cub)),
        'atencion', (SELECT coalesce(json_agg(json_build_object('id', a.id, 'nombre', a.nombre, 'estado_visual', a.estado_visual,
                                     'visto_por_ultima_vez', iso_utc(a.visto_por_ultima_vez), 'tipos', a.tipos) ORDER BY a.orden, a.nombre, a.id), '[]'::json)
            FROM (SELECT dev.*, CASE dev.estado_visual WHEN 'sin_senal' THEN 0 ELSE 1 END AS orden FROM dev
                   WHERE dev.estado_visual IN ('sin_senal', 'alerta') ORDER BY orden, dev.nombre, dev.id LIMIT 10) a),
        'magnitudes', (SELECT coalesce(json_agg(json_build_object('codigo', m.codigo, 'nombre', m.nombre, 'unidad', m.unidad_canonica, 'canales', k.n) ORDER BY m.codigo), '[]'::json)
            FROM (SELECT c.magnitud_codigo, count(*)::int AS n FROM canal c JOIN dev ON dev.id = c.dispositivo_id
                   WHERE dev.estado <> 'baja' GROUP BY c.magnitud_codigo) k JOIN magnitud m ON m.codigo = k.magnitud_codigo),
        'entrega_base', (SELECT coalesce(json_agg(json_build_object('id', dev.id, 'nombre', dev.nombre, 'recibidas', coalesce(t.n, 0),
                                     'creado_en', iso_utc(dev.creado_en), 'intervalo_esperado_s', dev.intervalo_esperado_s)), '[]'::json)
            FROM dev LEFT JOIN (SELECT dispositivo_id, count(*)::int AS n FROM tr GROUP BY dispositivo_id) t ON t.dispositivo_id = dev.id
           WHERE dev.estado = 'activo')
      ) AS r`, [sitioId, desde, hasta, intervalo]);
    const fila = r.rows[0];
    if (fila === undefined || fila.sitio === null) throw new NotFoundException('sitio no encontrado');
    const { entrega_base, salud, ...resto } = fila.r as typeof fila.r & { salud: { reportan: number; supervisados: number } };
    return {
      sitio: fila.sitio,
      ventana: { desde, hasta, intervalo },
      ...resto,
      salud: { ...salud, porcentaje: salud.supervisados > 0 ? Math.round((1000 * salud.reportan) / salud.supervisados) / 10 : null },
      ...entregasDelResumen(entrega_base, desde, hasta),
    };
  }

  // GET /sitios/{id}/ahora (docs/19 §4, bloque L, puntos 3 y 6; docs/10 §8.4 punto 65 viii): lo que mide cada dispositivo del sitio en
  // este momento. Como mucho tres consultas por petición, sin ninguna por fila: (1) los dispositivos con su estado visual (la regla SQL del
  // inventario y del resumen), los conteos, la página ordenada y el agregado por magnitud, calculado EN LA BASE sobre la última lectura de
  // cada canal de los que reportan (una fila por magnitud: desde el 13/11/2026 ya no viajan al proceso los canales de todo el sitio); (2) solo
  // si la página trae dispositivos, los canales DE LA PÁGINA con su última lectura (la consulta de la ficha, SQL_ULTIMA_MEDICION), de donde
  // salen los tres de cada tarjeta; (3) solo con `tendencia` y algún canal mostrado, los promedios por hora de esos canales, en una conexión
  // propia con tiempo máximo y cupo (tendencias(): si no alcanza, la respuesta sale con `tendencia: false`). ahora.spec.ts las cuenta.
  async ahora(sitioId: string, limite: number, tendencia: boolean) {
    const r = await this.pool.query<{
      existe: boolean; ahora: string; reportan: number; sin_senal: number; por_magnitud: FilaMagnitud[];
      pagina: { id: string; nombre: string; zona: string; estado_visual: string; visto_por_ultima_vez: string | null; intervalo_esperado_s: number }[];
    }>(`
      WITH dev AS (
        SELECT d.id, d.nombre, z.nombre AS zona, d.intervalo_esperado_s, e.visto_por_ultima_vez, ${SQL_ESTADO_VISUAL} AS estado_visual
          FROM dispositivo d JOIN zona z ON z.id = d.zona_id LEFT JOIN estado_dispositivo e ON e.dispositivo_id = d.id
         WHERE z.sitio_id = $1),
      mag AS (
        SELECT c.magnitud_codigo AS codigo, count(*)::int AS canales, avg(u.valor) AS promedio, min(u.valor) AS minimo, max(u.valor) AS maximo
          FROM dev JOIN canal c ON c.dispositivo_id = dev.id
         CROSS JOIN LATERAL (SELECT x.valor, x.tiempo FROM medicion x WHERE x.canal_id = c.id ORDER BY x.tiempo DESC LIMIT 1) u
         WHERE dev.estado_visual IN ('normal', 'alerta') AND ${SQL_LECTURA_VIGENTE}
         GROUP BY c.magnitud_codigo)
      SELECT EXISTS (SELECT 1 FROM sitio WHERE id = $1) AS existe, iso_utc(now()) AS ahora,
             (SELECT count(*)::int FROM dev WHERE estado_visual IN ('normal', 'alerta')) AS reportan,
             (SELECT count(*)::int FROM dev WHERE estado_visual = 'sin_senal') AS sin_senal,
             (SELECT coalesce(json_agg(json_build_object('codigo', mag.codigo, 'nombre', m.nombre, 'unidad', m.unidad_canonica, 'canales', mag.canales,
                                       'promedio', mag.promedio, 'minimo', mag.minimo, 'maximo', mag.maximo)), '[]'::json)
                FROM mag JOIN magnitud m ON m.codigo = mag.codigo) AS por_magnitud,
             (SELECT coalesce(json_agg(json_build_object('id', p.id, 'nombre', p.nombre, 'zona', p.zona, 'estado_visual', p.estado_visual,
                                       'visto_por_ultima_vez', iso_utc(p.visto_por_ultima_vez), 'intervalo_esperado_s', p.intervalo_esperado_s)
                                       ORDER BY p.orden, p.zona, p.nombre, p.id), '[]'::json)
                FROM (SELECT dev.*, CASE dev.estado_visual WHEN 'alerta' THEN 0 ELSE 1 END AS orden FROM dev
                       WHERE dev.estado_visual IN ('normal', 'alerta') ORDER BY orden, dev.zona, dev.nombre, dev.id LIMIT $2) p) AS pagina`,
      [sitioId, limite]);
    const base = r.rows[0];
    if (base === undefined || !base.existe) throw new NotFoundException('sitio no encontrado');
    const enPagina = base.pagina.map((d) => d.id);
    const c = enPagina.length === 0 ? { rows: [] as CanalConUltima[] } : await this.pool.query<CanalConUltima>(`
      SELECT c.id, c.dispositivo_id, c.magnitud_codigo AS magnitud, m.nombre AS magnitud_nombre, m.unidad_canonica AS unidad,
             d.intervalo_esperado_s, c.escala_cero, c.escala_cien, ${SQL_ULTIMA_MEDICION} AS ultima
        FROM canal c JOIN magnitud m ON m.codigo = c.magnitud_codigo JOIN dispositivo d ON d.id = c.dispositivo_id
       WHERE c.dispositivo_id = ANY($1::uuid[])`, [enPagina]);
    const porDispositivo = new Map<string, CanalConUltima[]>();
    for (const k of c.rows) {
      const lista = porDispositivo.get(k.dispositivo_id);
      if (lista === undefined) porDispositivo.set(k.dispositivo_id, [k]);
      else lista.push(k);
    }
    const dispositivos = base.pagina.map((d) => {
      const todos = porDispositivo.get(d.id) ?? [];
      return { ...d, canales_total: todos.length, canales: elegirCanales(todos) };
    });
    const mostrados = dispositivos.flatMap((d) => d.canales.map((k) => k.id));
    let chispas: Map<string, (number | null)[]> | undefined;
    let chispa: { desde: string; intervalo: '1 hour'; puntos: number } | undefined;
    if (tendencia) {
      const v = ventanaChispa(Date.parse(base.ahora));
      const filas = mostrados.length === 0 ? [] : await this.tendencias(mostrados, v.desde, v.hasta);
      if (filas !== null) {
        chispas = armarChispas(filas.map((x) => ({ canal_id: x.canal_id, t: Number(x.t), v: x.v })), mostrados, v.desde);
        chispa = { desde: v.desde.toISOString(), intervalo: '1 hour', puntos: CUBOS_CHISPA };
      }
    }
    return {
      reportan: base.reportan,
      sin_senal: base.sin_senal,
      por_magnitud: porMagnitud(base.por_magnitud),
      dispositivos: dispositivos.map((d) => ({
        ...d,
        canales: d.canales.map((k) => ({
          id: k.id, magnitud: k.magnitud, magnitud_nombre: k.magnitud_nombre, unidad: k.unidad, salud: esSalud(k.magnitud),
          ultima: k.ultima && { ...k.ultima, porcentaje: porcentaje(k.ultima.valor, k.escala_cero, k.escala_cien) },
          ...(chispas === undefined ? {} : { chispa: chispas.get(k.id) ?? new Array<number | null>(CUBOS_CHISPA).fill(null) }),
        })),
      })),
      // Siempre presente: true si la tendencia va en la respuesta; false si no se pidió o si se omitió (tiempo vencido o sin cupo).
      tendencia: chispa !== undefined,
      ...(chispa === undefined ? {} : { chispa }),
    };
  }

  // La tendencia de «Ahora» con sus dos topes (TENDENCIA, tablero.ts; docs/11 §4): como mucho dos a la vez en el proceso, cada una en una
  // conexión propia con tiempo máximo de sentencia (conTiempoMaximo). null = se omite: sin cupo (sin tocar la base) o tiempo vencido (57014,
  // query_canceled). Cualquier otro error de la base sigue siendo un error.
  private tendenciasEnCurso = 0;
  private readonly avisos = new AvisosAcotados(); // un WARN por motivo y por minuto
  private readonly log = new Logger('tablero');
  private async tendencias(canales: string[], desde: Date, hasta: Date): Promise<{ canal_id: string; t: string; v: number }[] | null> {
    if (this.tendenciasEnCurso >= TENDENCIA.maxEnCurso) {
      this.omitida(`sin cupo (${TENDENCIA.maxEnCurso} cálculos en curso)`);
      return null;
    }
    this.tendenciasEnCurso++;
    try {
      const t = await this.conTiempoMaximo(TENDENCIA.tiempoMaximoMs, (cliente) => cliente.query<{ canal_id: string; t: string; v: number }>(`
          SELECT x.canal_id, extract(epoch FROM time_bucket(INTERVAL '1 hour', x.tiempo))::bigint AS t, round(avg(x.valor)::numeric, 3)::float AS v
            FROM medicion x
           WHERE x.canal_id = ANY($1::uuid[]) AND x.tiempo >= $2 AND x.tiempo < $3
           GROUP BY 1, 2`, [canales, desde, hasta]));
      if (t === null) this.omitida(`tiempo máximo vencido (${TENDENCIA.tiempoMaximoMs} ms)`);
      return t?.rows ?? null;
    } finally {
      this.tendenciasEnCurso--;
    }
  }
  // Una consulta en una conexión propia con tiempo máximo de sentencia (el mecanismo de la exportación, consulta.service.ts), para la
  // tendencia y el histórico del sitio. null = venció el tiempo (57014); cualquier otro error sigue siendo un error. La conexión vuelve al
  // grupo con el tope restablecido (RESET) también si la consulta falla; si ni el RESET se puede (la conexión se cortó a mitad), se
  // devuelve con ese error y el grupo la DESTRUYE en vez de reusarla con el tope puesto (pg-pool: release(err) la quita del grupo).
  private async conTiempoMaximo<T>(ms: number, consulta: (cliente: PoolClient) => Promise<T>): Promise<T | null> {
    const cliente = await this.pool.connect();
    cliente.on('error', errorDeCliente); // un corte de la base a mitad falla esta petición, no el proceso (db/cliente.ts)
    let rota: Error | undefined;
    try {
      await cliente.query(`SET statement_timeout TO ${ms}`);
      return await consulta(cliente);
    } catch (e) {
      if ((e as { code?: string }).code !== '57014') throw e;
      return null;
    } finally {
      try {
        await cliente.query('RESET statement_timeout');
      } catch (e) {
        rota = e instanceof Error ? e : new Error(String(e));
      }
      cliente.off('error', errorDeCliente);
      cliente.release(rota);
    }
  }
  private omitida(motivo: string): void {
    const aviso = this.avisos.registrar(motivo);
    if (aviso !== null) this.log.warn(`«Ahora» respondió sin tendencia: ${aviso}`);
  }

  // El cupo del histórico del sitio (HISTORICO_SITIO, tablero.ts; docs/19 §4, M5): como mucho `maxEnCurso` consultas a la vez en el proceso,
  // para que las gráficas de una pestaña (hasta seis magnitudes juntas) no dejen sin conexiones a la recepción; las demás esperan en fila,
  // en orden de llegada, y con la fila llena se responde 503 sin tocar la base. Al soltar, el cupo pasa directo a quien espera primero.
  private historicosEnCurso = 0;
  private readonly filaHistorico: (() => void)[] = [];
  private async tomarCupoHistorico(): Promise<void> {
    if (this.historicosEnCurso < HISTORICO_SITIO.maxEnCurso) {
      this.historicosEnCurso++;
      return;
    }
    if (this.filaHistorico.length >= HISTORICO_SITIO.maxEnEspera) {
      throw new ServiceUnavailableException('hay demasiadas gráficas del sitio en espera: reintenta en un momento');
    }
    await new Promise<void>((seguir) => this.filaHistorico.push(seguir));
  }
  private soltarCupoHistorico(): void {
    const siguiente = this.filaHistorico.shift();
    if (siguiente !== undefined) siguiente();
    else this.historicosEnCurso--;
  }

  // GET /sitios/{id}/historico?magnitud (docs/19 §4, B4b y M): por tramo, el promedio de los DISPOSITIVOS que aportan (cada uno con el
  // promedio de sus lecturas del tramo o su última lectura vigente; SQL_HISTORICO_SITIO, tablero.ts), el mínimo y el máximo entre ellos,
  // las lecturas reales (`muestras`) y cuántos aportan (`n`); `dispositivos`, cuántos aportan en algún tramo («hasta 9»). La forma del
  // histórico de un canal, sin calibración (escala y porcentajes nulos: cada canal tiene la suya). Dos consultas: la primera trae la zona,
  // la unidad y la cota de lo que se lee (el inicio del primer tramo menos dos veces el mayor intervalo esperado de los canales); la
  // segunda, en una conexión propia con tiempo máximo (HISTORICO_SITIO): si lo excede, 503 y la conexión vuelve sin el tope.
  async historicoSitio(sitioId: string, magnitud: string, desde: Date, hasta: Date, intervalo: Intervalo) {
    const m = await this.pool.query<{ zona_horaria: string; unidad: string; nombre: string; cota: string }>(`
      SELECT s.zona_horaria, m.unidad_canonica AS unidad, m.nombre,
             iso_utc(${sqlLimiteVigencia('time_bucket($3::interval, $4::timestamptz, s.zona_horaria)', 'mx.i')}) AS cota
        FROM sitio s CROSS JOIN magnitud m
       CROSS JOIN LATERAL (
             SELECT coalesce(max(d.intervalo_esperado_s), 0) AS i
               FROM canal c JOIN dispositivo d ON d.id = c.dispositivo_id JOIN zona z ON z.id = d.zona_id
              WHERE z.sitio_id = s.id AND c.magnitud_codigo = m.codigo) mx
       WHERE s.id = $1 AND m.codigo = $2`,
      [sitioId, magnitud, intervalo, desde],
    );
    const meta = m.rows[0];
    if (meta === undefined) throw new BadRequestException(`magnitud desconocida: ${magnitud}`);
    await this.tomarCupoHistorico();
    let r: { rows: { t: string; v: number; mn: number; mx: number; muestras: number; n: number; dispositivos: number }[] } | null;
    try {
      r = await this.conTiempoMaximo(HISTORICO_SITIO.tiempoMaximoMs, (cliente) =>
        cliente.query<{ t: string; v: number; mn: number; mx: number; muestras: number; n: number; dispositivos: number }>(
          SQL_HISTORICO_SITIO, [sitioId, desde, hasta, intervalo, meta.zona_horaria, magnitud, meta.cota]));
    } finally {
      this.soltarCupoHistorico();
    }
    if (r === null) {
      throw new ServiceUnavailableException(`el histórico del sitio tardó más de ${HISTORICO_SITIO.tiempoMaximoMs / 1000} s: prueba con un rango más corto o más tarde`);
    }
    return {
      sitio_id: sitioId, magnitud, magnitud_nombre: meta.nombre, unidad: meta.unidad, zona_horaria: meta.zona_horaria, intervalo,
      desde, hasta, puntos: r.rows.length, dispositivos: r.rows[0]?.dispositivos ?? 0,
      tiempos: r.rows.map((x) => Number(x.t)),
      valores: r.rows.map((x) => x.v),
      minimos: r.rows.map((x) => x.mn),
      maximos: r.rows.map((x) => x.mx),
      muestras: r.rows.map((x) => x.muestras),
      n: r.rows.map((x) => x.n),
      escala: null,
      porcentajes: null,
    };
  }

  // GET /dispositivos/{id}/historico (docs/19 §4, D2): todos los canales en una respuesta, alineados por cubo (alinear()).
  async historicoDispositivo(dispositivoId: string, desde: Date, hasta: Date, intervalo: Intervalo) {
    const c = await this.pool.query<{ zona_horaria: string; canales: { id: string; magnitud: string; magnitud_nombre: string; unidad: string }[] }>(`
      SELECT s.zona_horaria,
             (SELECT coalesce(json_agg(json_build_object('id', c.id, 'magnitud', c.magnitud_codigo, 'magnitud_nombre', m.nombre, 'unidad', m.unidad_canonica)
                                       ORDER BY c.magnitud_codigo), '[]'::json)
                FROM canal c JOIN magnitud m ON m.codigo = c.magnitud_codigo WHERE c.dispositivo_id = d.id) AS canales
        FROM dispositivo d JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id WHERE d.id = $1`, [dispositivoId]);
    const meta = c.rows[0];
    if (meta === undefined) throw new NotFoundException('dispositivo no encontrado');
    const r = await this.pool.query<{ canal_id: string; t: string; v: number; mn: number; mx: number; muestras: number }>(`
      SELECT x.canal_id, extract(epoch FROM time_bucket($4::interval, x.tiempo, $5))::bigint AS t,
             round(avg(x.valor)::numeric, 3)::float AS v,
             round(min(x.valor)::numeric, 3)::float AS mn,
             round(max(x.valor)::numeric, 3)::float AS mx,
             count(*)::int AS muestras
        FROM medicion x JOIN canal c ON c.id = x.canal_id
       WHERE c.dispositivo_id = $1 AND x.tiempo >= $2 AND x.tiempo < $3
       GROUP BY 1, 2`, [dispositivoId, desde, hasta, intervalo, meta.zona_horaria]);
    const filas: FilaCubo[] = r.rows.map((x) => ({ canal_id: x.canal_id, t: Number(x.t), v: x.v, mn: x.mn, mx: x.mx, muestras: x.muestras }));
    const { tiempos, series } = alinear(filas, meta.canales.map((k) => k.id));
    return {
      dispositivo_id: dispositivoId, zona_horaria: meta.zona_horaria, intervalo, desde, hasta, puntos: tiempos.length, tiempos,
      canales: meta.canales.map((k) => ({ ...k, ...(series.get(k.id) ?? { valores: [], minimos: [], maximos: [], muestras: [] }) })),
    };
  }

  // GET /dispositivos/{id}/eventos (docs/19 §4, D5; punto 58): por clave (ocurrido_en, id) descendente con
  // idx_evento_dispositivo_ocurrido_en_id (migración 23). `usuario` = quién lo hizo si fue una persona (HU-11); nulo = el sistema.
  async eventosDispositivo(dispositivoId: string, desde: Date, hasta: Date, limite: number, cursor?: Cursor) {
    const r = await this.pool.query<{ id: string; tipo: string; detalle: unknown; ocurrido_en: string; usuario: { id: string; nombre: string } | null }>(`
      SELECT ev.id, ev.tipo, ev.detalle, ${isoUs('ev.ocurrido_en')} AS ocurrido_en,
             CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('id', u.id, 'nombre', u.nombre) END AS usuario
        FROM evento ev LEFT JOIN usuario u ON u.id = ev.usuario_id
       WHERE ev.dispositivo_id = $1 AND ev.ocurrido_en >= $2 AND ev.ocurrido_en < $3
         AND ($4::timestamptz IS NULL OR (ev.ocurrido_en, ev.id) < ($4::timestamptz, $5::uuid))
       ORDER BY ev.ocurrido_en DESC, ev.id DESC LIMIT $6`,
      [dispositivoId, desde, hasta, cursor?.t ?? null, cursor?.id ?? null, limite]);
    return r.rows;
  }

  // GET /cuarentena/detectados (docs/19 §4, F3): los emisores no registrados de los últimos 7 días, agrupados por (sitio, emisor): el mismo
  // identificador en dos sitios son dos filas. El emisor sale del tópico (el identificador directo, o el DevEUI tras una pasarela); si no
  // tiene esa forma, el tópico. El sitio, por el código del tópico, como en GET /cuarentena; `sitio_codigo` nulo si el tópico no nombra un
  // sitio existente, lo que solo ve el usuario del sistema (alcance null: LEFT JOIN; con alcance, el WHERE las deja fuera). Hasta 200
  // emisores, los de trama más reciente primero.
  async detectados(sitios: string[] | null) {
    const r = await this.pool.query<{ sitio_codigo: string | null; emisor: string; topico: string | null; tramas: number; ultima: string }>(`
      SELECT g.sitio_codigo, g.emisor, g.topico, g.tramas, iso_utc(g.ultima) AS ultima FROM (
        SELECT st.codigo AS sitio_codigo,
               coalesce(substring(q.topico FROM '^sitio/[^/]+/dispositivo/([^/]+)'),
                        substring(q.topico FROM '^sitio/[^/]+/pasarela/[^/]+/(?:device/)?([^/]+)'),
                        nullif(q.topico, ''), '(sin tópico)') AS emisor,
               (array_agg(q.topico ORDER BY q.recibido_en DESC))[1] AS topico,
               count(*)::int AS tramas, max(q.recibido_en) AS ultima
          FROM cuarentena q
          LEFT JOIN sitio st ON st.codigo = split_part(q.topico, '/', 2)
         WHERE q.motivo = 'no_registrado' AND q.dispositivo_id IS NULL AND q.recibido_en >= now() - INTERVAL '7 days'
           AND ($1::uuid[] IS NULL OR st.id = ANY($1::uuid[]))
         GROUP BY 1, 2) g
       ORDER BY g.ultima DESC LIMIT 200`, [sitios]);
    return r.rows;
  }
}

// De peor a mejor entrega; sin cálculo (nulo) al final, por nombre.
function peorPrimero(a: Entrega & { nombre: string }, b: Entrega & { nombre: string }): number {
  if (a.porcentaje === null || b.porcentaje === null) return (a.porcentaje === null ? 1 : 0) - (b.porcentaje === null ? 1 : 0) || a.nombre.localeCompare(b.nombre, 'es');
  return a.porcentaje - b.porcentaje || a.nombre.localeCompare(b.nombre, 'es');
}
