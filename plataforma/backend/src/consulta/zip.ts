// Zip en flujo, con código propio sobre node:zlib (docs/19 §4, bloque R, punto 4; 19/11/2026): la exportación por sitio escribe
// el CSV en un .zip y el XLSX, que también es un zip (ECMA-376 Parte 2), sin dependencia nueva y sin armar el archivo en memoria.
// Lo que sigue sale de la especificación de PKWARE (APPNOTE.TXT 6.3.10, descargada el 19/11/2026 con su huella):
//   - cada entrada: cabecera local (firma 0x04034b50, §4.3.7), datos comprimidos con deflate (método 8, §4.4.5) y descriptor de datos
//     (§4.3.9) con su firma opcional 0x08074b50, que §4.3.9.4 recomienda escribir («implementors SHOULD include the signature»);
//   - el bit 3 del «general purpose bit flag» (§4.4.4): «the fields crc-32, compressed size and uncompressed size are set to zero in the
//     local header. The correct values are put in the data descriptor immediately following the compressed data». Así se puede escribir
//     sin saber de antemano el tamaño ni el CRC: se calculan mientras pasa el flujo (zlib.crc32 incremental, Node ≥ 22.2.0);
//   - al final, el directorio central (§4.3.12, firma 0x02014b50) y el fin de directorio (§4.3.16, firma 0x06054b50).
// Sin ZIP64 (§4.4.1.4: un campo que no alcanza obliga a ZIP64): tamaños y desplazamientos son de 32 bits y el número de entradas, de 16.
// Por eso los topes de abajo: ninguna entrada pasa de 1 GiB sin comprimir (quien escribe parte el contenido antes, `cabe()`), el archivo
// se corta con error antes de 4 GiB y el número de entradas tiene un tope explícito, muy por debajo de 65 535.
import { once } from 'node:events';
import { createDeflateRaw, crc32, type DeflateRaw } from 'node:zlib';

export interface TopesZip {
  bytesPorEntrada: number; // sin comprimir
  bytesTotales: number; // del archivo escrito, con cabeceras y directorio central
  entradas: number;
}
// 1 GiB por entrada: deflate no agranda más de unos bytes por bloque, así que el tamaño comprimido también cabe en 32 bits.
// 4 GiB − 64 MiB en total: el margen cubre el directorio central (46 bytes más el nombre por entrada) y el último trozo de deflate.
export const TOPES_ZIP: Readonly<TopesZip> = { bytesPorEntrada: 2 ** 30, bytesTotales: 2 ** 32 - 64 * 2 ** 20, entradas: 1000 };

const MAX_32 = 0xffffffff;
const BIT3_DESCRIPTOR = 0x0008; // §4.4.4, bit 3
const DEFLATE = 8; // §4.4.5
const VERSION = 20; // §4.4.3.2: «2.0 - File is compressed using Deflate compression»
const TROZO = 64 * 1024; // se junta lo escrito en trozos de 64 KiB antes de pasarlo a deflate: una fila por llamada sería lento

interface Registro { nombre: Buffer; crc: number; comprimido: number; sinComprimir: number; desplazamiento: number }

// Fecha y hora en formato MS-DOS (§4.4.6): años desde 1980 y segundos de a dos. El proceso corre en UTC (zona-utc.ts).
export function fechaDos(d: Date): { hora: number; fecha: number } {
  return {
    hora: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    fecha: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

export class ErrorZip extends Error {}

// Escribe un zip hacia `salida`, que recibe cada trozo y resuelve cuando el destino puede recibir más (contrapresión: quien la implementa
// espera `drain`). Uso: abrir(nombre) → escribir(…)* → cerrar(), tantas entradas como haga falta, y terminar() al final.
export class EscritorZip {
  private readonly registros: Registro[] = [];
  private readonly dos: { hora: number; fecha: number };
  private desplazamiento = 0; // bytes ya entregados a `salida`
  private actual: { registro: Registro; deflate: DeflateRaw; consumo: Promise<void> } | null = null;
  private pendiente: Buffer[] = [];
  private bytesPendientes = 0;

  constructor(private readonly salida: (b: Buffer) => Promise<void>, private readonly topes: Readonly<TopesZip> = TOPES_ZIP, ahora = new Date()) {
    this.dos = fechaDos(ahora);
  }

  // Bytes sin comprimir de la entrada abierta (lo ya escrito más lo que espera en el trozo).
  get bytesEntrada(): number {
    return this.actual === null ? 0 : this.actual.registro.sinComprimir + this.bytesPendientes;
  }
  // ¿Caben `n` bytes más en la entrada abierta? Quien escribe lo pregunta antes de cada fila y, si no, abre la entrada siguiente.
  cabe(n: number): boolean {
    return this.bytesEntrada + n <= this.topes.bytesPorEntrada;
  }
  get bytesEscritos(): number {
    return this.desplazamiento;
  }

  private async emitir(b: Buffer): Promise<void> {
    if (this.desplazamiento + b.length > this.topes.bytesTotales) {
      throw new ErrorZip(`el archivo pasaría de ${this.topes.bytesTotales} bytes, el tope sin ZIP64: acorta el rango`);
    }
    this.desplazamiento += b.length;
    await this.salida(b);
  }

  async abrir(nombre: string): Promise<void> {
    if (this.actual !== null) throw new ErrorZip('hay una entrada abierta: ciérrala antes de abrir otra');
    if (!/^[\x20-\x7e]{1,200}$/.test(nombre)) throw new ErrorZip(`nombre de entrada no admitido: ${nombre}`); // ASCII: sin el bit 11
    if (this.registros.length >= this.topes.entradas) throw new ErrorZip(`el archivo pasaría de ${this.topes.entradas} entradas`);
    const n = Buffer.from(nombre, 'ascii');
    const registro: Registro = { nombre: n, crc: 0, comprimido: 0, sinComprimir: 0, desplazamiento: this.desplazamiento };
    // Cabecera local (§4.3.7): CRC y tamaños en cero, van en el descriptor (bit 3).
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(VERSION, 4);
    h.writeUInt16LE(BIT3_DESCRIPTOR, 6);
    h.writeUInt16LE(DEFLATE, 8);
    h.writeUInt16LE(this.dos.hora, 10);
    h.writeUInt16LE(this.dos.fecha, 12);
    // 14: crc-32, 18: comprimido, 22: sin comprimir → 0
    h.writeUInt16LE(n.length, 26);
    h.writeUInt16LE(0, 28);
    await this.emitir(Buffer.concat([h, n]));
    const deflate = createDeflateRaw({ level: 6 });
    // Lo que sale de deflate va a `salida` en orden y esperando a que el destino lo reciba: si el cliente lee lento, deflate se llena,
    // `write` devuelve false y escribir() espera `drain`; así nada se acumula en memoria.
    const consumo = (async () => {
      for await (const trozo of deflate as AsyncIterable<Buffer>) {
        registro.comprimido += trozo.length;
        await this.emitir(trozo);
      }
    })();
    consumo.catch(() => undefined); // el error se recoge en escribir()/cerrar(); sin esto, Node lo daría por no atendido
    this.actual = { registro, deflate, consumo };
  }

  async escribir(datos: string | Buffer): Promise<void> {
    if (this.actual === null) throw new ErrorZip('no hay una entrada abierta');
    const b = typeof datos === 'string' ? Buffer.from(datos, 'utf8') : datos;
    if (!this.cabe(b.length)) throw new ErrorZip(`la entrada pasaría de ${this.topes.bytesPorEntrada} bytes sin comprimir`);
    this.pendiente.push(b);
    this.bytesPendientes += b.length;
    if (this.bytesPendientes >= TROZO) await this.vaciar();
  }

  private async vaciar(): Promise<void> {
    const a = this.actual;
    if (a === null || this.bytesPendientes === 0) return;
    const unico = this.pendiente.length === 1 ? this.pendiente[0] : undefined;
    const b = unico ?? Buffer.concat(this.pendiente, this.bytesPendientes);
    this.pendiente = [];
    this.bytesPendientes = 0;
    a.registro.crc = crc32(b, a.registro.crc);
    a.registro.sinComprimir += b.length;
    if (!a.deflate.write(b)) await Promise.race([once(a.deflate, 'drain'), a.consumo.then(() => { throw new ErrorZip('deflate terminó antes de tiempo'); })]);
  }

  async cerrar(): Promise<void> {
    const a = this.actual;
    if (a === null) throw new ErrorZip('no hay una entrada abierta');
    await this.vaciar();
    a.deflate.end();
    await a.consumo;
    const r = a.registro;
    if (r.comprimido > MAX_32 || r.sinComprimir > MAX_32) throw new ErrorZip('una entrada pasó de 4 GiB: haría falta ZIP64');
    // Descriptor de datos con su firma (§4.3.9 y §4.3.9.4).
    const d = Buffer.alloc(16);
    d.writeUInt32LE(0x08074b50, 0);
    d.writeUInt32LE(r.crc >>> 0, 4);
    d.writeUInt32LE(r.comprimido, 8);
    d.writeUInt32LE(r.sinComprimir, 12);
    await this.emitir(d);
    this.registros.push(r);
    this.actual = null;
  }

  // Directorio central (§4.3.12) y fin de directorio (§4.3.16). Devuelve el tamaño total del archivo.
  async terminar(): Promise<number> {
    if (this.actual !== null) await this.cerrar();
    const inicio = this.desplazamiento;
    const partes: Buffer[] = [];
    for (const r of this.registros) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(VERSION, 4); // hecho por: 2.0, MS-DOS (byte alto 0, §4.4.2)
      c.writeUInt16LE(VERSION, 6);
      c.writeUInt16LE(BIT3_DESCRIPTOR, 8);
      c.writeUInt16LE(DEFLATE, 10);
      c.writeUInt16LE(this.dos.hora, 12);
      c.writeUInt16LE(this.dos.fecha, 14);
      c.writeUInt32LE(r.crc >>> 0, 16);
      c.writeUInt32LE(r.comprimido, 20);
      c.writeUInt32LE(r.sinComprimir, 24);
      c.writeUInt16LE(r.nombre.length, 28);
      // 30: extra, 32: comentario, 34: disco, 36: atributos internos, 38: externos → 0
      c.writeUInt32LE(r.desplazamiento, 42);
      partes.push(c, r.nombre);
    }
    const directorio = Buffer.concat(partes);
    const fin = Buffer.alloc(22);
    fin.writeUInt32LE(0x06054b50, 0);
    // 4: este disco, 6: disco del directorio → 0
    fin.writeUInt16LE(this.registros.length, 8);
    fin.writeUInt16LE(this.registros.length, 10);
    fin.writeUInt32LE(directorio.length, 12);
    if (inicio > MAX_32) throw new ErrorZip('el directorio central empezaría después de 4 GiB: haría falta ZIP64');
    fin.writeUInt32LE(inicio, 16);
    // 20: comentario → 0
    await this.emitir(Buffer.concat([directorio, fin]));
    return this.desplazamiento;
  }

  // Si la descarga se corta a mitad, deflate se destruye para no dejar su memoria colgada.
  abortar(): void {
    this.actual?.deflate.destroy();
    this.actual = null;
    this.pendiente = [];
    this.bytesPendientes = 0;
  }
}
