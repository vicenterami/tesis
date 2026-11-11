// Validación del cuerpo del alta de una pasarela (docs/10 §8.4 punto 47): todo lo que llega es hostil hasta demostrar lo contrario.
// Lo que pone el sistema (estado, instantes, credencial) no está en el tipo de entrada.
import { BadRequestException } from '@nestjs/common';
import { FORMA_ID_FISICO, FORMATOS_PASARELA, RESERVADOS } from './alta.dto.js';

export type FormatoPasarela = (typeof FORMATOS_PASARELA)[number];
export interface PasarelaValidada {
  id_fisico: string;
  nombre: string;
  sitio_id: string;
  formato: FormatoPasarela;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validarPasarela(cuerpo: unknown, reservadosExtra: readonly string[] = []): PasarelaValidada {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new BadRequestException(['el cuerpo debe ser un objeto JSON']);
  const c = cuerpo as Record<string, unknown>;
  const motivos: string[] = [];
  const texto = (v: unknown, nombre: string, min: number, max: number): string => {
    if (typeof v !== 'string') { motivos.push(`${nombre} debe ser texto`); return ''; }
    const t = v.trim();
    if (t.length < min || t.length > max) motivos.push(`${nombre} debe tener entre ${min} y ${max} caracteres`);
    return t;
  };
  const id_fisico = texto(c.id_fisico, 'id_fisico', 3, 63).toLowerCase();
  if (id_fisico !== '' && !FORMA_ID_FISICO.test(id_fisico)) motivos.push('id_fisico: minúsculas, dígitos y guion, de 3 a 63 caracteres (la misma forma que exige la base)');
  if ((RESERVADOS as readonly string[]).includes(id_fisico) || reservadosExtra.includes(id_fisico)) motivos.push(`id_fisico reservado para el sistema: ${id_fisico}`);
  const nombre = texto(c.nombre, 'nombre', 1, 80);
  const sitio_id = texto(c.sitio_id, 'sitio_id', 36, 36).toLowerCase();
  if (sitio_id !== '' && !UUID.test(sitio_id)) motivos.push('sitio_id no es un UUID válido');
  let formato: FormatoPasarela = 'milesight';
  if (typeof c.formato === 'string' && (FORMATOS_PASARELA as readonly string[]).includes(c.formato)) formato = c.formato as FormatoPasarela;
  else motivos.push(`formato debe ser una de: ${FORMATOS_PASARELA.join(', ')} (lo que publica: el servidor de red embebido o ChirpStack)`);
  const permitidas = new Set(['id_fisico', 'nombre', 'sitio_id', 'formato']);
  for (const k of Object.keys(c)) if (!permitidas.has(k)) motivos.push(`campo no admitido: ${k}`);
  if (motivos.length > 0) throw new BadRequestException(motivos);
  return { id_fisico, nombre, sitio_id, formato };
}
