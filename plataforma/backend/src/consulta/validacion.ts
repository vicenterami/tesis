import { BadRequestException } from '@nestjs/common';

// Validaciones mínimas de entrada, sin dependencias extra. Toda entrada del cliente es hostil
// hasta demostrar lo contrario: identificadores, fechas e intervalos se comprueban antes de tocar SQL.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Intervalos permitidos para time_bucket: lista cerrada → jamás se interpola texto libre en SQL.
export const INTERVALOS = ['1 minute', '5 minutes', '15 minutes', '1 hour', '6 hours', '1 day'] as const;
export type Intervalo = (typeof INTERVALOS)[number];

// Un parámetro repetido (`?id[]=…` o `?id=a&id=b`) llega de Express como arreglo, no como texto: antes del 12/10 pasaba la
// expresión regular (convierte el arreglo a texto) y reventaba después con 500. Todo lo que no sea texto es 400.
function texto(valor: unknown, nombre: string): string | undefined {
  if (valor === undefined) return undefined;
  if (typeof valor !== 'string') throw new BadRequestException(`${nombre} debe venir una sola vez y como texto`);
  return valor;
}

export function uuid(valor: unknown, nombre = 'id'): string {
  const v = texto(valor, nombre);
  if (v === undefined || !UUID.test(v)) throw new BadRequestException(`${nombre} no es un UUID válido`);
  return v.toLowerCase();
}

export function fecha(valor: unknown, porDefecto: Date, nombre: string): Date {
  const v = texto(valor, nombre);
  if (v === undefined) return porDefecto;
  // Solo ISO 8601 con fecha completa: JavaScript también acepta «2026/02/30» o «Feb 30 2026» y los corre al 2 de marzo sin avisar;
  // una hora 24:00 la mueve al día siguiente. Lo que no tenga esta forma es 400, aunque new Date() lo entendiera.
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}))?$/.test(v) || /T24:/.test(v)) throw new BadRequestException(`${nombre} debe ser una fecha ISO 8601`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${nombre} debe ser una fecha ISO 8601`);
  // Un día que no existe (2026-02-30) pasa el análisis: JavaScript lo corre al 2 de marzo sin avisar. La parte de fecha se valida
  // de ida y vuelta (docs/13, regla 16; lección del 22/10/2026): construida al mediodía UTC debe volver igual.
  const ymd = /^(\d{4}-\d{2}-\d{2})/.exec(v)?.[1];
  if (ymd && new Date(`${ymd}T12:00:00Z`).toISOString().slice(0, 10) !== ymd) throw new BadRequestException(`${nombre}: el día ${ymd} no existe`);
  return d;
}

export function intervalo(valor: unknown): Intervalo {
  const v = texto(valor, 'intervalo');
  if (v === undefined) return '15 minutes';
  if ((INTERVALOS as readonly string[]).includes(v)) return v as Intervalo;
  throw new BadRequestException(`intervalo debe ser uno de: ${INTERVALOS.join(', ')}`);
}

export function limite(valor: unknown, porDefecto = 50, maximo = 500): number {
  const v = texto(valor, 'limite');
  if (v === undefined) return porDefecto;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > maximo) throw new BadRequestException(`limite debe ser un entero entre 1 y ${maximo}`);
  return n;
}
