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

// ── «Ahora»: lo que se mide en este momento (docs/19 §4, bloque L, puntos 3 y 6) ──────────────────────────────────────────────────
// Magnitudes de **salud del equipo** (L3b): batería (nivel y tensión) y señal. Un solo lugar del backend, con los códigos del catálogo
// `magnitud` (migraciones 01 y 17); en la tarjeta de un dispositivo van al final, después de lo que se mide. Una magnitud nueva de salud
// se agrega aquí y en docs/19 L3b, juntas.
export const MAGNITUDES_SALUD = ['bateria', 'tension', 'rssi'] as const;
export function esSalud(magnitud: string): boolean {
  return (MAGNITUDES_SALUD as readonly string[]).includes(magnitud);
}
// Cuántos canales lleva cada tarjeta, y los topes de `limite` (de 1 a 60; 24 por defecto).
export const MAX_CANALES_AHORA = 3;
export const LIMITE_AHORA = { porDefecto: 24, maximo: 60 } as const;
// La tendencia: 24 cubos de una hora alineados a la hora UTC; el último es la hora en curso (parcial).
export const CUBOS_CHISPA = 24;
// Topes de la tendencia (docs/19 §4, L6; docs/11 §4; desde el 13/11/2026): lee 24 h de mediciones, así que va en una conexión propia con
// tiempo máximo de sentencia y, como mucho, dos cálculos a la vez en el proceso; si vence el tiempo o no hay cupo, «Ahora» responde igual,
// con `tendencia: false`. 2 s: cinco veces lo más lento medido en docs/16 §66 (392 ms, lecturas cada 5 s); con las dos de a la vez, quedan
// libres tres de las cinco conexiones del pool para la recepción.
export const TENDENCIA = { maxEnCurso: 2, tiempoMaximoMs: 2_000 } as const;
const HORA_MS = 3_600_000;

// Un canal con su última lectura tal como lo trae la consulta (la forma de la ficha: valor y tiempo; la calibración para el %).
export interface CanalConUltima {
  id: string; dispositivo_id: string; magnitud: string; magnitud_nombre: string; unidad: string; intervalo_esperado_s: number;
  escala_cero: number | null; escala_cien: number | null; ultima: { valor: number; tiempo: string } | null;
}

// El orden de los canales en una tarjeta: primero lo que se mide, al final la salud; dentro, por código de magnitud (como la ficha) e id.
export function ordenCanales(a: Pick<CanalConUltima, 'id' | 'magnitud'>, b: Pick<CanalConUltima, 'id' | 'magnitud'>): number {
  return Number(esSalud(a.magnitud)) - Number(esSalud(b.magnitud)) || a.magnitud.localeCompare(b.magnitud) || a.id.localeCompare(b.id);
}
export function elegirCanales<T extends Pick<CanalConUltima, 'id' | 'magnitud'>>(canales: readonly T[]): T[] {
  return [...canales].sort(ordenCanales).slice(0, MAX_CANALES_AHORA);
}

// ¿La lectura sigue vigente en el instante `referencia`? Menos de dos intervalos esperados del dispositivo: una lectura vieja no entra al
// promedio de «ahora» (L3a); en la tarjeta se muestra atenuada con su antigüedad (eso lo decide el panel). Estricta: exactamente dos
// intervalos ya no es vigente. Es la ÚNICA casa de la regla: «Ahora» la evalúa con el reloj de la base (desde el 13/11/2026 el agregado por
// magnitud se calcula en la base, docs/16 §66) y el histórico del sitio, al empezar cada tramo (docs/19 §4, M1). Los argumentos son
// expresiones SQL fijas del código, nunca datos.
export const VIGENCIA_INTERVALOS = 2;
// El instante más antiguo que una lectura puede tener para seguir vigente en `referencia`. Lo usa también quien acota desde cuándo leer
// (la cota del histórico del sitio): si el factor cambia, cambian juntos la regla y la cota.
export function sqlLimiteVigencia(referencia: string, intervalo: string): string {
  return `${referencia} - ${intervalo} * ${VIGENCIA_INTERVALOS} * INTERVAL '1 second'`;
}
export function sqlLecturaVigente(lectura: string, referencia: string, intervalo: string): string {
  return `${lectura} > ${sqlLimiteVigencia(referencia, intervalo)}`;
}
// En «Ahora», sobre `dev` (el dispositivo, con `intervalo_esperado_s`) y `u` (la última lectura del canal).
export const SQL_LECTURA_VIGENTE = sqlLecturaVigente('u.tiempo', 'now()', 'dev.intervalo_esperado_s');

// ── Histórico del sitio: el promedio de sus dispositivos (docs/19 §4, M; docs/10 §8.4 punto 66) ────────────────────────────────────
// En cada tramo, cada canal de la magnitud (uno por dispositivo: UNIQUE (dispositivo_id, magnitud_codigo)) aporta UN valor: el promedio
// de sus lecturas del tramo o, si no reportó en él, su última lectura mientras siga vigente al empezar el tramo (sqlLecturaVigente). El
// punto es el promedio de los aportes; la banda, el mínimo y el máximo entre ellos; `n`, cuántos aportan; `muestras`, las lecturas reales.
// Parámetros: $1 sitio, $2 desde, $3 hasta, $4 intervalo, $5 zona horaria, $6 magnitud y $7 la cota inferior de lo que se lee: el inicio
// del primer tramo menos dos veces el mayor intervalo esperado de esos canales (la calcula el servicio; como constante, la base descarta
// los fragmentos que no tocan al planificar). Cómo (medido en docs/16 §68):
//   · `propio`: por canal (LATERAL: cada canal se agrega solo, sin ordenar las lecturas de todo el sitio) y tramo, el promedio, mínimo,
//     máximo, cuántas y la última lectura con su hora; las anteriores a la ventana, aún vigentes al empezar el primer tramo, van a un
//     tramo «-infinity», del que solo se usa la última (la lectura anterior a la ventana). `b_sig`, el siguiente tramo con lecturas.
//   · `arrastre`: después de cada tramo con lecturas (y del «-infinity»), los tramos de la rejilla hasta el siguiente con lecturas en que
//     su última lectura sigue vigente; solo se recorren los tramos que pueden estarlo (dos intervalos esperados, en tramos, más uno). La
//     rejilla es un arreglo ordenado de los inicios de tramo (generate_series en la zona del sitio y time_bucket de cada paso: así coincide
//     con los tramos de las lecturas también cuando cambia la hora); `orden`, la posición de cada uno, para cortar el arreglo sin buscar.
//   · `suyo` y `ajeno`: lo propio y lo arrastrado, sumados por tramo, y unidos: un tramo sin ningún aporte no sale (no es 0).
// `dispositivos`: cuántos aportan en algún tramo (todo canal con lecturas en la ventana o una anterior vigente tiene exactamente una fila
// sin siguiente).
// `maxEnCurso` y `maxEnEspera` (revisión del 14/11/2026): cada consulta ocupa una conexión propia hasta `tiempoMaximoMs`, el grupo tiene
// cinco y las comparte con la recepción, y la pestaña Tendencias pide hasta seis magnitudes juntas; como mucho dos a la vez en el proceso,
// las demás esperan su turno (doce: dos pestañas completas) y, con la fila llena, 503.
export const HISTORICO_SITIO = { tiempoMaximoMs: 5_000, maxEnCurso: 2, maxEnEspera: 12 } as const;
export const SQL_HISTORICO_SITIO = `
      WITH c AS (
        SELECT c.id, d.intervalo_esperado_s
          FROM canal c JOIN dispositivo d ON d.id = c.dispositivo_id JOIN zona z ON z.id = d.zona_id
         WHERE z.sitio_id = $1 AND c.magnitud_codigo = $6),
      rejilla AS (
        SELECT array_agg(b ORDER BY b) AS b
          FROM (SELECT DISTINCT time_bucket($4::interval, g, $5) AS b
                  FROM generate_series(time_bucket($4::interval, $2::timestamptz, $5), $3::timestamptz, $4::interval, $5) g
                 WHERE g < $3) u),
      propio AS (
        SELECT c.id AS canal_id, c.intervalo_esperado_s, p.*
          FROM c CROSS JOIN LATERAL (
            SELECT g.b, g.v, g.mn, g.mx, g.k, g.ut, g.uv, lead(g.b) OVER (ORDER BY g.b) AS b_sig
              FROM (SELECT CASE WHEN x.tiempo < $2 THEN '-infinity' ELSE time_bucket($4::interval, x.tiempo, $5) END AS b,
                           avg(x.valor) AS v, min(x.valor) AS mn, max(x.valor) AS mx, count(*)::int AS k,
                           max(x.tiempo) AS ut, last(x.valor, x.tiempo) AS uv
                      FROM medicion x
                     WHERE x.canal_id = c.id AND x.tiempo >= $7 AND x.tiempo < $3
                       AND ${sqlLecturaVigente('x.tiempo', 'time_bucket($4::interval, $2::timestamptz, $5)', 'c.intervalo_esperado_s')}
                     GROUP BY 1) g) p),
      orden AS (SELECT u.b, u.i::int AS i FROM rejilla r CROSS JOIN LATERAL unnest(r.b) WITH ORDINALITY u(b, i)),
      arrastre AS (
        SELECT u.b, p.uv
          FROM (SELECT p.uv, p.ut, p.intervalo_esperado_s, coalesce(o0.i, 0) AS i0,
                       least(coalesce(o1.i, (SELECT cardinality(b) FROM rejilla) + 1) - 1,
                             coalesce(o0.i, 0) + 1 + ceil(p.intervalo_esperado_s * 2 / extract(epoch FROM $4::interval))::int) AS i1
                  FROM propio p LEFT JOIN orden o0 ON o0.b = p.b LEFT JOIN orden o1 ON o1.b = p.b_sig
                 WHERE p.b_sig IS NULL OR p.b_sig > p.b + $4::interval) p
         CROSS JOIN rejilla r CROSS JOIN LATERAL unnest(r.b[p.i0 + 1 : p.i1]) u(b)
         WHERE ${sqlLecturaVigente('p.ut', 'u.b', 'p.intervalo_esperado_s')}),
      suyo AS (
        SELECT b, sum(v) AS sv, count(*) AS n, min(mn) AS mn, max(mx) AS mx, sum(k) AS k FROM propio WHERE b > '-infinity' GROUP BY b),
      ajeno AS (
        SELECT b, sum(uv) AS sv, count(*) AS n, min(uv) AS mn, max(uv) AS mx FROM arrastre GROUP BY b)
      SELECT extract(epoch FROM b)::bigint AS t,
             round(((coalesce(s.sv, 0) + coalesce(a.sv, 0)) / (coalesce(s.n, 0) + coalesce(a.n, 0)))::numeric, 3)::float AS v,
             round(least(s.mn, a.mn)::numeric, 3)::float AS mn,
             round(greatest(s.mx, a.mx)::numeric, 3)::float AS mx,
             coalesce(s.k, 0)::int AS muestras,
             (coalesce(s.n, 0) + coalesce(a.n, 0))::int AS n,
             (SELECT count(*) FROM propio WHERE b_sig IS NULL)::int AS dispositivos
        FROM suyo s FULL JOIN ajeno a USING (b)
       ORDER BY b`;

// Por magnitud, sobre la última lectura vigente de cada canal: promedio, mínimo, máximo y cuántos canales aportan (una fila por magnitud,
// de la base). Aquí, la marca de salud, el promedio con tres decimales y el orden: las magnitudes de salud al final; dentro, por código.
// Una magnitud sin ninguna lectura vigente no llega de la base: no aparece (no es 0).
export interface FilaMagnitud { codigo: string; nombre: string; unidad: string; canales: number; promedio: number; minimo: number; maximo: number }
export interface AgregadoMagnitud extends FilaMagnitud { salud: boolean }
export function porMagnitud(filas: readonly FilaMagnitud[]): AgregadoMagnitud[] {
  const redondeo = (x: number): number => Math.round(x * 1000) / 1000;
  return filas
    .map((f) => ({
      codigo: f.codigo, nombre: f.nombre, unidad: f.unidad, salud: esSalud(f.codigo), canales: f.canales,
      promedio: redondeo(f.promedio), minimo: f.minimo, maximo: f.maximo,
    }))
    .sort((a, b) => Number(a.salud) - Number(b.salud) || a.codigo.localeCompare(b.codigo));
}

// La ventana de la tendencia: desde el inicio de la hora UTC en curso menos 23 h, 24 cubos (hasta el fin de la hora en curso).
export function ventanaChispa(ahoraMs: number): { desde: Date; hasta: Date } {
  const desde = Math.floor(ahoraMs / HORA_MS) * HORA_MS - (CUBOS_CHISPA - 1) * HORA_MS;
  return { desde: new Date(desde), hasta: new Date(desde + CUBOS_CHISPA * HORA_MS) };
}
// Filas (canal, cubo en segundos Unix, promedio) → por canal, 24 posiciones con null donde no hubo lecturas (un cubo vacío no es 0).
export function armarChispas(filas: readonly { canal_id: string; t: number; v: number }[], canales: readonly string[], desde: Date): Map<string, (number | null)[]> {
  const r = new Map(canales.map((c) => [c, new Array<number | null>(CUBOS_CHISPA).fill(null)]));
  const base = desde.getTime() / 1000;
  for (const f of filas) {
    const i = Math.round((f.t - base) / 3600);
    const serie = r.get(f.canal_id);
    if (serie !== undefined && i >= 0 && i < CUBOS_CHISPA) serie[i] = f.v;
  }
  return r;
}

// La resolución del rango cuando no se pide (resumen del sitio, docs/19 §4, B4): el intervalo más fino de la lista cerrada que deja la
// ventana en 300 cubos o menos (una gráfica de barras legible en un teléfono); una ventana de más de 300 días, cubos de un día.
export const MAX_CUBOS_RESUMEN = 300;
export function intervaloParaRango<T extends string>(desde: Date, hasta: Date, intervalos: readonly T[], segundos: Readonly<Record<T, number>>): T {
  const ventanaS = Math.max(0, (hasta.getTime() - desde.getTime()) / 1000);
  for (const i of intervalos) if (Math.ceil(ventanaS / segundos[i]) <= MAX_CUBOS_RESUMEN) return i;
  return intervalos[intervalos.length - 1];
}
