// Sitios y zonas desde el panel (docs/19 §4 U; P15 «Zonas» y P17 «Sitios»): las reglas que el panel repite para avisar antes de enviar. La
// guarda real es el servidor (backend/src/consulta/sitios-zonas.ts): mismos topes y misma forma del código; aquí solo se adelanta el motivo.
import { ErrorApi, mensajeError } from './api';

export const MAX_NOMBRE_ZONA = 80;
export const MAX_NOMBRE_SITIO = 80;
export const MAX_DESCRIPCION_SITIO = 500;
export const FORMA_CODIGO_SITIO = /^[a-z0-9][a-z0-9-]{1,62}$/; // ck_sitio_codigo (migración 11): va en el tópico sitio/<código>/…
export const ZONA_INICIAL = 'General';

export function motivoNombreZona(v: string): string | null {
  const t = v.trim();
  if (t === '') return 'Escribe el nombre de la zona.';
  if ([...t].length > MAX_NOMBRE_ZONA) return `El nombre de la zona admite hasta ${MAX_NOMBRE_ZONA} caracteres.`;
  return null;
}

export function motivoNombreSitio(nombre: string): string | null {
  if (nombre.trim() === '') return 'Escribe el nombre del sitio.';
  if ([...nombre.trim()].length > MAX_NOMBRE_SITIO) return `El nombre del sitio admite hasta ${MAX_NOMBRE_SITIO} caracteres.`;
  return null;
}

// La descripción es opcional: vacía vale (el servidor la guarda como «sin descripción»).
export function motivoDescripcionSitio(descripcion: string): string | null {
  return [...descripcion.trim()].length > MAX_DESCRIPCION_SITIO ? `La descripción admite hasta ${MAX_DESCRIPCION_SITIO} caracteres.` : null;
}

export function motivoSitio(nombre: string, codigo: string): string | null {
  const m = motivoNombreSitio(nombre);
  if (m !== null) return m;
  if (!FORMA_CODIGO_SITIO.test(codigo)) return 'El código va de 2 a 63 caracteres: minúsculas sin tildes, números y guiones, y empieza con letra o número.';
  return null;
}

// El código sugerido desde el nombre: minúsculas, sin tildes, lo que no es letra o número pasa a guion, sin guiones repetidos ni en los
// extremos, hasta 63 caracteres. «Sede Norte (anexo)» → «sede-norte-anexo». La persona lo puede cambiar.
export function codigoSugerido(nombre: string): string {
  return nombre.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/, '');
}

export const textoDispositivos = (n: number): string => (n === 1 ? '1 dispositivo activo' : `${n} dispositivos activos`);

export const ZONA_HORARIA_INICIAL = 'America/Santiago';

// Las zonas horarias que ofrece la lista: las que conoce el navegador y siempre «UTC» (algunos navegadores no la listan).
export function zonasHorarias(): string[] {
  let lista: string[];
  try { lista = Intl.supportedValuesOf('timeZone'); } catch { lista = [ZONA_HORARIA_INICIAL, 'America/Punta_Arenas']; }
  return lista.includes('UTC') ? lista : [...lista, 'UTC'];
}

// El valor inicial al crear un sitio: la zona del navegador SOLO si está en la lista de opciones (si no, el selector quedaría en blanco o con
// otra zona sin que se note); si no, la de Chile continental.
export function zonaInicial(opciones: readonly string[] = zonasHorarias()): string {
  let nav = '';
  try { nav = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* sin Intl: la de siempre */ }
  if (opciones.includes(nav)) return nav;
  return opciones.includes(ZONA_HORARIA_INICIAL) ? ZONA_HORARIA_INICIAL : (opciones[0] ?? ZONA_HORARIA_INICIAL);
}

// El texto de un error al crear o cambiar sitios y zonas: el motivo que escribió el servidor (409 «ya hay una zona…», «la zona tiene 3
// dispositivos activos…», 400 con cada campo), con mayúscula inicial; sin motivo, el mensaje general (sin conexión, sesión vencida).
export function textoDeError(e: unknown): string {
  if (e instanceof ErrorApi && e.motivos.length > 0 && e.codigo !== 401 && e.codigo !== 0) {
    const t = e.motivos.join('; ');
    return `${t.charAt(0).toUpperCase()}${t.slice(1)}${t.endsWith('.') ? '' : '.'}`;
  }
  return mensajeError(e);
}
