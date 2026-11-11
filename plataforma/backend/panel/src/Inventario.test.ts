// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Inventario from './Inventario.svelte';
import type { Condicion, DispositivoInventario, Sitio } from './lib/modelo';
import { inventarioSimulado } from './servidor-simulado';
import { SIN_FILTROS } from './lib/vista';
import { recordarMarcados } from './lib/comparar';

// Prueba por el DOM en los dos sentidos (docs/19 §6): lo que debe verse se lee del DOM; lo que debe frenarse, también.
const AHORA = new Date('2026-10-12T15:00:00Z');
const base = (p: Partial<DispositivoInventario>): DispositivoInventario => ({
  id: '00000000-0000-4000-8000-000000000001', id_fisico: 'dev-0001', nombre: 'Sensor', estado: 'activo', via: 'mqtt',
  formato: 'senml', intervalo_esperado_s: 60, visto_por_ultima_vez: '2026-10-12T14:59:30Z', en_linea: true, zona: 'Lab',
  sitio: 'Campus', sitio_codigo: 'uct', zona_id: 'z-lab', zona_horaria: 'America/Santiago', condiciones_abiertas: 0, canales: [], ...p,
});
const dispositivos: DispositivoInventario[] = [
  base({ id: '00000000-0000-4000-8000-000000000001', nombre: 'Invernadero', id_fisico: 'dev-0001' }),
  base({ id: '00000000-0000-4000-8000-000000000002', nombre: 'Bodega', id_fisico: 'dev-0002', estado: 'mantenimiento', condiciones_abiertas: 1 }),
  base({ id: '00000000-0000-4000-8000-000000000003', nombre: 'Pozo', id_fisico: 'dev-0003', visto_por_ultima_vez: '2026-10-12T14:00:00Z', en_linea: false, zona: 'Terreno', zona_id: 'z-terreno' }),
  base({ id: '00000000-0000-4000-8000-000000000004', nombre: 'Azotea', id_fisico: 'dev-0004', condiciones_abiertas: 1, via: 'http' }),
];
let abiertas: Condicion[] = [
  { id: 'c1', tipo: 'umbral', abierta_en: 't', cerrada_en: null, duracion_s: 10, dispositivo_id: '00000000-0000-4000-8000-000000000002', id_fisico: 'dev-0002', dispositivo: 'Bodega', umbral_alto: 30, umbral_bajo: null, magnitud: 'temperatura' },
  { id: 'c2', tipo: 'umbral', abierta_en: 't', cerrada_en: null, duracion_s: 10, dispositivo_id: '00000000-0000-4000-8000-000000000004', id_fisico: 'dev-0004', dispositivo: 'Azotea', umbral_alto: 30, umbral_bajo: null, magnitud: 'temperatura' },
];

class FuenteInerte {
  readyState = 1;
  onopen = null;
  onerror = null;
  addEventListener(): void {}
  close(): void {}
}

beforeEach(() => {
  vi.useFakeTimers({ now: AHORA, toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.stubGlobal('EventSource', FuenteInerte);
  vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
    const inv = inventarioSimulado(ruta, dispositivos, abiertas, new Date());
    if (inv !== null) return inv;
    if (ruta.startsWith('/condiciones')) return new Response(JSON.stringify(abiertas));
    return new Response('', { status: 404 });
  }));
});
const servidor = (lista: DispositivoInventario[], sitios: readonly { id: string; codigo: string }[] = []) => vi.fn(async (ruta: string) => inventarioSimulado(ruta, lista, abiertas, new Date(), sitios) ?? (ruta.startsWith('/condiciones') ? new Response(JSON.stringify(abiertas)) : new Response('', { status: 404 })));
const sitio = (codigo: string, nombre: string, zonas: { id: string; nombre: string }[]): Sitio => ({ id: `s-${codigo}`, codigo, nombre, zona_horaria: 'America/Santiago', rol: 'administrador', zonas });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Inventario (P2): semáforo, orden y filtros leídos del DOM', () => {
  it('muestra cada dispositivo con su estado visual y el conteo por estado', async () => {
    render(Inventario);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(5)); // cabecera + 4
    const filas = screen.getAllByRole('row').slice(1);
    expect(filas.map((f) => f.getAttribute('data-estado'))).toEqual(['sin_senal', 'alerta', 'normal', 'inactivo']);
    expect(filas.map((f) => f.querySelector('a')?.textContent)).toEqual(['Pozo', 'Azotea', 'Invernadero', 'Bodega']);
    // En los dos sentidos: Bodega está en mantenimiento con una condición abierta → Inactivo, NUNCA Alerta (RF-22).
    const bodega = filas.find((f) => f.textContent?.includes('Bodega'))!;
    expect(bodega.getAttribute('data-estado')).toBe('inactivo');
    expect(bodega.textContent).not.toContain('Alerta');
    const conteos = Object.fromEntries(
      ['sin_senal', 'alerta', 'normal', 'inactivo'].map((e) => [e, document.querySelector(`[data-conteo="${e}"] .n`)?.textContent]),
    );
    expect(conteos).toEqual({ sin_senal: '1', alerta: '1', normal: '1', inactivo: '1' });
    expect(screen.getByText('hace 1 h')).toBeTruthy(); // Pozo: visto a las 14:00, ahora 15:00
  });

  it('pulsar una ficha filtra la tabla; pulsarla de nuevo la quita', async () => {
    render(Inventario);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(5));
    const ficha = document.querySelector<HTMLButtonElement>('[data-conteo="alerta"]')!;
    ficha.click();
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(screen.getAllByRole('row')[1]!.getAttribute('data-estado')).toBe('alerta');
    expect(document.querySelector('[data-visibles]')?.textContent).toBe('1 de 4');
    ficha.click();
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(5));
  });

  it('los filtros por vía y zona y la búsqueda reducen la tabla; la hora exacta va en el título de «hace cuánto»', async () => {
    render(Inventario);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(5));
    const via = screen.getByLabelText('Vía') as HTMLSelectElement;
    via.value = 'http';
    via.dispatchEvent(new Event('change'));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(screen.getAllByRole('row')[1]!.textContent).toContain('Azotea');
    via.value = '';
    via.dispatchEvent(new Event('change'));
    const zona = screen.getByLabelText('Zona') as HTMLSelectElement;
    zona.value = 'z-terreno';
    zona.dispatchEvent(new Event('change'));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(screen.getAllByRole('row')[1]!.textContent).toContain('Pozo');
    zona.value = '';
    zona.dispatchEvent(new Event('change'));
    const buscar = screen.getByLabelText('Buscar') as HTMLInputElement;
    buscar.value = 'dev-0002';
    buscar.dispatchEvent(new Event('input'));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(screen.getAllByRole('row')[1]!.textContent).toContain('Bodega');
    buscar.value = '';
    buscar.dispatchEvent(new Event('input'));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(5));
    const celda = screen.getByText('hace 1 h');
    expect(celda.getAttribute('title')).toContain('(2026-10-12T14:00:00.000Z UTC)');
  });

  it('con un solo sitio no aparecen ni el filtro por sitio ni la columna Sitio (no informan nada)', async () => {
    render(Inventario);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(5));
    expect(screen.queryByLabelText('Sitio')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Sitio' })).toBeNull();
  });
  it('varios sitios (docs/19 P2): columna Sitio; dos sedes con una zona del mismo nombre no se confunden; el sitio llega por la URL (cabecera)', async () => {
    // Una segunda sede con una zona que también se llama «Lab»: se distingue por su id, no por el nombre.
    const conNorte = [...dispositivos, base({ id: '00000000-0000-4000-8000-000000000005', nombre: 'Estación norte', id_fisico: 'nor-0001', sitio: 'Sede Norte', sitio_codigo: 'norte', zona_id: 'z-lab-norte' })];
    const sitios = [sitio('uct', 'Campus', [{ id: 'z-lab', nombre: 'Lab' }, { id: 'z-terreno', nombre: 'Terreno' }]), sitio('norte', 'Sede Norte', [{ id: 'z-lab-norte', nombre: 'Lab' }])];
    vi.stubGlobal('fetch', servidor(conNorte, sitios));
    const { rerender } = render(Inventario, { sitios });
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(6));
    expect(screen.getByRole('columnheader', { name: 'Sitio' })).toBeTruthy();
    expect(screen.queryByLabelText('Sitio')).toBeNull(); // el sitio se elige en la cabecera (A1), no aquí
    const zona = screen.getByLabelText('Zona') as HTMLSelectElement;
    // Sin sitio elegido, cada zona lleva el nombre de su sitio: las dos «Lab» quedan distinguibles.
    expect([...zona.options].map((o) => o.textContent)).toEqual(['todas', 'Campus · Lab', 'Campus · Terreno', 'Sede Norte · Lab']);
    zona.value = 'z-lab'; // la «Lab» del campus
    zona.dispatchEvent(new Event('change'));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(4)); // Invernadero, Bodega, Azotea; no la de la sede norte
    expect(vi.mocked(fetch).mock.calls.map(([r]) => String(r)).some((r) => r.startsWith('/dispositivos?zona=z-lab&orden=atencion&limite=50'))).toBe(true); // filtra el servidor
    expect(screen.queryByText('Estación norte')).toBeNull();
    await rerender({ sitios, filtros: { ...SIN_FILTROS, sitio: 'norte' } }); // lo que hace el selector de la cabecera
    // La zona elegida no es de la sede norte: vuelve a «todas»; quedan solo los dispositivos de esa sede, y la zona sin prefijo.
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(screen.getAllByRole('row')[1]!.textContent).toContain('Estación norte');
    // A la API va el id del sitio (UUID en el servidor), no el código de la URL del panel.
    const pedidas = vi.mocked(fetch).mock.calls.map(([r]) => String(r)).filter((r) => r.startsWith('/dispositivos?'));
    expect(pedidas.some((r) => r.includes('sitio=s-norte'))).toBe(true);
    expect(pedidas.some((r) => r.includes('sitio=norte'))).toBe(false);
    expect(zona.value).toBe('');
    expect([...zona.options].map((o) => o.textContent)).toEqual(['todas', 'Lab']);
    await waitFor(() => expect(document.querySelector('[data-visibles]')?.textContent).toBe('1 de 1'));
    // Combinado con la búsqueda: la sede norte y un texto que no está en ella → 0 y el vacío lo dice.
    const buscar = screen.getByLabelText('Buscar') as HTMLInputElement;
    buscar.value = 'Invernadero';
    buscar.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(300); // la búsqueda espera una pausa corta antes de pedir
    await waitFor(() => expect(screen.getByText('Ningún dispositivo coincide con el filtro.')).toBeTruthy());
  });
  it('dos sitios con el mismo nombre se distinguen por su código (el nombre no es único; el código sí)', async () => {
    const gemelos = [base({}), base({ id: '00000000-0000-4000-8000-000000000009', nombre: 'Otro', id_fisico: 'otr-0001', sitio_codigo: 'campus-2', zona_id: 'z-lab-2' })];
    vi.stubGlobal('fetch', servidor(gemelos));
    render(Inventario);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
    expect(screen.getAllByRole('row').slice(1).map((f) => f.children[5]!.textContent)).toEqual(['Campus (campus-2)', 'Campus (uct)']); // «Otro» y «Sensor», por nombre
  });
  it('reloj_desviado abierto (docs/19 §4, incremento 1, punto 4): la fila lo dice en palabras con su hace cuánto, y al cerrarse desaparece sin recargar', async () => {
    let conReloj: Condicion[] = [{ id: 'c9', tipo: 'reloj_desviado', abierta_en: '2026-10-12T13:00:00Z', cerrada_en: null, duracion_s: 7200, dispositivo_id: '00000000-0000-4000-8000-000000000001', id_fisico: 'dev-0001', dispositivo: 'Invernadero', umbral_alto: null, umbral_bajo: null, magnitud: null }];
    const oyentes = new Map<string, (ev: MessageEvent) => void>();
    class Fuente { readyState = 1; onopen: ((e: Event) => void) | null = null; onerror = null; addEventListener(t: string, f: (ev: MessageEvent) => void): void { oyentes.set(t, f); } close(): void {} }
    vi.stubGlobal('EventSource', Fuente);
    let inventarios = 0;
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
      if (ruta.startsWith('/dispositivos?') && ruta.includes('limite=50&')) inventarios++; // la página, no los conteos (limite=1)
      return inventarioSimulado(ruta, dispositivos, conReloj, new Date()) ?? new Response(JSON.stringify(ruta.startsWith('/condiciones') ? conReloj : []));
    }));
    render(Inventario);
    await waitFor(() => expect(document.querySelector('[data-reloj-desviado]')).toBeTruthy());
    const fila = document.querySelector('[data-reloj-desviado]')!.closest('tr')!;
    expect(fila.getAttribute('data-estado')).toBe('alerta');
    expect(fila.querySelector('[data-reloj-desviado]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Reloj de pasarela desviado: las mediciones se fechan al llegar · hace 2 h');
    expect(document.querySelectorAll('[data-reloj-desviado]')).toHaveLength(1); // solo en su fila
    conReloj = [];
    oyentes.get('condicion')!({ data: JSON.stringify({ dispositivo_id: '00000000-0000-4000-8000-000000000001', condicion: 'reloj_desviado', estado: 'cerrada' }) } as MessageEvent);
    await vi.advanceTimersByTimeAsync(3000); // antirrebote de 3 s
    await waitFor(() => expect(document.querySelector('[data-reloj-desviado]')).toBeNull());
    expect(document.querySelector('[data-id="00000000-0000-4000-8000-000000000001"]')?.getAttribute('data-estado')).toBe('normal');
    expect(inventarios).toBe(1); // sin volver a pedir la página: el panel recalcula el estado con las condiciones nuevas (§6)
  });

  it('tope medido del vivo: 100 avisos de condición en 3 s → una sola tanda de 5 peticiones (abiertas y 4 conteos), nunca la página', async () => {
    const oyentes = new Map<string, (ev: MessageEvent) => void>();
    class Fuente { readyState = 1; onopen: ((e: Event) => void) | null = null; onerror = null; addEventListener(t: string, f: (ev: MessageEvent) => void): void { oyentes.set(t, f); } close(): void {} }
    vi.stubGlobal('EventSource', Fuente);
    const pedidas: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
      pedidas.push(ruta);
      return inventarioSimulado(ruta, dispositivos, abiertas, new Date()) ?? new Response(JSON.stringify(ruta.startsWith('/condiciones') ? abiertas : []));
    }));
    render(Inventario);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(5));
    const antes = pedidas.length;
    for (let i = 0; i < 100; i++) {
      oyentes.get('condicion')!({ data: JSON.stringify({ dispositivo_id: '00000000-0000-4000-8000-000000000004', condicion: 'umbral', estado: i % 2 === 0 ? 'abierta' : 'cerrada' }) } as MessageEvent);
      await vi.advanceTimersByTimeAsync(29); // 100 avisos repartidos en menos de 3 s
    }
    await vi.advanceTimersByTimeAsync(3000);
    const tanda = pedidas.slice(antes);
    expect(tanda).toHaveLength(5);
    expect(tanda.filter((r) => r.startsWith('/condiciones'))).toHaveLength(1);
    expect(tanda.filter((r) => r.includes('limite=1&'))).toHaveLength(4);
    expect(tanda.some((r) => r.startsWith('/dispositivos?') && r.includes('limite=50&'))).toBe(false); // la página no se repide
  });

  it('con un sitio en la URL se espera la lista de sitios antes de pedir: nunca una página sin filtrar', async () => {
    const conNorte = [...dispositivos, base({ id: '00000000-0000-4000-8000-000000000005', nombre: 'Estación norte', id_fisico: 'nor-0001', sitio: 'Sede Norte', sitio_codigo: 'norte', zona_id: 'z-lab-norte' })];
    const sitios = [sitio('uct', 'Campus', [{ id: 'z-lab', nombre: 'Lab' }]), sitio('norte', 'Sede Norte', [{ id: 'z-lab-norte', nombre: 'Lab' }])];
    vi.stubGlobal('fetch', servidor(conNorte, sitios));
    const { rerender } = render(Inventario, { sitios: null, filtros: { ...SIN_FILTROS, sitio: 'norte' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(vi.mocked(fetch).mock.calls.filter(([r]) => String(r).startsWith('/dispositivos?'))).toHaveLength(0);
    await rerender({ sitios, filtros: { ...SIN_FILTROS, sitio: 'norte' } });
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(screen.getAllByRole('row')[1]!.textContent).toContain('Estación norte');
  });

  it('sin dispositivos: el vacío explica qué hacer; con error de la API: el mensaje trae la acción', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]))));
    render(Inventario);
    await waitFor(() => expect(screen.getByText(/Sin dispositivos registrados/)).toBeTruthy());
    cleanup();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    render(Inventario);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('saturado'));
  });
});

// Incremento 2 (docs/19 §4, puntos 3 y 5): hora del sitio con una sola zona, aviso con varias, y las casillas «comparar».
describe('Inventario (P2), incremento 2: zona horaria y casillas para comparar', () => {
  it('una sola zona entre las filas: la hora del sitio; con dos zonas: «2 zonas horarias»', async () => {
    render(Inventario);
    await waitFor(() => expect(document.querySelector('[data-hora-sitio]')).toBeTruthy());
    expect(document.querySelector('[data-hora-sitio]')!.textContent).toContain('Hora en el sitio: 12/10/2026 12:00:00 · America/Santiago (UTC−03:00)');
    cleanup();
    const otra = [...dispositivos, base({ id: '00000000-0000-4000-8000-000000000005', nombre: 'Madrid', id_fisico: 'dev-0005', zona_horaria: 'Europe/Madrid', sitio_codigo: 'mad', sitio: 'Madrid', zona_id: 'z-mad' })];
    vi.stubGlobal('fetch', servidor(otra));
    render(Inventario);
    await waitFor(() => expect(document.querySelector('[data-hora-sitio]')?.textContent).toBe('2 zonas horarias: cada fila va en la de su sitio'));
    expect(document.querySelector('[data-aviso-zona]')).toBeNull();
  });

  it('«Comparar (N)» se activa con 2 a 6 marcadas y lleva a P3b con los marcados en orden', async () => {
    render(Inventario);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(5));
    const boton = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('[data-comparar]')!;
    expect(boton().textContent).toBe('Comparar (0)');
    expect(boton().disabled).toBe(true);
    screen.getByRole('checkbox', { name: 'comparar Invernadero' }).click();
    await waitFor(() => expect(boton().textContent).toBe('Comparar (1)'));
    expect(boton().disabled).toBe(true);
    screen.getByRole('checkbox', { name: 'comparar Pozo' }).click();
    await waitFor(() => expect(boton().disabled).toBe(false));
    boton().click();
    expect(window.location.hash).toBe('#/comparar?dispositivos=00000000-0000-4000-8000-000000000001,00000000-0000-4000-8000-000000000003&rango=24h');
    // Las casillas se recuerdan en la sesión: al volver al inventario siguen marcadas.
    cleanup();
    render(Inventario);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(5));
    expect((screen.getByRole('checkbox', { name: 'comparar Invernadero' }) as HTMLInputElement).checked).toBe(true);
    expect(boton().textContent).toBe('Comparar (2)');
    window.location.hash = '';
  });
});

// Inventario v2 (docs/19 §4, tablero v2, C; A5): el servidor filtra y pagina, el total viene en X-Total, la página va en la URL; el estado
// del servidor al cargar y el del panel en vivo; tarjetas bajo 700 px; «Marcar los visibles» con el tope de seis; Entrega ordenable.
describe('Inventario v2: paginación, estado del servidor, tarjetas en angosto, marcar y entrega', () => {
  const muchos = Array.from({ length: 132 }, (_, i) => base({ id: `00000000-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`, nombre: `Nodo ${String(i + 1).padStart(3, '0')}`, id_fisico: `n-${i + 1}`, entrega: (i * 7) % 100 }));
  const paginas = (): string[] => vi.mocked(fetch).mock.calls.map(([r]) => String(r)).filter((r) => r.startsWith('/dispositivos?') && r.includes('limite=50&'));

  it('«1–50 de 132» con el total del servidor; «Siguiente» pide desplazamiento=50 y escribe pagina=2; en la última, «Siguiente» se frena', async () => {
    vi.stubGlobal('fetch', servidor(muchos));
    const vistas: string[] = [];
    render(Inventario, { alCambiarVista: (f: string) => vistas.push(f) });
    await waitFor(() => expect(document.querySelector('[data-rotulo-pagina]')?.textContent).toBe('1–50 de 132'));
    expect(screen.getAllByRole('row')).toHaveLength(51);
    expect(paginas()[0]).toBe('/dispositivos?orden=atencion&limite=50&desplazamiento=0');
    expect(document.querySelector('[data-conteo="normal"] .n')?.textContent).toBe('132'); // del servidor (X-Total), no de la página
    (document.querySelector('[data-pagina-siguiente]') as HTMLButtonElement).click();
    await waitFor(() => expect(document.querySelector('[data-rotulo-pagina]')?.textContent).toBe('51–100 de 132'));
    expect(paginas().at(-1)).toBe('/dispositivos?orden=atencion&limite=50&desplazamiento=50');
    expect(vistas.at(-1)).toBe('#/inventario?pagina=2');
    (document.querySelector('[data-pagina-siguiente]') as HTMLButtonElement).click();
    await waitFor(() => expect(document.querySelector('[data-rotulo-pagina]')?.textContent).toBe('101–132 de 132'));
    expect((document.querySelector('[data-pagina-siguiente]') as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-pagina-siguiente]')!.closest('.boton-envoltura')!.textContent).toContain('ya estás en la última página');
  });

  it('la página de la URL se respeta al abrir, y un filtro nuevo vuelve a la página 1', async () => {
    vi.stubGlobal('fetch', servidor(muchos));
    render(Inventario, { filtros: { ...SIN_FILTROS, pagina: 3 } });
    await waitFor(() => expect(document.querySelector('[data-rotulo-pagina]')?.textContent).toBe('101–132 de 132'));
    const via = screen.getByLabelText('Vía') as HTMLSelectElement;
    via.value = 'mqtt';
    via.dispatchEvent(new Event('change'));
    await waitFor(() => expect(paginas().at(-1)).toBe('/dispositivos?via=mqtt&orden=atencion&limite=50&desplazamiento=0'));
  });

  it('el estado de cada fila es el del servidor al cargar y el del panel desde el primer dato en vivo (misma regla, §2)', async () => {
    // El servidor la ve en «Alerta» (una condición que el panel aún no recibió); el reloj del panel la recalcula con lo que sabe.
    const uno = [base({ id: '00000000-0000-4000-8000-000000000001', nombre: 'Invernadero', estado_visual: 'alerta' })];
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => inventarioSimulado(ruta, uno, [], new Date()) ?? new Response('[]')));
    render(Inventario);
    await waitFor(() => expect(screen.getAllByRole('row')[1]?.getAttribute('data-estado')).toBe('alerta'));
    await vi.advanceTimersByTimeAsync(10_000);
    await waitFor(() => expect(screen.getAllByRole('row')[1]?.getAttribute('data-estado')).toBe('normal'));
    // Y fila por fila, con los datos de prueba, el servidor simulado (la regla de §2) y estadoVisual() dicen lo mismo.
    cleanup();
    vi.stubGlobal('fetch', servidor(dispositivos));
    render(Inventario);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(5));
    const delServidor = screen.getAllByRole('row').slice(1).map((f) => f.getAttribute('data-estado'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(screen.getAllByRole('row').slice(1).map((f) => f.getAttribute('data-estado'))).toEqual(delServidor);
  });

  it('bajo 700 px: tarjetas en vez de tabla, con lo esencial a la vista y el resto tras «Más datos»; sobre 700 px, la tabla', async () => {
    let angosto = true;
    const oyentes: ((e: { matches: boolean }) => void)[] = [];
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('700px') && angosto, media: q, addEventListener: (_: string, f: (e: { matches: boolean }) => void) => oyentes.push(f), removeEventListener() {} }));
    render(Inventario);
    await waitFor(() => expect(document.querySelectorAll('.tarjeta-inventario')).toHaveLength(4));
    expect(document.querySelector('table')).toBeNull();
    const pozo = document.querySelector('.tarjeta-inventario[data-estado="sin_senal"]')!;
    expect(pozo.textContent).toContain('Pozo');
    expect(pozo.textContent).toContain('última trama hace 1 h');
    expect(pozo.querySelector('[data-desplegada]')).toBeNull(); // plegado
    (pozo.querySelector('[data-desplegar]') as HTMLButtonElement).click();
    await waitFor(() => expect(pozo.querySelector('[data-desplegada]')?.textContent).toContain('dev-0003'));
    expect((pozo.querySelector('[data-desplegar]') as HTMLButtonElement).getAttribute('aria-expanded')).toBe('true');
    angosto = false;
    for (const f of oyentes) f({ matches: false });
    await waitFor(() => expect(document.querySelector('table')).toBeTruthy());
    expect(document.querySelectorAll('.tarjeta-inventario')).toHaveLength(0);
  });

  it('«Marcar los visibles» marca los de la página hasta seis y luego se frena con el motivo escrito', async () => {
    recordarMarcados([]); // las casillas de la sesión del navegador, vacías (otra prueba marcó dos)
    vi.stubGlobal('fetch', servidor(muchos));
    render(Inventario);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(51));
    (document.querySelector('[data-marcar-visibles]') as HTMLButtonElement).click();
    await waitFor(() => expect(document.querySelector('[data-comparar]')?.textContent).toBe('Comparar (6)'));
    expect([...document.querySelectorAll<HTMLInputElement>('[data-marcar]')].filter((c) => c.checked)).toHaveLength(6);
    expect((document.querySelector('[data-marcar-visibles]') as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-marcar-visibles]')!.closest('.boton-envoltura')!.textContent).toContain('ya hay 6 marcados');
  });

  it('Entrega: la columna dice el porcentaje y, pulsada, ordena la página de peor a mejor (y lo escribe en la URL)', async () => {
    const vistas: string[] = [];
    vi.stubGlobal('fetch', servidor(dispositivos.map((d, i) => ({ ...d, entrega: [80, null, 12.4, 100][i]! }))));
    render(Inventario, { alCambiarVista: (f: string) => vistas.push(f) });
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(5));
    (document.querySelector('[data-ordenar-entrega]') as HTMLButtonElement).click();
    await waitFor(() => expect([...document.querySelectorAll('[data-entrega]')].map((c) => c.textContent)).toEqual(['12 %', '80 %', '100 %', '—']));
    expect(vistas.at(-1)).toBe('#/inventario?orden=entrega');
    expect(screen.getByRole('columnheader', { name: /Entrega/ }).getAttribute('aria-sort')).toBe('ascending');
    // Lo ordena el servidor (todas las páginas), no el panel la visible; y la columna dice su ventana: las últimas 24 h.
    expect(vi.mocked(fetch).mock.calls.map(([r]) => String(r)).some((r) => r.startsWith('/dispositivos?') && r.includes('orden=entrega') && r.includes('limite=50'))).toBe(true);
    expect(document.querySelector('[data-ordenar-entrega]')!.textContent).toContain('Entrega (24 h)');
  });
});
