// Recetas de decodificación por API (TT-12, bloque 5; docs/10 §8.4 punto 69 vi a viii; docs/19 §4, T, puntos 5 a 7; docs/20 §6). La forma
// de la receta la valida `erroresDeReceta` (receta.ts), el MISMO validador para crearla y para probarla sin guardar: lo que se prueba es lo
// que se podría guardar. Aquí, lo que es solo de la API: el nombre obligatorio al crear, los bytes de prueba y el «reemplazar por».
import { RECETA_CODIGO, erroresDeReceta } from '../recepcion/adaptadores/receta.js';
import { Error400, rechazo } from './configuracion.dto.js';

export interface CampoDefinido { magnitud: string; desplazamiento: number; tipo: string; sumar_antes?: number; multiplicar_por?: number; dividir_por?: number }
export interface RecetaDefinida { codigo: string; nombre: string; largo_bytes: number; campos: CampoDefinido[] }
export const MAX_TEXTO_BYTES = 1024; // 255 bytes en hexadecimal con un espacio entre cada uno ocupan 764 caracteres

const comoErrores = (motivos: readonly string[]): Error400[] => motivos.map((m) => {
  const i = m.indexOf(': ');
  return i > 0 ? { campo: m.slice(0, i), motivo: m.slice(i + 2) } : { campo: '(receta)', motivo: m };
});

// POST /recetas-decodificacion: la receta con su nombre (de 1 a 120, como ck_receta_decodificacion_nombre).
export function validarRecetaNueva(cuerpo: unknown): RecetaDefinida {
  const errores = comoErrores(erroresDeReceta(cuerpo));
  const c = (typeof cuerpo === 'object' && cuerpo !== null ? cuerpo : {}) as Record<string, unknown>;
  if (c.nombre === undefined) errores.push({ campo: 'nombre', motivo: 'obligatorio: de 1 a 120 caracteres' });
  if (errores.length > 0) throw rechazo(errores);
  return { ...(c as unknown as RecetaDefinida), nombre: String(c.nombre).trim() };
}

// POST /recetas-decodificacion/probar: `{receta, bytes, codificacion}`. La receta, con el validador de crear; sin código todavía (se está
// escribiendo), se prueba como «prueba». Los bytes, en hexadecimal (espacios entre bytes admitidos) o en base64, sin adivinar cuál: «deadbeef»
// es válido en los dos (docs/19 §4, T, punto 6).
export interface Prueba { receta: RecetaDefinida; bytes: Buffer }
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
export function validarPrueba(cuerpo: unknown): Prueba {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw rechazo([{ campo: '(cuerpo)', motivo: 'debe ser un objeto JSON: {receta, bytes, codificacion}' }]);
  const c = cuerpo as Record<string, unknown>;
  const errores: Error400[] = [];
  for (const k of Object.keys(c)) if (!['receta', 'bytes', 'codificacion'].includes(k)) errores.push({ campo: k, motivo: 'campo no admitido' });
  const r = (typeof c.receta === 'object' && c.receta !== null && !Array.isArray(c.receta) ? { ...(c.receta as Record<string, unknown>) } : c.receta) as Record<string, unknown>;
  if (typeof r === 'object' && r !== null && (r.codigo === undefined || r.codigo === '')) r.codigo = 'prueba';
  errores.push(...comoErrores(erroresDeReceta(r)).map((e) => ({ campo: e.campo === '(receta)' ? 'receta' : `receta.${e.campo}`, motivo: e.motivo })));
  let bytes = Buffer.alloc(0);
  if (c.codificacion !== 'hex' && c.codificacion !== 'base64') errores.push({ campo: 'codificacion', motivo: 'hex o base64 (no se adivina: «deadbeef» es válido en los dos)' });
  else if (typeof c.bytes !== 'string' || c.bytes.length > MAX_TEXTO_BYTES) errores.push({ campo: 'bytes', motivo: `texto de hasta ${MAX_TEXTO_BYTES} caracteres` });
  else if (c.codificacion === 'hex') {
    const malo = /[^0-9a-fA-F\s]/.exec(c.bytes);
    const limpio = c.bytes.replace(/\s+/g, '');
    if (malo !== null) errores.push({ campo: 'bytes', motivo: `eso no es hexadecimal: «${malo[0]}» en la posición ${malo.index + 1}` });
    else if (limpio.length % 2 !== 0) errores.push({ campo: 'bytes', motivo: 'en hexadecimal cada byte son dos dígitos: sobra o falta uno' });
    else bytes = Buffer.from(limpio, 'hex');
  } else {
    const limpio = c.bytes.trim();
    if (!BASE64.test(limpio)) errores.push({ campo: 'bytes', motivo: 'eso no es base64 (RFC 4648, con su relleno «=»)' });
    else bytes = Buffer.from(limpio, 'base64');
  }
  if (bytes.length > 255) errores.push({ campo: 'bytes', motivo: 'como mucho 255 bytes (el largo máximo de una receta)' });
  if (errores.length > 0) throw rechazo(errores);
  return { receta: r as unknown as RecetaDefinida, bytes };
}

// POST /recetas-decodificacion/{codigo}/reemplazar: `{por}`, otra receta del catálogo.
export function validarReemplazo(codigo: string, cuerpo: unknown): string {
  const c = (typeof cuerpo === 'object' && cuerpo !== null && !Array.isArray(cuerpo) ? cuerpo : {}) as Record<string, unknown>;
  const errores: Error400[] = [];
  for (const k of Object.keys(c)) if (k !== 'por') errores.push({ campo: k, motivo: 'campo no admitido' });
  if (typeof c.por !== 'string' || !RECETA_CODIGO.test(c.por)) errores.push({ campo: 'por', motivo: 'el código de otra receta del catálogo' });
  else if (c.por === codigo) errores.push({ campo: 'por', motivo: 'es la misma receta: elige otra' });
  if (errores.length > 0) throw rechazo(errores);
  return c.por as string;
}
