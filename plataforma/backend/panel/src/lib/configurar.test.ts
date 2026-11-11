import { describe, expect, it } from 'vitest';
import { ErrorApi } from './api';
import { cuerpoDispositivo, cuerpoReglas, erroresDeDispositivo, erroresPorCampo, horaDelConflicto, validarReglas, type RangoFisico, type ReglaFormulario } from './configurar';
import type { DispositivoFicha } from './modelo';

// P6 (docs/19 §4, tablero v2, E): la validación del panel es la del servidor (configuracion.dto.ts), con los MISMOS casos de su prueba
// (configuracion.dto.spec.ts) y los mismos campos y motivos: lo que el servidor rechaza, el panel lo dice junto al campo antes de enviar.
const TEMP = { rango_min: -40, rango_max: 85 };
const r = (x: Partial<ReglaFormulario>): ReglaFormulario => ({ umbral_alto: '', umbral_bajo: '', histeresis: '0', retardo_s: '0', ...x });
const errores = (reglas: ReglaFormulario[], rango: RangoFisico = TEMP) => validarReglas('', reglas, rango).errores;

describe('validarReglas: los casos del servidor, en los dos sentidos', () => {
  it('una regla buena pasa (histéresis y retardo en 0); la lista vacía quita todas; 86 400 s de retardo es el tope y pasa', () => {
    expect(validarReglas('', [r({ umbral_alto: '30' })], TEMP)).toEqual({ errores: [], etiqueta: null, reglas: [{ umbral_alto: 30, umbral_bajo: null, histeresis: 0, retardo_s: 0 }] });
    expect(errores([])).toEqual([]);
    expect(validarReglas('sala', [r({ umbral_alto: '30', umbral_bajo: '5', histeresis: '12', retardo_s: '86400' })], TEMP)).toMatchObject({ errores: [], etiqueta: 'sala' });
    expect(validarReglas('', [r({ umbral_alto: '30,5' })]).reglas[0]!.umbral_alto).toBe(30.5); // la coma decimal de quien escribe
  });
  it('bajo < alto; histéresis menor que la mitad de la banda; rango físico; retardo entero 0..86400; al menos un umbral (mismos campos y motivos)', () => {
    expect(errores([r({ umbral_alto: '10', umbral_bajo: '20' })])).toEqual([{ campo: 'reglas[0].umbral_bajo', motivo: 'debe ser menor que umbral_alto' }]);
    expect(errores([r({ umbral_alto: '30', umbral_bajo: '10', histeresis: '10' })])).toEqual([{ campo: 'reglas[0].histeresis', motivo: 'debe ser menor que la mitad de la banda (10)' }]);
    expect(errores([r({ umbral_alto: '90' })])[0]?.motivo).toMatch(/rango físico/);
    expect(errores([r({ umbral_alto: '90' })], { rango_min: null, rango_max: null })).toEqual([]); // sin el rango, decide el servidor
    expect(errores([r({ umbral_alto: '30', retardo_s: '86401' })])[0]?.campo).toBe('reglas[0].retardo_s');
    expect(errores([r({ umbral_alto: '30', retardo_s: '1.5' })])[0]?.campo).toBe('reglas[0].retardo_s');
    expect(errores([r({ histeresis: '1' })])[0]).toEqual({ campo: 'reglas[0]', motivo: 'al menos umbral_alto o umbral_bajo' });
    expect(errores([r({ umbral_alto: 'treinta' })])).toEqual([{ campo: 'reglas[0].umbral_alto', motivo: 'número finito o null' }]); // sin «al menos uno» encima
    expect(errores([r({ umbral_alto: '1' }), r({ umbral_alto: '2' }), r({ umbral_alto: '3' }), r({ umbral_alto: '4' }), r({ umbral_alto: '5' })])[0]?.campo).toBe('reglas');
    expect(validarReglas('x'.repeat(41), []).errores[0]?.campo).toBe('etiqueta');
  });
  it('el cuerpo de PUT conserva el id de cada regla editada (el servidor empareja por id; sin id es nueva) y no se arma con errores', () => {
    const c = cuerpoReglas('2026-11-11T12:00:00.123456Z', ' sala ', [r({ id: 'r1', umbral_alto: '30' }), r({ umbral_bajo: '2' })]);
    expect(c.cuerpo).toEqual({ actualizado_en: '2026-11-11T12:00:00.123456Z', etiqueta: 'sala', reglas: [{ id: 'r1', umbral_alto: 30, umbral_bajo: null, histeresis: 0, retardo_s: 0 }, { umbral_alto: null, umbral_bajo: 2, histeresis: 0, retardo_s: 0 }] });
    expect(cuerpoReglas('x', '', [r({ umbral_alto: '1', umbral_bajo: '2' })]).cuerpo).toBeNull();
  });
});

describe('el dispositivo, el 400 por campo y la hora del 409', () => {
  const d = { nombre: 'Sala', estado: 'activo', intervalo_esperado_s: 60, zona_id: 'z1', actualizado_en: '2026-11-11T12:00:00.123456Z' } as DispositivoFicha & { actualizado_en: string };
  it('solo lo que cambió, con el actualizado_en leído tal cual; nada que cambiar → null; intervalo fuera de 5..86400 y nombre vacío → error del campo', () => {
    expect(cuerpoDispositivo(d, { nombre: ' Sala ', estado: 'mantenimiento', intervalo: '60', zona_id: 'z1' })).toEqual({ actualizado_en: d.actualizado_en, estado: 'mantenimiento' });
    expect(cuerpoDispositivo(d, { nombre: 'Sala', estado: 'activo', intervalo: '60', zona_id: 'z1' })).toBeNull();
    expect(erroresDeDispositivo({ nombre: '  ', estado: 'activo', intervalo: '4', zona_id: 'z1' }).map((e) => e.campo)).toEqual(['nombre', 'intervalo_esperado_s']);
  });
  it('un 400 del servidor («campo: motivo») se reparte por campo; el 409 trae la hora en la zona del sitio', () => {
    const e400 = new ErrorApi(400, '', 'HTTP 400', ['reglas[0].umbral_alto: fuera del rango físico de la magnitud [-40, 85]', 'algo general']);
    expect(erroresPorCampo(e400)).toEqual([{ campo: 'reglas[0].umbral_alto', motivo: 'fuera del rango físico de la magnitud [-40, 85]' }, { campo: '(formulario)', motivo: 'algo general' }]);
    const e409 = new ErrorApi(409, '', 'HTTP 409', ['alguien lo cambió a las 13:42 UTC (2026-11-11T13:42:05.123456Z); recarga']);
    expect(horaDelConflicto(e409, 'America/Santiago')).toBe('10:42');
    expect(horaDelConflicto(new ErrorApi(409, '', 'x', ['otra cosa']), 'UTC')).toBeNull();
  });
});
