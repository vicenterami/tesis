// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoricoSitio, ResumenSitio, Sitio } from './lib/modelo';
import { SERIES } from './lib/tema';
import { UNIDADES_POR_DEFECTO } from './lib/unidades';

// P1 Tablero del sitio (docs/19 §4, tablero v2, B), por el DOM y en los dos sentidos, contra respuestas simuladas del contrato (I y
// «Campos»): los indicadores salen de una sola respuesta y suman el total; la salud dice «N de M reportan»; las gráficas, una por
// magnitud (hasta seis) con su banda y el cursor sincronizado; el rango va a la URL, también a medida en la hora del sitio; el vivo pide
// el resumen con antirrebote y nunca con una ventana fija; los vacíos llevan camino.
const graficos: { titulo: string; opciones: { cursor?: { sync?: { key: string } }; bands?: unknown[]; series: { label?: string }[] }; datos: unknown }[] = [];
vi.mock('uplot', () => {
  class UPlotFalso {
    static paths = { bars: (): (() => null) => () => null };
    lienzo = document.createElement('canvas');
    constructor(o: { title: string }, datos: unknown, el: HTMLElement) {
      el.appendChild(this.lienzo);
      graficos.push({ titulo: o.title, opciones: o as never, datos });
    }
    setData(): void {}
    setSize(): void {}
    redraw(): void {}
    destroy(): void { this.lienzo.remove(); } // como uPlot: al destruir, su lienzo se va (un gráfico recreado no deja dos)
    static tzDate(d: Date): Date { return d; }
  }
  return { default: UPlotFalso };
});
vi.mock('uplot/dist/uPlot.min.css', () => ({}));
import Tablero from './Tablero.svelte';

const AHORA = new Date('2026-11-11T15:00:00Z');
const SITIO: Sitio = { id: 's-uct', codigo: 'uct', nombre: 'Campus', zona_horaria: 'America/Santiago', rol: 'administrador', zonas: [] };
const MAGNITUDES = ['temperatura', 'humedad', 'presion', 'bateria', 'rssi', 'tension', 'temperatura_suelo'];
let resumen: ResumenSitio;
const base = (): ResumenSitio => ({
  sitio: { id: '00000000-0000-4000-8000-000000000001', codigo: 'uct', nombre: 'Campus', zona_horaria: 'America/Santiago' },
  ventana: { desde: '2026-11-10T15:00:00Z', hasta: '2026-11-11T15:00:00Z', intervalo: '15 minutes' },
  dispositivos: { total: 16, normal: 11, alerta: 2, sin_senal: 1, inactivo: 2 },
  salud: { reportan: 13, supervisados: 14, porcentaje: 92.857 },
  condiciones_abiertas: [{ tipo: 'sin_comunicacion', n: 1 }, { tipo: 'umbral', n: 3 }],
  tramas: { recibidas: 1200, rechazadas: 4, cubos: [{ tiempo: 1794405600, recibidas: 50, rechazadas: 1 }, { tiempo: 1794406500, recibidas: 48, rechazadas: 0 }] },
  atencion: [
    { id: '00000000-0000-4000-8000-000000000003', nombre: 'Pozo', estado_visual: 'sin_senal', visto_por_ultima_vez: '2026-11-11T13:00:00Z', tipos: ['sin_comunicacion'] },
    { id: '00000000-0000-4000-8000-000000000004', nombre: 'Azotea', estado_visual: 'alerta', visto_por_ultima_vez: '2026-11-11T14:59:00Z', tipos: ['umbral'] },
  ],
  magnitudes: MAGNITUDES.map((codigo, i) => ({ codigo, nombre: codigo, unidad: codigo === 'temperatura' ? 'Cel' : 'V', canales: 9 - i })),
  entrega: [
    { id: '00000000-0000-4000-8000-000000000003', nombre: 'Pozo', recibidas: 40, esperadas: 96, porcentaje: 41.6 },
    { id: '00000000-0000-4000-8000-000000000004', nombre: 'Azotea', recibidas: 96, esperadas: 96, porcentaje: 100 },
  ],
});
const historico = (magnitud: string): HistoricoSitio => ({
  magnitud, unidad: magnitud === 'temperatura' ? 'Cel' : 'V', zona_horaria: 'America/Santiago', intervalo: '15 minutes', desde: 'x', hasta: 'y', puntos: 2,
  tiempos: [1762869600, 1762870500], valores: [20, 21], minimos: [18, 19], maximos: [23, 24], n: [9, 9],
});
const peticiones: string[] = [];
const oyentes = new Map<string, (ev: MessageEvent) => void>();
class Fuente { readyState = 1; onopen: ((e: Event) => void) | null = null; onerror = null; addEventListener(t: string, f: (ev: MessageEvent) => void): void { oyentes.set(t, f); } close(): void {} }

beforeEach(() => {
  resumen = base();
  graficos.length = 0;
  peticiones.length = 0;
  oyentes.clear();
  vi.useFakeTimers({ now: AHORA, toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.stubGlobal('EventSource', Fuente);
  vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
    peticiones.push(ruta);
    if (ruta.startsWith('/sitios/s-uct/resumen?')) return new Response(JSON.stringify(resumen));
    const h = /^\/sitios\/s-uct\/historico\?(.*)$/.exec(ruta);
    if (h) return new Response(JSON.stringify(historico(new URLSearchParams(h[1]).get('magnitud')!)));
    return new Response('', { status: 404 });
  }));
});
// Grafico.svelte carga uPlot con import dinámico: antes de desmontar se espera a que cada gráfico tenga su doble; si no, la importación
// resolvería después de la prueba con el uPlot real, que sin navegador falla (como en App.test.ts).
afterEach(async () => {
  await waitFor(() => expect(document.querySelectorAll('.grafico canvas').length).toBe(document.querySelectorAll('.grafico').length)).catch(() => undefined);
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.location.hash = '';
});

const montar = (props: Record<string, unknown> = {}) => render(Tablero, { sitio: SITIO, unidades: UNIDADES_POR_DEFECTO, ...props });
const valor = (k: string): string | null | undefined => document.querySelector(`[data-indicador="${k}"] [data-valor]`)?.textContent;
const resumenes = (): string[] => peticiones.filter((p) => p.startsWith('/sitios/s-uct/resumen'));

describe('P1 Tablero: indicadores, atención y gráficas (B2–B4)', () => {
  it('los indicadores salen de una sola respuesta y los cuatro estados suman el total; la salud dice cuántos reportan', async () => {
    montar();
    await waitFor(() => expect(valor('total')).toBe('16'));
    const estados = ['normal', 'alerta', 'sin_senal', 'inactivo'].map((k) => Number(valor(k)));
    expect(estados.reduce((a, b) => a + b, 0)).toBe(16);
    expect(document.querySelector('[data-indicador="total"] [data-detalle]')!.textContent).toBe('normal, alerta, sin señal e inactivos');
    expect(valor('salud')).toBe('93 %');
    expect(document.querySelector('[data-indicador="salud"] [data-detalle]')!.textContent).toContain('13 de 14 reportan');
    expect(document.querySelector('[data-medidor]')!.getAttribute('aria-valuenow')).toBe('93');
    expect(resumenes()).toHaveLength(1); // un valor, un estado: todos los indicadores de una petición
    // Atención: en el orden del servidor, con la condición en palabras; las condiciones por tipo, de más a menos.
    expect([...document.querySelectorAll('[data-atencion-fila]')].map((f) => f.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'Sin señal Pozo hace 2 h · Sin comunicación', 'Alerta Azotea hace 1 min · Umbral',
    ]);
    expect([...document.querySelectorAll('[data-barra]')].slice(0, 2).map((b) => b.getAttribute('data-barra'))).toEqual(['Umbral', 'Sin comunicación']);
  });

  it('en los dos sentidos: si el desglose no suma el total, la tarjeta lo dice (no se disimula)', async () => {
    resumen = { ...base(), dispositivos: { total: 17, normal: 11, alerta: 2, sin_senal: 1, inactivo: 2 } };
    montar();
    await waitFor(() => expect(valor('total')).toBe('17'));
    expect(document.querySelector('[data-indicador="total"] [data-detalle]')!.textContent).toContain('no suma el total');
  });

  it('cada tarjeta de estado lleva al inventario del sitio filtrado por ese estado', async () => {
    montar();
    await waitFor(() => expect(valor('alerta')).toBe('2'));
    (document.querySelector('[data-indicador="alerta"] [data-tarjeta-accion]') as HTMLButtonElement).click();
    expect(window.location.hash).toBe('#/inventario?estado=alerta&sitio=uct');
    (document.querySelector('[data-entrega-todos]') as HTMLButtonElement).click();
    expect(window.location.hash).toBe('#/inventario?sitio=uct&orden=entrega');
  });

  it('una gráfica por magnitud (hasta seis) con su banda mín–máx, el cursor sincronizado y la séptima en la lista; tramas apiladas', async () => {
    montar();
    await waitFor(() => expect(document.querySelectorAll('[data-grafico-sitio]')).toHaveLength(6));
    expect(peticiones.filter((p) => p.startsWith('/sitios/s-uct/historico'))).toHaveLength(6);
    expect(peticiones.find((p) => p.includes('magnitud=temperatura'))).toContain('intervalo=15+minutes');
    expect(document.querySelector('[data-magnitudes-lista]')!.textContent).toContain('temperatura_suelo');
    await waitFor(() => expect(graficos.map((g) => g.titulo)).toHaveLength(7));
    const temp = graficos.find((g) => g.titulo === 'temperatura (°C)')!; // la unidad para personas (D7)
    expect(temp.opciones.bands).toHaveLength(1);
    expect(temp.opciones.series.map((s) => s.label)).toEqual(['Hora', 'promedio', 'mínimo', 'máximo']);
    expect(new Set(graficos.map((g) => g.opciones.cursor?.sync?.key))).toEqual(new Set(['tablero-s-uct']));
    const tramas = graficos.find((g) => g.titulo === 'Tramas recibidas y rechazadas')!;
    expect(tramas.datos).toEqual([[1794405600, 1794406500], [51, 48], [50, 48]]); // apiladas: la suma detrás, las recibidas delante
    expect(document.querySelector('[data-aporte]')!.textContent).toContain('Promedio de 9 dispositivos');
    // Cada magnitud con su encabezado, como sus hermanas, y la sección nombrada por él.
    const sec = document.querySelector('[data-magnitud-seccion="humedad"]')!;
    expect(document.getElementById(sec.getAttribute('aria-labelledby')!)!.tagName).toBe('H4');
    expect(screen.getByRole('region', { name: 'humedad' })).toBe(sec);
  });

  it('el rótulo de las tramas sale del intervalo que declara el servidor, no del pedido', async () => {
    resumen = { ...base(), ventana: { ...base().ventana, intervalo: '1 hour' } };
    montar();
    await waitFor(() => expect(document.querySelector('[data-titulo-tramas]')!.textContent).toBe('Tramas por cubo de 1 hora'));
  });

  it('texto alternativo (A3, WCAG 1.1.1): cada gráfica es una imagen con nombre; con varias series, leyenda y tabla con un renglón por punto', async () => {
    montar();
    await waitFor(() => expect(document.querySelectorAll('[data-grafico-sitio]')).toHaveLength(6));
    await waitFor(() => expect(graficos).toHaveLength(7));
    const tramas = screen.getByRole('img', { name: /^Tramas recibidas y rechazadas: rechazadas entre/ });
    expect(tramas.getAttribute('aria-label')).toContain('2 puntos');
    // Toda gráfica con varias series lleva leyenda (la de uPlot: no se apaga) y su tabla de valores.
    for (const g of document.querySelectorAll<HTMLElement>('.grafico')) {
      if (Number(g.dataset.series) < 2) continue;
      expect(g.nextElementSibling!.matches('details[data-datos-grafico]')).toBe(true);
    }
    for (const g of graficos) expect((g.opciones as { legend?: { show?: boolean } }).legend?.show).not.toBe(false);
    const datos = tramas.nextElementSibling as HTMLDetailsElement;
    expect(datos.querySelector('table')).toBeNull(); // cerrada no se arma
    datos.open = true;
    datos.dispatchEvent(new Event('toggle'));
    await waitFor(() => expect(datos.querySelectorAll('tbody tr')).toHaveLength(2)); // tantas filas como puntos
    expect([...datos.querySelectorAll('tbody tr')][0]!.textContent).toContain('1'); // rechazadas del primer cubo: la propia, no la suma
    expect([...datos.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Hora (America/Santiago)', 'rechazadas (tramas)', 'recibidas (tramas)']);
    expect([...[...datos.querySelectorAll('tbody tr')][0]!.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['1', '50']);
    const temp = document.querySelector('[data-grafico-sitio="temperatura"] .grafico')!;
    expect(temp.getAttribute('aria-label')).toBe('temperatura (°C): promedio entre 20 °C y 21 °C, último 21 °C, 2 puntos.');
  });

  it('el tema cambia y las gráficas se vuelven a crear con los colores del tema nuevo', async () => {
    montar();
    await waitFor(() => expect(graficos).toHaveLength(7));
    const trazo = (): string | undefined => (graficos.filter((g) => g.titulo === 'Tramas recibidas y rechazadas').at(-1)!.opciones.series[2] as { stroke?: string }).stroke;
    expect(trazo()).toBe(SERIES.claro[0]);
    document.documentElement.setAttribute('data-theme', 'oscuro');
    await waitFor(() => expect(trazo()).toBe(SERIES.oscuro[0]));
    expect(graficos.length).toBeGreaterThan(7); // recreadas, no solo repintadas con los colores viejos
    document.documentElement.removeAttribute('data-theme');
    await waitFor(() => expect(trazo()).toBe(SERIES.claro[0])); // y de vuelta
  });
});

describe('P1 Tablero: rango, a medida y vivo (B1, B2)', () => {
  it('un preajuste pide el resumen con su ventana y la escribe en la URL', async () => {
    const vistas: string[] = [];
    montar({ alCambiarVista: (f: string) => vistas.push(f) });
    await waitFor(() => expect(vistas.at(-1)).toBe('#/?sitio=uct&rango=24h'));
    screen.getByRole('button', { name: '7 días' }).click();
    await waitFor(() => expect(vistas.at(-1)).toBe('#/?sitio=uct&rango=7d'));
    expect(resumenes().at(-1)).toContain('desde=2026-11-04T15%3A00%3A00.000Z');
  });

  it('a medida: las horas se escriben en la del sitio y la ventana va a la URL en ISO; un fin anterior al inicio se frena junto a los campos', async () => {
    const vistas: string[] = [];
    montar({ alCambiarVista: (f: string) => vistas.push(f) });
    await waitFor(() => expect(valor('total')).toBe('16'));
    screen.getByRole('button', { name: 'A medida' }).click();
    await waitFor(() => expect(document.querySelector('[data-desde]')).toBeTruthy());
    await fireEvent.input(document.querySelector('[data-desde]')!, { target: { value: '2026-11-10T08:00' } });
    await fireEvent.input(document.querySelector('[data-hasta]')!, { target: { value: '2026-11-09T08:00' } });
    await fireEvent.submit(document.querySelector('[data-form-a-medida]')!);
    expect(document.querySelector('[data-error-a-medida]')!.textContent).toBe('El fin debe ser posterior al inicio.');
    const antes = resumenes().length;
    expect(antes).toBe(1); // frenado: ninguna petición
    await fireEvent.input(document.querySelector('[data-hasta]')!, { target: { value: '2026-11-10T20:00' } });
    await fireEvent.submit(document.querySelector('[data-form-a-medida]')!);
    // Santiago en noviembre está en UTC−03:00: 08:00 del sitio son las 11:00 UTC.
    await waitFor(() => expect(vistas.at(-1)).toBe('#/?sitio=uct&desde=2026-11-10T11%3A00%3A00.000Z&hasta=2026-11-10T23%3A00%3A00.000Z'));
    expect(resumenes().at(-1)).toContain('desde=2026-11-10T11%3A00%3A00.000Z');
    expect(peticiones.filter((p) => p.includes('magnitud=temperatura')).at(-1)).toContain('intervalo=15+minutes'); // 12 h: como 24 h
    expect(document.querySelector('[data-canal]')!.textContent).toContain('rango fijo');
  });

  it('en vivo: diez avisos seguidos → un solo resumen (antirrebote de 2 s); con una ventana fija, ninguno', async () => {
    montar();
    await waitFor(() => expect(valor('total')).toBe('16'));
    const antes = resumenes().length;
    for (let i = 0; i < 10; i++) oyentes.get('condicion')!({ data: JSON.stringify({ dispositivo_id: '00000000-0000-4000-8000-000000000003', condicion: 'umbral', estado: 'abierta' }) } as MessageEvent);
    await vi.advanceTimersByTimeAsync(2000);
    expect(resumenes().length - antes).toBe(1);
    expect(resumenes().at(-1)).toContain('intervalo=15+minutes'); // el resumen se pide con el intervalo de la lista cerrada
    expect(peticiones.filter((p) => p.startsWith('/sitios/s-uct/historico'))).toHaveLength(6); // las gráficas son historia: no se repiden
    cleanup();
    peticiones.length = 0;
    montar({ fija: { desde: new Date('2026-11-01T00:00:00Z'), hasta: new Date('2026-11-02T00:00:00Z') } });
    await waitFor(() => expect(resumenes()).toHaveLength(1));
    for (let i = 0; i < 5; i++) oyentes.get('visto')!({ data: JSON.stringify({ dispositivo_id: '00000000-0000-4000-8000-000000000003', tiempo: '2026-11-11T15:00:00Z' }) } as MessageEvent);
    await vi.advanceTimersByTimeAsync(4000);
    expect(resumenes()).toHaveLength(1);
  });

  it('en vivo: un aviso de un dispositivo de otro sitio no repide el resumen; uno de este sitio, sí', async () => {
    montar();
    await waitFor(() => expect(valor('total')).toBe('16'));
    const antes = resumenes().length;
    oyentes.get('visto')!({ data: JSON.stringify({ dispositivo_id: '00000000-0000-4000-8000-0000000000ff', tiempo: '2026-11-11T15:00:00Z' }) } as MessageEvent);
    oyentes.get('condicion')!({ data: JSON.stringify({ dispositivo_id: '00000000-0000-4000-8000-0000000000ff', condicion: 'umbral', estado: 'abierta' }) } as MessageEvent);
    await vi.advanceTimersByTimeAsync(4000);
    expect(resumenes().length).toBe(antes);
    oyentes.get('visto')!({ data: JSON.stringify({ dispositivo_id: '00000000-0000-4000-8000-000000000004', tiempo: '2026-11-11T15:00:00Z' }) } as MessageEvent);
    await vi.advanceTimersByTimeAsync(2000);
    expect(resumenes().length).toBe(antes + 1);
  });

  it('gana la última: un resumen del vivo del rango viejo que llega después de cambiar de rango no pisa los indicadores nuevos', async () => {
    montar();
    await waitFor(() => expect(valor('total')).toBe('16'));
    const f = vi.mocked(fetch).getMockImplementation()!;
    let soltarViejo: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
      peticiones.push(ruta);
      if (ruta.includes('/resumen?') && ruta.includes('desde=2026-11-10T15')) return new Promise<Response>((r) => (soltarViejo = r)); // el del vivo, 24 h
      if (ruta.includes('/resumen?')) return new Response(JSON.stringify({ ...base(), dispositivos: { total: 30, normal: 26, alerta: 2, sin_senal: 1, inactivo: 1 } }));
      return f(ruta);
    }));
    oyentes.get('visto')!({ data: JSON.stringify({ dispositivo_id: '00000000-0000-4000-8000-000000000003', tiempo: '2026-11-11T15:00:00Z' }) } as MessageEvent);
    await vi.advanceTimersByTimeAsync(2000); // el repedido sale y queda en vuelo
    screen.getByRole('button', { name: '7 días' }).click();
    await waitFor(() => expect(valor('total')).toBe('30'));
    soltarViejo(new Response(JSON.stringify({ ...base(), dispositivos: { total: 99, normal: 99, alerta: 0, sin_senal: 0, inactivo: 0 } })));
    await vi.advanceTimersByTimeAsync(10);
    expect(valor('total')).toBe('30');
  });

  it('vacíos con camino: sin dispositivos, el alta; sin tramas en el rango, «Ver los últimos 30 días»', async () => {
    resumen = { ...base(), dispositivos: { total: 0, normal: 0, alerta: 0, sin_senal: 0, inactivo: 0 } };
    montar();
    await waitFor(() => expect(document.querySelector('[data-tablero-vacio]')).toBeTruthy());
    expect(document.querySelector('[data-indicadores]')).toBeNull();
    cleanup();
    resumen = { ...base(), tramas: { recibidas: 0, rechazadas: 0, cubos: [] } };
    const vistas: string[] = [];
    montar({ alCambiarVista: (f: string) => vistas.push(f) });
    await waitFor(() => expect(document.querySelector('[data-sin-tramas]')).toBeTruthy());
    (document.querySelector('[data-ultimos-30]') as HTMLButtonElement).click();
    await waitFor(() => expect(vistas.at(-1)).toBe('#/?sitio=uct&rango=30d'));
  });

  it('un error del resumen se dice con «Reintentar»; reintentar lo recupera', async () => {
    let falla = true;
    const f = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => (falla && ruta.includes('/resumen') ? new Response('', { status: 503 }) : f(ruta))));
    montar();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('saturado'));
    falla = false;
    screen.getByRole('button', { name: 'Reintentar' }).click();
    await waitFor(() => expect(valor('total')).toBe('16'));
  });
});
