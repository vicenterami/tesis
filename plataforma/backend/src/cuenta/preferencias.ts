// Preferencias de una persona (docs/19 §4, H; HU-29, RF-56; migración 24): unidades de visualización, zona horaria, tema, tipos de
// condición con notificación del navegador, vistas guardadas y el sitio por defecto. La base guarda siempre la unidad estándar: esto solo
// cambia cómo se MUESTRA. Todo lo que llega es hostil: se valida aquí, antes de tocar la base, y un cuerpo inválido es 400 con la lista
// de motivos, como el resto de la API. La zona IANA se valida contra la lista del propio motor (Intl.supportedValuesOf).
import { BadRequestException } from '@nestjs/common';
import { FORMA_ACTUALIZADO_EN } from '../alta/calibracion.dto.js';
import type { Consultable } from '../db/evento.js';
import { isoUs } from '../db/iso-us.js';

export const UNIDADES_TEMPERATURA = ['C', 'F'] as const;
export const UNIDADES_LONGITUD = ['mm', 'm', 'km'] as const;
export const TEMAS = ['sistema', 'claro', 'oscuro'] as const;
// Los tipos de condición de ck_condicion_tipo (migraciones 02, 13, 19 y 20): sacados de la base el 11/11/2026.
export const TIPOS_CONDICION = ['sin_comunicacion', 'umbral', 'bateria', 'manipulacion', 'tope_superado', 'reloj_desviado'] as const;
// Pantallas que admiten una vista guardada: los filtros del inventario (P2), el rango y la resolución de la ficha (P3) y del tablero (P1).
export const PANTALLAS_VISTA = ['inventario', 'ficha', 'tablero'] as const;
export const MAX_VISTAS = 20;
export const MAX_PARAMETROS = 20;
export const MAX_BYTES_VISTAS = 16_384; // el mismo tope que ck_preferencia_vistas

export interface Vista { nombre: string; pantalla: (typeof PANTALLAS_VISTA)[number]; parametros: Record<string, string> }
export interface Preferencias {
  unidad_temperatura: (typeof UNIDADES_TEMPERATURA)[number];
  unidad_longitud: (typeof UNIDADES_LONGITUD)[number];
  zona_horaria: string; // 'sitio' o una IANA
  tema: (typeof TEMAS)[number];
  notificar: string[];
  vistas: Vista[];
  sitio_predeterminado: string | null;
}
export interface PreferenciasLeidas extends Preferencias {
  actualizado_en: string | null; // null = la persona aún no guardó ninguna: son las de por defecto
}
export interface CambioPreferencias extends Preferencias {
  actualizado_en: string | null;
}

export const PREFERENCIAS_POR_DEFECTO: Readonly<Preferencias> = Object.freeze({
  unidad_temperatura: 'C', unidad_longitud: 'm', zona_horaria: 'sitio', tema: 'sistema', notificar: [], vistas: [], sitio_predeterminado: null,
});

// La lista de zonas del motor, una vez. «UTC» se admite aparte: algunas versiones de V8 no la listan aunque la acepten.
let zonas: Set<string> | undefined;
export function zonaValida(z: string): boolean {
  zonas ??= new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);
  return zonas.has(z);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAVE_PARAMETRO = /^[a-z][a-z0-9_]{0,39}$/;
// `parametros.ruta`: la ruta del panel que abre la vista (el panel la guarda así; docs/19 «Campos»). Solo una ruta del propio panel: nunca
// «//otro-origen» ni un esquema; la misma forma que comprueba el panel antes de convertirla en enlace (lib/preferencias.ts).
export const FORMA_RUTA_PANEL = /^\/(?!\/)[\w\-/?=&%.:,+]*$/;
const CAMPOS = ['actualizado_en', 'unidad_temperatura', 'unidad_longitud', 'zona_horaria', 'tema', 'notificar', 'vistas', 'sitio_predeterminado'];

function enLista<T extends string>(v: unknown, lista: readonly T[], campo: string, motivos: string[]): T {
  if (typeof v !== 'string' || !(lista as readonly string[]).includes(v)) motivos.push(`${campo} debe ser una de: ${lista.join(', ')}`);
  return v as T;
}

function vistas(v: unknown, motivos: string[]): Vista[] {
  if (!Array.isArray(v) || v.length > MAX_VISTAS) {
    motivos.push(`vistas debe ser una lista de hasta ${MAX_VISTAS} elementos {nombre, pantalla, parametros}`);
    return [];
  }
  const salida: Vista[] = [];
  const nombres = new Set<string>();
  for (const [i, x] of v.entries()) {
    const e = (typeof x === 'object' && x !== null && !Array.isArray(x) ? x : {}) as Record<string, unknown>;
    const nombre = typeof e.nombre === 'string' ? e.nombre.trim() : '';
    if (nombre.length < 1 || nombre.length > 60) motivos.push(`vistas[${i}].nombre debe tener entre 1 y 60 caracteres`);
    else if (nombres.has(nombre.toLowerCase())) motivos.push(`vistas[${i}].nombre repetido`);
    nombres.add(nombre.toLowerCase());
    const pantalla = enLista(e.pantalla, PANTALLAS_VISTA, `vistas[${i}].pantalla`, motivos);
    const p = e.parametros;
    const parametros: Record<string, string> = {};
    if (typeof p !== 'object' || p === null || Array.isArray(p) || Object.keys(p).length > MAX_PARAMETROS) {
      motivos.push(`vistas[${i}].parametros debe ser un objeto de hasta ${MAX_PARAMETROS} pares texto → texto`);
    } else {
      for (const [k, val] of Object.entries(p as Record<string, unknown>)) {
        if (!CLAVE_PARAMETRO.test(k) || typeof val !== 'string' || val.length > 200) {
          motivos.push(`vistas[${i}].parametros.${k.slice(0, 40)}: clave en minúsculas (hasta 40) y valor de texto (hasta 200)`);
        } else if (k === 'ruta' && !FORMA_RUTA_PANEL.test(val)) {
          motivos.push(`vistas[${i}].parametros.ruta debe ser una ruta del panel («/…», sin otro origen)`);
        } else parametros[k] = val;
      }
    }
    for (const k of Object.keys(e)) if (!['nombre', 'pantalla', 'parametros'].includes(k)) motivos.push(`vistas[${i}]: campo no admitido: ${k.slice(0, 40)}`);
    salida.push({ nombre, pantalla, parametros });
  }
  if (Buffer.byteLength(JSON.stringify(salida), 'utf8') > MAX_BYTES_VISTAS) motivos.push(`vistas ocupa más de ${MAX_BYTES_VISTAS} bytes`);
  return salida;
}

// PUT /preferencias: reemplaza todas (PUT). `actualizado_en` es el que entregó GET /preferencias, tal cual; null si aún no había ninguna
// guardada (la primera vez). La pertenencia de `sitio_predeterminado` a los sitios de la persona la comprueba el servicio.
export function validarPreferencias(cuerpo: unknown): CambioPreferencias {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new BadRequestException(['el cuerpo debe ser un objeto JSON']);
  const c = cuerpo as Record<string, unknown>;
  const motivos: string[] = [];
  const a = c.actualizado_en;
  if (a !== null && (typeof a !== 'string' || !FORMA_ACTUALIZADO_EN.test(a) || Number.isNaN(new Date(a).getTime()))) {
    motivos.push('actualizado_en es obligatorio: el que entregó GET /preferencias, tal cual (null si aún no había ninguna guardada)');
  }
  const unidad_temperatura = enLista(c.unidad_temperatura, UNIDADES_TEMPERATURA, 'unidad_temperatura', motivos);
  const unidad_longitud = enLista(c.unidad_longitud, UNIDADES_LONGITUD, 'unidad_longitud', motivos);
  const tema = enLista(c.tema, TEMAS, 'tema', motivos);
  const zona = c.zona_horaria;
  if (typeof zona !== 'string' || (zona !== 'sitio' && !zonaValida(zona))) motivos.push('zona_horaria debe ser «sitio» o una zona IANA válida (p. ej. America/Santiago)');
  const notificar: string[] = [];
  if (!Array.isArray(c.notificar) || c.notificar.length > TIPOS_CONDICION.length) motivos.push(`notificar debe ser una lista de tipos de condición: ${TIPOS_CONDICION.join(', ')}`);
  else {
    for (const t of c.notificar as unknown[]) {
      if (typeof t !== 'string' || !(TIPOS_CONDICION as readonly string[]).includes(t)) motivos.push(`notificar: «${String(t).slice(0, 40)}» no es un tipo de condición`);
      else if (!notificar.includes(t)) notificar.push(t);
    }
  }
  const vs = vistas(c.vistas, motivos);
  const s = c.sitio_predeterminado;
  if (s !== null && (typeof s !== 'string' || !UUID.test(s))) motivos.push('sitio_predeterminado debe ser el UUID de uno de tus sitios, o null');
  for (const k of Object.keys(c)) if (!CAMPOS.includes(k)) motivos.push(`campo no admitido: ${k.slice(0, 40)}`);
  for (const k of CAMPOS) if (!(k in c)) motivos.push(`falta ${k} (PUT reemplaza todas las preferencias)`);
  if (motivos.length > 0) throw new BadRequestException(motivos);
  return {
    actualizado_en: a as string | null, unidad_temperatura, unidad_longitud, zona_horaria: zona as string, tema, notificar, vistas: vs,
    sitio_predeterminado: s === null ? null : (s as string).toLowerCase(),
  };
}

// Las preferencias de una persona, o las de por defecto con `actualizado_en: null` si aún no guardó ninguna. La usan GET /preferencias y
// GET /sesion (que las trae para aplicarlas al cargar: docs/19 §4, H).
export async function leerPreferencias(c: Consultable, usuarioId: string): Promise<PreferenciasLeidas> {
  const r = await c.query<PreferenciasLeidas>(
    `SELECT unidad_temperatura, unidad_longitud, zona_horaria, tema, notificar, vistas, sitio_predeterminado, ${isoUs('actualizado_en')} AS actualizado_en
       FROM preferencia WHERE usuario_id = $1`, [usuarioId]);
  return r.rows[0] ?? { ...PREFERENCIAS_POR_DEFECTO, notificar: [], vistas: [], actualizado_en: null };
}
