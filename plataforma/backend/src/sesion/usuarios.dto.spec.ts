import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { validarAltaUsuario, validarCambioUsuario } from './usuarios.dto.js';

// Cuerpos de POST /usuarios y PATCH /usuarios/{id}: limpios o 400 con todos los motivos (HU-18).
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const motivos = (f: () => unknown): string[] => {
  try { f(); return []; } catch (e) { return ((e as BadRequestException).getResponse() as { message: string[] }).message; }
};

describe('validarAltaUsuario', () => {
  it('limpia: email en minúsculas y sin espacios, nombre recortado, sitios con su rol', () => {
    expect(validarAltaUsuario({ nombre: ' Ana ', email: ' Ana@Ejemplo.Invalid ', sitios: [{ sitio_id: S1.toUpperCase(), rol: 'consulta' }] }))
      .toEqual({ nombre: 'Ana', email: 'ana@ejemplo.invalid', sitios: [{ sitio_id: S1, rol: 'consulta' }] });
  });
  it('todos los motivos a la vez; sin campos de más (la clave no la elige quien da el alta)', () => {
    const m = motivos(() => validarAltaUsuario({ nombre: '', email: 'sin-arroba', sitios: [{ sitio_id: 'x', rol: 'dueño' }, { sitio_id: S1, rol: 'consulta' }, { sitio_id: S1, rol: 'consulta' }], clave: 'mia' }));
    expect(m).toEqual(expect.arrayContaining([
      'nombre debe tener entre 1 y 80 caracteres', 'email debe tener la forma nombre@dominio (hasta 254 caracteres)', 'sitios[0].sitio_id no es un UUID válido',
      'sitios[0].rol debe ser una de: administrador, consulta', 'sitios[2].sitio_id repetido', 'campo no admitido: clave',
    ]));
    expect(motivos(() => validarAltaUsuario({ nombre: 'Ana', email: 'a@b.c', sitios: [] }))).toEqual(['sitios debe ser una lista de 1 a 50 elementos {sitio_id, rol}']);
    expect(motivos(() => validarAltaUsuario([]))).toEqual(['el cuerpo debe ser un objeto JSON']);
  });
});

describe('validarCambioUsuario', () => {
  const MARCA = '2026-11-08T12:00:00.123456Z';
  it('exige actualizado_en (bloqueo optimista) y algo que cambiar; rol null quita el sitio', () => {
    expect(validarCambioUsuario({ actualizado_en: MARCA, activo: false, sitios: [{ sitio_id: S2, rol: null }] }))
      .toEqual({ actualizado_en: MARCA, activo: false, sitios: [{ sitio_id: S2, rol: null }] });
    expect(motivos(() => validarCambioUsuario({ activo: false }))[0]).toMatch(/^actualizado_en es obligatorio/);
    expect(motivos(() => validarCambioUsuario({ actualizado_en: MARCA }))).toEqual(['nada que cambiar: nombre, activo, clave_temporal o sitios']);
  });
  it('clave_temporal solo admite true; activo solo booleano; nada de email ni de hash', () => {
    expect(motivos(() => validarCambioUsuario({ actualizado_en: MARCA, clave_temporal: 'nueva', activo: 'no', email: 'x@y', hash_password: 'h' }))).toEqual([
      'activo debe ser true o false', 'clave_temporal solo admite true (asigna una clave temporal nueva)', 'campo no admitido: email', 'campo no admitido: hash_password',
    ]);
    expect(validarCambioUsuario({ actualizado_en: MARCA, clave_temporal: true })).toEqual({ actualizado_en: MARCA, clave_temporal: true });
  });
});
