// Usuarios del panel (HU-18, RF-43, RF-44; docs/20 §4 y §6): la forma que devuelve GET /usuarios (sesion/usuarios.service.ts) y los
// cuerpos de PATCH /usuarios/{id}, siempre con el `actualizado_en` que se leyó (bloqueo optimista: si otra persona lo cambió, 409).
import type { Rol } from './sesion';

export interface UsuarioListado {
  id: string;
  nombre: string;
  email: string;
  en_mis_sitios: boolean;
  activo: boolean;
  clave_temporal: boolean;
  clave_temporal_vence_en: string | null;
  sitios: { sitio_id: string; codigo: string; rol: Rol }[];
  creado_en: string;
  actualizado_en: string;
}
export interface UsuarioConClave extends UsuarioListado {
  clave: string; // la temporal: se muestra UNA vez
}

// La respuesta de PATCH /usuarios/{id} aplicada a la lista: si trae la temporal recién asignada, se separa y la fila se guarda SIN ella
// (la temporal vive solo en el aviso «una vez» hasta que se oculta; nunca en la lista, que dura mientras la pantalla esté abierta).
export function aplicarRespuesta(lista: readonly UsuarioListado[], r: UsuarioListado | UsuarioConClave): { lista: UsuarioListado[]; clave: string | null } {
  const { clave, ...fila } = r as UsuarioConClave;
  return { lista: lista.map((x) => (x.id === fila.id ? fila : x)), clave: typeof clave === 'string' ? clave : null };
}

export type CambioUsuario =
  | { actualizado_en: string; activo: boolean }
  | { actualizado_en: string; clave_temporal: true }
  | { actualizado_en: string; sitios: { sitio_id: string; rol: Rol | null }[] };

// El rol de la persona en un sitio (null = sin acceso a ese sitio).
export const rolEn = (u: UsuarioListado, sitioId: string): Rol | null => u.sitios.find((s) => s.sitio_id === sitioId)?.rol ?? null;

export const cambioActivo = (u: UsuarioListado, activo: boolean): CambioUsuario => ({ actualizado_en: u.actualizado_en, activo });
export const cambioTemporal = (u: UsuarioListado): CambioUsuario => ({ actualizado_en: u.actualizado_en, clave_temporal: true });
export const cambioRol = (u: UsuarioListado, sitioId: string, rol: Rol | null): CambioUsuario => ({ actualizado_en: u.actualizado_en, sitios: [{ sitio_id: sitioId, rol }] });

// Cuerpo del alta: el email en minúsculas y sin espacios, como lo guarda el servidor.
export function cuerpoAlta(nombre: string, email: string, sitioId: string, rol: Rol): { nombre: string; email: string; sitios: { sitio_id: string; rol: Rol }[] } {
  return { nombre: nombre.trim(), email: email.trim().toLowerCase(), sitios: [{ sitio_id: sitioId, rol }] };
}

// Lo que falta para poder dar de alta (vacío = se puede). La forma del correo es la misma que exige la base (ck_usuario_email).
export function motivosAlta(nombre: string, email: string, sitioId: string): string[] {
  const m: string[] = [];
  if (nombre.trim().length < 1 || nombre.trim().length > 80) m.push('el nombre debe tener entre 1 y 80 caracteres');
  if (!/^[^@\s]+@[^@\s]+$/.test(email.trim()) || email.trim().length > 254) m.push('el correo debe tener la forma nombre@dominio');
  if (sitioId === '') m.push('elige el sitio');
  return m;
}
