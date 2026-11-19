// Términos de uso (docs/21 §7; docs/20 §12; RF-53, HU-27). La versión vigente es esta constante: subirla obliga a todas las personas a
// aceptar de nuevo en su siguiente petición (la sesión queda restringida mientras `usuario.terminos_version_aceptada` sea menor). Cambiar
// el texto sin subir la versión no obligaría a nadie: por eso TODO cambio del texto, también una errata, sube la versión y la fecha
// (decidido el 18/11/2026, docs/21 §7). No depende de acordarse: `huellaTerminos()` calcula el SHA-256 del texto y legal.spec.ts lo compara
// con la última fila de «Historial de los términos» en docs/21 §7; el paso 2w7 del verificador impide reescribir las filas ya publicadas.
// Sin datos personales: el responsable y su contacto los pone la página de privacidad desde las variables de entorno (privacidad.ts).
import { huella } from './huella.js';

export const TERMINOS_VERSION = 1;
export const TERMINOS_FECHA = '2026-11-11';

// Markdown simple (títulos con «##», párrafos y listas con «-»): el panel lo muestra como texto, sin HTML.
export const TERMINOS_TEXTO = `## Qué es este servicio
Un sistema para registrar, gestionar y monitorear dispositivos IoT y sus mediciones ambientales. Es un **prototipo** desarrollado como
trabajo de título: no tiene compromiso de disponibilidad, de tiempo de respuesta ni de conservación de los datos más allá de lo que dice
la página de privacidad.

## Tu cuenta
- La cuenta es personal: la clave no se comparte ni se anota donde otra persona pueda leerla.
- Lo que hagas con tu cuenta queda registrado con tu nombre en la actividad del sitio (quién cambió qué y cuándo).
- Si crees que alguien usó tu cuenta, cambia la clave y cierra tus sesiones abiertas desde «Mi cuenta».

## Uso aceptable
- No intentes probar la seguridad del sistema sin una autorización escrita de quien lo opera.
- No cargues datos de otras personas ni de otros sitios sin su permiso.
- No uses el sistema para fines distintos del monitoreo de los dispositivos de tus sitios.

## Los datos
- Los datos de un sitio pertenecen a la organización del sitio y se pueden exportar siempre, según tu perfil.
- Qué datos tuyos se guardan, para qué y por cuánto tiempo está en la página de privacidad.
- Puedes darte de baja: tus datos personales se anonimizan y el historial del sitio se conserva sin ellos.

## Licencia
El código del sistema se publica bajo la licencia AGPL-3.0-only. Los avisos de las bibliotecas de terceros y el enlace al código fuente
están en «Acerca de».

## Cambios
Si estos términos cambian, la versión sube y el sistema te pedirá aceptarlos de nuevo antes de seguir.`;

// Huella del texto de los términos (todo el texto servido; versión y fecha quedan fuera): ver huella.ts.
export function huellaTerminos(): string { return huella({ texto: TERMINOS_TEXTO }); }

export interface Terminos {
  version: number;
  fecha: string;
  texto: string;
}
export function terminos(): Terminos {
  return { version: TERMINOS_VERSION, fecha: TERMINOS_FECHA, texto: TERMINOS_TEXTO };
}

// ¿Debe aceptar? Ninguna versión aceptada, o una menor que la vigente (docs/20 §12).
export function terminosPendientes(aceptada: number | null, vigente: number = TERMINOS_VERSION): boolean {
  return aceptada === null || aceptada < vigente;
}
