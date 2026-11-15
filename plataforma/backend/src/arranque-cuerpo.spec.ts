import { afterEach, describe, expect, it } from 'vitest';
import { Body, Controller, Post, Put } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { MENSAJE_SIN_SESION_LOTE, MENSAJE_TOPE_CUERPO, MENSAJE_TOPE_LOTE, TOPE_CUERPO_LOTE, errorDeLectorJson, filtroAntesDeLeer, opcionesLectorJson } from './arranque.js';
import { MENSAJE_SIN_SESION } from './sesion/sesion.service.js';

// El lector de JSON de main.ts con un servidor real (docs/16 §70). Desde NestJS 12 el tipo de las opciones de `useBodyParser` excluye
// `verify`; main.ts lo pasa igual. Este banco monta LAS MISMAS opciones y el MISMO manejador de errores que main.ts (los dos salen de
// arranque.ts) y comprueba los dos topes: 100 KiB fuera del alta por lote, aunque el cuerpo llegue por trozos y sin largo declarado, y
// TOPE_CUERPO_LOTE en el lote (el peor caso medido de 500 filas llenas, alta/lote.ts; 512 KiB hasta el 15/11/2026), justo en el borde; y
// que el 413 responde en JSON con su motivo. Si NestJS dejara de pasar `verify`, o alguien lo quitara de
// arranque.ts, el segundo caso respondería 201.
@Controller()
class EcoController {
  @Post('eco')
  eco(@Body() cuerpo: unknown): unknown {
    return { ok: true, tipo: typeof cuerpo };
  }
  @Post('dispositivos/lote')
  lote(@Body() cuerpo: unknown): unknown {
    return { ok: true, tipo: typeof cuerpo };
  }
  @Put('dispositivos/lote')
  otroMetodo(@Body() cuerpo: unknown): unknown {
    return { ok: true, tipo: typeof cuerpo };
  }
}

let app: NestExpressApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function servidor(): Promise<string> {
  const modulo = await Test.createTestingModule({ controllers: [EcoController] }).compile();
  app = modulo.createNestApplication<NestExpressApplication>();
  app.use(filtroAntesDeLeer);
  app.useBodyParser('json', opcionesLectorJson());
  app.use(errorDeLectorJson);
  await app.listen(0, '127.0.0.1');
  return `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
}

// Un cuerpo JSON de `bytes` bytes enviado por trozos, sin Content-Length.
function porTrozos(bytes: number): ReadableStream<Uint8Array> {
  const texto = JSON.stringify({ x: 'a'.repeat(bytes - 8) });
  const datos = new TextEncoder().encode(texto);
  return new ReadableStream({
    start(c) {
      for (let i = 0; i < datos.length; i += 16 * 1024) c.enqueue(datos.subarray(i, i + 16 * 1024));
      c.close();
    },
  });
}
// Con la forma de una cookie de sesión (el filtro no la valida: eso es del guardia) salvo que se pida sin ella.
const COOKIE = `__Host-sesion=${'a'.repeat(43)}`;
const enviar = (url: string, bytes: number, o: { metodo?: string; cookie?: string | null } = {}): Promise<Response> =>
  fetch(url, {
    method: o.metodo ?? 'POST', body: porTrozos(bytes), duplex: 'half',
    headers: { 'content-type': 'application/json', ...(o.cookie === null ? {} : { cookie: o.cookie ?? COOKIE }) },
  } as RequestInit);

describe('lector de JSON de main.ts: los topes del cuerpo rigen con NestJS 12', () => {
  it('cuerpo chico por trozos → 201', async () => {
    const base = await servidor();
    expect((await enviar(`${base}/eco`, 1024)).status).toBe(201);
  });
  it('fuera del lote, 150 KiB por trozos (sin largo declarado) → 413 en JSON con su motivo', async () => {
    const base = await servidor();
    const r = await enviar(`${base}/eco`, 150 * 1024);
    expect(r.status).toBe(413);
    expect(r.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await r.json()).toEqual({ statusCode: 413, message: MENSAJE_TOPE_CUERPO });
  });
  it('en el alta por lote, 150 KiB por trozos entran (con y sin parámetros en la URL)', async () => {
    const base = await servidor();
    expect((await enviar(`${base}/dispositivos/lote`, 150 * 1024)).status).toBe(201);
    expect((await enviar(`${base}/dispositivos/lote?modo=validar`, 150 * 1024)).status).toBe(201);
  });
  it('en el alta por lote, el tope justo entra (600 KiB, que antes eran 413, también) y un byte más → 413 en JSON con el motivo del lote', async () => {
    const base = await servidor();
    expect((await enviar(`${base}/dispositivos/lote`, 600 * 1024)).status).toBe(201);
    expect((await enviar(`${base}/dispositivos/lote`, TOPE_CUERPO_LOTE)).status).toBe(201);
    const r = await enviar(`${base}/dispositivos/lote`, TOPE_CUERPO_LOTE + 1);
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ statusCode: 413, message: MENSAJE_TOPE_LOTE });
  });
  it('el tope grande es solo de POST: PUT al lote con 150 KiB por trozos → 413 (el de 100 KiB)', async () => {
    const base = await servidor();
    const r = await enviar(`${base}/dispositivos/lote`, 150 * 1024, { metodo: 'PUT' });
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ statusCode: 413, message: MENSAJE_TOPE_CUERPO });
  });
  it('sin la forma de una sesión (ni cookie ni X-Clave-Admin), POST al lote → 401 antes de leer el cuerpo, con el mensaje del guardia', async () => {
    const base = await servidor();
    for (const cookie of [null, '__Host-sesion=corta', 'otra=1']) {
      const r = await enviar(`${base}/dispositivos/lote`, TOPE_CUERPO_LOTE, { cookie });
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ statusCode: 401, message: MENSAJE_SIN_SESION });
    }
    expect(MENSAJE_SIN_SESION_LOTE).toBe(MENSAJE_SIN_SESION);
    const conClave = await fetch(`${base}/dispositivos/lote`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-clave-admin': 'x' }, body: '{}' });
    expect(conClave.status).toBe(201); // la clave la valida el guardia, no este filtro
  });
});
