// Secretos y hashes (docs/10 §3; docs/11 §4). El secreto de un dispositivo o de una pasarela se genera aquí, se entrega UNA vez en la
// respuesta y la base guarda solo su resumen; el broker guarda el suyo. Dos tratamientos, según quién elige el secreto (decidido el
// 13/11/2026, docs/11 §4):
//  - la credencial aleatoria (192 bits) se guarda con SHA-256: con esa entropía no hay nada que adivinar y un hash con costo no protegía nada;
//  - la clave de una persona, que puede ser adivinable, con scrypt N = 2^17 (docs/20 §4).
// Las credenciales anteriores al 13/11/2026 tienen huella scrypt (N = 2^15): siguen verificando y la vía HTTP las convierte (verificacion.ts).
import { createHash, randomBytes, scrypt as scryptCb, ScryptOptions, timingSafeEqual } from 'node:crypto';

// promisify elige la firma sin opciones; esta envoltura conserva N, r, p y maxmem.
function scrypt(secreto: string, sal: Buffer, largo: number, opciones: ScryptOptions): Promise<Buffer> {
  return new Promise((resolver, rechazar) => scryptCb(secreto, sal, largo, opciones, (e, clave) => (e ? rechazar(e) : resolver(clave))));
}

// 24 bytes aleatorios en base64url: 32 caracteres sin signos que un firmware tenga que escapar.
export function generarSecreto(): string {
  return randomBytes(24).toString('base64url');
}

// ── Credencial aleatoria de dispositivos y pasarelas: SHA-256 ──────────────────────────────────────────────────────────────────────────
// `sha256$<base64 del resumen de 32 bytes>`, sin sal: con 192 bits no hay diccionario ni tabla precalculada posible, y así dos
// conversiones simultáneas de la misma credencial escriben el mismo valor. Síncrono: no pasa por el pool de hilos.
const PREFIJO_SHA256 = 'sha256$';
const FORMA_SHA256 = /^sha256\$[A-Za-z0-9+/]{43}=$/; // 32 bytes en base64 estándar: 43 caracteres y un «=»

export function resumirSecreto(secreto: string): string {
  return PREFIJO_SHA256 + createHash('sha256').update(secreto, 'utf8').digest('base64');
}

// Siempre calcula el resumen y compara en tiempo constante, aunque la huella tenga otra forma (el trabajo es el mismo en los dos casos).
// Una huella con otra forma o con un largo distinto de 32 bytes no verifica nada: devuelve false, nunca lanza.
export function verificarResumen(secreto: string, huella: string): boolean {
  const calculado = createHash('sha256').update(secreto, 'utf8').digest();
  const esperado = FORMA_SHA256.test(huella) ? Buffer.from(huella.slice(PREFIJO_SHA256.length), 'base64') : Buffer.alloc(0);
  if (esperado.length !== calculado.length) {
    timingSafeEqual(calculado, calculado);
    return false;
  }
  return timingSafeEqual(calculado, esperado);
}

// Por qué camino se verifica una credencial de dispositivo o pasarela: `sha256` (la de hoy), `scrypt` (las anteriores al 13/11/2026) o
// null (otra forma: no verifica nada). La capa HTTP lo pregunta antes de verificar (solo el camino scrypt pasa por el cupo) y lo usa
// después (un acierto por el camino scrypt convierte la fila).
export type CaminoCredencial = 'sha256' | 'scrypt';
export function caminoDeCredencial(huella: string): CaminoCredencial | null {
  if (huella.startsWith(PREFIJO_SHA256)) return 'sha256';
  if (huella.startsWith('scrypt$')) return 'scrypt';
  return null;
}

// Verifica una credencial de dispositivo o pasarela despachando por la forma de su huella, y dice por qué camino fue.
export async function verificarCredencialDispositivo(secreto: string, huella: string): Promise<{ valida: boolean; camino: CaminoCredencial | null }> {
  const camino = caminoDeCredencial(huella);
  if (camino === 'sha256') return { valida: verificarResumen(secreto, huella), camino };
  if (camino === 'scrypt') return { valida: await verificarScrypt(secreto, huella), camino };
  return { valida: false, camino };
}

// ── Claves de personas: scrypt ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// N = 2^17 para las claves de personas (docs/20 §4; costo medido en docs/16 §58). N_CREDENCIAL_ANTERIOR = 2^15 es el que llevan las
// credenciales de dispositivos creadas antes del 13/11/2026: ningún camino de producción lo escribe ya (solo las pruebas, para fabricar
// una credencial anterior). Memoria por hash: 128·N·r = 32 MiB con 2^15 y 128 MiB con 2^17; el tope de Node (maxmem) se declara al doble
// de lo que pide N, a propósito (el de fábrica, 32 MiB, no alcanza). Asíncrono: el cálculo corre en el pool de hilos de Node.
export const N_PERSONA = 2 ** 17;
export const N_CREDENCIAL_ANTERIOR = 2 ** 15;
const PARAMETROS = { r: 8, p: 1, largo: 64 };
const LARGO_MINIMO = { sal: 16, clave: 32 };

export async function hashScrypt(secreto: string, sal: Buffer = randomBytes(16), N: number = N_PERSONA): Promise<string> {
  const maxmem = 2 * 128 * N * PARAMETROS.r;
  const clave = await scrypt(secreto, sal, PARAMETROS.largo, { N, r: PARAMETROS.r, p: PARAMETROS.p, maxmem });
  return `scrypt$${N}$${PARAMETROS.r}$${PARAMETROS.p}$${sal.toString('base64')}$${clave.toString('base64')}`;
}

// Un hash con otra forma (también una huella `sha256$…`: una clave de persona se verifica SOLO con scrypt), degenerado (sal o clave
// cortas: dos vacíos serían «iguales») o con parámetros fuera de lo que se escribe aquí no verifica nada: devuelve false, nunca lanza.
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
