// Inventario v2 (docs/19 §4, tablero v2, C): lo que el panel pide al servidor y lo que hace si el servidor no filtra (backend anterior).
import type { EstadoVisual } from './estado-visual';
import type { DispositivoInventario } from './modelo';
import type { FiltrosInventario } from './vista';

export const POR_PAGINA = 50;
// Las vías que admite la base (`ck_dispositivo_via`, migración 11): el filtro las ofrece aunque la página visible no tenga ninguna.
export const VIAS = ['http', 'lorawan', 'mqtt'] as const;

// `GET /dispositivos?sitio&zona&via&estado&q&orden&limite&desplazamiento` (I): solo los filtros puestos, en un orden fijo; la posición
// sale de la página. Texto de la persona, siempre codificado. La API filtra por el id (UUID) del sitio y de la zona; la URL del panel
// lleva el código del sitio (legible y estable), que se traduce aquí con `GET /sitios` (corrección del 11/11/2026: el código mandado
// tal cual no filtraba). Sin el id, el sitio no se manda (quien llama espera la lista de sitios antes de pedir). `orden=entrega` lo
// ordena el servidor, de peor a mejor con los nulos al final: el orden vale para todas las páginas, no solo para la visible.
export function urlInventario(f: FiltrosInventario, limite: number, sitioId: string | null = null): string {
  const q = new URLSearchParams();
  if (f.sitio !== '' && sitioId !== null) q.set('sitio', sitioId);
  if (f.zona !== '') q.set('zona', f.zona);
  if (f.via !== '') q.set('via', f.via);
  if (f.estado !== null) q.set('estado', f.estado);
  if (f.q.trim() !== '') q.set('q', f.q.trim());
  if (f.orden === 'entrega') q.set('orden', 'entrega');
  q.set('limite', String(limite));
  q.set('desplazamiento', String((f.pagina - 1) * limite));
  return `/dispositivos?${q.toString()}`;
}

// De peor a mejor entrega, sin dato al final: el mismo orden que `orden=entrega` del servidor (para un backend que no pagina).
export const compararEntrega = (a: { d: DispositivoInventario }, b: { d: DispositivoInventario }): number => (a.d.entrega ?? Infinity) - (b.d.entrega ?? Infinity);

// El mismo filtro, en el panel: con un servidor que ya filtró no cambia nada (salvo un estado recalculado en vivo); con uno anterior,
// que devuelve todo, deja lo mismo que habría dejado el servidor.
export function filtrarEnPanel<T extends { d: DispositivoInventario; estado: EstadoVisual }>(filas: readonly T[], f: FiltrosInventario): T[] {
  const q = f.q.trim().toLowerCase();
  return filas.filter(
    (x) =>
      (f.estado === null || x.estado === f.estado) &&
      (f.sitio === '' || x.d.sitio_codigo === f.sitio) &&
      (f.zona === '' || x.d.zona_id === f.zona) &&
      (f.via === '' || x.d.via === f.via) &&
      (q === '' || x.d.nombre.toLowerCase().includes(q) || x.d.id_fisico.toLowerCase().includes(q)),
  );
}

// «1–50 de 132» (docs/19 §6, paginación).
export function rotuloPagina(pagina: number, filas: number, total: number): string {
  if (total === 0 || filas === 0) return `0 de ${total.toLocaleString('es-CL')}`;
  const desde = (pagina - 1) * POR_PAGINA + 1;
  return `${desde.toLocaleString('es-CL')}–${(desde + filas - 1).toLocaleString('es-CL')} de ${total.toLocaleString('es-CL')}`;
}
