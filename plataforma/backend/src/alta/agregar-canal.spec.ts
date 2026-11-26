import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Pool } from 'pg';
import type { DynsecService } from '../broker/dynsec.service.js';
import type { ConsultaService } from '../consulta/consulta.service.js';
import type { AlcanceService } from '../sesion/alcance.service.js';
import { UsuarioSesion, usuarioSistema } from '../sesion/permisos.js';
import { MAX_CANALES } from './alta.dto.js';
import { AltaController } from './alta.controller.js';
import { AltaService } from './alta.service.js';
import type { ConfiguracionService } from './configuracion.service.js';
import { validarCanalNuevo } from './configuracion.dto.js';

// «Agregar una magnitud» a un equipo ya creado (POST /dispositivos/{id}/canales; docs/19 §4 AA; docs/10 §8.4 punto 71 vi), con una base falsa.
const D = '88888888-8888-4888-8888-888888888888';
const CATALOGO: Record<string, string> = { temperatura: 'Cel', rssi: 'dBm', snr: 'dB' };
const motivos = (c: unknown): string[] => {
  try { validarCanalNuevo(c); return []; } catch (e) { return ((e as BadRequestException).getResponse() as { message: string[] }).message; }
};

describe('validarCanalNuevo: el cuerpo de POST /dispositivos/{id}/canales', () => {
  it('el código de una magnitud, sin espacios ni mayúsculas', () => {
    expect(validarCanalNuevo({ magnitud: ' SNR ' })).toEqual({ magnitud: 'snr' });
  });
  it('sin magnitud, con otra forma, con campos ajenos o sin objeto → 400 con el motivo', () => {
    expect(motivos({})).toEqual([expect.stringContaining('magnitud: el código de una magnitud del catálogo')]);
    expect(motivos({ magnitud: '1x' })).toHaveLength(1);
    expect(motivos({ magnitud: 7 })).toHaveLength(1);
    expect(motivos({ magnitud: 'snr', etiqueta: 'x' })).toEqual(['etiqueta: campo no admitido']);
    expect(motivos(['snr'])).toEqual(['(cuerpo): debe ser un objeto JSON']);
  });
});

function armar(o: { existe?: boolean; estado?: string; canales?: string[] } = {}) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const canales = o.canales ?? ['temperatura'];
  const cliente = {
    query: async (texto: string, p: unknown[] = []) => {
      await Promise.resolve();
      sql.push(texto.trim().split(/\s+/).slice(0, 3).join(' '));
      params.push(p);
      if (texto.startsWith('SELECT d.id, d.id_fisico, d.estado')) {
        return { rows: o.existe === false ? [] : [{ id: D, id_fisico: 'nodo-de-prueba', estado: o.estado ?? 'activo', via: 'lorawan', pasarela_id: 'p1', sitio_codigo: 'uct' }] };
      }
      if (texto.startsWith('SELECT unidad_canonica AS unidad FROM magnitud')) {
        const u = CATALOGO[p[0] as string];
        return { rows: u === undefined ? [] : [{ unidad: u }] };
      }
      if (texto.trimStart().startsWith('SELECT c.id, c.magnitud_codigo AS magnitud')) {
        return { rows: canales.map((m, i) => ({ id: `k${i}`, magnitud: m, unidad: CATALOGO[m] ?? 'u', etiqueta: null, escala_cero: null, escala_cien: null })) };
      }
      if (texto.startsWith('INSERT INTO canal')) return { rows: [{ id: 'k-nuevo' }], rowCount: 1 };
      if (texto.startsWith('INSERT INTO evento')) return { rows: [{ ocurrido_en: new Date() }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release: vi.fn(), on: vi.fn(), off: vi.fn(),
  };
  const pool = { connect: () => Promise.resolve(cliente) } as unknown as Pool;
  return { servicio: new AltaService(pool, { disponible: true } as unknown as DynsecService, { publicar() {} } as never), sql, params, cliente };
}

describe('AltaService.agregarCanal: un canal más, con su evento, sin tocar los demás', () => {
  it('magnitud del catálogo que no tiene: fila bloqueada → INSERT canal → evento canal_alta con quién → COMMIT; agregada', async () => {
    const { servicio, sql, params, cliente } = armar();
    const r = await servicio.agregarCanal(D, 'snr', 'u1');
    expect(r).toEqual({ agregada: true, dispositivo_id: D, canal: { id: 'k-nuevo', magnitud: 'snr', unidad: 'dB', etiqueta: null, escala_cero: null, escala_cien: null } });
    const i = sql.indexOf('INSERT INTO canal');
    expect(sql[0]).toBe('BEGIN');
    expect(sql.slice(i)).toEqual(['INSERT INTO canal', 'INSERT INTO evento', 'COMMIT']);
    expect(params[i]).toEqual([D, 'snr']);
    const ev = params[i + 1];
    expect(ev[0]).toBe(D);
    expect(ev[1]).toBe('canal_alta');
    expect(JSON.parse(ev[2] as string)).toEqual({ canal_id: 'k-nuevo', magnitud: 'snr', origen: 'api' });
    expect(ev[3]).toBe('u1');
    expect(sql.some((s) => s.startsWith('UPDATE') || s.startsWith('DELETE'))).toBe(false); // los canales existentes no se tocan
    expect(cliente.release).toHaveBeenCalledTimes(1);
  });
  it('idempotente: si ya la tiene, responde ese canal con agregada false, sin INSERT ni evento', async () => {
    const { servicio, sql } = armar({ canales: ['temperatura', 'snr'] });
    const r = await servicio.agregarCanal(D, 'snr', 'u1');
    expect(r.agregada).toBe(false);
    expect(r.canal.id).toBe('k1');
    expect(sql.filter((s) => s.startsWith('INSERT'))).toEqual([]);
    expect(sql.at(-1)).toBe('COMMIT');
  });
  it('fuera del catálogo → 400; dado de baja → 409; con el máximo de canales → 409; inexistente → 404; siempre ROLLBACK y nada insertado', async () => {
    const casos: [Parameters<typeof armar>[0], string, new (...a: never[]) => Error][] = [
      [{}, 'radon', BadRequestException],
      [{ estado: 'baja' }, 'snr', ConflictException],
      [{ canales: Array.from({ length: MAX_CANALES }, (_, i) => `m${i}`) }, 'snr', ConflictException],
      [{ existe: false }, 'snr', NotFoundException],
    ];
    for (const [o, magnitud, clase] of casos) {
      const { servicio, sql } = armar(o);
      await expect(servicio.agregarCanal(D, magnitud, 'u1')).rejects.toBeInstanceOf(clase);
      expect(sql.filter((s) => s.startsWith('INSERT'))).toEqual([]);
      expect(sql.at(-1)).toBe('ROLLBACK');
    }
  });
});

describe('AltaController.agregarCanal: la acción escribir en el sitio del equipo (docs/20 §6)', () => {
  const controlador = (agregarCanal = vi.fn(() => Promise.resolve({ agregada: true })), exigirDispositivo = vi.fn(() => Promise.resolve('s1'))) => ({
    ctl: new AltaController({ agregarCanal } as unknown as AltaService, { exigirDispositivo } as unknown as AlcanceService,
      { get: (_k: string, d: string) => d } as unknown as ConfigService, {} as unknown as ConfiguracionService, {} as unknown as ConsultaService),
    agregarCanal, exigirDispositivo,
  });
  it('un perfil de consulta: 403 antes de mirar el equipo ni el cuerpo', async () => {
    const { ctl, agregarCanal, exigirDispositivo } = controlador();
    const consulta: UsuarioSesion = { ...usuarioSistema(), id: 'u1', sistema: false, todos: false, sitios: new Map([['s1', 'consulta']]) };
    await expect(ctl.agregarCanal(consulta, D, { magnitud: 'snr' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(exigirDispositivo).not.toHaveBeenCalled();
    expect(agregarCanal).not.toHaveBeenCalled();
  });
  it('el equipo ajeno o inexistente: el 404 del alcance, sin llamar al servicio', async () => {
    const { ctl, agregarCanal } = controlador(undefined, vi.fn(() => Promise.reject(new NotFoundException('dispositivo no encontrado'))));
    await expect(ctl.agregarCanal(usuarioSistema(), D, { magnitud: 'snr' })).rejects.toBeInstanceOf(NotFoundException);
    expect(agregarCanal).not.toHaveBeenCalled();
  });
  it('con permiso: alcance con «escribir», cuerpo validado y el servicio con quién; un cuerpo inválido es 400', async () => {
    const { ctl, agregarCanal, exigirDispositivo } = controlador();
    const operador: UsuarioSesion = { ...usuarioSistema(), id: 'u2', sistema: false, todos: false, sitios: new Map([['s1', 'operador']]) };
    await ctl.agregarCanal(operador, D, { magnitud: 'RSSI' });
    expect(exigirDispositivo).toHaveBeenCalledWith(operador, 'escribir', D);
    expect(agregarCanal).toHaveBeenCalledWith(D, 'rssi', 'u2');
    await expect(ctl.agregarCanal(operador, D, { magnitud: '' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctl.agregarCanal(operador, 'no-es-uuid', { magnitud: 'snr' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
