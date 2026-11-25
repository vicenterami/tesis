import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { FallaLibro, TOPES_XLSX, esFormatoDeFecha, leerXlsx, type CeldaLibro, type Libro } from './xlsx-lector';
import { megas } from './lote';
import { NS, REL, XML, cadenasXml, cs, estilosXml, fi, hojaXml, libro, nu, tx, zip, type Parte } from './xlsx-prueba';

// El lector propio de .xlsx del alta masiva (docs/19 §4, bloque N, punto 6): libros reales (LibreOffice y el escritor de la exportación por
// sitio) y libros armados a mano para cada límite y cada ataque. Los reales viven en e2e/datos/ y cómo se rehacen lo dice docs/16 §91.
const DATOS = join(import.meta.dirname, '../../e2e/datos');
const real = (nombre: string): Uint8Array => new Uint8Array(readFileSync(join(DATOS, nombre)));
const TOPES = { ...TOPES_XLSX, maxFilas: 500 };
const leer = (b: Uint8Array): Promise<Libro> => leerXlsx(b, TOPES);
// La falla que se espera: su tipo y un trozo de su razón.
async function falla(b: Uint8Array, tipo: FallaLibro['tipo'], razon: string): Promise<void> {
  const e = await leer(b).then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(FallaLibro);
  expect([(e as FallaLibro).tipo, (e as FallaLibro).razon]).toEqual([tipo, expect.stringContaining(razon)]);
}
const celda = (l: Libro, n: number, col: number): CeldaLibro | undefined => l.filas.find((f) => f.n === n)?.celdas[col];
const relaciones = (r: string): string => `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${r}</Relationships>`;
const conHojas = (s: string): string => `${XML}<workbook ${NS}><sheets>${s}</sheets></workbook>`;

// Las partes de un libro ya armado (descomprimidas), para torcer una y volver a armarlo.
function partesDe(b: Uint8Array): Parte[] {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const fin = b.length - 22;
  let p = d.getUint32(fin + 16, true);
  const r: Parte[] = [];
  for (let k = 0; k < d.getUint16(fin + 10, true); k++) {
    const nl = d.getUint16(p + 28, true);
    const local = d.getUint32(p + 42, true);
    const desde = local + 30 + d.getUint16(local + 26, true) + d.getUint16(local + 28, true);
    const datos = b.subarray(desde, desde + d.getUint32(p + 20, true));
    r.push({ nombre: new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl)), datos: d.getUint16(p + 10, true) === 8 ? new Uint8Array(inflateRawSync(datos)) : datos });
    p += 46 + nl + d.getUint16(p + 30, true) + d.getUint16(p + 32, true);
  }
  return r;
}
const HOJA = 'xl/worksheets/sheet1.xml';
// El libro con la parte `nombre` cambiada.
const torcer = (b: Uint8Array, nombre: string, cambio: (p: Parte) => Partial<Parte>): Uint8Array => zip(partesDe(b).map((p) => (p.nombre === nombre ? { ...p, ...cambio(p) } : p)));

describe('libros reales', () => {
  it('LibreOffice 26.8 (desde libro-libreoffice.fods): la primera hoja, sus tipos de celda, los huecos y la fila vacía; la segunda hoja no se lee', async () => {
    const l = await leer(real('libro-libreoffice.xlsx'));
    expect([l.hoja, l.cortado, l.filas.map((f) => f.n)]).toEqual(['Dispositivos', false, [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12]]);
    expect(l.filas[0]!.celdas.map((c) => (c?.tipo === 'texto' ? c.v : '?'))).toEqual(['id_fisico', 'nombre', 'zona', 'via', 'formato', 'intervalo_esperado_s', 'canales']);
    expect(celda(l, 2, 5)).toEqual({ tipo: 'numero', v: '300', fecha: false });
    expect(celda(l, 3, 0)).toEqual({ tipo: 'numero', v: '7', fecha: false }); // el identificador escrito como número
    expect(celda(l, 4, 1)).toEqual({ tipo: 'numero', v: '46345', fecha: true }); // una fecha: un número de días con formato «dd/mm/yyyy»
    expect([celda(l, 5, 1), celda(l, 5, 5)]).toEqual([{ tipo: 'texto', v: 'Sensor cuatro' }, { tipo: 'numero', v: '300', fecha: false }]); // fórmulas: el valor guardado
    expect([celda(l, 6, 1), celda(l, 6, 5)]).toEqual([{ tipo: 'texto', v: '2.000' }, { tipo: 'numero', v: '12.375', fecha: false }]); // «0.00» no es fecha
    expect([celda(l, 9, 1), celda(l, 9, 2)]).toEqual([undefined, { tipo: 'texto', v: 'Norte' }]); // la vacía entre dos llenas: un hueco
    expect(celda(l, 11, 1)).toEqual({ tipo: 'error', v: '#DIV/0!' });
    expect([celda(l, 12, 1), celda(l, 12, 2)]).toEqual([{ tipo: 'texto', v: 'Dos\nlíneas' }, { tipo: 'texto', v: 'Galpón & «Sur» _x0041_' }]); // «_x005F_x0041_» es el literal
    expect(JSON.stringify(l)).not.toContain('columna_de_otra_hoja');
  });
  it('LibreOffice, el catálogo de 60 escenarios (lote-escenarios.csv importado sin evaluar fórmulas): las 61 filas con su número; la vacía cuenta', async () => {
    const l = await leer(real('lote-escenarios.xlsx'));
    expect([l.filas.length, l.filas[20]!.n, l.filas[21]!.n, l.filas.at(-1)!.n]).toEqual([61, 21, 23, 62]);
    expect(celda(l, 47, 5)).toEqual({ tipo: 'numero', v: '60.5', fecha: false }); // «60,5» lo leyó LibreOffice como número
    expect(celda(l, 48, 1)).toEqual({ tipo: 'texto', v: '=HYPERLINK("http://ejemplo.invalid";"clic")' });
    expect(celda(l, 60, 7)).toEqual({ tipo: 'texto', v: 'sobra' }); // la celda de más, en la columna H
  });
  it('la exportación por sitio (escritor propio del backend, HU-08): celdas sin referencia `r`, texto en línea, sin cadenas compartidas; su primera hoja es «Acerca de»', async () => {
    const l = await leer(real('libro-exportado.xlsx'));
    expect([l.hoja, l.filas[0]!.celdas, l.filas[1]!.celdas]).toEqual(['Acerca de', [{ tipo: 'texto', v: 'campo' }, { tipo: 'texto', v: 'valor' }], [{ tipo: 'texto', v: 'formato' }, { tipo: 'texto', v: 'exportacion-sitio/1' }]]);
    expect(l.filas.length).toBeGreaterThan(10);
  });
});

describe('lo que dice la norma de cada celda (ECMA-376 Parte 1)', () => {
  it('sin referencia `r` manda la posición, también con `<c/>` vacías; con `r`, las vacías no aparecen y quedan huecos', async () => {
    const l = await leer(libro({ hoja: hojaXml(`<row r="1"><c/><c t="inlineStr"><is><t>b</t></is></c></row>${fi(2, tx('A2', 'a'), tx('C2', 'c'))}<row><c t="inlineStr"><is><t>x</t></is></c></row>`) }));
    expect(l.filas.map((f) => [f.n, [...f.celdas].map((c) => (c === undefined ? null : c.tipo === 'texto' ? c.v : '?'))])).toEqual([[1, [null, 'b']], [2, ['a', null, 'c']], [3, ['x']]]);
  });
  it('texto en línea con corridas y lectura fonética; cadena compartida con lectura fonética, «_x000D_», «_x005F_x0041_», CDATA y referencias numéricas', async () => {
    const l = await leer(libro({
      hoja: hojaXml(fi(1, '<c r="A1" t="inlineStr"><is><r><rPr><b/></rPr><t>Ho</t></r><r><t>la</t></r><rPh sb="0" eb="1"><t>ホラ</t></rPh></is></c>', cs('B1', 0), cs('C1', 1), tx('D1', '<![CDATA[a<b]]>&#65;&#x42;'))),
      cadenas: `${XML}<sst ${NS}><si><t>漢字</t><rPh sb="0" eb="2"><t>カンジ</t></rPh></si><si><t>uno_x000D_dos _x005F_x0041_</t></si></sst>`,
    }));
    expect(l.filas[0]!.celdas).toEqual([{ tipo: 'texto', v: 'Hola' }, { tipo: 'texto', v: '漢字' }, { tipo: 'texto', v: 'uno\rdos _x0041_' }, { tipo: 'texto', v: 'a<bAB' }]);
  });
  it('fórmulas: se toma el resultado guardado (texto, número, error, lógico) y nunca se evalúa; sin resultado guardado, se dice', async () => {
    const l = await leer(libro({ hoja: hojaXml(fi(1, '<c r="A1" t="str"><f>CONCAT("a";"b")</f><v>ab</v></c>', '<c r="B1"><f>1+1</f><v>2</v></c>', '<c r="C1" t="e"><f>1/0</f><v>#DIV/0!</v></c>',
      '<c r="D1" t="b"><f>TRUE()</f><v>1</v></c>', '<c r="E1"><f>1+1</f></c>', '<c r="F1" t="str"><f>A1</f></c>', '<c r="G1" t="d"><v>2026-11-19T00:00:00</v></c>')) }));
    expect(l.filas[0]!.celdas).toEqual([{ tipo: 'texto', v: 'ab' }, { tipo: 'numero', v: '2', fecha: false }, { tipo: 'error', v: '#DIV/0!' }, { tipo: 'logico', v: '1' },
      { tipo: 'sin_valor' }, { tipo: 'sin_valor' }, { tipo: 'fecha', v: '2026-11-19T00:00:00' }]);
  });
  it('fechas por su estilo: los formatos implícitos de fecha y hora (14 a 22, 45 a 47…) y los propios con d, m, y, h o s; «General», «0.00» y el texto entre comillas no', async () => {
    const formatos: (number | string)[] = [0, 14, 22, 2, 46, 'yyyy-mm-dd', 'General', '0.00', '[h]:mm:ss', '"m"0', '[Red]0.00', '0.00E+00', 49];
    const l = await leer(libro({ estilos: estilosXml(formatos), hoja: hojaXml(fi(1, ...formatos.map((_, i) => nu(`${String.fromCharCode(65 + i)}1`, 1, i)))) }));
    expect(l.filas[0]!.celdas.map((c) => (c?.tipo === 'numero' ? c.fecha : null))).toEqual([false, true, true, false, true, true, false, false, true, false, false, false, false]);
    // Sin estilos, ninguna fecha por estilo (el numFmt de dxfs tampoco cuenta: estilosXml lo trae).
    expect((await leer(libro({ hoja: hojaXml(fi(1, nu('A1', 1, 1))) }))).filas[0]!.celdas[0]).toEqual({ tipo: 'numero', v: '1', fecha: false });
    expect([esFormatoDeFecha('dd/mm/yyyy'), esFormatoDeFecha('[$-404]e/m/d'), esFormatoDeFecha('#,##0 "días"'), esFormatoDeFecha('\\h0')]).toEqual([true, true, false, false]);
  });
  it('los formatos implícitos de cada tabla de §18.8.30: 27 a 36 y 50 a 58 (chino, japonés y coreano) y 71 a 81 (tailandés) son fecha; los que no están en las tablas o son números, no', async () => {
    const ids = [27, 36, 50, 58, 71, 81, 23, 26, 37, 49, 59, 70, 82, 163];
    const l = await leer(libro({ estilos: estilosXml(ids), hoja: hojaXml(fi(1, ...ids.map((_, i) => nu(`${String.fromCharCode(65 + i)}1`, 1, i)))) }));
    expect(l.filas[0]!.celdas.map((c) => (c?.tipo === 'numero' ? c.fecha : null))).toEqual([true, true, true, true, true, true, false, false, false, false, false, false, false, false]);
  });
  it('un formato de número enorme y hostil (muchos «[» o «"» sin cerrar) se recorre una vez: en menos de 100 ms', () => {
    const t0 = performance.now();
    expect([esFormatoDeFecha('['.repeat(200_000)), esFormatoDeFecha('"'.repeat(200_001)), esFormatoDeFecha(`${'[h'.repeat(100_000)}0`)]).toEqual([false, false, true]);
    expect(performance.now() - t0).toBeLessThan(100);
  });
  it('la PRIMERA hoja visible según <sheets>, no la primera del zip ni la de rId1; una oculta delante se salta', async () => {
    const otra = { nombre: 'xl/worksheets/sheet2.xml', datos: hojaXml(fi(1, tx('A1', 'la segunda'))) };
    const rels = relaciones(`<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId9" Type="${REL}/worksheet" Target="/xl/worksheets/sheet2.xml"/>`);
    const hoja = hojaXml(fi(1, tx('A1', 'la primera del zip')));
    const a = await leer(libro({ hoja, otras: [otra], rels, libro: conHojas('<sheet name="Uno" sheetId="1" r:id="rId9"/><sheet name="Dos" sheetId="2" r:id="rId1"/>') }));
    expect([a.hoja, a.filas[0]!.celdas[0]]).toEqual(['Uno', { tipo: 'texto', v: 'la segunda' }]);
    const b = await leer(libro({ hoja, otras: [otra], rels, libro: conHojas('<sheet name="Oculta" sheetId="1" state="hidden" r:id="rId1"/><sheet name="Visible" sheetId="2" r:id="rId9"/>') }));
    expect([b.hoja, b.filas[0]!.celdas[0]]).toEqual(['Visible', { tipo: 'texto', v: 'la segunda' }]);
    await falla(libro({ libro: conHojas('<sheet name="Oculta" sheetId="1" state="veryHidden" r:id="rId1"/>') }), 'ilegible', 'no trae ninguna hoja visible');
  });
  it('prefijos de espacio de nombres (x:), partes guardadas sin comprimir y ZIP64 se leen igual', async () => {
    const conPrefijo = `${XML}<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>con prefijo</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>`;
    for (const o of [{}, { metodo: 0 as const }, { zip64: true }]) {
      expect((await leer(libro({ hoja: conPrefijo, ...o }))).filas[0]!.celdas[0]).toEqual({ tipo: 'texto', v: 'con prefijo' });
    }
  });
});

describe('los topes (bloque N, punto 6): contados mientras se descomprime, nunca el tamaño declarado', () => {
  const muchas = (k: number): string => Array.from({ length: k }, (_, i) => fi(i + 1, tx(`A${i + 1}`, `x${i}`))).join('');
  it('la lectura se detiene en max_filas + 1 filas de datos (más la cabecera); con max_filas justas, no', async () => {
    const a = await leer(libro({ hoja: hojaXml(muchas(502)) }));
    expect([a.cortado, a.filas.length]).toEqual([true, 502]);
    const b = await leer(libro({ hoja: hojaXml(muchas(501)) }));
    expect([b.cortado, b.filas.length]).toEqual([false, 501]);
  });
  it('una hoja de un millón de filas (49 MB al abrirla; el libro, 144 kB, bajo el tope de archivo del lote) se corta en la fila 502 sin descomprimirla entera', async () => {
    const hoja = hojaXml('<row><c t="inlineStr"><is><t>x</t></is></c></row>'.repeat(1_000_000));
    const b = libro({ hoja });
    expect([hoja.length > 5 * TOPES.bytesPorParte, b.length < 1_147_904]).toEqual([true, true]); // si se leyera entera, caería por el tope por parte
    const l = await leer(b);
    expect([l.cortado, l.filas.length, l.filas.at(-1)!.n]).toEqual([true, 502, 502]);
  });
  it('zip bomba: una parte que al abrirla pasa el tope por parte, diga el zip lo que diga de su tamaño', async () => {
    const bomba = libro({ cadenas: cadenasXml(['a'.repeat(TOPES.bytesPorParte)]), hoja: hojaXml(fi(1, cs('A1', 0))) });
    // En la unidad de la pantalla (`megas`: 10^6 bytes): 8 MiB son «8,4 MB».
    await falla(bomba, 'grande', `una de sus partes ocupa más de ${megas(TOPES.bytesPorParte)} MB al abrirla`);
    expect(megas(TOPES.bytesPorParte)).toBe('8,4');
    // El directorio declara 100 bytes: si el tope se contara con lo declarado, esta pasaría.
    await falla(torcer(bomba, 'xl/sharedStrings.xml', () => ({ declarado: 100 })), 'grande', 'una de sus partes ocupa más de 8,4 MB al abrirla');
  });
  it('el tope total: tres partes bajo el tope por parte que juntas lo pasan', async () => {
    const casi = 'b'.repeat(TOPES.bytesPorParte - 1000);
    await falla(libro({ cadenas: cadenasXml([casi]), estilos: `${XML}<styleSheet ${NS}><!-- ${casi} --></styleSheet>`, hoja: hojaXml(fi(1, cs('A1', 0)) + `<!-- ${casi} -->`) }), 'grande', `sus partes ocupan más de ${megas(TOPES.bytesTotales)} MB al abrirlas`);
  }, 20_000); // en la suite completa, con la CPU ocupada o a batería, pasaba el límite de 5 s de vitest (23/11/2026)
  it('500 filas llenas (cada celda en su tope y cada carácter escrito «&amp;») caben bajo el tope por parte', async () => {
    const topes = [63, 80, 80, 80, 80, 80, 1197, 80, 80];
    const letra = (i: number): string => String.fromCharCode(65 + i);
    const cab = fi(1, ...topes.map((_, i) => tx(`${letra(i)}1`, `c${i}`)));
    const filas = Array.from({ length: 500 }, (_, k) => fi(k + 2, ...topes.map((t, i) => tx(`${letra(i)}${k + 2}`, '&amp;'.repeat(t))))).join('');
    const hoja = hojaXml(cab + filas);
    expect(hoja.length).toBeLessThan(5_000_000);
    const l = await leer(libro({ hoja }));
    expect([l.cortado, l.filas.length, l.filas[1]!.celdas[6]]).toEqual([false, 501, { tipo: 'texto', v: '&'.repeat(1197) }]);
  });
  it('más partes que el tope en el directorio del zip', async () => {
    const basura = Array.from({ length: 995 }, (_, i) => ({ nombre: `basura/${i}.bin`, datos: 'x', metodo: 0 as const }));
    expect((await leer(libro({ otras: basura }))).filas).toEqual([]); // 5 + 995 = 1000: cabe
    await falla(libro({ otras: [...basura, { nombre: 'una-mas', datos: 'x' }] }), 'grande', 'trae 1001 partes y se abren libros de hasta 1000');
  });
  it('más cadenas compartidas que el tope', async () => {
    const sst = (k: number): string => `${XML}<sst ${NS}>${'<si><t/></si>'.repeat(k)}</sst>`;
    expect((await leer(libro({ cadenas: sst(TOPES.cadenas) }))).filas).toEqual([]);
    await falla(libro({ cadenas: sst(TOPES.cadenas + 1) }), 'grande', `trae más de ${TOPES.cadenas} textos distintos`);
  });
});

describe('ataques y archivos dañados', () => {
  const doctype = '<!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>';
  const conDoctype = (xml: string): string => xml.replace('?>\n', `?>\n${doctype}`);
  it('un <!DOCTYPE> (también la «bomba de mil millones de risas») se rechaza en cualquiera de las partes que se leen', async () => {
    const tipos = new TextDecoder().decode(partesDe(libro())[0]!.datos as Uint8Array);
    const casos = [
      libro({ tipos: conDoctype(tipos) }),
      libro({ libro: conDoctype(conHojas('<sheet name="Hoja1" sheetId="1" r:id="rId1"/>')) }),
      libro({ rels: conDoctype(relaciones(`<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>`)) }),
      libro({ hoja: conDoctype(hojaXml(fi(1, tx('A1', '&b;')))) }),
      libro({ cadenas: conDoctype(cadenasXml(['&b;'])) }),
      libro({ estilos: conDoctype(estilosXml([0])) }),
    ];
    for (const b of casos) await falla(b, 'ilegible', 'trae una declaración de tipo de documento («<!DOCTYPE»)');
  });
  it('una etiqueta enorme (300 000 caracteres: un nombre de atributo largo, sin «=», o un valor sin cerrar) se rechaza en menos de 1 s, sin análisis cuadrático', async () => {
    const largo = 'a'.repeat(300_000);
    for (const etiqueta of [`<c r="A1" ${largo}/>`, `<c r="A1" ${largo}=b/>`, `<c r="A1" t="${largo}/>`]) {
      const b = libro({ hoja: hojaXml(fi(1, etiqueta)) });
      expect(b.length).toBeLessThan(5000); // comprimido es chico: pasa el tope de archivo del lote
      const t0 = performance.now();
      await falla(b, 'ilegible', 'una etiqueta de más de 16 KiB');
      expect(performance.now() - t0).toBeLessThan(1000);
    }
  });
  it('bajo el tope, una hoja con 40 etiquetas de 16 000 caracteres (un nombre de atributo sin «=») se rechaza en menos de 1 s: los atributos se leen en una pasada', async () => {
    const b = libro({ hoja: hojaXml(Array.from({ length: 40 }, (_, k) => fi(k + 1, `<c r="A${k + 1}" ${'a'.repeat(16_000)}/>`)).join('')) });
    const t0 = performance.now();
    await falla(b, 'ilegible', 'una etiqueta está mal formada');
    expect(performance.now() - t0).toBeLessThan(1000);
  });
  it('un atributo sin comillas, sin valor o sin «=» hace mal formada la parte; con comillas simples o espacios alrededor del «=», se lee', async () => {
    for (const c of ['<c r=A1 t="inlineStr"><is><t>x</t></is></c>', '<c r="A1" t/>', '<c r="A1" t=/>']) {
      await falla(libro({ hoja: hojaXml(fi(1, c)) }), 'ilegible', 'mal formada');
    }
    await falla(libro({ hoja: hojaXml(fi(1, '<c r="A1 />')) }), 'ilegible', 'está incompleta'); // la comilla sin cerrar se come el resto
    const l = await leer(libro({ hoja: hojaXml(fi(1, "<c r = 'A1'  t\n=\t\"inlineStr\" ><is><t>x</t></is></c>")) }));
    expect(l.filas[0]!.celdas[0]).toEqual({ tipo: 'texto', v: 'x' });
  });
  it('un número de 100 000 dígitos con una letra al final (en menos de 1 s: la forma del número se mira sin retroceso) y uno que desborda («1e400»): ilegibles', async () => {
    const b = libro({ hoja: hojaXml(fi(1, nu('A1', `${'1'.repeat(100_000)}x`))) });
    const t0 = performance.now();
    await falla(b, 'ilegible', 'una celda numérica trae algo que no es un número');
    expect(performance.now() - t0).toBeLessThan(1000);
    await falla(libro({ hoja: hojaXml(fi(1, nu('A1', '1e400'))) }), 'ilegible', 'una celda numérica trae algo que no es un número');
  });
  it('un texto, un comentario y una sección CDATA de 7 MB cada uno, que llegan en muchos trozos, se leen enteros (y en menos de 10 s: un lector cuadrático tardaba 70 s)', async () => {
    const largo = 'x'.repeat(7_000_000);
    const b = libro({ hoja: hojaXml(`<!-- ${largo} -->${fi(1, tx('A1', `<![CDATA[${largo}]]>`), tx('B1', `${largo}&amp;`))}`) });
    const t0 = performance.now();
    const l = await leerXlsx(b, { ...TOPES, bytesPorParte: 32 * 2 ** 20, bytesTotales: 64 * 2 ** 20 });
    expect([(l.filas[0]!.celdas[0] as { v: string }).v.length, (l.filas[0]!.celdas[1] as { v: string }).v.length]).toEqual([7_000_000, 7_000_001]);
    // El tope no es una medida de rendimiento: atrapa un lector cuadrático (el 19/11/2026, una etiqueta de 1 kB tardaba 70 s). Solo mide ≈ 1 s;
    // en la suite completa con la CPU ocupada o a batería, 3,5 a 3,9 s (23/11/2026). 10 s sigue atrapando aquel caso con margen.
    expect(performance.now() - t0).toBeLessThan(10_000);
  }, 20_000); // su propia cota es 10 s; el límite de 5 s de vitest lo cortaba con la suite en paralelo y a batería (24/11/2026, como la del 23/11)
  it('una etiqueta sin cerrar no se vuelve a recorrer entera en cada trozo: 8 MiB en un atributo sin cerrar se rechazan en menos de 1 s', async () => {
    const b = libro({ hoja: hojaXml(fi(1, `<c r="A1" t="${'a'.repeat(TOPES.bytesPorParte - 1000)}/>`)) });
    const t0 = performance.now();
    await falla(b, 'ilegible', 'una etiqueta de más de 16 KiB');
    expect(performance.now() - t0).toBeLessThan(1000);
  });
  it('una entidad que XML no define, una referencia a un carácter que XML no admite o un «&» suelto hacen ilegible el libro', async () => {
    for (const t of ['&externa;', '&#1;', 'a & b']) await falla(libro({ hoja: hojaXml(fi(1, tx('A1', t))) }), 'ilegible', 'una referencia «&…;» que no existe');
  });
  it('una relación que sale de «xl/» con «..» o hacia otra parte del paquete, o que es externa', async () => {
    for (const destino of ['../../../etc/passwd', 'worksheets/../../x.xml', '/docProps/core.xml']) {
      await falla(libro({ rels: relaciones(`<Relationship Id="rId1" Type="${REL}/worksheet" Target="${destino}"/>`) }), 'ilegible', 'una de sus relaciones apunta fuera del libro');
    }
    const externa = relaciones(`<Relationship Id="rId1" Type="${REL}/worksheet" Target="http://ejemplo.invalid/h.xml" TargetMode="External"/>`);
    await falla(libro({ rels: externa }), 'ilegible', 'no se encuentra su primera hoja');
  });
  it('la hoja que no está, una hoja que es un gráfico y un libro sin hojas', async () => {
    await falla(libro({ sin: [HOJA] }), 'ilegible', 'falta su primera hoja («Hoja1»)');
    const nombre = 'H'.repeat(5000);
    const e = await leer(libro({ sin: [HOJA], libro: conHojas(`<sheet name="${nombre}" sheetId="1" r:id="rId1"/>`) })).then(() => null, (x: FallaLibro) => x);
    expect(e?.razon).toBe(`falta su primera hoja («${'H'.repeat(60)}…»)`); // el nombre que viene del archivo, recortado
    await falla(libro({ rels: relaciones(`<Relationship Id="rId1" Type="${REL}/chartsheet" Target="worksheets/sheet1.xml"/>`) }), 'ilegible', 'no es una tabla de celdas (puede ser un gráfico)');
    await falla(libro({ libro: conHojas('') }), 'ilegible', 'no trae ninguna hoja visible');
  });
  it('protegido con contraseña, CRC o tamaño que no calzan, dos partes con el mismo nombre y una cabecera local que nombra otra parte', async () => {
    const b = libro({ hoja: hojaXml(fi(1, tx('A1', 'x'))) });
    await falla(torcer(b, HOJA, () => ({ banderas: 1 })), 'ilegible', 'está protegido con contraseña');
    await falla(torcer(b, HOJA, () => ({ banderas: 0x40 })), 'ilegible', 'está protegido con contraseña');
    await falla(torcer(b, HOJA, () => ({ crc: 1234 })), 'ilegible', 'una de sus partes no es lo que declara el zip');
    await falla(torcer(b, HOJA, (p) => ({ declarado: (p.datos as Uint8Array).length + 1 })), 'ilegible', 'una de sus partes no es lo que declara el zip');
    await falla(torcer(b, HOJA, () => ({ nombreLocal: 'xl/worksheets/sheet9.xml' })), 'ilegible', 'está dañado');
    const partes = partesDe(b);
    await falla(zip([...partes, partes.find((p) => p.nombre === HOJA)!]), 'ilegible', 'trae dos partes con el mismo nombre');
    await falla(zip([...partes, { ...partes.find((p) => p.nombre === HOJA)!, nombre: 'XL/Worksheets/Sheet1.xml' }]), 'ilegible', 'trae dos partes con el mismo nombre');
  });
  it('otra compresión que deflate, y un deflate cortado a la mitad', async () => {
    const b = libro({ hoja: hojaXml(fi(1, tx('A1', 'x'))) });
    const otra = b.slice();
    const d = new DataView(otra.buffer);
    let p = d.getUint32(otra.length - 22 + 16, true);
    for (let k = 0; k < 5; k++) {
      const nl = d.getUint16(p + 28, true);
      if (new TextDecoder().decode(otra.subarray(p + 46, p + 46 + nl)) === HOJA) d.setUint16(p + 10, 12, true); // 12: bzip2 (APPNOTE §4.4.5)
      p += 46 + nl + d.getUint16(p + 30, true) + d.getUint16(p + 32, true);
    }
    await falla(otra, 'ilegible', 'usa una compresión que el lector no conoce (método 12)');
    const crudo = new TextEncoder().encode(hojaXml(fi(1, tx('A1', 'x'.repeat(5000)))));
    const deflate = new Uint8Array(deflateRawSync(crudo));
    const mitad = torcer(b, HOJA, () => ({ datos: deflate.subarray(0, deflate.length >> 1), comprimidos: true, declarado: crudo.length, crc: crc32(crudo) }));
    await falla(mitad, 'ilegible', 'no se puede descomprimir');
  });
  it('lo que no es un .xlsx: un zip sin directorio, un .ods, un .xlsb, un .docx, otro tipo de contenido y un zip vacío', async () => {
    await falla(Uint8Array.from([0x50, 0x4b, 3, 4, 20, 0, 0, 0]), 'ilegible', 'está incompleto o dañado');
    await falla(zip([{ nombre: 'mimetype', datos: 'application/vnd.oasis.opendocument.spreadsheet', metodo: 0 }, { nombre: 'content.xml', datos: '<x/>' }]), 'ilegible', 'es una planilla de OpenDocument (.ods)');
    await falla(zip([{ nombre: '[Content_Types].xml', datos: '<Types/>' }, { nombre: 'xl/workbook.bin', datos: 'x' }]), 'ilegible', 'es un libro binario (.xlsb)');
    await falla(zip([{ nombre: '[Content_Types].xml', datos: '<Types/>' }, { nombre: 'word/document.xml', datos: '<w/>' }]), 'ilegible', 'no es un libro .xlsx');
    const otroTipo = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
    await falla(libro({ tipos: otroTipo }), 'ilegible', 'no es un libro .xlsx');
    await falla(zip([]), 'ilegible', 'no es un libro .xlsx');
  });
  it('XML mal formado o incompleto, una parte en UTF-16, filas o celdas fuera de orden, una celda fuera de su fila, un texto compartido que no existe y un número que no lo es', async () => {
    await falla(libro({ hoja: `${XML}<worksheet ${NS}><sheetData><row r="1"></sheetData></worksheet>` }), 'ilegible', 'está mal formada');
    await falla(libro({ hoja: `${XML}<worksheet ${NS}><sheetData>` }), 'ilegible', 'está incompleta');
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...hojaXml('')].flatMap((c) => [c.charCodeAt(0), 0])]);
    await falla(libro({ hoja: utf16 as unknown as string }), 'ilegible', 'solo UTF-8');
    await falla(libro({ hoja: hojaXml(fi(3, tx('A3', 'a')) + fi(2, tx('A2', 'b'))) }), 'ilegible', 'sus filas no están en orden');
    await falla(libro({ hoja: hojaXml(fi(3, tx('A4', 'a'))) }), 'ilegible', 'una celda no está en su fila');
    await falla(libro({ hoja: hojaXml(fi(1, tx('B1', 'a'), tx('A1', 'b'))) }), 'ilegible', 'las celdas de una fila no están en orden');
    await falla(libro({ hoja: hojaXml(fi(1, cs('A1', 3))), cadenas: cadenasXml(['a']) }), 'ilegible', 'una celda apunta a un texto que no está en el libro');
    await falla(libro({ hoja: hojaXml(fi(1, nu('A1', '0x10'))) }), 'ilegible', 'una celda numérica trae algo que no es un número');
  });
  it('sin DecompressionStream («deflate-raw») en el navegador: sin_lector; un libro guardado sin comprimir se lee igual', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    try {
      await falla(libro({ hoja: hojaXml(fi(1, tx('A1', 'x'))) }), 'sin_lector', 'este navegador no trae el descompresor');
      expect((await leer(libro({ hoja: hojaXml(fi(1, tx('A1', 'x'))), metodo: 0 }))).filas).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
