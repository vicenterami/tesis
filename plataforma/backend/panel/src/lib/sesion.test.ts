import { describe, expect, it, vi } from 'vitest';
import { RENOVAR_CADA_MS, TEXTO_VENCIDA, crearRenovador, puedeEn, puedeEnAlguno, quienSoy, trasAvisoDeSesion, type EstadoPanel, type Sesion } from './sesion';

const permisos = { administrador: ['leer', 'exportar', 'escribir', 'usuarios'], consulta: ['leer'] };
const persona = (sitios: [string, string, 'administrador' | 'consulta'][]): Sesion => ({
  sistema: false, usuario: { id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid' }, clave_temporal: false, expira_en: null, inactividad_vence_en: null, permisos,
  sitios: sitios.map(([codigo, nombre, rol], i) => ({ sitio_id: `s${i}`, codigo, nombre, rol })),
});

describe('puedeEn y puedeEnAlguno: lo que la matriz de GET /sesion permite en cada sitio', () => {
  it('roles distintos en sitios distintos; un sitio ajeno, nada; sin sesión conocida, decide el servidor', () => {
    const s = persona([['uct', 'Campus', 'consulta'], ['mag', 'Magallanes', 'administrador']]);
    expect(puedeEn(s, 'leer', 'uct')).toBe(true);
    expect(puedeEn(s, 'exportar', 'uct')).toBe(false);
    expect(puedeEn(s, 'exportar', 'mag')).toBe(true);
    expect(puedeEn(s, 'leer', 'otro')).toBe(false);
    expect(puedeEn(null, 'exportar', 'uct')).toBe(true);
    expect(puedeEnAlguno(s, 'usuarios')).toBe(true);
    expect(puedeEnAlguno(persona([['uct', 'Campus', 'consulta']]), 'usuarios')).toBe(false);
    expect(puedeEnAlguno(null, 'usuarios')).toBe(false);
  });
  it('quién soy: nombre y sitios con su rol; el usuario del sistema, todos los sitios', () => {
    expect(quienSoy(persona([['uct', 'Campus', 'administrador'], ['mag', 'Magallanes', 'consulta']]))).toEqual({ nombre: 'Ana', sitios: 'Campus (administrador), Magallanes (consulta)' });
    expect(quienSoy({ sistema: true, nombre: 'sistema (clave de administrador)', sitios: 'todos', rol: 'administrador', permisos }).sitios).toBe('todos los sitios (administrador)');
  });
});

// docs/20 §3: un GET /sesion liviano como mucho cada 5 minutos, y solo si la persona interactúa.
describe('crearRenovador', () => {
  it('sin interacción no renueva nunca; con interacción, como mucho una vez cada 5 min y nunca dos en vuelo', async () => {
    let ahora = 0;
    let resolver: () => void = () => undefined;
    const renovar = vi.fn(() => new Promise<void>((r) => (resolver = r)));
    const r = crearRenovador(renovar, () => ahora);
    ahora = 60 * 60_000; // una hora sin nadie delante
    expect(renovar).not.toHaveBeenCalled();
    r.actividad();
    expect(renovar).toHaveBeenCalledTimes(1);
    r.actividad(); // en vuelo
    ahora += RENOVAR_CADA_MS - 1;
    resolver();
    await Promise.resolve();
    await Promise.resolve();
    r.actividad(); // aún no pasan 5 min desde la anterior
    expect(renovar).toHaveBeenCalledTimes(1);
    ahora += 1;
    r.actividad();
    expect(renovar).toHaveBeenCalledTimes(2);
  });
  it('renovado(): otra parte ya habló con el servidor (entrar, cambiar la clave) y el plazo se cuenta desde ahí', () => {
    let ahora = 0;
    const renovar = vi.fn(() => Promise.resolve());
    const r = crearRenovador(renovar, () => ahora);
    ahora = RENOVAR_CADA_MS;
    r.renovado();
    ahora += 1000;
    r.actividad();
    expect(renovar).not.toHaveBeenCalled();
  });
});

describe('trasAvisoDeSesion: lo que hace el panel ante un 401 o un 403 de clave temporal del cliente HTTP', () => {
  const base = (o: Partial<EstadoPanel>): EstadoPanel => ({ fase: 'dentro', sesion: persona([['uct', 'Campus', 'administrador']]), claveRecienUsada: null, cambiandoClave: false, rutaGuardada: null, mensajeEntrar: null, ...o });
  it('401 en el cambio obligatorio: «Entrar» y la temporal recién escrita se olvida (no queda en memoria sin sesión)', () => {
    const e = trasAvisoDeSesion(base({ fase: 'cambiar', claveRecienUsada: 'temporal-de-prueba' }), 'sin_sesion', '#/usuarios');
    expect(e).toMatchObject({ fase: 'entrar', sesion: null, claveRecienUsada: null, rutaGuardada: '#/usuarios', mensajeEntrar: TEXTO_VENCIDA });
  });
  it('401 ya en «Entrar»: no pisa la ruta guardada ni el mensaje', () => {
    const e = trasAvisoDeSesion(base({ fase: 'entrar', sesion: null, rutaGuardada: '#/x', mensajeEntrar: 'Cerraste la sesión.' }), 'sin_sesion', '#/');
    expect(e).toMatchObject({ fase: 'entrar', rutaGuardada: '#/x', mensajeEntrar: 'Cerraste la sesión.' });
  });
  it('403 de clave temporal: con sesión lleva al cambio; en «Entrar» o sin sesión se ignora (aviso atrasado)', () => {
    expect(trasAvisoDeSesion(base({}), 'clave_temporal', '#/').fase).toBe('cambiar');
    expect(trasAvisoDeSesion(base({ fase: 'entrar', sesion: null }), 'clave_temporal', '#/').fase).toBe('entrar');
    expect(trasAvisoDeSesion(base({ fase: 'comprobando', sesion: null }), 'clave_temporal', '#/').fase).toBe('comprobando');
  });
});
