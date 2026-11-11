import { describe, expect, it } from 'vitest';
import { aCanonica } from './unidades.js';

// Filtro 4: conversión a la unidad canónica; lo que no se sabe convertir se rechaza (undefined).
describe('aCanonica', () => {
  it('misma unidad o sin unidad → el valor tal cual', () => {
    expect(aCanonica(21.5, 'Cel', 'Cel')).toBe(21.5);
    expect(aCanonica(21.5, undefined, 'Cel')).toBe(21.5);
  });
  it('Kelvin y Fahrenheit a Celsius', () => {
    expect(aCanonica(300, 'K', 'Cel')).toBeCloseTo(26.85, 2);
    expect(aCanonica(212, '°F', 'Cel')).toBeCloseTo(100, 6);
    expect(aCanonica(32, 'F', 'Cel')).toBeCloseTo(0, 6);
  });
  it('presión: Pa, kPa y bar a hPa', () => {
    expect(aCanonica(101325, 'Pa', 'hPa')).toBeCloseTo(1013.25, 6);
    expect(aCanonica(101.325, 'kPa', 'hPa')).toBeCloseTo(1013.25, 6);
    expect(aCanonica(1.01325, 'bar', 'hPa')).toBeCloseTo(1013.25, 6);
  });
  it('porcentaje genérico a humedad relativa o batería', () => {
    expect(aCanonica(55, '%', '%RH')).toBe(55);
    expect(aCanonica(87, '%', '%EL')).toBe(87);
  });
  it('mV (unidad secundaria de SenML, RFC 8798) a V, la canónica de la humedad de suelo; V a mV no se inventa', () => {
    expect(aCanonica(2650, 'mV', 'V')).toBe(2.65);
    expect(aCanonica(2.65, 'V', 'mV')).toBeUndefined();
  });
  it('pareja desconocida → undefined (mejor rechazar que adivinar)', () => {
    expect(aCanonica(20, 'furlongs', 'Cel')).toBeUndefined();
    expect(aCanonica(20, 'Cel', 'hPa')).toBeUndefined();
  });
});
