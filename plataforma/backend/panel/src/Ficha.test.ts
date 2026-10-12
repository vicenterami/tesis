// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Condicion, DispositivoFicha, Historico, TramaRechazada } from './lib/modelo';

// uPlot dibuja en un canvas, que jsdom no tiene: se sustituye por un doble que registra datos y tamaño.
const graficos: { datos: unknown; destruido: boolean }[] = [];
vi.mock('uplot', () => {
  class UPlotFalso {
    constructor(_o: unknown, datos: unknown, el: HTMLElement) {
      el.appendChild(document.createElement('canvas'));
      graficos.push({ datos, destruido: false });
    }
    setData(d: unknown): void { graficos[graficos.length - 1]!.datos = d; }
    setSize(): void {}
    destroy(): void { graficos[graficos.length - 1]!.destruido = true; }
    static tzDate(d: Date): Date { return d; }
  }
  return { default: UPlotFalso };
});
vi.mock('uplot/dist/uPlot.min.css', () => ({}));
import Ficha from './Ficha.svelte';

const ID = '00000000-0000-4000-8000-000000000001';
const AHORA = new Date('2026-10-12T15:00:00Z');
const ficha: DispositivoFicha = {
  id: ID, id_fisico: 'dev-0001', nombre: 'Invernadero', estado: 'activo', via: 'mqtt', formato: 'senml', intervalo_esperado_s: 60,
  visto_por_ultima_vez: '2026-10-12T14:59:30Z', en_linea: true, zona: 'Lab', sitio: 'Campus', zona_horaria: 'America/Santiago',
  creado_en: '2026-10-01T12:00:00Z',
  canales: [
    { id: 'c-temp', magnitud: 'temperatura', magnitud_nombre: 'Temperatura', unidad: 'Cel', etiqueta: null, reglas: [{ id: 'r1', umbral_alto: 30, umbral_bajo: 5, histeresis: 0.5 }], ultima_medicion: { valor: 21.5, tiempo: '2026-10-12T14:59:30Z' } },
    { id: 'c-hum', magnitud: 'humedad', magnitud_nombre: 'Humedad', unidad: '%RH', etiqueta: 'suelo', reglas: null, ultima_medicion: null },
  ],
};
const condiciones: Condicion[] = [
  { id: 'k1', tipo: 'umbral', abierta_en: '2026-10-12T14:00:00Z', cerrada_en: '2026-10-12T14:30:00Z', duracion_s: 1800, dispositivo_id: ID, id_fisico: 'dev-0001', dispositivo: 'Invernadero', umbral_alto: 30, umbral_bajo: 5, magnitud: 'temperatura' },
  { id: 'k2', tipo: 'umbral', abierta_en: '2026-10-12T14:50:00Z', cerrada_en: null, duracion_s: 600, dispositivo_id: ID, id_fisico: 'dev-0001', dispositivo: 'Invernadero', umbral_alto: 30, umbral_bajo: 5, magnitud: 'temperatura' },
];
const rechazadas: TramaRechazada[] = [
  { id: 'q1', origen: 'mqtt', topico: 'sitio/campus/dispositivo/dev-0001/temperatura', motivo: 'invalida', detalle: 'temperatura: 500 Cel fuera del rango físico', dispositivo: 'dev-0001', recibido_en: '2026-10-12T13:00:00Z', payload: '{"v":500}', payload_formato: 'texto' },
];
const historico: Historico = { canal_id: 'c-temp', magnitud: 'temperatura', unidad: 'Cel', zona_horaria: 'America/Santiago', intervalo: '15 minutes', desde: 'x', hasta: 'y', puntos: 2, tiempos: [1760270400, 1760271300], valores: [20, 21], muestras: [3, 3] };

class FuenteInerte { readyState = 1; onopen = null; onerror = null; addEventListener(): void {} close(): void {} }
const peticiones: string[] = [];

beforeEach(() => {
  graficos.length = 0;
  peticiones.length = 0;
  vi.useFakeTimers({ now: AHORA, toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.stubGlobal('EventSource', FuenteInerte);
  vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
    peticiones.push(ruta);
    if (ruta === `/dispositivos/${ID}`) return new Response(JSON.stringify(ficha));
    if (ruta.startsWith('/condiciones?')) return new Response(JSON.stringify(condiciones));
    if (ruta.startsWith('/cuarentena?')) return new Response(JSON.stringify(rechazadas));
    if (ruta.startsWith('/canales/c-temp/historico')) return new Response(JSON.stringify(historico));
    return new Response('', { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Ficha (P3): identidad, canales, gráfico, condiciones y rechazadas, leídos del DOM', () => {
  it('muestra la identidad con el estado visual, una tarjeta por canal con su última lectura y umbrales', async () => {
    render(Ficha, { id: ID });
    await waitFor(() => expect(screen.getByText('Invernadero')).toBeTruthy());
    // Hay una condición de umbral abierta y está en línea → Alerta (y no «Sin señal» ni «Normal»).
    expect(document.querySelector('[data-estado]')?.getAttribute('data-estado')).toBe('alerta');
    expect(screen.getByText('dev-0001')).toBeTruthy();
    expect(screen.getByText('mqtt · senml')).toBeTruthy();
    const lecturas = [...document.querySelectorAll('[data-ultima]')].map((e) => e.textContent);
    expect(lecturas).toEqual(['21,5 Cel', '—']); // sin lectura: raya, sin unidad
    expect(screen.getByText(/umbrales: 5 a 30 \(histéresis 0.5\)/)).toBeTruthy();
    expect(screen.getByText('sin umbrales')).toBeTruthy();
  });

  it('pide el histórico del primer canal con el rango por defecto (24 h, 15 minutes) y se lo entrega al gráfico', async () => {
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-historico]')).toBeTruthy());
    const url = peticiones.find((p) => p.startsWith('/canales/c-temp/historico'))!;
    expect(url).toContain('intervalo=15+minutes');
    expect(url).toContain('desde=2026-10-11T15%3A00%3A00.000Z');
    expect(graficos.at(-1)?.datos).toEqual([[1760270400, 1760271300], [20, 21], [null, null]]);
    expect(document.querySelector('[data-historico]')?.textContent).toContain('2 puntos');
  });

  it('las condiciones salen abiertas primero y las rechazadas con su motivo y la trama plegada', async () => {
    render(Ficha, { id: ID });
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
    const filas = screen.getAllByRole('row').slice(1);
    expect(filas.map((f) => f.getAttribute('data-condicion'))).toEqual(['abierta', 'cerrada']);
    expect(screen.getByText('invalida')).toBeTruthy();
    expect(document.querySelector('details pre')?.textContent).toBe('{"v":500}');
  });

  it('un id que no existe → mensaje con la acción de volver al inventario, sin gráfico', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    render(Ficha, { id: ID });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('vuelve al inventario'));
    expect(graficos).toHaveLength(0);
  });
});
