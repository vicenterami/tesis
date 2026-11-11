import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi, accionPara, alPerderSesion, cambiaLaSesion, comprobarSesion, descargar, descargarTexto, leerPaginacion, nombreDeArchivo, obtener, obtenerPagina, pedir, segundosDeEspera, ultimaGana, type Guardador, type Paginacion } from './api';

const json = (cuerpo: unknown, status = 200, cabeceras: Record<string, string> = {}): Response => new Response(JSON.stringify(cuerpo), { status, headers: cabeceras });
const llamadas = (): [string, RequestInit][] => vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][];
function oir(): { motivos: string[]; dejar: () => void } {
  const motivos: string[] = [];
  return { motivos, dejar: alPerderSesion((m) => motivos.push(m)) };
}

describe('obtener: un solo cliente HTTP, errores con código y acción', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('200 → el JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'x' }]), { status: 200 })));
    await expect(obtener<{ id: string }[]>('/dispositivos')).resolves.toEqual([{ id: 'x' }]);
  });
  it('409 → ErrorApi con la acción «recarga»; 421 → «nombre del servidor»; otro código → acción genérica', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 409 })));
    await expect(obtener('/x')).rejects.toMatchObject({ codigo: 409, accion: expect.stringContaining('recarga') } satisfies Partial<ErrorApi>);
    expect(accionPara(421)).toContain('nombre del servidor');
    expect(accionPara(418)).toContain('inténtalo');
  });
});

// docs/20 §5 (CSRF) y docs/19 §6 (un solo cliente): la cabecera X-Pedido va en lo que escribe y solo ahí; la cookie, siempre.
describe('pedir: cookie del mismo origen y X-Pedido: panel en lo que escribe', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('GET sin X-Pedido; POST, PATCH y DELETE con X-Pedido: panel; todos con credentials same-origin y el cuerpo en JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true })));
    await obtener('/usuarios');
    await pedir('POST', '/usuarios', { cuerpo: { nombre: 'Ana' } });
    await pedir('PATCH', '/usuarios/u1', { cuerpo: { activo: false } });
    await pedir('DELETE', '/sesion');
    const [get, post, patch, del] = llamadas();
    expect((get![1].headers as Record<string, string>)['X-Pedido']).toBeUndefined();
    for (const [, init] of [post!, patch!, del!]) expect((init.headers as Record<string, string>)['X-Pedido']).toBe('panel');
    for (const [, init] of llamadas()) expect(init.credentials).toBe('same-origin');
    expect(post![1].body).toBe('{"nombre":"Ana"}');
    expect((post![1].headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(del![1].body).toBeUndefined();
  });
  it('una respuesta sin cuerpo (200 vacío) no rompe', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    await expect(pedir('DELETE', '/sesion')).resolves.toBeUndefined();
  });
});

describe('manejo central: 401, 403 de clave temporal, 409, 429 y sin red', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('401 → avisa «sin_sesion» a quien escucha (App muestra Entrar) y rechaza; con central: false, no avisa', async () => {
    const o = oir();
    vi.stubGlobal('fetch', vi.fn(async () => json({ statusCode: 401, message: 'sesión requerida' }, 401)));
    await expect(obtener('/dispositivos')).rejects.toMatchObject({ codigo: 401 });
    expect(o.motivos).toEqual(['sin_sesion']);
    await expect(pedir('POST', '/sesion', { cuerpo: {}, central: false })).rejects.toMatchObject({ codigo: 401 });
    expect(o.motivos).toEqual(['sin_sesion']); // el inicio de sesión trata su propio 401
    o.dejar();
  });
  it('403 por clave temporal → avisa «clave_temporal»; un 403 de rol no avisa nada', async () => {
    const o = oir();
    vi.stubGlobal('fetch', vi.fn(async () => json({ statusCode: 403, message: 'debes cambiar la clave temporal antes de seguir (POST /sesion/clave)' }, 403)));
    await expect(obtener('/dispositivos')).rejects.toMatchObject({ codigo: 403 });
    vi.stubGlobal('fetch', vi.fn(async () => json({ statusCode: 403, message: 'tu rol en este sitio no permite la acción «exportar»' }, 403)));
    await expect(obtener('/dispositivos/x/exportar')).rejects.toMatchObject({ codigo: 403, motivos: ['tu rol en este sitio no permite la acción «exportar»'] });
    expect(o.motivos).toEqual(['clave_temporal']);
    o.dejar();
  });
  it('400 → los motivos del cuerpo (lista de Nest) quedan en el error, para mostrarlos tal cual', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ statusCode: 400, message: ['la clave debe tener al menos 12 caracteres', 'la clave no puede ser el email'] }, 400)));
    await expect(pedir('POST', '/sesion/clave', { cuerpo: {} })).rejects.toMatchObject({ codigo: 400, motivos: ['la clave debe tener al menos 12 caracteres', 'la clave no puede ser el email'] });
  });
  it('429 → los segundos de espera: de reintentar_en_s o, si falta, del «reintenta en N s» del mensaje; la acción los dice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ statusCode: 429, message: 'bloqueado: demasiados intentos fallidos; reintenta en 60 s', reintentar_en_s: 60 }, 429)));
    await expect(pedir('POST', '/sesion', { central: false })).rejects.toMatchObject({ codigo: 429, reintentarEnS: 60, accion: 'demasiados intentos; espera 60 s y reintenta' });
    expect(segundosDeEspera({ message: 'bloqueado: demasiados intentos fallidos; reintenta en 300 s' })).toBe(300);
    expect(segundosDeEspera({ message: 'ya tienes 5 flujos abiertos; cierra una pestaña' })).toBeNull();
    expect(segundosDeEspera({ reintentar_en_s: -3 })).toBeNull();
  });
  it('sin red (fetch lanza) → ErrorApi código 0 «sin conexión»; una cancelación se propaga como AbortError, no como error que mostrar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(obtener('/dispositivos')).rejects.toMatchObject({ codigo: 0 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('cancelada', 'AbortError'); }));
    await expect(obtener('/dispositivos')).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('ultimaGana: la respuesta vieja no pisa a la nueva', () => {
  it('cada señal nueva cancela la anterior; cancelar() corta la vigente', () => {
    const g = ultimaGana();
    const a = g.senal();
    const b = g.senal();
    expect(a.aborted).toBe(true);
    expect(b.aborted).toBe(false);
    g.cancelar();
    expect(b.aborted).toBe(true);
  });
});

// Descargas por Blob en un solo ayudante (docs/19 §6): con la sesión, sin token en la URL ni <a href> a la API.
describe('descargar', () => {
  afterEach(() => vi.unstubAllGlobals());
  const guardador = (): Guardador & { pulsados: [string, string][]; liberadas: string[] } => {
    const g = { pulsados: [] as [string, string][], liberadas: [] as string[], crearUrl: () => 'blob:x', liberarUrl: (u: string) => g.liberadas.push(u), pulsar: (u: string, n: string) => g.pulsados.push([u, n]) };
    return g;
  };
  it('200 → Blob, nombre de Content-Disposition, un solo «clic» en memoria y la URL liberada; GET con la cookie y sin X-Pedido', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('a,b\n1,2\n', { headers: { 'content-disposition': 'attachment; filename="dev-0001_temperatura.csv"' } })));
    const g = guardador();
    await expect(descargar('/dispositivos/d1/exportar?formato=csv', 'dispositivo.csv', undefined, g)).resolves.toEqual({ nombre: 'dev-0001_temperatura.csv', bytes: 8 });
    expect(g.pulsados).toEqual([['blob:x', 'dev-0001_temperatura.csv']]);
    vi.runAllTimers();
    expect(g.liberadas).toEqual(['blob:x']);
    const [ruta, init] = llamadas()[0]!;
    expect(ruta).toBe('/dispositivos/d1/exportar?formato=csv');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['X-Pedido']).toBeUndefined();
    vi.useRealTimers();
  });
  it('401 → no descarga nada y avisa «sin_sesion» (vuelve al inicio de sesión en vez de abrir el JSON del 401)', async () => {
    const o = oir();
    vi.stubGlobal('fetch', vi.fn(async () => json({ statusCode: 401, message: 'sesión requerida' }, 401)));
    const g = guardador();
    await expect(descargar('/dispositivos/d1/exportar', 'x.csv', undefined, g)).rejects.toMatchObject({ codigo: 401 });
    expect(g.pulsados).toEqual([]);
    expect(o.motivos).toEqual(['sin_sesion']);
    o.dejar();
  });
  it('nombreDeArchivo: el de la cabecera si es un nombre simple; si trae rutas o nada, el de por defecto', () => {
    expect(nombreDeArchivo('attachment; filename="dev-0001.csv"', 'x.csv')).toBe('dev-0001.csv');
    expect(nombreDeArchivo("attachment; filename*=UTF-8''medici%C3%B3n.json", 'x.json')).toBe('medición.json');
    expect(nombreDeArchivo('attachment; filename="../../etc/passwd"', 'x.csv')).toBe('x.csv');
    expect(nombreDeArchivo(null, 'x.csv')).toBe('x.csv');
  });
  it('nombreDeArchivo: solo .csv y .json (lo que la API entrega); otra extensión da el nombre de por defecto', () => {
    expect(nombreDeArchivo('attachment; filename="datos.exe"', 'x.csv')).toBe('x.csv');
    expect(nombreDeArchivo('attachment; filename="pagina.html"', 'x.csv')).toBe('x.csv');
    expect(nombreDeArchivo('attachment; filename="sin-extension"', 'x.json')).toBe('x.json');
    expect(nombreDeArchivo('attachment; filename="dev-0001.JSON"', 'x.json')).toBe('dev-0001.JSON');
  });
  it('nombreDeArchivo: un «%» mal formado (URIError al decodificar) da el nombre por defecto, sin lanzar', () => {
    expect(nombreDeArchivo("attachment; filename*=UTF-8''medici%E0%A4n.json", 'x.json')).toBe('x.json');
    expect(nombreDeArchivo('attachment; filename="100%.csv"', 'x.csv')).toBe('x.csv');
  });
});

describe('comprobarSesion: una petición liviana cuando el canal en vivo cae, como mucho una cada 5 s', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('GET /sesion por el cliente central, y no más de una cada 5 s', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ sistema: false })));
    comprobarSesion(1_000_000);
    comprobarSesion(1_002_000);
    comprobarSesion(1_006_000);
    expect(llamadas().map(([r]) => r)).toEqual(['/sesion', '/sesion']);
  });
});

// Una petición iniciada antes de entrar (o de salir) que vuelve después con 401 o 403 habla de la sesión anterior: no se avisa.
describe('generación de la sesión: los avisos atrasados se descartan', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('un 401 de una petición iniciada antes de POST /sesion no avisa; uno iniciado después, sí', async () => {
    const o = oir();
    let soltar: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn((ruta: string, init: RequestInit = {}) => {
      if (ruta === '/lenta') return new Promise<Response>((res) => (soltar = res));
      if (init.method === 'POST' && ruta === '/sesion') return Promise.resolve(json({ usuario: {} }));
      return Promise.resolve(json({ statusCode: 401, message: 'sesión requerida' }, 401));
    }));
    const lenta = obtener('/lenta');
    await pedir('POST', '/sesion', { cuerpo: {}, central: false });
    soltar(json({ statusCode: 403, message: 'debes cambiar la clave temporal antes de seguir (POST /sesion/clave)' }, 403));
    await expect(lenta).rejects.toMatchObject({ codigo: 403 }); // quien la pidió igual recibe el error
    expect(o.motivos).toEqual([]);
    await expect(obtener('/otra')).rejects.toMatchObject({ codigo: 401 });
    expect(o.motivos).toEqual(['sin_sesion']);
    o.dejar();
  });
  it('POST /cuenta/baja también cambia la sesión: un 401 atrasado tras la baja no avisa «venció» (revisión del 11/11/2026)', async () => {
    const o = oir();
    let soltar: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn((ruta: string) => (ruta === '/lenta' ? new Promise<Response>((res) => (soltar = res)) : Promise.resolve(json({ baja: true })))));
    const lenta = obtener('/lenta');
    await pedir('POST', '/cuenta/baja', { cuerpo: { clave: 'x' } });
    soltar(json({ statusCode: 401, message: 'sesión requerida' }, 401));
    await expect(lenta).rejects.toMatchObject({ codigo: 401 });
    expect(o.motivos).toEqual([]);
    expect([cambiaLaSesion('POST', '/cuenta/baja'), cambiaLaSesion('GET', '/cuenta/exportar'), cambiaLaSesion('POST', '/soporte')]).toEqual([true, false, false]);
    o.dejar();
  });
  it('el ErrorApi trae el cuerpo entero del error (el 409 `reactivable` del alta lo necesita)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ statusCode: 409, reactivable: true, usuario: { id: 'u1' }, message: 'existe una cuenta inactiva' }, 409)));
    await expect(pedir('POST', '/usuarios', { cuerpo: {} })).rejects.toMatchObject({ codigo: 409, cuerpo: { reactivable: true, usuario: { id: 'u1' } } });
  });
});

// Totales y cursores en cabeceras (docs/19 §6 y §4 tablero v2, I): `pedir` los expone a quien los pide y no cambia nada para los demás.
describe('paginación: X-Total y X-Siguiente', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('obtenerPagina entrega las filas, el total y el cursor; sin cabeceras, null (un backend anterior)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([{ id: 'a' }], 200, { 'X-Total': '132', 'X-Siguiente': 'c2' })));
    await expect(obtenerPagina('/dispositivos?limite=50')).resolves.toEqual({ filas: [{ id: 'a' }], total: 132, siguiente: 'c2' });
    vi.stubGlobal('fetch', vi.fn(async () => json([])));
    await expect(obtenerPagina('/dispositivos')).resolves.toEqual({ filas: [], total: null, siguiente: null });
  });
  it('pedir con alPaginar avisa las cabeceras; quien no lo pasa recibe el mismo cuerpo de siempre', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([1, 2], 200, { 'X-Total': '2' })));
    const vistas: Paginacion[] = [];
    await expect(pedir('GET', '/x', { alPaginar: (p) => vistas.push(p) })).resolves.toEqual([1, 2]);
    expect(vistas).toEqual([{ total: 2, siguiente: null }]);
    await expect(obtener('/x')).resolves.toEqual([1, 2]);
  });
  it('en los dos sentidos: un total que no es un entero no negativo se descarta (nunca NaN ni negativo en «1–50 de N»)', () => {
    expect(leerPaginacion(new Headers({ 'X-Total': 'muchos' })).total).toBeNull();
    expect(leerPaginacion(new Headers({ 'X-Total': '-3' })).total).toBeNull();
    expect(leerPaginacion(new Headers({ 'X-Total': '' , 'X-Siguiente': '  ' }))).toEqual({ total: null, siguiente: null });
    expect(leerPaginacion(new Headers({ 'X-Total': '0' })).total).toBe(0);
  });
});

// 11/11/2026: el 403 de los términos sin aceptar avisa a App (docs/20 §12) y lo que el panel ya tiene en memoria (credenciales del lote,
// rechazadas) se entrega por el mismo camino de las descargas.
describe('términos pendientes y descargarTexto', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('un 403 con codigo «terminos_pendientes» avisa «terminos»; el de la clave temporal sigue siendo el suyo; sin `central`, nadie', async () => {
    const avisos: string[] = [];
    const dejar = alPerderSesion((m) => avisos.push(m));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ statusCode: 403, codigo: 'terminos_pendientes', message: 'debes aceptar los términos de uso (versión 2) antes de seguir (GET /terminos y POST /terminos/aceptar)' }), { status: 403 })));
    await expect(obtener('/sitios')).rejects.toBeInstanceOf(ErrorApi);
    await expect(pedir('GET', '/sitios', { central: false })).rejects.toBeInstanceOf(ErrorApi);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'cambia tu clave temporal primero: POST /sesion/clave' }), { status: 403 })));
    await expect(obtener('/sitios')).rejects.toBeInstanceOf(ErrorApi);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'tu rol en este sitio no lo permite' }), { status: 403 })));
    await expect(obtener('/sitios')).rejects.toBeInstanceOf(ErrorApi);
    dejar();
    expect(avisos).toEqual(['terminos', 'clave_temporal']);
  });
  it('descargarTexto: un Blob con el tipo, el nombre saneado (solo .csv o .json) y la URL liberada después', async () => {
    const pulsados: string[] = [];
    const liberadas: string[] = [];
    let blob: Blob | null = null;
    const g: Guardador = { crearUrl: (b) => { blob = b; return 'blob:1'; }, liberarUrl: (u) => liberadas.push(u), pulsar: (_u, n) => pulsados.push(n) };
    expect(descargarTexto('a,b\r\n', 'credenciales-2026-11-11.csv', undefined, g)).toEqual({ nombre: 'credenciales-2026-11-11.csv', bytes: 5 });
    expect(descargarTexto('x', '../malo.exe', undefined, g).nombre).toBe('descarga.csv');
    expect(pulsados).toEqual(['credenciales-2026-11-11.csv', 'descarga.csv']);
    expect(blob!.type).toBe('text/csv;charset=utf-8');
    await new Promise((r) => setTimeout(r, 0));
    expect(liberadas).toEqual(['blob:1', 'blob:1']);
  });
});
