// La cookie de sesión y los tiempos de vida (docs/20 §3). Funciones puras: el reloj entra como argumento, así las pruebas lo simulan.
import { createHash, randomBytes } from 'node:crypto';

// Con el prefijo `__Host-` (revisión del 08/11/2026): el navegador la acepta solo si viene con `Secure`, `Path=/` y sin `Domain`, así que
// ningún subdominio ni una respuesta por HTTP en claro puede fijarla o pisarla. Comprobado en http://127.0.0.1 con Chromium 156 y Firefox 157
// (Playwright): las dos la guardan y la devuelven; una `__Host-` sin `Secure` o con otro `Path` la descartan (docs/16 §58).
export const NOMBRE_COOKIE = '__Host-sesion';
// Inactividad y vida absoluta (decidido el 12/10/2026 con la hoja de sesiones de OWASP: 15–30 min de inactividad, 4–8 h absoluta).
export const INACTIVIDAD_MS = 30 * 60_000;
export const VIDA_ABSOLUTA_MS = 8 * 3600_000;
// El guardia renueva `ultima_actividad` como mucho una vez por minuto (decidido al implementar, 08/11/2026): cada petición del panel
// no se convierte en una escritura, y la inactividad efectiva queda entre 29 y 30 minutos.
export const RENOVAR_CADA_MS = 60_000;
// La vigencia de la clave temporal la fija el operador (CLAVE_TEMPORAL_HORAS, 1–72 h, 2 por defecto; arranque.ts, horasClaveTemporal):
// decidido el 08/11/2026, reemplaza las 24 h fijas del 12/10. Aquí solo la cuenta pura, con el plazo como argumento.
export function venceClaveTemporal(ahora: Date, horas: number): Date {
  return new Date(ahora.getTime() + horas * 3600_000);
}

// 32 bytes aleatorios (256 bits; OWASP pide al menos 64) en base64url: 43 caracteres sin signos que haya que escapar en una cookie.
export function generarIdentificador(): string {
  return randomBytes(32).toString('base64url');
}

// Lo que guarda la base: el SHA-256 del identificador, en hexadecimal (ck_sesion_id, migración 22). Sin sal ni costo, a propósito:
// el identificador ya tiene 256 bits de entropía, no hay diccionario que probar (un hash lento solo serviría para claves de personas).
export function hashIdentificador(identificador: string): string {
  return createHash('sha256').update(identificador, 'utf8').digest('hex');
}

const FORMA_IDENTIFICADOR = /^[A-Za-z0-9_-]{43}$/;

// Valor de la cookie de sesión en la cabecera Cookie, o null si no viene o no tiene la forma de un identificador (no se consulta la
// base con basura). Sin dependencias: la cabecera es «a=1; b=2»; si la cookie viene repetida, se toma la primera (RFC 6265 §5.4
// ordena de la ruta más larga a la más corta; esta cookie solo existe con Path=/).
export function leerCookie(cabecera: string | undefined, nombre = NOMBRE_COOKIE): string | null {
  if (typeof cabecera !== 'string' || cabecera === '') return null;
  for (const parte of cabecera.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() !== nombre) continue;
    const valor = parte.slice(i + 1).trim();
    return FORMA_IDENTIFICADOR.test(valor) ? valor : null;
  }
  return null;
}

// Set-Cookie de la sesión: `HttpOnly; Secure; SameSite=Lax; Path=/` siempre, también en desarrollo (docs/20 §3). Comprobado el 08/11/2026
// en http://127.0.0.1:3000 con Chromium 156 y Firefox 157 (sin interfaz, Playwright): los dos guardan la cookie Secure y la devuelven, así
// que no hace falta la variable HTTP_COOKIE_SEGURA que el diseño dejaba prevista (docs/16 §58). Sin Max-Age ni Expires: es una cookie de
// sesión del navegador (se va al cerrarlo); los vencimientos de verdad los aplica el servidor.
export function cabeceraCookie(identificador: string): string {
  return `${NOMBRE_COOKIE}=${identificador}; HttpOnly; Secure; SameSite=Lax; Path=/`;
}

// Borra la cookie en el navegador (cierre de sesión o sesión que ya no vale): mismo nombre y mismos atributos, valor vacío y Max-Age=0.
export function cabeceraBorrarCookie(): string {
  return `${NOMBRE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export interface TiemposSesion {
  creada_en: Date;
  ultima_actividad: Date;
  expira_en: Date;
  revocada_en: Date | null;
}

// Por qué una sesión ya no vale, o null si sigue viva. Lo que ocurra primero: revocada, 8 h desde que se creó, 30 min sin actividad.
export function motivoDeVencimiento(s: TiemposSesion, ahora: Date): 'revocada' | 'absoluta' | 'inactividad' | null {
  if (s.revocada_en !== null) return 'revocada';
  if (ahora.getTime() >= s.expira_en.getTime()) return 'absoluta';
  if (ahora.getTime() - s.ultima_actividad.getTime() >= INACTIVIDAD_MS) return 'inactividad';
  return null;
}

export function debeRenovar(ultimaActividad: Date, ahora: Date): boolean {
  return ahora.getTime() - ultimaActividad.getTime() >= RENOVAR_CADA_MS;
}

// La clave temporal vencida no abre sesión (docs/20 §4).
export function claveTemporalVencida(venceEn: Date | null, ahora: Date): boolean {
  return venceEn !== null && ahora.getTime() >= venceEn.getTime();
}
