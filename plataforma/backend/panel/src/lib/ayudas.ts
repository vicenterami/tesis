// Guía de perfiles derivada de la matriz de permisos (docs/19 §6; docs/20 §6). El texto de ayuda de cada rol NO se escribe a mano: se
// arma con las acciones que la matriz del servidor (`GET /sesion` → `permisos`, que sale de PERMISOS en sesion/permisos.ts) le da a
// ese rol, con una frase por acción de este diccionario. Si mañana el servidor le da «exportar» a consulta, la ayuda lo dice sola; si
// aparece una acción que el diccionario no conoce, se nombra tal cual (nunca se calla) y la prueba de este archivo falla.
import type { Matriz } from './sesion';

interface Frase {
  puede: string;
  noPuede: string;
}
export const FRASES: Readonly<Record<string, Frase>> = {
  leer: { puede: 've dispositivos, históricos, condiciones y cuarentena de sus sitios', noPuede: 'no ve los datos de sus sitios' },
  exportar: { puede: 'exporta las mediciones crudas', noPuede: 'no exporta' },
  // La baja es otra acción (`baja`, solo administradores): corrección del 11/11/2026, antes la guía del operador técnico decía que da de baja.
  escribir: { puede: 'da de alta y calibra dispositivos y pasarelas', noPuede: 'no cambia nada' },
  usuarios: { puede: 'da de alta personas y les asigna su rol en sus sitios', noPuede: 'no administra personas' },
  // Desde el tablero v2 (docs/19 §4, E; servidor: PATCH /dispositivos/{id} y PUT /canales/{id}/reglas).
  configurar: { puede: 'configura nombre, estado, intervalo, zona y umbrales de los dispositivos', noPuede: 'no configura dispositivos ni umbrales' },
  // Los cinco perfiles (docs/20 §2 y §6; servidor: ACCIONES de sesion/permisos.ts, 11/11/2026).
  baja: { puede: 'da de baja dispositivos (revoca sus credenciales)', noPuede: 'no da de baja dispositivos' },
  enlaces: { puede: 'crea y revoca los enlaces públicos de solo lectura del sitio', noPuede: 'no administra enlaces públicos' },
  auditoria: { puede: 've la actividad de las personas en sus sitios', noPuede: 'no ve la actividad de las personas' },
  sistema: { puede: 'administra el sistema: soporte, estado y límites de los servicios', noPuede: 'no administra el sistema' },
};

const NOMBRE_ROL: Readonly<Record<string, string>> = { administrador: 'Administrador', consulta: 'Consulta', investigador: 'Investigación', operador: 'Operación técnica' };

// «a, b y c»
function enumerar(xs: readonly string[], ultima: string): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} ${ultima} ${xs[xs.length - 1]}`;
}

// Acciones de la matriz que aún no tienen ninguna ruta (los enlaces públicos son de la Etapa 4, docs/19 §7): la guía no las ofrece ni las
// niega mientras no existan (corrección del 11/11/2026). Al construir la ruta, se quita de aquí.
export const SIN_RUTA_TODAVIA: readonly string[] = ['enlaces'];

// Todas las acciones que la matriz conoce (la unión de las de cada rol), en el orden en que aparecen, sin las que aún no tienen ruta.
export function accionesDe(m: Matriz): string[] {
  return [...new Set(Object.values(m).flat())].filter((a) => !SIN_RUTA_TODAVIA.includes(a));
}

// «Consulta: ve dispositivos, históricos, condiciones y cuarentena de sus sitios; no exporta, no cambia nada ni administra personas.»
export function ayudaDeRol(rol: string, m: Matriz): string {
  const suyas = (m[rol] ?? []).filter((a) => !SIN_RUTA_TODAVIA.includes(a));
  const todas = accionesDe(m);
  const si = suyas.map((a) => FRASES[a]?.puede ?? `puede «${a}»`);
  const no = todas.filter((a) => !suyas.includes(a)).map((a) => FRASES[a]?.noPuede ?? `no puede «${a}»`);
  // «no exporta, no cambia nada ni administra personas»: la última negación se une con «ni» y pierde su «no».
  const negaciones = no.length <= 1 ? no.join('') : `${no.slice(0, -1).join(', ')} ni ${no[no.length - 1]!.replace(/^no /, '')}`;
  const partes = [si.length > 0 ? enumerar(si, 'y') : 'no puede nada', negaciones].filter((x) => x !== '');
  return `${NOMBRE_ROL[rol] ?? rol}: ${partes.join('; ')}.`;
}

// La mini guía de la pantalla de usuarios: una línea por rol, en el orden de la matriz.
export function guiaDePerfiles(m: Matriz): { rol: string; texto: string }[] {
  return Object.keys(m).map((rol) => ({ rol, texto: ayudaDeRol(rol, m) }));
}
