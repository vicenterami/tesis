import { describe, expect, it } from 'vitest';
import { desfase, duracion, fechaHora, haceCuanto, haceSegundos, horaLocal, relojSitio, instanteDesdeLocal, localDesdeInstante } from './tiempo';

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

// Incremento 2, punto 3 (docs/13 regla 6): el desfase sale del nombre IANA en el instante dado, nunca fijo.
describe('desfase y reloj del sitio', () => {
  it('Santiago en verano (UTC−03:00) y en invierno (UTC−04:00); Madrid el 22/10/2026 (UTC+02:00); UTC; India con media hora', () => {
    expect(desfase('America/Santiago', new Date('2026-01-15T12:00:00Z'))).toBe('UTC\u221203:00');
    expect(desfase('America/Santiago', new Date('2026-07-15T12:00:00Z'))).toBe('UTC\u221204:00');
    expect(desfase('America/Santiago', new Date('2026-10-22T12:00:00Z'))).toBe('UTC\u221203:00');
    expect(desfase('Europe/Madrid', new Date('2026-10-22T12:00:00Z'))).toBe('UTC+02:00');
    expect(desfase('Europe/Madrid', new Date('2026-12-22T12:00:00Z'))).toBe('UTC+01:00');
    expect(desfase('UTC', new Date('2026-10-22T12:00:00Z'))).toBe('UTC+00:00');
    expect(desfase('Asia/Kolkata', new Date('2026-10-22T12:00:00Z'))).toBe('UTC+05:30');
  });
  it('sin «longOffset» (navegador antiguo) se calcula igual', () => {
    const Original = Intl.DateTimeFormat;
    const Falso = function (this: unknown, l?: string | string[], o?: Intl.DateTimeFormatOptions) {
      if (o?.timeZoneName === 'longOffset') throw new RangeError('timeZoneName');
      return new Original(l, o);
    } as unknown as typeof Intl.DateTimeFormat;
    Intl.DateTimeFormat = Falso;
    try {
      expect(desfase('America/Santiago', new Date('2026-07-15T12:00:00Z'))).toBe('UTC\u221204:00');
      expect(desfase('America/New_York', new Date('2026-07-15T12:00:00Z'))).toBe('UTC\u221204:00'); // «short» da «EDT»: se calcula de las partes
    } finally {
      Intl.DateTimeFormat = Original;
    }
  });
  it('el reloj del sitio, con segundos y en 24 h', () => {
    expect(relojSitio('America/Santiago', new Date('2026-10-23T00:58:07Z'))).toBe('22/10/2026 21:58:07');
  });
});


// Rango a medida (HU-07; docs/19 §4, tablero v2, B1): la hora del campo datetime-local es la del SITIO, no la del navegador.
describe('rango a medida: hora del sitio ↔ instante', () => {
  it('Santiago en invierno (UTC−04:00) y en verano (UTC−03:00); ida y vuelta', () => {
    expect(instanteDesdeLocal('2026-07-10T08:30', 'America/Santiago')?.toISOString()).toBe('2026-07-10T12:30:00.000Z');
    expect(instanteDesdeLocal('2026-11-10T08:30', 'America/Santiago')?.toISOString()).toBe('2026-11-10T11:30:00.000Z');
    expect(localDesdeInstante(new Date('2026-11-10T11:30:00Z'), 'America/Santiago')).toBe('2026-11-10T08:30');
    expect(localDesdeInstante(instanteDesdeLocal('2026-07-10T23:59', 'Europe/Madrid')!, 'Europe/Madrid')).toBe('2026-07-10T23:59');
  });
  it('un texto que no es fecha y hora no da instante (nunca se adivina)', () => {
    expect(instanteDesdeLocal('ayer', 'America/Santiago')).toBeNull();
    expect(instanteDesdeLocal('2026-11-10', 'America/Santiago')).toBeNull();
  });
});
