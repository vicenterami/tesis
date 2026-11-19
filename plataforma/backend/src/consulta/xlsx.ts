// Libro XLSX en flujo, con código propio (docs/19 §4, bloque R, punto 4; 19/11/2026): un paquete SpreadsheetML mínimo sobre el zip
// de zip.ts, con las hojas escritas fila a fila y olvidadas (texto en línea, `inlineStr`, sin tabla de cadenas compartidas). Lo que sigue
// sale de ECMA-376, 5.ª edición (descargada el 19/11/2026 con su huella):
//   - Parte 1 §12.2: el paquete mínimo es «[Content_Types].xml», la relación del paquete al libro, el libro, su relación a cada hoja y las
//     hojas; el libro relaciona además un único Styles Part (§12.3.20), que aquí lleva el formato de la fecha y la cabecera en negrita;
//   - Parte 4 §10.2: los espacios de nombres y relaciones «Transitional» (http://schemas.openxmlformats.org/…), los que leen Excel,
//     LibreOffice y Google Sheets; los «Strict» de la Parte 1 (http://purl.oclc.org/ooxml/…) no los abren todos;
//   - Parte 1 §18.3.1.4 y §18.18.11: «when the cell's type t is inlineStr then only the element is is allowed», con `<is><t>`;
//   - Parte 1 §18.4.12 y §22.9.2.19 (ST_Xstring): un carácter que XML 1.0 no admite se escribe «_xHHHH_»; y §22.4.2.4: «To store the
//     literal form of an escape sequence, the initial underscore shall itself be escaped (i.e. stored as _x005F_)»;
//   - Parte 1 §18.8.30 y §18.17.4.1: un formato propio (id ≥ 164) «yyyy-mm-dd hh:mm:ss.000» sobre el número de serie del sistema 1900
//     (día 0 = 30/12/1899): la fecha nativa con milisegundos para graficar sin convertir;
//   - Parte 1 §18.3.1.66: la primera fila fija, con un panel congelado (`ySplit="1"`, `state="frozen"`).
// Límites de Excel (Microsoft, «Excel specifications and limits», descargada el 19/11/2026): «1,048,576 rows» por hoja y «32,767
// characters» por celda. Por eso una hoja se corta en 1 048 575 filas de datos (más la cabecera) y sigue en «Mediciones (2)»; también se
// corta antes de que su parte del zip pase del tope sin ZIP64 (zip.ts).
import { EscritorZip } from './zip.js';

export const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const MAX_FILAS_DATOS = 1_048_575; // 1 048 576 filas por hoja, una es la cabecera
export const MAX_CARACTERES_CELDA = 32_767;
const ID_FORMATO_FECHA = 164; // §18.8.30: los ids menores son formatos implícitos
export const FORMATO_FECHA = 'yyyy-mm-dd hh:mm:ss.000';
const ESTILO_FECHA = 1;
const ESTILO_CABECERA = 2;
const MS_POR_DIA = 86_400_000;
const SERIE_EPOCA_UNIX = 25_569; // número de serie del 01/01/1970 en el sistema 1900 (§18.17.4.1: el 0 es el 30/12/1899)

// Un instante (milisegundos Unix, UTC) como número de serie de planilla del sistema 1900. Válido para fechas posteriores al 01/03/1900:
// la exportación parte en el año 2000 (rangoRazonable).
export function serieDePlanilla(ms: number): number {
  return ms / MS_POR_DIA + SERIE_EPOCA_UNIX;
}

// Texto para el contenido de un elemento XML, sin pérdida:
//   1) un «_» seguido de «x» (o «X») y cuatro dígitos hexadecimales se escribe «_x005F_» (§22.4.2.4), para que un «_x0041_» literal no se
//      lea como «A». Se protege aunque lo que siga no sea «_»: si después viniera un carácter escapado, el «_» de su escape cerraría la
//      secuencia (p. ej. «_xABCD» seguido de U+0001 daría «_xABCD_x0001_»);
//   2) los caracteres que XML 1.0 no admite (controles salvo tabulador, salto y retorno; U+FFFE, U+FFFF; sustitutos sueltos), «_xHHHH_»;
//   3) &, < y > como entidades; el retorno de carro como «&#13;», porque un lector XML convierte un retorno literal en salto de línea.
// eslint-disable-next-line no-control-regex -- los controles son justamente lo que se busca escapar
const PARA_ESCAPAR = /_(?=[xX][0-9A-Fa-f]{4})|[&<>\r\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export function textoXml(s: string): string {
  return s.replace(PARA_ESCAPAR, (c) => {
    switch (c) {
      case '_': return '_x005F_';
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '\r': return '&#13;';
      default: return `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`;
    }
  });
}
const atributoXml = (s: string): string => textoXml(s).replace(/"/g, '&quot;');

export type Celda = { texto: string } | { numero: number } | { fecha: number } | null;

// Una celda de la hoja. El texto va en línea; si trae espacio o salto, con xml:space="preserve" para que el lector no lo recorte.
// Un número que no es finito sale vacío, como en el CSV (celdaNumerica). Sin referencia `r` en la celda: es opcional y la posición manda.
export function celdaXml(c: Celda, estilo = 0): string {
  const s = estilo === 0 ? '' : ` s="${estilo}"`;
  if (c === null) return '<c/>';
  if ('texto' in c) {
    if (c.texto.length > MAX_CARACTERES_CELDA) throw new Error(`una celda de texto pasa de ${MAX_CARACTERES_CELDA} caracteres, el tope de Excel`);
    const preservar = /[ \t\n\r]/.test(c.texto) ? ' xml:space="preserve"' : '';
    return `<c t="inlineStr"${s}><is><t${preservar}>${textoXml(c.texto)}</t></is></c>`;
  }
  if ('numero' in c) return Number.isFinite(c.numero) ? `<c${s}><v>${String(c.numero)}</v></c>` : '<c/>';
  return Number.isFinite(c.fecha) ? `<c s="${ESTILO_FECHA}"><v>${String(serieDePlanilla(c.fecha))}</v></c>` : '<c/>';
}

export interface Columna { nombre: string; ancho: number }

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const TIPOS = XML +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '</Types>';
const RELS_PAQUETE = XML +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
  '</Relationships>';
// Estilos: 0 normal, 1 la fecha con milisegundos, 2 la cabecera en negrita. Excel exige las dos primeras tramas (none y gray125).
const ESTILOS = XML +
  `<styleSheet xmlns="${NS_MAIN}">` +
  `<numFmts count="1"><numFmt numFmtId="${ID_FORMATO_FECHA}" formatCode="${FORMATO_FECHA}"/></numFmts>` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  `<xf numFmtId="${ID_FORMATO_FECHA}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';
const PIE_HOJA = '</sheetData></worksheet>';

function cabeceraHoja(columnas: readonly Columna[]): string {
  const cols = columnas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho}" customWidth="1"/>`).join('');
  const fila = columnas.map((c) => celdaXml({ texto: c.nombre }, ESTILO_CABECERA)).join('');
  return XML + `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '<selection pane="bottomLeft"/></sheetView></sheetViews>' +
    `<cols>${cols}</cols><sheetData><row r="1">${fila}</row>`;
}

export interface Hoja { nombre: string; archivo: string; filas: number }
export interface TopesLibro { filasPorHoja: number }

// El libro: empezar() → hoja(nombre, columnas) → fila(…)* → [hoja(…) → fila(…)*]* → acercaDe(filas) → terminar(). La pestaña «Acerca de» se
// escribe al FINAL (lleva los conteos) pero va PRIMERA en el libro: el orden de las pestañas es el de <sheets>, no el del zip.
export class LibroXlsx {
  private readonly hojas: Hoja[] = [];
  private acerca: Hoja | null = null;
  private abierta: { base: string; parte: number; columnas: readonly Columna[]; hoja: Hoja } | null = null;

  constructor(private readonly zip: EscritorZip, private readonly topes: TopesLibro = { filasPorHoja: MAX_FILAS_DATOS }) {}

  async empezar(): Promise<void> {
    for (const [nombre, contenido] of [['[Content_Types].xml', TIPOS], ['_rels/.rels', RELS_PAQUETE], ['xl/styles.xml', ESTILOS]] as const) {
      await this.zip.abrir(nombre);
      await this.zip.escribir(contenido);
      await this.zip.cerrar();
    }
  }

  get hojasEscritas(): readonly Hoja[] {
    return this.hojas;
  }

  private async abrirParte(base: string, parte: number, columnas: readonly Columna[]): Promise<{ base: string; parte: number; columnas: readonly Columna[]; hoja: Hoja }> {
    const nombre = parte === 1 ? base : `${base} (${parte})`;
    const hoja: Hoja = { nombre, archivo: `xl/worksheets/hoja${this.hojas.length + 1}.xml`, filas: 0 };
    await this.zip.abrir(hoja.archivo);
    await this.zip.escribir(cabeceraHoja(columnas));
    this.hojas.push(hoja);
    this.abierta = { base, parte, columnas, hoja };
    return this.abierta;
  }

  private async cerrarAbierta(): Promise<void> {
    if (this.abierta === null) return;
    await this.zip.escribir(PIE_HOJA);
    await this.zip.cerrar();
    this.abierta = null;
  }

  async hoja(nombre: string, columnas: readonly Columna[]): Promise<void> {
    await this.cerrarAbierta();
    await this.abrirParte(nombre, 1, columnas);
  }

  // Una fila de datos. Si la hoja llegó al tope de filas, o la fila con el cierre ya no cabe en la parte del zip, sigue en la hoja siguiente
  // («Mediciones (2)»), con la misma cabecera.
  async fila(celdas: readonly Celda[]): Promise<void> {
    let a = this.abierta;
    if (a === null) throw new Error('no hay una hoja abierta');
    const contenido = celdas.map((c) => celdaXml(c)).join('');
    let xml = `<row r="${a.hoja.filas + 2}">${contenido}</row>`;
    if (a.hoja.filas >= this.topes.filasPorHoja || !this.zip.cabe(Buffer.byteLength(xml) + PIE_HOJA.length)) {
      await this.cerrarAbierta();
      a = await this.abrirParte(a.base, a.parte + 1, a.columnas);
      xml = `<row r="2">${contenido}</row>`;
    }
    await this.zip.escribir(xml);
    a.hoja.filas++;
  }

  // «Acerca de»: dos columnas, campo y valor, todo texto.
  async acercaDe(filas: readonly (readonly [string, string])[]): Promise<void> {
    await this.cerrarAbierta();
    const hoja: Hoja = { nombre: 'Acerca de', archivo: 'xl/worksheets/acerca.xml', filas: filas.length };
    await this.zip.abrir(hoja.archivo);
    await this.zip.escribir(cabeceraHoja([{ nombre: 'campo', ancho: 30 }, { nombre: 'valor', ancho: 100 }]));
    let n = 2;
    for (const [campo, valor] of filas) await this.zip.escribir(`<row r="${n++}">${celdaXml({ texto: campo })}${celdaXml({ texto: valor })}</row>`);
    await this.zip.escribir(PIE_HOJA);
    await this.zip.cerrar();
    this.acerca = hoja;
  }

  async terminar(): Promise<number> {
    await this.cerrarAbierta();
    const todas = this.acerca === null ? this.hojas : [this.acerca, ...this.hojas];
    const sheets = todas.map((h, i) => `<sheet name="${atributoXml(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
    await this.zip.abrir('xl/workbook.xml');
    await this.zip.escribir(XML + `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets}</sheets></workbook>`);
    await this.zip.cerrar();
    const rels = todas.map((h, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="${h.archivo.slice(3)}"/>`).join('') +
      `<Relationship Id="rId${todas.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>`;
    await this.zip.abrir('xl/_rels/workbook.xml.rels');
    await this.zip.escribir(XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
    await this.zip.cerrar();
    return this.zip.terminar();
  }
}
