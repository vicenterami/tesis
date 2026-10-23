// Cuerpo de PATCH /canales/{id} (docs/10 §8.4 punto 51 (ii)): `{escala_cero, escala_cien, actualizado_en}`. Las dos escalas con valor
// calibran; las dos null quitan la calibración; una sola, iguales o no finitas son 400 con el motivo, antes de tocar la base (la misma
// regla que ck_canal_escala, migración 18). `actualizado_en` es el que entregó la ficha y se devuelve a la base TAL CUAL, como texto:
// trae microsegundos y un Date de JavaScript los perdería (el bloqueo optimista daría 409 siempre).
import { BadRequestException } from '@nestjs/common';
import { validarEscalas } from './alta.dto';

export interface CalibracionValidada {
  escala_cero: number | null;
  escala_cien: number | null;
  actualizado_en: string;
}

// ISO 8601 con fecha, hora, segundos y zona; hasta 6 decimales (la precisión de timestamptz).
// Año de cuatro cifras entre 1900 y 2099 y hora 00–23: JavaScript acepta «0000-…» y «T24:…» y la base no (revisión del 22/10: eran un 500).
export const FORMA_ACTUALIZADO_EN = /^(?:19|20)\d{2}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export function validarCalibracion(cuerpo: unknown): CalibracionValidada {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new BadRequestException(['el cuerpo debe ser un objeto JSON']);
  const c = cuerpo as Record<string, unknown>;
  const motivos: string[] = [];
  for (const k of ['escala_cero', 'escala_cien'] as const) {
    if (!(k in c)) motivos.push(`${k} es obligatoria: un número para calibrar, o null para quitar la calibración`);
  }
  const escalas = validarEscalas(c.escala_cero, c.escala_cien, '', motivos);
  const a = c.actualizado_en;
  if (typeof a !== 'string' || !FORMA_ACTUALIZADO_EN.test(a) || Number.isNaN(new Date(a).getTime())) {
    motivos.push('actualizado_en es obligatorio: el instante ISO 8601 que entregó la ficha del dispositivo para este canal, tal cual');
  }
  for (const k of Object.keys(c)) if (!['escala_cero', 'escala_cien', 'actualizado_en'].includes(k)) motivos.push(`campo no admitido: ${k}`);
  if (motivos.length > 0 || escalas === null) throw new BadRequestException(motivos);
  return { ...escalas, actualizado_en: a as string };
}
