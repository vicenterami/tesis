import { describe, expect, it } from 'vitest';
// La fuente del servidor, como texto: la tabla de permisos que decide (sesion/permisos.ts). Así la prueba ve las acciones reales.
import fuentePermisos from '../../../src/sesion/permisos.ts?raw';
import { FRASES, SIN_RUTA_TODAVIA, accionesDe, ayudaDeRol, guiaDePerfiles } from './ayudas';

const MATRIZ = { administrador: ['leer', 'exportar', 'escribir', 'usuarios', 'configurar'], consulta: ['leer'] };
// La matriz de los cinco perfiles (docs/20 §6; PERMISOS de sesion/permisos.ts, 11/11/2026), para comprobar que cada acción del servidor
// tiene su frase y que la copia de la prueba no se quedó atrás.
const MATRIZ_CINCO = {
  administrador: ['leer', 'exportar', 'escribir', 'baja', 'configurar', 'usuarios', 'enlaces', 'auditoria'],
  investigador: ['leer', 'exportar'],
  operador: ['leer', 'escribir', 'configurar'],
  consulta: ['leer'],
  sistema: ['leer', 'exportar', 'escribir', 'baja', 'configurar', 'usuarios', 'enlaces', 'auditoria', 'sistema'],
};

// Guía de perfiles derivada de la matriz (docs/19 §6; docs/20 §6): el texto de cada rol sale de sus acciones, no de una frase aparte.
describe('ayudaDeRol y guiaDePerfiles', () => {
  it('con la matriz de hoy: consulta ve y no exporta ni cambia nada; administrador puede todo', () => {
    expect(ayudaDeRol('consulta', MATRIZ)).toBe(
      'Consulta: ve dispositivos, históricos, condiciones y cuarentena de sus sitios; no exporta, no cambia nada, no administra personas ni configura dispositivos ni umbrales.',
    );
    expect(ayudaDeRol('administrador', MATRIZ)).toBe(
      'Administrador: ve dispositivos, históricos, condiciones y cuarentena de sus sitios, exporta las mediciones crudas, da de alta y calibra dispositivos y pasarelas, da de alta personas y les asigna su rol en sus sitios y configura nombre, estado, intervalo, zona y umbrales de los dispositivos.',
    );
    expect(guiaDePerfiles(MATRIZ).map((g) => g.rol)).toEqual(['administrador', 'consulta']);
  });
  it('si la matriz cambia, la ayuda cambia sola: con «exportar» para consulta, la guía lo dice y deja de negarlo', () => {
    const otra = { ...MATRIZ, consulta: ['leer', 'exportar'] };
    expect(ayudaDeRol('consulta', otra)).toBe('Consulta: ve dispositivos, históricos, condiciones y cuarentena de sus sitios y exporta las mediciones crudas; no cambia nada, no administra personas ni configura dispositivos ni umbrales.');
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
    expect(accionesDe(MATRIZ_CINCO).sort()).toEqual(delServidor.filter((a) => !SIN_RUTA_TODAVIA.includes(a!)).sort());
    expect(guiaDePerfiles(MATRIZ_CINCO).every((g) => !g.texto.includes('«'))).toBe(true); // ninguna acción sin frase en la guía
  });
  it('corrección del 11/11/2026: escribir no dice «da de baja» (la baja es de administradores); los enlaces públicos no se ofrecen mientras no haya ruta', () => {
    const operador = ayudaDeRol('operador', MATRIZ_CINCO);
    expect(operador).toContain('da de alta y calibra dispositivos y pasarelas');
    expect(operador).toContain('no da de baja dispositivos');
    expect(operador).not.toMatch(/da de alta, da de baja/);
    expect(guiaDePerfiles(MATRIZ_CINCO).some((g) => /enlaces/.test(g.texto))).toBe(false);
    expect(ayudaDeRol('administrador', MATRIZ_CINCO)).toContain('da de baja dispositivos (revoca sus credenciales)');
  });
});
