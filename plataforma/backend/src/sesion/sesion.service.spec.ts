import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import type { Pool } from 'pg';
import * as credenciales from '../alta/credenciales.js';
import { INACTIVIDAD_MS, VIDA_ABSOLUTA_MS, hashIdentificador } from './cookie.js';
import { matrizPorRol, usuarioSistema } from './permisos.js';
import { MENSAJE_CREDENCIALES, SesionService, credencialesDelCuerpo } from './sesion.service.js';

// La sesión de punta a punta contra una base falsa en memoria y un reloj simulado (docs/20 §3, §4 y §8). El hash real (N = 2^17) se
// reemplaza por uno trivial: aquí se prueba QUÉ se verifica y cuándo; el costo y el tiempo igual los mide el guardián contra el backend.
interface Usuario { id: string; nombre: string; email: string; hash_password: string; activo: boolean; clave_temporal: boolean; clave_temporal_vence_en: Date | null }
interface Sesion { id: string; usuario_id: string; creada_en: Date; ultima_actividad: Date; expira_en: Date; revocada_en: Date | null }

function base(usuarios: Usuario[]) {
  const sesiones: Sesion[] = [];
  const accesos: { resultado: string; usuario_id: string | null; email: string | null; sesion_id: string | null }[] = [];
  const eventos: string[] = [];
  const query = vi.fn((sql: string, p: unknown[] = []) => {
    const filas = (rows: unknown[]) => Promise.resolve({ rows, rowCount: rows.length });
    if (sql.startsWith('SELECT id, nombre, email, hash_password')) {
      return filas(usuarios.filter((u) => (sql.includes('WHERE email') ? u.email === p[0] : u.id === p[0])));
    }
    if (sql.startsWith('INSERT INTO sesion')) {
      sesiones.push({ id: p[0] as string, usuario_id: p[1] as string, creada_en: p[2] as Date, ultima_actividad: p[2] as Date, expira_en: p[3] as Date, revocada_en: null });
      return filas([]);
    }
    if (sql.startsWith('INSERT INTO acceso')) {
      accesos.push({ usuario_id: p[1] as string | null, email: p[2] as string | null, resultado: p[4] as string, sesion_id: p[5] as string | null });
      return filas([]);
    }
    if (sql.includes('FROM sesion s JOIN usuario u')) {
      const s = sesiones.find((x) => x.id === p[0]);
      const u = s && usuarios.find((x) => x.id === s.usuario_id);
      return filas(s && u ? [{ ...s, usuario_id: u.id, nombre: u.nombre, email: u.email, activo: u.activo, clave_temporal: u.clave_temporal, clave_temporal_vence_en: u.clave_temporal_vence_en, sitios: [{ sitio_id: 's1', rol: 'consulta' }] }] : []);
    }
    if (sql.startsWith('UPDATE sesion SET ultima_actividad')) {
      const s = sesiones.find((x) => x.id === p[0] && x.revocada_en === null);
      if (s) s.ultima_actividad = p[1] as Date;
      return filas(s ? [s] : []);
    }
    if (sql.startsWith('UPDATE sesion SET revocada_en')) {
      const afectadas = sesiones.filter((x) => x.revocada_en === null && (sql.includes('usuario_id = $1') ? x.usuario_id === p[0] : x.id === p[0]));
      for (const s of afectadas) s.revocada_en = p[1] as Date;
      return Promise.resolve({ rows: [], rowCount: afectadas.length });
    }
    if (sql.startsWith('UPDATE usuario SET hash_password')) {
      const u = usuarios.find((x) => x.id === p[0])!;
      Object.assign(u, { hash_password: p[1], clave_temporal: false, clave_temporal_vence_en: null });
      return filas([]);
    }
    if (sql.startsWith('INSERT INTO evento')) { eventos.push(sql); return filas([]); }
    return filas([]); // BEGIN, COMMIT
  });
  const pool = { query, connect: () => Promise.resolve({ query, release: () => undefined }) } as unknown as Pool;
  return { pool, sesiones, accesos, eventos, query };
}

describe('SesionService (docs/20 §3–§4) con reloj simulado', () => {
  let verificar: MockInstance;
  let hashear: MockInstance;
  beforeEach(() => {
    hashear = vi.spyOn(credenciales, 'hashScrypt').mockImplementation((s: string) => Promise.resolve(`falso$${s}`));
    verificar = vi.spyOn(credenciales, 'verificarScrypt').mockImplementation((s: string, h: string) => Promise.resolve(h === `falso$${s}`));
  });
  afterEach(() => vi.restoreAllMocks());

  const ANA: Usuario = { id: 'u-ana', nombre: 'Ana', email: 'ana@ejemplo.invalid', hash_password: 'falso$caballo correcto bateria', activo: true, clave_temporal: false, clave_temporal_vence_en: null };
  const armar = (usuarios: Usuario[] = [{ ...ANA }]) => {
    const b = base(usuarios);
    const s = new SesionService(b.pool);
    let ahora = new Date('2026-11-08T12:00:00Z').getTime();
    s.ahora = () => new Date(ahora);
    return { ...b, s, usuarios, avanzar: (ms: number) => { ahora += ms; } };
  };
  const credencial = (email: string, clave: string) => ({ email, clave });
  const fallo = async (p: Promise<unknown>): Promise<{ codigo: number; mensaje: unknown }> => {
    try { await p; return { codigo: 200, mensaje: null }; } catch (e) {
      const h = e as HttpException; return { codigo: h.getStatus(), mensaje: (h.getResponse() as { message: unknown }).message };
    }
  };

  it('inicio correcto: identificador de 43 caracteres que la base guarda solo como hash; fila ok en acceso con la sesión', async () => {
    const { s, sesiones, accesos } = armar();
    const r = await s.iniciar(credencial('  ANA@ejemplo.invalid ', 'caballo correcto bateria'), '192.0.2.1', 'navegador de prueba');
    expect(r.identificador).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sesiones).toHaveLength(1);
    expect(sesiones[0].id).toBe(hashIdentificador(r.identificador));
    expect(JSON.stringify(sesiones)).not.toContain(r.identificador);
    expect(sesiones[0].expira_en.getTime() - sesiones[0].creada_en.getTime()).toBe(VIDA_ABSOLUTA_MS);
    expect(accesos).toEqual([{ resultado: 'ok', usuario_id: 'u-ana', email: 'ana@ejemplo.invalid', sesion_id: sesiones[0].id }]);
  });

  it('inexistente, inactivo y clave mala: el mismo 401 «credenciales no válidas», y el hash se calcula en los tres', async () => {
    const { s, accesos } = armar([{ ...ANA }, { ...ANA, id: 'u-ines', email: 'ines@ejemplo.invalid', activo: false }]);
    const casos = [credencial('nadie@ejemplo.invalid', 'caballo correcto bateria'), credencial('ines@ejemplo.invalid', 'caballo correcto bateria'), credencial('ana@ejemplo.invalid', 'otra clave cualquiera')];
    for (const c of casos) expect(await fallo(s.iniciar(c, '192.0.2.1', undefined))).toEqual({ codigo: 401, mensaje: MENSAJE_CREDENCIALES });
    expect(verificar).toHaveBeenCalledTimes(3);
    expect(accesos.map((a) => [a.resultado, a.usuario_id])).toEqual([['clave_incorrecta', null], ['inactivo', 'u-ines'], ['clave_incorrecta', 'u-ana']]);
  });

  it('6 claves malas seguidas: la sexta responde «bloqueado» (429) aunque sea la correcta, sin calcular el hash, y acceso tiene las 6 filas', async () => {
    const { s, accesos } = armar();
    for (let i = 0; i < 5; i++) expect((await fallo(s.iniciar(credencial(ANA.email, `mala ${i} larguisima`), '192.0.2.1', undefined))).codigo).toBe(401);
    verificar.mockClear();
    const sexta = await fallo(s.iniciar(credencial(ANA.email, 'caballo correcto bateria'), '192.0.2.1', undefined));
    expect(sexta.codigo).toBe(429);
    expect(String(sexta.mensaje)).toMatch(/^bloqueado/);
    expect(verificar).not.toHaveBeenCalled();
    expect(accesos.map((a) => a.resultado)).toEqual([...Array(5).fill('clave_incorrecta'), 'bloqueado']);
  });

  it('la clave temporal vencida no abre sesión; vigente, sí, marcada como temporal', async () => {
    const vence = new Date('2026-11-09T12:00:00Z');
    const { s, avanzar } = armar([{ ...ANA, clave_temporal: true, clave_temporal_vence_en: vence }]);
    const r = await s.iniciar(credencial(ANA.email, 'caballo correcto bateria'), '192.0.2.1', undefined);
    expect(r.usuario.clave_temporal).toBe(true);
    avanzar(24 * 3600_000);
    expect((await fallo(s.iniciar(credencial(ANA.email, 'caballo correcto bateria'), '192.0.2.1', undefined))).codigo).toBe(401);
  });

  it('cargar: viva con actividad; vence a los 30 min sin actividad y a las 8 h aunque haya actividad; renueva como mucho cada minuto', async () => {
    const { s, avanzar, query } = armar();
    const { identificador } = await s.iniciar(credencial(ANA.email, 'caballo correcto bateria'), '192.0.2.1', undefined);
    const renovaciones = () => query.mock.calls.filter(([q]) => String(q).startsWith('UPDATE sesion SET ultima_actividad')).length;
    expect((await s.cargar(identificador))?.sitios.get('s1')).toBe('consulta');
    expect(renovaciones()).toBe(0); // recién creada: no hace falta escribir
    avanzar(61_000);
    await s.cargar(identificador);
    expect(renovaciones()).toBe(1);
    for (let t = 61_000; t < VIDA_ABSOLUTA_MS - 20 * 60_000; t += 20 * 60_000) { avanzar(20 * 60_000); expect(await s.cargar(identificador)).not.toBeNull(); }
    avanzar(20 * 60_000); // 8 h y un minuto desde que se creó, con actividad hace 20 min: vence por la vida absoluta
    expect(await s.cargar(identificador)).toBeNull();

    const otra = await s.iniciar(credencial(ANA.email, 'caballo correcto bateria'), '192.0.2.1', undefined);
    avanzar(INACTIVIDAD_MS);
    expect(await s.cargar(otra.identificador)).toBeNull();
    expect(await s.cargar('x'.repeat(43))).toBeNull(); // nunca existió
  });

  it('cerrar revoca la sesión (el identificador viejo deja de valer) y deja «cierre»; cerrar en todos lados revoca las demás', async () => {
    const { s, accesos } = armar();
    const a = await s.iniciar(credencial(ANA.email, 'caballo correcto bateria'), '192.0.2.1', undefined);
    const b = await s.iniciar(credencial(ANA.email, 'caballo correcto bateria'), '192.0.2.2', undefined);
    const c = await s.iniciar(credencial(ANA.email, 'caballo correcto bateria'), '192.0.2.3', undefined);
    expect(a.identificador).not.toBe(b.identificador); // dos inicios: dos sesiones independientes
    expect(await s.cerrar((await s.cargar(a.identificador))!, false, '192.0.2.1')).toBe(1);
    expect(await s.cargar(a.identificador)).toBeNull();
    expect(await s.cargar(b.identificador)).not.toBeNull();
    expect(await s.cerrar((await s.cargar(b.identificador))!, true, '192.0.2.2')).toBe(2);
    expect(await s.cargar(c.identificador)).toBeNull();
    expect(accesos.filter((x) => x.resultado === 'cierre')).toHaveLength(2);
  });

  it('cambiar la clave: exige la actual, aplica las reglas, revoca todas las sesiones y abre una nueva con otro identificador', async () => {
    const { s, usuarios, eventos } = armar();
    const vieja = await s.iniciar(credencial(ANA.email, 'caballo correcto bateria'), '192.0.2.1', undefined);
    const u = (await s.cargar(vieja.identificador))!;
    await expect(s.cambiarClave(u, { actual: 'no es la actual de nadie', nueva: 'otra frase bastante larga' }, '192.0.2.1', undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.cambiarClave(u, { actual: 'caballo correcto bateria', nueva: 'corta' }, '192.0.2.1', undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.cambiarClave(u, { actual: 'caballo correcto bateria', nueva: 'caballo correcto bateria' }, '192.0.2.1', undefined)).rejects.toBeInstanceOf(BadRequestException);
    const nueva = await s.cambiarClave(u, { actual: 'caballo correcto bateria', nueva: 'otra frase bastante larga' }, '192.0.2.1', undefined);
    expect(nueva.identificador).not.toBe(vieja.identificador);
    expect(await s.cargar(vieja.identificador)).toBeNull();
    expect(await s.cargar(nueva.identificador)).not.toBeNull();
    expect(usuarios[0].hash_password).toBe('falso$otra frase bastante larga');
    expect(eventos).toHaveLength(1);
  });

  it('GET /sesion trae la matriz rol → acciones de la tabla que decide (la guía de perfiles del panel), con sesión y con la clave por cabecera', async () => {
    const { s } = armar();
    const abierta = await s.iniciar(credencial(ANA.email, 'caballo correcto bateria'), '192.0.2.1', undefined);
    const u = (await s.cargar(abierta.identificador))!;
    expect((await s.describir(u)).permisos).toEqual(matrizPorRol());
    expect((await s.describir(usuarioSistema())).permisos).toEqual(matrizPorRol());
  });

  it('el 429 de POST /sesion/clave trae los segundos de espera en reintentar_en_s, como el de POST /sesion', async () => {
    const { s } = armar();
    const abierta = await s.iniciar(credencial(ANA.email, 'caballo correcto bateria'), '192.0.2.1', undefined);
    const u = (await s.cargar(abierta.identificador))!;
    for (let i = 0; i < 5; i++) s.bloqueos.registrarFallo(ANA.email, '192.0.2.1');
    const e = await s.cambiarClave(u, { actual: 'caballo correcto bateria', nueva: 'otra frase bastante larga' }, '192.0.2.1', undefined).catch((x: HttpException) => x);
    expect((e as HttpException).getStatus()).toBe(429);
    expect((e as HttpException).getResponse()).toMatchObject({ reintentar_en_s: 60 });
  });

  it('ventana comprobar-actuar: si el bloqueo se completó mientras se verificaba, 429 aunque la clave sea correcta, y «bloqueado» en acceso', async () => {
    const { s, accesos, sesiones } = armar();
    verificar.mockImplementation((clave: string, hash: string) => {
      // Mientras este intento esperaba su turno del hash, cinco intentos con clave mala desde otra dirección completaron el bloqueo.
      for (let i = 0; i < 5; i++) s.bloqueos.registrarFallo(ANA.email, '198.51.100.9');
      return Promise.resolve(hash === `falso$${clave}`);
    });
    const r = await fallo(s.iniciar(credencial(ANA.email, 'caballo correcto bateria'), '192.0.2.1', undefined));
    expect(r.codigo).toBe(429);
    expect(String(r.mensaje)).toMatch(/^bloqueado/);
    expect(sesiones).toHaveLength(0);
    expect(accesos.map((a) => a.resultado)).toEqual(['bloqueado']);
  });

  it('el 429 deja UNA fila «bloqueado» por (email, dirección) y ventana de 15 min, no una por intento', async () => {
    const { s, accesos, avanzar } = armar();
    for (let i = 0; i < 5; i++) await fallo(s.iniciar(credencial(ANA.email, `mala ${i} larguisima`), '192.0.2.1', undefined));
    for (let i = 0; i < 3; i++) expect((await fallo(s.iniciar(credencial(ANA.email, 'otra mala larguisima'), '192.0.2.1', undefined))).codigo).toBe(429);
    expect(accesos.filter((a) => a.resultado === 'bloqueado')).toHaveLength(1);
    expect((await fallo(s.iniciar(credencial(ANA.email, 'otra mala larguisima'), '192.0.2.2', undefined))).codigo).toBe(429); // otra dirección: su fila
    expect(accesos.filter((a) => a.resultado === 'bloqueado')).toHaveLength(2);
    avanzar(60_000); // termina el bloqueo de 1 min; cinco fallos más lo renuevan (5 min) dentro de la misma ventana de registro
    for (let i = 0; i < 5; i++) await fallo(s.iniciar(credencial(ANA.email, `mala ${i} larguisima`), '192.0.2.1', undefined));
    await fallo(s.iniciar(credencial(ANA.email, 'otra mala larguisima'), '192.0.2.1', undefined));
    expect(accesos.filter((a) => a.resultado === 'bloqueado')).toHaveLength(2);
  });

  it('tope por dirección del hash: la tercera verificación simultánea de una dirección → 429 sin calcular; un 503 por cola llena cuenta como fallo de la dirección', async () => {
    const { s } = armar();
    const pendientes: (() => void)[] = [];
    verificar.mockImplementation(() => new Promise<boolean>((r) => pendientes.push(() => r(false))));
    const fallaIp = vi.spyOn(s.bloqueos, 'registrarFalloIp');
    const intentos: Promise<unknown>[] = [];
    // 11 direcciones × 2 = 22 verificaciones: 2 en curso y 20 en cola (turnos.ts).
    for (let i = 0; i < 11; i++) for (let j = 0; j < 2; j++) intentos.push(fallo(s.iniciar(credencial(ANA.email, 'mala larguisima'), `192.0.2.${10 + i}`, undefined)));
    await new Promise((r) => setImmediate(r));
    expect(verificar).toHaveBeenCalledTimes(2);
    expect((await fallo(s.iniciar(credencial(ANA.email, 'mala larguisima'), '192.0.2.10', undefined))).codigo).toBe(429); // tercera de esa dirección
    expect(fallaIp).not.toHaveBeenCalled();
    expect((await fallo(s.iniciar(credencial(ANA.email, 'mala larguisima'), '203.0.113.5', undefined))).codigo).toBe(503); // cola llena
    expect(fallaIp).toHaveBeenCalledWith('203.0.113.5');
    while (pendientes.length > 0 || verificar.mock.calls.length < 22) { pendientes.shift()?.(); await new Promise((r) => setImmediate(r)); }
    await Promise.all(intentos);
  });

  it('una clave temporal vencida deja de valer también en la sesión que ya estaba abierta', async () => {
    const { s, avanzar } = armar([{ ...ANA, clave_temporal: true, clave_temporal_vence_en: new Date('2026-11-08T12:50:00Z') }]);
    const { identificador } = await s.iniciar(credencial(ANA.email, 'caballo correcto bateria'), '192.0.2.1', undefined);
    avanzar(20 * 60_000);
    expect((await s.cargar(identificador))?.claveTemporal).toBe(true); // 12:20, vigente
    avanzar(20 * 60_000);
    expect(await s.cargar(identificador)).not.toBeNull(); // 12:40, vigente (y con actividad hace 20 min)
    avanzar(20 * 60_000);
    expect(await s.cargar(identificador)).toBeNull(); // 13:00: la temporal venció a las 12:50; la sesión, por sí sola, seguiría viva
  });

  it('el hash de relleno se calcula al arrancar (onModuleInit), no con el primer usuario inexistente', async () => {
    const { s } = armar();
    await s.onModuleInit();
    expect(hashear).toHaveBeenCalledTimes(1);
    await fallo(s.iniciar(credencial('nadie@ejemplo.invalid', 'cualquier clave larga'), '192.0.2.1', undefined));
    await fallo(s.iniciar(credencial('otro@ejemplo.invalid', 'cualquier clave larga'), '192.0.2.1', undefined));
    expect(hashear).toHaveBeenCalledTimes(1);
    expect(verificar).toHaveBeenCalledTimes(2); // y la verificación contra el relleno sí corre (mismo tiempo que un usuario real)
  });

  it('el cuerpo de POST /sesion: objeto con email y clave de texto; si no, 400 (no revela nada de la cuenta)', () => {
    for (const malo of [null, [], 'texto', {}, { email: 'a@b' }, { email: '', clave: 'x' }, { email: 'a@b', clave: 'x'.repeat(1025) }, { email: 1, clave: 2 }]) {
      expect(() => credencialesDelCuerpo(malo)).toThrow(BadRequestException);
    }
    expect(credencialesDelCuerpo({ email: ' Ana@X.invalid ', clave: ' con espacios ' })).toEqual({ email: 'ana@x.invalid', clave: ' con espacios ' });
    expect(new UnauthorizedException(MENSAJE_CREDENCIALES).getStatus()).toBe(401);
  });
});
