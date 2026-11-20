import { describe, expect, it } from 'vitest';
import { rotuloPersona } from './persona';

// El rótulo de la lista desplegable de «Actividad» (20/11/2026): «Nombre — correo»; sin correo, solo el nombre.
describe('rotuloPersona', () => {
  it('«Nombre — correo»; sin correo (cuenta anonimizada o vacío), solo el nombre', () => {
    expect(rotuloPersona({ nombre: 'Marta', correo: 'marta.a@example.org' })).toBe('Marta — marta.a@example.org');
    expect(rotuloPersona({ nombre: 'Cuenta dada de baja · 3f2a', correo: null })).toBe('Cuenta dada de baja · 3f2a');
    expect(rotuloPersona({ nombre: 'Ana', correo: '' })).toBe('Ana');
    expect(rotuloPersona({ nombre: 'Ana' })).toBe('Ana');
  });
});
