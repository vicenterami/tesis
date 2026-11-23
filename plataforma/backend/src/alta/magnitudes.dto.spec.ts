import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { M27, UNIDADES } from '../recepcion/adaptadores/catalogo-semilla.prueba.js';
import {
  ALIAS_FORMA, ALIAS_RESERVADOS, erroresDeSugeridos, validarCambioMagnitud, validarMagnitudNueva, validarRangoPropuesto,
} from './magnitudes.dto.js';
import { UNIDADES_CANONICAS } from './unidades.js';

// El validador del catálogo de magnitudes (TT-12, bloque 4; docs/10 §8.4 punto 69; docs/19 §4, T). Lo que la base exige (migración 27)
// se compara con el SQL; lo demás, con los motivos que ve la persona.
const errores = (f: () => unknown): string[] => {
  try { f(); } catch (e) {
    if (e instanceof BadRequestException) return ((e.getResponse() as { errores: { campo: string; motivo: string }[] }).errores).map((x) => `${x.campo}: ${x.motivo}`);
    throw e;
  }
  return [];
};
const NUEVA = { codigo: 'co2', nombre: 'Dióxido de carbono', unidad: 'Cel', rango_min: 0, rango_max: 5000 };
const MARCA = '2026-11-23T19:00:00.123456Z';

describe('lo que exige la base es lo que valida la API (migración 27)', () => {
  it('las claves reservadas y la forma del alias son las de ck_magnitud_alias_reservada y ck_magnitud_alias_clave', () => {
    const reservadas = [...(/ck_magnitud_alias_reservada CHECK \(clave NOT IN \(([^)]*)\)\)/.exec(M27)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(reservadas).toEqual([...ALIAS_RESERVADOS]);
    expect(M27).toContain(`clave ~ '${ALIAS_FORMA.source}'`);
  });
  it('toda unidad que ya usa el catálogo sembrado está en la lista cerrada, sin repetidas', () => {
    expect([...new Set(UNIDADES.values())].filter((u) => !UNIDADES_CANONICAS.includes(u))).toEqual([]);
    expect(new Set(UNIDADES_CANONICAS).size).toBe(UNIDADES_CANONICAS.length);
    expect(UNIDADES_CANONICAS).toHaveLength(53); // 58 del registro de RFC 8428 §12.1 − 8 no recomendadas + hPa, dBm y ug/m3
    // Las ocho «NOT RECOMMENDED» de RFC 8428 §12.1 no están (g, l, l/s, Bspl, %, 1/min, beat/min, beats).
    for (const u of ['g', 'l', 'l/s', 'Bspl', '%', '1/min', 'beat/min', 'beats']) expect(UNIDADES_CANONICAS).not.toContain(u);
  });
});

describe('crear una magnitud', () => {
  it('una buena: alias en minúsculas y sin repetir, sugeridos por omisión nulos y 0', () => {
    expect(validarMagnitudNueva({ ...NUEVA, alias: [' CO2_PPM ', 'co2.ppm'] })).toEqual({
      ...NUEVA, umbral_alto_sugerido: null, umbral_bajo_sugerido: null, histeresis_sugerida: 0, alias: ['co2_ppm', 'co2.ppm'],
    });
  });
  it.each<[string, Record<string, unknown>, string]>([
    ['código con mayúscula', { codigo: 'CO2' }, 'codigo: minúsculas'],
    ['código que empieza con número', { codigo: '2co' }, 'codigo: minúsculas'],
    ['unidad fuera de la lista', { unidad: 'ppm' }, 'unidad: una unidad de la lista'],
    ['unidad «NOT RECOMMENDED»', { unidad: '%' }, 'unidad: una unidad de la lista'],
    ['sin rango', { rango_max: undefined }, 'rango_max: número finito'],
    ['rango NaN', { rango_min: Number.NaN }, 'rango_min: número finito'],
    ['mínimo = máximo', { rango_min: 5000 }, 'rango_min: debe ser menor que rango_max'],
    ['nombre vacío', { nombre: '   ' }, 'nombre: texto de 1 a 80'],
    ['alias reservado', { alias: ['fport'] }, 'alias[0]: fport lo usa la pasarela para otra cosa'],
    ['alias con espacio', { alias: ['co 2'] }, 'alias[0]: minúsculas'],
    ['alias repetido (contando mayúsculas)', { alias: ['co2', 'CO2'] }, 'alias[1]: co2 está repetido'],
    ['campo desconocido', { color: 'rojo' }, 'color: campo no admitido'],
    ['sugerido fuera del rango', { umbral_alto_sugerido: 6000 }, 'umbral_alto_sugerido: fuera del rango físico'],
    ['sugerido bajo ≥ alto', { umbral_alto_sugerido: 100, umbral_bajo_sugerido: 100 }, 'umbral_bajo_sugerido: debe ser menor que umbral_alto'],
    ['histéresis de más de media banda (la misma regla del editor del canal)', { umbral_alto_sugerido: 100, umbral_bajo_sugerido: 0, histeresis_sugerida: 50 }, 'histeresis_sugerida: debe ser menor que la mitad de la banda'],
    ['histéresis sin umbrales', { histeresis_sugerida: 5 }, 'histeresis_sugerida: sin umbral sugerido no aplica'],
  ])('%s → 400', (_, cambio, texto) => {
    expect(errores(() => validarMagnitudNueva({ ...NUEVA, ...cambio })).join(' | ')).toContain(texto);
  });
});

describe('cambiar una magnitud', () => {
  it('solo lo que viene; el alias es la lista completa que reemplaza a la vigente', () => {
    expect(validarCambioMagnitud({ actualizado_en: MARCA, rango_max: 90, alias: ['Temp'] })).toEqual({ actualizado_en: MARCA, rango_max: 90, alias: ['temp'] });
    expect(validarCambioMagnitud({ actualizado_en: MARCA, umbral_alto_sugerido: null })).toEqual({ actualizado_en: MARCA, umbral_alto_sugerido: null });
  });
  it.each<[string, Record<string, unknown>, string]>([
    ['sin marca', { nombre: 'x' }, 'actualizado_en: obligatorio'],
    ['nada que cambiar', { actualizado_en: MARCA }, '(cuerpo): nada que cambiar'],
    ['el código no cambia', { actualizado_en: MARCA, codigo: 'otro' }, 'codigo: no cambia'],
    ['la unidad no cambia', { actualizado_en: MARCA, unidad: 'K' }, 'unidad: no cambia'],
    ['histéresis negativa', { actualizado_en: MARCA, histeresis_sugerida: -1 }, 'histeresis_sugerida: número mayor o igual que 0'],
    ['rango como texto', { actualizado_en: MARCA, rango_min: '0' }, 'rango_min: número finito'],
  ])('%s → 400', (_, cuerpo, texto) => {
    expect(errores(() => validarCambioMagnitud(cuerpo)).join(' | ')).toContain(texto);
  });
  it('los sugeridos se validan contra el rango final con la función del editor de reglas', () => {
    expect(erroresDeSugeridos({ umbral_alto_sugerido: 30, umbral_bajo_sugerido: null, histeresis_sugerida: 0.5 }, { rango_min: -40, rango_max: 85 })).toEqual([]);
    expect(erroresDeSugeridos({ umbral_alto_sugerido: 30, umbral_bajo_sugerido: null, histeresis_sugerida: 0 }, { rango_min: -40, rango_max: 20 })
      .map((e) => e.campo)).toEqual(['umbral_alto_sugerido']);
  });
});

describe('el rango propuesto del impacto', () => {
  it('números de la consulta; mínimo < máximo', () => {
    expect(validarRangoPropuesto('-10', '50.5')).toEqual({ rango_min: -10, rango_max: 50.5 });
    expect(errores(() => validarRangoPropuesto('', '1'))).toEqual(['rango_min: número finito']);
    expect(errores(() => validarRangoPropuesto('5', '5'))).toEqual(['rango_min: debe ser menor que rango_max']);
    expect(errores(() => validarRangoPropuesto('Infinity', '5'))).toContain('rango_min: número finito');
  });
});
