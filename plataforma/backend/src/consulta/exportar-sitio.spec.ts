import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import {
  BYTES_POR_FILA, COLUMNAS, TROZO_CARGA, VERSION_FORMATO, acercaDe, bytesAproximados, celdasTrama, escribirExportacionSitio, estimacion, formatoSitio, msDeInstante,
  nombreDeArchivoSitio, partirCarga, type FilaEventoSitio, type FilaMedicionSitio, type FilaTramaSitio, type FormatoSitio, type FuentesSitio, type MetaSitio,
} from './exportar-sitio.js';

const META: MetaSitio = {
  codigo: 'campus-uct', nombre: 'Campus', desde: new Date('2026-10-20T00:00:00Z'), hasta: new Date('2026-11-19T00:00:00Z'),
  generadoEn: new Date('2026-11-19T15:00:00Z'), retencionTramasDias: 30,
};
const M = (i: number): FilaMedicionSitio => ({ tiempo_utc: `2026-11-01T00:00:${String(i % 60).padStart(2, '0')}.000001Z`, id_fisico: 'dev-1', magnitud: 'temperatura', valor: i / 2, unidad: 'Cel', canal_id: 'c1' });
const T: FilaTramaSitio = { recibido_en_utc: '2026-11-01T00:00:00.5Z', id_fisico: 'dev-1', topico: 'sitio/x/dev-1', adaptador: 'senml', bytes: 3, sha256: 'ab', payload_base64: '+/8A' };
const E: FilaEventoSitio = { ocurrido_en_utc: '2026-11-01T00:00:00.000000Z', id_fisico: 'dev-1', tipo: 'alta', detalle: { nota: 'ñandú 🛠️' } };
async function* de<T>(xs: readonly T[]): AsyncGenerator<T> { for (const x of xs) yield await Promise.resolve(x); }
const fuentes = (m: number, t = 1, e = 1): FuentesSitio => ({
  mediciones: () => de(Array.from({ length: m }, (_, i) => M(i))), tramas: () => de(Array.from({ length: t }, () => T)), eventos: () => de(Array.from({ length: e }, () => E)),
});

function entradas(z: Buffer): Map<string, string> {
  const fin = z.length - 22;
  let p = z.readUInt32LE(fin + 16);
  const m = new Map<string, string>();
  for (let i = 0; i < z.readUInt16LE(fin + 10); i++) {
    const largo = z.readUInt16LE(p + 28);
    const local = z.readUInt32LE(p + 42);
    const inicio = local + 30 + z.readUInt16LE(local + 26);
    m.set(z.subarray(p + 46, p + 46 + largo).toString('ascii'), inflateRawSync(z.subarray(inicio, inicio + z.readUInt32LE(p + 20))).toString('utf8'));
    p += 46 + largo;
  }
  return m;
}
async function exportar(f: FormatoSitio, fu: FuentesSitio, topes?: Parameters<typeof escribirExportacionSitio>[4]) {
  const trozos: Buffer[] = [];
  const r = await escribirExportacionSitio(f, fu, META, (b) => { trozos.push(Buffer.from(b)); return Promise.resolve(); }, topes);
  return { r, archivo: Buffer.concat(trozos) };
}

describe('exportación por sitio (bloque R): formatos, nombre y partes', () => {
  it('formato: csv por omisión; xlsx y json; otro o repetido → error', () => {
    expect(formatoSitio(undefined)).toBe('csv');
    expect(formatoSitio('xlsx')).toBe('xlsx');
    expect(() => formatoSitio('xls')).toThrow('formato');
    expect(() => formatoSitio(['csv'])).toThrow('formato');
  });
  it('nombre del archivo: sitio_<código>_<desde>_<hasta>.<zip|xlsx|json>, saneado', () => {
    expect(nombreDeArchivoSitio('campus-uct', META.desde, META.hasta, 'csv')).toBe('sitio_campus-uct_2026-10-20_2026-11-19.zip');
    expect(nombreDeArchivoSitio('a/../b c', META.desde, META.hasta, 'xlsx')).toBe('sitio_a_.._b_c_2026-10-20_2026-11-19.xlsx');
    expect(nombreDeArchivoSitio('', META.desde, META.hasta, 'json')).toBe('sitio_sin-codigo_2026-10-20_2026-11-19.json');
  });
  it('corte de la carga en tres columnas de 32 000: 0, 31 999, 32 000, 32 001 y 87 384 caracteres; más de 96 000 es un error', () => {
    for (const n of [0, 31_999, 32_000, 32_001, 87_384]) {
      const s = 'A'.repeat(n - Math.min(n, 1)) + (n > 0 ? 'Z' : '');
      const [a, b, c] = partirCarga(s);
      expect([n, a.length, b.length, c.length, a + b + c === s]).toEqual([n, Math.min(n, TROZO_CARGA), Math.max(0, Math.min(n - TROZO_CARGA, TROZO_CARGA)), Math.max(0, n - 2 * TROZO_CARGA), true]);
    }
    expect(() => partirCarga('A'.repeat(96_001))).toThrow('no cabe');
    const celdas = celdasTrama({ ...T, payload_base64: 'Q'.repeat(87_384) });
    expect(celdas.slice(7).map((c) => (c !== null && 'texto' in c ? c.texto.length : 0))).toEqual([32_000, 32_000, 23_384]);
    expect(celdasTrama(T).slice(8)).toEqual([null, null]);
  });
  it('el instante de la base en milisegundos, truncando los microsegundos', () => {
    expect(msDeInstante('2026-11-19T15:30:44.123999Z')).toBe(Date.UTC(2026, 10, 19, 15, 30, 44, 123));
    expect(msDeInstante('2026-11-19T15:30:44Z')).toBe(Date.UTC(2026, 10, 19, 15, 30, 44));
    expect(msDeInstante('no')).toBeNaN();
  });
});

describe('exportación por sitio: los tres formatos con fuentes de prueba', () => {
  it('csv: un zip con los tres CSV (cabecera, CRLF, apóstrofo reversible) y LEEME.txt al final con los conteos', async () => {
    const { r, archivo } = await exportar('csv', fuentes(3));
    const e = entradas(archivo);
    expect([...e.keys()]).toEqual(['mediciones.csv', 'tramas.csv', 'eventos.csv', 'LEEME.txt']);
    expect(e.get('mediciones.csv')?.split('\r\n')[0]).toBe(COLUMNAS.mediciones.join(','));
    expect(e.get('mediciones.csv')?.split('\r\n').length).toBe(5); // cabecera, 3 filas y el final vacío
    expect(e.get('tramas.csv')?.split('\r\n')[1]).toBe("2026-11-01T00:00:00.5Z,dev-1,sitio/x/dev-1,senml,3,ab,'+/8A");
    expect(e.get('eventos.csv')?.split('\r\n')[1]).toBe('2026-11-01T00:00:00.000000Z,dev-1,alta,"{""nota"":""ñandú 🛠️""}"');
    const leeme = e.get('LEEME.txt') ?? '';
    expect(leeme).toContain(`formato: ${VERSION_FORMATO}`);
    expect(leeme).toContain('filas en mediciones.csv: 3');
    expect(leeme).toContain('filas en total: 3 mediciones, 1 tramas y 1 eventos');
    expect(leeme).toContain('guarda las tramas originales 30 días');
    expect(r.conteos).toEqual({ mediciones: 3, tramas: 1, eventos: 1 });
    expect(r.bytes).toBe(archivo.length);
  });
  it('csv: un CSV que no cabe en su entrada sigue en mediciones-2.csv con su cabecera (tope reducido en la prueba), sin perder filas', async () => {
    const { r, archivo } = await exportar('csv', fuentes(500), { zip: { bytesPorEntrada: 8000, bytesTotales: 10_000_000, entradas: 100 } });
    const e = entradas(archivo);
    const partesM = [...e.keys()].filter((k) => k.startsWith('mediciones'));
    expect(partesM.slice(0, 3)).toEqual(['mediciones.csv', 'mediciones-2.csv', 'mediciones-3.csv']);
    const filas = partesM.flatMap((k) => {
      const l = (e.get(k) ?? '').split('\r\n').filter((x) => x !== '');
      expect(l[0]).toBe(COLUMNAS.mediciones.join(','));
      return l.slice(1);
    });
    expect(filas).toEqual(Array.from({ length: 500 }, (_, i) => `${M(i).tiempo_utc},dev-1,temperatura,${i / 2},Cel,c1`));
    expect(r.archivos.filter((a) => a.nombre.startsWith('mediciones')).reduce((s, a) => s + a.filas, 0)).toBe(500);
    for (const k of partesM) expect(Buffer.byteLength(e.get(k) ?? '')).toBeLessThanOrEqual(8000);
    expect(e.get('LEEME.txt')).toContain('filas en mediciones-2.csv: ');
  });
  it('xlsx: Acerca de primera, después Mediciones, Tramas y Eventos; con el tope de filas reducido, «Mediciones (2)»', async () => {
    const { r, archivo } = await exportar('xlsx', fuentes(5), { zip: { bytesPorEntrada: 2 ** 30, bytesTotales: 2 ** 31, entradas: 100 }, filasPorHoja: 3 });
    const wb = entradas(archivo).get('xl/workbook.xml') ?? '';
    expect([...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(['Acerca de', 'Mediciones', 'Mediciones (2)', 'Tramas', 'Eventos']);
    expect(r.archivos).toEqual([{ nombre: 'hoja «Mediciones»', filas: 3 }, { nombre: 'hoja «Mediciones (2)»', filas: 2 }, { nombre: 'hoja «Tramas»', filas: 1 }, { nombre: 'hoja «Eventos»', filas: 1 }]);
    expect(entradas(archivo).get('xl/worksheets/acerca.xml')).toContain('filas en hoja «Mediciones (2)»');
  });
  it('json: un objeto con formato, sitio, rango, generado_en, los tres conjuntos y conteos al final; detalle como objeto', async () => {
    const { r, archivo } = await exportar('json', fuentes(2));
    const v = JSON.parse(archivo.toString('utf8')) as Record<string, unknown>;
    expect(Object.keys(v)).toEqual(['formato', 'sitio', 'desde', 'hasta', 'generado_en', 'retencion_tramas_dias', 'mediciones', 'tramas', 'eventos', 'conteos']);
    expect(v).toMatchObject({ formato: VERSION_FORMATO, sitio: { codigo: 'campus-uct', nombre: 'Campus' }, desde: '2026-10-20T00:00:00.000Z', conteos: { mediciones: 2, tramas: 1, eventos: 1 } });
    expect((v.eventos as { detalle: unknown }[])[0]?.detalle).toEqual({ nota: 'ñandú 🛠️' });
    expect((v.mediciones as unknown[])[1]).toEqual({ ...M(1) });
    expect(r.bytes).toBe(archivo.length);
    const vacio = JSON.parse((await exportar('json', fuentes(0, 0, 0))).archivo.toString('utf8')) as Record<string, unknown>;
    expect([vacio.mediciones, vacio.tramas, vacio.eventos, vacio.conteos]).toEqual([[], [], [], { mediciones: 0, tramas: 0, eventos: 0 }]);
  });
  it('si la salida falla (el cliente se fue), la fuente deja de entregar filas: el generador se cierra', async () => {
    let entregadas = 0;
    const cierres: string[] = [];
    let f: FormatoSitio = 'csv';
    async function* muchas(): AsyncGenerator<FilaMedicionSitio> {
      try { for (let i = 0; i < 1_000_000; i++) { entregadas++; yield await Promise.resolve(M(i)); } } finally { cierres.push(f); }
    }
    for (f of ['csv', 'json', 'xlsx'] as const) {
      entregadas = 0;
      const r = escribirExportacionSitio(f, { ...fuentes(0), mediciones: muchas }, META, () => (entregadas > 1000 ? Promise.reject(new Error('cliente se fue')) : Promise.resolve()));
      await expect(r).rejects.toThrow('cliente se fue');
      expect([f, cierres.includes(f), entregadas < 100_000]).toEqual([f, true, true]);
    }
  });
});

describe('estimación (bloque R, punto 5)', () => {
  it('conteos con tope: por encima, supera_tope y el tope como filas; bytes = filas × bytes por fila medidos', () => {
    const e = estimacion(META.desde, META.hasta, { mediciones: 1_000_001, tramas: 10, eventos: 0, tramasDesde: null }, 30);
    expect(e.mediciones).toEqual({ filas: 1_000_000, supera_tope: true });
    expect(e.tramas).toEqual({ filas: 10, supera_tope: false, desde: null });
    expect(e.tope_conteo).toBe(1_000_000);
    expect(e.bytes_aproximados).toEqual(bytesAproximados({ mediciones: 1_000_000, tramas: 10, eventos: 0 }));
    for (const f of ['csv', 'xlsx', 'json'] as const) for (const c of ['mediciones', 'tramas', 'eventos'] as const) expect(BYTES_POR_FILA[f][c]).toBeGreaterThan(0);
  });
  it('«Acerca de» del XLSX describe fecha_utc y no repite payload_base64_2 y _3', () => {
    const a = acercaDe(META, 'xlsx', [], { mediciones: 0, tramas: 0, eventos: 0 }).map(([k]) => k);
    expect(a).toContain('mediciones.fecha_utc');
    expect(a).toContain('tramas.payload_base64');
    expect(a).not.toContain('tramas.payload_base64_2');
  });
});
