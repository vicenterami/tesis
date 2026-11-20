// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ZonaSitio from './ZonaSitio.svelte';
import { fijarZonaPropia } from './lib/zona-propia.svelte';

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

// Zona propia (docs/19 §4, H): la línea dice en cuál van las horas y no avisa por el navegador; con la propia igual a la del sitio, nada cambia.
describe('ZonaSitio con zona propia', () => {
  afterEach(() => fijarZonaPropia(null));
  it('zona propia distinta: la hora de esa zona y el aviso de que no es la del sitio', () => {
    fijarZonaPropia('Europe/Madrid');
    render(ZonaSitio, { zona: 'America/Santiago', navegador: 'Asia/Tokyo' });
    expect(document.querySelector('[data-hora-sitio]')!.textContent).toBe('Hora en tu zona: 22/10/2026 14:00:00 · Europe/Madrid (UTC+02:00)');
    expect(document.querySelector('[data-aviso-zona-propia]')!.textContent!.replace(/\s+/g, ' ')).toBe(
      'Elegiste ver las horas en Europe/Madrid en lugar de la del sitio (America/Santiago, UTC−03:00); las fechas que escribes en un filtro o una exportación siguen en la zona del sitio');
    expect(document.querySelector('[data-aviso-zona]')).toBeNull();
  });
  it('zona propia igual a la del sitio: como sin preferencia', () => {
    fijarZonaPropia('America/Santiago');
    render(ZonaSitio, { zona: 'America/Santiago', navegador: 'Europe/Madrid' });
    expect(document.querySelector('[data-hora-sitio]')!.textContent).toContain('Hora en el sitio:');
    expect(document.querySelector('[data-aviso-zona-propia]')).toBeNull();
    expect(document.querySelector('[data-aviso-zona]')).not.toBeNull();
  });
  it('varias zonas en la lista: sin propia, «N zonas»; con propia, todas en la tuya', () => {
    render(ZonaSitio, { zona: 'America/Santiago', zonasDeLaLista: 2 });
    expect(document.querySelector('[data-hora-sitio]')!.textContent).toBe('2 zonas horarias: cada fila va en la de su sitio');
    cleanup();
    fijarZonaPropia('Europe/Madrid');
    render(ZonaSitio, { zona: 'America/Santiago', zonasDeLaLista: 2 });
    expect(document.querySelector('[data-hora-sitio]')!.textContent).toContain('Hora en tu zona:');
    expect(document.querySelector('[data-aviso-zona-propia]')!.textContent).toContain('en lugar de la de cada sitio');
  });
});
