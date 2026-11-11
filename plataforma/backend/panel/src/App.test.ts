// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
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

// Armazón (docs/19 §4, tablero v2, A1 y A2): la llegada es el tablero; el menú según el rol, con las pantallas que aún no existen sin
// enlace; el selector de sitio solo con más de uno y en la URL; el botón «Menú» con texto; el pie legal también sin sesión; el tema y el
// sitio de las preferencias.
describe('armazón: llegada, menú, sitio, legal y tema', () => {
  const NORTE = { ...SITIO, id: 's2', codigo: 'norte', nombre: 'Sede Norte' };
  const resumenes = (): string[] => peticiones.filter((p) => p.includes('/resumen?'));

  it('«#/» es el tablero del sitio (con un solo sitio, sin selector); el menú nombra lo que viene sin enlazarlo', async () => {
    render(App);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Tablero · Campus' })).toBeTruthy());
    await waitFor(() => expect(resumenes()[0]).toMatch(/^\/sitios\/s1\/resumen\?desde=/));
    expect(document.querySelector('[data-selector-sitio]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Tablero' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Inventario' }).getAttribute('href')).toBe('#/inventario');
    expect(screen.getByRole('link', { name: 'Usuarios' })).toBeTruthy(); // administra su sitio
    expect(screen.queryByRole('link', { name: /Condiciones/ })).toBeNull(); // sin pantalla todavía: sin enlace
    expect([...document.querySelectorAll('[data-nav-pendiente]')].map((x) => x.textContent)).toEqual(['Condiciones (próximamente)', 'Cuarentena (próximamente)']);
    // Desde P7 y P14 (11/11/2026): «Actividad» con «auditoria» en la matriz, «Dar de alta» con «escribir»; «Preferencias» en la cuenta.
    expect(screen.getByRole('link', { name: 'Actividad' }).getAttribute('href')).toBe('#/actividad');
    expect(screen.getByRole('link', { name: 'Dar de alta' }).getAttribute('href')).toBe('#/alta');
    expect(document.querySelector('[data-ir-preferencias]')!.getAttribute('href')).toBe('#/preferencias');
    expect(screen.getByRole('link', { name: 'Legal y acerca de' }).getAttribute('href')).toBe('#/legal');
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

  it('el botón «Menú» (con texto) pliega y despliega el menú, con aria-expanded', async () => {
    render(App);
    await waitFor(() => expect(document.querySelector('[data-menu]')).toBeTruthy());
    const boton = document.querySelector<HTMLButtonElement>('[data-menu]')!;
    expect(boton.textContent).toBe('Menú');
    expect(boton.getAttribute('aria-expanded')).toBe('false');
    expect(boton.getAttribute('aria-controls')).toBe('menu-principal');
    boton.click();
    await waitFor(() => expect(boton.getAttribute('aria-expanded')).toBe('true'));
    expect(document.querySelector('[data-menu-principal]')!.classList.contains('abierto')).toBe(true);
    expect(boton.textContent).toBe('Menú'); // el nombre no cambia: el estado lo lleva aria-expanded
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
