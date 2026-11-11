import { describe, expect, it, vi } from 'vitest';
import { ExecutionContext, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { CODIGO_TERMINOS_PENDIENTES, ConClaveTemporal, ConTerminosPendientes, GuardiaCentral, Publica, escribe, traePedidoDelPanel } from './guardia.js';
import { UsuarioSesion, usuarioSistema } from './permisos.js';
import type { SesionService } from './sesion.service.js';

// El guardia central (docs/20 §5), con la sesión falsa: quién entra, quién no y con qué código.
const CLAVE = 'k'.repeat(32);
const ID = 'A'.repeat(43);
const ANA: UsuarioSesion = { ...usuarioSistema(), id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid', sistema: false, todos: false, sitios: new Map([['s1', 'consulta']]), sesionId: 'a'.repeat(64) };

class Rutas {
  @Publica() publica(): void { /* ruta pública */ }
  privada(): void { /* ruta con guardia */ }
  @ConClaveTemporal() quienSoy(): void { /* admitida con clave temporal */ }
  @ConTerminosPendientes() aceptar(): void { /* admitida con los términos pendientes */ }
  @ConClaveTemporal() @ConTerminosPendientes() sesion(): void { /* GET /sesion: admitida con las dos */ }
}

function armar(opciones: { clave?: string; usuario?: UsuarioSesion | null } = {}) {
  const cargar = vi.fn(() => Promise.resolve(opciones.usuario === undefined ? ANA : opciones.usuario));
  const config = { get: (k: string) => (k === 'HTTP_CLAVE_ADMIN' ? opciones.clave : undefined) } as unknown as ConfigService;
  const guardia = new GuardiaCentral(new Reflector(), { cargar } as unknown as SesionService, config);
  const pedir = async (metodo: string, ruta: keyof Rutas, headers: Record<string, string> = {}) => {
    const req: Record<string, unknown> = { method: metodo, path: '/x', headers };
    const cabeceras: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => { cabeceras[k] = v; } };
    const ctx = {
      // El método como referencia, que es lo que entrega Nest (Reflector lee su metadato; nunca se llama).
      // eslint-disable-next-line @typescript-eslint/unbound-method
      getType: () => 'http', getHandler: () => Rutas.prototype[ruta], getClass: () => Rutas,
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext;
    let error: unknown = null;
    try { await guardia.canActivate(ctx); } catch (e) { error = e; }
    return { error, usuario: req.usuario as UsuarioSesion | undefined, cabeceras };
  };
  return { pedir, cargar };
}

describe('GuardiaCentral', () => {
  it('ruta pública: pasa sin mirar nada (ni cookie ni base)', async () => {
    const { pedir, cargar } = armar();
    expect((await pedir('GET', 'publica')).error).toBeNull();
    expect(cargar).not.toHaveBeenCalled();
  });

  it('sin cookie ni clave → 401 «sesión requerida», con el cuerpo fijo y sin tocar la base', async () => {
    const { pedir, cargar } = armar();
    const { error } = await pedir('GET', 'privada');
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual({ statusCode: 401, message: 'sesión requerida', error: 'Unauthorized' });
    expect(cargar).not.toHaveBeenCalled();
  });

  it('cookie válida: deja al usuario en la petición; una que ya no vale → 401 y la borra en el navegador', async () => {
    expect((await armar().pedir('GET', 'privada', { cookie: `__Host-sesion=${ID}` })).usuario).toBe(ANA);
    const vencida = await armar({ usuario: null }).pedir('GET', 'privada', { cookie: `__Host-sesion=${ID}` });
    expect(vencida.error).toBeInstanceOf(UnauthorizedException);
    expect(vencida.cabeceras['Set-Cookie']).toMatch(/^__Host-sesion=; .*Max-Age=0$/);
  });

  it('con sesión, una ruta que escribe sin X-Pedido: panel → 403 (CSRF); con ella, pasa; un GET no la necesita', async () => {
    const { pedir } = armar();
    expect((await pedir('POST', 'privada', { cookie: `__Host-sesion=${ID}` })).error).toBeInstanceOf(ForbiddenException);
    expect((await pedir('DELETE', 'privada', { cookie: `__Host-sesion=${ID}`, 'x-pedido': 'otro' })).error).toBeInstanceOf(ForbiddenException);
    expect((await pedir('POST', 'privada', { cookie: `__Host-sesion=${ID}`, 'x-pedido': 'panel' })).error).toBeNull();
    expect((await pedir('GET', 'privada', { cookie: `__Host-sesion=${ID}` })).error).toBeNull();
  });

  it('clave temporal: solo las rutas marcadas (quién soy, cerrar, cambiar la clave); las demás → 403', async () => {
    const { pedir } = armar({ usuario: { ...ANA, claveTemporal: true } });
    expect((await pedir('GET', 'privada', { cookie: `__Host-sesion=${ID}` })).error).toBeInstanceOf(ForbiddenException);
    expect((await pedir('GET', 'quienSoy', { cookie: `__Host-sesion=${ID}` })).error).toBeNull();
  });

  it('X-Clave-Admin correcta → usuario del sistema, sin X-Pedido; incorrecta → 401 aunque haya cookie; sin configurar → 503', async () => {
    const conClave = armar({ clave: CLAVE });
    const ok = await conClave.pedir('POST', 'privada', { 'x-clave-admin': CLAVE });
    expect(ok.error).toBeNull();
    expect(ok.usuario).toEqual(usuarioSistema());
    expect((await conClave.pedir('GET', 'privada', { 'x-clave-admin': CLAVE })).usuario).not.toBe(ok.usuario); // uno nuevo por petición
    expect((await conClave.pedir('GET', 'privada', { 'x-clave-admin': 'otra', cookie: `__Host-sesion=${ID}` })).error).toBeInstanceOf(UnauthorizedException);
    expect(conClave.cargar).not.toHaveBeenCalled();
    expect((await armar().pedir('GET', 'privada', { 'x-clave-admin': CLAVE })).error).toBeInstanceOf(ServiceUnavailableException);
  });

  it('qué escribe y qué cabecera vale: solo GET, HEAD y OPTIONS no escriben; «panel» exacto (sin distinguir mayúsculas), nunca repetida', () => {
    expect(['GET', 'head', 'OPTIONS'].map(escribe)).toEqual([false, false, false]);
    expect(['POST', 'PUT', 'PATCH', 'DELETE'].map(escribe)).toEqual([true, true, true, true]);
    expect(traePedidoDelPanel('Panel')).toBe(true);
    expect(traePedidoDelPanel('panel, panel')).toBe(false);
    expect(traePedidoDelPanel(undefined)).toBe(false);
  });
});

// Términos de uso (docs/20 §12; 11/11/2026): la sesión sin aceptar la versión vigente solo sirve para ver la sesión, aceptar y salir; lo demás,
// 403 con el código propio que el panel convierte en la pantalla «Términos de uso». La clave temporal va primero.
describe('GuardiaCentral: términos pendientes', () => {
  const PENDIENTE: UsuarioSesion = { ...ANA, terminosPendientes: true };
  it('una lectura → 403 terminos_pendientes, con la versión vigente', async () => {
    const { error } = await armar({ usuario: PENDIENTE }).pedir('GET', 'privada', { cookie: `__Host-sesion=${ID}` });
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({ statusCode: 403, codigo: CODIGO_TERMINOS_PENDIENTES, version: 1 });
  });
  it('aceptar y ver la sesión, 200; las páginas legales son públicas', async () => {
    expect((await armar({ usuario: PENDIENTE }).pedir('POST', 'aceptar', { cookie: `__Host-sesion=${ID}`, 'x-pedido': 'panel' })).error).toBeNull();
    expect((await armar({ usuario: PENDIENTE }).pedir('GET', 'sesion', { cookie: `__Host-sesion=${ID}` })).error).toBeNull();
    expect((await armar({ usuario: PENDIENTE }).pedir('GET', 'publica')).error).toBeNull();
  });
  it('con clave temporal y términos pendientes, la clave va primero: aceptar → 403 de la clave temporal', async () => {
    const { error } = await armar({ usuario: { ...PENDIENTE, claveTemporal: true } }).pedir('POST', 'aceptar', { cookie: `__Host-sesion=${ID}`, 'x-pedido': 'panel' });
    expect((error as ForbiddenException).message).toMatch(/clave temporal/);
  });
  it('aceptados: todo vuelve a la normalidad', async () => {
    expect((await armar({ usuario: { ...ANA, terminosPendientes: false } }).pedir('GET', 'privada', { cookie: `__Host-sesion=${ID}` })).error).toBeNull();
  });
});
