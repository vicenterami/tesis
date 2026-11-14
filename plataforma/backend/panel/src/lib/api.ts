// Un solo cliente HTTP para el panel (docs/19 §6): mismo origen (el backend sirve el panel; en desarrollo, Vite reenvía), la cookie de
// sesión con cada petición (`credentials: 'same-origin'`; ningún script la lee: es HttpOnly, docs/20 §3), la cabecera anti-CSRF
// `X-Pedido: panel` en toda petición que escribe (docs/20 §5), cada código de error con su acción, y nunca texto del usuario
// interpolado en una ruta. Lo que vale para toda la aplicación se resuelve AQUÍ, una vez (docs/19 §6, «un solo cliente»):
//   401 → la sesión no existe o venció: avisa a quien escucha (App guarda la ruta y muestra el inicio de sesión, P10);
//   403 por clave temporal → avisa (App muestra el cambio de clave obligatorio);
//   409 → ErrorApi con «alguien lo cambió, recarga» (bloqueo optimista, docs/10 §8.4 punto 28);
//   429 → ErrorApi con los segundos de espera que trae el cuerpo (`reintentar_en_s`, o el «reintenta en N s» del mensaje);
//   sin red → ErrorApi con código 0, «sin conexión».
// Una petición cancelada (AbortController) se propaga como AbortError, nunca como error que mostrar.
export class ErrorApi extends Error {
  constructor(
    public readonly codigo: number,
    public readonly accion: string,
    mensaje: string,
    // El `message` del cuerpo (texto o lista de motivos del 400), para las pantallas que lo muestran tal cual (alta de usuarios, clave).
    public readonly motivos: readonly string[] = [],
    public readonly reintentarEnS: number | null = null,
    // El cuerpo entero del error, para las pantallas que leen algo más que el mensaje (el 409 `reactivable` del alta de usuarios).
    public readonly cuerpo: Readonly<Record<string, unknown>> = {},
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

const ACCIONES: Readonly<Record<number, string>> = {
  0: 'revisa tu conexión; se reintenta al volver',
  400: 'revisa el filtro o la fecha',
  401: 'tu sesión venció; entra de nuevo',
  403: 'tu rol en este sitio no lo permite',
  404: 'ya no existe; vuelve al inventario',
  409: 'alguien lo cambió entretanto; recarga para ver el valor nuevo',
  421: 'el servicio no atiende esta dirección; entra por el nombre del servidor',
  429: 'demasiados intentos; espera un momento y reintenta',
  503: 'el servicio está saturado; se reintenta solo',
};

// Las condiciones abiertas se piden completas, hasta el máximo de la API; el panel avisa si llega al tope (docs/19 §2).
export const LIMITE_ABIERTAS = 500;
export const URL_ABIERTAS = `/condiciones?abiertas=true&limite=${LIMITE_ABIERTAS}`;

export const CABECERA_PEDIDO = 'X-Pedido';
const VALOR_PEDIDO = 'panel';
// El texto del 403 del guardia cuando la sesión tiene clave temporal (sesion/guardia.ts). Se reconoce por la ruta que nombra.
const MARCA_TEMPORAL = '/sesion/clave';
// El 403 de la sesión restringida por términos sin aceptar (docs/20 §12): el cuerpo trae un código propio; se reconoce por ese código
// o, como el de la clave temporal, por la ruta que nombra el mensaje (`/terminos`).
const MARCA_TERMINOS = '/terminos';
export function esTerminosPendientes(cuerpo: { codigo?: unknown; message?: unknown }, motivos: readonly string[]): boolean {
  return (typeof cuerpo.codigo === 'string' && cuerpo.codigo.includes('terminos')) || motivos.some((m) => m.includes(MARCA_TERMINOS));
}

export const escribe = (metodo: string): boolean => !['GET', 'HEAD', 'OPTIONS'].includes(metodo.toUpperCase());

// Texto para la persona a partir de cualquier error de carga: el de la API con su acción, o la falta de conexión.
export function mensajeError(e: unknown): string {
  if (e instanceof ErrorApi) return e.codigo === 0 ? `sin conexión con el servicio: ${e.accion}` : `${e.message}: ${e.accion}`;
  return 'sin conexión con el servicio';
}

export function accionPara(codigo: number, reintentarEnS: number | null = null): string {
  if (codigo === 429 && reintentarEnS !== null) return `demasiados intentos; espera ${reintentarEnS} s y reintenta`;
  return ACCIONES[codigo] ?? 'inténtalo de nuevo en un momento';
}

// ── Quién escucha lo que vale para toda la aplicación (App.svelte) ─────────────────────────────────────────────────────────────
export type MotivoSesion = 'sin_sesion' | 'clave_temporal' | 'terminos';
type Oyente = (motivo: MotivoSesion) => void;
const oyentes = new Set<Oyente>();
export function alPerderSesion(f: Oyente): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}
function avisar(motivo: MotivoSesion): void {
  for (const f of [...oyentes]) f(motivo);
}
// Generación de la sesión: sube cada vez que la sesión del navegador cambia (entrar, cambiar la clave, salir). Una petición iniciada
// antes de ese cambio que vuelve después con 401 o 403 habla de la sesión anterior: su aviso se descarta (no saca de una sesión recién
// abierta ni abre el cambio de clave sin sesión). La respuesta igual llega a quien la pidió como ErrorApi.
let generacion = 0;
// La baja de la propia cuenta (POST /cuenta/baja) también cierra todas sus sesiones (revisión del 11/11/2026): una petición atrasada que
// vuelve con 401 después de la baja no debe mostrar «tu sesión venció».
export const cambiaLaSesion = (metodo: string, ruta: string): boolean =>
  (metodo === 'POST' && (ruta === '/sesion' || ruta === '/sesion/clave' || ruta === '/cuenta/baja')) || (metodo === 'DELETE' && (ruta === '/sesion' || ruta.startsWith('/sesion?')));

// ── El cuerpo de un error: el `message` de Nest (texto o lista) y, en un 429, los segundos de espera ──────────────────────────────
interface CuerpoError {
  message?: unknown;
  reintentar_en_s?: unknown;
  codigo?: unknown;
}
async function leerCuerpoError(r: Response): Promise<CuerpoError> {
  try {
    const x: unknown = await r.json();
    return typeof x === 'object' && x !== null ? (x as CuerpoError) : {};
  } catch {
    return {};
  }
}
export function segundosDeEspera(cuerpo: CuerpoError): number | null {
  if (typeof cuerpo.reintentar_en_s === 'number' && Number.isFinite(cuerpo.reintentar_en_s) && cuerpo.reintentar_en_s >= 0) return Math.ceil(cuerpo.reintentar_en_s);
  const m = typeof cuerpo.message === 'string' ? /reintenta en (\d+) s/.exec(cuerpo.message) : null;
  return m ? Number(m[1]) : null;
}
const motivosDe = (cuerpo: CuerpoError): string[] =>
  Array.isArray(cuerpo.message) ? cuerpo.message.filter((x): x is string => typeof x === 'string') : typeof cuerpo.message === 'string' ? [cuerpo.message] : [];

export interface Opciones {
  cuerpo?: unknown;
  abortar?: AbortSignal;
  // false = quien llama trata el 401 y el 403 él mismo (el inicio de sesión: un 401 ahí es «credenciales no válidas», no «venció»).
  central?: boolean;
  // Las listas paginadas (docs/19 §6 y §4 tablero v2, I): el total va en `X-Total` y el cursor de la página siguiente en `X-Siguiente`;
  // el cuerpo sigue siendo la lista. Quien las necesita pasa este oyente; quien no, no cambia nada.
  alPaginar?: (p: Paginacion) => void;
}

// null = la respuesta no trae la cabecera (un backend anterior, o una ruta sin paginación): quien llama decide qué hacer sin ella.
export interface Paginacion {
  total: number | null;
  siguiente: string | null;
}
export function leerPaginacion(h: Headers): Paginacion {
  const t = h.get('x-total');
  const n = t === null || t.trim() === '' ? NaN : Number(t);
  const sig = h.get('x-siguiente');
  return { total: Number.isInteger(n) && n >= 0 ? n : null, siguiente: sig === null || sig.trim() === '' ? null : sig.trim() };
}

// Convierte una respuesta no 2xx en ErrorApi y, si vale para toda la aplicación (401, 403 de clave temporal), lo avisa.
async function rechazo(r: Response, metodo: string, ruta: string, central: boolean, generacionAlPedir: number): Promise<ErrorApi> {
  const cuerpo = await leerCuerpoError(r);
  const motivos = motivosDe(cuerpo);
  const espera = r.status === 429 ? segundosDeEspera(cuerpo) : null;
  if (generacionAlPedir !== generacion) central = false; // atrasada: habla de una sesión que ya no es la de ahora
  if (central && r.status === 401) avisar('sin_sesion');
  if (central && r.status === 403 && motivos.some((m) => m.includes(MARCA_TEMPORAL))) avisar('clave_temporal');
  else if (central && r.status === 403 && esTerminosPendientes(cuerpo, motivos)) avisar('terminos');
  return new ErrorApi(r.status, accionPara(r.status, espera), `HTTP ${r.status} en ${metodo === 'GET' ? '' : `${metodo} `}${ruta}`, motivos, espera, cuerpo as Record<string, unknown>);
}

// fetch con lo común. Sin red, fetch lanza TypeError: se vuelve ErrorApi(0). Una cancelación (AbortError) se propaga tal cual.
async function llamar(metodo: string, ruta: string, o: Opciones, acepta: string): Promise<Response> {
  const cabeceras: Record<string, string> = { accept: acepta };
  if (o.cuerpo !== undefined) cabeceras['content-type'] = 'application/json';
  if (escribe(metodo)) cabeceras[CABECERA_PEDIDO] = VALOR_PEDIDO;
  const generacionAlPedir = generacion;
  let r: Response;
  try {
    r = await fetch(ruta, {
      method: metodo,
      headers: cabeceras,
      credentials: 'same-origin',
      body: o.cuerpo === undefined ? undefined : JSON.stringify(o.cuerpo),
      signal: o.abortar,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    if (o.abortar?.aborted) throw e;
    throw new ErrorApi(0, accionPara(0), `sin conexión en ${ruta}`);
  }
  if (!r.ok) throw await rechazo(r, metodo, ruta, o.central ?? true, generacionAlPedir);
  if (cambiaLaSesion(metodo.toUpperCase(), ruta)) generacion++;
  return r;
}

export async function pedir<T>(metodo: string, ruta: string, o: Opciones = {}): Promise<T> {
  const r = await llamar(metodo, ruta, o, 'application/json');
  const texto = await r.text();
  const datos = (texto === '' ? undefined : JSON.parse(texto)) as T;
  o.alPaginar?.(leerPaginacion(r.headers));
  return datos;
}

export function obtener<T>(ruta: string, abortar?: AbortSignal): Promise<T> {
  return pedir<T>('GET', ruta, { abortar });
}

// Una página de una lista con su total y su cursor (las cabeceras), en una sola llamada.
export async function obtenerPagina<T>(ruta: string, abortar?: AbortSignal): Promise<{ filas: T[]; total: number | null; siguiente: string | null }> {
  let p: Paginacion = { total: null, siguiente: null };
  const filas = await pedir<T[]>('GET', ruta, { abortar, alPaginar: (x) => (p = x) });
  return { filas, ...p };
}

// «Gana la última» (docs/19 §6): cada llamada cancela la anterior y entrega su señal; `cancelar()` corta la que esté en vuelo (al
// desmontar la pantalla). Así una respuesta vieja nunca pisa a la nueva al cambiar de pantalla o de filtro.
export function ultimaGana(): { senal(): AbortSignal; cancelar(): void } {
  let actual: AbortController | null = null;
  return {
    senal() {
      actual?.abort();
      actual = new AbortController();
      return actual.signal;
    },
    cancelar() {
      actual?.abort();
      actual = null;
    },
  };
}
export const esCancelacion = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

// ── Descargas (exportar CSV/JSON) ────────────────────────────────────────────────────────────────────────────────────────────
// Por fetch con la sesión y un Blob, en UN solo ayudante; nunca un <a href> directo a la API ni un token en la URL (docs/19 §6,
// decidido al implementar el 08/11/2026): con la sesión vencida, un enlace directo abría el JSON del 401 en una pestaña; aquí el 401
// pasa por el manejo central (vuelve al inicio de sesión) y la persona ve un aviso, no un archivo roto. El archivo se arma en memoria:
// la exportación de un dispositivo (por tandas, tope por petición en el servidor) cabe; una por sitio (Etapa 4) se medirá antes.
export function nombreDeArchivo(cabecera: string | null, porDefecto: string): string {
  const m = cabecera === null ? null : /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cabecera);
  let nombre = '';
  try {
    nombre = m ? decodeURIComponent(m[1]!).trim() : '';
  } catch {
    nombre = ''; // un «%» mal formado (URIError): el nombre de por defecto, nunca una descarga que falla
  }
  // Solo el nombre: nada de rutas ni caracteres que un sistema de archivos interprete; y solo las extensiones que la API entrega
  // (.csv y .json, corrección del 11/11/2026): un «.exe» o un «.html» ajeno nunca llega al disco con ese nombre.
  return /^[\p{L}\p{N}_.\- ]{1,120}$/u.test(nombre) && !nombre.startsWith('.') && /\.(csv|json)$/i.test(nombre) ? nombre : porDefecto;
}

export interface Guardador {
  crearUrl(b: Blob): string;
  liberarUrl(u: string): void;
  pulsar(url: string, nombre: string): void;
}
const guardadorDelNavegador: Guardador = {
  crearUrl: (b) => URL.createObjectURL(b),
  liberarUrl: (u) => URL.revokeObjectURL(u),
  pulsar(url, nombre) {
    const a = document.createElement('a'); // en memoria: nunca se inserta en la página
    a.href = url;
    a.download = nombre;
    a.rel = 'noopener';
    a.click();
  },
};

export async function descargar(ruta: string, porDefecto: string, abortar?: AbortSignal, g: Guardador = guardadorDelNavegador): Promise<{ nombre: string; bytes: number }> {
  const r = await llamar('GET', ruta, { abortar }, 'text/csv, application/json');
  const blob = await r.blob();
  return entregar(blob, nombreDeArchivo(r.headers.get('content-disposition'), porDefecto), g);
}

// La misma entrega para lo que el panel ya tiene en memoria y nunca vuelve a pedir (las credenciales del alta masiva, que llegan una
// sola vez; las filas rechazadas para corregir): un Blob, un enlace en memoria y la URL liberada después (docs/19 §6, «toda descarga
// nueva usa el mismo ayudante»). Sin petición: no hay sesión que comprobar.
export function descargarTexto(contenido: string, nombre: string, tipo = 'text/csv;charset=utf-8', g: Guardador = guardadorDelNavegador): { nombre: string; bytes: number } {
  return entregar(new Blob([contenido], { type: tipo }), nombreDeArchivo(`attachment; filename="${nombre}"`, 'descarga.csv'), g);
}

function entregar(blob: Blob, nombre: string, g: Guardador): { nombre: string; bytes: number } {
  const url = g.crearUrl(blob);
  try {
    g.pulsar(url, nombre);
  } finally {
    // El navegador ya tomó la descarga al pulsar; se libera en el turno siguiente (Firefox la necesita viva hasta entonces).
    setTimeout(() => g.liberarUrl(url), 0);
  }
  return { nombre, bytes: blob.size };
}

// ── La sesión: comprobación liviana cuando el canal en vivo cae por rechazo del servidor ──────────────────────────────────────────
// El canal en vivo revalida la sesión en cada latido y se cierra si venció (docs/20 §10, R2); EventSource no entrega el código. Una
// petición `GET /sesion` dice si fue eso: si responde 401, el manejo central lleva al inicio de sesión. Como mucho una cada 5 s.
let ultimaComprobacion = 0;
export function comprobarSesion(ahora: number = Date.now()): void {
  if (ahora - ultimaComprobacion < 5000) return;
  ultimaComprobacion = ahora;
  pedir('GET', '/sesion').catch(() => undefined);
}
