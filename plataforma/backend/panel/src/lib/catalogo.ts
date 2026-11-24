// P16 Catálogo (docs/19 §4, T; TT-12): lo que la pantalla necesita sin tocar la red. Los tipos son los de la API (GET /magnitudes,
// GET /recetas-decodificacion; docs/20 §6); la validación en vivo repite las reglas del servidor para avisar antes de enviar, y el servidor
// decide (punto 3). Los textos, en palabras de la persona: ningún nombre de columna ni de variable, salvo los códigos (punto 9).
import { SIMBOLO } from './unidades';

export type SeccionCatalogo = 'magnitudes' | 'recetas';
export const SECCIONES_CATALOGO: readonly SeccionCatalogo[] = ['magnitudes', 'recetas'];

export interface Magnitud {
  codigo: string; nombre: string; unidad: string; rango_min: number; rango_max: number;
  umbral_alto_sugerido: number | null; umbral_bajo_sugerido: number | null; histeresis_sugerida: number;
  alias: string[]; actualizado_en: string; canales?: number;
}
export interface CampoReceta {
  orden?: number; magnitud: string; unidad?: string; desplazamiento: number; tipo: TipoCampo; sumar_antes: number; multiplicar_por: number; dividir_por: number;
}
export interface Receta { codigo: string; nombre: string; largo_bytes: number; creado_en?: string; campos: CampoReceta[]; equipos?: number }
export interface FueraDeRango { tipo: 'regla' | 'calibracion'; canal_id: string; dispositivo_id: string; dispositivo: string; etiqueta: string | null; valores: number[] }

// Las mismas formas y listas del servidor (alta/magnitudes.dto.ts, recepcion/adaptadores/receta.ts; una prueba del panel las fija).
export const CODIGO_MAGNITUD = /^[a-z][a-z0-9_]{0,39}$/;
export const CODIGO_RECETA = /^[a-z0-9][a-z0-9-]{2,62}$/;
export const FORMA_ALIAS = /^[a-z0-9_.-]{1,64}$/;
export const ALIAS_RESERVADOS: readonly string[] = ['deveui', 'devicename', 'applicationid', 'applicationname', 'fcnt', 'fport', 'data', 'time',
  'rxinfo', 'txinfo', 'deviceinfo', 'object'];
export const TIPOS_CAMPO = ['u8', 'i8', 'u16be', 'u16le', 'i16be', 'i16le', 'u32be', 'u32le', 'i32be', 'i32le'] as const;
export type TipoCampo = (typeof TIPOS_CAMPO)[number];
export const ANCHO: Readonly<Record<TipoCampo, number>> = { u8: 1, i8: 1, u16be: 2, u16le: 2, i16be: 2, i16le: 2, u32be: 4, u32le: 4, i32be: 4, i32le: 4 };
export const MAX_CAMPOS = 32;
export const MAX_FACTOR = 1_000_000;

// «°C» y no «Cel» (punto 2): el símbolo del panel si lo tiene; si no, el código SenML tal cual.
export const comoSeLee = (unidad: string): string => SIMBOLO[unidad] ?? unidad;
const numero = (x: number): string => x.toLocaleString('es-CL', { maximumFractionDigits: 6 });
export const textoRango = (m: Pick<Magnitud, 'rango_min' | 'rango_max' | 'unidad'>): string => `de ${numero(m.rango_min)} a ${numero(m.rango_max)} ${comoSeLee(m.unidad)}`;
export function textoSugerido(m: Pick<Magnitud, 'umbral_alto_sugerido' | 'umbral_bajo_sugerido' | 'histeresis_sugerida' | 'unidad'>): string {
  const u = comoSeLee(m.unidad);
  const partes: string[] = [];
  if (m.umbral_alto_sugerido !== null) partes.push(`alto ${numero(m.umbral_alto_sugerido)} ${u}`);
  if (m.umbral_bajo_sugerido !== null) partes.push(`bajo ${numero(m.umbral_bajo_sugerido)} ${u}`);
  if (partes.length === 0) return 'sin sugerido';
  return `${partes.join(' · ')} · histéresis ${numero(m.histeresis_sugerida)}`;
}
export const textoCanales = (n: number | undefined): string => (n === undefined ? '' : n === 1 ? 'en 1 canal' : `en ${n} canales`);
export const textoEquipos = (n: number | undefined): string => (n === undefined ? '' : n === 1 ? 'en 1 equipo' : `en ${n} equipos`);

// La descripción legible de cada tipo (punto 6).
export const AYUDA_TIPO: Readonly<Record<TipoCampo, string>> = {
  u8: 'un byte sin signo, de 0 a 255', i8: 'un byte con signo, de −128 a 127',
  u16be: 'entero de 2 bytes sin signo; orden de bytes: el más significativo primero', u16le: 'entero de 2 bytes sin signo; orden de bytes: el menos significativo primero',
  i16be: 'entero de 2 bytes con signo; orden de bytes: el más significativo primero', i16le: 'entero de 2 bytes con signo; orden de bytes: el menos significativo primero',
  u32be: 'entero de 4 bytes sin signo; el más significativo primero', u32le: 'entero de 4 bytes sin signo; el menos significativo primero',
  i32be: 'entero de 4 bytes con signo; el más significativo primero', i32le: 'entero de 4 bytes con signo; el menos significativo primero',
};
export const formula = (c: Pick<CampoReceta, 'sumar_antes' | 'multiplicar_por' | 'dividir_por'>): string =>
  `valor = (crudo ${c.sumar_antes < 0 ? '−' : '+'} ${numero(Math.abs(c.sumar_antes))}) × ${numero(c.multiplicar_por)} ÷ ${numero(c.dividir_por)}`;
export const textoCampo = (c: CampoReceta): string =>
  `${c.magnitud}: ${AYUDA_TIPO[c.tipo].split(';')[0]} en el byte ${c.desplazamiento}${c.sumar_antes !== 0 ? `, ${c.sumar_antes < 0 ? '−' : '+'} ${Math.abs(c.sumar_antes)}` : ''}${c.multiplicar_por !== 1 ? `, × ${c.multiplicar_por}` : ''}${c.dividir_por !== 1 ? `, ÷ ${c.dividir_por}` : ''}`;

// ── Validación en vivo de una magnitud (punto 3) ───────────────────────────────────────────────────────────────────────────────
export interface FormMagnitud {
  codigo: string; nombre: string; unidad: string; rango_min: number | null; rango_max: number | null;
  umbral_alto_sugerido: number | null; umbral_bajo_sugerido: number | null; histeresis_sugerida: number | null; alias: string[];
}
export type ErroresForm = Partial<Record<string, string>>;
const finito = (x: number | null): x is number => typeof x === 'number' && Number.isFinite(x);
export function erroresMagnitud(f: FormMagnitud, nueva: boolean, unidades: readonly string[]): ErroresForm {
  const e: ErroresForm = {};
  if (nueva && !CODIGO_MAGNITUD.test(f.codigo)) e.codigo = 'Minúsculas, números y «_», empieza con letra, hasta 40.';
  if (f.nombre.trim().length < 1 || f.nombre.trim().length > 80) e.nombre = 'Escribe un nombre de 1 a 80 caracteres.';
  if (nueva && !unidades.includes(f.unidad)) e.unidad = 'Elige una unidad de la lista.';
  if (!finito(f.rango_min)) e.rango_min = 'Escribe el mínimo.';
  if (!finito(f.rango_max)) e.rango_max = 'Escribe el máximo.';
  if (finito(f.rango_min) && finito(f.rango_max) && !(f.rango_min < f.rango_max)) e.rango_min = 'El mínimo debe ser menor que el máximo.';
  const alto = f.umbral_alto_sugerido, bajo = f.umbral_bajo_sugerido, h = f.histeresis_sugerida ?? 0;
  if (!(h >= 0)) e.histeresis_sugerida = 'La histéresis no puede ser negativa.';
  if (alto === null && bajo === null && h !== 0) e.histeresis_sugerida = 'Sin umbral sugerido, la histéresis no aplica: déjala en 0.';
  if (finito(f.rango_min) && finito(f.rango_max)) {
    for (const [k, x] of [['umbral_alto_sugerido', alto], ['umbral_bajo_sugerido', bajo]] as const) {
      if (x !== null && (x < f.rango_min || x > f.rango_max)) e[k] = `Debe quedar dentro del rango (${numero(f.rango_min)} a ${numero(f.rango_max)}).`;
    }
  }
  if (alto !== null && bajo !== null) {
    if (!(bajo < alto)) e.umbral_bajo_sugerido = 'El bajo debe ser menor que el alto.';
    else if (!(h < (alto - bajo) / 2)) e.histeresis_sugerida = `Debe ser menor que la mitad de la banda (${numero((alto - bajo) / 2)}).`;
  }
  const vistos = new Set<string>();
  for (const a of f.alias) {
    if (ALIAS_RESERVADOS.includes(a)) { e.alias = `${a} lo usa la pasarela para otra cosa: no puede ser alias.`; break; }
    if (!FORMA_ALIAS.test(a)) { e.alias = `«${a}»: solo minúsculas, números, «_», «.» y «-», hasta 64.`; break; }
    if (vistos.has(a)) { e.alias = `«${a}» está repetido.`; break; }
    vistos.add(a);
  }
  return e;
}
export const normalizarAlias = (x: string): string => x.trim().toLowerCase();

// Achicar el rango pregunta antes (punto 3); ampliarlo, nunca.
export const achicaElRango = (antes: Pick<Magnitud, 'rango_min' | 'rango_max'>, min: number, max: number): boolean => min > antes.rango_min || max < antes.rango_max;
export function textoImpacto(n: number, k: number): string {
  return `Con este rango, ${n === 1 ? '1 medición' : `${n} mediciones`} de los últimos 7 días, de ${k === 1 ? '1 canal' : `${k} canales`}, habrían quedado fuera y habrían ido a cuarentena. Lo ya guardado no cambia; rige desde la próxima trama. ¿Guardar igual?`;
}
export function textoFuera(lista: readonly FueraDeRango[], total: number): string {
  const vistas = lista.slice(0, 10).map((f) => `${f.tipo === 'regla' ? 'la regla' : 'la calibración'} del canal «${f.dispositivo}${f.etiqueta ? ` · ${f.etiqueta}` : ''}» (${f.valores.map(numero).join(' y ')})`);
  return `El rango nuevo deja fuera: ${vistas.join('; ')}${total > vistas.length ? ` y ${total - vistas.length} más` : ''}. Corrígelas antes o elige otro rango; nada se guardó.`;
}

// ── Recetas (puntos 6 y 7) ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface FormCampo { magnitud: string; desplazamiento: number | null; tipo: TipoCampo; sumar_antes: number | null; multiplicar_por: number | null; dividir_por: number | null }
export interface FormReceta { codigo: string; nombre: string; largo_bytes: number | null; campos: FormCampo[] }
export const campoVacio = (): FormCampo => ({ magnitud: '', desplazamiento: 0, tipo: 'u8', sumar_antes: 0, multiplicar_por: 1, dividir_por: 1 });
const entero = (x: number | null, min: number, max: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
export function erroresReceta(f: FormReceta): ErroresForm {
  const e: ErroresForm = {};
  if (!CODIGO_RECETA.test(f.codigo)) e.codigo = 'De 3 a 63: minúsculas, números y guiones, sin empezar por guion.';
  if (f.nombre.trim().length < 1 || f.nombre.trim().length > 120) e.nombre = 'Escribe un nombre de 1 a 120 caracteres.';
  const largo = f.largo_bytes;
  if (!entero(largo, 1, 255)) e.largo_bytes = 'Un entero de 1 a 255.';
  if (f.campos.length < 1) e.campos = 'Agrega al menos un campo.';
  else if (f.campos.length > MAX_CAMPOS) e.campos = `Como mucho ${MAX_CAMPOS} campos.`;
  const vistas = new Set<string>();
  f.campos.forEach((c, i) => {
    const n = i + 1;
    if (c.magnitud === '') e[`campo${i}.magnitud`] = 'Elige la magnitud.';
    else if (vistas.has(c.magnitud)) e[`campo${i}.magnitud`] = 'Esa magnitud ya está en otro campo.';
    else vistas.add(c.magnitud);
    if (!entero(c.desplazamiento, 0, 254)) e[`campo${i}.desplazamiento`] = 'Un entero desde 0 (el primer byte es el 0).';
    else if (entero(largo, 1, 255) && c.desplazamiento + ANCHO[c.tipo] > largo) {
      e[`campo${i}.desplazamiento`] = `La trama tiene ${largo} bytes, del 0 al ${largo - 1}: el campo ${n} empieza en el byte ${c.desplazamiento} y ocupa ${ANCHO[c.tipo]}, así que se sale.`;
    }
    if (!entero(c.sumar_antes, -MAX_FACTOR, MAX_FACTOR)) e[`campo${i}.sumar_antes`] = 'Un entero de −1 000 000 a 1 000 000.';
    if (!entero(c.multiplicar_por, 1, MAX_FACTOR)) e[`campo${i}.multiplicar_por`] = 'Un entero de 1 a 1 000 000.';
    if (!entero(c.dividir_por, 1, MAX_FACTOR)) e[`campo${i}.dividir_por`] = 'Un entero de 1 a 1 000 000.';
  });
  return e;
}
// La receta como la espera la API (sin los campos vacíos de la persona).
export const recetaDelForm = (f: FormReceta) => ({
  codigo: f.codigo.trim(), nombre: f.nombre.trim(), largo_bytes: f.largo_bytes,
  campos: f.campos.map((c) => ({ magnitud: c.magnitud, desplazamiento: c.desplazamiento, tipo: c.tipo, sumar_antes: c.sumar_antes, multiplicar_por: c.multiplicar_por, dividir_por: c.dividir_por })),
});
// «Crear a partir de esta» (punto 5): sus campos y el código con «-v2» al final (o el siguiente número si ya termina en -vN).
export function aPartirDe(r: Receta): FormReceta {
  const m = /-v(\d+)$/.exec(r.codigo);
  const codigo = m ? r.codigo.replace(/-v\d+$/, `-v${Number(m[1]) + 1}`) : `${r.codigo}-v2`;
  return {
    codigo: codigo.slice(0, 63), nombre: r.nombre, largo_bytes: r.largo_bytes,
    campos: r.campos.map((c) => ({ magnitud: c.magnitud, desplazamiento: c.desplazamiento, tipo: c.tipo, sumar_antes: c.sumar_antes, multiplicar_por: c.multiplicar_por, dividir_por: c.dividir_por })),
  };
}
// La huella de lo que se probó: si la receta o los bytes cambian, el resultado anterior se tacha (punto 6).
export const huellaPrueba = (f: FormReceta, bytes: string, codificacion: string): string => JSON.stringify([recetaDelForm(f), bytes, codificacion]);
export const textoReemplazo = (n: number, de: string, a: string): string =>
  `Hasta ${n === 1 ? '1 equipo pasa' : `${n} equipos pasan`} de «${de}» a «${a}» (los dados de baja no se mueven). Las tramas ya guardadas no cambian; las siguientes se decodifican con la nueva.`;
export const textoReemplazado = (n: number, a: string): string =>
  `${n === 1 ? '1 equipo usa' : `${n} equipos usan`} ahora «${a}». La receta anterior queda sin uso y se conserva.`;
