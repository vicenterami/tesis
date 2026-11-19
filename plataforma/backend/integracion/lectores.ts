// Lectores de los archivos de la exportación por sitio (docs/19 §4, bloque R, punto 7), escritos para la prueba y no con el código que los
// escribe: un zip (por su directorio central, con inflateRaw y el CRC de cada entrada), el CSV de RFC 4180 con la regla inversa del
// apóstrofo, y las hojas de un XLSX (entidades XML y el escape _xHHHH_ de ECMA-376). Si el que escribe y el que lee compartieran código, un
// error en ese código se vería como «ida y vuelta sin diferencias».
import { crc32, inflateRawSync } from 'node:zlib';

export interface EntradaZip { nombre: string; datos: Buffer; comprimido: number; flags: number; metodo: number }

// APPNOTE.TXT 6.3.10: fin de directorio (§4.3.16) → directorio central (§4.3.12) → cabecera local (§4.3.7) → datos → descriptor (§4.3.9).
// Comprueba además que las entradas estén una detrás de otra, sin huecos, y que el directorio empiece justo después de la última.
export function leerZip(z: Buffer): EntradaZip[] {
  const fin = z.length - 22;
  const error = (m: string): never => { throw new Error(`zip: ${m}`); };
  if (fin < 0 || z.readUInt32LE(fin) !== 0x06054b50) error('sin fin de directorio central al final (o con comentario)');
  const n = z.readUInt16LE(fin + 10);
  if (z.readUInt16LE(fin + 8) !== n) error('entradas del disco ≠ entradas totales');
  const inicioCd = z.readUInt32LE(fin + 16);
  if (inicioCd + z.readUInt32LE(fin + 12) !== fin) error('el directorio central no termina donde empieza el fin de directorio');
  let p = inicioCd;
  let esperado = 0;
  const salida: EntradaZip[] = [];
  for (let i = 0; i < n; i++) {
    if (z.readUInt32LE(p) !== 0x02014b50) error(`entrada ${i}: firma del directorio central`);
    const flags = z.readUInt16LE(p + 8);
    const metodo = z.readUInt16LE(p + 10);
    const crc = z.readUInt32LE(p + 16);
    const comprimido = z.readUInt32LE(p + 20);
    const sinComprimir = z.readUInt32LE(p + 24);
    const ln = z.readUInt16LE(p + 28);
    const local = z.readUInt32LE(p + 42);
    const nombre = z.subarray(p + 46, p + 46 + ln).toString('utf8');
    p += 46 + ln + z.readUInt16LE(p + 30) + z.readUInt16LE(p + 32);
    if (local !== esperado) error(`${nombre}: la cabecera local está en ${local} y se esperaba en ${esperado}`);
    if (z.readUInt32LE(local) !== 0x04034b50) error(`${nombre}: firma de la cabecera local`);
    if (z.readUInt16LE(local + 6) !== flags || z.readUInt16LE(local + 8) !== metodo) error(`${nombre}: la cabecera local y el directorio difieren`);
    const conDescriptor = (flags & 0x0008) !== 0;
    const inicio = local + 30 + z.readUInt16LE(local + 26) + z.readUInt16LE(local + 28);
    const datos = metodo === 8 ? inflateRawSync(z.subarray(inicio, inicio + comprimido)) : metodo === 0 ? z.subarray(inicio, inicio + comprimido) : error(`${nombre}: método ${metodo}`);
    if (datos.length !== sinComprimir) error(`${nombre}: ${datos.length} bytes y el directorio dice ${sinComprimir}`);
    if (crc32(datos) !== crc) error(`${nombre}: CRC distinto`);
    let siguiente = inicio + comprimido;
    if (conDescriptor) {
      let d = siguiente;
      if (z.readUInt32LE(d) === 0x08074b50) d += 4; // la firma es opcional (§4.3.9.3)
      if (z.readUInt32LE(d) !== crc || z.readUInt32LE(d + 4) !== comprimido || z.readUInt32LE(d + 8) !== sinComprimir) error(`${nombre}: el descriptor de datos no coincide`);
      siguiente = d + 12;
    }
    esperado = siguiente;
    salida.push({ nombre, datos, comprimido, flags, metodo });
  }
  if (esperado !== inicioCd) error(`la última entrada termina en ${esperado} y el directorio empieza en ${inicioCd}`);
  return salida;
}

// RFC 4180: campos separados por coma, filas por CRLF; un campo entre comillas puede traer comas, comillas dobladas y saltos.
export function leerCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (c === '"' && campo === '') {
      i++;
      for (;;) {
        if (i >= texto.length) throw new Error('csv: comillas sin cerrar');
        if (texto[i] === '"') {
          if (texto[i + 1] === '"') { campo += '"'; i += 2; continue; }
          i++;
          break;
        }
        campo += texto[i++];
      }
      if (i < texto.length && texto[i] !== ',' && !texto.startsWith('\r\n', i)) throw new Error(`csv: algo después de las comillas en ${i}`);
      continue;
    }
    if (c === ',') { fila.push(campo); campo = ''; i++; continue; }
    if (texto.startsWith('\r\n', i)) { fila.push(campo); filas.push(fila); fila = []; campo = ''; i += 2; continue; }
    if (c === '\r' || c === '\n') throw new Error(`csv: salto suelto fuera de comillas en ${i}`);
    campo += c;
    i++;
  }
  if (campo !== '' || fila.length > 0) throw new Error('csv: la última fila no termina en CRLF');
  return filas;
}
// La regla inversa del apóstrofo (LEEME.txt): a un texto que empieza con apóstrofos seguidos de un carácter de fórmula se le quita uno.
export const desproteger = (v: string): string => (/^'+[=+\-@\t\r\n＝＋－＠]/.test(v) ? v.slice(1) : v);

// Una hoja de SpreadsheetML: filas de celdas con su tipo. El texto se lee deshaciendo primero el XML (entidades) y después el escape de
// ST_Xstring (§22.9.2.19; «_x005F_» es el «_» literal, §22.4.2.4), de izquierda a derecha y sin solaparse.
export type CeldaLeida = { t: 'texto'; v: string } | { t: 'numero'; v: number; estilo: number } | null;
const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const desXml = (s: string): string =>
  s.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-fA-F]+));/g, (_t, e?: string, dec?: string, hex?: string) =>
    e !== undefined ? (ENTIDADES[e] ?? '') : String.fromCodePoint(dec !== undefined ? Number(dec) : parseInt(hex ?? '0', 16)));
export const desXstring = (s: string): string => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_t, h: string) => String.fromCharCode(parseInt(h, 16)));
export function leerHoja(xml: string): CeldaLeida[][] {
  if (!xml.includes('<sheetData>') || !xml.trimEnd().endsWith('</sheetData></worksheet>')) throw new Error('hoja: sin sheetData o sin cierre');
  const filas: CeldaLeida[][] = [];
  let numero = 0;
  for (const r of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    if (Number(r[1]) !== ++numero) throw new Error(`hoja: fila ${r[1]} donde se esperaba la ${numero}`);
    const celdas: CeldaLeida[] = [];
    for (const c of (r[2] ?? '').matchAll(/<c\/>|<c((?: [a-z]+="[^"]*")*)>([\s\S]*?)<\/c>/g)) {
      if (c[0] === '<c/>') { celdas.push(null); continue; }
      const atributos = c[1] ?? '';
      const tipo = /t="([^"]+)"/.exec(atributos)?.[1] ?? 'n';
      const estilo = Number(/s="(\d+)"/.exec(atributos)?.[1] ?? 0);
      if (tipo === 'inlineStr') {
        const t = /^<is><t(?: xml:space="preserve")?>([\s\S]*)<\/t><\/is>$/.exec(c[2] ?? '');
        if (t === null) throw new Error(`hoja: texto en línea mal formado: ${(c[2] ?? '').slice(0, 80)}`);
        celdas.push({ t: 'texto', v: desXstring(desXml(t[1] ?? '')) });
      } else if (tipo === 'n') {
        const v = /^<v>([^<]+)<\/v>$/.exec(c[2] ?? '');
        if (v === null) throw new Error(`hoja: número mal formado: ${c[2]}`);
        celdas.push({ t: 'numero', v: Number(v[1]), estilo });
      } else throw new Error(`hoja: tipo de celda inesperado ${tipo}`);
    }
    filas.push(celdas);
  }
  return filas;
}

// Las hojas del libro, en el orden de las pestañas: workbook.xml (nombres y r:id) → xl/_rels/workbook.xml.rels (archivo de cada una).
export function leerLibro(entradas: readonly EntradaZip[]): { nombre: string; filas: CeldaLeida[][] }[] {
  const parte = (n: string): string => {
    const e = entradas.find((x) => x.nombre === n);
    if (e === undefined) throw new Error(`xlsx: falta ${n}`);
    return e.datos.toString('utf8');
  };
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'xl/styles.xml']) parte(n);
  const rels = new Map([...parte('xl/_rels/workbook.xml.rels').matchAll(/<Relationship Id="([^"]+)" Type="[^"]+\/worksheet" Target="([^"]+)"\/>/g)].map((m) => [m[1], `xl/${m[2]}`]));
  return [...parte('xl/workbook.xml').matchAll(/<sheet name="([^"]+)" sheetId="\d+" r:id="([^"]+)"\/>/g)].map((m) => ({
    nombre: desXstring(desXml(m[1] ?? '')),
    filas: leerHoja(parte(rels.get(m[2] ?? '') ?? '¿?')),
  }));
}
