import { Inject, Injectable, NotFoundException } from '@nestjs/common';
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
      SELECT d.id, d.id_fisico, d.nombre, d.estado, d.intervalo_esperado_s,
             d.visto_por_ultima_vez,
             (d.visto_por_ultima_vez >= now() - d.intervalo_esperado_s * 2 * INTERVAL '1 second') AS en_linea,
             z.nombre AS zona, s.nombre AS sitio, s.zona_horaria,
             (SELECT count(*)::int FROM condicion c WHERE c.dispositivo_id = d.id AND c.cerrada_en IS NULL) AS condiciones_abiertas,
             (SELECT coalesce(json_agg(json_build_object('id', c.id, 'magnitud', c.magnitud_codigo, 'unidad', m.unidad_canonica) ORDER BY c.magnitud_codigo), '[]'::json)
                FROM canal c JOIN magnitud m ON m.codigo = c.magnitud_codigo WHERE c.dispositivo_id = d.id) AS canales
        FROM dispositivo d
        JOIN zona z ON z.id = d.zona_id
        JOIN sitio s ON s.id = z.sitio_id
       ORDER BY s.nombre, z.nombre, d.nombre`);
    return r.rows;
  }

  async dispositivo(id: string) {
    const d = await this.pool.query(`
      SELECT d.id, d.id_fisico, d.nombre, d.estado, d.intervalo_esperado_s, d.visto_por_ultima_vez, d.creado_en,
             (d.visto_por_ultima_vez >= now() - d.intervalo_esperado_s * 2 * INTERVAL '1 second') AS en_linea,
             z.nombre AS zona, s.nombre AS sitio, s.zona_horaria
        FROM dispositivo d JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id
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

  async condiciones(abiertas: boolean | undefined, lim: number) {
    const filtro = abiertas === undefined ? '' : abiertas ? 'WHERE c.cerrada_en IS NULL' : 'WHERE c.cerrada_en IS NOT NULL';
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
       ORDER BY c.abierta_en DESC LIMIT $1`, [lim]);
    return r.rows;
  }

  // La carga cruda se devuelve como texto acotado: es para diagnosticar, no para reprocesar.
  async cuarentena(lim: number) {
    const r = await this.pool.query(`
      SELECT id, origen, topico, motivo, recibido_en,
             left(convert_from(payload_crudo, 'UTF8'), 200) AS payload
        FROM cuarentena ORDER BY recibido_en DESC LIMIT $1`, [lim]);
    return r.rows;
  }
}
