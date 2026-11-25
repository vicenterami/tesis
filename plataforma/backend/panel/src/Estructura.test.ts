// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sitio } from './lib/modelo';
import { MAX_DESCRIPCION_SITIO, codigoSugerido, motivoDescripcionSitio, motivoNombreZona, motivoSitio, textoDispositivos, zonaInicial, zonasHorarias } from './lib/estructura';
import AjusteZonas from './AjusteZonas.svelte';
import Sitios from './Sitios.svelte';

// Sitios y zonas desde el panel (docs/19 §4 U): P15 «Zonas» y P17 «Sitios», por el DOM, y las reglas puras de lib/estructura.ts.
const SITIO: Sitio = {
  id: 's1', codigo: 'uct', nombre: 'Campus', zona_horaria: 'America/Santiago', rol: 'administrador',
  zonas: [{ id: 'z1', nombre: 'Laboratorio', activo: true, dispositivos: 2 }, { id: 'z2', nombre: 'Patio', activo: true, dispositivos: 0 },
    { id: 'z3', nombre: 'Bodega', activo: false, dispositivos: 0 }],
};

let pedidas: { metodo: string; ruta: string; cuerpo: unknown }[] = [];
let respuesta: (metodo: string, ruta: string) => Response = () => new Response('{}', { status: 200 });
beforeEach(() => {
  pedidas = [];
  respuesta = (metodo) => new Response(JSON.stringify(metodo === 'POST' ? { id: 'nuevo', nombre: 'Norte', codigo: 'sede-norte' } : {}), { status: metodo === 'POST' ? 201 : 200 });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(async (ruta: string, init: RequestInit = {}) => {
    await Promise.resolve();
    const metodo = init.method ?? 'GET';
    pedidas.push({ metodo, ruta, cuerpo: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    return respuesta(metodo, ruta);
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('lib/estructura: las reglas que el panel adelanta', () => {
  it('el código sugerido: minúsculas, sin tildes, guiones, sin extremos', () => {
    expect(codigoSugerido('Sede Norte (anexo)')).toBe('sede-norte-anexo');
    expect(codigoSugerido('  Ñuble – Galpón  ')).toBe('nuble-galpon');
    expect(codigoSugerido('x'.repeat(80))).toHaveLength(63);
  });
  it('los motivos antes de enviar', () => {
    expect(motivoNombreZona('  ')).toBe('Escribe el nombre de la zona.');
    expect(motivoNombreZona('Norte')).toBeNull();
    expect(motivoSitio('Sede', 'F')).toMatch(/^El código va de 2 a 63/);
    expect(motivoSitio('Sede', 'sede')).toBeNull();
    expect(motivoDescripcionSitio('x'.repeat(MAX_DESCRIPCION_SITIO))).toBeNull();
    expect(motivoDescripcionSitio('x'.repeat(MAX_DESCRIPCION_SITIO + 1))).toBe('La descripción admite hasta 500 caracteres.');
    expect(textoDispositivos(1)).toBe('1 dispositivo activo');
  });
  it('la zona horaria inicial es la del navegador solo si está en la lista; si no, America/Santiago; la lista incluye UTC', () => {
    const navegador = (z: string): void => { vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: z } as Intl.ResolvedDateTimeFormatOptions); };
    navegador('America/Punta_Arenas');
    expect(zonaInicial(['America/Santiago', 'America/Punta_Arenas', 'UTC'])).toBe('America/Punta_Arenas');
    navegador('Etc/Desconocida');
    expect(zonaInicial(['America/Santiago', 'UTC'])).toBe('America/Santiago');
    expect(zonasHorarias()).toContain('UTC');
    vi.restoreAllMocks();
  });
});

describe('P15 «Zonas»', () => {
  it('lista las zonas con sus dispositivos; «Retirar» desactivado con motivo si tiene activos; la retirada se puede volver a ofrecer', () => {
    const r = render(AjusteZonas, { sitio: SITIO, alCambiar: vi.fn() });
    const fila = (n: string): HTMLElement => r.container.querySelector(`[data-zona="${n}"]`) as HTMLElement;
    expect(fila('Laboratorio').textContent).toContain('2 dispositivos activos');
    expect((fila('Laboratorio').querySelector('[data-retirar-zona]') as HTMLButtonElement).disabled).toBe(true);
    expect((fila('Patio').querySelector('[data-retirar-zona]') as HTMLButtonElement).disabled).toBe(false);
    expect(fila('Bodega').textContent).toContain('retirada');
    expect(fila('Bodega').querySelector('[data-reactivar-zona]')).not.toBeNull();
  });
  it('agregar envía el nombre recortado a POST /sitios/{id}/zonas y recarga los sitios; vacío no envía', async () => {
    const alCambiar = vi.fn();
    const r = render(AjusteZonas, { sitio: SITIO, alCambiar });
    await fireEvent.submit(r.container.querySelector('[data-agregar-zona]')!);
    expect(pedidas).toHaveLength(0);
    expect(r.container.textContent).toContain('Escribe el nombre de la zona.');
    await fireEvent.input(r.container.querySelector('[data-campo-zona-nueva]')!, { target: { value: '  Norte ' } });
    await fireEvent.submit(r.container.querySelector('[data-agregar-zona]')!);
    await waitFor(() => expect(alCambiar).toHaveBeenCalled());
    expect(pedidas[0]).toEqual({ metodo: 'POST', ruta: '/sitios/s1/zonas', cuerpo: { nombre: 'Norte' } });
  });
  it('lo escrito se borra solo si el envío salió bien: un error lo deja, y un segundo envío con el primero en vuelo no lo borra ni manda otra petición', async () => {
    const campo = (r: { container: HTMLElement }): HTMLInputElement => r.container.querySelector('[data-campo-zona-nueva]') as HTMLInputElement;
    respuesta = () => new Response(JSON.stringify({ statusCode: 409, message: 'ya hay una zona «Norte» en este sitio' }), { status: 409 });
    const r = render(AjusteZonas, { sitio: SITIO, alCambiar: vi.fn() });
    await fireEvent.input(campo(r), { target: { value: 'Norte' } });
    await fireEvent.submit(r.container.querySelector('[data-agregar-zona]')!);
    await waitFor(() => expect(r.container.textContent).toContain('Ya hay una zona'));
    expect(campo(r).value).toBe('Norte');
    cleanup();
    let soltar = (): void => undefined;
    const retenida = new Promise<void>((ok) => (soltar = ok));
    vi.stubGlobal('fetch', vi.fn(async (ruta: string, init: RequestInit = {}) => {
      pedidas.push({ metodo: init.method ?? 'GET', ruta, cuerpo: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
      await retenida;
      return new Response('{}', { status: 201 });
    }));
    const q = render(AjusteZonas, { sitio: SITIO, alCambiar: vi.fn() });
    pedidas = [];
    await fireEvent.input(campo(q), { target: { value: 'Norte' } });
    await fireEvent.submit(q.container.querySelector('[data-agregar-zona]')!);
    await fireEvent.submit(q.container.querySelector('[data-agregar-zona]')!);
    expect(pedidas).toHaveLength(1);
    expect(campo(q).value).toBe('Norte');
    soltar();
    await waitFor(() => expect(campo(q).value).toBe(''));
  });
  it('retirar manda activo:false a PATCH /zonas/{id}; un 409 del servidor se muestra', async () => {
    respuesta = () => new Response(JSON.stringify({ statusCode: 409, message: 'la zona tiene 1 dispositivo activo: muévelo de zona o dalo de baja antes de retirarla' }), { status: 409 });
    const r = render(AjusteZonas, { sitio: SITIO, alCambiar: vi.fn() });
    await fireEvent.click(r.container.querySelector('[data-zona="Patio"] [data-retirar-zona]')!);
    await waitFor(() => expect(r.container.textContent).toContain('dalo de baja antes de retirarla'));
    expect(pedidas[0]).toEqual({ metodo: 'PATCH', ruta: '/zonas/z2', cuerpo: { activo: false } });
  });
});

describe('P17 «Sitios»', () => {
  it('la tabla cuenta las zonas activas y los equipos; crear sugiere el código y envía la primera zona', async () => {
    const alCambiar = vi.fn();
    const r = render(Sitios, { sitios: [SITIO], alCambiar });
    const fila = r.container.querySelector('[data-sitio="uct"]')!;
    expect([...fila.querySelectorAll('td')].map((x) => x.textContent?.trim())).toEqual(['Campus', 'uct', 'America/Santiago', '2', '2', 'Editar']);
    await fireEvent.click(r.container.querySelector('[data-abrir-crear-sitio]')!);
    await fireEvent.input(r.container.querySelector('[data-campo-nombre-sitio]')!, { target: { value: 'Sede Norte' } });
    await waitFor(() => expect((r.container.querySelector('[data-campo-codigo-sitio]') as HTMLInputElement).value).toBe('sede-norte'));
    await fireEvent.input(r.container.querySelector('[data-campo-descripcion-sitio]')!, { target: { value: '  Edificio del anexo ' } });
    await fireEvent.submit(r.container.querySelector('[data-formulario-sitio]')!);
    await waitFor(() => expect(alCambiar).toHaveBeenCalled());
    expect(pedidas[0]).toMatchObject({ metodo: 'POST', ruta: '/sitios', cuerpo: { nombre: 'Sede Norte', codigo: 'sede-norte', primera_zona: 'General', descripcion: 'Edificio del anexo' } });
    expect(r.container.querySelector('[data-sitio-creado]')?.textContent).toContain('Agregar personas a este sitio');
  });
  it('un código inválido no se envía y dice la regla', async () => {
    const r = render(Sitios, { sitios: [], alCambiar: vi.fn() });
    await fireEvent.click(r.container.querySelector('[data-abrir-crear-sitio]')!);
    await fireEvent.input(r.container.querySelector('[data-campo-nombre-sitio]')!, { target: { value: 'Sede' } });
    await fireEvent.input(r.container.querySelector('[data-campo-codigo-sitio]')!, { target: { value: 'Sede Sur' } });
    await fireEvent.submit(r.container.querySelector('[data-formulario-sitio]')!);
    expect(pedidas).toHaveLength(0);
    expect(r.container.textContent).toContain('El código va de 2 a 63 caracteres');
  });
  it('sin descripción, el cuerpo de crear no lleva el campo; el formulario ofrece «Descripción (opcional)» con su tope', async () => {
    const r = render(Sitios, { sitios: [], alCambiar: vi.fn() });
    await fireEvent.click(r.container.querySelector('[data-abrir-crear-sitio]')!);
    expect((r.container.querySelector('[data-campo-descripcion-sitio]') as HTMLInputElement).maxLength).toBe(MAX_DESCRIPCION_SITIO);
    expect(r.container.textContent).toContain('Descripción (opcional)');
    await fireEvent.input(r.container.querySelector('[data-campo-nombre-sitio]')!, { target: { value: 'Sede Norte' } });
    await waitFor(() => expect((r.container.querySelector('[data-campo-codigo-sitio]') as HTMLInputElement).value).toBe('sede-norte'));
    await fireEvent.submit(r.container.querySelector('[data-formulario-sitio]')!);
    await waitFor(() => expect(pedidas).toHaveLength(1));
    expect(pedidas[0]!.cuerpo).not.toHaveProperty('descripcion');
  });
  it('la tabla muestra la descripción bajo el nombre; «Editar» abre nombre y descripción en la misma fila', async () => {
    const r = render(Sitios, { sitios: [{ ...SITIO, descripcion: 'Sede principal' }], alCambiar: vi.fn() });
    const fila = r.container.querySelector('[data-sitio="uct"]')!;
    expect(fila.querySelector('[data-descripcion-sitio]')?.textContent).toBe('Sede principal');
    await fireEvent.click(fila.querySelector('[data-editar-sitio]')!);
    expect((fila.querySelector('[data-campo-editar-nombre]') as HTMLInputElement).value).toBe('Campus');
    expect((fila.querySelector('[data-campo-editar-descripcion]') as HTMLInputElement).value).toBe('Sede principal');
    expect(fila.querySelector('[data-guardar-sitio]')).not.toBeNull();
  });
  it('«Guardar» envía PATCH /sitios/{id} solo con lo que cambió y recarga los sitios; vaciar la descripción manda null; sin cambios no envía', async () => {
    const alCambiar = vi.fn();
    const r = render(Sitios, { sitios: [{ ...SITIO, descripcion: 'Sede principal' }], alCambiar });
    const fila = (): Element => r.container.querySelector('[data-sitio="uct"]')!;
    await fireEvent.click(fila().querySelector('[data-editar-sitio]')!);
    await fireEvent.click(fila().querySelector('[data-guardar-sitio]')!);
    expect(pedidas).toHaveLength(0);
    expect(fila().querySelector('[data-campo-editar-nombre]')).toBeNull(); // sin cambios: se cierra
    await fireEvent.click(fila().querySelector('[data-editar-sitio]')!);
    await fireEvent.input(fila().querySelector('[data-campo-editar-nombre]')!, { target: { value: '  Campus Sur ' } });
    await fireEvent.click(fila().querySelector('[data-guardar-sitio]')!);
    await waitFor(() => expect(alCambiar).toHaveBeenCalledTimes(1));
    expect(pedidas[0]).toEqual({ metodo: 'PATCH', ruta: '/sitios/s1', cuerpo: { nombre: 'Campus Sur' } });
    await fireEvent.click(fila().querySelector('[data-editar-sitio]')!);
    await fireEvent.input(fila().querySelector('[data-campo-editar-descripcion]')!, { target: { value: '  ' } });
    await fireEvent.click(fila().querySelector('[data-guardar-sitio]')!);
    await waitFor(() => expect(alCambiar).toHaveBeenCalledTimes(2));
    expect(pedidas[1]).toEqual({ metodo: 'PATCH', ruta: '/sitios/s1', cuerpo: { descripcion: null } });
  });
  it('editar: un nombre vacío o una descripción de más de 500 caracteres no se envía y dice el motivo; un 409 del servidor se muestra en la fila', async () => {
    const r = render(Sitios, { sitios: [SITIO], alCambiar: vi.fn() });
    const fila = (): Element => r.container.querySelector('[data-sitio="uct"]')!;
    await fireEvent.click(fila().querySelector('[data-editar-sitio]')!);
    await fireEvent.input(fila().querySelector('[data-campo-editar-nombre]')!, { target: { value: ' ' } });
    await fireEvent.click(fila().querySelector('[data-guardar-sitio]')!);
    expect(pedidas).toHaveLength(0);
    expect(fila().querySelector('[data-error-editar-sitio]')?.textContent).toBe('Escribe el nombre del sitio.');
    await fireEvent.input(fila().querySelector('[data-campo-editar-nombre]')!, { target: { value: 'Campus Sur' } });
    await fireEvent.input(fila().querySelector('[data-campo-editar-descripcion]')!, { target: { value: 'x'.repeat(MAX_DESCRIPCION_SITIO + 1) } });
    await fireEvent.click(fila().querySelector('[data-guardar-sitio]')!);
    expect(pedidas).toHaveLength(0);
    expect(fila().querySelector('[data-error-editar-sitio]')?.textContent).toContain('hasta 500 caracteres');
    await fireEvent.input(fila().querySelector('[data-campo-editar-descripcion]')!, { target: { value: '' } });
    respuesta = () => new Response(JSON.stringify({ statusCode: 409, message: 'ya hay un sitio con ese nombre' }), { status: 409 });
    await fireEvent.click(fila().querySelector('[data-guardar-sitio]')!);
    await waitFor(() => expect(fila().querySelector('[data-error-editar-sitio]')?.textContent).toBe('Ya hay un sitio con ese nombre.'));
  });
});
