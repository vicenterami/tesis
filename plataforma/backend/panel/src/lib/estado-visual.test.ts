import { describe, expect, it } from 'vitest';
import { canalCallado, compararAtencion, conteoPorEstado, enLinea, estadoVisual, ORDEN_ATENCION, ROTULO, rotuloCondicion, type DatosEstado } from './estado-visual';
import type { TipoCondicion } from './modelo';
import TABLA from './estado-visual-casos.json';

// La tabla de casos de docs/19 §2 (estado-visual-casos.json): la misma que prueba estadoVisual() del servidor (src/consulta/tablero.spec.ts)
// y la versión SQL contra una base real (integracion/espera.ts). Un caso nuevo se agrega una vez y lo prueban las tres.
function datosDelCaso(c: (typeof TABLA.casos)[number], ahora: Date): DatosEstado {
  const antes = (s: number): string => new Date(ahora.getTime() - s * 1000).toISOString();
  const enServicio = antes(c.en_servicio_hace_s);
  return {
    estado: c.estado as DatosEstado['estado'], visto_por_ultima_vez: c.visto_hace_s === null ? null : antes(c.visto_hace_s), intervalo_esperado_s: c.intervalo_s,
    en_servicio_desde: enServicio, espera_hasta: c.visto_hace_s === null ? new Date(Date.parse(enServicio) + c.espera_h * 3_600_000).toISOString() : null,
  };
}
describe('estadoVisual (docs/19 §2): la tabla de casos, la primera regla que aplica manda', () => {
  const ahora = new Date(TABLA.ahora);
  it('la tabla trae casos de los cinco estados', () => expect(new Set(TABLA.casos.map((c) => c.esperado))).toEqual(new Set(ORDEN_ATENCION)));
  for (const c of TABLA.casos) {
    it(`${c.nombre} → ${c.esperado}`, () => expect(estadoVisual(datosDelCaso(c, ahora), c.abiertas as TipoCondicion[], ahora)).toBe(c.esperado));
  }
  it('el paso del tiempo, sin repedir nada: quien espera pasa a «Sin señal» al vencer su plazo, y con su primera trama a «Normal»', () => {
    const c = datosDelCaso(TABLA.casos.find((x) => x.esperado === 'esperando' && x.en_servicio_hace_s === 3600)!, ahora);
    expect(estadoVisual(c, [], new Date(Date.parse(c.espera_hasta!) - 1000))).toBe('esperando');
    expect(estadoVisual(c, [], new Date(Date.parse(c.espera_hasta!)))).toBe('sin_senal');
    expect(estadoVisual({ ...c, visto_por_ultima_vez: ahora.toISOString(), espera_hasta: null }, [], ahora)).toBe('normal');
  });
  it('el rótulo del estado nuevo es el de docs/19 §2', () => expect(ROTULO.esperando).toBe('Esperando primera trama'));
});

describe('enLinea: la misma regla que la API (el más reciente entre visto y en_servicio_desde, dentro de 2 × intervalo esperado)', () => {
  const ahora = new Date('2026-10-12T15:00:00Z');
  it('visto hace 59 s con intervalo 30 s → en línea; hace 61 s → no', () => {
    expect(enLinea('2026-10-12T14:59:01Z', 30, ahora)).toBe(true);
    expect(enLinea('2026-10-12T14:58:59Z', 30, ahora)).toBe(false);
  });
  it('visto hace un día pero en servicio desde hace 30 s (volvió de mantenimiento) → en línea', () => {
    expect(enLinea('2026-10-11T15:00:00Z', 30, ahora, '2026-10-12T14:59:30Z')).toBe(true);
  });
  it('sin tramas → null, aunque esté en servicio', () => expect(enLinea(null, 30, ahora, '2026-10-12T14:59:30Z')).toBeNull());
});

describe('conteo y orden de atención', () => {
  it('cuenta los cinco estados aunque alguno sea cero', () =>
    expect(conteoPorEstado(['normal', 'alerta', 'normal', 'esperando'])).toEqual({ sin_senal: 0, alerta: 1, normal: 2, esperando: 1, inactivo: 0 }));
  it('Sin señal primero, Esperando primera trama antes de Inactivo, Inactivo al final; dentro del mismo estado, por nombre sin distinguir mayúsculas ni acentos', () => {
    const filas = [
      { estado: 'inactivo' as const, nombre: 'a' },
      { estado: 'normal' as const, nombre: 'Único' },
      { estado: 'normal' as const, nombre: 'ambiente' },
      { estado: 'sin_senal' as const, nombre: 'z' },
      { estado: 'alerta' as const, nombre: 'b' },
      { estado: 'esperando' as const, nombre: 'a nuevo' },
    ];
    expect(filas.sort(compararAtencion).map((f) => `${f.estado}:${f.nombre}`)).toEqual([
      'sin_senal:z', 'alerta:b', 'normal:ambiente', 'normal:Único', 'esperando:a nuevo', 'inactivo:a',
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
