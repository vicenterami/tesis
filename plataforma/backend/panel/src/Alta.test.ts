// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sesion } from './lib/sesion';
import Alta from './Alta.svelte';
import { borradorLote } from './lib/lote';

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
let responder: (metodo: string, ruta: string, cuerpo: CuerpoLote) => Response | Promise<Response>;
const COLS = ['id_fisico', 'nombre', 'zona', 'via', 'formato', 'intervalo_esperado_s', 'canales', 'pasarela', 'decodificador'];
const OBLIGATORIAS = ['id_fisico', 'nombre', 'zona', 'intervalo_esperado_s', 'canales'];
const PLANTILLA = {
  columnas: COLS.map((nombre) => ({ nombre, obligatoria: OBLIGATORIAS.includes(nombre), tope: 80, ayuda: '', ejemplo: '' })),
  max_filas: 500, max_bytes: 1_147_904, separadores: { columnas: [';', ',', '\t'], canales: ['|', ';'] },
};
let descargas: { nombre: string; contenido: Promise<string>; bytes: Promise<ArrayBuffer> }[] = [];

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
  Object.assign(borradorLote, { archivo: null, filas: [], aviso: null }); // el borrador de la pestaña no pasa de una prueba a otra
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
    return await responder(metodo, ruta, cuerpo);
  }));
  let ultimo: Blob | null = null;
  vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: (b: Blob) => { ultimo = b; return 'blob:x'; }, revokeObjectURL: () => {} }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { descargas.push({ nombre: this.download, contenido: ultimo!.text(), bytes: ultimo!.arrayBuffer() }); });
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
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('y el máximo es 1,1 MB: divídelo'));
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
    await waitFor(() => expect(boton('Revisar las filas')).toBeTruthy());
    await fireEvent.click(boton('Revisar las filas'));
    await waitFor(() => expect(boton('Crear 1 dispositivo')).toBeTruthy());
    await fireEvent.click(boton('Crear 1 dispositivo'));
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
    await fireEvent.click(boton('Revisar las filas'));
    await waitFor(() => expect(document.querySelector('[data-paso-lote="2"]')).toBeTruthy());
    const validar = pedidos.filter((p) => p.ruta.startsWith('/dispositivos/lote?'));
    expect(validar).toHaveLength(1); // validar va completo, una sola petición
    expect(validar[0]!.cuerpo.filas!.map((f) => f.n).slice(58, 62)).toEqual([60, 61, 63, 64]); // la fila vacía (la 62) cuenta
    expect([1, 121].map((_, i) => document.querySelector(`[data-filtro-lote="${['rechazada', 'valida'][i]}"] [data-cifra]`)!.textContent)).toEqual(['1', '121']);
    expect(document.querySelector('[data-fila-lote="124"]')!.getAttribute('data-resultado')).toBe('rechazada');
    await fireEvent.click(boton('Descargar las que no entran (CSV)')); // la descarga de las que no entran es de la revisión
    expect(descargas[0]!.nombre).toBe('no-entran-nodos.csv');
    expect(await descargas[0]!.contenido).toBe('id_fisico;nombre;zona;via;formato;intervalo_esperado_s;canales;pasarela;decodificador;fila;motivo\r\nn-122;Mala;Lab;mqtt;senml;60;temperatura;;;124;zona «Lab» no existe en tus sitios\r\n');
    expect([...new Uint8Array(await descargas[0]!.bytes).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM
    await fireEvent.click(boton('Crear 121 dispositivos'));
    await waitFor(() => expect(document.querySelector('[data-resultado-lote]')!.textContent).toContain('Se crearon 121 dispositivos'), { timeout: 4000 });
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
    expect(descargas[1]!.nombre).toMatch(/^credenciales-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = (await descargas[1]!.contenido).split('\r\n');
    expect(csv[0]).toBe('id_fisico,id,credencial,topico');
    expect(csv.filter((l) => l.startsWith('n-'))).toHaveLength(121);
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
    await waitFor(() => expect(boton('Revisar las filas')).toBeTruthy());
    await fireEvent.click(boton('Revisar las filas'));
    await waitFor(() => expect(boton('Crear 3 dispositivos')).toBeTruthy());
    await fireEvent.click(boton('Crear 3 dispositivos'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Cambió algo desde que lo revisaste y no se creó ninguno'));
    expect(document.querySelector('[data-detalles-error]')!.textContent).toContain('Fila 3 (n-2): se crea → no entra: la pasarela ug65 está dada de baja');
    expect(document.activeElement).toBe(document.querySelector('[data-error-lote="plan_cambio"]')); // el foco va al aviso
    await fireEvent.click(boton('Volver a revisar'));
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('[data-informe-lote]'))); // la revisión, ya con el plan nuevo
    expect(document.querySelector('[data-fila-lote="3"]')!.getAttribute('data-resultado')).toBe('rechazada');
    expect(document.querySelector('[data-credenciales-lote]')).toBeNull();
    await fireEvent.click(boton('Crear 2 dispositivos'));
    await waitFor(() => expect(document.body.textContent).toContain('Hay otra alta por lote en curso'));
    const pedidasCrear = pedidos.filter((p) => p.ruta === '/dispositivos/lote?modo=crear');
    expect(pedidasCrear.map((p) => [p.cuerpo.huella, p.cuerpo.filas!.map((f) => f.n)])).toEqual([[HUELLA, [2, 3, 4]], ['b'.repeat(64), [2, 4]]]);
    expect(pedidasCrear[0]!.cabeceras['Idempotency-Key']).not.toBe(pedidasCrear[1]!.cabeceras['Idempotency-Key']); // otra creación, otra llave
    await fireEvent.click(boton('Reintentar')); // el remedio hace algo: vuelve a pedir la creación (con el plan de ahora)
    await waitFor(() => expect(pedidos.filter((p) => p.ruta === '/dispositivos/lote?modo=crear')).toHaveLength(3));
  });

  it('si la creación se queda sin respuesta tras los tres intentos, la pantalla dice que puede haberse creado y el remedio (inventario y rotar la credencial)', async () => {
    responder = (metodo, ruta, cuerpo) => (ruta === '/dispositivos/lote?modo=validar' ? json(informe(cuerpo.filas!, 'validar')) : json({ statusCode: 504, message: 'Gateway Timeout' }, 504));
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(`${CAB}\n${filasCsv(2)}`);
    await waitFor(() => expect(boton('Revisar las filas')).toBeTruthy());
    await fireEvent.click(boton('Revisar las filas'));
    await waitFor(() => expect(boton('Crear 2 dispositivos')).toBeTruthy());
    await fireEvent.click(boton('Crear 2 dispositivos'));
    await waitFor(() => expect(document.querySelector('[data-creando-lote]')!.textContent).toContain('no cierres ni recargues la pestaña'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('rota la credencial de cada una desde su ficha'), { timeout: 6000 });
    expect(pedidos.filter((p) => p.ruta === '/dispositivos/lote?modo=crear')).toHaveLength(3);
    await fireEvent.click(boton('Ir al inventario'));
    expect(window.location.hash).toBe('#/inventario');
    history.replaceState(null, '', '#/');
  }, 10_000);

  it('un archivo con la cabecera mal o con más filas que max_filas se rechaza en el navegador, sin enviar nada', async () => {
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(`${CAB}\n${filasCsv(501)}`, 'grande.csv');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('El archivo trae 501 filas y el máximo es 500'));
    expect(screen.queryByRole('button', { name: 'Revisar las filas' })).toBeNull();
    await fireEvent.click(boton('Elegir otro archivo')); // el remedio lleva el foco al campo del archivo
    expect(document.activeElement).toBe(document.querySelector('[data-archivo]'));
    expect(pedidos.filter((p) => p.ruta.startsWith('/dispositivos/lote?'))).toEqual([]);
  });
});

describe('P7: alta masiva, qué falló y qué hacer (docs/19 §4, N8b): lo que se ve y el botón', () => {
  const CAB = 'id_fisico,nombre,zona,via,formato,intervalo_esperado_s,canales,pasarela';
  const HUELLA = 'a'.repeat(64);
  const valido = (filas: { id_fisico: string; n: number }[]) => ({ validas: filas.length, rechazadas: 0, existentes: 0, huella: HUELLA,
    filas: filas.map((f) => ({ n: f.n, id_fisico: f.id_fisico, resultado: 'valida', motivo: null, id: null, credencial: null, topico: null })) });
  const subir = async (texto: string): Promise<void> => {
    await waitFor(() => expect(document.querySelector('[data-archivo]')).toBeTruthy());
    await fireEvent.change(document.querySelector('[data-archivo]')!, { target: { files: [new File([texto], 'nodos.csv', { type: 'text/csv' })] } });
  };
  // [caso, respuesta de crear, el texto que se ve, el botón]
  const AL_CREAR: [string, () => Response, string, string][] = [
    ['sin permiso', () => json({ statusCode: 403, message: 'tu rol no permite hacer cambios' }, 403), 'Tu perfil no permite dar de alta', 'Ir al inventario'],
    ['demasiadas peticiones', () => json({ statusCode: 429, codigo: 'demasiadas_peticiones', reintentar_en_s: 37, message: 'más de 10 lotes en un minuto: reintenta en 37 s' }, 429), 'Espera 37 s y reintenta', 'Reintentar'],
    ['nada creado', () => json({ statusCode: 503, codigo: 'nada_creado', message: 'sin conexión de administración con el broker' }, 503), 'No se creó ninguno: el servidor no logró hablar con el broker', 'Reintentar'],
    ['lote incierto', () => json({ statusCode: 503, codigo: 'lote_incierto', message: 'no se pudo confirmar' }, 503), 'El servidor no pudo confirmar si se crearon', 'Ir al inventario'],
    ['llave reutilizada', () => json({ statusCode: 422, codigo: 'llave_reutilizada', message: 'otra' }, 422), 'se cruzó con una anterior de otro contenido', 'Volver a revisar'],
    ['rechazo del servidor', () => json({ statusCode: 400, codigo: 'cuerpo_invalido', message: ['fila 2: nombre pasa su tope de 80 caracteres (trae 81)'] }, 400), 'El servidor rechazó el archivo', 'Elegir otro archivo'],
  ];
  for (const [caso, respuesta, texto, accion] of AL_CREAR) {
    it(`al crear, ${caso}: el aviso lo dice, con el foco y el botón «${accion}»; el archivo sigue cargado`, async () => {
      responder = (metodo, ruta, cuerpo) => (ruta === '/dispositivos/lote?modo=validar' ? json(valido(cuerpo.filas!)) : respuesta());
      render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
      await subir(`${CAB}\nn-1,Uno,Lab,mqtt,senml,60,temperatura:Cel,`);
      await waitFor(() => expect(boton('Revisar las filas')).toBeTruthy());
      await fireEvent.click(boton('Revisar las filas'));
      await waitFor(() => expect(boton('Crear 1 dispositivo')).toBeTruthy());
      await fireEvent.click(boton('Crear 1 dispositivo'));
      await waitFor(() => expect(document.querySelector('[data-error-lote]')!.textContent).toContain(texto));
      expect(document.querySelector('[data-error-lote]')!.getAttribute('role')).toBe('alert');
      expect(document.activeElement).toBe(document.querySelector('[data-error-lote]'));
      expect(boton(accion)).toBeTruthy();
      expect(document.querySelector('[data-informe-lote]')).toBeTruthy(); // nada se perdió: la revisión sigue ahí
      expect(pedidos.filter((p) => p.ruta === '/dispositivos/lote?modo=crear')).toHaveLength(1); // un fallo con `codigo` no se repite
    });
  }
  it('un 409 que llega en un reintento no dice «no se creó ninguno»: dice que no se sabe y lleva al inventario', async () => {
    let n = 0;
    responder = (metodo, ruta, cuerpo) => {
      if (ruta === '/dispositivos/lote?modo=validar') return json(valido(cuerpo.filas!));
      n++;
      return n === 1 ? json({ statusCode: 502, message: 'Bad Gateway' }, 502) : json({ statusCode: 409, codigo: 'plan_cambio', message: 'cambió', plan: { ...valido(cuerpo.filas!), filas: [] } }, 409);
    };
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(`${CAB}\nn-1,Uno,Lab,mqtt,senml,60,temperatura:Cel,`);
    await waitFor(() => expect(boton('Revisar las filas')).toBeTruthy());
    await fireEvent.click(boton('Revisar las filas'));
    await waitFor(() => expect(boton('Crear 1 dispositivo')).toBeTruthy());
    await fireEvent.click(boton('Crear 1 dispositivo'));
    await waitFor(() => expect(document.querySelector('[data-error-lote="sin_respuesta"]')).toBeTruthy(), { timeout: 4000 });
    expect(document.body.textContent).not.toContain('no se creó ninguno');
    await fireEvent.click(boton('Ir al inventario'));
    expect(window.location.hash).toBe('#/inventario');
    history.replaceState(null, '', '#/');
  });
  // [caso, el archivo, el texto que se ve, el botón]
  const AL_LEER: [string, string, string, string][] = [
    ['columna desconocida', `${CAB},color\nn-1,Uno,Lab,,,60,temperatura,,rojo`, 'La columna «color» no es de la plantilla. Las columnas son: id_fisico,', 'Descargar la plantilla'],
    ['falta una obligatoria', 'id_fisico,nombre,zona,canales\nx,y,z,w', 'Falta la columna obligatoria «intervalo_esperado_s»', 'Descargar la plantilla'],
    ['una sola columna', 'id_fisico|nombre|zona\nx|y|z', 'no hay «;», «,» ni tabulador entre las columnas', 'Descargar la plantilla'],
    ['solo la cabecera', `${CAB}\n`, 'ninguna fila de datos', 'Elegir otro archivo'],
    ['vacío', ' ', 'El archivo está vacío', 'Elegir otro archivo'],
    ['celdas de más', `${CAB}\nn-1,Uno,Lab,,,60,temperatura,,sobra`, 'La fila 2 trae 9 celdas y la cabecera 8', 'Elegir otro archivo'],
    ['celda sobre su tope', `${CAB}\nn-1,${'N'.repeat(81)},Lab,,,60,temperatura,`, 'Fila 2, columna «nombre»: tiene 81 caracteres y el máximo es 80', 'Elegir otro archivo'],
    ['carácter no admitido', `${CAB}\nnodo-ñ,Uno,Lab,,,60,temperatura,`, 'Fila 2, columna «id_fisico»: solo admite letras sin acento', 'Elegir otro archivo'],
  ];
  for (const [caso, csv, texto, accion] of AL_LEER) {
    it(`al leer, ${caso}: se ve antes de enviar, con el botón «${accion}»`, async () => {
      render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
      await subir(csv);
      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(texto));
      expect(boton(accion)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Revisar las filas' })).toBeNull();
      expect(pedidos.filter((p) => p.ruta.startsWith('/dispositivos/lote?'))).toEqual([]);
    });
  }
  it('«Descargar la plantilla» descarga la plantilla del servidor', async () => {
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(`${CAB},color\nn-1,Uno,Lab,,,60,temperatura,,rojo`);
    await waitFor(() => expect(boton('Descargar la plantilla')).toBeTruthy());
    await fireEvent.click(boton('Descargar la plantilla'));
    expect(descargas.at(-1)!.nombre).toBe('plantilla-alta-masiva.csv');
    expect((await descargas.at(-1)!.contenido).split('\r\n')[0]).toBe(PLANTILLA.columnas.map((c) => c.nombre).join(';'));
    expect([...new Uint8Array(await descargas.at(-1)!.bytes).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
  it('la sesión vence al validar: el aviso lo dice y, al volver a la pantalla (tras entrar), el archivo leído sigue ahí con su aviso', async () => {
    responder = (metodo, ruta) => (ruta === '/dispositivos/lote?modo=validar' ? json({ statusCode: 401, message: 'sesión requerida' }, 401) : json([]));
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(`${CAB}\nn-1,Uno,Lab,mqtt,senml,60,temperatura:Cel,`);
    await waitFor(() => expect(boton('Revisar las filas')).toBeTruthy());
    await fireEvent.click(boton('Revisar las filas'));
    await waitFor(() => expect(document.querySelector('[data-error-lote="sesion_vencida"]')!.textContent).toContain('Tu sesión venció'));
    expect(boton('Iniciar sesión')).toBeTruthy();
    cleanup(); // la aplicación muestra «Entrar»; al volver, la pantalla se arma de nuevo
    responder = (metodo, ruta, cuerpo) => (ruta === '/dispositivos/lote?modo=validar' ? json(valido(cuerpo.filas!)) : json([]));
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await waitFor(() => expect(document.querySelector('[data-error-lote]')!.textContent).toContain('El archivo leído se conservó'));
    expect(document.querySelector('[data-filas-leidas]')!.textContent).toContain('1 filas leídas');
    await waitFor(() => expect(document.querySelector('[data-archivo]')).toBeTruthy()); // la plantilla volvió a cargarse
    await fireEvent.click(boton('Reintentar'));
    await waitFor(() => expect(boton('Crear 1 dispositivo')).toBeTruthy());
  });
});

describe('P7: alta masiva en tres pasos (docs/19 §4, N7)', () => {
  const CAB = 'id_fisico,nombre,zona,via,formato,intervalo_esperado_s,canales,pasarela';
  const HUELLA = 'c'.repeat(64);
  type Entrada = { id_fisico: string; n: number };
  const interpretada = (id: string, extra: Record<string, unknown> = {}) => ({
    id_fisico: id, nombre: `Nodo ${id}`, sitio: 'uct', zona: 'Zona norte', zona_id: 'z1', via: 'mqtt', formato: 'senml', intervalo_esperado_s: 60,
    canales: [{ magnitud: 'temperatura', nombre: 'Temperatura', unidad: 'Cel' }], pasarela: null, decodificador: null, topico: `uct/${id}/senml`, ...extra,
  });
  // El plan del servidor: `malas` por identificador → motivo; `existen` los que ya están; `avisos` los que traen aviso.
  const plan = (filas: Entrada[], modo: string, o: { malas?: Record<string, string>; existen?: string[]; avisos?: string[]; huella?: string } = {}) => ({
    validas: 0, rechazadas: 0, existentes: 0, huella: o.huella ?? HUELLA,
    filas: filas.map((f) => {
      const base = { n: f.n, id_fisico: f.id_fisico, id: null, credencial: null, topico: null, por_defecto: [] as string[], avisos: [] as { campo: string; texto: string }[], motivos: [] as { campo: string; texto: string }[] };
      if (o.malas?.[f.id_fisico] !== undefined) return { ...base, resultado: 'rechazada', motivo: o.malas[f.id_fisico], interpretada: null, motivos: [{ campo: 'zona', texto: o.malas[f.id_fisico]! }] };
      if (o.existen?.includes(f.id_fisico) === true) return { ...base, resultado: 'existe', motivo: 'ya está dado de alta', interpretada: null, id: `d-${f.id_fisico}`, motivos: [{ campo: 'id_fisico', texto: 'ya está dado de alta' }] };
      const avisos = o.avisos?.includes(f.id_fisico) === true ? [{ campo: 'zona', texto: 'zona «Zona norte» del sitio uct' }] : [];
      return { ...base, resultado: modo === 'crear' ? 'creada' : 'valida', motivo: null, interpretada: interpretada(f.id_fisico), por_defecto: ['via', 'formato'], avisos,
        id: modo === 'crear' ? `id-${f.id_fisico}` : null, credencial: modo === 'crear' ? `c-${f.id_fisico}` : null, topico: modo === 'crear' ? `uct/${f.id_fisico}/senml` : null };
    }),
  });
  const csv = (n: number): string => `${CAB}\n${Array.from({ length: n }, (_, i) => `n-${i + 1},Nodo ${i + 1},Lab,mqtt,senml,60,temperatura:Cel,`).join('\n')}`;
  const subir = async (texto: string, nombre = 'nodos.csv'): Promise<void> => {
    await waitFor(() => expect(document.querySelector('[data-archivo]')).toBeTruthy());
    await fireEvent.change(document.querySelector('[data-archivo]')!, { target: { files: [new File([texto], nombre)] } });
  };
  const revisar = async (): Promise<void> => {
    await waitFor(() => expect(boton('Revisar las filas')).toBeTruthy());
    await fireEvent.click(boton('Revisar las filas'));
    await waitFor(() => expect(document.querySelector('[data-paso-lote="2"]')).toBeTruthy());
  };
  const filas = (): string[] => [...document.querySelectorAll('[data-fila-lote]')].map((e) => e.getAttribute('data-fila-lote')!);

  it('origen → revisión → resultado, con el foco en el encabezado de cada paso; abre en «No entran»; las credenciales se descargan una vez', async () => {
    responder = (_m, ruta, cuerpo) => (ruta.endsWith('modo=validar') ? json(plan(cuerpo.filas!, 'validar', { malas: { 'n-3': 'zona vacía' } })) : json(plan(cuerpo.filas!, 'crear')));
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await waitFor(() => expect(document.querySelector('[data-paso-lote="1"]')).toBeTruthy());
    expect(document.querySelector('[data-pasos-lote] [aria-current="step"]')!.textContent).toBe('1. Origen');
    await waitFor(() => expect(document.querySelector('[data-plantilla-lote]')).toBeTruthy());
    expect(document.querySelector('[data-plantilla-lote]')!.textContent).toContain('Hasta 500 filas y 1,1 MB'); // los límites salen de la API
    await subir(csv(3));
    await revisar();
    expect(document.querySelector('[data-titulo-paso-lote]')!.textContent).toBe('Paso 2 de 3: Revisión');
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('[data-titulo-paso-lote]')));
    expect(document.querySelector('[data-filtro-lote="rechazada"]')!.getAttribute('aria-pressed')).toBe('true'); // abre con «No entran»
    expect(filas()).toEqual(['4']);
    expect(document.querySelector('[data-fila-lote="4"]')!.textContent).toContain('No entra: zona vacía');
    expect(pedidos.filter((p) => p.ruta.endsWith('modo=crear'))).toHaveLength(0);
    await fireEvent.click(boton('Crear 2 dispositivos'));
    await waitFor(() => expect(document.querySelector('[data-paso-lote="3"]')).toBeTruthy());
    expect(document.querySelector('[data-resultado-lote]')!.textContent).toBe('Se crearon 2 dispositivos.');
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('[data-titulo-paso-lote]')));
    expect(document.querySelector('[data-credenciales-lote]')!.textContent).toContain('2 credenciales');
    expect(document.body.textContent).not.toContain('c-n-1');
    expect(boton('Dar de alta otro lote').disabled).toBe(true); // las credenciales sin descargar no se pierden por un clic
    await fireEvent.click(boton('Descargar credenciales (CSV)'));
    expect((await descargas[0]!.contenido).split('\r\n').filter((l) => l.startsWith('n-'))).toHaveLength(2);
    await fireEvent.click(boton('Ya las guardé: olvidarlas'));
    expect(document.querySelector('[data-credenciales-lote]')).toBeNull();
    await fireEvent.click(boton('Dar de alta otro lote'));
    expect(document.querySelector('[data-paso-lote="1"]')).toBeTruthy();
    expect(document.querySelector('[data-filas-leidas]')).toBeNull();
  });

  it('las cinco tarjetas son botones con aria-pressed y cada una muestra exactamente las filas que cuenta', async () => {
    responder = (_m, ruta, cuerpo) => json(plan(cuerpo.filas!, 'validar', { malas: { 'n-2': 'zona vacía' }, existen: ['n-3', 'n-4'], avisos: ['n-1', 'n-3', 'n-5'] }));
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(csv(6));
    await revisar();
    const tarjetas = [...document.querySelectorAll('[data-filtro-lote]')];
    expect(tarjetas.map((t) => t.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['6 Leídas', '3 Se crean', '2 Ya existen', '1 No entran', '2 Con aviso']);
    expect(tarjetas.every((t) => t.tagName === 'BUTTON' && t.hasAttribute('aria-pressed'))).toBe(true);
    for (const id of ['leidas', 'valida', 'existe', 'rechazada', 'aviso']) {
      await fireEvent.click(document.querySelector(`[data-filtro-lote="${id}"]`)!);
      expect(document.querySelector(`[data-filtro-lote="${id}"]`)!.getAttribute('aria-pressed')).toBe('true');
      expect(tarjetas.filter((t) => t.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
      expect(filas()).toHaveLength(Number(document.querySelector(`[data-filtro-lote="${id}"] [data-cifra]`)!.textContent));
    }
    expect(filas()).toEqual(['2', '6']); // las filas de n-1 y n-5
    expect(document.querySelector('[data-avisos-lote]')!.textContent).toContain('2 filas que se crean traen avisos');
    await fireEvent.click(boton('Ver las filas con aviso'));
    expect(document.querySelector('[data-filtro-lote="aviso"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('«Crear N dispositivos» se desactiva mientras su petición está en vuelo y un segundo clic no manda otra', async () => {
    let soltar: (r: Response) => void = () => undefined;
    responder = (_m, ruta, cuerpo) => (ruta.endsWith('modo=validar') ? json(plan(cuerpo.filas!, 'validar')) : new Promise<Response>((ok) => { soltar = (r) => ok(r); soltarCuerpo = cuerpo; }));
    let soltarCuerpo: CuerpoLote = {};
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(csv(2));
    await revisar();
    const crear = boton('Crear 2 dispositivos');
    await fireEvent.click(crear);
    await waitFor(() => expect(crear.disabled).toBe(true));
    expect(crear.getAttribute('aria-busy')).toBe('true');
    expect(crear.textContent).toBe('Creando…');
    await fireEvent.click(crear);
    await fireEvent.click(crear);
    expect(pedidos.filter((p) => p.ruta.endsWith('modo=crear'))).toHaveLength(1);
    soltar(json(plan(soltarCuerpo.filas!, 'crear')));
    await waitFor(() => expect(document.querySelector('[data-paso-lote="3"]')).toBeTruthy());
    expect(pedidos.filter((p) => p.ruta.endsWith('modo=crear'))).toHaveLength(1);
  });

  it('«Volver» conserva el origen: lo leído, lo pegado y el nombre; «Revisar las filas» lo revisa de nuevo', async () => {
    responder = (_m, ruta, cuerpo) => json(plan(cuerpo.filas!, 'validar'));
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await waitFor(() => expect(document.querySelector('[data-pegado]')).toBeTruthy());
    await escribir('[data-pegado]', csv(2).replaceAll(',', '\t'));
    await fireEvent.click(boton('Leer lo pegado'));
    expect(document.querySelector('[data-filas-leidas]')!.textContent).toBe('Lo pegado: 2 filas leídas.');
    await revisar();
    await fireEvent.click(boton('Volver'));
    await waitFor(() => expect(document.querySelector('[data-paso-lote="1"]')).toBeTruthy());
    expect(document.querySelector('[data-filas-leidas]')!.textContent).toBe('Lo pegado: 2 filas leídas.');
    expect((document.querySelector('[data-pegado]') as HTMLTextAreaElement).value).toBe(csv(2).replaceAll(',', '\t'));
    await revisar();
    expect(pedidos.filter((p) => p.ruta.endsWith('modo=validar'))).toHaveLength(2);
  });

  it('el mismo lote por archivo CSV, pegado desde la planilla y JSON manda las mismas filas (con la fila vacía contada en el CSV)', async () => {
    responder = (_m, _r, cuerpo) => json(plan(cuerpo.filas!, 'validar'));
    const texto = `${CAB}\nn-1,Uno,Lab,mqtt,senml,60,temperatura:Cel,\n\nn-2,Dos,Lab,mqtt,senml,60,temperatura:Cel,`;
    const lista = [{ id_fisico: 'n-1', nombre: 'Uno', zona: 'Lab', via: 'mqtt', formato: 'senml', intervalo_esperado_s: 60, canales: 'temperatura:Cel' }, { id_fisico: 'n-2', nombre: 'Dos', zona: 'Lab', via: 'mqtt', formato: 'senml', intervalo_esperado_s: 60, canales: 'temperatura:Cel' }];
    const enviadas: unknown[] = [];
    for (const origen of ['csv', 'pegado', 'json'] as const) {
      render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
      if (origen === 'csv') await subir(texto);
      else if (origen === 'json') await subir(JSON.stringify(lista), 'nodos.json');
      else {
        await waitFor(() => expect(document.querySelector('[data-pegado]')).toBeTruthy());
        await escribir('[data-pegado]', texto.replaceAll(',', '\t'));
        await fireEvent.click(boton('Leer lo pegado'));
      }
      await revisar();
      enviadas.push(pedidos.filter((p) => p.ruta.endsWith('modo=validar')).at(-1)!.cuerpo.filas!.map(({ n, ...f }) => ({ ...f, n })));
      cleanup();
      Object.assign(borradorLote, { archivo: null, filas: [], aviso: null });
    }
    expect(enviadas[1]).toEqual(enviadas[0]);
    expect((enviadas[0] as { n: number }[]).map((f) => f.n)).toEqual([2, 4]);
    expect((enviadas[2] as Record<string, unknown>[]).map(({ n: _n, ...f }) => f)).toEqual((enviadas[0] as Record<string, unknown>[]).map(({ n: _n, ...f }) => f));
  });

  it('250 filas dibujan 100; «Mostrar 100 más» suma de a 100 y desaparece al mostrarlas todas; cambiar de filtro vuelve a 100', async () => {
    responder = (_m, _r, cuerpo) => json(plan(cuerpo.filas!, 'validar', { existen: ['n-1'] }));
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(csv(250));
    await revisar();
    await fireEvent.click(document.querySelector('[data-filtro-lote="leidas"]')!);
    expect(filas()).toHaveLength(100);
    expect(document.querySelector('[data-mostrando]')!.textContent).toContain('Se ven 100 de 250');
    await fireEvent.click(boton('Mostrar 100 más'));
    expect(filas()).toHaveLength(200);
    await fireEvent.click(document.querySelector('[data-filtro-lote="existe"]')!);
    await fireEvent.click(document.querySelector('[data-filtro-lote="leidas"]')!);
    expect(filas()).toHaveLength(100);
    await fireEvent.click(boton('Mostrar 100 más'));
    await fireEvent.click(boton('Mostrar 100 más'));
    expect(filas()).toHaveLength(250);
    expect(screen.queryByRole('button', { name: 'Mostrar 100 más' })).toBeNull();
  });

  it('el detalle de una fila: lo interpretado campo por campo, «por omisión», el aviso junto a su campo y el motivo junto al suyo', async () => {
    responder = (_m, _r, cuerpo) => json(plan(cuerpo.filas!, 'validar', { avisos: ['n-1'], malas: { 'n-2': 'zona vacía' } }));
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(csv(2));
    await revisar();
    await fireEvent.click(document.querySelector('[data-filtro-lote="leidas"]')!);
    expect(document.querySelector('[data-fila-lote="2"]')!.textContent).toContain('Con 1 aviso');
    await fireEvent.click(boton('Ver el detalle de la fila 2'));
    const campo = (c: string): Element => document.querySelector(`[data-detalle-lote="2"] [data-campo-lote="${c}"]`)!;
    expect(campo('zona').textContent).toContain('Zona norte (sitio uct)');
    expect(campo('zona').querySelector('[data-aviso-campo]')!.textContent).toContain('zona «Zona norte» del sitio uct');
    expect(campo('via').querySelector('[data-por-omision]')!.textContent).toBe('por omisión');
    expect(campo('nombre').querySelector('[data-por-omision]')).toBeNull();
    expect(campo('canales').textContent).toContain('temperatura en Cel');
    expect(campo('topico').textContent).toContain('uct/n-1/senml');
    await fireEvent.click(boton('Ver el detalle de la fila 3'));
    expect(document.querySelector('[data-detalle-lote="3"] [data-campo-lote="zona"] [data-motivo-campo]')!.textContent).toContain('zona vacía');
    expect(document.querySelector('[data-detalle-lote="3"] [data-campo-lote="zona"] code')!.textContent).toBe('Lab'); // lo que se escribió
    await fireEvent.click(boton('Ocultar el detalle de la fila 2'));
    expect(document.querySelector('[data-detalle-lote="2"]')).toBeNull();
  });

  it('409 plan_cambio: la revisión muestra el plan nuevo y cuáles cambiaron (de «se crea» a «ya existe» y el formato de otra)', async () => {
    let crear = 0;
    responder = (_m, ruta, cuerpo) => {
      if (ruta.endsWith('modo=validar')) return json(plan(cuerpo.filas!, 'validar'));
      crear++;
      const nuevo = plan(cuerpo.filas!, 'validar', { existen: ['n-1'], huella: 'd'.repeat(64) });
      nuevo.filas = nuevo.filas.map((f) => (f.id_fisico === 'n-2' ? { ...f, interpretada: interpretada('n-2', { formato: 'chirpstack' }) } : f)) as typeof nuevo.filas;
      return json({ statusCode: 409, codigo: 'plan_cambio', message: 'cambió', plan: nuevo }, 409);
    };
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(csv(3));
    await revisar();
    await fireEvent.click(boton('Crear 3 dispositivos'));
    await waitFor(() => expect(document.querySelector('[data-detalles-error]')).toBeTruthy());
    const dichos = document.querySelector('[data-detalles-error]')!.textContent!;
    expect(dichos).toContain('Fila 2 (n-1): se crea → ya existe: ya está dado de alta');
    expect(dichos).toContain('Fila 3 (n-2): sigue entrando, pero cambió formato senml → chirpstack');
    expect(crear).toBe(1);
    expect(document.querySelector('[data-filtro-lote="existe"] [data-cifra]')!.textContent).toBe('1');
    expect(document.querySelector('[data-filtro-lote="valida"] [data-cifra]')!.textContent).toBe('2');
    expect(document.querySelector('[data-paso-lote="2"]')).toBeTruthy(); // sigue en la revisión, con el plan de ahora
    expect(boton('Crear 2 dispositivos')).toBeTruthy();
  });

  it('en teléfono (bajo 700 px) cada fila es una tarjeta, con su detalle, y no hay tabla', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('700px'), media: q, addEventListener() {}, removeEventListener() {} }));
    responder = (_m, _r, cuerpo) => json(plan(cuerpo.filas!, 'validar', { malas: { 'n-2': 'zona vacía' } }));
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(csv(2));
    await revisar();
    expect(document.querySelector('[data-tabla-lote]')).toBeNull();
    expect(document.querySelectorAll('[data-tarjetas-lote] .tarjeta-lote')).toHaveLength(1);
    await fireEvent.click(document.querySelector('[data-filtro-lote="leidas"]')!);
    expect(document.querySelectorAll('[data-tarjetas-lote] .tarjeta-lote')).toHaveLength(2);
    await fireEvent.click(boton('Ver el detalle de la fila 3'));
    expect(document.querySelector('.tarjeta-lote [data-detalle-lote="3"]')).toBeTruthy();
  });

  // ── Correcciones del 16/11/2026 ─────────────────────────────────────────────────────────────────────────────────────────────
  const llegarAlResultado = async (): Promise<void> => {
    responder = (_m, ruta, cuerpo) => json(plan(cuerpo.filas!, ruta.endsWith('modo=crear') ? 'crear' : 'validar'));
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(csv(2));
    await revisar();
    await fireEvent.click(boton('Crear 2 dispositivos'));
    await waitFor(() => expect(document.querySelector('[data-paso-lote="3"]')).toBeTruthy());
  };
  it('con credenciales sin descargar, «Ir al inventario» está desactivado con su motivo y un enlace del menú pide confirmar (sin confirmar, no sale); descargadas, ya no se pregunta', async () => {
    await llegarAlResultado();
    const ir = boton('Ir al inventario');
    expect(ir.disabled).toBe(true);
    expect(ir.closest('.boton-envoltura')!.textContent).toContain('descarga primero las credenciales');
    expect(document.querySelector('[data-nota-credenciales]')!.textContent).toContain('una planilla puede alterar las credenciales que empiezan con «-»');
    const enlace = document.body.appendChild(Object.assign(document.createElement('a'), { href: '#/inventario' }));
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(await fireEvent.click(enlace)).toBe(false); // cancelado: el clic no sigue
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(window.location.hash).not.toBe('#/inventario');
    expect(document.querySelector('[data-credenciales-lote]')).toBeTruthy();
    confirmar.mockReturnValue(true);
    expect(await fireEvent.click(enlace)).toBe(true); // confirmado: sigue
    history.replaceState(null, '', '#/');
    await fireEvent.click(boton('Descargar credenciales (CSV)'));
    confirmar.mockClear();
    expect(await fireEvent.click(enlace)).toBe(true);
    expect(confirmar).not.toHaveBeenCalled();
    expect(boton('Ir al inventario').disabled).toBe(false);
    history.replaceState(null, '', '#/');
  });
  it('cerrar la pestaña mientras la creación está en vuelo pide confirmar; al terminar y descargar, ya no; y «Volver» queda desactivado con su motivo mientras se crea', async () => {
    let soltar: () => void = () => undefined;
    let cuerpoCrear: CuerpoLote = {};
    responder = (_m, ruta, cuerpo) => (ruta.endsWith('modo=validar') ? json(plan(cuerpo.filas!, 'validar')) : new Promise<Response>((ok) => { cuerpoCrear = cuerpo; soltar = () => ok(json(plan(cuerpoCrear.filas!, 'crear'))); }));
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(csv(2));
    await revisar();
    const salir = (): boolean => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    expect(salir()).toBe(false);
    await fireEvent.click(boton('Crear 2 dispositivos'));
    await waitFor(() => expect(boton('Creando…').disabled).toBe(true));
    expect(salir()).toBe(true);
    const volver = boton('Volver');
    expect(volver.disabled).toBe(true);
    expect(volver.closest('.boton-envoltura')!.textContent).toContain('se está creando');
    soltar();
    await waitFor(() => expect(document.querySelector('[data-paso-lote="3"]')).toBeTruthy());
    expect(salir()).toBe(true); // ahora son las credenciales sin descargar
    await fireEvent.click(boton('Descargar credenciales (CSV)'));
    expect(salir()).toBe(false);
  });
  it('la respuesta de una revisión vieja no abre la revisión con las filas de otro origen: cambiar de origen la cancela y la descarta', async () => {
    const respuestas: (() => void)[] = [];
    responder = (_m, _r, cuerpo) => new Promise<Response>((ok) => { respuestas.push(() => ok(json(plan(cuerpo.filas!, 'validar')))); });
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(csv(2), 'a.csv');
    await waitFor(() => expect(boton('Revisar las filas')).toBeTruthy());
    await fireEvent.click(boton('Revisar las filas'));
    await waitFor(() => expect(respuestas).toHaveLength(1));
    await escribir('[data-pegado]', `${CAB.replaceAll(',', '\t')}\notro-1\tOtro\tLab\tmqtt\tsenml\t60\ttemperatura:Cel\t`);
    await fireEvent.click(boton('Leer lo pegado'));
    respuestas[0]!(); // llega la respuesta de «a.csv»
    await new Promise((ok) => setTimeout(ok, 30));
    expect(document.querySelector('[data-paso-lote="2"]')).toBeNull();
    expect(document.querySelector('[data-filas-leidas]')!.textContent).toBe('Lo pegado: 1 filas leídas.');
    expect(boton('Revisar las filas').disabled).toBe(false);
    await fireEvent.click(boton('Revisar las filas'));
    await waitFor(() => expect(respuestas).toHaveLength(2));
    respuestas[1]!();
    await waitFor(() => expect(document.querySelector('[data-paso-lote="2"]')).toBeTruthy());
    expect(filas()).toEqual(['2']);
    expect(document.querySelector('[data-fila-lote="2"]')!.textContent).toContain('otro-1');
  });
  it('un archivo se lee una vez y deja el campo vacío (elegir de nuevo el mismo dispara `change`); una lectura que termina después de otra más nueva se descarta', async () => {
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await waitFor(() => expect(document.querySelector('[data-archivo]')).toBeTruthy());
    const campo = document.querySelector('[data-archivo]') as HTMLInputElement;
    const escritos: string[] = [];
    Object.defineProperty(campo, 'value', { configurable: true, get: () => '', set: (v: string) => { escritos.push(v); } });
    const lenta = new File([csv(2)], 'lenta.csv');
    let terminar: (t: string) => void = () => undefined;
    Object.defineProperty(lenta, 'text', { value: () => new Promise<string>((ok) => { terminar = ok; }) });
    await fireEvent.change(campo, { target: { files: [lenta] } });
    await fireEvent.change(campo, { target: { files: [new File([csv(1)], 'rapida.csv')] } });
    await waitFor(() => expect(document.querySelector('[data-filas-leidas]')!.textContent).toBe('rapida.csv: 1 filas leídas.'));
    terminar(csv(2));
    await new Promise((ok) => setTimeout(ok, 30));
    expect(document.querySelector('[data-filas-leidas]')!.textContent).toBe('rapida.csv: 1 filas leídas.');
    expect(escritos).toEqual(['', '']);
  });
  it('un 500 sin código al crear no ofrece crear de nuevo: se repite con la misma llave y, sin respuesta, manda al inventario a mirar', async () => {
    responder = (_m, ruta, cuerpo) => (ruta.endsWith('modo=validar') ? json(plan(cuerpo.filas!, 'validar')) : json({ statusCode: 500, message: 'Internal Server Error' }, 500));
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(csv(2));
    await revisar();
    await fireEvent.click(boton('Crear 2 dispositivos'));
    await waitFor(() => expect(document.querySelector('[data-error-lote="sin_respuesta"]')).toBeTruthy(), { timeout: 6000 });
    const crear = pedidos.filter((p) => p.ruta.endsWith('modo=crear'));
    expect(crear).toHaveLength(3);
    expect(new Set(crear.map((p) => p.cabeceras['Idempotency-Key'])).size).toBe(1);
    expect(boton('Ir al inventario')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
  }, 10_000);
  it('un error de lectura del origen recibe el foco, como los demás avisos', async () => {
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(`${CAB}\nn-1,"Uno,Lab,,,60,temperatura,`);
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('[data-error-archivo]')));
    expect(document.querySelector('[data-error-archivo]')!.textContent).toContain('Fila 2: comilla sin cerrar.');
  });
  it('«las que no entran» de un archivo llamado «lote (1).csv» se descarga con un nombre propio, no con el de por omisión', async () => {
    responder = (_m, _r, cuerpo) => json(plan(cuerpo.filas!, 'validar', { malas: { 'n-1': 'zona vacía' } }));
    render(Alta, { modo: 'lote', sesion: SESION, sitios: SITIOS });
    await subir(csv(2), 'lote (1).csv');
    await revisar();
    await fireEvent.click(boton('Descargar las que no entran (CSV)'));
    expect(descargas.at(-1)!.nombre).toBe('no-entran-lote 1.csv');
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
