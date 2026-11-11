import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import type { Pool } from 'pg';
import type { DynsecService } from '../broker/dynsec.service.js';
import { AltaService } from './alta.service.js';
import { validarCalibracion } from './calibracion.dto.js';
import { CanalesAdminController } from './canales.controller.js';
import type { AlcanceService } from '../sesion/alcance.service.js';
import { UsuarioSesion, usuarioSistema } from '../sesion/permisos.js';

// Calibración por API con bloqueo optimista (docs/10 §8.4 punto 51 (ii) a (vi)): DTO, 404, 409, evento y respuesta, con una base falsa.
const C = '77777777-7777-4777-8777-777777777777';
const D = '88888888-8888-4888-8888-888888888888';
const VIEJO = '2026-10-22T18:04:31.123456Z';
const NUEVO = '2026-10-22T18:10:02.654321Z';
const motivos = (c: unknown): string[] => {
  try { validarCalibracion(c); return []; } catch (e) { return ((e as BadRequestException).getResponse() as { message: string[] }).message; }
};

describe('validarCalibracion: el cuerpo de PATCH /canales/{id}, o los motivos (400 antes de tocar la base)', () => {
  it('las dos escalas con valor calibran; las dos null quitan la calibración; actualizado_en se devuelve tal cual, con sus microsegundos', () => {
    expect(validarCalibracion({ escala_cero: 2.205, escala_cien: 1.17, actualizado_en: VIEJO })).toEqual({ escala_cero: 2.205, escala_cien: 1.17, actualizado_en: VIEJO });
    expect(validarCalibracion({ escala_cero: null, escala_cien: null, actualizado_en: VIEJO })).toEqual({ escala_cero: null, escala_cien: null, actualizado_en: VIEJO });
  });
  it('una sola escala → 400 (las dos o ninguna)', () => {
    expect(motivos({ escala_cero: 2.205, escala_cien: null, actualizado_en: VIEJO })).toEqual([expect.stringContaining('escala_cero y escala_cien van juntas')]);
    expect(motivos({ escala_cien: 1.17, actualizado_en: VIEJO })).toEqual(['escala_cero es obligatoria: un número para calibrar, o null para quitar la calibración', expect.stringContaining('van juntas')]);
  });
  it('iguales → 400', () => {
    expect(motivos({ escala_cero: 1.5, escala_cien: 1.5, actualizado_en: VIEJO })).toEqual([expect.stringContaining('deben ser distintas')]);
  });
  it('NaN, Infinity (también el 1e400 de JSON) o texto → 400', () => {
    expect(motivos({ escala_cero: Number.NaN, escala_cien: 1, actualizado_en: VIEJO })).toEqual(['escala_cero debe ser un número finito']);
    expect(motivos({ escala_cero: 0, escala_cien: Number.POSITIVE_INFINITY, actualizado_en: VIEJO })).toEqual(['escala_cien debe ser un número finito']);
    expect(motivos(JSON.parse(`{"escala_cero": -1e400, "escala_cien": 1, "actualizado_en": "${VIEJO}"}`))).toEqual(['escala_cero debe ser un número finito']);
    expect(motivos({ escala_cero: '2.2', escala_cien: 1, actualizado_en: VIEJO })).toEqual(['escala_cero debe ser un número finito']);
  });
  it('sin actualizado_en, o con otra forma, → 400; campos ajenos → 400; lo que no es un objeto → 400', () => {
    expect(motivos({ escala_cero: 2, escala_cien: 1 })).toEqual([expect.stringContaining('actualizado_en es obligatorio')]);
    expect(motivos({ escala_cero: 2, escala_cien: 1, actualizado_en: '22/10/2026' })).toEqual([expect.stringContaining('actualizado_en')]);
    expect(motivos({ escala_cero: 2, escala_cien: 1, actualizado_en: '2026-10-22T18:04:31.1234567Z' })).toEqual([expect.stringContaining('actualizado_en')]); // más que microsegundos
    for (const a of ['0000-01-01T00:00:00Z', '2026-01-01T24:00:00Z']) expect(motivos({ escala_cero: 2, escala_cien: 1, actualizado_en: a })).toEqual([expect.stringContaining('actualizado_en')]); // JavaScript los acepta; la base no
    expect(motivos({ escala_cero: 2, escala_cien: 1, actualizado_en: VIEJO, magnitud: 'humedad' })).toEqual(['campo no admitido: magnitud']);
    expect(motivos([1, 2])).toEqual(['el cuerpo debe ser un objeto JSON']);
  });
});

// Base falsa: la fila bloqueada (o ninguna) y el UPDATE que afecta 1 fila si el actualizado_en enviado es el vigente, 0 si no.
function armar(opciones: { existe?: boolean; vigente?: string; antes?: { cero: number | null; cien: number | null }; insertFalla?: { code: string; constraint?: string } } = {}) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const vigente = opciones.vigente ?? VIEJO;
  const cliente = {
    query: async (texto: string, p: unknown[] = []) => {
      await Promise.resolve();
      sql.push(texto);
      params.push(p);
      if (texto.startsWith('SELECT c.id, c.dispositivo_id')) {
        return { rows: opciones.existe === false ? [] : [{ id: C, dispositivo_id: D, magnitud: 'humedad_suelo', unidad: 'V', etiqueta: null, escala_cero: opciones.antes?.cero ?? null, escala_cien: opciones.antes?.cien ?? null, actualizado_en: vigente }] };
      }
      if (texto.startsWith('UPDATE canal')) {
        if (opciones.insertFalla) throw Object.assign(new Error('rechazo'), opciones.insertFalla);
        if (p[3] !== vigente) return { rows: [], rowCount: 0 };
        return { rows: [{ id: C, dispositivo_id: D, magnitud: 'humedad_suelo', unidad: 'V', etiqueta: null, escala_cero: p[1], escala_cien: p[2], actualizado_en: NUEVO }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release: vi.fn(),
  };
  const pool = { connect: () => Promise.resolve(cliente) } as unknown as Pool;
  return { servicio: new AltaService(pool, { disponible: true } as unknown as DynsecService), sql, params, cliente };
}

describe('AltaService.calibrar: bloqueo optimista, evento y respuesta (docs/10 §8.4 punto 51)', () => {
  it('con el actualizado_en vigente: fila bloqueada → UPDATE condicionado → evento canal_calibrado → COMMIT; 200 con el canal y el actualizado_en nuevo', async () => {
    const { servicio, sql, params, cliente } = armar();
    const r = await servicio.calibrar(C, { escala_cero: 2.205, escala_cien: 1.17, actualizado_en: VIEJO });
    expect(sql[0]).toBe('BEGIN');
    expect(sql.at(-1)).toBe('COMMIT');
    expect(sql.find((s) => s.startsWith('SELECT c.id, c.dispositivo_id'))).toContain('FOR NO KEY UPDATE OF c');
    const u = sql.findIndex((s) => s.startsWith('UPDATE canal'));
    expect(sql[u]).toContain('c.actualizado_en = $4::timestamptz'); // texto con microsegundos, nunca un Date
    expect(params[u]).toEqual([C, 2.205, 1.17, VIEJO]);
    const e = sql.findIndex((s) => s.startsWith('INSERT INTO evento'));
    expect(e).toBeGreaterThan(u);
    expect(params[e][0]).toBe(D);
    expect(params[e][1]).toBe('canal_calibrado');
    expect(JSON.parse(params[e][2] as string)).toEqual({ canal_id: C, magnitud: 'humedad_suelo', antes: { cero: null, cien: null }, despues: { cero: 2.205, cien: 1.17 }, origen: 'api' });
    expect(r).toEqual({ id: C, dispositivo_id: D, magnitud: 'humedad_suelo', unidad: 'V', etiqueta: null, escala_cero: 2.205, escala_cien: 1.17, actualizado_en: NUEVO });
    expect(cliente.release).toHaveBeenCalledTimes(1);
  });

  it('con un actualizado_en viejo (otro lo cambió) → 409 «alguien lo cambió a las HH:MM», con el vigente; ROLLBACK y sin evento', async () => {
    const { servicio, sql } = armar({ vigente: NUEVO });
    const e = (await servicio.calibrar(C, { escala_cero: 2.205, escala_cien: 1.17, actualizado_en: VIEJO }).catch((x: unknown) => x)) as ConflictException;
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.getResponse()).toMatchObject({ statusCode: 409, actualizado_en: NUEVO, message: `alguien lo cambió a las 18:10 UTC (${NUEVO}); recarga` });
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
    expect(sql.some((s) => s.startsWith('INSERT INTO evento'))).toBe(false);
  });

  it('canal inexistente → 404 sin intentar el UPDATE', async () => {
    const { servicio, sql } = armar({ existe: false });
    await expect(servicio.calibrar(C, { escala_cero: 1, escala_cien: 2, actualizado_en: VIEJO })).rejects.toBeInstanceOf(NotFoundException);
    expect(sql.some((s) => s.startsWith('UPDATE canal'))).toBe(false);
  });

  it('quitar la calibración (las dos null) también deja el evento, con la escala anterior en «antes»; repetir las escalas vigentes no escribe nada', async () => {
    const { servicio, sql, params } = armar({ antes: { cero: 2.205, cien: 1.17 } });
    const r = await servicio.calibrar(C, { escala_cero: null, escala_cien: null, actualizado_en: VIEJO });
    expect(r.escala_cero).toBeNull();
    const e = params[sql.findIndex((s) => s.startsWith('INSERT INTO evento'))];
    expect(JSON.parse(e[2] as string)).toMatchObject({ antes: { cero: 2.205, cien: 1.17 }, despues: { cero: null, cien: null } });
    // las mismas escalas que ya tiene (el doble sigue devolviendo 2,205/1,17 como «antes»): COMMIT sin UPDATE ni evento, marca intacta
    const n = sql.length;
    const r2 = await servicio.calibrar(C, { escala_cero: 2.205, escala_cien: 1.17, actualizado_en: VIEJO });
    expect(sql.slice(n).some((s) => s.startsWith('UPDATE canal') || s.startsWith('INSERT INTO evento'))).toBe(false);
    expect(sql.at(-1)).toBe('COMMIT');
    expect(r2).toMatchObject({ escala_cero: 2.205, escala_cien: 1.17, actualizado_en: VIEJO });
  });

  it('la base rechaza la fila (ck_canal_escala) → 400; la fila tomada por otro (lock_timeout) → 503', async () => {
    await expect(armar({ insertFalla: { code: '23514', constraint: 'ck_canal_escala' } }).servicio.calibrar(C, { escala_cero: 1, escala_cien: 2, actualizado_en: VIEJO })).rejects.toBeInstanceOf(BadRequestException);
    await expect(armar({ insertFalla: { code: '55P03' } }).servicio.calibrar(C, { escala_cero: 1, escala_cien: 2, actualizado_en: VIEJO })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('la ruta la protege el guardia central (docs/20 §5): rol de consulta → 403 antes de validar; UUID y cuerpo validados antes del servicio', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CanalesAdminController)).toBeUndefined(); // ya no lleva guardia propia: la global (APP_GUARD)
    const llamado = vi.fn();
    const exigirCanal = vi.fn(() => Promise.resolve());
    const ctl = new CanalesAdminController({ calibrar: llamado } as unknown as AltaService, { exigirCanal } as unknown as AlcanceService);
    const consulta: UsuarioSesion = { ...usuarioSistema(), id: 'u1', sistema: false, todos: false, sitios: new Map([['s1', 'consulta']]) };
    await expect(ctl.calibrar(consulta, 'no-es-uuid', { escala_cero: 1, escala_cien: 2, actualizado_en: VIEJO })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.calibrar(usuarioSistema(), 'no-es-uuid', { escala_cero: 1, escala_cien: 2, actualizado_en: VIEJO })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctl.calibrar(usuarioSistema(), C, { escala_cero: 1, actualizado_en: VIEJO })).rejects.toBeInstanceOf(BadRequestException);
    expect(exigirCanal).toHaveBeenCalledWith(usuarioSistema(), 'escribir', C);
    expect(llamado).not.toHaveBeenCalled();
  });
});
