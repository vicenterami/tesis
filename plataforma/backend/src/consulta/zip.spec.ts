import { describe, expect, it } from 'vitest';
import { crc32, inflateRawSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { EscritorZip, ErrorZip, fechaDos, type TopesZip } from './zip.js';

// Lector escrito en la prueba, no con el código que escribe: recorre el directorio central desde el fin de directorio (APPNOTE §4.3.16),
// salta a cada cabecera local, descomprime con inflateRaw y compara el CRC y los tamaños con los del descriptor de datos (§4.3.9).
interface Entrada { nombre: string; datos: Buffer; flags: number; metodo: number; descriptor: { firma: number; crc: number; comprimido: number; sinComprimir: number } }
function leerZip(z: Buffer): { entradas: Entrada[]; comentario: number } {
  const fin = z.length - 22;
  expect(z.readUInt32LE(fin)).toBe(0x06054b50);
  const n = z.readUInt16LE(fin + 10);
  expect(z.readUInt16LE(fin + 8)).toBe(n);
  const tamCd = z.readUInt32LE(fin + 12);
  let p = z.readUInt32LE(fin + 16);
  expect(p + tamCd).toBe(fin);
  const entradas: Entrada[] = [];
  for (let i = 0; i < n; i++) {
    expect(z.readUInt32LE(p)).toBe(0x02014b50);
    const flags = z.readUInt16LE(p + 8);
    const metodo = z.readUInt16LE(p + 10);
    const crc = z.readUInt32LE(p + 16);
    const comprimido = z.readUInt32LE(p + 20);
    const sinComprimir = z.readUInt32LE(p + 24);
    const largoNombre = z.readUInt16LE(p + 28);
    const local = z.readUInt32LE(p + 42);
    const nombre = z.subarray(p + 46, p + 46 + largoNombre).toString('ascii');
    p += 46 + largoNombre + z.readUInt16LE(p + 30) + z.readUInt16LE(p + 32);
    expect(z.readUInt32LE(local)).toBe(0x04034b50);
    expect([z.readUInt32LE(local + 14), z.readUInt32LE(local + 18), z.readUInt32LE(local + 22)]).toEqual([0, 0, 0]); // bit 3: van en el descriptor
    const inicio = local + 30 + z.readUInt16LE(local + 26) + z.readUInt16LE(local + 28);
    const datos = inflateRawSync(z.subarray(inicio, inicio + comprimido));
    const d = inicio + comprimido;
    const descriptor = { firma: z.readUInt32LE(d), crc: z.readUInt32LE(d + 4), comprimido: z.readUInt32LE(d + 8), sinComprimir: z.readUInt32LE(d + 12) };
    expect(descriptor).toEqual({ firma: 0x08074b50, crc, comprimido, sinComprimir });
    expect(datos.length).toBe(sinComprimir);
    expect(crc32(datos)).toBe(crc);
    entradas.push({ nombre, datos, flags, metodo, descriptor });
  }
  return { entradas, comentario: z.readUInt16LE(fin + 20) };
}

async function armar(escribir: (z: EscritorZip) => Promise<void>, topes?: TopesZip, lento = false): Promise<Buffer> {
  const trozos: Buffer[] = [];
  const zip = new EscritorZip(async (b) => {
    trozos.push(Buffer.from(b));
    if (lento) await new Promise((r) => setImmediate(r));
  }, topes, new Date('2026-11-19T15:30:44Z'));
  await escribir(zip);
  const total = await zip.terminar();
  const z = Buffer.concat(trozos);
  expect(z.length).toBe(total);
  return z;
}

describe('zip en flujo (bloque R, punto 4): lo escrito se lee con inflateRaw y el CRC coincide', () => {
  it('varias entradas con texto, binario incompresible y una vacía; método 8, bit 3, descriptor con firma', async () => {
    const binario = randomBytes(200_000);
    const texto = 'tiempo_utc,valor\r\n' + Array.from({ length: 20_000 }, (_, i) => `2026-11-19T00:00:${String(i % 60).padStart(2, '0')}.123456Z,${i * 0.5}\r\n`).join('');
    const z = await armar(async (zip) => {
      await zip.abrir('mediciones.csv');
      for (let i = 0; i < texto.length; i += 1000) await zip.escribir(texto.slice(i, i + 1000)); // muchos trozos chicos
      await zip.cerrar();
      await zip.abrir('carga.bin');
      await zip.escribir(binario);
      await zip.cerrar();
      await zip.abrir('vacio.txt');
      await zip.cerrar();
    });
    const { entradas, comentario } = leerZip(z);
    expect(entradas.map((e) => e.nombre)).toEqual(['mediciones.csv', 'carga.bin', 'vacio.txt']);
    expect(entradas[0]?.datos.toString('utf8')).toBe(texto);
    expect(entradas[1]?.datos.equals(binario)).toBe(true);
    expect(entradas[2]?.datos.length).toBe(0);
    expect(entradas.every((e) => e.metodo === 8 && e.flags === 0x0008)).toBe(true);
    expect(comentario).toBe(0);
    expect(entradas[0]?.descriptor.comprimido).toBeLessThan(texto.length / 3); // deflate de verdad
  });
  it('con una salida lenta (contrapresión) el resultado es el mismo', async () => {
    const datos = randomBytes(300_000).toString('base64');
    const escribir = async (zip: EscritorZip): Promise<void> => {
      await zip.abrir('a.txt');
      for (let i = 0; i < datos.length; i += 7000) await zip.escribir(datos.slice(i, i + 7000));
      await zip.cerrar();
    };
    const rapido = await armar(escribir);
    const lento = await armar(escribir, undefined, true);
    expect(lento.equals(rapido)).toBe(true);
    expect(leerZip(lento).entradas[0]?.datos.toString()).toBe(datos);
  });
  it('fecha y hora MS-DOS (APPNOTE §4.4.6): años desde 1980, segundos de a dos', () => {
    const { hora, fecha } = fechaDos(new Date('2026-11-19T15:30:44Z'));
    expect([fecha >> 9, (fecha >> 5) & 0xf, fecha & 0x1f]).toEqual([46, 11, 19]);
    expect([hora >> 11, (hora >> 5) & 0x3f, (hora & 0x1f) * 2]).toEqual([15, 30, 44]);
  });
  it('topes sin ZIP64: una entrada no pasa del tope por entrada; cabe() lo anticipa', async () => {
    const zip = new EscritorZip(() => Promise.resolve(), { bytesPorEntrada: 100, bytesTotales: 10_000, entradas: 10 });
    await zip.abrir('a.csv');
    await zip.escribir('x'.repeat(60));
    expect(zip.cabe(40)).toBe(true);
    expect(zip.cabe(41)).toBe(false);
    await expect(zip.escribir('y'.repeat(41))).rejects.toBeInstanceOf(ErrorZip);
  });
  it('el total se corta con error antes del tope (4 GiB en producción): la salida no recibe el trozo que lo pasaría', async () => {
    let recibido = 0;
    const zip = new EscritorZip((b) => { recibido += b.length; return Promise.resolve(); }, { bytesPorEntrada: 2 ** 30, bytesTotales: 50_000, entradas: 10 });
    const r = (async () => {
      await zip.abrir('a.bin');
      for (let i = 0; i < 20; i++) await zip.escribir(randomBytes(10_000));
      await zip.cerrar();
      await zip.terminar();
    })();
    await expect(r).rejects.toThrow(/tope sin ZIP64/);
    expect(recibido).toBeLessThanOrEqual(50_000);
  });
  it('el número de entradas tiene un tope explícito (65 535 es el máximo sin ZIP64)', async () => {
    const zip = new EscritorZip(() => Promise.resolve(), { bytesPorEntrada: 100, bytesTotales: 1_000_000, entradas: 2 });
    for (const n of ['a', 'b']) { await zip.abrir(n); await zip.cerrar(); }
    await expect(zip.abrir('c')).rejects.toThrow(/2 entradas/);
  });
  it('si la salida falla (el cliente se fue), escribir y cerrar fallan con ese error', async () => {
    let n = 0;
    const zip = new EscritorZip(() => (++n > 2 ? Promise.reject(new Error('cliente se fue')) : Promise.resolve()));
    const r = (async () => {
      await zip.abrir('a.bin');
      for (let i = 0; i < 50; i++) await zip.escribir(randomBytes(64 * 1024));
      await zip.cerrar();
    })();
    await expect(r).rejects.toThrow('cliente se fue');
    zip.abortar();
  });
  it('un nombre que no es ASCII imprimible se rechaza (sin el bit 11 de UTF-8)', async () => {
    const zip = new EscritorZip(() => Promise.resolve());
    await expect(zip.abrir('medición.csv')).rejects.toBeInstanceOf(ErrorZip);
  });
});
