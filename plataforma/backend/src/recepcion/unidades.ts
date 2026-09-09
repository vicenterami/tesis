// Conversión de unidades hacia la unidad canónica de cada magnitud (filtro 4, normalizar).
// Clave: "<unidad recibida>→<unidad canónica>". Se usan los símbolos de SenML (RFC 8428).
// Si una pareja no está aquí, la lectura es INVÁLIDA (filtro 3): mejor rechazar que adivinar.
const CONVERSIONES: Record<string, (v: number) => number> = {
  'K→Cel': (v) => v - 273.15,
  '°F→Cel': (v) => ((v - 32) * 5) / 9,
  'F→Cel': (v) => ((v - 32) * 5) / 9,
  'Pa→hPa': (v) => v / 100,
  'kPa→hPa': (v) => v * 10,
  'bar→hPa': (v) => v * 1000,
  '%→%RH': (v) => v,   // porcentaje genérico usado como humedad relativa
  '%→%EL': (v) => v,   // porcentaje genérico usado como nivel de batería
};

// Devuelve el valor en la unidad canónica, o undefined si no sabe convertir.
export function aCanonica(valor: number, desde: string | undefined, canonica: string): number | undefined {
  if (!desde || desde === canonica) return valor;
  const f = CONVERSIONES[`${desde}→${canonica}`];
  return f ? f(valor) : undefined;
}
