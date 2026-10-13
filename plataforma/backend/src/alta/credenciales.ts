// Secretos y hashes del alta (docs/10 §3; decisión del 12/10: scrypt de node:crypto, sin dependencias). El secreto del
// dispositivo se genera aquí, se entrega UNA vez en la respuesta y la base guarda solo su hash; el broker guarda el suyo.
import { createHash, randomBytes, scrypt as scryptCb, ScryptOptions, timingSafeEqual } from 'node:crypto';

// promisify elige la firma sin opciones; esta envoltura conserva N, r, p y maxmem.
function scrypt(secreto: string, sal: Buffer, largo: number, opciones: ScryptOptions): Promise<Buffer> {
  return new Promise((resolver, rechazar) => scryptCb(secreto, sal, largo, opciones, (e, clave) => (e ? rechazar(e) : resolver(clave))));
}

// 24 bytes aleatorios en base64url: 32 caracteres sin signos que un firmware tenga que escapar.
export function generarSecreto(): string {
  return randomBytes(24).toString('base64url');
}

// Para secretos aleatorios de 24 bytes (alta entropía) basta N = 2^15; las claves de personas (docs/20) usarán 2^17.
// Memoria por hash: 128·N·r = 32 MiB, justo el tope por defecto de Node (maxmem): se declara uno mayor a propósito.
// Asíncrono: el cálculo corre en el pool de hilos de Node y no detiene la recepción de tramas mientras tanto.
const PARAMETROS = { N: 2 ** 15, r: 8, p: 1, largo: 64, maxmem: 64 * 1024 * 1024 };
const LARGO_MINIMO = { sal: 16, clave: 32 };

export async function hashScrypt(secreto: string, sal: Buffer = randomBytes(16)): Promise<string> {
  const clave = await scrypt(secreto, sal, PARAMETROS.largo, { N: PARAMETROS.N, r: PARAMETROS.r, p: PARAMETROS.p, maxmem: PARAMETROS.maxmem });
  return `scrypt$${PARAMETROS.N}$${PARAMETROS.r}$${PARAMETROS.p}$${sal.toString('base64')}$${clave.toString('base64')}`;
}

// Un hash con otra forma, degenerado (sal o clave cortas: dos vacíos serían «iguales») o con parámetros fuera de lo que se
// escribe aquí no verifica nada: devuelve false, nunca lanza.
export async function verificarScrypt(secreto: string, hash: string): Promise<boolean> {
  const partes = hash.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [N, r, p] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  if (!(N >= 2 ** 14 && N <= 2 ** 18 && r >= 8 && r <= 16 && p >= 1 && p <= 4)) return false;
  const sal = Buffer.from(partes[4], 'base64');
  const esperado = Buffer.from(partes[5], 'base64');
  if (sal.length < LARGO_MINIMO.sal || esperado.length < LARGO_MINIMO.clave) return false;
  try {
    const clave = await scrypt(secreto, sal, esperado.length, { N, r, p, maxmem: 256 * 1024 * 1024 });
    return timingSafeEqual(clave, esperado);
  } catch {
    return false;
  }
}

// Comparación de tiempo constante entre dos textos de largo distinto: se comparan sus hashes, nunca los textos (el largo
// de un secreto tampoco debe filtrarse por el reloj).
export function igualesEnTiempoConstante(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}
