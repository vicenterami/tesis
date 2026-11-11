import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { validarCambioDispositivo, validarReglas } from './configuracion.dto.js';
import { traducirFecha } from './configuracion.service.js';

// Validación de P6 en el servidor (docs/19 §4, E): 400 con la lista {campo, motivo}, en los dos sentidos.
const MARCA = '2026-11-11T12:00:00.123456Z';
const TEMP = { rango_min: -40, rango_max: 85 };
function errores(f: () => unknown): { campo: string; motivo: string }[] {
  try {
    f();
  } catch (e) {
    if (e instanceof BadRequestException) return (e.getResponse() as { errores: { campo: string; motivo: string }[] }).errores;
    throw e;
  }
  return [];
}

describe('validarReglas', () => {
  it('una regla buena pasa, con histéresis y retardo por defecto en 0; la lista vacía quita todas', () => {
    expect(validarReglas({ actualizado_en: MARCA, reglas: [{ umbral_alto: 30 }] }, TEMP)).toEqual({ actualizado_en: MARCA, etiqueta: null, reglas: [{ umbral_alto: 30, umbral_bajo: null, histeresis: 0, retardo_s: 0 }] });
    expect(validarReglas({ actualizado_en: MARCA, reglas: [] }, TEMP).reglas).toEqual([]);
    expect(validarReglas({ actualizado_en: MARCA, etiqueta: 'sala', reglas: [{ umbral_alto: 30, umbral_bajo: 5, histeresis: 12, retardo_s: 86400 }] }, TEMP).reglas[0]?.retardo_s).toBe(86400);
  });
  it('bajo < alto; histéresis menor que la mitad de la banda; dentro del rango físico; retardo 0..86400; al menos un umbral', () => {
    expect(errores(() => validarReglas({ actualizado_en: MARCA, reglas: [{ umbral_alto: 10, umbral_bajo: 20 }] }, TEMP))).toEqual([{ campo: 'reglas[0].umbral_bajo', motivo: 'debe ser menor que umbral_alto' }]);
    expect(errores(() => validarReglas({ actualizado_en: MARCA, reglas: [{ umbral_alto: 30, umbral_bajo: 10, histeresis: 10 }] }, TEMP))[0]?.campo).toBe('reglas[0].histeresis');
    expect(errores(() => validarReglas({ actualizado_en: MARCA, reglas: [{ umbral_alto: 90 }] }, TEMP))[0]?.motivo).toMatch(/rango físico/);
    expect(errores(() => validarReglas({ actualizado_en: MARCA, reglas: [{ umbral_alto: 30, retardo_s: 86401 }] }, TEMP))[0]?.campo).toBe('reglas[0].retardo_s');
    expect(errores(() => validarReglas({ actualizado_en: MARCA, reglas: [{ umbral_alto: 30, retardo_s: 1.5 }] }, TEMP))[0]?.campo).toBe('reglas[0].retardo_s');
    expect(errores(() => validarReglas({ actualizado_en: MARCA, reglas: [{ histeresis: 1 }] }, TEMP))[0]?.motivo).toMatch(/al menos umbral_alto o umbral_bajo/);
  });
  it('sin actualizado_en, o con campos de más: 400 que los nombra', () => {
    const e = errores(() => validarReglas({ reglas: [], prioridad: 1 }, TEMP)).map((x) => x.campo);
    expect(e).toEqual(['actualizado_en', 'prioridad']);
  });
});

describe('validarCambioDispositivo', () => {
  it('cambia solo lo que viene; la baja no es un estado configurable; nada que cambiar es 400', () => {
    expect(validarCambioDispositivo({ actualizado_en: MARCA, estado: 'mantenimiento', nombre: ' Sala ' })).toEqual({ actualizado_en: MARCA, estado: 'mantenimiento', nombre: 'Sala' });
    expect(errores(() => validarCambioDispositivo({ actualizado_en: MARCA, estado: 'baja' }))[0]?.campo).toBe('estado');
    expect(errores(() => validarCambioDispositivo({ actualizado_en: MARCA }))[0]?.motivo).toMatch(/nada que cambiar/);
    expect(errores(() => validarCambioDispositivo({ actualizado_en: MARCA, intervalo_esperado_s: 4 }))[0]?.campo).toBe('intervalo_esperado_s');
  });
});

// Un día que no existe en `actualizado_en` era 500 (la base respondía 22008): ahora 400 antes de tocar la base, y si algo pasara igual,
// la transacción traduce 22007/22008/22P02 a 400 como el resto de las escrituras.
describe('actualizado_en con un día inexistente', () => {
  it('2026-02-30 y 2026-13-01 → 400 en las dos rutas; 2028-02-29 (bisiesto) pasa', () => {
    for (const malo of ['2026-02-30T12:00:00.123456Z', '2026-13-01T00:00:00Z', '2026-04-31T00:00:00Z']) {
      expect(errores(() => validarCambioDispositivo({ actualizado_en: malo, nombre: 'x' }))[0]?.campo).toBe('actualizado_en');
      expect(errores(() => validarReglas({ actualizado_en: malo, reglas: [] }, TEMP))[0]?.campo).toBe('actualizado_en');
    }
    expect(validarCambioDispositivo({ actualizado_en: '2028-02-29T00:00:00Z', nombre: 'x' }).actualizado_en).toBe('2028-02-29T00:00:00Z');
  });
  it('traducirFecha: 22008, 22007 y 22P02 de la base → 400; otro error pasa tal cual', () => {
    for (const code of ['22008', '22007', '22P02']) expect(traducirFecha(Object.assign(new Error('x'), { code }))).toBeInstanceOf(BadRequestException);
    const otro = Object.assign(new Error('x'), { code: '40001' });
    expect(traducirFecha(otro)).toBe(otro);
  });
});

// Reglas emparejadas por id (decidido el 11/11/2026): con id cambia esa regla; sin id es nueva; un id repetido o mal formado es 400.
describe('validarReglas con id', () => {
  const R = '11111111-1111-4111-8111-111111111111';
  it('el id viaja con la regla (en minúsculas); sin id, la regla es nueva', () => {
    const v = validarReglas({ actualizado_en: MARCA, reglas: [{ id: R.toUpperCase(), umbral_alto: 30 }, { umbral_bajo: 5 }] }, TEMP);
    expect(v.reglas.map((r) => r.id)).toEqual([R, undefined]);
  });
  it('un id repetido o que no es UUID → 400 que lo nombra', () => {
    expect(errores(() => validarReglas({ actualizado_en: MARCA, reglas: [{ id: R, umbral_alto: 30 }, { id: R, umbral_alto: 40 }] }, TEMP))[0]?.campo).toBe('reglas[1].id');
    expect(errores(() => validarReglas({ actualizado_en: MARCA, reglas: [{ id: 'r1', umbral_alto: 30 }] }, TEMP))[0]?.campo).toBe('reglas[0].id');
  });
});
