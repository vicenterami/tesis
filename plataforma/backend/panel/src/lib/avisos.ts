// Un error de la API convertido en un aviso para la persona (docs/19 §6: «errores con acción»). Una sola función para todas las
// pantallas nuevas: el 409 siempre dice «recarga», el 429 siempre dice cuánto esperar, sin red siempre dice «sin conexión».
import { ErrorApi, mensajeError } from './api';

export type TipoAviso = 'exito' | 'error' | 'conflicto' | 'espera' | 'info';
export interface DatosAviso {
  tipo: TipoAviso;
  texto: string;
}

export function avisoDeError(e: unknown): DatosAviso {
  if (!(e instanceof ErrorApi)) return { tipo: 'error', texto: mensajeError(e) };
  switch (e.codigo) {
    case 0:
      return { tipo: 'error', texto: 'Sin conexión con el servicio: revisa tu conexión y reintenta.' };
    case 409:
      return { tipo: 'conflicto', texto: `Alguien lo cambió entretanto: recarga para ver el valor nuevo.${e.motivos.length > 0 ? ` (${e.motivos.join('; ')})` : ''}` };
    case 429:
      return { tipo: 'espera', texto: e.reintentarEnS !== null ? `Demasiados intentos: espera ${e.reintentarEnS} s y reintenta.` : 'Demasiados intentos: espera un momento y reintenta.' };
    case 400:
      return { tipo: 'error', texto: e.motivos.length > 0 ? `Revisa los datos: ${e.motivos.join('; ')}.` : 'Revisa los datos.' };
    case 403:
      return { tipo: 'error', texto: e.motivos[0] ?? 'Tu rol en este sitio no lo permite.' };
    case 404:
      return { tipo: 'error', texto: 'Ya no existe o no es de tus sitios: recarga la lista.' };
    case 503: {
      // Si el servidor dice por qué (una consulta que pasó su tiempo máximo: «prueba con un rango más corto»), se muestra eso: es lo que
      // la persona puede hacer. Sin motivo (el cupo del canal en vivo, el proxy), el aviso general.
      const motivo = e.motivos.join('; ');
      return { tipo: 'espera', texto: motivo !== '' ? `${motivo.charAt(0).toUpperCase()}${motivo.slice(1)}.` : 'El servicio está saturado: reintenta en un momento.' };
    }
    default:
      return { tipo: 'error', texto: mensajeError(e) };
  }
}
