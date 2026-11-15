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
export interface ColumnaPlantilla { nombre: string; obligatoria: boolean; tope: number; texto_libre?: boolean; ayuda: string; ejemplo: string }
export interface PlantillaLote {
  columnas: ColumnaPlantilla[];
  max_filas: number;
  max_bytes: number;
  separadores: { columnas: string[]; canales: string[] };
}

export type FilaLote = { n: number } & Partial<Record<string, string | number>>;
// Un problema del archivo, con su caso de la tabla de docs/19 §4, N8b (qué pasó, por qué, qué se ve y qué se puede hacer).
export interface Problema { caso: CasoError; texto: string }
export interface LecturaCsv {
  filas: FilaLote[];
  errores: Problema[];
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

// El archivo → filas con la cabecera de la plantilla. Lo que se puede ver antes de enviar se ve aquí, con la fila y la columna (docs/19 §4,
// N8b): la pantalla es la ayuda; el servidor sigue siendo la guarda real (filasDelCuerpo). Las reglas de las celdas salen de la plantilla
// (tope y `texto_libre` de cada columna), no de una copia.
const ASCII_IMPRIMIBLE = /^[\x20\x21\x23-\x5b\x5d-\x7e]*$/; // la misma regla de alta/lote.ts para las columnas que no son texto libre
const CONTROL = /\p{Cc}/u;
const SUSTITUTO_SUELTO = /\p{Cs}/u;
const MAX_PROBLEMAS = 10;
export function leerCsv(texto: string, p: PlantillaLote): LecturaCsv {
  const errores: Problema[] = [];
  const columnas = p.columnas.map((c) => c.nombre);
  const bytes = new TextEncoder().encode(texto).length;
  if (bytes > p.max_bytes) return { filas: [], errores: [{ caso: 'archivo_pesado', texto: textoPesado(bytes, p.max_bytes) }] };
  const registros = celdasCsv(texto);
  if (registros.length === 0) return { filas: [], errores: [{ caso: 'archivo_vacio', texto: 'El archivo está vacío.' }] };
  const cabecera = registros[0]!.celdas.map((x) => x.trim().toLowerCase());
  if (cabecera.length === 1 && columnas.length > 1) {
    return { filas: [], errores: [{ caso: 'una_columna', texto: `La cabecera tiene una sola columna («${recorte(registros[0]!.celdas[0] ?? '')}»): el archivo no está separado por comas. Una planilla en español suele guardar con «;»; descarga la plantilla y copia tus datos en ella.` }] };
  }
  for (const x of cabecera.filter((x) => x !== COLUMNA_MOTIVO && !columnas.includes(x))) {
    errores.push({ caso: 'columna_desconocida', texto: `La columna «${recorte(x)}» no es de la plantilla. Las columnas son: ${columnas.join(', ')}.` });
  }
  for (const c of p.columnas.filter((c) => c.obligatoria && !cabecera.includes(c.nombre))) errores.push({ caso: 'falta_obligatoria', texto: `Falta la columna obligatoria «${c.nombre}».` });
  for (const x of new Set(cabecera.filter((x, i) => cabecera.indexOf(x) !== i))) errores.push({ caso: 'columna_repetida', texto: `La columna «${recorte(x)}» está repetida en la cabecera.` });
  const datos = registros.slice(1);
  if (datos.length === 0) errores.push({ caso: 'solo_cabecera', texto: 'El archivo trae la cabecera pero ninguna fila de datos.' });
  if (datos.length > p.max_filas) errores.push({ caso: 'demasiadas_filas', texto: `El archivo trae ${datos.length} filas y el máximo es ${p.max_filas}: divídelo en partes de ${p.max_filas} o menos.` });
  if (errores.length > 0) return { filas: [], errores };
  // Por fila: el número de celdas y cada celda contra su columna.
  const porNombre = new Map(p.columnas.map((c) => [c.nombre, c]));
  for (const d of datos) {
    if (errores.length >= MAX_PROBLEMAS) break;
    if (d.celdas.length !== cabecera.length) {
      errores.push({ caso: 'celdas_de_mas_o_de_menos', texto: `La fila ${d.n} trae ${d.celdas.length} celdas y la cabecera ${cabecera.length}.` });
      continue;
    }
    cabecera.forEach((col, i) => {
      const c = porNombre.get(col);
      const v = (d.celdas[i] ?? '').trim();
      if (c === undefined || v === '' || errores.length >= MAX_PROBLEMAS) return;
      const donde = `Fila ${d.n}, columna «${col}»`;
      if (SUSTITUTO_SUELTO.test(v) || CONTROL.test(v)) errores.push({ caso: 'celda_invalida', texto: `${donde}: trae un carácter que no se admite (un salto de línea, un tabulador u otro carácter de control).` });
      else if (c.texto_libre !== true && !ASCII_IMPRIMIBLE.test(v)) errores.push({ caso: 'celda_invalida', texto: `${donde}: solo admite letras sin acento, dígitos y signos ASCII, sin comillas dobles ni barra invertida («${recorte(v, 40)}»).` });
      else if (v.length > c.tope) errores.push({ caso: 'celda_invalida', texto: `${donde}: tiene ${v.length} caracteres y el máximo es ${c.tope}.` });
    });
  }
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
const recorte = (t: string, max = 80): string => (t.length > max ? `${t.slice(0, max)}…` : t);
export const textoPesado = (bytes: number, max: number): string => `El archivo pesa ${megas(bytes)} MB y el máximo es ${megas(max)} MB: divídelo en partes más chicas.`;
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
// Se repite solo cuando no se sabe qué pasó (sin respuesta, o un 502/503/504 de un intermediario, sin `codigo` del backend); un 4xx o un
// fallo con `codigo` (`nada_creado`, `lote_incierto`) es una respuesta y se devuelve. Un 409 `lote_en_curso` al repetir puede ser la
// propia petición anterior todavía en curso: también se repite, tras la espera. El intento en que llegó la respuesta viaja con ella: un
// 409 en un intento posterior al primero no prueba que no se creó nada (revisión del 15/11/2026).
export const INTENTOS_CREAR = 3;
export function hayQueRepetir(e: unknown): boolean {
  if (!(e instanceof ErrorApi)) return false;
  if (typeof e.cuerpo.codigo === 'string') return false;
  return e.codigo === 0 || e.codigo === 502 || e.codigo === 503 || e.codigo === 504;
}
export const codigoDeConflicto = (e: unknown): string | null =>
  e instanceof ErrorApi && e.codigo === 409 && typeof e.cuerpo.codigo === 'string' ? e.cuerpo.codigo : null;
export class FalloDeCreacion extends Error {
  constructor(readonly causa: unknown, readonly intento: number) {
    super(causa instanceof Error ? causa.message : String(causa));
    this.name = 'FalloDeCreacion';
  }
}
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
      if (!repetible || i >= intentos) throw new FalloDeCreacion(e, i);
      await esperar(1000 * i);
    }
  }
}

// ── Qué falló, por qué y qué hacer (docs/19 §4, N8b): una sola traducción de cada error a su mensaje y su acción ─────────────────────
export const CASOS_ERROR = [
  'archivo_vacio', 'solo_cabecera', 'una_columna', 'columna_desconocida', 'falta_obligatoria', 'columna_repetida', 'celdas_de_mas_o_de_menos',
  'demasiadas_filas', 'archivo_pesado', 'celda_invalida', 'rechazo_del_servidor', 'sesion_vencida', 'sin_permiso', 'lote_en_curso', 'plan_cambio',
  'demasiadas_peticiones', 'sin_respuesta', 'sin_conexion', 'nada_creado', 'lote_incierto', 'llave_reutilizada', 'otro',
] as const;
export type CasoError = (typeof CASOS_ERROR)[number];
export const ACCIONES_LOTE = ['otro_archivo', 'plantilla', 'revisar', 'reintentar', 'inventario', 'sesion'] as const;
export type AccionLote = (typeof ACCIONES_LOTE)[number];
export const ROTULO_ACCION: Readonly<Record<AccionLote, string>> = {
  otro_archivo: 'Elegir otro archivo', plantilla: 'Descargar la plantilla', revisar: 'Volver a revisar', reintentar: 'Reintentar',
  inventario: 'Ir al inventario', sesion: 'Iniciar sesión',
};
// La acción de cada caso (la tabla de N8b). Una prueba recorre CASOS_ERROR y falla si alguno se queda sin acción o sin mensaje.
export const ACCION_DE: Readonly<Record<CasoError, AccionLote>> = {
  archivo_vacio: 'otro_archivo', solo_cabecera: 'otro_archivo', una_columna: 'plantilla', columna_desconocida: 'plantilla', falta_obligatoria: 'plantilla',
  columna_repetida: 'plantilla', celdas_de_mas_o_de_menos: 'otro_archivo', demasiadas_filas: 'otro_archivo', archivo_pesado: 'otro_archivo',
  celda_invalida: 'otro_archivo', rechazo_del_servidor: 'otro_archivo', sesion_vencida: 'sesion', sin_permiso: 'inventario', lote_en_curso: 'reintentar',
  plan_cambio: 'revisar', demasiadas_peticiones: 'reintentar', sin_respuesta: 'inventario', sin_conexion: 'reintentar', nada_creado: 'reintentar',
  lote_incierto: 'inventario', llave_reutilizada: 'revisar', otro: 'reintentar',
};
export const AVISO_SIN_RESPUESTA = 'No llegó la respuesta de la creación y no se sabe si se crearon. Revisa el inventario: las filas que al validar de nuevo salgan «ya existe» se crearon, y sus credenciales no se pueden recuperar: rota la credencial de cada una desde su ficha.';
// Los mensajes fijos de cada caso que no lleva datos propios (los que dependen de la respuesta se arman en explicarError).
export const TEXTO_DE: Readonly<Record<CasoError, string>> = {
  archivo_vacio: 'El archivo está vacío.',
  solo_cabecera: 'El archivo trae la cabecera pero ninguna fila de datos.',
  una_columna: 'La cabecera tiene una sola columna: el archivo no está separado por comas.',
  columna_desconocida: 'El archivo trae una columna que no es de la plantilla.',
  falta_obligatoria: 'Falta una columna obligatoria.',
  columna_repetida: 'Una columna está repetida en la cabecera.',
  celdas_de_mas_o_de_menos: 'Una fila trae más o menos celdas que la cabecera.',
  demasiadas_filas: 'El archivo trae más filas que el máximo: divídelo.',
  archivo_pesado: 'El archivo pesa más que el máximo: divídelo.',
  celda_invalida: 'Una celda pasa su tope o trae un carácter que no se admite.',
  rechazo_del_servidor: 'El servidor rechazó el archivo. Corrígelo y vuelve a elegirlo.',
  sesion_vencida: 'Tu sesión venció. Entra de nuevo: el archivo leído se conserva en esta pestaña y lo vuelves a validar antes de crear.',
  sin_permiso: 'Tu perfil no permite dar de alta dispositivos (lo hacen el operador técnico y los administradores). No se creó ninguno.',
  lote_en_curso: 'Hay otra alta por lote en curso en el servidor. Espera a que termine y reintenta; no se creó ninguno.',
  plan_cambio: 'Cambió algo desde que lo revisaste y no se creó ninguno. La revisión ya muestra lo de ahora; míralo y vuelve a crear.',
  demasiadas_peticiones: 'Hiciste demasiadas validaciones o creaciones en un minuto. Espera un momento y reintenta.',
  sin_respuesta: AVISO_SIN_RESPUESTA,
  sin_conexion: 'No hubo respuesta del servidor. Validar no crea nada: reintenta cuando vuelva la conexión.',
  nada_creado: 'No se creó ninguno: el servidor no logró hablar con el broker o con la base de datos. Reintenta en un momento.',
  lote_incierto: 'El servidor no pudo confirmar si se crearon. Revisa el inventario: los que aparezcan quedaron creados y necesitan rotar su credencial desde su ficha; si no aparecen, avisa al administrador del servidor.',
  llave_reutilizada: 'Esta creación se cruzó con una anterior de otro contenido y no se creó nada con ella. Vuelve a revisar y crea de nuevo.',
  otro: 'No se pudo completar. Reintenta en un momento.',
};
// Lo que ve la persona al volver de «Entrar» tras una sesión vencida: el archivo se conservó en la pestaña.
export const TEXTO_SESION_RETOMADA = 'Tu sesión había vencido. El archivo leído se conservó: valídalo de nuevo antes de crear.';
export interface ErrorExplicado { caso: CasoError; texto: string; accion: AccionLote; detalles: string[] }
const explicado = (caso: CasoError, texto = TEXTO_DE[caso], detalles: string[] = []): ErrorExplicado => ({ caso, texto, accion: ACCION_DE[caso], detalles });

// Las filas que cambiaron entre el plan que la persona vio y el nuevo, en palabras: «Fila 12: se creaba → ya existe».
const QUE_PASA: Readonly<Record<ResultadoFila, string>> = { valida: 'se crea', creada: 'creada', existe: 'ya existe', rechazada: 'no entra' };
export function describirCambios(visto: readonly FilaInforme[], nuevo: readonly FilaInforme[]): string[] {
  const antes = new Map(visto.map((f) => [f.n, f]));
  const cambios: string[] = [];
  for (const f of nuevo) {
    const a = antes.get(f.n);
    if (a === undefined) continue;
    const motivo = f.motivo === null ? '' : `: ${f.motivo}`;
    if (a.resultado !== f.resultado) {
      cambios.push(`Fila ${f.n} (${f.id_fisico}): ${QUE_PASA[a.resultado]} → ${QUE_PASA[f.resultado]}${f.resultado === 'valida' ? '' : motivo}`);
      continue;
    }
    const ia = a.interpretada ?? {};
    const ib = f.interpretada ?? {};
    const campos = [...new Set([...Object.keys(ia), ...Object.keys(ib)])].filter((k) => JSON.stringify(ia[k]) !== JSON.stringify(ib[k]));
    if (campos.length > 0) cambios.push(`Fila ${f.n} (${f.id_fisico}): sigue entrando, pero cambió ${campos.map((k) => `${k} ${valor(ia[k])} → ${valor(ib[k])}`).join(', ')}`);
  }
  return cambios;
}
const valor = (v: unknown): string => (v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));

// La traducción única. `intento`: en qué intento llegó la respuesta (1 si no hubo repeticiones); `visto`: el plan que la persona revisó.
export function explicarError(e: unknown, ctx: { operacion: 'validar' | 'crear'; intento?: number; visto?: readonly FilaInforme[] } = { operacion: 'crear' }): ErrorExplicado {
  const causa = e instanceof FalloDeCreacion ? e.causa : e;
  const intento = e instanceof FalloDeCreacion ? e.intento : (ctx.intento ?? 1);
  if (!(causa instanceof ErrorApi)) return explicado('otro');
  const codigo = typeof causa.cuerpo.codigo === 'string' ? causa.cuerpo.codigo : null;
  const motivos = causa.motivos.slice(0, 5);
  if (causa.codigo === 401) return explicado('sesion_vencida');
  if (causa.codigo === 403) return explicado('sin_permiso');
  // En un intento posterior al primero, un 409 no prueba que no se creó nada: la petición original pudo crear y perder su respuesta.
  if (causa.codigo === 409 && ctx.operacion === 'crear' && intento > 1) return explicado('sin_respuesta');
  if (codigo === 'lote_en_curso') return explicado('lote_en_curso');
  if (codigo === 'plan_cambio') {
    const plan = causa.cuerpo.plan as { filas?: FilaInforme[] } | undefined;
    const cambios = describirCambios(ctx.visto ?? [], plan?.filas ?? []);
    return explicado('plan_cambio', TEXTO_DE.plan_cambio, cambios.length > 0 ? cambios : ['No se pudo decir qué fila cambió: revisa el informe completo.']);
  }
  if (codigo === 'llave_reutilizada') return explicado('llave_reutilizada');
  if (causa.codigo === 429) {
    const s = causa.reintentarEnS;
    return explicado('demasiadas_peticiones', s === null ? TEXTO_DE.demasiadas_peticiones : `Hiciste demasiadas validaciones o creaciones en un minuto. Espera ${s} s y reintenta.`);
  }
  if (codigo === 'lote_incierto') return explicado('lote_incierto');
  if (codigo === 'nada_creado') return explicado('nada_creado');
  if (causa.codigo === 413) return explicado(codigo === 'demasiadas_filas' ? 'demasiadas_filas' : 'archivo_pesado', `${motivos[0] ?? 'El archivo es demasiado grande'}.`);
  if (causa.codigo === 400) return explicado('rechazo_del_servidor', TEXTO_DE.rechazo_del_servidor, motivos);
  if (hayQueRepetir(causa)) return explicado(ctx.operacion === 'crear' ? 'sin_respuesta' : 'sin_conexion');
  return explicado('otro', TEXTO_DE.otro, motivos);
}

// Lo que se conserva de la pantalla en la memoria de la pestaña mientras la persona vuelve a entrar (la sesión venció: la aplicación muestra
// «Entrar» y, al volver, el alta masiva retoma el archivo leído). Nunca las credenciales: esas se olvidan al perder la sesión.
export const borradorLote: { archivo: string | null; filas: FilaLote[]; aviso: ErrorExplicado | null } = { archivo: null, filas: [], aviso: null };
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
