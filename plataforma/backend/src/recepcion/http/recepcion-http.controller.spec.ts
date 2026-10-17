import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { CredencialHttp, RecepcionService, ResumenTrama } from '../recepcion.service';
import { RecepcionHttpController } from './recepcion-http.controller';
import type { ResultadoVerificacion, VerificacionDeTokens } from './verificacion';

// El controlador de la vía HTTP: el orden de comprobaciones del punto 52 y la traducción del resultado a un código; la tubería y la
// verificación son de mentira (la verificación real se prueba en verificacion.spec.ts).
describe('RecepcionHttpController', () => {
  const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';
  const SECRETO = 'secreto-de-prueba-de-treinta-y-dos-c';
  const resumen = (r: Partial<ResumenTrama>): ResumenTrama => ({ guardadas: 0, duplicadas: 0, rechazos: [], malformada: null, repetida: false, ...r });
  const fila = (id = 'd1'): CredencialHttp => ({ id, via: 'http', estado: 'activo', hash: 'huella' });

  function armar(verifica: ResultadoVerificacion, procesa: ResumenTrama | null = resumen({ guardadas: 1 }), secreto?: string) {
    const recepcion = {
      credencialHttp: jest.fn((idFisico: string) => Promise.resolve(fila(`d-${idFisico}`))),
      procesarHttp: jest.fn(() => Promise.resolve(procesa)),
    };
    const verificacion = { enCache: jest.fn(() => false), pista: jest.fn(() => false), verificar: jest.fn(() => Promise.resolve(verifica)) };
    const config = { get: () => secreto } as unknown as ConfigService;
    const c = new RecepcionHttpController(recepcion as unknown as RecepcionService, verificacion as unknown as VerificacionDeTokens, config);
    return { c, recepcion, verificacion };
  }
  function pedir(c: RecepcionHttpController, cabeceras: Record<string, string> = {}, ip = '203.0.113.1', id = 'nodo-01') {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), setHeader: jest.fn() };
    const req = { socket: { remoteAddress: ip }, body: Buffer.from('[{"n":"temperatura","v":21}]'),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...cabeceras } } as unknown as Request;
    return c.recibir(id, undefined, req, res as unknown as Response).then(() => res);
  }

  it('token verificado y una lectura guardada → 202 con el resumen', async () => {
    const { c, verificacion } = armar('ok');
    const res = await pedir(c);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ guardadas: 1, repetidas: 0, rechazos: [] });
    expect(verificacion.verificar).toHaveBeenCalledTimes(1);
    expect(verificacion.verificar).toHaveBeenCalledWith(expect.objectContaining({ id: 'd-nodo-01' }), TOKEN, 'nodo-01'); // con el identificador, para la pista
  });
  it('token ausente, con otra forma o un id imposible → 401 sin consultar la base; el mismo 401 si la verificación dice que no', async () => {
    for (const [cab, id] of [[{ authorization: '' }, 'nodo-01'], [{ authorization: 'Bearer corto' }, 'nodo-01'], [{}, 'NODO_01']] as const) {
      const { c, recepcion } = armar('ok');
      const res = await pedir(c, cab, '203.0.113.1', id);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(recepcion.credencialHttp).not.toHaveBeenCalled();
    }
    const { c, recepcion } = armar('no');
    const res = await pedir(c);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
    expect(recepcion.procesarHttp).not.toHaveBeenCalled();
  });
  it('un token sin forma o un id imposible dan 401 pero no cuentan para los bloqueos: 60 peticiones sin cabecera no bloquean el par ni la dirección', async () => {
    const { c, verificacion } = armar('ok');
    for (let i = 0; i < 60; i++) expect((await pedir(c, { authorization: '' })).status).toHaveBeenCalledWith(401);
    expect((await pedir(c)).status).toHaveBeenCalledWith(202);
    expect(verificacion.verificar).toHaveBeenCalledTimes(1);
  });
  it('el esquema Bearer no distingue mayúsculas (RFC 9110): «bearer» también entra', async () => {
    const { c } = armar('ok');
    expect((await pedir(c, { authorization: `bearer ${TOKEN}` })).status).toHaveBeenCalledWith(202);
  });
  it('el tipo de contenido se revisa antes que el token: 415', async () => {
    const { c, recepcion } = armar('ok');
    const res = await pedir(c, { 'content-type': 'application/xml' });
    expect(res.status).toHaveBeenCalledWith(415);
    expect(recepcion.credencialHttp).not.toHaveBeenCalled();
  });
  it('malformada o sin ninguna lectura útil → 422; solo repetida → 202', async () => {
    for (const [r, cod] of [[resumen({ malformada: 'no es JSON' }), 422], [resumen({ rechazos: ['temperatura: fuera de rango'] }), 422],
      [resumen({ repetida: true }), 202]] as const) {
      const { c } = armar('ok', r);
      expect((await pedir(c)).status).toHaveBeenCalledWith(cod);
    }
  });
  it('(a) con el token en caché no hay verificación, ni cupo, ni bloqueo por dirección que valga', async () => {
    const { c, verificacion } = armar('no');
    verificacion.enCache.mockReturnValue(true);
    expect((await pedir(c)).status).toHaveBeenCalledWith(202);
    expect(verificacion.verificar).not.toHaveBeenCalled();
  });
  it('(b) 5 fallos de un dispositivo desde una dirección bloquean ese par 60 s, incluso con el token bueno; el vecino detrás de la misma dirección y el mismo dispositivo desde otra siguen entrando', async () => {
    const { c, verificacion } = armar('no');
    for (let i = 0; i < 5; i++) expect((await pedir(c)).status).toHaveBeenCalledWith(401);
    verificacion.verificar.mockResolvedValue('ok');
    const bloqueada = await pedir(c);
    expect(bloqueada.status).toHaveBeenCalledWith(429);
    expect(bloqueada.setHeader).toHaveBeenCalledWith('Retry-After', '60');
    expect((await pedir(c, {}, '203.0.113.1', 'nodo-02')).status).toHaveBeenCalledWith(202); // vecino tras el mismo NAT
    expect((await pedir(c, {}, '203.0.113.2', 'nodo-01')).status).toHaveBeenCalledWith(202); // el mismo id, desde otra dirección
  });
  it('(c) 50 fallos desde una dirección, con cualquier identificador, bloquean sus verificaciones 60 s; lo ya bloqueado no suma; el token en caché pasa igual', async () => {
    const { c, verificacion, recepcion } = armar('no');
    // 10 identificadores × 5 fallos = 50 fallos contados; los intentos de más sobre un par ya bloqueado no cuentan.
    for (let n = 1; n <= 9; n++) for (let i = 0; i < 7; i++) await pedir(c, {}, '203.0.113.1', `nodo-${n}`);
    expect(verificacion.verificar).toHaveBeenCalledTimes(45);
    verificacion.verificar.mockResolvedValue('ok');
    expect((await pedir(c, {}, '203.0.113.1', 'nodo-10')).status).toHaveBeenCalledWith(202); // 45 fallos: todavía no
    verificacion.verificar.mockResolvedValue('no');
    for (let i = 0; i < 5; i++) await pedir(c, {}, '203.0.113.1', 'nodo-11'); // llega a 50
    verificacion.verificar.mockResolvedValue('ok');
    const bloqueada = await pedir(c, {}, '203.0.113.1', 'nodo-12');
    expect(bloqueada.status).toHaveBeenCalledWith(429);
    expect(bloqueada.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('desde esta dirección') }));
    expect((await pedir(c, {}, '203.0.113.2', 'nodo-12')).status).toHaveBeenCalledWith(202); // otra dirección
    // Dirección bloqueada: sin la pista del identificador no se consulta la base; con la pista, se consulta y la caché decide.
    const consultas = recepcion.credencialHttp.mock.calls.length;
    expect((await pedir(c, {}, '203.0.113.1', 'nodo-13')).status).toHaveBeenCalledWith(429);
    expect(recepcion.credencialHttp).toHaveBeenCalledTimes(consultas);
    verificacion.pista.mockReturnValue(true);
    verificacion.enCache.mockReturnValue(true);
    expect((await pedir(c, {}, '203.0.113.1', 'nodo-13')).status).toHaveBeenCalledWith(202); // en caché: no cuesta, no se bloquea
    expect(recepcion.credencialHttp).toHaveBeenCalledTimes(consultas + 1);
  });
  it('(e) dos tramas del mismo dispositivo en el mismo segundo → la segunda 429', async () => {
    const { c } = armar('ok');
    expect((await pedir(c)).status).toHaveBeenCalledWith(202);
    expect((await pedir(c)).status).toHaveBeenCalledWith(429);
  });
  it('(d) verificación saturada → 503 con Retry-After 1, sin contar como fallo', async () => {
    const { c, verificacion } = armar('saturado');
    for (let i = 0; i < 6; i++) {
      const res = await pedir(c);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '1');
    }
    verificacion.verificar.mockResolvedValue('ok');
    expect((await pedir(c)).status).toHaveBeenCalledWith(202); // seis 503 no bloquearon el par
  });
  it('la dirección del cliente sale de X-Forwarded-For solo con el secreto del proxy', async () => {
    const { c } = armar('no', null, SECRETO);
    const avisos = jest.spyOn((c as unknown as { log: { warn: (m: string) => void } }).log, 'warn').mockImplementation(() => undefined);
    await pedir(c, { 'x-forwarded-for': '198.51.100.7', 'x-proxy-secreto': SECRETO });
    await pedir(c, { 'x-forwarded-for': '198.51.100.8' }); // sin el secreto: la del socket
    const mensajes = avisos.mock.calls.map(([m]) => m);
    expect(mensajes.some((m) => m.includes('401 desde 198.51.100.7'))).toBe(true);
    expect(mensajes.some((m) => m.includes('401 desde 198.51.100.8'))).toBe(false);
    expect(mensajes.some((m) => m.includes('401 desde 203.0.113.1'))).toBe(true);
  });
  it('con el secreto configurado, una X-Forwarded-For que llega sin él se anota (acotado); con él, no', async () => {
    const { c } = armar('ok', null, SECRETO);
    const avisos = jest.spyOn((c as unknown as { log: { warn: (m: string) => void } }).log, 'warn').mockImplementation(() => undefined);
    await pedir(c, { 'x-forwarded-for': '198.51.100.7' });
    await pedir(c, { 'x-forwarded-for': '198.51.100.8', 'x-proxy-secreto': SECRETO }, '203.0.113.1', 'nodo-02');
    const sinSecreto = avisos.mock.calls.map(([m]) => m).filter((m) => m.includes('X-Forwarded-For sin el secreto'));
    expect(sinSecreto).toHaveLength(1);
  });
  it('un id con un salto de línea no llega crudo al registro', async () => {
    const { c } = armar('no');
    const avisos = jest.spyOn((c as unknown as { log: { warn: (m: string) => void } }).log, 'warn').mockImplementation(() => undefined);
    await pedir(c, { authorization: '' }, '203.0.113.9', 'nodo-01\nFALSO linea forjada');
    expect(avisos).toHaveBeenCalled();
    expect(avisos.mock.calls.every(([m]) => !m.includes('\n'))).toBe(true);
  });
  it('dado de baja entre la autenticación y la tubería → 401', async () => {
    const { c } = armar('ok', null);
    expect((await pedir(c)).status).toHaveBeenCalledWith(401);
  });
  it('sin PROXY_SECRETO el arranque avisa; con uno corto, el controlador no se construye (como las demás claves)', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      armar('ok');
      expect(warn.mock.calls.some(([m]) => String(m).includes('PROXY_SECRETO no definido'))).toBe(true);
      warn.mockClear();
      armar('ok', null, SECRETO);
      expect(warn).not.toHaveBeenCalled();
      expect(() => armar('ok', null, 'corto')).toThrow(/PROXY_SECRETO/);
    } finally {
      warn.mockRestore();
    }
  });
});
