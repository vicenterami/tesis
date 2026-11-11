import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import type { Pool } from 'pg';
import { usuarioSistema } from '../sesion/permisos.js';
import type { UsuarioSesion } from '../sesion/permisos.js';
import type { SesionService } from '../sesion/sesion.service.js';
import { CANDADO_ADMINISTRADORES } from '../sesion/usuarios.service.js';
import { AVISO_EXPORTAR, CuentaService, exigirNoUltimoAdministrador } from './cuenta.service.js';

// Baja por anonimización (docs/20 §11): la regla del último administrador y el ORDEN dentro de la transacción (clave → candado →
// recuento → anonimización en la base → evento → COMMIT). La anonimización real (qué columnas quedan) la prueba el humo contra la base.
const fila = (f: { global: boolean; admin: boolean; otros_globales: number; otros_admin: boolean }) =>
  ({ query: () => Promise.resolve({ rows: [f] }) }) as unknown as Parameters<typeof exigirNoUltimoAdministrador>[0];

describe('exigirNoUltimoAdministrador', () => {
  it('el último administrador del sistema → 409; con otro, pasa', async () => {
    await expect(exigirNoUltimoAdministrador(fila({ global: true, admin: true, otros_globales: 0, otros_admin: true }), 'u')).rejects.toThrow(/último administrador del sistema/);
    await expect(exigirNoUltimoAdministrador(fila({ global: true, admin: true, otros_globales: 1, otros_admin: true }), 'u')).resolves.toBeUndefined();
  });
  it('un administrador de sitio sin ningún otro administrador en la plataforma → 409; una persona de consulta, siempre pasa', async () => {
    await expect(exigirNoUltimoAdministrador(fila({ global: false, admin: true, otros_globales: 0, otros_admin: false }), 'u')).rejects.toBeInstanceOf(ConflictException);
    await expect(exigirNoUltimoAdministrador(fila({ global: false, admin: false, otros_globales: 0, otros_admin: false }), 'u')).resolves.toBeUndefined();
  });
});

// docs/21 §8 (decidido el 11/11/2026): la exportación trae también el correo tecleado en sus intentos, la fecha y el motivo de una baja y el
// detalle de los cambios que hizo; el aviso dice qué NO trae.
describe('GET /cuenta/exportar: qué trae y qué dice que no trae', () => {
  it('pide email_intentado, desactivado_en, motivo_baja y el detalle de sus eventos; el aviso enumera lo que no se incluye', async () => {
    const consultas: string[] = [];
    const query = vi.fn((sql: string) => { consultas.push(sql); return Promise.resolve({ rows: [] }); });
    const servicio = new CuentaService({ query } as unknown as Pool, { ahora: () => new Date('2026-11-11T12:00:00Z') } as unknown as SesionService);
    const ana: UsuarioSesion = { ...usuarioSistema(), id: 'u1', email: 'ana@ejemplo.invalid', sistema: false, todos: false, sesionId: 'a'.repeat(64) };
    const r = await servicio.exportar(ana);
    const de = (tabla: string) => consultas.find((q) => q.includes(`FROM ${tabla} WHERE usuario_id`) || q.includes(`FROM ${tabla} WHERE id`)) ?? '';
    expect(de('acceso')).toContain('email_intentado');
    expect(de('evento')).toContain('detalle');
    expect(de('usuario')).toMatch(/desactivado_en[\s\S]*motivo_baja/);
    expect(r.aviso).toBe(AVISO_EXPORTAR);
    expect(AVISO_EXPORTAR).toMatch(/No se incluyen: .*mediciones.*otras personas/);
  });
});

describe('POST /cuenta/baja: el orden de la transacción', () => {
  it('clave actual primero; después BEGIN, el candado de los administradores, el recuento, fn_anonimizar_usuario, el evento y COMMIT', async () => {
    const consultas: string[] = [];
    const query = vi.fn((sql: string) => {
      consultas.push(sql);
      if (sql.includes('AS global')) return Promise.resolve({ rows: [{ global: false, admin: false, otros_globales: 0, otros_admin: false }] });
      if (sql.includes('fn_anonimizar_usuario')) return Promise.resolve({ rows: [{ instante: new Date('2026-11-11T12:00:00Z') }] });
      if (sql.includes('INSERT INTO evento')) return Promise.resolve({ rows: [{ ocurrido_en: new Date() }] });
      return Promise.resolve({ rows: [] });
    });
    const pool = { query, connect: () => Promise.resolve({ query, release: () => undefined, on: () => undefined, off: () => undefined }) } as unknown as Pool;
    const exigirClaveActual = vi.fn(() => Promise.resolve());
    const registrar = vi.fn(() => Promise.resolve());
    const servicio = new CuentaService(pool, { exigirClaveActual, registrar, ahora: () => new Date() } as unknown as SesionService);
    const ana: UsuarioSesion = { ...usuarioSistema(), id: 'u1', email: 'ana@ejemplo.invalid', sistema: false, todos: false, sesionId: 'a'.repeat(64) };
    expect(await servicio.darseDeBaja(ana, { clave: 'la-actual' }, '127.0.0.1')).toEqual({ anonimizado_en: '2026-11-11T12:00:00.000Z' });
    expect(exigirClaveActual).toHaveBeenCalledWith(ana, 'la-actual', '127.0.0.1');
    const i = (p: string) => consultas.findIndex((q) => q.includes(p));
    expect([i('BEGIN'), i(CANDADO_ADMINISTRADORES), i('AS global'), i('fn_anonimizar_usuario'), i('INSERT INTO evento'), i('COMMIT')].every((v, k, a) => v >= 0 && (k === 0 || v > a[k - 1]))).toBe(true);
    expect(registrar).toHaveBeenCalledWith(expect.objectContaining({ resultado: 'cierre', email: null, usuarioId: 'u1' }));
  });
  it('la clave de administrador no es una cuenta: 400 sin tocar la base', async () => {
    const query = vi.fn();
    const servicio = new CuentaService({ query } as unknown as Pool, {} as SesionService);
    await expect(servicio.darseDeBaja(usuarioSistema(), { clave: 'x' }, '127.0.0.1')).rejects.toThrow(/no es una cuenta/);
    expect(query).not.toHaveBeenCalled();
  });
});
