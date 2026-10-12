// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Inventario from './Inventario.svelte';
import type { Condicion, DispositivoInventario } from './lib/modelo';

// Prueba por el DOM en los dos sentidos (docs/19 §6): lo que debe verse se lee del DOM; lo que debe frenarse, también.
const AHORA = new Date('2026-10-12T15:00:00Z');
const base = (p: Partial<DispositivoInventario>): DispositivoInventario => ({
  id: '00000000-0000-4000-8000-000000000001', id_fisico: 'dev-0001', nombre: 'Sensor', estado: 'activo', via: 'mqtt',
  formato: 'senml', intervalo_esperado_s: 60, visto_por_ultima_vez: '2026-10-12T14:59:30Z', en_linea: true, zona: 'Lab',
  sitio: 'Campus', zona_horaria: 'America/Santiago', condiciones_abiertas: 0, canales: [], ...p,
});
const dispositivos: DispositivoInventario[] = [
  base({ id: '00000000-0000-4000-8000-000000000001', nombre: 'Invernadero', id_fisico: 'dev-0001' }),
  base({ id: '00000000-0000-4000-8000-000000000002', nombre: 'Bodega', id_fisico: 'dev-0002', estado: 'mantenimiento', condiciones_abiertas: 1 }),
  base({ id: '00000000-0000-4000-8000-000000000003', nombre: 'Pozo', id_fisico: 'dev-0003', visto_por_ultima_vez: '2026-10-12T14:00:00Z', en_linea: false, zona: 'Terreno' }),
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
    if (ruta === '/dispositivos') return new Response(JSON.stringify(dispositivos));
    if (ruta.startsWith('/condiciones')) return new Response(JSON.stringify(abiertas));
    return new Response('', { status: 404 });
  }));
});
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
    zona.value = 'Terreno';
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
