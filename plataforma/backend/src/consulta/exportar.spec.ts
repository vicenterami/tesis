import { describe, expect, it } from 'vitest';
import { CABECERA_CSV, celdaCsv, celdaNumerica, filaCsv, filaJson, formato, nombreDeArchivo, rangoRazonable } from './exportar.js';

// La regla inversa, escrita aquí y no en el código que exporta: a un texto que empieza con apóstrofos seguidos de uno de los caracteres de
// fórmula se le quita UN apóstrofo. Y una celda CSV de una sola columna, leída según RFC 4180 (comillas dobles y "" interior).
const desproteger = (v: string): string => (/^'+[=+\-@\t\r\n＝＋－＠]/.test(v) ? v.slice(1) : v);
const leerCelda = (c: string): string => (c.startsWith('"') ? c.slice(1, -1).replace(/""/g, '"') : c);

const F = { tiempo_utc: '2026-10-12T15:00:00.123456Z', magnitud: 'temperatura', valor: 21.5, unidad: 'Cel', canal_id: 'c1' };

describe('exportación (RF-34): CSV estándar y JSON por fila', () => {
  it('una fila CSV: ISO UTC con microsegundos tal como viene de la base, punto decimal, coma, CRLF; y la cabecera fija', () => {
    expect(filaCsv(F)).toBe('2026-10-12T15:00:00.123456Z,temperatura,21.5,Cel,c1\r\n');
    expect(CABECERA_CSV).toBe('tiempo_utc,magnitud,valor,unidad,canal_id');
  });
  it('celdas con coma, comillas o salto de línea van entrecomilladas; las comillas se duplican', () => {
    expect(celdaCsv('a,b')).toBe('"a,b"');
    expect(celdaCsv('di "hola"')).toBe('"di ""hola"""');
    expect(celdaCsv('dos\nlíneas')).toBe('"dos\nlíneas"');
    expect(celdaCsv('simple')).toBe('simple');
  });
  it('inyección CSV: todo texto que empieza con =, +, -, @, tabulador, retorno o salto (o sus formas de ancho completo) se protege, aunque parezca número', () => {
    expect(celdaCsv('=1+1')).toBe("'=1+1");
    expect(celdaCsv('@cmd')).toBe("'@cmd");
    expect(celdaCsv("-1+cmd|' /C calc'!A0")).toBe("'-1+cmd|' /C calc'!A0");
    expect(celdaCsv('\tx')).toBe("'\tx");
    expect(celdaCsv('\nx')).toBe(`"'\nx"`);
    for (const c of ['＝', '＋', '－', '＠']) expect(celdaCsv(`${c}1`)).toBe(`'${c}1`);
    expect(celdaCsv('+AAEC')).toBe("'+AAEC"); // un payload_base64 puede empezar con «+»
  });
  it('apóstrofo reversible (bloque R, punto 2): tras cero o más apóstrofos, se antepone uno; la regla inversa quita uno y devuelve el original exacto', () => {
    expect(celdaCsv("'=1")).toBe("''=1");
    expect(celdaCsv("''+x")).toBe("'''+x");
    expect(celdaCsv("'")).toBe("'"); // un apóstrofo solo no se toca
    expect(celdaCsv("'abc")).toBe("'abc"); // ni uno seguido de otra cosa
    expect(celdaCsv('')).toBe('');
    const casos = ['=1', "'=1", "''=1", "'", "''", "'abc", 'abc', '+', "'+", '-3', '@', "'@", '\t', "'\t", '\r', '\n', "'\n", '＝', "'＝", '"=', 'a,b', "'a,\"b\"", '+/9=', '= =', "'''''-"];
    for (const v of casos) expect([v, desproteger(leerCelda(celdaCsv(v)))]).toEqual([v, v]);
  });
  it('la columna numérica sale tal cual (también negativa); lo que no es un número finito sale vacío', () => {
    expect(celdaNumerica(-3.5)).toBe('-3.5');
    expect(celdaNumerica(1e21)).toBe('1e+21');
    expect(celdaNumerica(Number.NaN)).toBe('');
  });
  it('rango razonable: desde < hasta, no antes del 2000, no más de un día en el futuro', () => {
    const ahora = new Date('2026-10-12T15:00:00Z');
    expect(rangoRazonable(new Date('2026-10-01T00:00:00Z'), ahora, ahora)).toBeNull();
    expect(rangoRazonable(ahora, new Date('2026-10-01T00:00:00Z'), ahora)).toContain('anterior');
    expect(rangoRazonable(new Date('-005000-01-01T00:00:00Z'), ahora, ahora)).toBe('desde no puede ser anterior al año 2000');
    expect(rangoRazonable(new Date('1999-12-31T23:59:59.999Z'), ahora, ahora)).toBe('desde no puede ser anterior al año 2000');
    expect(rangoRazonable(new Date('2000-01-01T00:00:00Z'), ahora, ahora)).toBeNull(); // el piso se admite
    expect(rangoRazonable(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-20T00:00:00Z'), ahora)).toContain('futuro');
  });
  it('JSON: una línea por fila con los mismos campos', () =>
    expect(JSON.parse(filaJson(F))).toEqual({ tiempo_utc: '2026-10-12T15:00:00.123456Z', magnitud: 'temperatura', valor: 21.5, unidad: 'Cel', canal_id: 'c1' }));
  it('nombre del archivo: identificador saneado y rango por día', () => {
    expect(nombreDeArchivo('dev 01/../x', new Date('2026-10-01T00:00:00Z'), new Date('2026-10-12T15:00:00Z'), 'csv')).toBe('dev_01_.._x_2026-10-01_2026-10-12.csv');
    expect(nombreDeArchivo('', new Date(F.tiempo_utc), new Date(F.tiempo_utc), 'json')).toBe('dispositivo_2026-10-12_2026-10-12.json');
  });
  it('formato: csv por defecto; json; otro o repetido → error', () => {
    expect(formato(undefined)).toBe('csv');
    expect(formato('json')).toBe('json');
    expect(() => formato('xlsx')).toThrow('formato');
    expect(() => formato(['csv'])).toThrow('formato');
  });
});
