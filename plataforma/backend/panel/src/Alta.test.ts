// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sesion } from './lib/sesion';
import Alta from './Alta.svelte';

// P7 Alta (docs/19 §4, tablero v2, F; D-103 A) por el DOM: el asistente con la credencial una sola vez y la espera de la primera trama;
// el alta masiva que valida antes de crear y crea en tandas de 50 con avance, se detiene en la tanda que falla y reintenta las restantes;
// la bandeja de detectados que lleva al asistente con el identificador.
const SITIOS = [{ id: 's1', codigo: 'uct', nombre: 'Campus', zona_horaria: 'America/Santiago', rol: 'administrador', zonas: [{ id: 'z-lab', nombre: 'Lab' }] }];
const SESION: Sesion = {
  sistema: false, usuario: { id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid' }, clave_temporal: false, expira_en: null, inactividad_vence_en: null,
  sitios: [{ sitio_id: 's1', codigo: 'uct', nombre: 'Campus', rol: 'administrador' }], permisos: { administrador: ['leer', 'escribir', 'configurar'], consulta: ['leer'] },
};
const NUEVO = '00000000-0000-4000-8000-0000000000d1';
const json = (x: unknown, status = 200): Response => new Response(JSON.stringify(x), { status });
let pedidos: { metodo: string; ruta: string; cuerpo: { filas?: { id_fisico: string }[] } & Record<string, unknown> }[] = [];
let responder: (metodo: string, ruta: string, cuerpo: { filas?: { id_fisico: string }[] } & Record<string, unknown>) => Response;
let descargas: { nombre: string; contenido: Promise<string> }[] = [];

class Fuente {
  static todas: Fuente[] = [];
  readyState = 1;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  oyentes = new Map<string, (e: MessageEvent) => void>();
  constructor(public url: string) { Fuente.todas.push(this); }
  addEventListener(t: string, f: (e: MessageEvent) => void): void { this.oyentes.set(t, f); }
  close(): void { this.readyState = 2; }
}

beforeEach(() => {
  pedidos = [];
  descargas = [];
  Fuente.todas.length = 0;
  vi.stubGlobal('EventSource', Fuente);
  responder = () => json({ message: 'no' }, 404);
  vi.stubGlobal('fetch', vi.fn(async (ruta: string, init: RequestInit = {}) => {
    const metodo = init.method ?? 'GET';
    const cuerpo = typeof init.body === 'string' ? JSON.parse(init.body) : {};
    pedidos.push({ metodo, ruta, cuerpo });
    return responder(metodo, ruta, cuerpo);
  }));
  let ultimo: Blob | null = null;
  vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: (b: Blob) => { ultimo = b; return 'blob:x'; }, revokeObjectURL: () => {} }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { descargas.push({ nombre: this.download, contenido: ultimo!.text() }); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const escribir = (sel: string, v: string): Promise<boolean> => fireEvent.input(document.querySelector(sel)!, { target: { value: v } });
const boton = (nombre: string | RegExp): HTMLButtonElement => screen.getByRole('button', { name: nombre }) as HTMLButtonElement;

describe('P7: asistente', () => {
  it('cinco pasos con el motivo al lado de «Siguiente»; crear → la credencial y el tópico UNA vez con «Copiar»; luego espera la primera trama en vivo', async () => {
    const copiado: string[] = [];
    vi.stubGlobal('navigator', { clipboard: { writeText: async (s: string) => { copiado.push(s); } } });
    responder = (metodo, ruta) => (metodo === 'POST' && ruta === '/dispositivos'
      ? json({ id: NUEVO, id_fisico: 'nodo-1', nombre: 'Nodo uno', conexion: { via: 'mqtt', usuario: 'nodo-1', credencial: 'Cred-una-vez-123', topico: 'uct/nodo-1/senml', ejemplo: {} } }, 201)
      : json([]));
    render(Alta, { sesion: SESION, sitios: SITIOS });
    expect(document.querySelector('[data-pasos] [aria-current="step"]')!.textContent).toBe('1. Identidad y zona');
    expect(boton('Siguiente').disabled).toBe(true);
    expect(boton('Siguiente').closest('.boton-envoltura')!.textContent).toContain('falta el identificador');
    await escribir('[data-campo="id_fisico"]', 'Nodo_1'); // «_» y mayúscula: la forma de la base no la admite
    expect(boton('Siguiente').disabled).toBe(true);
    await escribir('[data-campo="id_fisico"]', 'nodo-1');
    await escribir('[data-campo="nombre"]', 'Nodo uno');
    await fireEvent.click(boton('Siguiente'));
    expect(document.querySelector('[data-paso="2"]')).toBeTruthy();
    await fireEvent.click(boton('Siguiente'));
    await escribir('[data-campo="canal"]', 'temperatura');
    await fireEvent.click(boton('Crear el dispositivo'));
    await waitFor(() => expect(document.querySelector('[data-credencial]')?.textContent).toBe('Cred-una-vez-123'));
    expect(pedidos.find((p) => p.metodo === 'POST')!.cuerpo).toEqual({ id_fisico: 'nodo-1', nombre: 'Nodo uno', zona_id: 'z-lab', via: 'mqtt', formato: 'senml', intervalo_esperado_s: 300, canales: [{ magnitud: 'temperatura' }] });
    expect(document.querySelector('[data-credencial-una-vez]')!.textContent).toContain('La credencial no se vuelve a mostrar');
    await fireEvent.click(boton('Copiar la credencial'));
    await waitFor(() => expect(copiado).toEqual(['Cred-una-vez-123']));
    await fireEvent.click(boton('Ya la guardé: esperar la primera trama'));
    expect(document.body.textContent).not.toContain('Cred-una-vez-123'); // fuera de la página al pasar al paso 5
    expect(document.querySelector('[data-esperando]')).toBeTruthy();
    const f = Fuente.todas.at(-1)!;
    expect(f.url).toBe(`/eventos?dispositivo=${NUEVO}`);
    f.onopen?.(new Event('open'));
    f.oyentes.get('visto')!(new MessageEvent('visto', { data: JSON.stringify({ dispositivo_id: NUEVO, tiempo: '2026-11-11T12:00:00Z' }) }));
    await waitFor(() => expect(document.querySelector('[data-primera-trama]')).toBeTruthy());
    expect(f.readyState).toBe(2); // ya llegó: el canal se cierra
  });

  it('un identificador que ya existe (409) no crea un duplicado: lo dice y remite al inventario; un detectado llega con su identificador escrito', async () => {
    responder = (metodo) => (metodo === 'POST' ? json({ statusCode: 409, message: 'id_fisico «nodo-9» ya existe' }, 409) : json([]));
    render(Alta, { sesion: SESION, sitios: SITIOS, idFisico: 'nodo-9', sitio: 'uct' });
    expect((document.querySelector('[data-campo="id_fisico"]') as HTMLInputElement).value).toBe('nodo-9');
    await escribir('[data-campo="nombre"]', 'Nueve');
    await fireEvent.click(boton('Siguiente'));
    await fireEvent.click(boton('Siguiente'));
    await escribir('[data-campo="canal"]', 'humedad');
    await fireEvent.click(boton('Crear el dispositivo'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('id_fisico «nodo-9» ya existe. Si está en mantenimiento o dado de baja'));
    expect(document.querySelector('[data-credencial]')).toBeNull();
  });
});

// Accesibilidad y secretos del asistente (revisión del 11/11/2026).
describe('P7: foco, errores por campo y credenciales que no quedan', () => {
  it('cada paso tiene su encabezado «Paso N de 5: …» y recibe el foco al cambiar de paso (también el de la credencial); al cargar, no', async () => {
    responder = (metodo, ruta) => (metodo === 'POST' && ruta === '/dispositivos'
      ? json({ id: NUEVO, id_fisico: 'nodo-1', nombre: 'Nodo uno', conexion: { via: 'http', token: 'Tok-una-vez', nota: '' } }, 201) : json([]));
    render(Alta, { sesion: SESION, sitios: SITIOS });
    const titulo = (): HTMLElement => document.querySelector('[data-titulo-paso]')!;
    expect(titulo().textContent).toBe('Paso 1 de 5: Identidad y zona');
    expect(titulo().tagName).toBe('H4');
    expect(titulo().getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).not.toBe(titulo());
    await escribir('[data-campo="id_fisico"]', 'nodo-1');
    await escribir('[data-campo="nombre"]', 'Nodo uno');
    await fireEvent.click(boton('Siguiente'));
    await waitFor(() => expect(document.activeElement).toBe(titulo()));
    expect(titulo().textContent).toBe('Paso 2 de 5: Vía y formato');
    await fireEvent.click(boton('Siguiente'));
    await escribir('[data-campo="canal"]', 'temperatura');
    await fireEvent.click(boton('Crear el dispositivo'));
    await waitFor(() => expect(titulo().textContent).toBe('Paso 4 de 5: Credencial'));
    await waitFor(() => expect(document.activeElement).toBe(titulo()));
  });

  it('nombre, sitio y zona (y el identificador) ligan su error con aria-describedby; el error aparece al dejar el campo', async () => {
    render(Alta, { sesion: SESION, sitios: SITIOS });
    for (const [campo, error] of [['id_fisico', 'idf-error'], ['nombre', 'nombre-error'], ['sitio', 'sitio-error'], ['zona', 'zona-error']] as const) {
      const el = document.querySelector(`[data-campo="${campo}"]`)!;
      expect(el.getAttribute('aria-describedby')!.split(' ').some((id) => id.endsWith(error) && document.getElementById(id) !== null)).toBe(true);
    }
    const nombre = document.querySelector('[data-campo="nombre"]')!;
    expect(nombre.getAttribute('aria-invalid')).toBe('false');
    await fireEvent.blur(nombre);
    await waitFor(() => expect(nombre.getAttribute('aria-invalid')).toBe('true'));
    const id = nombre.getAttribute('aria-describedby')!;
    expect(document.getElementById(id)!.textContent).toBe('Escribe un nombre de 1 a 80 caracteres.');
    await escribir('[data-campo="nombre"]', 'Nodo');
    expect(document.getElementById(id)!.textContent).toBe('');
  });

  it('un CSV de más de 1 MB se rechaza por su tamaño ANTES de leerlo (no se carga entero en memoria)', async () => {
    const leer = vi.spyOn(Blob.prototype, 'text');
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await fireEvent.change(document.querySelector('[data-archivo]')!, { target: { files: [new File(['x'.repeat(1_000_001)], 'enorme.csv')] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('pesa más de 1 MB'));
    expect(leer).not.toHaveBeenCalled();
  });

  it('la credencial del asistente se olvida al perder la sesión; cerrar la pestaña con credenciales del lote sin descargar pide confirmar', async () => {
    responder = (metodo, ruta) => (metodo === 'POST' && ruta === '/dispositivos'
      ? json({ id: NUEVO, id_fisico: 'nodo-1', nombre: 'Nodo uno', conexion: { via: 'http', token: 'Tok-una-vez', nota: '' } }, 201)
      : ruta === '/perdida' ? json({ statusCode: 401, message: 'sesión requerida' }, 401) : json([]));
    render(Alta, { sesion: SESION, sitios: SITIOS });
    await escribir('[data-campo="id_fisico"]', 'nodo-1');
    await escribir('[data-campo="nombre"]', 'Nodo uno');
    await fireEvent.click(boton('Siguiente'));
    await fireEvent.click(boton('Siguiente'));
    await escribir('[data-campo="canal"]', 'temperatura');
    await fireEvent.click(boton('Crear el dispositivo'));
    await waitFor(() => expect(document.body.textContent).toContain('Tok-una-vez'));
    const { obtener } = await import('./lib/api');
    await obtener('/perdida').catch(() => undefined); // un 401 central: el cliente HTTP avisa «sin_sesion»
    await waitFor(() => expect(document.body.textContent).not.toContain('Tok-una-vez'));
    cleanup();
    responder = (metodo, ruta, cuerpo) => (ruta.startsWith('/dispositivos/lote')
      ? json({ validas: 1, rechazadas: 0, existentes: 0, filas: cuerpo.filas!.map((f, i) => ({ n: i + 2, id_fisico: f.id_fisico, resultado: ruta.endsWith('crear') ? 'creada' : 'valida', motivo: null, id: 'x', credencial: ruta.endsWith('crear') ? 'c-1' : null, topico: null })) })
      : json([]));
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await fireEvent.change(document.querySelector('[data-archivo]')!, { target: { files: [new File(['id_fisico,nombre,zona,via,formato,intervalo_esperado_s,canales,pasarela\nn-1,Uno,Lab,mqtt,senml,60,temperatura:Cel,'], 'uno.csv')] } });
    await waitFor(() => expect(boton('Validar el archivo')).toBeTruthy());
    await fireEvent.click(boton('Validar el archivo'));
    await waitFor(() => expect(boton('Crear las válidas (1)')).toBeTruthy());
    await fireEvent.click(boton('Crear las válidas (1)'));
    await waitFor(() => expect(document.querySelector('[data-credenciales-lote]')).toBeTruthy());
    const salir = (): boolean => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    expect(salir()).toBe(true);
    await fireEvent.click(boton('Descargar credenciales (CSV)'));
    expect(salir()).toBe(false);
  });
});

describe('P7: alta masiva por tandas (D-103 A)', () => {
  const CAB = 'id_fisico,nombre,zona,via,formato,intervalo_esperado_s,canales,pasarela';
  const filasCsv = (n: number): string => Array.from({ length: n }, (_, i) => `n-${i + 1},Nodo ${i + 1},Lab,mqtt,senml,60,temperatura:Cel,`).join('\n');
  const informe = (filas: { id_fisico: string }[], modo: string) => ({
    validas: 0, rechazadas: 0, existentes: 0,
    filas: filas.map((f, i) => (f.id_fisico === 'n-122'
      ? { n: i + 2, id_fisico: f.id_fisico, resultado: 'rechazada', motivo: 'zona «Lab» no existe en tus sitios', id: null, credencial: null, topico: null }
      : { n: i + 2, id_fisico: f.id_fisico, resultado: modo === 'crear' ? 'creada' : 'valida', motivo: null, id: modo === 'crear' ? `id-${f.id_fisico}` : null, credencial: modo === 'crear' ? `c-${f.id_fisico}` : null, topico: modo === 'crear' ? `uct/${f.id_fisico}/senml` : null })),
  });

  it('valida el archivo entero (no crea nada) y crea 120 válidas en 3 tandas; la segunda falla: se detiene con 50 creadas, ofrece reintentar las 70 restantes y las credenciales se descargan una vez', async () => {
    let tandas = 0;
    let fallar = true;
    responder = (metodo, ruta, cuerpo) => {
      if (ruta === '/dispositivos/lote?modo=validar') return json(informe(cuerpo.filas!, 'validar'));
      if (ruta === '/dispositivos/lote?modo=crear') {
        tandas++;
        if (tandas === 2 && fallar) return json({ statusCode: 502, message: 'Bad Gateway' }, 502);
        return json(informe(cuerpo.filas!, 'crear'));
      }
      return json([]);
    };
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    const archivo = new File([`${CAB}\n${filasCsv(121)}\nn-122,Mala,Lab,mqtt,senml,60,temperatura,`], 'nodos.csv', { type: 'text/csv' });
    await fireEvent.change(document.querySelector('[data-archivo]')!, { target: { files: [archivo] } });
    await waitFor(() => expect(document.querySelector('[data-filas-leidas]')!.textContent).toBe('nodos.csv: 122 filas leídas.'));
    await fireEvent.click(boton('Validar el archivo'));
    await waitFor(() => expect(document.querySelector('[data-resumen-lote]')).toBeTruthy());
    expect(pedidos.filter((p) => p.ruta.startsWith('/dispositivos/lote'))).toHaveLength(1); // validar va completo, una sola petición
    expect(pedidos[0]!.cuerpo.filas).toHaveLength(122);
    expect(document.querySelector('[data-resumen-lote]')!.textContent).toContain('Válidas 121 · creadas 0 · rechazadas 1');
    expect(document.querySelector('[data-fila-lote="123"]')!.getAttribute('data-resultado')).toBe('rechazada');
    await fireEvent.click(boton('Crear las válidas (121)'));
    await waitFor(() => expect(boton('Reintentar las restantes (71)')).toBeTruthy());
    const crear = pedidos.filter((p) => p.ruta === '/dispositivos/lote?modo=crear');
    expect(crear.map((p) => p.cuerpo.filas!.length)).toEqual([50, 50]);
    expect(crear[1]!.cuerpo.filas![0]!.id_fisico).toBe('n-51');
    expect(screen.getByRole('alert').textContent).toMatch(/Se detuvo en la tanda que empieza en la fila 52: .*Se crearon 50 de 121; las 71 restantes no se tocaron\./);
    expect(document.querySelector('[data-fila-lote="51"]')!.getAttribute('data-resultado')).toBe('creada');
    expect(document.querySelector('[data-fila-lote="52"]')!.getAttribute('data-resultado')).toBe('valida');
    expect(document.querySelector('[data-credenciales-lote]')!.textContent).toContain('50 credenciales');
    expect(document.body.textContent).not.toContain('c-n-1'); // las credenciales no se dibujan: se descargan
    fallar = false;
    await fireEvent.click(boton('Reintentar las restantes (71)'));
    await waitFor(() => expect(document.querySelector('[data-resumen-lote]')!.textContent).toContain('creadas 121'));
    expect(pedidos.filter((p) => p.ruta === '/dispositivos/lote?modo=crear').map((p) => p.cuerpo.filas!.length)).toEqual([50, 50, 50, 21]);
    expect(boton('Ya las guardé: olvidarlas').disabled).toBe(true); // primero, descargarlas
    await fireEvent.click(boton('Descargar credenciales (CSV)'));
    expect(descargas[0]!.nombre).toMatch(/^credenciales-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = (await descargas[0]!.contenido).split('\r\n');
    expect(csv[0]).toBe('id_fisico,id,credencial,topico');
    expect(csv.filter((l) => l.startsWith('n-'))).toHaveLength(121);
    await fireEvent.click(boton('Descargar rechazadas'));
    expect((await descargas[1]!.contenido).split('\r\n')[1]).toBe('n-122,Mala,Lab,mqtt,senml,60,temperatura,,zona «Lab» no existe en tus sitios');
    await fireEvent.click(boton('Ya las guardé: olvidarlas'));
    expect(document.querySelector('[data-credenciales-lote]')).toBeNull();
  });

  it('un archivo con la cabecera mal o con más de 500 filas se rechaza en el navegador, sin enviar nada', async () => {
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await fireEvent.change(document.querySelector('[data-archivo]')!, { target: { files: [new File([`${CAB}\n${filasCsv(501)}`], 'grande.csv')] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('el archivo trae 501 filas y el máximo es 500'));
    expect(screen.queryByRole('button', { name: 'Validar el archivo' })).toBeNull();
    expect(pedidos.filter((p) => p.ruta.startsWith('/dispositivos/lote'))).toEqual([]);
  });
});

describe('P7: bandeja de detectados', () => {
  it('lista lo que habla sin alta, con tramas y la última; «Dar de alta» lleva al asistente con el identificador; vacía, lo dice', async () => {
    responder = (_m, ruta) => (ruta === '/cuarentena/detectados' ? json([{ sitio_codigo: 'uct', emisor: 'nodo-raro', topico: 'uct/nodo-raro/senml', tramas: 12, ultima: '2026-11-11T12:00:00Z' }]) : json([]));
    render(Alta, { modo: 'detectados', sesion: SESION, sitios: SITIOS });
    await waitFor(() => expect(document.querySelector('[data-detectado="nodo-raro"]')).toBeTruthy());
    expect(document.querySelector('[data-detectado="nodo-raro"]')!.textContent).toContain('12');
    await fireEvent.click(boton('Dar de alta'));
    expect(window.location.hash).toBe('#/alta?id_fisico=nodo-raro&sitio=uct');
    cleanup();
    responder = () => json([]);
    render(Alta, { modo: 'detectados', sesion: SESION, sitios: SITIOS });
    await waitFor(() => expect(document.querySelector('[data-sin-detectados]')).toBeTruthy());
    history.replaceState(null, '', '#/');
  });
});
