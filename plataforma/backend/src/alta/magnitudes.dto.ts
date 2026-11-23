// Catálogo editable de magnitudes por API (TT-12, bloque 4; docs/10 §8.4 punto 69 i a v; docs/19 §4, T, puntos 3 y 4; docs/20 §6).
// Validación en el servidor, en funciones puras: 400 con la lista `{campo, motivo}`, como el resto de la configuración. La base vuelve a
// exigir lo mismo con sus CHECK (migración 27): esto da el motivo en palabras antes de llegar allí.
import { MAGNITUD_CODIGO } from '../recepcion/adaptadores/receta.js';
import { Error400, RangoFisico, erroresDeRegla, marca, rechazo } from './configuracion.dto.js';
import { UNIDADES_CANONICAS } from './unidades.js';

// La forma de un alias y las claves reservadas: las mismas de ck_magnitud_alias_clave y ck_magnitud_alias_reservada (una prueba las
// compara con el SQL de la migración 27).
export const ALIAS_FORMA = /^[a-z0-9_.-]{1,64}$/;
export const ALIAS_RESERVADOS: readonly string[] = ['deveui', 'devicename', 'applicationid', 'applicationname', 'fcnt', 'fport',
  'data', 'time', 'rxinfo', 'txinfo', 'deviceinfo', 'object'];
export const MAX_ALIAS = 32; // por magnitud: el panel los muestra todos en una línea
export const MAX_NOMBRE = 80;

export interface Sugeridos { umbral_alto_sugerido: number | null; umbral_bajo_sugerido: number | null; histeresis_sugerida: number }
export interface MagnitudNueva extends Sugeridos {
  codigo: string; nombre: string; unidad: string; rango_min: number; rango_max: number; alias: string[];
}
export interface CambioMagnitud extends Partial<Sugeridos> {
  actualizado_en: string; nombre?: string; rango_min?: number; rango_max?: number; alias?: string[];
}

const objeto = (cuerpo: unknown): Record<string, unknown> => {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw rechazo([{ campo: '(cuerpo)', motivo: 'debe ser un objeto JSON' }]);
  return cuerpo as Record<string, unknown>;
};
const finito = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function nombreDe(v: unknown, e: Error400[]): string {
  const t = typeof v === 'string' ? v.trim() : '';
  if (typeof v !== 'string' || t.length < 1 || t.length > MAX_NOMBRE) e.push({ campo: 'nombre', motivo: `texto de 1 a ${MAX_NOMBRE} caracteres` });
  return t;
}

function numero(v: unknown, campo: string, e: Error400[]): number {
  if (!finito(v)) { e.push({ campo, motivo: 'número finito' }); return Number.NaN; }
  return v;
}

function sugerido(v: unknown, campo: string, e: Error400[]): number | null {
  if (v === null) return null;
  if (!finito(v)) { e.push({ campo, motivo: 'número finito, o null para quitarlo' }); return null; }
  return v;
}

// Los alias: una lista que REEMPLAZA a la vigente (en PATCH, la que no viene se quita). Se guardan en minúsculas, como los compara la
// recepción; repetidos (contando mayúsculas) se rechazan, para que nadie crea que guardó dos.
export function aliasDe(v: unknown, e: Error400[]): string[] {
  if (!Array.isArray(v) || v.length > MAX_ALIAS) { e.push({ campo: 'alias', motivo: `lista de hasta ${MAX_ALIAS} claves` }); return []; }
  const vistos = new Set<string>();
  v.forEach((x: unknown, i: number) => {
    const k = typeof x === 'string' ? x.trim().toLowerCase() : '';
    if (!ALIAS_FORMA.test(k)) e.push({ campo: `alias[${i}]`, motivo: 'minúsculas, números, «_», «.» y «-», de 1 a 64' });
    else if (ALIAS_RESERVADOS.includes(k)) e.push({ campo: `alias[${i}]`, motivo: `${k} lo usa la pasarela para otra cosa: no puede ser alias` });
    else if (vistos.has(k)) e.push({ campo: `alias[${i}]`, motivo: `${k} está repetido` });
    else vistos.add(k);
  });
  return [...vistos];
}

// Los sugeridos se validan con la MISMA función que las reglas del canal (erroresDeRegla, alta/configuracion.dto.ts): un sugerido que la
// base acepta pero que el editor de reglas rechazaría (la histéresis de más de media banda, por ejemplo) no sirve para «Usar el
// sugerido» (docs/10 §8.4 punto 69 iv). Sin umbrales, la histéresis no aplica y debe quedar en 0.
export function erroresDeSugeridos(s: Sugeridos, rango: RangoFisico): Error400[] {
  if (s.umbral_alto_sugerido === null && s.umbral_bajo_sugerido === null) {
    return s.histeresis_sugerida === 0 ? [] : [{ campo: 'histeresis_sugerida', motivo: 'sin umbral sugerido no aplica: déjala en 0' }];
  }
  const { errores } = erroresDeRegla({ umbral_alto: s.umbral_alto_sugerido, umbral_bajo: s.umbral_bajo_sugerido, histeresis: s.histeresis_sugerida }, 0, rango);
  const nombres: Record<string, string> = { umbral_alto: 'umbral_alto_sugerido', umbral_bajo: 'umbral_bajo_sugerido', histeresis: 'histeresis_sugerida' };
  return errores.map((x) => {
    const k = x.campo.replace(/^reglas\[0\]\.?/, '');
    return { campo: nombres[k] ?? 'umbral_alto_sugerido', motivo: x.motivo };
  });
}

function erroresDeRango(min: number, max: number): Error400[] {
  return finito(min) && finito(max) && !(min < max) ? [{ campo: 'rango_min', motivo: 'debe ser menor que rango_max' }] : [];
}

const CAMPOS_NUEVA = ['codigo', 'nombre', 'unidad', 'rango_min', 'rango_max', 'umbral_alto_sugerido', 'umbral_bajo_sugerido', 'histeresis_sugerida', 'alias'];

// POST /magnitudes: el código y la unidad se eligen aquí y no cambian después (docs/10 §8.4 punto 69 ii); el rango, obligatorio.
export function validarMagnitudNueva(cuerpo: unknown): MagnitudNueva {
  const c = objeto(cuerpo);
  const e: Error400[] = [];
  const codigo = typeof c.codigo === 'string' ? c.codigo.trim() : '';
  if (!MAGNITUD_CODIGO.test(codigo)) e.push({ campo: 'codigo', motivo: 'minúsculas, números y «_», empieza con letra, hasta 40; no se podrá cambiar' });
  const nombre = nombreDe(c.nombre, e);
  const unidad = typeof c.unidad === 'string' ? c.unidad : '';
  if (!UNIDADES_CANONICAS.includes(unidad)) e.push({ campo: 'unidad', motivo: 'una unidad de la lista (GET /magnitudes/unidades); no se podrá cambiar' });
  const rango_min = numero(c.rango_min, 'rango_min', e);
  const rango_max = numero(c.rango_max, 'rango_max', e);
  e.push(...erroresDeRango(rango_min, rango_max));
  const s: Sugeridos = {
    umbral_alto_sugerido: c.umbral_alto_sugerido === undefined ? null : sugerido(c.umbral_alto_sugerido, 'umbral_alto_sugerido', e),
    umbral_bajo_sugerido: c.umbral_bajo_sugerido === undefined ? null : sugerido(c.umbral_bajo_sugerido, 'umbral_bajo_sugerido', e),
    histeresis_sugerida: c.histeresis_sugerida === undefined ? 0 : (finito(c.histeresis_sugerida) && c.histeresis_sugerida >= 0
      ? c.histeresis_sugerida : (e.push({ campo: 'histeresis_sugerida', motivo: 'número mayor o igual que 0' }), 0)),
  };
  const alias = c.alias === undefined ? [] : aliasDe(c.alias, e);
  for (const k of Object.keys(c)) if (!CAMPOS_NUEVA.includes(k)) e.push({ campo: k, motivo: 'campo no admitido' });
  if (e.length === 0) e.push(...erroresDeSugeridos(s, { rango_min, rango_max }));
  if (e.length > 0) throw rechazo(e);
  return { codigo, nombre, unidad, rango_min, rango_max, ...s, alias };
}

const CAMPOS_CAMBIO = ['actualizado_en', 'nombre', 'rango_min', 'rango_max', 'umbral_alto_sugerido', 'umbral_bajo_sugerido', 'histeresis_sugerida', 'alias'];

// PATCH /magnitudes/{codigo}: solo lo que viene cambia; la coherencia con lo guardado (los sugeridos dentro del rango final, mínimo <
// máximo) la revisa el servicio con la fila bloqueada, porque depende de los valores vigentes.
export function validarCambioMagnitud(cuerpo: unknown): CambioMagnitud {
  const c = objeto(cuerpo);
  const e: Error400[] = [];
  const r: CambioMagnitud = { actualizado_en: marca(c.actualizado_en, e) };
  if (c.nombre !== undefined) r.nombre = nombreDe(c.nombre, e);
  if (c.rango_min !== undefined) r.rango_min = numero(c.rango_min, 'rango_min', e);
  if (c.rango_max !== undefined) r.rango_max = numero(c.rango_max, 'rango_max', e);
  if (c.umbral_alto_sugerido !== undefined) r.umbral_alto_sugerido = sugerido(c.umbral_alto_sugerido, 'umbral_alto_sugerido', e);
  if (c.umbral_bajo_sugerido !== undefined) r.umbral_bajo_sugerido = sugerido(c.umbral_bajo_sugerido, 'umbral_bajo_sugerido', e);
  if (c.histeresis_sugerida !== undefined) {
    if (finito(c.histeresis_sugerida) && c.histeresis_sugerida >= 0) r.histeresis_sugerida = c.histeresis_sugerida;
    else e.push({ campo: 'histeresis_sugerida', motivo: 'número mayor o igual que 0' });
  }
  if (c.alias !== undefined) r.alias = aliasDe(c.alias, e);
  for (const k of ['codigo', 'unidad']) if (k in c) e.push({ campo: k, motivo: 'no cambia: lo citan los canales, las reglas y las mediciones guardadas' });
  for (const k of Object.keys(c)) if (!CAMPOS_CAMBIO.includes(k) && k !== 'codigo' && k !== 'unidad') e.push({ campo: k, motivo: 'campo no admitido' });
  if (e.length === 0 && Object.keys(r).length === 1) e.push({ campo: '(cuerpo)', motivo: 'nada que cambiar: nombre, rango, sugeridos o alias' });
  if (e.length > 0) throw rechazo(e);
  return r;
}

// GET /magnitudes/{codigo}/impacto?rango_min=&rango_max=: el rango propuesto, como números de la consulta.
export function validarRangoPropuesto(minimo: unknown, maximo: unknown): { rango_min: number; rango_max: number } {
  const e: Error400[] = [];
  const leer = (v: unknown, campo: string): number => {
    const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
    if (!Number.isFinite(x)) e.push({ campo, motivo: 'número finito' });
    return x;
  };
  const rango_min = leer(minimo, 'rango_min');
  const rango_max = leer(maximo, 'rango_max');
  e.push(...erroresDeRango(rango_min, rango_max));
  if (e.length > 0) throw rechazo(e);
  return { rango_min, rango_max };
}
