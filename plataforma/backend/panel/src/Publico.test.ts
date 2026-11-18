// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VistaPublica } from './lib/publico';

// P9, la pantalla de quien visita (docs/19 §4, O, puntos 5 a 9 y 11), por el DOM: el token solo en la cabecera, `carga=si` solo en la
// primera petición, los refrescos, la pausa, la ventana, los textos de 404, 429 y 503, y nada guardado en el navegador.
vi.mock('uplot', () => {
  class UPlotFalso {
    constructor(_o: unknown, _d: unknown, el: HTMLElement) { el.appendChild(document.createElement('canvas')); }
    setData(): void {}
    setSize(): void {}
    redraw(): void {}
    setCursor(): void {}
    destroy(): void {}
    static paths = { bars: (): (() => null) => () => null };
    static tzDate(d: Date): Date { return d; }
  }
  return { default: UPlotFalso };
});
vi.mock('uplot/dist/uPlot.min.css', () => ({}));
import Publico from './Publico.svelte';

const TOKEN = 'Zz09_-'.repeat(7) + 'Q'; // 43 caracteres base64url, sintético
const VISTA: VistaPublica = {
  titulo: 'Clima del invernadero', descripcion: null, sitio: 'Campus', zona_horaria: 'America/Santiago', minimo_dispositivos: 3,
  ventana: '24h', ventanas: ['24h', '7d'], intervalo: '5 minutes', desde: '2026-11-16T15:00:00Z', hasta: '2026-11-17T15:00:00Z',
  ultimo_dato: '2026-11-17T14:55:00Z', tiempos: [1_763_391_000, 1_763_391_300],
  magnitudes: [{ codigo: 'temperatura', nombre: 'Temperatura', unidad: 'Cel', ahora: 21.4, serie: [21.2, null], protegido: true, zonas: [{ nombre: 'Norte', ahora: null, serie: [null, 21] }] }],
};
let peticiones: { url: string; init: RequestInit }[] = [];
let respuesta: () => Response = () => new Response(JSON.stringify(VISTA));
let guardado: string[] = [];

beforeEach(() => {
  peticiones = [];
  guardado = [];
  respuesta = () => new Response(JSON.stringify(VISTA));
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    peticiones.push({ url, init });
    return respuesta();
  }));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => { guardado.push(k); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const texto = (sel: string): string => (document.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('P9, quien visita', () => {
  it('la primera petición lleva `carga=si`; los refrescos no; el token va solo en la cabecera, sin cookies; se dibuja lo que respondió', async () => {
    render(Publico, { token: TOKEN, cadaMs: 40 });
    await waitFor(() => expect(texto('[data-vp-titulo]')).toBe('Clima del invernadero'));
    expect(texto('[data-vp-sitio]')).toBe('Campus');
    expect(texto('[data-vp-magnitud="temperatura"] [data-vp-ahora]')).toBe('21,4 °C');
    expect(texto('[data-vp-zona="Norte"] [data-vp-zona-ahora]')).toBe('Sin dato');
    expect(texto('[data-vp-k]')).toBe('Promedio de 3 o más dispositivos, ahora');
    expect(texto('[data-vp-protegido]')).toContain('Algunos tramos se ocultan para proteger a equipos individuales.');
    expect(texto('[data-vp-pie]')).toBe('Vista pública de solo lectura · promedios del sitio');
    await waitFor(() => expect(peticiones.length).toBeGreaterThanOrEqual(3));
    expect(peticiones.map((p) => p.url).slice(0, 3)).toEqual(['/publico?ventana=24h&carga=si', '/publico?ventana=24h', '/publico?ventana=24h']);
    for (const p of peticiones) {
      expect(p.url).not.toContain(TOKEN);
      expect((p.init.headers as Record<string, string>)['X-Enlace-Publico']).toBe(TOKEN);
      expect(p.init.credentials).toBe('omit');
    }
    expect(guardado).toEqual([]); // ni localStorage ni sessionStorage
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('cambiar la ventana pide esa ventana (sin `carga`); las ofrecidas son las que permite el enlace', async () => {
    render(Publico, { token: TOKEN, cadaMs: 60_000 });
    await waitFor(() => expect(document.querySelector('[data-vp-ventana="7d"]')).toBeTruthy());
    expect(document.querySelector('[data-vp-ventana="30d"]')).toBeNull();
    expect(document.querySelector('[data-vp-ventana="24h"]')!.getAttribute('aria-pressed')).toBe('true');
    (document.querySelector('[data-vp-ventana="7d"]') as HTMLButtonElement).click();
    await waitFor(() => expect(peticiones.at(-1)!.url).toBe('/publico?ventana=7d'));
  });

  it('«Pausar actualización» detiene los refrescos; «Reanudar» pide de inmediato', async () => {
    render(Publico, { token: TOKEN, cadaMs: 40 });
    await waitFor(() => expect(document.querySelector('[data-vp-pausa]')).toBeTruthy());
    (document.querySelector('[data-vp-pausa]') as HTMLButtonElement).click();
    const n = peticiones.length;
    await new Promise((r) => setTimeout(r, 150));
    expect(peticiones.length).toBe(n);
    expect(texto('[data-vp-pausa]')).toBe('Reanudar actualización');
    (document.querySelector('[data-vp-pausa]') as HTMLButtonElement).click();
    await waitFor(() => expect(peticiones.length).toBe(n + 1));
  });

  it('404: un solo mensaje, nada de lo anterior, y no se vuelve a pedir', async () => {
    render(Publico, { token: TOKEN, cadaMs: 40 });
    await waitFor(() => expect(document.querySelector('[data-vp-titulo]')).toBeTruthy());
    respuesta = () => new Response('{"statusCode":404,"message":"enlace no disponible"}', { status: 404 });
    await waitFor(() => expect(document.querySelector('[data-vp-no-disponible]')).toBeTruthy());
    expect(texto('[data-vp-no-disponible]')).toBe('Este enlace ya no está disponible. Pídele uno nuevo a quien te lo compartió.');
    expect(document.querySelector('[data-vista-publica]')).toBeNull();
    const n = peticiones.length;
    await new Promise((r) => setTimeout(r, 150));
    expect(peticiones.length).toBe(n);
  });

  it('429 y 503: se conserva lo último mostrado, se dice y se reintenta', async () => {
    render(Publico, { token: TOKEN, cadaMs: 40 });
    await waitFor(() => expect(document.querySelector('[data-vp-titulo]')).toBeTruthy());
    respuesta = () => new Response('{}', { status: 429 });
    await waitFor(() => expect(texto('[data-vp-problema]')).toBe('Hay muchas visitas en este momento. La página se actualizará sola en un minuto.'));
    expect(texto('[data-vp-titulo]')).toBe('Clima del invernadero');
    respuesta = () => new Response('{}', { status: 503 });
    await waitFor(() => expect(texto('[data-vp-problema]')).toBe('Los datos están tardando. La página volverá a intentarlo en un minuto.'));
    respuesta = () => new Response(JSON.stringify(VISTA));
    await waitFor(() => expect(document.querySelector('[data-vp-problema]')).toBeNull());
  });

  it('sin token válido no se pide nada: «no disponible», como respondería el servidor', async () => {
    render(Publico, { token: null });
    await waitFor(() => expect(document.querySelector('[data-vp-no-disponible]')).toBeTruthy());
    expect(peticiones).toEqual([]);
  });

  it('una zona que se llama como la serie del sitio («Promedio del sitio») no rompe la página: la leyenda no usa el nombre como clave', async () => {
    const errores: unknown[] = [];
    const oir = (e: ErrorEvent): void => { errores.push(e.error); };
    window.addEventListener('error', oir);
    respuesta = () => new Response(JSON.stringify({ ...VISTA, magnitudes: VISTA.magnitudes.map((m) => ({ ...m, zonas: [{ nombre: 'Promedio del sitio', ahora: 20, serie: [20, 20] }] })) }));
    render(Publico, { token: TOKEN, cadaMs: 60_000 });
    await waitFor(() => expect(document.querySelectorAll('[data-leyenda-fija] li')).toHaveLength(2));
    expect([...document.querySelectorAll('[data-leyenda-fija] li')].map((l) => l.textContent)).toEqual(['Promedio del sitio', 'Promedio del sitio']);
    window.removeEventListener('error', oir);
    expect(errores).toEqual([]);
  });

  it('con k = 1 no se dibuja el aviso de lo oculto (`protegido` falso)', async () => {
    respuesta = () => new Response(JSON.stringify({ ...VISTA, minimo_dispositivos: 1, magnitudes: VISTA.magnitudes.map((m) => ({ ...m, protegido: false })) }));
    render(Publico, { token: TOKEN, cadaMs: 60_000 });
    await waitFor(() => expect(document.querySelector('[data-vp-titulo]')).toBeTruthy());
    expect(document.querySelector('[data-vp-protegido]')).toBeNull();
    expect(texto('[data-vp-k]')).toBe('Promedio de 1 o más dispositivos, ahora');
  });
});
