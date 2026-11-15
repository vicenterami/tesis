import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpException, HttpStatus, PayloadTooLargeException, Post,
  ServiceUnavailableException, UnauthorizedException, NotFoundException,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';

// Forma de los errores HTTP (docs/16 §70): la guía de migración 11→12 dice que el mapeo de errores de los adaptadores se rehízo
// («HTTP adapter error mapping has been reworked»). Esta prueba fija, con un servidor real, el código y el cuerpo que ve el panel
// por cada error que lanza el backend; se midió igual antes (11.2.5) y después (12.4.0) de la migración.
@Controller()
class ErroresController {
  @Get('400') e400(): never { throw new BadRequestException('mal'); }
  @Get('400-lista') e400l(): never { throw new BadRequestException({ statusCode: 400, message: ['a', 'b'], error: 'Bad Request' }); }
  @Get('401') e401(): never { throw new UnauthorizedException('no'); }
  @Get('403') e403(): never { throw new ForbiddenException('prohibido'); }
  @Get('404') e404(): never { throw new NotFoundException('nada'); }
  @Get('409') e409(): never { throw new ConflictException('choque'); }
  @Get('409-objeto') e409o(): never { throw new HttpException({ statusCode: 409, error: 'Conflict', version: 'v1', message: 'recarga' }, HttpStatus.CONFLICT); }
  @Get('413') e413(): never { throw new PayloadTooLargeException('grande'); }
  @Get('429') e429(): never { throw new HttpException('muchos', HttpStatus.TOO_MANY_REQUESTS); }
  @Get('503') e503(): never { throw new ServiceUnavailableException('caído'); }
  @Get('500') e500(): never { throw new Error('detalle interno que no debe salir'); }
  @Post('json') json(@Body() b: unknown): unknown { return b; }
}

describe('forma de los errores HTTP', () => {
  let app: NestExpressApplication;
  let base = '';
  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ controllers: [ErroresController] }).compile();
    app = modulo.createNestApplication<NestExpressApplication>({ logger: false });
    app.useBodyParser('json', { limit: 1024 });
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => { await app.close(); });

  async function comprobar(ruta: string, estado: number, cuerpo: unknown): Promise<void> {
    const r = await fetch(base + ruta);
    expect(r.status).toBe(estado);
    expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await r.json()).toEqual(cuerpo);
  }
  it('/400 → 400', () => comprobar('/400', 400, { message: 'mal', error: 'Bad Request', statusCode: 400 }));
  it('/400-lista → 400, con la lista de mensajes', () => comprobar('/400-lista', 400, { statusCode: 400, message: ['a', 'b'], error: 'Bad Request' }));
  it('/401 → 401', () => comprobar('/401', 401, { message: 'no', error: 'Unauthorized', statusCode: 401 }));
  it('/403 → 403', () => comprobar('/403', 403, { message: 'prohibido', error: 'Forbidden', statusCode: 403 }));
  it('/404 → 404', () => comprobar('/404', 404, { message: 'nada', error: 'Not Found', statusCode: 404 }));
  it('/409 → 409', () => comprobar('/409', 409, { message: 'choque', error: 'Conflict', statusCode: 409 }));
  it('/409-objeto → 409, con el objeto tal cual', () => comprobar('/409-objeto', 409, { statusCode: 409, error: 'Conflict', version: 'v1', message: 'recarga' }));
  it('/413 → 413', () => comprobar('/413', 413, { message: 'grande', error: 'Payload Too Large', statusCode: 413 }));
  it('/429 → 429, sin «error» (HttpException con texto)', () => comprobar('/429', 429, { statusCode: 429, message: 'muchos' }));
  it('/503 → 503', () => comprobar('/503', 503, { message: 'caído', error: 'Service Unavailable', statusCode: 503 }));
  it('/500 → 500 sin el detalle del Error', () => comprobar('/500', 500, { statusCode: 500, message: 'Internal server error' }));
  it('ruta inexistente → 404 en JSON', () => comprobar('/no-existe', 404, { message: 'Cannot GET /no-existe', error: 'Not Found', statusCode: 404 }));

  it('cuerpo JSON de más del tope del lector → 413 en JSON', async () => {
    const r = await fetch(`${base}/json`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(2000) }) });
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ statusCode: 413, message: 'request entity too large' });
  });
  it('JSON ilegible → 400 en JSON con error «Bad Request»', async () => {
    const r = await fetch(`${base}/json`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{mal' });
    expect(r.status).toBe(400);
    const c = (await r.json()) as { error: string; statusCode: number };
    expect([c.error, c.statusCode]).toEqual(['Bad Request', 400]);
  });
});
