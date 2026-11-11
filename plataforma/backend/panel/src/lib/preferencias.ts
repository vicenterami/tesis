// P13 Preferencias y mi cuenta (docs/19 §4, tablero v2, H; HU-28, HU-29, RF-55, RF-56). Las preferencias viven en la base, no en el
// navegador (docs/21 §4): `GET /preferencias` y `PUT /preferencias` con bloqueo optimista (`actualizado_en`). Guardar una preferencia es
// reversible: se muestra hecha al instante y, si el servidor la rechaza, vuelve a la anterior con un aviso que dice por qué (docs/19 §6,
// renderizado optimista). Darse de baja, cerrar sesiones o exportar no son optimistas.
import type { Preferencias, VistaGuardada } from './modelo';

export const TIPOS_NOTIFICABLES = ['sin_comunicacion', 'umbral', 'bateria', 'manipulacion', 'tope_superado', 'reloj_desviado'] as const;
export const MAX_VISTAS = 20;

export const PREFERENCIAS_POR_DEFECTO: Required<Omit<Preferencias, 'actualizado_en' | 'sitio_predeterminado'>> & { sitio_predeterminado: string | null } = {
  unidad_temperatura: 'C',
  unidad_longitud: 'm',
  zona_horaria: 'sitio',
  tema: 'sistema',
  sitio_predeterminado: null,
  notificar: [],
  vistas: [],
};

// Las zonas IANA que conoce el navegador (las mismas que valida el servidor con Intl.supportedValuesOf); sin esa función, solo UTC.
export function zonasIana(): string[] {
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    return typeof f === 'function' ? f('timeZone') : ['UTC'];
  } catch {
    return ['UTC'];
  }
}

// El cuerpo de PUT: las preferencias completas con el `actualizado_en` leído (el servidor reemplaza la fila; 409 si cambió).
export function cuerpoPreferencias(p: Preferencias): Preferencias {
  return {
    unidad_temperatura: p.unidad_temperatura ?? PREFERENCIAS_POR_DEFECTO.unidad_temperatura,
    unidad_longitud: p.unidad_longitud ?? PREFERENCIAS_POR_DEFECTO.unidad_longitud,
    zona_horaria: p.zona_horaria ?? PREFERENCIAS_POR_DEFECTO.zona_horaria,
    tema: p.tema ?? PREFERENCIAS_POR_DEFECTO.tema,
    sitio_predeterminado: p.sitio_predeterminado ?? null,
    notificar: [...(p.notificar ?? [])],
    vistas: [...(p.vistas ?? [])],
    actualizado_en: p.actualizado_en ?? null, // null la primera vez (aún no hay fila): el servidor lo exige igual
  };
}

// Cambio optimista: lo nuevo para mostrar ya y lo anterior para volver si el servidor lo rechaza.
export function cambiar(p: Preferencias, cambio: Partial<Preferencias>): { nuevas: Preferencias; anteriores: Preferencias } {
  return { nuevas: { ...p, ...cambio }, anteriores: p };
}

export function alternarNotificacion(p: Preferencias, tipo: string, activo: boolean): string[] {
  const actual = new Set(p.notificar ?? []);
  if (activo) actual.add(tipo);
  else actual.delete(tipo);
  return TIPOS_NOTIFICABLES.filter((t) => actual.has(t));
}

// Una vista guardada de la pantalla actual (P2 o P3): el fragmento sin el «#», con un nombre propio; el mismo nombre la reemplaza.
export function guardarVista(vistas: readonly VistaGuardada[], nombre: string, fragmento: string): VistaGuardada[] | string {
  const n = nombre.trim();
  if (n === '' || n.length > 60) return 'el nombre de la vista lleva entre 1 y 60 caracteres';
  const ruta = fragmento.replace(/^#/, '');
  const pantalla = ruta.startsWith('/dispositivos/') ? 'ficha' : ruta.startsWith('/inventario') ? 'inventario' : ruta === '/' || ruta.startsWith('/?') ? 'tablero' : null;
  if (pantalla === null) return 'solo se guardan vistas del tablero, el inventario o la ficha';
  const otras = vistas.filter((v) => v.nombre !== n);
  if (otras.length >= MAX_VISTAS) return `como mucho ${MAX_VISTAS} vistas guardadas: borra alguna`;
  if (!FORMA_RUTA.test(ruta) || ruta.length > 200) return 'la dirección de esta vista no se puede guardar';
  return [...otras, { nombre: n, pantalla, parametros: { ruta } }];
}
// La forma de una ruta del propio panel: la misma que exige el servidor a `parametros.ruta` (cuenta/preferencias.ts).
const FORMA_RUTA = /^\/(?!\/)[\w\-/?=&%.:,+]*$/;
// El enlace de una vista guardada: solo rutas del propio panel (nunca una URL de otro origen que viniera en la base).
export function enlaceDeVista(v: VistaGuardada): string | null {
  const ruta = typeof v.parametros === 'object' && v.parametros !== null ? v.parametros.ruta : undefined;
  return typeof ruta === 'string' && FORMA_RUTA.test(ruta) ? `#${ruta}` : null;
}
