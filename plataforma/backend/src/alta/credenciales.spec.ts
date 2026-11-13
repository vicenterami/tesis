import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  N_CREDENCIAL_ANTERIOR, N_PERSONA, caminoDeCredencial, generarSecreto, hashScrypt, igualesEnTiempoConstante, resumirSecreto, verificarCredencialDispositivo,
  verificarResumen, verificarScrypt,
} from './credenciales.js';

describe('credenciales: secreto aleatorio y hash scrypt (claves de personas y credenciales anteriores)', () => {
  it('el secreto tiene 32 caracteres base64url y nunca se repite', () => {
    const a = generarSecreto();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(generarSecreto()).not.toBe(a);
  });
  it('el hash verifica el secreto correcto y rechaza otro; dos hashes del mismo secreto difieren (sal)', async () => {
    const h = await hashScrypt('un-secreto', undefined, N_CREDENCIAL_ANTERIOR);
    expect(h.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(await verificarScrypt('un-secreto', h)).toBe(true);
    expect(await verificarScrypt('otro', h)).toBe(false);
    expect(await hashScrypt('un-secreto', undefined, N_CREDENCIAL_ANTERIOR)).not.toBe(h);
  });
  it('un hash con otra forma, degenerado o con parámetros absurdos no verifica nada y no lanza', async () => {
    expect(await verificarScrypt('x', 'bcrypt$...')).toBe(false);
    expect(await verificarScrypt('x', '')).toBe(false);
    expect(await verificarScrypt('x', 'scrypt$32768$8$1$c2FsLXNhbC1zYWwtc2Fs$')).toBe(false); // clave vacía: dos vacíos NO son iguales
    expect(await verificarScrypt('x', 'scrypt$32768$8$1$$' + 'A'.repeat(88))).toBe(false); // sin sal
    expect(await verificarScrypt('x', 'scrypt$1048576$32$1$c2FsLXNhbC1zYWwtc2Fs$' + 'A'.repeat(88))).toBe(false); // 4 GiB: fuera de rango
  });
  it('comparación en tiempo constante: iguales → sí; distinto largo o contenido → no; el costo del hash anterior es el esperado', async () => {
    expect(igualesEnTiempoConstante('abc', 'abc')).toBe(true);
    expect(igualesEnTiempoConstante('abc', 'abcd')).toBe(false);
    expect(igualesEnTiempoConstante('abc', 'abd')).toBe(false);
    const t0 = process.hrtime.bigint();
    await hashScrypt('medir', undefined, N_CREDENCIAL_ANTERIOR);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    expect(ms).toBeGreaterThan(5); // N = 2^15 no es gratis (medido ≈ 30–60 ms en el portátil); si bajara de 5 ms, alguien cambió N
    expect(ms).toBeLessThan(2000);
  });
  it('claves de personas (docs/20 §4): N = 2^17 es el de por defecto, verifica con el mismo código y cuesta más que el anterior', async () => {
    const t0 = process.hrtime.bigint();
    const h = await hashScrypt('una frase de persona');
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    expect(N_PERSONA).toBe(131072);
    expect(h.startsWith(`scrypt$${N_PERSONA}$8$1$`)).toBe(true);
    expect(await verificarScrypt('una frase de persona', h)).toBe(true);
    expect(await verificarScrypt('otra frase de persona', h)).toBe(false);
    expect(ms).toBeGreaterThan(20); // cuatro veces el trabajo y la memoria de 2^15 (128 MiB); el costo medido va en docs/16 §58
    expect(ms).toBeLessThan(5000);
  });
  it('I2: una huella sha256$… no verifica nunca como clave de persona (la sesión verifica solo con scrypt), ni con su propio secreto', async () => {
    const secreto = generarSecreto();
    expect(await verificarScrypt(secreto, resumirSecreto(secreto))).toBe(false);
  });
});

// La credencial aleatoria de dispositivos y pasarelas desde el 13/11/2026 (docs/11 §4): SHA-256, sin sal, comparación en tiempo constante.
// Las huellas de las pruebas se calculan aquí: ningún literal con forma de hash.
describe('credenciales: resumen SHA-256 de la credencial aleatoria', () => {
  const sha256b64 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('base64');
  it('formato: sha256$ y el base64 de los 32 bytes del resumen; sin sal (el mismo secreto da la misma huella)', () => {
    const s = generarSecreto();
    const h = resumirSecreto(s);
    expect(h).toBe(`sha256$${sha256b64(s)}`);
    expect(h).toMatch(/^sha256\$[A-Za-z0-9+/]{43}=$/);
    expect(Buffer.from(h.slice(7), 'base64')).toHaveLength(32);
    expect(resumirSecreto(s)).toBe(h);
    expect(h).not.toContain(s);
  });
  it('verifica el secreto correcto y rechaza otro; síncrono y barato (no es un hash con costo)', () => {
    const s = generarSecreto();
    const h = resumirSecreto(s);
    expect(verificarResumen(s, h)).toBe(true);
    expect(verificarResumen(generarSecreto(), h)).toBe(false);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 1000; i++) verificarResumen(s, h);
    expect(Number(process.hrtime.bigint() - t0) / 1e6).toBeLessThan(500); // mil verificaciones en menos de medio segundo
  });
  it('formas inválidas: otro prefijo, base64 roto, largo distinto de 32 bytes o vacío → false, nunca lanza', () => {
    const s = 'un-secreto-cualquiera';
    const b64 = sha256b64(s);
    const casos = [
      '', 'sha256$', `sha256$${b64.slice(0, -1)}`, `sha256$${b64}A`, `sha256$${b64.replace(/=$/, '')}`,
      `sha256$${Buffer.alloc(31).toString('base64')}`, `sha256$${Buffer.alloc(33).toString('base64')}`,
      `SHA256$${b64}`, `sha256$${b64.replace(/[+/]/g, '-')}${/[+/]/.test(b64) ? '' : '!'}`, `scrypt$${b64}`, `sha256$${b64}\n`,
    ];
    for (const h of casos) expect(verificarResumen(s, h), JSON.stringify(h)).toBe(false);
    expect(verificarResumen(s, `sha256$${b64}`)).toBe(true); // la forma válida del mismo secreto, para que el rechazo no sea por otra cosa
  });
  it('camino por la forma de la huella: sha256, scrypt u otra (null)', () => {
    expect(caminoDeCredencial(resumirSecreto('x'))).toBe('sha256');
    expect(caminoDeCredencial('scrypt$32768$8$1$a$b')).toBe('scrypt');
    expect(caminoDeCredencial('bcrypt$x')).toBeNull();
    expect(caminoDeCredencial('')).toBeNull();
  });
  it('verificarCredencialDispositivo despacha por prefijo y dice el camino: la nueva, la anterior (scrypt) y otra forma', async () => {
    const s = generarSecreto();
    expect(await verificarCredencialDispositivo(s, resumirSecreto(s))).toEqual({ valida: true, camino: 'sha256' });
    expect(await verificarCredencialDispositivo('otro', resumirSecreto(s))).toEqual({ valida: false, camino: 'sha256' });
    const anterior = await hashScrypt(s, undefined, N_CREDENCIAL_ANTERIOR);
    expect(await verificarCredencialDispositivo(s, anterior)).toEqual({ valida: true, camino: 'scrypt' });
    expect(await verificarCredencialDispositivo('otro', anterior)).toEqual({ valida: false, camino: 'scrypt' });
    expect(await verificarCredencialDispositivo(s, `bcrypt$${s}`)).toEqual({ valida: false, camino: null });
  });
});
