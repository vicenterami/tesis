import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { registrarEvento, registrarEventos } from './evento.js';

// «Quién lo hizo» (HU-11; docs/10 §8.4 punto 65 v): el helper único lleva el usuario de la sesión a evento.usuario_id; nulo = el sistema.
describe('registrarEvento', () => {
  it('inserta dispositivo, tipo, detalle (JSON) y usuario_id, y devuelve el instante', async () => {
    const cuando = new Date('2026-11-11T12:00:00Z');
    const query = vi.fn(() => Promise.resolve({ rows: [{ ocurrido_en: cuando }], rowCount: 1 }));
    const r = await registrarEvento({ query } as unknown as PoolClient, { dispositivoId: 'd1', tipo: 'alta', detalle: { via: 'mqtt' }, usuarioId: 'u1' });
    expect(r).toBe(cuando);
    const [sql, p] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql.startsWith('INSERT INTO evento (dispositivo_id, tipo, detalle, usuario_id)')).toBe(true);
    expect(p).toEqual(['d1', 'alta', '{"via":"mqtt"}', 'u1']);
  });
  it('sin persona (la clave de administrador, el sistema) → usuario_id nulo', async () => {
    const query = vi.fn(() => Promise.resolve({ rows: [{ ocurrido_en: new Date() }], rowCount: 1 }));
    await registrarEvento({ query } as unknown as PoolClient, { dispositivoId: null, tipo: 'pasarela_alta', detalle: {}, usuarioId: null });
    expect((query.mock.calls[0] as unknown as [string, unknown[]])[1][3]).toBeNull();
  });
});

// El lote pasa por el mismo ayudante (una sentencia para todas sus filas), no por un INSERT propio (docs/16 §61).
describe('registrarEventos', () => {
  it('una sentencia con unnest para N eventos, con el usuario de cada uno; lista vacía no consulta', async () => {
    const query = vi.fn(() => Promise.resolve({ rows: [], rowCount: 2 }));
    const c = { query } as unknown as PoolClient;
    expect(await registrarEventos(c, [])).toBe(0);
    expect(query).not.toHaveBeenCalled();
    expect(await registrarEventos(c, [
      { dispositivoId: 'd1', tipo: 'alta', detalle: { origen: 'lote' }, usuarioId: 'u1' },
      { dispositivoId: 'd2', tipo: 'alta', detalle: { origen: 'lote' }, usuarioId: 'u1' },
    ])).toBe(2);
    const [sql, p] = query.mock.calls[0] as unknown as [string, unknown[][]];
    expect(sql).toMatch(/^INSERT INTO evento \(dispositivo_id, tipo, detalle, usuario_id\) SELECT \* FROM unnest/);
    expect(p).toEqual([['d1', 'd2'], ['alta', 'alta'], ['{"origen":"lote"}', '{"origen":"lote"}'], ['u1', 'u1']]);
  });
});
