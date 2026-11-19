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
  return { servicio: new ConfiguracionService({ connect: () => Promise.resolve(cliente) } as unknown as Pool, { publicar() {} } as never), llamadas };
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

// Volver a servicio (docs/19 §2; docs/10 §8.4 punto 68): PATCH /dispositivos/{id} de `mantenimiento` a `activo` pone en_servicio_desde en
// now() en el mismo UPDATE (el séptimo parámetro); cualquier otro cambio no lo toca. Contra una base real, en integracion/espera.ts.
describe('ConfiguracionService.cambiarDispositivo: en_servicio_desde al volver a activo', () => {
  function armar(estadoAntes: string) {
    const llamadas: [string, unknown[]][] = [];
    const cliente = {
      query: vi.fn((sql: string, p: unknown[] = []) => {
        llamadas.push([sql.replace(/\s+/g, ' ').trim(), p]);
        if (sql.includes('FOR NO KEY UPDATE OF d')) {
          return Promise.resolve({ rows: [{ id: 'd1', nombre: 'Nodo', estado: estadoAntes, intervalo_esperado_s: 300, zona_id: 'z1', sitio_id: 's1', actualizado_en: MARCA, al_dia: true }] });
        }
        if (sql.startsWith('UPDATE condicion')) return Promise.resolve({ rows: [{ id: 'k1', tipo: 'sin_comunicacion' }, { id: 'k2', tipo: 'umbral' }], rowCount: 2 });
        return Promise.resolve({ rows: [{ ocurrido_en: new Date() }], rowCount: 1 });
      }),
      release: vi.fn(), on: vi.fn(), off: vi.fn(),
    };
    const update = () => llamadas.find(([s]) => s.startsWith('UPDATE dispositivo'));
    return { servicio: new ConfiguracionService({ connect: () => Promise.resolve(cliente) } as unknown as Pool, { publicar() {} } as never), update, llamadas };
  }
  it('de mantenimiento a activo → en_servicio_desde = now() en el mismo UPDATE', async () => {
    const { servicio, update } = armar('mantenimiento');
    await servicio.cambiarDispositivo('d1', { actualizado_en: MARCA, estado: 'activo' }, 'u1');
    expect(update()?.[0]).toContain('en_servicio_desde = CASE WHEN $7::boolean THEN now() ELSE en_servicio_desde END');
    expect(update()?.[1][6]).toBe(true);
  });
  it('de activo a mantenimiento, o un cambio de nombre estando activo → no lo toca', async () => {
    const a = armar('activo');
    await a.servicio.cambiarDispositivo('d1', { actualizado_en: MARCA, estado: 'mantenimiento' }, 'u1');
    expect(a.update()?.[1][6]).toBe(false);
    const b = armar('activo');
    await b.servicio.cambiarDispositivo('d1', { actualizado_en: MARCA, nombre: 'Otro' }, 'u1');
    expect(b.update()?.[1][6]).toBe(false);
  });
});

// Pasar a mantenimiento cierra las condiciones abiertas (RF-22; docs/19 §2; docs/10 §8.4 punto 68), todas como la baja, con un evento por
// cada una (`por: 'mantenimiento'`), en la MISMA transacción que el cambio de estado. Contra una base real, en integracion/espera.ts.
describe('ConfiguracionService.cambiarDispositivo: a mantenimiento cierra las condiciones abiertas', () => {
  function armarMant(estadoAntes: string, falla = false) {
    const llamadas: [string, unknown[]][] = [];
    const cliente = {
      query: vi.fn((sql: string, p: unknown[] = []) => {
        llamadas.push([sql.replace(/\s+/g, ' ').trim(), p]);
        if (sql.includes('FOR NO KEY UPDATE OF d')) {
          return Promise.resolve({ rows: [{ id: 'd1', nombre: 'Nodo', estado: estadoAntes, intervalo_esperado_s: 300, zona_id: 'z1', sitio_id: 's1', actualizado_en: MARCA, al_dia: true }] });
        }
        if (sql.startsWith('UPDATE condicion')) return Promise.resolve({ rows: [{ id: 'k1', tipo: 'sin_comunicacion' }, { id: 'k2', tipo: 'umbral' }], rowCount: 2 });
        return Promise.resolve({ rows: [{ ocurrido_en: new Date() }], rowCount: 1 });
      }),
      release: vi.fn(), on: vi.fn(), off: vi.fn(),
    };
    const avisos: unknown[] = [];
    const eventos = { publicar: (e: unknown) => { avisos.push([e, llamadas.some(([q]) => q === 'COMMIT')]); } };
    if (falla) cliente.query = vi.fn((sql: string, p: unknown[] = []): Promise<unknown> => {
      llamadas.push([sql.replace(/\s+/g, ' ').trim(), p]);
      if (sql.includes('FOR NO KEY UPDATE OF d')) return Promise.resolve({ rows: [{ id: 'd1', nombre: 'Nodo', estado: estadoAntes, intervalo_esperado_s: 300, zona_id: 'z1', sitio_id: 's1', actualizado_en: MARCA, al_dia: true }] });
      if (sql.startsWith('UPDATE condicion')) return Promise.resolve({ rows: [{ id: 'k1', tipo: 'sin_comunicacion' }], rowCount: 1 });
      if (sql.startsWith('INSERT INTO evento')) return Promise.reject(new Error('base caída'));
      return Promise.resolve({ rows: [{ ocurrido_en: new Date() }], rowCount: 1 });
    }) as never;
    return { servicio: new ConfiguracionService({ connect: () => Promise.resolve(cliente) } as unknown as Pool, eventos as never), llamadas, avisos };
  }
  it('el aviso en vivo de cada cierre sale DESPUÉS del COMMIT; si la transacción se deshace, no sale', async () => {
    const { servicio, avisos } = armarMant('activo');
    await servicio.cambiarDispositivo('d1', { actualizado_en: MARCA, estado: 'mantenimiento' }, 'u1');
    expect(avisos).toEqual([
      [{ tipo: 'condicion', dispositivo_id: 'd1', condicion: 'sin_comunicacion', estado: 'cerrada' }, true],
      [{ tipo: 'condicion', dispositivo_id: 'd1', condicion: 'umbral', estado: 'cerrada' }, true]]);
    const mala = armarMant('activo', true);
    await expect(mala.servicio.cambiarDispositivo('d1', { actualizado_en: MARCA, estado: 'mantenimiento' }, 'u1')).rejects.toThrow('base caída');
    expect(mala.avisos).toEqual([]);
  });
  it('de activo a mantenimiento: cierra TODAS las abiertas del equipo y deja un evento por cada una, antes de COMMIT', async () => {
    const { servicio, llamadas } = armarMant('activo');
    await servicio.cambiarDispositivo('d1', { actualizado_en: MARCA, estado: 'mantenimiento' }, 'u1');
    const cierre = llamadas.find(([s]) => s.startsWith('UPDATE condicion'));
    expect(cierre?.[0]).toBe('UPDATE condicion SET cerrada_en = now() WHERE dispositivo_id = $1 AND cerrada_en IS NULL RETURNING id, tipo');
    expect(cierre?.[1]).toEqual(['d1']);
    const ev = llamadas.find(([s]) => s.startsWith('INSERT INTO evento') && s.includes('unnest'));
    expect(ev?.[1][1]).toEqual(['condicion_cerrada', 'condicion_cerrada']);
    expect(ev?.[1][2]).toEqual([
      JSON.stringify({ tipo: 'sin_comunicacion', condicion_id: 'k1', por: 'mantenimiento' }), JSON.stringify({ tipo: 'umbral', condicion_id: 'k2', por: 'mantenimiento' })]);
    expect(llamadas.findIndex(([s]) => s.startsWith('UPDATE condicion'))).toBeLessThan(llamadas.findIndex(([s]) => s === 'COMMIT'));
  });
  it('un cambio de nombre estando activo, o de mantenimiento a activo, no toca condiciones', async () => {
    const a = armarMant('activo');
    await a.servicio.cambiarDispositivo('d1', { actualizado_en: MARCA, nombre: 'Otro' }, 'u1');
    expect(a.llamadas.some(([s]) => s.startsWith('UPDATE condicion'))).toBe(false);
    const b = armarMant('mantenimiento');
    await b.servicio.cambiarDispositivo('d1', { actualizado_en: MARCA, estado: 'activo' }, 'u1');
    expect(b.llamadas.some(([s]) => s.startsWith('UPDATE condicion'))).toBe(false);
  });
});
