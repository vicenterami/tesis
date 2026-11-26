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
  en_linea: null, en_servicio_desde: '2026-01-01T00:00:00Z', espera_hasta: '2099-01-01T00:00:00Z', zona: 'Lab', sitio: 'Campus', zona_horaria: 'America/Santiago', sitio_codigo: 'uct', zona_id: 'z-lab', creado_en: 'x', intervalo_observado_s: null,
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
  it('«Usar el sugerido» (docs/19 §4, T, punto 8): llena una regla nueva con el sugerido del catálogo sin guardar; con 4 reglas se desactiva con su motivo; sin sugerido no aparece', async () => {
    const catalogo = [{ codigo: 'temperatura', nombre: 'Temperatura', unidad: 'Cel', rango_min: -40, rango_max: 85, umbral_alto_sugerido: 30, umbral_bajo_sugerido: null, histeresis_sugerida: 0.5, alias: [], actualizado_en: MARCA_C }];
    responder = (metodo, ruta) => (metodo === 'GET' && ruta === `/dispositivos/${ID}` ? json(ficha()) : ruta === '/magnitudes' ? json(catalogo) : json({ message: 'no' }, 404));
    render(Configurar, { id: ID, sesion: sesion('administrador'), sitios: SITIOS });
    const boton = async () => { await waitFor(() => expect(document.querySelector(`[data-usar-sugerido="${TEMP}"]`)).not.toBeNull()); return document.querySelector(`[data-usar-sugerido="${TEMP}"]`) as HTMLButtonElement; };
    expect((await boton()).textContent).toContain('Usar el sugerido (alto 30 °C · histéresis 0,5)');
    await fireEvent.click(await boton());
    const nueva = (k: string) => (document.querySelector(`[data-config-canal="${TEMP}"] [data-regla="1"] [data-campo="${k}"]`) as HTMLInputElement).value;
    expect([nueva('umbral_alto'), nueva('umbral_bajo'), nueva('histeresis')]).toEqual(['30', '', '0.5']);
    expect(pedidos.some((p) => p.metodo !== 'GET')).toBe(false); // no guarda nada
    await fireEvent.click(await boton());
    await fireEvent.click(await boton());
    expect((await boton()).getAttribute('aria-disabled') === 'true' || (await boton()).disabled).toBe(true);
    expect(document.body.textContent).toContain('el canal ya tiene 4 reglas');
    cleanup();
    responder = (metodo, ruta) => (metodo === 'GET' && ruta === `/dispositivos/${ID}` ? json(ficha()) : ruta === '/magnitudes' ? json([{ ...catalogo[0], umbral_alto_sugerido: null, histeresis_sugerida: 0 }]) : json({ message: 'no' }, 404));
    render(Configurar, { id: ID, sesion: sesion('administrador'), sitios: SITIOS });
    await waitFor(() => expect(document.querySelector(`[data-config-canal="${TEMP}"] [data-guardar-reglas]`)).not.toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector(`[data-usar-sugerido="${TEMP}"]`)).toBeNull();
  });
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

  // «Agregar una magnitud» (docs/19 §4 AA, punto 3).
  const CATALOGO = ['temperatura', 'rssi', 'snr'].map((codigo) => ({ codigo, nombre: codigo === 'snr' ? 'Relación señal/ruido' : codigo, unidad: codigo === 'snr' ? 'dB' : codigo === 'rssi' ? 'dBm' : 'Cel',
    rango_min: -40, rango_max: 85, umbral_alto_sugerido: null, umbral_bajo_sugerido: null, histeresis_sugerida: 0, alias: [], actualizado_en: MARCA_C }));
  const SNR = '00000000-0000-4000-8000-0000000000c9';
  it('«Agregar una magnitud»: ofrece las del catálogo que no tiene, envía solo el código y suma el canal nuevo sin perder lo que se edita en los demás', async () => {
    let conSnr = false;
    responder = (metodo, ruta) => {
      if (metodo === 'GET' && ruta === `/dispositivos/${ID}`) {
        const f = ficha();
        return json(conSnr ? { ...f, canales: [...f.canales, { id: SNR, magnitud: 'snr', magnitud_nombre: 'Relación señal/ruido', unidad: 'dB', etiqueta: null, actualizado_en: MARCA_C, reglas: [], ultima_medicion: null }] } : f);
      }
      if (ruta === '/magnitudes') return json(CATALOGO);
      if (metodo === 'POST' && ruta === `/dispositivos/${ID}/canales`) { conSnr = true; return json({ agregada: true, dispositivo_id: ID, canal: { id: SNR, magnitud: 'snr' } }); }
      return json({ message: 'no' }, 404);
    };
    render(Configurar, { id: ID, sesion: sesion('administrador'), sitios: SITIOS });
    const selector = async () => { await waitFor(() => expect(document.querySelector('[data-campo="nueva-magnitud"] option[value="snr"]')).not.toBeNull()); return document.querySelector('[data-campo="nueva-magnitud"]') as HTMLSelectElement; };
    expect([...(await selector()).options].map((o) => o.value)).toEqual(['', 'rssi', 'snr']); // la temperatura ya la tiene
    const boton = document.querySelector('[data-agregar-magnitud]') as HTMLButtonElement;
    expect(boton.disabled).toBe(true); // sin elegir, no envía
    await fireEvent.input(campoRegla('umbral_alto'), { target: { value: '31' } }); // una edición en curso de otro canal
    await fireEvent.change(await selector(), { target: { value: 'snr' } });
    await fireEvent.click(boton);
    await waitFor(() => expect(document.querySelector(`[data-config-canal="${SNR}"]`)).not.toBeNull());
    expect(pedidos.filter((x) => x.metodo === 'POST')).toEqual([{ metodo: 'POST', ruta: `/dispositivos/${ID}/canales`, cuerpo: { magnitud: 'snr' } }]);
    expect(campoRegla('umbral_alto').value).toBe('31');
    expect(document.body.textContent).toContain('Relación señal/ruido: agregada. Se guarda desde la próxima trama');
    expect([...(document.querySelector('[data-campo="nueva-magnitud"]') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'rssi']);
  });
  it('«Agregar una magnitud» con perfil de consulta: el botón dice por qué no y no se envía nada', async () => {
    responder = (metodo, ruta) => (metodo === 'GET' && ruta === `/dispositivos/${ID}` ? json(ficha()) : ruta === '/magnitudes' ? json(CATALOGO) : json({ message: 'no' }, 404));
    render(Configurar, { id: ID, sesion: sesion('consulta'), sitios: SITIOS });
    await waitFor(() => expect(document.querySelector('[data-agregar-magnitud]')).not.toBeNull());
    await fireEvent.change(document.querySelector('[data-campo="nueva-magnitud"]')!, { target: { value: 'rssi' } });
    const boton = document.querySelector('[data-agregar-magnitud]') as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    expect(boton.closest('.boton-envoltura')!.textContent).toContain('agregar una magnitud exige el perfil');
    await fireEvent.click(boton);
    expect(pedidos.filter((x) => x.metodo !== 'GET')).toEqual([]);
  });

  // «Lo que la trama trae y no se guarda» (docs/19 §4 AA, punto 6).
  const SIN_GUARDAR = { revisadas: 20, claves: [
    { clave: 'rssi', magnitud: 'rssi', valor: -87, unidad: 'dBm', visto: '2026-11-11T11:59:00Z', origen: 'enlace' },
    { clave: 'co2', magnitud: null, valor: 412, unidad: null, visto: '2026-11-11T11:59:00Z', origen: 'carga' },
  ] };
  it('«Lo que la trama trae y no se guarda»: bajo demanda; «Agregar» crea el canal, la clave sale de la lista y el canal aparece; lo que no tiene magnitud lo dice', async () => {
    let conRssi = false;
    responder = (metodo, ruta) => {
      if (metodo === 'GET' && ruta === `/dispositivos/${ID}`) {
        const f = ficha();
        return json(conRssi ? { ...f, canales: [...f.canales, { id: SNR, magnitud: 'rssi', magnitud_nombre: 'Intensidad de señal', unidad: 'dBm', etiqueta: null, actualizado_en: MARCA_C, reglas: [], ultima_medicion: null }] } : f);
      }
      if (ruta === `/dispositivos/${ID}/sin-guardar`) return json(SIN_GUARDAR);
      if (metodo === 'POST' && ruta === `/dispositivos/${ID}/canales`) { conRssi = true; return json({ agregada: true }); }
      return json([]);
    };
    render(Configurar, { id: ID, sesion: sesion('administrador'), sitios: SITIOS });
    await waitFor(() => expect(document.querySelector('[data-revisar-tramas]')).not.toBeNull());
    expect(pedidos.some((x) => x.ruta.endsWith('/sin-guardar'))).toBe(false); // nada se relee al abrir la pantalla
    await fireEvent.click(document.querySelector('[data-revisar-tramas]')!);
    await waitFor(() => expect(document.querySelectorAll('[data-sin-guardar-clave]')).toHaveLength(2));
    expect(document.querySelector('[data-sin-guardar-clave="rssi"]')!.textContent).toContain('rssi (señal del enlace): −87 dBm');
    expect(document.querySelector('[data-sin-guardar-clave="co2"] [data-sin-magnitud]')!.textContent).toBe('sin magnitud en el catálogo: pídelo a quien administra el sistema');
    expect(document.querySelector('[data-agregar-clave="co2"]')).toBeNull();
    await fireEvent.click(document.querySelector('[data-agregar-clave="rssi"]')!);
    await waitFor(() => expect(document.querySelector(`[data-config-canal="${SNR}"]`)).not.toBeNull());
    expect(pedidos.filter((x) => x.metodo === 'POST')).toEqual([{ metodo: 'POST', ruta: `/dispositivos/${ID}/canales`, cuerpo: { magnitud: 'rssi' } }]);
    expect(document.querySelector('[data-sin-guardar-clave="rssi"]')).toBeNull();
  });
  // Correcciones del 25/11/2026: el canal creado no se dice como error si falla la relectura; «ya la guardaba» no dice «se guarda desde la
  // próxima trama»; y volver a revisar con el tope del servidor (429) dice cuánto esperar sin borrar la lista que ya se ve.
  it('«Agregar una magnitud»: si el POST se confirma y la relectura falla, dice que quedó agregada y que recargue (no invita a repetir el POST)', async () => {
    let posteado = false;
    responder = (metodo, ruta) => {
      if (metodo === 'GET' && ruta === `/dispositivos/${ID}`) return posteado ? json({ message: 'caída' }, 500) : json(ficha());
      if (ruta === '/magnitudes') return json(CATALOGO);
      if (metodo === 'POST' && ruta === `/dispositivos/${ID}/canales`) { posteado = true; return json({ agregada: true, dispositivo_id: ID, canal: { id: SNR, magnitud: 'snr' } }); }
      return json({ message: 'no' }, 404);
    };
    render(Configurar, { id: ID, sesion: sesion('administrador'), sitios: SITIOS });
    await waitFor(() => expect(document.querySelector('[data-campo="nueva-magnitud"] option[value="snr"]')).not.toBeNull());
    await fireEvent.change(document.querySelector('[data-campo="nueva-magnitud"]')!, { target: { value: 'snr' } });
    await fireEvent.click(document.querySelector('[data-agregar-magnitud]')!);
    await waitFor(() => expect(document.body.textContent).toContain('Relación señal/ruido: agregada.'));
    expect(document.body.textContent).toContain('No se pudo releer el equipo: recarga la pantalla');
    expect(document.querySelector('[data-form-magnitud] [data-aviso="error"]')).toBeNull();
  });
  it('«Lo que la trama trae y no se guarda»: «ya la guardaba» si el servidor responde agregada: false; volver a revisar con 429 conserva la lista y dice cuánto esperar', async () => {
    let revisiones = 0;
    responder = (metodo, ruta) => {
      if (metodo === 'GET' && ruta === `/dispositivos/${ID}`) return json(ficha());
      if (ruta === `/dispositivos/${ID}/sin-guardar`) return ++revisiones === 1 ? json(SIN_GUARDAR) : json({ statusCode: 429, codigo: 'sin_guardar_espera', message: 'acabas de revisar las tramas de este equipo: reintenta en 7 s', reintentar_en_s: 7 }, 429);
      if (metodo === 'POST' && ruta === `/dispositivos/${ID}/canales`) return json({ agregada: false });
      return json([]);
    };
    render(Configurar, { id: ID, sesion: sesion('administrador'), sitios: SITIOS });
    await waitFor(() => expect(document.querySelector('[data-revisar-tramas]')).not.toBeNull());
    await fireEvent.click(document.querySelector('[data-revisar-tramas]')!);
    await waitFor(() => expect(document.querySelectorAll('[data-sin-guardar-clave]')).toHaveLength(2));
    await fireEvent.click(document.querySelector('[data-agregar-clave="rssi"]')!);
    await waitFor(() => expect(document.querySelector('[data-sin-guardar]')!.textContent).toContain('«rssi»: el equipo ya la guardaba'));
    expect(document.querySelector('[data-sin-guardar]')!.textContent).not.toContain('se guarda desde la próxima trama');
    await fireEvent.click(document.querySelector('[data-revisar-otra-vez]')!);
    await waitFor(() => expect(document.querySelector('[data-sin-guardar-error]')!.textContent).toContain('espera 7 s'));
    expect(document.querySelectorAll('[data-sin-guardar-clave]')).toHaveLength(1); // co2 sigue a la vista
  });
  it('«Lo que la trama trae y no se guarda»: con perfil de consulta no aparece ni se pide (lee cargas crudas)', async () => {
    render(Configurar, { id: ID, sesion: sesion('consulta'), sitios: SITIOS });
    await waitFor(() => expect(document.querySelector('[data-configurar]')).not.toBeNull());
    expect(document.querySelector('[data-sin-guardar]')).toBeNull();
    expect(pedidos.some((x) => x.ruta.endsWith('/sin-guardar'))).toBe(false);
  });
});
