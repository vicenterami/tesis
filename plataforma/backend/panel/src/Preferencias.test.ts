// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferencias as P } from './lib/modelo';
import type { Sesion } from './lib/sesion';
import Preferencias from './Preferencias.svelte';

// P13 (docs/19 §4, tablero v2, H; docs/20 §11; docs/21 §5) por el DOM: la preferencia se ve al instante y vuelve atrás si el servidor la
// rechaza; el permiso de notificar se pide al activar; las sesiones se cierran tras la respuesta; la baja pide la clave y se explica.
const SESION: Sesion = {
  sistema: false, usuario: { id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid' }, clave_temporal: false, expira_en: null, inactividad_vence_en: null,
  sitios: [{ sitio_id: 's1', codigo: 'uct', nombre: 'Campus', rol: 'administrador' }], permisos: { administrador: ['leer'], consulta: ['leer'] },
};
const PREFS: P = { unidad_temperatura: 'C', unidad_longitud: 'm', zona_horaria: 'sitio', tema: 'sistema', notificar: [], vistas: [], sitio_predeterminado: null, actualizado_en: null };
const SESIONES = [
  { id: 'a'.repeat(64), creada_en: '2026-11-11T10:00:00Z', ultima_actividad: '2026-11-11T12:00:00Z', agente: 'Firefox en Linux', origen: '192.0.2.0/24', actual: true },
  { id: 'b'.repeat(64), creada_en: '2026-11-10T10:00:00Z', ultima_actividad: '2026-11-10T12:00:00Z', agente: 'Chrome en Android', origen: '198.51.100.0/24', actual: false },
];
const json = (x: unknown, status = 200): Response => new Response(JSON.stringify(x), { status });
let pedidos: { metodo: string; ruta: string; cuerpo: Record<string, unknown> | undefined }[] = [];
let respuestaPut: (c: Record<string, unknown>) => Response;
let respuestaBaja: () => Response;

beforeEach(() => {
  pedidos = [];
  respuestaPut = (c) => json({ ...c, actualizado_en: '2026-11-11T13:00:00.000001Z' });
  respuestaBaja = () => json({ anonimizado_en: '2026-11-11T13:00:00Z' });
  vi.stubGlobal('fetch', vi.fn(async (ruta: string, init: RequestInit = {}) => {
    const metodo = init.method ?? 'GET';
    const cuerpo = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    pedidos.push({ metodo, ruta, cuerpo });
    if (ruta === '/preferencias' && metodo === 'GET') return json(PREFS);
    if (ruta === '/preferencias' && metodo === 'PUT') {
      // Como el servidor (cuenta/preferencias.ts): `parametros` de cada vista es un objeto texto → texto; si no, 400 con el motivo.
      const malas = ((cuerpo.vistas ?? []) as { parametros?: unknown }[]).map((v, i) => [v.parametros, i] as const)
        .filter(([p]) => typeof p !== 'object' || p === null || Array.isArray(p) || Object.values(p).some((x) => typeof x !== 'string'));
      if (malas.length > 0) return json({ statusCode: 400, message: malas.map(([, i]) => `vistas[${i}].parametros debe ser un objeto de hasta 20 pares texto → texto`) }, 400);
      return respuestaPut(cuerpo);
    }
    if (ruta === '/sesiones') return json(SESIONES);
    if (ruta.startsWith('/sesiones/') && metodo === 'DELETE') return json({ revocada: true, actual: false });
    if (ruta === '/terminos') return json({ version: 1, fecha: '2026-11-11', texto: 't' });
    if (ruta === '/cuenta/baja') return respuestaBaja();
    return json({ message: 'no' }, 404);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute('data-theme'); });

const select = (k: string): HTMLSelectElement => document.querySelector(`[data-pref="${k}"]`) as HTMLSelectElement;
async function cambiar(k: string, v: string): Promise<void> {
  select(k).value = v;
  await fireEvent.change(select(k));
}

describe('P13 Preferencias', () => {
  it('°F se ve al instante (optimista) y viaja completo con el actualizado_en leído; un 409 la devuelve a °C y dice por qué; el tema se aplica en vivo', async () => {
    const vistas: P[] = [];
    render(Preferencias, { sesion: SESION, alCambiarPreferencias: (p: P) => vistas.push(p) });
    await waitFor(() => expect(select('unidad_temperatura')).toBeTruthy());
    await cambiar('unidad_temperatura', 'F');
    expect(vistas.at(-1)!.unidad_temperatura).toBe('F'); // antes de la respuesta
    await waitFor(() => expect(pedidos.find((p) => p.metodo === 'PUT')).toBeTruthy());
    expect(pedidos.find((p) => p.metodo === 'PUT')!.cuerpo).toEqual({ ...PREFS, unidad_temperatura: 'F', actualizado_en: null });
    await waitFor(() => expect(vistas.at(-1)!.actualizado_en).toBe('2026-11-11T13:00:00.000001Z'));
    respuestaPut = () => json({ statusCode: 409, message: 'cambiaron entretanto' }, 409);
    await cambiar('tema', 'oscuro');
    expect(document.documentElement.getAttribute('data-theme')).toBe('oscuro');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('No se guardó la preferencia; volvió a la anterior. Alguien lo cambió entretanto'));
    expect(select('tema').value).toBe('sistema');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(pedidos.filter((p) => p.metodo === 'PUT').at(-1)!.cuerpo!.actualizado_en).toBe('2026-11-11T13:00:00.000001Z'); // el que dejó el guardado anterior
  });

  it('notificaciones del navegador: el permiso se pide al marcar (nunca al cargar); negado, no se guarda; dado, se guarda el tipo', async () => {
    let respuesta: NotificationPermission = 'denied';
    const pedir = vi.fn(async () => respuesta);
    vi.stubGlobal('Notification', Object.assign(function () {}, { permission: 'default', requestPermission: pedir }));
    render(Preferencias, { sesion: SESION });
    await waitFor(() => expect(document.querySelector('[data-notificar="umbral"]')).toBeTruthy());
    expect(pedir).not.toHaveBeenCalled();
    expect(document.querySelector('[data-ayuda-notificar]')!.textContent).toMatch(/«N condiciones nuevas en» el sitio, sin el dispositivo ni el tipo/);
    await fireEvent.click(document.querySelector('[data-notificar="umbral"]')!);
    await waitFor(() => expect(document.body.textContent).toContain('El navegador no dio permiso para notificar'));
    expect(pedidos.filter((p) => p.metodo === 'PUT')).toEqual([]);
    expect((document.querySelector('[data-notificar="umbral"]') as HTMLInputElement).checked).toBe(false); // la casilla no miente
    respuesta = 'granted';
    await fireEvent.click(document.querySelector('[data-notificar="umbral"]')!);
    await waitFor(() => expect(pedidos.find((p) => p.metodo === 'PUT')?.cuerpo?.notificar).toEqual(['umbral']));
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it('vistas guardadas: la última vista de datos se guarda con un nombre y se ofrece como enlace del panel', async () => {
    render(Preferencias, { sesion: SESION, ultimaVista: '#/inventario?estado=alerta' });
    await waitFor(() => expect(document.querySelector('[data-sin-vistas]')).toBeTruthy());
    await fireEvent.input(document.querySelector('[data-nombre-vista]')!, { target: { value: 'Alertas' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar la vista' }));
    await waitFor(() => expect(document.querySelector('[data-vista="Alertas"] a')?.getAttribute('href')).toBe('#/inventario?estado=alerta'));
    expect(pedidos.find((p) => p.metodo === 'PUT')!.cuerpo!.vistas).toEqual([{ nombre: 'Alertas', pantalla: 'inventario', parametros: { ruta: '/inventario?estado=alerta' } }]);
    expect(document.querySelector('[data-aviso="error"]')).toBeNull(); // el servidor simulado, que exige un objeto, la aceptó
  });
});

describe('P13 Mi cuenta', () => {
  it('sesiones abiertas: la actual no se cierra desde aquí (dice por qué); otra se cierra con DELETE y sale de la lista tras la respuesta', async () => {
    render(Preferencias, { sesion: SESION });
    await waitFor(() => expect(document.querySelectorAll('[data-sesion-abierta]')).toHaveLength(2));
    const actual = document.querySelector(`[data-cerrar-sesion="${'a'.repeat(64)}"]`) as HTMLButtonElement;
    expect(actual.disabled).toBe(true);
    expect(actual.closest('.boton-envoltura')!.textContent).toContain('para cerrarla, «Salir»');
    await fireEvent.click(document.querySelector(`[data-cerrar-sesion="${'b'.repeat(64)}"]`)!);
    await waitFor(() => expect(document.querySelectorAll('[data-sesion-abierta]')).toHaveLength(1));
    expect(pedidos.find((p) => p.metodo === 'DELETE')!.ruta).toBe(`/sesiones/${'b'.repeat(64)}`);
    expect(document.querySelector('[data-terminos-aceptados]')!.textContent).toContain('versión 1, aceptada');
  });

  it('darme de baja: explicado antes; exige la clave y marcar que es irreversible; clave mala (400) no da de baja; bien, avisa a App', async () => {
    const baja = vi.fn();
    render(Preferencias, { sesion: SESION, alDarseDeBaja: baja });
    const explicacion = document.querySelector('[data-explicacion-baja]')!.textContent!.replace(/\s+/g, ' ');
    expect(explicacion).toContain('Es irreversible');
    // Lo decidido el 11/11/2026: altas y cambios sin datos tuyos; accesos con IP, 90 días; y los mensajes de soporte.
    expect(explicacion).toMatch(/altas y cambios .*sin datos tuyos/);
    expect(explicacion).toMatch(/accesos .*dirección IP.*se borran a los 90 días/);
    expect(explicacion).toContain('tus mensajes de soporte');
    const b = (): HTMLButtonElement => screen.getByRole('button', { name: 'Darme de baja' }) as HTMLButtonElement;
    expect(b().disabled).toBe(true);
    await fireEvent.input(document.querySelector('[data-clave-baja]')!, { target: { value: 'no-es-mi-clave' } });
    expect(b().closest('.boton-envoltura')!.textContent).toContain('marca que entiendes');
    await fireEvent.click(document.querySelector('[data-entiendo-baja]')!);
    respuestaBaja = () => json({ statusCode: 400, message: ['la clave actual no es correcta'] }, 400);
    await fireEvent.click(b());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('La clave no es la actual: no se dio de baja nada.'));
    expect(baja).not.toHaveBeenCalled();
    expect((document.querySelector('[data-clave-baja]') as HTMLInputElement).value).toBe(''); // la clave no queda en la página
    respuestaBaja = () => json({ anonimizado_en: '2026-11-11T13:00:00Z' });
    await fireEvent.input(document.querySelector('[data-clave-baja]')!, { target: { value: 'mi-clave-de-verdad' } });
    await fireEvent.click(b());
    await waitFor(() => expect(baja).toHaveBeenCalledTimes(1));
    expect(pedidos.find((p) => p.ruta === '/cuenta/baja' && p.cuerpo?.clave === 'mi-clave-de-verdad')).toBeTruthy();
  });
});
