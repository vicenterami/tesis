import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { POOL } from '../db/db.module.js';
import { isoUs } from '../db/iso-us.js';
import { ClaseActividad, textoActividad } from './actividad.js';
import type { PersonaAutor } from '../db/persona.js';
import type { Cursor } from './tablero.js';

export interface FilaActividad {
  id: string;
  instante: string; // ISO con microsegundos: también es la mitad del cursor
  clase: ClaseActividad;
  tipo: string;
  texto: string;
  usuario: PersonaAutor | null;
  dispositivo: { id: string; nombre: string } | null;
}

// GET /sitios/{id}/actividad (docs/19 §4, G). Una consulta: los eventos de los dispositivos del sitio y los accesos de quienes tienen
// membresía ACTIVA en él (decidido al implementar, 11/11/2026: quien ya no está en el sitio no le muestra sus entradas al administrador
// del sitio), en [desde, hasta), por (instante, id) descendente. Los eventos sin persona (los del sistema: condiciones, supervisión) entran
// si no hay filtro de persona: son parte de lo que pasó en el sitio. El cursor es el de la última fila (keyset, docs/10 §8.4 punto 58).
// Los eventos SIN dispositivo también (corrección del 11/11/2026: antes se perdían): las pasarelas del sitio (`pasarela_*`, por
// `detalle.pasarela_id`), las cuentas de personas que están o estuvieron en él (`usuario_*`, por `detalle.usuario_id`: las mismas que ve en
// su lista de usuarios, así se ve también la baja o el sitio quitado) y los términos que aceptaron quienes tienen membresía activa
// (`terminos_aceptados`, por quien lo hizo). El nombre de esa pasarela o de esa persona va en `objeto`, solo para el texto. Desde el
// 17/11/2026, los enlaces públicos del sitio (`enlace_*`, por `detalle.enlace_id` y el sitio de la fila del enlace, no el del detalle), con
// su título como `objeto` (docs/19 §4, O, punto 4); y el tope y el k de la vista pública del sitio (`enlace_tope`, `enlace_minimo`, por `detalle.sitio_id`); desde el 18/11/2026, el plazo de
// la primera trama del sitio (`espera_primera_trama`, por `detalle.sitio_id`).
@Injectable()
export class ActividadService {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  async actividad(sitioId: string, f: { desde: Date; hasta: Date; tipo?: string; usuario?: string; limite: number; cursor?: Cursor }): Promise<FilaActividad[]> {
    const r = await this.pool.query<{
      id: string; instante: string; clase: ClaseActividad; tipo: string; detalle: unknown; usuario_id: string | null; usuario_nombre: string | null; usuario_correo: string | null;
      dispositivo_id: string | null; dispositivo_nombre: string | null; objeto: string | null;
    }>(`
      SELECT x.id, ${isoUs('x.instante')} AS instante, x.clase, x.tipo, x.detalle, x.usuario_id, u.nombre AS usuario_nombre,
             CASE WHEN u.anonimizado_en IS NULL THEN u.email END AS usuario_correo, x.dispositivo_id, x.dispositivo_nombre,
             x.objeto
        FROM (
          SELECT e.id, e.ocurrido_en AS instante, 'evento' AS clase, e.tipo, e.detalle, e.usuario_id, d.id AS dispositivo_id, d.nombre AS dispositivo_nombre,
                 NULL::text AS objeto
            FROM evento e JOIN dispositivo d ON d.id = e.dispositivo_id JOIN zona z ON z.id = d.zona_id
           WHERE z.sitio_id = $1 AND e.ocurrido_en >= $2 AND e.ocurrido_en < $3
             AND ($4::text IS NULL OR e.tipo = $4) AND ($5::uuid IS NULL OR e.usuario_id = $5)
             AND ($6::timestamptz IS NULL OR (e.ocurrido_en, e.id) < ($6::timestamptz, $7::uuid))
          UNION ALL
          SELECT e.id, e.ocurrido_en, 'evento', e.tipo, e.detalle, e.usuario_id, NULL, NULL, coalesce(pa.nombre, pe.nombre, ep.titulo)
            FROM evento e
            LEFT JOIN pasarela pa ON starts_with(e.tipo, 'pasarela_') AND pa.id::text = e.detalle->>'pasarela_id'
            LEFT JOIN usuario pe ON starts_with(e.tipo, 'usuario_') AND pe.id::text = e.detalle->>'usuario_id'
            LEFT JOIN enlace_publico ep ON starts_with(e.tipo, 'enlace_') AND ep.id::text = e.detalle->>'enlace_id'
           WHERE e.dispositivo_id IS NULL AND e.ocurrido_en >= $2 AND e.ocurrido_en < $3
             AND ($4::text IS NULL OR e.tipo = $4) AND ($5::uuid IS NULL OR e.usuario_id = $5)
             AND ($6::timestamptz IS NULL OR (e.ocurrido_en, e.id) < ($6::timestamptz, $7::uuid))
             AND ((starts_with(e.tipo, 'pasarela_') AND pa.sitio_id = $1)
               OR (starts_with(e.tipo, 'usuario_') AND pe.id IN (SELECT us.usuario_id FROM usuario_sitio us WHERE us.sitio_id = $1))
               OR (e.tipo = 'terminos_aceptados' AND e.usuario_id IN (SELECT us.usuario_id FROM usuario_sitio us WHERE us.sitio_id = $1 AND us.activo))
               OR (starts_with(e.tipo, 'enlace_') AND ep.sitio_id = $1)
               OR (e.tipo IN ('enlace_tope', 'enlace_minimo', 'espera_primera_trama') AND e.detalle->>'sitio_id' = $1::text))
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
      usuario: x.usuario_id === null ? null : { id: x.usuario_id, nombre: x.usuario_nombre ?? '', correo: x.usuario_correo },
      dispositivo: x.dispositivo_id === null ? null : { id: x.dispositivo_id, nombre: x.dispositivo_nombre ?? '' },
    }));
  }
}
