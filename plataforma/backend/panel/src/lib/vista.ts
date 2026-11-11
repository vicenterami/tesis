import { ORDEN_ATENCION, type EstadoVisual } from './estado-visual';
import { RANGOS, RESOLUCIONES, type ClaveRango, type ClaveResolucion } from './grafico';
import { VIAS } from './inventario';

// La vista vive en la URL (docs/19 §4, incremento 1, punto 1): `#/dispositivos/<id>?canal=<uuid>&rango=24h&res=5m[&desde=&hasta=]`,
// `#/inventario?estado=alerta&sitio=&zona=&via=&q=&pagina=2&orden=entrega` y `#/?sitio=&rango=7d` (el tablero, P1; o `&desde=&hasta=`
// en ISO, el rango a medida). La comparación (incremento 2, punto 5), `#/comparar?dispositivos=<uuid>,<uuid>&magnitud=&rango=&res=`.
// Los parámetros van tras el `?` DEL FRAGMENTO, así la ruta del panel sigue siendo `#/…` y nunca llega al servidor. Un valor inválido se
// ignora y rige el valor por defecto; nunca se adivina. Desde el tablero v2 (11/11/2026, A1) `#/` es el tablero y el inventario vive en
// `#/inventario`: un enlace viejo `#/?estado=…` (con algún filtro del inventario) se redirige a `#/inventario?…` (redireccionVieja).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODIGO_SITIO = /^[\w.-]{1,60}$/; // el código del sitio (único); nunca texto libre en la URL de otra persona

export type OrdenInventario = 'atencion' | 'entrega';
export interface FiltrosInventario {
  estado: EstadoVisual | null;
  sitio: string; // código del sitio
  zona: string; // id de la zona
  via: string;
  q: string;
  pagina: number; // desde 1 (docs/19 §6, paginación: la posición va en la URL)
  orden: OrdenInventario;
}
export const SIN_FILTROS: FiltrosInventario = { estado: null, sitio: '', zona: '', via: '', q: '', pagina: 1, orden: 'atencion' };

// Una ventana a medida o acotada por un zoom (HU-07; tablero v2, B1 y D1): un solo mecanismo, `desde` y `hasta` en ISO.
export interface VentanaFija {
  desde: Date;
  hasta: Date;
}
export const MAX_VENTANA_MS = 366 * 86_400_000; // el tope del servidor (docs/19 §4, incremento 2, punto 4)

export type Vista =
  | { pantalla: 'ficha'; id: string; canal: string | null; rango: ClaveRango | null; res: ClaveResolucion | null; fija: VentanaFija | null }
  | { pantalla: 'comparar'; dispositivos: string[]; magnitud: string | null; rango: ClaveRango | null; res: ClaveResolucion | null }
  | { pantalla: 'usuarios' } // P10, administración de usuarios (docs/19 §4): `#/usuarios`
  | { pantalla: 'legal' } // P11 mínima (A1): `#/legal`
  | { pantalla: 'tablero'; sitio: string; rango: ClaveRango | null; fija: VentanaFija | null }
  | { pantalla: 'inventario'; filtros: FiltrosInventario };

// Comparar admite de 2 a 6 dispositivos (docs/19 §4, incremento 2, punto 5); la pantalla dice qué hacer con menos.
export const MAX_COMPARAR = 6;
const MAGNITUD = /^[a-z0-9_]{1,40}$/; // el código de la magnitud (catálogo de la base), nunca texto libre

const leerSitio = (v: string | null): string => (v !== null && CODIGO_SITIO.test(v) ? v : '');
const leerRango = (v: string | null): ClaveRango | null => (RANGOS.some((r) => r.clave === v) ? (v as ClaveRango) : null);
// Si la resolución sirve para el rango lo decide la pantalla (resolucionValida): aquí solo se exige que sea de la lista.
const leerRes = (v: string | null): ClaveResolucion | null => (RESOLUCIONES.some((r) => r.clave === v) ? (v as ClaveResolucion) : null);
// Las dos fechas válidas, en orden y dentro del tope del servidor; si no, ninguna (rige el rango).
export function leerVentanaFija(desde: string | null, hasta: string | null): VentanaFija | null {
  if (desde === null || hasta === null) return null;
  const d = new Date(desde);
  const h = new Date(hasta);
  if (Number.isNaN(d.getTime()) || Number.isNaN(h.getTime())) return null;
  if (h.getTime() <= d.getTime() || h.getTime() - d.getTime() > MAX_VENTANA_MS) return null;
  return { desde: d, hasta: h };
}
const PARAMETROS_INVENTARIO = ['estado', 'zona', 'via', 'q', 'pagina', 'orden'];

function partes(fragmento: string): { ruta: string; q: URLSearchParams } {
  const sinAlmohadilla = fragmento.startsWith('#') ? fragmento.slice(1) : fragmento;
  const i = sinAlmohadilla.indexOf('?');
  return { ruta: i < 0 ? sinAlmohadilla : sinAlmohadilla.slice(0, i), q: new URLSearchParams(i < 0 ? '' : sinAlmohadilla.slice(i + 1)) };
}

// Un enlace guardado antes del tablero v2 (`#/?estado=alerta`, `#/?via=http`) abría el inventario: se lleva a `#/inventario` con los
// mismos parámetros. null si no hace falta.
export function redireccionVieja(fragmento: string): string | null {
  const { ruta, q } = partes(fragmento);
  if (ruta !== '/' && ruta !== '') return null;
  if (!PARAMETROS_INVENTARIO.some((p) => q.has(p))) return null;
  return `#/inventario?${q.toString()}`;
}

export function leerVista(fragmento: string): Vista {
  const nueva = redireccionVieja(fragmento);
  const { ruta, q } = partes(nueva ?? fragmento);
  const ficha = /^\/dispositivos\/([^/]+)$/.exec(ruta);
  if (ficha && UUID.test(ficha[1]!)) {
    const canal = q.get('canal');
    return {
      pantalla: 'ficha',
      id: ficha[1]!,
      canal: canal !== null && UUID.test(canal) ? canal : null,
      rango: leerRango(q.get('rango')),
      res: leerRes(q.get('res')),
      fija: leerVentanaFija(q.get('desde'), q.get('hasta')),
    };
  }
  if (ruta === '/usuarios') return { pantalla: 'usuarios' };
  if (ruta === '/legal') return { pantalla: 'legal' };
  if (ruta === '/comparar') {
    // Ids válidos, sin repetir, en el orden de la URL (el primero fija la unidad del eje y el primer color); más de 6, se recorta.
    const ids = [...new Set((q.get('dispositivos') ?? '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => UUID.test(x)))].slice(0, MAX_COMPARAR);
    const magnitud = q.get('magnitud');
    return { pantalla: 'comparar', dispositivos: ids, magnitud: magnitud !== null && MAGNITUD.test(magnitud) ? magnitud : null, rango: leerRango(q.get('rango')), res: leerRes(q.get('res')) };
  }
  if (ruta === '/inventario') {
    const estado = q.get('estado');
    const pagina = Number(q.get('pagina') ?? '1');
    return {
      pantalla: 'inventario',
      filtros: {
        estado: (ORDEN_ATENCION as readonly string[]).includes(estado ?? '') ? (estado as EstadoVisual) : null,
        // Como el resto: un valor que no tiene la forma esperada se ignora (corrección del 11/11/2026).
        sitio: leerSitio(q.get('sitio')),
        zona: UUID.test(q.get('zona') ?? '') ? q.get('zona')! : '',
        via: (VIAS as readonly string[]).includes(q.get('via') ?? '') ? q.get('via')! : '',
        q: (q.get('q') ?? '').slice(0, 100), // texto libre; acotado para que una URL ajena no arrastre basura
        pagina: Number.isInteger(pagina) && pagina >= 1 && pagina <= 100_000 ? pagina : 1,
        orden: q.get('orden') === 'entrega' ? 'entrega' : 'atencion',
      },
    };
  }
  // Todo lo demás es el tablero (P1), la pantalla de llegada (A1).
  return { pantalla: 'tablero', sitio: leerSitio(q.get('sitio')), rango: leerRango(q.get('rango')), fija: leerVentanaFija(q.get('desde'), q.get('hasta')) };
}

// Solo se escribe lo que no es el valor por defecto en el inventario; la ficha lleva siempre canal y rango (un enlace
// compartido abre exactamente esa vista aunque el valor por defecto cambie algún día).
// La resolución va solo cuando no es «auto» (incremento 2, punto 4).
// La ventana fija (zoom o rango a medida) va en `desde` y `hasta`, junto al rango del que salió (al que vuelve «rango completo»).
export function fragmentoFicha(id: string, canal: string | null, rango: ClaveRango, res: ClaveResolucion | null = null, fija: VentanaFija | null = null): string {
  const q = new URLSearchParams();
  if (canal !== null) q.set('canal', canal);
  q.set('rango', rango);
  if (res !== null) q.set('res', res);
  if (fija !== null) {
    q.set('desde', fija.desde.toISOString());
    q.set('hasta', fija.hasta.toISOString());
  }
  return `#/dispositivos/${id}?${q.toString()}`;
}

// El tablero: el sitio (si la persona tiene más de uno) y el rango o la ventana a medida; «#/» con todo por defecto.
export function fragmentoTablero(sitio: string, rango: ClaveRango | null, fija: VentanaFija | null = null): string {
  const q = new URLSearchParams();
  if (sitio !== '') q.set('sitio', sitio);
  if (fija !== null) {
    q.set('desde', fija.desde.toISOString());
    q.set('hasta', fija.hasta.toISOString());
  } else if (rango !== null) q.set('rango', rango);
  const s = q.toString();
  return s === '' ? '#/' : `#/?${s}`;
}

// La coma entre ids se deja legible (URLSearchParams la escribiría %2C): los ids son UUID y no la contienen.
export function fragmentoComparar(dispositivos: readonly string[], magnitud: string | null, rango: ClaveRango, res: ClaveResolucion | null = null): string {
  const q = new URLSearchParams();
  if (magnitud !== null) q.set('magnitud', magnitud);
  q.set('rango', rango);
  if (res !== null) q.set('res', res);
  return `#/comparar?dispositivos=${dispositivos.join(',')}&${q.toString()}`;
}

export function fragmentoInventario(f: FiltrosInventario): string {
  const q = new URLSearchParams();
  if (f.estado !== null) q.set('estado', f.estado);
  if (f.sitio !== '') q.set('sitio', f.sitio);
  if (f.zona !== '') q.set('zona', f.zona);
  if (f.via !== '') q.set('via', f.via);
  if (f.q !== '') q.set('q', f.q);
  if (f.pagina > 1) q.set('pagina', String(f.pagina));
  if (f.orden !== 'atencion') q.set('orden', f.orden);
  const s = q.toString();
  return s === '' ? '#/inventario' : `#/inventario?${s}`;
}
