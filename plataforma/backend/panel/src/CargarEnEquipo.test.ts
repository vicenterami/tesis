// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CargarEnEquipo from './CargarEnEquipo.svelte';
import { PuertoSimulado, TIEMPOS_PRUEBA, type OpcionesEquipo } from './lib/serie-simulado';
import type { SerieDelNavegador } from './lib/serie';

// «Cargar en el equipo» por el DOM (docs/19 §4, Z): sin puerto serie, lo que se ofrece; con él, la red una vez, el selector del navegador,
// el avance en cuatro pasos y, en lote, de a uno con reintento. Ni la clave del equipo ni la de la red llegan a la página, a fetch ni al
// almacenamiento del navegador. Claves evidentemente falsas.
const CLAVE = 'clave-falsa-de-prueba-0000000001';
const CLAVE_RED = 'clave-de-red-falsa';
const UNO = [{ id: '00000000-0000-4000-8000-000000000001', id_fisico: 'nodo-0001', sitio: 'uct', clave: CLAVE }];
const TRES = [
  ...UNO,
  { id: '00000000-0000-4000-8000-000000000002', id_fisico: 'nodo-0002', sitio: 'uct', clave: 'clave-falsa-de-prueba-0000000002' },
  { id: '00000000-0000-4000-8000-000000000003', id_fisico: 'nodo-0003', sitio: 'uct', clave: 'clave-falsa-de-prueba-0000000003' },
];

class Fuente {
  static todas: Fuente[] = [];
  readyState = 1;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  oyentes = new Map<string, (e: MessageEvent) => void>();
  constructor(public url: string) { Fuente.todas.push(this); }
  addEventListener(t: string, f: (e: MessageEvent) => void): void { this.oyentes.set(t, f); }
  close(): void { this.readyState = 2; }
}

let puertos: PuertoSimulado[];
let opciones: OpcionesEquipo[];
let pedidos: number;
// El navegador: cada «Conectar y cargar» abre su selector y la persona elige el puerto del equipo que tiene conectado.
const serie: SerieDelNavegador = { requestPort: async () => { pedidos++; const p = new PuertoSimulado(opciones.shift() ?? {}); puertos.push(p); return p; } };
const llamadasFetch: string[] = [];
const guardados: string[] = [];

beforeEach(() => {
  puertos = [];
  opciones = [];
  pedidos = 0;
  llamadasFetch.length = 0;
  guardados.length = 0;
  Fuente.todas.length = 0;
  vi.stubGlobal('EventSource', Fuente);
  vi.stubGlobal('fetch', vi.fn(async (ruta: string, init: RequestInit = {}) => { llamadasFetch.push(`${ruta} ${String(init.body ?? '')}`); return new Response('{}'); }));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string, v: string) => { guardados.push(`${k}=${v}`); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const escribir = (sel: string, v: string): Promise<boolean> => fireEvent.input(document.querySelector(sel)!, { target: { value: v } });
async function abrirYEscribirRed(): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: 'Cargar en el equipo' }));
  await escribir('[data-campo-carga="red"]', 'red-de-prueba');
  await escribir('[data-campo-carga="clave_red"]', CLAVE_RED);
  await escribir('[data-campo-carga="servidor"]', 'servidor.ejemplo');
}
const hechos = (idf: string): string[] => [...document.querySelectorAll(`[data-equipo-carga="${idf}"] [data-hecho="true"]`)].map((x) => x.getAttribute('data-paso-carga')!);
function sinSecretos(): void {
  for (const s of [CLAVE, CLAVE_RED]) {
    expect(document.body.innerHTML).not.toContain(s);
    expect(llamadasFetch.join('\n')).not.toContain(s);
    expect(guardados.join('\n')).not.toContain(s);
  }
}

describe('Cargar en el equipo (docs/19 §4, Z)', () => {
  it('sin puerto serie en el navegador no hay botón: dice por qué y ofrece lo de siempre y el guion de terminal', () => {
    render(CargarEnEquipo, { equipos: UNO, serie: null, seguro: true });
    expect(screen.queryByRole('button', { name: 'Cargar en el equipo' })).toBeNull();
    const t = document.querySelector('[data-sin-serie]')!.textContent!;
    expect(t).toContain('no está disponible en este navegador');
    expect(t).toContain('Chrome, Edge y Opera, y Firefox de escritorio desde la versión 151');
    expect(document.querySelector('[data-sin-serie]')!.getAttribute('data-sin-serie')).toBe('navegador');
    expect(t).toContain('copia los datos o descarga la ficha');
    expect(t).toContain('herramientas/cargar-equipo.py');
  });

  it('pide la red una vez, abre el selector con el clic, y muestra el avance hasta la primera trama; ninguna clave sale de la memoria', async () => {
    render(CargarEnEquipo, { equipos: UNO, serie, tiempos: TIEMPOS_PRUEBA });
    expect(document.querySelector('[data-red-carga]')).toBeNull(); // antes del clic, nada que llenar
    await abrirYEscribirRed();
    expect((document.querySelector('[data-campo-carga="clave_red"]') as HTMLInputElement).type).toBe('password');
    expect((document.querySelector('[data-campo-carga="puerto"]') as HTMLInputElement).value).toBe('8883');
    await fireEvent.click(screen.getByRole('button', { name: 'Conectar y cargar nodo-0001' }));
    await waitFor(() => expect(document.querySelector('[data-equipo-carga="nodo-0001"]')!.getAttribute('data-estado-carga')).toBe('hecho'));
    expect(pedidos).toBe(1);
    expect(puertos[0]!.recibidas.find((o) => o.orden === 'configurar')).toEqual({
      orden: 'configurar', red: 'red-de-prueba', clave_red: CLAVE_RED, servidor: 'servidor.ejemplo', puerto: 8883, sitio: 'uct', id: 'nodo-0001', clave: CLAVE,
    });
    expect(hechos('nodo-0001')).toEqual(['cargada', 'red', 'broker']);
    expect(document.querySelector('[data-equipo-carga="nodo-0001"] [role="status"]')!.textContent).toContain('El broker la aceptó: hecho');
    // La primera trama: el canal en vivo del dispositivo, abierto desde «credencial cargada».
    const f = Fuente.todas.find((x) => x.url === `/eventos?dispositivo=${UNO[0]!.id}`)!;
    f.oyentes.get('visto')!(new MessageEvent('visto', { data: JSON.stringify({ dispositivo_id: UNO[0]!.id, tiempo: '2026-11-25T12:00:00Z' }) }));
    await waitFor(() => expect(hechos('nodo-0001')).toEqual(['cargada', 'red', 'broker', 'trama']));
    expect(document.querySelector('[data-texto-carga]')!.textContent).toBe('Listo: ya envía datos');
    expect(f.readyState).toBe(2);
    sinSecretos();
  });

  it('«Mostrar» deja ver la clave de la red que se escribe; vuelve a ocultarla', async () => {
    render(CargarEnEquipo, { equipos: UNO, serie });
    await abrirYEscribirRed();
    const campo = document.querySelector('[data-campo-carga="clave_red"]') as HTMLInputElement;
    await fireEvent.click(screen.getByRole('button', { name: 'Mostrar' }));
    expect(campo.type).toBe('text');
    await fireEvent.click(screen.getByRole('button', { name: 'Ocultar' }));
    expect(campo.type).toBe('password');
  });

  it('una red o un servidor mal escritos se dicen arriba, sin abrir el selector', async () => {
    render(CargarEnEquipo, { equipos: UNO, serie });
    await abrirYEscribirRed();
    await escribir('[data-campo-carga="clave_red"]', 'corta');
    await fireEvent.click(screen.getByRole('button', { name: 'Conectar y cargar nodo-0001' }));
    expect(document.querySelector('[data-error-red-carga]')!.textContent).toBe('Revisa la clave de la red (vacía si la red es abierta, o de 8 a 63 caracteres).');
    expect(pedidos).toBe(0);
  });

  it('si la persona cierra el selector sin elegir puerto, lo dice y permite reintentar', async () => {
    const sinElegir: SerieDelNavegador = { requestPort: async () => { throw new DOMException('No port selected by the user.', 'NotFoundError'); } };
    render(CargarEnEquipo, { equipos: UNO, serie: sinElegir });
    await abrirYEscribirRed();
    await fireEvent.click(screen.getByRole('button', { name: 'Conectar y cargar nodo-0001' }));
    await waitFor(() => expect(document.querySelector('[data-falla-carga]')).toBeTruthy());
    expect(document.querySelector('[data-falla-carga]')!.textContent).toBe('No elegiste un puerto. Conecta el equipo por USB y vuelve a intentar.');
    expect(screen.getByRole('button', { name: 'Reintentar nodo-0001' })).toBeTruthy();
  });

  it('si el navegador niega el permiso del puerto serie (no es que la persona cerrara el selector), dice eso y no «no elegiste»', async () => {
    const sinPermiso: SerieDelNavegador = { requestPort: async () => { throw new DOMException('Permission denied.', 'SecurityError'); } };
    render(CargarEnEquipo, { equipos: UNO, serie: sinPermiso });
    await abrirYEscribirRed();
    await fireEvent.click(screen.getByRole('button', { name: 'Conectar y cargar nodo-0001' }));
    await waitFor(() => expect(document.querySelector('[data-falla-carga]')).toBeTruthy());
    expect(document.querySelector('[data-falla-carga]')!.textContent).toMatch(/^El navegador no dio permiso para usar el puerto serie/);
  });

  it('una falla del equipo se dice en palabras simples, con lo logrado marcado («cargado, sin conectar»)', async () => {
    opciones = [{ errorBroker: 'credencial' }];
    render(CargarEnEquipo, { equipos: UNO, serie, tiempos: TIEMPOS_PRUEBA });
    await abrirYEscribirRed();
    await fireEvent.click(screen.getByRole('button', { name: 'Conectar y cargar nodo-0001' }));
    await waitFor(() => expect(document.querySelector('[data-falla-carga]')).toBeTruthy());
    expect(document.querySelector('[data-falla-carga]')!.textContent).toBe('El broker rechazó la credencial: rótala desde la ficha del equipo y vuelve a cargarla.');
    expect(hechos('nodo-0001')).toEqual(['cargada', 'red']);
    expect(document.querySelector('[data-texto-carga]')!.textContent).toBe('Cargado, sin conectar');
    sinSecretos();
  });

  it('en lote: de a uno (los demás esperan con su motivo), marca los hechos, cuenta, y reintenta el que falló', async () => {
    opciones = [{}, { mudo: true }, {}];
    render(CargarEnEquipo, { equipos: TRES, otros: 2, serie, tiempos: TIEMPOS_PRUEBA });
    await abrirYEscribirRed();
    expect(document.querySelector('[data-otros-carga]')!.textContent).toContain('2 creados no van por MQTT');
    expect(document.querySelector('[data-resumen-carga]')!.textContent).toContain('0 de 3 cargados');
    await fireEvent.click(screen.getByRole('button', { name: 'Conectar y cargar nodo-0001' }));
    // Mientras carga el primero, los otros esperan: un solo puerto a la vez.
    const segundo = screen.getByRole('button', { name: 'Conectar y cargar nodo-0002' }) as HTMLButtonElement;
    expect(segundo.disabled).toBe(true);
    expect(segundo.closest('.boton-envoltura')!.textContent).toContain('hay otra carga en curso');
    await waitFor(() => expect(document.querySelector('[data-resumen-carga]')!.textContent).toContain('1 de 3 cargados'));
    await fireEvent.click(screen.getByRole('button', { name: 'Conectar y cargar nodo-0002' }));
    await waitFor(() => expect(document.querySelector('[data-equipo-carga="nodo-0002"] [data-falla-carga]')!.textContent).toContain('El equipo no responde'));
    await fireEvent.click(screen.getByRole('button', { name: 'Reintentar nodo-0002' }));
    await waitFor(() => expect(document.querySelector('[data-equipo-carga="nodo-0002"]')!.getAttribute('data-estado-carga')).toBe('hecho'));
    expect(document.querySelector('[data-resumen-carga]')!.textContent).toContain('2 de 3 cargados');
    expect(document.querySelector('[data-equipo-carga="nodo-0003"]')!.getAttribute('data-estado-carga')).toBe('nada');
    expect(pedidos).toBe(3); // un selector por intento: la persona elige cada vez el equipo que tiene enchufado
    expect(document.body.innerHTML).not.toContain('clave-falsa-de-prueba');
    sinSecretos();
  });

  it('sin contexto seguro (HTTP fuera de localhost), el motivo es la dirección, no el navegador', () => {
    render(CargarEnEquipo, { equipos: UNO, serie: null, seguro: false });
    const p = document.querySelector('[data-sin-serie]')!;
    expect(p.getAttribute('data-sin-serie')).toBe('inseguro');
    expect(p.textContent).toContain('necesita que el panel se abra por HTTPS');
    expect(p.textContent).not.toContain('no está disponible en este navegador');
  });

  it('un equipo ya cargado con OTRO identificador: se pide escribirlo; sin escribirlo bien no se reemplaza; «No reemplazar» no manda nada', async () => {
    opciones = [{ config: { id: 'nodo-0009' } }, { config: { id: 'nodo-0009' } }];
    render(CargarEnEquipo, { equipos: UNO, serie, tiempos: TIEMPOS_PRUEBA });
    await abrirYEscribirRed();
    await fireEvent.click(screen.getByRole('button', { name: 'Conectar y cargar nodo-0001' }));
    await waitFor(() => expect(document.querySelector('[data-reemplazo="nodo-0001"]')).toBeTruthy());
    expect(document.querySelector('[data-reemplazo]')!.textContent).toContain('ya está cargado como nodo-0009');
    const reemplazar = screen.getByRole('button', { name: 'Reemplazar nodo-0009' }) as HTMLButtonElement;
    expect(reemplazar.disabled).toBe(true);
    await escribir('[data-confirmar-actual]', 'nodo-000');
    expect(reemplazar.disabled).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'No reemplazar' }));
    await waitFor(() => expect(document.querySelector('[data-falla-carga]')!.textContent).toBe('No se cargó nada: el equipo sigue cargado como nodo-0009.'));
    expect(puertos[0]!.recibidas.some((o) => o.orden === 'configurar')).toBe(false);
    await fireEvent.click(screen.getByRole('button', { name: 'Reintentar nodo-0001' }));
    await waitFor(() => expect(document.querySelector('[data-confirmar-actual]')).toBeTruthy());
    await escribir('[data-confirmar-actual]', 'nodo-0009');
    await fireEvent.click(screen.getByRole('button', { name: 'Reemplazar nodo-0009' }));
    await waitFor(() => expect(document.querySelector('[data-equipo-carga="nodo-0001"]')!.getAttribute('data-estado-carga')).toBe('hecho'));
    expect(puertos[1]!.recibidas.find((o) => o.orden === 'configurar')).toMatchObject({ id: 'nodo-0001' });
    sinSecretos();
  });

  it('salir de la pantalla durante una carga la detiene y cierra el puerto y el canal en vivo', async () => {
    opciones = [{ holaTrasIntentos: 1_000 }];
    const { unmount } = render(CargarEnEquipo, { equipos: UNO, serie, tiempos: { ...TIEMPOS_PRUEBA, esperaSaludo: 5_000 } });
    await abrirYEscribirRed();
    await fireEvent.click(screen.getByRole('button', { name: 'Conectar y cargar nodo-0001' }));
    await waitFor(() => expect(puertos[0]?.abierto).toBe(true));
    unmount();
    await waitFor(() => expect(puertos[0]!.abierto).toBe(false));
  });
});
