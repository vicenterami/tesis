import { describe, expect, it } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ACCIONES, PERFILES, PERMISOS, ROLES, Rol, UsuarioSesion, alcanceDeLectura, matrizPorRol, usuarioSistema, exigir, exigirEnAlguno, exigirGlobal, permitir, permitirGlobal, puedeEnAlguno } from './permisos.js';

// La matriz de docs/20 §6 en la función que decide (docs/10 §8.4 punto 36). Dos sitios: s1 (el de la persona) y s2 (otro).
const persona = (sitios: [string, Rol][], todos = false): UsuarioSesion =>
  ({ ...usuarioSistema(), id: 'u1', sistema: false, todos, sitios: new Map(sitios), sesionId: 'a'.repeat(64) });
const CONSULTA = persona([['s1', 'consulta']]);
const INVESTIGADOR = persona([['s1', 'investigador']]);
const OPERADOR = persona([['s1', 'operador']]);
const ADMIN = persona([['s1', 'administrador']]);
const SISTEMA = persona([], true); // administrador del sistema: una persona con alcance `todos` (migración 24)

// docs/20 §6, columna por columna (11/11/2026): lo que cada perfil puede en SU sitio. Escrita aparte de PERMISOS a propósito: si alguien
// relaja la tabla del código, esta prueba falla (plantado: `exportar` de vuelta en solo administrador hace fallar «investigador exporta»;
// `escribir` abierto a consulta hace fallar «consulta no da de alta»).
const MATRIZ_DOCS_20: Record<string, readonly string[]> = {
  consulta: ['leer'],
  investigador: ['leer', 'exportar'],
  operador: ['leer', 'escribir', 'configurar'],
  administrador: ['leer', 'exportar', 'escribir', 'baja', 'configurar', 'usuarios', 'enlaces', 'auditoria'],
  administrador_sistema: ['leer', 'exportar', 'escribir', 'baja', 'configurar', 'usuarios', 'enlaces', 'auditoria', 'sistema'],
};

describe('permitir(usuario, accion, sitio): la tabla de docs/20 §6 con los cinco perfiles', () => {
  it('cada perfil en su sitio: exactamente las acciones de su columna (permitido) y ninguna otra (prohibido, 403)', () => {
    const quien: Record<string, UsuarioSesion> = { consulta: CONSULTA, investigador: INVESTIGADOR, operador: OPERADOR, administrador: ADMIN, administrador_sistema: SISTEMA };
    for (const [perfil, puede] of Object.entries(MATRIZ_DOCS_20)) {
      for (const a of ACCIONES) {
        if (a === 'sistema') continue; // lo global no tiene sitio: permitirGlobal
        expect([perfil, a, permitir(quien[perfil], a, 's1')]).toEqual([perfil, a, puede.includes(a) ? 'permitido' : 'prohibido']);
      }
    }
  });
  it('exportar: administrador de sitio e investigador (y el del sistema); consulta y operador técnico, 403', () => {
    expect(permitir(INVESTIGADOR, 'exportar', 's1')).toBe('permitido');
    expect(permitir(ADMIN, 'exportar', 's1')).toBe('permitido');
    expect(permitir(CONSULTA, 'exportar', 's1')).toBe('prohibido');
    expect(permitir(OPERADOR, 'exportar', 's1')).toBe('prohibido');
  });
  it('el operador técnico da de alta y configura, pero no da de baja ni gestiona usuarios', () => {
    expect(permitir(OPERADOR, 'escribir', 's1')).toBe('permitido');
    expect(permitir(OPERADOR, 'configurar', 's1')).toBe('permitido');
    expect(permitir(OPERADOR, 'baja', 's1')).toBe('prohibido');
    expect(permitir(OPERADOR, 'usuarios', 's1')).toBe('prohibido');
  });
  it('otro sitio → no_existe (404, la misma forma que un recurso inexistente: RF-41), para cualquier perfil de sitio y acción', () => {
    for (const u of [CONSULTA, INVESTIGADOR, OPERADOR, ADMIN]) for (const a of ACCIONES) expect(permitir(u, a, 's2')).toBe('no_existe');
    expect(permitir(ADMIN, 'leer', null)).toBe('no_existe'); // inexistente
  });
  it('roles distintos en sitios distintos: cada sitio decide con su rol', () => {
    const mixto = persona([['s1', 'consulta'], ['s2', 'administrador']]);
    expect(permitir(mixto, 'escribir', 's1')).toBe('prohibido');
    expect(permitir(mixto, 'escribir', 's2')).toBe('permitido');
  });
  it('el administrador del sistema y el usuario del sistema (X-Clave-Admin) alcanzan a todos los sitios, pero no inventan recursos', () => {
    for (const u of [SISTEMA, usuarioSistema()]) {
      for (const a of ACCIONES) expect(permitir(u, a, 'cualquiera')).toBe('permitido');
      expect(permitir(u, 'leer', null)).toBe('no_existe');
    }
  });
  it('lo global (soporte, estado del sistema): solo el alcance `todos`; ningún administrador de sitio', () => {
    expect(permitirGlobal(SISTEMA, 'sistema')).toBe(true);
    expect(permitirGlobal(usuarioSistema(), 'sistema')).toBe(true);
    for (const u of [CONSULTA, INVESTIGADOR, OPERADOR, ADMIN]) {
      expect(permitirGlobal(u, 'sistema')).toBe(false);
      expect(() => exigirGlobal(u, 'sistema')).toThrow(ForbiddenException);
    }
  });
  it('la tabla no se relaja en silencio: solo leer admite consulta; solo leer y exportar, investigador', () => {
    expect(Object.entries(PERMISOS).filter(([, roles]) => roles.includes('consulta')).map(([a]) => a)).toEqual(['leer']);
    expect(Object.entries(PERMISOS).filter(([, roles]) => roles.includes('investigador')).map(([a]) => a)).toEqual(['leer', 'exportar']);
  });
  it('matrizPorRol (la guía de perfiles del panel, GET /sesion): sale de PERMISOS, celda por celda, y coincide con docs/20 §6', () => {
    const m = matrizPorRol();
    expect(Object.keys(m).sort()).toEqual([...PERFILES].sort());
    for (const r of PERFILES) for (const a of ACCIONES) expect(m[r].includes(a)).toBe(PERMISOS[a].includes(r));
    for (const r of PERFILES) expect([...m[r]].sort()).toEqual([...MATRIZ_DOCS_20[r]].sort());
    // y coincide con la función que decide: lo que la guía dice que un rol de sitio puede, permitir() lo permite en su sitio
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
    (a.sitios as Map<string, Rol>).set('s1', 'consulta');
    expect(b.sitios.size).toBe(0);
    expect(usuarioSistema().sitios.size).toBe(0);
  });
});
