import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { FORMATO_FECHA, LibroXlsx, MAX_FILAS_DATOS, celdaXml, serieDePlanilla, textoXml, type Celda } from './xlsx.js';
import { EscritorZip } from './zip.js';

// Lectores escritos en la prueba: las partes del zip (por el directorio central, con inflateRaw) y el texto de una celda, deshaciendo
// primero el XML (entidades) y después el escape de ST_Xstring (ECMA-376 Parte 1 §22.9.2.19 y §22.4.2.4), de izquierda a derecha.
function partes(z: Buffer): Map<string, string> {
  const fin = z.length - 22;
  const n = z.readUInt16LE(fin + 10);
  let p = z.readUInt32LE(fin + 16);
  const m = new Map<string, string>();
  for (let i = 0; i < n; i++) {
    const comprimido = z.readUInt32LE(p + 20);
    const largo = z.readUInt16LE(p + 28);
    const local = z.readUInt32LE(p + 42);
    const nombre = z.subarray(p + 46, p + 46 + largo).toString('ascii');
    const inicio = local + 30 + z.readUInt16LE(local + 26) + z.readUInt16LE(local + 28);
    m.set(nombre, inflateRawSync(z.subarray(inicio, inicio + comprimido)).toString('utf8'));
    p += 46 + largo;
  }
  return m;
}
const desXml = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-fA-F]+));/g, (_t, e: string, dec?: string, hex?: string) =>
    dec !== undefined ? String.fromCharCode(Number(dec)) : hex !== undefined ? String.fromCharCode(parseInt(hex, 16)) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e] ?? '');
const desXstring = (s: string): string => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_t, h: string) => String.fromCharCode(parseInt(h, 16)));
const leerTexto = (xml: string): string => desXstring(desXml(/^<c t="inlineStr"[^>]*><is><t(?: xml:space="preserve")?>([\s\S]*)<\/t><\/is><\/c>$/.exec(xml)?.[1] ?? '¡no es texto en línea!'));
function filas(hoja: string): string[][] {
  return [...hoja.matchAll(/<row r="(\d+)">([\s\S]*?)<\/row>/g)].map((r) =>
    [...(r[2] ?? '').matchAll(/<c\/>|<c( [^>]*)?>([\s\S]*?)<\/c>/g)].map((c) => {
      if (c[0] === '<c/>') return '';
      const t = /<t[^>]*>([\s\S]*)<\/t>/.exec(c[2] ?? '');
      return t ? desXstring(desXml(t[1] ?? '')) : /<v>([^<]*)<\/v>/.exec(c[2] ?? '')?.[1] ?? '';
    }));
}

describe('XLSX con código propio: escape sin pérdida (ECMA-376 Parte 1 §22.9.2.19 y §22.4.2.4)', () => {
  const casos = [
    'simple', 'a & b < c > d', 'comillas " y apóstrofo \'', 'con\ttab', 'dos\nlíneas', 'retorno\r\nfinal\r', ' espacios al borde ',
    '\u0001\u0002\u0008\u000B\u000C\u001F', 'nulo\u0000adentro', '_x0041_', '_x005F_x0041_', '_X0041_', '_xABCD\u0001', '_x\u0001', '__x0001_', '_x00',
    'tildes ñandú y emoji 🛠️', 'sustituto suelto \uD800 y \uDC00', '￾￿', '=1+1', "'=1",
  ];
  it('cada texto, escrito como celda y leído por el lector de la prueba, vuelve exacto', () => {
    for (const s of casos) expect([s, leerTexto(celdaXml({ texto: s }))]).toEqual([s, s]);
  });
  it('lo escrito es XML 1.0 válido: ningún carácter de control salvo tabulador y salto; ningún retorno literal', () => {
    for (const s of casos) expect(textoXml(s)).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\r￾￿]/); // eslint-disable-line no-control-regex
  });
  it('un _xHHHH_ literal se protege con _x005F_ (el ejemplo de la norma) y un control se escribe _xHHHH_', () => {
    expect(textoXml('_x0008_')).toBe('_x005F_x0008_');
    expect(textoXml('\u0008')).toBe('_x0008_');
    expect(textoXml('_xABCD\u0001')).toBe('_x005F_xABCD_x0001_');
    expect(textoXml('_x00')).toBe('_x00'); // sin cuatro dígitos no hay secuencia que proteger
  });
  it('xml:space="preserve" solo cuando hay espacios o saltos; un texto de más de 32 767 caracteres es un error, no un recorte', () => {
    expect(celdaXml({ texto: 'abc' })).toBe('<c t="inlineStr"><is><t>abc</t></is></c>');
    expect(celdaXml({ texto: ' a' })).toContain('xml:space="preserve"');
    expect(() => celdaXml({ texto: 'x'.repeat(32_768) })).toThrow('32767');
    expect(() => celdaXml({ texto: 'x'.repeat(32_767) })).not.toThrow();
  });
  it('números como número (negativos, 1e-7, el mayor double); lo que no es finito, vacío; la fecha como serie de 1900 con su estilo', () => {
    expect(celdaXml({ numero: -12.5 })).toBe('<c><v>-12.5</v></c>');
    expect(celdaXml({ numero: 1e-7 })).toBe('<c><v>1e-7</v></c>');
    expect(celdaXml({ numero: Number.MAX_VALUE })).toBe('<c><v>1.7976931348623157e+308</v></c>');
    expect(celdaXml({ numero: Number.NaN })).toBe('<c/>');
    expect(serieDePlanilla(Date.UTC(1899, 11, 31, 12))).toBe(1.5); // el ejemplo de §18.17.4.1
    expect(serieDePlanilla(Date.UTC(1970, 0, 1))).toBe(25_569);
    const ms = Date.UTC(2026, 10, 19, 15, 30, 44, 123);
    expect(Math.round((Number(/<v>([^<]+)<\/v>/.exec(celdaXml({ fecha: ms }))?.[1]) - 25_569) * 86_400_000)).toBe(ms); // milisegundos exactos
    expect(celdaXml({ fecha: ms })).toMatch(/^<c s="1"><v>/);
  });
});

describe('XLSX: el paquete mínimo, las hojas y el corte', () => {
  async function libro(escribir: (l: LibroXlsx) => Promise<void>, filasPorHoja = MAX_FILAS_DATOS, bytesPorEntrada = 2 ** 30): Promise<Map<string, string>> {
    const trozos: Buffer[] = [];
    const zip = new EscritorZip((b) => { trozos.push(Buffer.from(b)); return Promise.resolve(); }, { bytesPorEntrada, bytesTotales: 2 ** 31, entradas: 100 });
    const l = new LibroXlsx(zip, { filasPorHoja });
    await l.empezar();
    await escribir(l);
    await l.terminar();
    return partes(Buffer.concat(trozos));
  }
  it('tipos de contenido, relaciones, libro, estilos y hojas; «Acerca de» escrita al final y primera pestaña; la primera fila fija', async () => {
    const p = await libro(async (l) => {
      await l.hoja('Mediciones', [{ nombre: 'tiempo_utc', ancho: 28 }, { nombre: 'valor', ancho: 10 }]);
      await l.fila([{ texto: '2026-11-19T00:00:00.000001Z' }, { numero: 1 }]);
      await l.hoja('Eventos', [{ nombre: 'tipo', ancho: 10 }]);
      await l.acercaDe([['formato', 'exportacion-sitio/1'], ['filas', '1']]);
    });
    expect([...p.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/styles.xml', 'xl/worksheets/hoja1.xml', 'xl/worksheets/hoja2.xml',
      'xl/worksheets/acerca.xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels']);
    const wb = p.get('xl/workbook.xml') ?? '';
    expect([...wb.matchAll(/<sheet name="([^"]+)" sheetId="(\d+)" r:id="(rId\d+)"\/>/g)].map((m) => m.slice(1))).toEqual([
      ['Acerca de', '1', 'rId1'], ['Mediciones', '2', 'rId2'], ['Eventos', '3', 'rId3']]);
    const rels = p.get('xl/_rels/workbook.xml.rels') ?? '';
    expect(rels).toContain('Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/acerca.xml"');
    expect(rels).toContain('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"');
    expect(p.get('_rels/.rels')).toContain('Target="xl/workbook.xml"');
    expect(p.get('[Content_Types].xml')).toContain('PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"');
    expect(p.get('xl/styles.xml')).toContain(`formatCode="${FORMATO_FECHA}"`);
    expect(p.get('xl/worksheets/hoja1.xml')).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(filas(p.get('xl/worksheets/hoja1.xml') ?? '')).toEqual([['tiempo_utc', 'valor'], ['2026-11-19T00:00:00.000001Z', '1']]);
    expect(filas(p.get('xl/worksheets/acerca.xml') ?? '')).toEqual([['campo', 'valor'], ['formato', 'exportacion-sitio/1'], ['filas', '1']]);
  });
  it('una hoja que llega al tope de filas (reducido en la prueba) sigue en «Mediciones (2)», con su cabecera y sus filas desde la 2', async () => {
    const p = await libro(async (l) => {
      await l.hoja('Mediciones', [{ nombre: 'n', ancho: 5 }]);
      for (let i = 1; i <= 7; i++) await l.fila([{ numero: i }]);
    }, 3);
    const wb = p.get('xl/workbook.xml') ?? '';
    expect([...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(['Mediciones', 'Mediciones (2)', 'Mediciones (3)']);
    expect(filas(p.get('xl/worksheets/hoja1.xml') ?? '')).toEqual([['n'], ['1'], ['2'], ['3']]);
    expect(filas(p.get('xl/worksheets/hoja3.xml') ?? '')).toEqual([['n'], ['7']]);
    expect(p.get('xl/worksheets/hoja2.xml')).toContain('<row r="4">');
  });
  it('también se corta antes de que la parte del zip pase su tope de bytes (sin ZIP64)', async () => {
    const p = await libro(async (l) => {
      await l.hoja('Tramas', [{ nombre: 'carga', ancho: 5 }]);
      for (let i = 0; i < 10; i++) await l.fila([{ texto: 'x'.repeat(400) + String(i) }]);
    }, MAX_FILAS_DATOS, 2000);
    const hojas = [...p.keys()].filter((k) => /hoja\d+\.xml$/.test(k));
    expect(hojas.length).toBeGreaterThan(2);
    for (const h of hojas) expect(Buffer.byteLength(p.get(h) ?? '')).toBeLessThanOrEqual(2000);
    const todas = hojas.flatMap((h) => filas(p.get(h) ?? '').slice(1).map((f) => f[0]));
    expect(todas).toEqual(Array.from({ length: 10 }, (_, i) => 'x'.repeat(400) + String(i)));
  });
  it('una celda vacía (null) ocupa su lugar', () => {
    const c: Celda[] = [{ texto: 'a' }, null, { numero: 2 }];
    expect(filas(`<row r="2">${c.map((x) => celdaXml(x)).join('')}</row>`)).toEqual([['a', '', '2']]);
  });
});
