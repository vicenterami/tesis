import { describe, expect, it } from 'vitest';
// La fuente del servidor, como texto: la tabla de permisos que decide (sesion/permisos.ts). Así la prueba ve las acciones reales.
import fuentePermisos from '../../../src/sesion/permisos.ts?raw';
import { FRASES, accionesDe, ayudaDeRol, guiaDePerfiles } from './ayudas';

const MATRIZ = { administrador: ['leer', 'exportar', 'escribir', 'usuarios'], consulta: ['leer'] };

// Guía de perfiles derivada de la matriz (docs/19 §6; docs/20 §6): el texto de cada rol sale de sus acciones, no de una frase aparte.
describe('ayudaDeRol y guiaDePerfiles', () => {
  it('con la matriz de hoy: consulta ve y no exporta ni cambia nada; administrador puede todo', () => {
    expect(ayudaDeRol('consulta', MATRIZ)).toBe(
      'Consulta: ve dispositivos, históricos, condiciones y cuarentena de sus sitios; no exporta, no cambia nada ni administra personas.',
    );
    expect(ayudaDeRol('administrador', MATRIZ)).toBe(
      'Administrador: ve dispositivos, históricos, condiciones y cuarentena de sus sitios, exporta las mediciones crudas, da de alta, da de baja y configura dispositivos, pasarelas y calibraciones y da de alta personas y les asigna su rol en sus sitios.',
    );
    expect(guiaDePerfiles(MATRIZ).map((g) => g.rol)).toEqual(['administrador', 'consulta']);
  });
  it('si la matriz cambia, la ayuda cambia sola: con «exportar» para consulta, la guía lo dice y deja de negarlo', () => {
    const otra = { ...MATRIZ, consulta: ['leer', 'exportar'] };
    expect(ayudaDeRol('consulta', otra)).toBe('Consulta: ve dispositivos, históricos, condiciones y cuarentena de sus sitios y exporta las mediciones crudas; no cambia nada ni administra personas.');
  });
  it('una acción que el diccionario no conoce se nombra tal cual (nunca se calla) y un rol sin acciones lo dice', () => {
    expect(ayudaDeRol('administrador', { administrador: ['leer', 'auditar'], consulta: [] })).toContain('puede «auditar»');
    expect(ayudaDeRol('consulta', { administrador: ['leer', 'auditar'], consulta: [] })).toBe('Consulta: no puede nada; no ve los datos de sus sitios ni puede «auditar».');
  });
  it('cada acción de la tabla del servidor (ACCIONES de sesion/permisos.ts) tiene su frase: una acción nueva sin frase hace fallar esta prueba', () => {
    const m = /export const ACCIONES = \[([^\]]*)\] as const/.exec(fuentePermisos);
    expect(m).not.toBeNull();
    const delServidor = [...m![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(delServidor.length).toBeGreaterThanOrEqual(4);
    expect(delServidor.filter((a) => FRASES[a!] === undefined)).toEqual([]);
    expect(accionesDe(MATRIZ).sort()).toEqual([...delServidor].sort());
  });
});
