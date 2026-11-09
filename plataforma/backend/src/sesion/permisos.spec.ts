import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ACCIONES, PERMISOS, ROLES, UsuarioSesion, alcanceDeLectura, matrizPorRol, usuarioSistema, exigir, exigirEnAlguno, permitir, puedeEnAlguno } from './permisos';

// La matriz de docs/20 §6 en la función que decide (docs/10 §8.4 punto 36). Dos sitios: s1 (el de la persona) y s2 (otro).
const persona = (sitios: [string, 'administrador' | 'consulta'][]): UsuarioSesion =>
  ({ ...usuarioSistema(), id: 'u1', sistema: false, todos: false, sitios: new Map(sitios), sesionId: 'a'.repeat(64) });
const CONSULTA = persona([['s1', 'consulta']]);
const ADMIN = persona([['s1', 'administrador']]);

describe('permitir(usuario, accion, sitio): la tabla de docs/20 §6', () => {
  it('consulta en su sitio: lee; exportar, escribir y usuarios → prohibido (403)', () => {
    expect(permitir(CONSULTA, 'leer', 's1')).toBe('permitido');
    for (const a of ['exportar', 'escribir', 'usuarios'] as const) expect(permitir(CONSULTA, a, 's1')).toBe('prohibido');
  });
  it('administrador en su sitio: todo permitido', () => {
    for (const a of ACCIONES) expect(permitir(ADMIN, a, 's1')).toBe('permitido');
  });
  it('otro sitio → no_existe (404, la misma forma que un recurso inexistente: RF-41), para cualquier rol y acción', () => {
    for (const u of [CONSULTA, ADMIN]) for (const a of ACCIONES) expect(permitir(u, a, 's2')).toBe('no_existe');
    expect(permitir(ADMIN, 'leer', null)).toBe('no_existe'); // inexistente
  });
  it('roles distintos en sitios distintos: cada sitio decide con su rol', () => {
    const mixto = persona([['s1', 'consulta'], ['s2', 'administrador']]);
    expect(permitir(mixto, 'escribir', 's1')).toBe('prohibido');
    expect(permitir(mixto, 'escribir', 's2')).toBe('permitido');
  });
  it('el usuario del sistema (X-Clave-Admin) es administrador en todos los sitios, pero no inventa recursos', () => {
    for (const a of ACCIONES) expect(permitir(usuarioSistema(), a, 'cualquiera')).toBe('permitido');
    expect(permitir(usuarioSistema(), 'leer', null)).toBe('no_existe');
  });
  it('la tabla no se relaja en silencio: solo leer admite consulta', () => {
    expect(Object.entries(PERMISOS).filter(([, roles]) => roles.includes('consulta')).map(([a]) => a)).toEqual(['leer']);
  });
  it('matrizPorRol (la guía de perfiles del panel, GET /sesion): sale de PERMISOS, celda por celda, sin acciones de más ni de menos', () => {
    const m = matrizPorRol();
    expect(Object.keys(m).sort()).toEqual([...ROLES].sort());
    for (const r of ROLES) for (const a of ACCIONES) expect(m[r].includes(a)).toBe(PERMISOS[a].includes(r));
    expect(m).toEqual({ administrador: ['leer', 'exportar', 'escribir', 'usuarios'], consulta: ['leer'] });
    // y coincide con la función que decide: lo que la guía dice que un rol puede, permitir() lo permite en su sitio
    for (const r of ROLES) for (const a of ACCIONES) expect(permitir(persona([['s1', r]]), a, 's1') === 'permitido').toBe(m[r].includes(a));
  });
});

describe('exigir, exigirEnAlguno y el alcance de una lista', () => {
  it('exigir convierte la decisión en 404 o 403, con el mensaje del recurso', () => {
    expect(() => exigir(CONSULTA, 'leer', 's2', 'dispositivo no encontrado')).toThrow(new NotFoundException('dispositivo no encontrado'));
    expect(() => exigir(CONSULTA, 'exportar', 's1', 'dispositivo no encontrado')).toThrow(ForbiddenException);
    expect(() => exigir(ADMIN, 'exportar', 's1', 'dispositivo no encontrado')).not.toThrow();
  });
  it('exigirEnAlguno: sin administrador en ningún sitio → 403 antes de validar el cuerpo', () => {
    expect(puedeEnAlguno(CONSULTA, 'escribir')).toBe(false);
    expect(() => exigirEnAlguno(CONSULTA, 'escribir')).toThrow(ForbiddenException);
    expect(() => exigirEnAlguno(persona([]), 'leer')).toThrow(ForbiddenException);
    expect(() => exigirEnAlguno(ADMIN, 'usuarios')).not.toThrow();
  });
  it('alcance de lectura: null solo para el sistema; una persona sin sitios filtra por la lista vacía (nunca sin filtro)', () => {
    expect(alcanceDeLectura(usuarioSistema())).toBeNull();
    expect(alcanceDeLectura(persona([['s1', 'consulta'], ['s3', 'administrador']]))).toEqual(['s1', 's3']);
    expect(alcanceDeLectura(persona([]))).toEqual([]);
  });
  it('usuarioSistema(): un objeto y un mapa nuevos por petición; escribir en uno no se ve en otro (revisión del 08/11/2026)', () => {
    const a = usuarioSistema();
    const b = usuarioSistema();
    expect(a).not.toBe(b);
    expect(a.sitios).not.toBe(b.sitios);
    (a.sitios as Map<string, 'administrador' | 'consulta'>).set('s1', 'consulta');
    expect(b.sitios.size).toBe(0);
    expect(usuarioSistema().sitios.size).toBe(0);
  });
});
