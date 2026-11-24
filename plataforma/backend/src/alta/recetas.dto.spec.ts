import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { validarPrueba, validarReemplazo, validarRecetaNueva } from './recetas.dto.js';

// El validador de las recetas por API (TT-12, bloque 5; docs/19 §4, T, puntos 6 y 7). La forma de la receta la cubre receta.spec.ts
// (erroresDeReceta); aquí, lo propio de la API: el nombre al crear, los bytes de prueba y el «reemplazar por».
const errores = (f: () => unknown): string => {
  try { f(); } catch (e) {
    if (e instanceof BadRequestException) return ((e.getResponse() as { errores: { campo: string; motivo: string }[] }).errores).map((x) => `${x.campo}: ${x.motivo}`).join(' | ');
    throw e;
  }
  return '';
};
const RECETA = { codigo: 'nodo-v1', nombre: 'Nodo', largo_bytes: 4, campos: [{ magnitud: 'humedad', desplazamiento: 2, tipo: 'u16be', dividir_por: 10 }] };

describe('crear una receta', () => {
  it('con nombre; sin él, 400; con una clave de más, 400', () => {
    expect(validarRecetaNueva({ ...RECETA, nombre: ' Nodo ' }).nombre).toBe('Nodo');
    const sinNombre: Record<string, unknown> = { ...RECETA };
    delete sinNombre.nombre;
    expect(errores(() => validarRecetaNueva(sinNombre))).toContain('nombre: obligatorio');
    expect(errores(() => validarRecetaNueva({ ...RECETA, color: 'x' }))).toContain('clave desconocida: color');
  });
});

describe('probar sin guardar: los bytes', () => {
  const bytesDe = (bytes: string, codificacion = 'hex') => validarPrueba({ receta: RECETA, bytes, codificacion }).bytes.toString('hex');
  it('hexadecimal con espacios entre bytes, o base64; sin código, se prueba como «prueba»', () => {
    expect(bytesDe('de ad BE ef')).toBe('deadbeef');
    expect(bytesDe('3q2+7w==', 'base64')).toBe('deadbeef');
    expect(validarPrueba({ receta: { ...RECETA, codigo: '' }, bytes: '00', codificacion: 'hex' }).receta.codigo).toBe('prueba');
  });
  it.each<[string, Record<string, unknown>, string]>([
    ['no se adivina la codificación', { bytes: 'deadbeef' }, 'codificacion: hex o base64'],
    ['un carácter que no es hexadecimal, con su posición', { bytes: '02 zz', codificacion: 'hex' }, 'eso no es hexadecimal: «z» en la posición 4'],
    ['un dígito suelto', { bytes: 'abc', codificacion: 'hex' }, 'sobra o falta uno'],
    ['base64 sin su relleno', { bytes: '3q2+7w', codificacion: 'base64' }, 'eso no es base64'],
    ['más de 255 bytes', { bytes: 'aa'.repeat(256), codificacion: 'hex' }, 'como mucho 255 bytes'],
    ['un texto demasiado largo', { bytes: 'a'.repeat(1025), codificacion: 'hex' }, 'texto de hasta 1024'],
    ['una receta mala (el mismo validador que crear)', { receta: { ...RECETA, largo_bytes: 0 }, bytes: '00', codificacion: 'hex' }, 'receta.largo_bytes'],
    ['un campo de más', { bytes: '00', codificacion: 'hex', extra: 1 }, 'extra: campo no admitido'],
  ])('%s → 400', (_, cambio, texto) => {
    expect(errores(() => validarPrueba({ receta: RECETA, ...cambio }))).toContain(texto);
  });
});

describe('reemplazar por', () => {
  it('otra receta; la misma o una forma mala, 400', () => {
    expect(validarReemplazo('nodo-v1', { por: 'nodo-v2' })).toBe('nodo-v2');
    expect(errores(() => validarReemplazo('nodo-v1', { por: 'nodo-v1' }))).toContain('es la misma receta');
    expect(errores(() => validarReemplazo('nodo-v1', { por: 'Nodo V2' }))).toContain('por: el código de otra receta');
    expect(errores(() => validarReemplazo('nodo-v1', {}))).toContain('por:');
  });
});
