import {
  INACTIVIDAD_MS, RENOVAR_CADA_MS, VIDA_ABSOLUTA_MS, cabeceraBorrarCookie, cabeceraCookie, claveTemporalVencida, venceClaveTemporal, debeRenovar, generarIdentificador,
  hashIdentificador, leerCookie, motivoDeVencimiento,
} from './cookie';

// La cookie de sesión y su vida (docs/20 §3), con un reloj simulado: cada instante se construye, nada depende de la hora real.
describe('cookie de sesión', () => {
  it('identificador: 32 bytes aleatorios en base64url (43 caracteres), distinto cada vez; la base guarda su SHA-256 en hexadecimal', () => {
    const a = generarIdentificador();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(generarIdentificador()).not.toBe(a);
    expect(hashIdentificador(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIdentificador(a)).not.toContain(a);
    expect(hashIdentificador(a)).toBe(hashIdentificador(a));
  });
  it('Set-Cookie con HttpOnly, Secure, SameSite=Lax y Path=/, sin Max-Age (cookie de sesión del navegador); el borrado, con Max-Age=0', () => {
    const c = cabeceraCookie('x'.repeat(43));
    expect(c).toBe(`__Host-sesion=${'x'.repeat(43)}; HttpOnly; Secure; SameSite=Lax; Path=/`);
    expect(c).not.toMatch(/Max-Age|Expires/i);
    expect(cabeceraBorrarCookie()).toBe('__Host-sesion=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  });
  it('leerCookie: la toma entre otras, ignora espacios y descarta lo que no tiene la forma (no se consulta la base con basura)', () => {
    const id = generarIdentificador();
    expect(leerCookie(`tema=oscuro; __Host-sesion=${id}; otra=1`)).toBe(id);
    expect(leerCookie(`  __Host-sesion=${id}  `)).toBe(id);
    expect(leerCookie(undefined)).toBeNull();
    expect(leerCookie('__Host-sesion=corta')).toBeNull();
    expect(leerCookie(`__Host-sesion=${id}x`)).toBeNull();
    expect(leerCookie("__Host-sesion=' OR 1=1 --aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBeNull();
    expect(leerCookie(`otrasesion=${id}`)).toBeNull();
    expect(leerCookie(`sesion=${id}`)).toBeNull(); // el nombre sin prefijo (el de antes del 08/11/2026) ya no vale
  });
});

describe('vida de la sesión con reloj simulado (30 min sin actividad, 8 h absoluta)', () => {
  const t0 = new Date('2026-11-08T12:00:00Z');
  const mas = (ms: number): Date => new Date(t0.getTime() + ms);
  const sesion = (ultima: Date) => ({ creada_en: t0, ultima_actividad: ultima, expira_en: mas(VIDA_ABSOLUTA_MS), revocada_en: null as Date | null });

  it('viva hasta 30 min sin actividad; a los 30 min exactos, vencida', () => {
    expect(motivoDeVencimiento(sesion(t0), mas(INACTIVIDAD_MS - 1))).toBeNull();
    expect(motivoDeVencimiento(sesion(t0), mas(INACTIVIDAD_MS))).toBe('inactividad');
  });
  it('la actividad la mantiene viva, pero nunca más allá de las 8 h desde que se creó', () => {
    expect(motivoDeVencimiento(sesion(mas(VIDA_ABSOLUTA_MS - 60_000)), mas(VIDA_ABSOLUTA_MS - 1))).toBeNull();
    expect(motivoDeVencimiento(sesion(mas(VIDA_ABSOLUTA_MS - 60_000)), mas(VIDA_ABSOLUTA_MS))).toBe('absoluta');
  });
  it('revocada (cierre, cambio de clave) no vale aunque esté dentro de los dos plazos', () => {
    expect(motivoDeVencimiento({ ...sesion(t0), revocada_en: t0 }, mas(1000))).toBe('revocada');
  });
  it('se renueva como mucho una vez por minuto; la clave temporal vence a la hora exacta', () => {
    expect(debeRenovar(t0, mas(RENOVAR_CADA_MS - 1))).toBe(false);
    expect(debeRenovar(t0, mas(RENOVAR_CADA_MS))).toBe(true);
    expect(claveTemporalVencida(mas(24 * 3600_000), mas(24 * 3600_000 - 1))).toBe(false);
    expect(claveTemporalVencida(mas(24 * 3600_000), mas(24 * 3600_000))).toBe(true);
    expect(claveTemporalVencida(null, mas(1e12))).toBe(false);
  });
  it('la clave temporal con la vigencia por defecto (2 h): vale a 1 h 59 min, vencida a las 2 h y 1 s; con otra vigencia (24 h), la suya', () => {
    const v2 = venceClaveTemporal(t0, 2);
    expect(claveTemporalVencida(v2, mas((60 + 59) * 60_000))).toBe(false);
    expect(claveTemporalVencida(v2, mas(2 * 3600_000 + 1000))).toBe(true);
    const v24 = venceClaveTemporal(t0, 24);
    expect(claveTemporalVencida(v24, mas(2 * 3600_000 + 1000))).toBe(false);
    expect(claveTemporalVencida(v24, mas(24 * 3600_000 + 1000))).toBe(true);
  });
});
