// Reglas de la clave de una persona (docs/20 §4): mínimo 12 caracteres, máximo 128, sin exigir símbolos; se rechaza si está en la
// lista corta de claves comunes de abajo, si es el propio email y si es igual a la anterior. Devuelve la lista de motivos (vacía = sirve).
import { randomBytes } from 'node:crypto';

export const CLAVE_MINIMO = 12;
export const CLAVE_MAXIMO = 128;

// Lista corta, versionada aquí, de claves de 12 caracteres o más que se adivinan primero: secuencias de teclado y de dígitos, la
// palabra «clave» o «contraseña» con números, y nombres del propio sistema. De elaboración propia (no copiada de una lista pública):
// la regla larga de verdad es el mínimo de 12; esta lista solo corta lo obvio. Se compara sin distinguir mayúsculas. Cualquier ampliación cita su fuente y su licencia
// (nada copiado de listas públicas sin licencia conocida).
export const CLAVES_COMUNES: readonly string[] = [
  '123456789012', '1234567890123', '12345678901234', '123456123456', '111111111111', '000000000000', '121212121212',
  '123123123123', '987654321098', '098765432109',
  'qwertyuiop12', 'qwertyuiop123', 'qwertyuiopasdf', 'asdfghjkl123', 'asdfghjklñ12', '1q2w3e4r5t6y', 'q1w2e3r4t5y6',
  'qazwsxedcrfv', 'zxcvbnm12345', 'abcdefghijkl', 'abcdef123456', 'abc123abc123', 'aaaaaaaaaaaa',
  'password1234', 'password12345', 'password123456', 'passwordpassword', 'contraseña123', 'contraseña1234', 'contrasena123',
  'contrasena1234', 'contraseña2026', 'contrasena2026', 'clave1234567', 'clavesecreta', 'clavesegura1', 'micontraseña',
  'administrador', 'administrador1', 'administrador123', 'admin1234567', 'adminadmin12', 'iloveyou1234', 'bienvenido123',
  'bienvenido2026', 'chile1234567', 'universidad1', 'universidad123', 'plataforma123', 'plataforma2026',
  'sensores2026', 'monitoreo123', 'dispositivo1', 'mosquitto123', 'timescaledb1',
];
const COMUNES = new Set(CLAVES_COMUNES.map((c) => c.toLowerCase()));

export function motivosDeClave(clave: unknown, opciones: { email?: string | null; anterior?: string | null } = {}): string[] {
  if (typeof clave !== 'string') return ['la clave debe ser texto'];
  const motivos: string[] = [];
  // Se cuentan caracteres (puntos de código), no unidades UTF-16: «ñ» y un emoji valen uno.
  const largo = [...clave].length;
  if (largo < CLAVE_MINIMO) motivos.push(`la clave debe tener al menos ${CLAVE_MINIMO} caracteres`);
  if (largo > CLAVE_MAXIMO) motivos.push(`la clave puede tener hasta ${CLAVE_MAXIMO} caracteres`);
  if (COMUNES.has(clave.toLowerCase())) motivos.push('la clave está en la lista de claves comunes: elige otra');
  if (opciones.email && clave.trim().toLowerCase() === opciones.email.trim().toLowerCase()) motivos.push('la clave no puede ser el email');
  if (opciones.anterior !== undefined && opciones.anterior !== null && clave === opciones.anterior) motivos.push('la clave nueva debe ser distinta de la anterior');
  return motivos;
}

// Clave temporal que asigna un administrador (alta o «olvidé mi clave», docs/20 §4): 18 bytes aleatorios en base64url, 24 caracteres.
// Se muestra una sola vez en la respuesta y la base guarda solo su hash, como la credencial de un dispositivo.
export function generarClaveTemporal(): string {
  return randomBytes(18).toString('base64url');
}
