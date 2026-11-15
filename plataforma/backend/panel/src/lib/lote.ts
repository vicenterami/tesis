// P7, alta masiva por archivo (docs/19 §4, F2 y bloque N). El CSV se lee en el navegador (nunca se sube el archivo: se convierte en
// `filas` y va como JSON, cada una con `n`, su fila en el archivo contando las vacías, con la cabecera en la 1). Las columnas, sus topes y
// los límites salen de `GET /dispositivos/lote/plantilla`: el panel no guarda copia. Se valida completo con `modo=validar` (no crea nada) y
// las válidas se crean con `modo=crear` en UNA petición, todo o nada, con la `huella` del plan revisado y una llave de reintento
// (`Idempotency-Key`): si la respuesta se pierde, se repite con la misma llave y el servidor devuelve la misma, sin crear de más. Las
// credenciales llegan UNA sola vez y viven solo en memoria hasta que la persona las descarga.
import { ErrorApi } from './api';

// La columna que «Descargar rechazadas» agrega para que se lea el porqué; al volver a subir el archivo corregido, se ignora.
export const COLUMNA_MOTIVO = 'motivo';

// ── La plantilla del servidor (GET /dispositivos/lote/plantilla) ───────────────────────────────────────────────────────────────────
export interface ColumnaPlantilla { nombre: string; obligatoria: boolean; tope: number; ayuda: string; ejemplo: string }
export interface PlantillaLote {
  columnas: ColumnaPlantilla[];
  max_filas: number;
  max_bytes: number;
  separadores: { columnas: string[]; canales: string[] };
}

export type FilaLote = { n: number } & Partial<Record<string, string | number>>;
export interface LecturaCsv {
  filas: FilaLote[];
  errores: string[];
}

// RFC 4180: comas, comillas dobles (con "" dentro), saltos CRLF o LF, y la marca BOM que deja Excel. Una celda entre comillas puede
// llevar comas y saltos de línea. Devuelve cada registro con su número (`n`, desde 1) contando los vacíos, que se descartan: así el
// número es la fila que la persona ve en su planilla aunque haya filas vacías en medio.
export function celdasCsv(texto: string): { n: number; celdas: string[] }[] {
  const t = texto.replace(/^﻿/, '');
  const registros: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (c === '"') comillas = false;
      else celda += c;
    } else if (c === '"' && celda === '') comillas = true;
    else if (c === ',') {
      fila.push(celda);
      celda = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(celda);
      registros.push(fila);
      fila = [];
      celda = '';
    } else celda += c;
  }
  if (celda !== '' || fila.length > 0) {
    fila.push(celda);
    registros.push(fila);
  }
  return registros.map((celdas, i) => ({ n: i + 1, celdas })).filter((r) => r.celdas.some((x) => x.trim() !== ''));
}

// El archivo → filas con la cabecera de la plantilla. Los errores son del archivo entero (cabecera, tamaño); los de cada fila los dice el servidor.
export function leerCsv(texto: string, p: PlantillaLote): LecturaCsv {
  const errores: string[] = [];
  const columnas = p.columnas.map((c) => c.nombre);
  if (new TextEncoder().encode(texto).length > p.max_bytes) return { filas: [], errores: [`el archivo pesa más de ${megas(p.max_bytes)} MB: divídelo`] };
  const registros = celdasCsv(texto);
  if (registros.length === 0) return { filas: [], errores: ['el archivo está vacío'] };
  const cabecera = registros[0]!.celdas.map((x) => x.trim().toLowerCase());
  const desconocidas = cabecera.filter((x) => x !== COLUMNA_MOTIVO && !columnas.includes(x));
  if (desconocidas.length > 0) errores.push(`columnas no admitidas: ${desconocidas.join(', ')} (la cabecera es ${columnas.join(', ')})`);
  const faltan = p.columnas.filter((c) => c.obligatoria && !cabecera.includes(c.nombre)).map((c) => c.nombre);
  if (faltan.length > 0) errores.push(`faltan columnas: ${faltan.join(', ')}`);
  const repetidas = cabecera.filter((x, i) => cabecera.indexOf(x) !== i);
  if (repetidas.length > 0) errores.push(`columnas repetidas: ${[...new Set(repetidas)].join(', ')}`);
  const datos = registros.slice(1);
  if (datos.length === 0) errores.push('el archivo no trae filas de datos, solo la cabecera');
  if (datos.length > p.max_filas) errores.push(`el archivo trae ${datos.length} filas y el máximo es ${p.max_filas}: divídelo`);
  if (errores.length > 0) return { filas: [], errores };
  const filas = datos.map((d) => {
    const f: FilaLote = { n: d.n };
    cabecera.forEach((col, i) => {
      if (col === COLUMNA_MOTIVO) return;
      const v = (d.celdas[i] ?? '').trim();
      if (v !== '') f[col] = v;
    });
    return f;
  });
  return { filas, errores: [] };
}
export const megas = (bytes: number): string => (bytes / 1_000_000).toLocaleString('es-CL', { maximumFractionDigits: 1 });

// El cuerpo que se enviará, contra el tope de bytes de la plantilla (antes de enviar: el servidor respondería 413).
export function excedeBytes(cuerpo: unknown, p: PlantillaLote): boolean {
  return new TextEncoder().encode(JSON.stringify(cuerpo)).length > p.max_bytes;
}

// ── El plan del servidor ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export type ResultadoFila = 'valida' | 'creada' | 'rechazada' | 'existe';
export interface Nota { campo: string; texto: string }
export interface FilaInforme {
  n: number; // la fila del archivo, la que mandó el panel
  id_fisico: string;
  resultado: ResultadoFila;
  motivo: string | null;
  id: string | null;
  credencial: string | null;
  topico: string | null;
  interpretada?: Record<string, unknown> | null;
  por_defecto?: string[];
  avisos?: Nota[];
  motivos?: Nota[];
}
export interface InformeLote {
  leidas?: number;
  validas: number;
  rechazadas: number;
  existentes: number;
  con_aviso?: number;
  huella: string;
  filas: FilaInforme[];
}
export const ROTULO_RESULTADO: Readonly<Record<ResultadoFila, string>> = { valida: 'Válida', creada: 'Creada', rechazada: 'Rechazada', existe: 'Ya existe' };

// ── Crear: una petición, y la misma llave si la respuesta se pierde ────────────────────────────────────────────────────────────────
// Se repite solo cuando no se sabe qué pasó (sin respuesta, o un 502/503/504 de un intermediario); un 4xx es una respuesta y se devuelve.
// Un 409 `lote_en_curso` al repetir puede ser la propia petición anterior todavía en curso: también se repite, tras la espera.
export const INTENTOS_CREAR = 3;
export function hayQueRepetir(e: unknown): boolean {
  if (!(e instanceof ErrorApi)) return false;
  return e.codigo === 0 || e.codigo === 502 || e.codigo === 503 || e.codigo === 504;
}
export const codigoDeConflicto = (e: unknown): string | null =>
  e instanceof ErrorApi && e.codigo === 409 && typeof e.cuerpo.codigo === 'string' ? e.cuerpo.codigo : null;
export async function crearConReintento<T>(
  enviar: (llave: string) => Promise<T>,
  llave: string,
  esperar: (ms: number) => Promise<void> = (ms) => new Promise((ok) => setTimeout(ok, ms)),
  intentos = INTENTOS_CREAR,
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await enviar(llave);
    } catch (e) {
      const repetible = hayQueRepetir(e) || (i > 1 && codigoDeConflicto(e) === 'lote_en_curso');
      if (!repetible || i >= intentos) throw e;
      await esperar(1000 * i);
    }
  }
}
export function nuevaLlave(): string {
  return crypto.randomUUID();
}

// ── Lo que se descarga (por el ayudante único `descargarTexto`, docs/19 §6) ───────────────────────────────────────────────────────
// Una celda de CSV: entre comillas si hace falta; y si empieza con = + - @ (una fórmula para una planilla), con un apóstrofo delante,
// salvo en las credenciales, que son para máquinas y no se pueden alterar (inyección de fórmulas: OWASP «CSV Injection»).
export function celda(v: string | number | null | undefined, literal = false): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (!literal && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const lineaCsv = (xs: readonly string[]): string => xs.join(',');

// Las credenciales de las creadas: id_fisico, id, credencial, tópico. CRLF (RFC 4180).
export function csvCredenciales(filas: readonly FilaInforme[]): string {
  const creadas = filas.filter((f) => f.resultado === 'creada');
  return [lineaCsv(['id_fisico', 'id', 'credencial', 'topico']), ...creadas.map((f) => lineaCsv([celda(f.id_fisico), celda(f.id, true), celda(f.credencial, true), celda(f.topico, true)]))].join('\r\n') + '\r\n';
}

// Las rechazadas, con las columnas de la plantilla y el motivo al final: se corrigen y se vuelven a subir tal cual (el lector ignora `motivo`).
export function csvRechazadas(columnas: readonly string[], original: readonly FilaLote[], filas: readonly FilaInforme[]): string {
  const porN = new Map(original.map((f) => [f.n, f]));
  const malas = filas.filter((f) => f.resultado === 'rechazada');
  const cuerpo = malas.map((f) => {
    const o = porN.get(f.n) ?? { n: f.n };
    return lineaCsv([...columnas.map((c) => celda(o[c])), celda(f.motivo)]);
  });
  return [lineaCsv([...columnas, COLUMNA_MOTIVO]), ...cuerpo].join('\r\n') + '\r\n';
}

// Un ejemplo para descargar antes de empezar: la cabecera y una fila con el ejemplo de cada columna de la plantilla.
export function csvEjemplo(p: PlantillaLote): string {
  return `${lineaCsv(p.columnas.map((c) => c.nombre))}\r\n${lineaCsv(p.columnas.map((c) => celda(c.ejemplo)))}\r\n`;
}
