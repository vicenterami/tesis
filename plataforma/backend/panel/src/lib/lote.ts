// P7, alta masiva por archivo (docs/19 §4, tablero v2, F2; D-103 A). El CSV se lee en el navegador (nunca se sube el archivo: se
// convierte en `filas` y va como JSON), se valida completo con `POST /dispositivos/lote?modo=validar` (rápido: no crea nada) y las
// válidas se crean con `modo=crear` en TANDAS de 50 filas secuenciales: crear 500 de una vez tarda ≈ 70 s (un resumen scrypt por
// credencial) y el proxy corta a los 60 s; cada tanda tarda ≈ 7 s. Si una tanda falla, se detiene, se muestra lo creado hasta ahí y se
// ofrece reintentar las restantes. Las credenciales llegan UNA sola vez y viven solo en memoria hasta que la persona las descarga.
export const COLUMNAS_LOTE = ['id_fisico', 'nombre', 'zona', 'via', 'formato', 'intervalo_esperado_s', 'canales', 'pasarela'] as const;
export type ColumnaLote = (typeof COLUMNAS_LOTE)[number];
// La columna que «Descargar rechazadas» agrega para que se lea el porqué; al volver a subir el archivo corregido, se ignora.
export const COLUMNA_MOTIVO = 'motivo';
const OBLIGATORIAS: readonly ColumnaLote[] = ['id_fisico', 'nombre', 'zona', 'canales'];
export const MAX_FILAS_LOTE = 500; // el tope del servidor (lote.ts, MAX_FILAS_LOTE): más es 413
export const TANDA = 50; // D-103 A (lote.ts, TANDA_CLIENTE_LOTE)
export const MAX_BYTES_CSV = 1_000_000;

export type FilaLote = Partial<Record<ColumnaLote, string>>;
export interface LecturaCsv {
  filas: FilaLote[];
  errores: string[];
}

// RFC 4180: comas, comillas dobles (con "" dentro), saltos CRLF o LF, y la marca BOM que deja Excel. Una celda entre comillas puede
// llevar comas y saltos de línea.
export function celdasCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '');
  const filas: string[][] = [];
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
      filas.push(fila);
      fila = [];
      celda = '';
    } else celda += c;
  }
  if (celda !== '' || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((x) => x.trim() !== ''));
}

// El archivo → filas con la cabecera fija. Los errores son del archivo entero (cabecera, tamaño); los de cada fila los dice el servidor.
export function leerCsv(texto: string): LecturaCsv {
  const errores: string[] = [];
  if (texto.length > MAX_BYTES_CSV) return { filas: [], errores: [`el archivo pesa más de ${MAX_BYTES_CSV / 1_000_000} MB: divídelo`] };
  const celdas = celdasCsv(texto);
  if (celdas.length === 0) return { filas: [], errores: ['el archivo está vacío'] };
  const cabecera = celdas[0]!.map((x) => x.trim().toLowerCase());
  const desconocidas = cabecera.filter((x) => x !== COLUMNA_MOTIVO && !(COLUMNAS_LOTE as readonly string[]).includes(x));
  if (desconocidas.length > 0) errores.push(`columnas no admitidas: ${desconocidas.join(', ')} (la cabecera es ${COLUMNAS_LOTE.join(', ')})`);
  const faltan = OBLIGATORIAS.filter((x) => !cabecera.includes(x));
  if (faltan.length > 0) errores.push(`faltan columnas: ${faltan.join(', ')}`);
  const repetidas = cabecera.filter((x, i) => cabecera.indexOf(x) !== i);
  if (repetidas.length > 0) errores.push(`columnas repetidas: ${[...new Set(repetidas)].join(', ')}`);
  const datos = celdas.slice(1);
  if (datos.length === 0) errores.push('el archivo no trae filas de datos, solo la cabecera');
  if (datos.length > MAX_FILAS_LOTE) errores.push(`el archivo trae ${datos.length} filas y el máximo es ${MAX_FILAS_LOTE}: divídelo`);
  if (errores.length > 0) return { filas: [], errores };
  const filas = datos.map((d) => {
    const f: FilaLote = {};
    cabecera.forEach((col, i) => {
      if (col === COLUMNA_MOTIVO) return;
      const v = (d[i] ?? '').trim();
      if (v !== '') f[col as ColumnaLote] = v;
    });
    return f;
  });
  return { filas, errores: [] };
}

// ── El informe del servidor ───────────────────────────────────────────────────────────────────────────────────────────────────────
export type ResultadoFila = 'valida' | 'creada' | 'rechazada' | 'existe';
export interface FilaInforme {
  n: number; // la fila del archivo (la 1 es la cabecera)
  id_fisico: string;
  resultado: ResultadoFila;
  motivo: string | null;
  id: string | null;
  credencial: string | null;
  topico: string | null;
}
export interface InformeLote {
  validas: number;
  rechazadas: number;
  existentes: number;
  filas: FilaInforme[];
}
export const ROTULO_RESULTADO: Readonly<Record<ResultadoFila, string>> = { valida: 'Válida', creada: 'Creada', rechazada: 'Rechazada', existe: 'Ya existe' };

// El servidor numera las filas de lo que recibe (la primera de datos es la 2). Al mandar una tanda o solo las válidas, su `n` se
// devuelve a la fila del ARCHIVO con la lista de filas enviadas: `enviadas[k]` es la fila del archivo de la k-ésima enviada.
export function renumerar(informe: InformeLote, enviadas: readonly number[]): FilaInforme[] {
  return informe.filas.map((f) => ({ ...f, n: enviadas[f.n - 2] ?? f.n }));
}

export function partirEnTandas<T>(xs: readonly T[], tam = TANDA): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < xs.length; i += tam) r.push(xs.slice(i, i + tam));
  return r;
}

export interface Avance {
  creadas: number; // filas ya respondidas por el servidor (creadas o no)
  total: number;
}
export interface ResultadoCreacion {
  filas: FilaInforme[]; // lo que el servidor respondió, en filas del archivo
  pendientes: number[]; // las filas del archivo que no llegaron a crearse (la tanda que falló y las siguientes)
  error: unknown | null;
}

// Crea por tandas secuenciales (nunca dos en vuelo: el servidor admite una creación por lote a la vez). `filasDelArchivo` son las
// filas del archivo (n) que se piden crear, en orden; `cuerpoDe` arma la fila a enviar y `enviar` hace la petición. Se detiene en la
// primera tanda que falla y devuelve lo creado hasta ahí y lo pendiente; una cancelación también detiene.
export async function crearPorTandas(
  filasDelArchivo: readonly number[],
  cuerpoDe: (n: number) => FilaLote,
  enviar: (filas: FilaLote[]) => Promise<InformeLote>,
  alAvanzar: (a: Avance, parcial: FilaInforme[]) => void = () => {},
  tam = TANDA,
): Promise<ResultadoCreacion> {
  const acumulado: FilaInforme[] = [];
  const tandas = partirEnTandas(filasDelArchivo, tam);
  let hechas = 0;
  for (let t = 0; t < tandas.length; t++) {
    const tanda = tandas[t]!;
    try {
      const informe = await enviar(tanda.map(cuerpoDe));
      acumulado.push(...renumerar(informe, tanda));
      hechas += tanda.length;
      alAvanzar({ creadas: hechas, total: filasDelArchivo.length }, [...acumulado]);
    } catch (e) {
      return { filas: acumulado, pendientes: tandas.slice(t).flat(), error: e };
    }
  }
  return { filas: acumulado, pendientes: [], error: null };
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

// Las rechazadas, con las columnas del archivo y el motivo al final: se corrigen y se vuelven a subir tal cual (el lector ignora `motivo`).
export function csvRechazadas(original: readonly FilaLote[], filas: readonly FilaInforme[]): string {
  const malas = filas.filter((f) => f.resultado === 'rechazada');
  const cuerpo = malas.map((f) => {
    const o = original[f.n - 2] ?? {};
    return lineaCsv([...COLUMNAS_LOTE.map((c) => celda(o[c])), celda(f.motivo)]);
  });
  return [lineaCsv([...COLUMNAS_LOTE, COLUMNA_MOTIVO]), ...cuerpo].join('\r\n') + '\r\n';
}

// Un ejemplo para descargar antes de empezar: la cabecera y una fila que muestra la forma de `canales`.
export const CSV_EJEMPLO = `${COLUMNAS_LOTE.join(',')}\r\nnodo-ejemplo-01,Nodo de ejemplo,Zona norte,mqtt,senml,300,temperatura:Cel;humedad:%RH,\r\n`;
