import { describe, expect, it } from 'vitest';
import { conAutor, verAutor } from './dispositivos.controller.js';
import { usuarioSistema } from '../sesion/permisos.js';
import type { Rol, UsuarioSesion } from '../sesion/permisos.js';

// «Quién hizo el cambio» (docs/21 §2; decidido el 11/11/2026): el nombre, solo para quien administra el sitio y el usuario del sistema.
const S = '00000000-0000-4000-8000-000000000001';
const persona = (rol: Rol): UsuarioSesion => ({ id: 'u', nombre: 'n', email: 'e', sistema: false, todos: false, sitios: new Map([[S, rol]]), claveTemporal: false, sesionId: 's' });
const filas = [{ id: 'e1', usuario: { id: 'u1', nombre: 'Ana' } }, { id: 'e2', usuario: null }];

describe('verAutor y conAutor', () => {
  it('administrador del sitio y usuario del sistema ven el nombre; consulta recibe usuario null en todas las filas', () => {
    expect(conAutor(filas, verAutor(persona('administrador'), S))[0].usuario).toEqual({ id: 'u1', nombre: 'Ana' });
    expect(conAutor(filas, verAutor(usuarioSistema(), S))[0].usuario).toEqual({ id: 'u1', nombre: 'Ana' });
    expect(conAutor(filas, verAutor(persona('consulta'), S)).map((f) => f.usuario)).toEqual([null, null]);
  });
  it('no cambia las filas recibidas (copia)', () => {
    conAutor(filas, false);
    expect(filas[0].usuario).not.toBeNull();
  });
});
