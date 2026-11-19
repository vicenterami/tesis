// P15, «Ajustes del sitio» (docs/19 §4, Q): lo puro, probado sin DOM. El plazo de la primera trama (`GET`/`PUT /sitios/{id}/espera-primera-trama`),
// su equivalencia en días, los textos de la sección, el 409 `espera_cambio` y quién ve qué en cada sitio. El k y el tope siguen en lib/enlaces.ts
// (son de la vista pública, bloque O); las pantallas son AjustesSitio.svelte y un componente por ajuste.
import { ErrorApi } from './api';
import { avisoDeError, type DatosAviso } from './avisos';
import type { Sitio } from './modelo';
import type { Sesion } from './sesion';

// `afectados` solo viene con `?propuesto=<h>` (docs/19 §4, P, punto 2): equipos que esperan su primera trama y con ese plazo quedarían vencidos.
export interface EsperaSitio { espera_primera_trama_h: number; por_omision: number; minimo: number; maximo: number; afectados?: number }

// ── Quién ve qué ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type AccionDeAjustes = 'ajustes' | 'enlaces';
// ¿Tiene la persona esa acción en ese sitio? La matriz de la sesión (docs/20 §6); el administrador del sistema, en todos. El servidor decide
// igual: si el panel se equivoca, su 403 se muestra.
export function puedeEnSitio(s: Sesion, sitio: Pick<Sitio, 'codigo'>, accion: AccionDeAjustes): boolean {
  if (s.sistema || s.administrador_sistema === true) return true;
  const deSesion = s.sitios.find((y) => y.codigo === sitio.codigo);
  return deSesion !== undefined && (s.permisos?.[deSesion.rol] ?? []).includes(accion);
}
// Los sitios donde la persona cambia algo de esta pantalla: con la acción `ajustes` (el plazo) o `enlaces` (el k y el tope).
export const sitiosConAjustes = (s: Sesion, sitios: readonly Sitio[]): Sitio[] => sitios.filter((x) => puedeEnSitio(s, x, 'ajustes') || puedeEnSitio(s, x, 'enlaces'));

// ── El plazo de la primera trama ────────────────────────────────────────────────────────────────────────────────────────────────────
// «168 horas son 7 días»; con horas que no son días justos, un decimal con coma; menos de un día, «menos de un día».
export function equivalenciaEnDias(h: number): string {
  if (!Number.isFinite(h) || h < 1) return '';
  const dias = h / 24;
  if (dias < 1) return 'menos de un día';
  const texto = Number.isInteger(dias) ? String(dias) : dias.toFixed(1).replace('.', ',');
  return `${texto} ${dias === 1 ? 'día' : 'días'}`;
}
export const textoEquivalencia = (h: number): string => (h === 1 ? '1 hora son' : `${h} horas son`) + ` ${equivalenciaEnDias(h)}`;
export const AL_VENCER_LA_ESPERA = 'Si un equipo no envía ninguna trama en ese plazo, contado desde que entró en servicio, pasa a «Sin señal» y se abre la alarma de falta de comunicación.';
export const POR_QUE_LA_ESPERA = 'Un alta masiva suele hacerse días antes de instalar los equipos: el plazo evita que figuren sin señal mientras tanto.';
export const CUANDO_RIGE_LA_ESPERA = 'El cambio rige en la revisión siguiente del sistema: alargarlo devuelve a «Esperando primera trama» a los equipos que ya habían vencido; acortarlo puede abrir la alarma de falta de comunicación.';
// Por qué «Guardar el plazo» no sirve todavía (null = sirve): fuera de rango o no entero, o el mismo que rige (no se manda nada).
export function faltaEspera(horas: unknown, e: EsperaSitio | null): string | null {
  if (e === null) return 'espera a que cargue el plazo';
  if (typeof horas !== 'number' || !Number.isInteger(horas) || horas < e.minimo || horas > e.maximo) return `elige un número entero entre ${e.minimo} y ${e.maximo}`;
  return horas === e.espera_primera_trama_h ? 'es el que ya rige' : null;
}
export const textoPlazoGuardado = (h: number): string => `El plazo de la primera trama de este sitio es ahora de ${h} h (${equivalenciaEnDias(h)}).`;
// El 409 `espera_cambio` de fijar el plazo (bloqueo optimista): el que rige ahora, o null si el error es otro.
export function esperaQueRige(e: unknown): number | null {
  if (!(e instanceof ErrorApi) || e.codigo !== 409 || e.cuerpo.codigo !== 'espera_cambio') return null;
  return typeof e.cuerpo.espera_primera_trama_h === 'number' ? e.cuerpo.espera_primera_trama_h : null;
}
export function avisoDeEspera(e: unknown): DatosAviso {
  const rige = esperaQueRige(e);
  if (rige !== null) return { tipo: 'conflicto', texto: (e as ErrorApi).motivos[0] ?? `Alguien cambió el plazo de la primera trama de este sitio entretanto: ahora es de ${rige} h. Revísalo antes de cambiarlo.` };
  return avisoDeError(e);
}
// Acortar el plazo: el aviso antes de guardar, con cuántos equipos pasarían a «Sin señal» (docs/19 §4, Q, punto 2). Es un aviso, no una garantía.
export const acortaElPlazo = (horas: number, e: EsperaSitio | null): boolean => e !== null && Number.isInteger(horas) && horas < e.espera_primera_trama_h;
export const textoAfectados = (n: number): string => (n === 1
  ? 'Con este plazo, 1 equipo que espera su primera trama pasará a «Sin señal» y abrirá su alarma de falta de comunicación en la revisión siguiente del sistema. ¿Guardar igual?'
  : `Con este plazo, ${n} equipos que esperan su primera trama pasarán a «Sin señal» y abrirán su alarma de falta de comunicación en la revisión siguiente del sistema. ¿Guardar igual?`);
export const afectadosDe = (r: EsperaSitio): number => (typeof r.afectados === 'number' && Number.isInteger(r.afectados) && r.afectados > 0 ? r.afectados : 0);
