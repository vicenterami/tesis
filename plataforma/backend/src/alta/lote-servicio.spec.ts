import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import type { Pool } from 'pg';
import { AltaService } from './alta.service.js';
import type { DynsecService } from '../broker/dynsec.service.js';
import * as credenciales from './credenciales.js';
import type { AltaDeLote } from './lote.js';

// crearLote (docs/19 §4, F2): los eventos pasan por el ayudante único (registrarEventos, una sentencia) y el 23505 de una carrera entre la
// validación y la creación responde un mensaje propio, no «id_fisico «lote de N» ya existe».
const Z = '00000000-0000-4000-8000-0000000000a1';
const altas = (n: number): AltaDeLote[] => Array.from({ length: n }, (_, i) => ({
  n: i + 2, formato: 'senml', sitio_codigo: 'uct',
  alta: { id_fisico: `nodo-${i}`, nombre: 'n', zona_id: Z, via: 'http', formato: 'senml', pasarela_id: null, decodificador: null, intervalo_esperado_s: 60, canales: [{ magnitud: 'temperatura', etiqueta: null, escala_cero: null, escala_cien: null }] },
}));
function armar(falla?: string) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const cliente = {
    query: vi.fn((texto: string, p: unknown[] = []) => {
      sql.push(texto.replace(/\s+/g, ' ').trim());
      params.push(p);
      if (texto.trim().startsWith('WITH d AS')) {
        if (falla) return Promise.reject(Object.assign(new Error('duplicate key'), { code: falla }));
        return Promise.resolve({ rows: (p[1] as string[]).map((f, i) => ({ id: `D${i}`, id_fisico: f, via: 'http', formato: 'senml' })) });
      }
      return Promise.resolve({ rows: [], rowCount: 2 });
    }),
    release: vi.fn(), on: vi.fn(), off: vi.fn(),
  };
  const servicio = new AltaService({ connect: () => Promise.resolve(cliente) } as unknown as Pool, { disponible: false } as unknown as DynsecService);
  return { servicio, sql, params };
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
  it('23505 → 409 «un identificador del lote ya existe: vuelve a validar», sin el «lote de 2» que nombraba el mensaje genérico', async () => {
    const { servicio, sql } = armar('23505');
    const e = await servicio.crearLote(altas(2), 'u1').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect((e as ConflictException).message).toBe('un identificador del lote ya existe: vuelve a validar');
    expect((e as ConflictException).message).not.toContain('lote de 2');
    expect(sql).toContain('ROLLBACK');
  }, 20_000);
});
