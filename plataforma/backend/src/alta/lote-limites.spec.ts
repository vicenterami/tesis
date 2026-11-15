import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { COLUMNAS_LOTE, COLUMNAS_TEXTO_LIBRE, MAX_BYTES_LOTE, MAX_FILAS_LOTE, TOPES_COLUMNA, TOPE_CANALES, filasDelCuerpo, plantillaLote } from './lote.js';
import { MENSAJE_TOPE_CUERPO, MENSAJE_TOPE_LOTE, TOPE_CUERPO_LOTE, esLote } from '../arranque.js';

// Los límites del alta por lote, en el límite (docs/19 §4, N5 y N11): el peor caso de 500 filas con cada columna en su tope se MIDE en
// bytes UTF-8 (no se estima) y fija el tope del cuerpo, que es uno solo en el backend (MAX_BYTES_LOTE, que usa el lector de JSON) y en el
// proxy (client_max_body_size). 501 filas es 413; una celda sobre su tope es 400 con su fila.
// El peor caso de lo que se ACEPTA: tres bytes por carácter en el texto libre (nombre, zona) y uno en las columnas de códigos.
const llena = (n: number): Record<string, unknown> =>
  Object.fromEntries([['n', n], ...COLUMNAS_LOTE.map((c) => [c, (COLUMNAS_TEXTO_LIBRE.includes(c) ? '€' : 'x').repeat(TOPES_COLUMNA[c])])]);
// `n` con 16 cifras (el mayor entero seguro), creciente.
const peorCaso = (filas = MAX_FILAS_LOTE): { filas: Record<string, unknown>[]; huella: string } =>
  ({ filas: Array.from({ length: filas }, (_, i) => llena(Number.MAX_SAFE_INTEGER - filas + i + 1)), huella: 'a'.repeat(64) });
// Lo que vale cada carácter en el JSON (bytes por unidad de UTF-16): «€» 3, «😀» 2, «"» 2, un carácter de control 6, un sustituto suelto 6.
const bytesPorUnidad = (c: string): number => (Buffer.byteLength(JSON.stringify(c)) - 2) / c.length;
const admite = (columna: string, v: string): boolean => {
  try {
    filasDelCuerpo({ filas: [{ n: 1, [columna]: v }] });
    return true;
  } catch {
    return false;
  }
};
const CANDIDATOS = [
  ...Array.from({ length: 0x80 }, (_, i) => String.fromCharCode(i)), '\u0085', '\u00a0', 'ñ', '€', '\u2028', '\ufeff', '😀', '\ud800', '\udfff',
];
const motivosDe = (fila: Record<string, unknown>): string[] => {
  try {
    filasDelCuerpo({ filas: [llena(1), fila] });
    return [];
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return ((e as BadRequestException).getResponse() as { message: string[] }).message;
  }
};

describe('el tope del cuerpo sale del peor caso medido de lo que se acepta', () => {
  it('cada columna llena está exactamente en su tope y la forma del cuerpo la acepta', () => {
    const f = llena(1);
    for (const c of COLUMNAS_LOTE) expect([c, String(f[c]).length]).toEqual([c, TOPES_COLUMNA[c]]);
    expect(TOPE_CANALES).toBe(1197);
    expect(filasDelCuerpo(peorCaso(), 'crear').filas).toHaveLength(MAX_FILAS_LOTE);
  });
  it(`500 filas llenas caben en MAX_BYTES_LOTE (${MAX_BYTES_LOTE} bytes), y el tope no las pasa en más de 16 KiB`, () => {
    const bytes = Buffer.byteLength(JSON.stringify(peorCaso()));
    expect(bytes).toBeLessThanOrEqual(MAX_BYTES_LOTE);
    expect(MAX_BYTES_LOTE - bytes).toBeLessThan(16 * 1024);
    expect(TOPE_CUERPO_LOTE).toBe(MAX_BYTES_LOTE); // el lector de JSON usa el mismo número
  });
  it('nadie lo supera con caracteres admisibles: por columna, el carácter admitido más caro en el JSON, repetido hasta el tope, sigue cabiendo', () => {
    const fila: Record<string, unknown> = {};
    for (const c of COLUMNAS_LOTE) {
      const admitidos = CANDIDATOS.filter((x) => admite(c, x.repeat(Math.floor(TOPES_COLUMNA[c] / x.length))));
      const caro = admitidos.reduce((a, b) => (bytesPorUnidad(b) > bytesPorUnidad(a) ? b : a));
      fila[c] = caro.repeat(Math.floor(TOPES_COLUMNA[c] / caro.length));
      expect([c, bytesPorUnidad(caro)]).toEqual([c, COLUMNAS_TEXTO_LIBRE.includes(c) ? 3 : 1]);
    }
    const cuerpo = { filas: Array.from({ length: MAX_FILAS_LOTE }, (_, i) => ({ n: Number.MAX_SAFE_INTEGER - MAX_FILAS_LOTE + i + 1, ...fila })), huella: 'a'.repeat(64) };
    expect(() => filasDelCuerpo(cuerpo, 'crear')).not.toThrow();
    expect(Buffer.byteLength(JSON.stringify(cuerpo))).toBeLessThanOrEqual(MAX_BYTES_LOTE);
  });
  it('lo que el JSON escribe con más bytes no entra: controles, sustitutos sueltos y, en las columnas de códigos, «"», «\\» y lo que no es ASCII', () => {
    for (const x of ['\u0000', '\u0001', '\t', '\u007f', '\u0085']) expect(motivosDe({ n: 8, nombre: `a${x}b` })).toEqual(['fila 8: nombre trae un carácter de control']);
    expect(motivosDe({ n: 8, zona: 'a\ud800' })).toEqual(['fila 8: zona trae un carácter no válido (un sustituto UTF-16 suelto)']);
    expect(motivosDe({ n: 8, nombre: 'Ñandú 😀 «€»' })).toEqual([]); // el texto libre admite lo imprimible
    for (const c of COLUMNAS_LOTE.filter((x) => !COLUMNAS_TEXTO_LIBRE.includes(x))) {
      for (const x of ['"', '\\', 'é', '€']) expect(motivosDe({ n: 8, [c]: x })).toEqual([`fila 8: ${c} admite solo caracteres ASCII imprimibles, sin comillas dobles ni barra invertida`]);
    }
  });
  it('501 filas es 413 con `codigo: demasiadas_filas`; un cuerpo inválido es 400 con `codigo: cuerpo_invalido` y la lista de motivos', () => {
    expect(() => filasDelCuerpo(peorCaso(MAX_FILAS_LOTE + 1), 'crear')).toThrow(PayloadTooLargeException);
    try { filasDelCuerpo(peorCaso(MAX_FILAS_LOTE + 1)); } catch (e) { expect((e as PayloadTooLargeException).getResponse()).toMatchObject({ codigo: 'demasiadas_filas' }); }
    try { filasDelCuerpo({ filas: [{ n: 2, color: 'x' }] }); } catch (e) { expect((e as BadRequestException).getResponse()).toEqual({ statusCode: 400, error: 'Bad Request', codigo: 'cuerpo_invalido', message: ['fila 2: columna no admitida: color'] }); }
    expect.assertions(3);
  });
  it('una celda un carácter sobre su tope es 400 con su fila; también una que no es texto ni número', () => {
    for (const c of COLUMNAS_LOTE) {
      const t = TOPES_COLUMNA[c];
      expect(motivosDe({ ...llena(7), [c]: 'x'.repeat(t + 1) })).toEqual([`fila 7: ${c} pasa su tope de ${t} caracteres (trae ${t + 1})`]);
    }
    expect(motivosDe({ n: 8, nombre: true })).toEqual(['fila 8: nombre debe ser texto o número']);
    expect(motivosDe({ n: 8, nombre: null })).toEqual(['fila 8: nombre debe ser texto o número']);
    expect(motivosDe({ n: 8, canales: ['temperatura'] })).toEqual(['fila 8: canales debe ser texto o número']);
    expect(motivosDe({ n: 8, intervalo_esperado_s: 60 })).toEqual([]); // un número es una celda válida
  });
  it('una columna que no es de la plantilla es 400 con su fila, con la clave recortada a 80 caracteres; también __proto__, constructor y toString', () => {
    expect(motivosDe({ n: 8, color: 'x' })).toEqual(['fila 8: columna no admitida: color']);
    expect(motivosDe({ n: 8, ['k'.repeat(5000)]: 'x' })).toEqual([`fila 8: columna no admitida: ${'k'.repeat(80)}…`]);
    for (const k of ['__proto__', 'constructor', 'toString']) {
      const fila = JSON.parse(`{"n":8,"${k}":"${'x'.repeat(200)}"}`) as Record<string, unknown>;
      expect([k, motivosDe(fila)]).toEqual([k, [`fila 8: columna no admitida: ${k}`]]);
    }
    expect(motivosDe({ n: 8, ['c'.repeat(300)]: 1, otra: 2 }).every((m) => m.length < 200)).toBe(true);
  });
  it('el proxy: tope general de 128 KiB y el del lote, el mismo número que el backend; sus 413, en JSON con el mensaje del backend', () => {
    const conf = readFileSync(new URL('../../../proxy/nginx.conf', import.meta.url), 'utf8');
    const topes = [...conf.matchAll(/^\s*client_max_body_size\s+(\S+);/gm)].map((m) => m[1]);
    expect(topes).toEqual(['131072', String(MAX_BYTES_LOTE)]);
    const lote = /location ~\* \^\/dispositivos\/lote\/\?\$ \{([^}]*)\}/.exec(conf)?.[1] ?? '';
    expect(lote).toContain(`client_max_body_size ${MAX_BYTES_LOTE};`);
    for (const z of ['limit_req          zone=general burst=200 nodelay;', 'limit_req          zone=administracion burst=10 nodelay;', 'limit_conn         http_por_ip 100;']) expect(lote).toContain(z);
    expect(lote).toContain('error_page 413 @lote_grande;');
    expect([...conf.matchAll(/^\s*error_page 413 (@\w+);/gm)].map((m) => m[1])).toEqual(['@cuerpo_grande', '@lote_grande']); // el general y el del lote
    const cuerpos = [...conf.matchAll(/return 413 '([^']*)';/g)].map((m) => JSON.parse(m[1]) as unknown);
    expect(cuerpos).toEqual([{ statusCode: 413, message: MENSAJE_TOPE_CUERPO }, { statusCode: 413, message: MENSAJE_TOPE_LOTE }]);
  });
  it('lo que el backend trata como lote (tope grande) también lo trata así el proxy: nunca al revés', () => {
    const conf = readFileSync(new URL('../../../proxy/nginx.conf', import.meta.url), 'utf8');
    const expr = /location ~\* (\S+) \{\n[^}]*client_max_body_size/.exec(conf)?.[1];
    expect(expr).toBe('^/dispositivos/lote/?$');
    const delProxy = new RegExp(expr!, 'i');
    // nginx compara `$uri`: sin la consulta, con los %XX decodificados y las barras repetidas unidas (merge_slashes, por omisión).
    const uri = (url: string): string => decodeURIComponent(url.split('?')[0]).replace(/\/{2,}/g, '/');
    const urls = ['/dispositivos/lote', '/dispositivos/lote/', '/dispositivos/lote?x=1', '/dispositivos/lote/?modo=crear', '/Dispositivos/Lote', '/DISPOSITIVOS/LOTE?modo=validar',
      '/dispositivos/lote;x', '//dispositivos/lote', '/dispositivos//lote', '/dispositivos%2flote', '/dispositivos/lote%2f', '/dispositivos/lote/plantilla', '/dispositivos/lote-falso'];
    const inseguras = urls.filter((u) => esLote('POST', u) && !delProxy.test(uri(u)));
    expect(inseguras).toEqual([]);
    expect(urls.filter((u) => esLote('POST', u))).toEqual(['/dispositivos/lote', '/dispositivos/lote/', '/dispositivos/lote?x=1', '/dispositivos/lote/?modo=crear', '/Dispositivos/Lote', '/DISPOSITIVOS/LOTE?modo=validar']);
  });
  it('la plantilla publica los mismos topes, max_filas, max_bytes y los separadores; las obligatorias son las que exige la validación', () => {
    const p = plantillaLote();
    expect(p.columnas.map((c) => c.nombre)).toEqual([...COLUMNAS_LOTE]);
    expect(Object.fromEntries(p.columnas.map((c) => [c.nombre, c.tope]))).toEqual(TOPES_COLUMNA);
    expect(p.columnas.filter((c) => c.obligatoria).map((c) => c.nombre)).toEqual(['id_fisico', 'nombre', 'zona', 'intervalo_esperado_s', 'canales']);
    expect(p).toMatchObject({ max_filas: MAX_FILAS_LOTE, max_bytes: MAX_BYTES_LOTE, separadores: { columnas: [';', ',', '\t'], canales: ['|', ';'] } });
    expect(p.columnas.find((c) => c.nombre === 'canales')?.ejemplo).not.toContain(';');
    expect(p.columnas.filter((c) => c.texto_libre).map((c) => c.nombre)).toEqual([...COLUMNAS_TEXTO_LIBRE]); // la pantalla comprueba lo mismo que filasDelCuerpo // el ejemplo ya no trae «;» sin comillas
  });
});
