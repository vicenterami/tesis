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

// El tope de bytes del cuerpo de POST /dispositivos/lote: el peor caso de lo que `filasDelCuerpo` ACEPTA, con MAX_FILAS_LOTE filas y todas
// las columnas en su tope: tres bytes por carácter en el texto libre (nombre y zona: el máximo en UTF-8 por unidad de UTF-16, porque los
// caracteres de control y los sustitutos sueltos, que el JSON escribe con seis, se rechazan) y uno en las demás (ASCII imprimible sin
// «"» ni «\»), `n` con 16 cifras y la huella. Medido por `lote-limites.spec.ts` (JSON.stringify y Buffer.byteLength), que además intenta
// superarlo con cada carácter admisible: 1 147 087 bytes al 15/11/2026, redondeado hacia arriba al KiB, 1 121 KiB (1 147 904 bytes). Hasta
// la revisión del 15/11/2026 la guarda solo rechazaba NUL y el «peor caso» de 1 467 392 no lo era: con caracteres de control o de tres bytes
// en las columnas de códigos se pasaba. La prueba falla si el peor caso no cabe o si este tope lo pasa en más de 16 KiB. Lo usan el lector de
// JSON (arranque.ts), la plantilla (`max_bytes`) y el proxy (`client_max_body_size` del `location` del lote en proxy/nginx.conf).
// Es el peor caso del JSON TAL COMO LO ESCRIBE JSON.stringify (la forma que manda el panel), no de cualquier texto que JSON.parse reduzca
// a lo mismo: un cliente que escriba escapes innecesarios («\u0041» por «A»), claves repetidas, números con relleno («60.000…0») o el JSON
// con sangría manda más bytes para el mismo contenido y puede recibir 413 del lector (revisión del 15/11/2026; se eligió decirlo y no
// restringir los números a `n` e `intervalo_esperado_s`, porque la sangría y los espacios lo agrandan igual).
export const MAX_BYTES_LOTE = 1121 * 1024;

export const SEPARADORES_LOTE = { columnas: [';', ',', '\t'], canales: ['|', ';'] } as const;

// `texto_libre`: admite cualquier carácter imprimible (nombre y zona); las demás, solo ASCII imprimible sin «"» ni «\» (filasDelCuerpo). Lo
// publica la plantilla para que la pantalla compruebe lo mismo antes de enviar (revisión del 15/11/2026), sin copiar la lista.
export interface ColumnaPlantilla { nombre: ColumnaLote; obligatoria: boolean; tope: number; texto_libre: boolean; ayuda: string; ejemplo: string }
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
    columnas: COLUMNAS_LOTE.map((nombre) => ({
      nombre, obligatoria: AYUDAS[nombre][0], tope: TOPES_COLUMNA[nombre], texto_libre: COLUMNAS_TEXTO_LIBRE.includes(nombre), ayuda: AYUDAS[nombre][1], ejemplo: AYUDAS[nombre][2],
    })),
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
export interface AltaDeLote { n: number; alta: AltaValidada; formato: Formato; sitio_codigo: string; sitio_id: string }
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
// mayor que el de la fila anterior (único y creciente), que se devuelve tal cual, y solo columnas de la plantilla. Cada celda es texto o
// número, dentro del tope de su columna, sin caracteres de control ni sustitutos sueltos, y en las columnas de códigos e identificadores
// solo ASCII imprimible (revisión del 15/11/2026: así el peor caso del cuerpo es el de lo que se acepta, no el de lo que se suele mandar).
// Si no, 400 con la fila (`n`, o su posición si `n` no sirve). En `crear`, `huella` es obligatoria.
export const FORMA_HUELLA = /^[0-9a-f]{64}$/;
// Las columnas de texto libre (nombre y zona) admiten cualquier carácter imprimible; las demás son códigos, identificadores o números
// (`canales`: códigos de magnitud y unidades canónicas del catálogo, todas ASCII hoy; una unidad que no lo fuera exigiría revisar esto).
export const COLUMNAS_TEXTO_LIBRE: readonly ColumnaLote[] = ['nombre', 'zona'];
// ASCII imprimible sin «"» ni «\»: ningún código, identificador, número ni unidad del catálogo los usa, y el JSON los escribe con dos bytes.
const ASCII_IMPRIMIBLE = /^[\x20\x21\x23-\x5b\x5d-\x7e]*$/;
const CONTROL = /\p{Cc}/u;
const SUSTITUTO_SUELTO = /\p{Cs}/u; // en modo «u», un par de sustitutos es un solo punto de código: solo calzan los sueltos
const MAX_MOTIVOS_CUERPO = 20;
// Un texto que viene del cliente, recortado antes de ponerlo en un motivo (una clave puede medir lo que el cuerpo permita).
export const recorte = (t: string, max = TOPE_POR_OMISION): string => (t.length > max ? `${t.slice(0, max)}…` : t);
const esColumna = (k: string): k is ColumnaLote => Object.hasOwn(TOPES_COLUMNA, k);
export function filasDelCuerpo(cuerpo: unknown, modo: ModoLote = 'validar'): { filas: FilaEntrada[]; huella: string | null } {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new BadRequestException(['el cuerpo debe ser un objeto JSON con `filas`']);
  const c = cuerpo as Record<string, unknown>;
  const filas = c.filas;
  if (!Array.isArray(filas) || filas.length === 0) throw new BadRequestException(['filas debe ser una lista con al menos una fila']);
  if (filas.length > MAX_FILAS_LOTE) {
    throw new PayloadTooLargeException({ statusCode: 413, error: 'Payload Too Large', codigo: 'demasiadas_filas', message: `el lote trae ${filas.length} filas y el máximo es ${MAX_FILAS_LOTE}: divídelo` });
  }
  const motivos: string[] = [];
  for (const k of Object.keys(c)) if (k !== 'filas' && k !== 'huella') motivos.push(`campo no admitido en el cuerpo: ${recorte(k)}`);
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
      if (!esColumna(k)) {
        motivos.push(`${etiqueta}: columna no admitida: ${recorte(k)}`);
        continue;
      }
      const tope = TOPES_COLUMNA[k];
      if (typeof v === 'number' ? !Number.isFinite(v) : typeof v !== 'string') {
        motivos.push(`${etiqueta}: ${k} debe ser texto o número`);
        continue;
      }
      const t = String(v);
      if (SUSTITUTO_SUELTO.test(t)) motivos.push(`${etiqueta}: ${k} trae un carácter no válido (un sustituto UTF-16 suelto)`);
      else if (CONTROL.test(t)) motivos.push(`${etiqueta}: ${k} trae un carácter de control`);
      else if (!COLUMNAS_TEXTO_LIBRE.includes(k) && !ASCII_IMPRIMIBLE.test(t)) motivos.push(`${etiqueta}: ${k} admite solo caracteres ASCII imprimibles, sin comillas dobles ni barra invertida`);
      else if (t.length > tope) motivos.push(`${etiqueta}: ${k} pasa su tope de ${tope} caracteres (trae ${t.length})`);
    }
    salida.push(o as FilaEntrada);
  });
  if (motivos.length > 0) {
    const extra = motivos.length > MAX_MOTIVOS_CUERPO ? [`… y ${motivos.length - MAX_MOTIVOS_CUERPO} más`] : [];
    // `codigo` (aditivo, revisión del 15/11/2026): la pantalla lo distingue de otros 400; `message` sigue siendo la lista de motivos.
    throw new BadRequestException({ statusCode: 400, error: 'Bad Request', codigo: 'cuerpo_invalido', message: [...motivos.slice(0, MAX_MOTIVOS_CUERPO), ...extra] });
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
  // Zonas y pasarelas por su id y por su nombre o id_fisico, una vez por petición (revisión del 15/11/2026: antes, un recorrido por fila).
  const zonasPorId = new Map(cat.zonas.map((x) => [x.id, x]));
  const zonasPorNombre = new Map<string, ZonaCatalogo[]>();
  for (const x of cat.zonas) zonasPorNombre.set(x.nombre.toLowerCase(), [...(zonasPorNombre.get(x.nombre.toLowerCase()) ?? []), x]);
  const pasarelasPorId = new Map(cat.pasarelas.map((x) => [x.id, x]));
  const pasarelasPorIdFisico = new Map(cat.pasarelas.map((x) => [x.id_fisico, x]));
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
    if (crudo !== idFisico) avisos.push({ campo: 'id_fisico', texto: `venía con mayúsculas: se guardará como «${idFisico}»` });
    if (cat.idsDePasarela.has(idFisico)) motivos.push({ campo: 'id_fisico', texto: `id_fisico «${idFisico}» ya lo usa una pasarela` });
    const otras = (nombres.get(texto(f.nombre).toLowerCase()) ?? []).filter((x) => x !== n);
    if (otras.length > 0) avisos.push({ campo: 'nombre', texto: `el nombre se repite en la fila ${otras[0]}${otras.length > 1 ? ` y ${otras.length - 1} más` : ''}` });

    // Zona: su UUID o su nombre, entre las zonas de los sitios donde quien carga puede dar de alta.
    const z = texto(f.zona);
    const porId = UUID.test(z);
    const porIdZona = porId ? zonasPorId.get(z.toLowerCase()) : undefined;
    const candidatas = porId ? (porIdZona === undefined ? [] : [porIdZona]) : (zonasPorNombre.get(z.toLowerCase()) ?? []);
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
      pasarela = UUID.test(p) ? pasarelasPorId.get(p.toLowerCase()) : pasarelasPorIdFisico.get(p.toLowerCase());
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
    altas.push({ n, alta, formato: formatoFinal, sitio_codigo: zona.sitio_codigo, sitio_id: zona.sitio_id });
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
// el cliente (el panel, un UUID). La respuesta de una creación que creó al menos un dispositivo se guarda por (persona, llave) durante 2
// minutos en la memoria del proceso, con la firma del cuerpo y los sitios de lo creado: repetir con la misma llave y el mismo cuerpo
// devuelve la misma respuesta sin crear nada, si la persona conserva «escribir» en esos sitios; la misma llave con otro cuerpo es 422
// (`llave_reutilizada`). Lo que no creó nada no se guarda: se vuelve a calcular. Vale con una instancia, como «una creación a la vez»
// (docs/11 §4). Las credenciales en claro viven aquí esos 2 minutos y nunca se escriben en un registro.
// Topes (revisión del 15/11/2026: antes solo por conteo): 200 entradas, 3 por persona y 16 MiB en total, medidos en bytes UTF-8 del JSON
// de la respuesta (Buffer.byteLength). Una respuesta de 500 filas creadas pesa ≈ 0,5 MB, así que caben ≈ 30. En memoria el objeto ocupa
// más que su JSON (cadenas en UTF-16 y la estructura de cada fila): medido con 20 respuestas de 500 filas, 9,9 MB de JSON ocupaban 20 MB
// del montículo, ≈ 2 veces. El almacén lleno ronda entonces 32 MiB, ≈ 6 % del techo de memoria del backend (512 MiB en
// docker-compose.yml, dentro de los 2 GB de RNF-17). Al llenarse salen las vencidas, después las más antiguas de esa persona
// y después las más antiguas de todas; una respuesta más grande que el tope total no se guarda.
export const CABECERA_LLAVE = 'idempotency-key';
export const FORMA_LLAVE = /^[A-Za-z0-9_-]{16,128}$/;
export const VIDA_LLAVE_MS = 120_000;
export const MAX_LLAVES = 200;
export const MAX_LLAVES_POR_PERSONA = 3;
export const MAX_BYTES_LLAVES = 16 * 1024 * 1024;
// Los reintentos tienen su propio cupo (no gastan el de los lotes, para que una respuesta perdida no quede tras un 429, pero tampoco son gratis).
export const REINTENTOS_POR_MINUTO = 10;
export function llaveDeReintento(v: unknown): string {
  if (typeof v === 'string' && FORMA_LLAVE.test(v)) return v;
  throw new BadRequestException(['Idempotency-Key es obligatoria en modo=crear: de 16 a 128 caracteres entre letras, dígitos, «-» y «_» (el panel manda un UUID)']);
}
export function firmaDelCuerpo(cuerpo: unknown): string {
  return createHash('sha256').update(JSON.stringify(cuerpo) ?? '').digest('hex');
}
interface Guardada<T> { persona: string; expira: number; firma: string; respuesta: T; sitios: readonly string[]; bytes: number }
export class RespuestasPorLlave<T> {
  private readonly guardadas = new Map<string, Guardada<T>>();
  private total = 0;
  constructor(
    private readonly vidaMs = VIDA_LLAVE_MS, private readonly tope = MAX_LLAVES, private readonly porPersona = MAX_LLAVES_POR_PERSONA,
    private readonly topeBytes = MAX_BYTES_LLAVES,
  ) {}
  get tamano(): number {
    return this.guardadas.size;
  }
  get bytes(): number {
    return this.total;
  }
  private quitar(k: string): void {
    const g = this.guardadas.get(k);
    if (g === undefined) return;
    this.total -= g.bytes;
    this.guardadas.delete(k);
  }
  private limpiar(ahora: number): void {
    for (const [k, v] of this.guardadas) if (v.expira <= ahora) this.quitar(k);
  }
  // ¿Hay una respuesta guardada con esta llave? (barato: sin firmar el cuerpo; decide qué cupo gasta la petición)
  tiene(persona: string, llave: string, ahora = Date.now()): boolean {
    this.limpiar(ahora);
    return this.guardadas.has(`${persona}\n${llave}`);
  }
  // La respuesta guardada y los sitios de lo creado, o undefined si no hay; 422 si la llave ya se usó con otro cuerpo.
  buscar(persona: string, llave: string, firma: string, ahora = Date.now()): { respuesta: T; sitios: readonly string[] } | undefined {
    this.limpiar(ahora);
    const g = this.guardadas.get(`${persona}\n${llave}`);
    if (g === undefined) return undefined;
    if (g.firma !== firma) {
      throw new HttpException({ statusCode: 422, error: 'Unprocessable Entity', codigo: 'llave_reutilizada', message: 'esta Idempotency-Key ya se usó con otro cuerpo: genera una nueva para otra creación' }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return { respuesta: g.respuesta, sitios: g.sitios };
  }
  guardar(persona: string, llave: string, firma: string, respuesta: T, sitios: readonly string[], bytes: number, ahora = Date.now()): void {
    this.limpiar(ahora);
    const clave = `${persona}\n${llave}`;
    this.quitar(clave);
    if (bytes > this.topeBytes) return;
    const deLaPersona = [...this.guardadas].filter(([, g]) => g.persona === persona).map(([k]) => k);
    while (deLaPersona.length >= this.porPersona) this.quitar(deLaPersona.shift()!);
    for (const k of [...this.guardadas.keys()]) {
      if (this.guardadas.size < this.tope && this.total + bytes <= this.topeBytes) break;
      this.quitar(k);
    }
    this.guardadas.set(clave, { persona, expira: ahora + this.vidaMs, firma, respuesta, sitios, bytes });
    this.total += bytes;
  }
}

// Límite de tasa del lote (docs/11 §4): como mucho LOTES_POR_MINUTO peticiones por persona en una ventana deslizante de un minuto. En la
// memoria del proceso: con varias instancias no vale (docs/11 §4, fila del alta masiva).
export const LOTES_POR_MINUTO = 10;
export class TasaPorPersona {
  private readonly marcas = new Map<string, number[]>();
  constructor(private readonly tope = LOTES_POR_MINUTO, private readonly ventanaMs = 60_000) {}
  // true = se admite (y se anota); false = se pasó del tope.
  // Cuánto falta para que se libere un lugar en la ventana (para decírselo a la persona en el 429).
  esperaS(clave: string, ahora = Date.now()): number {
    const vivas = (this.marcas.get(clave) ?? []).filter((t) => ahora - t < this.ventanaMs);
    return vivas.length === 0 ? 0 : Math.max(1, Math.ceil((vivas[0] + this.ventanaMs - ahora) / 1000));
  }
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
