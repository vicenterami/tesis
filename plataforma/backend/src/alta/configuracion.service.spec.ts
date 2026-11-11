import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { Pool } from 'pg';
import { ConfiguracionService } from './configuracion.service.js';

// PUT /canales/{id}/reglas empareja por id (decidido el 11/11/2026): antes se reasignaba por posición (ORDER BY id) y una condición
// abierta quedaba apuntando a una regla con otros umbrales. Base falsa: se mira qué sentencia toca qué regla.
const R1 = '11111111-1111-4111-8111-111111111111';
const R2 = '22222222-2222-4222-8222-222222222222';
const MARCA = '2026-11-11T12:00:00.123456Z';
function armar() {
  const llamadas: [string, unknown[]][] = [];
  const cliente = {
    query: vi.fn((sql: string, p: unknown[] = []) => {
      llamadas.push([sql.replace(/\s+/g, ' ').trim(), p]);
      if (sql.includes('FROM canal c JOIN magnitud')) return Promise.resolve({ rows: [{ id: 'k1', dispositivo_id: 'd1', magnitud: 'temperatura', unidad: 'Cel', etiqueta: null, rango_min: -40, rango_max: 85, actualizado_en: MARCA }] });
      if (sql.startsWith('UPDATE canal')) return Promise.resolve({ rows: [{ actualizado_en: MARCA }] });
      if (sql.startsWith('SELECT id, umbral_alto')) return Promise.resolve({ rows: [{ id: R1, umbral_alto: 30, umbral_bajo: null, histeresis: 0, retardo_s: 0 }, { id: R2, umbral_alto: null, umbral_bajo: 5, histeresis: 0, retardo_s: 0 }] });
      if (sql.startsWith('INSERT INTO regla_umbral')) return Promise.resolve({ rows: [{ id: 'nueva' }] });
      if (sql.startsWith('UPDATE condicion')) return Promise.resolve({ rows: [{ id: 'c1' }], rowCount: 1 });
      return Promise.resolve({ rows: [{ ocurrido_en: new Date() }], rowCount: 1 });
    }),
    release: vi.fn(), on: vi.fn(), off: vi.fn(),
  };
  return { servicio: new ConfiguracionService({ connect: () => Promise.resolve(cliente) } as unknown as Pool), llamadas };
}

describe('ConfiguracionService.reemplazarReglas: por id, no por posición', () => {
  it('con id cambia ESA regla; sin id, una nueva; la que no viene se cierra y se quita', async () => {
    const { servicio, llamadas } = armar();
    const r = await servicio.reemplazarReglas('k1', { actualizado_en: MARCA, reglas: [{ id: R2, umbral_bajo: 8 }, { umbral_alto: 40 }] }, 'u1');
    const updates = llamadas.filter(([s]) => s.startsWith('UPDATE regla_umbral')).map(([, p]) => p[0]);
    expect(updates).toEqual([R2]); // por posición habría sido R1 (la primera ORDER BY id)
    expect(llamadas.filter(([s]) => s.startsWith('INSERT INTO regla_umbral'))).toHaveLength(1);
    expect(llamadas.find(([s]) => s.startsWith('UPDATE condicion'))?.[1][0]).toEqual([R1]);
    expect(llamadas.find(([s]) => s.includes('fn_quitar_reglas'))?.[1][1]).toEqual([R2, 'nueva']);
    expect(r.reglas.map((x) => x.id)).toEqual([R2, 'nueva']);
  });
  it('un id que no es de este canal → 400 y nada se cambia', async () => {
    const { servicio, llamadas } = armar();
    await expect(servicio.reemplazarReglas('k1', { actualizado_en: MARCA, reglas: [{ id: '33333333-3333-4333-8333-333333333333', umbral_alto: 30 }] }, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(llamadas.some(([s]) => s.startsWith('UPDATE regla_umbral') || s.startsWith('INSERT INTO regla_umbral'))).toBe(false);
    expect(llamadas.at(-1)?.[0]).toBe('ROLLBACK');
  });
});
