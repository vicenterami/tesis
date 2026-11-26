import { describe, expect, it } from 'vitest';
import { MAGNITUDES_ENLACE, lineaSenal, ordenTendencias } from './senal';

// La señal del enlace en el panel (docs/19 §4 AA).
describe('ordenTendencias: la salud al final antes del corte de seis', () => {
  it('lo que se mide primero aunque la salud tenga más canales; dentro, más canales y por nombre', () => {
    const ms = [
      { codigo: 'rssi', nombre: 'Intensidad de señal', canales: 9, salud: true },
      { codigo: 'humedad', nombre: 'Humedad', canales: 2, salud: false },
      { codigo: 'tension', nombre: 'Tensión', canales: 9, salud: true },
      { codigo: 'temperatura', nombre: 'Temperatura', canales: 5, salud: false },
      { codigo: 'presion', nombre: 'Presión', canales: 2 }, // sin `salud` (servidor anterior): cuenta como medida
    ];
    expect(ordenTendencias(ms).map((m) => m.codigo)).toEqual(['temperatura', 'humedad', 'presion', 'rssi', 'tension']);
    expect(ms[0]?.codigo).toBe('rssi'); // no cambia la lista de entrada
  });
});

describe('lineaSenal: la línea de un equipo en «Calidad del enlace»', () => {
  const ahora = new Date('2026-11-25T12:10:00Z');
  it('intensidad y relación señal/ruido con su unidad, coma decimal, menos tipográfico y hace cuánto (la más reciente)', () => {
    expect(lineaSenal({ id: 'd', nombre: 'N', rssi: { valor: -87, tiempo: '2026-11-25T12:00:00Z' }, snr: { valor: -7.5, tiempo: '2026-11-25T12:07:00Z' } }, ahora))
      .toBe('−87 dBm · SNR −7,5 dB · hace 3 min');
  });
  it('con una sola, solo esa; sin ninguna, «sin lecturas de señal»', () => {
    expect(lineaSenal({ id: 'd', nombre: 'N', rssi: null, snr: { valor: 0, tiempo: '2026-11-25T12:09:30Z' } }, ahora)).toBe('SNR 0 dB · ahora');
    expect(lineaSenal({ id: 'd', nombre: 'N', rssi: null, snr: null }, ahora)).toBe('sin lecturas de señal');
  });
  it('las magnitudes que el alta propone son las dos del enlace, con los códigos del catálogo', () => {
    expect(MAGNITUDES_ENLACE.map((m) => m.codigo)).toEqual(['rssi', 'snr']);
  });
});
