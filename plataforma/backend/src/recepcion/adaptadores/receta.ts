import { Lectura } from '../lectura.js';
import { limpia } from '../texto.js';
import { TramaMalformada } from './adaptador.js';

// Intérprete de recetas de decodificación (TT-12; docs/10 §8.4 punto 69 vi; esquema en docs/08 §8, migración 27). Una receta es SOLO
// DATO: el largo exacto de la trama y de 1 a 32 campos, cada uno un entero de 8, 16 o 32 bits en un desplazamiento, convertido con
// valor = (crudo + sumar_antes) × multiplicar_por ÷ dividir_por, de izquierda a derecha. Sin expresiones, bucles ni condiciones: una
// receta escrita como código sería ejecución remota en manos de quien edita el catálogo.
// Función pura: no toca la base. Quien la llama (la recepción, bloque 3; «probar sin guardar», bloque 5) le entrega la receta ya leída.

export const TIPOS_CAMPO = ['u8', 'i8', 'u16be', 'u16le', 'i16be', 'i16le', 'u32be', 'u32le', 'i32be', 'i32le'] as const;
export type TipoCampo = (typeof TIPOS_CAMPO)[number];
export const ANCHO_TIPO: Readonly<Record<TipoCampo, 1 | 2 | 4>> = {
  u8: 1, i8: 1, u16be: 2, u16le: 2, i16be: 2, i16le: 2, u32be: 4, u32le: 4, i32be: 4, i32le: 4,
};

// Las mismas cotas que los CHECK de la migración 27 (una prueba las compara con el SQL).
export const RECETA_LIMITES = { largoMin: 1, largoMax: 255, camposMin: 1, camposMax: 32, sumarMax: 1_000_000, factorMax: 1_000_000 } as const;
export const RECETA_CODIGO = /^[a-z0-9][a-z0-9-]{2,62}$/;
export const MAGNITUD_CODIGO = /^[a-z][a-z0-9_]{0,39}$/;
// Las claves que admite una definición (la forma de la API y del panel; al guardar, `magnitud` va a receta_campo.magnitud_codigo). Una clave
// fuera de estas se rechaza, como en fn_crear_receta: mal escrita, tomaría el valor por omisión (revisión del 23/11/2026).
const CLAVES_RECETA = ['codigo', 'nombre', 'largo_bytes', 'campos'];
const CLAVES_CAMPO = ['magnitud', 'desplazamiento', 'tipo', 'sumar_antes', 'multiplicar_por', 'dividir_por'];

export interface CampoReceta {
  magnitud: string;        // receta_campo.magnitud_codigo
  unidad: string;          // la unidad canónica de esa magnitud (la trae la consulta que lee la receta)
  desplazamiento: number;
  tipo: TipoCampo;
  sumar_antes: number;
  multiplicar_por: number;
  dividir_por: number;
}

export interface Receta {
  codigo: string;
  largo_bytes: number;
  campos: readonly CampoReceta[]; // en su `orden`
}

const esEntero = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const esTipo = (v: unknown): v is TipoCampo => typeof v === 'string' && (TIPOS_CAMPO as readonly string[]).includes(v);

// Validador de la definición, el mismo para crear una receta y para probarla sin guardar (punto 69 viii): lo que se prueba es lo que se
// podría guardar. Devuelve la lista de problemas en español (vacía = válida). No comprueba que la magnitud exista: eso lo dice la base
// (clave foránea) o la consulta que trae la unidad.
export function erroresDeReceta(r: unknown): string[] {
  const e: string[] = [];
  if (typeof r !== 'object' || r === null) return ['la receta debe ser un objeto'];
  const x = r as Record<string, unknown>;
  for (const k of Object.keys(x)) if (!CLAVES_RECETA.includes(k)) e.push(`clave desconocida: ${k.slice(0, 40)}`);
  if (x.nombre !== undefined && (typeof x.nombre !== 'string' || x.nombre.trim().length < 1 || x.nombre.trim().length > 120)) {
    e.push('nombre: de 1 a 120 caracteres');
  } else if (typeof x.nombre === 'string' && /[\p{Cc}\p{Cf}]/u.test(x.nombre)) {
    e.push('nombre: sin caracteres de control ni invisibles');
  }
  if (typeof x.codigo !== 'string' || !RECETA_CODIGO.test(x.codigo)) {
    e.push('codigo: de 3 a 63 caracteres, minúsculas, dígitos y guiones, sin empezar por guion');
  }
  const L = RECETA_LIMITES;
  const largoOk = esEntero(x.largo_bytes, L.largoMin, L.largoMax);
  if (!largoOk) e.push(`largo_bytes: un entero de ${L.largoMin} a ${L.largoMax}`);
  if (!Array.isArray(x.campos) || x.campos.length < L.camposMin || x.campos.length > L.camposMax) {
    e.push(`campos: una lista de ${L.camposMin} a ${L.camposMax}`);
    return e;
  }
  const vistas = new Set<string>();
  x.campos.forEach((c: unknown, i: number) => {
    const n = `campo ${i + 1}`;
    if (typeof c !== 'object' || c === null) { e.push(`${n}: debe ser un objeto`); return; }
    const k = c as Record<string, unknown>;
    for (const q of Object.keys(k)) if (!CLAVES_CAMPO.includes(q)) e.push(`${n}: clave desconocida: ${q.slice(0, 40)}`);
    if (typeof k.magnitud !== 'string' || !MAGNITUD_CODIGO.test(k.magnitud)) e.push(`${n}: magnitud no válida`);
    else if (vistas.has(k.magnitud)) e.push(`${n}: la magnitud ${k.magnitud} ya está en otro campo`);
    else vistas.add(k.magnitud);
    if (!esTipo(k.tipo)) e.push(`${n}: tipo debe ser uno de ${TIPOS_CAMPO.join(', ')}`);
    if (!esEntero(k.desplazamiento, 0, L.largoMax - 1)) e.push(`${n}: desplazamiento debe ser un entero desde 0`);
    else if (esTipo(k.tipo) && largoOk && k.desplazamiento + ANCHO_TIPO[k.tipo] > (x.largo_bytes as number)) {
      e.push(`${n}: ${k.tipo} en el byte ${k.desplazamiento} no cabe en ${String(x.largo_bytes)} bytes`);
    }
    if (k.sumar_antes !== undefined && !esEntero(k.sumar_antes, -L.sumarMax, L.sumarMax)) e.push(`${n}: sumar_antes debe ser un entero de −${L.sumarMax} a ${L.sumarMax}`);
    for (const f of ['multiplicar_por', 'dividir_por'] as const) {
      if (k[f] !== undefined && !esEntero(k[f], 1, L.factorMax)) e.push(`${n}: ${f} debe ser un entero de 1 a ${L.factorMax}`);
    }
  });
  return e;
}

function leer(b: Buffer, tipo: TipoCampo, d: number): number {
  switch (tipo) {
    case 'u8': return b.readUInt8(d);
    case 'i8': return b.readInt8(d);
    case 'u16be': return b.readUInt16BE(d);
    case 'u16le': return b.readUInt16LE(d);
    case 'i16be': return b.readInt16BE(d);
    case 'i16le': return b.readInt16LE(d);
    case 'u32be': return b.readUInt32BE(d);
    case 'u32le': return b.readUInt32LE(d);
    case 'i32be': return b.readInt32BE(d);
    case 'i32le': return b.readInt32LE(d);
  }
}

// Aplica la receta a los bytes de una trama. Toda falla sale como TramaMalformada, nunca como otro error: un error imprevisto por el
// tópico de una pasarela deja al nodo sin marcar vivo (recepcion.service.ts), y una receta mal escrita no debe poder causar eso. Por eso
// se comprueba todo antes de leer (aunque la base ya lo garantice: la receta podría venir de «probar» o de una base sin migrar).
export function aplicarReceta(r: Receta, b: Buffer): Omit<Lectura, 'tiempo'>[] {
  // «perfil …: se esperaban N bytes» es el texto que conserva C-89 (docs/16). El código no se valida aquí: solo se acota y se limpia.
  const nombre = `perfil ${typeof r?.codigo === 'string' ? limpia(r.codigo.slice(0, 64)) : '?'}`;
  try {
    if (!Buffer.isBuffer(b)) throw new TramaMalformada(`${nombre}: no hay bytes que decodificar`);
    if (!esEntero(r.largo_bytes, RECETA_LIMITES.largoMin, RECETA_LIMITES.largoMax)) throw new TramaMalformada(`${nombre}: largo de la receta no válido`);
    if (b.length !== r.largo_bytes) throw new TramaMalformada(`${nombre}: se esperaban ${r.largo_bytes} bytes y llegaron ${b.length}`);
    if (!Array.isArray(r.campos) || r.campos.length < RECETA_LIMITES.camposMin || r.campos.length > RECETA_LIMITES.camposMax) {
      throw new TramaMalformada(`${nombre}: la receta no tiene campos válidos`);
    }
    const vistas = new Set<string>();
    return r.campos.map((c, i) => {
      const n = `${nombre}, campo ${i + 1}`;
      const tipo: unknown = c.tipo;
      if (!esTipo(tipo)) throw new TramaMalformada(`${n}: tipo desconocido`);
      if (!esEntero(c.desplazamiento, 0, b.length - ANCHO_TIPO[tipo])) throw new TramaMalformada(`${n}: desplazamiento no válido o fuera de la trama`);
      if (!esEntero(c.sumar_antes, -RECETA_LIMITES.sumarMax, RECETA_LIMITES.sumarMax)
        || !esEntero(c.multiplicar_por, 1, RECETA_LIMITES.factorMax) || !esEntero(c.dividir_por, 1, RECETA_LIMITES.factorMax)) {
        throw new TramaMalformada(`${n}: factores no válidos`);
      }
      if (typeof c.magnitud !== 'string' || c.magnitud === '' || typeof c.unidad !== 'string' || c.unidad === '') {
        throw new TramaMalformada(`${n}: sin magnitud o unidad`);
      }
      if (vistas.has(c.magnitud)) throw new TramaMalformada(`${n}: magnitud repetida`);
      vistas.add(c.magnitud);
      // De izquierda a derecha: (200 + b) / 100 sale exacto como lo calculaba el código; × 0,01 no lo sería.
      const valor = ((leer(b, tipo, c.desplazamiento) + c.sumar_antes) * c.multiplicar_por) / c.dividir_por;
      if (!Number.isFinite(valor)) throw new TramaMalformada(`${n}: valor no finito`);
      return { magnitud: c.magnitud, valor, unidad: c.unidad };
    });
  } catch (err) {
    if (err instanceof TramaMalformada) throw err;
    throw new TramaMalformada(`${nombre}: no se pudo aplicar la receta`);
  }
}
