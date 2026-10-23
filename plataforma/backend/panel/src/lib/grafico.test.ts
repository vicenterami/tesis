import { describe, expect, it } from 'vitest';
import { EJE_TIEMPO, NOMBRES_FECHA, PALETA, RANGOS, SELLO_LEYENDA, agregarLectura, alinearSeries, formatearValor, puntosDe, rangoQueContiene, resolucionValida, resolucionesAdmisibles, resumenRango, rotuloIntervalo, seriesDesdeHistorico, urlHistorico, ventana } from './grafico';

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
  it('el intervalo de la API se muestra en español', () => {
    expect(rotuloIntervalo('15 minutes')).toBe('15 minutos');
    expect(rotuloIntervalo('1 day')).toBe('1 día');
  });
  it('formatea con coma decimal y la unidad; nulo → raya', () => {
    expect(formatearValor(21.456789, 'Cel')).toBe('21,457 Cel');
    expect(formatearValor(null, 'Cel')).toBe('—');
  });
});

describe('fechas y horas del gráfico en español y 24 h (docs/19 §6)', () => {
  // Con la función de formato real de uPlot 1.6.32: las plantillas de EJE_TIEMPO y SELLO_LEYENDA deben dar 24 h y meses en español.
  const d = new Date(2026, 9, 16, 21, 30); // 16 de octubre, 21:30 (hora local del proceso de prueba: aquí solo importa el formato)
  it('el eje por minutos dice 21:30, no 9:30pm; la leyenda trae día/mes/año y hora en 24 h', async () => {
    const { default: uPlot } = await import('uplot');
    const minutos = EJE_TIEMPO.find((f) => f[0] === 60)!;
    expect(uPlot.fmtDate(minutos[1] as string, NOMBRES_FECHA)(d)).toBe('21:30');
    expect(uPlot.fmtDate(SELLO_LEYENDA, NOMBRES_FECHA)(d)).toBe('16/10/2026 21:30');
    const meses = EJE_TIEMPO.find((f) => f[0] === 28 * 24 * 3600)!;
    expect(uPlot.fmtDate(meses[1] as string, NOMBRES_FECHA)(d)).toBe('oct');
  });
  it('ninguna plantilla usa la hora de 12 h ni am/pm', () => {
    const textos = [SELLO_LEYENDA, ...EJE_TIEMPO.flatMap((f) => f.filter((x): x is string => typeof x === 'string'))];
    expect(textos.filter((t) => /\{h\}|\{aa\}|\{AA\}/.test(t))).toEqual([]);
  });
});

describe('rangoQueContiene: el menor rango que dibuja la última medición (docs/19 §4, incremento 1, punto 2)', () => {
  const ahora = new Date('2026-10-12T15:00:00Z');
  it('elige el menor de la lista cerrada; más de 30 días → ninguno', () => {
    expect(rangoQueContiene('2026-10-12T14:30:00Z', ahora)).toBe('1h');
    expect(rangoQueContiene('2026-10-12T10:00:00Z', ahora)).toBe('24h');
    expect(rangoQueContiene('2026-10-08T15:00:00Z', ahora)).toBe('7d');
    expect(rangoQueContiene('2026-09-20T15:00:00Z', ahora)).toBe('30d');
    expect(rangoQueContiene('2026-09-01T15:00:00Z', ahora)).toBeNull();
    expect(rangoQueContiene('no es fecha', ahora)).toBeNull();
  });
});

// Incremento 2 (docs/19 §4): resoluciones por rango (punto 4), resumen del rango (punto 6), alineación de P3b (punto 5).
describe('resoluciones admisibles: entre 2 y 2 500 puntos para el rango', () => {
  it('30 días desde 1 h; 7 días desde 5 min; 24 h desde 1 min y sin 1 día (1 punto); 1 hora hasta 15 min', () => {
    expect(resolucionesAdmisibles('30d')).toEqual(['1h', '6h', '1d']);
    expect(resolucionesAdmisibles('7d')).toEqual(['5m', '15m', '1h', '6h', '1d']);
    expect(resolucionesAdmisibles('24h')).toEqual(['1m', '5m', '15m', '1h', '6h']);
    expect(resolucionesAdmisibles('1h')).toEqual(['1m', '5m', '15m']);
    expect(puntosDe('7d', '5m')).toBe(2016);
  });
  it('la resolución elegida cambia el intervalo pedido; una que no sirve para el rango vuelve a «auto»', () => {
    const ahora = new Date('2026-10-12T15:00:00Z');
    expect(ventana('7d', ahora, '5m').intervalo).toBe('5 minutes');
    expect(ventana('7d', ahora, null).intervalo).toBe('1 hour');
    expect(resolucionValida('30d', '1m')).toBeNull();
    expect(resolucionValida('30d', '1h')).toBe('1h');
  });
});

describe('resumenRango: mínimo, máximo y promedio de los promedios', () => {
  it('ignora los nulos; sin valores, null', () => {
    expect(resumenRango([20, null, 22, 24])).toEqual({ n: 3, min: 20, max: 24, promedio: 22 });
    expect(resumenRango([null])).toBeNull();
    expect(resumenRango([])).toBeNull();
  });
});

describe('alinearSeries: un eje común con hueco (null) donde una serie no tiene cubo', () => {
  it('une y ordena los instantes; cada serie conserva sus valores y deja null en los ajenos', () => {
    expect(alinearSeries([{ tiempos: [10, 30], valores: [1, 3] }, { tiempos: [20, 30, 40], valores: [5, 6, 7] }])).toEqual([
      [10, 20, 30, 40],
      [1, null, 3, null],
      [null, 5, 6, 7],
    ]);
    expect(alinearSeries([])).toEqual([[]]);
  });
  it('la paleta trae 6 colores distintos', () => expect(new Set(PALETA).size).toBe(6));
});

