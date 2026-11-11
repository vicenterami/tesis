import { describe, expect, it } from 'vitest';
import { marcadosParaComparar, olvidarMarcados, recordarMarcados } from './comparar';

// Las casillas «comparar» viven mientras dura la sesión del navegador; al salir o al vencer la sesión se olvidan (App.svelte).
describe('marcados para comparar', () => {
  it('se recuerdan sin repetir y en orden; olvidarMarcados los borra', () => {
    recordarMarcados(['a', 'b', 'a']);
    expect(marcadosParaComparar()).toEqual(['a', 'b']);
    olvidarMarcados();
    expect(marcadosParaComparar()).toEqual([]);
  });
});
