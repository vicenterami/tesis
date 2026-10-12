import { BadRequestException } from '@nestjs/common';
import { fecha, intervalo, limite, uuid } from './validacion';

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
  });
});
