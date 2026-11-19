// Libros .xlsx armados a mano para las pruebas del lector (lib/xlsx-lector.ts) y del alta masiva: un zip escrito aquí con node:zlib, con lo
// que haga falta torcer (el tamaño declarado, el CRC, las banderas, el nombre de la cabecera local, ZIP64) y un paquete SpreadsheetML mínimo
// (ECMA-376 Parte 1 §12.2) al que se le cambia la parte que cada prueba necesita. Solo lo usan las pruebas: ninguna pantalla lo importa.
import { crc32, deflateRawSync } from 'node:zlib';

export interface Parte {
  nombre: string;
  datos: string | Uint8Array;
  metodo?: 0 | 8; // 8 (deflate) por omisión
  declarado?: number; // el tamaño sin comprimir que dice el directorio (por omisión, el verdadero)
  crc?: number;
  banderas?: number;
  nombreLocal?: string; // el de la cabecera local (por omisión, el mismo)
  comprimidos?: boolean; // `datos` ya van comprimidos con deflate (para entregar un deflate cortado): se escriben tal cual
}

const u16 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff];
const u32 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const u64 = (n: number): number[] => [...u32(n), ...u32(Math.floor(n / 2 ** 32))];

// Un zip con las partes en orden: cabecera local, datos, y al final el directorio central y su fin (con `zip64`, los registros de ZIP64 y
// los campos del directorio en 0xFFFFFFFF, con sus valores en el campo extra 0x0001).
export function zip(partes: readonly Parte[], o: { zip64?: boolean } = {}): Uint8Array {
  const trozos: Uint8Array[] = [];
  const central: number[][] = [];
  let pos = 0;
  const poner = (b: Uint8Array | number[]): void => {
    const x = b instanceof Uint8Array ? b : Uint8Array.from(b);
    trozos.push(x);
    pos += x.length;
  };
  for (const p of partes) {
    const crudo = typeof p.datos === 'string' ? new TextEncoder().encode(p.datos) : p.datos;
    const metodo = p.metodo ?? 8;
    const datos = metodo === 8 && p.comprimidos !== true ? new Uint8Array(deflateRawSync(crudo)) : crudo;
    const crc = p.crc ?? crc32(crudo);
    const declarado = p.declarado ?? crudo.length;
    const nombre = new TextEncoder().encode(p.nombre);
    const local = new TextEncoder().encode(p.nombreLocal ?? p.nombre);
    const desde = pos;
    poner([...u32(0x04034b50), ...u16(20), ...u16(p.banderas ?? 0), ...u16(metodo), ...u16(0), ...u16(0), ...u32(crc), ...u32(datos.length), ...u32(declarado), ...u16(local.length), ...u16(0), ...local]);
    poner(datos);
    const extra = o.zip64 ? [...u16(1), ...u16(24), ...u64(declarado), ...u64(datos.length), ...u64(desde)] : [];
    const [t, c, l] = o.zip64 ? [0xffffffff, 0xffffffff, 0xffffffff] : [declarado, datos.length, desde];
    central.push([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(p.banderas ?? 0), ...u16(metodo), ...u16(0), ...u16(0), ...u32(crc), ...u32(c), ...u32(t), ...u16(nombre.length),
      ...u16(extra.length), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(l), ...nombre, ...extra,
    ]);
  }
  const inicio = pos;
  for (const c of central) poner(c);
  const largo = pos - inicio;
  if (o.zip64) {
    const registro = pos;
    poner([...u32(0x06064b50), ...u64(44), ...u16(45), ...u16(45), ...u32(0), ...u32(0), ...u64(partes.length), ...u64(partes.length), ...u64(largo), ...u64(inicio)]);
    poner([...u32(0x07064b50), ...u32(0), ...u64(registro), ...u32(1)]);
    poner([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(0xffff), ...u16(0xffff), ...u32(0xffffffff), ...u32(0xffffffff), ...u16(0)]);
  } else poner([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(partes.length), ...u16(partes.length), ...u32(largo), ...u32(inicio), ...u16(0)]);
  const r = new Uint8Array(pos);
  let k = 0;
  for (const t of trozos) {
    r.set(t, k);
    k += t.length;
  }
  return r;
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
export const hojaXml = (filas: string): string => `${XML}<worksheet ${NS}><sheetData>${filas}</sheetData></worksheet>`;
export const cadenasXml = (cadenas: readonly string[]): string => `${XML}<sst ${NS} count="${cadenas.length}" uniqueCount="${cadenas.length}">${cadenas.map((c) => `<si><t xml:space="preserve">${c}</t></si>`).join('')}</sst>`;
// Estilos con los formatos dados: el estilo de celda i usa `formatos[i]` (un número es un formato implícito; un texto, uno propio).
export function estilosXml(formatos: readonly (number | string)[]): string {
  const propios = formatos.map((f, i) => (typeof f === 'string' ? `<numFmt numFmtId="${164 + i}" formatCode="${f.replace(/"/g, '&quot;')}"/>` : '')).join('');
  const xfs = formatos.map((f, i) => `<xf numFmtId="${typeof f === 'string' ? 164 + i : f}" fontId="0" fillId="0" borderId="0" xfId="0"/>`).join('');
  return `${XML}<styleSheet ${NS}><numFmts>${propios}</numFmts><cellStyleXfs count="1"><xf numFmtId="22"/></cellStyleXfs><cellXfs>${xfs}</cellXfs>` +
    `<dxfs><dxf><numFmt numFmtId="200" formatCode="yyyy"/></dxf></dxfs></styleSheet>`;
}
// Celdas: texto en línea, cadena compartida (índice), número (con su estilo) y la fila.
export const tx = (ref: string, t: string): string => `<c r="${ref}" t="inlineStr"><is><t>${t}</t></is></c>`;
export const cs = (ref: string, i: number): string => `<c r="${ref}" t="s"><v>${i}</v></c>`;
export const nu = (ref: string, v: string | number, s?: number): string => `<c r="${ref}"${s === undefined ? '' : ` s="${s}"`}><v>${v}</v></c>`;
export const fi = (n: number, ...celdas: string[]): string => `<row r="${n}">${celdas.join('')}</row>`;

export interface OpcionesLibro {
  hoja?: string; // la primera hoja (xl/worksheets/sheet1.xml)
  cadenas?: string; // xl/sharedStrings.xml
  estilos?: string; // xl/styles.xml
  libro?: string; // xl/workbook.xml entero
  rels?: string; // xl/_rels/workbook.xml.rels entero
  tipos?: string; // [Content_Types].xml entero
  otras?: readonly Parte[]; // partes de más (otra hoja, basura…)
  sin?: readonly string[]; // partes que no se escriben
  metodo?: 0 | 8;
  zip64?: boolean;
}
// Un libro mínimo y válido: una hoja «Hoja1» y, si se dan, las cadenas compartidas y los estilos. Cada opción reemplaza su parte.
export function libro(o: OpcionesLibro = {}): Uint8Array {
  const rels = [`<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>`];
  if (o.cadenas !== undefined) rels.push(`<Relationship Id="rId2" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>`);
  if (o.estilos !== undefined) rels.push(`<Relationship Id="rId3" Type="${REL}/styles" Target="styles.xml"/>`);
  const partes: Parte[] = [
    {
      nombre: '[Content_Types].xml',
      datos: o.tipos ?? `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    },
    { nombre: '_rels/.rels', datos: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { nombre: 'xl/workbook.xml', datos: o.libro ?? `${XML}<workbook ${NS}><sheets><sheet name="Hoja1" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { nombre: 'xl/_rels/workbook.xml.rels', datos: o.rels ?? `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>` },
    { nombre: 'xl/worksheets/sheet1.xml', datos: o.hoja ?? hojaXml('') },
  ];
  if (o.cadenas !== undefined) partes.push({ nombre: 'xl/sharedStrings.xml', datos: o.cadenas });
  if (o.estilos !== undefined) partes.push({ nombre: 'xl/styles.xml', datos: o.estilos });
  return zip([...partes.filter((p) => !(o.sin ?? []).includes(p.nombre)), ...(o.otras ?? [])].map((p) => ({ metodo: o.metodo, ...p })), { zip64: o.zip64 });
}
export { REL, NS, XML };
