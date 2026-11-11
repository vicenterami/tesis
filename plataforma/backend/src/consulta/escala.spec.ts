import { describe, expect, it } from 'vitest';
import { porcentaje } from './escala.js';

// Calibración del suelo de docs/16 §38: 0 % al aire (2,65 V) y 100 % en agua (1,20 V): el 100 % está por debajo del 0 %.
describe('porcentaje con la calibración del canal (docs/10 §8.4 punto 51)', () => {
  it('los extremos y el medio, con el 100 % por debajo del 0 % (sensor de suelo capacitivo)', () => {
    expect(porcentaje(2.65, 2.65, 1.2)).toBe(0);
    expect(porcentaje(1.2, 2.65, 1.2)).toBe(100);
    expect(porcentaje(1.925, 2.65, 1.2)).toBe(50);
  });
  it('también con el 100 % por encima del 0 %, y redondeado a una décima', () => {
    expect(porcentaje(1.5, 1, 4)).toBe(16.7);
  });
  it('fuera de la calibración se recorta a [0, 100]', () => {
    expect(porcentaje(3.0, 2.65, 1.2)).toBe(0);
    expect(porcentaje(0.5, 2.65, 1.2)).toBe(100);
  });
  it('sin calibración, sin valor, o con algo que no es un número finito → null (nunca un porcentaje inventado)', () => {
    expect(porcentaje(2, null, null)).toBeNull();
    expect(porcentaje(2, 2.65, null)).toBeNull();
    expect(porcentaje(null, 2.65, 1.2)).toBeNull();
    expect(porcentaje(undefined, 2.65, 1.2)).toBeNull();
    expect(porcentaje(Number.NaN, 2.65, 1.2)).toBeNull();
    expect(porcentaje(2, Number.POSITIVE_INFINITY, 1.2)).toBeNull();
    expect(porcentaje(2, 2, 2)).toBeNull(); // la base lo impide (ck_canal_escala); aquí tampoco se divide por cero
  });
});
