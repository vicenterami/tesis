// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ZonaSitio from './ZonaSitio.svelte';

// docs/19 §4, incremento 2, punto 3 (cierra la regla 6 de docs/13): el aviso aparece solo si el navegador está en otra zona.
beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-22T12:00:00Z'), toFake: ['Date', 'setInterval', 'clearInterval'] }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ZonaSitio: hora del sitio y aviso de zona', () => {
  it('navegador en Europe/Madrid y sitio en Santiago: el aviso con el desfase de Madrid ese día', () => {
    render(ZonaSitio, { zona: 'America/Santiago', navegador: 'Europe/Madrid' });
    expect(document.querySelector('[data-hora-sitio]')!.textContent).toBe('Hora en el sitio: 22/10/2026 09:00:00 · America/Santiago (UTC−03:00)');
    expect(document.querySelector('[data-aviso-zona]')!.textContent).toBe('Tu navegador está en Europe/Madrid (UTC+02:00); todas las horas de esta pantalla van en la zona del sitio');
  });
  it('navegador en la zona del sitio, o sin zona declarada: sin aviso', () => {
    render(ZonaSitio, { zona: 'America/Santiago', navegador: 'America/Santiago' });
    expect(document.querySelector('[data-aviso-zona]')).toBeNull();
    cleanup();
    render(ZonaSitio, { zona: 'America/Santiago', navegador: null });
    expect(document.querySelector('[data-aviso-zona]')).toBeNull();
  });
});
