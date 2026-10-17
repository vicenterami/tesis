import { claveDeDireccion, Cupo, FallosPorClave, RitmoPorDispositivo } from './topes';

// Topes de la recepción por HTTP (docs/10 §8.4 punto 52), con un reloj de mentira.
describe('topes de la recepción por HTTP', () => {
  it('5 fallos en 60 s bloquean la clave 60 s; otra clave no se ve afectada; el bloqueo vence', () => {
    let t = 0;
    const f = new FallosPorClave(5, 60_000, 60_000, () => t);
    for (let i = 0; i < 4; i++) f.registrarFallo('203.0.113.1|nodo-01');
    expect(f.bloqueo('203.0.113.1|nodo-01')).toBe(0);
    f.registrarFallo('203.0.113.1|nodo-01');
    expect(f.bloqueo('203.0.113.1|nodo-01')).toBe(60_000);
    expect(f.bloqueo('203.0.113.1|nodo-02')).toBe(0);
    expect(f.bloqueo('203.0.113.2|nodo-01')).toBe(0);
    t = 59_999;
    expect(f.bloqueo('203.0.113.1|nodo-01')).toBe(1);
    t = 60_000;
    expect(f.bloqueo('203.0.113.1|nodo-01')).toBe(0);
  });
  it('los fallos fuera de la ventana no cuentan: 4 viejos y 1 nuevo no bloquean', () => {
    let t = 0;
    const f = new FallosPorClave(5, 60_000, 60_000, () => t);
    for (let i = 0; i < 4; i++) f.registrarFallo('203.0.113.1');
    t = 60_001;
    f.registrarFallo('203.0.113.1');
    expect(f.bloqueo('203.0.113.1')).toBe(0);
  });
  it('IPv6 se cuenta por su /64 (la clave la normaliza quien llama); IPv4 mapeada, como IPv4', () => {
    expect(claveDeDireccion('2001:db8:1:2::5')).toBe('2001:db8:1:2::/64');
    expect(claveDeDireccion('2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(claveDeDireccion('2001:db8::')).toBe('2001:db8:0:0::/64');
    expect(claveDeDireccion('::1')).toBe('0:0:0:0::/64');
    expect(claveDeDireccion('::ffff:203.0.113.1')).toBe('203.0.113.1');
    expect(claveDeDireccion('::FFFF:203.0.113.1')).toBe('203.0.113.1'); // mayúsculas: la misma dirección
    expect(claveDeDireccion('203.0.113.1')).toBe('203.0.113.1');
    const f = new FallosPorClave(5, 60_000, 60_000, () => 0);
    for (let i = 1; i <= 5; i++) f.registrarFallo(claveDeDireccion(`2001:db8:1:2::${i}`));
    expect(f.bloqueo(claveDeDireccion('2001:db8:1:2::99'))).toBe(60_000);
    expect(f.bloqueo(claveDeDireccion('2001:db8:1:3::1'))).toBe(0);
  });
  it('con más claves que el tope, suelta las cuentas más antiguas, nunca un bloqueo vigente', () => {
    const f = new FallosPorClave(2, 60_000, 60_000, () => 0, 10);
    f.registrarFallo('198.51.100.1'); f.registrarFallo('198.51.100.1'); // bloqueada
    for (let i = 0; i < 50; i++) f.registrarFallo(`203.0.113.${i}`);
    expect(f.claves).toBeLessThan(10);
    expect(f.bloqueo('198.51.100.1')).toBe(60_000);
  });
  it('el cupo deja 2 verificaciones a la vez; al soltar una, entra otra; soltar de más no lo deja negativo', () => {
    const c = new Cupo(2);
    expect([c.tomar(), c.tomar(), c.tomar()]).toEqual([true, true, false]);
    c.soltar();
    expect(c.tomar()).toBe(true);
    c.soltar(); c.soltar(); c.soltar();
    expect([c.tomar(), c.tomar(), c.tomar()]).toEqual([true, true, false]);
  });
  it('una trama aceptada por segundo por dispositivo; la que llega antes no alarga la espera; otro dispositivo pasa', () => {
    let t = 0;
    const r = new RitmoPorDispositivo(1_000, () => t);
    expect(r.pasar('d1')).toBe(true);
    t = 500;
    expect(r.pasar('d1')).toBe(false);
    expect(r.pasar('d2')).toBe(true);
    t = 1_000;
    expect(r.pasar('d1')).toBe(true); // a los 1000 ms de la primera, no de la rechazada
  });
});
