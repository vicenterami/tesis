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
  escribir: { puede: 'da de alta, da de baja y configura dispositivos, pasarelas y calibraciones', noPuede: 'no cambia nada' },
  usuarios: { puede: 'da de alta personas y les asigna su rol en sus sitios', noPuede: 'no administra personas' },
  // Desde el tablero v2 (docs/19 §4, E; servidor: PATCH /dispositivos/{id} y PUT /canales/{id}/reglas).
  configurar: { puede: 'configura nombre, estado, intervalo, zona y umbrales de los dispositivos', noPuede: 'no configura dispositivos ni umbrales' },
};

const NOMBRE_ROL: Readonly<Record<string, string>> = { administrador: 'Administrador', consulta: 'Consulta' };

// «a, b y c»
function enumerar(xs: readonly string[], ultima: string): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} ${ultima} ${xs[xs.length - 1]}`;
}

// Todas las acciones que la matriz conoce (la unión de las de cada rol), en el orden en que aparecen.
export function accionesDe(m: Matriz): string[] {
  return [...new Set(Object.values(m).flat())];
}

// «Consulta: ve dispositivos, históricos, condiciones y cuarentena de sus sitios; no exporta, no cambia nada ni administra personas.»
export function ayudaDeRol(rol: string, m: Matriz): string {
  const suyas = m[rol] ?? [];
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
