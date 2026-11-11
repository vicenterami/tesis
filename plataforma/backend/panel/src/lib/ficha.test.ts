import { describe, expect, it } from 'vitest';
import type { TramaRechazada } from './modelo';
import { agruparRechazadas, textoEvento } from './ficha';

const t = (id: string, motivo: TramaRechazada['motivo'], detalle: string | null, recibido_en: string): TramaRechazada =>
  ({ id, origen: 'mqtt', topico: null, motivo, detalle, dispositivo: 'dev-0001', recibido_en, payload: id, payload_formato: 'texto' });

describe('ficha v2: rechazadas agrupadas (D6) y eventos en palabras (D5)', () => {
  it('veinte filas iguales son un grupo «× 20» con la última; otro detalle es otro grupo', () => {
    const filas = [
      ...Array.from({ length: 20 }, (_, i) => t(`a${i}`, 'invalida', 'temperatura fuera de rango', `2026-10-12T1${i % 10}:00:00Z`)),
      t('b', 'invalida', 'humedad fuera de rango', '2026-10-12T09:30:00Z'),
      t('c', 'malformada', null, '2026-10-12T19:30:00Z'),
    ];
    const g = agruparRechazadas(filas);
    expect(g.map((x) => [x.motivo, x.n])).toEqual([['malformada', 1], ['invalida', 20], ['invalida', 1]]);
    expect(g[1]!.ultima.recibido_en).toBe('2026-10-12T19:00:00Z');
    expect(agruparRechazadas([])).toEqual([]);
  });
  it('un evento dice quién lo hizo, o que fue el sistema', () => {
    expect(textoEvento({ id: '1', tipo: 'umbrales', detalle: null, ocurrido_en: 'x', usuario: { id: 'u', nombre: 'Ana' } })).toBe('Cambio de umbrales · cambiado por Ana');
    expect(textoEvento({ id: '1b', tipo: 'alta', detalle: null, ocurrido_en: 'x', usuario: { id: 'u', nombre: 'Ana' } })).toBe('Alta del dispositivo · registrado por Ana');
    // usuario null (quien mira no administra el sitio, o lo hizo el sistema): no se inventa nada sobre quién (G1, 11/11/2026)
    expect(textoEvento({ id: '2', tipo: 'mantenimiento', detalle: null, ocurrido_en: 'x', usuario: null })).toBe('Pasó a mantenimiento');
    expect(textoEvento({ id: '3', tipo: 'otro_tipo', detalle: null, ocurrido_en: 'x', usuario: null })).toBe('otro tipo');
    expect(textoEvento({ id: '4', tipo: 'reglas_cambiadas', detalle: null, ocurrido_en: 'x', usuario: null })).toBe('Cambio de umbrales');
  });
});
