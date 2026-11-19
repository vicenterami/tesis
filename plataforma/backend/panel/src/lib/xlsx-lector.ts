// Lector propio de libros .xlsx para el alta masiva (docs/19 §4, bloque N, punto 6; construido el 19/11/2026). Se descarga solo al elegir
// un .xlsx (`import()` desde lib/lote.ts) y no importa nada: no entra en la primera carga ni arrastra otro código. Abre un archivo que puede
// venir de un tercero, así que lee lo mínimo y con topes escritos:
//   - del zip (PKWARE, APPNOTE.TXT 6.3.10): el fin de directorio (§4.3.16, y el de ZIP64, §4.3.14 y §4.3.15), el directorio central (§4.3.12,
//     con el campo extra ZIP64 de §4.5.3) y la cabecera local de cada parte que se lee (§4.3.7); solo los métodos 0 (guardada) y 8 (deflate)
//     de §4.4.5 y nada cifrado (§4.4.4, bits 0 y 6). Como mucho `entradas` partes en el directorio; dos con el mismo nombre lo hacen ilegible;
//   - del libro (ECMA-376, 5.ª edición, Parte 1; la Parte 2 para el paquete): SOLO «[Content_Types].xml», «xl/workbook.xml», sus relaciones
//     «xl/_rels/workbook.xml.rels», la tabla de estilos (qué celda tiene formato de fecha: §18.8.30 y §18.8.10), la de cadenas compartidas
//     (§18.4.8 y §18.4.9) y la PRIMERA hoja visible en el orden de `<sheets>` (§18.2.19 y §18.18.68). Ninguna otra parte se abre;
//   - cada parte se descomprime con `DecompressionStream('deflate-raw')` (WHATWG Compression; Chrome 103, Firefox 113 y Safari 16.4, según
//     browser-compat-data) contando los bytes MIENTRAS salen: un tope por parte y otro en total, nunca el tamaño que declara el zip. Al terminar
//     una parte, su tamaño y su CRC-32 deben ser los del directorio;
//   - el XML lo recorre un lector propio de etiquetas: un `<!DOCTYPE` (o cualquier otra declaración `<!…`) se rechaza, y una entidad que no es
//     una de las cinco de XML ni una referencia numérica también: no hay entidades externas ni expansiones;
//   - la hoja se lee mientras se descomprime y la lectura se DETIENE al juntar la cabecera y `maxFilas + 1` filas con datos;
//   - la columna sale de la referencia `r` de cada celda (las vacías no aparecen; §18.3.1.4) o, si no la trae, de la posición (CT_Cell la
//     declara opcional y el escritor de la exportación por sitio no la escribe); la fila, de la suya (§18.3.1.73);
//   - el texto: cadena compartida, en línea (`inlineStr`) o el resultado guardado de una fórmula (`str`): una fórmula nunca se evalúa. El
//     escape `_xHHHH_` de ST_Xstring (§22.9.2.19; el literal va «_x005F_», §22.4.2.4) se deshace; las lecturas fonéticas (`rPh`) no son texto.
// Qué es cada celda para el alta (texto, número, fecha, valor lógico, error o fórmula sin resultado) lo decide lib/lote.ts.

export interface TopesXlsx {
  maxFilas: number; // filas de datos: se leen la cabecera y hasta maxFilas + 1
  bytesPorParte: number; // descomprimidos, contados mientras salen
  bytesTotales: number;
  entradas: number; // partes en el directorio del zip
  cadenas: number; // textos en la tabla de cadenas compartidas
}
// 8 MiB por parte: 500 filas con cada celda en su tope y cada carácter escrito «&amp;» ocupan menos de 5 MB (lo mide xlsx-lector.test.ts).
export const TOPES_XLSX: Readonly<Omit<TopesXlsx, 'maxFilas'>> = { bytesPorParte: 8 * 2 ** 20, bytesTotales: 16 * 2 ** 20, entradas: 1000, cadenas: 50_000 };

export type CeldaLibro =
  | { tipo: 'texto'; v: string }
  | { tipo: 'numero'; v: string; fecha: boolean }
  | { tipo: 'fecha' | 'logico' | 'error'; v: string }
  | { tipo: 'sin_valor' };
// `celdas[i]`: la columna i (A = 0); un hueco es una celda vacía.
export interface FilaLibro { n: number; celdas: (CeldaLibro | undefined)[] }
export interface Libro { hoja: string; filas: FilaLibro[]; cortado: boolean }

// Por qué no se pudo leer, en palabras de la persona: `ilegible` (dañado, no es un .xlsx o trae algo que el lector no admite), `grande` (pasa
// un tope) o `sin_lector` (el navegador no trae DecompressionStream('deflate-raw')).
export class FallaLibro extends Error {
  constructor(readonly tipo: 'ilegible' | 'grande' | 'sin_lector', readonly razon: string) {
    super(razon);
    this.name = 'FallaLibro';
  }
}
const ilegible = (r: string): FallaLibro => new FallaLibro('ilegible', r);
const grande = (r: string): FallaLibro => new FallaLibro('grande', r);
const DANADO = 'está dañado';
// Los megabytes como los dice la pantalla (`megas` de lib/lote.ts: 10^6 bytes y coma decimal); una prueba compara los dos textos.
const mb = (n: number): string => (n / 1_000_000).toLocaleString('es-CL', { maximumFractionDigits: 1 });
// Lo que viene del archivo y se repite en un mensaje (un nombre de hoja, una ruta), recortado.
const corto = (t: string): string => (t.length > 60 ? `${t.slice(0, 60)}…` : t);

export function hayDescompresor(): boolean {
  try {
    return typeof DecompressionStream === 'function' && new DecompressionStream('deflate-raw') !== null;
  } catch {
    return false; // WHATWG: «If format is unsupported in DecompressionStream, then throw a TypeError»
  }
}

// ── El zip ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Entrada { nombre: Uint8Array; banderas: number; metodo: number; crc: number; comprimido: number; tamano: number; local: number }
const MAX_32 = 0xffffffff;

function directorio(b: Uint8Array, maxEntradas: number): { entradas: Map<string, Entrada>; inicio: number } {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (p: number): number => d.getUint16(p, true);
  const u32 = (p: number): number => d.getUint32(p, true);
  const u64 = (p: number): number => {
    const x = d.getBigUint64(p, true);
    if (x > BigInt(b.length)) throw ilegible(DANADO);
    return Number(x);
  };
  // El fin de directorio (§4.3.16): el último cuyo comentario llega justo al final del archivo.
  let fin = -1;
  for (let i = b.length - 22; i >= 0 && i >= b.length - 22 - 0xffff; i--) {
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === b.length) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw ilegible('está incompleto o dañado');
  let total = u16(fin + 10);
  let largo = u32(fin + 12);
  let inicio = u32(fin + 16);
  let tope = fin;
  if (total === 0xffff || largo === MAX_32 || inicio === MAX_32) {
    // ZIP64 (§4.3.15 y §4.3.14): el localizador va justo antes del fin de directorio y apunta al registro.
    if (fin < 20 || u32(fin - 20) !== 0x07064b50) throw ilegible(DANADO);
    const r = u64(fin - 12);
    if (r + 56 > fin - 20 || u32(r) !== 0x06064b50) throw ilegible(DANADO);
    total = u64(r + 32);
    largo = u64(r + 40);
    inicio = u64(r + 48);
    tope = r;
  } else if (u16(fin + 4) !== 0 || u16(fin + 6) !== 0) throw ilegible('está partido en varios archivos');
  if (total > maxEntradas) throw grande(`trae ${total} partes y se abren libros de hasta ${maxEntradas}`);
  const finDirectorio = inicio + largo;
  if (finDirectorio > tope) throw ilegible(DANADO);
  const entradas = new Map<string, Entrada>();
  const nombres = new TextDecoder();
  let p = inicio;
  for (let k = 0; k < total; k++) {
    if (p + 46 > finDirectorio || u32(p) !== 0x02014b50) throw ilegible(DANADO);
    const nl = u16(p + 28);
    const el = u16(p + 30);
    const siguiente = p + 46 + nl + el + u16(p + 32);
    if (siguiente > finDirectorio) throw ilegible(DANADO);
    const e: Entrada = {
      nombre: b.subarray(p + 46, p + 46 + nl), banderas: u16(p + 8), metodo: u16(p + 10), crc: u32(p + 16), comprimido: u32(p + 20), tamano: u32(p + 24),
      local: u32(p + 42),
    };
    // El campo extra ZIP64 (§4.5.3) trae, en este orden, solo los campos que en el directorio valen 0xFFFFFFFF.
    for (let x = p + 46 + nl; x + 4 <= p + 46 + nl + el; x += 4 + u16(x + 2)) {
      if (u16(x) !== 0x0001) continue;
      let q = x + 4;
      for (const campo of ['tamano', 'comprimido', 'local'] as const) {
        if (e[campo] !== MAX_32) continue;
        if (q + 8 > x + 4 + u16(x + 2)) throw ilegible(DANADO);
        e[campo] = u64(q);
        q += 8;
      }
    }
    // Los nombres de las partes no distinguen mayúsculas (ECMA-376 Parte 2): dos iguales darían dos lecturas posibles del mismo libro.
    const clave = nombres.decode(e.nombre).toLowerCase();
    if (entradas.has(clave)) throw ilegible('trae dos partes con el mismo nombre');
    entradas.set(clave, e);
    p = siguiente;
  }
  return { entradas, inicio };
}

// CRC-32 de zip (polinomio 0xEDB88320), por trozos.
let tablaCrc: Uint32Array | null = null;
function crc32(x: Uint8Array, crc: number): number {
  if (tablaCrc === null) {
    tablaCrc = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tablaCrc[n] = c >>> 0;
    }
  }
  let c = ~crc;
  for (let i = 0; i < x.length; i++) c = tablaCrc[(c ^ x[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

async function* descomprimir(datos: Uint8Array): AsyncGenerator<Uint8Array> {
  if (!hayDescompresor()) throw new FallaLibro('sin_lector', 'este navegador no trae el descompresor que hace falta');
  // Lo comprimido entra en tajadas de 8 KiB, a pedido del descompresor: así lo que sale de cada lectura queda acotado aunque un navegador
  // entregue de una vez lo que produce cada trozo de entrada.
  let p = 0;
  const fuente = new ReadableStream<Uint8Array>({
    pull(c) {
      if (p >= datos.length) c.close();
      else c.enqueue(datos.subarray(p, (p += 8192)));
    },
  });
  const lector = fuente.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  try {
    for (;;) {
      let r: ReadableStreamReadResult<Uint8Array>;
      try {
        r = await lector.read();
      } catch {
        throw ilegible(`${DANADO}: una de sus partes no se puede descomprimir`);
      }
      if (r.done) return;
      yield r.value;
    }
  } finally {
    void lector.cancel().catch(() => undefined); // quien deja de leer antes corta la descompresión
  }
}

class Zip {
  private usados = 0;
  constructor(private readonly b: Uint8Array, private readonly entradas: Map<string, Entrada>, private readonly inicio: number, private readonly topes: TopesXlsx) {}

  hay(nombre: string): boolean {
    return this.entradas.has(nombre.toLowerCase());
  }

  // Los bytes descomprimidos de una parte, por trozos, contados mientras salen.
  async *trozos(nombre: string): AsyncGenerator<Uint8Array> {
    const e = this.entradas.get(nombre.toLowerCase());
    if (e === undefined) throw ilegible(`${DANADO}: le falta una parte`);
    if ((e.banderas & 0x41) !== 0) throw ilegible('está protegido con contraseña');
    if (e.metodo !== 0 && e.metodo !== 8) throw ilegible(`usa una compresión que el lector no conoce (método ${e.metodo})`);
    const d = new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength);
    const l = e.local;
    if (l + 30 > this.inicio || d.getUint32(l, true) !== 0x04034b50) throw ilegible(DANADO);
    const nl = d.getUint16(l + 26, true);
    const desde = l + 30 + nl + d.getUint16(l + 28, true);
    // La cabecera local debe nombrar la misma parte que el directorio: si no, dos lectores verían archivos distintos.
    const propio = this.b.subarray(l + 30, l + 30 + nl);
    if (nl !== e.nombre.length || propio.some((x, i) => x !== e.nombre[i]) || desde + e.comprimido > this.inicio) throw ilegible(DANADO);
    const datos = this.b.subarray(desde, desde + e.comprimido);
    let n = 0;
    let crc = 0;
    for await (const trozo of e.metodo === 0 ? [datos] : descomprimir(datos)) {
      n += trozo.length;
      this.usados += trozo.length;
      if (n > this.topes.bytesPorParte) throw grande(`una de sus partes ocupa más de ${mb(this.topes.bytesPorParte)} MB al abrirla`);
      if (this.usados > this.topes.bytesTotales) throw grande(`sus partes ocupan más de ${mb(this.topes.bytesTotales)} MB al abrirlas`);
      crc = crc32(trozo, crc);
      yield trozo;
    }
    if (n !== e.tamano || crc !== e.crc) throw ilegible(`${DANADO}: una de sus partes no es lo que declara el zip`);
  }
}

// ── El XML ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
type Atributos = Record<string, string>;
interface Oyente {
  abre(nombre: string, a: Atributos): void;
  cierra(nombre: string): void;
  texto(t: string): void;
  terminar(): void; // la parte se leyó entera: todo lo abierto debe estar cerrado
}
const ENTIDADES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
// Los caracteres que XML 1.0 admite (§2.2, «Char»): una referencia numérica a otro hace mal formado el documento.
const CARACTER_XML = (c: number): boolean => c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff);
function sinEntidades(t: string): string {
  if (!t.includes('&')) return t;
  return t.replace(/&([^;&<]*)(;?)/g, (_, x: string, pc: string) => {
    const m = /^#(?:x([0-9a-fA-F]{1,6})|([0-9]{1,7}))$/.exec(x);
    const c = m === null ? -1 : m[1] !== undefined ? parseInt(m[1], 16) : parseInt(m[2]!, 10);
    const r = m === null ? ENTIDADES[x] : CARACTER_XML(c) ? String.fromCodePoint(c) : undefined;
    if (pc !== ';' || r === undefined) throw ilegible(`${DANADO}: trae una referencia «&…;» que no existe`);
    return r;
  });
}
const local = (n: string): string => n.slice(n.indexOf(':') + 1);
const blanco = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';
// Una etiqueta (lo que va entre «<» y «>») no pasa de 16 KiB: la más larga de un libro legítimo es un valor de atributo de unas decenas de
// caracteres (un formato de número tiene como mucho 255 en Excel). Sin este tope, un tramo enorme se recorría una y otra vez.
const MAX_ETIQUETA = 16 * 1024;

// Recorre el XML por trozos (lo incompleto espera al trozo siguiente) y avisa de cada etiqueta y cada texto. Los nombres llegan sin prefijo.
// Cada carácter se mira una vez: el texto se entrega en cuanto llega (quien lo junta lo concatena) y una marca sin cerrar recuerda hasta dónde
// se buscó su cierre, así que el trozo siguiente no la recorre de nuevo.
class LectorXml {
  private resto = '';
  // Si `resto` es una marca sin cerrar (empieza con «<»): cuánto de ella ya se recorrió y la comilla abierta en ese punto.
  private visto = 0;
  private comilla = '';
  constructor(private readonly o: Oyente) {}

  alimentar(trozo: string, fin = false): void {
    const s = this.resto + trozo;
    const retomada = this.resto.startsWith('<');
    const hasta = (marca: string, desde: number): number => {
      const k = s.indexOf(marca, desde);
      return k < 0 ? -1 : k + marca.length;
    };
    let i = 0;
    for (;;) {
      const lt = s.indexOf('<', i);
      if (lt < 0) {
        // Sin «<» hasta el final: el texto se entrega ya, salvo una referencia «&…» que puede terminar en el trozo siguiente (mide 10 o menos).
        const amp = fin ? -1 : s.lastIndexOf('&');
        const corte = amp >= i && amp >= s.length - 16 && !s.includes(';', amp) ? amp : s.length;
        if (corte > i) this.o.texto(sinEntidades(s.slice(i, corte)));
        i = corte;
        break;
      }
      if (lt > i) this.o.texto(sinEntidades(s.slice(i, lt)));
      i = lt;
      // La marca que quedó a medias en el trozo anterior se retoma donde se dejó de buscar.
      const sigue = lt === 0 && retomada;
      const desde = sigue ? Math.max(1, this.visto) : lt + 1;
      let q = sigue ? this.comilla : '';
      this.visto = 0;
      this.comilla = '';
      if (!fin && s.length - lt < 9) break; // «<![CDATA[» mide 9: con menos no se sabe qué empieza
      let f = -1;
      if (s.startsWith('<?', lt)) f = hasta('?>', Math.max(lt + 2, desde - 1));
      else if (s.startsWith('<!--', lt)) f = hasta('-->', Math.max(lt + 4, desde - 2));
      else if (s.startsWith('<![CDATA[', lt)) {
        f = hasta(']]>', Math.max(lt + 9, desde - 2));
        if (f > 0) this.o.texto(s.slice(lt + 9, f - 3));
      } else if (s.startsWith('<!', lt)) throw ilegible('trae una declaración de tipo de documento («<!DOCTYPE»), que el lector no admite');
      else {
        // El «>» que cierra la etiqueta, fuera de comillas (un valor de atributo puede traer «>»), a no más de MAX_ETIQUETA del «<».
        const tope = lt + 1 + MAX_ETIQUETA;
        let k = desde;
        for (; k < s.length && k < tope && f < 0; k++) {
          const c = s[k]!;
          if (q !== '') q = c === q ? '' : q;
          else if (c === '"' || c === "'") q = c;
          else if (c === '>') f = k + 1;
        }
        if (f < 0 && k >= tope) throw ilegible(`trae una etiqueta de más de ${MAX_ETIQUETA / 1024} KiB, que el lector no admite`);
        if (f > 0) this.etiqueta(s.slice(lt + 1, f - 1));
      }
      if (f < 0) {
        // Incompleta: espera al trozo siguiente, que buscará desde aquí.
        this.visto = s.length - lt;
        this.comilla = q;
        break;
      }
      i = f;
    }
    this.resto = s.slice(i);
    if (fin && this.resto !== '') throw ilegible(`${DANADO}: una de sus partes está incompleta`);
  }

  // Nombre y atributos (`nombre="valor"` o con comillas simples) en una sola pasada, sin expresiones con retroceso: lo que no tiene esa forma
  // hace mal formada la parte.
  private etiqueta(t: string): void {
    if (t.startsWith('/')) return this.o.cierra(local(t.slice(1).trim()));
    const vacia = t.endsWith('/');
    const c = vacia ? t.slice(0, -1) : t;
    const mal = (): FallaLibro => ilegible(`${DANADO}: una etiqueta está mal formada`);
    let k = 0;
    while (k < c.length && !blanco(c[k])) k++;
    const nombre = local(c.slice(0, k));
    if (nombre === '') throw mal();
    const a: Atributos = {};
    for (;;) {
      while (blanco(c[k])) k++;
      if (k >= c.length) break;
      const desde = k;
      while (k < c.length && c[k] !== '=' && !blanco(c[k])) k++;
      const n = c.slice(desde, k);
      while (blanco(c[k])) k++;
      if (c[k] !== '=') throw mal();
      k++;
      while (blanco(c[k])) k++;
      const comilla = c[k];
      const cierre = comilla === '"' || comilla === "'" ? c.indexOf(comilla, k + 1) : -1;
      if (cierre < 0) throw mal();
      a[n] = sinEntidades(c.slice(k + 1, cierre));
      k = cierre + 1;
    }
    this.o.abre(nombre, a);
    if (vacia) this.o.cierra(nombre);
  }
}

// Lo que se hace con cada etiqueta y cada texto, con la pila de los nombres abiertos (la etiqueta actual al final).
function oyente(abre: (n: string, a: Atributos, pila: string[]) => void, cierra: (n: string, pila: string[]) => void = () => undefined, texto: (t: string, pila: string[]) => void = () => undefined): Oyente {
  const pila: string[] = [];
  return {
    abre(n, a) {
      pila.push(n);
      abre(n, a, pila);
    },
    cierra(n) {
      if (pila.pop() !== n) throw ilegible(`${DANADO}: una de sus partes está mal formada`);
      cierra(n, pila);
    },
    texto(t) {
      if (pila.length > 0) texto(t, pila);
      else if (t.trim() !== '') throw ilegible(`${DANADO}: una de sus partes está mal formada`);
    },
    terminar() {
      if (pila.length > 0) throw ilegible(`${DANADO}: una de sus partes está incompleta`);
    },
  };
}

// Una parte entera como XML, por trozos, en UTF-8 estricto (la Parte 2 admite también UTF-16, que ni Excel ni LibreOffice escriben). `listo`
// corta la lectura: `return` dentro del `for await` cierra el generador y con él la descompresión.
async function recorrer(zip: Zip, nombre: string, o: Oyente, listo: () => boolean = () => false): Promise<void> {
  const texto = new TextDecoder('utf-8', { fatal: true });
  const decodificar = (b?: Uint8Array): string => {
    try {
      return b === undefined ? texto.decode() : texto.decode(b, { stream: true });
    } catch {
      throw ilegible('está guardado con una codificación de texto que el lector no lee (solo UTF-8)');
    }
  };
  const x = new LectorXml(o);
  for await (const trozo of zip.trozos(nombre)) {
    x.alimentar(decodificar(trozo));
    if (listo()) return;
  }
  x.alimentar(decodificar(), true);
  o.terminar();
}

// ── El libro ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const TIPOS_LIBRO = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml', 'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml', 'application/vnd.ms-excel.template.macroEnabled.main+xml',
];
const TIPO_HOJA = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
// Los formatos implícitos de fecha y hora: ECMA-376 Parte 1, §18.8.30, que lista los id «whose formatCode value is implied rather than
// explicitly saved in the file» en cuatro tablas. La de todos los idiomas trae las fechas y horas 14 a 22 y 45 a 47 (las demás, hasta 49, son
// números); la de «zh-tw and zh-cn» y la de «ja-jp and ko-kr», las fechas y horas 27 a 36 y 50 a 58 (p. ej. «27 [$-404]e/m/d», «57
// [$-411]ge.m.d»); la de «th-th», números del 59 al 70 y fechas y horas del 71 al 81 (p. ej. «81 d/m/bb»). Un id que no está en ellas
// («the behavior is implementation-defined») no se toma por fecha. Un formato propio es de fecha si, sin lo que va entre comillas, escapado,
// con «_» o «*», entre corchetes (salvo [h], [m] y [s]) ni «General» ni la «E» de la notación científica, trae d, m, y, h o s.
const FECHA_IMPLICITA = (id: number): boolean => (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58) || (id >= 71 && id <= 81);
export function esFormatoDeFecha(codigo: string): boolean {
  const s = codigo.toLowerCase().replaceAll('general', '');
  // Cada salto va hacia adelante y, si un «"» o un «[» no tiene cierre, ninguno de los siguientes lo tendrá: no se vuelve a buscar. Así el
  // formato se recorre una vez (un «"» o un «[» sin cerrar cuentan como un carácter más).
  let sinComilla = false;
  let sinCorchete = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    const cierre = c === '"' && !sinComilla ? s.indexOf('"', i + 1) : c === '[' && !sinCorchete ? s.indexOf(']', i + 1) : -1;
    if (cierre < 0 && c === '"') sinComilla = true;
    if (cierre < 0 && c === '[') sinCorchete = true;
    if (c === '[' && cierre > i && /^[hms]+$/.test(s.slice(i + 1, cierre))) return true;
    if (cierre > i) i = cierre;
    else if (c === '\\' || c === '_' || c === '*' || (c === 'e' && (s[i + 1] === '+' || s[i + 1] === '-'))) i++;
    else if (c === 'd' || c === 'm' || c === 'y' || c === 'h' || c === 's') return true;
  }
  return false;
}

// Una referencia «B12» → columna 1 (A = 0) y fila 12.
function referencia(r: string): [number, number] {
  const m = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(r);
  if (m === null) throw ilegible(`${DANADO}: una celda trae una referencia que no se entiende`);
  let c = 0;
  for (const x of m[1]!) c = c * 26 + x.charCodeAt(0) - 64;
  return [c - 1, Number(m[2])];
}
const MAX_COLUMNAS = 16_384; // Excel: 1 048 576 filas por 16 384 columnas
const MAX_FILAS_HOJA = 1_048_576;
const desescapar = (t: string): string => t.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
// La forma léxica de xsd:double que escriben las planillas, sin ambigüedad (los dígitos después del punto solo con el punto): lineal.
const NUMERO_XSD = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/;

// La ruta de una relación del libro (relativa a «xl/», o absoluta desde la raíz del paquete), sin salir de «xl/».
function rutaDe(destino: string): string {
  const ruta = destino.startsWith('/') ? destino.slice(1) : `xl/${destino}`;
  if (ruta.split('/').some((s) => s === '..' || s === '.') || ruta.includes('\\') || !ruta.startsWith('xl/')) {
    throw ilegible(`una de sus relaciones apunta fuera del libro («${corto(destino)}»)`);
  }
  return ruta;
}

export async function leerXlsx(bytes: Uint8Array, topes: TopesXlsx): Promise<Libro> {
  const { entradas, inicio } = directorio(bytes, topes.entradas);
  const zip = new Zip(bytes, entradas, inicio, topes);
  if (!zip.hay('[Content_Types].xml')) throw ilegible(zip.hay('mimetype') ? 'es una planilla de OpenDocument (.ods), no un libro .xlsx' : 'no es un libro .xlsx');
  if (!zip.hay('xl/workbook.xml')) throw ilegible(zip.hay('xl/workbook.bin') ? 'es un libro binario (.xlsb), no un .xlsx' : 'no es un libro .xlsx');

  // [Content_Types].xml (Parte 2): el tipo de cada parte, por su nombre o por su extensión.
  const porNombre = new Map<string, string>();
  const porExtension = new Map<string, string>();
  await recorrer(zip, '[Content_Types].xml', oyente((n, a) => {
    if (n === 'Override' && a.PartName !== undefined) porNombre.set(a.PartName.toLowerCase(), a.ContentType ?? '');
    if (n === 'Default' && a.Extension !== undefined) porExtension.set(a.Extension.toLowerCase(), a.ContentType ?? '');
  }));
  const tipoDe = (ruta: string): string => porNombre.get(`/${ruta}`.toLowerCase()) ?? porExtension.get(ruta.slice(ruta.lastIndexOf('.') + 1).toLowerCase()) ?? '';
  if (!TIPOS_LIBRO.includes(tipoDe('xl/workbook.xml'))) throw ilegible('no es un libro .xlsx');

  // La primera hoja visible, en el orden de <sheets>.
  const hojas: { nombre: string; id: string | undefined }[] = [];
  await recorrer(zip, 'xl/workbook.xml', oyente((n, a, pila) => {
    if (n !== 'sheet' || pila[pila.length - 2] !== 'sheets' || a.state === 'hidden' || a.state === 'veryHidden') return;
    hojas.push({ nombre: a.name ?? '', id: Object.entries(a).find(([k]) => k.includes(':') && local(k) === 'id')?.[1] });
  }));
  const primera = hojas[0];
  if (primera === undefined) throw ilegible('no trae ninguna hoja visible');

  // Las relaciones del libro: la hoja y, si las hay, las cadenas compartidas y los estilos.
  const rels = new Map<string, { tipo: string; destino: string; externa: boolean }>();
  if (!zip.hay('xl/_rels/workbook.xml.rels')) throw ilegible(`${DANADO}: le falta una parte`);
  await recorrer(zip, 'xl/_rels/workbook.xml.rels', oyente((n, a) => {
    if (n === 'Relationship' && a.Id !== undefined) rels.set(a.Id, { tipo: a.Type ?? '', destino: a.Target ?? '', externa: a.TargetMode === 'External' });
  }));
  const rel = primera.id === undefined ? undefined : rels.get(primera.id);
  const dicha = corto(primera.nombre);
  if (rel === undefined || rel.externa) throw ilegible(`no se encuentra su primera hoja («${dicha}»)`);
  if (!rel.tipo.endsWith('/worksheet')) throw ilegible(`su primera hoja («${dicha}») no es una tabla de celdas (puede ser un gráfico)`);
  const rutaHoja = rutaDe(rel.destino);
  if (!zip.hay(rutaHoja)) throw ilegible(`falta su primera hoja («${dicha}»)`);
  if (tipoDe(rutaHoja) !== TIPO_HOJA) throw ilegible(`su primera hoja («${dicha}») no es una tabla de celdas`);
  const otra = (sufijo: string): string | null => {
    const r = [...rels.values()].find((x) => x.tipo.endsWith(sufijo) && !x.externa);
    return r === undefined ? null : rutaDe(r.destino);
  };

  // Los estilos: qué índice de cellXfs tiene formato de fecha.
  const fecha: boolean[] = [];
  const rutaEstilos = otra('/styles');
  if (rutaEstilos !== null && zip.hay(rutaEstilos)) {
    const propios = new Map<number, string>();
    const ids: number[] = [];
    await recorrer(zip, rutaEstilos, oyente((n, a, pila) => {
      const padre = pila[pila.length - 2];
      if (n === 'numFmt' && padre === 'numFmts') propios.set(Number(a.numFmtId), a.formatCode ?? '');
      if (n === 'xf' && padre === 'cellXfs') ids.push(Number(a.numFmtId ?? 0));
    }));
    for (const id of ids) fecha.push(propios.has(id) ? esFormatoDeFecha(propios.get(id)!) : FECHA_IMPLICITA(id));
  }

  // Las cadenas compartidas: el texto de cada <si> es el de su <t> o el de sus corridas <r>, no el de las lecturas fonéticas <rPh>.
  const cadenas: string[] = [];
  const rutaCadenas = otra('/sharedStrings');
  if (rutaCadenas !== null && zip.hay(rutaCadenas)) {
    let actual: string | null = null;
    await recorrer(zip, rutaCadenas, oyente((n, _, pila) => {
      if (n !== 'si' || pila.length !== 2) return;
      if (cadenas.length >= topes.cadenas) throw grande(`trae más de ${topes.cadenas} textos distintos y se abren libros de hasta ${topes.cadenas}`);
      actual = '';
    }, (n, pila) => {
      if (n !== 'si' || pila.length !== 1) return;
      cadenas.push(desescapar(actual ?? ''));
      actual = null;
    }, (t, pila) => {
      if (actual !== null && pila[pila.length - 1] === 't' && !pila.includes('rPh')) actual += t;
    }));
  }

  // La hoja, fila por fila, hasta juntar la cabecera y maxFilas + 1 filas con datos.
  const filas: FilaLibro[] = [];
  const limite = topes.maxFilas + 2;
  let fila: FilaLibro | null = null;
  let ultimaFila = 0;
  let col = -1;
  let celda: { t: string; s: number; v: string | null; f: boolean; en: string } | null = null;
  const lleno = (c: CeldaLibro | undefined): boolean => c !== undefined && !(c.tipo === 'texto' && c.v.trim() === '');
  const valor = (c: NonNullable<typeof celda>): CeldaLibro | undefined => {
    const v = c.v;
    if (c.t === 's') {
      const k = v !== null && /^\d+$/.test(v.trim()) ? Number(v) : -1;
      if (k < 0 || k >= cadenas.length) throw ilegible(`${DANADO}: una celda apunta a un texto que no está en el libro`);
      return { tipo: 'texto', v: cadenas[k]! };
    }
    if (c.t === 'inlineStr') return { tipo: 'texto', v: desescapar(c.en) };
    if (v === null || (c.t === 'n' && v.trim() === '')) return c.f ? { tipo: 'sin_valor' } : undefined; // una fórmula sin su resultado guardado
    if (c.t === 'str') return { tipo: 'texto', v: desescapar(v) };
    if (c.t === 'b' || c.t === 'e' || c.t === 'd') return { tipo: c.t === 'b' ? 'logico' : c.t === 'e' ? 'error' : 'fecha', v };
    if (c.t !== 'n') throw ilegible(`una celda tiene un tipo que el lector no conoce («${c.t.slice(0, 12)}»)`);
    // «1e400» tiene la forma de un número, pero no cabe en uno (Excel no guarda más de 9,99999999999999E+307): tampoco es un número.
    if (!NUMERO_XSD.test(v) || !Number.isFinite(Number(v))) throw ilegible(`${DANADO}: una celda numérica trae algo que no es un número`);
    return { tipo: 'numero', v: v.trim(), fecha: fecha[c.s] === true };
  };
  await recorrer(zip, rutaHoja, oyente((n, a, pila) => {
    const padre = pila[pila.length - 2];
    if (n === 'row' && padre === 'sheetData') {
      const r = a.r === undefined ? ultimaFila + 1 : Number(a.r);
      if (!Number.isInteger(r) || r <= ultimaFila || r > MAX_FILAS_HOJA) throw ilegible(`${DANADO}: sus filas no están en orden`);
      fila = { n: r, celdas: [] };
      ultimaFila = r;
      col = -1;
    } else if (n === 'c' && padre === 'row' && fila !== null) {
      let c = col + 1;
      if (a.r !== undefined) {
        const [x, r] = referencia(a.r);
        if (r !== fila.n) throw ilegible(`${DANADO}: una celda no está en su fila`);
        c = x;
      }
      if (c <= col || c >= MAX_COLUMNAS) throw ilegible(`${DANADO}: las celdas de una fila no están en orden`);
      col = c;
      celda = { t: a.t ?? 'n', s: Number(a.s ?? 0), v: null, f: false, en: '' };
    } else if (n === 'f' && celda !== null) celda.f = true;
    else if (n === 'v' && celda !== null) celda.v = '';
  }, (n) => {
    if (n === 'c' && celda !== null && fila !== null) {
      const x = valor(celda);
      if (x !== undefined) fila.celdas[col] = x;
      celda = null;
    } else if (n === 'row' && fila !== null) {
      if (fila.celdas.some(lleno)) filas.push(fila);
      fila = null;
    }
  }, (t, pila) => {
    if (celda === null) return;
    const n = pila[pila.length - 1];
    if (n === 'v') celda.v = (celda.v ?? '') + t;
    else if (n === 't' && pila.includes('is') && !pila.includes('rPh')) celda.en += t;
  }), () => filas.length >= limite);
  return { hoja: primera.nombre, filas: filas.slice(0, limite), cortado: filas.length >= limite };
}
