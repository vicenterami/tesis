import { describe, expect, it } from 'vitest';
import { RANGOS, agregarLectura, formatearValor, seriesDesdeHistorico, urlHistorico, ventana } from './grafico';

describe('ventana y URL del histórico (docs/19 P3)', () => {
  const ahora = new Date('2026-10-12T15:00:00Z');
  it('cada rango termina en «ahora» y usa un intervalo de la lista cerrada de la API', () => {
    const v = ventana('24h', ahora);
    expect(v.hasta).toEqual(ahora);
    expect(v.desde.toISOString()).toBe('2026-10-11T15:00:00.000Z');
    expect(v.intervalo).toBe('15 minutes');
    expect(RANGOS.map((r) => r.intervalo)).toEqual(['1 minute', '15 minutes', '1 hour', '6 hours']);
  });
  it('la URL lleva los parámetros codificados', () =>
    expect(urlHistorico('abc', new Date('2026-10-11T15:00:00Z'), ahora, '15 minutes')).toBe(
      '/canales/abc/historico?desde=2026-10-11T15%3A00%3A00.000Z&hasta=2026-10-12T15%3A00%3A00.000Z&intervalo=15+minutes',
    ));
});

describe('series: histórico agregado y lecturas en vivo aparte', () => {
  it('del histórico salen tiempos y promedios; la serie «actual» va vacía', () =>
    expect(seriesDesdeHistorico({ tiempos: [1, 2], valores: [10, 20] })).toEqual([[1, 2], [10, 20], [null, null]]));
  it('una lectura en vivo se agrega al final en la serie «actual», sin tocar el promedio', () => {
    const s = agregarLectura(seriesDesdeHistorico({ tiempos: [1, 2], valores: [10, 20] }), '1970-01-01T00:00:05Z', 21.5);
    expect(s).toEqual([[1, 2, 5], [10, 20, null], [null, null, 21.5]]);
  });
  it('una lectura con instante anterior (reloj del nodo) se inserta en su sitio; una ilegible se ignora', () => {
    const s = agregarLectura(seriesDesdeHistorico({ tiempos: [1, 5], valores: [10, 50] }), '1970-01-01T00:00:03Z', 3);
    expect(s[0]).toEqual([1, 3, 5]);
    expect(agregarLectura(s, 'no es fecha', 1)).toEqual(s);
  });
  it('con más de N lecturas en vivo se descartan las más viejas, nunca el histórico', () => {
    let s = seriesDesdeHistorico({ tiempos: [1], valores: [10] });
    for (let i = 0; i < 5; i++) s = agregarLectura(s, new Date((i + 10) * 1000).toISOString(), i, 3);
    expect(s[0]).toEqual([1, 12, 13, 14]);
    expect(s[1]).toEqual([10, null, null, null]);
    expect(s[2]).toEqual([null, 2, 3, 4]);
  });
  it('formatea con coma decimal y la unidad; nulo → raya', () => {
    expect(formatearValor(21.456789, 'Cel')).toBe('21,457 Cel');
    expect(formatearValor(null, 'Cel')).toBe('—');
  });
});
