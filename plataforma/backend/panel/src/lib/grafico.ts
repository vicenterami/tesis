import type uPlot from 'uplot';
import type { Historico } from './modelo';
import { SERIES } from './tema';

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

// El menor rango cuya ventana (terminando en «ahora») contiene el instante; null si ninguno (más de 30 días: el panel no lo
// dibuja, docs/19 §4, incremento 1, punto 2). Lo usa el botón «Ver la última medición»: el rango nunca cambia sin clic.
export function rangoQueContiene(iso: string, ahora: Date): ClaveRango | null {
  const edad = ahora.getTime() - Date.parse(iso);
  if (!Number.isFinite(edad)) return null;
  return RANGOS.find((r) => edad <= r.ms)?.clave ?? null;
}

// Resoluciones elegibles (docs/19 §4, incremento 2, punto 4): las de la lista cerrada de la API. «auto» (null) es la fija de cada
// rango, la de RANGOS. Se ofrecen solo las que dan entre 2 y 2 500 puntos para el rango elegido: 30 días admite desde 1 h, 7 días
// desde 5 min, 24 h desde 1 min. El servidor rechaza más de 5 000 cubos (validacion.ts); el panel nunca arma una petición así.
export const RESOLUCIONES = [
  { clave: '1m', rotulo: '1 min', s: 60, intervalo: '1 minute' },
  { clave: '5m', rotulo: '5 min', s: 300, intervalo: '5 minutes' },
  { clave: '15m', rotulo: '15 min', s: 900, intervalo: '15 minutes' },
  { clave: '1h', rotulo: '1 h', s: 3600, intervalo: '1 hour' },
  { clave: '6h', rotulo: '6 h', s: 21_600, intervalo: '6 hours' },
  { clave: '1d', rotulo: '1 día', s: 86_400, intervalo: '1 day' },
] as const;
export type ClaveResolucion = (typeof RESOLUCIONES)[number]['clave'];
export const MIN_PUNTOS = 2;
export const MAX_PUNTOS = 2500;

export function resolucion(clave: ClaveResolucion) {
  return RESOLUCIONES.find((r) => r.clave === clave)!;
}
// Cuántos cubos da un rango con una resolución (ventana ÷ intervalo): la cuenta que también hace el servidor.
export function puntosDe(clave: ClaveRango, res: ClaveResolucion): number {
  return Math.ceil(rango(clave).ms / 1000 / resolucion(res).s);
}
export function resolucionesAdmisibles(clave: ClaveRango): ClaveResolucion[] {
  return RESOLUCIONES.filter((r) => {
    const n = puntosDe(clave, r.clave);
    return n >= MIN_PUNTOS && n <= MAX_PUNTOS;
  }).map((r) => r.clave);
}
// Una resolución que no sirve para el rango (de una URL ajena, o tras cambiar de rango) vuelve a «auto»: nunca se adivina otra.
export function resolucionValida(clave: ClaveRango, res: ClaveResolucion | null): ClaveResolucion | null {
  return res !== null && resolucionesAdmisibles(clave).includes(res) ? res : null;
}

// ── Ventanas fijas (tablero v2, B1 y D1): el rango a medida y el zoom por arrastre son la misma cosa, `desde` y `hasta` ──────────
// «La resolución la fija el rango» también a medida: la del menor rango de la lista que la contiene (60 a 170 puntos, como los
// preajustes); más allá de 30 días, un día (366 como mucho: el tope del servidor).
export function intervaloParaVentana(ms: number): string {
  return RANGOS.find((r) => ms <= r.ms)?.intervalo ?? '1 day';
}
// El zoom refina (D1): la resolución más fina de la lista que da entre 2 y 2 500 puntos para la ventana. Una ventana de menos de dos
// minutos no tiene ninguna (1 min daría menos de 2 puntos): quien hace zoom la ensancha antes (VENTANA_MINIMA_S).
export const VENTANA_MINIMA_S = 2 * 60;
export function resolucionMasFina(ms: number): ClaveResolucion {
  const s = ms / 1000;
  return (RESOLUCIONES.find((r) => Math.ceil(s / r.s) <= MAX_PUNTOS && Math.ceil(s / r.s) >= MIN_PUNTOS) ?? RESOLUCIONES[RESOLUCIONES.length - 1]!).clave;
}
// Una selección del gráfico (segundos Unix) → la ventana a pedir, de al menos dos minutos (centrada en lo elegido si era menor).
// null si algún extremo no es un número finito (un NaN de uPlot fuera del área): nunca una fecha inválida que reviente al armar la URL.
export function ventanaDeSeleccion(desdeS: number, hastaS: number): { desde: Date; hasta: Date } | null {
  if (!Number.isFinite(desdeS) || !Number.isFinite(hastaS)) return null;
  let [a, b] = desdeS <= hastaS ? [desdeS, hastaS] : [hastaS, desdeS];
  if (b - a < VENTANA_MINIMA_S) {
    const centro = (a + b) / 2;
    [a, b] = [centro - VENTANA_MINIMA_S / 2, centro + VENTANA_MINIMA_S / 2];
  }
  return { desde: new Date(Math.round(a) * 1000), hasta: new Date(Math.round(b) * 1000) };
}

// Ventana [desde, hasta) que pide el panel para un rango, terminando en «ahora»; con resolución elegida, su intervalo.
export function ventana(clave: ClaveRango, ahora: Date, res: ClaveResolucion | null = null): { desde: Date; hasta: Date; intervalo: string } {
  const r = rango(clave);
  const intervalo = res === null ? r.intervalo : resolucion(res).intervalo;
  return { desde: new Date(ahora.getTime() - r.ms), hasta: ahora, intervalo };
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

// Valor con su unidad, con tres decimales como mucho (los que guarda la API) y coma decimal (es-CL). `decimales` (0 a 3) los limita más:
// lo usa quien resume lo dibujado (la etiqueta flotante, el resumen del rango), con `decimalesParaRecorrido`.
const NUMEROS = [0, 1, 2, 3].map((d) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: d }));
const NUMERO = NUMEROS[3]!;
export const formatearNumero = (v: number, decimales = 3): string => (NUMEROS[decimales] ?? NUMERO).format(v);
export function formatearValor(valor: number | null, unidad: string, decimales = 3): string {
  if (valor === null) return '—';
  return `${formatearNumero(valor, decimales)} ${unidad}`;
}
// Cuántos decimales hacen falta para leer un punto de lo dibujado (docs/19 §4, bloque L, punto 4c): los que distinguen dos valores
// vecinos del recorrido, y no más. Con 11 °C de recorrido, uno («19,4 °C» y no «19,396 °C»); con 1,5 hPa, dos («1.009,51 hPa»); con 100,
// ninguno. Sin recorrido (un solo valor, o todos iguales) no hay con qué decidir: los tres de la API.
export function decimalesParaRecorrido(minimo: number, maximo: number): number {
  const recorrido = maximo - minimo;
  if (!Number.isFinite(recorrido) || recorrido <= 0) return 3;
  return Math.max(0, Math.min(3, Math.ceil(-Math.log10(recorrido)) + 2));
}
// El recorrido de todo lo dibujado (las series de valores: todas menos la de tiempos), para `decimalesParaRecorrido`.
export function decimalesDeSeries(series: readonly (readonly (number | null)[])[]): number {
  let min = Infinity;
  let max = -Infinity;
  for (let s = 1; s < series.length; s++) {
    for (const v of series[s]!) {
      if (v === null || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return decimalesParaRecorrido(min, max);
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

// Lo que el rango ya sabe (docs/19 §4, incremento 2, punto 6): mínimo, máximo y promedio de los PROMEDIOS recibidos. Es un promedio
// de promedios (cada cubo pesa lo mismo, tenga 1 o 360 lecturas) y así se nombra en pantalla. null si no hay ninguno.
export function resumenRango(valores: readonly (number | null)[]): { n: number; min: number; max: number; promedio: number } | null {
  const v = valores.filter((x): x is number => x !== null && Number.isFinite(x));
  if (v.length === 0) return null;
  let min = v[0]!;
  let max = v[0]!;
  let suma = 0;
  for (const x of v) {
    if (x < min) min = x;
    if (x > max) max = x;
    suma += x;
  }
  return { n: v.length, min, max, promedio: suma / v.length };
}

// Varias series en un eje de tiempo común (P3b, punto 5): la unión ordenada de los instantes y, por serie, su valor o null donde
// no tiene cubo. Se usa null y no `uPlot.join` (que existe en 1.6.32): join deja `undefined` en los huecos de alineación, y uPlot
// une la línea por encima de un `undefined`; el diseño pide hueco, que en uPlot es null.
export function alinearSeries(series: readonly { tiempos: readonly number[]; valores: readonly (number | null)[] }[]): [number[], ...(number | null)[][]] {
  const tiempos = [...new Set(series.flatMap((s) => s.tiempos))].sort((a, b) => a - b);
  const indice = new Map(tiempos.map((t, i) => [t, i]));
  const columnas = series.map((s) => {
    const col: (number | null)[] = tiempos.map(() => null);
    s.tiempos.forEach((t, i) => (col[indice.get(t)!] = s.valores[i] ?? null));
    return col;
  });
  return [tiempos, ...columnas];
}

// Paleta fija de 6 colores distinguibles para P3b (Okabe e Ito, 2008, «Color Universal Design»: pensada para quien no distingue rojo y
// verde), en el orden fijo validado en docs/19 §4 (tablero v2, A3): el primer dispositivo de la URL siempre lleva el primero. Los valores
// de cada tema viven en lib/tema.ts (SERIES, la única fuente); esta es la del tema claro.
export const PALETA: readonly string[] = SERIES.claro;

// ── Gráficas del tablero v3 (docs/19 §4, bloque L, punto 4) ──────────────────────────────────────────────────────────────────────
// Alto según la pantalla (L4g): 280 px en escritorio y 200 px en un teléfono (el contenedor mide menos de 560 px).
export const altoGrafico = (ancho: number): number => (ancho > 0 && ancho < 560 ? 200 : 280);
// Puntos sobre la serie principal solo con 30 o menos a la vista (L4d): con más, tapan la línea.
export const MAX_PUNTOS_DIBUJADOS = 30;

// La hora de la etiqueta flotante, en la zona del sitio y en 24 h («13/11/2026 18:45»).
export function horaEtiqueta(segundos: number, zona: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('es-CL', { timeZone: zona, hourCycle: 'h23', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(segundos * 1000)).map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

// Las filas de la etiqueta flotante (L4c) para el cubo `i`: una por serie con su valor y su unidad (o lo que la serie diga de sí, como las
// barras apiladas, que muestran el propio y no la suma); la banda mín–máx, en una sola fila; las series sin valor en ese cubo no se
// nombran (en la ficha, «lectura actual» existe solo donde llegó algo en vivo). Sin ninguna, una fila «sin datos». Todos los valores de
// la etiqueta llevan los mismos decimales como mucho (`decimales`, de `decimalesDeSeries`): el valor exacto está en «Ver los datos».
export interface FilaEtiqueta {
  nombre: string;
  valor: string;
  color: string;
  banda?: boolean; // la fila de la banda mín–máx: su muestra es la de la leyenda fija (un bloque tenue), no una línea
}
export function filasEtiqueta(
  series: readonly (readonly (number | null)[])[],
  lineas: readonly { label: string; stroke: string; leyenda?: (i: number) => string }[],
  banda: { alta: number; baja: number; color: string } | null,
  i: number,
  unidad: string,
  decimales = 3,
): FilaEtiqueta[] {
  const texto = (v: number | null | undefined): string | null => (v === null || v === undefined || !Number.isFinite(v) ? null : `${formatearNumero(v, decimales)} ${unidad}`);
  const filas: FilaEtiqueta[] = [];
  lineas.forEach((l, k) => {
    const s = k + 1;
    if (banda !== null && (s === banda.alta || s === banda.baja)) return;
    const valor = l.leyenda !== undefined ? l.leyenda(i) : texto(series[s]?.[i]);
    if (valor !== null) filas.push({ nombre: l.label, valor, color: l.stroke });
  });
  if (banda !== null) {
    const baja = series[banda.baja]?.[i];
    const alta = series[banda.alta]?.[i];
    if (baja !== null && baja !== undefined && alta !== null && alta !== undefined) filas.push({ nombre: 'mínimo–máximo', valor: `${formatearNumero(baja, decimales)} a ${formatearNumero(alta, decimales)} ${unidad}`, color: banda.color, banda: true });
  }
  return filas.length === 0 ? [{ nombre: 'sin datos', valor: '—', color: '' }] : filas;
}
