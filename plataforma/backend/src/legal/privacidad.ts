// Página de privacidad (docs/21 §7; RF-54, HU-27): se arma desde el inventario para personas de docs/21 §2.1 (inventario.ts, comparado con
// el documento por legal.spec.ts) y desde los apartados §3, §4, §5 y §8, resumidos aquí. Lo que viaja a la pantalla es texto para quien
// lee: sin rutas de documentos, funciones, variables, fichas ni etapas (la trazabilidad vive en docs/21 §2; legal.spec.ts lo comprueba). El
// responsable y su contacto salen de variables de entorno (docs/21 §6): RESPONSABLE_NOMBRE y RESPONSABLE_CONTACTO; mientras no estén, la
// página lo dice en vez de mostrar un contacto inventado. Ningún dato personal vive en el código.
import { INACTIVIDAD_MS, VIDA_ABSOLUTA_MS } from '../sesion/cookie.js';
import { huella } from './huella.js';
import { INVENTARIO, FilaInventario } from './inventario.js';

// Versión y fecha del texto (decidido el 18/11/2026, docs/21 §7): TODO cambio del texto que viaja a la pantalla (el inventario, los apartados y
// el aviso sin responsable; lo que no depende de la instancia) sube la versión en 1 y pone la fecha del cambio, también una errata. No
// depende de acordarse: `huellaPrivacidad()` calcula el SHA-256 de ese texto y legal.spec.ts lo compara con la última fila del historial de
// docs/21 §7 («Historial de la privacidad»); si el texto cambió sin subir la versión y agregar la fila, `pnpm test` falla. El paso 2w7 del
// verificador impide además reescribir las filas ya publicadas. El contenido de la subida va primero en esa fila, después aquí.
export const PRIVACIDAD_VERSION = 3;
export const PRIVACIDAD_FECHA = '2026-11-18';
export const MAX_RESPONSABLE = 200;

export interface Responsable { nombre: string; contacto: string }
export interface Seccion { titulo: string; parrafos: string[] }
export interface Privacidad {
  version: number;
  fecha: string;
  responsable: Responsable | null;
  aviso_responsable: string | null;
  datos: readonly FilaInventario[];
  secciones: Seccion[];
}

// Texto de una variable: sin saltos de línea ni caracteres de control, acotado. Vacía o ausente → null.
export function textoDeEntorno(v: string | undefined): string | null {
  if (v === undefined) return null;
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return t === '' ? null : t.slice(0, MAX_RESPONSABLE);
}

export function responsableDeEntorno(nombre: string | undefined, contacto: string | undefined): Responsable | null {
  const n = textoDeEntorno(nombre);
  const c = textoDeEntorno(contacto);
  return n === null || c === null ? null : { nombre: n, contacto: c };
}

// Un plazo en palabras, calculado de las constantes de la sesión (sesion/cookie.ts): el texto no puede decir 30 si el código dice otra cosa.
export function plazo(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min % 60 === 0) return `${min / 60} ${min === 60 ? 'hora' : 'horas'}`;
  return `${min} ${min === 1 ? 'minuto' : 'minutos'}`;
}

export const SECCIONES: readonly Seccion[] = [
  {
    titulo: 'Terceros',
    parrafos: [
      'Ningún tercero recibe tus datos ni las mediciones: el panel no carga scripts, fuentes, estilos ni analítica de otros sitios, y el servidor no envía datos afuera.',
      'La red privada de administración y el vigilante externo reciben solo metadatos de operación (llaves públicas, un latido), nunca datos de personas ni mediciones.',
      'No hay correo saliente. Si algún día lo hay, el proveedor se agrega a esta página antes de usarlo.',
    ],
  },
  {
    titulo: 'Cookies y almacenamiento del navegador',
    parrafos: [
      'Una sola cookie, `__Host-sesion`, estrictamente necesaria para la sesión (HttpOnly, Secure, SameSite=Lax). No hay cookies de analítica, de publicidad ni de terceros.',
      `La sesión vence a los ${plazo(INACTIVIDAD_MS)} sin actividad o a las ${plazo(VIDA_ABSOLUTA_MS)} de abierta, lo que ocurra primero; la cookie se borra al salir o al cerrar el navegador.`,
      'El panel no guarda nada en el almacenamiento local del navegador: tus preferencias viven en la base y te siguen entre equipos.',
    ],
  },
  {
    titulo: 'Permisos del navegador',
    parrafos: ['El panel no pide cámara, micrófono ni ubicación. Si se activan las notificaciones del navegador, se piden cuando tú las activas, nunca al cargar la página.'],
  },
  {
    titulo: 'Tus derechos',
    parrafos: [
      'Acceso y portabilidad: «Mi cuenta» muestra tus datos y tus sesiones, y «Exportar mis datos» los descarga en JSON.',
      'Rectificación: el administrador corrige tu nombre; el correo, el administrador del sistema (es tu nombre de inicio de sesión).',
      'Supresión: «Darme de baja» anonimiza tu cuenta (nombre, correo y clave se borran; el historial del sitio queda sin tus datos). Los intentos de acceso y las sesiones se borran solos a los 90 días y los respaldos a los 30.',
      'Información y reclamo: el contacto del responsable (arriba) y el formulario de soporte.',
    ],
  },
];

export const AVISO_SIN_RESPONSABLE =
  'Quien opera esta instancia aún no configuró su nombre ni su contacto. Mientras tanto, usa el formulario de soporte: lo lee el administrador del sistema.';

export function privacidad(responsable: Responsable | null): Privacidad {
  return {
    version: PRIVACIDAD_VERSION, fecha: PRIVACIDAD_FECHA, responsable, aviso_responsable: responsable === null ? AVISO_SIN_RESPONSABLE : null,
    datos: INVENTARIO, secciones: [...SECCIONES],
  };
}

// Huella del texto que lee la persona: el inventario, los apartados y el aviso sin responsable. Deja fuera lo que depende de la instancia
// (responsable, contacto) y lo que no es texto (versión y fecha): ver huella.ts.
export function huellaPrivacidad(): string {
  return huella({ datos: INVENTARIO, secciones: SECCIONES, aviso_sin_responsable: AVISO_SIN_RESPONSABLE });
}
