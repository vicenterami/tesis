import { describe, expect, it } from 'vitest';
import { duracion, fechaHora, haceCuanto, haceSegundos, horaLocal } from './tiempo';

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

describe('duracion, fechaHora y haceSegundos: textos para personas (docs/19 §6)', () => {
  it('segundos hasta 2 min, minutos hasta 1 h, horas después; coma decimal', () => {
    expect([17, 119, 180, 600, 3600, 5400].map(duracion)).toEqual(['17 s', '119 s', '3 min', '10 min', '1 h', '1,5 h']);
  });
  it('fecha y hora en la zona del sitio, 24 h y mes en español', () => {
    expect(fechaHora('2026-10-08T17:05:00Z', 'America/Santiago')).toBe('8 de octubre de 2026, 14:05');
  });
  it('«hace N s» hasta 2 min; después, en minutos, horas o días', () => {
    const ahora = new Date('2026-10-12T15:00:00Z');
    expect(haceSegundos('2026-10-12T14:59:18Z', ahora)).toBe('hace 42 s');
    expect(haceSegundos('2026-10-12T14:50:00Z', ahora)).toBe('hace 10 min');
  });
});
