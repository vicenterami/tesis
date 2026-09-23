import { interfazDeEscucha } from './arranque';

describe('interfazDeEscucha (docs/10 §6): nunca abrir todas las interfaces por accidente', () => {
  it('sin variable → solo este equipo', () => expect(interfazDeEscucha(undefined)).toBe('127.0.0.1'));
  it('variable vacía → solo este equipo (un `??` habría devuelto "" y Node escucha en todas)', () =>
    expect(interfazDeEscucha('')).toBe('127.0.0.1'));
  it('solo espacios → solo este equipo', () => expect(interfazDeEscucha('  ')).toBe('127.0.0.1'));
  it('0.0.0.0 explícito (contenedor) → se respeta', () => expect(interfazDeEscucha('0.0.0.0')).toBe('0.0.0.0'));
});
