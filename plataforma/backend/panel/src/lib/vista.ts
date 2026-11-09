import { ORDEN_ATENCION, type EstadoVisual } from './estado-visual';
import { RANGOS, RESOLUCIONES, type ClaveRango, type ClaveResolucion } from './grafico';

// La vista vive en la URL (docs/19 §4, incremento 1, punto 1): `#/dispositivos/<id>?canal=<uuid>&rango=24h&res=5m` y
// `#/?estado=alerta&sitio=&zona=&via=&q=`; la comparación (incremento 2, punto 5), `#/comparar?dispositivos=<uuid>,<uuid>&magnitud=&rango=&res=`. Los parámetros van tras el `?` DEL FRAGMENTO, así la ruta del panel sigue siendo
// `#/…` y nunca llega al servidor. Un valor inválido se ignora y rige el valor por defecto; nunca se adivina.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FiltrosInventario {
  estado: EstadoVisual | null;
  sitio: string; // código del sitio
  zona: string; // id de la zona
  via: string;
  q: string;
}
export const SIN_FILTROS: FiltrosInventario = { estado: null, sitio: '', zona: '', via: '', q: '' };

export type Vista =
  | { pantalla: 'ficha'; id: string; canal: string | null; rango: ClaveRango | null; res: ClaveResolucion | null }
  | { pantalla: 'comparar'; dispositivos: string[]; magnitud: string | null; rango: ClaveRango | null; res: ClaveResolucion | null }
  | { pantalla: 'usuarios' } // P10, administración de usuarios (docs/19 §4): `#/usuarios`
  | { pantalla: 'inventario'; filtros: FiltrosInventario };

// Comparar admite de 2 a 6 dispositivos (docs/19 §4, incremento 2, punto 5); la pantalla dice qué hacer con menos.
export const MAX_COMPARAR = 6;
const MAGNITUD = /^[a-z0-9_]{1,40}$/; // el código de la magnitud (catálogo de la base), nunca texto libre

const leerRango = (v: string | null): ClaveRango | null => (RANGOS.some((r) => r.clave === v) ? (v as ClaveRango) : null);
// Si la resolución sirve para el rango lo decide la pantalla (resolucionValida): aquí solo se exige que sea de la lista.
const leerRes = (v: string | null): ClaveResolucion | null => (RESOLUCIONES.some((r) => r.clave === v) ? (v as ClaveResolucion) : null);

export function leerVista(fragmento: string): Vista {
  const sinAlmohadilla = fragmento.startsWith('#') ? fragmento.slice(1) : fragmento;
  const i = sinAlmohadilla.indexOf('?');
  const ruta = i < 0 ? sinAlmohadilla : sinAlmohadilla.slice(0, i);
  const q = new URLSearchParams(i < 0 ? '' : sinAlmohadilla.slice(i + 1));
  const ficha = /^\/dispositivos\/([^/]+)$/.exec(ruta);
  if (ficha && UUID.test(ficha[1]!)) {
    const canal = q.get('canal');
    return {
      pantalla: 'ficha',
      id: ficha[1]!,
      canal: canal !== null && UUID.test(canal) ? canal : null,
      rango: leerRango(q.get('rango')),
      res: leerRes(q.get('res')),
    };
  }
  if (ruta === '/usuarios') return { pantalla: 'usuarios' };
  if (ruta === '/comparar') {
    // Ids válidos, sin repetir, en el orden de la URL (el primero fija la unidad del eje y el primer color); más de 6, se recorta.
    const ids = [...new Set((q.get('dispositivos') ?? '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => UUID.test(x)))].slice(0, MAX_COMPARAR);
    const magnitud = q.get('magnitud');
    return { pantalla: 'comparar', dispositivos: ids, magnitud: magnitud !== null && MAGNITUD.test(magnitud) ? magnitud : null, rango: leerRango(q.get('rango')), res: leerRes(q.get('res')) };
  }
  const estado = q.get('estado');
  return {
    pantalla: 'inventario',
    filtros: {
      estado: (ORDEN_ATENCION as readonly string[]).includes(estado ?? '') ? (estado as EstadoVisual) : null,
      sitio: q.get('sitio') ?? '',
      zona: q.get('zona') ?? '',
      via: q.get('via') ?? '',
      q: (q.get('q') ?? '').slice(0, 100), // texto libre que solo filtra en el cliente; acotado para que una URL ajena no arrastre basura
    },
  };
}

// Solo se escribe lo que no es el valor por defecto en el inventario; la ficha lleva siempre canal y rango (un enlace
// compartido abre exactamente esa vista aunque el valor por defecto cambie algún día).
// La resolución va solo cuando no es «auto» (incremento 2, punto 4).
export function fragmentoFicha(id: string, canal: string | null, rango: ClaveRango, res: ClaveResolucion | null = null): string {
  const q = new URLSearchParams();
  if (canal !== null) q.set('canal', canal);
  q.set('rango', rango);
  if (res !== null) q.set('res', res);
  return `#/dispositivos/${id}?${q.toString()}`;
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
  const s = q.toString();
  return s === '' ? '#/' : `#/?${s}`;
}
