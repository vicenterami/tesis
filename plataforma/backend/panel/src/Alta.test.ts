// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sesion } from './lib/sesion';
import Alta from './Alta.svelte';

// P7 Alta (docs/19 §4, tablero v2, F; docs/16 §61) por el DOM: el asistente con la credencial una sola vez y la espera de la primera trama;
// el alta masiva que lee las columnas y los límites de la plantilla del servidor, valida antes de crear (cada fila con su `n`) y crea en
// UNA petición con la huella y la llave de reintento, repitiendo con la misma llave si la respuesta se pierde y atendiendo el 409 por su `codigo`;
// la bandeja de detectados que lleva al asistente con el identificador.
const SITIOS = [{ id: 's1', codigo: 'uct', nombre: 'Campus', zona_horaria: 'America/Santiago', rol: 'administrador', zonas: [{ id: 'z-lab', nombre: 'Lab' }] }];
const SESION: Sesion = {
  sistema: false, usuario: { id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid' }, clave_temporal: false, expira_en: null, inactividad_vence_en: null,
  sitios: [{ sitio_id: 's1', codigo: 'uct', nombre: 'Campus', rol: 'administrador' }], permisos: { administrador: ['leer', 'escribir', 'configurar'], consulta: ['leer'] },
};
const NUEVO = '00000000-0000-4000-8000-0000000000d1';
const json = (x: unknown, status = 200): Response => new Response(JSON.stringify(x), { status });
type CuerpoLote = { filas?: ({ id_fisico: string; n: number } & Record<string, unknown>)[]; huella?: string } & Record<string, unknown>;
let pedidos: { metodo: string; ruta: string; cuerpo: CuerpoLote; cabeceras: Record<string, string> }[] = [];
let responder: (metodo: string, ruta: string, cuerpo: CuerpoLote) => Response;
const COLS = ['id_fisico', 'nombre', 'zona', 'via', 'formato', 'intervalo_esperado_s', 'canales', 'pasarela', 'decodificador'];
const OBLIGATORIAS = ['id_fisico', 'nombre', 'zona', 'intervalo_esperado_s', 'canales'];
const PLANTILLA = {
  columnas: COLS.map((nombre) => ({ nombre, obligatoria: OBLIGATORIAS.includes(nombre), tope: 80, ayuda: '', ejemplo: '' })),
  max_filas: 500, max_bytes: 1_467_392, separadores: { columnas: [';', ',', '\t'], canales: ['|', ';'] },
};
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
    pedidos.push({ metodo, ruta, cuerpo, cabeceras: (init.headers ?? {}) as Record<string, string> });
    if (ruta === '/dispositivos/lote/plantilla') return json(PLANTILLA);
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

  it('un CSV de más de max_bytes (de la plantilla) se rechaza por su tamaño ANTES de leerlo (no se carga entero en memoria)', async () => {
    const leer = vi.spyOn(Blob.prototype, 'text');
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await waitFor(() => expect(document.querySelector('[data-archivo]')).toBeTruthy());
    await fireEvent.change(document.querySelector('[data-archivo]')!, { target: { files: [new File(['x'.repeat(PLANTILLA.max_bytes + 1)], 'enorme.csv')] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('pesa más de 1,5 MB'));
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
      ? json({ validas: 1, rechazadas: 0, existentes: 0, huella: 'h'.repeat(64), filas: cuerpo.filas!.map((f) => ({ n: f.n, id_fisico: f.id_fisico, resultado: ruta.endsWith('crear') ? 'creada' : 'valida', motivo: null, id: 'x', credencial: ruta.endsWith('crear') ? 'c-1' : null, topico: null })) })
      : json([]));
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await waitFor(() => expect(document.querySelector('[data-archivo]')).toBeTruthy());
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

describe('P7: alta masiva en una petición', () => {
  const CAB = 'id_fisico,nombre,zona,via,formato,intervalo_esperado_s,canales,pasarela';
  const filasCsv = (n: number): string => Array.from({ length: n }, (_, i) => `n-${i + 1},Nodo ${i + 1},Lab,mqtt,senml,60,temperatura:Cel,`).join('\n');
  const HUELLA = 'a'.repeat(64);
  const informe = (filas: { id_fisico: string; n: number }[], modo: string, huella = HUELLA) => ({
    validas: 0, rechazadas: 0, existentes: 0, huella,
    filas: filas.map((f) => (f.id_fisico === 'n-122'
      ? { n: f.n, id_fisico: f.id_fisico, resultado: 'rechazada', motivo: 'zona «Lab» no existe en tus sitios', id: null, credencial: null, topico: null }
      : { n: f.n, id_fisico: f.id_fisico, resultado: modo === 'crear' ? 'creada' : 'valida', motivo: null, id: modo === 'crear' ? `id-${f.id_fisico}` : null, credencial: modo === 'crear' ? `c-${f.id_fisico}` : null, topico: modo === 'crear' ? `uct/${f.id_fisico}/senml` : null })),
  });
  const subir = async (texto: string, nombre = 'nodos.csv'): Promise<void> => {
    await waitFor(() => expect(document.querySelector('[data-archivo]')).toBeTruthy());
    await fireEvent.change(document.querySelector('[data-archivo]')!, { target: { files: [new File([texto], nombre, { type: 'text/csv' })] } });
  };

  it('valida el archivo entero con el `n` de cada fila (una vacía en medio cuenta), crea las 121 válidas en UNA petición con la huella y la llave; si la respuesta se pierde, repite con la misma llave; las credenciales se descargan una vez', async () => {
    let intentos = 0;
    responder = (metodo, ruta, cuerpo) => {
      if (ruta === '/dispositivos/lote?modo=validar') return json(informe(cuerpo.filas!, 'validar'));
      if (ruta === '/dispositivos/lote?modo=crear') {
        intentos++;
        if (intentos === 1) return json({ statusCode: 502, message: 'Bad Gateway' }, 502); // la respuesta se perdió en el camino
        return json(informe(cuerpo.filas!, 'crear'));
      }
      return json([]);
    };
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(`${CAB}\n${filasCsv(60)}\n\n${filasCsv(121).split('\n').slice(60).join('\n')}\nn-122,Mala,Lab,mqtt,senml,60,temperatura,`);
    await waitFor(() => expect(document.querySelector('[data-filas-leidas]')!.textContent).toBe('nodos.csv: 122 filas leídas.'));
    await fireEvent.click(boton('Validar el archivo'));
    await waitFor(() => expect(document.querySelector('[data-resumen-lote]')).toBeTruthy());
    const validar = pedidos.filter((p) => p.ruta.startsWith('/dispositivos/lote?'));
    expect(validar).toHaveLength(1); // validar va completo, una sola petición
    expect(validar[0]!.cuerpo.filas!.map((f) => f.n).slice(58, 62)).toEqual([60, 61, 63, 64]); // la fila vacía (la 62) cuenta
    expect(document.querySelector('[data-resumen-lote]')!.textContent).toContain('Válidas 121 · creadas 0 · rechazadas 1');
    expect(document.querySelector('[data-fila-lote="124"]')!.getAttribute('data-resultado')).toBe('rechazada');
    await fireEvent.click(boton('Crear las válidas (121)'));
    await waitFor(() => expect(document.querySelector('[data-resumen-lote]')!.textContent).toContain('creadas 121'), { timeout: 4000 });
    const crear = pedidos.filter((p) => p.ruta === '/dispositivos/lote?modo=crear');
    expect(crear).toHaveLength(2); // la perdida y su repetición
    expect(crear.map((p) => p.cuerpo.filas!.length)).toEqual([121, 121]);
    expect(crear[0]!.cuerpo.huella).toBe(HUELLA);
    expect(crear[0]!.cabeceras['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(crear[1]!.cabeceras['Idempotency-Key']).toBe(crear[0]!.cabeceras['Idempotency-Key']);
    expect(crear[0]!.cuerpo).toEqual(crear[1]!.cuerpo);
    expect(document.querySelector('[data-credenciales-lote]')!.textContent).toContain('121 credenciales');
    expect(document.body.textContent).not.toContain('c-n-1'); // las credenciales no se dibujan: se descargan
    expect(boton('Ya las guardé: olvidarlas').disabled).toBe(true); // primero, descargarlas
    await fireEvent.click(boton('Descargar credenciales (CSV)'));
    expect(descargas[0]!.nombre).toMatch(/^credenciales-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = (await descargas[0]!.contenido).split('\r\n');
    expect(csv[0]).toBe('id_fisico,id,credencial,topico');
    expect(csv.filter((l) => l.startsWith('n-'))).toHaveLength(121);
    await fireEvent.click(boton('Descargar rechazadas'));
    expect((await descargas[1]!.contenido).split('\r\n')[1]).toBe('n-122,Mala,Lab,mqtt,senml,60,temperatura,,,zona «Lab» no existe en tus sitios');
    await fireEvent.click(boton('Ya las guardé: olvidarlas'));
    expect(document.querySelector('[data-credenciales-lote]')).toBeNull();
  });

  it('409 plan_cambio: no se creó ninguno; el informe pasa al plan nuevo con su huella y lo dice; 409 lote_en_curso, lo dice', async () => {
    let crear = 0;
    responder = (metodo, ruta, cuerpo) => {
      if (ruta === '/dispositivos/lote?modo=validar') return json(informe(cuerpo.filas!, 'validar'));
      crear++;
      if (crear === 1) {
        const plan = informe(cuerpo.filas!, 'validar', 'b'.repeat(64));
        const filas: Record<string, unknown>[] = plan.filas.map((f, i) => (i === 1 ? { ...f, resultado: 'rechazada', motivo: 'la pasarela ug65 está dada de baja' } : f));
        return json({ statusCode: 409, codigo: 'plan_cambio', message: 'el plan cambió', plan: { ...plan, filas } }, 409);
      }
      return json({ statusCode: 409, codigo: 'lote_en_curso', message: 'otra en curso' }, 409);
    };
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(`${CAB}\n${filasCsv(3)}`);
    await waitFor(() => expect(boton('Validar el archivo')).toBeTruthy());
    await fireEvent.click(boton('Validar el archivo'));
    await waitFor(() => expect(boton('Crear las válidas (3)')).toBeTruthy());
    await fireEvent.click(boton('Crear las válidas (3)'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Cambió desde que lo revisaste: no se creó ninguno'));
    expect(document.querySelector('[data-fila-lote="3"]')!.getAttribute('data-resultado')).toBe('rechazada');
    expect(document.querySelector('[data-credenciales-lote]')).toBeNull();
    await fireEvent.click(boton('Crear las válidas (2)'));
    await waitFor(() => expect(document.body.textContent).toContain('Hay otra alta por lote en curso'));
    const pedidasCrear = pedidos.filter((p) => p.ruta === '/dispositivos/lote?modo=crear');
    expect(pedidasCrear.map((p) => [p.cuerpo.huella, p.cuerpo.filas!.map((f) => f.n)])).toEqual([[HUELLA, [2, 3, 4]], ['b'.repeat(64), [2, 4]]]);
    expect(pedidasCrear[0]!.cabeceras['Idempotency-Key']).not.toBe(pedidasCrear[1]!.cabeceras['Idempotency-Key']); // otra creación, otra llave
  });

  it('un archivo con la cabecera mal o con más filas que max_filas se rechaza en el navegador, sin enviar nada', async () => {
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(`${CAB}\n${filasCsv(501)}`, 'grande.csv');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('el archivo trae 501 filas y el máximo es 500'));
    expect(screen.queryByRole('button', { name: 'Validar el archivo' })).toBeNull();
    expect(pedidos.filter((p) => p.ruta.startsWith('/dispositivos/lote?'))).toEqual([]);
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
