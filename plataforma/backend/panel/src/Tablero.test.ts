// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AhoraSitio, HistoricoSitio, ResumenSitio, Sitio } from './lib/modelo';
import { SERIES } from './lib/tema';
import { UNIDADES_POR_DEFECTO } from './lib/unidades';

// P1 Tablero del sitio (docs/19 §4, tablero v2, B; tablero v3, bloque L), por el DOM y en los dos sentidos, contra respuestas simuladas del
// contrato (I y «Campos»; L6). Resumen: dos pedidos al entrar, la franja de indicadores (enlaces con rótulo y cifra), «Ahora» por magnitud
// y por dispositivo, vivo sin pedir nada por cada trama, el resumen como mucho una vez por minuto, `sitio_id` para saber qué aviso es del
// sitio, «Pausar» y «Reanudar». Tendencias y Red: se piden al abrirlas, con la fila del rango; vivas solo en 1 h y 24 h, con la ventana
// alineada al cubo; una gráfica por magnitud con su banda, las sin datos en una línea; tramas con eje de enteros; etiqueta flotante propia.
interface Opciones {
  title?: string;
  legend?: { show?: boolean };
  cursor?: { sync?: { key: string } };
  bands?: unknown[];
  series: { label?: string; stroke?: string; points?: { show?: boolean | ((u: unknown, s: number, i0: number, i1: number) => boolean) } }[];
  axes: { incrs?: number[] }[];
  scales: { y?: { range?: (u: unknown, min: number, max: number) => [number, number] } };
  hooks: { setCursor?: ((u: unknown) => void)[] };
}
interface Doble { over: HTMLElement; cursor: { idx: number | null; left: number; top: number }; data: unknown }
const graficos: { titulo: string; opciones: Opciones; datos: unknown; u: Doble }[] = [];
vi.mock('uplot', () => {
  class UPlotFalso {
    static paths = { bars: (): (() => null) => () => null };
    lienzo = document.createElement('canvas');
    over = document.createElement('div');
    cursor = { idx: null as number | null, left: -1, top: -1 };
    data: unknown;
    constructor(o: Opciones, datos: unknown, el: HTMLElement) {
      el.appendChild(this.lienzo);
      el.appendChild(this.over);
      this.data = datos;
      graficos.push({ titulo: el.dataset.titulo ?? '', opciones: o, datos, u: this });
    }
    setData(d: unknown): void {
      this.data = d;
      const g = graficos.find((x) => x.u === (this as unknown as Doble));
      if (g) g.datos = d;
    }
    setSize(): void {}
    redraw(): void {}
    // Como uPlot: mover el cursor a una posición elige el cubo más cercano (aquí, el segundo) y avisa a los ganchos.
    setCursor(o: { left: number; top: number }): void {
      this.cursor = { idx: 1, left: o.left, top: o.top };
      const g = graficos.find((x) => x.u === (this as unknown as Doble))!;
      for (const h of g.opciones.hooks.setCursor ?? []) h(this);
    }
    destroy(): void { this.lienzo.remove(); } // como uPlot: al destruir, su lienzo se va (un gráfico recreado no deja dos)
    static tzDate(d: Date): Date { return d; }
  }
  return { default: UPlotFalso };
});
vi.mock('uplot/dist/uPlot.min.css', () => ({}));
import Tablero from './Tablero.svelte';

const AHORA = new Date('2026-11-11T15:00:00Z');
const SITIO: Sitio = { id: 's-uct', codigo: 'uct', nombre: 'Campus', zona_horaria: 'America/Santiago', rol: 'administrador', zonas: [] };
const POZO = '00000000-0000-4000-8000-000000000003';
const AZOTEA = '00000000-0000-4000-8000-000000000004';
const INVERNADERO = '00000000-0000-4000-8000-000000000005';
const NUEVO = '00000000-0000-4000-8000-000000000006';
const C_TEMP = '00000000-0000-4000-8000-0000000000c1';
const C_HUM = '00000000-0000-4000-8000-0000000000c2';
const C_BAT = '00000000-0000-4000-8000-0000000000c3';
const C_INV = '00000000-0000-4000-8000-0000000000c4';
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
    { id: POZO, nombre: 'Pozo', estado_visual: 'sin_senal', visto_por_ultima_vez: '2026-11-11T13:00:00Z', tipos: ['sin_comunicacion'] },
    { id: AZOTEA, nombre: 'Azotea', estado_visual: 'alerta', visto_por_ultima_vez: '2026-11-11T14:59:00Z', tipos: ['umbral'] },
  ],
  magnitudes: MAGNITUDES.map((codigo, i) => ({ codigo, nombre: codigo, unidad: codigo === 'temperatura' ? 'Cel' : 'V', canales: 9 - i })),
  entrega: [
    { id: POZO, nombre: 'Pozo', recibidas: 40, esperadas: 96, porcentaje: 41.6 },
    { id: AZOTEA, nombre: 'Azotea', recibidas: 96, esperadas: 96, porcentaje: 100 },
  ],
});
const chispa = (): (number | null)[] => Array.from({ length: 24 }, (_x, i) => (i === 5 ? null : 15 + (i % 6)));
function datosAhora(tendencia: boolean): AhoraSitio {
  const c = (x: object): object => (tendencia ? { ...x, chispa: chispa() } : x);
  return {
    reportan: 3, sin_senal: 1,
    por_magnitud: [
      { codigo: 'temperatura', nombre: 'Temperatura', unidad: 'Cel', salud: false, canales: 2, promedio: 17.234, minimo: 11.8, maximo: 21.43 },
      { codigo: 'bateria', nombre: 'Nivel de batería', unidad: '%EL', salud: true, canales: 1, promedio: 8, minimo: 8, maximo: 8 },
    ],
    dispositivos: [
      { id: AZOTEA, nombre: 'Azotea', zona: 'Techo', estado_visual: 'alerta', visto_por_ultima_vez: '2026-11-11T14:59:48Z', intervalo_esperado_s: 60, canales_total: 4, canales: [
        c({ id: C_TEMP, magnitud: 'temperatura', magnitud_nombre: 'Temperatura', unidad: 'Cel', salud: false, ultima: { valor: 21.43, tiempo: '2026-11-11T14:59:48Z', porcentaje: null } }),
        c({ id: C_HUM, magnitud: 'humedad', magnitud_nombre: 'Humedad relativa', unidad: '%RH', salud: false, ultima: { valor: 40, tiempo: '2026-11-11T14:57:30Z', porcentaje: null } }),
        c({ id: C_BAT, magnitud: 'bateria', magnitud_nombre: 'Nivel de batería', unidad: '%EL', salud: true, ultima: { valor: 8, tiempo: '2026-11-11T14:59:48Z', porcentaje: null } }),
      ] as never },
      { id: INVERNADERO, nombre: 'Invernadero', zona: 'Norte', estado_visual: 'normal', visto_por_ultima_vez: '2026-11-11T14:58:00Z', intervalo_esperado_s: 300, canales_total: 1, canales: [
        c({ id: C_INV, magnitud: 'temperatura', magnitud_nombre: 'Temperatura', unidad: 'Cel', salud: false, ultima: { valor: 11.8, tiempo: '2026-11-11T14:58:00Z', porcentaje: null } }),
      ] as never },
      { id: NUEVO, nombre: 'Nodo recién instalado', zona: 'Laboratorio', estado_visual: 'normal', visto_por_ultima_vez: null, intervalo_esperado_s: 600, canales_total: 1, canales: [
        c({ id: '00000000-0000-4000-8000-0000000000c5', magnitud: 'temperatura', magnitud_nombre: 'Temperatura', unidad: 'Cel', salud: false, ultima: null }),
      ] as never },
    ],
    tendencia,
    ...(tendencia ? { chispa: { desde: '2026-11-10T16:00:00.000Z', intervalo: '1 hour' as const, puntos: 24 } } : {}),
  };
}
let tendenciaDisponible = true;
const historico = (magnitud: string): HistoricoSitio => ({
  magnitud, unidad: magnitud === 'temperatura' ? 'Cel' : 'V', zona_horaria: 'America/Santiago', intervalo: '15 minutes', desde: 'x', hasta: 'y', puntos: 2,
  tiempos: [1762869600, 1762870500],
  // «tension» no tiene datos en el rango: se nombra en una línea, sin lienzo (L4f).
  valores: magnitud === 'tension' ? [null, null] : [20, 21], minimos: [18, 19], maximos: [23, 24], n: [9, 9],
});
const peticiones: string[] = [];
const oyentes = new Map<string, (ev: MessageEvent) => void>();
class Fuente { readyState = 1; onopen: ((e: Event) => void) | null = null; onerror = null; addEventListener(t: string, f: (ev: MessageEvent) => void): void { oyentes.set(t, f); } close(): void {} }
const aviso = (tipo: string, datos: object): void => oyentes.get(tipo)!({ data: JSON.stringify(datos) } as MessageEvent);

beforeEach(() => {
  resumen = base();
  tendenciaDisponible = true;
  graficos.length = 0;
  peticiones.length = 0;
  oyentes.clear();
  vi.useFakeTimers({ now: AHORA, toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.stubGlobal('EventSource', Fuente);
  vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
    peticiones.push(ruta);
    if (ruta.startsWith('/sitios/s-uct/resumen?')) return new Response(JSON.stringify(resumen));
    if (ruta.startsWith('/sitios/s-uct/ahora?')) return new Response(JSON.stringify(datosAhora(tendenciaDisponible && ruta.includes('tendencia=si'))));
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
const ahoras = (): string[] => peticiones.filter((p) => p.startsWith('/sitios/s-uct/ahora'));
const historicos = (): string[] => peticiones.filter((p) => p.startsWith('/sitios/s-uct/historico'));
const tarjeta = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-ahora-dispositivo="${id}"]`)!;
const valorCanal = (id: string): string => document.querySelector(`[data-ahora-canal="${id}"] [data-ahora-valor]`)?.textContent ?? '';
const listo = (): Promise<void> => waitFor(() => expect(document.querySelector('[data-ahora-dispositivos]')).toBeTruthy());

describe('Resumen (L2, L3): dos pedidos, indicadores y «Ahora»', () => {
  it('al entrar, dos pedidos: el resumen de las últimas 24 horas y «Ahora» con tendencia; ningún histórico y ningún selector de rango', async () => {
    montar();
    await listo();
    expect(resumenes()).toHaveLength(1);
    const q = new URLSearchParams(resumenes()[0]!.split('?')[1]);
    expect([q.get('desde'), q.get('hasta')]).toEqual(['2026-11-10T15:00:00.000Z', '2026-11-11T15:00:00.000Z']);
    expect(ahoras()).toEqual(['/sitios/s-uct/ahora?limite=24&tendencia=si']);
    expect(historicos()).toEqual([]); // los históricos se piden al abrir Tendencias
    expect(peticiones).toHaveLength(2);
    expect(document.querySelector('[data-rango]')).toBeNull(); // el resumen no depende del rango
    expect(screen.getByRole('link', { name: 'Resumen' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Tendencias' }).getAttribute('href')).toBe('#/?sitio=uct&ver=tendencias');
  });

  it('la franja: el enlace de cada ficha se llama por su rótulo y su cifra y lleva al inventario filtrado; los cuatro estados suman el total; «Tramas (24 h)» lleva a Red', async () => {
    montar();
    await waitFor(() => expect(valor('total')).toBe('16'));
    expect(screen.getByRole('link', { name: 'Sin señal: 1' }).getAttribute('href')).toBe('#/inventario?estado=sin_senal&sitio=uct');
    expect(screen.getByRole('link', { name: 'Alerta: 2' }).getAttribute('href')).toBe('#/inventario?estado=alerta&sitio=uct');
    expect(screen.getByRole('link', { name: 'Dispositivos: 16' }).getAttribute('href')).toBe('#/inventario?sitio=uct');
    expect(screen.getByRole('link', { name: 'Tramas (24 h): 1.200' }).getAttribute('href')).toBe('#/?sitio=uct&ver=red&rango=24h');
    expect(screen.getByRole('link', { name: 'Salud del sitio: 93 %' })).toBeTruthy();
    expect(['normal', 'alerta', 'sin_senal', 'inactivo'].map((k) => Number(valor(k))).reduce((a, b) => a + b, 0)).toBe(16);
    expect(document.querySelector('[data-indicador="salud"] [data-detalle]')!.textContent).toContain('13 de 14 reportan');
    expect(document.querySelector('[data-medidor]')!.getAttribute('aria-valuenow')).toBe('93');
    // Ya no hay un «Ver en el inventario» por ficha: cada una de las siete lleva un solo enlace (el suyo) y ningún botón.
    const fichas = [...document.querySelectorAll('[data-indicadores] > li')];
    expect(fichas).toHaveLength(7);
    expect(fichas.map((f) => `${f.querySelectorAll('a').length}/${f.querySelectorAll('button').length}/${f.textContent!.includes('Ver en el inventario')}`)).toEqual(Array(7).fill('1/0/false'));
    // Atención: en el orden del servidor, con la condición en palabras; las condiciones por tipo, de más a menos.
    expect([...document.querySelectorAll('[data-atencion-fila]')].map((f) => f.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'Sin señal Pozo hace 2 h · Sin comunicación', 'Alerta Azotea hace 1 min · Umbral',
    ]);
    expect([...document.querySelectorAll('[data-barra]')].map((b) => b.getAttribute('data-barra'))).toEqual(['Umbral', 'Sin comunicación']);
  });

  it('en los dos sentidos: si el desglose no suma el total, la ficha lo dice (no se disimula)', async () => {
    resumen = { ...base(), dispositivos: { total: 17, normal: 11, alerta: 2, sin_senal: 1, inactivo: 2 } };
    montar();
    await waitFor(() => expect(valor('total')).toBe('17'));
    expect(document.querySelector('[data-indicador="total"] [data-detalle]')!.textContent).toContain('no suma el total');
  });

  it('«Ahora» por magnitud: promedio grande con su unidad para personas, entre mínimo y máximo y cuántos aportan; la salud del equipo al final', async () => {
    montar();
    await listo();
    const magnitudes = [...document.querySelectorAll('[data-ahora-magnitud]')];
    expect(magnitudes.map((m) => m.getAttribute('data-ahora-magnitud'))).toEqual(['temperatura', 'bateria']);
    expect(magnitudes[0]!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Temperatura 17,2°C entre 11,8 y 21,4 · 2 dispositivos');
    expect(magnitudes[1]!.classList.contains('salud')).toBe(true);
    expect(document.querySelector('[data-ahora-conteo]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('3 dispositivos reportan · 1 sin señal, en «Requiere atención»');
  });

  it('«Ahora» por dispositivo: alerta primero, valor grande y tendencia; una lectura vieja se atenúa y dice su antigüedad; «+N»; sin tramas, «esperando la primera trama»', async () => {
    montar();
    await listo();
    expect([...document.querySelectorAll('[data-ahora-dispositivo]')].map((d) => d.getAttribute('data-ahora-dispositivo'))).toEqual([AZOTEA, INVERNADERO, NUEVO]);
    const azotea = tarjeta(AZOTEA);
    expect(azotea.querySelector('a')!.getAttribute('href')).toBe(`#/dispositivos/${AZOTEA}`);
    expect(azotea.querySelector('.estado')!.textContent).toBe('Alerta'); // el estado con su texto, no solo su color
    expect(azotea.querySelector('[data-ahora-hace]')!.textContent).toBe('hace 12 s');
    expect(valorCanal(C_TEMP)).toBe('21,4°C');
    expect(valorCanal(C_BAT)).toBe('8%');
    const humedad = document.querySelector(`[data-ahora-canal="${C_HUM}"]`)!;
    expect(humedad.classList.contains('vieja')).toBe(true); // 150 s con un intervalo de 1 min: más de dos intervalos
    expect(humedad.textContent).toContain('hace 2 min');
    expect(document.querySelector(`[data-ahora-canal="${C_TEMP}"]`)!.classList.contains('vieja')).toBe(false);
    expect(document.querySelector(`[data-ahora-canal="${C_INV}"]`)!.classList.contains('vieja')).toBe(false); // 120 s con 5 min: vigente
    expect(azotea.querySelector('[data-ahora-mas]')!.textContent).toBe('+1 canal en su ficha');
    expect(azotea.querySelectorAll('[data-chispa]')).toHaveLength(3);
    expect(azotea.querySelector('[data-chispa]')!.getAttribute('aria-hidden')).toBe('true'); // decorativa: el dato es el número
    expect(azotea.querySelector('[data-chispa]')!.querySelectorAll('path')).toHaveLength(2); // el hueco de la hora 6 parte la línea
    const nuevo = tarjeta(NUEVO);
    expect(nuevo.querySelector('[data-ahora-hace]')!.textContent).toBe('esperando la primera trama');
    expect(nuevo.querySelector('[data-ahora-valor]')).toBeNull(); // nunca un valor vacío en grande
  });

  it('una ráfaga de avisos `medicion` y `visto` cambia las tarjetas SIN ningún pedido, como mucho una vez por segundo; uno más viejo no pisa', async () => {
    montar();
    await listo();
    const antes = peticiones.length;
    for (let i = 0; i < 20; i++) {
      aviso('medicion', { dispositivo_id: AZOTEA, canal_id: C_TEMP, valor: 22 + i / 10, unidad: 'Cel', tiempo: `2026-11-11T15:00:${String(i).padStart(2, '0')}Z`, sitio_id: 's-uct' });
      aviso('visto', { dispositivo_id: INVERNADERO, tiempo: `2026-11-11T15:00:${String(i).padStart(2, '0')}Z`, sitio_id: 's-uct' });
    }
    aviso('medicion', { dispositivo_id: AZOTEA, canal_id: C_TEMP, valor: 99, unidad: 'Cel', tiempo: '2026-11-11T14:00:00Z', sitio_id: 's-uct' }); // desordenado
    expect(valorCanal(C_TEMP)).toBe('21,4°C'); // todavía no: se dibuja por lotes
    await vi.advanceTimersByTimeAsync(1000);
    expect(valorCanal(C_TEMP)).toBe('23,9°C'); // el último de la ráfaga (22 + 19/10), no el desordenado
    expect(tarjeta(AZOTEA).classList.contains('reciente')).toBe(true); // resalte breve
    expect(tarjeta(INVERNADERO).querySelector('[data-ahora-hace]')!.textContent).toBe('hace 0 s');
    expect(peticiones.length).toBe(antes); // ni resumen ni «Ahora»: nada al servidor
    await vi.advanceTimersByTimeAsync(1000);
    expect(tarjeta(AZOTEA).classList.contains('reciente')).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(peticiones.length).toBe(antes); // tampoco después (ningún antirrebote quedó pendiente)
  });

  it('con tramas continuas, el resumen se repide como mucho una vez por minuto y «Ahora» nunca', async () => {
    montar();
    await listo();
    for (let s = 0; s < 180; s += 5) {
      aviso('visto', { dispositivo_id: AZOTEA, tiempo: new Date(AHORA.getTime() + s * 1000).toISOString(), sitio_id: 's-uct' });
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(resumenes().length).toBeGreaterThanOrEqual(3); // uno por minuto en tres minutos
    expect(resumenes().length).toBeLessThanOrEqual(4); // el de la entrada más tres
    expect(ahoras()).toHaveLength(1);
  });

  it('un aviso `condicion` del sitio repide «Ahora» SIN tendencia y el resumen, una vez (antirrebote); la tendencia leída se conserva', async () => {
    montar();
    await listo();
    for (let i = 0; i < 10; i++) aviso('condicion', { dispositivo_id: POZO, condicion: 'umbral', estado: 'abierta', sitio_id: 's-uct' });
    await vi.advanceTimersByTimeAsync(2000);
    await waitFor(() => expect(ahoras()).toHaveLength(2));
    expect(ahoras()[1]).toBe('/sitios/s-uct/ahora?limite=24'); // sin tendencia
    expect(resumenes()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10);
    expect(tarjeta(AZOTEA).querySelectorAll('[data-chispa]')).toHaveLength(3); // la línea de 24 h sigue
  });

  it('qué aviso es del sitio lo dice `sitio_id`: otro sitio se ignora; con null, solo si el dispositivo ya está a la vista', async () => {
    montar();
    await listo();
    aviso('condicion', { dispositivo_id: AZOTEA, condicion: 'umbral', estado: 'abierta', sitio_id: 'otro-sitio' });
    aviso('medicion', { dispositivo_id: AZOTEA, canal_id: C_TEMP, valor: 50, unidad: 'Cel', tiempo: '2026-11-11T15:00:01Z', sitio_id: 'otro-sitio' });
    aviso('condicion', { dispositivo_id: '00000000-0000-4000-8000-0000000000ff', condicion: 'umbral', estado: 'abierta', sitio_id: null });
    await vi.advanceTimersByTimeAsync(3000);
    expect(ahoras()).toHaveLength(1);
    expect(valorCanal(C_TEMP)).toBe('21,4°C');
    aviso('medicion', { dispositivo_id: AZOTEA, canal_id: C_TEMP, valor: 30, unidad: 'Cel', tiempo: '2026-11-11T15:00:02Z', sitio_id: null }); // a la vista
    await vi.advanceTimersByTimeAsync(1000);
    expect(valorCanal(C_TEMP)).toBe('30°C');
    aviso('condicion', { dispositivo_id: POZO, condicion: 'umbral', estado: 'abierta' }); // sin el campo (un backend anterior): Pozo está en atención
    await vi.advanceTimersByTimeAsync(2000);
    await waitFor(() => expect(ahoras()).toHaveLength(2));
  });

  it('«Pausar» detiene toda actualización (WCAG 2.2.2), también la que ya estaba programada y el reloj de los «hace N s», y dice desde cuándo; «Reanudar» pide una vez lo que se muestra', async () => {
    montar();
    await listo();
    const hace = (): string[] => [...document.querySelectorAll('[data-ahora-hace]')].map((x) => x.textContent ?? '');
    aviso('condicion', { dispositivo_id: POZO, condicion: 'umbral', estado: 'abierta', sitio_id: 's-uct' }); // programa repedir todo a los 2 s…
    await vi.advanceTimersByTimeAsync(500);
    screen.getByRole('button', { name: 'Pausar' }).click(); // …y se pausa antes
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reanudar' }).getAttribute('aria-pressed')).toBe('true'));
    expect(document.querySelector('[data-canal]')!.textContent).toContain('en pausa');
    expect(document.querySelector('[data-pausa-desde]')!.textContent).toMatch(/^ desde las \d{2}:\d{2}:\d{2}$/); // en la hora del sitio
    const haceAlPausar = hace();
    expect(haceAlPausar.length).toBeGreaterThan(0);
    aviso('medicion', { dispositivo_id: AZOTEA, canal_id: C_TEMP, valor: 30, unidad: 'Cel', tiempo: '2026-11-11T15:00:02Z', sitio_id: 's-uct' });
    aviso('condicion', { dispositivo_id: POZO, condicion: 'umbral', estado: 'abierta', sitio_id: 's-uct' });
    await vi.advanceTimersByTimeAsync(70_000);
    expect(valorCanal(C_TEMP)).toBe('21,4°C');
    expect(peticiones).toHaveLength(2); // ni lo programado antes de pausar ni lo que llegó después pidieron nada
    expect(hace()).toEqual(haceAlPausar); // los «hace N s» no avanzaron
    screen.getByRole('button', { name: 'Reanudar' }).click();
    await waitFor(() => expect(ahoras()).toHaveLength(2));
    expect(resumenes()).toHaveLength(2);
    expect(ahoras()[1]).toBe('/sitios/s-uct/ahora?limite=24'); // una vez, sin tendencia
    await vi.advanceTimersByTimeAsync(5000);
    expect(peticiones).toHaveLength(4);
  });

  it('una lectura que llega mientras «Ahora» se repide no se pierde: es posterior a la foto del servidor', async () => {
    montar();
    await listo();
    const base = vi.mocked(fetch).getMockImplementation()!;
    let soltar: (() => void) | null = null;
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
      if (ruta.startsWith('/sitios/s-uct/ahora?') && !ruta.includes('tendencia=si')) await new Promise<void>((ok) => (soltar = ok));
      return base(ruta);
    }));
    aviso('condicion', { dispositivo_id: POZO, condicion: 'umbral', estado: 'abierta', sitio_id: 's-uct' });
    await vi.advanceTimersByTimeAsync(2000); // sale el pedido de «Ahora» y queda en vuelo
    expect(soltar).not.toBeNull();
    aviso('medicion', { dispositivo_id: AZOTEA, canal_id: C_TEMP, valor: 30, unidad: 'Cel', tiempo: '2026-11-11T15:00:02Z', sitio_id: 's-uct' });
    await vi.advanceTimersByTimeAsync(300);
    soltar!(); // la foto del servidor, anterior a esa lectura, llega ahora
    await vi.advanceTimersByTimeAsync(1500); // el lote de un segundo
    expect(valorCanal(C_TEMP)).toBe('30°C');
  });

  it('si el servidor omite la tendencia (`tendencia: false`), las tarjetas salen sin la línea y no se insiste', async () => {
    tendenciaDisponible = false;
    montar();
    await listo();
    expect(document.querySelectorAll('[data-chispa]')).toHaveLength(0);
    expect(valorCanal(C_TEMP)).toBe('21,4°C');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ahoras()).toHaveLength(1);
  });

  it('vacíos con camino: sin dispositivos, el alta', async () => {
    resumen = { ...base(), dispositivos: { total: 0, normal: 0, alerta: 0, sin_senal: 0, inactivo: 0 } };
    montar();
    await waitFor(() => expect(document.querySelector('[data-tablero-vacio]')).toBeTruthy());
    expect(document.querySelector('[data-indicadores]')).toBeNull();
    expect(document.querySelector('[data-ir-alta]')!.getAttribute('href')).toBe('#/alta?sitio=uct');
  });

  it('un error del resumen se dice con «Reintentar»; reintentar lo recupera', async () => {
    let falla = true;
    const f = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => (falla && ruta.includes('/resumen') ? new Response('', { status: 503 }) : f(ruta))));
    montar();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('saturado'));
    expect(document.querySelector('[data-indicadores]')).toBeNull();
    falla = false;
    screen.getByRole('button', { name: 'Reintentar' }).click();
    await waitFor(() => expect(valor('total')).toBe('16'));
  });
});

describe('Tendencias y Red (L2, L4): se piden al abrirlas, con la fila del rango', () => {
  const montarVer = (ver: 'tendencias' | 'red', props: Record<string, unknown> = {}) => montar({ ver, ...props });
  const conLienzo = (): Promise<void> => waitFor(() => expect(document.querySelectorAll('.grafico canvas').length).toBe(document.querySelectorAll('.grafico').length));

  it('Tendencias: el resumen del rango y una gráfica por magnitud con datos (hasta seis), con banda, un título y el cursor sincronizado; las sin datos, en una línea y sin lienzo; la séptima, en la lista', async () => {
    montarVer('tendencias');
    await waitFor(() => expect(document.querySelectorAll('[data-grafico-sitio]')).toHaveLength(5));
    expect(historicos()).toHaveLength(6);
    expect(ahoras()).toEqual([]); // «Ahora» es del resumen
    expect(historicos().find((p) => p.includes('magnitud=temperatura'))).toContain('intervalo=15+minutes');
    expect(document.querySelector('[data-grafico-sitio="tension"]')).toBeNull();
    expect(document.querySelector('[data-magnitudes-vacias]')!.textContent).toBe('Sin datos en este rango: tension.');
    expect(document.querySelector('[data-magnitudes-lista]')!.textContent).toContain('temperatura_suelo');
    await conLienzo();
    expect(graficos).toHaveLength(5);
    const temp = graficos.find((g) => g.titulo === 'temperatura (°C)')!; // la unidad para personas (D7)
    expect(temp.opciones.title).toBeUndefined(); // el lienzo no repite el título: es el de la sección (L4b)
    expect(temp.opciones.legend?.show).toBe(false); // sin la tabla de leyenda de uPlot (L4c)
    expect(temp.opciones.bands).toHaveLength(1);
    expect(temp.opciones.series.map((s) => s.label)).toEqual(['Hora', 'promedio', 'mínimo', 'máximo']);
    expect(new Set(graficos.map((g) => g.opciones.cursor?.sync?.key))).toEqual(new Set(['tablero-s-uct']));
    const sec = document.querySelector('[data-magnitud-seccion="humedad"]')!;
    expect(document.getElementById(sec.getAttribute('aria-labelledby')!)!.textContent).toBe('humedad');
    expect(screen.getByRole('region', { name: 'humedad' })).toBe(sec);
    expect(sec.querySelector('[data-leyenda-fija]')!.textContent).toBe('promediomínimo–máximo'); // nombres con su color, sin valores
    expect(document.querySelector('[data-aporte]')!.textContent).toBe('Promedio de 9 dispositivos por 15 minutos');
  });

  it('puntos solo con 30 o menos y nunca en los bordes de la banda (L4d)', async () => {
    montarVer('tendencias');
    await waitFor(() => expect(graficos.length).toBeGreaterThan(0));
    const s = graficos[0]!.opciones.series;
    const mostrar = s[1]!.points!.show as (u: unknown, si: number, i0: number, i1: number) => boolean;
    expect(mostrar(null, 1, 0, 29)).toBe(true);
    expect(mostrar(null, 1, 0, 30)).toBe(false);
    expect(s[2]!.points!.show).toBe(false);
    expect(s[3]!.points!.show).toBe(false);
  });

  it('Red: tramas por cubo apiladas con eje de enteros desde 0 y entrega de peor a mejor; ningún histórico por magnitud', async () => {
    montarVer('red');
    await waitFor(() => expect(document.querySelector('[data-titulo-tramas]')!.textContent).toBe('Tramas por cubo de 15 minutos')); // el intervalo que declara el servidor
    expect(historicos()).toEqual([]);
    await conLienzo();
    const tramas = graficos.find((g) => g.titulo === 'Tramas recibidas y rechazadas')!;
    expect(tramas.datos).toEqual([[1794405600, 1794406500], [51, 48], [50, 48]]); // apiladas: la suma detrás, las recibidas delante
    expect(tramas.opciones.axes[1]!.incrs!.every((x) => Number.isInteger(x))).toBe(true);
    expect(tramas.opciones.scales.y!.range!(null, 0, 2.4)).toEqual([0, 3]);
    expect([...document.querySelectorAll('[data-barra]')].map((b) => b.getAttribute('data-barra'))).toEqual(['Pozo', 'Azotea']);
    expect(document.querySelector('[data-entrega-todos]')!.getAttribute('href')).toBe('#/inventario?sitio=uct&orden=entrega');
  });

  it('el rótulo de las tramas sale del intervalo que declara el servidor, no del pedido', async () => {
    resumen = { ...base(), ventana: { ...base().ventana, intervalo: '1 hour' } };
    montarVer('red');
    await waitFor(() => expect(document.querySelector('[data-titulo-tramas]')!.textContent).toBe('Tramas por cubo de 1 hora'));
  });

  it('texto alternativo (WCAG 1.1.1): cada gráfica es una imagen con nombre; «Ver los datos» con un renglón por punto, cada serie con su propio número', async () => {
    montarVer('red');
    await conLienzo();
    await waitFor(() => expect(graficos).toHaveLength(1));
    const tramas = screen.getByRole('img', { name: /^Tramas recibidas y rechazadas: rechazadas entre/ });
    expect(tramas.getAttribute('aria-label')).toContain('2 puntos');
    const datos = document.querySelector<HTMLDetailsElement>('[data-datos-grafico]')!;
    expect(datos.querySelector('table')).toBeNull(); // cerrada no se arma
    datos.open = true;
    datos.dispatchEvent(new Event('toggle'));
    await waitFor(() => expect(datos.querySelectorAll('tbody tr')).toHaveLength(2));
    expect([...datos.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Hora (America/Santiago)', 'rechazadas (tramas)', 'recibidas (tramas)']);
    expect([...[...datos.querySelectorAll('tbody tr')][0]!.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['1', '50']);
    expect(document.querySelector('[data-leyenda-fija]')!.textContent).toBe('rechazadasrecibidas');
  });

  it('la etiqueta flotante: solo en el gráfico bajo el puntero, con la hora y el valor de cada serie con su unidad; se va con Escape, al salir o al desplazar', async () => {
    montarVer('tendencias');
    await conLienzo();
    await waitFor(() => expect(graficos).toHaveLength(5));
    const [a, b] = graficos;
    const mover = (g: (typeof graficos)[number], idx: number): void => {
      g.u.cursor = { idx, left: 40, top: 20 };
      for (const h of g.opciones.hooks.setCursor ?? []) h(g.u);
    };
    mover(b!, 1); // el sincronizado recibe el gancho, pero el puntero no está sobre él
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('[data-etiqueta-flotante]')).toBeNull();
    await fireEvent.mouseEnter(a!.u.over);
    mover(a!, 1);
    await vi.advanceTimersByTimeAsync(0);
    const etiqueta = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-etiqueta-flotante]');
    expect(document.querySelectorAll('[data-etiqueta-flotante]')).toHaveLength(1);
    expect([etiqueta()!.querySelector('.hora')!.textContent, ...[...etiqueta()!.querySelectorAll('.fila')].map((f) => f.textContent)]).toEqual(['11/11/2025 11:15', 'promedio: 21 °C', 'mínimo–máximo: 19 a 24 °C']);
    expect(etiqueta()!.getAttribute('aria-hidden')).toBe('true'); // los mismos valores están en «Ver los datos»
    await fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(etiqueta()).toBeNull();
    mover(a!, 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(etiqueta()).toBeTruthy();
    window.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(0);
    expect(etiqueta()).toBeNull();
    mover(a!, 0);
    await vi.advanceTimersByTimeAsync(0);
    await fireEvent.mouseLeave(a!.u.over);
    expect(etiqueta()).toBeNull();
    mover(a!, 0); // fuera del gráfico ya no aparece
    await vi.advanceTimersByTimeAsync(0);
    expect(etiqueta()).toBeNull();
  });

  it('en una pantalla táctil (L4c): un toque muestra la etiqueta en el punto tocado; el `mouseleave` que emula el navegador no la quita; tocar fuera, sí', async () => {
    montarVer('tendencias');
    await conLienzo();
    await waitFor(() => expect(graficos).toHaveLength(5));
    const over = graficos[0]!.u.over;
    const toque = (tipo: string, el: Element): void => { el.dispatchEvent(Object.assign(new MouseEvent(tipo, { bubbles: true, clientX: 30, clientY: 20 }), { pointerType: 'touch' })); };
    toque('pointerdown', over);
    toque('pointerup', over);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelectorAll('[data-etiqueta-flotante]')).toHaveLength(1);
    await fireEvent.mouseLeave(over); // lo que emula el navegador tras el toque…
    const g = graficos[0]!;
    g.u.cursor = { idx: null, left: -10, top: -10 }; // …y uPlot, al recibirlo, esconde su cursor y avisa al gancho
    for (const h of g.opciones.hooks.setCursor ?? []) h(g.u);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelectorAll('[data-etiqueta-flotante]')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    await fireEvent.mouseLeave(over); // también si llega más tarde
    expect(document.querySelectorAll('[data-etiqueta-flotante]')).toHaveLength(1);
    toque('pointerdown', document.body); // un toque fuera del gráfico
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('[data-etiqueta-flotante]')).toBeNull();
    // Con un ratón de verdad, salir del gráfico vuelve a quitarla.
    toque('pointerdown', over);
    toque('pointerup', over);
    over.dispatchEvent(Object.assign(new MouseEvent('pointermove', { bubbles: true }), { pointerType: 'mouse' }));
    await fireEvent.mouseLeave(over);
    expect(document.querySelector('[data-etiqueta-flotante]')).toBeNull();
  });

  it('en táctil, tras desplazar la página, el cursor sincronizado que llega al tocar OTRO gráfico no revive la etiqueta del primero', async () => {
    montarVer('tendencias');
    await conLienzo();
    await waitFor(() => expect(graficos).toHaveLength(5));
    const g = graficos[0]!;
    const toque = (tipo: string, el: Element): void => { el.dispatchEvent(Object.assign(new MouseEvent(tipo, { bubbles: true, clientX: 30, clientY: 20 }), { pointerType: 'touch' })); };
    toque('pointerdown', g.u.over);
    toque('pointerup', g.u.over);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelectorAll('[data-etiqueta-flotante]')).toHaveLength(1);
    window.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('[data-etiqueta-flotante]')).toBeNull();
    g.u.cursor = { idx: 1, left: 40, top: 20 }; // lo que recibe el primero cuando se toca otro gráfico sincronizado
    for (const h of g.opciones.hooks.setCursor ?? []) h(g.u);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('[data-etiqueta-flotante]')).toBeNull(); // con el dedo, el gráfico ya no está «bajo el puntero»
  });

  it('el rango va a la URL de la pestaña; vivo con 1 h (cada 10 s como mucho, ventana alineada al minuto, nunca dos en vuelo); con 7 días, «Actualizar»', async () => {
    const vistas: string[] = [];
    montarVer('tendencias', { alCambiarVista: (f: string) => vistas.push(f) });
    await waitFor(() => expect(vistas.at(-1)).toBe('#/?sitio=uct&ver=tendencias&rango=24h'));
    screen.getByRole('button', { name: 'última hora' }).click();
    await waitFor(() => expect(vistas.at(-1)).toBe('#/?sitio=uct&ver=tendencias&rango=1h'));
    expect(resumenes().at(-1)).toContain('desde=2026-11-11T14%3A00%3A00.000Z');
    await waitFor(() => expect(document.querySelector('[data-refresco]')!.textContent).toContain('actualizado hace'));
    expect(document.querySelector('[data-actualizar]')).toBeNull();
    const antes = resumenes().length;
    await vi.advanceTimersByTimeAsync(2500);
    for (let i = 0; i < 30; i++) aviso('visto', { dispositivo_id: AZOTEA, tiempo: '2026-11-11T15:00:00Z', sitio_id: 's-uct' });
    await vi.advanceTimersByTimeAsync(7000); // 9,5 s desde la carga: todavía no
    expect(resumenes().length).toBe(antes);
    await vi.advanceTimersByTimeAsync(1000);
    await waitFor(() => expect(resumenes().length).toBe(antes + 1)); // a los 10 s, uno solo por los 30 avisos
    expect(resumenes().at(-1)).toContain('desde=2026-11-11T14%3A00%3A00.000Z'); // 15:00:10 − 1 h, alineado al minuto
    expect(historicos().length).toBe(18); // 24 h, 1 h y el refresco: seis cada vez
    await vi.advanceTimersByTimeAsync(30_000);
    expect(resumenes().length).toBe(antes + 1); // sin avisos, nada
    aviso('visto', { dispositivo_id: AZOTEA, tiempo: '2026-11-11T15:00:40Z', sitio_id: 'otro-sitio' });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(resumenes().length).toBe(antes + 1); // de otro sitio, tampoco
    screen.getByRole('button', { name: '7 días' }).click();
    await waitFor(() => expect(vistas.at(-1)).toBe('#/?sitio=uct&ver=tendencias&rango=7d'));
    const conSiete = resumenes().length;
    for (let i = 0; i < 5; i++) aviso('visto', { dispositivo_id: AZOTEA, tiempo: '2026-11-11T15:01:00Z', sitio_id: 's-uct' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(resumenes().length).toBe(conSiete); // 7 días no se actualiza solo
    screen.getByRole('button', { name: 'Actualizar' }).click();
    await waitFor(() => expect(resumenes().length).toBe(conSiete + 1));
  });

  it('un refresco ya programado no sobrevive a un cambio de rango: no pisa lo que la persona pidió ni corre en 7 días', async () => {
    const vistas: string[] = [];
    montarVer('tendencias', { rango: '1h', alCambiarVista: (f: string) => vistas.push(f) });
    await waitFor(() => expect(vistas.at(-1)).toBe('#/?sitio=uct&ver=tendencias&rango=1h'));
    await vi.advanceTimersByTimeAsync(2000);
    aviso('visto', { dispositivo_id: AZOTEA, tiempo: '2026-11-11T15:00:02Z', sitio_id: 's-uct' }); // programa el refresco para los 10 s
    await vi.advanceTimersByTimeAsync(3000);
    screen.getByRole('button', { name: '7 días' }).click(); // la persona cambia de rango antes
    await waitFor(() => expect(vistas.at(-1)).toBe('#/?sitio=uct&ver=tendencias&rango=7d'));
    const conSiete = resumenes().length;
    await vi.advanceTimersByTimeAsync(60_000); // el temporizador de antes ya habría vencido
    expect(resumenes().length).toBe(conSiete);
    expect(vistas.at(-1)).toBe('#/?sitio=uct&ver=tendencias&rango=7d'); // y la URL dice lo que se ve
  });

  it('«Pausar» detiene el refresco de las gráficas, también el que ya estaba programado; «Reanudar» pide una vez', async () => {
    montarVer('red', { rango: '1h' });
    await conLienzo();
    await waitFor(() => expect(resumenes()).toHaveLength(1));
    aviso('visto', { dispositivo_id: AZOTEA, tiempo: '2026-11-11T15:00:00Z', sitio_id: 's-uct' }); // programa un refresco para los 10 s…
    await vi.advanceTimersByTimeAsync(1000);
    screen.getByRole('button', { name: 'Pausar' }).click(); // …y se pausa antes
    await waitFor(() => expect(document.querySelector('[data-refresco]')!.textContent).toContain('en pausa'));
    for (let i = 0; i < 5; i++) aviso('visto', { dispositivo_id: AZOTEA, tiempo: '2026-11-11T15:00:00Z', sitio_id: 's-uct' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(resumenes()).toHaveLength(1);
    screen.getByRole('button', { name: 'Reanudar' }).click();
    await waitFor(() => expect(resumenes()).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(resumenes()).toHaveLength(2);
  });

  it('a medida: las horas se escriben en la del sitio y la ventana va a la URL en ISO; un fin anterior al inicio se frena junto a los campos', async () => {
    const vistas: string[] = [];
    montarVer('tendencias', { alCambiarVista: (f: string) => vistas.push(f) });
    await waitFor(() => expect(resumenes()).toHaveLength(1));
    screen.getByRole('button', { name: 'A medida' }).click();
    await waitFor(() => expect(document.querySelector('[data-desde]')).toBeTruthy());
    await fireEvent.input(document.querySelector('[data-desde]')!, { target: { value: '2026-11-10T08:00' } });
    await fireEvent.input(document.querySelector('[data-hasta]')!, { target: { value: '2026-11-09T08:00' } });
    await fireEvent.submit(document.querySelector('[data-form-a-medida]')!);
    expect(document.querySelector('[data-error-a-medida]')!.textContent).toBe('El fin debe ser posterior al inicio.');
    expect(resumenes()).toHaveLength(1); // frenado: ninguna petición
    await fireEvent.input(document.querySelector('[data-hasta]')!, { target: { value: '2026-11-10T20:00' } });
    await fireEvent.submit(document.querySelector('[data-form-a-medida]')!);
    // Santiago en noviembre está en UTC−03:00: 08:00 del sitio son las 11:00 UTC.
    await waitFor(() => expect(vistas.at(-1)).toBe('#/?sitio=uct&ver=tendencias&desde=2026-11-10T11%3A00%3A00.000Z&hasta=2026-11-10T23%3A00%3A00.000Z'));
    expect(resumenes().at(-1)).toContain('desde=2026-11-10T11%3A00%3A00.000Z');
    expect(document.querySelector('[data-refresco]')!.textContent).toContain('rango fijo');
    expect(document.querySelector('[data-actualizar]')).toBeNull(); // es historia
  });

  it('sin tramas en el rango, «Ver los últimos 30 días»', async () => {
    resumen = { ...base(), tramas: { recibidas: 0, rechazadas: 0, cubos: [] } };
    const vistas: string[] = [];
    montarVer('red', { alCambiarVista: (f: string) => vistas.push(f) });
    await waitFor(() => expect(document.querySelector('[data-sin-tramas]')).toBeTruthy());
    expect(document.querySelector('[data-sin-tramas] ~ .grafico, .grafico')).toBeNull(); // sin ejes vacíos
    (document.querySelector('[data-ultimos-30]') as HTMLButtonElement).click();
    await waitFor(() => expect(vistas.at(-1)).toBe('#/?sitio=uct&ver=red&rango=30d'));
  });

  it('el tema cambia y las gráficas se vuelven a crear con los colores del tema nuevo', async () => {
    montarVer('red');
    await waitFor(() => expect(graficos).toHaveLength(1));
    const trazo = (): string | undefined => graficos.at(-1)!.opciones.series[2]!.stroke;
    expect(trazo()).toBe(SERIES.claro[0]);
    document.documentElement.setAttribute('data-theme', 'oscuro');
    await waitFor(() => expect(trazo()).toBe(SERIES.oscuro[0]));
    expect(graficos.length).toBeGreaterThan(1); // recreadas, no solo repintadas con los colores viejos
    document.documentElement.removeAttribute('data-theme');
    await waitFor(() => expect(trazo()).toBe(SERIES.claro[0])); // y de vuelta
  });
});
