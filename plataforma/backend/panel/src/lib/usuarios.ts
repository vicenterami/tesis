// Usuarios del panel (HU-18, RF-43, RF-44; docs/20 §4 y §6): la forma que devuelve GET /usuarios (sesion/usuarios.service.ts) y los
// cuerpos de PATCH /usuarios/{id}, siempre con el `actualizado_en` que se leyó (bloqueo optimista: si otra persona lo cambió, 409).
import type { Rol } from './sesion';

export interface UsuarioListado {
  id: string;
  nombre: string;
  email: string;
  en_mis_sitios: boolean;
  activo: boolean;
  administrador_sistema?: boolean; // perfil global (docs/20 §2): su cuenta solo la cambia otro administrador del sistema
  motivo_baja?: string | null;
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

// Los cuerpos que acepta el servidor (sesion/usuarios.dto.ts): la baja lleva su motivo (1–300; migración 24) y la reactivación, una clave
// temporal nueva en la misma petición (revisión del 11/11/2026: la clave de antes no vuelve).
export type CambioUsuario =
  | { actualizado_en: string; activo: false; motivo: string }
  | { actualizado_en: string; activo: true; clave_temporal: true }
  | { actualizado_en: string; clave_temporal: true }
  | { actualizado_en: string; sitios: { sitio_id: string; rol: Rol | null }[] };

// Los cuatro perfiles por sitio (docs/20 §2; el mismo orden que sesion/permisos.ts ROLES, de menos a más): el selector los ofrece todos.
export const ROLES_DE_SITIO: readonly Rol[] = ['consulta', 'investigador', 'operador', 'administrador'];
export const MAX_MOTIVO = 300; // el mismo tope que ck_usuario_motivo_baja (migración 24)
// El motivo es texto libre que queda en la cuenta y en el registro de cambios (docs/21 §2): se pide sin datos de nadie.
export const AVISO_MOTIVO = 'Escribe la razón sin nombres ni datos personales: queda en el registro de cambios.';

// El rol de la persona en un sitio (null = sin acceso a ese sitio).
export const rolEn = (u: UsuarioListado, sitioId: string): Rol | null => u.sitios.find((s) => s.sitio_id === sitioId)?.rol ?? null;

export const cambioBaja = (u: UsuarioListado, motivo: string): CambioUsuario => ({ actualizado_en: u.actualizado_en, activo: false, motivo: motivo.trim() });
export const cambioReactivar = (u: Pick<UsuarioListado, 'actualizado_en'>): CambioUsuario => ({ actualizado_en: u.actualizado_en, activo: true, clave_temporal: true });
export const cambioTemporal = (u: UsuarioListado): CambioUsuario => ({ actualizado_en: u.actualizado_en, clave_temporal: true });
export const cambioRol = (u: UsuarioListado, sitioId: string, rol: Rol | null): CambioUsuario => ({ actualizado_en: u.actualizado_en, sitios: [{ sitio_id: sitioId, rol }] });

// Lo que falta para confirmar una baja (null = se puede): el mismo rango que valida el servidor.
export function motivoDeBajaInvalido(motivo: string): string | null {
  const m = motivo.trim().length;
  return m < 1 ? 'escribe el motivo de la baja' : m > MAX_MOTIVO ? `el motivo admite hasta ${MAX_MOTIVO} caracteres` : null;
}

// Cuerpo del alta: el email en minúsculas y sin espacios, como lo guarda el servidor. Con el perfil global (solo lo da un administrador
// del sistema), el sitio es opcional.
export interface CuerpoAlta { nombre: string; email: string; sitios: { sitio_id: string; rol: Rol }[]; administrador_sistema?: true }
export function cuerpoAlta(nombre: string, email: string, sitioId: string, rol: Rol, global = false): CuerpoAlta {
  const c: CuerpoAlta = { nombre: nombre.trim(), email: email.trim().toLowerCase(), sitios: sitioId === '' ? [] : [{ sitio_id: sitioId, rol }] };
  if (global) c.administrador_sistema = true;
  return c;
}

// Lo que falta para poder dar de alta (vacío = se puede). La forma del correo es la misma que exige la base (ck_usuario_email).
export function motivosAlta(nombre: string, email: string, sitioId: string, global = false): string[] {
  const m: string[] = [];
  if (nombre.trim().length < 1 || nombre.trim().length > 80) m.push('el nombre debe tener entre 1 y 80 caracteres');
  if (!/^[^@\s]+@[^@\s]+$/.test(email.trim()) || email.trim().length > 254) m.push('el correo debe tener la forma nombre@dominio');
  if (sitioId === '' && !global) m.push('elige el sitio');
  return m;
}

// El 409 del alta cuando el correo es de una cuenta inactiva que quien pregunta puede ver (usuarios.service.ts, exigirCorreoLibre): trae la
// ficha con `reactivable: true` y el panel ofrece «Reactivar» en vez de crear otra. Cualquier otro error → null.
export function reactivableDe(cuerpo: Readonly<Record<string, unknown>> | undefined): UsuarioListado | null {
  if (cuerpo?.reactivable !== true) return null;
  const u = cuerpo.usuario as UsuarioListado | undefined;
  return typeof u === 'object' && u !== null && typeof u.id === 'string' && typeof u.actualizado_en === 'string' ? u : null;
}
