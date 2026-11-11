import { describe, expect, it } from 'vitest';
import { emailParaRegistro, ipParaRegistro } from './sesion.service.js';

// Lo que sale hacia los registros y lo que entra a `acceso.email_intentado` (revisión de privacidad del 08/11/2026).
describe('privacidad de los registros de acceso', () => {
  it('trunca la IP para los registros: IPv4 a /24, IPv6 a /48, y «desconocida» si no es una dirección', () => {
    expect(ipParaRegistro('203.0.113.77')).toBe('203.0.113.0/24');
    expect(ipParaRegistro('2001:db8:abcd:1234::9')).toBe('2001:db8:abcd::/48');
    expect(ipParaRegistro('desconocida')).toBe('desconocida');
    expect(ipParaRegistro('')).toBe('desconocida');
  });

  it('guarda el email intentado solo si tiene forma de correo', () => {
    expect(emailParaRegistro('ana@ejemplo.invalid')).toBe('ana@ejemplo.invalid');
    expect(emailParaRegistro('esto es una clave 123')).toBeNull();
    expect(emailParaRegistro('sin-arroba.invalid')).toBeNull();
    expect(emailParaRegistro('con espacio@ejemplo.invalid')).toBeNull();
  });

  it('no guarda vacíos ni textos de más de 254 caracteres', () => {
    expect(emailParaRegistro(null)).toBeNull();
    expect(emailParaRegistro('')).toBeNull();
    expect(emailParaRegistro('a'.repeat(250) + '@x.invalid')).toBeNull();
  });
});
