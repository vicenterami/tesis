import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { direccionDelCliente } from './direccion.js';

// La dirección del cliente detrás del proxy (docs/10 §8.4 punto 52): X-Forwarded-For solo con el secreto compartido.
describe('direccionDelCliente', () => {
  const SECRETO = 'secreto-de-prueba-de-treinta-y-dos-c';
  const req = (headers: Record<string, string>, remoteAddress = '203.0.113.1'): Request =>
    ({ headers, socket: { remoteAddress } }) as unknown as Request;

  it('sin secreto configurado → la del socket, aunque venga X-Forwarded-For, y sin marcar nada (ya se avisó al arrancar)', () => {
    expect(direccionDelCliente(req({ 'x-forwarded-for': '198.51.100.7', 'x-proxy-secreto': SECRETO }), undefined))
      .toEqual({ direccion: '203.0.113.1', forwardedIgnorado: false });
  });
  it('con el secreto correcto → la primera dirección de X-Forwarded-For; sin X-Forwarded-For → la del socket', () => {
    expect(direccionDelCliente(req({ 'x-forwarded-for': '198.51.100.7', 'x-proxy-secreto': SECRETO }), SECRETO)).toEqual({ direccion: '198.51.100.7', forwardedIgnorado: false });
    expect(direccionDelCliente(req({ 'x-forwarded-for': ' 198.51.100.7 , 203.0.113.9', 'x-proxy-secreto': SECRETO }), SECRETO).direccion).toBe('198.51.100.7');
    expect(direccionDelCliente(req({ 'x-proxy-secreto': SECRETO }), SECRETO)).toEqual({ direccion: '203.0.113.1', forwardedIgnorado: false });
    expect(direccionDelCliente(req({ 'x-forwarded-for': '', 'x-proxy-secreto': SECRETO }), SECRETO)).toEqual({ direccion: '203.0.113.1', forwardedIgnorado: false });
  });
  it('secreto distinto, de otro largo o ausente → la del socket, sin lanzar, y X-Forwarded-For queda marcada como ignorada', () => {
    for (const presentado of ['otro-secreto-de-treinta-y-dos-cara', 'corto', '']) {
      expect(direccionDelCliente(req({ 'x-forwarded-for': '198.51.100.7', 'x-proxy-secreto': presentado }), SECRETO)).toEqual({ direccion: '203.0.113.1', forwardedIgnorado: true });
    }
    expect(direccionDelCliente(req({ 'x-forwarded-for': '198.51.100.7' }), SECRETO)).toEqual({ direccion: '203.0.113.1', forwardedIgnorado: true });
    expect(direccionDelCliente(req({}), SECRETO)).toEqual({ direccion: '203.0.113.1', forwardedIgnorado: false }); // sin X-Forwarded-For no hay nada que ignorar
  });
  it('sin dirección de socket (una petición de mentira) → «desconocida», nunca una cadena vacía', () => {
    expect(direccionDelCliente({ headers: {}, socket: {} } as unknown as Request, undefined).direccion).toBe('desconocida');
  });
});
