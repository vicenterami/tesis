// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Condicion, DispositivoFicha, EventoDispositivo, Historico, HistoricoDispositivo, TramaRechazada } from './lib/modelo';

// uPlot dibuja en un canvas, que jsdom no tiene: se sustituye por un doble que registra datos y tamaño.
// Desde el tablero v2 también guarda las opciones (ganchos de selección, bandas, cursor) y ofrece lo que el zoom usa: `over` (el doble
// clic), `select` y `posToVal` (aquí, píxel = segundo, para elegir la ventana exacta).
interface Opciones { title: string; bands?: unknown[]; series: { label?: string }[]; cursor?: { sync?: { key: string } }; hooks: { setSelect?: ((u: unknown) => void)[] } }
const graficos: { datos: unknown; destruido: boolean; titulo: string; opciones: Opciones; u: { over: HTMLElement; select: { left: number; width: number } } }[] = [];
vi.mock('uplot', () => {
  class UPlotFalso {
    over = document.createElement('div');
    select = { left: 0, width: 0, top: 0, height: 0 };
    constructor(o: Opciones, datos: unknown, el: HTMLElement) {
      el.appendChild(document.createElement('canvas'));
      graficos.push({ datos, destruido: false, titulo: o.title, opciones: o, u: this });
    }
    posToVal(px: number): number { return px; }
    setSelect(): void {}
    redraw(): void {}
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

let eventos: EventoDispositivo[] = [];
let eventosSiguiente: string | null = null;
const todos: HistoricoDispositivo = {
  tiempos: [1760270400, 1760271300],
  canales: [
    { id: 'c-temp', magnitud: 'temperatura', magnitud_nombre: 'Temperatura', unidad: 'Cel', valores: [20, 21], minimos: [19, 20], maximos: [21, 22] },
    { id: 'c-hum', magnitud: 'humedad', magnitud_nombre: 'Humedad', unidad: '%RH', valores: [40, null], minimos: [38, null], maximos: [42, null] },
  ],
};

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
  eventos = [];
  eventosSiguiente = null;
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
    if (ruta.startsWith(`/dispositivos/${ID}/eventos?`)) return new Response(JSON.stringify(eventos), { headers: eventosSiguiente === null ? {} : { 'X-Siguiente': eventosSiguiente } });
    if (ruta.startsWith(`/dispositivos/${ID}/historico?`)) return new Response(JSON.stringify(todos));
    if (ruta.startsWith(`/dispositivos/${ID}/exportar?`)) return new Response('tiempo,valor\n2026-10-12T14:00:00Z,20\n', { headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="dev-0001_temperatura.csv"' } });
    return new Response('', { status: 404 });
  }));
});
// Descargas por Blob (lib/api.ts, `descargar`; docs/19 §6): jsdom no tiene URL.createObjectURL ni descarga nada; se registra qué se
// pidió, con qué nombre y que el enlace en memoria nunca entra a la página.
function espiarDescargas(): { nombres: string[]; enPagina: () => number } {
  const nombres: string[] = [];
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:prueba'), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { nombres.push(this.download); });
  return { nombres, enPagina: () => document.querySelectorAll('a[href^="blob:"]').length };
}
const llamadaA = (prefijo: string): [string, RequestInit] | undefined =>
  (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][]).find(([r]) => r.startsWith(prefijo));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Ficha (P3): identidad, canales, gráfico, condiciones y rechazadas, leídos del DOM', () => {
  it('muestra la identidad con el estado visual, una tarjeta por canal con su última lectura y umbrales', async () => {
    render(Ficha, { id: ID });
    await waitFor(() => expect(screen.getByText('Invernadero')).toBeTruthy());
    // Hay una condición de umbral abierta y está en línea → Alerta (y no «Sin señal» ni «Normal»).
    expect(document.querySelector('[data-estado]')?.getAttribute('data-estado')).toBe('alerta');
    expect(screen.getByText('dev-0001')).toBeTruthy();
    expect(screen.getByText('mqtt · senml')).toBeTruthy();
    const lecturas = [...document.querySelectorAll('[data-ultima]')].map((e) => e.textContent);
    expect(lecturas).toEqual(['21,5 °C', '—']); // sin lectura: raya, sin unidad
    expect(screen.getByText(/umbrales: 5 °C a 30 °C \(histéresis 0,5 °C\)/)).toBeTruthy();
    expect(screen.getByText('sin umbrales')).toBeTruthy();
  });

  it('pide el histórico del primer canal con el rango por defecto (24 h, 15 minutes) y se lo entrega al gráfico', async () => {
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-historico]')).toBeTruthy());
    await waitFor(() => expect(graficos).toHaveLength(1));
    expect(peticiones.filter((p) => p.startsWith('/condiciones?') && !p.includes('desde=')).sort()).toEqual([`/condiciones?dispositivo=${ID}&abiertas=true&limite=500`, `/condiciones?dispositivo=${ID}&limite=50`]);
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
    expect(screen.getByText('Inválida')).toBeTruthy(); // el motivo en palabras, nunca el código (§6)
    expect(document.querySelector('details pre')?.textContent).toBe('{"v":500}');
  });

  it('una medición en vivo del canal visible actualiza la tarjeta y entra al gráfico en un lote (250 ms); en pausa, no', async () => {
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-historico]')).toBeTruthy());
    await waitFor(() => expect(graficos).toHaveLength(1)); // desde el incremento 2 el gráfico se monta con la primera respuesta (punto 2)
    const fuente = FuenteControlable.instancias[0]!;
    fuente.abrir();
    fuente.emitir('medicion', { dispositivo_id: ID, canal_id: 'c-temp', valor: 23.25, unidad: 'Cel', tiempo: '2026-10-12T15:00:05Z' });
    fuente.emitir('medicion', { dispositivo_id: 'otro-dispositivo', canal_id: 'c-temp', valor: 99, unidad: 'Cel', tiempo: '2026-10-12T15:00:06Z' }); // ajeno: se descarta
    await waitFor(() => expect(document.querySelector('[data-ultima]')?.textContent).toBe('23,25 °C'));
    expect(graficos.at(-1)?.datos).toEqual([[1760270400, 1760271300], [20, 21], [null, null]]); // todavía no: va por lotes
    await vi.advanceTimersByTimeAsync(250);
    expect((graficos.at(-1)?.datos as number[][])[2]).toEqual([null, null, 23.25]);
    screen.getByRole('button', { name: 'Pausar' }).click();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reanudar' })).toBeTruthy());
    fuente.emitir('medicion', { dispositivo_id: ID, canal_id: 'c-temp', valor: 30, unidad: 'Cel', tiempo: '2026-10-12T15:00:07Z' });
    await vi.advanceTimersByTimeAsync(250);
    expect(document.querySelector('[data-ultima]')?.textContent).toBe('23,25 °C');
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
    await waitFor(() => expect(document.querySelector('[data-ultima]')?.textContent).toBe('24 °C'));
    expect(document.querySelector('[data-porcentaje]')).toBeNull();
  });
  it('el porcentaje que llega en la carga de la ficha (GET /dispositivos/{id}) también se muestra', async () => {
    const calibrada = { ...ficha, canales: ficha.canales.map((c) => (c.id === 'c-temp' ? { ...c, ultima_medicion: { valor: 21.5, tiempo: '2026-10-12T14:59:30Z', porcentaje: 61.4 } } : c)) };
    const base = globalThis.fetch; // el simulador del beforeEach: solo la ficha cambia
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => (ruta === `/dispositivos/${ID}` ? new Response(JSON.stringify(calibrada)) : base(ruta))));
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-porcentaje]')?.textContent).toBe('61,4 % según su calibración'));
  });
  it('un aviso de condición vuelve a pedir las condiciones con antirrebote: diez avisos → una consulta', async () => {
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-historico]')).toBeTruthy());
    const antes = peticiones.filter((p) => p.startsWith('/condiciones?')).length;
    const fuente = FuenteControlable.instancias[0]!;
    fuente.abrir();
    for (let i = 0; i < 10; i++) fuente.emitir('condicion', { dispositivo_id: ID, condicion: 'umbral', estado: 'abierta' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(peticiones.filter((p) => p.startsWith('/condiciones?')).length - antes).toBe(2); // abiertas + recientes: una tanda
  });

  it('al reconectar tras una caída (F4) se vuelve a pedir todo: ficha, condiciones, rechazadas e histórico', async () => {
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
    expect(graficos[0]!.titulo).toBe('Temperatura (°C)');
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
    // Un botón que descarga por fetch con la sesión (nunca un enlace directo a la API): la semana que precede a la última medición.
    const d = espiarDescargas();
    screen.getByRole('button', { name: 'Exportar la semana de la última medición' }).click();
    await waitFor(() => expect(d.nombres).toEqual(['dev-0001_temperatura.csv']));
    expect(llamadaA(`/dispositivos/${ID}/exportar`)![0]).toMatch(new RegExp(`^/dispositivos/${ID}/exportar\\?formato=csv&desde=2026-07-25`));
    expect(screen.queryByRole('link', { name: /exporta/ })).toBeNull();
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

  it('canal callado (docs/19 §4): equipo en línea y un canal sin lecturas en 2 intervalos → tarjeta y cabecera lo dicen; una lectura lo quita', async () => {
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-historico]')).toBeTruthy());
    const tarjeta = (c: string): HTMLElement => document.querySelector(`[data-canal-id="${c}"]`)!;
    const aviso = (): string | null => document.querySelector('[data-callados]')?.textContent?.trim() ?? null;
    const fuente = FuenteControlable.instancias[0]!;
    fuente.abrir();
    // Al cargar: c-hum nunca tuvo lecturas y el equipo reportó hace 30 s → callado; c-temp leyó hace 30 s → no.
    expect(tarjeta('c-hum').classList.contains('callado')).toBe(true);
    expect(tarjeta('c-hum').querySelector('[data-callado]')?.textContent).toBe('callado');
    expect(tarjeta('c-hum').querySelector('.vivo')?.textContent).toBe('sin lecturas · callado');
    expect(tarjeta('c-temp').classList.contains('callado')).toBe(false);
    expect(aviso()).toMatch(/^1 canal callado:/);
    // Llega una lectura de c-hum: deja de callar sin recargar.
    fuente.emitir('medicion', { dispositivo_id: ID, canal_id: 'c-hum', valor: 50, unidad: '%RH', tiempo: new Date().toISOString() });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tarjeta('c-hum').classList.contains('callado')).toBe(false);
    expect(aviso()).toBeNull();
    // 130 s con el equipo reportando (visto) y solo c-hum leyendo: calla c-temp (como la presión de la corrida de 24 h).
    for (let i = 0; i < 13; i++) {
      fuente.emitir('visto', { dispositivo_id: ID, tiempo: new Date().toISOString() });
      fuente.emitir('medicion', { dispositivo_id: ID, canal_id: 'c-hum', valor: 50, unidad: '%RH', tiempo: new Date().toISOString() });
      await vi.advanceTimersByTimeAsync(10_000);
    }
    expect(tarjeta('c-temp').classList.contains('callado')).toBe(true);
    expect(tarjeta('c-hum').classList.contains('callado')).toBe(false);
    expect(aviso()).toMatch(/^1 canal callado:/);
    // El equipo deja de reportar: manda «Sin señal» del equipo y los canales ya no se marcan uno a uno.
    await vi.advanceTimersByTimeAsync(130_000);
    expect(document.querySelector('[data-estado]')!.getAttribute('data-estado')).toBe('sin_senal');
    expect(document.querySelectorAll('.canal.callado').length).toBe(0);
    expect(aviso()).toBeNull();
  });
});

// Incremento 2 (docs/19 §4, puntos 2, 3, 4 y 6), por el DOM. La leyenda (punto 1) solo se ve en un navegador real: banco.sh navegador.
describe('Ficha (P3), incremento 2: cambio sin blanco, error con reintento, resolución, hora del sitio, resumen y CSV', () => {
  // El histórico responde cuando la prueba lo decide: así se ve el estado intermedio («cargando…»).
  let pendientes: { ruta: string; responder: (r: Response) => void }[] = [];
  function historicoDiferido(): void {
    pendientes = [];
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((ruta: string) => {
      if (ruta.startsWith('/canales/c-temp/historico')) {
        peticiones.push(ruta);
        return new Promise<Response>((r) => pendientes.push({ ruta, responder: r }));
      }
      return base(ruta);
    }));
  }
  const textoPuntos = (): string => (document.querySelector('[data-historico]') ?? document.querySelector('[data-cargando-texto]'))?.textContent ?? '';
  const datosGrafico = (): unknown => graficos.at(-1)?.datos;

  it('al cambiar de rango conserva la serie anterior y dice «cargando…»; con la respuesta la reemplaza y recién entonces escribe la URL', async () => {
    historicoDiferido();
    const vistas: string[] = [];
    render(Ficha, { id: ID, alCambiarVista: (f: string) => vistas.push(f) });
    await waitFor(() => expect(pendientes).toHaveLength(1));
    pendientes[0]!.responder(new Response(JSON.stringify(historico)));
    await waitFor(() => expect(graficos).toHaveLength(1));
    await waitFor(() => expect(textoPuntos()).toContain('2 puntos'));
    expect(vistas.at(-1)).toBe(`#/dispositivos/${ID}?canal=c-temp&rango=24h`);
    screen.getByRole('button', { name: '7 días' }).click();
    await waitFor(() => expect(textoPuntos()).toBe('cargando…'));
    expect(document.querySelector('[role="group"]')?.getAttribute('aria-busy')).toBe('true');
    expect(datosGrafico()).toEqual([[1760270400, 1760271300], [20, 21], [null, null]]); // la serie anterior sigue
    expect(vistas.at(-1)).toBe(`#/dispositivos/${ID}?canal=c-temp&rango=24h`); // la URL dice lo que se ve
    pendientes[1]!.responder(new Response(JSON.stringify({ ...historico, intervalo: '1 hour', puntos: 1, tiempos: [1760270400], valores: [19], muestras: [60] })));
    await waitFor(() => expect(textoPuntos()).toContain('1 puntos, promedio por 1 hora'));
    expect(datosGrafico()).toEqual([[1760270400], [19], [null]]);
    expect(graficos).toHaveLength(1); // mismo canal: el gráfico no se recrea, solo recibe datos
    expect(vistas.at(-1)).toBe(`#/dispositivos/${ID}?canal=c-temp&rango=7d`);
    expect(document.querySelector('[role="group"]')?.getAttribute('aria-busy')).toBe('false');
  });

  it('con error conserva la serie, dice el error con «Reintentar» y no toca la URL; «Reintentar» vuelve a pedir y se recupera', async () => {
    historicoDiferido();
    const vistas: string[] = [];
    render(Ficha, { id: ID, alCambiarVista: (f: string) => vistas.push(f) });
    await waitFor(() => expect(pendientes).toHaveLength(1));
    pendientes[0]!.responder(new Response(JSON.stringify(historico)));
    await waitFor(() => expect(textoPuntos()).toContain('2 puntos'));
    screen.getByRole('button', { name: '30 días' }).click();
    await waitFor(() => expect(pendientes).toHaveLength(2));
    pendientes[1]!.responder(new Response('', { status: 503 }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('HTTP 503'));
    expect(datosGrafico()).toEqual([[1760270400, 1760271300], [20, 21], [null, null]]);
    expect(textoPuntos()).toContain('2 puntos, promedio por 15 minutos'); // lo dibujado, no lo pedido
    expect(vistas.at(-1)).toBe(`#/dispositivos/${ID}?canal=c-temp&rango=24h`);
    expect(document.querySelector('[data-rango-vacio]')).toBeNull(); // un error no se disfraza de rango vacío
    screen.getByRole('button', { name: 'Reintentar' }).click();
    await waitFor(() => expect(pendientes).toHaveLength(3));
    expect(pendientes[2]!.ruta).toContain('intervalo=6+hours');
    pendientes[2]!.responder(new Response(JSON.stringify({ ...historico, intervalo: '6 hours' })));
    await waitFor(() => expect(vistas.at(-1)).toBe(`#/dispositivos/${ID}?canal=c-temp&rango=30d`));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('resolución: «auto» y las que dan de 2 a 2 500 puntos; elegir una pide su intervalo y la escribe en la URL; un rango donde no sirve vuelve a «auto»', async () => {
    const vistas: string[] = [];
    render(Ficha, { id: ID, alCambiarVista: (f: string) => vistas.push(f) });
    await waitFor(() => expect(textoPuntos()).toContain('2 puntos'));
    const select = document.querySelector<HTMLSelectElement>('[data-resolucion]')!;
    expect([...select.options].map((o) => o.value)).toEqual(['auto', '1m', '5m', '15m', '1h', '6h']);
    expect(select.options[0]!.textContent).toBe('auto (15 minutos)');
    expect(select.options[1]!.textContent).toBe('1 min (1.440 puntos)');
    select.value = '1m';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => expect(vistas.at(-1)).toBe(`#/dispositivos/${ID}?canal=c-temp&rango=24h&res=1m`));
    expect(peticiones.filter((p) => p.startsWith('/canales/')).at(-1)).toContain('intervalo=1+minute');
    screen.getByRole('button', { name: '30 días' }).click(); // 30 días cada minuto serían 43 200 puntos: vuelve a «auto»
    await waitFor(() => expect(vistas.at(-1)).toBe(`#/dispositivos/${ID}?canal=c-temp&rango=30d`));
    expect(peticiones.filter((p) => p.startsWith('/canales/')).at(-1)).toContain('intervalo=6+hours');
    expect(document.querySelector<HTMLSelectElement>('[data-resolucion]')!.value).toBe('auto');
  });

  it('la resolución de la URL se aplica al cargar; una que no sirve para el rango se ignora', async () => {
    render(Ficha, { id: ID, rango: '7d', res: '5m' });
    await waitFor(() => expect(peticiones.some((p) => p.startsWith('/canales/'))).toBe(true));
    expect(peticiones.find((p) => p.startsWith('/canales/'))).toContain('intervalo=5+minutes');
    cleanup();
    peticiones.length = 0;
    render(Ficha, { id: ID, rango: '30d', res: '1m' });
    await waitFor(() => expect(peticiones.some((p) => p.startsWith('/canales/'))).toBe(true));
    expect(peticiones.find((p) => p.startsWith('/canales/'))).toContain('intervalo=6+hours');
  });

  it('bajo el gráfico: mín, máx y promedio de los promedios dibujados, y el CSV de la ventana visible', async () => {
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-resumen-rango]')).toBeTruthy());
    expect(document.querySelector('[data-resumen-rango]')!.textContent!.replace(/\s+/g, ' ')).toBe('en este rango: mín 20 °C · máx 21 °C · promedio de los 2 promedios dibujados 20,5 °C');
    const d = espiarDescargas();
    screen.getByRole('button', { name: 'Descargar CSV de este rango' }).click();
    await waitFor(() => expect(d.nombres).toEqual(['dev-0001_temperatura.csv']));
    const [ruta, init] = llamadaA(`/dispositivos/${ID}/exportar`)!;
    expect(ruta).toBe(`/dispositivos/${ID}/exportar?formato=csv&desde=2026-10-11T15%3A00%3A00.000Z&hasta=2026-10-12T15%3A00%3A00.000Z`);
    expect(init.credentials).toBe('same-origin'); // con la cookie de sesión, sin token en la URL
    expect(d.enPagina()).toBe(0); // el enlace se crea en memoria y no queda en la página
    await waitFor(() => expect(document.querySelector('[data-aviso="exito"]')?.textContent).toContain('Descargado dev-0001_temperatura.csv'));
    expect(screen.queryByRole('link', { name: 'Descargar CSV de este rango' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Comparar con otros dispositivos' }).getAttribute('href')).toBe(`#/comparar?dispositivos=${ID}&magnitud=temperatura&rango=24h`);
  });

  it('rango vacío: el mensaje y un gráfico sin puntos (con la ventana pedida en el eje; se mira en el navegador), sin resumen', async () => {
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => (ruta.startsWith('/canales/c-temp/historico') ? new Response(JSON.stringify({ ...historico, puntos: 0, tiempos: [], valores: [], muestras: [] })) : base(ruta))));
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-rango-vacio]')).toBeTruthy());
    await waitFor(() => expect(graficos).toHaveLength(1));
    expect(document.querySelector('.grafico')?.getAttribute('data-puntos')).toBe('0');
    expect(document.querySelector('[data-resumen-rango]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Descargar CSV de este rango' })).toBeTruthy();
  });

  it('la cabecera dice la hora del sitio con su zona y desfase, al día cada segundo', async () => {
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-hora-sitio]')).toBeTruthy());
    // 15:00:00 UTC del 12/10/2026 en Santiago (horario de verano desde el 6/9) son las 12:00:00
    expect(document.querySelector('[data-hora-sitio]')!.textContent).toBe('Hora en el sitio: 12/10/2026 12:00:00 · America/Santiago (UTC−03:00)');
    await vi.advanceTimersByTimeAsync(3000);
    expect(document.querySelector('[data-reloj-sitio]')!.textContent).toBe('12/10/2026 12:00:03');
  });
});

// Sesión en la ficha (P10; docs/20 §6): exportar exige el perfil de administrador o de investigador en el sitio del dispositivo. El panel lo sabe por la matriz
// que trae GET /sesion; si el servidor igual rechaza, el aviso lo dice, y un 401 lleva al inicio de sesión (manejo central).
describe('Ficha (P3) con sesión: exportar según el rol y descargas que fallan', () => {
  const matriz = { administrador: ['leer', 'exportar', 'escribir', 'usuarios'], consulta: ['leer'] };
  const sesionCon = (rol: 'administrador' | 'consulta') => ({
    sistema: false as const, usuario: { id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid' }, clave_temporal: false,
    sitios: [{ sitio_id: 's1', codigo: 'uct', nombre: 'Campus', rol }], expira_en: null, inactividad_vence_en: null, permisos: matriz,
  });

  it('consulta: el botón de exportar está desactivado y el motivo se lee al lado; administrador: activo y sin motivo', async () => {
    render(Ficha, { id: ID, sesion: sesionCon('consulta') });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Descargar CSV de este rango' })).toBeTruthy());
    const boton = screen.getByRole('button', { name: 'Descargar CSV de este rango' }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    const motivo = document.getElementById(boton.getAttribute('aria-describedby')!.split(' ').find((x) => x.endsWith('-motivo'))!);
    expect(motivo?.textContent).toBe('exportar exige el perfil de administrador o de investigador en este sitio');
    boton.click();
    expect(llamadaA(`/dispositivos/${ID}/exportar`)).toBeUndefined();
    cleanup();
    render(Ficha, { id: ID, sesion: sesionCon('administrador') });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Descargar CSV de este rango' })).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Descargar CSV de este rango' }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector('[data-motivo-desactivado]')).toBeNull();
  });

  it('la descarga con la sesión vencida (401) no descarga nada y avisa al manejo central; un 403 se muestra en un aviso', async () => {
    const { alPerderSesion } = await import('./lib/api');
    const motivos: string[] = [];
    const dejar = alPerderSesion((m) => motivos.push(m));
    const d = espiarDescargas();
    const base = vi.mocked(fetch).getMockImplementation()!;
    let codigo = 401;
    vi.mocked(fetch).mockImplementation(async (ruta, init) =>
      String(ruta).includes('/exportar') ? new Response(JSON.stringify({ statusCode: codigo, message: codigo === 401 ? 'sesión requerida' : 'tu rol en este sitio no permite la acción «exportar»' }), { status: codigo }) : base(ruta, init));
    render(Ficha, { id: ID });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Descargar CSV de este rango' })).toBeTruthy());
    screen.getByRole('button', { name: 'Descargar CSV de este rango' }).click();
    await waitFor(() => expect(motivos).toEqual(['sin_sesion']));
    expect(d.nombres).toEqual([]);
    codigo = 403;
    await waitFor(() => expect((screen.getByRole('button', { name: 'Descargar CSV de este rango' }) as HTMLButtonElement).disabled).toBe(false));
    screen.getByRole('button', { name: 'Descargar CSV de este rango' }).click();
    await waitFor(() => expect(document.querySelector('[data-aviso="error"]')?.textContent).toContain('tu rol en este sitio no permite la acción «exportar»'));
    expect(motivos).toEqual(['sin_sesion']); // el 403 de un rol no es «sin sesión»
    expect(d.nombres).toEqual([]);
    dejar();
  });
});

// Ficha v2 (docs/19 §4, tablero v2, D): zoom que refina, «Volver» y doble clic; mín–máx; umbrales y franjas; todos los canales; eventos
// por cursor; rechazadas agrupadas; unidades de la persona.
describe('Ficha v2: zoom, banda, umbrales, todos los canales, eventos, rechazadas y unidades', () => {
  const HORA = 3600;
  const ahoraS = AHORA.getTime() / 1000;
  const historicos = (): string[] => peticiones.filter((p) => p.startsWith('/canales/c-temp/historico'));
  const seleccionar = (desdeS: number, hastaS: number): void => {
    const g = graficos.at(-1)!;
    g.u.select = { left: desdeS, width: hastaS - desdeS };
    g.opciones.hooks.setSelect![0]!(g.u);
  };

  it('arrastrar acota la ventana: pide la resolución más fina admisible, la escribe en la URL y el vivo deja de agregar puntos; «Volver» y el doble clic deshacen', async () => {
    const vistas: string[] = [];
    render(Ficha, { id: ID, alCambiarVista: (f: string) => vistas.push(f) });
    await waitFor(() => expect(graficos).toHaveLength(1));
    seleccionar(ahoraS - 3 * HORA, ahoraS - 2 * HORA); // una hora, hace tres
    await waitFor(() => expect(historicos()).toHaveLength(2));
    expect(historicos()[1]).toContain('intervalo=1+minute');
    expect(historicos()[1]).toContain('desde=2026-10-12T12%3A00%3A00.000Z');
    await waitFor(() => expect(vistas.at(-1)).toBe(`#/dispositivos/${ID}?canal=c-temp&rango=24h&res=1m&desde=2026-10-12T12%3A00%3A00.000Z&hasta=2026-10-12T13%3A00%3A00.000Z`));
    expect(document.querySelector('[data-rango-fijo]')).toBeTruthy();
    expect(screen.getByRole('button', { name: '24 horas' }).getAttribute('aria-pressed')).toBe('false'); // ningún preajuste: manda la ventana
    // El vivo: la tarjeta se mueve, el gráfico (historia) no.
    const fuente = FuenteControlable.instancias[0]!;
    fuente.abrir();
    fuente.emitir('medicion', { dispositivo_id: ID, canal_id: 'c-temp', valor: 25, unidad: 'Cel', tiempo: '2026-10-12T15:00:05Z' });
    await waitFor(() => expect(document.querySelector('[data-ultima]')?.textContent).toBe('25 °C'));
    await vi.advanceTimersByTimeAsync(300);
    expect((graficos.at(-1)!.datos as unknown[][])[2]).toEqual([null, null]);
    // Un segundo zoom y «Volver»: vuelve al primero; otro «Volver»: al rango completo.
    seleccionar(ahoraS - 3 * HORA, ahoraS - 3 * HORA + 600);
    await waitFor(() => expect(historicos()).toHaveLength(3));
    screen.getByRole('button', { name: 'Volver' }).click();
    await waitFor(() => expect(historicos()).toHaveLength(4));
    expect(historicos()[3]).toContain('desde=2026-10-12T12%3A00%3A00.000Z');
    screen.getByRole('button', { name: 'Volver' }).click();
    await waitFor(() => expect(vistas.at(-1)).toBe(`#/dispositivos/${ID}?canal=c-temp&rango=24h`));
    expect(screen.queryByRole('button', { name: 'Volver' })).toBeNull();
    // El doble clic: al rango completo, terminando en ahora.
    seleccionar(ahoraS - 2 * HORA, ahoraS - HORA);
    await waitFor(() => expect(document.querySelector('[data-rango-fijo]')).toBeTruthy());
    graficos.at(-1)!.u.over.dispatchEvent(new MouseEvent('dblclick'));
    await waitFor(() => expect(vistas.at(-1)).toBe(`#/dispositivos/${ID}?canal=c-temp&rango=24h`));
    expect(historicos().at(-1)).toContain('intervalo=15+minutes');
    expect(document.querySelector('[data-rango-fijo]')).toBeNull();
  });

  it('una ventana de la URL (enlace compartido) se respeta al abrir; un clic sin arrastre no hace zoom', async () => {
    const fija = { desde: new Date('2026-10-12T10:00:00Z'), hasta: new Date('2026-10-12T11:00:00Z') };
    render(Ficha, { id: ID, fija });
    await waitFor(() => expect(historicos()).toHaveLength(1));
    expect(historicos()[0]).toContain('desde=2026-10-12T10%3A00%3A00.000Z');
    expect(historicos()[0]).toContain('intervalo=1+minute');
    await waitFor(() => expect(graficos).toHaveLength(1));
    const g = graficos[0]!;
    g.u.select = { left: ahoraS - HORA, width: 1 };
    g.opciones.hooks.setSelect![0]!(g.u);
    await vi.advanceTimersByTimeAsync(50);
    expect(historicos()).toHaveLength(1);
  });

  it('«Mostrar mín–máx» dibuja la banda del mismo matiz con el mínimo y el máximo de cada cubo; sin esos campos, el botón no aparece', async () => {
    const conBanda = { ...historico, minimos: [19, 20], maximos: [22, 23] };
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => (ruta.startsWith('/canales/c-temp/historico') ? new Response(JSON.stringify(conBanda)) : base(ruta))));
    render(Ficha, { id: ID });
    await waitFor(() => expect(graficos).toHaveLength(1));
    expect(graficos[0]!.opciones.bands).toEqual([]);
    screen.getByRole('button', { name: 'Mostrar mín–máx' }).click();
    await waitFor(() => expect(graficos).toHaveLength(2));
    expect(graficos[1]!.opciones.bands).toHaveLength(1);
    expect(graficos[1]!.opciones.series.map((x) => x.label)).toEqual(['Hora', 'promedio', 'lectura actual', 'mínimo', 'máximo']);
    expect(graficos[1]!.datos).toEqual([[1760270400, 1760271300], [20, 21], [null, null], [19, 20], [22, 23]]);
    cleanup();
    vi.stubGlobal('fetch', base);
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-historico]')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Mostrar mín–máx' })).toBeNull();
  });

  it('umbrales como líneas con etiqueta y su histéresis; las condiciones del canal en la ventana, como franjas', async () => {
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => (ruta.startsWith('/canales/c-hum/historico') ? new Response(JSON.stringify({ ...historico, canal_id: 'c-hum', unidad: '%RH' })) : base(ruta))));
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('.grafico')?.getAttribute('data-umbrales')).toBe('2'));
    expect(peticiones.some((p) => p.startsWith(`/condiciones?dispositivo=${ID}&desde=`))).toBe(true);
    await waitFor(() => expect(document.querySelector('.grafico')?.getAttribute('data-franjas')).toBe('2'));
    expect(document.querySelector('[data-franjas-texto]')!.textContent).toContain('Umbral, Umbral');
    // En los dos sentidos: el canal de humedad no tiene umbrales ni condiciones de su magnitud.
    document.querySelector<HTMLButtonElement>('[data-canal-id="c-hum"]')!.click();
    await waitFor(() => expect(document.querySelector('.grafico')?.getAttribute('data-umbrales')).toBe('0'));
    expect(document.querySelector('.grafico')?.getAttribute('data-franjas')).toBe('0');
  });

  it('si llegan 500 condiciones en la ventana (el tope), un aviso dice que se muestran las 500 más recientes; con menos, nada', async () => {
    const base = globalThis.fetch;
    const muchas = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, tipo: 'umbral', abierta_en: '2026-10-12T14:00:00Z', cerrada_en: '2026-10-12T14:01:00Z', duracion_s: 60, dispositivo_id: ID, id_fisico: 'dev-0001', dispositivo: 'Invernadero', umbral_alto: 30, umbral_bajo: null, magnitud: 'temperatura' }));
    let n = 500;
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => (ruta.startsWith(`/condiciones?dispositivo=${ID}&desde=`) ? new Response(JSON.stringify(muchas(n))) : base(ruta))));
    render(Ficha, { id: ID });
    await waitFor(() => expect(screen.getByText(/Se muestran las 500 condiciones más recientes/)).toBeTruthy());
    cleanup();
    n = 499;
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('.grafico')?.getAttribute('data-franjas')).toBe('499'));
    expect(screen.queryByText(/Se muestran las 500 condiciones más recientes/)).toBeNull();
  });

  it('«Todos los canales»: una petición para todos y una gráfica pequeña por canal, con el cursor sincronizado', async () => {
    render(Ficha, { id: ID });
    await waitFor(() => expect(graficos).toHaveLength(1));
    screen.getByRole('button', { name: 'Todos los canales' }).click();
    await waitFor(() => expect(document.querySelectorAll('[data-grafico-canal]')).toHaveLength(2));
    const pedidas = peticiones.filter((p) => p.startsWith(`/dispositivos/${ID}/historico?`));
    expect(pedidas).toHaveLength(1);
    expect(pedidas[0]).toContain('intervalo=15+minutes');
    await waitFor(() => expect(graficos).toHaveLength(3));
    expect(new Set(graficos.map((g) => g.opciones.cursor?.sync?.key))).toEqual(new Set([`ficha-${ID}`]));
    expect(graficos.map((g) => g.titulo).slice(1)).toEqual(['Temperatura (°C)', 'Humedad (%RH)']);
  });

  it('historial de eventos del rango, con quién lo hizo, y «Más antiguos» por cursor; rechazadas iguales agrupadas con «× N»', async () => {
    eventos = [{ id: 'e1', tipo: 'umbrales', detalle: null, ocurrido_en: '2026-10-12T14:00:00Z', usuario: { id: 'u1', nombre: 'Ana' } }];
    eventosSiguiente = 'cursor-2';
    const iguales = [0, 1, 2].map((i) => ({ ...rechazadas[0]!, id: `q${i}`, recibido_en: `2026-10-12T1${i}:00:00Z` }));
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => (ruta.startsWith('/cuarentena?') ? new Response(JSON.stringify(ruta.includes('cursor=') ? [] : iguales), { headers: ruta.includes('cursor=') ? {} : { 'X-Siguiente': 'r2' } }) : base(ruta))));
    render(Ficha, { id: ID });
    await waitFor(() => expect(document.querySelector('[data-evento="e1"]')?.textContent).toContain('Cambio de umbrales · cambiado por Ana'));
    expect(document.querySelectorAll('[data-grupo-rechazadas]')).toHaveLength(1);
    expect(document.querySelector('[data-veces]')!.textContent).toBe('× 3');
    eventos = [{ id: 'e0', tipo: 'mantenimiento', detalle: null, ocurrido_en: '2026-10-12T09:00:00Z', usuario: null }];
    eventosSiguiente = null;
    screen.getByRole('button', { name: 'Más antiguos' }).click();
    await waitFor(() => expect(document.querySelectorAll('[data-evento]')).toHaveLength(2));
    expect(peticiones.filter((p) => p.includes('/eventos?')).at(-1)).toContain('cursor=cursor-2');
    expect(screen.queryByRole('button', { name: 'Más antiguos' })).toBeNull(); // sin cursor, no hay más
    screen.getByRole('button', { name: 'Más antiguas' }).click();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Más antiguas' })).toBeNull());
    expect(vi.mocked(fetch).mock.calls.map(([r]) => String(r)).some((r) => r.startsWith('/cuarentena?') && r.includes('cursor=r2'))).toBe(true);
  });

  it('unidades de la persona: con °F la tarjeta, el título, la serie y los umbrales se convierten al mostrar (la petición no cambia)', async () => {
    render(Ficha, { id: ID, unidades: { temperatura: 'F', longitud: 'mm' } });
    await waitFor(() => expect(document.querySelector('[data-ultima]')?.textContent).toBe('70,7 °F'));
    await waitFor(() => expect(graficos).toHaveLength(1));
    expect(graficos[0]!.titulo).toBe('Temperatura (°F)');
    expect(graficos[0]!.datos).toEqual([[1760270400, 1760271300], [68, 69.8], [null, null]]);
    expect(screen.getByText(/umbrales: 41 °F a 86 °F \(histéresis 0,9 °F\)/)).toBeTruthy();
    expect(historicos()[0]).not.toContain('F'); // la API no sabe de unidades de la persona
  });
});
