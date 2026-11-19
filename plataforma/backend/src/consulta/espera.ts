// El plazo de la primera trama de un sitio (docs/19 §2 y §4, P; docs/10 §8.4 punto 68; migración 26): sus límites, los mismos del CHECK de
// la base (ck_sitio_espera_primera_trama_h), y la validación del cuerpo de PUT /sitios/{id}/espera-primera-trama. Sin base ni Nest más
// allá de la excepción: cada caso con su prueba (espera.spec.ts).
import { BadRequestException } from '@nestjs/common';

// 168 h (7 días) por omisión: un alta masiva suele ir días antes de instalar; 2 160 h (90 días) como techo.
export const ESPERA_PRIMERA_TRAMA = { minimo: 1, maximo: 2160, porOmision: 168 } as const;

export interface EsperaSitio { espera_primera_trama_h: number; por_omision: number; minimo: number; maximo: number }
export const ESPERA_CAMBIO = (h: number): string =>
  `Alguien cambió el plazo de la primera trama de este sitio entretanto: ahora es de ${h} h. Revísalo antes de cambiarlo.`;

const enRango = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= ESPERA_PRIMERA_TRAMA.minimo && v <= ESPERA_PRIMERA_TRAMA.maximo;

// `{espera_primera_trama_h, anterior?}`: el plazo nuevo y, si se manda, el que se leyó (bloqueo optimista por valor, como el k del sitio).
// Un campo de más, un número fuera de 1 a 2 160 o que no es entero: 400 con cada motivo.
export function validarEspera(cuerpo: unknown): { horas: number; anterior: number | null } {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new BadRequestException(['el cuerpo debe ser un objeto JSON']);
  const c = cuerpo as Record<string, unknown>;
  const motivos = Object.keys(c).filter((k) => k !== 'espera_primera_trama_h' && k !== 'anterior').map((k) => `campo no admitido: ${k}`);
  const { minimo, maximo } = ESPERA_PRIMERA_TRAMA;
  if (!enRango(c.espera_primera_trama_h)) motivos.push(`espera_primera_trama_h debe ser un entero de horas entre ${minimo} y ${maximo} (90 días)`);
  if (c.anterior !== undefined && !enRango(c.anterior)) motivos.push(`anterior debe ser el plazo que leíste: un entero entre ${minimo} y ${maximo}`);
  if (motivos.length > 0) throw new BadRequestException(motivos);
  return { horas: c.espera_primera_trama_h as number, anterior: c.anterior === undefined ? null : (c.anterior as number) };
}
