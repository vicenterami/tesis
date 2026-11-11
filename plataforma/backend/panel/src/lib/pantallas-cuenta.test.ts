import { describe, expect, it } from 'vitest';
import { bloquesDeTexto, esPrivacidad, textoDe } from './legal';
import { agregarCondicion, debeNotificar, ponerNombres, textoGrupo } from './notificaciones';
import { alternarNotificacion, cambiar, cuerpoPreferencias, enlaceDeVista, guardarVista } from './preferencias';
import { urlActividad } from './actividad';

// Funciones puras de P11 (textos legales), P13 (preferencias), P14 (actividad) y de las notificaciones en pantalla (E).
describe('P11: los textos legales se muestran como texto, nunca como HTML', () => {
  it('títulos, párrafos y listas; las negritas y el código se leen sin sus marcas; una etiqueta HTML queda como texto', () => {
    expect(bloquesDeTexto('## Qué es\nUn **prototipo**\nsin compromiso.\n\n- uno\n- dos `x`\n  sigue\n\n<img src=x onerror=alert(1)>')).toEqual([
      { tipo: 'titulo', texto: 'Qué es' },
      { tipo: 'parrafo', texto: 'Un prototipo sin compromiso.' },
      { tipo: 'lista', items: ['uno', 'dos x sigue'] },
      { tipo: 'parrafo', texto: '<img src=x onerror=alert(1)>' },
    ]);
    expect(textoDe({ version: 1, fecha: '2026-11-11', texto: 't' })).toEqual({ version: 1, fecha: '2026-11-11', texto: 't' });
    expect(textoDe({ otra: 1 })).toBeNull();
    expect(esPrivacidad({ datos: [], secciones: [] })).toBe(true);
    expect(esPrivacidad({ texto: 'x' })).toBe(false);
  });
});

describe('P13: preferencias', () => {
  it('el cuerpo de PUT va completo con el actualizado_en leído (null la primera vez); el cambio optimista guarda lo anterior para volver', () => {
    expect(cuerpoPreferencias({ unidad_temperatura: 'F', actualizado_en: null })).toEqual({ unidad_temperatura: 'F', unidad_longitud: 'm', zona_horaria: 'sitio', tema: 'sistema', sitio_predeterminado: null, notificar: [], vistas: [], actualizado_en: null });
    const { nuevas, anteriores } = cambiar({ unidad_temperatura: 'C' }, { unidad_temperatura: 'F' });
    expect([nuevas.unidad_temperatura, anteriores.unidad_temperatura]).toEqual(['F', 'C']);
    expect(alternarNotificacion({ notificar: ['umbral'] }, 'sin_comunicacion', true)).toEqual(['sin_comunicacion', 'umbral']);
    expect(alternarNotificacion({ notificar: ['umbral'] }, 'umbral', false)).toEqual([]);
  });
  it('vistas guardadas: solo del tablero, el inventario o la ficha; el mismo nombre reemplaza; el enlace nunca sale del panel', () => {
    const v = guardarVista([], ' Alertas ', '#/inventario?estado=alerta');
    expect(v).toEqual([{ nombre: 'Alertas', pantalla: 'inventario', parametros: { ruta: '/inventario?estado=alerta' } }]);
    expect(guardarVista(v as never, 'Alertas', '#/?rango=7d')).toEqual([{ nombre: 'Alertas', pantalla: 'tablero', parametros: { ruta: '/?rango=7d' } }]);
    expect(guardarVista([], 'x', '#/preferencias')).toMatch(/solo se guardan/);
    expect(guardarVista([], '  ', '#/')).toMatch(/nombre/);
    expect(enlaceDeVista({ nombre: 'a', pantalla: 'ficha', parametros: { ruta: '/dispositivos/x?rango=24h' } })).toBe('#/dispositivos/x?rango=24h');
    expect(enlaceDeVista({ nombre: 'a', pantalla: 'ficha', parametros: { ruta: '//otro.example/x' } })).toBeNull();
    expect(enlaceDeVista({ nombre: 'a', pantalla: 'ficha', parametros: { ruta: 'javascript:alert(1)' } })).toBeNull();
    // Una vista guardada con la forma vieja (texto suelto) o sin ruta no es enlace (corrección del 11/11/2026).
    expect(enlaceDeVista({ nombre: 'a', pantalla: 'ficha', parametros: '/inventario' as never })).toBeNull();
    expect(enlaceDeVista({ nombre: 'a', pantalla: 'ficha', parametros: { estado: 'alerta' } })).toBeNull();
  });
});

describe('P14 y notificaciones', () => {
  it('la URL de la actividad lleva el id del sitio, los filtros puestos y el cursor', () => {
    const fija = { desde: new Date('2026-11-10T00:00:00Z'), hasta: new Date('2026-11-11T00:00:00Z') };
    expect(urlActividad('s 1', { sitio: 'uct', tipo: 'alta', usuario: '', fija }, 'c2')).toBe('/sitios/s%201/actividad?desde=2026-11-10T00%3A00%3A00.000Z&hasta=2026-11-11T00%3A00%3A00.000Z&tipo=alta&cursor=c2&limite=50');
  });
  it('avisos agrupados por dispositivo: el segundo del mismo suma «× 2» y su tipo; una cerrada no se anuncia; el nombre llega después', () => {
    const t = new Date('2026-11-11T12:00:00Z');
    let g = agregarCondicion([], { dispositivo_id: 'd1', condicion: 'umbral', estado: 'abierta' }, t);
    g = agregarCondicion(g, { dispositivo_id: 'd2', condicion: 'sin_comunicacion', estado: 'abierta' }, t);
    g = agregarCondicion(g, { dispositivo_id: 'd1', condicion: 'bateria', estado: 'abierta' }, t);
    g = agregarCondicion(g, { dispositivo_id: 'd1', condicion: 'umbral', estado: 'cerrada' }, t);
    expect(g.map((x) => [x.dispositivo_id, x.veces])).toEqual([['d1', 2], ['d2', 1]]);
    expect(textoGrupo(g[0]!)).toBe('Un dispositivo de tus sitios: Umbral, Batería (× 2)');
    expect(textoGrupo(ponerNombres(g, new Map([['d1', 'Invernadero']]))[0]!)).toMatch(/^Invernadero: /);
    expect(debeNotificar('umbral', ['umbral'], 'granted')).toBe(true);
    expect(debeNotificar('umbral', ['umbral'], 'default')).toBe(false); // sin permiso, solo el aviso en pantalla
    expect(debeNotificar('bateria', ['umbral'], 'granted')).toBe(false); // no lo eligió
  });
});
