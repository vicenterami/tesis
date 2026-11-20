// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnlaceListado } from './lib/enlaces';
import type { Sitio } from './lib/modelo';
import type { VistaPublica } from './lib/publico';
import type { Sesion } from './lib/sesion';

// P9, la pantalla de quien publica (docs/19 §4, O, puntos 2, 3, 4, 10 y 11), por el DOM: la vista previa con sus avisos antes de
// «Publicar», la dirección una sola vez, renovar (con el 409 `acorta`), revocar con confirmación, la línea de lectura del k y del tope (que se cambian en «Ajustes del sitio», P15).
vi.mock('uplot', () => {
  class UPlotFalso {
    constructor(_o: unknown, _d: unknown, el: HTMLElement) { el.appendChild(document.createElement('canvas')); }
    setData(): void {}
    setSize(): void {}
    redraw(): void {}
    setCursor(): void {}
    destroy(): void {}
    static paths = { bars: (): (() => null) => () => null };
    static tzDate(d: Date): Date { return d; }
  }
  return { default: UPlotFalso };
});
vi.mock('uplot/dist/uPlot.min.css', () => ({}));
import Publicar from './Publicar.svelte';

const TOKEN = 'Zz09_-'.repeat(7) + 'Q';
const SITIOS: Sitio[] = [{ id: 's1', codigo: 'uct', nombre: 'Campus', zona_horaria: 'America/Santiago', rol: 'administrador', zonas: [{ id: 'z1', nombre: 'Norte' }, { id: 'z2', nombre: 'Sur' }] }];
const SESION: Sesion = {
  sistema: false, usuario: { id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid' }, clave_temporal: false, expira_en: null, inactividad_vence_en: null,
  sitios: [{ sitio_id: 's1', codigo: 'uct', nombre: 'Campus', rol: 'administrador' }], permisos: { administrador: ['leer', 'enlaces'] },
};
const PREVIA: VistaPublica & { avisos: string[] } = {
  titulo: '', descripcion: null, sitio: 'Campus', zona_horaria: 'America/Santiago', minimo_dispositivos: 3, ventana: '24h', ventanas: ['24h', '7d'],
  intervalo: '5 minutes', desde: '2026-11-16T15:00:00Z', hasta: '2026-11-17T15:00:00Z', ultimo_dato: '2026-11-17T14:55:00Z', tiempos: [1_763_391_000],
  magnitudes: [{ codigo: 'temperatura', nombre: 'Temperatura', unidad: 'Cel', ahora: 21.4, serie: [21.2], protegido: true, zonas: [] }],
  avisos: ['Combinando el total del sitio con las zonas publicadas se puede deducir el promedio de las no publicadas («Sur»).'],
};
const ENLACE: EnlaceListado = {
  id: 'e1', titulo: 'Clima', descripcion: null, magnitudes: [{ codigo: 'temperatura', nombre: 'Temperatura', unidad: 'Cel' }], ventana_maxima: '7d',
  zonas: [{ id: 'z1', nombre: 'Norte' }], creado_por: { id: 'u1', nombre: 'Ana', correo: 'ana@example.org' }, creado_en: '2026-11-10T15:00:00Z', expira_en: '2026-12-17T15:00:00Z',
  renovado_en: null, revocado_en: null, revocado_por: null, accesos_7d: 4, estado: 'vigente', renovable: true, retencion_dias: 90, anonimizado_en: null,
};
let pedidas: { metodo: string; ruta: string; cuerpo: unknown }[] = [];
let crear: () => Response;
let renovarAcorta = true;
let respuestaPrevia: () => Response;
let catalogoFalla = false; // `GET /magnitudes` responde 500 mientras sea true
let kServidor = 3; // el k que rige en el servidor (otra persona puede cambiarlo)
// Una petición que se queda en vuelo hasta que la prueba la suelta (para cambiar de sitio mientras tanto).
let retener: (metodo: string, ruta: string) => Promise<void> | null = () => null;

const json = (x: unknown, status = 200): Response => new Response(JSON.stringify(x), { status });
beforeEach(() => {
  pedidas = [];
  renovarAcorta = true;
  kServidor = 3;
  catalogoFalla = false;
  retener = () => null;
  respuestaPrevia = () => json(PREVIA);
  crear = () => json({ ...ENLACE, id: 'e2', titulo: 'Clima del invernadero', token: TOKEN, direccion: `/panel/#/v/${TOKEN}`, avisos: PREVIA.avisos }, 201);
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(async (ruta: string, init: RequestInit = {}) => {
    // Como fetch: una petición cancelada antes de responder rechaza con AbortError (así una cancelación de más se nota).
    await Promise.resolve();
    if (init.signal?.aborted) throw new DOMException('cancelada', 'AbortError');
    const metodo = init.method ?? 'GET';
    const cuerpo = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    pedidas.push({ metodo, ruta, cuerpo });
    await retener(metodo, ruta);
    if (init.signal?.aborted) throw new DOMException('cancelada', 'AbortError'); // también si se canceló mientras esperaba
    // El segundo sitio (Magallanes): sin enlaces, k = 7 y tope 9.
    if (ruta === '/sitios/s2/enlaces' && metodo === 'GET') return json([]);
    if (ruta === '/sitios/s2/enlaces/minimo' && metodo === 'GET') return json({ minimo_dispositivos: 7, fijado: true, por_omision: 3, piso: 1, maximo: 20 });
    if (ruta === '/sitios/s2/enlaces/tope' && metodo === 'GET') return json({ max_enlaces: 9, fijado: true, por_omision: 50, techo: 200, vivos: 0 });
    if (ruta === '/magnitudes' && catalogoFalla) return json({ statusCode: 500, message: 'falla' }, 500);
    if (ruta === '/magnitudes') return json([{ codigo: 'humedad', nombre: 'Humedad', unidad: '%RH' }, { codigo: 'temperatura', nombre: 'Temperatura', unidad: 'Cel' }]);
    if (ruta.startsWith('/sitios/s1/enlaces?incluir=todos')) return json([ENLACE, { ...ENLACE, id: 'e0', estado: 'revocado', renovable: false, revocado_en: '2026-11-12T15:00:00Z', revocado_por: { id: 'u3', nombre: 'Ana', correo: 'ana.otra@example.org' } }]);
    if (ruta === '/sitios/s1/enlaces' && metodo === 'GET') return json([ENLACE]);
    if (ruta === '/sitios/s1/enlaces' && metodo === 'POST') return crear();
    if (ruta === '/sitios/s1/enlaces/vista-previa') return respuestaPrevia();
    if (ruta === '/sitios/s1/enlaces/minimo' && metodo === 'GET') return json({ minimo_dispositivos: kServidor, fijado: false, por_omision: 3, piso: 1, maximo: 20 });
    if (ruta === '/sitios/s1/enlaces/minimo' && metodo === 'PUT') {
      if (cuerpo.anterior !== undefined && cuerpo.anterior !== kServidor) {
        return json({ statusCode: 409, codigo: 'minimo_cambio', minimo_dispositivos: kServidor, message: `Alguien cambió el mínimo de este sitio entretanto: ahora es k = ${kServidor}. Revísalo antes de cambiarlo.` }, 409);
      }
      kServidor = cuerpo.minimo_dispositivos;
      return json({ minimo_dispositivos: cuerpo.minimo_dispositivos, fijado: true, por_omision: 3, piso: 1, maximo: 20, avisos: ['Este mínimo afecta a todos los enlaces públicos de este sitio.', 'La zona «Sur» tiene 1 equipo: con k = 1 su lectura sale tal cual.'] });
    }
    if (ruta === '/sitios/s1/enlaces/tope' && metodo === 'GET') return json({ max_enlaces: 50, fijado: false, por_omision: 50, techo: 200, vivos: 1 });
    if (ruta === '/sitios/s1/enlaces/tope' && metodo === 'PUT') return json({ max_enlaces: cuerpo.max_enlaces, fijado: true, por_omision: 50, techo: 200, vivos: 1 });
    if (ruta === '/sitios/s1/enlaces/e1/renovar') {
      if (renovarAcorta && cuerpo.acortar !== true) return json({ statusCode: 409, codigo: 'acorta', expira_en_actual: '2026-12-17T15:00:00Z', expira_en_nueva: '2026-11-24T15:00:00Z', message: 'acorta' }, 409);
      return json({ ...ENLACE, expira_en: '2026-11-24T15:00:00Z', expira_en_anterior: ENLACE.expira_en, acorta: true });
    }
    if (ruta === '/sitios/s1/enlaces/e1' && metodo === 'DELETE') return json({ ...ENLACE, estado: 'revocado' });
    return json({}, 404);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const $ = <T extends Element = HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
const texto = (sel: string): string => (document.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const montar = async (): Promise<void> => {
  render(Publicar, { sitio: 'uct', sesion: SESION, sitios: SITIOS, alCambiarVista: () => undefined });
  await waitFor(() => expect(document.querySelector('[data-magnitud-enlace="temperatura"]')).toBeTruthy());
  await waitFor(() => expect(document.querySelector('[data-enlace="e1"]')).toBeTruthy());
};
// «Publicar» se habilita cuando llegó la vista previa de la selección actual.
const previaLista = async (): Promise<void> => {
  await waitFor(() => expect($<HTMLButtonElement>('[data-publicar-crear]').disabled).toBe(false));
};
const elegir = async (sel: string): Promise<void> => {
  const c = $<HTMLInputElement>(sel);
  c.checked = true;
  await fireEvent.change(c);
};

describe('P9, quien publica', () => {
  it('sin título ni magnitudes no se publica, con el motivo escrito; los avisos de texto público están junto al título, la descripción y las zonas', async () => {
    await montar();
    expect($<HTMLButtonElement>('[data-publicar-crear]').disabled).toBe(true);
    expect(texto('[data-formulario-publicar] [data-motivo-desactivado]')).toBe('Escribe un título.');
    await fireEvent.input($('[data-titulo-enlace]'), { target: { value: 'Clima del invernadero' } });
    expect(texto('[data-formulario-publicar] [data-motivo-desactivado]')).toBe('Elige al menos una magnitud para publicar.');
    expect(texto('[data-aviso-texto-publico]')).toBe('Este texto lo verá cualquiera con el enlace: sin nombres de personas ni datos personales.');
    expect($('[data-titulo-enlace]').getAttribute('aria-describedby')).toBe($('[data-aviso-texto-publico]').id);
    expect($('[data-descripcion-enlace]').getAttribute('aria-describedby')).toBe($('[data-aviso-texto-publico]').id);
    expect(texto('[data-aviso-nombres-publicos]')).toContain('El nombre del sitio y el de cada zona publicada también los verá cualquiera con el enlace');
    expect(pedidas.some((p) => p.ruta.endsWith('/vista-previa'))).toBe(false);
    // Al abrir, sin hacer nada, cargan el catálogo, la lista y los ajustes del sitio (el k y el tope).
    await waitFor(() => expect(texto('[data-minimo-actual]')).toBe('3'));
    expect(texto('[data-tope-actual]')).toBe('50');
  });

  // P15 (docs/19 §4, Q, punto 4): el k y el tope ya no se cambian aquí; queda la lectura y el enlace a «Ajustes del sitio».
  it('el k y el tope son una línea de lectura con los valores reales y el enlace «Cambiar en Ajustes del sitio»; no hay campos ni botones para cambiarlos', async () => {
    kServidor = 5;
    await montar();
    await waitFor(() => expect(texto('[data-lectura-ajustes]')).toBe('Mínimo de dispositivos por valor publicado: 5 · Tope de enlaces vivos: 50 · Cambiar en Ajustes del sitio'));
    const enlace = $<HTMLAnchorElement>('[data-lectura-ajustes] [data-cambiar-en-ajustes]');
    expect(enlace.getAttribute('href')).toBe('#/sitio/ajustes?sitio=uct');
    expect(document.querySelector('[data-minimo-campo], [data-guardar-minimo], [data-tope-campo], [data-guardar-tope], [data-confirmar-minimo-aviso]')).toBeNull();
    expect(pedidas.some((p) => p.metodo === 'PUT')).toBe(false);
  });

  it('elegir una magnitud pide la vista previa (la misma forma que GET /publico) y sus avisos se ven ANTES del botón «Publicar»', async () => {
    await montar();
    await fireEvent.input($('[data-titulo-enlace]'), { target: { value: '  Clima del invernadero ' } });
    await elegir('[data-magnitud-enlace="temperatura"]');
    await elegir('[data-zona-enlace="Norte"]');
    await waitFor(() => expect(document.querySelector('[data-vista-previa] [data-vista-publica]')).toBeTruthy());
    const previas = pedidas.filter((p) => p.ruta === '/sitios/s1/enlaces/vista-previa');
    expect(previas).toHaveLength(1); // dos casillas seguidas: una sola consulta
    expect(previas[0]!.cuerpo).toMatchObject({ magnitudes: ['temperatura'], zonas: ['z1'], ventana_maxima: '7d', ventana: '24h' });
    expect(texto('[data-vista-previa] [data-vp-titulo]')).toBe('Clima del invernadero'); // lo escrito, recortado, sin otra consulta
    expect(texto('[data-vista-previa] [data-vp-ahora]')).toBe('21,4 °C');
    const aviso = $('[data-aviso-publicar]');
    expect(aviso.textContent).toBe(PREVIA.avisos[0]);
    expect(aviso.compareDocumentPosition($('[data-publicar-crear]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect($<HTMLButtonElement>('[data-publicar-crear]').disabled).toBe(false);
  });

  it('publicar muestra la dirección una sola vez, con «Copiar»; ocultarla la borra de la página', async () => {
    await montar();
    await fireEvent.input($('[data-titulo-enlace]'), { target: { value: 'Clima del invernadero' } });
    await elegir('[data-magnitud-enlace="temperatura"]');
    await previaLista();
    await fireEvent.submit($('[data-formulario-publicar]'));
    await waitFor(() => expect(document.querySelector('[data-enlace-una-vez]')).toBeTruthy());
    // jsdom entra por «localhost»: la dirección no sirve fuera de este equipo, y se avisa junto a ella.
    expect(texto('[data-aviso-origen]')).toBe('Esta dirección usa el nombre con que entraste; para compartirla, entra por el nombre público del servidor.');
    expect($('[data-direccion-enlace]').getAttribute('translate')).toBe('no');
    const post = pedidas.find((p) => p.metodo === 'POST' && p.ruta === '/sitios/s1/enlaces')!;
    expect(post.cuerpo).toEqual({ titulo: 'Clima del invernadero', descripcion: null, magnitudes: ['temperatura'], ventana_maxima: '7d', zonas: [], plazo_dias: 30, retencion_dias: 90 });
    expect(texto('[data-direccion-enlace]')).toBe(`${window.location.origin}/panel/#/v/${TOKEN}`);
    expect(document.querySelector('[data-copiar-direccion]')).toBeTruthy();
    expect(texto('[data-enlace-una-vez]')).toContain('Esta dirección no se vuelve a mostrar');
    ($('[data-ocultar-direccion]') as HTMLButtonElement).click();
    await waitFor(() => expect(document.querySelector('[data-enlace-una-vez]')).toBeNull());
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('el tope del sitio: el 409 dice el número y qué hacer', async () => {
    crear = () => json({ statusCode: 409, codigo: 'tope_enlaces', message: 'Este sitio ya tiene 5 enlaces. Revoca uno para crear otro.' }, 409);
    await montar();
    await fireEvent.input($('[data-titulo-enlace]'), { target: { value: 'Clima' } });
    await elegir('[data-magnitud-enlace="temperatura"]');
    await previaLista();
    await fireEvent.submit($('[data-formulario-publicar]'));
    await waitFor(() => expect(document.body.textContent).toContain('Este sitio ya tiene 5 enlaces. Revoca uno para crear otro.'));
  });

  it('la lista dice qué publica, vence, visitas y estado; «Ver todos» pide `incluir=todos`', async () => {
    await montar();
    expect(texto('[data-enlace="e1"] [data-que-publica]')).toBe('Temperatura; hasta 7 días; zona Norte');
    expect(texto('[data-enlace="e1"] [data-estado-enlace]')).toBe('vigente');
    expect(texto('[data-enlace="e1"] [data-accesos-enlace]')).toBe('4');
    expect(texto('[data-enlace="e1"] .datos-enlace')).toContain('Ana ana@example.org, el'); // el correo, para distinguir homónimos
    ($('[data-ver-todos]') as HTMLButtonElement).click();
    await waitFor(() => expect(document.querySelector('[data-enlace="e0"]')).toBeTruthy());
    expect(pedidas.at(-1)!.ruta).toBe('/sitios/s1/enlaces?incluir=todos');
    expect(texto('[data-enlace="e0"] [data-estado-enlace]')).toBe('revocado');
    expect(texto('[data-enlace="e0"] .datos-enlace')).toContain('Ana ana@example.org'); // la misma Ana que quien revocó, otra cuenta
    expect(texto('[data-enlace="e0"] .datos-enlace')).toContain(', por Ana ana.otra@example.org');
    expect(document.querySelector('[data-enlace="e0"] [data-renovar]')).toBeNull();
  });

  it('renovar con un plazo que acorta: el servidor responde 409 `acorta`, se muestran las dos fechas y «Renovar igual» manda `acortar: true`', async () => {
    await montar();
    ($('[data-renovar="e1"]') as HTMLButtonElement).click();
    await waitFor(() => expect(document.querySelector('[data-plazo-renovar]')).toBeTruthy());
    const plazo = $<HTMLSelectElement>('[data-plazo-renovar]');
    plazo.value = '7';
    await fireEvent.change(plazo);
    ($('[data-confirmar-renovar]') as HTMLButtonElement).click();
    await waitFor(() => expect(document.querySelector('[data-acorta]')).toBeTruthy());
    expect(texto('[data-acorta] p')).toBe('Vencía el 17 de diciembre de 2026, 12:00; con este plazo vencerá antes, el 24 de noviembre de 2026, 12:00.');
    ($('[data-renovar-igual]') as HTMLButtonElement).click();
    await waitFor(() => expect(document.querySelector('[data-acorta]')).toBeNull());
    const renovaciones = pedidas.filter((p) => p.ruta.endsWith('/renovar')).map((p) => p.cuerpo);
    expect(renovaciones).toEqual([{ plazo_dias: 7 }, { plazo_dias: 7, acortar: true }]);
  });

  it('revocar pide confirmación; sin confirmar no se manda nada', async () => {
    await montar();
    ($('[data-revocar="e1"]') as HTMLButtonElement).click();
    await waitFor(() => expect(document.querySelector('[data-confirmar-revocacion]')).toBeTruthy());
    expect(texto('[data-confirmar-revocacion] p')).toContain('no se deshace');
    expect(pedidas.some((p) => p.metodo === 'DELETE')).toBe(false);
    ($('[data-confirmar-revocar]') as HTMLButtonElement).click();
    await waitFor(() => expect(pedidas.some((p) => p.metodo === 'DELETE' && p.ruta === '/sitios/s1/enlaces/e1')).toBe(true));
  });

  it('«Publicar» espera la vista previa de la selección actual: tras cambiarla, desactivado con su motivo; si la previa falla, también', async () => {
    await montar();
    await fireEvent.input($('[data-titulo-enlace]'), { target: { value: 'Clima' } });
    await elegir('[data-magnitud-enlace="temperatura"]');
    await previaLista();
    await elegir('[data-zona-enlace="Norte"]'); // otra selección: los avisos de antes ya no son los de esta
    expect($<HTMLButtonElement>('[data-publicar-crear]').disabled).toBe(true);
    expect(texto('[data-formulario-publicar] [data-motivo-desactivado]')).toBe('Espera la vista previa: lo que verá quien visite y sus avisos se muestran antes de publicar.');
    expect(document.querySelector('[data-avisos-publicar]')).toBeNull();
    await fireEvent.submit($('[data-formulario-publicar]'));
    expect(pedidas.some((p) => p.metodo === 'POST' && p.ruta === '/sitios/s1/enlaces')).toBe(false);
    await previaLista();
    respuestaPrevia = () => json({ statusCode: 503, message: 'la vista previa tardó demasiado' }, 503);
    await elegir('[data-zona-enlace="Sur"]');
    await waitFor(() => expect(texto('[data-formulario-publicar] [data-motivo-desactivado]')).toBe('La vista previa no se pudo cargar: reintenta antes de publicar.'));
    expect($<HTMLButtonElement>('[data-publicar-crear]').disabled).toBe(true);
  });

  it('si falla el catálogo de magnitudes, tiene su propio aviso con su «Reintentar» (pide `/magnitudes`, no la vista previa) y no se publica; la vista previa tiene el suyo', async () => {
    catalogoFalla = true;
    render(Publicar, { sitio: 'uct', sesion: SESION, sitios: SITIOS, alCambiarVista: () => undefined });
    await waitFor(() => expect(document.querySelector('[data-enlace="e1"]')).toBeTruthy());
    const aviso = (): Element | null => $('[data-formulario-publicar] fieldset').querySelector('[data-aviso]');
    await waitFor(() => expect(aviso()).toBeTruthy());
    expect(aviso()!.textContent).toContain('No se pudo cargar el catálogo de magnitudes.');
    expect(document.querySelector('[data-vista-previa] [data-aviso]')).toBeNull(); // la vista previa no hereda el error del catálogo
    expect(document.querySelector('[data-sin-magnitudes]')).toBeNull();
    await fireEvent.input($('[data-titulo-enlace]'), { target: { value: 'Clima' } });
    expect($<HTMLButtonElement>('[data-publicar-crear]').disabled).toBe(true);
    expect(texto('[data-formulario-publicar] [data-motivo-desactivado]')).toBe('El catálogo de magnitudes no se pudo cargar: reintenta antes de publicar.');
    // Reintentar: pide `/magnitudes` otra vez y ninguna vista previa.
    catalogoFalla = false;
    pedidas = [];
    await fireEvent.click(aviso()!.querySelector('[data-aviso-accion]')!);
    await waitFor(() => expect(document.querySelector('[data-magnitud-enlace="temperatura"]')).toBeTruthy());
    expect(aviso()).toBeNull();
    expect(pedidas.map((p) => p.ruta)).toEqual(['/magnitudes']);
    expect(texto('[data-formulario-publicar] [data-motivo-desactivado]')).toBe('Elige al menos una magnitud para publicar.');
    // Con el catálogo, las magnitudes se eligen y la vista previa sigue su camino; si esa falla, su aviso es el suyo y su «Reintentar» pide la vista previa.
    respuestaPrevia = () => json({ statusCode: 500, message: 'falla' }, 500);
    await elegir('[data-magnitud-enlace="temperatura"]');
    await waitFor(() => expect(document.querySelector('[data-vista-previa] [data-aviso]')).toBeTruthy());
    expect($('[data-formulario-publicar] fieldset').querySelector('[data-aviso]')).toBeNull();
    respuestaPrevia = () => json(PREVIA);
    pedidas = [];
    await fireEvent.click($('[data-vista-previa] [data-aviso-accion]'));
    await previaLista();
    expect(pedidas.map((p) => p.ruta)).toEqual(['/sitios/s1/enlaces/vista-previa']);
    expect(document.querySelector('[data-vista-previa] [data-aviso]')).toBeNull();
  });

  it('al salir de la página (pagehide, también hacia la caché de ida y vuelta) la dirección con el token se olvida', async () => {
    await montar();
    await fireEvent.input($('[data-titulo-enlace]'), { target: { value: 'Clima' } });
    await elegir('[data-magnitud-enlace="temperatura"]');
    await previaLista();
    await fireEvent.submit($('[data-formulario-publicar]'));
    await waitFor(() => expect(document.querySelector('[data-enlace-una-vez]')).toBeTruthy());
    window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true })); // la página entra a la caché de ida y vuelta
    await waitFor(() => expect(document.querySelector('[data-enlace-una-vez]')).toBeNull());
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  // Dos sitios que la persona administra, para cambiar de uno a otro con una petición en vuelo.
  const DOS: Sitio[] = [...SITIOS, { id: 's2', codigo: 'mag', nombre: 'Magallanes', zona_horaria: 'America/Punta_Arenas', rol: 'administrador', zonas: [] }];
  const SESION_DOS: Sesion = { ...SESION, sitios: [...(SESION as Extract<Sesion, { sistema: false }>).sitios, { sitio_id: 's2', codigo: 'mag', nombre: 'Magallanes', rol: 'administrador' }] } as Sesion;
  const soltable = (): { promesa: Promise<void>; soltar: () => void } => { let soltar = (): void => undefined; const promesa = new Promise<void>((ok) => (soltar = ok)); return { promesa, soltar }; };

  it('mientras se publica, el selector de sitio se desactiva con su motivo; al cambiar de sitio se olvidan los avisos del anterior', async () => {
    crear = () => json({ statusCode: 409, codigo: 'tope_enlaces', message: 'Este sitio ya tiene 5 enlaces. Revoca uno para crear otro.' }, 409);
    const r = render(Publicar, { sitio: 'uct', sesion: SESION_DOS, sitios: DOS, alCambiarVista: () => undefined });
    await waitFor(() => expect(document.querySelector('[data-magnitud-enlace="temperatura"]')).toBeTruthy());
    await fireEvent.input($('[data-titulo-enlace]'), { target: { value: 'Clima' } });
    await elegir('[data-magnitud-enlace="temperatura"]');
    await previaLista();
    const pausa = soltable();
    retener = (metodo, ruta) => (metodo === 'POST' && ruta === '/sitios/s1/enlaces' ? pausa.promesa : null);
    await fireEvent.submit($('[data-formulario-publicar]'));
    await waitFor(() => expect($<HTMLSelectElement>('[data-sitio-publicar]').disabled).toBe(true));
    expect(texto('[data-motivo-sitio]')).toBe('espera a que termine de publicarse: su dirección se muestra aquí');
    pausa.soltar();
    await waitFor(() => expect(document.body.textContent).toContain('Este sitio ya tiene 5 enlaces.'));
    expect($<HTMLSelectElement>('[data-sitio-publicar]').disabled).toBe(false);
    await r.rerender({ sitio: 'mag', sesion: SESION_DOS, sitios: DOS, alCambiarVista: () => undefined });
    await waitFor(() => expect(texto('[data-minimo-actual]')).toBe('7'));
    expect(document.body.textContent).not.toContain('Este sitio ya tiene 5 enlaces.');
  });

  it('`pagehide` sin la caché de ida y vuelta (pasar a otra aplicación en un teléfono) conserva la dirección', async () => {
    await montar();
    await fireEvent.input($('[data-titulo-enlace]'), { target: { value: 'Clima' } });
    await elegir('[data-magnitud-enlace="temperatura"]');
    await previaLista();
    await fireEvent.submit($('[data-formulario-publicar]'));
    await waitFor(() => expect(document.querySelector('[data-enlace-una-vez]')).toBeTruthy());
    window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }));
    await new Promise((x) => setTimeout(x, 20));
    expect(document.querySelector('[data-enlace-una-vez]')).toBeTruthy();
  });
});
