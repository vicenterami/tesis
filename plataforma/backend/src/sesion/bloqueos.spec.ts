import { describe, expect, it } from 'vitest';
import { Bloqueos, ESCALONES_MS, ESPERA_SI_LLENO_MS, FALLOS_POR_IP, FALLOS_POR_USUARIO, MAX_CLAVES, VENTANA_MS } from './bloqueos.js';

// Bloqueos por intentos fallidos (docs/20 §4) con un reloj simulado.
describe('Bloqueos', () => {
  const armar = () => {
    let ahora = Date.UTC(2026, 10, 8, 12);
    const b = new Bloqueos(() => ahora);
    return { b, avanzar: (ms: number) => { ahora += ms; } };
  };

  it('por usuario: 4 fallos no bloquean; el 5.º bloquea 1 minuto; al minuto puede volver a intentar', () => {
    const { b, avanzar } = armar();
    for (let i = 0; i < FALLOS_POR_USUARIO - 1; i++) expect(b.registrarFallo('ana@x.invalid', '192.0.2.1')).toBe(0);
    expect(b.restanteUsuario('ana@x.invalid')).toBe(0);
    expect(b.registrarFallo('ana@x.invalid', '192.0.2.1')).toBe(ESCALONES_MS[0]);
    expect(b.restanteUsuario('ana@x.invalid')).toBe(60_000);
    avanzar(60_000);
    expect(b.restanteUsuario('ana@x.invalid')).toBe(0);
  });

  it('creciente: el segundo bloqueo dura 5 minutos y el tercero 15, y no pasa de 15', () => {
    const { b, avanzar } = armar();
    const cinco = () => { let ms = 0; for (let i = 0; i < FALLOS_POR_USUARIO; i++) ms = b.registrarFallo('ana@x.invalid', '192.0.2.1'); return ms; };
    expect(cinco()).toBe(60_000);
    avanzar(60_000);
    expect(cinco()).toBe(5 * 60_000);
    avanzar(5 * 60_000);
    expect(cinco()).toBe(15 * 60_000);
    avanzar(15 * 60_000);
    expect(cinco()).toBe(15 * 60_000);
  });

  it('el nivel vuelve a cero tras 15 minutos sin fallos desde el fin del bloqueo, o con un inicio de sesión correcto', () => {
    const { b, avanzar } = armar();
    const cinco = () => { let ms = 0; for (let i = 0; i < FALLOS_POR_USUARIO; i++) ms = b.registrarFallo('ana@x.invalid', '192.0.2.1'); return ms; };
    cinco();
    avanzar(60_000 + VENTANA_MS + 1);
    expect(cinco()).toBe(60_000);
    avanzar(60_000);
    b.registrarExito('ana@x.invalid');
    expect(cinco()).toBe(60_000);
  });

  it('los fallos fuera de la ventana de 15 minutos no suman', () => {
    const { b, avanzar } = armar();
    for (let i = 0; i < FALLOS_POR_USUARIO - 1; i++) b.registrarFallo('ana@x.invalid', '192.0.2.1');
    avanzar(VENTANA_MS);
    expect(b.registrarFallo('ana@x.invalid', '192.0.2.1')).toBe(0);
  });

  it('la clave es el email escrito: uno inexistente se bloquea igual (no revela qué cuentas existen) y no afecta a otro', () => {
    const { b } = armar();
    for (let i = 0; i < FALLOS_POR_USUARIO; i++) b.registrarFallo('nadie@x.invalid', '192.0.2.1');
    expect(b.restanteUsuario('nadie@x.invalid')).toBeGreaterThan(0);
    expect(b.restanteUsuario('ana@x.invalid')).toBe(0);
  });

  it('por IP: 50 fallos en 15 minutos (con emails distintos) → bloqueada hasta que el más viejo salga de la ventana', () => {
    const { b, avanzar } = armar();
    for (let i = 0; i < FALLOS_POR_IP - 1; i++) { b.registrarFallo(`u${i}@x.invalid`, '198.51.100.7'); avanzar(1000); }
    expect(b.restanteIp('198.51.100.7')).toBe(0);
    b.registrarFallo('otro@x.invalid', '198.51.100.7');
    const espera = b.restanteIp('198.51.100.7');
    expect(espera).toBe(VENTANA_MS - (FALLOS_POR_IP - 1) * 1000);
    expect(b.restanteIp('203.0.113.9')).toBe(0); // otra dirección, libre
    avanzar(espera);
    expect(b.restanteIp('198.51.100.7')).toBe(0);
  });

  it('el rechazo «bloqueado» va a acceso una vez por (email, dirección) y ventana de 15 min (revisión del 08/11/2026)', () => {
    const { b, avanzar } = armar();
    expect([1, 2, 3].map(() => b.debeRegistrarBloqueo('ana@x.invalid', '192.0.2.1'))).toEqual([true, false, false]);
    expect(b.debeRegistrarBloqueo('ana@x.invalid', '192.0.2.2')).toBe(true);
    expect(b.debeRegistrarBloqueo('beto@x.invalid', '192.0.2.1')).toBe(true);
    avanzar(VENTANA_MS);
    expect(b.debeRegistrarBloqueo('ana@x.invalid', '192.0.2.1')).toBe(true);
  });

  it(`MAX_CLAVES es un tope duro: con ${MAX_CLAVES} claves vivas, un intento que traería una nueva espera (429) y el registro no crece`, () => {
    const { b, avanzar } = armar();
    for (let i = 0; i < MAX_CLAVES / 2; i++) b.registrarFallo(`u${i}@x.invalid`, `2001:db8::${i.toString(16)}`); // direcciones de documentación (RFC 3849)
    expect(b.tamano).toBe(MAX_CLAVES);
    expect(b.restante('nuevo@x.invalid', '203.0.113.1')).toBe(ESPERA_SI_LLENO_MS);
    expect(b.restante('u1@x.invalid', '2001:db8::1')).toBe(0); // quien ya está en el registro sigue intentando
    expect(b.registrarFallo('nuevo@x.invalid', '203.0.113.1')).toBe(0);
    b.registrarFalloIp('203.0.113.2');
    expect(b.debeRegistrarBloqueo('u1@x.invalid', '2001:db8::1')).toBe(false); // tampoco un par nuevo
    expect(b.tamano).toBe(MAX_CLAVES);
    avanzar(VENTANA_MS); // los fallos salen de la ventana: la poda libera todo
    expect(b.restante('nuevo@x.invalid', '203.0.113.1')).toBe(0);
  });

  it('un fallo solo de la dirección (503 por la cola del hash llena) suma al bloqueo por IP y no al de ningún usuario', () => {
    const { b } = armar();
    for (let i = 0; i < FALLOS_POR_IP; i++) b.registrarFalloIp('198.51.100.7');
    expect(b.restanteIp('198.51.100.7')).toBeGreaterThan(0);
    expect(b.restanteUsuario('ana@x.invalid')).toBe(0);
  });
});
