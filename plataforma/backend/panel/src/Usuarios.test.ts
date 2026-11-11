// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sesion } from './lib/sesion';
import { aplicarRespuesta, type UsuarioListado } from './lib/usuarios';
import Usuarios from './Usuarios.svelte';

// Pantalla de usuarios (P10; docs/20 §4 y §6) por el DOM: la guía de perfiles sale de la matriz; el alta muestra la clave temporal una
// vez; los cambios llevan el actualizado_en leído y el 409 pide recargar sin pisar nada.
const PERMISOS = { administrador: ['leer', 'exportar', 'escribir', 'usuarios'], consulta: ['leer'] };
const SESION: Sesion = {
  sistema: false, usuario: { id: 'u-yo', nombre: 'Ana', email: 'ana@ejemplo.invalid' }, clave_temporal: false, expira_en: null, inactividad_vence_en: null, permisos: PERMISOS,
  sitios: [{ sitio_id: 's-uct', codigo: 'uct', nombre: 'Campus', rol: 'administrador' }, { sitio_id: 's-mag', codigo: 'mag', nombre: 'Magallanes', rol: 'consulta' }],
};
const yo: UsuarioListado = { id: 'u-yo', nombre: 'Ana', email: 'ana@ejemplo.invalid', en_mis_sitios: true, activo: true, clave_temporal: false, clave_temporal_vence_en: null, sitios: [{ sitio_id: 's-uct', codigo: 'uct', rol: 'administrador' }], creado_en: 'x', actualizado_en: '2026-11-08T12:00:00.000001Z' };
const bea: UsuarioListado = { ...yo, id: 'u-bea', nombre: 'Bea', email: 'bea@ejemplo.invalid', sitios: [{ sitio_id: 's-uct', codigo: 'uct', rol: 'consulta' }], actualizado_en: '2026-11-08T12:30:00.123456Z' };
let lista: UsuarioListado[] = [];
let respuestaPatch: () => Response = () => new Response('{}');
const pedidos: { metodo: string; ruta: string; cuerpo: unknown; pedido: string | undefined }[] = [];

beforeEach(() => {
  lista = [yo, bea];
  pedidos.length = 0;
  respuestaPatch = () => new Response(JSON.stringify({ ...bea, activo: false, actualizado_en: '2026-11-08T13:00:00.000000Z' }));
  vi.stubGlobal('fetch', vi.fn(async (ruta: string, init: RequestInit = {}) => {
    const metodo = init.method ?? 'GET';
    pedidos.push({ metodo, ruta, cuerpo: typeof init.body === 'string' ? JSON.parse(init.body) : undefined, pedido: (init.headers as Record<string, string>)['X-Pedido'] });
    if (ruta === '/usuarios' && metodo === 'GET') return new Response(JSON.stringify(lista));
    if (ruta === '/sitios' && metodo === 'GET') return new Response(JSON.stringify([{ id: 's-uct', codigo: 'uct', nombre: 'Campus' }, { id: 's-mag', codigo: 'mag', nombre: 'Magallanes' }]));
    if (ruta === '/usuarios' && metodo === 'POST') {
      const c = JSON.parse(String(init.body));
      const inactiva = lista.find((u) => u.email === c.email && !u.activo);
      if (inactiva) return new Response(JSON.stringify({ statusCode: 409, reactivable: true, usuario: inactiva, message: 'existe una cuenta inactiva con ese email' }), { status: 409 });
      const nuevo = { ...bea, id: 'u-ceci', nombre: c.nombre, email: c.email, clave_temporal: true, clave_temporal_vence_en: '2026-11-09T12:00:00Z', sitios: [{ sitio_id: 's-uct', codigo: 'uct', rol: c.sitios[0].rol }] };
      lista = [...lista, nuevo];
      return new Response(JSON.stringify({ ...nuevo, clave: 'Tmp-una-sola-vez-123456' }), { status: 201 });
    }
    if (ruta.startsWith('/usuarios/') && metodo === 'PATCH') {
      // Las mismas reglas que el servidor (sesion/usuarios.dto.ts): la baja exige motivo (1–300) y reactivar, clave temporal nueva.
      const c = JSON.parse(String(init.body)) as { activo?: boolean; motivo?: string; clave_temporal?: boolean };
      const motivos: string[] = [];
      if (c.activo === false && (typeof c.motivo !== 'string' || c.motivo.trim().length < 1 || c.motivo.trim().length > 300)) motivos.push('motivo es obligatorio al desactivar (activo: false): por qué se da de baja');
      if (c.activo === true && c.clave_temporal !== true) motivos.push('activo: true (reactivar) exige clave_temporal: true en la misma petición: la clave anterior no vuelve');
      if (motivos.length > 0) return new Response(JSON.stringify({ statusCode: 400, message: motivos }), { status: 400 });
      return respuestaPatch();
    }
    return new Response('', { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const filaDe = (email: string): HTMLElement => document.querySelector<HTMLElement>(`[data-usuario="${email}"]`)!;

describe('Usuarios (P10)', () => {
  it('la guía de perfiles y el tooltip del rol salen de la matriz de la sesión; solo mis sitios de administrador se ofrecen', async () => {
    render(Usuarios, { sesion: SESION });
    await waitFor(() => expect(filaDe('bea@ejemplo.invalid')).toBeTruthy());
    expect(document.querySelector('[data-guia-rol="consulta"]')!.textContent).toBe('Consulta: ve dispositivos, históricos, condiciones y cuarentena de sus sitios; no exporta, no cambia nada ni administra personas.');
    const rol = document.querySelector<HTMLSelectElement>('[data-rol-alta]')!;
    expect(document.getElementById(rol.getAttribute('aria-describedby')!)!.textContent).toContain('Consulta: ve dispositivos');
    await fireEvent.change(rol, { target: { value: 'administrador' } });
    expect(document.getElementById(rol.getAttribute('aria-describedby')!)!.textContent).toContain('Administrador: ve dispositivos');
    // Magallanes es de consulta para mí: ni en el alta ni como columna de roles
    expect([...document.querySelectorAll<HTMLOptionElement>('[data-alta-usuario] select option')].map((o) => o.textContent)).toContain('Campus');
    expect(document.querySelector('[data-rol-sitio="mag"]')).toBeNull();
    expect(document.querySelector<HTMLSelectElement>(`[data-usuario="bea@ejemplo.invalid"] [data-rol-sitio="uct"]`)!.value).toBe('consulta');
  });

  it('alta: POST con X-Pedido y el cuerpo normalizado; la clave temporal se muestra una vez, con copiar, y al ocultarla ya no está', async () => {
    const escrito: string[] = [];
    vi.stubGlobal('navigator', { clipboard: { writeText: async (s: string) => { escrito.push(s); } } });
    render(Usuarios, { sesion: SESION });
    await waitFor(() => expect(filaDe('bea@ejemplo.invalid')).toBeTruthy());
    const crear = (): HTMLButtonElement => screen.getByRole('button', { name: 'Dar de alta' }) as HTMLButtonElement;
    expect(crear().disabled).toBe(true); // falta el nombre: el motivo se lee al lado
    expect(document.querySelector('[data-alta-usuario] [data-motivo-desactivado]')!.textContent).toContain('nombre');
    await fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: '  Ceci  ' } });
    await fireEvent.input(screen.getByLabelText('Correo'), { target: { value: ' Ceci@Ejemplo.INVALID ' } });
    await waitFor(() => expect(crear().disabled).toBe(false));
    await fireEvent.click(crear());
    await waitFor(() => expect(document.querySelector('[data-clave-temporal]')?.textContent).toBe('Tmp-una-sola-vez-123456'));
    expect(pedidos.find((p) => p.metodo === 'POST')).toMatchObject({ pedido: 'panel', cuerpo: { nombre: 'Ceci', email: 'ceci@ejemplo.invalid', sitios: [{ sitio_id: 's-uct', rol: 'consulta' }] } });
    expect(document.querySelector('[data-clave-una-vez]')!.textContent).toContain('No se vuelve a mostrar');
    await fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await waitFor(() => expect(escrito).toEqual(['Tmp-una-sola-vez-123456']));
    expect(screen.getByRole('button', { name: 'Copiada' })).toBeTruthy();
    await waitFor(() => expect(filaDe('ceci@ejemplo.invalid')).toBeTruthy()); // la lista se recargó
    await fireEvent.click(screen.getByRole('button', { name: 'Ya la entregué: ocultar' }));
    expect(document.body.textContent).not.toContain('Tmp-una-sola-vez-123456');
  });

  it('desactivar y cambiar el rol: PATCH con el actualizado_en leído, tal cual; nadie se desactiva a sí mismo', async () => {
    render(Usuarios, { sesion: SESION });
    await waitFor(() => expect(filaDe('bea@ejemplo.invalid')).toBeTruthy());
    const mia = filaDe('ana@ejemplo.invalid').querySelector<HTMLButtonElement>('[data-alternar-activo]')!;
    expect(mia.disabled).toBe(true);
    expect(filaDe('ana@ejemplo.invalid').textContent).toContain('no puedes desactivarte a ti mismo');
    await fireEvent.click(filaDe('bea@ejemplo.invalid').querySelector('[data-alternar-activo]')!);
    // La baja pide el motivo antes de enviar nada (el servidor lo exige): sin texto, el botón está desactivado y lo dice.
    expect(pedidos.filter((p) => p.metodo === 'PATCH')).toHaveLength(0);
    const motivo = filaDe('bea@ejemplo.invalid').querySelector<HTMLInputElement>('[data-motivo-baja]')!;
    expect(document.getElementById(motivo.getAttribute('aria-describedby')!)!.textContent).toContain('sin nombres ni datos personales');
    expect(filaDe('bea@ejemplo.invalid').querySelector<HTMLButtonElement>('[data-confirmar-baja]')!.disabled).toBe(true);
    await fireEvent.input(motivo, { target: { value: '  dejó el proyecto  ' } });
    await fireEvent.click(filaDe('bea@ejemplo.invalid').querySelector('[data-confirmar-baja]')!);
    await waitFor(() => expect(filaDe('bea@ejemplo.invalid').querySelector('[data-estado-usuario]')!.textContent).toContain('inactivo'));
    expect(pedidos.find((p) => p.metodo === 'PATCH')).toMatchObject({ ruta: '/usuarios/u-bea', pedido: 'panel', cuerpo: { actualizado_en: '2026-11-08T12:30:00.123456Z', activo: false, motivo: 'dejó el proyecto' } });
    expect(filaDe('bea@ejemplo.invalid').querySelector('[data-motivo-baja]')).toBeNull();
    expect(document.querySelector('[data-aviso="exito"]')!.textContent).toContain('Bea quedó inactivo');
    pedidos.length = 0;
    respuestaPatch = () => new Response(JSON.stringify({ ...bea, activo: false, sitios: [{ sitio_id: 's-uct', codigo: 'uct', rol: 'administrador' }], actualizado_en: '2026-11-08T13:05:00.000000Z' }));
    await fireEvent.change(filaDe('bea@ejemplo.invalid').querySelector('[data-rol-sitio="uct"]')!, { target: { value: 'administrador' } });
    await waitFor(() => expect(pedidos.find((p) => p.metodo === 'PATCH')).toMatchObject({ cuerpo: { actualizado_en: '2026-11-08T13:00:00.000000Z', sitios: [{ sitio_id: 's-uct', rol: 'administrador' }] } }));
  });

  it('409 (alguien lo cambió): el aviso pide recargar, el selector vuelve a lo leído y «Recargar» vuelve a pedir la lista', async () => {
    respuestaPatch = () => new Response(JSON.stringify({ statusCode: 409, message: 'el usuario cambió desde que se leyó: recarga' }), { status: 409 });
    render(Usuarios, { sesion: SESION });
    await waitFor(() => expect(filaDe('bea@ejemplo.invalid')).toBeTruthy());
    await fireEvent.change(filaDe('bea@ejemplo.invalid').querySelector('[data-rol-sitio="uct"]')!, { target: { value: '' } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Alguien lo cambió entretanto: recarga para ver el valor nuevo.'));
    expect(document.querySelector<HTMLSelectElement>(`[data-usuario="bea@ejemplo.invalid"] [data-rol-sitio="uct"]`)!.value).toBe('consulta');
    const antes = pedidos.filter((p) => p.metodo === 'GET').length;
    await fireEvent.click(screen.getByRole('button', { name: 'Recargar' }));
    await waitFor(() => expect(pedidos.filter((p) => p.metodo === 'GET').length).toBe(antes + 1));
  });

  it('asignar una clave temporal a otra persona: la muestra una vez; a quien está inactivo no se le asigna (motivo escrito)', async () => {
    respuestaPatch = () => new Response(JSON.stringify({ ...bea, clave_temporal: true, clave_temporal_vence_en: '2026-11-09T12:00:00Z', clave: 'Otra-temporal-987654321', actualizado_en: '2026-11-08T14:00:00.000000Z' }));
    lista = [yo, bea, { ...bea, id: 'u-dani', nombre: 'Dani', email: 'dani@ejemplo.invalid', activo: false }];
    render(Usuarios, { sesion: SESION });
    await waitFor(() => expect(filaDe('dani@ejemplo.invalid')).toBeTruthy());
    expect(filaDe('dani@ejemplo.invalid').querySelector<HTMLButtonElement>('[data-asignar-temporal]')!.disabled).toBe(true);
    expect(filaDe('dani@ejemplo.invalid').textContent).toContain('actívalo primero');
    await fireEvent.click(filaDe('bea@ejemplo.invalid').querySelector('[data-asignar-temporal]')!);
    await waitFor(() => expect(document.querySelector('[data-clave-temporal]')?.textContent).toBe('Otra-temporal-987654321'));
    expect(pedidos.find((p) => p.metodo === 'PATCH')).toMatchObject({ cuerpo: { actualizado_en: '2026-11-08T12:30:00.123456Z', clave_temporal: true } });
    // La hora del vencimiento, en formato de 24 h (docs/19 §6: nunca «p. m.»; lo mostró la primera captura con navegador)
    const estado = filaDe('bea@ejemplo.invalid').querySelector('[data-estado-usuario]')!.textContent!;
    expect(estado).toMatch(/vence el \S+ \d{2}:\d{2}/);
    expect(estado).not.toMatch(/[ap]\.\s?m\./);
  });

  it('el servidor simulado exige lo mismo que el real: una baja sin motivo y una reactivación sin clave temporal → 400', async () => {
    const r1 = await fetch('/usuarios/u-bea', { method: 'PATCH', headers: {}, body: JSON.stringify({ actualizado_en: 'x', activo: false }) });
    const r2 = await fetch('/usuarios/u-bea', { method: 'PATCH', headers: {}, body: JSON.stringify({ actualizado_en: 'x', activo: true }) });
    const r3 = await fetch('/usuarios/u-bea', { method: 'PATCH', headers: {}, body: JSON.stringify({ actualizado_en: 'x', activo: true, clave_temporal: true }) });
    expect([r1.status, r2.status, r3.status]).toEqual([400, 400, 200]);
  });

  it('reactivar desde la fila: PATCH con activo y una clave temporal nueva, que se muestra una vez', async () => {
    lista = [yo, { ...bea, activo: false }];
    respuestaPatch = () => new Response(JSON.stringify({ ...bea, activo: true, clave_temporal: true, clave: 'Nueva-al-volver-123456' }));
    render(Usuarios, { sesion: SESION });
    await waitFor(() => expect(filaDe('bea@ejemplo.invalid')).toBeTruthy());
    await fireEvent.click(filaDe('bea@ejemplo.invalid').querySelector('[data-alternar-activo]')!);
    await waitFor(() => expect(document.querySelector('[data-clave-temporal]')?.textContent).toBe('Nueva-al-volver-123456'));
    expect(pedidos.find((p) => p.metodo === 'PATCH')).toMatchObject({ cuerpo: { actualizado_en: '2026-11-08T12:30:00.123456Z', activo: true, clave_temporal: true } });
  });

  it('el selector de rol ofrece los cuatro perfiles de sitio; la casilla del perfil global solo aparece para el administrador del sistema', async () => {
    render(Usuarios, { sesion: SESION });
    await waitFor(() => expect(filaDe('bea@ejemplo.invalid')).toBeTruthy());
    expect([...document.querySelectorAll<HTMLOptionElement>('[data-rol-alta] option')].map((o) => o.value)).toEqual(['consulta', 'investigador', 'operador', 'administrador']);
    expect([...filaDe('bea@ejemplo.invalid').querySelectorAll<HTMLOptionElement>('[data-rol-sitio="uct"] option')].map((o) => o.value)).toEqual(['', 'consulta', 'investigador', 'operador', 'administrador']);
    expect(document.querySelector('[data-global-alta]')).toBeNull();
    cleanup();
    render(Usuarios, { sesion: { ...SESION, sitios: [], administrador_sistema: true } });
    await waitFor(() => expect(document.querySelector('[data-global-alta]')).toBeTruthy());
    await waitFor(() => expect([...document.querySelectorAll<HTMLOptionElement>('[data-sitio-alta] option')].map((o) => o.textContent)).toEqual(['Campus', 'Magallanes']));
    await fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: 'Gloria' } });
    await fireEvent.input(screen.getByLabelText('Correo'), { target: { value: 'gloria@ejemplo.invalid' } });
    await fireEvent.change(document.querySelector('[data-rol-alta]')!, { target: { value: 'operador' } });
    await fireEvent.click(document.querySelector('[data-global-alta]')!);
    await fireEvent.click(screen.getByRole('button', { name: 'Dar de alta' }));
    await waitFor(() => expect(pedidos.find((p) => p.metodo === 'POST')).toMatchObject({ cuerpo: { email: 'gloria@ejemplo.invalid', administrador_sistema: true, sitios: [{ sitio_id: 's-uct', rol: 'operador' }] } }));
  });

  it('una cuenta de administrador del sistema no se ofrece a cambiar a quien administra solo un sitio (el servidor diría 403)', async () => {
    lista = [yo, { ...bea, administrador_sistema: true }];
    render(Usuarios, { sesion: SESION });
    await waitFor(() => expect(filaDe('bea@ejemplo.invalid')).toBeTruthy());
    expect(filaDe('bea@ejemplo.invalid').querySelector<HTMLButtonElement>('[data-asignar-temporal]')!.disabled).toBe(true);
    expect(filaDe('bea@ejemplo.invalid').querySelector<HTMLButtonElement>('[data-alternar-activo]')!.disabled).toBe(true);
    expect(filaDe('bea@ejemplo.invalid').textContent).toContain('solo otro administrador del sistema');
  });

  it('alta con el correo de una cuenta inactiva (409 reactivable): ofrece «Reactivar» y la reactiva con clave temporal nueva', async () => {
    lista = [yo, { ...bea, activo: false }];
    respuestaPatch = () => new Response(JSON.stringify({ ...bea, activo: true, clave_temporal: true, clave: 'Vuelve-con-esta-123456' }));
    render(Usuarios, { sesion: SESION });
    await waitFor(() => expect(filaDe('bea@ejemplo.invalid')).toBeTruthy());
    await fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: 'Bea' } });
    await fireEvent.input(screen.getByLabelText('Correo'), { target: { value: 'bea@ejemplo.invalid' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Dar de alta' }));
    await waitFor(() => expect(document.querySelector('[data-reactivable]')).toBeTruthy());
    expect(document.querySelector('[data-reactivable]')!.textContent).toContain('inactiva');
    await fireEvent.click(document.querySelector('[data-reactivar-alta]')!);
    await waitFor(() => expect(document.querySelector('[data-clave-temporal]')?.textContent).toBe('Vuelve-con-esta-123456'));
    expect(pedidos.find((p) => p.metodo === 'PATCH')).toMatchObject({ ruta: '/usuarios/u-bea', cuerpo: { actualizado_en: '2026-11-08T12:30:00.123456Z', activo: true, clave_temporal: true } });
    expect(document.querySelector('[data-reactivable]')).toBeNull();
  });

  it('la temporal asignada no queda en la lista: la fila se guarda sin `clave`; vive solo en el aviso hasta ocultarla', () => {
    const r = { ...bea, clave_temporal: true, clave: 'Otra-temporal-987654321', actualizado_en: '2026-11-08T14:00:00.000000Z' };
    const { lista: nueva, clave } = aplicarRespuesta([yo, bea], r);
    expect(clave).toBe('Otra-temporal-987654321');
    expect(nueva[1]).not.toHaveProperty('clave');
    expect(JSON.stringify(nueva)).not.toContain('Otra-temporal');
    expect(nueva[1]).toMatchObject({ id: 'u-bea', clave_temporal: true, actualizado_en: '2026-11-08T14:00:00.000000Z' });
    expect(aplicarRespuesta([yo, bea], { ...bea, activo: false }).clave).toBeNull();
  });

  it('la clave temporal no es región viva: role="status" va solo en el texto del aviso, nunca en el <code> ni en un ancestro suyo', async () => {
    respuestaPatch = () => new Response(JSON.stringify({ ...bea, clave_temporal: true, clave: 'Otra-temporal-987654321' }));
    render(Usuarios, { sesion: SESION });
    await waitFor(() => expect(filaDe('bea@ejemplo.invalid')).toBeTruthy());
    await fireEvent.click(filaDe('bea@ejemplo.invalid').querySelector('[data-asignar-temporal]')!);
    await waitFor(() => expect(document.querySelector('[data-clave-temporal]')).toBeTruthy());
    const code = document.querySelector('[data-clave-temporal]')!;
    expect(code.closest('[role="status"], [aria-live]')).toBeNull();
    const vivo = document.querySelector('[data-clave-una-vez] [role="status"]')!;
    expect(vivo.textContent).toContain('No se vuelve a mostrar');
    expect(vivo.contains(code)).toBe(false);
  });

  it('la vigencia de la temporal la dice el servidor (clave_temporal_vence_en), nunca un plazo fijo del panel', async () => {
    const vence = '2026-11-08T16:00:00Z'; // p. ej. CLAVE_TEMPORAL_HORAS=2 asignada a las 14:00 UTC
    respuestaPatch = () => new Response(JSON.stringify({ ...bea, clave_temporal: true, clave_temporal_vence_en: vence, clave: 'Otra-temporal-987654321' }));
    render(Usuarios, { sesion: SESION });
    await waitFor(() => expect(filaDe('bea@ejemplo.invalid')).toBeTruthy());
    await fireEvent.click(filaDe('bea@ejemplo.invalid').querySelector('[data-asignar-temporal]')!);
    await waitFor(() => expect(document.querySelector('[data-vence-temporal]')).toBeTruthy());
    const esperado = new Date(vence).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' });
    expect(document.querySelector('[data-vence-temporal]')!.textContent).toBe(esperado);
    expect(document.querySelector('[data-clave-una-vez]')!.textContent).not.toMatch(/24 horas|24 h\b/);
    expect(document.body.textContent).not.toContain('(24 h)');
  });
});

