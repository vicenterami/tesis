// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('uplot', () => ({ default: class { constructor(_o: unknown, _d: unknown, el: HTMLElement) { el.appendChild(document.createElement('canvas')); } setData(): void {} setSize(): void {} destroy(): void {} } }));
vi.mock('uplot/dist/uPlot.min.css', () => ({}));
import App from './App.svelte';
import Legal from './Legal.svelte';
import Notificaciones from './Notificaciones.svelte';

// P11 (docs/19 §4, P11; docs/20 §12) y las notificaciones en pantalla (E), por el DOM: las páginas legales como texto (nunca HTML), el
// soporte con su límite de tasa, la aceptación obligatoria de los términos (sin datos hasta aceptar) y los avisos agrupados por
// dispositivo sobre el MISMO canal en vivo de la pantalla.
const json = (x: unknown, status = 200, h: Record<string, string> = {}): Response => new Response(JSON.stringify(x), { status, headers: h });
const PRIVACIDAD = {
  version: 1, fecha: '2026-11-11', responsable: null, aviso_responsable: 'Quien opera esta instancia aún no configuró su nombre ni su contacto.',
  datos: [{ dato: 'Correo', donde: '`usuario.email`', para_que: 'Iniciar sesión', cuanto_tiempo: 'Mientras exista la cuenta', quien_accede: 'La persona' }],
  secciones: [{ titulo: 'Terceros', parrafos: ['Ningún tercero recibe tus datos.'] }],
};
const TERMINOS = { version: 3, fecha: '2026-11-11', texto: '## Tu cuenta\n- La cuenta es **personal**.\n\n<script>alert(1)</script>' };
const ACERCA = { nombre: 'Sistema', version: '0.9.0', commit: 'abc1234', licencia: 'AGPL-3.0-only', aviso_licencia: 'x', codigo_fuente: null, avisos_terceros: '/panel/avisos-de-terceros.txt' };
let pedidos: { metodo: string; ruta: string; cuerpo: unknown }[] = [];
let soporte: () => Response;
let sesion: Record<string, unknown>;
let datosRestringidos = false;

class Fuente {
  static todas: Fuente[] = [];
  readyState = 1;
  cerrada = false;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  oyentes = new Map<string, (e: MessageEvent) => void>();
  constructor(public url: string) { Fuente.todas.push(this); }
  addEventListener(t: string, f: (e: MessageEvent) => void): void { this.oyentes.set(t, f); }
  close(): void { this.cerrada = true; this.readyState = 2; }
}

beforeEach(() => {
  pedidos = [];
  Fuente.todas.length = 0;
  datosRestringidos = false;
  soporte = () => json({ id: 'm1', creado_en: 'x' }, 201);
  sesion = {
    sistema: false, usuario: { id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid' }, clave_temporal: false, expira_en: null, inactividad_vence_en: null,
    sitios: [{ sitio_id: 's1', codigo: 'uct', nombre: 'Campus', rol: 'administrador' }], permisos: { administrador: ['leer', 'escribir', 'configurar', 'usuarios', 'auditoria'], consulta: ['leer'] },
    preferencias: { notificar: ['umbral'] }, terminos: { version_vigente: 3, version_aceptada: 2, aceptados_en: null, pendiente: true },
  };
  vi.stubGlobal('EventSource', Fuente);
  vi.stubGlobal('fetch', vi.fn(async (ruta: string, init: RequestInit = {}) => {
    const metodo = init.method ?? 'GET';
    pedidos.push({ metodo, ruta, cuerpo: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    if (ruta === '/privacidad') return json(PRIVACIDAD);
    if (ruta === '/terminos') return json(TERMINOS);
    if (ruta === '/acerca') return json(ACERCA);
    if (ruta === '/soporte') return soporte();
    if (ruta === '/salud') return json({ estado: 'ok', base: 'conectada', tablas: 20 });
    if (ruta === '/sesion' && metodo === 'GET') return json(sesion);
    if (ruta === '/sesion' && metodo === 'DELETE') return json({ cerrada: true });
    if (ruta === '/terminos/aceptar') {
      sesion = { ...sesion, terminos: { version_vigente: 3, version_aceptada: 3, aceptados_en: 'x', pendiente: false } };
      return json({ version: 3, aceptados_en: 'x' });
    }
    if (datosRestringidos) return json({ statusCode: 403, codigo: 'terminos_pendientes', version: 3, message: 'debes aceptar los términos de uso (versión 3) antes de seguir (GET /terminos y POST /terminos/aceptar)' }, 403);
    if (ruta === '/sitios') return json([{ id: 's1', codigo: 'uct', nombre: 'Campus', zona_horaria: 'America/Santiago', rol: 'administrador', zonas: [] }]);
    if (ruta.startsWith('/dispositivos?')) return json([{ id: 'd1', id_fisico: 'dev-1', nombre: 'Invernadero', estado: 'activo', via: 'mqtt', formato: 'senml', intervalo_esperado_s: 60, visto_por_ultima_vez: null, en_linea: null, zona: 'Lab', sitio: 'Campus', zona_horaria: 'America/Santiago', sitio_codigo: 'uct', zona_id: 'z', condiciones_abiertas: 0, canales: [], estado_visual: 'normal' }], 200, { 'X-Total': '1' });
    if (ruta.startsWith('/condiciones?')) return json([{ id: 'c1', tipo: 'umbral', dispositivo_id: 'd1', dispositivo: 'Invernadero', abierta_en: 'x', cerrada_en: null, duracion_s: 1, id_fisico: 'dev-1', sitio: 'Campus', umbral_alto: 30, umbral_bajo: null, magnitud: 'temperatura' }]);
    return json({ message: 'no' }, 404);
  }));
  history.replaceState(null, '', '#/inventario');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); history.replaceState(null, '', '#/'); });

describe('P11 Legal y acerca de', () => {
  it('privacidad (inventario y responsable no configurado), términos con versión y acerca de con commit; todo como texto, un <script> del servidor no se interpreta', async () => {
    render(Legal, { conSesion: true });
    await waitFor(() => expect(document.querySelector('[data-inventario-privacidad]')).toBeTruthy());
    expect(document.querySelector('[data-inventario-privacidad]')!.textContent).toContain('Correo: Iniciar sesión. Dónde: usuario.email.');
    expect(document.querySelector('[data-sin-responsable]')!.textContent).toContain('aún no configuró');
    await waitFor(() => expect(document.querySelector('[data-legal-terminos] [data-version-legal]')?.textContent).toBe('Versión 3, del 2026-11-11.'));
    expect(document.querySelector('[data-legal-terminos] li')!.textContent).toBe('La cuenta es personal.');
    expect(document.querySelector('[data-legal-terminos] script')).toBeNull();
    expect(document.querySelector('[data-legal-terminos]')!.textContent).toContain('<script>alert(1)</script>');
    await waitFor(() => expect(document.querySelector('[data-acerca-commit]')?.textContent).toBe('abc1234'));
    expect(document.querySelector('[data-legal-cookie]')).toBeTruthy(); // lo de antes sigue
  });

  it('AGPL §13 (decidido el 11/11/2026): el aviso del servidor siempre; sin enlace configurado, «pídelo al responsable (Soporte)»; con él, el enlace', async () => {
    render(Legal, { conSesion: false });
    await waitFor(() => expect(document.querySelector('[data-aviso-licencia]')?.textContent).toBe('x'));
    expect(document.querySelector('[data-codigo-fuente]')!.textContent).toContain('pídelo al responsable (Soporte)');
    expect(document.querySelector<HTMLAnchorElement>('[data-codigo-fuente] a')!.getAttribute('href')).toBe('#/legal?seccion=soporte');
    cleanup();
    vi.mocked(fetch).mockImplementation(async (ruta) => json(ruta === '/acerca' ? { ...ACERCA, version: null, commit: null, codigo_fuente: 'https://example.org/codigo' } : { message: 'no' }, ruta === '/acerca' ? 200 : 404));
    render(Legal, { conSesion: false });
    await waitFor(() => expect(document.querySelector<HTMLAnchorElement>('[data-codigo-fuente] a')?.getAttribute('href')).toBe('https://example.org/codigo'));
    expect(document.querySelector('[data-acerca-version]')).toBeNull(); // sin sesión, el servidor no la manda
  });

  it('soporte: enviar deja el aviso de éxito y vacía el texto; un 429 dice cuántos segundos esperar; sin sesión, no se ofrece el formulario', async () => {
    render(Legal, { conSesion: true });
    const t = document.querySelector('[data-soporte-texto]') as HTMLTextAreaElement;
    await fireEvent.input(t, { target: { value: '  El nodo 3 no aparece  ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Enviar a soporte' }));
    await waitFor(() => expect(document.body.textContent).toContain('Mensaje enviado'));
    expect(pedidos.find((p) => p.ruta === '/soporte')!.cuerpo).toEqual({ texto: 'El nodo 3 no aparece' });
    expect(t.value).toBe('');
    soporte = () => json({ statusCode: 429, message: 'demasiados mensajes de soporte; reintenta en 1800 s', reintentar_en_s: 1800 }, 429);
    await fireEvent.input(t, { target: { value: 'otra vez' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Enviar a soporte' }));
    await waitFor(() => expect(document.body.textContent).toContain('Demasiados intentos: espera 1800 s y reintenta.'));
    cleanup();
    render(Legal, { conSesion: false });
    expect(document.querySelector('[data-form-soporte]')).toBeNull();
  });
});

describe('Términos pendientes (docs/20 §12)', () => {
  it('con la sesión restringida, la pantalla de términos y ningún dato (ni canal en vivo); «Acepto los términos (versión 3)» los acepta y entra', async () => {
    render(App);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Términos de uso' })).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Acepto los términos (versión 3)' })).toBeTruthy());
    expect(pedidos.some((p) => p.ruta.startsWith('/dispositivos') || p.ruta === '/sitios')).toBe(false);
    expect(Fuente.todas).toHaveLength(0);
    await fireEvent.click(screen.getByRole('button', { name: 'Acepto los términos (versión 3)' }));
    await waitFor(() => expect(document.querySelector('[data-id="d1"]')).toBeTruthy());
    expect(pedidos.find((p) => p.ruta === '/terminos/aceptar')).toMatchObject({ metodo: 'POST', cuerpo: { version: 3 } });
  });

  it('un 403 «terminos_pendientes» en cualquier lectura (la versión subió con la sesión abierta) lleva a la pantalla de términos; «Salir» cierra la sesión', async () => {
    sesion = { ...sesion, terminos: { version_vigente: 3, version_aceptada: 3, aceptados_en: 'x', pendiente: false } };
    datosRestringidos = true;
    render(App);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Términos de uso' })).toBeTruthy());
    expect(document.querySelector('[data-id="d1"]')).toBeNull();
    await fireEvent.click(document.querySelector('[data-salir-terminos]')!);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy());
    expect(pedidos.some((p) => p.ruta === '/sesion' && p.metodo === 'DELETE')).toBe(true);
  });
});

describe('Notificaciones en pantalla (E)', () => {
  it('una sola conexión al canal sin filtro para el inventario y los avisos; condiciones del mismo dispositivo se agrupan con «× 2» y nombre; la del navegador, solo para el tipo elegido', async () => {
    sesion = { ...sesion, terminos: undefined };
    const creadas: { titulo: string; tag?: string; body?: string }[] = [];
    vi.stubGlobal('Notification', Object.assign(function (this: unknown, titulo: string, o: { tag?: string; body?: string }) { creadas.push({ titulo, tag: o.tag, body: o.body }); }, { permission: 'granted', requestPermission: async () => 'granted' }));
    render(App);
    await waitFor(() => expect(document.querySelector('[data-id="d1"]')).toBeTruthy());
    await waitFor(() => expect(document.querySelector('[data-notificaciones]')).toBeTruthy());
    const abiertas = Fuente.todas.filter((f) => !f.cerrada);
    expect(abiertas.map((f) => f.url)).toEqual(['/eventos']); // compartido: inventario + avisos, una conexión
    const f = abiertas[0]!;
    f.onopen?.(new Event('open'));
    const condicion = (tipo: string): void => f.oyentes.get('condicion')!(new MessageEvent('condicion', { data: JSON.stringify({ dispositivo_id: 'd1', condicion: tipo, estado: 'abierta' }) }));
    condicion('umbral');
    condicion('bateria');
    await waitFor(() => expect(document.querySelector('[data-notificaciones]')!.textContent).toContain('Invernadero: Umbral, Batería (× 2)'), { timeout: 3000 });
    expect(document.querySelectorAll('[data-notificaciones] [data-aviso]')).toHaveLength(1);
    expect(document.querySelector('[data-notificaciones]')!.getAttribute('aria-live')).toBe('polite');
    // Cuerpo genérico (decidido el 11/11/2026): ni el dispositivo ni el tipo salen de la página; el sitio, cuando ya se sabe.
    expect(creadas).toEqual([{ titulo: 'Condiciones nuevas', tag: 'condiciones-sitios', body: '1 condición nueva en tus sitios' }]); // «bateria» no lo eligió
    await waitFor(() => expect(pedidos.some((p) => p.ruta.startsWith('/condiciones?'))).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    condicion('umbral');
    expect(creadas.at(-1)).toEqual({ titulo: 'Condiciones nuevas', tag: 'condiciones-Campus', body: '1 condición nueva en Campus' });
    expect(JSON.stringify(creadas)).not.toMatch(/Invernadero|Umbral/);
  });

  it('en teléfono (≤ 700 px) se ven 2 avisos y el resto queda plegado en «y N más» (WCAG 2.4.11: no tapan el foco); en escritorio, hasta 5', async () => {
    for (const [angosto, visibles, plegado] of [[true, 2, 'y 1 más'], [false, 3, null]] as const) {
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: angosto && q.includes('700px'), media: q, addEventListener() {}, removeEventListener() {} }));
      Fuente.todas.length = 0;
      render(Notificaciones, { notificar: [] });
      const f = Fuente.todas.at(-1)!;
      f.onopen?.(new Event('open'));
      for (const d of ['d1', 'd2', 'd3']) f.oyentes.get('condicion')!(new MessageEvent('condicion', { data: JSON.stringify({ dispositivo_id: d, condicion: 'umbral', estado: 'abierta' }) }));
      await waitFor(() => expect(document.querySelectorAll('[data-notificaciones] > .aviso-caja, [data-notificaciones] > [data-aviso]').length).toBe(visibles));
      const det = document.querySelector('[data-avisos-plegados]');
      expect(det === null ? null : det.querySelector('summary')!.textContent).toBe(plegado);
      if (det !== null) expect(det.hasAttribute('open')).toBe(false); // plegado hasta que la persona lo abra
      cleanup();
    }
  });
});
