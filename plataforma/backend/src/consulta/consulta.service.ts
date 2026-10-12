import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FilaExportada } from './exportar';
import { Pool } from 'pg';
import { POOL } from '../db/db.module';
import { Intervalo } from './validacion';

// Consultas de lectura. SQL explícito y parametrizado ($1, $2…): se lee, se audita, se explica.
// Las fechas salen como Date → JSON las serializa en ISO 8601 con 'Z' (UTC), regla 5 de docs/13.
// Cuando la fecha va DENTRO de un JSON armado en SQL (json_agg/json_build_object) se usa iso_utc():
// sin ella Postgres emite '+00:00' y la API mezclaría dos formatos.
@Injectable()
export class ConsultaService {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  // Un dispositivo está "en línea" si su último mensaje cae dentro de 2 × su intervalo esperado
  // (mismo criterio que el supervisor: un mensaje perdido no es una caída; dos seguidos, sí).
  async dispositivos() {
    const r = await this.pool.query(`
      SELECT d.id, d.id_fisico, d.nombre, d.estado, d.via, d.formato, d.intervalo_esperado_s,
             e.visto_por_ultima_vez,
             (e.visto_por_ultima_vez >= now() - d.intervalo_esperado_s * 2 * INTERVAL '1 second') AS en_linea,
             z.nombre AS zona, s.nombre AS sitio, s.zona_horaria,
             (SELECT count(*)::int FROM condicion c WHERE c.dispositivo_id = d.id AND c.cerrada_en IS NULL) AS condiciones_abiertas,
             (SELECT coalesce(json_agg(json_build_object('id', c.id, 'magnitud', c.magnitud_codigo, 'unidad', m.unidad_canonica) ORDER BY c.magnitud_codigo), '[]'::json)
                FROM canal c JOIN magnitud m ON m.codigo = c.magnitud_codigo WHERE c.dispositivo_id = d.id) AS canales
        FROM dispositivo d
        LEFT JOIN estado_dispositivo e ON e.dispositivo_id = d.id
        JOIN zona z ON z.id = d.zona_id
        JOIN sitio s ON s.id = z.sitio_id
       ORDER BY s.nombre, z.nombre, d.nombre`);
    return r.rows;
  }

  async dispositivo(id: string) {
    const d = await this.pool.query(`
      SELECT d.id, d.id_fisico, d.nombre, d.estado, d.via, d.formato, d.intervalo_esperado_s, e.visto_por_ultima_vez, d.creado_en,
             (e.visto_por_ultima_vez >= now() - d.intervalo_esperado_s * 2 * INTERVAL '1 second') AS en_linea,
             z.nombre AS zona, s.nombre AS sitio, s.zona_horaria
        FROM dispositivo d LEFT JOIN estado_dispositivo e ON e.dispositivo_id = d.id
        JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id
       WHERE d.id = $1`, [id]);
    if (!d.rows[0]) throw new NotFoundException('dispositivo no encontrado');

    const canales = await this.pool.query(`
      SELECT c.id, c.magnitud_codigo AS magnitud, m.nombre AS magnitud_nombre, m.unidad_canonica AS unidad, c.etiqueta,
             (SELECT json_agg(json_build_object('id', r.id, 'umbral_alto', r.umbral_alto, 'umbral_bajo', r.umbral_bajo, 'histeresis', r.histeresis))
                FROM regla_umbral r WHERE r.canal_id = c.id) AS reglas,
             (SELECT json_build_object('valor', x.valor, 'tiempo', iso_utc(x.tiempo)) FROM medicion x
               WHERE x.canal_id = c.id ORDER BY x.tiempo DESC LIMIT 1) AS ultima_medicion
        FROM canal c JOIN magnitud m ON m.codigo = c.magnitud_codigo
       WHERE c.dispositivo_id = $1 ORDER BY c.magnitud_codigo`, [id]);

    const condiciones = await this.pool.query(`
      SELECT id, tipo, regla_id, abierta_en, cerrada_en FROM condicion
       WHERE dispositivo_id = $1 AND cerrada_en IS NULL ORDER BY abierta_en DESC`, [id]);

    return { ...d.rows[0], canales: canales.rows, condiciones_abiertas: condiciones.rows };
  }

  // Histórico agregado por la base de datos con time_bucket EN LA ZONA DEL SITIO (docs/13, regla 4).
  // Devuelve el formato columnar que uPlot consume directo: tiempos en segundos Unix y valores.
  // Rango semiabierto [desde, hasta) — regla 8.
  async historico(canalId: string, desde: Date, hasta: Date, intervalo: Intervalo) {
    const c = await this.pool.query<{ zona_horaria: string; magnitud: string; unidad: string }>(`
      SELECT s.zona_horaria, c.magnitud_codigo AS magnitud, m.unidad_canonica AS unidad
        FROM canal c JOIN magnitud m ON m.codigo = c.magnitud_codigo
        JOIN dispositivo d ON d.id = c.dispositivo_id JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id
       WHERE c.id = $1`, [canalId]);
    if (!c.rows[0]) throw new NotFoundException('canal no encontrado');
    const { zona_horaria, magnitud, unidad } = c.rows[0];

    // El intervalo viene de una lista cerrada (validacion.ts), por eso puede ir como parámetro ::interval.
    const r = await this.pool.query<{ t: string; v: number; n: number }>(`
      SELECT extract(epoch FROM time_bucket($4::interval, tiempo, $5))::bigint AS t,
             round(avg(valor)::numeric, 3)::float AS v,
             count(*)::int AS n
        FROM medicion
       WHERE canal_id = $1 AND tiempo >= $2 AND tiempo < $3
       GROUP BY 1 ORDER BY 1`, [canalId, desde, hasta, intervalo, zona_horaria]);

    return {
      canal_id: canalId, magnitud, unidad, zona_horaria, intervalo,
      desde, hasta, puntos: r.rows.length,
      tiempos: r.rows.map((x) => Number(x.t)),
      valores: r.rows.map((x) => x.v),
      muestras: r.rows.map((x) => x.n),
    };
  }

  // `dispositivoId` (opcional, ya validado como UUID por el controlador): solo las de ese dispositivo (ficha del panel, docs/19 P3).
  async condiciones(abiertas: boolean | undefined, lim: number, dispositivoId?: string) {
    const condiciones: string[] = [];
    const parametros: unknown[] = [lim];
    if (abiertas !== undefined) condiciones.push(abiertas ? 'c.cerrada_en IS NULL' : 'c.cerrada_en IS NOT NULL');
    if (dispositivoId !== undefined) {
      parametros.push(dispositivoId);
      condiciones.push(`c.dispositivo_id = $${parametros.length}`);
    }
    const filtro = condiciones.length === 0 ? '' : `WHERE ${condiciones.join(' AND ')}`;
    const r = await this.pool.query(`
      SELECT c.id, c.tipo, c.abierta_en, c.cerrada_en,
             extract(epoch FROM coalesce(c.cerrada_en, now()) - c.abierta_en)::int AS duracion_s,
             d.id AS dispositivo_id, d.id_fisico, d.nombre AS dispositivo,
             r.umbral_alto, r.umbral_bajo, ca.magnitud_codigo AS magnitud
        FROM condicion c
        JOIN dispositivo d ON d.id = c.dispositivo_id
        LEFT JOIN regla_umbral r ON r.id = c.regla_id
        LEFT JOIN canal ca ON ca.id = r.canal_id
        ${filtro}
       ORDER BY c.abierta_en DESC LIMIT $1`, parametros);
    return r.rows;
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
    const cliente = await this.pool.connect();
    try {
      await cliente.query('SET statement_timeout TO 30000');
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
      await cliente.query('RESET statement_timeout').catch(() => undefined);
      cliente.release();
    }
  }

  // La carga cruda se devuelve acotada: es para diagnosticar, no para reprocesar. payload_legible (migración 09)
  // da texto si es UTF-8 y hexadecimal si no: antes, una sola trama binaria hacía fallar la consulta entera.
  // El detalle dice el porqué concreto («temperatura: 500 Cel fuera del rango físico [-40, 85]»).
  // `dispositivoId` (opcional, UUID validado): solo lo rechazado de ese dispositivo (las de `no_registrado` no tienen dueño).
  async cuarentena(lim: number, dispositivoId?: string) {
    const filtro = dispositivoId === undefined ? '' : 'WHERE q.dispositivo_id = $2';
    const parametros = dispositivoId === undefined ? [lim] : [lim, dispositivoId];
    const r = await this.pool.query(`
      SELECT q.id, q.origen, q.topico, q.motivo, q.detalle, d.id_fisico AS dispositivo, q.recibido_en,
             p.texto AS payload, p.formato AS payload_formato
        FROM cuarentena q
        LEFT JOIN dispositivo d ON d.id = q.dispositivo_id
        CROSS JOIN LATERAL payload_legible(q.payload_crudo, 200) p
        ${filtro}
       ORDER BY q.recibido_en DESC LIMIT $1`, parametros);
    return r.rows;
  }
}
