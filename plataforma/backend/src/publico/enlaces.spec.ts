import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { AlcanceService } from '../sesion/alcance.service.js';
import { Rol, UsuarioSesion, exigir, usuarioSistema } from '../sesion/permisos.js';
import { EnlacesController } from './enlaces.controller.js';
import { EnlacesService, TOPE_ENLACES } from './enlaces.service.js';
import { LimitesPublico, hashToken, validarRenovacion, validarVista } from './publico.js';
import type { VistaPublicaService } from './vista-publica.service.js';

// Administrar los enlaces de un sitio (docs/19 §4, O, puntos 3, 4 y 10; docs/20 §6, fila «Administrar los enlaces públicos»).
const S = '55555555-5555-4555-8555-555555555555';
const OTRO = '77777777-7777-4777-8777-777777777777';
const E = '66666666-6666-4666-8666-666666666666';
const Z = '11111111-1111-4111-8111-111111111111';
const L: LimitesPublico = { kPorOmision: 3, kPiso: 1, vencimientoMaxDias: 180, maxEnlacesPorSitio: 50, maxEnlacesTecho: 200 };
const persona = (sitios: [string, Rol][]): UsuarioSesion => ({ ...usuarioSistema(), id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid', sistema: false, todos: false, sitios: new Map(sitios), sesionId: 'a'.repeat(64) });
const cuerpo = { titulo: 'Clima', magnitudes: ['temperatura'], ventana_maxima: '7d' };

function controlador() {
  const vacio = () => Promise.resolve({});
  const servicio = { listar: vi.fn(() => Promise.resolve([])), crear: vi.fn(vacio), previa: vi.fn(vacio), renovar: vi.fn(vacio), revocar: vi.fn(vacio), tope: vi.fn(vacio), fijarTope: vi.fn(vacio), minimo: vi.fn(vacio), fijarMinimo: vi.fn(vacio) };
  // El sitio existe solo si es S u OTRO; exigir() decide 404/403 como en la pila (permisos.ts).
  const alcance = { exigirSitio: vi.fn((u: UsuarioSesion, accion: 'enlaces', id: string) => Promise.resolve().then(() => exigir(u, accion, [S, OTRO].includes(id) ? id : null, 'sitio no encontrado'))) };
  const c = new EnlacesController(servicio as unknown as EnlacesService, { limites: L } as VistaPublicaService, alcance as unknown as AlcanceService);
  return { c, servicio, alcance };
}
const codigo = async (p: Promise<unknown>): Promise<number> => {
  try { await p; return 200; } catch (e) { if (e instanceof HttpException) return e.getStatus(); throw e; }
};

describe('EnlacesController: quién puede y en qué orden', () => {
  it('la matriz: administrador de sitio y del sistema, sí; consulta, investigador y operador, 403; otro sitio, 404', async () => {
    for (const rol of ['consulta', 'investigador', 'operador'] as const) expect(await codigo(controlador().c.listar(persona([[S, rol]]), S)), rol).toBe(403);
    expect(await codigo(controlador().c.listar(persona([[S, 'administrador']]), S))).toBe(200);
    expect(await codigo(controlador().c.listar(usuarioSistema(), S))).toBe(200);
    expect(await codigo(controlador().c.listar(persona([[S, 'administrador']]), OTRO))).toBe(404);
    expect(await codigo(controlador().c.listar(persona([[S, 'administrador']]), '99999999-9999-4999-8999-999999999999'))).toBe(404);
  });
  it('sin la acción en ningún sitio: 403 antes de mirar el cuerpo (no aprende su forma); después el cuerpo (400) y después el sitio (404)', async () => {
    const { c, servicio } = controlador();
    expect(await codigo(c.crear(persona([[S, 'consulta']]), S, { basura: true }))).toBe(403);
    expect(await codigo(c.previa(persona([[S, 'operador']]), S, { basura: true }))).toBe(403);
    expect(await codigo(c.crear(persona([[OTRO, 'administrador']]), S, { basura: true }))).toBe(400);
    expect(await codigo(c.crear(persona([[OTRO, 'administrador']]), S, cuerpo))).toBe(404);
    expect(await codigo(c.renovar(persona([[S, 'administrador']]), S, 'no-uuid', { plazo_dias: 30 }))).toBe(400);
    expect(await codigo(c.revocar(persona([[S, 'investigador']]), S, E))).toBe(403);
    expect(servicio.crear).not.toHaveBeenCalled();
  });
  it('la lista: solo los vivos por omisión, todos con incluir=todos; otro valor, 400. El tope: lo fija el administrador, 403 antes del cuerpo', async () => {
    const { c, servicio } = controlador();
    const adm = persona([[S, 'administrador']]);
    await c.listar(adm, S);
    await c.listar(adm, S, 'todos');
    expect(servicio.listar.mock.calls).toEqual([[S, false], [S, true]]);
    expect(await codigo(c.listar(adm, S, 'muertos'))).toBe(400);
    expect(await codigo(c.fijarTope(persona([[S, 'consulta']]), S, { basura: 1 }))).toBe(403);
    expect(await codigo(c.fijarTope(adm, S, { max_enlaces: 201 }))).toBe(400);
    await c.fijarTope(adm, S, { max_enlaces: 20 });
    expect(servicio.fijarTope).toHaveBeenCalledWith(S, 20, 'u1');
    expect(await codigo(c.leerTope(persona([[S, 'investigador']]), S))).toBe(403);
  });
  it('el k del sitio: lo fija el administrador (del piso a 20); otro perfil, 403 antes del cuerpo; fuera de rango, 400', async () => {
    const { c, servicio } = controlador();
    const adm = persona([[S, 'administrador']]);
    expect(await codigo(c.fijarMinimo(persona([[S, 'operador']]), S, { basura: 1 }))).toBe(403);
    expect(await codigo(c.fijarMinimo(adm, S, { minimo_dispositivos: 21 }))).toBe(400);
    expect(await codigo(c.fijarMinimo(adm, OTRO, { minimo_dispositivos: 2 }))).toBe(404);
    await c.fijarMinimo(adm, S, { minimo_dispositivos: 2 });
    expect(servicio.fijarMinimo).toHaveBeenCalledWith(S, 2, 'u1');
    expect(await codigo(c.leerMinimo(persona([[S, 'consulta']]), S))).toBe(403);
  });
  it('con permiso: el servicio recibe el sitio de la ruta, lo validado y quién lo hace', async () => {
    const { c, servicio } = controlador();
    await c.crear(persona([[S, 'administrador']]), S, cuerpo);
    expect(servicio.crear).toHaveBeenCalledWith(S, validarVista(cuerpo, L), 'u1');
    await c.revocar(usuarioSistema(), S, E);
    expect(servicio.revocar).toHaveBeenCalledWith(S, E, null);
  });
});

// El servicio contra una conexión falsa que registra cada sentencia.
interface Base { noRevocados?: number; fijado?: number | null; fila?: { creado_en: string; expira_en: string; revocado_en: string | null; ahora: string } | null; revocadoAntes?: boolean; zonas?: { id: string; nombre: string }[] }
function servicio(o: Base = {}) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const cliente = {
    on: vi.fn(), off: vi.fn(), release: vi.fn(),
    query: vi.fn(async (texto: string, p: unknown[] = []) => {
      await Promise.resolve();
      sql.push(texto.trim());
      params.push(p);
      if (texto.includes('FROM magnitud WHERE codigo = ANY')) return { rows: (p[0] as string[]).filter((m) => m !== 'inventada').map((codigo) => ({ codigo })) };
      if (texto.includes('FROM zona WHERE sitio_id')) return { rows: o.zonas ?? [] };
      if (texto.includes('AS fijado')) return { rows: [{ fijado: o.fijado ?? null, vivos: o.noRevocados ?? 0 }] };
      if (texto.includes('AS equipos')) return { rows: [] };
      if (texto.includes('INSERT INTO enlace_publico')) return { rows: [{ id: E, expira_en: '2026-12-17T00:00:00.000Z' }] };
      if (texto.includes('FOR UPDATE')) return { rows: o.fila === null ? [] : [o.fila] };
      if (texto.includes('UPDATE enlace_publico SET renovado_en')) return { rows: [{ expira_en: '2026-12-17T00:00:00.000Z' }] };
      if (texto.includes('UPDATE enlace_publico SET revocado_en')) return { rows: o.revocadoAntes || o.fila === null ? [] : [{ id: E }] };
      if (texto.includes('SELECT 1 FROM enlace_publico')) return { rows: o.fila === null ? [] : [{}] };
      if (texto.includes('INSERT INTO evento')) return { rows: [{ ocurrido_en: new Date() }] };
      if (texto.includes('FROM enlace_publico e JOIN sitio')) {
        return { rows: [{ id: E, titulo: 'Clima', descripcion: null, ventana_maxima: '7d', zonas: [], magnitudes: [], creado_por: null, revocado_por: null,
          creado_en: '2026-11-17T00:00:00.000Z', expira_en: '2026-12-17T00:00:00.000Z', renovado_en: null, revocado_en: null, accesos_7d: 0, ahora: '2026-11-17T12:00:00.000Z' }] };
      }
      return { rows: [] };
    }),
  };
  const pool = { connect: vi.fn(() => Promise.resolve(cliente)) } as unknown as Pool;
  const olvidar = vi.fn();
  const vista = { limites: L, olvidar } as unknown as VistaPublicaService;
  return { s: new EnlacesService(pool, vista), sql, params, cliente, olvidar };
}
const dias = (n: number): string => new Date(Date.parse('2026-11-17T12:00:00Z') + n * 86_400_000).toISOString();

describe('EnlacesService: crear', () => {
  it('candado por sitio antes de contar; el token sale una vez y a la base va solo su resumen; evento con el sitio', async () => {
    const { s, sql, params } = servicio({ zonas: [{ id: Z, nombre: 'Norte' }] });
    const r = await s.crear(S, validarVista({ ...cuerpo, zonas: [Z] }, L), 'u1');
    expect(sql.findIndex((x) => x.includes('pg_advisory_xact_lock'))).toBeLessThan(sql.findIndex((x) => x.includes('AS fijado')));
    const insercion = params[sql.findIndex((x) => x.startsWith('INSERT INTO enlace_publico'))];
    expect(insercion[1]).toBe(hashToken(r.token));
    expect(JSON.stringify(params)).not.toContain(r.token);
    expect(insercion[4]).toBe(JSON.stringify([{ id: Z, nombre: 'Norte' }]));
    const evento = params[sql.findIndex((x) => x.startsWith('INSERT INTO evento'))];
    expect(evento[1]).toBe('enlace_creado');
    expect(JSON.parse(evento[2] as string)).toMatchObject({ sitio_id: S, enlace_id: E, plazo_dias: 30, k_sitio: 3, k_por_omision: 3, retencion_dias: 90 });
    expect(r).toMatchObject({ id: E, direccion: `/panel/#/v/${r.token}`, estado: 'vigente', renovable: true });
    expect(sql.at(-1)).toBe('COMMIT');
  });
  it('con el tope de enlaces no revocados: 409 con el texto del diseño, sin insertar; una magnitud o una zona ajena, 400', async () => {
    const lleno = servicio({ noRevocados: 50 });
    const e = await lleno.s.crear(S, validarVista(cuerpo, L), 'u1').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect((e as ConflictException).getResponse()).toMatchObject({ codigo: 'tope_enlaces', message: TOPE_ENLACES(50) });
    // El tope que fijó el administrador del sitio rige, con su número en el texto; nunca más que el techo del despliegue.
    const fijado = await servicio({ noRevocados: 7, fijado: 7 }).s.crear(S, validarVista(cuerpo, L), 'u1').catch((x: unknown) => x);
    expect((fijado as ConflictException).getResponse()).toMatchObject({ message: 'Este sitio ya tiene 7 enlaces. Revoca uno para crear otro.' });
    expect(await servicio({ noRevocados: 6, fijado: 7 }).s.crear(S, validarVista(cuerpo, L), 'u1')).toMatchObject({ id: E });
    expect(lleno.sql.some((x) => x.startsWith('INSERT INTO enlace_publico'))).toBe(false);
    expect(lleno.sql.at(-1)).toBe('ROLLBACK');
    await expect(servicio().s.crear(S, validarVista({ ...cuerpo, magnitudes: ['inventada'] }, L), 'u1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(servicio({ zonas: [] }).s.crear(S, validarVista({ ...cuerpo, zonas: [Z] }, L), 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('EnlacesService: el k del sitio', () => {
  it('fijarlo deja el evento enlace_minimo con el anterior y responde que afecta a todos los enlaces del sitio', async () => {
    const b = servicio();
    const r = await b.s.fijarMinimo(S, 2, 'u1');
    const evento = b.params[b.sql.findIndex((x) => x.startsWith('INSERT INTO evento'))];
    expect(evento[1]).toBe('enlace_minimo');
    expect(JSON.parse(evento[2] as string)).toMatchObject({ sitio_id: S, minimo_dispositivos: 2, anterior: 3 });
    expect(b.sql.some((x) => x.startsWith('UPDATE sitio SET publico_minimo_dispositivos'))).toBe(true);
    expect(r.avisos[0]).toBe('Este mínimo afecta a todos los enlaces públicos de este sitio.');
    expect(b.sql.indexOf('COMMIT')).toBeGreaterThan(0);
  });
});

describe('EnlacesService: renovar y revocar', () => {
  const ahora = '2026-11-17T12:00:00.000Z';
  it('revocado, vencido hace más de 30 días o de más de un año: 409 no_renovable, sin cambiar nada', async () => {
    for (const fila of [{ creado_en: dias(-10), expira_en: dias(5), revocado_en: dias(-1), ahora }, { creado_en: dias(-40), expira_en: dias(-31), revocado_en: null, ahora },
      { creado_en: dias(-366), expira_en: dias(5), revocado_en: null, ahora }]) {
      const b = servicio({ fila });
      const e = await b.s.renovar(S, E, validarRenovacion({ plazo_dias: 30 }, L), 'u1').catch((x: unknown) => x);
      expect((e as ConflictException).getResponse()).toMatchObject({ codigo: 'no_renovable' });
      expect(b.sql.some((x) => x.startsWith('UPDATE'))).toBe(false);
    }
    await expect(servicio({ fila: null }).s.renovar(S, E, validarRenovacion({ plazo_dias: 30 }, L), 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('un plazo que acorta: 409 con las dos fechas; confirmado, renueva y deja el evento con el vencimiento anterior', async () => {
    const fila = { creado_en: dias(-10), expira_en: dias(80), revocado_en: null, ahora };
    const e = await servicio({ fila }).s.renovar(S, E, validarRenovacion({ plazo_dias: 30 }, L), 'u1').catch((x: unknown) => x);
    expect((e as ConflictException).getResponse()).toMatchObject({ codigo: 'acorta', expira_en_actual: dias(80), expira_en_nueva: dias(30) });
    const b = servicio({ fila });
    const r = await b.s.renovar(S, E, validarRenovacion({ plazo_dias: 30, acortar: true }, L), 'u1');
    expect(r).toMatchObject({ acorta: true, expira_en_anterior: dias(80) });
    const evento = b.params[b.sql.findIndex((x) => x.startsWith('INSERT INTO evento'))];
    expect(evento[1]).toBe('enlace_renovado');
    expect(JSON.parse(evento[2] as string)).toMatchObject({ sitio_id: S, enlace_id: E, plazo_dias: 30, expira_en_anterior: dias(80) });
  });
  it('revocar: deja el evento y libera lo guardado; ya revocado, 409; de otro sitio o inexistente, 404', async () => {
    const b = servicio({ fila: { creado_en: dias(-1), expira_en: dias(5), revocado_en: null, ahora } });
    await b.s.revocar(S, E, 'u1');
    expect(b.params[b.sql.findIndex((x) => x.startsWith('INSERT INTO evento'))][1]).toBe('enlace_revocado');
    expect(b.olvidar).toHaveBeenCalledWith(E);
    await expect(servicio({ revocadoAntes: true, fila: { creado_en: dias(-1), expira_en: dias(5), revocado_en: dias(0), ahora } }).s.revocar(S, E, 'u1')).rejects.toBeInstanceOf(ConflictException);
    await expect(servicio({ fila: null }).s.revocar(S, E, 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('renovar y revocar buscan el enlace con el sitio de la ruta en el WHERE: un enlace de otro sitio no se toca', async () => {
    const b = servicio({ fila: { creado_en: dias(-1), expira_en: dias(5), revocado_en: null, ahora } });
    await b.s.renovar(S, E, validarRenovacion({ plazo_dias: 90 }, L), 'u1');
    await b.s.revocar(S, E, 'u1');
    const escrituras = b.sql.map((x, i) => [x, b.params[i]] as const).filter(([x]) => x.startsWith('UPDATE enlace_publico') || x.includes('FOR UPDATE'));
    expect(escrituras).toHaveLength(3);
    for (const [x, p] of escrituras) {
      expect(x).toContain('sitio_id = $2');
      expect(p.slice(0, 2)).toEqual([E, S]);
    }
  });
});
