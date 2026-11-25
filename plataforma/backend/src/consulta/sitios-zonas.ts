// Sitios y zonas desde el panel (docs/19 §4 bloques U y U2; docs/20 §6; migración 28): la validación de los cuerpos de POST /sitios,
// PATCH /sitios/{id}, POST /sitios/{id}/zonas y PATCH /zonas/{id}, y la clave con que el backend compara nombres de zona en memoria. Sin
// base ni Nest más allá de la excepción: cada caso con su prueba (sitios-zonas.spec.ts). Lo que solo sabe la base (si la zona horaria
// existe en pg_timezone_names; si un nombre de zona ya existe según lower(btrim()) de PostgreSQL) lo pregunta el servicio a la base.
// Las constantes MAX_* y FORMA_CODIGO_SITIO se repiten en el panel (panel/src/lib/estructura.ts): el guardián compara que digan lo mismo.
import { BadRequestException } from '@nestjs/common';

// La regla de ck_sitio_codigo (migración 11): es el segmento del tópico `sitio/<codigo>/…`.
export const FORMA_CODIGO_SITIO = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const MAX_NOMBRE_SITIO = 80;
export const MAX_DESCRIPCION_SITIO = 500;
export const MAX_NOMBRE_ZONA = 80;
export const ZONA_INICIAL_POR_OMISION = 'General';

export interface SitioNuevo { nombre: string; codigo: string; zona_horaria: string; primera_zona: string; descripcion: string | null }
export interface CambioSitio { nombre?: string; descripcion?: string | null }
export interface CambioZona { nombre?: string; activo?: boolean }

// La forma de una zona horaria: aquí solo la forma de un nombre IANA; si existe lo decide la base (pg_timezone_names, la misma lista del
// disparador validar_zona_horaria de la migración 03), en SitiosZonasService.crearSitio. Una sola fuente: la lista de Node (Intl) no es la
// de la base, y un nombre que una conoce y la otra no saldría como error del servidor.
export const FORMA_ZONA_HORARIA = /^[A-Za-z0-9_+\-/]{1,64}$/;

// La clave con que el backend compara dos nombres de zona en memoria (el alta masiva: las filas entre sí y contra el catálogo): sin
// espacios en los extremos y en minúsculas, la forma del índice uq_zona_sitio_nombre_normalizado (migración 28) escrita en JS. Es una
// aproximación: toLowerCase de JS y lower() de PostgreSQL no coinciden en todo Unicode, y trim() quita más blancos que btrim(); por eso,
// antes de crear zonas, la base dice con su propia normalización cuáles ya existen y cuáles son la misma (AltaService.zonasEnLaBase).
export const claveZona = (nombre: string): string => nombre.trim().toLowerCase();

// Caracteres de formato invisibles (Unicode Cf: ancho cero, marcas e inversiones bidireccionales): un nombre que los trae se ve igual
// que otro y no lo es.
// Control (Cc) y los separadores de línea y de párrafo de Unicode (U+2028 y U+2029, Zl y Zp): también parten la línea.
export const CONTROL_O_LINEA = /[\p{Cc}\p{Zl}\p{Zp}]/u;
export const INVISIBLE = /\p{Cf}/u;
export const TEXTO_INVISIBLE = 'trae un carácter invisible que no se admite';

// Un nombre de zona o de sitio: texto imprimible, sin espacios en los extremos (se recortan) ni vacío, hasta `max` caracteres. Devuelve el
// motivo, o null si sirve.
function motivoNombre(v: unknown, campo: string, max: number): string | null {
  if (typeof v !== 'string') return `${campo}: escríbelo como texto`;
  const t = v.trim();
  if (t.length === 0) return `${campo}: no puede quedar vacío`;
  if ([...t].length > max) return `${campo}: hasta ${max} caracteres`;
  if (CONTROL_O_LINEA.test(t)) return `${campo}: trae un carácter de control que no se admite`;
  if (INVISIBLE.test(t)) return `${campo}: ${TEXTO_INVISIBLE}`;
  return null;
}

function objeto(cuerpo: unknown): Record<string, unknown> {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new BadRequestException(['el cuerpo debe ser un objeto JSON']);
  return cuerpo as Record<string, unknown>;
}

const sobrantes = (c: Record<string, unknown>, admitidos: readonly string[]): string[] =>
  Object.keys(c).filter((k) => !admitidos.includes(k)).map((k) => `campo no admitido: ${k}`);

// La descripción de un sitio: texto de hasta MAX_DESCRIPCION_SITIO caracteres, recortado; vacía o null = sin descripción. Devuelve el
// motivo, o null si sirve.
function motivoDescripcion(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return 'descripción: escríbela como texto';
  if ([...v.trim()].length > MAX_DESCRIPCION_SITIO) return `descripción: hasta ${MAX_DESCRIPCION_SITIO} caracteres`;
  // Una sola línea (el panel la escribe en un campo de una línea): ningún carácter de control, ni siquiera el salto de línea (un NUL,
  // además, lo rechaza la base), ni de formato invisible.
  if (CONTROL_O_LINEA.test(v)) return 'descripción: trae un carácter de control que no se admite';
  if (INVISIBLE.test(v)) return `descripción: ${TEXTO_INVISIBLE}`;
  return null;
}
const descripcionLimpia = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

// POST /sitios: `{nombre, codigo, zona_horaria, primera_zona?, descripcion?}`. La primera zona es «General» si no viene.
export function validarSitioNuevo(cuerpo: unknown): SitioNuevo {
  const c = objeto(cuerpo);
  const motivos = sobrantes(c, ['nombre', 'codigo', 'zona_horaria', 'primera_zona', 'descripcion']);
  const mn = motivoNombre(c.nombre, 'nombre del sitio', MAX_NOMBRE_SITIO);
  if (mn !== null) motivos.push(mn);
  if (typeof c.codigo !== 'string' || !FORMA_CODIGO_SITIO.test(c.codigo)) {
    motivos.push('código: de 2 a 63 caracteres, minúsculas sin tildes, números y guiones, que empiece con letra o número (va en el tópico sitio/<código>/…)');
  }
  if (typeof c.zona_horaria !== 'string' || !FORMA_ZONA_HORARIA.test(c.zona_horaria)) motivos.push('zona horaria: un nombre IANA, como America/Santiago');
  const primera = c.primera_zona === undefined ? ZONA_INICIAL_POR_OMISION : c.primera_zona;
  const mz = motivoNombre(primera, 'primera zona', MAX_NOMBRE_ZONA);
  if (mz !== null) motivos.push(mz);
  const md = motivoDescripcion(c.descripcion);
  if (md !== null) motivos.push(md);
  if (motivos.length > 0) throw new BadRequestException(motivos);
  return {
    nombre: (c.nombre as string).trim(), codigo: c.codigo as string, zona_horaria: c.zona_horaria as string, primera_zona: (primera as string).trim(),
    descripcion: descripcionLimpia(c.descripcion),
  };
}

// PATCH /sitios/{id}: `{nombre?, descripcion?}` (al menos uno; el código y la zona horaria no cambian: el código va en los tópicos y la zona
// horaria cambiaría el «día» de toda la historia). `descripcion: null` o vacía la borra.
export function validarCambioSitio(cuerpo: unknown): CambioSitio {
  const c = objeto(cuerpo);
  const motivos = sobrantes(c, ['nombre', 'descripcion']);
  if (c.nombre === undefined && c.descripcion === undefined) motivos.push('nada que cambiar: manda nombre o descripcion');
  if (c.nombre !== undefined) {
    const m = motivoNombre(c.nombre, 'nombre del sitio', MAX_NOMBRE_SITIO);
    if (m !== null) motivos.push(m);
  }
  const md = motivoDescripcion(c.descripcion);
  if (md !== null) motivos.push(md);
  if (motivos.length > 0) throw new BadRequestException(motivos);
  const r: CambioSitio = {};
  if (c.nombre !== undefined) r.nombre = (c.nombre as string).trim();
  if (c.descripcion !== undefined) r.descripcion = descripcionLimpia(c.descripcion);
  return r;
}

// POST /sitios/{id}/zonas: `{nombre}`.
export function validarZonaNueva(cuerpo: unknown): string {
  const c = objeto(cuerpo);
  const motivos = sobrantes(c, ['nombre']);
  const m = motivoNombre(c.nombre, 'nombre de la zona', MAX_NOMBRE_ZONA);
  if (m !== null) motivos.push(m);
  if (motivos.length > 0) throw new BadRequestException(motivos);
  return (c.nombre as string).trim();
}

// PATCH /zonas/{id}: `{nombre?, activo?}` (al menos uno). `activo: false` la retira; `true` la vuelve a ofrecer.
export function validarCambioZona(cuerpo: unknown): CambioZona {
  const c = objeto(cuerpo);
  const motivos = sobrantes(c, ['nombre', 'activo']);
  if (c.nombre === undefined && c.activo === undefined) motivos.push('nada que cambiar: manda nombre o activo');
  if (c.nombre !== undefined) {
    const m = motivoNombre(c.nombre, 'nombre de la zona', MAX_NOMBRE_ZONA);
    if (m !== null) motivos.push(m);
  }
  if (c.activo !== undefined && typeof c.activo !== 'boolean') motivos.push('activo: true o false');
  if (motivos.length > 0) throw new BadRequestException(motivos);
  const r: CambioZona = {};
  if (c.nombre !== undefined) r.nombre = (c.nombre as string).trim();
  if (c.activo !== undefined) r.activo = c.activo as boolean;
  return r;
}

// Los textos de los 409, en palabras de la persona (docs/19 §4 S, punto 4).
export const ZONA_REPETIDA = (nombre: string): string => `ya hay una zona «${nombre}» en este sitio (sin distinguir mayúsculas)`;
export const ZONA_RETIRADA = (nombre: string): string =>
  `ya existe una zona «${nombre}» retirada en este sitio: vuelve a ofrecerla en Ajustes del sitio → Zonas en vez de crear otra`;
export const ZONA_HORARIA_DESCONOCIDA = (z: string): string => `zona horaria: la base no conoce «${z}»; elige un nombre IANA, como America/Santiago`;
export const EN_CURSO = 'otro cambio sobre este sitio o esta zona está en curso; vuelve a intentarlo';
export const CODIGO_REPETIDO = (codigo: string): string => `ya existe un sitio con el código «${codigo}»: elige otro`;
export const ZONA_CON_DISPOSITIVOS = (n: number): string =>
  `la zona tiene ${n} dispositivo${n === 1 ? '' : 's'} activo${n === 1 ? '' : 's'}: muévelo${n === 1 ? '' : 's'} de zona o da${n === 1 ? 'lo' : 'los'} de baja antes de retirarla`;
