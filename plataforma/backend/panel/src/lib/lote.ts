// P7, alta masiva (docs/19 §4, F2 y bloque N). El origen (archivo CSV, lo pegado, JSON o un libro .xlsx) se lee en el navegador (nunca se sube el archivo: se convierte en
// `filas` y va como JSON, cada una con `n`, su fila en el archivo contando las vacías, con la cabecera en la 1). Las columnas, sus topes y
// los límites salen de `GET /dispositivos/lote/plantilla`: el panel no guarda copia. Se valida completo con `modo=validar` (no crea nada) y
// las válidas se crean con `modo=crear` en UNA petición, todo o nada, con la `huella` del plan revisado y una llave de reintento
// (`Idempotency-Key`): si la respuesta se pierde, se repite con la misma llave y el servidor devuelve la misma, sin crear de más. Las
// credenciales llegan UNA sola vez y viven solo en memoria hasta que la persona las descarga.
import { ErrorApi } from './api';
import type { CeldaLibro, Libro } from './xlsx-lector'; // solo tipos: el lector se carga a pedido (leerArchivoLote)

// La columna que «Descargar las que no entran» agrega para que se lea el porqué; al volver a subir el archivo corregido, se ignora.
export const COLUMNA_MOTIVO = 'motivo';

// ── La plantilla del servidor (GET /dispositivos/lote/plantilla) ───────────────────────────────────────────────────────────────────
// `rotulo`: el nombre de la columna para las personas; `simbolos`: lo que una columna de códigos admite además del ASCII imprimible (en
// `canales`, «°» y «º»), con el tope contado en bytes UTF-8 (docs/19 §4, bloque S, puntos 2 y 4). Los dos los publica el servidor.
export interface ColumnaPlantilla { nombre: string; obligatoria: boolean; tope: number; texto_libre?: boolean; ayuda: string; ejemplo: string; rotulo?: string; simbolos?: string }
export interface PlantillaLote {
  columnas: ColumnaPlantilla[];
  max_filas: number;
  max_bytes: number;
  separadores: { columnas: string[]; canales: string[] };
}

export type FilaLote = { n: number } & Partial<Record<string, string | number>>;
// Un problema del archivo, con su caso de la tabla de docs/19 §4, N8b (qué pasó, por qué, qué se ve y qué se puede hacer).
export interface Problema { caso: CasoError; texto: string }
// Una fila mal formada (docs/19 §4, bloque S, punto 1): más o menos celdas que la cabecera, un carácter que no se admite o más larga que
// el tope de su columna. No frena a las demás: no se envía, se muestra en la revisión como «No entra» con sus motivos (campo = la columna,
// o `fila`) y va al CSV de las que no entran. `fila` lleva lo que la persona escribió, alineado a la cabecera (lo que sobra, en el motivo).
export interface FilaNoEntra { fila: FilaLote; motivos: Nota[] }
export interface LecturaCsv {
  filas: FilaLote[];
  errores: Problema[];
  noEntran?: FilaNoEntra[];
}

// Los orígenes (docs/19 §4, N6): un archivo CSV, lo pegado desde la planilla (separado por tabuladores) y una lista JSON terminan en la
// misma lista `filas`, cada una con su `n` (la fila del origen contando las vacías, con la cabecera en la 1; en JSON, la posición más 1).
// El archivo y lo pegado van por el mismo lector de tablas (`leerCsv`); el JSON arma las mismas celdas y pasa por la misma comprobación.
// Las columnas que el lector ignora al volver a subir lo que se descargó: `fila` y `motivo`.
interface Registro { n: number; celdas: string[]; motivos?: Nota[] }
export const COLUMNA_FILA = 'fila';
const IGNORADAS: readonly string[] = [COLUMNA_FILA, COLUMNA_MOTIVO];

// El separador de columnas: el que más veces aparece en la cabecera, fuera de comillas, entre los que publica la plantilla. Sin ninguno, la
// cabecera es de una sola columna (y se avisa).
function detectarSeparador(t: string, candidatos: readonly string[]): string {
  const cuenta = new Map(candidatos.map((c) => [c, 0]));
  let comillas = false;
  for (const c of t) {
    if (c === '"') comillas = !comillas;
    else if (!comillas && (c === '\n' || c === '\r')) break;
    else if (!comillas && cuenta.has(c)) cuenta.set(c, (cuenta.get(c) ?? 0) + 1);
  }
  let mejor = candidatos[0] ?? ',';
  for (const [c, n] of cuenta) if (n > (cuenta.get(mejor) ?? 0)) mejor = c;
  return mejor;
}

// RFC 4180 con el separador dado: comillas dobles (con "" dentro), saltos CRLF o LF, y la marca BOM que deja Excel. Una celda entre comillas
// puede llevar el separador y saltos de línea. Devuelve cada registro con su número (`n`, desde 1) contando los vacíos, que se descartan:
// así el número es la fila que la persona ve en su planilla aunque haya filas vacías en medio. Una comilla sin cerrar o texto pegado a una
// comilla de cierre no se pierde en silencio: se dice con la fila (revisión del 16/11/2026).
export function celdasTabla(texto: string, separadores: readonly string[]): { registros: Registro[]; errores: Problema[] } {
  const t = texto.replace(/^\uFEFF/, '');
  const sep = detectarSeparador(t, separadores);
  const registros: string[][] = [];
  const errores: Problema[] = [];
  let fila: string[] = [];
  let celda = '';
  let comillas = false;
  let cerrada = false; // la celda acaba de cerrar su comilla: solo puede seguir un separador o el fin de la fila
  let pegado = false; // ya se dijo, en este registro, que hay texto pegado a una comilla de cierre
  const n = (): number => registros.length + 1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (c === '"') {
        comillas = false;
        cerrada = true;
      } else celda += c;
    } else if (c === '"' && celda === '' && !cerrada) comillas = true;
    else if (c === sep) {
      fila.push(celda);
      celda = '';
      cerrada = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(celda);
      registros.push(fila);
      fila = [];
      celda = '';
      cerrada = false;
      pegado = false;
    } else {
      if (cerrada && !pegado) {
        errores.push({ caso: 'celda_invalida', texto: `Fila ${n()}: hay texto pegado a una comilla de cierre; separa las celdas con «${sep === '\t' ? 'tabulador' : sep}».` });
        pegado = true;
      }
      celda += c;
    }
  }
  if (comillas) errores.push({ caso: 'celda_invalida', texto: `Fila ${n()}: comilla sin cerrar.` });
  if (celda !== '' || fila.length > 0) {
    fila.push(celda);
    registros.push(fila);
  }
  return { registros: registros.map((celdas, i) => ({ n: i + 1, celdas })).filter((r) => r.celdas.some((x) => x.trim() !== '')), errores };
}

// Lo que se puede ver antes de enviar se ve aquí, con la fila y la columna (docs/19 §4, N8b): la pantalla es la ayuda; el servidor sigue
// siendo la guarda real (filasDelCuerpo). Las reglas de las celdas salen de la plantilla (tope, `texto_libre` y `simbolos` de cada columna), no
// de una copia. Desde el bloque S (punto 1) una celda mal formada deja su FILA fuera («No entra», con su motivo), no el archivo entero.
const IMPRIMIBLE = /[\x20\x21\x23-\x5b\x5d-\x7e]/; // la misma regla de alta/lote.ts para las columnas que no son texto libre
const CONTROL = /\p{Cc}/u;
const SUSTITUTO_SUELTO = /\p{Cs}/u;
// Las MISMAS palabras que usa el servidor cuando una fila mal formada le llega igual (alta/lote.ts, TEXTOS_CELDA: lote.test.ts compara los
// dos bloques letra por letra). `admitidos`: lo que la columna sí admite además del ASCII; `dobles`: los símbolos de la celda que el tope
// cuenta como dos (bytes UTF-8).
export const TEXTOS_CELDA = {
  control: 'trae un salto de línea, un tabulador u otro carácter de control, que no se admite',
  sustituto: 'trae un carácter dañado que no se puede leer',
  simbolo: (c: string, admitidos = ''): string =>
    `trae «${c}», que no se admite: solo letras sin tilde ni eñe, dígitos y signos simples${admitidos === '' ? '' : `, y también ${[...admitidos].map((x) => `«${x}»`).join(' y ')}`}, sin comillas dobles ni barra invertida`,
  largo: (n: number, tope: number, dobles = ''): string =>
    `tiene ${n} caracteres${dobles === '' ? '' : `, contando como dos cada ${[...dobles].map((x) => `«${x}»`).join(' y ')},`} y el máximo es ${tope}`,
  tipo: 'no es texto ni número',
} as const;
const bytesUtf8 = (t: string): number => new TextEncoder().encode(t).length;
// Lo que tiene mal una celda contra su columna, en palabras de la persona («Identificador: trae «ó», que no se admite…»), o null.
export function motivoDeCelda(c: ColumnaPlantilla, v: string): string | null {
  const rotulo = c.rotulo ?? c.nombre;
  if (SUSTITUTO_SUELTO.test(v)) return `${rotulo}: ${TEXTOS_CELDA.sustituto}`;
  if (CONTROL.test(v)) return `${rotulo}: ${TEXTOS_CELDA.control}`;
  if (c.texto_libre !== true) {
    for (const x of v) if (!IMPRIMIBLE.test(x) && !(c.simbolos ?? '').includes(x)) return `${rotulo}: ${TEXTOS_CELDA.simbolo(x, c.simbolos ?? '')}`;
  }
  // En las columnas de códigos, el tope en bytes UTF-8 (un «°» vale dos), como el servidor, y el texto dice cómo se contó; en el texto
  // libre, en caracteres.
  const largo = c.texto_libre === true ? v.length : bytesUtf8(v);
  const dobles = c.texto_libre === true ? '' : [...new Set(v.replace(/[\x20-\x7e]/g, ''))].join('');
  return largo > c.tope ? `${rotulo}: ${TEXTOS_CELDA.largo(largo, c.tope, dobles)}` : null;
}
const celdasDe = (k: number): string => (k === 1 ? '1 celda' : `${k} celdas`);
// La descarga antepone un apóstrofo a una celda con forma de fórmula (punto 9); el lector lo quita para que lo descargado y vuelto a subir
// sin tocar dé el mismo plan.
const CON_APOSTROFO = /^'[=+\-@\t\r\n＝＋－＠]/;
const sinApostrofo = (v: string): string => (CON_APOSTROFO.test(v) ? v.slice(1) : v);

// El camino común de los tres orígenes: la cabecera y los registros (ya con sus `n`) → filas, las que no entran o los problemas del archivo.
// El archivo entero se rechaza solo cuando no se puede leer (columnas desconocidas, repetidas u obligatorias que faltan, sin filas o más
// filas que el tope); una fila mal formada pasa a «No entra» con su motivo y las demás se revisan (docs/19 §4, bloque S, punto 1).
function comprobar(cabecera: string[], datos: Registro[], p: PlantillaLote, sinDatos: Problema): LecturaCsv {
  const errores: Problema[] = [];
  const columnas = p.columnas.map((c) => c.nombre);
  // Cada nombre desconocido una vez (una cabecera con muchas celdas vacías no repite el mismo error por cada una).
  for (const x of new Set(cabecera.filter((x) => !IGNORADAS.includes(x) && !columnas.includes(x)))) {
    errores.push({ caso: 'columna_desconocida', texto: `La columna «${recorte(x)}» no es de la plantilla. Las columnas son: ${columnas.join(', ')}.` });
  }
  for (const c of p.columnas.filter((c) => c.obligatoria && !cabecera.includes(c.nombre))) errores.push({ caso: 'falta_obligatoria', texto: `Falta la columna obligatoria «${c.nombre}».` });
  for (const x of new Set(cabecera.filter((x, i) => cabecera.indexOf(x) !== i))) errores.push({ caso: 'columna_repetida', texto: `La columna «${recorte(x)}» está repetida en la cabecera.` });
  if (datos.length === 0) errores.push(sinDatos);
  if (datos.length > p.max_filas) errores.push({ caso: 'demasiadas_filas', texto: `El archivo trae ${datos.length} filas y el máximo es ${p.max_filas}: divídelo en partes de ${p.max_filas} o menos.` });
  if (errores.length > 0) return { filas: [], errores, noEntran: [] };
  // Por fila: el número de celdas y cada celda contra su columna. Lo que la persona escribió se conserva, alineado a la cabecera.
  const porNombre = new Map(p.columnas.map((c) => [c.nombre, c]));
  const filas: FilaLote[] = [];
  const noEntran: FilaNoEntra[] = [];
  for (const d of datos) {
    const f: FilaLote = { n: d.n };
    const motivos: Nota[] = [...(d.motivos ?? [])];
    cabecera.forEach((col, i) => {
      if (IGNORADAS.includes(col)) return;
      const v = sinApostrofo(d.celdas[i] ?? '').trim();
      if (v !== '') f[col] = v;
      const c = porNombre.get(col);
      const m = c === undefined || v === '' ? null : motivoDeCelda(c, v);
      if (m !== null) motivos.push({ campo: col, texto: m });
    });
    const k = d.celdas.length - cabecera.length;
    if (k > 0) {
      const sobran = d.celdas.slice(cabecera.length).map((x) => `«${recorte(x.trim(), 20)}»`).join(', ');
      motivos.unshift({ campo: 'fila', texto: `la fila trae ${celdasDe(k)} más que la cabecera (${sobran}): ¿un separador de más dentro de una celda?` });
    } else if (k < 0) motivos.unshift({ campo: 'fila', texto: `la fila trae ${celdasDe(-k)} menos que la cabecera: ¿falta un separador?` });
    if (motivos.length > 0) noEntran.push({ fila: f, motivos });
    else filas.push(f);
  }
  return { filas, errores: [], noEntran };
}

// Un archivo CSV o lo pegado desde la planilla (tabuladores): el mismo lector.
export function leerCsv(texto: string, p: PlantillaLote): LecturaCsv {
  const { registros, errores } = celdasTabla(texto, p.separadores.columnas);
  if (errores.length > 0) return { filas: [], errores };
  if (registros.length === 0) return { filas: [], errores: [{ caso: 'archivo_vacio', texto: 'El archivo está vacío.' }] };
  const cabecera = registros[0]!.celdas.map((x) => x.trim().toLowerCase());
  if (cabecera.length === 1 && p.columnas.length > 1) {
    return { filas: [], errores: [{ caso: 'una_columna', texto: `La cabecera tiene una sola columna («${recorte(registros[0]!.celdas[0] ?? '')}»): no hay «;», «,» ni tabulador entre las columnas. Descarga la plantilla y copia tus datos en ella.` }] };
  }
  return comprobar(cabecera, registros.slice(1), p, { caso: 'solo_cabecera', texto: 'El archivo trae la cabecera pero ninguna fila de datos.' });
}

// Una lista de objetos con las columnas de la plantilla. `n` es la posición más 1. Un número se vuelve texto, como llega en un CSV.
export function leerJson(texto: string, p: PlantillaLote): LecturaCsv {
  const malo = (t: string): LecturaCsv => ({ filas: [], errores: [{ caso: 'celda_invalida', texto: t }] });
  let lista: unknown;
  try {
    lista = JSON.parse(texto.replace(/^\uFEFF/, ''));
  } catch {
    return malo('El JSON no se puede leer: debe ser una lista de objetos con las columnas de la plantilla.');
  }
  if (!Array.isArray(lista) || lista.some((x) => typeof x !== 'object' || x === null || Array.isArray(x))) return malo('El JSON debe ser una lista de objetos con las columnas de la plantilla.');
  if (lista.length === 0) return { filas: [], errores: [{ caso: 'archivo_vacio', texto: 'El archivo está vacío.' }] };
  const objetos = lista as Record<string, unknown>[];
  const problemas: Problema[] = [];
  // Dos claves que solo difieren en mayúsculas o en espacios son la misma columna: se dice, no se toma la última en silencio.
  for (const o of objetos) {
    const vistas = Object.keys(o).map((k) => k.trim().toLowerCase());
    for (const x of new Set(vistas.filter((x, i) => vistas.indexOf(x) !== i))) {
      if (!problemas.some((q) => q.texto.includes(`«${recorte(x)}»`))) problemas.push({ caso: 'columna_repetida', texto: `La columna «${recorte(x)}» está repetida en la cabecera.` });
    }
  }
  if (problemas.length > 0) return { filas: [], errores: problemas };
  const cabecera = [...new Set(objetos.flatMap((o) => Object.keys(o).map((k) => k.trim().toLowerCase())))];
  const rotulos = new Map(p.columnas.map((c) => [c.nombre, c.rotulo ?? c.nombre]));
  const datos: Registro[] = objetos.map((o, i) => {
    const porClave = new Map(Object.entries(o).map(([k, v]) => [k.trim().toLowerCase(), v]));
    const motivos: Nota[] = [];
    const celdas = cabecera.map((col) => {
      const v = porClave.get(col);
      if (v === undefined || v === null) return '';
      if (typeof v === 'string') return v;
      // Un número ya perdió su escritura al leerse (`12345678901234567890` queda en `12345678901234567000`): solo se admiten los enteros que se
      // escriben igual. Desde el bloque S (punto 1), una celda así deja fuera su fila, no el archivo.
      if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v);
      const rotulo = rotulos.get(col) ?? recorte(col);
      motivos.push({ campo: col, texto: typeof v === 'number' ? `${rotulo}: el número no se puede leer tal como está escrito; escríbelo entre comillas` : `${rotulo}: ${TEXTOS_CELDA.tipo}` });
      return '';
    });
    return { n: i + 1, celdas, motivos };
  });
  return comprobar(cabecera, datos.filter((d) => d.celdas.some((x) => x.trim() !== '') || (d.motivos ?? []).length > 0), p, { caso: 'archivo_vacio', texto: 'El archivo está vacío.' });
}

// Lo pegado y el texto de un archivo: el tamaño primero (un origen que pasa `max_bytes` tampoco cabría como cuerpo), después el JSON (empieza
// con «[» o «{») o la tabla.
export function leerOrigen(texto: string, p: PlantillaLote): LecturaCsv {
  const bytes = new TextEncoder().encode(texto).length;
  if (bytes > p.max_bytes) return { filas: [], errores: [{ caso: 'archivo_pesado', texto: textoPesado(bytes, p.max_bytes) }] };
  return /^[\uFEFF\s]*[[{]/.test(texto) ? leerJson(texto, p) : leerCsv(texto, p);
}

// ── El libro de Excel (docs/19 §4, bloque N, punto 6; 19/11/2026) ────────────────────────────────────────────────────────────────
// El único punto de entrada de un archivo elegido: por su firma, un libro .xlsx (un zip: «PK» y los bytes 3 y 4, o un zip vacío, 5 y 6) va al
// lector propio, que se descarga recién aquí (`cargar`, un `import()` dinámico: no entra en la primera carga ni en la del alta masiva); el
// contenedor del Office antiguo (un .xls, o un .xlsx protegido con contraseña, que Excel guarda cifrado dentro de él) se dice; todo lo demás
// se lee como texto UTF-8, como hasta el bloque S. Desde aquí el libro es el mismo camino que un CSV: `comprobar`, las mismas reglas de S1 y S2,
// y la revisión del servidor.
const empiezaCon = (b: Uint8Array, firma: readonly number[]): boolean => firma.every((x, i) => b[i] === x);
const FIRMAS_ZIP = [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06]] as const;
const FIRMA_OFFICE_ANTIGUO = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
type ModuloLector = typeof import('./xlsx-lector');
const problema = (caso: CasoError, texto: string): LecturaCsv => ({ filas: [], errores: [{ caso, texto }] });
export const textoLibro = (caso: 'libro_ilegible' | 'libro_grande', razon: string): string =>
  caso === 'libro_ilegible'
    ? `El libro no se puede leer: ${razon}. Guárdalo de nuevo desde tu planilla (como .xlsx o como CSV) o copia las celdas y pégalas aquí.`
    : `El libro es demasiado grande para leerlo: ${razon}. Guárdalo de nuevo solo con la hoja de los dispositivos, o copia las celdas y pégalas aquí.`;

export async function leerArchivoLote(bytes: Uint8Array, p: PlantillaLote, cargar: () => Promise<ModuloLector> = () => import('./xlsx-lector')): Promise<LecturaCsv> {
  if (bytes.length > p.max_bytes) return problema('archivo_pesado', textoPesado(bytes.length, p.max_bytes));
  if (empiezaCon(bytes, FIRMA_OFFICE_ANTIGUO)) return problema('libro_ilegible', textoLibro('libro_ilegible', 'es un libro de Excel antiguo (.xls) o está protegido con contraseña'));
  if (!FIRMAS_ZIP.some((f) => empiezaCon(bytes, f))) return leerOrigen(new TextDecoder().decode(bytes), p);
  let m: ModuloLector;
  try {
    m = await cargar();
  } catch {
    return problema('libro_sin_lector', 'No se pudo cargar el lector de libros de Excel (¿se cortó la conexión?). Elige el archivo de nuevo, o copia las celdas y pégalas aquí.');
  }
  try {
    return deLibro(await m.leerXlsx(bytes, { ...m.TOPES_XLSX, maxFilas: p.max_filas }), p);
  } catch (e) {
    if (!(e instanceof m.FallaLibro)) return problema('libro_ilegible', textoLibro('libro_ilegible', 'está dañado'));
    if (e.tipo === 'sin_lector') return problema('libro_sin_lector', TEXTO_DE.libro_sin_lector);
    const caso = e.tipo === 'grande' ? 'libro_grande' : 'libro_ilegible';
    return problema(caso, textoLibro(caso, e.razon));
  }
}

// Las palabras de una celda del libro que no se puede tomar como texto (`${rótulo}: …`). Un identificador que la planilla guardó como número
// pudo perder sus ceros a la izquierda o redondearse, y una celda con formato de fecha guarda un número de días: ninguno se adivina.
export const TEXTOS_LIBRO = {
  numero: 'la planilla lo guarda como número, y pudo quitarle ceros a la izquierda o redondearlo; escríbelo como texto',
  fecha: 'la planilla lo guarda con formato de fecha; escríbelo como texto',
  error: (v: string): string => `la planilla muestra el error «${recorte(v, 20)}»; corrígelo en la planilla o escribe el valor`,
  sinValor: 'es una fórmula sin su resultado guardado; ábrela y guárdala de nuevo en tu planilla, o escribe el valor',
  noNumero: 'trae un número que no se puede leer; escríbelo de nuevo en la planilla',
} as const;
// Las columnas que identifican algo (el equipo, su pasarela): un número ahí se rechaza en vez de escribirse.
const COLUMNAS_IDENTIFICADOR: readonly string[] = ['id_fisico', 'pasarela'];

// Un número de la planilla como se ve en una planilla en español: coma decimal, sin separador de miles y con a lo más 15 cifras significativas,
// la precisión de Excel («Number precision 15 digits», Microsoft, «Excel specifications and limits»). Así el 0.30000000000000004 que guarda
// una suma de coma flotante se lee «0,3», como lo muestra la planilla: no se inventan decimales (regla de los números de planilla).
// Uno que no es finito («1e400» desborda a Infinity) no se escribe como «Infinity»: se devuelve tal como venía (el lector ya lo rechaza, y
// `celdaComoTexto` también).
export function textoDeNumero(v: string): string {
  const x = Number(v);
  return Number.isFinite(x) ? String(Number(x.toPrecision(15))).replace('.', ',').replace('e', 'E') : v.trim();
}
const llena = (c: CeldaLibro | undefined): boolean => c !== undefined && !(c.tipo === 'texto' && c.v.trim() === '');
const textoDeCabecera = (c: CeldaLibro | undefined): string => (c === undefined || c.tipo === 'sin_valor' ? '' : c.tipo === 'numero' ? textoDeNumero(c.v) : c.v);
// La letra de una columna (0 → A, 26 → AA), para decir dónde está lo que sobra.
export function columnaEnLetras(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// Una celda del libro como el texto que llevaría el CSV, o el motivo por el que su fila no entra. `col`: la columna de la plantilla (sin ella,
// una columna que se ignora o que no es de la plantilla, solo se convierte).
function celdaComoTexto(c: CeldaLibro | undefined, col: ColumnaPlantilla | undefined): { texto: string; motivo: string | null } {
  if (c === undefined || c.tipo === 'texto') return { texto: c?.v ?? '', motivo: null };
  const no = (m: string): { texto: string; motivo: string | null } => ({ texto: '', motivo: col === undefined ? null : `${col.rotulo ?? col.nombre}: ${m}` });
  if (c.tipo === 'numero' && !c.fecha && !Number.isFinite(Number(c.v))) return no(TEXTOS_LIBRO.noNumero);
  if (c.tipo === 'numero' && !c.fecha) return col !== undefined && COLUMNAS_IDENTIFICADOR.includes(col.nombre) ? no(TEXTOS_LIBRO.numero) : { texto: textoDeNumero(c.v), motivo: null };
  if (c.tipo === 'numero' || c.tipo === 'fecha') return no(TEXTOS_LIBRO.fecha);
  if (c.tipo === 'logico') return no(TEXTOS_CELDA.tipo);
  return no(c.tipo === 'error' ? TEXTOS_LIBRO.error(c.v) : TEXTOS_LIBRO.sinValor);
}

// La primera hoja del libro → las mismas filas que daría su CSV: la cabecera es su primera fila con datos y `n`, el número de fila de la
// planilla. Lo que no se puede tomar como texto deja fuera su fila con su motivo (S1); un dato en una columna sin cabecera, también.
export function deLibro(l: Libro, p: PlantillaLote): LecturaCsv {
  const [primera, ...resto] = l.filas;
  if (primera === undefined) return problema('archivo_vacio', `La primera hoja del libro («${recorte(l.hoja)}») está vacía: se lee solo la primera hoja.`);
  let ancho = primera.celdas.length;
  while (ancho > 0 && !llena(primera.celdas[ancho - 1])) ancho--;
  const cabecera = Array.from({ length: ancho }, (_, i) => textoDeCabecera(primera.celdas[i]).trim().toLowerCase());
  const porNombre = new Map(p.columnas.map((c) => [c.nombre, c]));
  const datos: Registro[] = resto.map((f) => {
    const motivos: Nota[] = [];
    const celdas = cabecera.map((col, i) => {
      const r = celdaComoTexto(f.celdas[i], IGNORADAS.includes(col) ? undefined : porNombre.get(col));
      if (r.motivo !== null) motivos.push({ campo: col, texto: r.motivo });
      return r.texto;
    });
    const sobran = f.celdas.flatMap((c, i) => (i >= ancho && llena(c) ? [{ v: recorte(textoDeCabecera(c).trim(), 20), col: columnaEnLetras(i) }] : []));
    if (sobran.length === 1) motivos.unshift({ campo: 'fila', texto: `la fila trae «${sobran[0]!.v}» en la columna ${sobran[0]!.col}, que no tiene cabecera` });
    else if (sobran.length > 1) motivos.unshift({ campo: 'fila', texto: `la fila trae datos en ${sobran.length} columnas sin cabecera: ${sobran.map((x) => `«${x.v}» (${x.col})`).join(', ')}` });
    return { n: f.n, celdas, motivos };
  });
  const r = comprobar(cabecera, datos, p, { caso: 'solo_cabecera', texto: 'El libro trae la cabecera pero ninguna fila de datos.' });
  // La lectura se detuvo en max_filas + 1 filas de datos: no se sabe cuántas trae, solo que son más que el máximo.
  if (l.cortado) {
    r.errores = r.errores.map((e) => (e.caso === 'demasiadas_filas' ? { caso: e.caso, texto: `La primera hoja del libro trae más de ${p.max_filas} filas y el máximo es ${p.max_filas}: divídelo en partes de ${p.max_filas} o menos.` } : e));
  }
  return r;
}
const recorte = (t: string, max = 80): string => (t.length > max ? `${t.slice(0, max)}…` : t);
export const textoPesado = (bytes: number, max: number): string => `El archivo pesa ${megas(bytes)} MB y el máximo es ${megas(max)} MB: divídelo en partes más chicas.`;
export const megas = (bytes: number): string => (bytes / 1_000_000).toLocaleString('es-CL', { maximumFractionDigits: 1 });

// El cuerpo que se enviará, contra el tope de bytes de la plantilla (antes de enviar: el servidor respondería 413).
export function excedeBytes(cuerpo: unknown, p: PlantillaLote): boolean {
  return new TextEncoder().encode(JSON.stringify(cuerpo)).length > p.max_bytes;
}

// ── El plan del servidor ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export type ResultadoFila = 'valida' | 'creada' | 'rechazada' | 'existe';
export interface Nota { campo: string; texto: string }
export interface FilaInforme {
  n: number; // la fila del archivo, la que mandó el panel
  id_fisico: string;
  resultado: ResultadoFila;
  motivo: string | null;
  id: string | null;
  credencial: string | null;
  topico: string | null;
  // A dónde envía el equipo creado según su vía (solo al crear; docs/19 §4, bloque S): el tópico MQTT, «POST /recepcion/<id>» o «por su pasarela <id>».
  destino?: string | null;
  interpretada?: Record<string, unknown> | null;
  // Lo interpretado en palabras de personas, escrito por el servidor (docs/19 §4, bloque S, punto 4): dónde se crea, el resumen y cada campo.
  legible?: { donde: string; resumen: string; campos: Record<string, string> } | null;
  por_defecto?: string[];
  avisos?: Nota[];
  motivos?: Nota[];
}
export interface InformeLote {
  leidas?: number;
  validas: number;
  rechazadas: number;
  existentes: number;
  con_aviso?: number;
  huella: string;
  zonas_por_nombre?: ZonaPorNombre[];
  filas: FilaInforme[];
}
// Las zonas escritas por su nombre en las filas que entran (bloque S, punto 3): la revisión lo dice una vez sobre la lista.
export interface ZonaPorNombre { zona: string; sitio: string; filas: number }
// Una fila mal formada, como fila del plan: «No entra», con sus motivos, sin pasar por el servidor (bloque S, punto 1).
export function filaQueNoEntra(x: FilaNoEntra): FilaInforme {
  const id = x.fila.id_fisico;
  return {
    n: x.fila.n, id_fisico: id === undefined ? '' : String(id), resultado: 'rechazada', motivo: x.motivos.map((m) => m.texto).join('; '), id: null, credencial: null,
    topico: null, interpretada: null, legible: null, por_defecto: [], avisos: [], motivos: x.motivos,
  };
}
// El plan del servidor y las filas que no entran por cómo están escritas, en el orden del origen.
export const mezclarPlan = (servidor: readonly FilaInforme[], locales: readonly FilaInforme[]): FilaInforme[] => [...servidor, ...locales].sort((a, b) => a.n - b.n);

// ── Crear: una petición, y la misma llave si la respuesta se pierde ────────────────────────────────────────────────────────────────
// Se repite solo cuando no se sabe qué pasó (sin respuesta, o un 5xx —un 500 del servidor o un 502/503/504 de un intermediario— sin `codigo` del backend: pudo crear y fallar después); un 4xx o un
// fallo con `codigo` (`nada_creado`, `lote_incierto`) es una respuesta y se devuelve. Un 409 `lote_en_curso` al repetir puede ser la
// propia petición anterior todavía en curso: también se repite, tras la espera. El intento en que llegó la respuesta viaja con ella: un
// 409 en un intento posterior al primero no prueba que no se creó nada (revisión del 15/11/2026).
export const INTENTOS_CREAR = 3;
export function hayQueRepetir(e: unknown): boolean {
  if (!(e instanceof ErrorApi)) return false;
  if (typeof e.cuerpo.codigo === 'string') return false;
  return e.codigo === 0 || e.codigo >= 500;
}
export const codigoDeConflicto = (e: unknown): string | null =>
  e instanceof ErrorApi && e.codigo === 409 && typeof e.cuerpo.codigo === 'string' ? e.cuerpo.codigo : null;
export class FalloDeCreacion extends Error {
  constructor(readonly causa: unknown, readonly intento: number) {
    super(causa instanceof Error ? causa.message : String(causa));
    this.name = 'FalloDeCreacion';
  }
}
export async function crearConReintento<T>(
  enviar: (llave: string) => Promise<T>,
  llave: string,
  esperar: (ms: number) => Promise<void> = (ms) => new Promise((ok) => setTimeout(ok, ms)),
  intentos = INTENTOS_CREAR,
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await enviar(llave);
    } catch (e) {
      const repetible = hayQueRepetir(e) || (i > 1 && codigoDeConflicto(e) === 'lote_en_curso');
      if (!repetible || i >= intentos) throw new FalloDeCreacion(e, i);
      await esperar(1000 * i);
    }
  }
}

// ── Qué falló, por qué y qué hacer (docs/19 §4, N8b): una sola traducción de cada error a su mensaje y su acción ─────────────────────
// Desde el bloque S (punto 1), una fila con celdas de más o de menos ya no es un error del archivo (era `celdas_de_mas_o_de_menos`): es un
// motivo de esa fila. `celda_invalida` queda para lo que impide leer el archivo (una comilla sin cerrar, un JSON que no es una lista).
export const CASOS_ERROR = [
  'archivo_vacio', 'solo_cabecera', 'una_columna', 'libro_ilegible', 'libro_grande', 'libro_sin_lector', 'columna_desconocida', 'falta_obligatoria', 'columna_repetida',
  'demasiadas_filas', 'archivo_pesado', 'celda_invalida', 'rechazo_del_servidor', 'sesion_vencida', 'sin_permiso', 'lote_en_curso', 'plan_cambio',
  'demasiadas_peticiones', 'sin_respuesta', 'sin_conexion', 'nada_creado', 'lote_incierto', 'llave_reutilizada', 'otro',
] as const;
export type CasoError = (typeof CASOS_ERROR)[number];
export const ACCIONES_LOTE = ['otro_archivo', 'pegar', 'plantilla', 'revisar', 'reintentar', 'inventario', 'sesion'] as const;
export type AccionLote = (typeof ACCIONES_LOTE)[number];
export const ROTULO_ACCION: Readonly<Record<AccionLote, string>> = {
  otro_archivo: 'Elegir otro archivo', pegar: 'Pegar las celdas', plantilla: 'Descargar la plantilla', revisar: 'Volver a revisar', reintentar: 'Reintentar',
  inventario: 'Ir al inventario', sesion: 'Iniciar sesión',
};
// La acción de cada caso (la tabla de N8b). Una prueba recorre CASOS_ERROR y falla si alguno se queda sin acción o sin mensaje.
export const ACCION_DE: Readonly<Record<CasoError, AccionLote>> = {
  archivo_vacio: 'otro_archivo', solo_cabecera: 'otro_archivo', una_columna: 'plantilla', libro_ilegible: 'otro_archivo', libro_grande: 'otro_archivo', libro_sin_lector: 'pegar', columna_desconocida: 'plantilla', falta_obligatoria: 'plantilla',
  columna_repetida: 'plantilla', demasiadas_filas: 'otro_archivo', archivo_pesado: 'otro_archivo',
  celda_invalida: 'otro_archivo', rechazo_del_servidor: 'otro_archivo', sesion_vencida: 'sesion', sin_permiso: 'inventario', lote_en_curso: 'reintentar',
  plan_cambio: 'revisar', demasiadas_peticiones: 'reintentar', sin_respuesta: 'inventario', sin_conexion: 'reintentar', nada_creado: 'reintentar',
  lote_incierto: 'inventario', llave_reutilizada: 'revisar', otro: 'reintentar',
};
export const AVISO_SIN_RESPUESTA = 'No llegó la respuesta de la creación y no se sabe si se crearon. Revisa el inventario: las filas que al validar de nuevo salgan «ya existe» se crearon, y sus credenciales no se pueden recuperar: rota la credencial de cada una desde su ficha.';
// Los mensajes fijos de cada caso que no lleva datos propios (los que dependen de la respuesta se arman en explicarError).
export const TEXTO_DE: Readonly<Record<CasoError, string>> = {
  archivo_vacio: 'El archivo está vacío.',
  solo_cabecera: 'El archivo trae la cabecera pero ninguna fila de datos.',
  una_columna: 'La cabecera tiene una sola columna: no hay «;», «,» ni tabulador entre las columnas.',
  // Los del libro .xlsx (bloque N, punto 6): el texto que se ve lleva además la razón (`textoLibro`).
  libro_ilegible: 'El libro no se puede leer: guárdalo de nuevo desde tu planilla (como .xlsx o como CSV) o copia las celdas y pégalas aquí.',
  libro_grande: 'El libro es demasiado grande para leerlo: guárdalo de nuevo solo con la hoja de los dispositivos, o copia las celdas y pégalas aquí.',
  libro_sin_lector: 'Este navegador no puede abrir libros de Excel: copia las celdas en tu planilla y pégalas aquí, o guarda el libro como CSV.',
  columna_desconocida: 'El archivo trae una columna que no es de la plantilla.',
  falta_obligatoria: 'Falta una columna obligatoria.',
  columna_repetida: 'Una columna está repetida en la cabecera.',
  demasiadas_filas: 'El archivo trae más filas que el máximo: divídelo.',
  archivo_pesado: 'El archivo pesa más que el máximo: divídelo.',
  celda_invalida: 'Una celda pasa su tope o trae un carácter que no se admite.',
  rechazo_del_servidor: 'El servidor rechazó el archivo. Corrígelo y vuelve a elegirlo.',
  sesion_vencida: 'Tu sesión venció. Entra de nuevo: el archivo leído se conserva en esta pestaña y lo vuelves a validar antes de crear.',
  sin_permiso: 'Tu perfil no permite dar de alta dispositivos (lo hacen el operador técnico y los administradores). No se creó ninguno.',
  lote_en_curso: 'Hay otra alta por lote en curso en el servidor. Espera a que termine y reintenta; no se creó ninguno.',
  plan_cambio: 'Cambió algo desde que lo revisaste y no se creó ninguno. La revisión ya muestra lo de ahora; míralo y vuelve a crear.',
  demasiadas_peticiones: 'Hiciste demasiadas validaciones o creaciones en un minuto. Espera un momento y reintenta.',
  sin_respuesta: AVISO_SIN_RESPUESTA,
  sin_conexion: 'No hubo respuesta del servidor. Validar no crea nada: reintenta cuando vuelva la conexión.',
  nada_creado: 'No se creó ninguno: el servidor no logró hablar con el broker o con la base de datos. Reintenta en un momento.',
  lote_incierto: 'El servidor no pudo confirmar si se crearon. Revisa el inventario: los que aparezcan quedaron creados y necesitan rotar su credencial desde su ficha; si no aparecen, avisa al administrador del servidor.',
  llave_reutilizada: 'Esta creación se cruzó con una anterior de otro contenido y no se creó nada con ella. Vuelve a revisar y crea de nuevo.',
  otro: 'No se pudo completar. Reintenta en un momento.',
};
// Lo que ve la persona al volver de «Entrar» tras una sesión vencida: el archivo se conservó en la pestaña.
export const TEXTO_SESION_RETOMADA = 'Tu sesión había vencido. El archivo leído se conservó: valídalo de nuevo antes de crear.';
export interface ErrorExplicado { caso: CasoError; texto: string; accion: AccionLote; detalles: string[] }
const explicado = (caso: CasoError, texto = TEXTO_DE[caso], detalles: string[] = []): ErrorExplicado => ({ caso, texto, accion: ACCION_DE[caso], detalles });

// Las filas que cambiaron entre el plan que la persona vio y el nuevo, en palabras: «Fila 12: se creaba → ya existe».
const QUE_PASA: Readonly<Record<ResultadoFila, string>> = { valida: 'se crea', creada: 'creada', existe: 'ya existe', rechazada: 'no entra' };
export function describirCambios(visto: readonly FilaInforme[], nuevo: readonly FilaInforme[]): string[] {
  const antes = new Map(visto.map((f) => [f.n, f]));
  const cambios: string[] = [];
  for (const f of nuevo) {
    const a = antes.get(f.n);
    if (a === undefined) continue;
    const motivo = f.motivo === null ? '' : `: ${f.motivo}`;
    if (a.resultado !== f.resultado) {
      cambios.push(`Fila ${f.n} (${f.id_fisico}): ${QUE_PASA[a.resultado]} → ${QUE_PASA[f.resultado]}${f.resultado === 'valida' ? '' : motivo}`);
      continue;
    }
    const ia = a.interpretada ?? {};
    const ib = f.interpretada ?? {};
    const campos = [...new Set([...Object.keys(ia), ...Object.keys(ib)])].filter((k) => JSON.stringify(ia[k]) !== JSON.stringify(ib[k]));
    if (campos.length > 0) cambios.push(`Fila ${f.n} (${f.id_fisico}): sigue entrando, pero cambió ${campos.map((k) => `${k} ${valor(ia[k])} → ${valor(ib[k])}`).join(', ')}`);
  }
  return cambios;
}
const valor = (v: unknown): string => (v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));

// La traducción única. `intento`: en qué intento llegó la respuesta (1 si no hubo repeticiones); `visto`: el plan que la persona revisó.
export function explicarError(e: unknown, ctx: { operacion: 'validar' | 'crear'; intento?: number; visto?: readonly FilaInforme[] } = { operacion: 'crear' }): ErrorExplicado {
  const causa = e instanceof FalloDeCreacion ? e.causa : e;
  const intento = e instanceof FalloDeCreacion ? e.intento : (ctx.intento ?? 1);
  if (!(causa instanceof ErrorApi)) return explicado('otro');
  const codigo = typeof causa.cuerpo.codigo === 'string' ? causa.cuerpo.codigo : null;
  const motivos = causa.motivos.slice(0, 5);
  if (causa.codigo === 401) return explicado('sesion_vencida');
  if (causa.codigo === 403) return explicado('sin_permiso');
  // En un intento posterior al primero, un 409 no prueba que no se creó nada: la petición original pudo crear y perder su respuesta.
  if (causa.codigo === 409 && ctx.operacion === 'crear' && intento > 1) return explicado('sin_respuesta');
  if (codigo === 'lote_en_curso') return explicado('lote_en_curso');
  if (codigo === 'plan_cambio') {
    const plan = causa.cuerpo.plan as { filas?: FilaInforme[] } | undefined;
    const cambios = describirCambios(ctx.visto ?? [], plan?.filas ?? []);
    return explicado('plan_cambio', TEXTO_DE.plan_cambio, cambios.length > 0 ? cambios : ['No se pudo decir qué fila cambió: revisa el informe completo.']);
  }
  if (codigo === 'llave_reutilizada') return explicado('llave_reutilizada');
  if (causa.codigo === 429) {
    const s = causa.reintentarEnS;
    return explicado('demasiadas_peticiones', s === null ? TEXTO_DE.demasiadas_peticiones : `Hiciste demasiadas validaciones o creaciones en un minuto. Espera ${s} s y reintenta.`);
  }
  if (codigo === 'lote_incierto') return explicado('lote_incierto');
  if (codigo === 'nada_creado') return explicado('nada_creado');
  if (causa.codigo === 413) return explicado(codigo === 'demasiadas_filas' ? 'demasiadas_filas' : 'archivo_pesado', `${motivos[0] ?? 'El archivo es demasiado grande'}.`);
  if (causa.codigo === 400) return explicado('rechazo_del_servidor', TEXTO_DE.rechazo_del_servidor, motivos);
  if (hayQueRepetir(causa)) return explicado(ctx.operacion === 'crear' ? 'sin_respuesta' : 'sin_conexion');
  return explicado('otro', TEXTO_DE.otro, motivos);
}

// La memoria del alta masiva en la pestaña (el borrador del origen y las credenciales sin descargar) vive en lib/lote-memoria.ts: la usa
// también App.svelte al cerrar la sesión, sin cargar este módulo en la primera carga.
export { borradorLote, credencialesLote, olvidarCredencialesLote, olvidarLote, retomarLoteDe } from './lote-memoria';
export function nuevaLlave(): string {
  return crypto.randomUUID();
}

// ── Lo que se descarga (por el ayudante único `descargarTexto`, docs/19 §6 y §4 N9) ────────────────────────────────────────────────
// La plantilla y «las que no entran» van con «;», BOM y CRLF: una planilla en español los abre en columnas. Una celda entre comillas si hace
// falta; y si empieza con = + - @, tabulador, retorno o salto de línea, o con sus variantes de ancho completo, con un apóstrofo delante
// (inyección de fórmulas: OWASP «CSV Injection»); la única excepción es una celda que ENTERA sea un número (`-5`, `+3,2`). Las credenciales
// van `literal`: son para máquinas y no se pueden alterar.
const FORMULA = /^[=+\-@\t\r\n＝＋－＠]/;
const NUMERO = /^[+-]?\d+(?:[.,]\d+)?$/;
export function celda(v: string | number | null | undefined, literal = false): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (!literal && FORMULA.test(s) && !NUMERO.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const lineaCsv = (xs: readonly string[], separador = ','): string => xs.join(separador);
const BOM = '\uFEFF';
const tablaCsv = (lineas: readonly string[]): string => `${BOM}${lineas.join('\r\n')}\r\n`;

// Las credenciales de las creadas: id_fisico, id, credencial y destino, a dónde envía cada uno según su vía (desde el bloque S; antes, `topico`,
// vacío fuera de MQTT): el tópico MQTT, «POST /recepcion/<id_fisico>» o «por su pasarela <id_fisico>», con la credencial vacía (la
// pasarela autentica a los LoRaWAN). CRLF (RFC 4180); es para máquinas: con coma y sin BOM.
export function csvCredenciales(filas: readonly FilaInforme[]): string {
  const creadas = filas.filter((f) => f.resultado === 'creada');
  return [lineaCsv(['id_fisico', 'id', 'credencial', 'destino']), ...creadas.map((f) => lineaCsv([celda(f.id_fisico, true), celda(f.id, true), celda(f.credencial, true), celda(f.destino ?? f.topico, true)]))].join('\r\n') + '\r\n';
}

// Las que no entran, con las columnas de la plantilla en su orden y, al final, `fila` (la del origen) y `motivo`: se corrigen y se vuelven
// a subir tal cual (el lector ignora esas dos).
export function csvRechazadas(columnas: readonly string[], original: readonly FilaLote[], filas: readonly FilaInforme[]): string {
  const porN = new Map(original.map((f) => [f.n, f]));
  const malas = filas.filter((f) => f.resultado === 'rechazada');
  const cuerpo = malas.map((f) => {
    const o = porN.get(f.n) ?? { n: f.n };
    return lineaCsv([...columnas.map((c) => celda(o[c])), celda(f.n), celda(f.motivo)], ';');
  });
  return tablaCsv([lineaCsv([...columnas, COLUMNA_FILA, COLUMNA_MOTIVO], ';'), ...cuerpo]);
}

// La plantilla para descargar antes de empezar: la cabecera y una fila con el ejemplo de cada columna.
export function csvPlantilla(p: PlantillaLote): string {
  return tablaCsv([lineaCsv(p.columnas.map((c) => c.nombre), ';'), lineaCsv(p.columnas.map((c) => celda(c.ejemplo)), ';')]);
}

// El nombre de la descarga de «las que no entran», a partir del del origen: sin extensión y solo con el alfabeto que admite `nombreDeArchivo`
// (lib/api.ts); un nombre como «lote (1).csv» no cae al nombre por omisión.
export function baseDeDescarga(origen: string | null): string {
  const base = (origen ?? '').replace(/\.(csv|json|tsv|txt)$/i, '').replace(/[^\p{L}\p{N}_.\- ]/gu, '').trim().replace(/^\.+/, '').slice(0, 100).trim();
  return base === '' ? 'lote' : base;
}
