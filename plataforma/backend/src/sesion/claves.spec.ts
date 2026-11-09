import { CLAVES_COMUNES, CLAVE_MAXIMO, CLAVE_MINIMO, generarClaveTemporal, motivosDeClave } from './claves';

// Reglas de la clave de una persona (docs/20 §4).
describe('motivosDeClave', () => {
  it('12 a 128 caracteres, sin exigir símbolos: una frase larga de solo letras sirve', () => {
    expect(motivosDeClave('caballo correcto bateria grapa')).toEqual([]);
    expect(motivosDeClave('a'.repeat(CLAVE_MINIMO - 1) + 'b'.slice(1))).toContain(`la clave debe tener al menos ${CLAVE_MINIMO} caracteres`);
    expect(motivosDeClave('x'.repeat(CLAVE_MAXIMO))).toEqual([]);
    expect(motivosDeClave('x'.repeat(CLAVE_MAXIMO + 1))).toContain(`la clave puede tener hasta ${CLAVE_MAXIMO} caracteres`);
  });
  it('cuenta caracteres, no bytes: once «ñ» no llegan a 12; doce sí', () => {
    expect(motivosDeClave('ñ'.repeat(11))).toHaveLength(1);
    expect(motivosDeClave('ñ'.repeat(12))).toEqual([]);
  });
  it('la lista de claves comunes se rechaza sin distinguir mayúsculas, y toda su entrada tiene 12 o más (si no, sobraría)', () => {
    expect(motivosDeClave('Password1234')).toEqual(['la clave está en la lista de claves comunes: elige otra']);
    expect(motivosDeClave('QWERTYUIOP12')).toHaveLength(1);
    expect(CLAVES_COMUNES.every((c) => [...c].length >= CLAVE_MINIMO)).toBe(true);
  });
  it('ni el propio email ni la anterior; lo que no es texto, un solo motivo', () => {
    expect(motivosDeClave('Ana@Ejemplo.Invalid', { email: 'ana@ejemplo.invalid' })).toContain('la clave no puede ser el email');
    expect(motivosDeClave('una clave nueva larga', { anterior: 'una clave nueva larga' })).toEqual(['la clave nueva debe ser distinta de la anterior']);
    expect(motivosDeClave(123456789012)).toEqual(['la clave debe ser texto']);
  });
  it('la clave temporal: 24 caracteres base64url, distinta cada vez, y cumple las reglas', () => {
    const a = generarClaveTemporal();
    expect(a).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(generarClaveTemporal()).not.toBe(a);
    expect(motivosDeClave(a)).toEqual([]);
  });
});
