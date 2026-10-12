import { describe, expect, it } from 'vitest';
import { haceCuanto, horaLocal } from './tiempo';

describe('haceCuanto', () => {
  const ahora = new Date('2026-10-12T15:00:00Z');
  it('segundos → «ahora»; minutos, horas y días; null → «sin tramas aún»; nunca negativo', () => {
    expect(haceCuanto('2026-10-12T14:59:30Z', ahora)).toBe('ahora');
    expect(haceCuanto('2026-10-12T14:57:00Z', ahora)).toBe('hace 3 min');
    expect(haceCuanto('2026-10-12T12:30:00Z', ahora)).toBe('hace 2 h');
    expect(haceCuanto('2026-10-07T15:00:00Z', ahora)).toBe('hace 5 d');
    expect(haceCuanto(null, ahora)).toBe('sin tramas aún');
    expect(haceCuanto('2026-10-12T15:00:30Z', ahora)).toBe('ahora');
  });
});

describe('horaLocal: hora de la zona del sitio con el UTC al lado (docs/13)', () => {
  it('en América/Santiago, las 15:00 UTC del 12/10/2026 son las 12:00 (horario de verano)', () => {
    const t = horaLocal('2026-10-12T15:00:00.000Z', 'America/Santiago');
    expect(t).toContain('12:00:00');
    expect(t).toContain('(2026-10-12T15:00:00.000Z UTC)');
  });
});
