import { generarSecreto, hashScrypt, igualesEnTiempoConstante, verificarScrypt } from './credenciales';

describe('credenciales del alta: secreto aleatorio y hash scrypt', () => {
  it('el secreto tiene 32 caracteres base64url y nunca se repite', () => {
    const a = generarSecreto();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(generarSecreto()).not.toBe(a);
  });
  it('el hash verifica el secreto correcto y rechaza otro; dos hashes del mismo secreto difieren (sal)', async () => {
    const h = await hashScrypt('un-secreto');
    expect(h.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(await verificarScrypt('un-secreto', h)).toBe(true);
    expect(await verificarScrypt('otro', h)).toBe(false);
    expect(await hashScrypt('un-secreto')).not.toBe(h);
  });
  it('un hash con otra forma, degenerado o con parámetros absurdos no verifica nada y no lanza', async () => {
    expect(await verificarScrypt('x', 'bcrypt$...')).toBe(false);
    expect(await verificarScrypt('x', '')).toBe(false);
    expect(await verificarScrypt('x', 'scrypt$32768$8$1$c2FsLXNhbC1zYWwtc2Fs$')).toBe(false); // clave vacía: dos vacíos NO son iguales
    expect(await verificarScrypt('x', 'scrypt$32768$8$1$$' + 'A'.repeat(88))).toBe(false); // sin sal
    expect(await verificarScrypt('x', 'scrypt$1048576$32$1$c2FsLXNhbC1zYWwtc2Fs$' + 'A'.repeat(88))).toBe(false); // 4 GiB: fuera de rango
  });
  it('comparación en tiempo constante: iguales → sí; distinto largo o contenido → no; el costo del hash es el esperado', async () => {
    expect(igualesEnTiempoConstante('abc', 'abc')).toBe(true);
    expect(igualesEnTiempoConstante('abc', 'abcd')).toBe(false);
    expect(igualesEnTiempoConstante('abc', 'abd')).toBe(false);
    const t0 = process.hrtime.bigint();
    await hashScrypt('medir');
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    expect(ms).toBeGreaterThan(5); // N = 2^15 no es gratis (medido ≈ 30–60 ms en el portátil); si bajara de 5 ms, alguien cambió N
    expect(ms).toBeLessThan(2000);
  });
});
