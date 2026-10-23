import { describe, expect, it } from 'vitest';
import { SIN_FILTROS, fragmentoComparar, fragmentoFicha, fragmentoInventario, leerVista } from './vista';

const ID = '00000000-0000-4000-8000-000000000001';
const CANAL = '00000000-0000-4000-8000-0000000000c1';

describe('leerVista / fragmento*: la vista en la URL (docs/19 §4, incremento 1, punto 1)', () => {
  it('ficha: id, canal y rango se leen tras el «?» del fragmento, y se escriben igual (ida y vuelta)', () => {
    const f = fragmentoFicha(ID, CANAL, '7d');
    expect(f).toBe(`#/dispositivos/${ID}?canal=${CANAL}&rango=7d`);
    expect(leerVista(f)).toEqual({ pantalla: 'ficha', id: ID, canal: CANAL, rango: '7d', res: null });
    expect(leerVista(`#/dispositivos/${ID}`)).toEqual({ pantalla: 'ficha', id: ID, canal: null, rango: null, res: null });
  });
  it('ficha: un rango desconocido o un canal que no es UUID se ignoran (rige el valor por defecto)', () => {
    expect(leerVista(`#/dispositivos/${ID}?canal=c-temp&rango=2y&res=2m`)).toEqual({ pantalla: 'ficha', id: ID, canal: null, rango: null, res: null });
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

// Incremento 2 (docs/19 §4, puntos 4 y 5): la resolución en la URL de la ficha y la URL de P3b.
describe('resolución en la ficha y URL de la comparación (P3b)', () => {
  const OTRO = '00000000-0000-4000-8000-000000000002';
  it('ficha: «res» solo cuando no es «auto»; ida y vuelta', () => {
    expect(fragmentoFicha(ID, CANAL, '7d', '5m')).toBe(`#/dispositivos/${ID}?canal=${CANAL}&rango=7d&res=5m`);
    expect(leerVista(fragmentoFicha(ID, CANAL, '7d', '5m'))).toEqual({ pantalla: 'ficha', id: ID, canal: CANAL, rango: '7d', res: '5m' });
    expect(fragmentoFicha(ID, CANAL, '7d', null)).not.toContain('res=');
  });
  it('comparar: ids, magnitud, rango y resolución, ida y vuelta, con la coma legible', () => {
    const f = fragmentoComparar([ID, OTRO], 'temperatura', '24h', '5m');
    expect(f).toBe(`#/comparar?dispositivos=${ID},${OTRO}&magnitud=temperatura&rango=24h&res=5m`);
    expect(leerVista(f)).toEqual({ pantalla: 'comparar', dispositivos: [ID, OTRO], magnitud: 'temperatura', rango: '24h', res: '5m' });
    expect(fragmentoComparar([ID, OTRO], null, '7d')).toBe(`#/comparar?dispositivos=${ID},${OTRO}&rango=7d`);
  });
  it('comparar: ids inválidos y repetidos fuera, más de 6 se recorta, magnitud que no es código se ignora', () => {
    const muchos = Array.from({ length: 8 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
    const v = leerVista(`#/comparar?dispositivos=${ID},x,${ID.toUpperCase()},${muchos.join(',')}&magnitud=<script>&rango=9y`);
    expect(v.pantalla).toBe('comparar');
    if (v.pantalla !== 'comparar') return;
    expect(v.dispositivos).toHaveLength(6);
    expect(v.dispositivos[0]).toBe(ID);
    expect(new Set(v.dispositivos).size).toBe(6);
    expect(v.magnitud).toBeNull();
    expect(v.rango).toBeNull();
    expect(leerVista('#/comparar')).toEqual({ pantalla: 'comparar', dispositivos: [], magnitud: null, rango: null, res: null });
  });
});

