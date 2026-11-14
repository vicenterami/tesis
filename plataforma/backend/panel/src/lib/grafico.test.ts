import { describe, expect, it } from 'vitest';
import { SERIES } from './tema';
import { EJE_TIEMPO, NOMBRES_FECHA, RANGOS, SELLO_LEYENDA, agregarLectura, alinearSeries, decimalesDeSeries, decimalesParaRecorrido, filasEtiqueta, formatearValor, rotuloCada, puntosDe, rangoQueContiene, resolucionValida, resolucionesAdmisibles, resumenRango, rotuloIntervalo, seriesDesdeHistorico, urlHistorico, ventana, intervaloParaVentana, resolucionMasFina, ventanaDeSeleccion } from './grafico';

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
  it('los rótulos dicen «cada 15 minutos», sin «cubo» y sin «cada 1 …» (docs/19 §4, M4)', () => {
    expect(['1 minute', '5 minutes', '15 minutes', '1 hour', '6 hours', '1 day'].map(rotuloCada))
      .toEqual(['cada minuto', 'cada 5 minutos', 'cada 15 minutos', 'cada hora', 'cada 6 horas', 'cada día']);
  });
  it('formatea con coma decimal y la unidad; nulo → raya', () => {
    expect(formatearValor(21.456789, 'Cel')).toBe('21,457 Cel');
    expect(formatearValor(null, 'Cel')).toBe('—');
  });
  it('los decimales de lo dibujado (L4c): los que distinguen dos valores del recorrido, entre cero y tres', () => {
    expect(decimalesParaRecorrido(10.8, 21.4)).toBe(1); // temperatura del sitio: «19,4 °C»
    expect(decimalesParaRecorrido(1009, 1010.5)).toBe(2); // presión: «1.009,51 hPa»
    expect(decimalesParaRecorrido(0, 100)).toBe(0); // un porcentaje de punta a punta
    expect(decimalesParaRecorrido(3.25, 3.31)).toBe(3); // tensión de batería
    expect(decimalesParaRecorrido(0, 1e9)).toBe(0); // nunca negativo
    expect(decimalesParaRecorrido(20, 20)).toBe(3); // sin recorrido: los de la API
    expect(decimalesParaRecorrido(Infinity, -Infinity)).toBe(3); // sin ningún valor
    expect(formatearValor(19.396, '°C', 1)).toBe('19,4 °C');
    expect(formatearValor(60.023, '%RH', 1)).toBe('60 %RH'); // como mucho: no rellena con ceros
  });
  it('… el recorrido se mide sobre todas las series de valores (nunca sobre la de tiempos) y sin los huecos', () => {
    expect(decimalesDeSeries([[1_000_000, 1_000_900], [19.396, null], [10.8, 19.29], [21.03, 19.5]])).toBe(1);
    expect(decimalesDeSeries([[1_000_000, 1_000_900], [null, null]])).toBe(3);
    expect(decimalesDeSeries([[1_000_000]])).toBe(3);
  });
  it('… y la etiqueta flotante escribe todas sus filas con esos decimales como mucho (el valor exacto está en «Ver los datos»)', () => {
    const series = [[1_000_000, 1_000_900], [19.396, 19.292], [19.29, 10.8], [19.5, 21.03]];
    const lineas = [{ label: 'promedio', stroke: '#111' }, { label: 'mínimo', stroke: '#111' }, { label: 'máximo', stroke: '#111' }];
    const banda = { alta: 3, baja: 2, color: '#111' };
    expect(filasEtiqueta(series, lineas, banda, 0, '°C', decimalesDeSeries(series)).map((f) => `${f.nombre}: ${f.valor}`)).toEqual(['promedio: 19,4 °C', 'mínimo–máximo: 19,3 a 19,5 °C']);
    expect(filasEtiqueta(series, lineas, banda, 0, '°C').map((f) => f.valor)).toEqual(['19,396 °C', '19,29 a 19,5 °C']); // sin pedirlo, los tres de la API
    expect(filasEtiqueta([[1], [null]], [{ label: 'promedio', stroke: '#111' }], null, 0, '°C', 1)).toEqual([{ nombre: 'sin datos', valor: '—', color: '' }]);
  });
  it('… con `aportes` (el promedio del sitio, M3), al final, cuántos dispositivos aportan en ese punto; sin dato o sin aportes, ninguna fila más', () => {
    const series = [[1_000_000, 1_000_900], [14.2, 11.6], [11.8, 11.6], [17.6, 11.7]];
    const lineas = [{ label: 'promedio', stroke: '#111' }, { label: 'mínimo', stroke: '#111' }, { label: 'máximo', stroke: '#111' }];
    const banda = { alta: 3, baja: 2, color: '#111' };
    const filas = filasEtiqueta(series, lineas, banda, 0, '°C', 1, [3, 1]);
    expect(filas.map((f) => `${f.nombre}: ${f.valor}`)).toEqual(['promedio: 14,2 °C', 'mínimo–máximo: 11,8 a 17,6 °C', 'aportan: 3 dispositivos']);
    expect(filas.at(-1)).toMatchObject({ aporte: true, color: '' });
    expect(filasEtiqueta(series, lineas, banda, 1, '°C', 1, [3, 1]).at(-1)!.valor).toBe('1 dispositivo');
    expect(filasEtiqueta(series, lineas, banda, 0, '°C', 1)).toHaveLength(2); // la ficha y la comparación no pasan `aportes`
    expect(filasEtiqueta([[1], [null]], [{ label: 'promedio', stroke: '#111' }], null, 0, '°C', 1, [0])).toEqual([{ nombre: 'sin datos', valor: '—', color: '' }]);
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
  it('la paleta trae 6 colores distintos en cada tema', () => expect([new Set(SERIES.claro).size, new Set(SERIES.oscuro).size]).toEqual([6, 6]));
});


// Zoom que refina y rango a medida (docs/19 §4, tablero v2, B1 y D1).
describe('ventanas fijas: resolución del zoom y del rango a medida', () => {
  it('el zoom pide la resolución más fina con 2 a 2 500 puntos', () => {
    expect(resolucionMasFina(3_600_000)).toBe('1m'); // 1 h → 60 puntos por minuto
    expect(resolucionMasFina(3 * 86_400_000)).toBe('5m'); // 3 días: 4 320 por minuto (no), 864 cada 5 min
    expect(resolucionMasFina(30 * 86_400_000)).toBe('1h');
  });
  it('una selección de menos de dos minutos se ensancha a dos, centrada; el orden de los extremos no importa', () => {
    const v = ventanaDeSeleccion(1_000_060, 1_000_000)!;
    expect((v.hasta.getTime() - v.desde.getTime()) / 1000).toBe(120);
    expect(v.desde.getTime() / 1000).toBe(999_970);
  });
  it('una selección con un extremo que no es número finito no da ventana (nunca una fecha inválida que lance al armar la URL)', () => {
    expect(ventanaDeSeleccion(Number.NaN, 1_000_000)).toBeNull();
    expect(ventanaDeSeleccion(1_000_000, Infinity)).toBeNull();
    expect(ventanaDeSeleccion(1_000_000, 1_003_600)).not.toBeNull(); // en los dos sentidos
  });
  it('a medida, la resolución la fija el menor rango que contiene la ventana; más de 30 días, un día', () => {
    expect(intervaloParaVentana(2 * 3_600_000)).toBe('15 minutes');
    expect(intervaloParaVentana(10 * 86_400_000)).toBe('6 hours');
    expect(intervaloParaVentana(90 * 86_400_000)).toBe('1 day');
  });
});
