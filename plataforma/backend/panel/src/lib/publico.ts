// Vista pública por enlace, del lado del panel (P9; docs/19 §4, O, puntos 5, 6, 9 y 11). Lo puro, probado sin DOM: la lectura del token
// del fragmento ANTES de montar la aplicación (main.ts), la petición a `GET /publico` (el token solo en la cabecera `X-Enlace-Publico`,
// nunca en la ruta ni en la consulta; sin cookies), el armado de lo que se dibuja y los textos que lee quien visita. Lo mismo dibuja la
// vista previa de quien publica (Publicar.svelte): la respuesta tiene la misma forma (punto 3).
import { formatearValor, rotuloCada } from './grafico';
import { desfase, fechaHora, haceCuanto } from './tiempo';
import { simbolo } from './unidades';

// ── La ruta y el token (punto 5) ──────────────────────────────────────────────────────────────────────────────────────────────────
// La dirección que se comparte es `…/panel/#/v/<token>`: el fragmento no llega al servidor ni a la cabecera de procedencia. El token, como
// lo genera el backend (32 bytes en base64url: 43 caracteres; publico.ts del backend, FORMA_TOKEN). Uno con otra forma no se pide: la
// pantalla dice directamente «no disponible» (la misma respuesta que daría el servidor).
export const FORMA_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const RUTA_PUBLICA = /^#\/v(?:\/|$)/;
export const esRutaPublica = (fragmento: string): boolean => RUTA_PUBLICA.test(fragmento);
export function leerTokenPublico(fragmento: string): string | null {
  if (!esRutaPublica(fragmento)) return null;
  const resto = fragmento.slice(4); // tras «#/v/»
  const fin = resto.search(/[?#&/]/);
  const t = (fin < 0 ? resto : resto.slice(0, fin)).trim();
  return FORMA_TOKEN.test(t) ? t : null;
}
// Toda dirección del panel que vaya a un registro (un informe de errores, un aviso) se escribe sin el token: `#/v/…` (punto 5).
export function sinToken(texto: string): string {
  return texto.replace(/#\/v\/[^\s"'<>]*/g, '#/v/…');
}

// ── La respuesta de GET /publico y de la vista previa (la misma; el contrato, en el OpenAPI) ───────────────────────────────────────
export const VENTANAS = ['24h', '7d', '30d'] as const;
export type VentanaPublica = (typeof VENTANAS)[number];
export const ROTULO_VENTANA: Readonly<Record<VentanaPublica, string>> = { '24h': 'Últimas 24 horas', '7d': 'Últimos 7 días', '30d': 'Últimos 30 días' };
export const esVentana = (x: unknown): x is VentanaPublica => typeof x === 'string' && (VENTANAS as readonly string[]).includes(x);
export interface ZonaPublica { nombre: string; ahora: number | null; serie: (number | null)[] }
export interface MagnitudPublica { codigo: string; nombre: string; unidad: string; ahora: number | null; serie: (number | null)[]; protegido: boolean; zonas: ZonaPublica[] }
export interface VistaPublica {
  titulo: string; descripcion: string | null; sitio: string; zona_horaria: string; minimo_dispositivos: number;
  ventana: VentanaPublica; ventanas: VentanaPublica[]; intervalo: string; desde: string; hasta: string;
  ultimo_dato: string | null; tiempos: number[]; magnitudes: MagnitudPublica[];
}

// ── Textos de quien visita (punto 9 y la tabla del punto 11) ───────────────────────────────────────────────────────────────────────
export const TEXTO_NO_DISPONIBLE = 'Este enlace ya no está disponible. Pídele uno nuevo a quien te lo compartió.';
export const TEXTO_MUCHAS_VISITAS = 'Hay muchas visitas en este momento. La página se actualizará sola en un minuto.';
export const TEXTO_TARDANDO = 'Los datos están tardando. La página volverá a intentarlo en un minuto.';
export const TEXTO_SIN_CONEXION = 'No hay conexión con el servicio. La página volverá a intentarlo en un minuto.';
export const AVISO_PROTEGIDO = 'Algunos tramos se ocultan para proteger a equipos individuales.';
export const TEXTO_PIE = 'Vista pública de solo lectura · promedios del sitio';
// El indicador `protegido`, explicado en palabras de quien visita: qué es un hueco y por qué no se distingue de un tramo sin datos.
export const explicacionProtegido = (k: number): string =>
  `Cuando en un tramo reportan menos de ${k} equipos, ese tramo queda en blanco, igual que uno sin datos. Así nadie puede deducir la lectura de un equipo en particular.`;
export const textoPromedioDe = (k: number): string => `Promedio de ${k} o más dispositivos`;
export const SIN_DATO = 'Sin dato';
// Cada cuánto se refresca sola (punto 7: 60 s, el período más corto con que reporta un equipo del campus).
export const REFRESCO_MS = 60_000;

// ── La petición (puntos 5, 6 y 8) ────────────────────────────────────────────────────────────────────────────────────────────────
export type Resultado =
  | { tipo: 'ok'; vista: VistaPublica }
  | { tipo: 'no_disponible' }
  | { tipo: 'muchas_visitas' }
  | { tipo: 'tardando' }
  | { tipo: 'sin_conexion' };
// La consulta: la ventana y, SOLO en la primera petición de la pantalla, `carga=si` (cuenta un acceso; los refrescos no la llevan). El
// token nunca va aquí.
export function consultaPublica(ventana: VentanaPublica, carga: boolean): string {
  const q = new URLSearchParams({ ventana });
  if (carga) q.set('carga', 'si');
  return `/publico?${q.toString()}`;
}
// Sin cookies (`credentials: 'omit'`: aunque quien visita tenga una sesión del panel abierta en el navegador, no viaja), sin caché y sin
// procedencia. Un 404 es «no disponible», sea cual sea el motivo (punto 6); 429, muchas visitas; 503 u otro error del servidor, «tardando»
// (se conserva lo último mostrado). Una cancelación se propaga.
export async function pedirVistaPublica(token: string, ventana: VentanaPublica, carga: boolean, abortar?: AbortSignal, f: typeof fetch = fetch): Promise<Resultado> {
  let r: Response;
  try {
    r = await f(consultaPublica(ventana, carga), {
      method: 'GET',
      headers: { accept: 'application/json', 'X-Enlace-Publico': token },
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      redirect: 'error', // una redirección no se sigue: el token no viaja a otra dirección
      signal: abortar,
    });
  } catch (e) {
    if (abortar?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw e;
    return { tipo: 'sin_conexion' };
  }
  if (r.status === 404) return { tipo: 'no_disponible' };
  if (r.status === 429) return { tipo: 'muchas_visitas' };
  if (!r.ok) return { tipo: 'tardando' };
  try {
    const v = (await r.json()) as VistaPublica;
    return esVistaPublica(v) ? { tipo: 'ok', vista: v } : { tipo: 'tardando' };
  } catch {
    return { tipo: 'tardando' };
  }
}
// Lo mínimo para dibujar sin romperse; lo demás lo garantiza el contrato.
export function esVistaPublica(x: unknown): x is VistaPublica {
  const v = x as Partial<VistaPublica> | null;
  return typeof v === 'object' && v !== null && typeof v.titulo === 'string' && typeof v.sitio === 'string' && typeof v.zona_horaria === 'string'
    && Array.isArray(v.tiempos) && Array.isArray(v.magnitudes) && Array.isArray(v.ventanas) && esVentana(v.ventana);
}
export function textoDeResultado(r: Resultado): string | null {
  switch (r.tipo) {
    case 'no_disponible': return TEXTO_NO_DISPONIBLE;
    case 'muchas_visitas': return TEXTO_MUCHAS_VISITAS;
    case 'tardando': return TEXTO_TARDANDO;
    case 'sin_conexion': return TEXTO_SIN_CONEXION;
    default: return null;
  }
}

// ── Lo que se dibuja (punto 9) ───────────────────────────────────────────────────────────────────────────────────────────────────
// Un valor null (sin datos u oculto: se ven igual, a propósito) es «Sin dato» en la tarjeta y un hueco en la gráfica.
export interface ZonaDibujada { nombre: string; ahora: string }
export interface TarjetaMagnitud {
  codigo: string;
  nombre: string;
  unidad: string;
  ahora: string; // «21,4 °C» o «Sin dato»
  conValor: boolean;
  protegido: boolean;
  zonas: ZonaDibujada[];
  conDatos: boolean; // algún valor en la ventana (del sitio o de una zona): si no, la gráfica no se dibuja y se dice
  series: (number | null)[][]; // [tiempos, sitio, zona 1, …] para Grafico.svelte
  nombresSeries: string[]; // «Promedio del sitio», y el nombre de cada zona
}
export interface VistaDibujada {
  titulo: string;
  descripcion: string | null;
  sitio: string;
  zona: string;
  k: number;
  textoK: string;
  cada: string; // «cada 5 minutos»
  actualizado: string; // «Actualizado hace 3 min» o «Sin datos todavía»
  ultimoDato: string | null; // la hora del último dato en la zona del sitio (lo que se anuncia al refrescar)
  zonaHoraria: string; // «Horas del sitio (America/Santiago, UTC−03:00)»
  ventana: VentanaPublica;
  ventanas: { clave: VentanaPublica; rotulo: string }[];
  graficoVentana: { desde: number; hasta: number };
  tarjetas: TarjetaMagnitud[];
}
const conAlgo = (xs: readonly (number | null)[]): boolean => xs.some((x) => x !== null);
export function armarVista(v: VistaPublica, ahora: Date): VistaDibujada {
  const k = v.minimo_dispositivos;
  return {
    titulo: v.titulo,
    descripcion: v.descripcion,
    sitio: v.sitio,
    zona: v.zona_horaria,
    k,
    textoK: textoPromedioDe(k),
    cada: rotuloCada(v.intervalo),
    actualizado: v.ultimo_dato === null ? 'Sin datos todavía' : `Actualizado ${haceCuanto(v.ultimo_dato, ahora)}`,
    ultimoDato: v.ultimo_dato === null ? null : fechaHora(v.ultimo_dato, v.zona_horaria),
    zonaHoraria: `Horas del sitio (${v.zona_horaria}, ${desfase(v.zona_horaria, ahora)})`,
    ventana: v.ventana,
    ventanas: v.ventanas.filter(esVentana).map((clave) => ({ clave, rotulo: ROTULO_VENTANA[clave] })),
    graficoVentana: { desde: Math.floor(Date.parse(v.desde) / 1000), hasta: Math.floor(Date.parse(v.hasta) / 1000) },
    // La unidad, con su símbolo para personas (lib/unidades.ts: «Cel» → «°C»), sin convertir: quien visita no tiene preferencias.
    tarjetas: v.magnitudes.map((m) => ({
      codigo: m.codigo,
      nombre: m.nombre,
      unidad: simbolo(m.unidad),
      ahora: m.ahora === null ? SIN_DATO : formatearValor(m.ahora, simbolo(m.unidad), 1),
      conValor: m.ahora !== null,
      protegido: m.protegido,
      zonas: m.zonas.map((z) => ({ nombre: z.nombre, ahora: z.ahora === null ? SIN_DATO : formatearValor(z.ahora, simbolo(m.unidad), 1) })),
      conDatos: conAlgo(m.serie) || m.zonas.some((z) => conAlgo(z.serie)),
      series: [v.tiempos, m.serie, ...m.zonas.map((z) => z.serie)],
      nombresSeries: ['Promedio del sitio', ...m.zonas.map((z) => z.nombre)],
    })),
  };
}
