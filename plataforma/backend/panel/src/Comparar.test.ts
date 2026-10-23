// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanalFicha, DispositivoFicha, Historico } from './lib/modelo';

// P3b (docs/19 §4, incremento 2, punto 5) por el DOM. uPlot se sustituye por un doble que registra datos y líneas (jsdom no dibuja).
const graficos: { datos: unknown; lineas: string[]; titulo: string }[] = [];
vi.mock('uplot', () => {
  class UPlotFalso {
    constructor(o: { title: string; series: { label: string }[] }, datos: unknown, el: HTMLElement) {
      el.appendChild(document.createElement('canvas'));
      graficos.push({ datos, lineas: o.series.slice(1).map((s) => s.label), titulo: o.title });
    }
    setData(d: unknown): void { graficos[graficos.length - 1]!.datos = d; }
    setSize(): void {}
    destroy(): void {}
    static tzDate(d: Date): Date { return d; }
  }
  return { default: UPlotFalso };
});
vi.mock('uplot/dist/uPlot.min.css', () => ({}));
import Comparar from './Comparar.svelte';

const AHORA = new Date('2026-10-12T15:00:00Z');
const id = (n: number): string => `00000000-0000-4000-8000-00000000000${n}`;
const canal = (cid: string, magnitud: string, unidad: string, valor: number | null): CanalFicha => ({
  id: cid, magnitud, magnitud_nombre: magnitud[0]!.toUpperCase() + magnitud.slice(1), unidad, etiqueta: null, reglas: null,
  ultima_medicion: valor === null ? null : { valor, tiempo: '2026-10-12T14:58:00Z', porcentaje: null },
});
const ficha = (n: number, nombre: string, canales: CanalFicha[]): DispositivoFicha => ({
  id: id(n), id_fisico: `dev-000${n}`, nombre, estado: 'activo', via: 'mqtt', formato: 'senml', intervalo_esperado_s: 60,
  visto_por_ultima_vez: '2026-10-12T14:59:30Z', en_linea: true, zona: 'Lab', sitio: 'Campus', zona_horaria: 'America/Santiago', sitio_codigo: 'uct',
  zona_id: 'z', creado_en: '2026-10-01T00:00:00Z', intervalo_observado_s: 60, canales,
});
const fichas: Record<string, DispositivoFicha> = {
  [id(1)]: ficha(1, 'Invernadero', [canal('c1t', 'temperatura', 'Cel', 21), canal('c1h', 'humedad', '%RH', 50)]),
  [id(2)]: ficha(2, 'Bodega', [canal('c2t', 'temperatura', 'Cel', 18)]),
  [id(3)]: ficha(3, 'Pozo', [canal('c3h', 'humedad', '%RH', 70)]),
  [id(4)]: ficha(4, 'Raro', [canal('c4t', 'temperatura', 'K', 290)]),
};
const hist = (tiempos: number[], valores: number[]): Historico => ({ canal_id: 'x', magnitud: 'temperatura', unidad: 'Cel', zona_horaria: 'America/Santiago', intervalo: '15 minutes', desde: 'x', hasta: 'y', puntos: tiempos.length, tiempos, valores, muestras: tiempos.map(() => 1) });

class FuenteControlable {
  static instancias: FuenteControlable[] = [];
  url: string;
  readyState = 1;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private oyentes = new Map<string, (ev: MessageEvent) => void>();
  constructor(url: string) { this.url = url; FuenteControlable.instancias.push(this); }
  addEventListener(tipo: string, f: (ev: MessageEvent) => void): void { this.oyentes.set(tipo, f); }
  close(): void { this.readyState = 2; }
  emitir(tipo: string, data: object): void { this.oyentes.get(tipo)?.({ data: JSON.stringify(data) } as MessageEvent); }
}
const peticiones: string[] = [];
beforeEach(() => {
  graficos.length = 0;
  peticiones.length = 0;
  FuenteControlable.instancias.length = 0;
  vi.useFakeTimers({ now: AHORA, toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.stubGlobal('EventSource', FuenteControlable);
  vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
    peticiones.push(ruta);
    const f = /^\/dispositivos\/([^/?]+)$/.exec(ruta);
    if (f) return fichas[f[1]!] ? new Response(JSON.stringify(fichas[f[1]!])) : new Response('', { status: 404 });
    if (ruta.startsWith('/condiciones')) return new Response('[]');
    if (ruta.startsWith('/canales/c1t/historico')) return new Response(JSON.stringify(hist([100, 200], [20, 21])));
    if (ruta.startsWith('/canales/c2t/historico')) return new Response(JSON.stringify(hist([200, 300], [17, 18])));
    return new Response('', { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const motivos = (): string[] => [...document.querySelectorAll('[data-fila-comparar]')].map((f) => f.querySelector('[data-motivo]')?.textContent?.trim() ?? '');

describe('Comparar (P3b): la misma magnitud de varios dispositivos', () => {
  it('dibuja una serie por dispositivo alineada por cubo (hueco donde falta), con la misma ventana e intervalo; ninguno se omite en silencio', async () => {
    render(Comparar, { dispositivos: [id(1), id(2), id(3), id(4)] });
    await waitFor(() => expect(graficos).toHaveLength(1));
    // La más común de los marcados: temperatura (3 de 4).
    expect(graficos[0]!.titulo).toBe('Temperatura (Cel)');
    expect(graficos[0]!.lineas).toEqual(['Invernadero', 'Bodega']);
    await waitFor(() => expect(graficos[0]!.datos).toEqual([[100, 200, 300], [20, 21, null], [null, 17, 18]]));
    const hs = peticiones.filter((p) => p.startsWith('/canales/'));
    expect(hs).toHaveLength(2);
    expect(hs[0]!.split('?')[1]).toBe(hs[1]!.split('?')[1]);
    expect(motivos()).toEqual(['', '', '· sin canal de Temperatura', '· unidad distinta (K): no se dibuja']);
    expect(document.querySelector('[data-historico]')?.textContent).toContain('2 series, 3 instantes, promedio por 15 minutos');
  });

  it('una sola conexión a /eventos sin filtro; una lectura de un marcado actualiza su fila sin recargar y la de otro se ignora', async () => {
    render(Comparar, { dispositivos: [id(1), id(2)] });
    await waitFor(() => expect(document.querySelectorAll('[data-fila-comparar]')).toHaveLength(2));
    expect(FuenteControlable.instancias.map((f) => f.url)).toEqual(['/eventos']);
    const fichasAntes = peticiones.filter((p) => p.startsWith('/dispositivos/')).length;
    const fuente = FuenteControlable.instancias[0]!;
    fuente.onopen?.(new Event('open'));
    fuente.emitir('medicion', { dispositivo_id: id(2), canal_id: 'c2t', valor: 19.75, unidad: 'Cel', tiempo: '2026-10-12T15:00:00Z' });
    fuente.emitir('medicion', { dispositivo_id: id(3), canal_id: 'c3h', valor: 99, unidad: '%RH', tiempo: '2026-10-12T15:00:00Z' });
    await vi.advanceTimersByTimeAsync(250);
    const fila = document.querySelector(`[data-fila-comparar="${id(2)}"] [data-ultima]`)!;
    expect(fila.textContent).toBe('19,75 Cel');
    expect(peticiones.filter((p) => p.startsWith('/dispositivos/')).length).toBe(fichasAntes); // sin recargar
    expect(graficos[0]!.datos).toEqual([[100, 200, 300], [20, 21, null], [null, 17, 18]]); // el gráfico es historia: no recibe el vivo
  });

  it('cambiar de magnitud vuelve a pedir el gráfico; menos de dos marcados y ninguno que la mida tienen su mensaje', async () => {
    render(Comparar, { dispositivos: [id(1), id(2), id(3)], magnitud: 'humedad' });
    await waitFor(() => expect(document.querySelectorAll('[data-fila-comparar]')).toHaveLength(3));
    expect(motivos()).toEqual(['', '· sin canal de Humedad', '']);
    cleanup();
    render(Comparar, { dispositivos: [id(1), id(2)], magnitud: 'presion' });
    await waitFor(() => expect(document.querySelector('[data-comparar-sin-magnitud]')?.textContent).toBe('Ninguno de los marcados mide presion.'));
    cleanup();
    render(Comparar, { dispositivos: [id(1)] });
    expect(document.querySelector('[data-comparar-vacio]')?.textContent).toContain('Marca al menos dos dispositivos en el inventario');
  });

  it('escribe en la URL lo que dibuja; un dispositivo que ya no existe se dice en su fila', async () => {
    const vistas: string[] = [];
    render(Comparar, { dispositivos: [id(1), id(2), id(9)], rango: '7d', res: '5m', alCambiarVista: (f: string) => vistas.push(f) });
    await waitFor(() => expect(vistas).toHaveLength(1));
    expect(vistas[0]).toBe(`#/comparar?dispositivos=${id(1)},${id(2)},${id(9)}&magnitud=temperatura&rango=7d&res=5m`);
    expect(peticiones.find((p) => p.startsWith('/canales/'))).toContain('intervalo=5+minutes');
    expect(motivos()).toEqual(['', '', '· ya no existe']);
  });
});
