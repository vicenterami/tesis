// Configurar un dispositivo y las reglas de un canal (docs/19 §4, E; docs/10 §8.4 punto 28; HU-06, HU-13, RF-14). Validación en el
// servidor, en funciones puras: 400 con la lista `{campo, motivo}` (y el texto en `message`, como el resto de la API). La pantalla P6
// aplica las mismas reglas antes de enviar; esta es la que decide.
import { BadRequestException } from '@nestjs/common';
import { FORMA_ACTUALIZADO_EN } from './calibracion.dto.js';

export interface Error400 { campo: string; motivo: string }
export function rechazo(errores: readonly Error400[]): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', message: errores.map((e) => `${e.campo}: ${e.motivo}`), errores });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// La marca del bloqueo optimista: la forma de FORMA_ACTUALIZADO_EN (años 1900–2099, horas 00–23) y un día que exista, de ida y vuelta
// como en fecha() (validacion.ts): «2026-02-30» pasaba la forma y la base respondía 22008, que llegaba como 500.
export function diaExiste(v: string): boolean {
  const ymd = v.slice(0, 10);
  return new Date(`${ymd}T12:00:00Z`).toISOString().slice(0, 10) === ymd;
}
function marca(v: unknown, errores: Error400[]): string {
  if (typeof v !== 'string' || !FORMA_ACTUALIZADO_EN.test(v) || Number.isNaN(new Date(v).getTime()) || !diaExiste(v)) {
    errores.push({ campo: 'actualizado_en', motivo: 'obligatorio: el instante ISO 8601 que entregó la ficha, tal cual' });
    return '';
  }
  return v;
}

// ── PATCH /dispositivos/{id} ────────────────────────────────────────────────────────────────────────────────────────────────────
export const ESTADOS_CONFIGURABLES = ['activo', 'mantenimiento'] as const; // la baja es DELETE /dispositivos/{id}: revoca credenciales
export interface CambioDispositivo {
  actualizado_en: string;
  nombre?: string;
  estado?: (typeof ESTADOS_CONFIGURABLES)[number];
  intervalo_esperado_s?: number;
  zona_id?: string;
}
export function validarCambioDispositivo(cuerpo: unknown): CambioDispositivo {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw rechazo([{ campo: '(cuerpo)', motivo: 'debe ser un objeto JSON' }]);
  const c = cuerpo as Record<string, unknown>;
  const errores: Error400[] = [];
  const r: CambioDispositivo = { actualizado_en: marca(c.actualizado_en, errores) };
  if (c.nombre !== undefined) {
    const t = typeof c.nombre === 'string' ? c.nombre.trim() : '';
    if (t.length < 1 || t.length > 80) errores.push({ campo: 'nombre', motivo: 'entre 1 y 80 caracteres' });
    else r.nombre = t;
  }
  if (c.estado !== undefined) {
    if (typeof c.estado === 'string' && (ESTADOS_CONFIGURABLES as readonly string[]).includes(c.estado)) r.estado = c.estado as CambioDispositivo['estado'];
    else errores.push({ campo: 'estado', motivo: 'activo o mantenimiento (la baja es DELETE /dispositivos/{id})' });
  }
  if (c.intervalo_esperado_s !== undefined) {
    const v = c.intervalo_esperado_s;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 5 && v <= 86_400) r.intervalo_esperado_s = v;
    else errores.push({ campo: 'intervalo_esperado_s', motivo: 'entero entre 5 y 86400 (segundos)' });
  }
  if (c.zona_id !== undefined) {
    if (typeof c.zona_id === 'string' && UUID.test(c.zona_id)) r.zona_id = c.zona_id.toLowerCase();
    else errores.push({ campo: 'zona_id', motivo: 'UUID de una zona del mismo sitio' });
  }
  for (const k of Object.keys(c)) if (!['actualizado_en', 'nombre', 'estado', 'intervalo_esperado_s', 'zona_id'].includes(k)) errores.push({ campo: k, motivo: 'campo no admitido' });
  if (errores.length === 0 && Object.keys(r).length === 1) errores.push({ campo: '(cuerpo)', motivo: 'nada que cambiar: nombre, estado, intervalo_esperado_s o zona_id' });
  if (errores.length > 0) throw rechazo(errores);
  return r;
}

// ── PUT /canales/{id}/reglas ────────────────────────────────────────────────────────────────────────────────────────────────────
export const MAX_REGLAS = 4;
export const MAX_RETARDO_S = 86_400; // el mismo tope que ck_regla_umbral_retardo_s (migración 23)
// `id` (opcional): la regla guardada que se cambia; sin `id`, una regla nueva. Las guardadas que no vienen se quitan (docs/19 §4, I).
export interface ReglaValidada { id?: string; umbral_alto: number | null; umbral_bajo: number | null; histeresis: number; retardo_s: number }
export interface ReglasValidadas { actualizado_en: string; etiqueta: string | null; reglas: ReglaValidada[] }
export interface RangoFisico { rango_min: number | null; rango_max: number | null }

// Una regla: al menos un umbral; bajo < alto; histéresis ≥ 0 y menor que la mitad de la banda (si no, la condición no se cerraría nunca
// dentro de ella); los umbrales dentro del rango físico de la magnitud (fuera, la lectura ya se rechaza en el filtro 3 y la regla no
// sonaría nunca); retardo entero entre 0 y 86 400 s.
export function erroresDeRegla(v: unknown, i: number, rango: RangoFisico): { regla: ReglaValidada | null; errores: Error400[] } {
  const e: Error400[] = [];
  const campo = (k: string): string => `reglas[${i}].${k}`;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { regla: null, errores: [{ campo: `reglas[${i}]`, motivo: 'debe ser un objeto' }] };
  const r = v as Record<string, unknown>;
  const numero = (k: string): number | null => {
    const x = r[k];
    if (x === undefined || x === null) return null;
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      e.push({ campo: campo(k), motivo: 'número finito o null' });
      return null;
    }
    return x;
  };
  const alto = numero('umbral_alto');
  const bajo = numero('umbral_bajo');
  const h = r.histeresis === undefined ? 0 : r.histeresis;
  const histeresis = typeof h === 'number' && Number.isFinite(h) && h >= 0 ? h : (e.push({ campo: campo('histeresis'), motivo: 'número mayor o igual que 0' }), 0);
  const rt = r.retardo_s === undefined ? 0 : r.retardo_s;
  const retardo = typeof rt === 'number' && Number.isInteger(rt) && rt >= 0 && rt <= MAX_RETARDO_S ? rt : (e.push({ campo: campo('retardo_s'), motivo: `entero entre 0 y ${MAX_RETARDO_S} (segundos)` }), 0);
  if (alto === null && bajo === null && !e.some((x) => x.campo === campo('umbral_alto') || x.campo === campo('umbral_bajo'))) {
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
  let id: string | undefined;
  if (r.id !== undefined && r.id !== null) {
    if (typeof r.id === 'string' && UUID.test(r.id)) id = r.id.toLowerCase();
    else e.push({ campo: campo('id'), motivo: 'UUID de una regla de este canal, o ausente para una regla nueva' });
  }
  for (const k of Object.keys(r)) if (!['id', 'umbral_alto', 'umbral_bajo', 'histeresis', 'retardo_s'].includes(k)) e.push({ campo: campo(k), motivo: 'campo no admitido' });
  return { regla: e.length === 0 ? { ...(id === undefined ? {} : { id }), umbral_alto: alto, umbral_bajo: bajo, histeresis, retardo_s: retardo } : null, errores: e };
}

export function validarReglas(cuerpo: unknown, rango: RangoFisico): ReglasValidadas {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw rechazo([{ campo: '(cuerpo)', motivo: 'debe ser un objeto JSON' }]);
  const c = cuerpo as Record<string, unknown>;
  const errores: Error400[] = [];
  const actualizado_en = marca(c.actualizado_en, errores);
  let etiqueta: string | null = null;
  if (c.etiqueta !== undefined && c.etiqueta !== null) {
    const t = typeof c.etiqueta === 'string' ? c.etiqueta.trim() : '';
    if (t.length > 40 || typeof c.etiqueta !== 'string') errores.push({ campo: 'etiqueta', motivo: 'texto de hasta 40 caracteres, o null' });
    else etiqueta = t === '' ? null : t;
  }
  const reglas: ReglaValidada[] = [];
  if (!Array.isArray(c.reglas) || c.reglas.length > MAX_REGLAS) {
    errores.push({ campo: 'reglas', motivo: `lista de 0 a ${MAX_REGLAS} reglas (vacía quita todas)` });
  } else {
    const vistos = new Set<string>();
    (c.reglas as unknown[]).forEach((v, i) => {
      const r = erroresDeRegla(v, i, rango);
      errores.push(...r.errores);
      if (r.regla?.id !== undefined) {
        if (vistos.has(r.regla.id)) errores.push({ campo: `reglas[${i}].id`, motivo: 'la misma regla viene dos veces' });
        vistos.add(r.regla.id);
      }
      if (r.regla !== null) reglas.push(r.regla);
    });
  }
  for (const k of Object.keys(c)) if (!['actualizado_en', 'etiqueta', 'reglas'].includes(k)) errores.push({ campo: k, motivo: 'campo no admitido' });
  if (errores.length > 0) throw rechazo(errores);
  return { actualizado_en, etiqueta, reglas };
}
