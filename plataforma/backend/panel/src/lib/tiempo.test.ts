import { afterEach, describe, expect, it } from 'vitest';
import { fijarZonaPropia } from './zona-propia.svelte';
import { fechaHoraEn, veEnOtraZona, zonaVista, desfase, duracion, fechaCivil, fechaHora, haceCuanto, haceSegundos, horaLocal, relojSitio, instanteDesdeLocal, localDesdeInstante } from './tiempo';

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
  // Corrección del 19/11/2026: al oeste de UTC, la hora que no existe caía una hora antes (el 00:00 del cambio en Santiago, a las 23:00 del 5/9).
  it('cambio de hora: la hora que no existe cae en la siguiente válida, al oeste y al este de UTC; la repetida, en su primera vez', () => {
    const S = 'America/Santiago'; // el 6/9/2026 a las 00:00 (−04) el reloj salta a la 01:00 (−03); el 5/4/2026 a las 00:00 (−03) vuelve a las 23:00 (−04)
    expect(instanteDesdeLocal('2026-09-06T00:00', S)?.toISOString()).toBe('2026-09-06T04:00:00.000Z'); // la 01:00 del 6/9
    expect(instanteDesdeLocal('2026-09-06T00:30', S)?.toISOString()).toBe('2026-09-06T04:30:00.000Z'); // la 01:30
    expect(instanteDesdeLocal('2026-09-05T23:59', S)?.toISOString()).toBe('2026-09-06T03:59:00.000Z'); // el último minuto antes del salto, intacto
    expect(instanteDesdeLocal('2026-09-06T01:00', S)?.toISOString()).toBe('2026-09-06T04:00:00.000Z');
    expect(instanteDesdeLocal('2026-03-08T02:30', 'America/New_York')?.toISOString()).toBe('2026-03-08T07:30:00.000Z'); // las 03:30 EDT
    expect(instanteDesdeLocal('2026-03-29T02:30', 'Europe/Madrid')?.toISOString()).toBe('2026-03-29T01:30:00.000Z'); // las 03:30 CEST
    expect(instanteDesdeLocal('2026-04-04T23:30', S)?.toISOString()).toBe('2026-04-05T02:30:00.000Z'); // repetida: la primera, en −03
    expect(instanteDesdeLocal('2026-04-05T00:00', S)?.toISOString()).toBe('2026-04-05T04:00:00.000Z');
  });
  it('un texto que no es fecha y hora no da instante (nunca se adivina)', () => {
    expect(instanteDesdeLocal('ayer', 'America/Santiago')).toBeNull();
    expect(instanteDesdeLocal('2026-11-10', 'America/Santiago')).toBeNull();
  });
});

describe('fechaCivil: una fecha sin hora, tal cual, sin pasar por zonas', () => {
  it('AAAA-MM-DD → DD/MM/AAAA; cualquier otra forma se devuelve igual', () => {
    expect(fechaCivil('2026-11-18')).toBe('18/11/2026');
    expect(fechaCivil('2026-01-01')).toBe('01/01/2026'); // el primer día del año no retrocede a diciembre por la zona
    expect(fechaCivil('2026-11-18T10:00:00Z')).toBe('2026-11-18T10:00:00Z');
  });
});

// Zona horaria propia (docs/19 §4, H y D7): lo que se MUESTRA va en la zona elegida; sin ella, en la del sitio; lo que se escribe, siempre en la del sitio.
describe('zona propia aplicada a las horas que se muestran', () => {
  const INSTANTE = '2026-10-22T12:00:00.000Z'; // Santiago ya en horario de verano (UTC−03:00); Madrid sigue en el de invierno (UTC+02:00)
  afterEach(() => fijarZonaPropia(null));

  it('sin preferencia (o «sitio»), la hora va en la zona del sitio', () => {
    expect(zonaVista('America/Santiago')).toBe('America/Santiago');
    fijarZonaPropia('sitio');
    expect(horaLocal(INSTANTE, 'America/Santiago')).toMatch(/9:00:00.*\(2026-10-22T12:00:00\.000Z UTC\)$/); // el formato de fecha de es-CL cambia entre versiones de ICU: se mira la hora
    expect(veEnOtraZona('America/Santiago')).toBe(false);
  });
  it('con una zona propia, horaLocal y fechaHora la usan; el instante UTC no cambia', () => {
    fijarZonaPropia('Europe/Madrid');
    expect(horaLocal(INSTANTE, 'America/Santiago')).toMatch(/(14:00:00|2:00:00 p\. ?m\.).*\(2026-10-22T12:00:00\.000Z UTC\)$/);
    expect(fechaHora(INSTANTE, 'America/Santiago')).toBe('22 de octubre de 2026, 14:00');
    expect(veEnOtraZona('America/Santiago')).toBe(true);
  });
  it('una zona propia inválida vale como «la del sitio»', () => {
    fijarZonaPropia('Marte/Olimpo');
    expect(zonaVista('America/Santiago')).toBe('America/Santiago');
  });
  it('horaEn y fechaHoraEn ignoran la preferencia (lo que dice UTC es UTC)', () => {
    fijarZonaPropia('Europe/Madrid');
    expect(fechaHoraEn(INSTANTE, 'UTC')).toBe('22 de octubre de 2026, 12:00');
  });
  it('lo que se escribe sigue en la zona del sitio aunque haya zona propia', () => {
    fijarZonaPropia('Asia/Tokyo');
    expect(instanteDesdeLocal('2026-10-22T09:00', 'America/Santiago')!.toISOString()).toBe(INSTANTE);
    expect(localDesdeInstante(new Date(INSTANTE), 'America/Santiago')).toBe('2026-10-22T09:00');
  });
  it('cambio de hora: el instante cercano al salto se muestra con el desfase de ese día en la zona propia', () => {
    // Madrid atrasa el reloj el 25/10/2026 a las 03:00 (de +02:00 a +01:00); Santiago lo adelantó el 06/09/2026 a las 00:00 (de −04:00 a −03:00).
    fijarZonaPropia('Europe/Madrid');
    expect(fechaHora('2026-10-25T00:30:00Z', 'America/Santiago')).toBe('25 de octubre de 2026, 02:30'); // aún verano (+02:00)
    expect(fechaHora('2026-10-25T01:30:00Z', 'America/Santiago')).toBe('25 de octubre de 2026, 02:30'); // ya invierno (+01:00): la misma hora en el reloj
    expect(horaLocal('2026-10-25T01:30:00Z', 'America/Santiago')).toContain('(2026-10-25T01:30:00.000Z UTC)');
    // y escribir una hora que no existe en el sitio (00:30 del 06/09) cae en la siguiente válida, la 01:30, sin que la preferencia lo toque
    expect(instanteDesdeLocal('2026-09-06T00:30', 'America/Santiago')!.toISOString()).toBe('2026-09-06T04:30:00.000Z');
  });
});
