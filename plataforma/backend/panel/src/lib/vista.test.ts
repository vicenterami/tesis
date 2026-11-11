import { describe, expect, it } from 'vitest';
import { SIN_FILTROS, SIN_FILTROS_ACTIVIDAD, fragmentoActividad, fragmentoAlta, fragmentoComparar, fragmentoFicha, fragmentoInventario, fragmentoTablero, leerVentanaFija, leerVista, redireccionVieja } from './vista';

const ID = '00000000-0000-4000-8000-000000000001';
const CANAL = '00000000-0000-4000-8000-0000000000c1';

describe('leerVista / fragmento*: la vista en la URL (docs/19 §4, incremento 1, punto 1)', () => {
  it('ficha: id, canal y rango se leen tras el «?» del fragmento, y se escriben igual (ida y vuelta)', () => {
    const f = fragmentoFicha(ID, CANAL, '7d');
    expect(f).toBe(`#/dispositivos/${ID}?canal=${CANAL}&rango=7d`);
    expect(leerVista(f)).toEqual({ pantalla: 'ficha', id: ID, canal: CANAL, rango: '7d', res: null, fija: null });
    expect(leerVista(`#/dispositivos/${ID}`)).toEqual({ pantalla: 'ficha', id: ID, canal: null, rango: null, res: null, fija: null });
  });
  it('ficha: un rango desconocido o un canal que no es UUID se ignoran (rige el valor por defecto)', () => {
    expect(leerVista(`#/dispositivos/${ID}?canal=c-temp&rango=2y&res=2m`)).toEqual({ pantalla: 'ficha', id: ID, canal: null, rango: null, res: null, fija: null });
  });
  it('inventario: los filtros, la página y el orden se leen y se escriben; sin filtros, «#/inventario»; un estado desconocido se ignora', () => {
    const filtros = { estado: 'alerta' as const, sitio: 'uct', zona: '00000000-0000-4000-8000-00000000a001', via: 'mqtt', q: 'dev 01&x', pagina: 3, orden: 'entrega' as const };
    expect(leerVista(fragmentoInventario(filtros))).toEqual({ pantalla: 'inventario', filtros });
    expect(fragmentoInventario(SIN_FILTROS)).toBe('#/inventario');
    expect(leerVista('#/inventario')).toEqual({ pantalla: 'inventario', filtros: SIN_FILTROS });
    expect(leerVista('#/inventario?estado=rojo&via=http&pagina=-2&orden=x')).toEqual({ pantalla: 'inventario', filtros: { ...SIN_FILTROS, via: 'http' } });
  });
  it('inventario: sitio, zona y vía basura se ignoran como el resto (código de sitio, UUID de zona, vía de la lista)', () => {
    expect(leerVista('#/inventario?sitio=<script>&zona=z-lab&via=paloma')).toEqual({ pantalla: 'inventario', filtros: SIN_FILTROS });
    expect(leerVista(`#/inventario?sitio=${'x'.repeat(61)}&zona=00000000-0000-4000-8000-00000000a001x`)).toEqual({ pantalla: 'inventario', filtros: SIN_FILTROS });
    // En los dos sentidos: los válidos se conservan.
    expect(leerVista('#/inventario?sitio=uct&zona=00000000-0000-4000-8000-00000000a001&via=lorawan')).toEqual({
      pantalla: 'inventario', filtros: { ...SIN_FILTROS, sitio: 'uct', zona: '00000000-0000-4000-8000-00000000a001', via: 'lorawan' },
    });
  });
  it('tablero v2 (A1): «#/» y lo vacío son el tablero; un enlace viejo con filtros del inventario se redirige a «#/inventario»', () => {
    expect(leerVista('')).toEqual({ pantalla: 'tablero', sitio: '', rango: null, fija: null });
    expect(leerVista('#/?sitio=uct&rango=7d')).toEqual({ pantalla: 'tablero', sitio: 'uct', rango: '7d', fija: null });
    expect(redireccionVieja('#/?estado=alerta&sitio=uct')).toBe('#/inventario?estado=alerta&sitio=uct');
    expect(redireccionVieja('#/?via=http')).toBe('#/inventario?via=http');
    expect(redireccionVieja('#/?sitio=uct&rango=7d')).toBeNull(); // el tablero no se redirige
    expect(redireccionVieja('#/inventario?estado=alerta')).toBeNull();
    expect(leerVista('#/?estado=rojo&via=http')).toEqual({ pantalla: 'inventario', filtros: { ...SIN_FILTROS, via: 'http' } });
  });
  it('tablero: el rango a medida va en desde/hasta (ISO); fechas al revés, inválidas o de más de 366 días se ignoran', () => {
    const fija = { desde: new Date('2026-11-01T03:00:00Z'), hasta: new Date('2026-11-08T03:00:00Z') };
    const f = fragmentoTablero('uct', null, fija);
    expect(f).toBe('#/?sitio=uct&desde=2026-11-01T03%3A00%3A00.000Z&hasta=2026-11-08T03%3A00%3A00.000Z');
    expect(leerVista(f)).toEqual({ pantalla: 'tablero', sitio: 'uct', rango: null, fija });
    expect(fragmentoTablero('', null)).toBe('#/');
    expect(leerVentanaFija('2026-11-08T00:00:00Z', '2026-11-01T00:00:00Z')).toBeNull();
    expect(leerVentanaFija('ayer', '2026-11-01T00:00:00Z')).toBeNull();
    expect(leerVentanaFija('2025-01-01T00:00:00Z', '2026-11-01T00:00:00Z')).toBeNull();
    expect(leerVista('#/?sitio=<b>').pantalla === 'tablero' && (leerVista('#/?sitio=<b>') as { sitio: string }).sitio).toBe('');
  });
  it('legal (P11): «#/legal»', () => expect(leerVista('#/legal')).toEqual({ pantalla: 'legal' }));
  it('usuarios (P10): «#/usuarios» abre la pantalla de usuarios; con algo detrás, no', () => {
    expect(leerVista('#/usuarios')).toEqual({ pantalla: 'usuarios' });
    expect(leerVista('#/usuarios?x=1')).toEqual({ pantalla: 'usuarios' });
    expect(leerVista('#/usuarios/otro').pantalla).toBe('tablero');
  });
  it('una ruta de ficha con un id que no es UUID no abre la ficha: vuelve al tablero', () => {
    expect(leerVista('#/dispositivos/../salud').pantalla).toBe('tablero');
  });
});

// Incremento 2 (docs/19 §4, puntos 4 y 5): la resolución en la URL de la ficha y la URL de P3b.
describe('resolución en la ficha y URL de la comparación (P3b)', () => {
  const OTRO = '00000000-0000-4000-8000-000000000002';
  it('ficha: «res» solo cuando no es «auto»; ida y vuelta', () => {
    expect(fragmentoFicha(ID, CANAL, '7d', '5m')).toBe(`#/dispositivos/${ID}?canal=${CANAL}&rango=7d&res=5m`);
    expect(leerVista(fragmentoFicha(ID, CANAL, '7d', '5m'))).toEqual({ pantalla: 'ficha', id: ID, canal: CANAL, rango: '7d', res: '5m', fija: null });
    const fija = { desde: new Date('2026-10-12T10:00:00Z'), hasta: new Date('2026-10-12T11:00:00Z') };
    expect(leerVista(fragmentoFicha(ID, CANAL, '24h', '1m', fija))).toEqual({ pantalla: 'ficha', id: ID, canal: CANAL, rango: '24h', res: '1m', fija }); // zoom: ida y vuelta
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


// Las pantallas de la iteración 1 (11/11/2026): P6, P7, P13, P14 y los apartados de P11, de ida y vuelta; lo inválido se ignora.
describe('rutas de P6, P7, P11, P13 y P14', () => {
  const ID = '00000000-0000-4000-8000-000000000001';
  it('configurar, alta (con un detectado), preferencias y apartados legales; un identificador o un apartado inválido se ignora', () => {
    expect(leerVista(`#/dispositivos/${ID.toUpperCase()}/configurar`)).toEqual({ pantalla: 'configurar', id: ID });
    expect(leerVista('#/dispositivos/no-uuid/configurar').pantalla).toBe('tablero');
    expect(leerVista(fragmentoAlta('uno', 'nodo-raro', 'uct'))).toEqual({ pantalla: 'alta', modo: 'uno', idFisico: 'nodo-raro', sitio: 'uct' });
    expect(leerVista('#/alta?modo=lote&id_fisico=Nodo_Malo')).toEqual({ pantalla: 'alta', modo: 'lote', idFisico: '', sitio: '' });
    expect(fragmentoAlta('uno')).toBe('#/alta');
    expect(leerVista('#/preferencias')).toEqual({ pantalla: 'preferencias' });
    expect(leerVista('#/legal?seccion=soporte')).toEqual({ pantalla: 'legal', seccion: 'soporte' });
    expect(leerVista('#/legal?seccion=otra')).toEqual({ pantalla: 'legal' });
  });
  it('actividad: sitio, tipo, persona y ventana en la URL, de ida y vuelta; valores con otra forma se descartan', () => {
    const f = { sitio: 'uct', tipo: 'reglas_cambiadas', usuario: ID, fija: { desde: new Date('2026-11-10T00:00:00Z'), hasta: new Date('2026-11-11T00:00:00Z') } };
    expect(leerVista(fragmentoActividad(f))).toEqual({ pantalla: 'actividad', filtros: f });
    expect(fragmentoActividad(SIN_FILTROS_ACTIVIDAD)).toBe('#/actividad');
    expect(leerVista('#/actividad?tipo=DROP%20TABLE&usuario=x&sitio=a%20b')).toEqual({ pantalla: 'actividad', filtros: SIN_FILTROS_ACTIVIDAD });
  });
});
