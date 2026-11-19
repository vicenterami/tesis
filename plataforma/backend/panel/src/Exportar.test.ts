// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REINTENTO_ESTIMACION_MS, SIN_DATOS, TEXTO_CANCELADA, TEXTO_CORTADA, TEXTO_EN_CURSO, TEXTO_ESTIMAR_EN_CURSO, TEXTO_ESTIMAR_LENTA, TEXTO_NO_EMPEZO } from './lib/exportar';
import type { Sitio } from './lib/modelo';
import type { Sesion } from './lib/sesion';
import Exportar from './Exportar.svelte';

// P8, «Exportar datos» de un sitio (docs/19 §4, R, punto 6), por el DOM: el rango (con «Entre fechas» en la zona del sitio), la estimación
// que se pide tras una pausa al cambiar el sitio o el rango (una a la vez; la anterior se cancela y una respuesta vieja se descarta; ante el
// cupo lleno, un solo reintento), la confirmación sobre 250 MB, la descarga con `descargar()` y su nombre, «Cancelar», el 429 del cupo (por
// su código), el 503 y los errores de red. Los temporizadores son los reales: las pausas de la pantalla se miden, no se simulan.
const AHORA = new Date('2026-11-19T15:00:00Z'); // 12:00 del 19/11 en Santiago (UTC−03:00); 10:00 en Isla de Pascua (UTC−05:00)
const UCT: Sitio = { id: 's1', codigo: 'uct', nombre: 'Campus', zona_horaria: 'America/Santiago', rol: 'administrador', zonas: [] };
const ISLA: Sitio = { id: 's2', codigo: 'isla', nombre: 'Isla de Pascua', zona_horaria: 'Pacific/Easter', rol: 'investigador', zonas: [] };
const MATRIZ = { administrador: ['leer', 'exportar', 'ajustes'], investigador: ['leer', 'exportar'], consulta: ['leer'] };
const persona = (sitios: Sitio[], rol = 'administrador'): Sesion => ({
  sistema: false, usuario: { id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid' }, clave_temporal: false, expira_en: null, inactividad_vence_en: null,
  sitios: sitios.map((s) => ({ sitio_id: s.id, codigo: s.codigo, nombre: s.nombre, rol: rol as 'administrador' })), permisos: MATRIZ,
});

let pedidas: { ruta: string; senal: AbortSignal | null; en: number }[] = [];
let bytes = { csv: 1_234_567, xlsx: 2_000_000, json: 12_500_000 };
let ignorarCancelacion = false; // una respuesta que ya venía en camino cuando se canceló: llega igual (la pantalla debe descartarla)
let retener: (ruta: string) => Promise<void> | null = () => null;
let descarga: (ruta: string) => Response = (ruta) => archivo(ruta);
let estimar: (ruta: string) => Response = (ruta) => json(estimacion(ruta));
const ESTIMACION = '/exportar/estimacion?';
// El 429 del cupo del servidor: se reconoce por `codigo`; el texto es cualquiera a propósito (puede cambiar).
const CUPO = { statusCode: 429, error: 'Too Many Requests', codigo: 'exportaciones_en_curso', message: 'mensaje que el servidor puede cambiar' };

const json = (x: unknown, status = 200): Response => new Response(JSON.stringify(x), { status });
// El conteo depende del sitio y del ancho del rango: así se sabe de qué petición salió lo que se ve.
function estimacion(ruta: string): Record<string, unknown> {
  const q = new URLSearchParams(ruta.slice(ruta.indexOf('?') + 1));
  const horas = (Date.parse(q.get('hasta')!) - Date.parse(q.get('desde')!)) / 3_600_000;
  const filas = ruta.startsWith('/sitios/s2/') ? 7 : ({ 24: 1_440, 168: 10_080, 720: 45_210 } as Record<number, number>)[horas] ?? 500;
  return {
    desde: q.get('desde'), hasta: q.get('hasta'), tope_conteo: 1_000_000, mediciones: { filas, supera_tope: false },
    tramas: { filas: 9_044, supera_tope: false, desde: '2026-10-20T15:00:01.000Z' }, eventos: { filas: 37, supera_tope: false }, retencion_tramas_dias: 30,
    bytes_aproximados: bytes,
  };
}
// Lo que manda el servidor al exportar: el archivo con su nombre (el zip y el xlsx empiezan con «PK\x03\x04»).
function archivo(ruta: string): Response {
  const f = new URLSearchParams(ruta.slice(ruta.indexOf('?') + 1)).get('formato')!;
  const ext = f === 'csv' ? 'zip' : f;
  const cuerpo = f === 'json' ? new TextEncoder().encode('{"formato":"exportacion-sitio/1"}') : new Uint8Array([0x50, 0x4b, 3, 4, ...new Array(2_996).fill(0)]);
  return new Response(cuerpo, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="sitio_uct_2026-10-20_2026-11-19.${ext}"` } });
}

let guardados: string[] = [];
beforeEach(() => {
  pedidas = [];
  guardados = [];
  bytes = { csv: 1_234_567, xlsx: 2_000_000, json: 12_500_000 };
  ignorarCancelacion = false;
  retener = () => null;
  descarga = archivo;
  estimar = (ruta) => json(estimacion(ruta));
  vi.useFakeTimers({ now: AHORA, toFake: ['Date'] });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:prueba'), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { guardados.push(this.download); });
  vi.stubGlobal('fetch', vi.fn(async (ruta: string, init: RequestInit = {}) => {
    // Como fetch: una petición cancelada antes de responder rechaza con AbortError (salvo que la prueba simule una que ya venía).
    await Promise.resolve();
    if (!ignorarCancelacion && init.signal?.aborted) throw new DOMException('cancelada', 'AbortError');
    pedidas.push({ ruta, senal: init.signal ?? null, en: performance.now() });
    await retener(ruta);
    if (!ignorarCancelacion && init.signal?.aborted) throw new DOMException('cancelada', 'AbortError');
    if (ruta.includes(ESTIMACION)) return estimar(ruta);
    if (/^\/sitios\/s[12]\/exportar\?/.test(ruta)) return descarga(ruta);
    return json({ statusCode: 404 }, 404);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

const $ = <T extends Element = HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
const texto = (sel: string): string => (document.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const estimaciones = (): string[] => pedidas.filter((p) => p.ruta.includes(ESTIMACION)).map((p) => p.ruta);
const descargas = (): string[] => pedidas.filter((p) => /\/exportar\?formato=/.test(p.ruta)).map((p) => p.ruta);
const soltable = (): { promesa: Promise<void>; soltar: () => void } => { let soltar = (): void => undefined; const promesa = new Promise<void>((ok) => (soltar = ok)); return { promesa, soltar }; };
const montar = (sitios: Sitio[] = [UCT], sitio = 'uct', alCambiarVista: (f: string) => void = () => undefined) =>
  render(Exportar, { sitio, sesion: persona(sitios), sitios, alCambiarVista });
const listo = (): Promise<void> => waitFor(() => expect(document.querySelector('[data-estimacion-texto]')).toBeTruthy());
const elegir = (sel: string): Promise<boolean> => fireEvent.click($(sel));
const descargar = async (): Promise<void> => {
  await waitFor(() => expect($<HTMLButtonElement>('[data-descargar-exportar]').disabled).toBe(false));
  $<HTMLButtonElement>('[data-descargar-exportar]').click();
};
const q = (desde: string, hasta: string): string => new URLSearchParams({ desde, hasta }).toString();

describe('P8, el rango y la estimación', () => {
  it('al abrir pide los últimos 30 días y muestra lo que trae, el tamaño del formato elegido y la retención; cada control con su etiqueta', async () => {
    montar();
    await listo();
    expect(estimaciones()).toEqual([`/sitios/s1/exportar/estimacion?${q('2026-10-20T15:00:00.000Z', '2026-11-19T15:00:00.000Z')}`]);
    expect(texto('[data-estimacion-texto]')).toBe('≈ 45.210 mediciones, 9.044 tramas y 37 eventos; unos 1,2 MB en CSV.');
    expect(texto('[data-retencion]')).toBe('Las tramas originales se guardan 30 días: este rango las trae todas.');
    expect($<HTMLInputElement>('[data-rango-exportar="30d"]').checked).toBe(true);
    expect([...document.querySelectorAll('[data-rango-exportar]')].map((r) => (r.closest('label')?.textContent ?? '').trim()))
      .toEqual(['Últimas 24 horas', 'Últimos 7 días', 'Últimos 30 días', 'Todo el historial (desde el año 2000)', 'Entre fechas']);
    // Cada formato con su para qué, enlazado al control.
    const xlsx = $<HTMLInputElement>('[data-formato-exportar="xlsx"]');
    expect(document.getElementById(xlsx.getAttribute('aria-describedby')!)?.textContent).toBe('Para Excel o LibreOffice: una hoja por tipo de dato.');
    expect(texto('[data-sitio-exportar-nombre]')).toBe('Sitio: Campus'); // un solo sitio: su nombre, sin selector
    expect(document.querySelector('[data-sitio-exportar]')).toBeNull();
    // Otro formato no pide otra estimación (trae los tres tamaños): cambia el tamaño.
    await elegir('[data-formato-exportar="json"]');
    await waitFor(() => expect(texto('[data-estimacion-texto]')).toBe('≈ 45.210 mediciones, 9.044 tramas y 37 eventos; unos 12,5 MB en JSON.'));
    expect(estimaciones()).toHaveLength(1);
  });

  it('cada rango pide su estimación con su ventana; «Todo el historial» desde el 1/1/2000', async () => {
    montar();
    await listo();
    await elegir('[data-rango-exportar="24h"]');
    await waitFor(() => expect(texto('[data-estimacion-texto]')).toContain('1.440 mediciones'));
    await elegir('[data-rango-exportar="7d"]');
    await waitFor(() => expect(texto('[data-estimacion-texto]')).toContain('10.080 mediciones'));
    await elegir('[data-rango-exportar="todo"]');
    await waitFor(() => expect(estimaciones()).toHaveLength(4));
    expect(estimaciones().slice(1)).toEqual([
      `/sitios/s1/exportar/estimacion?${q('2026-11-18T15:00:00.000Z', '2026-11-19T15:00:00.000Z')}`,
      `/sitios/s1/exportar/estimacion?${q('2026-11-12T15:00:00.000Z', '2026-11-19T15:00:00.000Z')}`,
      `/sitios/s1/exportar/estimacion?${q('2000-01-01T00:00:00.000Z', '2026-11-19T15:00:00.000Z')}`,
    ]);
  });

  it('una estimación a la vez: cambiar el rango cancela la que estaba en vuelo, y lo que se ve es la del rango nuevo', async () => {
    const primera = soltable();
    retener = (ruta) => (ruta.includes(ESTIMACION) && estimaciones().length === 1 ? primera.promesa : null);
    montar();
    await waitFor(() => expect(estimaciones()).toHaveLength(1));
    expect(texto('[data-estimacion-cargando]')).toBe('Contando lo que trae este rango…');
    await elegir('[data-rango-exportar="24h"]');
    await waitFor(() => expect(estimaciones()).toHaveLength(2));
    expect(pedidas[0]!.senal!.aborted).toBe(true); // la de 30 días se canceló al pedir la de 24 horas
    expect(pedidas[1]!.senal!.aborted).toBe(false);
    await waitFor(() => expect(texto('[data-estimacion-texto]')).toContain('1.440 mediciones'));
    primera.soltar();
    await new Promise((ok) => setTimeout(ok, 20));
    expect(texto('[data-estimacion-texto]')).toContain('1.440 mediciones');
    expect(document.querySelector('[data-aviso]')).toBeNull(); // una cancelación nunca se muestra como error
  });

  it('una respuesta de un rango anterior que llega tarde (ya venía en camino) se descarta', async () => {
    ignorarCancelacion = true;
    const vieja = soltable();
    retener = (ruta) => (ruta.includes(ESTIMACION) && estimaciones().length === 1 ? vieja.promesa : null);
    montar();
    await waitFor(() => expect(estimaciones()).toHaveLength(1));
    await elegir('[data-rango-exportar="7d"]');
    await waitFor(() => expect(texto('[data-estimacion-texto]')).toContain('10.080 mediciones'));
    vieja.soltar(); // la de 30 días llega después de la de 7 días
    await new Promise((ok) => setTimeout(ok, 20));
    expect(texto('[data-estimacion-texto]')).toContain('10.080 mediciones');
  });

  it('una respuesta de un sitio anterior se descarta: al cambiar de sitio se ve la del sitio nuevo', async () => {
    ignorarCancelacion = true;
    const vieja = soltable();
    retener = (ruta) => (ruta.startsWith('/sitios/s1/') ? vieja.promesa : null);
    const vistas: string[] = [];
    const r = montar([UCT, ISLA], 'uct', (f) => vistas.push(f));
    await waitFor(() => expect(estimaciones()).toHaveLength(1));
    // Con más de un sitio, el selector; elegir otro escribe la ruta (App la lee y cambia el sitio).
    const selector = $<HTMLSelectElement>('[data-sitio-exportar]');
    expect([...selector.options].map((o) => o.textContent)).toEqual(['Campus', 'Isla de Pascua']);
    await fireEvent.change(selector, { target: { value: 'isla' } });
    expect(vistas).toEqual(['#/exportar?sitio=isla']);
    await r.rerender({ sitio: 'isla', sesion: persona([UCT, ISLA]), sitios: [UCT, ISLA], alCambiarVista: () => undefined });
    await waitFor(() => expect(texto('[data-estimacion-texto]')).toContain('7 mediciones'));
    vieja.soltar();
    await new Promise((ok) => setTimeout(ok, 20));
    expect(texto('[data-estimacion-texto]')).toContain('7 mediciones');
  });

  it('«Entre fechas»: abre con la última semana y pide días completos en la hora del SITIO; días que no sirven se dicen junto a los campos y no se pide nada', async () => {
    montar([ISLA], 'isla'); // Isla de Pascua: UTC−05:00 en noviembre (el navegador de la prueba está en otra zona)
    await listo();
    await elegir('[data-rango-exportar="fechas"]');
    expect($<HTMLInputElement>('[data-dia-desde]').value).toBe('2026-11-13');
    expect($<HTMLInputElement>('[data-dia-hasta]').value).toBe('2026-11-19');
    expect($<HTMLInputElement>('[data-dia-hasta]').max).toBe('2026-11-19');
    expect(document.querySelector('[data-entre-fechas] label [data-dia-desde]')).toBeTruthy(); // con su etiqueta
    await waitFor(() => expect(estimaciones()).toHaveLength(2));
    expect(estimaciones()[1]).toBe(`/sitios/s2/exportar/estimacion?${q('2026-11-13T05:00:00.000Z', '2026-11-20T05:00:00.000Z')}`);
    expect(texto('[data-entre-fechas] + .vivo')).toBe('Días completos, de 00:00 a 24:00 en la hora del sitio (UTC−05:00).');
    // Al revés: el motivo junto a los campos, ninguna petición y «Descargar» desactivado con su motivo.
    await fireEvent.input($('[data-dia-desde]'), { target: { value: '2026-11-18' } });
    await fireEvent.input($('[data-dia-hasta]'), { target: { value: '2026-11-17' } });
    await waitFor(() => expect(texto('[data-error-dias]')).toBe('El último día no puede ser anterior al primero.'));
    expect($('[data-dia-hasta]').getAttribute('aria-invalid')).toBe('true');
    await new Promise((ok) => setTimeout(ok, 450));
    expect(estimaciones()).toHaveLength(2); // ni la del 18 al 19 (duró menos que la pausa) ni la de días al revés
    expect($<HTMLButtonElement>('[data-descargar-exportar]').disabled).toBe(true);
    expect(texto('[data-motivo-desactivado]')).toBe('elige un rango válido');
    await fireEvent.input($('[data-dia-hasta]'), { target: { value: '2026-11-18' } });
    await waitFor(() => expect(estimaciones()).toHaveLength(3));
    expect(estimaciones()[2]).toBe(`/sitios/s2/exportar/estimacion?${q('2026-11-18T05:00:00.000Z', '2026-11-19T05:00:00.000Z')}`);
    expect(texto('[data-error-dias]')).toBe('');
  });

  it('sin filas en el rango lo dice y qué hacer; la estimación con 503 lo dice en llano, sin reintentar sola, y «Descargar» espera hasta tenerla', async () => {
    let falla = true;
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (ruta, init) =>
      String(ruta).includes(ESTIMACION) && falla ? json({ statusCode: 503, message: 'la estimación tardó más de 10 s: prueba con un rango más corto o en un momento' }, 503) : base(ruta, init));
    montar();
    await waitFor(() => expect(document.querySelector('[data-estimacion] [data-aviso]')).toBeTruthy());
    expect(texto('[data-estimacion] [data-aviso] .aviso-texto')).toBe(TEXTO_ESTIMAR_LENTA);
    await new Promise((ok) => setTimeout(ok, REINTENTO_ESTIMACION_MS + 300));
    expect(vi.mocked(fetch).mock.calls.filter(([r]) => String(r).includes(ESTIMACION))).toHaveLength(1); // un 503 no se reintenta solo
    expect($<HTMLButtonElement>('[data-descargar-exportar]').disabled).toBe(true);
    expect(texto('[data-motivo-desactivado]')).toBe('no se pudo calcular el tamaño: reinténtalo arriba');
    falla = false;
    bytes = { csv: 1_776, xlsx: 4_337, json: 284 };
    vi.mocked(fetch).mockImplementation(async (ruta, init) =>
      String(ruta).includes(ESTIMACION) ? json({ ...estimacion(String(ruta)), mediciones: { filas: 0, supera_tope: false }, tramas: { filas: 0, supera_tope: false, desde: null }, eventos: { filas: 0, supera_tope: false } }) : base(ruta, init));
    await fireEvent.click($('[data-estimacion] [data-aviso-accion]'));
    await waitFor(() => expect(texto('[data-estimacion-texto]')).toBe(SIN_DATOS));
    expect(texto('[data-retencion]')).toBe('Las tramas originales se guardan 30 días: este rango no trae ninguna.');
    expect($<HTMLButtonElement>('[data-descargar-exportar]').disabled).toBe(false); // un archivo vacío también se puede bajar
  }, 10_000);
});

describe('P8, la pausa y el reintento de la estimación', () => {
  it('escribir una fecha no pide una estimación por tecla: se pide una sola, con lo último escrito, tras la pausa', async () => {
    montar();
    await listo();
    await elegir('[data-rango-exportar="fechas"]');
    // Al elegir «Entre fechas» y escribir enseguida, cada cambio cancela la pausa anterior.
    for (const v of ['2026-11-01', '2026-11-10', '2026-11-11']) await fireEvent.input($('[data-dia-desde]'), { target: { value: v } });
    expect(estimaciones()).toHaveLength(1); // aún dentro de la pausa: nada
    expect(texto('[data-estimacion-cargando]')).toBe('Contando lo que trae este rango…');
    await waitFor(() => expect(estimaciones()).toHaveLength(2));
    await new Promise((ok) => setTimeout(ok, 450));
    expect(estimaciones()).toHaveLength(2);
    expect(estimaciones()[1]).toBe(`/sitios/s1/exportar/estimacion?${q('2026-11-11T03:00:00.000Z', '2026-11-20T03:00:00.000Z')}`);
    await waitFor(() => expect(texto('[data-estimacion-texto]')).toContain('500 mediciones'));
  });

  it('cupo lleno al estimar: un solo reintento solo, a los 1,5 s; si responde, la estimación y ningún aviso', async () => {
    let n = 0;
    estimar = (ruta) => (++n === 1 ? json(CUPO, 429) : json(estimacion(ruta)));
    montar();
    await waitFor(() => expect(texto('[data-estimacion-texto]')).toContain('45.210 mediciones'), { timeout: 4000 });
    const [a, b] = pedidas.filter((p) => p.ruta.includes(ESTIMACION));
    expect(estimaciones()).toHaveLength(2);
    expect(b!.en - a!.en).toBeGreaterThanOrEqual(REINTENTO_ESTIMACION_MS - 50);
    expect(document.querySelector('[data-estimacion] [data-aviso]')).toBeNull();
    expect($<HTMLButtonElement>('[data-descargar-exportar]').disabled).toBe(false);
  }, 10_000);

  it('cupo lleno otra vez: el aviso en llano con «Reintentar», sin un tercer intento solo; «Descargar» espera y «Reintentar» lo destraba', async () => {
    let lleno = true;
    estimar = (ruta) => (lleno ? json(CUPO, 429) : json(estimacion(ruta)));
    montar();
    await waitFor(() => expect(texto('[data-estimacion] [data-aviso] .aviso-texto')).toBe(TEXTO_ESTIMAR_EN_CURSO), { timeout: 4000 });
    expect(estimaciones()).toHaveLength(2);
    expect($<HTMLButtonElement>('[data-descargar-exportar]').disabled).toBe(true);
    expect(texto('[data-motivo-desactivado]')).toBe('no se pudo calcular el tamaño: reinténtalo arriba');
    await new Promise((ok) => setTimeout(ok, REINTENTO_ESTIMACION_MS + 300));
    expect(estimaciones()).toHaveLength(2); // nada más, solo
    lleno = false;
    await fireEvent.click($('[data-estimacion] [data-aviso-accion]'));
    await waitFor(() => expect(texto('[data-estimacion-texto]')).toContain('45.210 mediciones'));
    expect(estimaciones()).toHaveLength(3);
    expect($<HTMLButtonElement>('[data-descargar-exportar]').disabled).toBe(false);
    expect(document.querySelector('[data-motivo-desactivado]')).toBeNull();
  }, 10_000);

  it('cambiar el rango durante la espera del reintento la anula: no llega un reintento del rango anterior', async () => {
    estimar = (ruta) => (ruta.includes(q('2026-10-20T15:00:00.000Z', '2026-11-19T15:00:00.000Z')) ? json(CUPO, 429) : json(estimacion(ruta)));
    montar();
    await waitFor(() => expect(estimaciones()).toHaveLength(1));
    await new Promise((ok) => setTimeout(ok, 50)); // el 429 llegó y el reintento quedó en espera
    await elegir('[data-rango-exportar="24h"]');
    await waitFor(() => expect(texto('[data-estimacion-texto]')).toContain('1.440 mediciones'));
    await new Promise((ok) => setTimeout(ok, REINTENTO_ESTIMACION_MS + 300));
    expect(estimaciones()).toHaveLength(2); // la de 30 días no se reintentó
    expect(texto('[data-estimacion-texto]')).toContain('1.440 mediciones');
  }, 10_000);
});

describe('P8, la descarga', () => {
  it('«Descargar» pide el formato y el rango elegidos con `descargar()` y guarda el archivo con el nombre del servidor; el aviso dice nombre y tamaño', async () => {
    montar();
    await listo();
    await elegir('[data-formato-exportar="xlsx"]');
    await descargar();
    await waitFor(() => expect(guardados).toEqual(['sitio_uct_2026-10-20_2026-11-19.xlsx']));
    expect(descargas()).toEqual([`/sitios/s1/exportar?formato=xlsx&${q('2026-10-20T15:00:00.000Z', '2026-11-19T15:00:00.000Z')}`]);
    const [, init] = (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][]).find(([r]) => r.includes('/exportar?formato='))!;
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>).accept).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await waitFor(() => expect(texto('[data-aviso="exito"] .aviso-texto')).toContain('Descargado sitio_uct_2026-10-20_2026-11-19.xlsx (3 kB).'));
    expect(document.querySelectorAll('a[href^="blob:"]')).toHaveLength(0); // el enlace vive en memoria, nunca en la página
    // Los tres formatos, cada uno con su extensión.
    await elegir('[data-formato-exportar="csv"]');
    await descargar();
    await waitFor(() => expect(guardados).toHaveLength(2));
    await elegir('[data-formato-exportar="json"]');
    await descargar();
    await waitFor(() => expect(guardados).toEqual(['sitio_uct_2026-10-20_2026-11-19.xlsx', 'sitio_uct_2026-10-20_2026-11-19.zip', 'sitio_uct_2026-10-20_2026-11-19.json']));
    // El aviso habla de lo bajado: otro rango lo quita.
    await waitFor(() => expect(document.querySelector('[data-aviso="exito"]')).toBeTruthy());
    await elegir('[data-rango-exportar="24h"]');
    await waitFor(() => expect(document.querySelector('[data-aviso="exito"]')).toBeNull());
  });

  it('sobre 250 MB estimados pide confirmar: sin confirmar no se pide nada, «Cancelar» la cierra y «Descargar igual» descarga', async () => {
    bytes = { csv: 13_700_000, xlsx: 24_000_000, json: 300_000_000 };
    montar();
    await listo();
    await descargar(); // el CSV pesa 13,7 MB: sin pregunta
    await waitFor(() => expect(guardados).toHaveLength(1));
    expect(document.querySelector('[data-confirmar-exportar]')).toBeNull();
    await waitFor(() => expect(document.querySelector('[data-aviso="exito"]')).toBeTruthy());
    await elegir('[data-formato-exportar="json"]');
    expect(document.querySelector('[data-aviso="exito"]')).toBeTruthy(); // otro formato, el mismo rango: el aviso sigue
    await descargar();
    await waitFor(() => expect(document.querySelector('[data-confirmar-exportar]')).toBeTruthy());
    expect(texto('[data-confirmar-exportar] p')).toBe('El archivo pesaría unos 300 MB. Tu navegador arma el archivo en memoria: con un rango menor es más seguro. ¿Descargar igual?');
    expect($('[data-confirmar-exportar]').getAttribute('role')).toBe('alert');
    expect(descargas()).toHaveLength(1); // sin confirmar, ninguna petición
    await fireEvent.click($('[data-no-descargar]'));
    expect(document.querySelector('[data-confirmar-exportar]')).toBeNull();
    expect(descargas()).toHaveLength(1);
    // Cambiar el rango con la pregunta abierta la cierra (el tamaño ya es otro).
    await descargar();
    await waitFor(() => expect(document.querySelector('[data-confirmar-exportar]')).toBeTruthy());
    await elegir('[data-rango-exportar="7d"]');
    await waitFor(() => expect(document.querySelector('[data-confirmar-exportar]')).toBeNull());
    await descargar();
    await waitFor(() => expect(document.querySelector('[data-confirmar-exportar]')).toBeTruthy());
    await fireEvent.click($('[data-descargar-igual]'));
    await waitFor(() => expect(guardados).toEqual(['sitio_uct_2026-10-20_2026-11-19.zip', 'sitio_uct_2026-10-20_2026-11-19.json']));
    expect(descargas()[1]).toBe(`/sitios/s1/exportar?formato=json&${q('2026-11-12T15:00:00.000Z', '2026-11-19T15:00:00.000Z')}`);
  });

  it('«Cancelar» mientras baja corta la descarga: no se guarda nada, se dice, y los controles vuelven', async () => {
    const lenta = soltable();
    retener = (ruta) => (/\/exportar\?formato=/.test(ruta) ? lenta.promesa : null);
    montar();
    await listo();
    await descargar();
    await waitFor(() => expect(document.querySelector('[data-cancelar-exportar]')).toBeTruthy());
    expect(texto('[data-descargar-exportar]')).toBe('Descargando…');
    expect($<HTMLFieldSetElement>('[data-rangos-exportar]').disabled).toBe(true); // nada cambia a mitad de la descarga
    expect($<HTMLFieldSetElement>('[data-formatos-exportar]').disabled).toBe(true);
    await fireEvent.click($('[data-cancelar-exportar]'));
    expect(pedidas.find((p) => /\/exportar\?formato=/.test(p.ruta))!.senal!.aborted).toBe(true);
    lenta.soltar();
    await waitFor(() => expect(texto('[data-aviso="info"] .aviso-texto')).toBe(TEXTO_CANCELADA));
    expect(guardados).toEqual([]);
    expect(document.querySelector('[data-cancelar-exportar]')).toBeNull();
    expect($<HTMLFieldSetElement>('[data-rangos-exportar]').disabled).toBe(false);
  });

  it('el 429 del cupo se reconoce por su código (no por el texto); el 503, sin red y el corte a mitad, lo suyo; nunca se guarda un archivo a medias', async () => {
    descarga = () => json(CUPO, 429);
    montar();
    await listo();
    await descargar();
    await waitFor(() => expect(texto('[data-aviso="espera"] .aviso-texto')).toBe(TEXTO_EN_CURSO));
    // El texto de siempre sin el código (un 429 del límite de tasa) no es el cupo.
    descarga = () => json({ statusCode: 429, message: 'hay 2 exportaciones o estimaciones en curso; inténtalo en un momento' }, 429);
    await descargar();
    await waitFor(() => expect(texto('[data-aviso="espera"] .aviso-texto')).toBe('Demasiados intentos: espera un momento y reintenta.'));
    // 503: la exportación falló antes de enviar nada (la base no respondió).
    descarga = () => json({ statusCode: 503, error: 'Service Unavailable', message: 'la exportación falló antes de empezar a enviar el archivo; inténtalo en un momento' }, 503);
    await descargar();
    await waitFor(() => expect(texto('[data-aviso="espera"] .aviso-texto')).toBe(TEXTO_NO_EMPEZO));
    // Sin red: fetch no llega a responder.
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (ruta, init) => {
      if (/\/exportar\?formato=/.test(String(ruta))) throw new TypeError('Failed to fetch');
      return base(ruta, init);
    });
    await descargar();
    await waitFor(() => expect(texto('[data-aviso="error"] .aviso-texto')).toBe('Sin conexión con el servicio: revisa tu conexión y reintenta.'));
    // La conexión se corta a mitad del cuerpo (el servidor corta así un error en flujo): el Blob no se arma y no se guarda nada.
    vi.mocked(fetch).mockImplementation(async (ruta, init) => {
      if (!/\/exportar\?formato=/.test(String(ruta))) return base(ruta, init);
      const cortado = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([0x50, 0x4b, 3, 4])); c.error(new TypeError('terminated')); } });
      return new Response(cortado, { headers: { 'content-disposition': 'attachment; filename="sitio_uct_2026-10-20_2026-11-19.zip"' } });
    });
    await descargar();
    await waitFor(() => expect(texto('[data-aviso="error"] .aviso-texto')).toBe(TEXTO_CORTADA));
    expect(guardados).toEqual([]);
  });

  it('salir de la pantalla corta la estimación y la descarga en vuelo', async () => {
    const lenta = soltable();
    retener = (ruta) => (/\/exportar\?formato=/.test(ruta) ? lenta.promesa : null);
    const r = montar();
    await listo();
    await descargar();
    await waitFor(() => expect(document.querySelector('[data-cancelar-exportar]')).toBeTruthy());
    r.unmount();
    expect(pedidas.find((p) => /\/exportar\?formato=/.test(p.ruta))!.senal!.aborted).toBe(true);
    lenta.soltar();
    await new Promise((ok) => setTimeout(ok, 20));
    expect(guardados).toEqual([]);
  });
});

describe('P8, sin la acción', () => {
  it('quien no exporta en ningún sitio lee quién exporta (de la matriz) y el enlace al tablero; no se pide nada', async () => {
    render(Exportar, { sitio: 'uct', sesion: persona([UCT], 'consulta'), sitios: [UCT], alCambiarVista: () => undefined });
    expect(texto('[data-sin-exportar]')).toBe('Tu rol no exporta datos en ningún sitio: los exportan los perfiles de administrador e investigación. Si los necesitas, pídeselos a quien administra el tuyo. Volver al tablero');
    expect($<HTMLAnchorElement>('[data-sin-exportar] a').getAttribute('href')).toBe('#/');
    expect(document.querySelector('[data-formulario-exportar]')).toBeNull();
    await new Promise((ok) => setTimeout(ok, 20));
    expect(pedidas).toEqual([]);
  });
});
