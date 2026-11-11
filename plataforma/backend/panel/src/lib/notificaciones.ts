// Notificaciones en pantalla (docs/19 §4, tablero v2, E; HU-24, HU-25; §6 «Avisos»): una condición que se abre en un sitio de la persona
// aparece en cualquier pantalla como un aviso AGRUPADO por dispositivo (varias del mismo, una sola tarjeta con «× N»: TT-23), anunciado
// con aria-live sin robar el foco. Además, la notificación del navegador para los tipos que la persona eligió en P13, solo si dio el
// permiso (se pide al activarla, nunca al cargar: docs/21 §5). Funciones puras: el componente las aplica.
import { rotuloCondicion } from './estado-visual';

export interface GrupoAviso {
  dispositivo_id: string;
  nombre: string | null; // null mientras no se sabe (llega con la lista de abiertas, pedida con antirrebote)
  tipos: string[]; // en el orden en que llegaron, sin repetir
  veces: number;
  ultima: string; // ISO
}
export const MAX_GRUPOS = 5; // los más recientes; los demás se resumen en «y N dispositivos más»
// En teléfono (≤ 700 px) los avisos fijos al pie tapaban el campo con el foco (WCAG 2.4.11; revisión del 11/11/2026): se ven 2 y el resto
// queda plegado en «y N más».
export const MAX_GRUPOS_ANGOSTO = 2;

// Una condición abierta suma a su grupo (o crea uno al principio); una cerrada no se anuncia (el estado ya cambia en cada pantalla).
export function agregarCondicion(grupos: readonly GrupoAviso[], e: { dispositivo_id: string; condicion: string; estado: string }, ahora: Date, nombre: string | null = null): GrupoAviso[] {
  if (e.estado !== 'abierta') return [...grupos];
  const previo = grupos.find((g) => g.dispositivo_id === e.dispositivo_id);
  const resto = grupos.filter((g) => g.dispositivo_id !== e.dispositivo_id);
  const g: GrupoAviso = previo === undefined
    ? { dispositivo_id: e.dispositivo_id, nombre, tipos: [e.condicion], veces: 1, ultima: ahora.toISOString() }
    : { ...previo, nombre: previo.nombre ?? nombre, tipos: previo.tipos.includes(e.condicion) ? previo.tipos : [...previo.tipos, e.condicion], veces: previo.veces + 1, ultima: ahora.toISOString() };
  return [g, ...resto];
}

export function ponerNombres(grupos: readonly GrupoAviso[], nombres: ReadonlyMap<string, string>): GrupoAviso[] {
  return grupos.map((g) => (g.nombre === null && nombres.has(g.dispositivo_id) ? { ...g, nombre: nombres.get(g.dispositivo_id)! } : g));
}

export function textoGrupo(g: GrupoAviso): string {
  const quien = g.nombre ?? 'Un dispositivo de tus sitios';
  const que = g.tipos.map(rotuloCondicion).join(', ');
  return `${quien}: ${que}${g.veces > 1 ? ` (× ${g.veces})` : ''}`;
}

// La notificación del NAVEGADOR sale de la página (la ve quien mire la pantalla bloqueada o el centro de notificaciones del sistema): por eso
// lleva solo un cuerpo genérico, sin el nombre del dispositivo ni el tipo de condición; el detalle está en la pantalla (decidido el
// 11/11/2026; docs/21 §5). `cuantas` = condiciones nuevas de ese sitio desde que se abrió la página.
export const TITULO_NOTIFICACION = 'Condiciones nuevas';
export function cuerpoNotificacion(cuantas: number, sitio: string | null): string {
  return `${cuantas} ${cuantas === 1 ? 'condición nueva' : 'condiciones nuevas'} en ${sitio ?? 'tus sitios'}`;
}

export type Permiso = 'granted' | 'denied' | 'default' | 'sin_soporte';
export function permisoActual(): Permiso {
  return typeof Notification === 'undefined' ? 'sin_soporte' : (Notification.permission as Permiso);
}
// ¿Se muestra además una notificación del navegador? Solo para los tipos elegidos y con el permiso dado.
export const debeNotificar = (tipo: string, notificar: readonly string[] | undefined, permiso: Permiso): boolean => permiso === 'granted' && (notificar ?? []).includes(tipo);
