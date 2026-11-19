// Exportación de un sitio entero (HU-08, RF-34, RF-31, RF-41; docs/19 §4, bloque R; 19/11/2026): en UN archivo, las mediciones, las tramas
// aceptadas con su carga exacta y su huella, y los eventos del ciclo de vida de todos los dispositivos del sitio, en cualquier estado.
// Funciones puras sobre tres fuentes que se recorren una vez y una salida con contrapresión: el controlador conecta las consultas por
// tandas (consulta.service.ts) y la respuesta HTTP. Nada de personas en el archivo (docs/21, minimización): quién hizo cada cambio se
// queda en «Actividad» (P14); el detalle de los eventos de un dispositivo no lleva nombres, correos ni ids de usuario (revisado el
// 19/11/2026 en cada escritor de `evento`: alta, baja, rotación, calibración, configuración, reglas, condiciones).
import { celdaCsv, celdaNumerica, nombreSaneado } from './exportar.js';
import { LibroXlsx, type Celda, type Columna } from './xlsx.js';
import { EscritorZip, TOPES_ZIP, type TopesZip } from './zip.js';

export const FORMATOS_SITIO = ['csv', 'xlsx', 'json'] as const;
export type FormatoSitio = (typeof FORMATOS_SITIO)[number];
export const VERSION_FORMATO = 'exportacion-sitio/1';

export function formatoSitio(valor: unknown): FormatoSitio {
  if (valor === undefined) return 'csv';
  if (typeof valor === 'string' && (FORMATOS_SITIO as readonly string[]).includes(valor)) return valor as FormatoSitio;
  throw new Error(`formato debe ser uno de: ${FORMATOS_SITIO.join(', ')}`);
}

export const EXTENSION: Readonly<Record<FormatoSitio, string>> = { csv: 'zip', xlsx: 'xlsx', json: 'json' };
export const TIPO_CONTENIDO: Readonly<Record<FormatoSitio, string>> = {
  csv: 'application/zip',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json; charset=utf-8',
};

// sitio_<código>_<desde>_<hasta>.<extensión>, con el mismo saneado que la exportación por dispositivo.
export function nombreDeArchivoSitio(codigo: string, desde: Date, hasta: Date, f: FormatoSitio): string {
  return `sitio_${nombreSaneado(codigo, 'sin-codigo', desde, hasta)}.${EXTENSION[f]}`;
}

export interface FilaMedicionSitio { tiempo_utc: string; id_fisico: string; magnitud: string; valor: number; unidad: string; canal_id: string }
export interface FilaTramaSitio { recibido_en_utc: string; id_fisico: string; topico: string; adaptador: string; bytes: number; sha256: string; payload_base64: string }
export interface FilaEventoSitio { ocurrido_en_utc: string; id_fisico: string; tipo: string; detalle: unknown }
export interface FuentesSitio {
  mediciones(): AsyncIterable<FilaMedicionSitio>;
  tramas(): AsyncIterable<FilaTramaSitio>;
  eventos(): AsyncIterable<FilaEventoSitio>;
}
export interface MetaSitio { codigo: string; nombre: string; desde: Date; hasta: Date; generadoEn: Date; retencionTramasDias: number }
export interface Conteos { mediciones: number; tramas: number; eventos: number }
export interface Archivo { nombre: string; filas: number }
export interface ResultadoExportacion { conteos: Conteos; archivos: Archivo[]; bytes: number }

export const COLUMNAS = {
  mediciones: ['tiempo_utc', 'id_fisico', 'magnitud', 'valor', 'unidad', 'canal_id'],
  tramas: ['recibido_en_utc', 'id_fisico', 'topico', 'adaptador', 'bytes', 'sha256', 'payload_base64'],
  eventos: ['ocurrido_en_utc', 'id_fisico', 'tipo', 'detalle_json'],
} as const;
export type Conjunto = keyof typeof COLUMNAS;
const CONJUNTOS: readonly Conjunto[] = ['mediciones', 'tramas', 'eventos'];

// Qué es cada columna: lo dicen LEEME.txt y la hoja «Acerca de».
const DESCRIPCION: Readonly<Record<string, string>> = {
  tiempo_utc: 'instante de la medición en UTC (ISO 8601 con microsegundos), el texto exacto de la base',
  recibido_en_utc: 'instante en que la plataforma recibió la trama, en UTC (ISO 8601 con microsegundos)',
  ocurrido_en_utc: 'instante del evento en UTC (ISO 8601 con microsegundos)',
  fecha_utc: 'solo en XLSX: el mismo instante como fecha de planilla (UTC, milisegundos; los microsegundos están en la columna de texto)',
  id_fisico: 'identificador físico del dispositivo (DevEUI, MAC u otro)',
  magnitud: 'código de la magnitud del catálogo (temperatura, humedad, …)',
  valor: 'valor medido, con punto decimal (notación científica si hace falta)',
  unidad: 'unidad con que se guardó el valor (símbolo SenML)',
  canal_id: 'identificador del canal (UUID)',
  topico: 'tópico MQTT (o ruta HTTP) por el que llegó la trama',
  adaptador: 'adaptador que tradujo la trama (senml, plano, …)',
  bytes: 'tamaño de la carga original en bytes',
  sha256: 'huella SHA-256 de la carga original, calculada en la base (hexadecimal)',
  payload_base64: 'la carga original exacta en base64 (RFC 4648); en XLSX se parte en payload_base64, payload_base64_2 y payload_base64_3, de hasta 32 000 caracteres, que se concatenan',
  tipo: 'tipo de evento (alta, baja, dispositivo_configurado, condicion_abierta, …)',
  detalle_json: 'detalle del evento en JSON (sin datos de personas)',
};

// El instante del texto de la base («2026-11-19T12:00:00.123456Z») en milisegundos Unix, truncando los microsegundos (un Date no los guarda).
export function msDeInstante(texto: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/.exec(texto);
  if (m === null) return Number.NaN;
  const frac = (m[7] ?? '').padEnd(6, '0');
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), Math.floor(Number(frac) / 1000));
}

// La carga en base64 partida para el XLSX: hasta tres trozos de 32 000 caracteres (una celda admite 32 767). 64 KiB, el tope del broker y
// del receptor HTTP, son 87 384 caracteres: caben en tres. Más que eso no debería existir; si existe, se corta la descarga con el motivo
// en vez de perder una parte de la carga en silencio.
export const TROZO_CARGA = 32_000;
export const TROZOS_CARGA = 3;
export function partirCarga(b64: string): [string, string, string] {
  if (b64.length > TROZO_CARGA * TROZOS_CARGA) throw new Error(`una carga de ${b64.length} caracteres en base64 no cabe en ${TROZOS_CARGA} columnas de ${TROZO_CARGA}`);
  return [b64.slice(0, TROZO_CARGA), b64.slice(TROZO_CARGA, 2 * TROZO_CARGA), b64.slice(2 * TROZO_CARGA)];
}

// Las filas de cada formato, una función por conjunto: el lector de la prueba de integración las lee con su propio código.
export function filaMedicionCsv(f: FilaMedicionSitio): string {
  return [celdaCsv(f.tiempo_utc), celdaCsv(f.id_fisico), celdaCsv(f.magnitud), celdaNumerica(f.valor), celdaCsv(f.unidad), celdaCsv(f.canal_id)].join(',') + '\r\n';
}
export function filaTramaCsv(f: FilaTramaSitio): string {
  return [celdaCsv(f.recibido_en_utc), celdaCsv(f.id_fisico), celdaCsv(f.topico), celdaCsv(f.adaptador), celdaNumerica(f.bytes), celdaCsv(f.sha256), celdaCsv(f.payload_base64)].join(',') + '\r\n';
}
const detalleTexto = (d: unknown): string => (d === null || d === undefined ? '' : JSON.stringify(d));
export function filaEventoCsv(f: FilaEventoSitio): string {
  return [celdaCsv(f.ocurrido_en_utc), celdaCsv(f.id_fisico), celdaCsv(f.tipo), celdaCsv(detalleTexto(f.detalle))].join(',') + '\r\n';
}
export function filaMedicionJson(f: FilaMedicionSitio): string {
  return JSON.stringify({ tiempo_utc: f.tiempo_utc, id_fisico: f.id_fisico, magnitud: f.magnitud, valor: Number.isFinite(f.valor) ? f.valor : null, unidad: f.unidad, canal_id: f.canal_id });
}
export function filaTramaJson(f: FilaTramaSitio): string {
  return JSON.stringify({ recibido_en_utc: f.recibido_en_utc, id_fisico: f.id_fisico, topico: f.topico, adaptador: f.adaptador, bytes: f.bytes, sha256: f.sha256, payload_base64: f.payload_base64 });
}
export function filaEventoJson(f: FilaEventoSitio): string {
  return JSON.stringify({ ocurrido_en_utc: f.ocurrido_en_utc, id_fisico: f.id_fisico, tipo: f.tipo, detalle: f.detalle ?? null });
}

const texto = (v: string): Celda => ({ texto: v });
const fecha = (instante: string): Celda => ({ fecha: msDeInstante(instante) });
export const COLUMNAS_XLSX: Readonly<Record<Conjunto, readonly Columna[]>> = {
  mediciones: [{ nombre: 'tiempo_utc', ancho: 28 }, { nombre: 'fecha_utc', ancho: 24 }, { nombre: 'id_fisico', ancho: 22 }, { nombre: 'magnitud', ancho: 14 },
    { nombre: 'valor', ancho: 14 }, { nombre: 'unidad', ancho: 10 }, { nombre: 'canal_id', ancho: 38 }],
  tramas: [{ nombre: 'recibido_en_utc', ancho: 28 }, { nombre: 'fecha_utc', ancho: 24 }, { nombre: 'id_fisico', ancho: 22 }, { nombre: 'topico', ancho: 30 },
    { nombre: 'adaptador', ancho: 12 }, { nombre: 'bytes', ancho: 8 }, { nombre: 'sha256', ancho: 66 }, { nombre: 'payload_base64', ancho: 40 },
    { nombre: 'payload_base64_2', ancho: 20 }, { nombre: 'payload_base64_3', ancho: 20 }],
  eventos: [{ nombre: 'ocurrido_en_utc', ancho: 28 }, { nombre: 'fecha_utc', ancho: 24 }, { nombre: 'id_fisico', ancho: 22 }, { nombre: 'tipo', ancho: 24 },
    { nombre: 'detalle_json', ancho: 80 }],
};
export function celdasMedicion(f: FilaMedicionSitio): Celda[] {
  return [texto(f.tiempo_utc), fecha(f.tiempo_utc), texto(f.id_fisico), texto(f.magnitud), { numero: f.valor }, texto(f.unidad), texto(f.canal_id)];
}
export function celdasTrama(f: FilaTramaSitio): Celda[] {
  const [a, b, c] = partirCarga(f.payload_base64);
  return [texto(f.recibido_en_utc), fecha(f.recibido_en_utc), texto(f.id_fisico), texto(f.topico), texto(f.adaptador), { numero: f.bytes }, texto(f.sha256),
    texto(a), b === '' ? null : texto(b), c === '' ? null : texto(c)];
}
export function celdasEvento(f: FilaEventoSitio): Celda[] {
  const d = detalleTexto(f.detalle);
  return [texto(f.ocurrido_en_utc), fecha(f.ocurrido_en_utc), texto(f.id_fisico), texto(f.tipo), d === '' ? null : texto(d)];
}

const NOMBRE_HOJA: Readonly<Record<Conjunto, string>> = { mediciones: 'Mediciones', tramas: 'Tramas', eventos: 'Eventos' };

// El contenido de LEEME.txt y de la hoja «Acerca de», en pares campo–valor. Va al FINAL del archivo, con los conteos: una descarga cortada
// no lo trae, y eso se nota.
export function acercaDe(meta: MetaSitio, f: Exclude<FormatoSitio, 'json'>, archivos: readonly Archivo[], conteos: Conteos): [string, string][] {
  const filas: [string, string][] = [
    ['formato', VERSION_FORMATO],
    ['sitio', `${meta.codigo} (${meta.nombre})`],
    ['desde (UTC, incluido)', meta.desde.toISOString()],
    ['hasta (UTC, excluido)', meta.hasta.toISOString()],
    ['generado en (UTC)', meta.generadoEn.toISOString()],
    ['contenido', 'las mediciones, las tramas aceptadas con su carga original y los eventos del ciclo de vida de todos los dispositivos del sitio, en cualquier estado, del rango [desde, hasta); ordenados por dispositivo, magnitud y tiempo'],
    ['tramas', `la plataforma guarda las tramas originales ${meta.retencionTramasDias} días: del rango salen las que todavía existen (las mediciones y los eventos no vencen así)`],
    ['personas', 'el archivo no trae datos de personas; quién hizo cada cambio está en «Actividad» del panel'],
    ['cuarentena', 'no se exporta: son las tramas rechazadas, no datos aceptados del sitio'],
  ];
  if (f === 'csv') {
    filas.push(['CSV', 'coma como separador, punto decimal, UTF-8, fin de línea CRLF, comillas dobles según RFC 4180']);
    filas.push(['apóstrofo', 'a todo texto que, tras cero o más apóstrofos, empieza con = + - @, tabulador, retorno o salto de línea (o sus formas de ancho completo) se le antepuso un apóstrofo para que una planilla no lo ejecute como fórmula; para recuperar el original exacto, a un texto que empieza con apóstrofos seguidos de uno de esos caracteres se le quita uno']);
  } else {
    filas.push(['XLSX', 'una hoja por conjunto, con la primera fila fija; una hoja que llega a 1 048 575 filas sigue en «Mediciones (2)» y así; el texto va tal cual (la planilla no lo evalúa)']);
  }
  for (const c of CONJUNTOS) {
    const cols = f === 'xlsx' ? COLUMNAS_XLSX[c].map((x) => x.nombre).filter((x) => !/^payload_base64_\d$/.test(x)) : [...COLUMNAS[c]];
    for (const col of cols) filas.push([`${c}.${col}`, DESCRIPCION[col] ?? '']);
  }
  for (const a of archivos) filas.push([`filas en ${a.nombre}`, String(a.filas)]);
  filas.push(['filas en total', `${conteos.mediciones} mediciones, ${conteos.tramas} tramas y ${conteos.eventos} eventos`]);
  return filas;
}

// Junta trozos pequeños (una fila) en trozos de 64 KiB antes de entregarlos: cada entrega es una escritura en el socket.
class Acumulador {
  private partes: string[] = [];
  private largo = 0;
  constructor(private readonly salida: (b: Buffer) => Promise<void>) {}
  async escribir(s: string): Promise<void> {
    this.partes.push(s);
    this.largo += s.length;
    if (this.largo >= 64 * 1024) await this.vaciar();
  }
  async vaciar(): Promise<void> {
    if (this.largo === 0) return;
    const b = Buffer.from(this.partes.join(''), 'utf8');
    this.partes = [];
    this.largo = 0;
    await this.salida(b);
  }
}

export interface TopesExportacion { zip: TopesZip; filasPorHoja?: number }

// Escribe el archivo entero en `salida` y devuelve los conteos. Si `salida` lanza (el cliente se fue), la fuente en curso deja de
// pedir tandas: el `for await` sale y el generador cierra su consulta.
export async function escribirExportacionSitio(
  f: FormatoSitio, fuentes: FuentesSitio, meta: MetaSitio, salida: (b: Buffer) => Promise<void>, topes: TopesExportacion = { zip: TOPES_ZIP },
): Promise<ResultadoExportacion> {
  const conteos: Conteos = { mediciones: 0, tramas: 0, eventos: 0 };
  if (f === 'json') {
    const a = new Acumulador(salida);
    let bytes = 0;
    const out = async (s: string): Promise<void> => { bytes += Buffer.byteLength(s); await a.escribir(s); };
    await out(`{"formato":${JSON.stringify(VERSION_FORMATO)},"sitio":${JSON.stringify({ codigo: meta.codigo, nombre: meta.nombre })},` +
      `"desde":"${meta.desde.toISOString()}","hasta":"${meta.hasta.toISOString()}","generado_en":"${meta.generadoEn.toISOString()}",` +
      `"retencion_tramas_dias":${meta.retencionTramasDias}`);
    const conjunto = async <T>(nombre: Conjunto, filas: AsyncIterable<T>, json: (x: T) => string): Promise<void> => {
      await out(`,\n"${nombre}":[`);
      for await (const x of filas) {
        await out((conteos[nombre] === 0 ? '\n' : ',\n') + json(x));
        conteos[nombre]++;
      }
      await out('\n]');
    };
    await conjunto('mediciones', fuentes.mediciones(), filaMedicionJson);
    await conjunto('tramas', fuentes.tramas(), filaTramaJson);
    await conjunto('eventos', fuentes.eventos(), filaEventoJson);
    await out(`,\n"conteos":${JSON.stringify(conteos)}}\n`);
    await a.vaciar();
    return { conteos, archivos: [], bytes };
  }

  const zip = new EscritorZip(salida, topes.zip, meta.generadoEn);
  try {
    if (f === 'csv') {
      const archivos: Archivo[] = [];
      const conjunto = async <T>(nombre: Conjunto, filas: AsyncIterable<T>, csv: (x: T) => string): Promise<void> => {
        const cabecera = COLUMNAS[nombre].join(',') + '\r\n';
        let archivo: Archivo = { nombre: `${nombre}.csv`, filas: 0 };
        let parte = 1;
        archivos.push(archivo);
        await zip.abrir(archivo.nombre);
        await zip.escribir(cabecera);
        for await (const x of filas) {
          const linea = csv(x);
          // Sin ZIP64, una entrada no pasa de 1 GiB: la que se llena sigue en «mediciones-2.csv», con su cabecera.
          if (!zip.cabe(Buffer.byteLength(linea))) {
            await zip.cerrar();
            archivo = { nombre: `${nombre}-${++parte}.csv`, filas: 0 };
            archivos.push(archivo);
            await zip.abrir(archivo.nombre);
            await zip.escribir(cabecera);
          }
          await zip.escribir(linea);
          archivo.filas++;
          conteos[nombre]++;
        }
        await zip.cerrar();
      };
      await conjunto('mediciones', fuentes.mediciones(), filaMedicionCsv);
      await conjunto('tramas', fuentes.tramas(), filaTramaCsv);
      await conjunto('eventos', fuentes.eventos(), filaEventoCsv);
      const leeme = acercaDe(meta, 'csv', archivos, conteos).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n';
      await zip.abrir('LEEME.txt');
      await zip.escribir(leeme);
      await zip.cerrar();
      return { conteos, archivos, bytes: await zip.terminar() };
    }

    const libro = new LibroXlsx(zip, { filasPorHoja: topes.filasPorHoja ?? 1_048_575 });
    await libro.empezar();
    const conjunto = async <T>(nombre: Conjunto, filas: AsyncIterable<T>, celdas: (x: T) => Celda[]): Promise<void> => {
      await libro.hoja(NOMBRE_HOJA[nombre], COLUMNAS_XLSX[nombre]);
      for await (const x of filas) {
        await libro.fila(celdas(x));
        conteos[nombre]++;
      }
    };
    await conjunto('mediciones', fuentes.mediciones(), celdasMedicion);
    await conjunto('tramas', fuentes.tramas(), celdasTrama);
    await conjunto('eventos', fuentes.eventos(), celdasEvento);
    const archivos = libro.hojasEscritas.map((h) => ({ nombre: `hoja «${h.nombre}»`, filas: h.filas }));
    await libro.acercaDe(acercaDe(meta, 'xlsx', archivos, conteos));
    return { conteos, archivos, bytes: await libro.terminar() };
  } catch (e) {
    zip.abortar();
    throw e;
  }
}

// ── Estimación antes de descargar (bloque R, punto 5) ─────────────────────────────────────────────────────────────────────────────
export const TOPE_ESTIMACION = 1_000_000;
// Tiempo máximo de cada consulta de la estimación (la exportación tiene 30 s): contar 1 000 000 tarda ≈ 0,5 s (docs/16 §89).
export const TIEMPO_ESTIMACION_MS = 10_000;
// Bytes por fila del archivo descargado (el .zip del CSV y el .xlsx, comprimidos; el JSON, tal cual), medidos en la prueba de integración
// sobre 1 000 000 de mediciones, 100 000 tramas SenML de ≈ 120 bytes y 10 000 eventos: bytes del archivo ÷ filas (docs/16 §89). Una trama
// de 64 KiB pesa mucho más que la del banco: el tamaño de las tramas es el más aproximado de los tres.
export const BYTES_POR_FILA: Readonly<Record<FormatoSitio, Readonly<Record<Conjunto, number>>>> = {
  csv: { mediciones: 8.9, tramas: 51.9, eventos: 29.9 },
  xlsx: { mediciones: 19, tramas: 60.6, eventos: 37.8 },
  json: { mediciones: 172.9, tramas: 395.5, eventos: 208.2 },
};
export const BYTES_FIJOS: Readonly<Record<FormatoSitio, number>> = { csv: 1776, xlsx: 4337, json: 284 };

export interface Conteo { filas: number; supera_tope: boolean }
export function bytesAproximados(filas: Conteos): Record<FormatoSitio, number> {
  const de = (f: FormatoSitio): number => Math.round(BYTES_FIJOS[f] + CONJUNTOS.reduce((s, c) => s + filas[c] * BYTES_POR_FILA[f][c], 0));
  return { csv: de('csv'), xlsx: de('xlsx'), json: de('json') };
}
// El cuerpo de GET /sitios/{id}/exportar/estimacion. `n` trae los conteos de la base, que llegan hasta `tope + 1`.
export function estimacion(desde: Date, hasta: Date, n: Conteos & { tramasDesde: Date | null }, retencionDias: number, tope = TOPE_ESTIMACION) {
  const conteo = (x: number): Conteo => ({ filas: Math.min(x, tope), supera_tope: x > tope });
  const filas: Conteos = { mediciones: Math.min(n.mediciones, tope), tramas: Math.min(n.tramas, tope), eventos: Math.min(n.eventos, tope) };
  return {
    desde, hasta, tope_conteo: tope,
    mediciones: conteo(n.mediciones),
    tramas: { ...conteo(n.tramas), desde: n.tramasDesde },
    eventos: conteo(n.eventos),
    retencion_tramas_dias: retencionDias,
    bytes_aproximados: bytesAproximados(filas),
  };
}
