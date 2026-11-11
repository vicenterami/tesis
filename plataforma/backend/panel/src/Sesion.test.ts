// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DispositivoInventario } from './lib/modelo';
import { marcadosParaComparar, recordarMarcados } from './lib/comparar';
import { TEXTO_CREDENCIALES } from './lib/sesion';
import { inventarioSimulado } from './servidor-simulado';

// P10 de punta a punta en el DOM (docs/19 §4 y §6; docs/20 §3 y §4), contra un backend falso con estado: sin sesión → «Entrar»; con la
// temporal → cambio obligatorio; dentro → inventario y quién soy; la sesión que vence → «Entrar» con la ruta guardada y vuelta a ella;
// salir → DELETE /sesion y el canal en vivo cerrado; la renovación solo con interacción. El navegador real lo recorre e2e/sesion.mjs.
vi.mock('uplot', () => ({ default: class { constructor(_o: unknown, _d: unknown, el: HTMLElement) { el.appendChild(document.createElement('canvas')); } setData(): void {} setSize(): void {} destroy(): void {} static tzDate(d: Date): Date { return d; } } }));
vi.mock('uplot/dist/uPlot.min.css', () => ({}));
import App from './App.svelte';

const AHORA = new Date('2026-11-08T15:00:00Z');
const PERMISOS = { administrador: ['leer', 'exportar', 'escribir', 'usuarios'], consulta: ['leer'] };
const TEMPORAL = 'temporal-de-prueba-24-car';
const NUEVA = 'una frase larga de prueba';
const inventario: DispositivoInventario[] = [
  { id: '00000000-0000-4000-8000-000000000001', id_fisico: 'dev-0001', nombre: 'Invernadero', estado: 'activo', via: 'mqtt', formato: 'senml', intervalo_esperado_s: 60, visto_por_ultima_vez: '2026-11-08T14:59:30Z', en_linea: true, zona: 'Lab', sitio: 'Campus', zona_horaria: 'America/Santiago', sitio_codigo: 'uct', zona_id: 'z', condiciones_abiertas: 0, canales: [] },
  { id: '00000000-0000-4000-8000-000000000003', id_fisico: 'dev-0003', nombre: 'Pozo', estado: 'activo', via: 'http', formato: 'senml', intervalo_esperado_s: 60, visto_por_ultima_vez: '2026-11-08T14:59:30Z', en_linea: true, zona: 'Lab', sitio: 'Campus', zona_horaria: 'America/Santiago', sitio_codigo: 'uct', zona_id: 'z', condiciones_abiertas: 0, canales: [] },
];

// El backend falso: una persona («Ana», administradora de Campus), su clave y el estado de su sesión.
const srv = { sesion: 'ninguna' as 'ninguna' | 'temporal' | 'viva', clave: TEMPORAL, temporal: true, rol: 'administrador' as 'administrador' | 'consulta', bloqueo: 0 };
const pedidos: { metodo: string; ruta: string; pedido: string | undefined; cuerpo: unknown }[] = [];
const json = (x: unknown, status = 200): Response => new Response(JSON.stringify(x), { status });
function backend(ruta: string, init: RequestInit = {}): Response {
  const metodo = init.method ?? 'GET';
  const cab = (init.headers ?? {}) as Record<string, string>;
  const cuerpo = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  pedidos.push({ metodo, ruta, pedido: cab['X-Pedido'], cuerpo });
  if (ruta === '/salud') return json({ estado: 'ok', base: 'conectada', tablas: 20 });
  if (metodo === 'POST' && ruta === '/sesion') {
    if (srv.bloqueo > 0) return json({ statusCode: 429, message: `bloqueado: demasiados intentos fallidos; reintenta en ${srv.bloqueo} s`, reintentar_en_s: srv.bloqueo }, 429);
    if (cab['X-Pedido'] !== 'panel' || cuerpo?.email !== 'ana@ejemplo.invalid' || cuerpo?.clave !== srv.clave) return json({ statusCode: 401, message: 'credenciales no válidas' }, 401);
    srv.sesion = srv.temporal ? 'temporal' : 'viva';
    return json({ usuario: { id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid', clave_temporal: srv.temporal }, expira_en: '2026-11-08T23:00:00Z' });
  }
  if (srv.sesion === 'ninguna') return json({ statusCode: 401, message: 'sesión requerida' }, 401);
  if (ruta === '/sesion' && metodo === 'GET') {
    return json({ sistema: false, usuario: { id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid' }, clave_temporal: srv.sesion === 'temporal', sitios: [{ sitio_id: 's1', codigo: 'uct', nombre: 'Campus', rol: srv.rol }], expira_en: null, inactividad_vence_en: null, permisos: PERMISOS });
  }
  if (ruta.startsWith('/sesion') && metodo === 'DELETE') { srv.sesion = 'ninguna'; return json({ revocadas: 1 }); }
  if (ruta === '/sesion/clave' && metodo === 'POST') {
    if (cuerpo?.actual !== srv.clave) return json({ statusCode: 400, message: ['la clave actual no es correcta'] }, 400);
    srv.clave = cuerpo.nueva; srv.temporal = false; srv.sesion = 'viva';
    return json({ usuario: { id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid', clave_temporal: false }, expira_en: '2026-11-08T23:00:00Z' });
  }
  if (srv.sesion === 'temporal') return json({ statusCode: 403, message: 'debes cambiar la clave temporal antes de seguir (POST /sesion/clave)' }, 403);
  const inv = inventarioSimulado(ruta, inventario, [], AHORA);
  if (inv !== null) return inv;
  if (ruta === '/sitios') return json([{ id: 's1', codigo: 'uct', nombre: 'Campus', zona_horaria: 'America/Santiago', rol: srv.rol, zonas: [{ id: 'z', nombre: 'Lab' }] }]);
  if (ruta.startsWith('/condiciones?')) return json([]);
  if (ruta === '/usuarios') return json([]);
  return json({ statusCode: 404, message: 'no encontrado' }, 404);
}

// EventSource: se registra cada canal abierto y si se cerró.
class Fuente {
  static todas: Fuente[] = [];
  readyState = 1;
  cerrada = false;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(public url: string) { Fuente.todas.push(this); }
  addEventListener(): void {}
  close(): void { this.cerrada = true; this.readyState = 2; }
}
const abiertas = (): Fuente[] => Fuente.todas.filter((f) => !f.cerrada);

beforeEach(() => {
  Object.assign(srv, { sesion: 'ninguna', clave: TEMPORAL, temporal: true, rol: 'administrador', bloqueo: 0 });
  pedidos.length = 0;
  Fuente.todas.length = 0;
  vi.useFakeTimers({ now: AHORA, toFake: ['Date'] });
  vi.stubGlobal('EventSource', Fuente);
  vi.stubGlobal('fetch', vi.fn(async (ruta: string, init?: RequestInit) => backend(ruta, init)));
  history.replaceState(null, '', '#/inventario'); // estas pruebas miran el inventario; la llegada al tablero, App.test.ts
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  history.replaceState(null, '', '#/');
});

const escribir = async (etiqueta: string | RegExp, valor: string): Promise<void> => { await fireEvent.input(screen.getByLabelText(etiqueta), { target: { value: valor } }); };
async function entrarCon(clave: string): Promise<void> {
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy());
  await escribir('Correo', 'ana@ejemplo.invalid');
  await escribir('Clave', clave);
  await fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}
async function dentro(filas = 3): Promise<void> {
  srv.sesion = 'viva';
  srv.temporal = false;
  render(App);
  await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(filas)); // cabecera + dispositivos visibles
}

describe('P10: entrar, clave temporal, quién soy', () => {
  it('sin sesión: la pantalla «Entrar» con autocompletado de gestor de claves y el camino de «olvidé mi clave»; ninguna pantalla ni canal en vivo', async () => {
    render(App);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy());
    expect(screen.getByLabelText('Correo').getAttribute('autocomplete')).toBe('username');
    expect(screen.getByLabelText('Clave').getAttribute('autocomplete')).toBe('current-password');
    expect(screen.getByText('¿Olvidaste tu clave?')).toBeTruthy();
    expect(document.body.textContent).toContain('Pídele una clave temporal al administrador de tu sitio');
    expect(pedidos.some((p) => p.ruta === '/dispositivos')).toBe(false);
    expect(Fuente.todas).toHaveLength(0);
  });

  it('cualquier rechazo de credenciales: el mismo texto; un 429 dice cuántos segundos esperar', async () => {
    render(App);
    await entrarCon('no-es-la-clave');
    await waitFor(() => expect(screen.getByRole('alert').textContent?.trim()).toBe(TEXTO_CREDENCIALES));
    const post = pedidos.find((p) => p.metodo === 'POST' && p.ruta === '/sesion')!;
    expect(post.pedido).toBe('panel');
    srv.bloqueo = 60;
    await fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(document.querySelector('[data-aviso="espera"]')?.textContent).toContain('espera 60 s'));
    expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy(); // un 401 o un 429 al entrar no es «tu sesión venció»
  });

  it('con la temporal: cambio obligatorio con las reglas a la vista antes de escribir; al cambiarla, el inventario y quién soy en la cabecera', async () => {
    render(App);
    await entrarCon(TEMPORAL);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Elige tu clave' })).toBeTruthy());
    expect(document.querySelector('[data-reglas-clave]')!.textContent).toContain('Entre 12 y 128 caracteres');
    expect(screen.queryByLabelText(/Clave actual/)).toBeNull(); // la temporal recién escrita no se pide otra vez
    expect(screen.getByLabelText('Clave nueva').getAttribute('autocomplete')).toBe('new-password');
    const guardar = (): HTMLButtonElement => screen.getByRole('button', { name: 'Guardar la clave nueva' }) as HTMLButtonElement;
    expect(guardar().disabled).toBe(true);
    await escribir('Clave nueva', 'corta');
    expect(document.querySelector('[data-clave-estado]')!.textContent).toContain('faltan 7 caracteres');
    await escribir('Clave nueva', NUEVA);
    await escribir('Repite la clave nueva', NUEVA);
    await waitFor(() => expect(guardar().disabled).toBe(false));
    expect(pedidos.some((p) => p.ruta === '/dispositivos')).toBe(false); // nada de pantallas hasta cambiarla
    await fireEvent.click(guardar());
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
    const cambio = pedidos.find((p) => p.ruta === '/sesion/clave')!;
    expect(cambio).toMatchObject({ metodo: 'POST', pedido: 'panel', cuerpo: { actual: TEMPORAL, nueva: NUEVA } });
    expect(document.querySelector('[data-quien-nombre]')!.textContent).toBe('Ana');
    expect(document.querySelector('[data-quien-sitios]')!.textContent).toBe('Campus (administrador)');
    expect(screen.getByRole('link', { name: 'Usuarios' })).toBeTruthy();
    expect(abiertas()).toHaveLength(1); // el canal en vivo del inventario, abierto recién ahora
  });

  it('una sesión con clave temporal que llega recargando la página pide también la clave actual', async () => {
    srv.sesion = 'temporal';
    render(App);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Elige tu clave' })).toBeTruthy());
    expect(screen.getByLabelText(/Clave actual/).getAttribute('autocomplete')).toBe('current-password');
  });

  it('rol de consulta: sin «Usuarios» en el menú, y #/usuarios dice que su rol no administra personas', async () => {
    srv.rol = 'consulta';
    await dentro();
    expect(document.querySelector('[data-quien-sitios]')!.textContent).toBe('Campus (consulta)');
    expect(screen.queryByRole('link', { name: 'Usuarios' })).toBeNull();
    history.replaceState(null, '', '#/usuarios');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(document.querySelector('[data-sin-usuarios]')).toBeTruthy());
    expect(pedidos.some((p) => p.ruta === '/usuarios')).toBe(false);
  });
});

describe('P10: vencer, renovar y salir', () => {
  it('la sesión vence (401 en una petición): «Entrar» con aviso, el canal en vivo se cierra; al entrar, vuelve a la ruta guardada y reabre el canal', async () => {
    history.replaceState(null, '', '#/inventario?via=http');
    await dentro(2);
    expect(abiertas()).toHaveLength(1);
    recordarMarcados(['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']);
    srv.sesion = 'ninguna'; // venció en el servidor
    vi.setSystemTime(new Date(AHORA.getTime() + 6 * 60_000));
    await fireEvent.keyDown(window, { key: 'a' }); // interacción → renovación → 401
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy());
    expect(document.body.textContent).toContain('Tu sesión venció o se cerró: entra de nuevo para seguir donde estabas.');
    expect(abiertas()).toHaveLength(0);
    expect(marcadosParaComparar()).toEqual([]); // las casillas «comparar» no pasan a quien entre después
    history.replaceState(null, '', '#/usuarios'); // la URL cambió mientras tanto: manda la ruta guardada
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await entrarCon(srv.clave);
    await waitFor(() => expect(window.location.hash).toBe('#/inventario?via=http'));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2)); // el filtro de la ruta guardada: solo la de vía http
    expect(abiertas()).toHaveLength(1);
  });

  it('renovación: sin interacción, ningún GET /sesion aunque pasen 30 min; con interacción, uno cada 5 min como mucho', async () => {
    await dentro();
    const renovaciones = (): number => pedidos.filter((p) => p.metodo === 'GET' && p.ruta === '/sesion').length;
    const antes = renovaciones();
    vi.setSystemTime(new Date(AHORA.getTime() + 30 * 60_000));
    expect(renovaciones()).toBe(antes);
    await fireEvent.pointerDown(window);
    await fireEvent.keyDown(window, { key: 'x' });
    await fireEvent.mouseMove(window);
    await waitFor(() => expect(renovaciones()).toBe(antes + 1));
    vi.setSystemTime(new Date(AHORA.getTime() + 34 * 60_000));
    await fireEvent.keyDown(window, { key: 'x' });
    expect(renovaciones()).toBe(antes + 1);
  });

  it('un 403 por clave temporal en medio de la sesión lleva al cambio obligatorio', async () => {
    await dentro();
    srv.sesion = 'temporal'; // la sesión quedó con clave temporal: el guardia responde 403 a todo salvo la sesión y el cambio
    history.replaceState(null, '', '#/dispositivos/00000000-0000-4000-8000-000000000001');
    window.dispatchEvent(new HashChangeEvent('hashchange')); // la ficha pide GET /dispositivos/{id} → 403 «debes cambiar la clave temporal»
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Elige tu clave' })).toBeTruthy());
    expect(abiertas()).toHaveLength(0); // las pantallas (y sus canales) se desmontan mientras tanto
  });

  it('salir: DELETE /sesion con X-Pedido, «Entrar», el canal cerrado y el panel vuelto al tablero; «cerrar en todos lados» manda ?todas=true', async () => {
    history.replaceState(null, '', '#/inventario?via=http');
    await dentro(2);
    recordarMarcados(['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']);
    expect(marcadosParaComparar()).toHaveLength(2); // en los dos sentidos: con sesión, se recuerdan
    await fireEvent.click(screen.getByRole('button', { name: 'Salir' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy());
    expect(pedidos.find((p) => p.metodo === 'DELETE')).toMatchObject({ ruta: '/sesion', pedido: 'panel' });
    expect(document.body.textContent).toContain('Cerraste la sesión.');
    expect(abiertas()).toHaveLength(0);
    expect(window.location.hash).toBe('#/'); // la próxima persona no hereda la pantalla ni los filtros de la anterior
    expect(marcadosParaComparar()).toEqual([]); // ni sus casillas «comparar»
    cleanup();
    pedidos.length = 0;
    history.replaceState(null, '', '#/inventario');
    await dentro();
    await fireEvent.click(screen.getByRole('button', { name: 'Cerrar en todos lados' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy());
    expect(pedidos.find((p) => p.metodo === 'DELETE')).toMatchObject({ ruta: '/sesion?todas=true', pedido: 'panel' });
  });

  // Avisos atrasados (lib/api.ts, generación de la sesión; lib/sesion.ts, trasAvisoDeSesion): /salud se retiene y responde tarde.
  function saludRetenida(): () => (r: Response) => void {
    let soltar: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn((ruta: string, init?: RequestInit) => (ruta === '/salud' ? new Promise<Response>((res) => (soltar = res)) : Promise.resolve(backend(ruta, init)))));
    return () => soltar;
  }
  it('un 401 de una petición iniciada antes de entrar no saca de la sesión recién abierta', async () => {
    const soltar = saludRetenida();
    srv.temporal = false;
    render(App);
    await entrarCon(srv.clave);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
    soltar()(json({ statusCode: 401, message: 'sesión requerida' }, 401));
    await waitFor(() => expect(document.querySelector('[data-salud]')!.textContent).toContain('sin respuesta'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('heading', { name: 'Entrar' })).toBeNull();
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });
  it('un 403 de clave temporal que llega después de salir no abre «Elige tu clave» sin sesión', async () => {
    const soltar = saludRetenida();
    srv.sesion = 'viva';
    srv.temporal = false;
    render(App);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
    await fireEvent.click(screen.getByRole('button', { name: 'Salir' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy());
    soltar()(json({ statusCode: 403, message: 'debes cambiar la clave temporal antes de seguir (POST /sesion/clave)' }, 403));
    await waitFor(() => expect(document.querySelector('[data-salud]')!.textContent).toContain('sin respuesta'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('heading', { name: 'Elige tu clave' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy();
  });
  it('el usuario del sistema (clave de administrador por cabecera) no ve «Usuarios»: la pantalla es de personas con sesión', async () => {
    vi.stubGlobal('fetch', vi.fn(async (ruta: string, init?: RequestInit) =>
      ruta === '/sesion' ? json({ sistema: true, nombre: 'sistema', sitios: 'todos', rol: 'administrador', permisos: PERMISOS }) : (srv.sesion = 'viva', backend(ruta, init))));
    render(App);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
    expect(document.querySelector('[data-ir-usuarios]')).toBeNull();
  });
});

