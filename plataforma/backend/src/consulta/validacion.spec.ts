import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CanalesController } from './canales.controller.js';
import type { ConsultaService } from './consulta.service.js';
import type { AlcanceService } from '../sesion/alcance.service.js';
import { usuarioSistema } from '../sesion/permisos.js';
import { MAX_CUBOS, cubos, exigirTopeCubos, fecha, intervalo, limite, uuid } from './validacion.js';

// Toda entrada del cliente es hostil (docs/11 §3). Un parámetro repetido llega como arreglo: debe dar 400, nunca 500.
describe('validacion: parámetros de consulta', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  it('uuid: válido en minúsculas; mayúsculas se normalizan; inválido, vacío o repetido → 400', () => {
    expect(uuid(ID)).toBe(ID);
    expect(uuid(ID.toUpperCase())).toBe(ID);
    for (const v of ['dev-0001', '', undefined, [ID], { a: 1 }]) expect(() => uuid(v)).toThrow(BadRequestException);
  });
  it('limite: por defecto 50; 1–500; fuera de rango, decimal, texto o repetido → 400', () => {
    expect(limite(undefined)).toBe(50);
    expect(limite('500')).toBe(500);
    for (const v of ['0', '501', '2.5', 'x', ['5']]) expect(() => limite(v)).toThrow(BadRequestException);
  });
  it('intervalo: lista cerrada; repetido → 400', () => {
    expect(intervalo(undefined)).toBe('15 minutes');
    expect(intervalo('1 day')).toBe('1 day');
    for (const v of ['1 year', ['1 hour']]) expect(() => intervalo(v)).toThrow(BadRequestException);
  });
  it('fecha: ISO; ausente → por defecto; ilegible o repetida → 400', () => {
    const d = new Date('2026-10-12T00:00:00Z');
    expect(fecha(undefined, d, 'desde')).toBe(d);
    expect(fecha('2026-10-12T15:00:00Z', d, 'desde').toISOString()).toBe('2026-10-12T15:00:00.000Z');
    for (const v of ['ayer', ['2026-10-12']]) expect(() => fecha(v, d, 'desde')).toThrow(BadRequestException);
    // un día que no existe: JavaScript lo correría al 2 de marzo sin avisar; la validación de ida y vuelta lo rechaza (22/10)
    expect(() => fecha('2026-02-30T12:00:00Z', d, 'desde')).toThrow(/no existe/);
    expect(fecha('2028-02-29T00:00:00Z', d, 'desde').toISOString()).toBe('2028-02-29T00:00:00.000Z'); // bisiesto real: pasa
    for (const v of ['2026/02/30', 'Feb 30 2026', '2026-01-01T24:00:00Z', '+010000-01-01T00:00:00Z']) expect(() => fecha(v, d, 'desde')).toThrow(BadRequestException); // formas que JavaScript entiende y corre
  });
  // docs/19 §4, incremento 2, punto 4: más de 5 000 cubos (ventana ÷ intervalo) → 400 antes de consultar.
  it('tope de cubos: 30 días cada hora (720) y 24 h cada minuto (1 440) pasan; 7 días cada minuto (10 080) → 400', () => {
    const hasta = new Date('2026-10-22T12:00:00Z');
    const atras = (dias: number): Date => new Date(hasta.getTime() - dias * 86_400_000);
    expect(cubos(atras(30), hasta, '1 hour')).toBe(720);
    expect(cubos(atras(1), hasta, '1 minute')).toBe(1440);
    expect(cubos(hasta, atras(1), '1 minute')).toBe(0); // ventana invertida: cero cubos, la consulta devuelve vacío
    expect(() => exigirTopeCubos(atras(30), hasta, '1 hour')).not.toThrow();
    expect(() => exigirTopeCubos(atras(7), hasta, '1 minute')).toThrow(/10080 cubos.*máximo es 5000/);
    // el borde: exactamente 5 000 pasa; uno más, no
    expect(() => exigirTopeCubos(new Date(hasta.getTime() - MAX_CUBOS * 60_000), hasta, '1 minute')).not.toThrow();
    expect(() => exigirTopeCubos(new Date(hasta.getTime() - (MAX_CUBOS + 1) * 60_000), hasta, '1 minute')).toThrow(BadRequestException);
    // y la ventana máxima (revisión del 22/10): 366 días a un cubo por día pasan el tope de cubos pero no el de ventana
    expect(() => exigirTopeCubos(atras(366), hasta, '1 day')).not.toThrow();
    expect(() => exigirTopeCubos(atras(367), hasta, '1 day')).toThrow(/367 días.*máximo es 366/);
  });
  it('GET /canales/{id}/historico rechaza la ventana excesiva sin llamar a la consulta; si pasa, exige el sitio del canal (docs/20 §6)', async () => {
    const historico = vi.fn();
    const exigirCanal = vi.fn(() => Promise.resolve());
    const c = new CanalesController({ historico } as unknown as ConsultaService, { exigirCanal } as unknown as AlcanceService);
    const ID = '11111111-1111-4111-8111-111111111111';
    await expect(c.historico(usuarioSistema(), ID, '2026-01-01T00:00:00Z', '2026-10-01T00:00:00Z', '1 minute')).rejects.toThrow(BadRequestException);
    expect(historico).not.toHaveBeenCalled();
    expect(exigirCanal).not.toHaveBeenCalled();
    await c.historico(usuarioSistema(), ID, '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', '1 hour');
    expect(exigirCanal).toHaveBeenCalledWith(usuarioSistema(), 'leer', ID);
    expect(historico).toHaveBeenCalledTimes(1);
  });
});
