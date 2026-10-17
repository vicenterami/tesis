// Porcentaje con la calibración lineal de un canal (docs/10 §8.4 punto 51; migración 18): `cero` es el valor de la magnitud que
// corresponde al 0 % y `cien` el que corresponde al 100 %. Puede ser cien < cero (el sensor de suelo capacitivo baja con el agua).
// Lo guardado es siempre el valor crudo: el % se calcula aquí, así una calibración corregida no deja historia mal guardada.
// Sin calibración, o con un valor que no es un número finito, no hay porcentaje: null.
export function porcentaje(valor: number | null | undefined, cero: number | null, cien: number | null): number | null {
  if (valor === null || valor === undefined || cero === null || cien === null) return null;
  if (!Number.isFinite(valor) || !Number.isFinite(cero) || !Number.isFinite(cien) || cero === cien) return null;
  const p = (100 * (valor - cero)) / (cien - cero);
  return Math.round(Math.min(100, Math.max(0, p)) * 10) / 10;  // recortado a [0, 100] y a una décima
}
