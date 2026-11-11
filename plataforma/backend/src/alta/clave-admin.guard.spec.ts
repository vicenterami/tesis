import { describe, expect, it } from 'vitest';
import { rechazoDeClaveAdmin } from './clave-admin.guard.js';

describe('rechazoDeClaveAdmin (docs/10 §8.4 punto 41)', () => {
  const clave = 'x'.repeat(32);
  it('sin clave configurada → sin_configurar, aunque la cabecera traiga algo (503, nunca abierta)', () => {
    expect(rechazoDeClaveAdmin(clave, undefined)).toBe('sin_configurar');
  });
  it('cabecera ausente o vacía → ausente; una lista (solo por el tipo) también', () => {
    expect(rechazoDeClaveAdmin(undefined, clave)).toBe('ausente');
    expect(rechazoDeClaveAdmin('', clave)).toBe('ausente');
    expect(rechazoDeClaveAdmin([clave, clave], clave)).toBe('ausente');
  });
  it('la cabecera repetida llega unida por «, » (así la entrega Node) → distinta, nunca pasa', () => {
    expect(rechazoDeClaveAdmin(`${clave}, ${clave}`, clave)).toBe('distinta');
  });
  it('distinta, un prefijo o la misma con un carácter más → distinta', () => {
    expect(rechazoDeClaveAdmin('y'.repeat(32), clave)).toBe('distinta');
    expect(rechazoDeClaveAdmin(clave.slice(0, 31), clave)).toBe('distinta');
    expect(rechazoDeClaveAdmin(clave + 'x', clave)).toBe('distinta');
  });
  it('igual → pasa', () => expect(rechazoDeClaveAdmin(clave, clave)).toBeNull());
});
