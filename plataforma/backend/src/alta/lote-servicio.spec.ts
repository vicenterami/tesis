import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { AltaService } from './alta.service.js';
import type { DynsecService } from '../broker/dynsec.service.js';
import * as credenciales from './credenciales.js';
import { ChoqueDeLote, type AltaDeLote } from './lote.js';

// crearLote (docs/19 §4, F2 y N8): los eventos pasan por el ayudante único (registrarEventos, una sentencia) y el choque que solo ve la base
// (el 23505 de una carrera entre la validación y la creación, o el formato de la pasarela que cambió) deshace todo y lanza ChoqueDeLote, que
// el controlador convierte en `plan_cambio` con el plan recalculado.
const Z = '00000000-0000-4000-8000-0000000000a1';
const altas = (n: number): AltaDeLote[] => Array.from({ length: n }, (_, i) => ({
  n: i + 2, formato: 'senml', sitio_codigo: 'uct', sitio_id: '00000000-0000-4000-8000-000000000001',
  alta: { id_fisico: `nodo-${i}`, nombre: 'n', zona_id: Z, via: 'http', formato: 'senml', pasarela_id: null, decodificador: null, intervalo_esperado_s: 60, canales: [{ magnitud: 'temperatura', etiqueta: null, escala_cero: null, escala_cien: null }] },
}));
interface Opciones { commitFalla?: boolean; quedo?: 'si' | 'no' | 'error'; pasarelasActivas?: number }
function armar(falla?: string, restriccion?: string, o: Opciones = {}) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const cliente = {
    query: vi.fn((texto: string, p: unknown[] = []) => {
      sql.push(texto.replace(/\s+/g, ' ').trim());
      params.push(p);
      if (texto.trim().startsWith('WITH d AS')) {
        if (falla) return Promise.reject(Object.assign(new Error('duplicate key'), { code: falla, constraint: restriccion }));
        return Promise.resolve({ rows: (p[1] as string[]).map((f, i) => ({ id: `D${i}`, id_fisico: f, via: 'http', formato: 'senml' })) });
      }
      if (texto.startsWith('SELECT id FROM pasarela')) return Promise.resolve({ rows: Array.from({ length: o.pasarelasActivas ?? (p[0] as string[]).length }, (_, i) => ({ id: `P${i}` })) });
      if (texto === 'COMMIT' && o.commitFalla) return Promise.reject(new Error('Connection terminated unexpectedly'));
      return Promise.resolve({ rows: [], rowCount: 2 });
    }),
    release: vi.fn(), on: vi.fn(), off: vi.fn(),
  };
  // La consulta de «¿quedaron?» va por el grupo, no por la conexión de la transacción.
  const pool = {
    connect: () => Promise.resolve(cliente),
    query: vi.fn(() => (o.quedo === 'error' ? Promise.reject(new Error('sin base')) : Promise.resolve({ rows: [{ n: o.quedo === 'si' ? '2' : '0' }] }))),
  };
  const ordenes: unknown[][] = [];
  const dynsec = { disponible: true, ordenar: vi.fn((x: unknown[]) => { ordenes.push(x); return Promise.resolve([]); }) };
  const servicio = new AltaService(pool as unknown as Pool, dynsec as unknown as DynsecService);
  return { servicio, sql, params, ordenes, pool };
}

describe('AltaService.crearLote', () => {
  it('los eventos van por registrarEventos (INSERT … unnest) después del alta, en la misma transacción', async () => {
    const { servicio, sql } = armar();
    const r = await servicio.crearLote(altas(2), 'u1');
    expect([...r.values()].map((x) => x.id)).toEqual(['D0', 'D1']);
    const i = sql.findIndex((s) => s.startsWith('WITH d AS'));
    expect(sql[i]).not.toContain('INSERT INTO evento');
    expect(sql[i + 1]).toMatch(/^INSERT INTO evento \(dispositivo_id, tipo, detalle, usuario_id\) SELECT \* FROM unnest/);
    expect(sql.at(-1)).toBe('COMMIT');
  }, 20_000);
  it('I1: las credenciales del lote se resumen con SHA-256 sin llamar a scrypt; la base recibe solo los resúmenes, nunca los secretos', async () => {
    const { servicio, sql, params } = armar();
    const scrypt = vi.spyOn(credenciales, 'hashScrypt');
    try {
      const r = await servicio.crearLote(altas(500), 'u1');
      expect(scrypt).not.toHaveBeenCalled();
      const huellas = params[sql.findIndex((s) => s.startsWith('WITH d AS'))][11] as string[];
      const secretos = [...r.values()].map((x) => x.credencial as string);
      expect(huellas).toHaveLength(500);
      expect(huellas.every((h) => h.startsWith('sha256$'))).toBe(true);
      expect(huellas.every((h, i) => credenciales.verificarResumen(secretos[i], h))).toBe(true);
      expect(JSON.stringify(params).includes(secretos[0])).toBe(false);
    } finally {
      scrypt.mockRestore();
    }
  });
  it('23505 → ChoqueDeLote (el controlador recalcula y responde plan_cambio), con ROLLBACK', async () => {
    const { servicio, sql } = armar('23505');
    const e = await servicio.crearLote(altas(2), 'u1').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ChoqueDeLote);
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
  }, 20_000);
  it('23503 de fk_dispositivo_pasarela_formato (el formato de la pasarela cambió) → ChoqueDeLote; otro 23503 sigue siendo 400', async () => {
    expect(await armar('23503', 'fk_dispositivo_pasarela_formato').servicio.crearLote(altas(1), 'u1').catch((x: unknown) => x)).toBeInstanceOf(ChoqueDeLote);
    const otro = await armar('23503', 'dispositivo_zona_id_fkey').servicio.crearLote(altas(1), 'u1').catch((x: unknown) => x);
    expect(otro).not.toBeInstanceOf(ChoqueDeLote);
    expect((otro as { getStatus(): number }).getStatus()).toBe(400);
  }, 20_000);
  const mqtt = (n: number): AltaDeLote[] => altas(n).map((a) => ({ ...a, alta: { ...a.alta, via: 'mqtt' } }));
  const bajas = (ordenes: unknown[][]): number => ordenes.flat().filter((x) => (x as { command?: string }).command === 'deleteClient').length;
  it('COMMIT con error pero aplicado (los dispositivos están): el lote se da por creado, con sus credenciales, y nada se borra del broker', async () => {
    const { servicio, ordenes, pool } = armar(undefined, undefined, { commitFalla: true, quedo: 'si' });
    const r = await servicio.crearLote(mqtt(2), 'u1');
    expect([...r.values()].map((x) => typeof x.credencial)).toEqual(['string', 'string']);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(bajas(ordenes)).toBe(0);
  }, 20_000);
  it('COMMIT con error y no aplicado (no están): se deshace en el broker y el error sigue; si no se puede saber, 503 y el broker no se toca', async () => {
    const no = armar(undefined, undefined, { commitFalla: true, quedo: 'no' });
    await expect(no.servicio.crearLote(mqtt(2), 'u1')).rejects.toBeTruthy();
    expect(bajas(no.ordenes)).toBe(2);
    const incierto = armar(undefined, undefined, { commitFalla: true, quedo: 'error' });
    const e = await incierto.servicio.crearLote(mqtt(2), 'u1').catch((x: unknown) => x);
    expect((e as { getStatus(): number }).getStatus()).toBe(503);
    expect((e as Error).message).toMatch(/revisa el inventario; los que aparezcan necesitan rotar su credencial/);
    expect(bajas(incierto.ordenes)).toBe(0);
  }, 20_000);
  it('una pasarela del lote que ya no está activa (bloqueadas FOR SHARE dentro de la transacción) → ChoqueDeLote, sin INSERT', async () => {
    const con = (activas: number) => armar(undefined, undefined, { pasarelasActivas: activas });
    const lora = (): AltaDeLote[] => altas(2).map((a, i) => ({ ...a, formato: 'milesight', alta: { ...a.alta, via: 'lorawan', formato: null, pasarela_id: `00000000-0000-4000-8000-0000000000c${i}` } }));
    const mala = con(1);
    expect(await mala.servicio.crearLote(lora(), 'u1').catch((x: unknown) => x)).toBeInstanceOf(ChoqueDeLote);
    expect(mala.sql.some((x) => x.startsWith('WITH d AS'))).toBe(false);
    expect(mala.sql).toContain('SELECT id FROM pasarela WHERE id = ANY($1::uuid[]) AND activo FOR SHARE');
    const buena = con(2);
    await buena.servicio.crearLote(lora(), 'u1');
    expect(buena.sql.at(-1)).toBe('COMMIT');
  }, 20_000);
});
