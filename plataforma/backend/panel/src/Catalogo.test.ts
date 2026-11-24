// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Catalogo from './Catalogo.svelte';
import { ALIAS_RESERVADOS, CODIGO_MAGNITUD, CODIGO_RECETA, FORMA_ALIAS, TIPOS_CAMPO, aPartirDe, erroresReceta, textoFuera } from './lib/catalogo';

// P16 Catálogo (docs/19 §4, T, punto 11), por el DOM, contra un servidor simulado con la forma de la API (docs/20 §6; backend: alta/magnitudes.*
// y alta/recetas.*).
const MARCA = '2026-11-23T19:00:00.123456Z';
const temperatura = () => ({ codigo: 'temperatura', nombre: 'Temperatura', unidad: 'Cel', rango_min: -40, rango_max: 85, umbral_alto_sugerido: 30, umbral_bajo_sugerido: null,
  histeresis_sugerida: 0.5, alias: ['temperature', 'temperatura'], actualizado_en: MARCA, canales: 14 });
const CAMPUS = { codigo: 'campus-heltec-v3-v1', nombre: 'Heltec V3 del campus', largo_bytes: 10, equipos: 2, campos: [
  { orden: 1, magnitud: 'temperatura', unidad: 'Cel', desplazamiento: 5, tipo: 'i16be', sumar_antes: 0, multiplicar_por: 1, dividir_por: 100 }] };

let pedidas: { metodo: string; ruta: string; cuerpo: unknown }[] = [];
let magnitudes: Record<string, unknown>[] = [];
let recetas: Record<string, unknown>[] = [];
let impacto: { mediciones: number; canales: number } | 'falla' = { mediciones: 0, canales: 0 };
let respuestaPatch: () => Response = () => json({});
const json = (x: unknown, status = 200): Response => new Response(JSON.stringify(x), { status });

beforeEach(() => {
  pedidas = [];
  magnitudes = [temperatura()];
  recetas = [CAMPUS];
  impacto = { mediciones: 0, canales: 0 };
  respuestaPatch = () => json(temperatura());
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(async (ruta: string, init: RequestInit = {}) => {
    await Promise.resolve();
    const metodo = (init.method ?? 'GET').toUpperCase();
    pedidas.push({ metodo, ruta, cuerpo: init.body ? JSON.parse(String(init.body)) : undefined });
    if (ruta === '/magnitudes') return json(magnitudes);
    if (ruta === '/magnitudes/unidades') return json(['Cel', 'K', 'V', '%RH', 'W/m2']);
    if (ruta === '/recetas-decodificacion') return json(recetas);
    if (ruta.startsWith('/magnitudes/temperatura/impacto')) return impacto === 'falla' ? json({ message: 'sin base' }, 503) : json({ codigo: 'temperatura', dias: 7, ...impacto });
    if (metodo === 'PATCH' && ruta === '/magnitudes/temperatura') return respuestaPatch();
    if (metodo === 'POST' && ruta === '/magnitudes') return json(temperatura());
    if (metodo === 'POST' && ruta === '/recetas-decodificacion/probar') {
      const c = JSON.parse(String(init.body)) as { bytes: string; codificacion: string };
      const largo = c.codificacion === 'hex' ? c.bytes.replace(/\s/g, '').length / 2 : 10;
      return json(largo === 10 ? { ok: true, lecturas: [{ magnitud: 'temperatura', valor: 18.16, unidad: 'Cel' }] } : { ok: false, motivo: `se esperaban 10 bytes y llegaron ${largo}` });
    }
    if (metodo === 'POST' && ruta.endsWith('/reemplazar')) return json({ codigo: 'campus-heltec-v3-v1', por: 'campus-heltec-v3-v2', dispositivos: 2, avisos: [] });
    return json({ message: `ruta no simulada: ${metodo} ${ruta}` }, 404);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const abrir = async (seccion: 'magnitudes' | 'recetas' = 'magnitudes') => {
  const r = render(Catalogo, { seccion, alCambiarVista: () => {} });
  await waitFor(() => expect(r.container.querySelector(seccion === 'magnitudes' ? '[data-lista-magnitudes], [data-catalogo-vacio]' : '[data-lista-recetas], [data-sin-recetas]')).not.toBeNull());
  return r;
};
const escribir = async (el: Element | null, v: string) => { await fireEvent.input(el as HTMLInputElement, { target: { value: v } }); };

describe('las listas', () => {
  it('magnitudes: nombre, unidad como se lee, rango, sugerido, alias y en cuántos canales', async () => {
    const { container } = await abrir();
    const fila = container.querySelector('[data-magnitud="temperatura"]')!.textContent!;
    for (const t of ['Temperatura', '°C', 'de -40 a 85 °C', 'alto 30 °C · histéresis 0,5', 'temperature, temperatura', 'en 14 canales']) expect(fila).toContain(t);
  });
  it('sin magnitudes: la invitación a crear la primera', async () => {
    magnitudes = [];
    const { container } = await abrir();
    expect(container.querySelector('[data-catalogo-vacio]')!.textContent).toContain('crea la primera magnitud');
  });
  it('recetas: el largo, los campos legibles y en cuántos equipos; sin recetas, qué es una receta', async () => {
    const { container } = await abrir('recetas');
    const fila = container.querySelector('[data-receta="campus-heltec-v3-v1"]')!.textContent!;
    for (const t of ['10 bytes', 'temperatura: entero de 2 bytes con signo en el byte 5, ÷ 100', 'en 2 equipos']) expect(fila).toContain(t);
    cleanup();
    recetas = [];
    const otra = await abrir('recetas');
    expect(otra.container.querySelector('[data-sin-recetas]')!.textContent).toContain('traduce los bytes');
  });
});

describe('editar una magnitud: el rango más chico se confirma', () => {
  const editar = async () => {
    const r = await abrir();
    await fireEvent.click(r.container.querySelector('[data-editar-magnitud="temperatura"]')!);
    return r;
  };
  it('con mediciones afectadas pregunta y «Guardar igual» manda exactamente el rango consultado', async () => {
    impacto = { mediciones: 5, canales: 2 };
    const { container } = await editar();
    await escribir(container.querySelector('[data-campo="rango_max"]'), '70');
    await fireEvent.click(container.querySelector('[data-guardar-magnitud]')!);
    await waitFor(() => expect(container.querySelector('[data-confirmar-rango]')!.textContent).toContain('5 mediciones de los últimos 7 días, de 2 canales'));
    expect(pedidas.some((p) => p.metodo === 'PATCH')).toBe(false);
    await fireEvent.click(container.querySelector('[data-guardar-igual]')!);
    await waitFor(() => expect(pedidas.find((p) => p.metodo === 'PATCH')?.cuerpo).toEqual({ actualizado_en: MARCA, rango_max: 70 })); // solo lo que cambió
  });
  it('con 0 afectadas guarda directo; ampliar no pregunta', async () => {
    const { container } = await editar();
    await escribir(container.querySelector('[data-campo="rango_max"]'), '70');
    await fireEvent.click(container.querySelector('[data-guardar-magnitud]')!);
    await waitFor(() => expect(pedidas.filter((p) => p.metodo === 'PATCH')).toHaveLength(1));
    cleanup(); pedidas = [];
    const otra = await editar();
    await escribir(otra.container.querySelector('[data-campo="rango_max"]'), '90');
    await fireEvent.click(otra.container.querySelector('[data-guardar-magnitud]')!);
    await waitFor(() => expect(pedidas.filter((p) => p.metodo === 'PATCH')).toHaveLength(1));
    expect(pedidas.some((p) => p.ruta.includes('/impacto'))).toBe(false);
  });
  it('si la consulta del impacto falla, se dice y no se guarda', async () => {
    impacto = 'falla';
    const { container } = await editar();
    await escribir(container.querySelector('[data-campo="rango_min"]'), '0');
    await fireEvent.click(container.querySelector('[data-guardar-magnitud]')!);
    await waitFor(() => expect(container.querySelector('[data-form-magnitud] [data-aviso]')!.textContent).toContain('no se guardó'));
    expect(pedidas.some((p) => p.metodo === 'PATCH')).toBe(false);
  });
  it('el 409 con la lista nombra la regla que queda fuera; el de relectura conserva lo escrito', async () => {
    respuestaPatch = () => json({ statusCode: 409, message: 'deja fuera', total: 1, fuera: [{ tipo: 'regla', canal_id: 'k', dispositivo_id: 'd', dispositivo: 'Sala 3', etiqueta: null, valores: [90] }] }, 409);
    const { container } = await editar();
    await escribir(container.querySelector('[data-campo="nombre"]'), 'Temperatura del aire');
    await fireEvent.click(container.querySelector('[data-guardar-magnitud]')!);
    await waitFor(() => expect(container.querySelector('[data-form-magnitud] [data-aviso]')!.textContent).toContain('la regla del canal «Sala 3» (90)'));
    // Relectura: otra persona subió el máximo a 99; lo que esta persona no tocó (el máximo) muestra lo nuevo y lo que sí tocó (el nombre) se conserva.
    respuestaPatch = () => json({ statusCode: 409, actualizado_en: '2026-11-23T13:42:00.000000Z', message: 'alguien' }, 409);
    magnitudes = [{ ...temperatura(), rango_max: 99, actualizado_en: '2026-11-23T13:42:00.000000Z' }];
    await fireEvent.click(container.querySelector('[data-guardar-magnitud]')!);
    await waitFor(() => expect(container.querySelector('[data-form-magnitud] [data-aviso]')!.textContent).toContain('Alguien cambió esta magnitud'));
    expect((container.querySelector('[data-campo="nombre"]') as HTMLInputElement).value).toBe('Temperatura del aire');
    expect((container.querySelector('[data-campo="rango_max"]') as HTMLInputElement).value).toBe('99');
    respuestaPatch = () => json(temperatura());
    await fireEvent.click(container.querySelector('[data-guardar-magnitud]')!);
    await waitFor(() => expect(pedidas.filter((p) => p.metodo === 'PATCH').at(-1)?.cuerpo).toEqual({ actualizado_en: '2026-11-23T13:42:00.000000Z', nombre: 'Temperatura del aire' }));
  });
  it('un alias reservado se dice antes de enviar, en palabras', async () => {
    const { container } = await editar();
    await escribir(container.querySelector('[data-campo="alias-nuevo"]'), 'fPort');
    await fireEvent.click(container.querySelector('[data-agregar-alias]')!);
    await waitFor(() => expect(container.querySelector('[data-error-alias]')!.textContent).toContain('fport lo usa la pasarela para otra cosa'));
  });
});

describe('recetas: probar sin guardar y reemplazar por', () => {
  it('«Crear a partir de esta» abre la -v2; probar con la captura en hexadecimal y en base64 da las lecturas; al cambiar la receta, el resultado se tacha', async () => {
    const { container } = await abrir('recetas');
    await fireEvent.click(container.querySelector('[data-a-partir="campus-heltec-v3-v1"]')!);
    expect((container.querySelector('[data-form-receta] [data-campo="codigo"]') as HTMLInputElement).value).toBe('campus-heltec-v3-v2');
    await escribir(container.querySelector('[data-campo="bytes"]'), '02 00 00 00 8f 07 18 19 98 af');
    await fireEvent.click(container.querySelector('[data-probar]')!);
    await waitFor(() => expect(container.querySelector('[data-resultado-prueba="al-dia"]')!.textContent).toContain('18,16'));
    await fireEvent.click(container.querySelector('[data-codificacion="base64"]')!);
    expect(container.querySelector('[data-resultado-prueba="viejo"] [data-prueba-vieja]')!.textContent).toContain('vuelve a probar');
    await escribir(container.querySelector('[data-campo="bytes"]'), 'AgAAAI8HGBmYrw==');
    await fireEvent.click(container.querySelector('[data-probar]')!);
    await waitFor(() => expect(container.querySelector('[data-resultado-prueba="al-dia"]')).not.toBeNull());
    expect(pedidas.filter((p) => p.ruta === '/recetas-decodificacion/probar').map((p) => (p.cuerpo as { codificacion: string }).codificacion)).toEqual(['hex', 'base64']);
  });
  it('con 9 bytes, el motivo en palabras', async () => {
    const { container } = await abrir('recetas');
    await fireEvent.click(container.querySelector('[data-crear-receta]')!);
    await escribir(container.querySelector('[data-campo="bytes"]'), '020000008f07181998');
    // Sin magnitud elegida, probar no envía nada y dice qué falta, en palabras (docs/19 §4, T, punto 9).
    await fireEvent.click(container.querySelector('[data-probar]')!);
    expect(container.querySelector('[data-form-receta] [data-aviso]')!.textContent).toContain('Antes de probar: Un entero de 1 a 255. Elige la magnitud.');
    expect(pedidas.some((p) => p.ruta === '/recetas-decodificacion/probar')).toBe(false);
    await fireEvent.change(container.querySelector('[data-campo-receta="0"] [data-campo="magnitud"]') as HTMLSelectElement, { target: { value: 'temperatura' } });
    await escribir(container.querySelector('[data-campo="largo_bytes"]'), '10');
    await fireEvent.click(container.querySelector('[data-probar]')!);
    await waitFor(() => expect(container.querySelector('[data-motivo-prueba]')!.textContent).toContain('se esperaban 10 bytes y llegaron 9'));
  });
  it('«Reemplazar por» confirma con el número de equipos y, al terminar, lo dice', async () => {
    recetas = [CAMPUS, { ...CAMPUS, codigo: 'campus-heltec-v3-v2', equipos: 0 }];
    const { container } = await abrir('recetas');
    await fireEvent.click(container.querySelector('[data-reemplazar="campus-heltec-v3-v1"]')!);
    const sel = container.querySelector('[data-reemplazar-por]') as HTMLSelectElement;
    await fireEvent.change(sel, { target: { value: 'campus-heltec-v3-v2' } });
    expect(container.querySelector('[data-texto-reemplazo]')!.textContent).toContain('2 equipos pasan de «campus-heltec-v3-v1» a «campus-heltec-v3-v2»');
    await fireEvent.click(container.querySelector('[data-confirmar-reemplazar]')!);
    await waitFor(() => expect(container.querySelector('[data-seccion-recetas] [data-aviso="exito"]')!.textContent).toContain('2 equipos usan ahora «campus-heltec-v3-v2»'));
  });
});

describe('las reglas del panel son las del servidor (backend: alta/magnitudes.dto.ts y recepcion/adaptadores/receta.ts)', () => {
  it('formas, reservadas y tipos', () => {
    expect(CODIGO_MAGNITUD.source).toBe('^[a-z][a-z0-9_]{0,39}$');
    expect(CODIGO_RECETA.source).toBe('^[a-z0-9][a-z0-9-]{2,62}$');
    expect(FORMA_ALIAS.source).toBe('^[a-z0-9_.-]{1,64}$');
    expect(ALIAS_RESERVADOS).toHaveLength(12);
    expect(TIPOS_CAMPO).toEqual(['u8', 'i8', 'u16be', 'u16le', 'i16be', 'i16le', 'u32be', 'u32le', 'i32be', 'i32le']);
  });
  it('un campo que se sale de la trama se explica en bytes; la -v3 sigue a la -v2', () => {
    const e = erroresReceta({ codigo: 'nodo-v1', nombre: 'Nodo', largo_bytes: 10, campos: [{ magnitud: 'a', desplazamiento: 9, tipo: 'u16be', sumar_antes: 0, multiplicar_por: 1, dividir_por: 1 }] });
    expect(e['campo0.desplazamiento']).toBe('La trama tiene 10 bytes, del 0 al 9: el campo 1 empieza en el byte 9 y ocupa 2, así que se sale.');
    expect(aPartirDe({ ...CAMPUS, codigo: 'nodo-v2' } as never).codigo).toBe('nodo-v3');
    expect(textoFuera([], 0)).toContain('nada se guardó');
  });
});
