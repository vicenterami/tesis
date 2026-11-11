// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DispositivoFicha } from './lib/modelo';
import type { Sesion } from './lib/sesion';
import Configurar from './Configurar.svelte';

// P6 Configurar (docs/19 §4, tablero v2, E; flujo F2) por el DOM, en los dos sentidos: el error se lee junto al campo y frena el
// guardado; lo guardado llega del servidor (nunca optimista); el 409 pide recargar con la hora y no pisa nada.
const ID = '00000000-0000-4000-8000-000000000001';
const TEMP = '00000000-0000-4000-8000-0000000000c1';
const REGLA = '00000000-0000-4000-8000-0000000000a1';
const MARCA_D = '2026-11-11T12:00:00.123456Z';
const MARCA_C = '2026-11-11T12:00:00.654321Z';
const ficha = (): DispositivoFicha => ({
  id: ID, id_fisico: 'dev-0001', nombre: 'Invernadero', estado: 'activo', via: 'mqtt', formato: 'senml', intervalo_esperado_s: 60, visto_por_ultima_vez: null,
  en_linea: null, zona: 'Lab', sitio: 'Campus', zona_horaria: 'America/Santiago', sitio_codigo: 'uct', zona_id: 'z-lab', creado_en: 'x', intervalo_observado_s: null,
  actualizado_en: MARCA_D,
  canales: [{ id: TEMP, magnitud: 'temperatura', magnitud_nombre: 'Temperatura', unidad: 'Cel', etiqueta: null, actualizado_en: MARCA_C,
    reglas: [{ id: REGLA, umbral_alto: 30, umbral_bajo: 5, histeresis: 1, retardo_s: 0 }], ultima_medicion: null }],
});
const SITIOS = [{ id: 's1', codigo: 'uct', nombre: 'Campus', zona_horaria: 'America/Santiago', rol: 'administrador', zonas: [{ id: 'z-lab', nombre: 'Lab' }, { id: 'z-bod', nombre: 'Bodega' }] }];
const sesion = (rol: 'administrador' | 'consulta'): Sesion => ({
  sistema: false, usuario: { id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid' }, clave_temporal: false, expira_en: null, inactividad_vence_en: null,
  sitios: [{ sitio_id: 's1', codigo: 'uct', nombre: 'Campus', rol }], permisos: { administrador: ['leer', 'escribir', 'configurar'], consulta: ['leer'] },
});
let pedidos: { metodo: string; ruta: string; cuerpo: unknown }[] = [];
let responder: (metodo: string, ruta: string, cuerpo: unknown) => Promise<Response> | Response;
const json = (x: unknown, status = 200): Response => new Response(JSON.stringify(x), { status });

beforeEach(() => {
  pedidos = [];
  responder = (metodo, ruta) => (metodo === 'GET' && ruta === `/dispositivos/${ID}` ? json(ficha()) : json({ message: 'no' }, 404));
  vi.stubGlobal('fetch', vi.fn(async (ruta: string, init: RequestInit = {}) => {
    const metodo = init.method ?? 'GET';
    const cuerpo = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    pedidos.push({ metodo, ruta, cuerpo });
    return responder(metodo, ruta, cuerpo);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const campoRegla = (k: string): HTMLInputElement => document.querySelector(`[data-config-canal="${TEMP}"] [data-regla="0"] [data-campo="${k}"]`) as HTMLInputElement;
const botonReglas = (): HTMLButtonElement => document.querySelector(`[data-config-canal="${TEMP}"] [data-guardar-reglas]`) as HTMLButtonElement;

describe('P6 Configurar', () => {
  it('validación en vivo con el error junto al campo: bajo ≥ alto frena «Guardar las reglas» con el motivo; corregido, el PUT lleva el id de la regla y el actualizado_en leído, y lo guardado llega del servidor', async () => {
    render(Configurar, { id: ID, sesion: sesion('administrador'), sitios: SITIOS });
    await waitFor(() => expect(campoRegla('umbral_bajo')).toBeTruthy());
    expect(campoRegla('umbral_alto').value).toBe('30');
    await fireEvent.input(campoRegla('umbral_bajo'), { target: { value: '35' } });
    const err = document.querySelector('[data-error-campo="reglas[0].umbral_bajo"]')!;
    expect(err.textContent).toBe('debe ser menor que umbral_alto');
    expect(campoRegla('umbral_bajo').getAttribute('aria-describedby')).toContain(err.id); // el error, enlazado al campo
    expect(campoRegla('umbral_bajo').getAttribute('aria-invalid')).toBe('true');
    expect(botonReglas().disabled).toBe(true);
    expect(botonReglas().closest('.boton-envoltura')!.textContent).toContain('debe ser menor que umbral_alto');
    await fireEvent.input(campoRegla('umbral_bajo'), { target: { value: '10' } });
    await fireEvent.input(campoRegla('retardo_s'), { target: { value: '120' } });
    expect(botonReglas().disabled).toBe(false);
    let soltar!: () => void;
    responder = (metodo, ruta, cuerpo) => {
      if (metodo === 'PUT') return new Promise<Response>((ok) => { soltar = () => ok(json({ id: TEMP, etiqueta: null, actualizado_en: '2026-11-11T13:00:00.000001Z', reglas: [{ ...(cuerpo as { reglas: object[] }).reglas[0], id: REGLA }] })); });
      return json(ficha());
    };
    await fireEvent.click(botonReglas());
    await waitFor(() => expect(botonReglas().textContent).toBe('Guardando…')); // nunca optimista: espera con el botón ocupado
    expect(botonReglas().getAttribute('aria-busy')).toBe('true');
    expect(pedidos.find((p) => p.metodo === 'PUT')).toMatchObject({ ruta: `/canales/${TEMP}/reglas`, cuerpo: { actualizado_en: MARCA_C, etiqueta: null, reglas: [{ id: REGLA, umbral_alto: 30, umbral_bajo: 10, histeresis: 1, retardo_s: 120 }] } });
    soltar();
    await waitFor(() => expect(screen.getByText('Reglas guardadas: rigen desde la próxima trama.')).toBeTruthy());
    expect(campoRegla('retardo_s').value).toBe('120');
  });

  it('409 al guardar el dispositivo: «alguien lo cambió a las HH:MM» en la zona del sitio con «Recargar»; lo escrito no se pisa hasta recargar', async () => {
    render(Configurar, { id: ID, sesion: sesion('administrador'), sitios: SITIOS });
    await waitFor(() => expect(document.querySelector('[data-form-dispositivo] [data-campo="nombre"]')).toBeTruthy());
    const nombre = document.querySelector('[data-form-dispositivo] [data-campo="nombre"]') as HTMLInputElement;
    expect((document.querySelector('[data-guardar-dispositivo]') as HTMLButtonElement).disabled).toBe(true); // sin cambios
    responder = (metodo) => (metodo === 'PATCH' ? json({ statusCode: 409, message: `alguien lo cambió a las 13:42 UTC (2026-11-11T13:42:05.123456Z); recarga` }, 409) : json({ ...ficha(), nombre: 'Invernadero B' }));
    await fireEvent.input(nombre, { target: { value: 'Mi nombre' } });
    (document.querySelector('[data-campo="zona"]') as HTMLSelectElement).value = 'z-bod';
    await fireEvent.change(document.querySelector('[data-campo="zona"]')!);
    await fireEvent.submit(document.querySelector('[data-form-dispositivo]')!);
    const alerta = await waitFor(() => screen.getByRole('alert'));
    expect(alerta.textContent).toContain('Alguien lo cambió a las 10:42 entretanto: recarga para ver el valor nuevo');
    expect(pedidos.find((p) => p.metodo === 'PATCH')!.cuerpo).toEqual({ actualizado_en: MARCA_D, nombre: 'Mi nombre', zona_id: 'z-bod' });
    expect(nombre.value).toBe('Mi nombre'); // nada se pisó
    await fireEvent.click(screen.getByRole('button', { name: 'Recargar' }));
    await waitFor(() => expect((document.querySelector('[data-form-dispositivo] [data-campo="nombre"]') as HTMLInputElement).value).toBe('Invernadero B'));
  });

  it('un 400 del servidor (rango físico, que el panel no conoce) se escribe junto a su campo; una regla nueva va sin id y quitar la única deja «sin reglas»', async () => {
    render(Configurar, { id: ID, sesion: sesion('administrador'), sitios: SITIOS });
    await waitFor(() => expect(campoRegla('umbral_alto')).toBeTruthy());
    await fireEvent.input(campoRegla('umbral_alto'), { target: { value: '900' } });
    responder = (metodo) => (metodo === 'PUT' ? json({ statusCode: 400, message: ['reglas[0].umbral_alto: fuera del rango físico de la magnitud [-40, 85]'] }, 400) : json(ficha()));
    await fireEvent.click(botonReglas());
    await waitFor(() => expect(document.querySelector('[data-error-campo="reglas[0].umbral_alto"]')!.textContent).toBe('fuera del rango físico de la magnitud [-40, 85]'));
    await fireEvent.click(screen.getByRole('button', { name: 'Agregar una regla' }));
    expect(document.querySelectorAll(`[data-config-canal="${TEMP}"] [data-regla]`)).toHaveLength(2);
    expect(document.querySelector(`[data-config-canal="${TEMP}"] [data-regla="1"] legend`)!.textContent).toBe('Regla 2 (nueva)');
    for (const b of screen.getAllByRole('button', { name: 'Quitar esta regla' }).reverse()) await fireEvent.click(b);
    expect(document.querySelector('[data-sin-reglas]')).toBeTruthy();
  });

  it('con perfil de consulta: se ve la configuración, los botones dicen por qué no se puede y no se envía nada', async () => {
    render(Configurar, { id: ID, sesion: sesion('consulta'), sitios: SITIOS });
    await waitFor(() => expect(document.querySelector('[data-sin-permiso]')).toBeTruthy());
    await fireEvent.input(document.querySelector('[data-form-dispositivo] [data-campo="nombre"]')!, { target: { value: 'Otro' } });
    expect((document.querySelector('[data-guardar-dispositivo]') as HTMLButtonElement).disabled).toBe(true);
    expect(botonReglas().disabled).toBe(true);
    expect(botonReglas().closest('.boton-envoltura')!.textContent).toContain('configurar exige el perfil');
    expect(pedidos.filter((p) => p.metodo !== 'GET')).toEqual([]);
  });
});
