// P8, «Exportar datos» de un sitio (docs/19 §4, R, punto 6; HU-08, RF-34): lo puro, probado sin DOM. El rango (cinco opciones; «Entre
// fechas» como días completos en la zona del sitio, docs/13), las rutas de la exportación y de su estimación (`GET /sitios/{id}/exportar` y
// `…/exportar/estimacion`, sitios.controller.ts), los textos de la estimación, de la retención de las tramas y de la confirmación, y el
// aviso de cada error. La pantalla es Exportar.svelte.
import { ErrorApi, esCancelacion } from './api';
import { avisoDeError, type DatosAviso } from './avisos';
import type { Sitio } from './modelo';
import { ROTULO_ROL, puedeEn, type Matriz, type Rol, type Sesion } from './sesion';
import { instanteDesdeLocal, localDesdeInstante, relojSitio } from './tiempo';

// ── Formatos ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const FORMATOS = ['csv', 'xlsx', 'json'] as const;
export type FormatoExportacion = (typeof FORMATOS)[number];
// El rótulo, para qué sirve (la línea del diseño) y la extensión del archivo que entrega el servidor (el CSV llega en un .zip).
export const DATOS_FORMATO: Readonly<Record<FormatoExportacion, { rotulo: string; paraQue: string; extension: string }>> = {
  csv: { rotulo: 'CSV', paraQue: 'Para R, Python o QGIS: tres archivos en un .zip.', extension: 'zip' },
  xlsx: { rotulo: 'XLSX', paraQue: 'Para Excel o LibreOffice: una hoja por tipo de dato.', extension: 'xlsx' },
  json: { rotulo: 'JSON', paraQue: 'Para programas.', extension: 'json' },
};

// ── Rango ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const RANGOS_EXPORTACION = [
  { clave: '24h', rotulo: 'Últimas 24 horas' },
  { clave: '7d', rotulo: 'Últimos 7 días' },
  { clave: '30d', rotulo: 'Últimos 30 días' },
  { clave: 'todo', rotulo: 'Todo el historial (desde el año 2000)' },
  { clave: 'fechas', rotulo: 'Entre fechas' },
] as const;
export type RangoExportacion = (typeof RANGOS_EXPORTACION)[number]['clave'];
export const RANGO_POR_OMISION: RangoExportacion = '30d'; // el mismo que el servidor usa sin `desde`
// El piso del servidor (`rangoRazonable`: «desde no puede ser anterior al año 2000», en UTC; el 1/1/2000 se admite).
export const DESDE_EL_2000 = new Date(Date.UTC(2000, 0, 1));
export const PRIMER_DIA = '2000-01-01';
const DIA_MS = 86_400_000;
const ATRAS_MS: Readonly<Record<'24h' | '7d' | '30d', number>> = { '24h': DIA_MS, '7d': 7 * DIA_MS, '30d': 30 * DIA_MS };

// Los dos días de «Entre fechas», como los escribe `<input type="date">`: «AAAA-MM-DD», sin hora ni zona.
export interface DiasElegidos { desde: string; hasta: string }
export type Ventana = { desde: Date; hasta: Date; error: null } | { desde: null; hasta: null; error: string };

export const ERROR_DIAS_VACIOS = 'Elige el primer y el último día.';
export const ERROR_DIAS_ORDEN = 'El último día no puede ser anterior al primero.';
export const ERROR_DIAS_FUTURO = 'El último día puede ser, como mucho, hoy.';
export const ERROR_DIAS_ANTES_2000 = 'El primer día no puede ser anterior al 1 de enero de 2000.';

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
// Una fecha civil que existe (no «2026-02-30»); null si no.
function fechaValida(f: string): string | null {
  const m = FECHA.exec(f);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? f : null;
}
// «AAAA-MM-DD» más n días (n puede ser negativo), en el calendario: sin zonas, sin horas.
export function sumarDias(f: string, n: number): string {
  const m = FECHA.exec(f)!;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n)).toISOString().slice(0, 10);
}
// Hoy en la zona del sitio (el día que el calendario del sitio marca ahora), «AAAA-MM-DD».
export const hoyEnSitio = (ahora: Date, zona: string): string => localDesdeInstante(ahora, zona).slice(0, 10);
// Los días con que abre «Entre fechas»: la última semana completa hasta hoy, en la zona del sitio.
export function diasPorOmision(ahora: Date, zona: string): DiasElegidos {
  const hoy = hoyEnSitio(ahora, zona);
  return { desde: sumarDias(hoy, -6), hasta: hoy };
}
// Por qué esos días no sirven (null = sirven). El último día es como mucho hoy: el servidor admite `hasta` hasta un día en el futuro, y el
// fin del día de hoy está dentro de eso.
export function errorDeDias(d: DiasElegidos, hoy: string): string | null {
  const desde = fechaValida(d.desde);
  const hasta = fechaValida(d.hasta);
  if (desde === null || hasta === null) return ERROR_DIAS_VACIOS;
  if (desde < PRIMER_DIA) return ERROR_DIAS_ANTES_2000;
  if (hasta < desde) return ERROR_DIAS_ORDEN;
  if (hasta > hoy) return ERROR_DIAS_FUTURO;
  return null;
}

// El rango pedido como dos instantes [desde, hasta). Los relativos terminan en `ahora`; «Todo el historial» empieza en el piso del servidor;
// «Entre fechas» va del 00:00 del primer día al 00:00 del día siguiente al último, ambos en la zona del sitio (docs/13 regla 6), con las
// mismas funciones que el rango a medida del tablero y la ficha (un 00:00 que no existe por el cambio de hora cae en la hora siguiente). Un
// sitio al este de UTC tiene su 1 de enero de 2000 antes del piso: se acota al piso.
export function ventanaExportacion(rango: RangoExportacion, ahora: Date, zona: string, dias: DiasElegidos): Ventana {
  if (rango === 'todo') return { desde: DESDE_EL_2000, hasta: ahora, error: null };
  if (rango !== 'fechas') return { desde: new Date(ahora.getTime() - ATRAS_MS[rango]), hasta: ahora, error: null };
  const error = errorDeDias(dias, hoyEnSitio(ahora, zona));
  if (error !== null) return { desde: null, hasta: null, error };
  const desde = instanteDesdeLocal(`${dias.desde}T00:00`, zona);
  const hasta = instanteDesdeLocal(`${sumarDias(dias.hasta, 1)}T00:00`, zona);
  if (desde === null || hasta === null) return { desde: null, hasta: null, error: ERROR_DIAS_VACIOS };
  return { desde: desde.getTime() < DESDE_EL_2000.getTime() ? DESDE_EL_2000 : desde, hasta, error: null };
}
// Lo que identifica una estimación: el sitio y el rango elegido (los relativos no cambian de clave al correr el reloj). Una respuesta que
// llega con otra clave es de un sitio o un rango anterior y se descarta.
export const claveDeEstimacion = (sitioId: string, rango: RangoExportacion, dias: DiasElegidos): string =>
  rango === 'fechas' ? `${sitioId}|fechas|${dias.desde}|${dias.hasta}` : `${sitioId}|${rango}`;

const consulta = (v: { desde: Date; hasta: Date }): string => new URLSearchParams({ desde: v.desde.toISOString(), hasta: v.hasta.toISOString() }).toString();
export const rutaEstimacion = (sitioId: string, v: { desde: Date; hasta: Date }): string =>
  `/sitios/${encodeURIComponent(sitioId)}/exportar/estimacion?${consulta(v)}`;
export const rutaExportar = (sitioId: string, f: FormatoExportacion, v: { desde: Date; hasta: Date }): string =>
  `/sitios/${encodeURIComponent(sitioId)}/exportar?formato=${f}&${consulta(v)}`;
// El nombre si la respuesta no trae uno que sirva (el servidor manda `sitio_<código>_<desde>_<hasta>.<extensión>`).
export const nombrePorOmision = (codigo: string, f: FormatoExportacion): string => `sitio_${codigo}.${DATOS_FORMATO[f].extension}`;

// ── La estimación (`GET /sitios/{id}/exportar/estimacion`) ──────────────────────────────────────────────────────────────────────────────
export interface ConteoEstimado { filas: number; supera_tope: boolean }
export interface Estimacion {
  desde: string;
  hasta: string;
  tope_conteo: number;
  mediciones: ConteoEstimado;
  tramas: ConteoEstimado & { desde: string | null };
  eventos: ConteoEstimado;
  retencion_tramas_dias: number;
  bytes_aproximados: Record<FormatoExportacion, number>;
}
const numero = (x: number): string => x.toLocaleString('es-CL');
export const superaTope = (e: Estimacion): boolean => e.mediciones.supera_tope || e.tramas.supera_tope || e.eventos.supera_tope;
// «1,2 MB»: kB bajo un megabyte, GB desde mil megabytes; múltiplos de mil (como los MB del alta masiva, lib/lote.ts).
export function tamano(bytes: number): string {
  const f = (x: number): string => x.toLocaleString('es-CL', { maximumFractionDigits: 1 });
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 kB';
  if (bytes < 1_000_000) return `${numero(Math.max(1, Math.round(bytes / 1000)))} kB`;
  if (bytes < 1_000_000_000) return `${f(bytes / 1_000_000)} MB`;
  return `${f(bytes / 1_000_000_000)} GB`;
}
function cuenta(c: ConteoEstimado, uno: string, varios: string): string {
  if (c.supera_tope) return `más de ${numero(c.filas)} ${varios}`;
  return `${numero(c.filas)} ${c.filas === 1 ? uno : varios}`;
}
export const SIN_DATOS = 'Este rango no trae mediciones, tramas ni eventos: el archivo saldría solo con los encabezados. Prueba con un rango más amplio.';
// «≈ 45.210 mediciones, 9.044 tramas y 37 eventos; unos 1,2 MB en CSV». Con más filas que el tope del conteo, el tamaño es un mínimo.
export function textoEstimacion(e: Estimacion, f: FormatoExportacion): string {
  if (e.mediciones.filas + e.tramas.filas + e.eventos.filas === 0) return SIN_DATOS;
  const partes = `${cuenta(e.mediciones, 'medición', 'mediciones')}, ${cuenta(e.tramas, 'trama', 'tramas')} y ${cuenta(e.eventos, 'evento', 'eventos')}`;
  const rotulo = DATOS_FORMATO[f].rotulo;
  return superaTope(e) ? `${partes}; más de ${tamano(e.bytes_aproximados[f])} en ${rotulo}.` : `≈ ${partes}; unos ${tamano(e.bytes_aproximados[f])} en ${rotulo}.`;
}
// La línea de la retención de las tramas (docs/19 §4, R, puntos 1 y 6): el servidor guarda las tramas `retencion_tramas_dias`; si el rango
// empieza antes, el archivo las trae solo desde la más antigua que queda (`tramas.desde`), en la fecha del sitio. El margen: «Últimos 30 días»
// con 30 días de retención empieza justo en el corte, y la respuesta llega unos instantes después de pedirla (la primera corrida con
// navegador real decía «solo desde hoy» por esos milisegundos).
export const MARGEN_RETENCION_MS = 5 * 60_000;
export function lineaRetencion(e: Estimacion, ahora: Date, zona: string): string {
  const dias = e.retencion_tramas_dias;
  const base = `Las tramas originales se guardan ${dias} ${dias === 1 ? 'día' : 'días'}`;
  if (e.tramas.desde === null) return `${base}: este rango no trae ninguna.`;
  if (Date.parse(e.desde) < ahora.getTime() - dias * DIA_MS - MARGEN_RETENCION_MS) return `${base}: de este rango, solo desde el ${relojSitio(zona, new Date(e.tramas.desde)).slice(0, 10)}.`;
  return `${base}: este rango las trae todas.`;
}

// ── La confirmación (docs/19 §4, R, punto 6) ────────────────────────────────────────────────────────────────────────────────────────
// Sobre 250 MB estimados en el formato elegido, o con más filas que el tope del conteo (entonces el tamaño es solo un mínimo).
export const UMBRAL_CONFIRMAR_BYTES = 250_000_000;
export const pideConfirmar = (e: Estimacion, f: FormatoExportacion): boolean => e.bytes_aproximados[f] > UMBRAL_CONFIRMAR_BYTES || superaTope(e);
export function textoConfirmar(e: Estimacion, f: FormatoExportacion): string {
  const cuanto = superaTope(e) ? `más de ${tamano(e.bytes_aproximados[f])}, sin saber cuánto más` : `unos ${tamano(e.bytes_aproximados[f])}`;
  return `El archivo pesaría ${cuanto}. Tu navegador arma el archivo en memoria: con un rango menor es más seguro. ¿Descargar igual?`;
}

// ── Avisos ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const textoDescargado = (nombre: string, bytes: number): string => `Descargado ${nombre} (${tamano(bytes)}).`;
export const TEXTO_CANCELADA = 'Cancelaste la descarga: no se guardó ningún archivo.';
export const TEXTO_EN_CURSO = 'Hay otras exportaciones en curso en el servidor: no se guardó ningún archivo; reinténtalo en un momento.';
export const TEXTO_NO_EMPEZO = 'La exportación no pudo empezar porque la base no respondió: no se guardó ningún archivo; reinténtalo en un momento.';
export const TEXTO_CORTADA = 'La descarga se cortó antes de terminar y no se guardó ningún archivo: reintenta y, si vuelve a pasar, prueba con un rango menor.';
export const TEXTO_ESTIMAR_EN_CURSO = 'No se pudo estimar ahora: hay otras exportaciones en curso. Reinténtalo en un momento.';
export const TEXTO_ESTIMAR_LENTA = 'No se pudo estimar ahora: la base no respondió a tiempo. Reinténtalo en un momento o prueba con un rango más corto.';
// El cupo de exportaciones del servidor (2 exportaciones o estimaciones a la vez por proceso, `cupo-exportaciones.ts`): su 429 trae
// `codigo: 'exportaciones_en_curso'` en las tres rutas. Se reconoce por el código, nunca por el texto del mensaje, que puede cambiar; un 429
// sin ese código (el límite de tasa del proxy) es otro caso. El cuerpo entero llega en `ErrorApi.cuerpo` (lib/api.ts, `rechazo`).
export const CODIGO_CUPO = 'exportaciones_en_curso';
export const esCupoLleno = (e: unknown): boolean => e instanceof ErrorApi && e.codigo === 429 && e.cuerpo.codigo === CODIGO_CUPO;
// La descarga: el cupo y el 503 (la exportación falló antes de enviar nada: base caída o consulta pasada de tiempo) en llano. Un fallo que no
// es de la API llega al leer el cuerpo: la conexión se cortó a mitad y, como el archivo se arma en memoria antes de entregarlo, no queda
// ningún archivo a medias en el disco.
export function avisoDeExportacion(e: unknown): DatosAviso {
  if (esCupoLleno(e)) return { tipo: 'espera', texto: TEXTO_EN_CURSO };
  if (e instanceof ErrorApi) return e.codigo === 503 ? { tipo: 'espera', texto: TEXTO_NO_EMPEZO } : avisoDeError(e);
  if (esCancelacion(e)) return { tipo: 'info', texto: TEXTO_CANCELADA };
  return { tipo: 'error', texto: TEXTO_CORTADA };
}
// La estimación (comparte el cupo y tiene 10 s por consulta): el 429 que queda tras el reintento automático y el 503, en llano; lo demás,
// con el aviso de siempre. La pantalla los muestra con «Reintentar».
export function avisoDeEstimacion(e: unknown): DatosAviso {
  if (esCupoLleno(e)) return { tipo: 'espera', texto: TEXTO_ESTIMAR_EN_CURSO };
  if (e instanceof ErrorApi && e.codigo === 503) return { tipo: 'espera', texto: TEXTO_ESTIMAR_LENTA };
  const a = avisoDeError(e);
  return { tipo: a.tipo, texto: `No se pudo calcular lo que trae este rango. ${a.texto}` };
}
// Los tiempos de la estimación: se pide tras una pausa desde el último cambio (escribir una fecha no es una petición por tecla) y, ante el
// cupo lleno, se reintenta una sola vez, solo.
export const ESPERA_ESTIMACION_MS = 300;
export const REINTENTO_ESTIMACION_MS = 1500;

// ── Quién exporta ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// La acción `exportar` en ese sitio (administrador de sitio y del sistema, investigador: docs/20 §6). Sin sesión (una prueba que monta la
// ficha sola) se deja al servidor; el administrador del sistema, en todos. El servidor decide igual: si el panel se equivoca, su 403 se ve.
export function puedeExportarEn(s: Sesion | null, codigo: string): boolean {
  if (s === null || s.sistema || s.administrador_sistema === true) return true;
  return puedeEn(s, 'exportar', codigo);
}
export const sitiosQueExporta = (s: Sesion, sitios: readonly Sitio[]): Sitio[] => sitios.filter((x) => puedeExportarEn(s, x.codigo));
// «Tu rol no exporta…»: quién sí, según la matriz que trae la sesión (si mañana la matriz cambia, el texto cambia solo).
export function textoSinExportar(m: Matriz | undefined): string {
  const perfiles = Object.keys(m ?? {}).filter((rol) => (m?.[rol] ?? []).includes('exportar')).map((rol) => ROTULO_ROL[rol as Rol] ?? rol);
  if (perfiles.length === 0) return 'Tu rol no exporta datos en ningún sitio: pídeselos a quien administra el tuyo.';
  const ultimo = perfiles.at(-1)!;
  // «administrador e investigación»: «e» ante un sonido «i» (no ante «hie»).
  const quienes = perfiles.length === 1
    ? `los exporta el perfil de ${ultimo}`
    : `los exportan los perfiles de ${perfiles.slice(0, -1).join(', ')} ${/^h?i(?!e)/i.test(ultimo) ? 'e' : 'y'} ${ultimo}`;
  return `Tu rol no exporta datos en ningún sitio: ${quienes}. Si los necesitas, pídeselos a quien administra el tuyo.`;
}
