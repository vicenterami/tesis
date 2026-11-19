import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import type { Response } from 'express';
import type { AlcanceService } from '../sesion/alcance.service.js';
import { Accion, Rol, UsuarioSesion, exigir, usuarioSistema } from '../sesion/permisos.js';
import { SitiosController } from './sitios.controller.js';
import { DispositivosController } from './dispositivos.controller.js';
import { CODIGO_CUPO, CupoExportaciones, MAX_EXPORTACIONES, MENSAJE_CUPO } from './cupo-exportaciones.js';
import { DescargaCortada, MENSAJE_FALLA, escritorDeDescarga, responderFalla } from './descarga.js';
import type { ConsultaService } from './consulta.service.js';
import type { TableroService } from './tablero.service.js';

// Las dos rutas de la exportación por sitio (docs/19 §4, bloque R, puntos 2, 3 y 5; docs/20 §6, fila del 19/11/2026) sin base: el orden de
// los códigos, el cupo único con la exportación por dispositivo y la escritura que se corta si el cliente se va. La prueba contra una base
// real, con la aplicación compilada, está en integracion/exportar.ts.
const S = '55555555-5555-4555-8555-555555555555';
const OTRO = '77777777-7777-4777-8777-777777777777';
const D = '66666666-6666-4666-8666-666666666666';
const persona = (sitios: [string, Rol][]): UsuarioSesion =>
  ({ ...usuarioSistema(), id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid', sistema: false, todos: false, sitios: new Map(sitios), sesionId: 'a'.repeat(64) });
const codigo = async (p: Promise<unknown>): Promise<number> => {
  try { await p; return 200; } catch (e) { if (e instanceof HttpException) return e.getStatus(); throw e; }
};
// Una respuesta mínima: cabeceras, write con contrapresión controlable, close, y lo que hace falta para responder un error antes de escribir.
class Respuesta extends EventEmitter {
  cabeceras = new Map<string, string>();
  trozos: Buffer[] = [];
  cuerpo = '';
  statusCode = 200;
  destroyed = false;
  writableEnded = false;
  headersSent = false;
  lleno = false;
  setHeader(k: string, v: string): void { this.cabeceras.set(k.toLowerCase(), v); }
  removeHeader(k: string): void { this.cabeceras.delete(k.toLowerCase()); }
  write(b: Buffer | string): boolean { this.headersSent = true; this.trozos.push(Buffer.from(b)); return !this.lleno; }
  end(b?: string): void { this.headersSent = true; this.writableEnded = true; if (b !== undefined) this.cuerpo = b; }
  destroy(): void { this.destroyed = true; this.emit('close'); }
}
const N0 = { mediciones: 0, tramas: 0, eventos: 0, tramasDesde: null };
const cuerpoDe = (e: unknown): unknown => (e instanceof HttpException ? e.getResponse() : null);

function armar(cupo = new CupoExportaciones()) {
  const alcance = { exigirSitio: vi.fn((u: UsuarioSesion, a: Accion, id: string) => Promise.resolve().then(() => exigir(u, a, [S, OTRO].includes(id) ? id : null, 'sitio no encontrado'))) };
  let soltar: () => void = () => undefined;
  const consulta = {
    sitioExportable: vi.fn(() => Promise.resolve({ codigo: 'campus', nombre: 'Campus' })),
    // La descarga (o la estimación) queda «en curso» hasta que la prueba la suelta.
    conConexionExportacion: vi.fn((_fn: unknown, _tope?: number) => new Promise<unknown>((r) => { soltar = () => r(N0); })),
    estimarSitio: vi.fn(),
  };
  const c = new SitiosController({} as TableroService, alcance as unknown as AlcanceService, {} as never, {} as never, consulta as unknown as ConsultaService, cupo);
  return { c, consulta, cupo, soltar: () => soltar() };
}
function dispositivos(cupo: CupoExportaciones, mediciones: () => AsyncGenerator<unknown> = async function* () { /* vacío */ }) {
  return new DispositivosController(
    { identidad: () => Promise.resolve({ id_fisico: 'dev-1' }), mediciones } as unknown as ConsultaService,
    { exigirDispositivo: () => Promise.resolve(S) } as unknown as AlcanceService, {} as TableroService, cupo);
}

describe('GET /sitios/{id}/exportar y …/estimacion: el orden de los códigos (docs/20 §6)', () => {
  it('sitio inexistente u otro sitio → 404; consulta y operador → 403; investigador y administrador pasan; después el formato y el rango → 400', async () => {
    const { c, consulta } = armar();
    const res = new Respuesta() as unknown as Response;
    const inv = persona([[S, 'investigador']]);
    expect(await codigo(c.exportar(inv, OTRO, res))).toBe(404);
    expect(await codigo(c.exportar(inv, '88888888-8888-4888-8888-888888888888', res))).toBe(404);
    expect(await codigo(c.exportar(inv, 'no-es-uuid', res))).toBe(400);
    for (const rol of ['consulta', 'operador'] as const) {
      expect(await codigo(c.exportar(persona([[S, rol]]), S, res, 'xlsx'))).toBe(403);
      expect(await codigo(c.estimacion(persona([[S, rol]]), S))).toBe(403);
    }
    expect(await codigo(c.exportar(persona([[S, 'consulta']]), S, res, 'xls'))).toBe(403); // el permiso antes que el formato
    expect(await codigo(c.exportar(inv, S, res, 'xls'))).toBe(400);
    expect(await codigo(c.exportar(inv, S, res, 'csv', '1999-12-31T00:00:00Z'))).toBe(400);
    expect(await codigo(c.exportar(inv, S, res, 'csv', '2026-11-02T00:00:00Z', '2026-11-01T00:00:00Z'))).toBe(400);
    expect(await codigo(c.estimacion(inv, S, '2026-11-02T00:00:00Z', '2026-11-01T00:00:00Z'))).toBe(400);
    expect(consulta.conConexionExportacion).not.toHaveBeenCalled();
  });
});

describe('cupo único (bloque R, punto 3; revisión del 19/11/2026): dos consultas pesadas a la vez por proceso, entre exportaciones y estimaciones', () => {
  it(`con ${MAX_EXPORTACIONES} en curso (una exportación y una estimación), el tercero responde 429 con codigo, sea exportación de sitio, de dispositivo o estimación; al terminar, se libera`, async () => {
    const cupo = new CupoExportaciones();
    const a = armar(cupo);
    const b = armar(cupo);
    const inv = persona([[S, 'investigador']]);
    const r1 = a.c.exportar(inv, S, new Respuesta() as unknown as Response, 'json');
    const r2 = b.c.estimacion(inv, S);
    await vi.waitFor(() => expect(cupo.ocupados).toBe(2));
    expect(b.consulta.conConexionExportacion.mock.calls[0]?.[1]).toBe(10_000); // la estimación, con 10 s por consulta
    const terceros = [
      armar(cupo).c.exportar(inv, S, new Respuesta() as unknown as Response),
      armar(cupo).c.estimacion(inv, S),
      dispositivos(cupo).exportar(inv, D, new Respuesta() as unknown as Response),
    ];
    for (const t of terceros) {
      const e = await t.then(() => null, (x: unknown) => x);
      expect(e instanceof HttpException ? e.getStatus() : e).toBe(429);
      expect(cuerpoDe(e)).toEqual({ statusCode: 429, error: 'Too Many Requests', codigo: CODIGO_CUPO, message: MENSAJE_CUPO });
    }
    expect(MENSAJE_CUPO).toBe('hay 2 exportaciones o estimaciones en curso; inténtalo en un momento');
    a.soltar();
    await r1;
    expect(cupo.ocupados).toBe(1);
    b.soltar();
    expect(await r2).toMatchObject({ mediciones: { filas: 0, supera_tope: false } });
    expect(cupo.ocupados).toBe(0);
  });
  it('una estimación que pasa su tope de 10 s responde 503 y suelta el cupo', async () => {
    const cupo = new CupoExportaciones();
    const { c, consulta } = armar(cupo);
    consulta.conConexionExportacion.mockImplementation(() => Promise.reject(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })));
    expect(await codigo(c.estimacion(persona([[S, 'investigador']]), S))).toBe(503);
    expect(cupo.ocupados).toBe(0);
  });
});

describe('falla antes de la primera escritura (revisión del 19/11/2026): 503 en JSON, no un corte', () => {
  it('sitio: si la primera consulta falla, sin cabeceras del archivo, 503 con el formato de error, y el cupo se suelta', async () => {
    const cupo = new CupoExportaciones();
    const { c, consulta } = armar(cupo);
    consulta.conConexionExportacion.mockImplementation(() => Promise.reject(new Error('la base se cayó')));
    const res = new Respuesta();
    await c.exportar(persona([[S, 'administrador']]), S, res as unknown as Response, 'xlsx');
    expect([cupo.ocupados, res.destroyed, res.statusCode]).toEqual([0, false, 503]);
    expect(res.cabeceras.get('content-disposition')).toBeUndefined();
    expect(res.cabeceras.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.cabeceras.get('cache-control')).toBe('no-store');
    expect(JSON.parse(res.cuerpo)).toEqual({ statusCode: 503, error: 'Service Unavailable', message: MENSAJE_FALLA });
  });
  it('dispositivo: la cabecera del CSV queda retenida, la primera consulta falla y responde 503', async () => {
    const cupo = new CupoExportaciones();
    const res = new Respuesta();
    // eslint-disable-next-line require-yield
    await dispositivos(cupo, async function* () { await Promise.resolve(); throw new Error('la base no responde'); }).exportar(persona([[S, 'investigador']]), D, res as unknown as Response);
    expect([cupo.ocupados, res.destroyed, res.statusCode, res.trozos.length, res.cabeceras.has('content-disposition')]).toEqual([0, false, 503, 0, false]);
  });
  it('con las cabeceras ya enviadas, en cambio, se corta la conexión', () => {
    const res = new Respuesta();
    res.write('ya salió algo');
    expect(responderFalla(res as unknown as ServerResponse, new Error('a mitad'))).toBe('cortada');
    expect([res.destroyed, res.statusCode]).toEqual([true, 200]);
    const res2 = new Respuesta();
    expect(responderFalla(res2 as unknown as ServerResponse, new DescargaCortada())).toBe('cortada'); // el cliente ya no está
  });
});

describe('escritorDeDescarga: retención inicial, contrapresión y corte', () => {
  it('retiene lo primero hasta el umbral (un archivo chico sale entero al terminar); después, con el socket lleno espera `drain`; si en vez de eso se cierra, falla con DescargaCortada', async () => {
    const chico = new Respuesta();
    const d0 = escritorDeDescarga(chico as unknown as ServerResponse);
    await d0.escribir('cabecera\r\n');
    await d0.escribir(Buffer.from('fila\r\n'));
    expect([chico.trozos.length, chico.headersSent]).toEqual([0, false]);
    await d0.terminar();
    expect([Buffer.concat(chico.trozos).toString(), chico.writableEnded]).toEqual(['cabecera\r\nfila\r\n', true]);

    const res = new Respuesta();
    const d = escritorDeDescarga(res as unknown as ServerResponse, 4);
    await d.escribir('ab');
    expect(res.trozos.length).toBe(0);
    await d.escribir('cd'); // llega al umbral: sale lo retenido junto
    expect(Buffer.concat(res.trozos).toString()).toBe('abcd');
    res.lleno = true;
    const p = d.escribir('e');
    let listo = false;
    void p.then(() => { listo = true; });
    await new Promise((r) => setImmediate(r));
    expect(listo).toBe(false);
    res.emit('drain');
    await p;
    const q = d.escribir('f');
    res.destroy();
    await expect(q).rejects.toBeInstanceOf(DescargaCortada);
    await expect(d.escribir('g')).rejects.toBeInstanceOf(DescargaCortada);
    expect(res.listenerCount('drain') + res.listenerCount('close')).toBe(0);
  });
});

describe('proxy (bloque R, punto 3): las dos exportaciones pasan sin guardarse en el disco del proxy, con los mismos topes de tasa', () => {
  const conf = readFileSync(new URL('../../../proxy/nginx.conf', import.meta.url), 'utf8');
  const bloque = (cabecera: RegExp): string => new RegExp(cabecera.source + String.raw`\s*\{([^}]*)\}`).exec(conf)?.[1] ?? '';
  it('su `location` lleva proxy_buffering off y las mismas líneas de tasa y conexiones que «location /»', () => {
    const exportar = bloque(/location ~\* \^\/\(dispositivos\|sitios\)\/\[\^\/\]\+\/exportar\/\?\$/);
    const raiz = bloque(/location \//);
    expect(exportar).toMatch(/^\s*proxy_buffering\s+off;/m);
    const tasa = (b: string): string[] => b.split('\n').map((l) => l.trim()).filter((l) => /^limit_(req|conn)\s/.test(l));
    expect(tasa(raiz).length).toBe(3);
    expect(tasa(exportar)).toEqual(tasa(raiz));
    expect(exportar).toMatch(/proxy_pass\s+\$backend;/);
  });
  it('la expresión toma las dos rutas como las sirve Express (sin distinguir mayúsculas, barra final opcional) y nada más', () => {
    const expr = /location ~\* (\S+) \{[^}]*proxy_buffering\s+off;/.exec(conf)?.[1] ?? '';
    const re = new RegExp(expr, 'i');
    const si = ['/sitios/abc/exportar', '/dispositivos/abc/exportar', '/Sitios/abc/Exportar', '/sitios/abc/exportar/'];
    const no = ['/sitios/abc/exportar/estimacion', '/cuenta/exportar', '/sitios/exportar', '/sitios/a/b/exportar', '/sitios/abc/exportarx'];
    expect(si.filter((u) => !re.test(u))).toEqual([]);
    expect(no.filter((u) => re.test(u))).toEqual([]);
  });
});
