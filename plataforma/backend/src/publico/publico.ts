// Vista pública por enlace (RF-62, HU-32; diseño en docs/19 §4, O; docs/20 §7; docs/11 §4). Aquí, lo puro y probado sin base: los topes y
// los parámetros del despliegue, el token, la validación de lo que llega, la renovación, el estado de un enlace y la regla que protege a
// cada equipo (k dispositivos), aplicada al armar cada respuesta. Las consultas viven en vista-publica.service.ts y enlaces.service.ts.
import { BadRequestException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { generarIdentificador, hashIdentificador } from '../sesion/cookie.js';
import { HISTORICO_SITIO } from '../consulta/tablero.js';
import { INVISIBLE, esRelleno } from '../recepcion/texto.js';

// ── Listas cerradas y topes (docs/19 §4, O, puntos 1, 4 y 6) ─────────────────────────────────────────────────────────────────────
// La ventana que pide quien visita, de la lista cerrada (nunca fechas libres), hasta la máxima del enlace; en horas.
export const VENTANAS_PUBLICAS = ['24h', '7d', '30d'] as const;
export type VentanaPublica = (typeof VENTANAS_PUBLICAS)[number];
export const HORAS_VENTANA: Readonly<Record<VentanaPublica, number>> = { '24h': 24, '7d': 168, '30d': 720 };
// Plazos al crear o renovar: una actividad, un mes, un trimestre, un semestre; 30 por omisión.
export const PLAZOS_DIAS = [7, 30, 90, 180] as const;
export const PLAZO_POR_OMISION = 30;
// Se renueva un enlace vigente o uno vencido hace 30 días o menos, y nunca uno de más de un año: pasado eso, se crea otro.
export const RENOVAR_VENCIDO_HASTA_DIAS = 30;
export const RENOVAR_HASTA_EDAD_DIAS = 365;
// «Vence pronto» en la lista (decidido al implementar, 17/11/2026: el diseño nombra el estado sin fijar el plazo): siete días o menos.
export const VENCE_PRONTO_DIAS = 7;
export const MAX_TITULO = 80;
export const MAX_DESCRIPCION = 300;
// Topes de lo que se publica (decidido al implementar, 17/11/2026; los mismos CHECK de la migración 25): el catálogo tiene doce magnitudes
// y la medición del punto 13 usa seis y cinco zonas; veinte zonas dejan holgura sin que una sola vista se vuelva una consulta enorme.
export const MAX_MAGNITUDES = 12;
export const MAX_ZONAS = 20;
// Cuánto se conserva el texto de un enlace que dejó de valer (decidido el 17/11/2026): lo elige quien publica; 31 días como mínimo (más que
// los 30 en que todavía se puede renovar) y 365 como máximo. Después, fn_anonimizar_enlaces_publicos (migración 25).
export const RETENCION_TEXTO = { porDefecto: 90, minimo: 31, maximo: 365 } as const;
// Filas del contador de más de 90 días se borran (punto 8; fn_limpiar_accesos_publicos, desde RetencionService).
export const DIAS_CONTADOR = 90;
// La respuesta guardada y el cupo propio (punto 7). 60 s: el período más corto con que reporta un equipo del campus. El tiempo máximo de la
// consulta es el de las tendencias del tablero (HISTORICO_SITIO, la pestaña Tendencias), como pide el diseño. Una sola consulta pública a
// la vez en el proceso (las demás esperan en fila; con la fila llena, 503): el grupo tiene cinco conexiones y ya las comparten la recepción,
// las tendencias (2) y el histórico del sitio (2). Provisorio: el punto 13 pide fijar el cupo con la medición de 120 y 2 000 dispositivos.
export const PUBLICO = {
  guardadaMs: 60_000,
  maxGuardadas: 300,
  maxBytesGuardados: 8 * 1024 * 1024,
  tiempoMaximoMs: HISTORICO_SITIO.tiempoMaximoMs,
  maxEnCurso: 1,
  maxEnEspera: 20,
  // La vista previa del administrador tiene su propio cupo (decidido el 17/11/2026): mucha visita no le quita la vista previa a quien publica.
  previaEnCurso: 1,
  previaEnEspera: 5,
  volcadoMs: 60_000,
  maxClavesContador: 10_000,
} as const;

// La cabecera que trae el token. Solo la lee el controlador de GET /publico (docs/20 §5): la guardia central no la mira.
export const CABECERA_ENLACE = 'x-enlace-publico';
// La misma respuesta para un token inexistente, vencido, revocado o con forma inválida (punto 6): un solo texto, a propósito.
export const NO_DISPONIBLE = 'enlace no disponible';

// ── Parámetros del despliegue (punto 2 y 4; docs/11 §7) ─────────────────────────────────────────────────────────────────────────────
// Ausente → valor por defecto. Presente e inválido (vacío, texto, decimal, fuera de rango) → el arranque se detiene: nunca un valor que el
// operador no pidió (lección del 23/09/2026 con HTTP_INTERFAZ vacía). Cuando exista la pantalla de límites (P12), pasarán a ella.
export interface LimitesPublico {
  kPorOmision: number; // PUBLICO_MINIMO_DISPOSITIVOS (3): el k de un sitio que no lo fijó
  kPiso: number; // PUBLICO_MINIMO_DISPOSITIVOS_PISO (1): lo más bajo que puede fijar el administrador de un sitio
  vencimientoMaxDias: number; // PUBLICO_VENCIMIENTO_MAX_DIAS (180)
  maxEnlacesPorSitio: number; // PUBLICO_MAX_ENLACES_POR_SITIO (50): el tope de un sitio cuyo administrador no fijó otro
  maxEnlacesTecho: number; // PUBLICO_MAX_ENLACES_TECHO (200): lo más alto que puede fijar un administrador de sitio
}
// k puede SUBIR por encima del valor por omisión hasta este tope (decidido el 17/11/2026: subir nunca expone); el mismo CHECK de la base.
export const K_MAXIMO = 20;
function entero(valor: string | undefined, nombre: string, minimo: number, maximo: number, porDefecto: number): number {
  if (valor === undefined) return porDefecto;
  const v = valor.trim();
  const n = Number(v);
  if (!/^\d+$/.test(v) || n < minimo || n > maximo) {
    throw new Error(`${nombre}="${valor.slice(0, 20)}" no es válido: se espera un entero entre ${minimo} y ${maximo} (por defecto ${porDefecto})`);
  }
  return n;
}
export function limitesPublico(leer: (nombre: string) => string | undefined): LimitesPublico {
  const kPorOmision = entero(leer('PUBLICO_MINIMO_DISPOSITIVOS'), 'PUBLICO_MINIMO_DISPOSITIVOS', 1, K_MAXIMO, 3);
  const kPiso = entero(leer('PUBLICO_MINIMO_DISPOSITIVOS_PISO'), 'PUBLICO_MINIMO_DISPOSITIVOS_PISO', 1, K_MAXIMO, 1);
  if (kPiso > kPorOmision) {
    throw new Error(`PUBLICO_MINIMO_DISPOSITIVOS_PISO (${kPiso}) no puede ser mayor que PUBLICO_MINIMO_DISPOSITIVOS (${kPorOmision})`);
  }
  // El máximo de la lista de plazos es 180: un valor mayor no daría nada más; menos de 7 dejaría sin ningún plazo que elegir.
  const vencimientoMaxDias = entero(leer('PUBLICO_VENCIMIENTO_MAX_DIAS'), 'PUBLICO_VENCIMIENTO_MAX_DIAS', 7, 180, 180);
  // El tope de enlaces vivos por sitio lo fija el administrador del sitio (decidido el 17/11/2026) dentro del techo del despliegue; sin
  // fijarlo, rige el valor por omisión. Mil como techo del techo: la respuesta guardada sigue acotada igual (300 entradas y 8 MiB, no por enlace).
  const maxEnlacesTecho = entero(leer('PUBLICO_MAX_ENLACES_TECHO'), 'PUBLICO_MAX_ENLACES_TECHO', 1, 1000, 200);
  const maxEnlacesPorSitio = entero(leer('PUBLICO_MAX_ENLACES_POR_SITIO'), 'PUBLICO_MAX_ENLACES_POR_SITIO', 1, 1000, 50);
  if (maxEnlacesPorSitio > maxEnlacesTecho) {
    throw new Error(`PUBLICO_MAX_ENLACES_POR_SITIO (${maxEnlacesPorSitio}) no puede ser mayor que PUBLICO_MAX_ENLACES_TECHO (${maxEnlacesTecho})`);
  }
  return { kPorOmision, kPiso, vencimientoMaxDias, maxEnlacesPorSitio, maxEnlacesTecho };
}
export function plazosPermitidos(l: LimitesPublico): number[] {
  return PLAZOS_DIAS.filter((p) => p <= l.vencimientoMaxDias);
}
// El k que rige al servir es DEL SITIO (decidido el 17/11/2026, tras la tercera revisión): el que fijó su administrador o, sin fijar, el
// valor por omisión del despliegue; nunca menos que el piso vigente (si el operador lo subió después, manda el piso: falla cerrado).
export function kSitio(fijado: number | null | undefined, l: LimitesPublico): number {
  return Math.max(fijado ?? l.kPorOmision, l.kPiso);
}
// El k de omisión rige en todo sitio que no fijó el suyo: bajarlo de K_RECOMENDADO baja el de esos sitios sin un evento en su actividad.
// Es decisión del operador (docs/19 §4, O, punto 2), y al arrancar queda dicha en el registro (revisión final del 17/11/2026).
export const K_RECOMENDADO = 3;
export function avisoKOmision(kPorOmision: number): string | null {
  return kPorOmision < K_RECOMENDADO
    ? `PUBLICO_MINIMO_DISPOSITIVOS=${kPorOmision}, menos que ${K_RECOMENDADO}: rige en todos los sitios que no fijaron su k, y ese cambio no queda en su actividad (responsabilidad del operador; docs/19 §4, O)`
    : null;
}
// El k del sitio (PUT /sitios/{id}/enlaces/minimo): entero del piso del despliegue a 20.
export function validarMinimo(cuerpo: unknown, l: LimitesPublico): number {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new BadRequestException(['el cuerpo debe ser un objeto JSON']);
  const c = cuerpo as Record<string, unknown>;
  const motivos = Object.keys(c).filter((k) => k !== 'minimo_dispositivos').map((k) => `campo no admitido: ${k}`);
  const k = c.minimo_dispositivos;
  if (typeof k !== 'number' || !Number.isInteger(k) || k < l.kPiso || k > K_MAXIMO) {
    motivos.push(`minimo_dispositivos debe ser un entero entre ${l.kPiso} y ${K_MAXIMO} (con 1, el promedio es la lectura de ese equipo)`);
  }
  if (motivos.length > 0) throw new BadRequestException(motivos);
  return k as number;
}

// ── El token (punto 4; como el de la sesión, docs/20 §3) ───────────────────────────────────────────────────────────────────────────
export const FORMA_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const generarToken = generarIdentificador;
export const hashToken = hashIdentificador;
// El token de la cabecera, o null si no viene, viene repetida o no tiene la forma (sin consultar la base con basura).
export function leerToken(cabecera: string | string[] | undefined): string | null {
  if (typeof cabecera !== 'string') return null;
  const t = cabecera.trim();
  return FORMA_TOKEN.test(t) ? t : null;
}
// La fila se busca por el resumen (índice único) y además se compara en tiempo constante: defensa en profundidad, no depende de cómo la
// base compare texto.
export function mismoResumen(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}
// La dirección que se comparte (punto 5): el token va en el fragmento, que el navegador no envía al servidor.
export function direccionDelEnlace(token: string): string {
  return `/panel/#/v/${token}`;
}

// ── Lo que llega: crear y vista previa (puntos 1 a 4 y 11) ────────────────────────────────────────────────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODIGO_MAGNITUD = /^[a-z0-9_]{1,40}$/;
// El texto público usa la regla de la recepción (recepcion/texto.ts; tercera revisión del 17/11/2026): nada invisible ni de control
// (\p{C}), ningún separador salvo el espacio común (\p{Z}) ni los rellenos que se ven en blanco; la descripción admite además el salto de
// línea. Y ninguno admite más de tres marcas combinantes seguidas (una «letra» con decenas de acentos encima tapa el texto de al lado).
const MARCAS_SEGUIDAS = /\p{M}{4,}/u;
function textoNoPermitido(s: string, admiteSalto: boolean): boolean {
  return Array.from(s).some((c) => c !== ' ' && !(admiteSalto && c === '\n') && (INVISIBLE.test(c) || esRelleno(c.codePointAt(0) ?? 0))) || MARCAS_SEGUIDAS.test(s);
}
const CON_LETRA_O_NUMERO = /[\p{L}\p{N}]/u;
export const SIN_MAGNITUDES = 'Elige al menos una magnitud para publicar.';

export interface VistaValidada {
  titulo: string;
  descripcion: string | null;
  magnitudes: string[];
  ventana_maxima: VentanaPublica;
  zonas: string[]; // ids; vacío = sin desglose
  plazo_dias: number;
  retencion_dias: number;
  ventana: VentanaPublica; // solo en la vista previa: qué ventana dibujar
}
// `previa`: la vista previa acepta el mismo formulario sin título (aún se está escribiendo) y con `ventana`.
export function validarVista(cuerpo: unknown, l: LimitesPublico, previa = false): VistaValidada {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new BadRequestException(['el cuerpo debe ser un objeto JSON']);
  const c = cuerpo as Record<string, unknown>;
  const motivos: string[] = [];
  const permitidas = new Set(['titulo', 'descripcion', 'magnitudes', 'ventana_maxima', 'zonas', 'plazo_dias', 'retencion_dias', ...(previa ? ['ventana'] : [])]);
  for (const k of Object.keys(c)) if (!permitidas.has(k)) motivos.push(`campo no admitido: ${k}`);

  let titulo = '';
  if (c.titulo === undefined && previa) titulo = '';
  else if (typeof c.titulo !== 'string') motivos.push('titulo debe ser texto');
  else {
    titulo = c.titulo.trim();
    if ((!previa && titulo.length < 1) || titulo.length > MAX_TITULO) motivos.push(`titulo debe tener entre 1 y ${MAX_TITULO} caracteres`);
    if (textoNoPermitido(titulo, false)) motivos.push('titulo no admite saltos de línea, caracteres invisibles, de control o de dirección del texto, ni marcas apiladas');
    else if (titulo.length > 0 && !CON_LETRA_O_NUMERO.test(titulo)) motivos.push('titulo debe tener al menos una letra o un número');
  }
  let descripcion: string | null = null;
  if (c.descripcion !== undefined && c.descripcion !== null) {
    if (typeof c.descripcion !== 'string') motivos.push('descripcion debe ser texto');
    else {
      const d = c.descripcion.trim();
      if (d.length > MAX_DESCRIPCION) motivos.push(`descripcion admite hasta ${MAX_DESCRIPCION} caracteres`);
      if (textoNoPermitido(d, true)) motivos.push('descripcion no admite caracteres invisibles, de control o de dirección del texto, ni marcas apiladas (sí saltos de línea)');
      descripcion = d === '' ? null : d;
    }
  }

  let magnitudes: string[] = [];
  if (c.magnitudes === undefined || (Array.isArray(c.magnitudes) && c.magnitudes.length === 0)) motivos.push(SIN_MAGNITUDES);
  else if (!Array.isArray(c.magnitudes) || c.magnitudes.some((m) => typeof m !== 'string' || !CODIGO_MAGNITUD.test(m))) {
    motivos.push('magnitudes: una lista de códigos del catálogo (temperatura, humedad, …)');
  } else {
    magnitudes = c.magnitudes as string[];
    if (new Set(magnitudes).size !== magnitudes.length) motivos.push('magnitudes: hay códigos repetidos');
    if (magnitudes.length > MAX_MAGNITUDES) motivos.push(`magnitudes: hasta ${MAX_MAGNITUDES}`);
  }

  let ventana_maxima: VentanaPublica = '24h';
  if (typeof c.ventana_maxima === 'string' && (VENTANAS_PUBLICAS as readonly string[]).includes(c.ventana_maxima)) ventana_maxima = c.ventana_maxima as VentanaPublica;
  else if (!(previa && c.ventana_maxima === undefined)) motivos.push(`ventana_maxima debe ser una de: ${VENTANAS_PUBLICAS.join(', ')}`);
  else ventana_maxima = '30d';

  let zonas: string[] = [];
  if (c.zonas !== undefined && c.zonas !== null) {
    if (!Array.isArray(c.zonas) || c.zonas.some((z) => typeof z !== 'string' || !UUID.test(z))) motivos.push('zonas: una lista de UUID de zonas del sitio (vacía = sin desglose)');
    else {
      zonas = (c.zonas as string[]).map((z) => z.toLowerCase());
      if (new Set(zonas).size !== zonas.length) motivos.push('zonas: hay zonas repetidas');
      if (zonas.length > MAX_ZONAS) motivos.push(`zonas: hasta ${MAX_ZONAS}`);
    }
  }


  const plazos = plazosPermitidos(l);
  let plazo_dias = plazos.includes(PLAZO_POR_OMISION) ? PLAZO_POR_OMISION : Math.max(...plazos);
  if (c.plazo_dias !== undefined) {
    if (typeof c.plazo_dias !== 'number' || !plazos.includes(c.plazo_dias)) motivos.push(`plazo_dias debe ser uno de: ${plazos.join(', ')}`);
    else plazo_dias = c.plazo_dias;
  }

  let retencion_dias: number = RETENCION_TEXTO.porDefecto;
  if (c.retencion_dias !== undefined) {
    const r = c.retencion_dias;
    if (typeof r !== 'number' || !Number.isInteger(r) || r < RETENCION_TEXTO.minimo || r > RETENCION_TEXTO.maximo) {
      motivos.push(`retencion_dias debe ser un entero entre ${RETENCION_TEXTO.minimo} y ${RETENCION_TEXTO.maximo} (por omisión ${RETENCION_TEXTO.porDefecto})`);
    } else retencion_dias = r;
  }

  let ventana: VentanaPublica = '24h';
  if (previa && c.ventana !== undefined) {
    if (typeof c.ventana !== 'string' || !(VENTANAS_PUBLICAS as readonly string[]).includes(c.ventana)) motivos.push(`ventana debe ser una de: ${VENTANAS_PUBLICAS.join(', ')}`);
    else ventana = c.ventana as VentanaPublica;
  }
  if (motivos.length === 0 && HORAS_VENTANA[ventana] > HORAS_VENTANA[ventana_maxima]) motivos.push(`ventana no puede pasar la máxima (${ventana_maxima})`);
  if (motivos.length > 0) throw new BadRequestException(motivos);
  return { titulo, descripcion, magnitudes, ventana_maxima, zonas, plazo_dias, retencion_dias, ventana };
}

// La ventana que pide quien visita (`?ventana=`): ausente, 24 h; de la lista y hasta la máxima del enlace; si no, 400.
export function ventanaPedida(valor: unknown, maxima: VentanaPublica): VentanaPublica {
  if (valor === undefined) return '24h';
  const permitidas = VENTANAS_PUBLICAS.filter((v) => HORAS_VENTANA[v] <= HORAS_VENTANA[maxima]);
  if (typeof valor !== 'string' || !(permitidas as readonly string[]).includes(valor)) {
    throw new BadRequestException(`ventana debe ser una de: ${permitidas.join(', ')}`);
  }
  return valor as VentanaPublica;
}
export function ventanasDe(maxima: VentanaPublica): VentanaPublica[] {
  return VENTANAS_PUBLICAS.filter((v) => HORAS_VENTANA[v] <= HORAS_VENTANA[maxima]);
}

// ── Renovar (punto 4 y 11) ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface RenovacionValidada { plazo_dias: number; acortar: boolean }
export function validarRenovacion(cuerpo: unknown, l: LimitesPublico): RenovacionValidada {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new BadRequestException(['el cuerpo debe ser un objeto JSON']);
  const c = cuerpo as Record<string, unknown>;
  const motivos: string[] = [];
  for (const k of Object.keys(c)) if (!['plazo_dias', 'acortar'].includes(k)) motivos.push(`campo no admitido: ${k}`);
  const plazos = plazosPermitidos(l);
  if (typeof c.plazo_dias !== 'number' || !plazos.includes(c.plazo_dias)) motivos.push(`plazo_dias debe ser uno de: ${plazos.join(', ')}`);
  if (c.acortar !== undefined && typeof c.acortar !== 'boolean') motivos.push('acortar debe ser true o false');
  if (motivos.length > 0) throw new BadRequestException(motivos);
  return { plazo_dias: c.plazo_dias as number, acortar: c.acortar === true };
}
const DIA_MS = 86_400_000;
export interface FilaVigencia { creado_en: string; expira_en: string; revocado_en: string | null }
// ¿Se puede renovar? Vigente o vencido hace 30 días o menos, no revocado y con menos de un año desde su creación.
export function renovable(f: FilaVigencia, ahora: Date): boolean {
  if (f.revocado_en !== null) return false;
  const t = ahora.getTime();
  return t - Date.parse(f.expira_en) <= RENOVAR_VENCIDO_HASTA_DIAS * DIA_MS && t - Date.parse(f.creado_en) <= RENOVAR_HASTA_EDAD_DIAS * DIA_MS;
}
// El vencimiento nuevo (hoy más el plazo, desde el reloj de la base) y si acorta el que había.
export function nuevoVencimiento(f: FilaVigencia, ahora: Date, plazoDias: number): { expira_en: Date; acorta: boolean } {
  const expira = new Date(ahora.getTime() + plazoDias * DIA_MS);
  return { expira_en: expira, acorta: expira.getTime() < Date.parse(f.expira_en) };
}
export const NO_RENOVABLE = 'Este enlace ya no se puede renovar. Crea uno nuevo.';
// Un enlace está VIVO si no se revocó y sigue vigente o aún se puede renovar (decidido el 17/11/2026): solo los vivos cuentan para el tope
// del sitio y salen en la lista por omisión. Uno muerto no vuelve: su fila queda (la actividad lo nombra) y su texto se anonimiza a su plazo.
export function vivo(f: FilaVigencia, ahora: Date): boolean {
  return f.revocado_en === null && (Date.parse(f.expira_en) > ahora.getTime() || renovable(f, ahora));
}
// La misma regla en SQL, sobre `enlace_publico e` (expresiones fijas del código).
export const SQL_ENLACE_VIVO = `(e.revocado_en IS NULL AND (e.expira_en > now()
        OR (e.expira_en > now() - INTERVAL '${RENOVAR_VENCIDO_HASTA_DIAS} days' AND e.creado_en > now() - INTERVAL '${RENOVAR_HASTA_EDAD_DIAS} days')))`;
// El tope de enlaces de un sitio (PUT /sitios/{id}/enlaces/tope): entero de 1 al techo del despliegue.
export function validarTope(cuerpo: unknown, l: LimitesPublico): number {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new BadRequestException(['el cuerpo debe ser un objeto JSON']);
  const c = cuerpo as Record<string, unknown>;
  const motivos = Object.keys(c).filter((k) => k !== 'max_enlaces').map((k) => `campo no admitido: ${k}`);
  const n = c.max_enlaces;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > l.maxEnlacesTecho) motivos.push(`max_enlaces debe ser un entero entre 1 y ${l.maxEnlacesTecho} (el techo de esta instancia)`);
  if (motivos.length > 0) throw new BadRequestException(motivos);
  return n as number;
}

// ── Estado en la lista (punto 10) ──────────────────────────────────────────────────────────────────────────────────────────────────
export type EstadoEnlace = 'vigente' | 'vence_pronto' | 'vencido' | 'revocado';
export function estadoEnlace(f: FilaVigencia, ahora: Date): EstadoEnlace {
  if (f.revocado_en !== null) return 'revocado';
  const resta = Date.parse(f.expira_en) - ahora.getTime();
  if (resta <= 0) return 'vencido';
  return resta <= VENCE_PRONTO_DIAS * DIA_MS ? 'vence_pronto' : 'vigente';
}

// ── El día del contador, en la zona horaria del sitio (punto 8) ────────────────────────────────────────────────────────────────────
export function diaEnZona(instante: Date, zona: string): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instante);
  const p = (t: string): string => partes.find((x) => x.type === t)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')}`;
}

// ── La regla de k y el armado de los datos (puntos 1, 2 y 6) ───────────────────────────────────────────────────────────────────────
// Filas de la base: por magnitud, el total del sitio (zona_id nulo) y cada zona publicada; `n` es cuántos dispositivos aportan. `n` NUNCA
// sale de aquí: la vista dice «promedio de k o más dispositivos».
export interface FilaSeriePublica { magnitud: string; zona_id: string | null; t: number; v: number; n: number }
export interface FilaAhoraPublica { magnitud: string; zona_id: string | null; v: number; n: number; ultimo: string | null }
export interface MagnitudCatalogo { codigo: string; nombre: string; unidad: string }
export interface ZonaPublicada { id: string; nombre: string }

// Lo que viaja: un número o null por valor. Lo oculto y lo que no tiene datos se ven IGUAL (null), tramo a tramo (docs/19 §4, O, punto 2;
// revisión del 17/11/2026): si se distinguieran, cada hueco «oculto» diría cuándo reportó un equipo solo. `protegido` (uno por magnitud)
// dice que algún valor de la magnitud se ocultó, sin decir cuál.
export interface ZonaDeVista { nombre: string; ahora: number | null; serie: (number | null)[] }
export interface MagnitudDeVista extends MagnitudCatalogo { ahora: number | null; serie: (number | null)[]; protegido: boolean; zonas: ZonaDeVista[] }
export interface DatosPublicos { tiempos: number[]; magnitudes: MagnitudDeVista[]; ultimo_dato: string | null }

// Un valor con n aportes, antes de decidir: se publica si n ≥ k; 0 < n < k es «oculto»; sin aportes, vacío.
interface Valor { v: number | null; oculto: boolean }
function valorConK(v: number | undefined, n: number | undefined, k: number): Valor {
  if (v === undefined || n === undefined || n <= 0) return { v: null, oculto: false };
  return n >= k ? { v, oculto: false } : { v: null, oculto: true };
}
// La regla de la resta (punto 2): con el k DEL SITIO, una zona con entre 1 y k−1 equipos se oculta en todo enlace, y el total se publica solo
// si los equipos de esas zonas —todas las del sitio, publicadas o no— suman 0 o al menos k. Así cualquier combinación de lo publicado, en uno
// o en varios enlaces, son grupos de k o más equipos (zonas grandes enteras o la unión de las chicas). Con un k por enlace (lo de antes, aun
// con el menor k del sitio) combinar enlaces de magnitudes o ventanas distintas seguía despejando promedios de menos de k.
export function totalPublicable(nPorZona: readonly number[], k: number): boolean {
  const ocultos = nPorZona.filter((n) => n > 0 && n < k).reduce((a, b) => a + b, 0);
  return ocultos === 0 || ocultos >= k;
}

// Arma los datos de la vista: la MISMA función para GET /publico y para la vista previa (punto 3). Reglas:
//  · la base trae el total del sitio (zona_id nulo) y TODAS las zonas del sitio, publicadas o no, con su `n`: las no publicadas solo
//    entran a la regla de la resta y nunca a la respuesta; `n` tampoco sale de aquí;
//  · cada tramo de cada serie (del sitio y de cada zona publicada) y cada valor de «ahora», con valorConK; el total, además, con
//    totalPublicable sobre los `n` de todas las zonas de ese tramo (o de «ahora»);
//  · un tramo entra a `tiempos` solo si publica algún valor: un tramo con solo valores ocultos no delata que alguien reportó;
//  · solo las magnitudes y las zonas publicadas, en el orden publicado y con el nombre publicado;
//  · cada valor se copia campo a campo: ninguna columna de más que traiga la base llega a la respuesta;
//  · `ultimo_dato`: el inicio del tramo de la lectura más reciente entre los «ahora» del sitio que se publican (los ocultos no cuentan;
//    la base ya lo trae redondeado, SQL_PUBLICO_AHORA).
export function armarDatos(e: {
  magnitudes: readonly MagnitudCatalogo[]; zonas: readonly ZonaPublicada[]; k: number;
  series: readonly FilaSeriePublica[]; ahora: readonly FilaAhoraPublica[];
}): DatosPublicos {
  const publicadas = new Set(e.magnitudes.map((m) => m.codigo));
  const clave = (m: string, z: string | null): string => `${m}|${z ?? ''}`;
  const porSerie = new Map<string, Map<number, { v: number; n: number }>>();
  const nZonas = new Map<string, number[]>(); // magnitud|t → n de cada zona del sitio en ese tramo
  for (const f of e.series) {
    if (!publicadas.has(f.magnitud)) continue;
    const t = Number(f.t);
    const s = porSerie.get(clave(f.magnitud, f.zona_id)) ?? new Map<number, { v: number; n: number }>();
    s.set(t, { v: Number(f.v), n: Number(f.n) });
    porSerie.set(clave(f.magnitud, f.zona_id), s);
    if (f.zona_id !== null) nZonas.set(`${f.magnitud}|${t}`, [...(nZonas.get(`${f.magnitud}|${t}`) ?? []), Number(f.n)]);
  }
  const porAhora = new Map(e.ahora.filter((f) => publicadas.has(f.magnitud)).map((f) => [clave(f.magnitud, f.zona_id), f]));
  const candidatos = [...new Set(e.series.filter((f) => publicadas.has(f.magnitud)).map((f) => Number(f.t)))].sort((a, b) => a - b);

  const decidir = (m: string): { sitio: Valor[]; zonas: Valor[][]; ahora: Valor; zonasAhora: Valor[] } => {
    const sitioS = porSerie.get(clave(m, null));
    const sitio = candidatos.map((t) => {
      const p = sitioS?.get(t);
      const x = valorConK(p?.v, p?.n, e.k);
      return x.v !== null && !totalPublicable(nZonas.get(`${m}|${t}`) ?? [], e.k) ? { v: null, oculto: true } : x;
    });
    const zonas = e.zonas.map((z) => { const s = porSerie.get(clave(m, z.id)); return candidatos.map((t) => { const p = s?.get(t); return valorConK(p?.v, p?.n, e.k); }); });
    const a = porAhora.get(clave(m, null));
    let ahora = valorConK(a === undefined ? undefined : Number(a.v), a === undefined ? undefined : Number(a.n), e.k);
    const nAhora = e.ahora.filter((f) => f.magnitud === m && f.zona_id !== null).map((f) => Number(f.n));
    if (ahora.v !== null && !totalPublicable(nAhora, e.k)) ahora = { v: null, oculto: true };
    const zonasAhora = e.zonas.map((z) => { const f = porAhora.get(clave(m, z.id)); return valorConK(f === undefined ? undefined : Number(f.v), f === undefined ? undefined : Number(f.n), e.k); });
    return { sitio, zonas, ahora, zonasAhora };
  };
  const decisiones = new Map(e.magnitudes.map((m) => [m.codigo, decidir(m.codigo)]));
  // Los tramos que publican algo, en alguna magnitud: el eje común.
  const conValor = candidatos.map((_, i) => [...decisiones.values()].some((d) => d.sitio[i].v !== null || d.zonas.some((z) => z[i].v !== null)));
  const tiempos = candidatos.filter((_, i) => conValor[i]);
  const recortar = (xs: Valor[]): (number | null)[] => xs.filter((_, i) => conValor[i]).map((x) => x.v);

  let ultimo: string | null = null;
  const magnitudes = e.magnitudes.map((m): MagnitudDeVista => {
    const d = decisiones.get(m.codigo) as ReturnType<typeof decidir>;
    // Solo de la configuración (segunda revisión del 17/11/2026): si dependiera de lo oculto en la ventana, su cambio delataría cuándo
    // reporta un grupo chico.
    const protegido = e.k > 1;
    const fila = porAhora.get(clave(m.codigo, null));
    if (d.ahora.v !== null && fila?.ultimo && (ultimo === null || Date.parse(fila.ultimo) > Date.parse(ultimo))) ultimo = fila.ultimo;
    return {
      codigo: m.codigo, nombre: m.nombre, unidad: m.unidad, ahora: d.ahora.v, serie: recortar(d.sitio), protegido,
      zonas: e.zonas.map((z, i) => ({ nombre: z.nombre, ahora: d.zonasAhora[i].v, serie: recortar(d.zonas[i]) })),
    };
  });
  return { tiempos, magnitudes, ultimo_dato: ultimo };
}

// ── Lo que un visitante podría deducir: avisos para quien publica (decidido el 17/11/2026) ───────────────────────────────────────
// La protección por omisión es de la plataforma (k, la regla de la resta); bajarla o publicar algo deducible es decisión del administrador
// del sitio, que la toma sabiendo: la vista previa y la respuesta de crear traen estos avisos, y el evento enlace_creado registra el k.
// `equipos`: los dispositivos de cada zona del sitio (publicada o no) con una lectura vigente de alguna magnitud publicada desde que están en
// su zona: los mismos que cuenta «ahora» en la vista (segunda revisión del 17/11/2026). Es un aviso con los equipos de hoy; la regla se
// aplica tramo a tramo con los que aportan.
export interface ZonaDelSitio { id: string; nombre: string; equipos: number }
const equipos = (n: number): string => (n === 1 ? '1 equipo' : `${n} equipos`);
const avisoKBajo = (k: number, kPorOmision: number): string[] =>
  (k < kPorOmision ? [`El mínimo de este sitio es k = ${k} (${kPorOmision} por omisión): un promedio de tan pocos equipos se acerca a la lectura de cada uno.`] : []);
export function avisosDePublicacion(x: { zonas: readonly ZonaDelSitio[]; publicadas: readonly string[]; k: number; kPorOmision: number }): string[] {
  return [...avisoKBajo(x.k, x.kPorOmision), ...avisosDeZonas(x.zonas, x.publicadas, x.k)];
}
// Lo de cada zona y el total, para UNA magnitud: la regla de k se aplica por magnitud (cada una tiene su propia población).
function avisosDeZonas(zonasDelSitio: readonly ZonaDelSitio[], publicadasIds: readonly string[], k: number): string[] {
  const x = { zonas: zonasDelSitio, publicadas: publicadasIds, k };
  const avisos: string[] = [];
  const publicadas = x.zonas.filter((z) => x.publicadas.includes(z.id));
  const otras = x.zonas.filter((z) => !x.publicadas.includes(z.id) && z.equipos > 0);
  if (x.k === 1) {
    for (const z of publicadas.filter((z) => z.equipos === 1)) avisos.push(`La zona «${z.nombre}» tiene 1 equipo: con k = 1 su lectura sale tal cual.`);
    if (x.zonas.reduce((a, z) => a + z.equipos, 0) === 1) avisos.push('El sitio tiene 1 equipo: con k = 1 el total es su lectura tal cual.');
  }
  for (const z of publicadas.filter((z) => z.equipos > 0 && z.equipos < x.k)) {
    avisos.push(`La zona «${z.nombre}» tiene hoy ${equipos(z.equipos)}, menos que k = ${x.k}: saldrá sin valor mientras sea así.`);
  }
  const total = totalPublicable(x.zonas.map((z) => z.equipos), x.k);
  if (!total) avisos.push(`El total del sitio saldrá sin valor: hay zonas con menos de ${x.k} equipos que juntas suman menos de ${x.k}, y con el total se despejarían por resta.`);
  if (total && publicadas.length > 0 && otras.length > 0) {
    avisos.push(`Combinando el total del sitio con las zonas publicadas se puede deducir el promedio de las no publicadas (${otras.map((z) => `«${z.nombre}»`).join(', ')}).`);
  }
  return avisos;
}
// Al fijar el k del sitio: afecta a todos sus enlaces; y lo que un visitante podría deducir con ese k en todo el sitio (como si cada zona
// estuviera publicada en algún enlace).
export const AVISO_TODOS_LOS_ENLACES = 'Este mínimo afecta a todos los enlaces públicos de este sitio.';
export function avisosDeMinimo(x: { magnitudes: readonly ZonasDeMagnitud[]; k: number; anterior: number; kPorOmision: number }): string[] {
  const avisos = [AVISO_TODOS_LOS_ENLACES];
  if (x.k < x.anterior) avisos.push(`Bajaste el mínimo de ${x.anterior} a ${x.k}: lo que antes salía oculto puede salir publicado.`);
  const todas = [...new Set(x.magnitudes.flatMap((m) => m.zonas.map((z) => z.id)))];
  return [...avisos, ...avisosPorMagnitud({ magnitudes: x.magnitudes, publicadas: todas, k: x.k, kPorOmision: x.kPorOmision })];
}
// Los avisos de una vista con varias magnitudes (revisión final del 17/11/2026): la regla de k cuenta los equipos de CADA magnitud, así que
// los avisos también; con más de una magnitud con datos, cada aviso dice de cuál es. El de k bajo va una vez. Una magnitud sin equipos en
// el sitio no avisa nada (no hay qué deducir).
export interface ZonasDeMagnitud { magnitud: string; zonas: ZonaDelSitio[] }
export function avisosPorMagnitud(x: { magnitudes: readonly ZonasDeMagnitud[]; publicadas: readonly string[]; k: number; kPorOmision: number }): string[] {
  const conDatos = x.magnitudes.filter((m) => m.zonas.some((z) => z.equipos > 0));
  const deCada = conDatos.flatMap((m) => avisosDeZonas(m.zonas, x.publicadas, x.k).map((a) => (conDatos.length > 1 ? `${m.magnitud}: ${a}` : a)));
  return [...avisoKBajo(x.k, x.kPorOmision), ...new Set(deCada)];
}

// La respuesta completa: lo del enlace (leído en cada petición) más los datos (guardados hasta 60 s).
export interface VistaPublica {
  titulo: string; descripcion: string | null; sitio: string; zona_horaria: string; minimo_dispositivos: number;
  ventana: VentanaPublica; ventanas: VentanaPublica[]; intervalo: string; desde: string; hasta: string;
  ultimo_dato: string | null; tiempos: number[]; magnitudes: MagnitudDeVista[];
}
export interface DatosConVentana extends DatosPublicos { intervalo: string; desde: string; hasta: string }
export function armarVista(meta: { titulo: string; descripcion: string | null; sitio: string; zona_horaria: string; k: number; ventana: VentanaPublica; ventana_maxima: VentanaPublica }, d: DatosConVentana): VistaPublica {
  return {
    titulo: meta.titulo, descripcion: meta.descripcion, sitio: meta.sitio, zona_horaria: meta.zona_horaria, minimo_dispositivos: meta.k,
    ventana: meta.ventana, ventanas: ventanasDe(meta.ventana_maxima), intervalo: d.intervalo, desde: d.desde, hasta: d.hasta,
    ultimo_dato: d.ultimo_dato, tiempos: d.tiempos, magnitudes: d.magnitudes,
  };
}
