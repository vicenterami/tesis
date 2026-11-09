// Cuerpos de POST /usuarios y PATCH /usuarios/{id} (HU-18, RF-43, RF-44; docs/20 §4). Todo lo que llega es hostil: se valida antes de
// tocar la base y un cuerpo inválido es 400 con la lista de motivos, como en el alta de dispositivos. Lo que pone solo el sistema (la
// clave, que es temporal y se genera aquí; los instantes) no está en la entrada: ningún cliente puede mandarlo.
import { BadRequestException } from '@nestjs/common';
import { FORMA_ACTUALIZADO_EN } from '../alta/calibracion.dto';
import { ROLES, Rol } from './permisos';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// La misma forma que exige la base (ck_usuario_email, migración 22).
export const FORMA_EMAIL = /^[^@\s]+@[^@\s]+$/;
export const MAX_SITIOS = 50;

export interface AltaUsuario {
  nombre: string;
  email: string;
  sitios: { sitio_id: string; rol: Rol }[];
}
export interface CambioUsuario {
  actualizado_en: string; // bloqueo optimista (docs/10 §8.4 punto 28): el que entregó GET /usuarios, tal cual
  nombre?: string;
  activo?: boolean;
  clave_temporal?: true; // «olvidé mi clave»: asigna una temporal nueva (se muestra una vez)
  sitios?: { sitio_id: string; rol: Rol | null }[]; // rol null = quitarle ese sitio (baja lógica de usuario_sitio)
}

function objeto(cuerpo: unknown): Record<string, unknown> {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new BadRequestException(['el cuerpo debe ser un objeto JSON']);
  return cuerpo as Record<string, unknown>;
}

function nombre(v: unknown, motivos: string[]): string {
  if (typeof v !== 'string' || v.trim().length < 1 || v.trim().length > 80) motivos.push('nombre debe tener entre 1 y 80 caracteres');
  return typeof v === 'string' ? v.trim() : '';
}

function sitios(v: unknown, motivos: string[], admiteNulo: boolean): { sitio_id: string; rol: Rol | null }[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_SITIOS) {
    motivos.push(`sitios debe ser una lista de 1 a ${MAX_SITIOS} elementos {sitio_id, rol}`);
    return [];
  }
  const vistos = new Set<string>();
  const salida: { sitio_id: string; rol: Rol | null }[] = [];
  for (const [i, x] of v.entries()) {
    const e = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
    const id = typeof e.sitio_id === 'string' ? e.sitio_id.toLowerCase() : '';
    if (!UUID.test(id)) motivos.push(`sitios[${i}].sitio_id no es un UUID válido`);
    else if (vistos.has(id)) motivos.push(`sitios[${i}].sitio_id repetido`);
    vistos.add(id);
    const rolValido = (typeof e.rol === 'string' && (ROLES as readonly string[]).includes(e.rol)) || (admiteNulo && e.rol === null);
    if (!rolValido) motivos.push(`sitios[${i}].rol debe ser una de: ${ROLES.join(', ')}${admiteNulo ? ' (o null para quitar el sitio)' : ''}`);
    salida.push({ sitio_id: id, rol: (e.rol ?? null) as Rol | null });
  }
  return salida;
}

export function validarAltaUsuario(cuerpo: unknown): AltaUsuario {
  const c = objeto(cuerpo);
  const motivos: string[] = [];
  const n = nombre(c.nombre, motivos);
  const email = typeof c.email === 'string' ? c.email.trim().toLowerCase() : '';
  if (email.length < 3 || email.length > 254 || !FORMA_EMAIL.test(email)) motivos.push('email debe tener la forma nombre@dominio (hasta 254 caracteres)');
  const s = sitios(c.sitios, motivos, false);
  for (const k of Object.keys(c)) if (!['nombre', 'email', 'sitios'].includes(k)) motivos.push(`campo no admitido: ${k}`);
  if (motivos.length > 0) throw new BadRequestException(motivos);
  return { nombre: n, email, sitios: s as { sitio_id: string; rol: Rol }[] };
}

export function validarCambioUsuario(cuerpo: unknown): CambioUsuario {
  const c = objeto(cuerpo);
  const motivos: string[] = [];
  const a = c.actualizado_en;
  if (typeof a !== 'string' || !FORMA_ACTUALIZADO_EN.test(a) || Number.isNaN(new Date(a).getTime())) {
    motivos.push('actualizado_en es obligatorio: el instante ISO 8601 que entregó GET /usuarios para este usuario, tal cual');
  }
  const salida: CambioUsuario = { actualizado_en: a as string };
  if ('nombre' in c) salida.nombre = nombre(c.nombre, motivos);
  if ('activo' in c) {
    if (typeof c.activo !== 'boolean') motivos.push('activo debe ser true o false');
    else salida.activo = c.activo;
  }
  if ('clave_temporal' in c) {
    if (c.clave_temporal !== true) motivos.push('clave_temporal solo admite true (asigna una clave temporal nueva)');
    else salida.clave_temporal = true;
  }
  if ('sitios' in c) salida.sitios = sitios(c.sitios, motivos, true);
  for (const k of Object.keys(c)) if (!['actualizado_en', 'nombre', 'activo', 'clave_temporal', 'sitios'].includes(k)) motivos.push(`campo no admitido: ${k}`);
  if (motivos.length === 0 && Object.keys(c).length === 1) motivos.push('nada que cambiar: nombre, activo, clave_temporal o sitios');
  if (motivos.length > 0) throw new BadRequestException(motivos);
  return salida;
}
