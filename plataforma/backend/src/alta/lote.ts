// Alta masiva (docs/19 §4, F2 y bloque N; docs/10 §8.4 puntos 65 iv y 67): un plan por fila calculado EN MEMORIA con la misma función del
// alta de a uno (validarAlta) y los catálogos leídos una vez. Cada fila dice qué se creará (`interpretada`), qué completó el servidor
// (`por_defecto`), qué entra pero conviene ver (`avisos`) y por qué no entra (`motivos`). La vista previa y la creación usan esta misma
// función; la creación vuelve a calcular y, si el plan cambió (otra `huella`), no crea nada. Función pura: los catálogos los trae el
// servicio; aquí no hay base ni broker.
import { createHash } from 'node:crypto';
import { BadRequestException, HttpException, HttpStatus, PayloadTooLargeException } from '@nestjs/common';
import { AltaValidada, Formato, MAX_CANALES, validarAlta } from './alta.dto.js';
import { PERFILES } from '../recepcion/adaptadores/perfiles.js';

// Una sola constante para el tope de filas (la usan la validación, la plantilla y la documentación del contrato).
export const MAX_FILAS_LOTE = 500;
export const MODOS_LOTE = ['validar', 'crear'] as const;
export type ModoLote = (typeof MODOS_LOTE)[number];
export const COLUMNAS_LOTE = ['id_fisico', 'nombre', 'zona', 'via', 'formato', 'intervalo_esperado_s', 'canales', 'pasarela', 'decodificador'] as const;
export type ColumnaLote = (typeof COLUMNAS_LOTE)[number];

// ── Topes por columna (bloque N, punto 5) ──────────────────────────────────────────────────────────────────────────────────────────
// El de validarAlta donde existe (identificador 63, nombre 80, magnitud 40, hasta 20 canales) y 80 donde no. Dentro de `canales`, la
// unidad no tiene tope en validarAlta (debe ser la canónica del catálogo): se le dan 16 caracteres, más que la unidad SenML más larga del
// catálogo de hoy (`ug/m3`, 5), para acotar la celda; un canal es «magnitud:unidad» y entre canales va « | ».
export const TOPE_POR_OMISION = 80;
export const MAX_MAGNITUD = 40;
export const MAX_UNIDAD = 16;
const SEPARADOR_CANALES = ' | ';
export const TOPE_CANALES = MAX_CANALES * (MAX_MAGNITUD + 1 + MAX_UNIDAD) + (MAX_CANALES - 1) * SEPARADOR_CANALES.length;
export const TOPES_COLUMNA: Readonly<Record<ColumnaLote, number>> = {
  id_fisico: 63, nombre: 80, zona: TOPE_POR_OMISION, via: TOPE_POR_OMISION, formato: TOPE_POR_OMISION, intervalo_esperado_s: TOPE_POR_OMISION,
  canales: TOPE_CANALES, pasarela: TOPE_POR_OMISION, decodificador: TOPE_POR_OMISION,
};

// El tope de bytes del cuerpo de POST /dispositivos/lote: el peor caso de MAX_FILAS_LOTE filas con TODAS las columnas en su tope (con
// caracteres de tres bytes en UTF-8 donde se admite texto libre: nombre, zona y la unidad de cada canal), `n` con 16 cifras y la huella,
// medido por `lote-limites.spec.ts` (JSON.stringify y Buffer.byteLength), no estimado: 1 467 087 bytes al 15/11/2026, redondeado hacia
// arriba al KiB: 1 433 KiB (1 467 392 bytes). La prueba falla si el peor caso no cabe o si este tope lo pasa en más de 16 KiB (ni corto ni arbitrario). Lo usan el
// lector de JSON (arranque.ts), la plantilla (`max_bytes`) y el proxy (`client_max_body_size` de proxy/nginx.conf, comparado por la misma prueba).
export const MAX_BYTES_LOTE = 1433 * 1024;

export const SEPARADORES_LOTE = { columnas: [';', ',', '\t'], canales: ['|', ';'] } as const;

export interface ColumnaPlantilla { nombre: ColumnaLote; obligatoria: boolean; tope: number; ayuda: string; ejemplo: string }
export interface PlantillaLote {
  columnas: ColumnaPlantilla[];
  max_filas: number;
  max_bytes: number;
  separadores: { columnas: readonly string[]; canales: readonly string[] };
}
const AYUDAS: Readonly<Record<ColumnaLote, [obligatoria: boolean, ayuda: string, ejemplo: string]>> = {
  id_fisico: [true, 'Identificador físico: minúsculas, dígitos y guion, de 3 a 63; también es el usuario del broker. Las mayúsculas se pasan a minúsculas, con aviso.', 'nodo-ejemplo-01'],
  nombre: [true, 'Nombre para las personas, de 1 a 80 caracteres.', 'Nodo de ejemplo'],
  zona: [true, 'Nombre o UUID de una zona de un sitio donde puedes dar de alta; si el nombre se repite en dos sitios, su UUID.', 'Zona norte'],
  via: [false, 'mqtt, http o lorawan; vacía, mqtt.', 'mqtt'],
  formato: [false, 'senml o plano (vías mqtt y http); vacío, senml. Un nodo lorawan hereda el de su pasarela.', 'senml'],
  intervalo_esperado_s: [true, 'Segundos esperados entre tramas: un entero de 5 a 86400.', '300'],
  canales: [true, `De 1 a ${MAX_CANALES} canales «magnitud:unidad» separados por «|» (también se admite «;»); la unidad es opcional y, si va, la canónica del catálogo (GET /magnitudes).`, 'temperatura:Cel | humedad:%RH'],
  pasarela: [false, 'Solo vía lorawan, y ahí obligatoria: id_fisico o UUID de una pasarela activa del mismo sitio.', ''],
  decodificador: [false, `Solo vía lorawan, opcional: perfil con que la plataforma decodifica la carga (${PERFILES.join(', ')}).`, ''],
};
export function plantillaLote(): PlantillaLote {
  return {
    columnas: COLUMNAS_LOTE.map((nombre) => ({ nombre, obligatoria: AYUDAS[nombre][0], tope: TOPES_COLUMNA[nombre], ayuda: AYUDAS[nombre][1], ejemplo: AYUDAS[nombre][2] })),
    max_filas: MAX_FILAS_LOTE, max_bytes: MAX_BYTES_LOTE, separadores: SEPARADORES_LOTE,
  };
}

// ── El plan por fila (bloque N, punto 2) ───────────────────────────────────────────────────────────────────────────────────────────
export type Resultado = 'valida' | 'creada' | 'rechazada' | 'existe';
export interface Nota { campo: string; texto: string }
export interface CanalInterpretado { magnitud: string; nombre: string; unidad: string }
export interface Interpretada {
  id_fisico: string;
  nombre: string;
  sitio: string; // código del sitio
  zona: string; // nombre de la zona
  zona_id: string;
  via: string;
  formato: Formato;
  intervalo_esperado_s: number;
  canales: CanalInterpretado[];
  pasarela: string | null; // id_fisico de la pasarela
  pasarela_id: string | null;
  decodificador: string | null;
  topico: string; // dónde publicará: el tópico MQTT, la ruta de la recepción HTTP o el de su pasarela
}
export interface FilaInforme {
  n: number; // la fila del origen, la que manda el cliente (en un CSV, la línea contando las vacías, con la cabecera en la 1)
  id_fisico: string;
  resultado: Resultado;
  motivo: string | null; // la unión de `motivos` (docs/10 §8.4 punto 65 i: ninguna respuesta cambia de forma)
  id: string | null;
  credencial: string | null;
  topico: string | null;
  interpretada: Interpretada | null; // lo que se creará; null si la fila no entra (o ya existe)
  por_defecto: string[];
  avisos: Nota[];
  motivos: Nota[];
}
export interface ZonaCatalogo { id: string; nombre: string; sitio_id: string; sitio_codigo: string }
export interface PasarelaCatalogo { id: string; id_fisico: string; sitio_id: string; activo: boolean; formato: Formato }
export interface MagnitudCatalogo { nombre: string; unidad: string }
export interface Catalogos {
  zonas: readonly ZonaCatalogo[]; // solo las de los sitios donde quien carga puede dar de alta (las demás «no existen»: RF-41)
  magnitudes: ReadonlyMap<string, MagnitudCatalogo>; // código → nombre y unidad canónica
  pasarelas: readonly PasarelaCatalogo[];
  existentes: ReadonlyMap<string, { id: string; estado: string }>; // dispositivos de SUS sitios con el id_fisico de alguna fila
  idsDePasarela: ReadonlySet<string>; // id_fisico ya usados por una pasarela de sus sitios (comparten espacio de nombres: migración 11)
  // id_fisico de alguna fila que ya usa un dispositivo o una pasarela de OTRO sitio: no se revela de quién ni su id ni su estado (RF-41).
  // Sigue sin poder usarse (id_fisico es único en toda la plataforma): la fila se rechaza con un motivo que no dice más.
  ajenos: ReadonlySet<string>;
}
export interface AltaDeLote { n: number; alta: AltaValidada; formato: Formato; sitio_codigo: string }
export type FilaEntrada = Record<string, unknown> & { n: number };

// El choque que solo ve la base al insertar (23505: otra petición creó el identificador entre la validación y la inserción; o el formato de
// la pasarela cambió, fk_dispositivo_pasarela_formato). El servicio deshace todo y lo lanza; el controlador recalcula y responde
// `plan_cambio` con el plan nuevo (bloque N, punto 8).
export class ChoqueDeLote extends Error {
  constructor() {
    super('el plan cambió al insertar');
    this.name = 'ChoqueDeLote';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

export function modoLote(v: unknown): ModoLote {
  if (typeof v === 'string' && (MODOS_LOTE as readonly string[]).includes(v)) return v as ModoLote;
  throw new BadRequestException(`modo debe ser uno de: ${MODOS_LOTE.join(', ')}`);
}

// ── La forma del cuerpo ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// `{filas: [...], huella?}` con 1 a 500 objetos; más de 500 es 413 (antes de mirar cada fila). Cada fila trae `n`: un entero positivo,
// mayor que el de la fila anterior (único y creciente), que se devuelve tal cual. Cada celda es texto o número, sin el carácter NUL y
// dentro del tope de su columna; si no, 400 con la fila (`n`, o su posición si `n` no sirve). En `crear`, `huella` es obligatoria.
export const FORMA_HUELLA = /^[0-9a-f]{64}$/;
const MAX_MOTIVOS_CUERPO = 20;
export function filasDelCuerpo(cuerpo: unknown, modo: ModoLote = 'validar'): { filas: FilaEntrada[]; huella: string | null } {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new BadRequestException(['el cuerpo debe ser un objeto JSON con `filas`']);
  const c = cuerpo as Record<string, unknown>;
  const filas = c.filas;
  if (!Array.isArray(filas) || filas.length === 0) throw new BadRequestException(['filas debe ser una lista con al menos una fila']);
  if (filas.length > MAX_FILAS_LOTE) throw new PayloadTooLargeException(`el lote trae ${filas.length} filas y el máximo es ${MAX_FILAS_LOTE}: divídelo`);
  const motivos: string[] = [];
  for (const k of Object.keys(c)) if (k !== 'filas' && k !== 'huella') motivos.push(`campo no admitido en el cuerpo: ${k}`);
  let huella: string | null = null;
  if (c.huella !== undefined) {
    if (typeof c.huella === 'string' && FORMA_HUELLA.test(c.huella)) huella = c.huella;
    else motivos.push('huella: 64 cifras hexadecimales en minúsculas (la que devolvió la vista previa)');
  } else if (modo === 'crear') motivos.push('huella es obligatoria en modo=crear: la que devolvió la vista previa');
  let anterior = 0;
  const salida: FilaEntrada[] = [];
  filas.forEach((f: unknown, i) => {
    if (typeof f !== 'object' || f === null || Array.isArray(f)) {
      motivos.push(`fila en la posición ${i + 1}: debe ser un objeto`);
      return;
    }
    const o = f as Record<string, unknown>;
    const n = o.n;
    let etiqueta = `fila ${String(n)}`;
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) {
      etiqueta = `fila en la posición ${i + 1}`;
      motivos.push(`${etiqueta}: n debe ser un entero positivo (la fila del origen)`);
    } else if (n <= anterior) {
      motivos.push(`${etiqueta}: n debe ser mayor que el de la fila anterior (${anterior}): único y creciente`);
    } else anterior = n;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'n') continue;
      const tope = (TOPES_COLUMNA as Readonly<Record<string, number>>)[k] ?? TOPE_POR_OMISION;
      if (typeof v === 'number' ? !Number.isFinite(v) : typeof v !== 'string') motivos.push(`${etiqueta}: ${k} debe ser texto o número`);
      else if (String(v).includes('\u0000')) motivos.push(`${etiqueta}: ${k} trae el carácter NUL`);
      else if (String(v).length > tope) motivos.push(`${etiqueta}: ${k} pasa su tope de ${tope} caracteres (trae ${String(v).length})`);
    }
    salida.push(o as FilaEntrada);
  });
  if (motivos.length > 0) {
    const extra = motivos.length > MAX_MOTIVOS_CUERPO ? [`… y ${motivos.length - MAX_MOTIVOS_CUERPO} más`] : [];
    throw new BadRequestException([...motivos.slice(0, MAX_MOTIVOS_CUERPO), ...extra]);
  }
  return { filas: salida, huella };
}

// `canales` como en la planilla: «magnitud:unidad | magnitud:unidad» (también con «;»). La unidad es opcional; si viene, la canónica.
export function leerCanales(v: unknown, magnitudes: ReadonlyMap<string, MagnitudCatalogo>, motivos: Nota[], avisos: Nota[]): { magnitud: string }[] {
  const t = texto(v);
  if (t === '') {
    motivos.push({ campo: 'canales', texto: 'canales vacío: «magnitud:unidad | magnitud:unidad»' });
    return [];
  }
  const canales: { magnitud: string }[] = [];
  for (const parte of t.split(/[|;]/).map((x) => x.trim()).filter((x) => x !== '')) {
    const [m = '', u] = parte.split(':').map((x) => x.trim());
    const magnitud = m.toLowerCase();
    const cat = magnitudes.get(magnitud);
    if (cat === undefined) motivos.push({ campo: 'canales', texto: `magnitud desconocida: ${magnitud || '(vacía)'}` });
    else if (u !== undefined && u !== '' && u !== cat.unidad) motivos.push({ campo: 'canales', texto: `${magnitud}: la unidad es ${cat.unidad}, no ${u}` });
    else if (u === undefined || u === '') avisos.push({ campo: 'canales', texto: `${magnitud} sin unidad: se asume ${cat.unidad}` });
    canales.push({ magnitud });
  }
  return canales;
}

// El campo de un motivo de validarAlta, por su comienzo (los textos empiezan con el nombre del campo del alta de a uno).
function campoDe(m: string): string {
  const x = /^(id_fisico|nombre|zona_id|via|formato|decodificador|intervalo_esperado_s|canales)\b/.exec(m)?.[1];
  if (x !== undefined) return x === 'zona_id' ? 'zona' : x;
  if (/pasarela_id/.test(m)) return 'pasarela';
  const columna = /^campo no admitido: (.+)$/.exec(m)?.[1];
  return columna ?? 'fila';
}

function topicoDe(via: string, sitio: string, idFisico: string, pasarela: string | null): string {
  if (via === 'http') return `/recepcion/${idFisico}`;
  if (via === 'lorawan') return `sitio/${sitio}/pasarela/${pasarela ?? '?'}/${idFisico}/<evento>`;
  return `sitio/${sitio}/dispositivo/${idFisico}/<magnitud>`;
}

export function validarLote(filas: readonly FilaEntrada[], cat: Catalogos, reservados: readonly string[] = []): { informe: FilaInforme[]; altas: AltaDeLote[] } {
  const informe: FilaInforme[] = [];
  const altas: AltaDeLote[] = [];
  const vistos = new Map<string, number>();
  // Los nombres repetidos dentro del archivo (aviso, no motivo): nombre en minúsculas → filas donde aparece.
  const nombres = new Map<string, number[]>();
  for (const f of filas) {
    const k = texto(f.nombre).toLowerCase();
    if (k !== '') nombres.set(k, [...(nombres.get(k) ?? []), f.n]);
  }
  for (const f of filas) {
    const n = f.n;
    const crudo = texto(f.id_fisico);
    const idFisico = crudo.toLowerCase();
    const motivos: Nota[] = [];
    const avisos: Nota[] = [];
    const porDefecto: string[] = [];
    const fila = (resultado: Resultado, extra: Partial<FilaInforme> = {}): FilaInforme => ({
      n, id_fisico: idFisico, resultado, motivo: motivos.length > 0 ? motivos.map((m) => m.texto).join('; ') : null, id: null, credencial: null, topico: null,
      interpretada: null, por_defecto: porDefecto, avisos, motivos, ...extra,
    });
    // Lo que no es de la fila: el identificador repetido, ajeno o ya dado de alta se responde sin mirar más (y sin avisos: RF-41).
    const antes = vistos.get(idFisico);
    if (idFisico !== '' && antes !== undefined) {
      motivos.push({ campo: 'id_fisico', texto: `id_fisico repetido: ya está en la fila ${antes}` });
      informe.push(fila('rechazada'));
      continue;
    }
    if (idFisico !== '') vistos.set(idFisico, n);
    if (cat.ajenos.has(idFisico)) {
      motivos.push({ campo: 'id_fisico', texto: 'identificador no disponible' });
      informe.push(fila('rechazada'));
      continue;
    }
    const existente = cat.existentes.get(idFisico);
    if (existente !== undefined) {
      const remedio = existente.estado === 'activo' ? '' : `; está en ${existente.estado}: reactivarlo desde su ficha`;
      motivos.push({ campo: 'id_fisico', texto: `ya está dado de alta${remedio}` });
      informe.push(fila('existe', { id: existente.id }));
      continue;
    }
    for (const k of Object.keys(f)) if (k !== 'n' && !(COLUMNAS_LOTE as readonly string[]).includes(k)) motivos.push({ campo: k, texto: `columna no admitida: ${k}` });
    if (crudo !== idFisico) avisos.push({ campo: 'id_fisico', texto: `venía con mayúsculas: se guardará como «${idFisico}»` });
    if (cat.idsDePasarela.has(idFisico)) motivos.push({ campo: 'id_fisico', texto: `id_fisico «${idFisico}» ya lo usa una pasarela` });
    const otras = (nombres.get(texto(f.nombre).toLowerCase()) ?? []).filter((x) => x !== n);
    if (otras.length > 0) avisos.push({ campo: 'nombre', texto: `el nombre se repite en la fila ${otras[0]}${otras.length > 1 ? ` y ${otras.length - 1} más` : ''}` });

    // Zona: su UUID o su nombre, entre las zonas de los sitios donde quien carga puede dar de alta.
    const z = texto(f.zona);
    const porId = UUID.test(z);
    const candidatas = porId ? cat.zonas.filter((x) => x.id === z.toLowerCase()) : cat.zonas.filter((x) => x.nombre.toLowerCase() === z.toLowerCase());
    let zona: ZonaCatalogo | undefined;
    if (z === '') motivos.push({ campo: 'zona', texto: 'zona vacía' });
    else if (candidatas.length === 0) motivos.push({ campo: 'zona', texto: `zona «${z}» no existe en tus sitios` });
    else if (candidatas.length > 1) motivos.push({ campo: 'zona', texto: `zona «${z}» existe en más de un sitio: usa su id` });
    else zona = candidatas[0];
    if (zona !== undefined && !porId) avisos.push({ campo: 'zona', texto: `zona «${zona.nombre}» del sitio ${zona.sitio_codigo}` });

    const viaTexto = texto(f.via).toLowerCase();
    if (viaTexto === '') porDefecto.push('via');
    const via = viaTexto || 'mqtt';
    // Pasarela (solo lorawan): su id_fisico o su UUID, del mismo sitio y activa; el nodo hereda su formato.
    const p = texto(f.pasarela);
    let pasarela: PasarelaCatalogo | undefined;
    if (p !== '') {
      pasarela = cat.pasarelas.find((x) => (UUID.test(p) ? x.id === p.toLowerCase() : x.id_fisico === p.toLowerCase()));
      if (pasarela === undefined) motivos.push({ campo: 'pasarela', texto: `pasarela «${p}» no existe` });
      else if (zona !== undefined && pasarela.sitio_id !== zona.sitio_id) motivos.push({ campo: 'pasarela', texto: `la pasarela ${pasarela.id_fisico} pertenece a otro sitio` });
      else if (!pasarela.activo) motivos.push({ campo: 'pasarela', texto: `la pasarela ${pasarela.id_fisico} está dada de baja` });
    }
    let formato: string | undefined = texto(f.formato).toLowerCase() || undefined;
    if (formato === undefined) porDefecto.push('formato');
    if (via === 'lorawan' && formato !== undefined) {
      if (pasarela !== undefined && formato !== pasarela.formato) motivos.push({ campo: 'formato', texto: `formato: un nodo lorawan hereda el de su pasarela (${pasarela.formato})` });
      else if (pasarela !== undefined) avisos.push({ campo: 'formato', texto: `se ignora: un nodo lorawan hereda el formato de su pasarela (${pasarela.formato})` });
      formato = undefined;
    }
    const canales = leerCanales(f.canales, cat.magnitudes, motivos, avisos);
    const intervaloTexto = texto(f.intervalo_esperado_s);
    const cuerpo: Record<string, unknown> = {
      id_fisico: idFisico, nombre: texto(f.nombre), zona_id: zona?.id ?? '00000000-0000-0000-0000-000000000000', via,
      intervalo_esperado_s: /^\d+$/.test(intervaloTexto) ? Number(intervaloTexto) : intervaloTexto, canales,
    };
    if (formato !== undefined) cuerpo.formato = formato;
    if (p !== '') cuerpo.pasarela_id = pasarela?.id ?? p;
    const d = texto(f.decodificador);
    if (d !== '') cuerpo.decodificador = d;
    // La misma validación del alta de a uno (forma del id_fisico, reservados, vía, formato, intervalo, canales repetidos, decodificador…).
    let alta: AltaValidada | undefined;
    try {
      alta = validarAlta(cuerpo, reservados);
    } catch (e) {
      const r = e instanceof BadRequestException ? (e.getResponse() as { message?: unknown }).message : undefined;
      const lista: string[] = Array.isArray(r) ? r.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))) : [typeof r === 'string' ? r : (e as Error).message];
      for (const m of lista) if (!motivos.some((x) => x.texto === m)) motivos.push({ campo: campoDe(m), texto: m });
    }
    if (motivos.length > 0 || alta === undefined || zona === undefined) {
      if (motivos.length === 0) motivos.push({ campo: 'fila', texto: 'fila inválida' });
      informe.push(fila('rechazada'));
      continue;
    }
    const formatoFinal: Formato = alta.formato ?? pasarela?.formato ?? 'senml';
    altas.push({ n, alta, formato: formatoFinal, sitio_codigo: zona.sitio_codigo });
    const interpretada: Interpretada = {
      id_fisico: alta.id_fisico, nombre: alta.nombre, sitio: zona.sitio_codigo, zona: zona.nombre, zona_id: zona.id, via: alta.via, formato: formatoFinal,
      intervalo_esperado_s: alta.intervalo_esperado_s,
      canales: alta.canales.map((k) => ({ magnitud: k.magnitud, nombre: cat.magnitudes.get(k.magnitud)?.nombre ?? k.magnitud, unidad: cat.magnitudes.get(k.magnitud)?.unidad ?? '' })),
      pasarela: pasarela?.id_fisico ?? null, pasarela_id: alta.pasarela_id, decodificador: alta.decodificador,
      topico: topicoDe(alta.via, zona.sitio_codigo, alta.id_fisico, pasarela?.id_fisico ?? null),
    };
    informe.push(fila('valida', { interpretada }));
  }
  return { informe, altas };
}

// La huella del plan (bloque N, punto 2): SHA-256 de la forma canónica (JSON con las claves ordenadas, sin espacios) de la lista
// [n, interpretada] de las filas que se crearían, en orden. Dos planes iguales dan la misma huella aunque la segunda vez el cliente mande
// solo las filas que entran (las demás no tienen `interpretada`); cualquier diferencia en lo que se crearía (otro formato, otra zona,
// otro sitio, una fila que dejó de entrar o que ahora entra) da otra.
export function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}
export function huellaDelPlan(informe: readonly FilaInforme[]): string {
  const plan = informe.filter((f) => f.interpretada !== null).map((f) => [f.n, f.interpretada]);
  return createHash('sha256').update(canonico(plan)).digest('hex');
}

export interface RespuestaLote {
  leidas: number;
  validas: number;
  existentes: number;
  rechazadas: number;
  con_aviso: number;
  huella: string;
  filas: FilaInforme[];
}
// Invariante (con prueba): validas + existentes + rechazadas = leidas; `con_aviso` es transversal (cuenta filas de cualquier resultado).
export function totales(informe: readonly FilaInforme[]): Omit<RespuestaLote, 'huella' | 'filas'> {
  return {
    leidas: informe.length,
    validas: informe.filter((f) => f.resultado === 'valida' || f.resultado === 'creada').length,
    existentes: informe.filter((f) => f.resultado === 'existe').length,
    rechazadas: informe.filter((f) => f.resultado === 'rechazada').length,
    con_aviso: informe.filter((f) => f.avisos.length > 0).length,
  };
}
export function respuestaLote(informe: FilaInforme[]): RespuestaLote {
  return { ...totales(informe), huella: huellaDelPlan(informe), filas: informe };
}

// ── Reintento de `modo=crear` con la misma llave (bloque N, punto 8) ──────────────────────────────────────────────────────────────────
// La llave viaja en la cabecera `Idempotency-Key` (el nombre del borrador de la IETF «The Idempotency-Key HTTP Header Field»); la genera
// el cliente (el panel, un UUID). La respuesta de una creación que terminó se guarda por (persona, llave) durante 2 minutos en la memoria
// del proceso, con la firma del cuerpo: repetir con la misma llave y el mismo cuerpo devuelve la misma respuesta sin crear nada; la misma
// llave con otro cuerpo es 422 (`llave_reutilizada`). Solo se guardan creaciones que terminaron (un 409 o un 400 se vuelven a calcular).
// Tope de entradas: llena, se borran las vencidas y, si no alcanza, la más antigua. Vale con una instancia, como «una creación a la vez»
// (docs/11 §4). Las credenciales en claro viven aquí esos 2 minutos y nunca se escriben en un registro.
export const CABECERA_LLAVE = 'idempotency-key';
export const FORMA_LLAVE = /^[A-Za-z0-9_-]{16,128}$/;
export const VIDA_LLAVE_MS = 120_000;
export const MAX_LLAVES = 200;
export function llaveDeReintento(v: unknown): string {
  if (typeof v === 'string' && FORMA_LLAVE.test(v)) return v;
  throw new BadRequestException(['Idempotency-Key es obligatoria en modo=crear: de 16 a 128 caracteres entre letras, dígitos, «-» y «_» (el panel manda un UUID)']);
}
export function firmaDelCuerpo(cuerpo: unknown): string {
  return createHash('sha256').update(JSON.stringify(cuerpo) ?? '').digest('hex');
}
export class RespuestasPorLlave<T> {
  private readonly guardadas = new Map<string, { expira: number; firma: string; respuesta: T }>();
  constructor(private readonly vidaMs = VIDA_LLAVE_MS, private readonly tope = MAX_LLAVES) {}
  get tamano(): number {
    return this.guardadas.size;
  }
  private limpiar(ahora: number): void {
    for (const [k, v] of this.guardadas) if (v.expira <= ahora) this.guardadas.delete(k);
  }
  // La respuesta guardada, o undefined si no hay; 422 si la llave ya se usó con otro cuerpo.
  buscar(persona: string, llave: string, firma: string, ahora = Date.now()): T | undefined {
    this.limpiar(ahora);
    const g = this.guardadas.get(`${persona}\n${llave}`);
    if (g === undefined) return undefined;
    if (g.firma !== firma) {
      throw new HttpException({ statusCode: 422, error: 'Unprocessable Entity', codigo: 'llave_reutilizada', message: 'esta Idempotency-Key ya se usó con otro cuerpo: genera una nueva para otra creación' }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return g.respuesta;
  }
  guardar(persona: string, llave: string, firma: string, respuesta: T, ahora = Date.now()): void {
    this.limpiar(ahora);
    while (this.guardadas.size >= this.tope) {
      const primera = this.guardadas.keys().next().value;
      if (primera === undefined) break;
      this.guardadas.delete(primera);
    }
    this.guardadas.set(`${persona}\n${llave}`, { expira: ahora + this.vidaMs, firma, respuesta });
  }
}

// Límite de tasa del lote (docs/11 §4): como mucho LOTES_POR_MINUTO peticiones por persona en una ventana deslizante de un minuto. En la
// memoria del proceso: con varias instancias no vale (docs/11 §4, fila del alta masiva).
export const LOTES_POR_MINUTO = 10;
export class TasaPorPersona {
  private readonly marcas = new Map<string, number[]>();
  constructor(private readonly tope = LOTES_POR_MINUTO, private readonly ventanaMs = 60_000) {}
  // true = se admite (y se anota); false = se pasó del tope.
  admitir(clave: string, ahora = Date.now()): boolean {
    const vivas = (this.marcas.get(clave) ?? []).filter((t) => ahora - t < this.ventanaMs);
    if (vivas.length >= this.tope) {
      this.marcas.set(clave, vivas);
      return false;
    }
    vivas.push(ahora);
    this.marcas.set(clave, vivas);
    if (this.marcas.size > 1000) for (const [k, v] of this.marcas) if (v.every((t) => ahora - t >= this.ventanaMs)) this.marcas.delete(k);
    return true;
  }
}
