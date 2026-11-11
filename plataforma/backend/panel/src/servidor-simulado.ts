// Solo para las pruebas (no lo importa ningún componente): el `GET /dispositivos` del contrato del tablero v2 (docs/19 §4, I), simulado
// sobre una lista: filtra por sitio, zona, vía, estado y texto, pagina con `limite` y `desplazamiento`, pone el total en `X-Total` y
// suma `estado_visual` (con la regla de §2, la misma función del panel: el servidor la escribe en SQL; que digan lo mismo fila por fila
// lo comprueba el backend) y `entrega`. Sin parámetros (`/dispositivos` a secas, un backend anterior) devuelve todo, sin cabecera.
import { enLinea, estadoVisual } from './lib/estado-visual';
import type { Condicion, DispositivoInventario } from './lib/modelo';

// `sitio` es el id del sitio, como en la API (las filas traen su código): `sitios` dice qué id tiene cada código. `orden=entrega`
// ordena de peor a mejor con los nulos al final, como el servidor.
export function inventarioSimulado(ruta: string, dispositivos: readonly DispositivoInventario[], abiertas: readonly Condicion[], ahora: Date, sitios: readonly { id: string; codigo: string }[] = []): Response | null {
  if (!ruta.startsWith('/dispositivos?') && ruta !== '/dispositivos') return null;
  if (ruta === '/dispositivos') return new Response(JSON.stringify(dispositivos));
  const q = new URLSearchParams(ruta.slice(ruta.indexOf('?') + 1));
  const conEstado = dispositivos.map((d) => ({
    ...d,
    estado_visual: d.estado_visual ?? estadoVisual({ estado: d.estado, en_linea: enLinea(d.visto_por_ultima_vez, d.intervalo_esperado_s, ahora) }, abiertas.filter((c) => c.dispositivo_id === d.id).map((c) => c.tipo)),
  }));
  const texto = (q.get('q') ?? '').toLowerCase();
  const filas = conEstado.filter(
    (d) =>
      (!q.has('sitio') || d.sitio_codigo === sitios.find((s) => s.id === q.get('sitio'))?.codigo) &&
      (!q.has('zona') || d.zona_id === q.get('zona')) &&
      (!q.has('via') || d.via === q.get('via')) &&
      (!q.has('estado') || d.estado_visual === q.get('estado')) &&
      (texto === '' || d.nombre.toLowerCase().includes(texto) || d.id_fisico.toLowerCase().includes(texto)),
  );
  if (q.get('orden') === 'entrega') filas.sort((a, b) => (a.entrega ?? Infinity) - (b.entrega ?? Infinity));
  const limite = Number(q.get('limite') ?? '50');
  const desde = Number(q.get('desplazamiento') ?? '0');
  return new Response(JSON.stringify(filas.slice(desde, desde + limite)), { headers: { 'X-Total': String(filas.length) } });
}
