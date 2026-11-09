// Tabla de permisos por acción y la única función que decide (docs/20 §5 y §6; docs/10 §8.4 punto 36). Ninguna ruta compara roles
// por su cuenta: llama a permitir() (o a exigir(), que la envuelve y lanza) con el sitio que resolvió el SERVIDOR a partir del
// recurso pedido (el dispositivo, el canal, la zona, la pasarela), nunca uno que venga en el cuerpo.
import { ForbiddenException, NotFoundException } from '@nestjs/common';

export const ROLES = ['administrador', 'consulta'] as const; // RF-44; el mismo CHECK que ck_usuario_sitio_rol (migración 01)
export type Rol = (typeof ROLES)[number];

// Acciones de la matriz de docs/20 §6:
//   leer        GET de dispositivos, ficha, histórico, condiciones, cuarentena, pasarelas y el canal en vivo
//   exportar    GET /dispositivos/{id}/exportar (datos crudos: solo administrador, docs/10 §8.4 punto 6)
//   escribir    alta, baja, rotación de credenciales, calibración, pasarelas
//   usuarios    alta y cambios de usuarios y de sus roles
export const ACCIONES = ['leer', 'exportar', 'escribir', 'usuarios'] as const;
export type Accion = (typeof ACCIONES)[number];

export const PERMISOS: Readonly<Record<Accion, readonly Rol[]>> = {
  leer: ['administrador', 'consulta'],
  exportar: ['administrador'],
  escribir: ['administrador'],
  usuarios: ['administrador'],
};

// Quién hace la petición. `todos` = alcance sobre todos los sitios: solo el «usuario del sistema», que es la clave de administrador
// por cabecera (docs/20 §5; docs/10 §8.4 punto 41) mientras siga en el .env. Una persona con sesión siempre tiene `todos = false` y
// su alcance es exactamente su mapa de sitios.
export interface UsuarioSesion {
  id: string | null; // null en el usuario del sistema: no es una fila de `usuario`
  nombre: string;
  email: string | null;
  sistema: boolean;
  todos: boolean;
  sitios: ReadonlyMap<string, Rol>; // sitio_id → rol, solo accesos activos
  claveTemporal: boolean;
  sesionId: string | null; // hash de la sesión (null en el usuario del sistema)
}

// Un objeto NUEVO por petición (revisión del 08/11/2026): un objeto congelado compartido no congelaba su Map, y una escritura en una
// petición (un cast, un error futuro) se habría visto en todas las demás. Cada llamada entrega su propio mapa vacío.
export function usuarioSistema(): UsuarioSesion {
  return { id: null, nombre: 'sistema (clave de administrador)', email: null, sistema: true, todos: true, sitios: new Map<string, Rol>(), claveTemporal: false, sesionId: null };
}

export type Decision = 'permitido' | 'no_existe' | 'prohibido';

// `sitioId` null = el recurso no existe. Un recurso de otro sitio responde lo mismo que uno inexistente (RF-41: no se revela que
// existe); «prohibido» queda para «es tu sitio pero tu rol no puede» (403).
export function permitir(usuario: UsuarioSesion, accion: Accion, sitioId: string | null): Decision {
  if (sitioId === null) return 'no_existe';
  const rol: Rol | undefined = usuario.todos ? 'administrador' : usuario.sitios.get(sitioId);
  if (rol === undefined) return 'no_existe';
  return PERMISOS[accion].includes(rol) ? 'permitido' : 'prohibido';
}

// La misma decisión, convertida en la respuesta HTTP. `noEncontrado` es el mensaje del 404 («dispositivo no encontrado»): el mismo que
// da la consulta cuando el identificador no existe.
export function exigir(usuario: UsuarioSesion, accion: Accion, sitioId: string | null, noEncontrado: string): void {
  const d = permitir(usuario, accion, sitioId);
  if (d === 'no_existe') throw new NotFoundException(noEncontrado);
  if (d === 'prohibido') throw new ForbiddenException(`tu rol en este sitio no permite la acción «${accion}»`);
}

// ¿Puede hacer `accion` en algún sitio? Lo usan las rutas que escriben antes de validar el cuerpo: una persona sin ningún sitio de
// administrador recibe 403 sin aprender la forma del cuerpo (como la clave de administrador corría antes que la validación).
export function puedeEnAlguno(usuario: UsuarioSesion, accion: Accion): boolean {
  if (usuario.todos) return true;
  for (const rol of usuario.sitios.values()) if (PERMISOS[accion].includes(rol)) return true;
  return false;
}
export function exigirEnAlguno(usuario: UsuarioSesion, accion: Accion): void {
  if (!puedeEnAlguno(usuario, accion)) throw new ForbiddenException('tu rol no permite hacer cambios');
}

// Los sitios que entran al WHERE de una lista (docs/10 §8.4 punto 36): null = sin filtro (usuario del sistema). Para una persona, la
// lista de sus sitios (puede ir vacía: entonces la lista sale vacía, nunca sin filtro).
export function alcanceDeLectura(usuario: UsuarioSesion): string[] | null {
  return usuario.todos ? null : [...usuario.sitios.keys()];
}
