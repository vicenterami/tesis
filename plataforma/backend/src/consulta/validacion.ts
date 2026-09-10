import { BadRequestException } from '@nestjs/common';

// Validaciones mínimas de entrada, sin dependencias extra. Toda entrada del cliente es hostil
// hasta demostrar lo contrario: identificadores, fechas e intervalos se comprueban antes de tocar SQL.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Intervalos permitidos para time_bucket: lista cerrada → jamás se interpola texto libre en SQL.
export const INTERVALOS = ['1 minute', '5 minutes', '15 minutes', '1 hour', '6 hours', '1 day'] as const;
export type Intervalo = (typeof INTERVALOS)[number];

export function uuid(valor: string, nombre = 'id'): string {
  if (!UUID.test(valor)) throw new BadRequestException(`${nombre} no es un UUID válido`);
  return valor.toLowerCase();
}

export function fecha(valor: string | undefined, porDefecto: Date, nombre: string): Date {
  if (valor === undefined) return porDefecto;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${nombre} debe ser una fecha ISO 8601`);
  return d;
}

export function intervalo(valor: string | undefined): Intervalo {
  if (valor === undefined) return '15 minutes';
  if ((INTERVALOS as readonly string[]).includes(valor)) return valor as Intervalo;
  throw new BadRequestException(`intervalo debe ser uno de: ${INTERVALOS.join(', ')}`);
}

export function limite(valor: string | undefined, porDefecto = 50, maximo = 500): number {
  if (valor === undefined) return porDefecto;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > maximo) throw new BadRequestException(`limite debe ser un entero entre 1 y ${maximo}`);
  return n;
}
