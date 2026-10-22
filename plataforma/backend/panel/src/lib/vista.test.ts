import { describe, expect, it } from 'vitest';
import { SIN_FILTROS, fragmentoFicha, fragmentoInventario, leerVista } from './vista';

const ID = '00000000-0000-4000-8000-000000000001';
const CANAL = '00000000-0000-4000-8000-0000000000c1';

describe('leerVista / fragmento*: la vista en la URL (docs/19 §4, incremento 1, punto 1)', () => {
  it('ficha: id, canal y rango se leen tras el «?» del fragmento, y se escriben igual (ida y vuelta)', () => {
    const f = fragmentoFicha(ID, CANAL, '7d');
    expect(f).toBe(`#/dispositivos/${ID}?canal=${CANAL}&rango=7d`);
    expect(leerVista(f)).toEqual({ pantalla: 'ficha', id: ID, canal: CANAL, rango: '7d' });
    expect(leerVista(`#/dispositivos/${ID}`)).toEqual({ pantalla: 'ficha', id: ID, canal: null, rango: null });
  });
  it('ficha: un rango desconocido o un canal que no es UUID se ignoran (rige el valor por defecto)', () => {
    expect(leerVista(`#/dispositivos/${ID}?canal=c-temp&rango=2y`)).toEqual({ pantalla: 'ficha', id: ID, canal: null, rango: null });
  });
  it('inventario: los filtros se leen y se escriben; sin filtros, «#/»; un estado desconocido se ignora', () => {
    const filtros = { estado: 'alerta' as const, sitio: 'uct', zona: 'z-lab', via: 'mqtt', q: 'dev 01&x' };
    expect(leerVista(fragmentoInventario(filtros))).toEqual({ pantalla: 'inventario', filtros });
    expect(fragmentoInventario(SIN_FILTROS)).toBe('#/');
    expect(leerVista('')).toEqual({ pantalla: 'inventario', filtros: SIN_FILTROS });
    expect(leerVista('#/?estado=rojo&via=http')).toEqual({ pantalla: 'inventario', filtros: { ...SIN_FILTROS, via: 'http' } });
  });
  it('una ruta de ficha con un id que no es UUID no abre la ficha: vuelve al inventario', () => {
    expect(leerVista('#/dispositivos/../salud').pantalla).toBe('inventario');
  });
});
