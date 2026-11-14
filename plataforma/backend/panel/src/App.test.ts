// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DispositivoFicha, DispositivoInventario, Historico } from './lib/modelo';
import { inventarioSimulado } from './servidor-simulado';

// La vista en la URL (docs/19 §4, incremento 1, punto 1), por el DOM y en los dos sentidos: la URL fija lo que se ve, lo que se
// elige se escribe en la URL sin sumar entradas al historial, un cambio externo del fragmento se reaplica y un valor inválido
// deja el valor por defecto.
vi.mock('uplot', () => {
  class UPlotFalso {
    constructor(_o: unknown, _d: unknown, el: HTMLElement) { el.appendChild(document.createElement('canvas')); }
    setData(): void {}
    setSize(): void {}
    destroy(): void {}
    static tzDate(d: Date): Date { return d; }
  }
  return { default: UPlotFalso };
});
vi.mock('uplot/dist/uPlot.min.css', () => ({}));
import App from './App.svelte';
import { olvidarPreferencias } from './lib/escritor-preferencias';

const AHORA = new Date('2026-10-12T15:00:00Z');
const ID = '00000000-0000-4000-8000-000000000001';
const TEMP = '00000000-0000-4000-8000-0000000000c1';
const HUM = '00000000-0000-4000-8000-0000000000c2';
const comun = { id_fisico: 'dev-0001', estado: 'activo' as const, via: 'mqtt', formato: 'senml', intervalo_esperado_s: 60, visto_por_ultima_vez: '2026-10-12T14:59:30Z', en_linea: true, zona: 'Lab', sitio: 'Campus', zona_horaria: 'America/Santiago', sitio_codigo: 'uct', zona_id: 'z-lab' };
const ficha: DispositivoFicha = {
  ...comun, id: ID, nombre: 'Invernadero', creado_en: '2026-10-01T12:00:00Z', intervalo_observado_s: 60,
  canales: [
    { id: TEMP, magnitud: 'temperatura', magnitud_nombre: 'Temperatura', unidad: 'Cel', etiqueta: null, reglas: null, ultima_medicion: { valor: 21.5, tiempo: '2026-10-12T14:59:30Z', porcentaje: null } },
    { id: HUM, magnitud: 'humedad', magnitud_nombre: 'Humedad', unidad: '%RH', etiqueta: null, reglas: null, ultima_medicion: { valor: 40, tiempo: '2026-10-12T14:59:30Z', porcentaje: null } },
  ],
};
const inventario: DispositivoInventario[] = [
  { ...comun, id: ID, nombre: 'Invernadero', condiciones_abiertas: 0, canales: [] },
  { ...comun, id: '00000000-0000-4000-8000-000000000003', nombre: 'Pozo', id_fisico: 'dev-0003', via: 'http', condiciones_abiertas: 0, canales: [] },
];
const SITIO = { id: 's1', codigo: 'uct', nombre: 'Campus', zona_horaria: 'America/Santiago', rol: 'administrador', zonas: [{ id: 'z-lab', nombre: 'Lab' }] };
let sitios = [SITIO];
const historico = (canal: string): Historico => ({ canal_id: canal, magnitud: 'x', unidad: 'Cel', zona_horaria: 'America/Santiago', intervalo: '15 minutes', desde: 'x', hasta: 'y', puntos: 1, tiempos: [1760270400], valores: [20], muestras: [1] });

// Con sesión de administrador (P10): estas pruebas miran la vista en la URL; la sesión se prueba en Sesion.test.ts.
const SESION = {
  sistema: false, usuario: { id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid' }, clave_temporal: false,
  sitios: [{ sitio_id: 's1', codigo: 'uct', nombre: 'Campus', rol: 'administrador' }], expira_en: null, inactividad_vence_en: null,
  permisos: { administrador: ['leer', 'exportar', 'escribir', 'baja', 'configurar', 'usuarios', 'enlaces', 'auditoria'], consulta: ['leer'] },
};
class FuenteInerte {
  readyState = 1;
  onopen = null;
  onerror = null;
  addEventListener(): void {}
  close(): void {}
}
const peticiones: string[] = [];
const PREFS_BASE = { unidad_temperatura: 'C', unidad_longitud: 'm', zona_horaria: 'sitio', tema: 'sistema', notificar: [], vistas: [], sitio_predeterminado: null, actualizado_en: null };

beforeEach(() => {
  peticiones.length = 0;
  // Solo la fecha: waitFor espera con temporizadores reales (aquí se mira la URL, que no muta el DOM).
  vi.useFakeTimers({ now: AHORA, toFake: ['Date'] });
  vi.stubGlobal('EventSource', FuenteInerte);
  vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
    peticiones.push(ruta);
    if (ruta === '/sesion') return new Response(JSON.stringify(SESION));
    const inv = inventarioSimulado(ruta, inventario, [], AHORA);
    if (inv !== null) return inv;
    if (ruta === '/sitios') return new Response(JSON.stringify(sitios));
    if (ruta === '/salud') return new Response(JSON.stringify({ estado: 'ok', base: 'conectada', tablas: 22 }));
    if (/^\/sitios\/[^/]+\/ahora\?/.test(ruta)) return new Response(JSON.stringify({ reportan: 0, sin_senal: 0, por_magnitud: [], dispositivos: [], tendencia: false }));
    if (ruta === '/terminos' || ruta === '/privacidad' || ruta === '/acerca') return new Response(JSON.stringify({ version: 1, fecha: '2026-11-11', texto: 't' }));
    if (ruta === `/dispositivos/${ID}`) return new Response(JSON.stringify(ficha));
    if (ruta.startsWith('/condiciones?') || ruta.startsWith('/cuarentena?')) return new Response('[]');
    const h = /^\/canales\/([^/]+)\/historico/.exec(ruta);
    if (h) return new Response(JSON.stringify(historico(h[1]!)));
    return new Response('', { status: 404 });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  history.replaceState(null, '', '#/');
  sitios = [SITIO];
  document.documentElement.removeAttribute('data-theme');
  olvidarPreferencias();
});

const pulsado = (nombre: string): string | null => screen.getByRole('button', { name: nombre }).getAttribute('aria-pressed');
const historicos = (): string[] => peticiones.filter((p) => p.startsWith('/canales/'));
// Grafico.svelte carga uPlot con import dinámico: cada prueba que abre la ficha espera a que el doble del gráfico exista, para que
// la importación no resuelva después de terminada la prueba (fuera del doble, con el uPlot real, que sin navegador falla).
const graficoListo = (): Promise<void> => waitFor(() => expect(document.querySelector('canvas')).toBeTruthy());
// Un cambio del fragmento desde fuera (atrás, un enlace pegado): cambia la URL y llega `hashchange`.
function cambioExterno(fragmento: string): void {
  history.replaceState(null, '', fragmento);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

describe('P3: canal y rango en la URL', () => {
  it('la URL fija el canal y el rango al abrir; elegir otro rango lo escribe con replaceState (sin entrada nueva en el historial)', async () => {
    history.replaceState(null, '', `#/dispositivos/${ID}?canal=${HUM}&rango=7d`);
    render(App);
    await waitFor(() => expect(historicos()).toHaveLength(1));
    expect(historicos()[0]).toContain(`/canales/${HUM}/historico`);
    expect(historicos()[0]).toContain('intervalo=1+hour');
    await waitFor(() => expect(pulsado('7 días')).toBe('true'));
    expect(document.querySelector(`[data-canal-id="${HUM}"]`)?.getAttribute('aria-pressed')).toBe('true');
    await graficoListo();
    const largo = history.length;
    screen.getByRole('button', { name: '30 días' }).click();
    await waitFor(() => expect(window.location.hash).toBe(`#/dispositivos/${ID}?canal=${HUM}&rango=30d`));
    expect(history.length).toBe(largo);
    document.querySelector<HTMLButtonElement>(`[data-canal-id="${TEMP}"]`)!.click();
    await waitFor(() => expect(window.location.hash).toBe(`#/dispositivos/${ID}?canal=${TEMP}&rango=30d`));
    await graficoListo();
  });

  it('un cambio externo del fragmento se reaplica: otro canal y otro rango, con su histórico', async () => {
    history.replaceState(null, '', `#/dispositivos/${ID}?canal=${HUM}&rango=7d`);
    render(App);
    await waitFor(() => expect(pulsado('7 días')).toBe('true'));
    await graficoListo(); // con la importación de uPlot en vuelo, dos montajes seguidos del gráfico escapan al doble
    cambioExterno(`#/dispositivos/${ID}?canal=${TEMP}&rango=1h`);
    await waitFor(() => expect(pulsado('última hora')).toBe('true'));
    expect(pulsado('7 días')).toBe('false');
    expect(document.querySelector(`[data-canal-id="${TEMP}"]`)?.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(historicos().at(-1)).toContain(`/canales/${TEMP}/historico`));
    expect(historicos().at(-1)).toContain('intervalo=1+minute');
    await graficoListo();
  });

  it('un rango desconocido y un canal que no es UUID se ignoran: primer canal y 24 h, y la URL queda corregida', async () => {
    history.replaceState(null, '', `#/dispositivos/${ID}?canal=c-temp&rango=2y`);
    render(App);
    await waitFor(() => expect(window.location.hash).toBe(`#/dispositivos/${ID}?canal=${TEMP}&rango=24h`));
    expect(pulsado('24 horas')).toBe('true');
    expect(historicos()).toHaveLength(1);
    expect(historicos()[0]).toContain(`/canales/${TEMP}/historico`);
    await graficoListo();
  });

  it('un canal con forma de UUID que no es de este dispositivo también se ignora', async () => {
    history.replaceState(null, '', `#/dispositivos/${ID}?canal=00000000-0000-4000-8000-0000000000ff&rango=7d`);
    render(App);
    await waitFor(() => expect(window.location.hash).toBe(`#/dispositivos/${ID}?canal=${TEMP}&rango=7d`));
    expect(historicos().every((p) => p.includes(TEMP))).toBe(true);
    await graficoListo();
  });
});

describe('P2: filtros en la URL', () => {
  const filas = (): string[] => screen.getAllByRole('row').slice(1).map((f) => f.querySelector('a')?.textContent ?? '');

  it('la URL fija los filtros al abrir; cambiarlos los escribe; quitarlos deja «#/inventario»; un enlace viejo «#/?via=…» llega al inventario', async () => {
    history.replaceState(null, '', '#/?via=http&q=poz'); // guardado antes del tablero v2 (A1): se redirige sin entrada nueva
    render(App);
    await waitFor(() => expect(filas()).toEqual(['Pozo']));
    expect(window.location.hash).toBe('#/inventario?via=http&q=poz');
    expect((screen.getByLabelText('Vía') as HTMLSelectElement).value).toBe('http');
    expect((screen.getByLabelText('Buscar') as HTMLInputElement).value).toBe('poz');
    const largo = history.length;
    const buscar = screen.getByLabelText('Buscar') as HTMLInputElement;
    buscar.value = '';
    buscar.dispatchEvent(new Event('input'));
    await waitFor(() => expect(window.location.hash).toBe('#/inventario?via=http'));
    const via = screen.getByLabelText('Vía') as HTMLSelectElement;
    via.value = '';
    via.dispatchEvent(new Event('change'));
    await waitFor(() => expect(window.location.hash).toBe('#/inventario'));
    await waitFor(() => expect(filas()).toEqual(['Invernadero', 'Pozo']));
    document.querySelector<HTMLButtonElement>('[data-conteo="normal"]')!.click();
    await waitFor(() => expect(window.location.hash).toBe('#/inventario?estado=normal'));
    expect(history.length).toBe(largo);
  });

  it('un cambio externo del fragmento se reaplica (los filtros que no trae vuelven a «todos»)', async () => {
    history.replaceState(null, '', '#/?via=http');
    render(App);
    await waitFor(() => expect(filas()).toEqual(['Pozo']));
    cambioExterno('#/?q=invern');
    await waitFor(() => expect(filas()).toEqual(['Invernadero']));
    expect((screen.getByLabelText('Vía') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Buscar') as HTMLInputElement).value).toBe('invern');
  });

  it('un estado desconocido y un sitio, una zona o una vía que no existen se ignoran: tabla completa y la URL queda en «#/inventario»', async () => {
    history.replaceState(null, '', '#/?estado=rojo&sitio=nada&zona=tampoco&via=paloma');
    render(App);
    await waitFor(() => expect(filas()).toEqual(['Invernadero', 'Pozo']));
    await waitFor(() => expect(window.location.hash).toBe('#/inventario'));
  });

  it('el enlace de una fila abre la ficha y «atrás» vuelve al inventario con sus filtros', async () => {
    history.replaceState(null, '', '#/?via=http');
    render(App);
    await waitFor(() => expect(filas()).toEqual(['Pozo']));
    cambioExterno(`#/dispositivos/${ID}`); // lo que hace el enlace (la ficha de otro id daría 404 en este doble)
    await waitFor(() => expect(screen.getByText('Invernadero')).toBeTruthy());
    await graficoListo();
    cambioExterno('#/?via=http'); // «atrás»
    await waitFor(() => expect(filas()).toEqual(['Pozo']));
    expect((screen.getByLabelText('Vía') as HTMLSelectElement).value).toBe('http');
  });
});

// Armazón (docs/19 §4, tablero v2, A1 y A2; desde el 13/11/2026, bloque L, puntos 1 y 5): la llegada es el tablero; la barra lateral con
// las pantallas que existen (icono y texto), que se contrae a iconos con su nombre accesible y su ayuda; bajo 1 000 px, un cajón que
// atrapa el foco y lo devuelve a «Menú»; «Saltar al contenido»; el tema con un botón por el único escritor de preferencias; el selector de
// sitio solo con más de uno; el pie legal también sin sesión; y el servicio, que se dice solo si falla.
describe('armazón: llegada, menú lateral, cajón, sitio, legal y tema', () => {
  const NORTE = { ...SITIO, id: 's2', codigo: 'norte', nombre: 'Sede Norte' };
  const resumenes = (): string[] => peticiones.filter((p) => p.includes('/resumen?'));
  const nav = (): HTMLElement => document.querySelector<HTMLElement>('[data-menu-principal]')!;
  const menu = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('[data-menu]')!;
  // matchMedia de un ancho: el cajón bajo 1 000 px, la barra expandida desde 1 280 px.
  const ancho = (px: number): void => {
    vi.stubGlobal('matchMedia', (q: string) => {
      const max = /max-width:\s*([\d.]+)px/.exec(q);
      const min = /min-width:\s*([\d.]+)px/.exec(q);
      const matches = max !== null ? px <= Number(max[1]) : min !== null ? px >= Number(min[1]) : q.includes('light');
      return { matches, media: q, addEventListener() {}, removeEventListener() {} };
    });
  };

  it('«#/» es el tablero del sitio (con un solo sitio, sin selector y con su nombre arriba); el menú lleva solo pantallas que existen, con icono y texto', async () => {
    render(App);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Tablero · Campus' })).toBeTruthy());
    await waitFor(() => expect(resumenes()[0]).toMatch(/^\/sitios\/s1\/resumen\?desde=/));
    expect(document.querySelector('[data-selector-sitio]')).toBeNull();
    expect(document.querySelector('[data-sitio-nombre]')!.textContent).toBe('Campus');
    const enlaces = [...nav().querySelectorAll('a')];
    expect(enlaces.map((a) => a.textContent!.trim())).toEqual(['Tablero', 'Inventario', 'Actividad', 'Usuarios', 'Dar de alta', 'Legal y acerca de']);
    for (const a of enlaces) expect(a.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true'); // el icono no es el nombre
    expect(screen.getByRole('link', { name: 'Tablero' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Inventario' }).getAttribute('href')).toBe('#/inventario');
    expect(document.querySelector('[data-nav-pendiente]')).toBeNull();
    expect(document.body.textContent).not.toContain('próximamente'); // L1a: se quitan las entradas sin pantalla
    expect(document.querySelector('[data-ir-preferencias]')!.getAttribute('href')).toBe('#/preferencias');
    // El servicio no vive en la cabecera (L1d): si responde bien, no se dice nada.
    expect(document.querySelector('[data-salud]')).toBeNull();
    expect(document.querySelector('[data-aviso-servicio]')).toBeNull();
    // Orden del foco (2.4.1 y 2.4.3): «Saltar al contenido», la barra superior, el menú y el contenido.
    const enfocables = [...document.querySelectorAll<HTMLElement>('a[href], button')];
    expect(enfocables[0]!.matches('[data-saltar]')).toBe(true);
    expect(enfocables.indexOf(menu())).toBeLessThan(enfocables.indexOf(screen.getByRole('link', { name: 'Tablero' })));
    expect(enfocables.indexOf(screen.getByRole('link', { name: 'Tablero' }))).toBeLessThan(enfocables.indexOf(document.querySelector<HTMLElement>('[data-pestana="resumen"]')!));
  });

  it('«Saltar al contenido» lleva el foco a <main> sin cambiar la ruta del panel', async () => {
    history.replaceState(null, '', '#/inventario');
    render(App);
    await waitFor(() => expect(document.querySelector('[data-saltar]')).toBeTruthy());
    const clic = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('[data-saltar]')!.dispatchEvent(clic);
    expect(clic.defaultPrevented).toBe(true); // el fragmento es la ruta del panel: el enlace no navega a «#contenido»
    expect(document.activeElement).toBe(document.getElementById('contenido'));
    expect(window.location.hash).toBe('#/inventario');
  });

  it('con dos sitios aparece el selector; elegir otro lo escribe en la URL y abre su tablero', async () => {
    sitios = [SITIO, NORTE];
    render(App);
    await waitFor(() => expect(document.querySelector('[data-selector-sitio]')).toBeTruthy());
    const selector = document.querySelector<HTMLSelectElement>('[data-selector-sitio]')!;
    expect([...selector.options].map((o) => o.textContent)).toEqual(['Campus', 'Sede Norte']);
    selector.value = 'norte';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Tablero · Sede Norte' })).toBeTruthy());
    expect(window.location.hash).toBe('#/?sitio=norte');
    await waitFor(() => expect(resumenes().at(-1)).toMatch(/^\/sitios\/s2\/resumen\?/));
  });

  it('una navegación que el panel aún no procesó manda sobre la vista que una carga en vuelo quiere escribir en la URL', async () => {
    const base = vi.mocked(fetch).getMockImplementation()!;
    let soltar: (() => void) | null = null;
    vi.stubGlobal('fetch', vi.fn(async (ruta: string, init?: RequestInit) => {
      if (/^\/sitios\/s1\/resumen\?/.test(ruta)) {
        await new Promise<void>((ok) => (soltar = ok)); // Tendencias pidió su resumen: queda en vuelo
        return new Response(JSON.stringify({
          ventana: { desde: 'x', hasta: 'y', intervalo: '15 minutes' }, dispositivos: { total: 0, normal: 0, alerta: 0, sin_senal: 0, inactivo: 0 },
          tramas: { recibidas: 0, rechazadas: 0, cubos: [] }, magnitudes: [], entrega: [], atencion: [], condiciones: [],
        }));
      }
      return base(ruta, init);
    }));
    history.replaceState(null, '', '#/?ver=tendencias');
    render(App);
    await waitFor(() => expect(soltar).not.toBeNull());
    // La persona elige «Inventario»: la URL cambia ya y su `hashchange` llega en la tarea siguiente; antes de eso termina la carga.
    history.pushState(null, '', '#/inventario');
    soltar!();
    await new Promise((r) => setTimeout(r, 50));
    expect(window.location.hash).toBe('#/inventario'); // la carga no reemplazó la URL nueva con la vista de Tendencias
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Inventario' }).getAttribute('aria-current')).toBe('page'));
    expect(window.location.hash.startsWith('#/inventario')).toBe(true);
  });

  it('desde 1 280 px abre expandida; «Menú» (icono y texto) la contrae a iconos: cada enlace se llama por su texto y lo muestra como ayuda', async () => {
    ancho(1440);
    render(App);
    await waitFor(() => expect(menu()).toBeTruthy());
    expect(menu().textContent).toBe('Menú');
    expect(menu().querySelector('svg')).toBeTruthy();
    expect(menu().getAttribute('aria-expanded')).toBe('true');
    expect(menu().getAttribute('aria-controls')).toBe('menu-principal');
    expect(document.querySelector('.armazon')!.classList.contains('contraido')).toBe(false);
    await fireEvent.click(menu());
    await waitFor(() => expect(document.querySelector('.armazon')!.classList.contains('contraido')).toBe(true));
    expect(menu().getAttribute('aria-expanded')).toBe('false');
    expect(menu().textContent).toBe('Menú'); // el nombre no cambia: el estado lo lleva aria-expanded
    const inventario = screen.getByRole('link', { name: 'Inventario' });
    expect(inventario.getAttribute('aria-label')).toBe('Inventario');
    const ayuda = inventario.parentElement!.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(ayuda.textContent).toBe('Inventario');
    expect(ayuda.hidden).toBe(true);
    await fireEvent.focusIn(inventario);
    expect(ayuda.hidden).toBe(false); // al enfocar
    await fireEvent.keyDown(inventario, { key: 'Escape' });
    expect(ayuda.hidden).toBe(true); // se quita con Escape
    // Todos los enlaces de solo icono, también el del pie («Legal y acerca de»), llevan su nombre y su ayuda visible (RF-58, L1e).
    const soloIcono = [...nav().querySelectorAll<HTMLAnchorElement>('a[href]')];
    expect(soloIcono.length).toBeGreaterThanOrEqual(3);
    expect(soloIcono.map((a) => a.parentElement!.querySelector('[role="tooltip"]')?.textContent ?? `sin ayuda: ${a.getAttribute('aria-label')}`)).toEqual(soloIcono.map((a) => a.getAttribute('aria-label')));
    expect(soloIcono.at(-1)!.getAttribute('aria-label')).toBe('Legal y acerca de');
    await fireEvent.click(menu());
    await waitFor(() => expect(document.querySelector('.armazon')!.classList.contains('contraido')).toBe(false));
    expect(screen.getByRole('link', { name: 'Inventario' }).hasAttribute('aria-label')).toBe(false);
  });

  it('entre 1 000 y 1 279 px abre contraída; el estado vive en memoria (ni en la cuenta ni en el navegador)', async () => {
    ancho(1100);
    const guardado = vi.spyOn(Storage.prototype, 'setItem');
    render(App);
    await waitFor(() => expect(menu()).toBeTruthy());
    await waitFor(() => expect(document.querySelector('.armazon')!.classList.contains('contraido')).toBe(true));
    await fireEvent.click(menu());
    await waitFor(() => expect(document.querySelector('.armazon')!.classList.contains('contraido')).toBe(false));
    expect(guardado).not.toHaveBeenCalled();
    expect(peticiones.filter((p) => p === '/preferencias')).toEqual([]);
    guardado.mockRestore();
  });

  it('bajo 1 000 px el menú es un cajón: el foco entra y no sale con Tab; Escape, tocar fuera o elegir un destino lo cierran y el foco vuelve a «Menú»', async () => {
    ancho(390);
    render(App);
    await waitFor(() => expect(menu()).toBeTruthy());
    await waitFor(() => expect(document.querySelector('.armazon')!.classList.contains('es-cajon')).toBe(true));
    expect(menu().getAttribute('aria-expanded')).toBe('false');
    // El tema va dentro del cajón en teléfono (L5): no en la barra superior.
    expect(document.querySelector('.barra-superior [data-tema]')).toBeNull();
    expect(nav().querySelector('[data-tema]')).toBeTruthy();
    await fireEvent.click(menu());
    await waitFor(() => expect(nav().contains(document.activeElement)).toBe(true));
    expect(menu().getAttribute('aria-expanded')).toBe('true');
    expect((document.getElementById('contenido') as HTMLElement & { inert: boolean }).inert).toBe(true); // lo de detrás no recibe ni foco ni puntero
    const enfocables = [...nav().querySelectorAll<HTMLElement>('a[href], button')];
    enfocables.at(-1)!.focus();
    await fireEvent.keyDown(enfocables.at(-1)!, { key: 'Tab' });
    expect(document.activeElement).toBe(enfocables[0]); // da la vuelta dentro
    await fireEvent.keyDown(enfocables[0]!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(enfocables.at(-1));
    // Si el foco quedó fuera del cajón (un clic en el fondo lo deja en el cuerpo), Tab lo devuelve al cajón; «Saltar al contenido», inerte.
    expect((document.querySelector('[data-saltar]') as HTMLElement & { inert: boolean }).inert).toBe(true);
    (document.activeElement as HTMLElement).blur();
    expect(nav().contains(document.activeElement)).toBe(false);
    await fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(document.activeElement).toBe(enfocables[0]);
    // El último control del cajón es «Cerrar menú» (un diálogo modal se cierra también con un control con nombre).
    const cerrar = screen.getByRole('button', { name: 'Cerrar menú' });
    expect(enfocables.at(-1)).toBe(cerrar);
    await fireEvent.click(cerrar);
    await waitFor(() => expect(menu().getAttribute('aria-expanded')).toBe('false'));
    expect(document.activeElement).toBe(menu());
    expect((document.querySelector('[data-saltar]') as HTMLElement & { inert: boolean }).inert).toBeFalsy();
    await fireEvent.click(menu());
    await waitFor(() => expect(nav().contains(document.activeElement)).toBe(true));
    await fireEvent.keyDown(document.body, { key: 'Escape' }); // Escape vale esté donde esté el foco
    await waitFor(() => expect(menu().getAttribute('aria-expanded')).toBe('false'));
    expect(document.activeElement).toBe(menu());
    await fireEvent.click(menu());
    await waitFor(() => expect(document.querySelector('[data-velo]')).toBeTruthy());
    await fireEvent.click(document.querySelector('[data-velo]')!);
    await waitFor(() => expect(document.activeElement).toBe(menu()));
    await fireEvent.click(menu());
    await waitFor(() => expect(nav().contains(document.activeElement)).toBe(true));
    const inventario = screen.getByRole('link', { name: 'Inventario' });
    await fireEvent.click(inventario);
    cambioExterno('#/inventario'); // lo que hace el enlace
    await waitFor(() => expect(menu().getAttribute('aria-expanded')).toBe('false'));
    expect(document.activeElement).toBe(menu());
  });

  it('el tema con un botón: dice lo que hará, se aplica al instante y se guarda por la fila de preferencias; si el servidor lo rechaza, vuelve y lo dice', async () => {
    const puts: { cuerpo: Record<string, unknown>; soltar: (r: Response) => void }[] = [];
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal('fetch', vi.fn(async (ruta: string, init?: RequestInit) => {
      if (ruta === '/sesion') return new Response(JSON.stringify({ ...SESION, preferencias: { ...PREFS_BASE } }));
      if (ruta === '/preferencias' && init?.method === 'PUT') return new Promise<Response>((soltar) => puts.push({ cuerpo: JSON.parse(String(init.body)), soltar }));
      // Lo que el servidor tiene cuando se le pregunta tras el 409: otra pestaña de la misma persona guardó entretanto.
      if (ruta === '/preferencias') { relecturas++; return new Response(JSON.stringify({ ...PREFS_BASE, tema: 'oscuro', actualizado_en: '2026-11-13T10:05:00.000002Z' })); }
      return base(ruta, init);
    }));
    let relecturas = 0;
    render(App);
    const tema = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('[data-tema]')!;
    await waitFor(() => expect(menu()).toBeTruthy()); // con la sesión ya leída
    await waitFor(() => expect(tema().textContent).toBe('Tema oscuro'));
    await fireEvent.click(tema());
    expect(document.documentElement.getAttribute('data-theme')).toBe('oscuro'); // al instante
    await waitFor(() => expect(tema().textContent).toBe('Tema claro'));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.cuerpo).toMatchObject({ tema: 'oscuro', actualizado_en: null });
    await fireEvent.click(tema()); // otro toque mientras el primero sigue en vuelo: espera su turno
    await new Promise((r) => setTimeout(r, 30));
    expect(puts).toHaveLength(1); // nunca dos PUT en vuelo
    puts[0]!.soltar(new Response(JSON.stringify({ ...puts[0]!.cuerpo, actualizado_en: '2026-11-13T10:00:00.000001Z' })));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]!.cuerpo).toMatchObject({ tema: 'claro', actualizado_en: '2026-11-13T10:00:00.000001Z' }); // con la marca que dejó el anterior
    puts[1]!.soltar(new Response(JSON.stringify({ statusCode: 409, message: 'cambiaron' }), { status: 409 }));
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('oscuro')); // vuelve
    // Puede haber otro aviso a la vez (el doble de la API de estas pruebas no sirve el resumen del tablero): se busca el del tema entre todos.
    await waitFor(() => expect(screen.getAllByRole('alert').map((x) => x.textContent).join(' | ')).toContain('No se guardó el tema; volvió al anterior.'));
    expect(tema().textContent).toBe('Tema claro');
    // Tras el 409 se releyeron las preferencias vigentes: el intento siguiente lleva la marca del servidor y ya no choca.
    expect(relecturas).toBe(1);
    await fireEvent.click(tema());
    await waitFor(() => expect(puts).toHaveLength(3));
    expect(puts[2]!.cuerpo).toMatchObject({ tema: 'claro', actualizado_en: '2026-11-13T10:05:00.000002Z' });
  });

  it('sin sesión el botón de tema vale para la visita: no guarda nada', async () => {
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
      peticiones.push(ruta);
      return ruta === '/salud' ? new Response(JSON.stringify({ estado: 'ok', base: 'conectada', tablas: 22 })) : new Response(JSON.stringify({ statusCode: 401 }), { status: 401 });
    }));
    render(App);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy());
    await fireEvent.click(document.querySelector('[data-tema]')!);
    expect(document.documentElement.getAttribute('data-theme')).toBe('oscuro');
    expect(peticiones.filter((p) => p === '/preferencias')).toEqual([]);
  });

  it('un servicio que no responde se dice con un aviso; con sesión, «Legal y acerca de» dice el estado del servicio', async () => {
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal('fetch', vi.fn(async (ruta: string, init?: RequestInit) => (ruta === '/salud' ? new Response('', { status: 503 }) : base(ruta, init))));
    render(App);
    await waitFor(() => expect(document.querySelector('[data-aviso-servicio]')!.textContent).toContain('El servicio no responde'));
    vi.stubGlobal('fetch', vi.fn(async (ruta: string, init?: RequestInit) => base(ruta, init)));
    cambioExterno('#/legal?seccion=acerca');
    await waitFor(() => expect(document.querySelector('[data-salud]')?.textContent).toBe('ok, base conectada, 22 tablas'));
  });

  it('«Legal y acerca de» se lee también sin sesión: la licencia AGPL y los avisos de terceros', async () => {
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => (ruta === '/salud' ? new Response('{}') : new Response(JSON.stringify({ statusCode: 401 }), { status: 401 }))));
    history.replaceState(null, '', '#/legal');
    render(App);
    await waitFor(() => expect(document.querySelector('[data-legal]')).toBeTruthy());
    expect(document.querySelector('[data-legal]')!.textContent).toContain('GNU Affero General Public License, versión 3');
    const cookie = document.querySelector('[data-legal-cookie]')!.textContent!;
    expect(cookie).toContain('__Host-sesion');
    expect(cookie).toContain('30 minutos sin actividad');
    expect(cookie).toContain('8 horas');
    expect(cookie).toContain('No hay cookies de');
    expect(document.querySelector('[data-avisos-terceros]')!.getAttribute('href')).toBe(`${import.meta.env.BASE_URL}avisos-de-terceros.txt`); // bajo /panel/ en el build
    expect(screen.getByRole('link', { name: 'Legal y acerca de' }).getAttribute('href')).toBe('#/legal'); // el pie, también sin sesión
    expect(screen.queryByRole('heading', { name: 'Entrar' })).toBeNull();
    cambioExterno('#/');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy()); // los datos, en cambio, exigen sesión
  });

  it('las preferencias de la sesión mandan: tema oscuro en <html data-theme> y el sitio predeterminado en el tablero', async () => {
    sitios = [SITIO, NORTE];
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal('fetch', vi.fn(async (ruta: string, init?: RequestInit) =>
      ruta === '/sesion' ? new Response(JSON.stringify({ ...SESION, preferencias: { tema: 'oscuro', sitio_predeterminado: 'norte' } })) : base(ruta, init)));
    render(App);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Tablero · Sede Norte' })).toBeTruthy());
    expect(document.documentElement.getAttribute('data-theme')).toBe('oscuro');
  });
});
