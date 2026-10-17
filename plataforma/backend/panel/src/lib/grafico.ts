import type uPlot from 'uplot';
import type { Historico } from './modelo';

// Datos del gráfico de la ficha (docs/19 P3): el histórico llega agregado por la base (cientos de puntos) y lo que llega en
// vivo se dibuja aparte, como «lectura actual», para no mezclar un valor crudo con promedios.

// Rangos que ofrece la ficha y el intervalo de agregación que usa cada uno (todos de la lista cerrada de la API).
export const RANGOS = [
  { clave: '1h', rotulo: 'última hora', ms: 3_600_000, intervalo: '1 minute' },
  { clave: '24h', rotulo: '24 horas', ms: 86_400_000, intervalo: '15 minutes' },
  { clave: '7d', rotulo: '7 días', ms: 7 * 86_400_000, intervalo: '1 hour' },
  { clave: '30d', rotulo: '30 días', ms: 30 * 86_400_000, intervalo: '6 hours' },
] as const;
export type ClaveRango = (typeof RANGOS)[number]['clave'];
export const RANGO_POR_DEFECTO: ClaveRango = '24h';

export function rango(clave: ClaveRango) {
  return RANGOS.find((r) => r.clave === clave) ?? RANGOS[1];
}

// Ventana [desde, hasta) que pide el panel para un rango, terminando en «ahora».
export function ventana(clave: ClaveRango, ahora: Date): { desde: Date; hasta: Date; intervalo: string } {
  const r = rango(clave);
  return { desde: new Date(ahora.getTime() - r.ms), hasta: ahora, intervalo: r.intervalo };
}

// La URL se arma con los parámetros codificados; el id del canal viene de la API y aun así se codifica.
export function urlHistorico(canalId: string, desde: Date, hasta: Date, intervalo: string): string {
  const q = new URLSearchParams({ desde: desde.toISOString(), hasta: hasta.toISOString(), intervalo });
  return `/canales/${encodeURIComponent(canalId)}/historico?${q.toString()}`;
}

// Series para uPlot: [tiempos (s), promedio del histórico, lectura actual]. Un punto solo tiene valor en una de las dos.
export type Series = [number[], (number | null)[], (number | null)[]];

export function seriesDesdeHistorico(h: Pick<Historico, 'tiempos' | 'valores'>): Series {
  return [[...h.tiempos], [...h.valores], h.tiempos.map(() => null)];
}

// Agrega una lectura en vivo al final; si llega desordenada (reloj del nodo), se inserta en su sitio. Tope de puntos en
// vivo para que una pestaña abierta por días no crezca sin cota: se descartan los más viejos de la serie «actual».
export const MAX_PUNTOS_VIVO = 500;
export function agregarLectura(s: Series, tiempoIso: string, valor: number, maxVivo = MAX_PUNTOS_VIVO): Series {
  const t = Date.parse(tiempoIso) / 1000;
  if (!Number.isFinite(t)) return s;
  const [tiempos, promedio, actual] = [s[0].slice(), s[1].slice(), s[2].slice()];
  let i = tiempos.length;
  while (i > 0 && tiempos[i - 1]! > t) i--;
  tiempos.splice(i, 0, t);
  promedio.splice(i, 0, null);
  actual.splice(i, 0, valor);
  let vivos = actual.filter((v) => v !== null).length;
  for (let j = 0; j < tiempos.length && vivos > maxVivo; ) {
    if (actual[j] !== null && promedio[j] === null) {
      tiempos.splice(j, 1); promedio.splice(j, 1); actual.splice(j, 1); vivos--;
    } else j++;
  }
  return [tiempos, promedio, actual];
}

// El intervalo de la API, en palabras del panel.
const ROTULO_INTERVALO: Readonly<Record<string, string>> = {
  '1 minute': '1 minuto', '5 minutes': '5 minutos', '15 minutes': '15 minutos', '1 hour': '1 hora', '6 hours': '6 horas', '1 day': '1 día',
};
export function rotuloIntervalo(intervalo: string): string {
  return ROTULO_INTERVALO[intervalo] ?? intervalo;
}

// Valor con su unidad, con tres decimales como mucho y coma decimal (es-CL).
export function formatearValor(valor: number | null, unidad: string): string {
  if (valor === null) return '—';
  return `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 3 }).format(valor)} ${unidad}`;
}

// Fechas y horas como se leen en Chile (docs/19 §6): 24 h y meses en español. uPlot trae por defecto el formato en inglés de 12 h
// («9:30pm», «Time»), lo que se vio en la primera prueba con navegador real (16/10). Plantillas de `uPlot.fmtDate` (1.6.32): {H} es la
// hora de 0 a 23, {mm} los minutos, {D}/{M} día y mes, {MMM} el mes abreviado.
export const NOMBRES_FECHA = {
  MMMM: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  MMM: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'],
  WWWW: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
  WWW: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
};
// Eje de tiempo: la misma tabla que trae uPlot (paso del eje, rótulo por defecto, y el que se agrega al cambiar de año, mes o día),
// con las horas en 24 h y la fecha como día/mes. Los pasos van en segundos: la serie usa segundos Unix.
const H = 3600;
const D = 24 * H;
const NL = '\n';
export const EJE_TIEMPO: uPlot.Axis.TimeValuesConfig = [
  [365 * D, '{YYYY}', null, null, null, null, null, null, 1],
  [28 * D, '{MMM}', NL + '{YYYY}', null, null, null, null, null, 1],
  [D, '{D}/{M}', NL + '{YYYY}', null, null, null, null, null, 1],
  [H, '{H}:00', NL + '{D}/{M}/{YY}', null, NL + '{D}/{M}', null, null, null, 1],
  [60, '{H}:{mm}', NL + '{D}/{M}/{YY}', null, NL + '{D}/{M}', null, null, null, 1],
  [1, ':{ss}', NL + '{D}/{M}/{YY} {H}:{mm}', null, NL + '{D}/{M} {H}:{mm}', null, NL + '{H}:{mm}', null, 1],
];
// La leyenda del instante bajo el cursor.
export const SELLO_LEYENDA = '{D}/{M}/{YYYY} {H}:{mm}';
