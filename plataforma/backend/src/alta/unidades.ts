// Las unidades como las escribe una persona (docs/19 §4, bloque S, punto 2): la ÚNICA tabla de escrituras comunes de cada unidad del
// catálogo. La usa `leerCanales` (lote.ts), que lee la columna `canales` del alta por lote, por la API y por el panel; el panel no la
// repite. El alta de a uno no recibe unidad (la fija el catálogo por la magnitud): no tiene nada que leer con ella. Se acepta la unidad del
// catálogo o una escritura común de la MISMA unidad, y se guarda la del catálogo; no se convierten valores ni se acepta otra unidad (°F
// para la temperatura sigue sin entrar: eso es el catálogo editable, TT-12, y las unidades de visualización de cada persona).
//   «°C», «ºC» (el ordinal masculino, que un teclado en español escribe en vez del grado), «C» y «degC» → `Cel`, sin distinguir mayúsculas
//   («cel», «°c», «c», «degc» también).
//   «%» → la unidad porcentual de la magnitud (`%RH` de la humedad, `%EL` de la batería…): toda unidad del catálogo que empieza con «%».
export const ESCRITURAS_UNIDAD: Readonly<Record<string, readonly string[]>> = {
  Cel: ['°C', 'ºC', 'C', 'degC'],
};
// Los caracteres que no son ASCII y aparecen en alguna escritura: la columna `canales` los admite (lote.ts, filasDelCuerpo y la plantilla).
export const SIMBOLOS_UNIDAD = [...new Set(Object.values(ESCRITURAS_UNIDAD).flat().join('').replace(/[\x20-\x7e]/g, ''))].join('');

// Las unidades cuyas escrituras se leen sin distinguir mayúsculas: en la familia Celsius ninguna es ambigua («cel», «degc», «°c», «c»).
const SIN_MAYUSCULAS: ReadonlySet<string> = new Set(['Cel']);

// 'catalogo' = escrita como la del catálogo; 'escritura' = una escritura común de la misma unidad; null = otra unidad.
export function unidadEscrita(escrita: string, canonica: string): 'catalogo' | 'escritura' | null {
  if (escrita === canonica) return 'catalogo';
  const igual = SIN_MAYUSCULAS.has(canonica) ? (x: string): boolean => x.toLowerCase() === escrita.toLowerCase() : (x: string): boolean => x === escrita;
  if ([canonica, ...(ESCRITURAS_UNIDAD[canonica] ?? [])].some(igual)) return 'escritura';
  if (escrita === '%' && canonica.startsWith('%')) return 'escritura';
  return null;
}

// Cómo se lee cada unidad del catálogo en los textos para personas (motivos, avisos y el detalle de la revisión): «°C» y no «Cel»,
// «% de humedad» y no «%RH». Las del catálogo de hoy (db/init: Cel, %RH, hPa, %EL, dBm, ug/m3, V); una que no esté aquí se lee tal cual.
const COMO_SE_LEE: Readonly<Record<string, string>> = {
  Cel: '°C', '%RH': '% de humedad', '%EL': '% de batería', hPa: 'hPa', dBm: 'dBm', 'ug/m3': 'µg/m³', V: 'V',
};
export const comoSeLee = (unidad: string): string => COMO_SE_LEE[unidad] ?? unidad;

// La lista CERRADA de unidades canónicas con que se puede crear una magnitud (TT-12; docs/08 §8 (a); docs/10 §8.4 punto 69 ii): el registro
// de unidades de SenML (RFC 8428 §12.1, copia del 16/10/2026) sin las ocho que marca con asterisco, «NOT RECOMMENDED» para implementaciones
// nuevas (g, l, l/s, Bspl, %, 1/min, beat/min y beats; el de cuatro de ellas está en la línea de continuación de la tabla), más las tres que ya usa el catálogo y que RFC 8798 define como unidades secundarias (hPa, dBm, ug/m3). Una sola casa:
// la API la usa para validar y la entrega al panel; agregar una unidad es cambiar esta lista, no la base.
export const UNIDADES_CANONICAS: readonly string[] = [
  'm', 'kg', 's', 'A', 'K', 'cd', 'mol', 'Hz', 'rad', 'sr', 'N', 'Pa', 'J', 'W', 'C', 'V', 'F', 'Ohm', 'S', 'Wb', 'T', 'H', 'Cel', 'lm',
  'lx', 'Bq', 'Gy', 'Sv', 'kat', 'm2', 'm3', 'm/s', 'm/s2', 'm3/s', 'W/m2', 'cd/m2', 'bit', 'bit/s', 'lat', 'lon', 'pH', 'dB', 'dBW',
  'count', '/', '%RH', '%EL', 'EL', '1/s', 'S/m',
  'hPa', 'dBm', 'ug/m3',
];
