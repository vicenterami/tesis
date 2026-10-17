import type { Request, Response } from 'express';
import type { RecepcionService, ResumenTrama } from '../recepcion.service';
import { RecepcionHttpController } from './recepcion-http.controller';

// El controlador de la vía HTTP traduce el resultado de la tubería a un código (docs/10 §8.4 punto 52); la tubería es de mentira.
describe('RecepcionHttpController', () => {
  const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';
  const resumen = (r: Partial<ResumenTrama>): ResumenTrama => ({ guardadas: 0, duplicadas: 0, rechazos: [], malformada: null, repetida: false, ...r });

  function armar(autentica: string | null, procesa: ResumenTrama | null = resumen({ guardadas: 1 })) {
    const recepcion = { autenticarHttp: jest.fn(() => Promise.resolve(autentica)), procesarHttp: jest.fn(() => Promise.resolve(procesa)) };
    return { c: new RecepcionHttpController(recepcion as unknown as RecepcionService), recepcion };
  }
  function pedir(c: RecepcionHttpController, cabeceras: Record<string, string> = {}, ip = '203.0.113.1', id = 'nodo-01') {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), setHeader: jest.fn() };
    const req = { ip, body: Buffer.from('[{"n":"temperatura","v":21}]'),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...cabeceras } } as unknown as Request;
    return c.recibir(id, undefined, req, res as unknown as Response).then(() => res);
  }

  it('autenticada y con una lectura guardada → 202 con el resumen', async () => {
    const { c } = armar('d1');
    const res = await pedir(c);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ guardadas: 1, repetidas: 0, rechazos: [] });
  });
  it('token ausente, con otra forma o un id imposible → 401 sin consultar la base; el mismo 401 si la base dice que no', async () => {
    for (const [cab, id] of [[{ authorization: '' }, 'nodo-01'], [{ authorization: 'Bearer corto' }, 'nodo-01'], [{}, 'NODO_01']] as const) {
      const { c, recepcion } = armar('d1');
      const res = await pedir(c, cab, '203.0.113.1', id);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(recepcion.autenticarHttp).not.toHaveBeenCalled();
    }
    const { c, recepcion } = armar(null);
    const res = await pedir(c);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
    expect(recepcion.procesarHttp).not.toHaveBeenCalled();
  });
  it('el tipo de contenido se revisa antes que el token: 415', async () => {
    const { c, recepcion } = armar('d1');
    const res = await pedir(c, { 'content-type': 'application/xml' });
    expect(res.status).toHaveBeenCalledWith(415);
    expect(recepcion.autenticarHttp).not.toHaveBeenCalled();
  });
  it('malformada o sin ninguna lectura útil → 422; solo repetida → 202', async () => {
    for (const [r, cod] of [[resumen({ malformada: 'no es JSON' }), 422], [resumen({ rechazos: ['temperatura: fuera de rango'] }), 422],
      [resumen({ repetida: true }), 202]] as const) {
      const { c } = armar('d1', r);
      expect((await pedir(c)).status).toHaveBeenCalledWith(cod);
    }
  });
  it('5 fallos desde una dirección la bloquean, incluso con el token bueno; otra dirección sigue entrando', async () => {
    const { c, recepcion } = armar(null);
    for (let i = 0; i < 5; i++) await pedir(c);
    recepcion.autenticarHttp.mockResolvedValue('d1');
    const bloqueada = await pedir(c);
    expect(bloqueada.status).toHaveBeenCalledWith(429);
    expect(bloqueada.setHeader).toHaveBeenCalledWith('Retry-After', '60');
    expect((await pedir(c, {}, '203.0.113.2')).status).toHaveBeenCalledWith(202);
  });
  it('dos tramas del mismo dispositivo en el mismo segundo → la segunda 429', async () => {
    const { c } = armar('d1');
    expect((await pedir(c)).status).toHaveBeenCalledWith(202);
    expect((await pedir(c)).status).toHaveBeenCalledWith(429);
  });
  it('con 2 verificaciones en curso, la tercera → 503 con Retry-After 1, sin verificar; al terminar, el cupo se libera', async () => {
    const { c, recepcion } = armar('d1');
    let soltar!: () => void;
    const pendiente = new Promise<string>((r) => (soltar = () => r('d1')));
    recepcion.autenticarHttp.mockReturnValueOnce(pendiente).mockReturnValueOnce(pendiente);
    const dos = [pedir(c, {}, '203.0.113.1', 'nodo-01'), pedir(c, {}, '203.0.113.1', 'nodo-02')];
    const tercera = await pedir(c, {}, '203.0.113.1', 'nodo-03');
    expect(tercera.status).toHaveBeenCalledWith(503);
    expect(tercera.setHeader).toHaveBeenCalledWith('Retry-After', '1');
    expect(recepcion.autenticarHttp).toHaveBeenCalledTimes(2);
    soltar();
    await Promise.all(dos);
    recepcion.autenticarHttp.mockResolvedValueOnce('d4'); // otro dispositivo: d1 ya mandó en este segundo (ritmo)
    expect((await pedir(c, {}, '203.0.113.1', 'nodo-04')).status).toHaveBeenCalledWith(202);
  });
  it('si la verificación lanza (la base no responde), el cupo se libera igual', async () => {
    const { c, recepcion } = armar('d1');
    recepcion.autenticarHttp.mockRejectedValueOnce(new Error('tiempo agotado')).mockRejectedValueOnce(new Error('tiempo agotado'));
    await expect(pedir(c, {}, '203.0.113.1', 'nodo-01')).rejects.toThrow();
    await expect(pedir(c, {}, '203.0.113.1', 'nodo-02')).rejects.toThrow();
    expect((await pedir(c, {}, '203.0.113.1', 'nodo-03')).status).toHaveBeenCalledWith(202);
  });
  it('un id con un salto de línea no llega crudo al registro', async () => {
    const { c } = armar(null);
    const avisos = jest.spyOn((c as unknown as { log: { warn: (m: string) => void } }).log, 'warn').mockImplementation(() => undefined);
    await pedir(c, { authorization: '' }, '203.0.113.9', 'nodo-01\nFALSO linea forjada');
    expect(avisos).toHaveBeenCalled();
    expect(avisos.mock.calls.every(([m]) => !m.includes('\n'))).toBe(true);
  });
  it('dado de baja entre la autenticación y la tubería → 401', async () => {
    const { c } = armar('d1', null);
    expect((await pedir(c)).status).toHaveBeenCalledWith(401);
  });
});
