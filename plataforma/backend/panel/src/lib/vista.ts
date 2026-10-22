import { ORDEN_ATENCION, type EstadoVisual } from './estado-visual';
import { RANGOS, type ClaveRango } from './grafico';

// La vista vive en la URL (docs/19 §4, incremento 1, punto 1): `#/dispositivos/<id>?canal=<uuid>&rango=24h` y
// `#/?estado=alerta&sitio=&zona=&via=&q=`. Los parámetros van tras el `?` DEL FRAGMENTO, así la ruta del panel sigue siendo
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
  | { pantalla: 'ficha'; id: string; canal: string | null; rango: ClaveRango | null }
  | { pantalla: 'inventario'; filtros: FiltrosInventario };

export function leerVista(fragmento: string): Vista {
  const sinAlmohadilla = fragmento.startsWith('#') ? fragmento.slice(1) : fragmento;
  const i = sinAlmohadilla.indexOf('?');
  const ruta = i < 0 ? sinAlmohadilla : sinAlmohadilla.slice(0, i);
  const q = new URLSearchParams(i < 0 ? '' : sinAlmohadilla.slice(i + 1));
  const ficha = /^\/dispositivos\/([^/]+)$/.exec(ruta);
  if (ficha && UUID.test(ficha[1]!)) {
    const canal = q.get('canal');
    const rango = q.get('rango');
    return {
      pantalla: 'ficha',
      id: ficha[1]!,
      canal: canal !== null && UUID.test(canal) ? canal : null,
      rango: RANGOS.some((r) => r.clave === rango) ? (rango as ClaveRango) : null,
    };
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
export function fragmentoFicha(id: string, canal: string | null, rango: ClaveRango): string {
  const q = new URLSearchParams();
  if (canal !== null) q.set('canal', canal);
  q.set('rango', rango);
  return `#/dispositivos/${id}?${q.toString()}`;
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
