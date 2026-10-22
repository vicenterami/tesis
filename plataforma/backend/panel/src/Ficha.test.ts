// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Condicion, DispositivoFicha, Historico, TramaRechazada } from './lib/modelo';

// uPlot dibuja en un canvas, que jsdom no tiene: se sustituye por un doble que registra datos y tamaño.
const graficos: { datos: unknown; destruido: boolean; titulo: string }[] = [];
vi.mock('uplot', () => {
  class UPlotFalso {
    constructor(o: { title: string }, datos: unknown, el: HTMLElement) {
      el.appendChild(document.createElement('canvas'));
      graficos.push({ datos, destruido: false, titulo: o.title });
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
  visto_por_ultima_vez: '2026-10-12T14:59:30Z', en_linea: true, zona: 'Lab', sitio: 'Campus', zona_horaria: 'America/Santiago', sitio_codigo: 'uct', zona_id: 'z-lab',
  creado_en: '2026-10-01T12:00:00Z', intervalo_observado_s: 60,
  canales: [
    { id: 'c-temp', magnitud: 'temperatura', magnitud_nombre: 'Temperatura', unidad: 'Cel', etiqueta: null, reglas: [{ id: 'r1', umbral_alto: 30, umbral_bajo: 5, histeresis: 0.5 }], ultima_medicion: { valor: 21.5, tiempo: '2026-10-12T14:59:30Z', porcentaje: null } },
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

// EventSource controlable: la prueba emite eventos y simula la caída y la reapertura.
class FuenteControlable {
  static instancias: FuenteControlable[] = [];
  readyState = 1;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private oyentes = new Map<string, (ev: MessageEvent) => void>();
  constructor() { FuenteControlable.instancias.push(this); }
  addEventListener(tipo: string, f: (ev: MessageEvent) => void): void { this.oyentes.set(tipo, f); }
  close(): void { this.readyState = 2; }
  emitir(tipo: string, data: object): void { this.oyentes.get(tipo)?.({ data: JSON.stringify(data) } as MessageEvent); }
  abrir(): void { this.readyState = 1; this.onopen?.(new Event('open')); }
  caer(): void { this.readyState = 2; this.onerror?.(new Event('error')); }
}
const peticiones: string[] = [];

beforeEach(() => {
  graficos.length = 0;
  peticiones.length = 0;
  vi.useFakeTimers({ now: AHORA, toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  FuenteControlable.instancias.length = 0;
  vi.stubGlobal('EventSource', FuenteControlable);
  vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
    peticiones.push(ruta);
    if (ruta === `/dispositivos/${ID}`) return new Response(JSON.stringify(ficha));
    if (ruta.startsWith('/condiciones?')) return new Response(JSON.stringify(ruta.includes('abiertas=true') ? condiciones.filter((c) => c.cerrada_en === null) : condiciones));
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
    await waitFor(() => expect(graficos).toHaveLength(1));
    expect(peticiones.filter((p) => p.startsWith('/condiciones?')).sort()).toEqual([`/condiciones?dispositivo=${ID}&abiertas=true&limite=500`, `/condiciones?dispositivo=${ID}&limite=50`]);
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

  it('una medición en vivo del canal visible actualiza la tarjeta y entra al gráfico en un lote (250 ms); en pausa, no', async () => {
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-historico]')).toBeTruthy());
    const fuente = FuenteControlable.instancias[0]!;
    fuente.abrir();
    fuente.emitir('medicion', { dispositivo_id: ID, canal_id: 'c-temp', valor: 23.25, unidad: 'Cel', tiempo: '2026-10-12T15:00:05Z' });
    fuente.emitir('medicion', { dispositivo_id: 'otro-dispositivo', canal_id: 'c-temp', valor: 99, unidad: 'Cel', tiempo: '2026-10-12T15:00:06Z' }); // ajeno: se descarta
    await waitFor(() => expect(document.querySelector('[data-ultima]')?.textContent).toBe('23,25 Cel'));
    expect(graficos.at(-1)?.datos).toEqual([[1760270400, 1760271300], [20, 21], [null, null]]); // todavía no: va por lotes
    await vi.advanceTimersByTimeAsync(250);
    expect((graficos.at(-1)?.datos as number[][])[2]).toEqual([null, null, 23.25]);
    screen.getByRole('button', { name: 'Pausar' }).click();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reanudar' })).toBeTruthy());
    fuente.emitir('medicion', { dispositivo_id: ID, canal_id: 'c-temp', valor: 30, unidad: 'Cel', tiempo: '2026-10-12T15:00:07Z' });
    await vi.advanceTimersByTimeAsync(250);
    expect(document.querySelector('[data-ultima]')?.textContent).toBe('23,25 Cel');
    expect((graficos.at(-1)?.datos as number[][])[2]).toEqual([null, null, 23.25]);
  });

  it('el porcentaje calibrado (docs/10 §8.4 punto 51) aparece solo si el canal lo trae; un evento sin el campo no rompe la tarjeta', async () => {
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-historico]')).toBeTruthy());
    expect(document.querySelector('[data-porcentaje]')).toBeNull(); // la ficha de prueba no tiene calibración
    const fuente = FuenteControlable.instancias[0]!;
    fuente.abrir();
    fuente.emitir('medicion', { dispositivo_id: ID, canal_id: 'c-temp', valor: 23.25, unidad: 'Cel', tiempo: '2026-10-12T15:00:05Z', porcentaje: 32.8 });
    await waitFor(() => expect(document.querySelector('[data-porcentaje]')?.textContent).toBe('32,8 % según su calibración'));
    fuente.emitir('medicion', { dispositivo_id: ID, canal_id: 'c-temp', valor: 24, unidad: 'Cel', tiempo: '2026-10-12T15:00:10Z' });
    await waitFor(() => expect(document.querySelector('[data-ultima]')?.textContent).toBe('24 Cel'));
    expect(document.querySelector('[data-porcentaje]')).toBeNull();
  });
  it('el porcentaje que llega en la carga de la ficha (GET /dispositivos/{id}) también se muestra', async () => {
    const calibrada = { ...ficha, canales: ficha.canales.map((c) => (c.id === 'c-temp' ? { ...c, ultima_medicion: { valor: 21.5, tiempo: '2026-10-12T14:59:30Z', porcentaje: 61.4 } } : c)) };
    const base = globalThis.fetch; // el simulador del beforeEach: solo la ficha cambia
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => (ruta === `/dispositivos/${ID}` ? new Response(JSON.stringify(calibrada)) : base(ruta))));
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-porcentaje]')?.textContent).toBe('61,4 % según su calibración'));
  });
  it('un aviso de condición repide las condiciones con antirrebote: diez avisos → una consulta', async () => {
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-historico]')).toBeTruthy());
    const antes = peticiones.filter((p) => p.startsWith('/condiciones?')).length;
    const fuente = FuenteControlable.instancias[0]!;
    fuente.abrir();
    for (let i = 0; i < 10; i++) fuente.emitir('condicion', { dispositivo_id: ID, condicion: 'umbral', estado: 'abierta' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(peticiones.filter((p) => p.startsWith('/condiciones?')).length - antes).toBe(2); // abiertas + recientes: una tanda
  });

  it('al reconectar tras una caída (F4) se repide todo: ficha, condiciones, rechazadas e histórico', async () => {
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-historico]')).toBeTruthy());
    const fichaAntes = peticiones.filter((p) => p === `/dispositivos/${ID}`).length;
    const histAntes = peticiones.filter((p) => p.startsWith('/canales/')).length;
    const fuente = FuenteControlable.instancias[0]!;
    fuente.abrir();
    fuente.caer();
    await waitFor(() => expect(document.querySelector('[data-canal]')?.getAttribute('data-canal')).toBe('reconectando'));
    await vi.advanceTimersByTimeAsync(1000); // primer reintento
    const nueva = FuenteControlable.instancias[1]!;
    nueva.abrir();
    // Bajo temporizadores simulados, waitFor solo despierta con mutaciones del DOM: aquí no las hay (los datos son los mismos),
    // así que se vacían las promesas pendientes a mano antes de mirar.
    await vi.advanceTimersByTimeAsync(10);
    expect(peticiones.filter((p) => p === `/dispositivos/${ID}`).length).toBe(fichaAntes + 1);
    expect(peticiones.filter((p) => p.startsWith('/canales/')).length).toBe(histAntes + 1);
    await waitFor(() => expect(document.querySelector('[data-canal]')?.getAttribute('data-canal')).toBe('en_vivo'));
  });

  it('cambiar de canal recrea el gráfico con el título y la unidad del canal nuevo y pide su histórico', async () => {
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
      peticiones.push(ruta);
      if (ruta === `/dispositivos/${ID}`) return new Response(JSON.stringify(ficha));
      if (ruta.startsWith('/condiciones?')) return new Response(JSON.stringify([]));
      if (ruta.startsWith('/cuarentena?')) return new Response(JSON.stringify([]));
      if (ruta.startsWith('/canales/c-temp/historico')) return new Response(JSON.stringify(historico));
      if (ruta.startsWith('/canales/c-hum/historico')) return new Response(JSON.stringify({ ...historico, canal_id: 'c-hum', magnitud: 'humedad', unidad: '%RH', tiempos: [1], valores: [55], muestras: [1], puntos: 1 }));
      return new Response('', { status: 404 });
    }));
    render(Ficha, { id: ID });
    await waitFor(() => expect(graficos).toHaveLength(1));
    expect(graficos[0]!.titulo).toBe('Temperatura (Cel)');
    document.querySelector<HTMLButtonElement>('[data-canal-id="c-hum"]')!.click();
    await waitFor(() => expect(graficos).toHaveLength(2));
    expect(graficos[0]!.destruido).toBe(true);
    expect(graficos[1]!.titulo).toBe('Humedad (%RH)'); // el título lleva magnitud y unidad; la etiqueta va en la tarjeta
    await waitFor(() => expect(graficos[1]!.datos).toEqual([[1], [55], [null]]));
  });

  it('un id que no existe → mensaje con la acción de volver al inventario, sin gráfico', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    render(Ficha, { id: ID });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('vuelve al inventario'));
    expect(graficos).toHaveLength(0);
  });
});

// Incremento 1 (docs/19 §4, puntos 2 a 5), por el DOM y en los dos sentidos.
describe('Ficha (P3), incremento 1: rango vacío, intervalo observado, reloj de pasarela y «en vivo» con prueba', () => {
  // La ficha con otra última medición del canal visible y un histórico vacío; el resto, el simulador del beforeEach.
  function conUltima(tiempo: string | null, extra: Partial<DispositivoFicha> = {}, puntos = 0): void {
    const f: DispositivoFicha = { ...ficha, ...extra, canales: ficha.canales.map((c) => (c.id === 'c-temp' ? { ...c, ultima_medicion: tiempo === null ? null : { valor: 20, tiempo, porcentaje: null } } : c)) };
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
      if (ruta === `/dispositivos/${ID}`) { peticiones.push(ruta); return new Response(JSON.stringify(f)); }
      if (ruta.startsWith('/canales/c-temp/historico')) {
        peticiones.push(ruta);
        return new Response(JSON.stringify(puntos === 0 ? { ...historico, puntos: 0, tiempos: [], valores: [], muestras: [] } : historico));
      }
      return base(ruta);
    }));
  }
  const vacio = (): string => document.querySelector('[data-rango-vacio]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  it('rango vacío con última medición hace 4 d: lo dice con fecha y hora del sitio, y el botón elige 7 días solo al pulsarlo', async () => {
    conUltima('2026-10-08T15:00:00Z');
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-rango-vacio]')).toBeTruthy());
    expect(vacio()).toContain('Sin mediciones en este rango; la última es de hace 4 d (8 de octubre de 2026, 12:00)');
    const boton = screen.getByRole('button', { name: 'Ver la última medición' });
    // Nunca cambia el rango sin clic: sigue en 24 h y no se pidió otro histórico.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(screen.getByRole('button', { name: '24 horas' }).getAttribute('aria-pressed')).toBe('true');
    expect(peticiones.filter((p) => p.startsWith('/canales/'))).toHaveLength(1);
    boton.click();
    await waitFor(() => expect(screen.getByRole('button', { name: '7 días' }).getAttribute('aria-pressed')).toBe('true'));
    expect(peticiones.filter((p) => p.startsWith('/canales/')).at(-1)).toContain('intervalo=1+hour');
  });

  it('con puntos en el rango no aparece ni el texto ni el botón', async () => {
    conUltima('2026-10-08T15:00:00Z', {}, 2);
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-historico]')?.textContent).toContain('2 puntos'));
    expect(document.querySelector('[data-rango-vacio]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ver la última medición' })).toBeNull();
  });

  it('última medición de hace más de 30 días: remite a exportar, sin botón; sin ninguna medición, solo «sin mediciones»', async () => {
    conUltima('2026-08-01T15:00:00Z');
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-rango-vacio]')).toBeTruthy());
    expect(vacio()).toContain('El panel no dibuja más de 30 días: para verla, exporta sus mediciones.');
    expect(screen.getByRole('link', { name: 'exporta sus mediciones' }).getAttribute('href')).toMatch(new RegExp(`^/dispositivos/${ID}/exportar\\?formato=csv&desde=2026-07-25`));
    expect(screen.queryByRole('button', { name: 'Ver la última medición' })).toBeNull();
    cleanup();
    conUltima(null);
    render(Ficha, { id: ID });
    await waitFor(() => expect(vacio()).toBe('Sin mediciones en este rango.'));
    expect(screen.queryByRole('button', { name: 'Ver la última medición' })).toBeNull();
  });

  it('intervalo observado junto al esperado, con sus dos avisos, sin aviso dentro de la banda y el caso sin datos', async () => {
    const casos: [number | null, number, string, string | null][] = [
      [17, 180, 'reporta cada ≈ 17 s (esperado 3 min)', 'más seguido de lo declarado: revisa el intervalo esperado'],
      [600, 180, 'reporta cada ≈ 10 min (esperado 3 min)', 'más lento de lo declarado: revisa el intervalo esperado'],
      [200, 180, 'reporta cada ≈ 3,3 min (esperado 3 min)', null],
      [null, 180, 'intervalo observado: sin datos suficientes (esperado 3 min)', null],
    ];
    for (const [observado, esperado, texto, aviso] of casos) {
      conUltima('2026-10-12T14:59:30Z', { intervalo_observado_s: observado, intervalo_esperado_s: esperado }, 2);
      render(Ficha, { id: ID });
      await waitFor(() => expect(document.querySelector('[data-intervalo]')).toBeTruthy());
      expect(document.querySelector('[data-intervalo]')!.textContent!.replace(/\s+/g, ' ')).toContain(texto);
      expect(document.querySelector('[data-aviso-intervalo]')?.textContent ?? null).toBe(aviso);
      cleanup();
    }
  });

  it('la condición reloj_desviado abierta se dice en palabras con su hace cuánto, y al cerrarse desaparece sin recargar', async () => {
    let reloj: Condicion[] = [{ ...condiciones[1]!, id: 'k3', tipo: 'reloj_desviado', abierta_en: '2026-10-12T14:40:00Z', magnitud: null }];
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => (ruta.startsWith('/condiciones?') ? new Response(JSON.stringify(reloj)) : base(ruta))));
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-reloj-desviado]')).toBeTruthy());
    expect(document.querySelector('[data-reloj-desviado]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Reloj de pasarela desviado: las mediciones se fechan al llegar · hace 20 min');
    expect(document.querySelector('[data-estado]')?.getAttribute('data-estado')).toBe('alerta');
    reloj = [{ ...reloj[0]!, cerrada_en: '2026-10-12T15:00:00Z' }];
    const fuente = FuenteControlable.instancias[0]!;
    fuente.abrir();
    fuente.emitir('condicion', { dispositivo_id: ID, condicion: 'reloj_desviado', estado: 'cerrada' });
    await vi.advanceTimersByTimeAsync(1000);
    await waitFor(() => expect(document.querySelector('[data-reloj-desviado]')).toBeNull());
    expect(document.querySelector('[data-estado]')?.getAttribute('data-estado')).toBe('normal');
  });

  it('«última lectura hace N s» del canal visible; con el canal en vivo y más de 2 intervalos sin lecturas, «conectado, sin lecturas»', async () => {
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-historico]')).toBeTruthy());
    const enVivo = (): string => document.querySelector('[data-en-vivo]')!.textContent!.trim();
    const ultima = (): string => document.querySelector('[data-ultima-lectura]')!.textContent!.replace(/\s+/g, ' ').trim();
    const fuente = FuenteControlable.instancias[0]!;
    fuente.abrir();
    await waitFor(() => expect(enVivo()).toBe('en vivo: conectado'));
    expect(ultima()).toBe('· última lectura hace 30 s'); // 14:59:30, ahora 15:00:00
    // Pasan 130 s (intervalo esperado 60 s) con latidos pero sin lecturas: el canal vive, el nodo calla.
    for (let i = 0; i < 13; i++) {
      fuente.emitir('latido', { tiempo: new Date().toISOString() });
      await vi.advanceTimersByTimeAsync(10_000);
    }
    expect(enVivo()).toBe('en vivo: conectado, sin lecturas');
    expect(ultima()).toBe('· última lectura hace 2 min');
    fuente.emitir('medicion', { dispositivo_id: ID, canal_id: 'c-temp', valor: 22, unidad: 'Cel', tiempo: new Date().toISOString() });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(enVivo()).toBe('en vivo: conectado');
    expect(ultima()).toBe('· última lectura hace 10 s');
    // Una lectura de OTRO canal no cuenta para el visible.
    for (let i = 0; i < 13; i++) {
      fuente.emitir('latido', { tiempo: new Date().toISOString() });
      if (i % 3 === 0) fuente.emitir('medicion', { dispositivo_id: ID, canal_id: 'c-hum', valor: 50, unidad: '%RH', tiempo: new Date().toISOString() });
      await vi.advanceTimersByTimeAsync(10_000);
    }
    expect(enVivo()).toBe('en vivo: conectado, sin lecturas');
  });
});
