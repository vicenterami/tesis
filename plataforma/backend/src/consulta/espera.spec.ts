import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { AlcanceService } from '../sesion/alcance.service.js';
import { Accion, Rol, UsuarioSesion, exigir, usuarioSistema } from '../sesion/permisos.js';
import { ESPERA_CAMBIO, ESPERA_PRIMERA_TRAMA, validarEspera, validarPropuesto } from './espera.js';
import { EsperaService, SQL_AFECTADOS_POR_PLAZO } from './espera.service.js';
import { SQL_ESPERA_HASTA } from './tablero.js';
import { SitiosController } from './sitios.controller.js';
import type { TableroService } from './tablero.service.js';
import type { ActividadService } from './actividad.service.js';

// El plazo de la primera trama del sitio (docs/19 §2 y §4, P; docs/20 §6, filas del plazo; docs/10 §8.4 punto 68). La prueba contra una base
// real (la columna, el CHECK, el evento y el aislamiento por sitio con la aplicación compilada) está en integracion/espera.ts.
const S = '55555555-5555-4555-8555-555555555555';
const OTRO = '77777777-7777-4777-8777-777777777777';
const persona = (sitios: [string, Rol][]): UsuarioSesion =>
  ({ ...usuarioSistema(), id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid', sistema: false, todos: false, sitios: new Map(sitios), sesionId: 'a'.repeat(64) });
const codigo = async (p: Promise<unknown>): Promise<number> => {
  try { await p; return 200; } catch (e) { if (e instanceof HttpException) return e.getStatus(); throw e; }
};

describe('validarEspera: el cuerpo de PUT /sitios/{id}/espera-primera-trama', () => {
  it('los límites son los del CHECK de la migración 26 (1 a 2 160, 168 por omisión)', () => {
    expect(ESPERA_PRIMERA_TRAMA).toEqual({ minimo: 1, maximo: 2160, porOmision: 168 });
  });
  it('un entero de 1 a 2 160, con o sin `anterior`', () => {
    expect(validarEspera({ espera_primera_trama_h: 1 })).toEqual({ horas: 1, anterior: null });
    expect(validarEspera({ espera_primera_trama_h: 2160, anterior: 168 })).toEqual({ horas: 2160, anterior: 168 });
  });
  it('fuera de rango, no entero, texto, ausente, un campo de más o un cuerpo que no es objeto → 400 con cada motivo', () => {
    for (const malo of [{ espera_primera_trama_h: 0 }, { espera_primera_trama_h: 2161 }, { espera_primera_trama_h: 1.5 }, { espera_primera_trama_h: '24' }, {},
      { espera_primera_trama_h: 24, anterior: 0 }, { espera_primera_trama_h: 24, sitio_id: S }, null, [24], 24]) {
      expect(() => validarEspera(malo), JSON.stringify(malo)).toThrow(BadRequestException);
    }
    try { validarEspera({ espera_primera_trama_h: 0, extra: 1 }); } catch (e) {
      expect((e as BadRequestException).getResponse()).toMatchObject({ message: ['campo no admitido: extra', 'espera_primera_trama_h debe ser un entero de horas entre 1 y 2160 (90 días)'] });
    }
  });
});

describe('SitiosController: el plazo, quién puede y en qué orden (docs/20 §6 y §10)', () => {
  function controlador() {
    const espera = { leer: vi.fn(() => Promise.resolve({})), fijar: vi.fn(() => Promise.resolve({})) };
    // El sitio existe solo si es S u OTRO; exigir() decide 404/403 como en la pila (permisos.ts).
    const alcance = { exigirSitio: vi.fn((u: UsuarioSesion, accion: Accion, id: string) => Promise.resolve().then(() => exigir(u, accion, [S, OTRO].includes(id) ? id : null, 'sitio no encontrado'))) };
    const c = new SitiosController({} as TableroService, alcance as unknown as AlcanceService, {} as ActividadService, espera as unknown as EsperaService, {} as never, {} as never);
    return { c, espera };
  }
  it('leerlo: cualquier perfil del sitio (200); otro sitio o inexistente, 404', async () => {
    for (const rol of ['consulta', 'investigador', 'operador', 'administrador'] as const) expect(await codigo(controlador().c.leerEspera(persona([[S, rol]]), S)), rol).toBe(200);
    expect(await codigo(controlador().c.leerEspera(persona([[S, 'administrador']]), OTRO))).toBe(404);
    expect(await codigo(controlador().c.leerEspera(persona([[S, 'administrador']]), '99999999-9999-4999-8999-999999999999'))).toBe(404);
    expect(await codigo(controlador().c.leerEspera(persona([[S, 'administrador']]), 'no-uuid'))).toBe(400);
  });
  it('fijarlo: consulta, investigación y operación técnica → 403 antes de mirar el cuerpo; el administrador del sitio y el del sistema → 200 con quién', async () => {
    for (const rol of ['consulta', 'investigador', 'operador'] as const) {
      const { c, espera } = controlador();
      expect(await codigo(c.fijarEspera(persona([[S, rol]]), S, { basura: 1 })), rol).toBe(403);
      expect(espera.fijar).not.toHaveBeenCalled();
    }
    const { c, espera } = controlador();
    expect(await codigo(c.fijarEspera(persona([[S, 'administrador']]), S, { espera_primera_trama_h: 24, anterior: 168 }))).toBe(200);
    expect(espera.fijar).toHaveBeenCalledWith(S, 24, 'u1', 168);
    expect(await codigo(controlador().c.fijarEspera({ ...usuarioSistema(), todos: true }, OTRO, { espera_primera_trama_h: 24 }))).toBe(200);
  });
  it('fijarlo: fuera de rango → 400; administrador de OTRO sitio → 400 por el cuerpo y 404 con uno válido (no revela el sitio); operador de un sitio y administrador de otro → 403 en el suyo de operador', async () => {
    const adm = persona([[S, 'administrador']]);
    expect(await codigo(controlador().c.fijarEspera(adm, S, { espera_primera_trama_h: 2161 }))).toBe(400);
    expect(await codigo(controlador().c.fijarEspera(persona([[OTRO, 'administrador']]), S, { espera_primera_trama_h: 0 }))).toBe(400);
    const { c, espera } = controlador();
    expect(await codigo(c.fijarEspera(persona([[OTRO, 'administrador']]), S, { espera_primera_trama_h: 24 }))).toBe(404);
    expect(espera.fijar).not.toHaveBeenCalled();
    expect(await codigo(controlador().c.fijarEspera(persona([[S, 'operador'], [OTRO, 'administrador']]), S, { espera_primera_trama_h: 24 }))).toBe(403);
  });
});

describe('EsperaService.fijar: bloqueo optimista por valor, evento con quién y nada si no cambia', () => {
  function armar(vigente: number) {
    const llamadas: [string, unknown[]][] = [];
    let actual = vigente;
    const cliente = {
      query: vi.fn((sql: string, p: unknown[] = []) => {
        llamadas.push([sql.replace(/\s+/g, ' ').trim(), p]);
        if (sql.startsWith('SELECT espera_primera_trama_h')) return Promise.resolve({ rows: [{ h: actual }] });
        if (sql.startsWith('UPDATE sitio')) { actual = p[1] as number; return Promise.resolve({ rowCount: 1, rows: [] }); }
        return Promise.resolve({ rows: [{ ocurrido_en: new Date() }], rowCount: 1 });
      }),
      release: vi.fn(), on: vi.fn(), off: vi.fn(),
    };
    return { servicio: new EsperaService({ connect: () => Promise.resolve(cliente) } as unknown as Pool), llamadas, cliente };
  }
  it('cambia, deja el evento espera_primera_trama con el valor y el anterior, y bloquea la fila del sitio antes de leer el vigente', async () => {
    const { servicio, llamadas } = armar(168);
    expect(await servicio.fijar(S, 24, 'u1', 168)).toEqual({ espera_primera_trama_h: 24, por_omision: 168, minimo: 1, maximo: 2160 });
    expect(llamadas.find(([s]) => s.startsWith('SELECT espera_primera_trama_h'))?.[0]).toContain('FOR NO KEY UPDATE');
    const ev = llamadas.find(([s]) => s.startsWith('INSERT INTO evento'));
    expect(ev?.[1]).toEqual([null, 'espera_primera_trama', JSON.stringify({ sitio_id: S, espera_primera_trama_h: 24, anterior: 168 }), 'u1']);
    expect(llamadas.at(-1)?.[0]).toBe('COMMIT');
  });
  it('con `anterior` que ya no rige → 409 espera_cambio con el vigente, sin UPDATE ni evento, y ROLLBACK', async () => {
    const { servicio, llamadas } = armar(72);
    const e = await servicio.fijar(S, 24, 'u1', 168).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect((e as ConflictException).getResponse()).toMatchObject({ codigo: 'espera_cambio', espera_primera_trama_h: 72, message: ESPERA_CAMBIO(72) });
    expect(llamadas.some(([s]) => s.startsWith('UPDATE sitio') || s.startsWith('INSERT INTO evento'))).toBe(false);
    expect(llamadas.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('el mismo valor que rige: sin UPDATE ni evento (nada que registrar)', async () => {
    const { servicio, llamadas } = armar(168);
    await servicio.fijar(S, 168, 'u1', null);
    expect(llamadas.some(([s]) => s.startsWith('UPDATE sitio') || s.startsWith('INSERT INTO evento'))).toBe(false);
  });
});

// 18/11/2026: el aviso de quien acorta el plazo, `GET …/espera-primera-trama?propuesto=<h>` → `afectados` (docs/19 §4, P y Q). Los casos contra una
// base real (dentro, borde, ya vencido, otro sitio, mantenimiento) están en integracion/espera.ts.
describe('validarPropuesto: el `?propuesto=` se valida como el PUT', () => {
  it('ausente → null; un entero de 1 a 2 160 → ese número', () => {
    expect(validarPropuesto(undefined)).toBeNull();
    expect(validarPropuesto('1')).toBe(1);
    expect(validarPropuesto('2160')).toBe(2160);
  });
  it('vacío, 0, 2 161, decimal, signo, texto o repetido (arreglo) → 400', () => {
    for (const malo of ['', '0', '2161', '1.5', '-5', '+5', '24h', ' 24', '00000', ['24', '48'], 24]) {
      expect(() => validarPropuesto(malo), JSON.stringify(malo)).toThrow(BadRequestException);
    }
  });
});

describe('EsperaService.leer con `propuesto`: una sola consulta, con la regla del estado visual', () => {
  const armar = (n: number) => {
    const consultas: [string, unknown[]][] = [];
    const pool = { query: vi.fn((sql: string, p: unknown[] = []) => { consultas.push([sql, p]); return Promise.resolve({ rows: sql.includes('count(*)') ? [{ n }] : [{ h: 168 }] }); }) };
    return { servicio: new EsperaService(pool as unknown as Pool), consultas };
  };
  it('sin `propuesto` la respuesta es la de siempre: ni `afectados` ni segunda consulta', async () => {
    const { servicio, consultas } = armar(5);
    const r = await servicio.leer(S);
    expect(r).toEqual({ espera_primera_trama_h: 168, por_omision: 168, minimo: 1, maximo: 2160 });
    expect('afectados' in r).toBe(false);
    expect(consultas).toHaveLength(1);
  });
  it('con `propuesto` suma `afectados` con UNA consulta más, del sitio y de las horas pedidas', async () => {
    const { servicio, consultas } = armar(3);
    expect(await servicio.leer(S, 24)).toEqual({ espera_primera_trama_h: 168, por_omision: 168, minimo: 1, maximo: 2160, afectados: 3 });
    expect(consultas).toHaveLength(2);
    expect(consultas[1]?.[1]).toEqual([S, 24]);
  });
  it('la consulta usa la expresión del estado visual (no una copia) y cuenta solo activos que nunca enviaron, dentro de su plazo y vencidos con el propuesto', () => {
    const sql = SQL_AFECTADOS_POR_PLAZO.replace(/\s+/g, ' ');
    expect(sql).toContain(`now() < ${SQL_ESPERA_HASTA.replace(/\s+/g, ' ')}`);
    expect(sql).toContain("d.estado = 'activo'");
    expect(sql).toContain('e.visto_por_ultima_vez IS NULL');
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM condicion cv WHERE cv.dispositivo_id = d.id AND cv.cerrada_en IS NULL AND cv.tipo = 'sin_comunicacion')");
    expect(sql).toContain("d.en_servicio_desde + $2 * INTERVAL '1 hour' <= now()");
    expect(sql).toContain('z.sitio_id = $1');
  });
  it('el controlador: `propuesto` inválido → 400 (antes del sitio); válido, se lo pasa al servicio; cualquier perfil del sitio puede leer; otro sitio, 404', async () => {
    const espera = { leer: vi.fn(() => Promise.resolve({})), fijar: vi.fn() };
    const alcance = { exigirSitio: vi.fn((u: UsuarioSesion, accion: Accion, id: string) => Promise.resolve().then(() => exigir(u, accion, [S, OTRO].includes(id) ? id : null, 'sitio no encontrado'))) };
    const c = new SitiosController({} as TableroService, alcance as unknown as AlcanceService, {} as ActividadService, espera as unknown as EsperaService, {} as never, {} as never);
    expect(await codigo(c.leerEspera(persona([[S, 'consulta']]), S, '0'))).toBe(400);
    expect(espera.leer).not.toHaveBeenCalled();
    expect(await codigo(c.leerEspera(persona([[S, 'consulta']]), S, '24'))).toBe(200);
    expect(espera.leer).toHaveBeenCalledWith(S, 24);
    expect(await codigo(c.leerEspera(persona([[S, 'consulta']]), S))).toBe(200);
    expect(espera.leer).toHaveBeenLastCalledWith(S, null);
    expect(await codigo(c.leerEspera(persona([[S, 'administrador']]), OTRO, '24'))).toBe(404);
  });
});
