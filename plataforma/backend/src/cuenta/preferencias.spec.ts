import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PREFERENCIAS_POR_DEFECTO, leerPreferencias, validarPreferencias, zonaValida } from './preferencias.js';

// Preferencias (docs/19 §4, H; HU-29): todo lo que llega se valida antes de tocar la base, con todos los motivos a la vez.
const motivos = (f: () => unknown): string[] => {
  try { f(); return []; } catch (e) { return ((e as BadRequestException).getResponse() as { message: string[] }).message; }
};
const BUENAS = {
  actualizado_en: null, unidad_temperatura: 'F', unidad_longitud: 'km', zona_horaria: 'America/Punta_Arenas', tema: 'oscuro',
  notificar: ['umbral', 'umbral', 'bateria'], vistas: [{ nombre: ' Mis alertas ', pantalla: 'inventario', parametros: { estado: 'alerta' } }],
  sitio_predeterminado: '11111111-1111-4111-8111-111111111111',
};

// Prueba cruzada (corrección del 11/11/2026): lo que arma el PANEL al guardar una vista (panel/src/lib/preferencias.ts, guardarVista) lo
// acepta este validador tal cual, y la ruta vuelve como enlace del panel. La importación es dinámica y con la ruta armada en tiempo de
// ejecución: el tsc del backend no revisa el código del panel (tiene su propio tsconfig), vitest sí lo carga.
describe('vistas: el panel y el servidor dicen lo mismo', () => {
  it('guardarVista del panel → validarPreferencias acepta; la forma vieja (texto) y una ruta de otro origen, 400', async () => {
    const ruta = ['..', '..', 'panel', 'src', 'lib', 'preferencias.ts'].join('/');
    const panel = (await import(/* @vite-ignore */ ruta)) as {
      guardarVista: (v: readonly unknown[], n: string, f: string) => unknown[] | string; enlaceDeVista: (v: unknown) => string | null;
    };
    const vistas = panel.guardarVista([], 'Alertas', '#/inventario?estado=alerta');
    expect(Array.isArray(vistas)).toBe(true);
    const r = validarPreferencias({ ...BUENAS, vistas });
    expect(r.vistas).toEqual(vistas);
    expect(panel.enlaceDeVista(r.vistas[0])).toBe('#/inventario?estado=alerta');
    expect(motivos(() => validarPreferencias({ ...BUENAS, vistas: [{ nombre: 'A', pantalla: 'inventario', parametros: '/inventario' }] })))
      .toEqual(['vistas[0].parametros debe ser un objeto de hasta 20 pares texto → texto']);
    expect(motivos(() => validarPreferencias({ ...BUENAS, vistas: [{ nombre: 'A', pantalla: 'inventario', parametros: { ruta: '//otro.example/x' } }] })))
      .toEqual(['vistas[0].parametros.ruta debe ser una ruta del panel («/…», sin otro origen)']);
  });
});

describe('validarPreferencias (PUT /preferencias)', () => {
  it('limpia: notificar sin repetidos, nombre de la vista recortado, la zona IANA del motor', () => {
    expect(validarPreferencias(BUENAS)).toEqual({ ...BUENAS, notificar: ['umbral', 'bateria'], vistas: [{ nombre: 'Mis alertas', pantalla: 'inventario', parametros: { estado: 'alerta' } }] });
    expect(validarPreferencias({ ...BUENAS, zona_horaria: 'sitio', actualizado_en: '2026-11-11T10:00:00.123456Z' }).zona_horaria).toBe('sitio');
  });
  it('zona IANA: la lista del motor (Intl.supportedValuesOf) y UTC; un texto inventado, no', () => {
    expect(zonaValida('America/Santiago')).toBe(true);
    expect(zonaValida('UTC')).toBe(true);
    expect(zonaValida('Marte/Olympus')).toBe(false);
    expect(motivos(() => validarPreferencias({ ...BUENAS, zona_horaria: 'Marte/Olympus' }))).toEqual(['zona_horaria debe ser «sitio» o una zona IANA válida (p. ej. America/Santiago)']);
  });
  it('todos los motivos a la vez: unidades, tema, tipos, vistas, sitio y campos de más o de menos', () => {
    const m = motivos(() => validarPreferencias({
      actualizado_en: 'ayer', unidad_temperatura: 'K', unidad_longitud: 'pulgadas', tema: 'rosa', zona_horaria: 3, notificar: ['inventado'],
      vistas: [{ nombre: '', pantalla: 'otra', parametros: { 'Mal Clave': 1 } }], sitio_predeterminado: 'x', extra: true,
    }));
    expect(m).toEqual(expect.arrayContaining([
      expect.stringMatching(/^actualizado_en es obligatorio/), 'unidad_temperatura debe ser una de: C, F', 'unidad_longitud debe ser una de: mm, m, km',
      'tema debe ser una de: sistema, claro, oscuro', expect.stringMatching(/^zona_horaria/), 'notificar: «inventado» no es un tipo de condición',
      'vistas[0].nombre debe tener entre 1 y 60 caracteres', 'vistas[0].pantalla debe ser una de: inventario, ficha, tablero',
      expect.stringMatching(/^vistas\[0\]\.parametros\.Mal Clave/), expect.stringMatching(/^sitio_predeterminado/), 'campo no admitido: extra',
    ]));
    expect(motivos(() => validarPreferencias({ actualizado_en: null }))).toContain('falta tema (PUT reemplaza todas las preferencias)');
  });
  it('vistas: hasta 20, nombres sin repetir (sin distinguir mayúsculas), y el tamaño acotado', () => {
    expect(motivos(() => validarPreferencias({ ...BUENAS, vistas: Array.from({ length: 21 }, (_, i) => ({ nombre: `v${i}`, pantalla: 'ficha', parametros: {} })) })))
      .toEqual(['vistas debe ser una lista de hasta 20 elementos {nombre, pantalla, parametros}']);
    expect(motivos(() => validarPreferencias({ ...BUENAS, vistas: [{ nombre: 'A', pantalla: 'ficha', parametros: {} }, { nombre: 'a', pantalla: 'ficha', parametros: {} }] })))
      .toEqual(['vistas[1].nombre repetido']);
  });
  it('leerPreferencias: sin fila, las de por defecto con actualizado_en null (la primera vez)', async () => {
    const c = { query: () => Promise.resolve({ rows: [] }) } as unknown as Parameters<typeof leerPreferencias>[0];
    expect(await leerPreferencias(c, 'u1')).toEqual({ ...PREFERENCIAS_POR_DEFECTO, actualizado_en: null });
  });
});
