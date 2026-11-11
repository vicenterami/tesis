import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { POOL } from '../db/db.module.js';
import { isoUs } from '../db/iso-us.js';
import { ClaseActividad, textoActividad } from './actividad.js';
import type { Cursor } from './tablero.js';

export interface FilaActividad {
  id: string;
  instante: string; // ISO con microsegundos: también es la mitad del cursor
  clase: ClaseActividad;
  tipo: string;
  texto: string;
  usuario: { id: string; nombre: string } | null;
  dispositivo: { id: string; nombre: string } | null;
}

// GET /sitios/{id}/actividad (docs/19 §4, G). Una consulta: los eventos de los dispositivos del sitio y los accesos de quienes tienen
// membresía ACTIVA en él (decidido al implementar, 11/11/2026: quien ya no está en el sitio no le muestra sus entradas al administrador
// del sitio), en [desde, hasta), por (instante, id) descendente. Los eventos sin persona (los del sistema: condiciones, supervisión) entran
// si no hay filtro de persona: son parte de lo que pasó en el sitio. El cursor es el de la última fila (keyset, docs/10 §8.4 punto 58).
// Los eventos SIN dispositivo también (corrección del 11/11/2026: antes se perdían): las pasarelas del sitio (`pasarela_*`, por
// `detalle.pasarela_id`), las cuentas de personas que están o estuvieron en él (`usuario_*`, por `detalle.usuario_id`: las mismas que ve en
// su lista de usuarios, así se ve también la baja o el sitio quitado) y los términos que aceptaron quienes tienen membresía activa
// (`terminos_aceptados`, por quien lo hizo). El nombre de esa pasarela o de esa persona va en `objeto`, solo para el texto.
@Injectable()
export class ActividadService {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  async actividad(sitioId: string, f: { desde: Date; hasta: Date; tipo?: string; usuario?: string; limite: number; cursor?: Cursor }): Promise<FilaActividad[]> {
    const r = await this.pool.query<{
      id: string; instante: string; clase: ClaseActividad; tipo: string; detalle: unknown; usuario_id: string | null; usuario_nombre: string | null;
      dispositivo_id: string | null; dispositivo_nombre: string | null; objeto: string | null;
    }>(`
      SELECT x.id, ${isoUs('x.instante')} AS instante, x.clase, x.tipo, x.detalle, x.usuario_id, u.nombre AS usuario_nombre, x.dispositivo_id, x.dispositivo_nombre,
             x.objeto
        FROM (
          SELECT e.id, e.ocurrido_en AS instante, 'evento' AS clase, e.tipo, e.detalle, e.usuario_id, d.id AS dispositivo_id, d.nombre AS dispositivo_nombre,
                 NULL::text AS objeto
            FROM evento e JOIN dispositivo d ON d.id = e.dispositivo_id JOIN zona z ON z.id = d.zona_id
           WHERE z.sitio_id = $1 AND e.ocurrido_en >= $2 AND e.ocurrido_en < $3
             AND ($4::text IS NULL OR e.tipo = $4) AND ($5::uuid IS NULL OR e.usuario_id = $5)
             AND ($6::timestamptz IS NULL OR (e.ocurrido_en, e.id) < ($6::timestamptz, $7::uuid))
          UNION ALL
          SELECT e.id, e.ocurrido_en, 'evento', e.tipo, e.detalle, e.usuario_id, NULL, NULL, coalesce(pa.nombre, pe.nombre)
            FROM evento e
            LEFT JOIN pasarela pa ON starts_with(e.tipo, 'pasarela_') AND pa.id::text = e.detalle->>'pasarela_id'
            LEFT JOIN usuario pe ON starts_with(e.tipo, 'usuario_') AND pe.id::text = e.detalle->>'usuario_id'
           WHERE e.dispositivo_id IS NULL AND e.ocurrido_en >= $2 AND e.ocurrido_en < $3
             AND ($4::text IS NULL OR e.tipo = $4) AND ($5::uuid IS NULL OR e.usuario_id = $5)
             AND ($6::timestamptz IS NULL OR (e.ocurrido_en, e.id) < ($6::timestamptz, $7::uuid))
             AND ((starts_with(e.tipo, 'pasarela_') AND pa.sitio_id = $1)
               OR (starts_with(e.tipo, 'usuario_') AND pe.id IN (SELECT us.usuario_id FROM usuario_sitio us WHERE us.sitio_id = $1))
               OR (e.tipo = 'terminos_aceptados' AND e.usuario_id IN (SELECT us.usuario_id FROM usuario_sitio us WHERE us.sitio_id = $1 AND us.activo)))
          UNION ALL
          SELECT a.id, a.instante, 'acceso', a.resultado, NULL, a.usuario_id, NULL, NULL, NULL
            FROM acceso a
           WHERE a.usuario_id IN (SELECT us.usuario_id FROM usuario_sitio us WHERE us.sitio_id = $1 AND us.activo)
             AND a.instante >= $2 AND a.instante < $3
             AND ($4::text IS NULL OR a.resultado = $4) AND ($5::uuid IS NULL OR a.usuario_id = $5)
             AND ($6::timestamptz IS NULL OR (a.instante, a.id) < ($6::timestamptz, $7::uuid))
        ) x LEFT JOIN usuario u ON u.id = x.usuario_id
       ORDER BY x.instante DESC, x.id DESC LIMIT $8`,
      [sitioId, f.desde, f.hasta, f.tipo ?? null, f.usuario ?? null, f.cursor?.t ?? null, f.cursor?.id ?? null, f.limite]);
    return r.rows.map((x) => ({
      id: x.id, instante: x.instante, clase: x.clase, tipo: x.tipo, texto: textoActividad(x.clase, x.tipo, x.dispositivo_nombre, x.detalle, x.objeto),
      usuario: x.usuario_id === null ? null : { id: x.usuario_id, nombre: x.usuario_nombre ?? '' },
      dispositivo: x.dispositivo_id === null ? null : { id: x.dispositivo_id, nombre: x.dispositivo_nombre ?? '' },
    }));
  }
}
