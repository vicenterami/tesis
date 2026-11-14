import { describe, expect, it } from 'vitest';
import { aplicarAvisos, cifraAhora, conservarTendencia, esDelSitio, lecturaVieja, trazosChispa } from './ahora';
import type { AhoraSitio } from './modelo';

// «Ahora» en memoria (docs/19 §4, bloque L, punto 3): qué aviso es del sitio, cómo se aplican `medicion` y `visto`, la tendencia que se
// conserva, la lectura vieja, la cifra y la línea de tendencia con sus huecos.
const D = 'd1';
const datos = (): AhoraSitio => ({
  reportan: 1, sin_senal: 0, por_magnitud: [], tendencia: true, chispa: { desde: '2026-11-10T16:00:00.000Z', intervalo: '1 hour', puntos: 24 },
  dispositivos: [{ id: D, nombre: 'x', zona: 'z', estado_visual: 'normal', visto_por_ultima_vez: '2026-11-11T14:00:00Z', intervalo_esperado_s: 60, canales_total: 1,
    canales: [{ id: 'c1', magnitud: 'temperatura', magnitud_nombre: 'Temperatura', unidad: 'Cel', salud: false, ultima: { valor: 20, tiempo: '2026-11-11T14:00:00Z', porcentaje: null }, chispa: [1, 2, null, 4] }] }],
});

describe('lib/ahora', () => {
  it('esDelSitio: por su sitio_id; con null o sin el campo, solo si el dispositivo ya se muestra', () => {
    const vis = new Set([D]);
    expect(esDelSitio({ dispositivo_id: 'otro', sitio_id: 's1' }, 's1', vis)).toBe(true);
    expect(esDelSitio({ dispositivo_id: D, sitio_id: 's2' }, 's1', vis)).toBe(false);
    expect(esDelSitio({ dispositivo_id: D, sitio_id: null }, 's1', vis)).toBe(true);
    expect(esDelSitio({ dispositivo_id: 'otro', sitio_id: null }, 's1', vis)).toBe(false);
    expect(esDelSitio({ dispositivo_id: 'otro' }, 's1', vis)).toBe(false);
  });
  it('aplicarAvisos: el valor, su hora y «visto»; uno más viejo no pisa; uno de otro dispositivo o canal no cambia nada', () => {
    const r = aplicarAvisos(datos(), [
      { tipo: 'medicion', dispositivo_id: D, canal_id: 'c1', valor: 21, unidad: 'Cel', tiempo: '2026-11-11T14:05:00Z' },
      { tipo: 'medicion', dispositivo_id: D, canal_id: 'c1', valor: 99, unidad: 'Cel', tiempo: '2026-11-11T14:01:00Z' },
      { tipo: 'visto', dispositivo_id: D, tiempo: '2026-11-11T14:06:00Z' },
      { tipo: 'medicion', dispositivo_id: 'otro', canal_id: 'c1', valor: 5, unidad: 'Cel', tiempo: '2026-11-11T14:07:00Z' },
    ]);
    expect(r.cambiados).toEqual([D]);
    expect(r.datos.dispositivos[0]!.canales[0]!.ultima).toEqual({ valor: 21, tiempo: '2026-11-11T14:05:00Z', porcentaje: null });
    expect(r.datos.dispositivos[0]!.visto_por_ultima_vez).toBe('2026-11-11T14:06:00Z');
    expect(r.datos.dispositivos[0]!.canales[0]!.chispa).toEqual([1, 2, null, 4]); // la tendencia no se toca en vivo
    const nada = aplicarAvisos(datos(), [{ tipo: 'medicion', dispositivo_id: D, canal_id: 'c9', valor: 5, unidad: 'Cel', tiempo: '2026-11-11T15:00:00Z' }]);
    expect(nada.cambiados).toEqual([]);
  });
  it('conservarTendencia: una lectura sin tendencia guarda la línea ya leída de cada canal; con tendencia nueva, manda la nueva', () => {
    const sin: AhoraSitio = { ...datos(), tendencia: false, dispositivos: datos().dispositivos.map((d) => ({ ...d, canales: d.canales.map(({ chispa: _c, ...c }) => c) })) };
    delete sin.chispa;
    const r = conservarTendencia(sin, datos());
    expect(r.tendencia).toBe(true);
    expect(r.dispositivos[0]!.canales[0]!.chispa).toEqual([1, 2, null, 4]);
    expect(conservarTendencia(sin, null)).toBe(sin);
  });
  it('lecturaVieja: más de dos intervalos esperados', () => {
    const ahora = new Date('2026-11-11T15:00:00Z');
    expect(lecturaVieja('2026-11-11T14:58:00Z', 60, ahora)).toBe(false); // justo dos
    expect(lecturaVieja('2026-11-11T14:57:59Z', 60, ahora)).toBe(true);
  });
  it('cifraAhora: los decimales que se leen de un vistazo, con coma', () => {
    expect([1010.7, 17.234, 3.714, -97, 0.5].map(cifraAhora)).toEqual(['1.011', '17,2', '3,71', '-97', '0,5']);
  });
  it('trazosChispa: un tramo por racha sin huecos; un punto suelto se dibuja; sin datos, nada', () => {
    expect(trazosChispa([1, 2, null, 4, 5], 40, 20)).toHaveLength(2);
    expect(trazosChispa([null, 3, null], 40, 20)).toEqual(['M20.0 10.0 l0.1 0']);
    expect(trazosChispa([null, null], 40, 20)).toEqual([]);
    const [t] = trazosChispa([0, 10], 10, 10);
    expect(t).toBe('M0.0 9.0 L10.0 1.0'); // el mínimo abajo, el máximo arriba, con un píxel de margen
  });
});
