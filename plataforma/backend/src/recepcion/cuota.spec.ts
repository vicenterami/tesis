import { describe, expect, it } from 'vitest';
import { CuotaPorEmisor, inicioDeVentana } from './cuota.js';

// Cuota de cuarentena en memoria para lo que el filtro 1 rechaza (docs/10 §8.4 punto 53 (iii)).
describe('CuotaPorEmisor', () => {
  const t = (iso: string) => new Date(iso);
  it('la ventana es la hora del reloj: 10:59:59 y 10:00:00 comparten contador; 11:00:00 empieza otro', () => {
    expect(inicioDeVentana(t('2026-10-17T10:59:59.999Z')).toISOString()).toBe('2026-10-17T10:00:00.000Z');
    const c = new CuotaPorEmisor();
    const a = c.contador('pasarela:p1', t('2026-10-17T10:00:00Z'));
    a.guardadas = 3;
    expect(c.contador('pasarela:p1', t('2026-10-17T10:59:59Z')).guardadas).toBe(3);
    expect(c.contador('pasarela:p1', t('2026-10-17T11:00:00Z')).guardadas).toBe(0);
    expect(c.contador('pasarela:p2', t('2026-10-17T11:00:00Z')).guardadas).toBe(0); // otro emisor, otro contador
  });
  it('con más emisores que el tope, suelta primero las ventanas vencidas y después las más antiguas', () => {
    const c = new CuotaPorEmisor(3);
    c.contador('a', t('2026-10-17T09:00:00Z'));
    c.contador('b', t('2026-10-17T10:00:00Z'));
    c.contador('c', t('2026-10-17T10:00:00Z'));
    c.contador('d', t('2026-10-17T10:00:00Z')); // «a» está vencido: se suelta; «b» y «c» siguen
    expect(c.claves).toBe(3);
    c.contador('b', t('2026-10-17T10:00:00Z')).guardadas = 7;
    c.contador('e', t('2026-10-17T10:00:00Z')); // nada vencido: se suelta la más antigua (b)
    expect(c.claves).toBe(3);
    expect(c.contador('b', t('2026-10-17T10:00:00Z')).guardadas).toBe(0);
  });
});
