import { describe, expect, it } from 'vitest';
import { formatearValor } from './grafico';
import { MAGNITUDES_LONGITUD, UNIDADES_POR_DEFECTO, conversion, convertirSerie, preferenciaUnidades, simbolo } from './unidades';

// Unidades para personas (docs/19 §4, tablero v2, D7): símbolo desde una sola tabla; °C/°F y mm/m/km solo al mostrar, con ida y vuelta.
describe('unidades: símbolos y conversión al mostrar', () => {
  it('los códigos de SenML se muestran con su símbolo; uno desconocido, tal cual', () => {
    expect(simbolo('Cel')).toBe('°C');
    expect(simbolo('%RH')).toBe('%RH');
    expect(simbolo('%EL')).toBe('%');
    expect(simbolo('hPa')).toBe('hPa');
    expect(simbolo('dBm')).toBe('dBm');
    expect(simbolo('V')).toBe('V');
    expect(simbolo('furlong')).toBe('furlong');
  });
  it('sin preferencia no se convierte nada (la unidad del catálogo); una preferencia inválida tampoco cambia nada', () => {
    expect(preferenciaUnidades(undefined)).toEqual(UNIDADES_POR_DEFECTO);
    expect(UNIDADES_POR_DEFECTO).toEqual({ temperatura: null, longitud: null });
    expect(preferenciaUnidades({ unidad_temperatura: 'K' as never, unidad_longitud: 'pulgada' as never })).toEqual({ temperatura: null, longitud: null });
    expect(conversion('Cel').desdeBase(21.5)).toBe(21.5);
    const m = conversion('m', UNIDADES_POR_DEFECTO, 'nivel', ['nivel']); // aun siendo de longitud: sin preferencia, metros
    expect([m.simbolo, m.desdeBase(1.5)]).toEqual(['m', 1.5]);
    expect(preferenciaUnidades({ unidad_temperatura: 'F', unidad_longitud: 'km' })).toEqual({ temperatura: 'F', longitud: 'km' }); // en los dos sentidos
  });
  it('la longitud se convierte solo en magnitudes de longitud de la lista explícita; nunca la precipitación en mm', () => {
    expect(MAGNITUDES_LONGITUD).toEqual([]); // el catálogo de hoy (db/init) no tiene ninguna magnitud de longitud
    const km = { temperatura: null, longitud: 'km' } as const;
    expect(conversion('mm', km, 'precipitacion').simbolo).toBe('mm');
    expect(conversion('mm', km, 'precipitacion', ['nivel']).desdeBase(12)).toBe(12);
    expect(conversion('m', km).simbolo).toBe('m'); // sin magnitud, tampoco
    expect(conversion('m', km, 'nivel', ['nivel']).desdeBase(1500)).toBe(1.5);
  });
  it('°C → °F con los puntos fijos (0 → 32, 100 → 212, −40 → −40) y la ida y vuelta exacta al mostrar', () => {
    const f = conversion('Cel', { temperatura: 'F', longitud: 'mm' });
    expect(f.simbolo).toBe('°F');
    expect(f.desdeBase(0)).toBe(32);
    expect(f.desdeBase(100)).toBe(212);
    expect(f.desdeBase(-40)).toBe(-40);
    for (const c of [-55, -12.25, 0, 21.5, 36.6, 85, 125]) {
      const ida = f.desdeBase(c);
      expect(Math.abs(f.aBase(ida) - c)).toBeLessThan(1e-9);
      expect(formatearValor(f.aBase(ida), '°C')).toBe(formatearValor(c, '°C'));
    }
    expect(formatearValor(f.desdeBase(21.5), f.simbolo)).toBe('70,7 °F');
  });
  it('m → mm, m y km, y de vuelta; otra magnitud nunca se convierte por la preferencia de longitud', () => {
    for (const longitud of ['mm', 'm', 'km'] as const) {
      const c = conversion('m', { temperatura: 'C', longitud }, 'nivel', ['nivel']);
      expect(c.simbolo).toBe(longitud);
      for (const v of [0, 0.001, 1.5, 1234.567]) expect(Math.abs(c.aBase(c.desdeBase(v)) - v)).toBeLessThan(1e-9);
    }
    expect(conversion('m', { temperatura: 'C', longitud: 'mm' }, 'nivel', ['nivel']).desdeBase(1.5)).toBe(1500);
    expect(conversion('m', { temperatura: 'C', longitud: 'km' }, 'nivel', ['nivel']).desdeBase(1500)).toBe(1.5);
    expect(conversion('hPa', { temperatura: 'F', longitud: 'km' }).desdeBase(1013)).toBe(1013);
    expect(conversion('%RH', { temperatura: 'F', longitud: 'km' }).simbolo).toBe('%RH');
  });
  it('una serie con huecos se convierte sin rellenarlos', () => {
    expect(convertirSerie([0, null, 100], conversion('Cel', { temperatura: 'F', longitud: 'mm' }))).toEqual([32, null, 212]);
  });
});
