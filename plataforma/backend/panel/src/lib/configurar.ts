// P6 Configurar (docs/19 §4, tablero v2, E; F2; HU-06, HU-13, RF-14). La validación es la MISMA que decide en el servidor
// (`backend/src/alta/configuracion.dto.ts`: validarCambioDispositivo y erroresDeRegla), con los mismos campos y los mismos motivos, para
// que el error se lea junto al campo antes de enviar y no después. El servidor sigue siendo quien decide: un 400 suyo se reparte por
// campo con `erroresPorCampo`. Lo único que el panel no puede comprobar es el rango físico de la magnitud (la ficha no lo trae): se pasa
// cuando se conoce y, si no, lo dice el 400 del servidor junto al campo.
import { ErrorApi } from './api';
import type { CanalFicha, DispositivoFicha } from './modelo';

export interface ErrorCampo {
  campo: string;
  motivo: string;
}
export interface RangoFisico {
  rango_min: number | null;
  rango_max: number | null;
}
export const SIN_RANGO: RangoFisico = { rango_min: null, rango_max: null };

// Las mismas constantes del servidor (configuracion.dto.ts).
export const ESTADOS_CONFIGURABLES = ['activo', 'mantenimiento'] as const;
export type EstadoConfigurable = (typeof ESTADOS_CONFIGURABLES)[number];
export const MAX_REGLAS = 4;
export const MAX_RETARDO_S = 86_400;
export const INTERVALO_MIN_S = 5;
export const INTERVALO_MAX_S = 86_400;
export const MAX_NOMBRE = 80;
export const MAX_ETIQUETA = 40;

// ── El dispositivo ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// El formulario guarda texto (lo que la persona escribe); el cuerpo lleva solo lo que cambió respecto de lo leído.
export interface FormularioDispositivo {
  nombre: string;
  estado: EstadoConfigurable;
  intervalo: string;
  zona_id: string;
}
export function formularioDe(d: DispositivoFicha): FormularioDispositivo {
  return { nombre: d.nombre, estado: d.estado === 'mantenimiento' ? 'mantenimiento' : 'activo', intervalo: String(d.intervalo_esperado_s), zona_id: d.zona_id };
}

const entero = (t: string): number | null => (/^\s*-?\d+\s*$/.test(t) ? Number(t) : null);
// Un número del formulario: vacío es «sin valor» (null); lo que no es número es NaN (el error lo nombra).
export function numeroDe(t: string): number | null {
  const s = t.trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function erroresDeDispositivo(f: FormularioDispositivo): ErrorCampo[] {
  const e: ErrorCampo[] = [];
  const nombre = f.nombre.trim();
  if (nombre.length < 1 || nombre.length > MAX_NOMBRE) e.push({ campo: 'nombre', motivo: `entre 1 y ${MAX_NOMBRE} caracteres` });
  if (!(ESTADOS_CONFIGURABLES as readonly string[]).includes(f.estado)) e.push({ campo: 'estado', motivo: 'activo o mantenimiento (la baja es otra acción)' });
  const i = entero(f.intervalo);
  if (i === null || i < INTERVALO_MIN_S || i > INTERVALO_MAX_S) e.push({ campo: 'intervalo_esperado_s', motivo: `entero entre ${INTERVALO_MIN_S} y ${INTERVALO_MAX_S} (segundos)` });
  return e;
}

// PATCH /dispositivos/{id}: `actualizado_en` tal cual se leyó y solo los campos que cambiaron (null si nada cambió).
export function cuerpoDispositivo(d: DispositivoFicha & { actualizado_en: string }, f: FormularioDispositivo): Record<string, unknown> | null {
  const c: Record<string, unknown> = { actualizado_en: d.actualizado_en };
  if (f.nombre.trim() !== d.nombre) c.nombre = f.nombre.trim();
  if (f.estado !== d.estado) c.estado = f.estado;
  const i = entero(f.intervalo);
  if (i !== null && i !== d.intervalo_esperado_s) c.intervalo_esperado_s = i;
  if (f.zona_id !== d.zona_id) c.zona_id = f.zona_id;
  return Object.keys(c).length === 1 ? null : c;
}

// ── Las reglas de un canal ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ReglaFormulario {
  id?: string; // la regla guardada que se edita (el servidor empareja por id); sin id, una regla nueva
  umbral_alto: string;
  umbral_bajo: string;
  histeresis: string;
  retardo_s: string;
}
export interface ReglaNumerica {
  id?: string;
  umbral_alto: number | null;
  umbral_bajo: number | null;
  histeresis: number;
  retardo_s: number;
}
const texto = (v: number | null | undefined): string => (v === null || v === undefined ? '' : String(v));
export function reglasDe(c: CanalFicha): ReglaFormulario[] {
  return (c.reglas ?? []).map((r) => ({ id: r.id, umbral_alto: texto(r.umbral_alto), umbral_bajo: texto(r.umbral_bajo), histeresis: texto(r.histeresis ?? 0), retardo_s: texto((r as { retardo_s?: number }).retardo_s ?? 0) }));
}
export const REGLA_NUEVA: ReglaFormulario = { umbral_alto: '', umbral_bajo: '', histeresis: '0', retardo_s: '0' };

// La regla del formulario, en números, con los errores de forma (lo que el servidor diría «número finito o null»).
function leerRegla(r: ReglaFormulario, i: number, e: ErrorCampo[]): ReglaNumerica {
  const campo = (k: string): string => `reglas[${i}].${k}`;
  const num = (k: 'umbral_alto' | 'umbral_bajo'): number | null => {
    const n = numeroDe(r[k]);
    if (n !== null && Number.isNaN(n)) {
      e.push({ campo: campo(k), motivo: 'número finito o null' });
      return null;
    }
    return n;
  };
  const alto = num('umbral_alto');
  const bajo = num('umbral_bajo');
  const h = numeroDe(r.histeresis) ?? 0;
  const histeresis = !Number.isNaN(h) && h >= 0 ? h : (e.push({ campo: campo('histeresis'), motivo: 'número mayor o igual que 0' }), 0);
  const rt = r.retardo_s.trim() === '' ? 0 : entero(r.retardo_s);
  const retardo = rt !== null && rt >= 0 && rt <= MAX_RETARDO_S ? rt : (e.push({ campo: campo('retardo_s'), motivo: `entero entre 0 y ${MAX_RETARDO_S} (segundos)` }), 0);
  return { ...(r.id === undefined ? {} : { id: r.id }), umbral_alto: alto, umbral_bajo: bajo, histeresis, retardo_s: retardo };
}

// Las reglas de contenido, en el MISMO orden y con el MISMO texto que erroresDeRegla del servidor.
export function erroresDeRegla(r: ReglaNumerica, i: number, rango: RangoFisico = SIN_RANGO, previos: readonly ErrorCampo[] = []): ErrorCampo[] {
  const e: ErrorCampo[] = [];
  const campo = (k: string): string => `reglas[${i}].${k}`;
  const { umbral_alto: alto, umbral_bajo: bajo, histeresis } = r;
  if (alto === null && bajo === null && !previos.some((x) => x.campo === campo('umbral_alto') || x.campo === campo('umbral_bajo'))) {
    e.push({ campo: `reglas[${i}]`, motivo: 'al menos umbral_alto o umbral_bajo' });
  }
  if (alto !== null && bajo !== null) {
    if (!(bajo < alto)) e.push({ campo: campo('umbral_bajo'), motivo: 'debe ser menor que umbral_alto' });
    else if (!(histeresis < (alto - bajo) / 2)) e.push({ campo: campo('histeresis'), motivo: `debe ser menor que la mitad de la banda (${(alto - bajo) / 2})` });
  }
  for (const [k, x] of [['umbral_alto', alto], ['umbral_bajo', bajo]] as const) {
    if (x === null) continue;
    if ((rango.rango_min !== null && x < rango.rango_min) || (rango.rango_max !== null && x > rango.rango_max)) {
      e.push({ campo: campo(k), motivo: `fuera del rango físico de la magnitud [${rango.rango_min ?? '−∞'}, ${rango.rango_max ?? '∞'}]` });
    }
  }
  return e;
}

// Todo el formulario de un canal: la lista de errores (vacía = se puede guardar) y el cuerpo de PUT /canales/{id}/reglas.
export function validarReglas(etiqueta: string, reglas: readonly ReglaFormulario[], rango: RangoFisico = SIN_RANGO): { errores: ErrorCampo[]; reglas: ReglaNumerica[]; etiqueta: string | null } {
  const errores: ErrorCampo[] = [];
  const t = etiqueta.trim();
  if (t.length > MAX_ETIQUETA) errores.push({ campo: 'etiqueta', motivo: `texto de hasta ${MAX_ETIQUETA} caracteres, o null` });
  if (reglas.length > MAX_REGLAS) errores.push({ campo: 'reglas', motivo: `lista de 0 a ${MAX_REGLAS} reglas (vacía quita todas)` });
  const numericas = reglas.map((r, i) => {
    const forma: ErrorCampo[] = [];
    const n = leerRegla(r, i, forma);
    errores.push(...forma, ...erroresDeRegla(n, i, rango, forma));
    return n;
  });
  return { errores, reglas: numericas, etiqueta: t === '' ? null : t };
}

export function cuerpoReglas(actualizadoEn: string, etiqueta: string, reglas: readonly ReglaFormulario[], rango: RangoFisico = SIN_RANGO): { cuerpo: Record<string, unknown> | null; errores: ErrorCampo[] } {
  const v = validarReglas(etiqueta, reglas, rango);
  if (v.errores.length > 0) return { cuerpo: null, errores: v.errores };
  return { cuerpo: { actualizado_en: actualizadoEn, etiqueta: v.etiqueta, reglas: v.reglas }, errores: [] };
}

// El primer motivo de un campo, para escribirlo junto a él.
export const motivoDe = (errores: readonly ErrorCampo[], campo: string): string | null => errores.find((x) => x.campo === campo)?.motivo ?? null;

// Un 400 del servidor («campo: motivo», la lista de `message`) repartido por campo; lo que no nombra un campo va como «(formulario)».
export function erroresPorCampo(e: unknown): ErrorCampo[] {
  if (!(e instanceof ErrorApi) || e.codigo !== 400) return [];
  return e.motivos.map((m) => {
    const i = m.indexOf(': ');
    return i > 0 && !m.slice(0, i).includes(' ') ? { campo: m.slice(0, i), motivo: m.slice(i + 2) } : { campo: '(formulario)', motivo: m };
  });
}

// La hora del 409 («alguien lo cambió a las 10:42»), en la zona del sitio, del `actualizado_en` vigente que trae el mensaje del servidor;
// null si el mensaje no lo trae.
export function horaDelConflicto(e: unknown, zona: string): string | null {
  if (!(e instanceof ErrorApi) || e.codigo !== 409) return null;
  const m = e.motivos.map((x) => /\((\d{4}-\d{2}-\d{2}T[\d:.]+Z)\)/.exec(x)).find((x) => x !== null);
  if (!m) return null;
  const d = new Date(m[1]!);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('es-CL', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}
