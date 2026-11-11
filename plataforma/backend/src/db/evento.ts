// La única forma de insertar en `evento` desde una escritura con persona (docs/10 §8.4 punto 65 v; docs/19 §4, G1; HU-11): el alta, la
// baja, la rotación de credenciales, la calibración, la configuración del dispositivo y sus reglas, el alta por lote (registrarEventos) y,
// desde el 11/11/2026, los de las personas (usuario_alta, usuario_cambio, usuario_clave, usuario_baja, terminos_aceptados). Lleva el
// `usuario_id` de la sesión (nulo = el sistema: la clave de administrador por cabecera no es una fila de `usuario`). El detalle va
// como JSON, una foto por valor (docs/08 §6). Recibe el cliente de la transacción: el evento se confirma o se deshace con el cambio.
import type { PoolClient } from 'pg';

export type Consultable = Pick<PoolClient, 'query'>;

export interface NuevoEvento {
  dispositivoId: string | null;
  tipo: string;
  detalle: object;
  usuarioId: string | null;
}

export async function registrarEvento(c: Consultable, e: NuevoEvento): Promise<Date> {
  const r = await c.query<{ ocurrido_en: Date }>(
    'INSERT INTO evento (dispositivo_id, tipo, detalle, usuario_id) VALUES ($1, $2, $3, $4) RETURNING ocurrido_en',
    [e.dispositivoId, e.tipo, JSON.stringify(e.detalle), e.usuarioId],
  );
  return r.rows[0]?.ocurrido_en ?? new Date();
}

// Varios eventos en UNA sentencia (el alta por lote: hasta 500), con la misma forma y el mismo usuario por fila.
export async function registrarEventos(c: Consultable, eventos: readonly NuevoEvento[]): Promise<number> {
  if (eventos.length === 0) return 0;
  const r = await c.query(
    'INSERT INTO evento (dispositivo_id, tipo, detalle, usuario_id) SELECT * FROM unnest($1::uuid[], $2::text[], $3::jsonb[], $4::uuid[])',
    [eventos.map((e) => e.dispositivoId), eventos.map((e) => e.tipo), eventos.map((e) => JSON.stringify(e.detalle)), eventos.map((e) => e.usuarioId)],
  );
  return r.rowCount ?? 0;
}
