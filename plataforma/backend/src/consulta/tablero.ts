// Funciones puras del tablero v2 (docs/19 §4, bloque «Tablero v2», I; docs/10 §8.4 puntos 58 y 65): el estado visual de cuatro valores,
// la entrega (HU-15), el cursor opaco de las listas por clave y los filtros del inventario. Sin base ni Nest: cada una con su prueba.
import { BadRequestException } from '@nestjs/common';

// ── Estado visual (docs/19 §2; punto 65 ii) ────────────────────────────────────────────────────────────────────────────────────────
// La regla está escrita una vez en docs/19 §2 y tiene dos implementaciones probadas entre sí: esta (y su versión SQL de abajo, que
// filtra y pagina en el servidor) y estadoVisual() del panel, que recalcula en vivo sin repedir la página.
export const ESTADOS_VISUALES = ['inactivo', 'sin_senal', 'alerta', 'normal'] as const;
export type EstadoVisual = (typeof ESTADOS_VISUALES)[number];

// Los tipos de condición que ponen un dispositivo en «alerta» (docs/19 §2), enumerados como en el panel: un tipo nuevo no cae en alerta
// sin decidirlo (la regla y sus dos implementaciones se cambian juntas). `sin_comunicacion` es «sin señal», no alerta.
export const TIPOS_ALERTA = ['umbral', 'bateria', 'manipulacion', 'tope_superado', 'reloj_desviado'] as const;
export function estadoVisual(estado: string, enLinea: boolean | null, abiertas: readonly string[]): EstadoVisual {
  if (estado !== 'activo') return 'inactivo';
  if (abiertas.includes('sin_comunicacion') || enLinea === false) return 'sin_senal';
  if (abiertas.some((t) => (TIPOS_ALERTA as readonly string[]).includes(t))) return 'alerta';
  return 'normal';
}

// La misma regla en SQL, sobre `dispositivo d` y `estado_dispositivo e` (LEFT JOIN). `en_linea` nulo (sin tramas aún) no es «fuera de
// línea»: por eso `IS FALSE` y no `NOT`. Texto fijo del código, sin datos: se interpola en las consultas como SQL_INTERVALO_OBSERVADO.
export const SQL_EN_LINEA = `(e.visto_por_ultima_vez >= now() - d.intervalo_esperado_s * 2 * INTERVAL '1 second')`;
export const SQL_ESTADO_VISUAL = `(CASE
        WHEN d.estado <> 'activo' THEN 'inactivo'
        WHEN EXISTS (SELECT 1 FROM condicion cv WHERE cv.dispositivo_id = d.id AND cv.cerrada_en IS NULL AND cv.tipo = 'sin_comunicacion')
             OR ${SQL_EN_LINEA} IS FALSE THEN 'sin_senal'
        WHEN EXISTS (SELECT 1 FROM condicion cv WHERE cv.dispositivo_id = d.id AND cv.cerrada_en IS NULL
                       AND cv.tipo IN (${TIPOS_ALERTA.map((t) => `'${t}'`).join(', ')})) THEN 'alerta'
        ELSE 'normal' END)`;

// ── Entrega (HU-15; punto 65 vii) ────────────────────────────────────────────────────────────────────────────────────────────────
// Tramas recibidas en la ventana ÷ esperadas (ventana ÷ intervalo esperado), acotada a 100 %. La ventana efectiva empieza en lo más
// tardío entre `desde`, el alta del dispositivo y el horizonte de retención de `trama` (antes no hay con qué contar). Sin una trama
// esperada completa en esa ventana (recién creado, o una ventana entera fuera de la retención), no se calcula: nulo, nunca inventado.
export interface Entrega { recibidas: number; esperadas: number; porcentaje: number | null }
export function entrega(recibidas: number, desde: Date, hasta: Date, creadoEn: Date, intervaloS: number, retencionDesde: Date): Entrega {
  const inicio = Math.max(desde.getTime(), creadoEn.getTime(), retencionDesde.getTime());
  const ventanaS = Math.max(0, (hasta.getTime() - inicio) / 1000);
  const esperadas = intervaloS > 0 ? Math.floor(ventanaS / intervaloS) : 0;
  if (esperadas < 1) return { recibidas, esperadas: 0, porcentaje: null };
  return { recibidas, esperadas, porcentaje: Math.min(100, Math.round((1000 * recibidas) / esperadas) / 10) };
}

// ── Cursor opaco (punto 58) ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Las dos claves del orden (tiempo con microsegundos, como texto de la base, e id) en base64url. Opaco para el cliente, que lo devuelve tal
// cual; no se firma: el alcance por sitio sigue en el WHERE, así que uno manipulado solo puede pedir otra posición de lo que ya puede ver.
const FORMA_TIEMPO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface Cursor { t: string; id: string }
export function codificarCursor(t: string, id: string): string {
  return Buffer.from(JSON.stringify([t, id]), 'utf8').toString('base64url');
}
export function leerCursor(valor: unknown): Cursor | undefined {
  if (valor === undefined) return undefined;
  const invalido = new BadRequestException('cursor inválido: usa el de la cabecera X-Siguiente, tal cual');
  if (typeof valor !== 'string' || valor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(valor)) throw invalido;
  let par: unknown;
  try {
    par = JSON.parse(Buffer.from(valor, 'base64url').toString('utf8'));
  } catch {
    throw invalido;
  }
  if (!Array.isArray(par) || par.length !== 2) throw invalido;
  const [t, id] = par as unknown[];
  if (typeof t !== 'string' || typeof id !== 'string' || !FORMA_TIEMPO.test(t) || !FORMA_UUID.test(id) || Number.isNaN(Date.parse(t))) throw invalido;
  // Un día inexistente (2026-02-30) o el año 0000 pasaban la forma y la base respondía 22008 → 500; el punto 58 pide 400. Ida y vuelta
  // de la fecha, como fecha() (validacion.ts), y años desde 1900.
  const ymd = t.slice(0, 10);
  if (Number(t.slice(0, 4)) < 1900 || new Date(`${ymd}T12:00:00Z`).toISOString().slice(0, 10) !== ymd) throw invalido;
  return { t, id: id.toLowerCase() };
}
// Una página llena trae el cursor de la siguiente (la clave de su última fila); una incompleta, ninguno: no hay más.
export function siguiente<T>(filas: readonly T[], limite: number, clave: (f: T) => Cursor): string | null {
  const ultima = filas[filas.length - 1];
  return filas.length === limite && ultima !== undefined ? codificarCursor(clave(ultima).t, clave(ultima).id) : null;
}

// ── Filtros del inventario (docs/19 §4, C) ───────────────────────────────────────────────────────────────────────────────────────
export const VIAS_FILTRO = ['mqtt', 'http', 'lorawan'] as const;
// `orden`: por nombre (sitio, zona, nombre: el de siempre), por entrega de las últimas 24 h (de peor a mejor y sin cálculo al final) o por
// atención (docs/19 §2: sin señal, alerta, normal, inactivo; dentro de cada uno, por nombre).
export const ORDENES_INVENTARIO = ['nombre', 'entrega', 'atencion'] as const;
export interface FiltroInventario {
  sitio?: string; zona?: string; via?: string; estado?: EstadoVisual; q?: string; limite?: number; desplazamiento?: number;
  orden?: (typeof ORDENES_INVENTARIO)[number];
}
const UNA_VEZ = (v: unknown, nombre: string): string | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new BadRequestException(`${nombre} debe venir una sola vez y como texto`);
  return v;
};
export function filtroInventario(p: Record<string, unknown>): FiltroInventario {
  const f: FiltroInventario = {};
  for (const k of ['sitio', 'zona'] as const) {
    const v = UNA_VEZ(p[k], k);
    if (v !== undefined) {
      if (!FORMA_UUID.test(v)) throw new BadRequestException(`${k} no es un UUID válido`);
      f[k] = v.toLowerCase();
    }
  }
  const via = UNA_VEZ(p.via, 'via');
  if (via !== undefined) {
    if (!(VIAS_FILTRO as readonly string[]).includes(via)) throw new BadRequestException(`via debe ser una de: ${VIAS_FILTRO.join(', ')}`);
    f.via = via;
  }
  const estado = UNA_VEZ(p.estado, 'estado');
  if (estado !== undefined) {
    if (!(ESTADOS_VISUALES as readonly string[]).includes(estado)) throw new BadRequestException(`estado debe ser uno de: ${ESTADOS_VISUALES.join(', ')}`);
    f.estado = estado as EstadoVisual;
  }
  const orden = UNA_VEZ(p.orden, 'orden');
  if (orden !== undefined) {
    if (!(ORDENES_INVENTARIO as readonly string[]).includes(orden)) throw new BadRequestException(`orden debe ser uno de: ${ORDENES_INVENTARIO.join(', ')}`);
    f.orden = orden as FiltroInventario['orden'];
  }
  const q = UNA_VEZ(p.q, 'q')?.trim();
  if (q !== undefined && q !== '') {
    if (q.length > 80) throw new BadRequestException('q admite hasta 80 caracteres');
    f.q = q;
  }
  const lim = UNA_VEZ(p.limite, 'limite');
  const desp = UNA_VEZ(p.desplazamiento, 'desplazamiento');
  if (lim !== undefined) {
    const n = Number(lim);
    if (!Number.isInteger(n) || n < 1 || n > 500) throw new BadRequestException('limite debe ser un entero entre 1 y 500');
    f.limite = n;
  }
  if (desp !== undefined) {
    const n = Number(desp);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new BadRequestException('desplazamiento debe ser un entero entre 0 y 1000000');
    f.desplazamiento = n;
    f.limite ??= 50;
  }
  return f;
}
// `q` busca en id_fisico y nombre sin distinguir mayúsculas; sus comodines se escapan (un «%» escrito es un «%», no «cualquier cosa»).
export function patronBusqueda(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// ── Históricos alineados (docs/19 §4, D2) ────────────────────────────────────────────────────────────────────────────────────────
// Filas (canal, cubo, promedio, mínimo, máximo) → un eje de tiempos común (la unión de los cubos de todos los canales, ordenada) y, por
// canal, sus series con null donde ese canal no tiene dato. Es la forma que uPlot dibuja con varias gráficas y el cursor sincronizado.
// `muestras`: lecturas del cubo (como en el histórico de un canal y en el del sitio); 0 donde el canal no tiene dato en ese cubo.
export interface FilaCubo { canal_id: string; t: number; v: number; mn: number; mx: number; muestras: number }
export interface SerieAlineada { valores: (number | null)[]; minimos: (number | null)[]; maximos: (number | null)[]; muestras: number[] }
export function alinear(filas: readonly FilaCubo[], canales: readonly string[]): { tiempos: number[]; series: Map<string, SerieAlineada> } {
  const tiempos = [...new Set(filas.map((f) => f.t))].sort((a, b) => a - b);
  const posicion = new Map(tiempos.map((t, i) => [t, i]));
  const series = new Map(canales.map((c) => [c, {
    valores: new Array<number | null>(tiempos.length).fill(null),
    minimos: new Array<number | null>(tiempos.length).fill(null),
    maximos: new Array<number | null>(tiempos.length).fill(null),
    muestras: new Array<number>(tiempos.length).fill(0),
  }]));
  for (const f of filas) {
    const s = series.get(f.canal_id);
    const i = posicion.get(f.t);
    if (s === undefined || i === undefined) continue;
    s.valores[i] = f.v;
    s.minimos[i] = f.mn;
    s.maximos[i] = f.mx;
    s.muestras[i] = f.muestras;
  }
  return { tiempos, series };
}

// La resolución del rango cuando no se pide (resumen del sitio, docs/19 §4, B4): el intervalo más fino de la lista cerrada que deja la
// ventana en 300 cubos o menos (una gráfica de barras legible en un teléfono); una ventana de más de 300 días, cubos de un día.
export const MAX_CUBOS_RESUMEN = 300;
export function intervaloParaRango<T extends string>(desde: Date, hasta: Date, intervalos: readonly T[], segundos: Readonly<Record<T, number>>): T {
  const ventanaS = Math.max(0, (hasta.getTime() - desde.getTime()) / 1000);
  for (const i of intervalos) if (Math.ceil(ventanaS / segundos[i]) <= MAX_CUBOS_RESUMEN) return i;
  return intervalos[intervalos.length - 1];
}
