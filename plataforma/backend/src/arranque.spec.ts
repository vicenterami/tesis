import { interfazDeEscucha, registrosEnJson, servirDocumentacion } from './arranque';

describe('registrosEnJson (docs/10 §6): JSON en contenedor, texto en desarrollo', () => {
  it('sin variable → texto', () => expect(registrosEnJson(undefined)).toBe(false));
  it('«texto» → texto', () => expect(registrosEnJson('texto')).toBe(false));
  it('« JSON » con espacios y mayúsculas → json', () => expect(registrosEnJson(' JSON ')).toBe(true));
});

describe('interfazDeEscucha (docs/10 §6): nunca abrir todas las interfaces por accidente', () => {
  it('sin variable → solo este equipo', () => expect(interfazDeEscucha(undefined)).toBe('127.0.0.1'));
  it('variable vacía → solo este equipo (un `??` habría devuelto "" y Node escucha en todas)', () =>
    expect(interfazDeEscucha('')).toBe('127.0.0.1'));
  it('solo espacios → solo este equipo', () => expect(interfazDeEscucha('  ')).toBe('127.0.0.1'));
  it('0.0.0.0 explícito (contenedor) → se respeta', () => expect(interfazDeEscucha('0.0.0.0')).toBe('0.0.0.0'));
});

describe('servirDocumentacion (docs/11 §3): /docs apagada salvo que se pida explícitamente', () => {
  it('sin variable → apagada', () => expect(servirDocumentacion(undefined)).toBe(false));
  it('variable vacía → apagada', () => expect(servirDocumentacion('')).toBe(false));
  it('«no» → apagada', () => expect(servirDocumentacion('no')).toBe(false));
  it('«true» o «1» → apagada (solo vale «si», para no aceptar valores que nadie escribió a propósito)', () => {
    expect(servirDocumentacion('true')).toBe(false);
    expect(servirDocumentacion('1')).toBe(false);
  });
  it('«si» → encendida', () => expect(servirDocumentacion('si')).toBe(true));
  it('« SI » con espacios y mayúsculas → encendida', () => expect(servirDocumentacion(' SI ')).toBe(true));
});
