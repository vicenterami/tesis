// Reglas de la clave de una persona, mostradas ANTES de escribir y comprobadas mientras se escribe (docs/20 §4). Quien decide es el
// servidor (sesion/claves.ts: además, la lista de claves comunes, que no se copia aquí para no tener dos listas): si rechaza, su 400 trae
// los motivos y la pantalla los muestra tal cual. Aquí solo lo que se puede decir sin consultar a nadie, con los mismos números.
export const CLAVE_MINIMO = 12;
export const CLAVE_MAXIMO = 128;

export const REGLAS_CLAVE: readonly string[] = [
  `Entre ${CLAVE_MINIMO} y ${CLAVE_MAXIMO} caracteres; una frase larga sirve mejor que símbolos raros (no se exigen).`,
  'No puede ser tu correo, ni la clave actual, ni una de las claves comunes que el sistema rechaza.',
  'Al cambiarla se cierran tus otras sesiones abiertas.',
];

// Motivos para no enviar todavía (vacío = se puede enviar). Se cuentan caracteres, no unidades UTF-16 («ñ» y un emoji valen uno),
// igual que el servidor.
export function motivosDeClaveNueva(nueva: string, repetida: string, o: { email?: string | null; actual?: string | null } = {}): string[] {
  const motivos: string[] = [];
  const largo = [...nueva].length;
  if (largo < CLAVE_MINIMO) motivos.push(`faltan ${CLAVE_MINIMO - largo} caracteres (mínimo ${CLAVE_MINIMO})`);
  if (largo > CLAVE_MAXIMO) motivos.push(`sobran ${largo - CLAVE_MAXIMO} caracteres (máximo ${CLAVE_MAXIMO})`);
  if (o.email && nueva.trim().toLowerCase() === o.email.trim().toLowerCase()) motivos.push('no puede ser tu correo');
  if (o.actual && nueva === o.actual) motivos.push('debe ser distinta de la actual');
  if (repetida !== nueva) motivos.push('las dos claves nuevas no coinciden');
  return motivos;
}
