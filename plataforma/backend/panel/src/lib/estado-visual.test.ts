import { describe, expect, it } from 'vitest';
import { compararAtencion, conteoPorEstado, enLinea, estadoVisual } from './estado-visual';

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
