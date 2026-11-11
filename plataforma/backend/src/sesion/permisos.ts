// Tabla de permisos por acción y la única función que decide (docs/20 §5 y §6; docs/10 §8.4 punto 36). Ninguna ruta compara roles
// por su cuenta: llama a permitir() (o a exigir(), que la envuelve y lanza) con el sitio que resolvió el SERVIDOR a partir del
// recurso pedido (el dispositivo, el canal, la zona, la pasarela), nunca uno que venga en el cuerpo.
import { ForbiddenException, NotFoundException } from '@nestjs/common';

// Perfiles por sitio (docs/20 §2; desde el 11/11/2026, migración 24): el mismo CHECK que ck_usuario_sitio_rol. `administrador` es el de
// sitio y conserva el nombre de la migración 01. El administrador del sistema no es un rol por sitio: es `usuario.administrador_sistema`
// (alcance `todos`), y en la tabla aparece como el perfil `administrador_sistema`.
export const ROLES = ['administrador', 'investigador', 'operador', 'consulta'] as const;
export type Rol = (typeof ROLES)[number];
export const PERFIL_SISTEMA = 'administrador_sistema';
export const PERFILES = [...ROLES, PERFIL_SISTEMA] as const;
export type Perfil = (typeof PERFILES)[number];

// Acciones de la matriz de docs/20 §6 (una columna por perfil):
//   leer        GET de dispositivos, ficha, históricos, eventos, condiciones, cuarentena, pasarelas, sitios, resumen y el canal en vivo
//   exportar    GET /dispositivos/{id}/exportar (datos crudos, no públicos: docs/10 §8.4 punto 6): administrador de sitio e investigador
//   escribir    alta (de a uno y por lote), rotación de credenciales, calibración, pasarelas, bandeja de detectados
//   baja        DELETE /dispositivos/{id} y DELETE /pasarelas/{id} (el equipo deja de recibir datos): solo quien administra el sitio
//   configurar  PATCH /dispositivos/{id} y PUT /canales/{id}/reglas: operador técnico y administradores
//   usuarios    alta y cambios de usuarios y de sus perfiles (y ver el nombre de quien hizo un cambio: docs/21 §2)
//   enlaces     enlaces públicos del sitio (Etapa 4, §7)
//   auditoria   actividad del sitio (GET /sitios/{id}/actividad, P14)
//   sistema     lo global: soporte, estado del sistema, límites; solo el administrador del sistema (permitirGlobal)
export const ACCIONES = ['leer', 'exportar', 'escribir', 'baja', 'configurar', 'usuarios', 'enlaces', 'auditoria', 'sistema'] as const;
export type Accion = (typeof ACCIONES)[number];

const TODOS: readonly Perfil[] = PERFILES;
export const PERMISOS: Readonly<Record<Accion, readonly Perfil[]>> = {
  leer: TODOS,
  exportar: ['administrador', 'investigador', PERFIL_SISTEMA],
  escribir: ['operador', 'administrador', PERFIL_SISTEMA],
  baja: ['administrador', PERFIL_SISTEMA],
  configurar: ['operador', 'administrador', PERFIL_SISTEMA],
  usuarios: ['administrador', PERFIL_SISTEMA],
  enlaces: ['administrador', PERFIL_SISTEMA],
  auditoria: ['administrador', PERFIL_SISTEMA],
  sistema: [PERFIL_SISTEMA],
};

// La misma tabla vista por perfil (perfil → acciones que puede), para que el panel construya la guía de cada perfil a partir de ella y no de
// un texto escrito aparte que podría desincronizarse (docs/19 §6; decidido al implementar, 08/11/2026). Sale de PERMISOS: no es otra fuente.
export function matrizPorRol(): Record<Perfil, Accion[]> {
  const m = Object.fromEntries(PERFILES.map((r) => [r, [] as Accion[]])) as Record<Perfil, Accion[]>;
  for (const a of ACCIONES) for (const r of PERMISOS[a]) m[r].push(a);
  return m;
}

// Quién hace la petición. `todos` = alcance sobre todos los sitios: el administrador del sistema (una persona con
// `usuario.administrador_sistema`, desde el 11/11/2026) y el «usuario del sistema», que es la clave de administrador por cabecera
// (docs/20 §5; docs/10 §8.4 punto 41) mientras siga en el .env. Cualquier otra persona tiene `todos = false` y su alcance es exactamente
// su mapa de sitios.
export interface UsuarioSesion {
  id: string | null; // null en el usuario del sistema: no es una fila de `usuario`
  nombre: string;
  email: string | null;
  sistema: boolean;
  todos: boolean;
  sitios: ReadonlyMap<string, Rol>; // sitio_id → rol, solo accesos activos
  claveTemporal: boolean;
  terminosPendientes: boolean; // aceptó una versión de los términos menor que la vigente, o ninguna (docs/20 §12)
  sesionId: string | null; // hash de la sesión (null en el usuario del sistema)
}

// Un objeto NUEVO por petición (revisión del 08/11/2026): un objeto congelado compartido no congelaba su Map, y una escritura en una
// petición (un cast, un error futuro) se habría visto en todas las demás. Cada llamada entrega su propio mapa vacío.
export function usuarioSistema(): UsuarioSesion {
  return { id: null, nombre: 'sistema (clave de administrador)', email: null, sistema: true, todos: true, sitios: new Map<string, Rol>(), claveTemporal: false, terminosPendientes: false, sesionId: null };
}

export type Decision = 'permitido' | 'no_existe' | 'prohibido';

// `sitioId` null = el recurso no existe. Un recurso de otro sitio responde lo mismo que uno inexistente (RF-41: no se revela que
// existe); «prohibido» queda para «es tu sitio pero tu rol no puede» (403).
export function permitir(usuario: UsuarioSesion, accion: Accion, sitioId: string | null): Decision {
  if (sitioId === null) return 'no_existe';
  const rol: Perfil | undefined = usuario.todos ? PERFIL_SISTEMA : usuario.sitios.get(sitioId);
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
  if (usuario.todos) return PERMISOS[accion].includes(PERFIL_SISTEMA);
  for (const rol of usuario.sitios.values()) if (PERMISOS[accion].includes(rol)) return true;
  return false;
}
export function exigirEnAlguno(usuario: UsuarioSesion, accion: Accion): void {
  if (!puedeEnAlguno(usuario, accion)) throw new ForbiddenException('tu rol no permite hacer cambios');
}

// Lo global, sin sitio (soporte, estado del sistema, límites): solo el alcance `todos` (docs/20 §6, fila «Estado del sistema…»).
export function permitirGlobal(usuario: UsuarioSesion, accion: Accion): boolean {
  return usuario.todos && PERMISOS[accion].includes(PERFIL_SISTEMA);
}
export function exigirGlobal(usuario: UsuarioSesion, accion: Accion): void {
  if (!permitirGlobal(usuario, accion)) throw new ForbiddenException('solo el administrador del sistema puede hacer esto');
}

// Los sitios que entran al WHERE de una lista (docs/10 §8.4 punto 36): null = sin filtro (usuario del sistema). Para una persona, la
// lista de sus sitios (puede ir vacía: entonces la lista sale vacía, nunca sin filtro).
export function alcanceDeLectura(usuario: UsuarioSesion): string[] | null {
  return usuario.todos ? null : [...usuario.sitios.keys()];
}
