// Página de privacidad (docs/21 §7; RF-54, HU-27): se arma desde el inventario de docs/21 §2 (inventario.ts, comparado con el documento
// por privacidad.spec.ts) y desde los apartados §3 a §6 y §8, resumidos aquí con su número para que quien lea pueda ir a la fuente. El
// responsable y su contacto salen de variables de entorno (docs/21 §6): RESPONSABLE_NOMBRE y RESPONSABLE_CONTACTO; mientras no estén, la
// página lo dice en vez de mostrar un contacto inventado. Ningún dato personal vive en el código.
import { INVENTARIO, FilaInventario } from './inventario.js';

export const PRIVACIDAD_VERSION = 1;
export const PRIVACIDAD_FECHA = '2026-11-11';
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

export const SECCIONES: readonly Seccion[] = [
  {
    titulo: 'Terceros (docs/21 §3)',
    parrafos: [
      'Ningún tercero recibe tus datos ni las mediciones: el panel no carga scripts, fuentes, estilos ni analítica de otros sitios, y el servidor no envía datos afuera.',
      'La red privada de administración y el vigilante externo reciben solo metadatos de operación (llaves públicas, un latido), nunca datos de personas ni mediciones.',
      'No hay correo saliente. Si algún día lo hay, el proveedor se agrega a esta página antes de usarlo.',
    ],
  },
  {
    titulo: 'Cookies y almacenamiento del navegador (docs/21 §4)',
    parrafos: [
      'Una sola cookie, `__Host-sesion`, estrictamente necesaria para la sesión (HttpOnly, Secure, SameSite=Lax). No hay cookies de analítica, de publicidad ni de terceros.',
      'El panel no guarda nada en el almacenamiento local del navegador: tus preferencias viven en la base y te siguen entre equipos.',
    ],
  },
  {
    titulo: 'Permisos del navegador (docs/21 §5)',
    parrafos: ['El panel no pide cámara, micrófono ni ubicación. Si se activan las notificaciones del navegador, se piden cuando tú las activas, nunca al cargar la página.'],
  },
  {
    titulo: 'Tus derechos (docs/21 §8)',
    parrafos: [
      'Acceso y portabilidad: «Mi cuenta» muestra tus datos y tus sesiones, y «Exportar mis datos» los descarga en JSON.',
      'Rectificación: el administrador corrige tu nombre; el correo, el administrador del sistema (es tu nombre de inicio de sesión).',
      'Supresión: «Darme de baja» anonimiza tu cuenta (nombre, correo y clave se borran; el historial del sitio queda sin tus datos). Los intentos de acceso y las sesiones se borran solos a los 90 días y los respaldos a los 30.',
      'Información y reclamo: el contacto del responsable (arriba) y el formulario de soporte.',
    ],
  },
];

export const AVISO_SIN_RESPONSABLE =
  'Quien opera esta instancia aún no configuró su nombre ni su contacto (docs/21 §6). Mientras tanto, usa el formulario de soporte: lo lee el administrador del sistema.';

export function privacidad(responsable: Responsable | null): Privacidad {
  return {
    version: PRIVACIDAD_VERSION, fecha: PRIVACIDAD_FECHA, responsable, aviso_responsable: responsable === null ? AVISO_SIN_RESPONSABLE : null,
    datos: INVENTARIO, secciones: [...SECCIONES],
  };
}
