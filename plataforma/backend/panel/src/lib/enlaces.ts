// P9, del lado de quien publica (docs/19 §4, O, puntos 3, 4, 10 y 11; el contrato, en el OpenAPI: `/sitios/{id}/enlaces…`). Lo puro,
// probado sin DOM: los tipos de la lista, el formulario hecho cuerpo, los textos de la tabla del punto 11 y el estado de cada enlace. La
// pantalla es Publicar.svelte.
import { ErrorApi } from './api';
import { avisoDeError, type DatosAviso } from './avisos';
import type { Sesion } from './sesion';
import type { Sitio } from './modelo';
import { ROTULO_VENTANA, type VentanaPublica, type VistaPublica } from './publico';
import { fechaHora } from './tiempo';

export type EstadoEnlace = 'vigente' | 'vence_pronto' | 'vencido' | 'revocado';
export interface EnlaceListado {
  id: string; titulo: string; descripcion: string | null; magnitudes: { codigo: string; nombre: string; unidad: string }[]; ventana_maxima: VentanaPublica;
  zonas: { id: string; nombre: string }[]; creado_por: { id: string; nombre: string } | null; creado_en: string; expira_en: string;
  renovado_en: string | null; revocado_en: string | null; revocado_por: { id: string; nombre: string } | null; accesos_7d: number;
  estado: EstadoEnlace; renovable: boolean; retencion_dias: number; anonimizado_en: string | null;
}
export interface EnlaceCreado extends EnlaceListado { token: string; direccion: string; avisos: string[] }
export interface VistaPrevia extends VistaPublica { avisos: string[] }
export interface MinimoSitio { minimo_dispositivos: number; fijado: boolean; por_omision: number; piso: number; maximo: number; avisos?: string[] }
export interface TopeEnlaces { max_enlaces: number; fijado: boolean; por_omision: number; techo: number; vivos: number }
export interface MagnitudCatalogo { codigo: string; nombre: string; unidad: string }

// ── Listas cerradas (las del backend, publico.ts) ───────────────────────────────────────────────────────────────────────────────────
export const PLAZOS = [7, 30, 90, 180] as const;
export const ROTULO_PLAZO: Readonly<Record<number, string>> = { 7: '7 días (una actividad)', 30: '30 días (un mes)', 90: '90 días (un trimestre)', 180: '180 días (un semestre)' };
export const PLAZO_POR_OMISION = 30;
export const RETENCION = { porDefecto: 90, minimo: 31, maximo: 365 } as const;
export const MAX_TITULO = 80;
export const MAX_DESCRIPCION = 300;
export const MAX_MAGNITUDES = 12;
export const MAX_ZONAS = 20;
export const ROTULO_ESTADO: Readonly<Record<EstadoEnlace, string>> = { vigente: 'vigente', vence_pronto: 'vence pronto', vencido: 'vencido', revocado: 'revocado' };

// ── Textos del punto 10 y de la tabla del punto 11 ─────────────────────────────────────────────────────────────────────────────────
export const AVISO_TEXTO_PUBLICO = 'Este texto lo verá cualquiera con el enlace: sin nombres de personas ni datos personales.';
export const AVISO_NOMBRES_PUBLICOS = 'El nombre del sitio y el de cada zona publicada también los verá cualquiera con el enlace: sin nombres de personas ni datos personales.';
export const SIN_MAGNITUDES = 'Elige al menos una magnitud para publicar.';
export const NO_RENOVABLE = 'Este enlace ya no se puede renovar. Crea uno nuevo.';
export const AVISO_TODOS_LOS_ENLACES = 'Este mínimo afecta a todos los enlaces públicos de este sitio.';
export const TOKEN_UNA_VEZ = 'Esta dirección no se vuelve a mostrar: cópiala ahora. Si se pierde, crea otro enlace y revoca este.';
export const sinDatosEnVentana = (nombre: string): string => `Sin datos de «${nombre}» en esta ventana: el visitante verá la tarjeta vacía.`;
export const textoAcorta = (actual: string, nueva: string, zona: string): string =>
  `Vencía el ${fechaHora(actual, zona)}; con este plazo vencerá antes, el ${fechaHora(nueva, zona)}.`;
// Lo que un visitante podría deducir con un k dado, en palabras de quien administra (punto 2).
export function deduciblePorK(k: number): string {
  if (k === 1) return 'Con k = 1, el promedio de una zona o de un tramo con un solo equipo es la lectura de ese equipo, tal cual.';
  return `Con k = ${k}, un valor sale solo si lo aportan ${k} o más equipos; de un tramo al siguiente, si entra o sale uno, comparar los dos promedios acota su lectura.`;
}

// ── Quién publica y dónde ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// Los sitios donde la persona tiene la acción `enlaces` (la matriz de la sesión; docs/20 §6). El administrador del sistema, en todos. El
// servidor decide igual: si el panel se equivoca, su 403 se muestra.
export function sitiosQuePublica(s: Sesion, sitios: readonly Sitio[]): Sitio[] {
  if (s.sistema || s.administrador_sistema === true) return [...sitios];
  return sitios.filter((x) => {
    const deSesion = s.sitios.find((y) => y.codigo === x.codigo);
    return deSesion !== undefined && (s.permisos?.[deSesion.rol] ?? []).includes('enlaces');
  });
}

// ── El formulario ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface FormularioVista {
  titulo: string;
  descripcion: string;
  magnitudes: string[]; // códigos, en el orden en que se muestran
  ventana_maxima: VentanaPublica;
  zonas: string[]; // ids; vacía = sin desglose
  plazo_dias: number;
  retencion_dias: number;
}
export const FORMULARIO_VACIO: FormularioVista = { titulo: '', descripcion: '', magnitudes: [], ventana_maxima: '7d', zonas: [], plazo_dias: PLAZO_POR_OMISION, retencion_dias: RETENCION.porDefecto };
export function cuerpoVista(f: FormularioVista): Record<string, unknown> {
  const descripcion = f.descripcion.trim();
  return {
    titulo: f.titulo.trim(),
    descripcion: descripcion === '' ? null : descripcion,
    magnitudes: [...f.magnitudes],
    ventana_maxima: f.ventana_maxima,
    zonas: [...f.zonas],
    plazo_dias: f.plazo_dias,
    retencion_dias: f.retencion_dias,
  };
}
// La vista previa acepta el formulario sin título (aún se está escribiendo) y con la ventana que se dibuja.
export function cuerpoPrevia(f: FormularioVista, ventana: VentanaPublica): Record<string, unknown> {
  return { ...cuerpoVista(f), ventana };
}
// Lo que falta para publicar, en el orden en que se lee el formulario (el primero va junto al botón, Boton.motivoDesactivado). Las reglas
// finas del texto (caracteres invisibles, marcas apiladas) las decide el servidor y su 400 se muestra tal cual.
export function faltaParaPublicar(f: FormularioVista): string | null {
  if (f.titulo.trim() === '') return 'Escribe un título.';
  if (f.titulo.trim().length > MAX_TITULO) return `El título admite hasta ${MAX_TITULO} caracteres.`;
  if (f.descripcion.trim().length > MAX_DESCRIPCION) return `La descripción admite hasta ${MAX_DESCRIPCION} caracteres.`;
  if (f.magnitudes.length === 0) return SIN_MAGNITUDES;
  if (f.magnitudes.length > MAX_MAGNITUDES) return `Hasta ${MAX_MAGNITUDES} magnitudes por enlace.`;
  if (f.zonas.length > MAX_ZONAS) return `Hasta ${MAX_ZONAS} zonas por enlace.`;
  if (!Number.isInteger(f.retencion_dias) || f.retencion_dias < RETENCION.minimo || f.retencion_dias > RETENCION.maximo) {
    return `Conserva el texto entre ${RETENCION.minimo} y ${RETENCION.maximo} días.`;
  }
  return null;
}
// La ventana de la vista previa: nunca más larga que la máxima del enlace (el servidor respondería 400).
export function ventanaPreviaValida(v: VentanaPublica, maxima: VentanaPublica): VentanaPublica {
  const orden: VentanaPublica[] = ['24h', '7d', '30d'];
  return orden.indexOf(v) <= orden.indexOf(maxima) ? v : maxima;
}
// «Publicar» espera la vista previa de la selección que se publica (decidido el 17/11/2026, tras la revisión de las pantallas): los avisos
// de lo que un visitante podría deducir deben verse ANTES de confirmar (punto 3). La firma es lo que cambia la vista previa y sus avisos:
// magnitudes, zonas y ventana máxima (el título y la descripción se dibujan desde el formulario; el plazo y la retención no se ven).
export const firmaDeSeleccion = (f: Pick<FormularioVista, 'magnitudes' | 'zonas' | 'ventana_maxima'>): string =>
  JSON.stringify({ magnitudes: f.magnitudes, zonas: f.zonas, ventana_maxima: f.ventana_maxima });
export const ESPERA_PREVIA = 'Espera la vista previa: lo que verá quien visite y sus avisos se muestran antes de publicar.';
export const FALLO_PREVIA = 'La vista previa no se pudo cargar: reintenta antes de publicar.';
export const ESPERA_MINIMO = 'Espera a que se guarde el mínimo del sitio: los avisos de la vista previa dependen de él.';
// Sin vista previa no se publica; mientras se guarda el k del sitio, tampoco (la vista previa y sus avisos se rehacen con el k nuevo).
export function motivoPorPrevia(x: { hayPrevia: boolean; firmaActual: string; firmaPrevia: string | null; esperando: boolean; cargando: boolean; fallo: boolean; guardandoMinimo: boolean }): string | null {
  if (x.guardandoMinimo) return ESPERA_MINIMO;
  if (x.esperando || x.cargando) return ESPERA_PREVIA;
  if (x.fallo) return FALLO_PREVIA;
  return x.hayPrevia && x.firmaPrevia === x.firmaActual ? null : ESPERA_PREVIA;
}
// El 409 `minimo_cambio` de fijar el k (bloqueo optimista): el k que rige ahora, o null si el error es otro.
export function minimoQueRige(e: unknown): number | null {
  if (!(e instanceof ErrorApi) || e.codigo !== 409 || e.cuerpo.codigo !== 'minimo_cambio') return null;
  return typeof e.cuerpo.minimo_dispositivos === 'number' ? e.cuerpo.minimo_dispositivos : null;
}
// La dirección se arma con el nombre con que entró quien publica (el origen de esta página). Si ese nombre solo sirve en su equipo o en una
// red privada (localhost, loopback, redes privadas y la de direcciones compartidas del RFC 6598, o un nombre .local), se le avisa.
export const AVISO_ORIGEN_LOCAL = 'Esta dirección usa el nombre con que entraste; para compartirla, entra por el nombre público del servidor.';
export function octetosLocales(o: readonly number[]): boolean {
  const [a, b] = o;
  if (o.length !== 4 || o.some((x) => !Number.isInteger(x) || x < 0 || x > 255) || a === undefined || b === undefined) return false;
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a === 0;
}
// Nombres: localhost, uno de una sola etiqueta (sin punto: solo lo resuelve la red local) y los sufijos de uso local (.local, .lan,
// .internal, .home.arpa). IPv6: loopback, ULA, enlace local y una IPv4 mapeada (::ffff:…, en puntos o en hexadecimal).
const SUFIJOS_LOCALES = ['.localhost', '.local', '.lan', '.internal', '.home.arpa'];
export function origenLocal(nombre: string): boolean {
  const h = nombre.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (h === '') return false;
  if (h.includes(':')) {
    const mapeada = /^::ffff:(?:(\d{1,3}(?:\.\d{1,3}){3})|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(h);
    if (mapeada) {
      const o = mapeada[1] !== undefined ? mapeada[1].split('.').map(Number) : [parseInt(mapeada[2]!, 16), parseInt(mapeada[3]!, 16)].flatMap((x) => [x >> 8, x & 255]);
      return octetosLocales(o);
    }
    return h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return octetosLocales(h.split('.').map(Number));
  return h === 'localhost' || !h.includes('.') || SUFIJOS_LOCALES.some((s) => h.endsWith(s) || h === s.slice(1));
}

// Las magnitudes que la vista previa trae sin ningún valor en la ventana (punto 11: el visitante verá la tarjeta vacía).
export function avisosSinDatos(p: VistaPublica): string[] {
  return p.magnitudes
    .filter((m) => m.ahora === null && !m.serie.some((x) => x !== null) && !m.zonas.some((z) => z.ahora !== null || z.serie.some((x) => x !== null)))
    .map((m) => sinDatosEnVentana(m.nombre));
}

// ── La lista ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// «Temperatura y Humedad; hasta 7 días; zonas Norte y Sur» (o «sin desglose por zona»).
const enumerar = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`);
export function quePublica(e: Pick<EnlaceListado, 'magnitudes' | 'ventana_maxima' | 'zonas'>): string {
  const ventana = ROTULO_VENTANA[e.ventana_maxima].replace(/^Últim[ao]s /, 'hasta ');
  const zonas = e.zonas.length === 0 ? 'sin desglose por zona' : `${e.zonas.length === 1 ? 'zona' : 'zonas'} ${enumerar(e.zonas.map((z) => z.nombre))}`;
  return `${enumerar(e.magnitudes.map((m) => m.nombre))}; ${ventana}; ${zonas}`;
}
// El título de un enlace cuyo texto ya se anonimizó (docs/19 §4, O: la actividad lo nombra «Enlace retirado»).
export const tituloDe = (e: Pick<EnlaceListado, 'titulo' | 'anonimizado_en'>): string => (e.anonimizado_en !== null ? 'Enlace retirado' : e.titulo);
// La dirección completa que se comparte: el origen de esta página más la ruta con el token en el fragmento.
export const direccionCompleta = (origen: string, direccion: string): string => `${origen.replace(/\/+$/, '')}${direccion}`;

// ── Errores con su texto (punto 11) ──────────────────────────────────────────────────────────────────────────────────────────────
// 409 `tope_enlaces` trae el número del sitio en su texto; `no_renovable`, el del punto 11; un 400 de la lista vacía, el de elegir una
// magnitud; lo demás, el aviso común del panel (lib/avisos.ts: 401 y 403 los trata además el cliente HTTP).
export function avisoDeEnlace(e: unknown): DatosAviso {
  if (e instanceof ErrorApi) {
    const codigo = typeof e.cuerpo.codigo === 'string' ? e.cuerpo.codigo : '';
    if (e.codigo === 409 && codigo === 'tope_enlaces') return { tipo: 'error', texto: e.motivos[0] ?? 'Este sitio ya llegó a su tope de enlaces vivos. Revoca uno para crear otro.' };
    if (e.codigo === 409 && codigo === 'no_renovable') return { tipo: 'error', texto: NO_RENOVABLE };
    if (e.codigo === 409 && codigo === 'minimo_cambio') return { tipo: 'conflicto', texto: e.motivos[0] ?? 'Alguien cambió el mínimo de este sitio entretanto. Revísalo antes de cambiarlo.' };
    if (e.codigo === 409 && /ya estaba revocado/.test(e.motivos.join(' '))) return { tipo: 'conflicto', texto: 'Ese enlace ya estaba revocado: recarga la lista.' };
    if (e.codigo === 400 && e.motivos.includes(SIN_MAGNITUDES)) return { tipo: 'error', texto: SIN_MAGNITUDES };
  }
  return avisoDeError(e);
}
// El 409 `acorta` de renovar: las dos fechas, para preguntar antes de confirmar. null si el error es otro.
export function acortaDe(e: unknown): { actual: string; nueva: string } | null {
  if (!(e instanceof ErrorApi) || e.codigo !== 409 || e.cuerpo.codigo !== 'acorta') return null;
  const { expira_en_actual: actual, expira_en_nueva: nueva } = e.cuerpo;
  return typeof actual === 'string' && typeof nueva === 'string' ? { actual, nueva } : null;
}
