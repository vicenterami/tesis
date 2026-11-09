import { describe, expect, it } from 'vitest';
// Los números del servidor (sesion/claves.ts), como texto: las reglas que el panel muestra no pueden decir otros.
import fuenteClaves from '../../../src/sesion/claves.ts?raw';
import { CLAVE_MAXIMO, CLAVE_MINIMO, REGLAS_CLAVE, motivosDeClaveNueva } from './clave';

describe('reglas de la clave en el panel (docs/20 §4)', () => {
  it('mínimo y máximo: los mismos números que el servidor', () => {
    expect(fuenteClaves).toContain(`export const CLAVE_MINIMO = ${CLAVE_MINIMO};`);
    expect(fuenteClaves).toContain(`export const CLAVE_MAXIMO = ${CLAVE_MAXIMO};`);
    expect(REGLAS_CLAVE[0]).toContain(`Entre ${CLAVE_MINIMO} y ${CLAVE_MAXIMO} caracteres`);
  });
  it('corta, larga, igual al correo, igual a la actual y repetida distinta: cada una con su motivo; una buena, ninguno', () => {
    expect(motivosDeClaveNueva('corta', 'corta')).toEqual(['faltan 7 caracteres (mínimo 12)']);
    expect(motivosDeClaveNueva('x'.repeat(130), 'x'.repeat(130))).toEqual(['sobran 2 caracteres (máximo 128)']);
    expect(motivosDeClaveNueva('Ana@Ejemplo.invalid', 'Ana@Ejemplo.invalid', { email: 'ana@ejemplo.invalid' })).toEqual(['no puede ser tu correo']);
    expect(motivosDeClaveNueva('la misma frase larga', 'la misma frase larga', { actual: 'la misma frase larga' })).toEqual(['debe ser distinta de la actual']);
    expect(motivosDeClaveNueva('una frase bastante larga', 'una frase bastante larg')).toEqual(['las dos claves nuevas no coinciden']);
    expect(motivosDeClaveNueva('una frase bastante larga', 'una frase bastante larga', { email: 'ana@ejemplo.invalid', actual: 'otra' })).toEqual([]);
  });
  it('cuenta caracteres, no unidades UTF-16: 12 eñes valen 12', () => {
    expect(motivosDeClaveNueva('ñ'.repeat(12), 'ñ'.repeat(12))).toEqual([]);
    expect(motivosDeClaveNueva('😀'.repeat(11), '😀'.repeat(11))).toEqual(['faltan 1 caracteres (mínimo 12)']);
  });
});
