import { describe, expect, it } from 'vitest';
import { canalCallado, compararAtencion, conteoPorEstado, enLinea, estadoVisual, rotuloCondicion } from './estado-visual';
import type { TipoCondicion } from './modelo';

describe('estadoVisual (docs/19 §2): la primera regla que aplica manda', () => {
  it('mantenimiento o baja → Inactivo, aunque tenga condiciones abiertas o esté fuera de línea', () => {
    expect(estadoVisual({ estado: 'mantenimiento', en_linea: false }, ['umbral'])).toBe('inactivo');
    expect(estadoVisual({ estado: 'baja', en_linea: true }, [])).toBe('inactivo');
  });
  it('condición sin_comunicacion abierta, o fuera de línea → Sin señal, antes que Alerta', () => {
    expect(estadoVisual({ estado: 'activo', en_linea: true }, ['sin_comunicacion', 'umbral'])).toBe('sin_senal');
    expect(estadoVisual({ estado: 'activo', en_linea: false }, [])).toBe('sin_senal');
  });
  it('umbral, batería o manipulación abiertas, en línea → Alerta', () => {
    expect(estadoVisual({ estado: 'activo', en_linea: true }, ['umbral'])).toBe('alerta');
    expect(estadoVisual({ estado: 'activo', en_linea: true }, ['bateria'])).toBe('alerta');
    expect(estadoVisual({ estado: 'activo', en_linea: true }, ['manipulacion'])).toBe('alerta');
    expect(estadoVisual({ estado: 'activo', en_linea: true }, ['tope_superado'])).toBe('alerta');
  });
  it('reloj_desviado abierta, en línea → Alerta (los datos entran, fechados por la recepción); Sin señal manda sobre ella', () => {
    expect(estadoVisual({ estado: 'activo', en_linea: true }, ['reloj_desviado'])).toBe('alerta');
    expect(estadoVisual({ estado: 'activo', en_linea: true }, ['reloj_desviado', 'sin_comunicacion'])).toBe('sin_senal');
  });
  it('activo, en línea y sin condiciones → Normal; sin tramas aún (null) también, hasta que haya datos', () => {
    expect(estadoVisual({ estado: 'activo', en_linea: true }, [])).toBe('normal');
    expect(estadoVisual({ estado: 'activo', en_linea: null }, [])).toBe('normal');
  });
});

describe('enLinea: la misma regla que la API (visto dentro de 2 × intervalo esperado)', () => {
  const ahora = new Date('2026-10-12T15:00:00Z');
  it('visto hace 59 s con intervalo 30 s → en línea; hace 61 s → no', () => {
    expect(enLinea('2026-10-12T14:59:01Z', 30, ahora)).toBe(true);
    expect(enLinea('2026-10-12T14:58:59Z', 30, ahora)).toBe(false);
  });
  it('sin tramas → null', () => expect(enLinea(null, 30, ahora)).toBeNull());
});

describe('conteo y orden de atención', () => {
  it('cuenta los cuatro estados aunque alguno sea cero', () =>
    expect(conteoPorEstado(['normal', 'alerta', 'normal'])).toEqual({ sin_senal: 0, alerta: 1, normal: 2, inactivo: 0 }));
  it('Sin señal primero, Inactivo al final; dentro del mismo estado, por nombre sin distinguir mayúsculas ni acentos', () => {
    const filas = [
      { estado: 'inactivo' as const, nombre: 'a' },
      { estado: 'normal' as const, nombre: 'Único' },
      { estado: 'normal' as const, nombre: 'ambiente' },
      { estado: 'sin_senal' as const, nombre: 'z' },
      { estado: 'alerta' as const, nombre: 'b' },
    ];
    expect(filas.sort(compararAtencion).map((f) => `${f.estado}:${f.nombre}`)).toEqual([
      'sin_senal:z', 'alerta:b', 'normal:ambiente', 'normal:Único', 'inactivo:a',
    ]);
  });
});

describe('rótulo de cada tipo de condición (docs/19 §6: ningún código interno a la vista)', () => {
  it('cada tipo del modelo tiene su texto; uno desconocido se muestra tal cual, sin romper', () => {
    const tipos: TipoCondicion[] = ['sin_comunicacion', 'umbral', 'bateria', 'manipulacion', 'tope_superado', 'reloj_desviado'];
    expect(tipos.map(rotuloCondicion)).toEqual(['Sin comunicación', 'Umbral', 'Batería', 'Manipulación', 'Tope superado', 'Reloj de pasarela desviado']);
    expect(rotuloCondicion('nuevo_tipo')).toBe('nuevo_tipo');
  });
});

describe('canalCallado (docs/19 §4, P3): equipo en línea y ese canal sin lectura dentro de 2 × intervalo esperado', () => {
  const ahora = new Date('2026-10-24T18:53:42Z');
  const visto = '2026-10-24T18:53:39Z'; // el equipo reportó hace 3 s
  it('la presión de la corrida de 24 h: última lectura hace 3 h 30 min con el equipo en línea → callado', () => {
    expect(canalCallado('2026-10-24T15:23:39Z', visto, 60, ahora)).toBe(true);
  });
  it('borde de la tolerancia: 120 s exactos no calla; 121 s, sí (intervalo 60 s)', () => {
    expect(canalCallado('2026-10-24T18:51:42Z', visto, 60, ahora)).toBe(false);
    expect(canalCallado('2026-10-24T18:51:41Z', visto, 60, ahora)).toBe(true);
  });
  it('un canal que nunca tuvo lecturas, de un equipo que ya reporta → callado', () => {
    expect(canalCallado(null, visto, 60, ahora)).toBe(true);
  });
  it('equipo fuera de línea o sin tramas aún → no se marca el canal: manda «Sin señal» del equipo', () => {
    expect(canalCallado('2026-10-24T15:24:39Z', '2026-10-24T18:00:00Z', 60, ahora)).toBe(false);
    expect(canalCallado(null, null, 60, ahora)).toBe(false);
  });
});
