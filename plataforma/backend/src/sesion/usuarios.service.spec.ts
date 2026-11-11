import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Pool } from 'pg';
import type { AlcanceService } from './alcance.service.js';
import { Rol, UsuarioSesion, usuarioSistema } from './permisos.js';
import type { SesionService } from './sesion.service.js';
import type { CambioUsuario } from './usuarios.dto.js';
import { CANDADO_ADMINISTRADORES, UsuariosService, rechazoDeCambio, tocaAdministradores, tocaCuenta } from './usuarios.service.js';
import { ALTAS_POR_MINUTO, UsuariosController } from './usuarios.controller.js';

// Usuarios contra una base falsa (docs/20 §4 y §10; revisión del 08/11/2026): quién puede cambiar la cuenta de quién, el candado de los
// administradores y la clave de administrador en la lista. Sitios: A y B. El SQL real lo ejercita el paso 4b del guardián.
interface Persona { id: string; activo: boolean; sitios: { sitio: string; rol: Rol; activo: boolean }[]; sistema?: boolean; bajaDelSistema?: boolean }

function armar(personas: Persona[], config?: ConfigService) {
  const consultas: string[] = [];
  const parametros: unknown[][] = [];
  const query = vi.fn((sql: string, p: unknown[] = []) => {
    consultas.push(sql);
    parametros.push(p);
    const filas = (rows: unknown[], rowCount = rows.length) => Promise.resolve({ rows, rowCount });
    const alcance = (p[1] ?? null) as string[] | null;
    const en = (s: string) => alcance === null || alcance.includes(s);
    if (sql.includes('FOR NO KEY UPDATE')) {
      const u = personas.find((x) => x.id === p[0] && x.sitios.some((s) => en(s.sitio)));
      if (u === undefined) return filas([]);
      return filas([{
        actualizado_en: '2026-11-08T12:00:00.000000Z',
        en_mis_sitios: u.sitios.some((s) => s.activo && en(s.sitio)),
        ajenos: alcance === null ? [] : u.sitios.filter((s) => s.activo && !en(s.sitio)).map((s) => s.sitio),
        administradorSistema: u.sistema === true, bajaDelSistema: !u.activo && u.bajaDelSistema === true,
      }]);
    }
    if (sql.includes('UPDATE usuario SET nombre')) {
      const u = personas.find((x) => x.id === p[0])!;
      if (p[3] !== null) u.activo = p[3] as boolean;
      return filas([{ id: u.id }]);
    }
    if (sql.includes('INSERT INTO usuario_sitio') && sql.includes('ON CONFLICT')) {
      const u = personas.find((x) => x.id === p[0])!;
      const s = u.sitios.find((x) => x.sitio === p[1]);
      if (s) Object.assign(s, { rol: p[2], activo: true }); else u.sitios.push({ sitio: p[1] as string, rol: p[2] as Rol, activo: true });
      return filas([]);
    }
    if (sql.includes('AS hay')) {
      return filas([{ hay: personas.some((u) => u.activo && u.sitios.some((s) => s.activo && s.rol === 'administrador')) }]);
    }
    if (sql.includes('AS n FROM usuario WHERE administrador_sistema')) return filas([{ n: 0 }]);
    if (sql.includes('WHERE u.email = $1')) return filas([]); // el correo del alta no existe (exigirCorreoLibre)
    if (sql.startsWith('INSERT INTO usuario ')) return filas([{ id: 'nueva' }]);
    if (sql.includes('FROM usuario u')) return filas(personas.map((u) => ({ id: u.id }))); // listar y leer
    return filas([]); // BEGIN, SET LOCAL, candado, evento, sesiones, COMMIT, ROLLBACK
  });
  const pool = { query, connect: () => Promise.resolve({ query, release: () => undefined, on: () => undefined, off: () => undefined }) } as unknown as Pool;
  const sesiones = { hashClave: () => Promise.resolve('falso'), ahora: () => new Date('2026-11-08T12:00:00Z') } as unknown as SesionService;
  const alcance = {
    exigirSitio: (u: UsuarioSesion, _a: string, s: string) => (u.todos || u.sitios.get(s) === 'administrador' ? Promise.resolve() : Promise.reject(new NotFoundException('sitio no encontrado'))),
  } as unknown as AlcanceService;
  return { servicio: new UsuariosService(pool, sesiones, alcance, config), consultas, parametros, personas };
}

const ADMIN_A: UsuarioSesion = { ...usuarioSistema(), id: 'adm-a', nombre: 'Admin A', sistema: false, todos: false, sitios: new Map([['A', 'administrador']]), sesionId: 'a'.repeat(64) };
const cambio = (c: Partial<CambioUsuario>): CambioUsuario => ({ actualizado_en: '2026-11-08T12:00:00.000000Z', ...c });
const codigo = async (p: Promise<unknown>): Promise<number | string> => {
  try { await p; return 200; } catch (e) { return e instanceof HttpException ? e.getStatus() : String(e); }
};
const personas = (): Persona[] => [
  { id: 'adm-a', activo: true, sitios: [{ sitio: 'A', rol: 'administrador', activo: true }] },
  { id: 'beto', activo: true, sitios: [{ sitio: 'A', rol: 'consulta', activo: true }, { sitio: 'B', rol: 'administrador', activo: true }] },
  { id: 'carla', activo: true, sitios: [{ sitio: 'A', rol: 'consulta', activo: true }] },
  { id: 'dora', activo: true, sitios: [{ sitio: 'A', rol: 'consulta', activo: false }, { sitio: 'B', rol: 'consulta', activo: true }] },
  { id: 'eva', activo: true, sitios: [{ sitio: 'B', rol: 'administrador', activo: true }] },
];

describe('Quién cambia la cuenta de quién (revisión del 08/11/2026: escalada entre sitios)', () => {
  it('la regla: la cuenta, solo si cubro TODOS sus sitios activos; los roles de mis sitios, siempre; el usuario del sistema, todo', () => {
    const P = { administradorSistema: false, bajaDelSistema: false };
    expect(rechazoDeCambio(['A'], true, ['B'], cambio({ activo: false }), P)).toMatch(/^la cuenta pertenece también a otros sitios/);
    expect(rechazoDeCambio(['A'], true, ['B'], cambio({ clave_temporal: true }), P)).not.toBeNull();
    expect(rechazoDeCambio(['A'], true, ['B'], cambio({ nombre: 'Otro' }), P)).not.toBeNull();
    expect(rechazoDeCambio(['A'], true, ['B'], cambio({ sitios: [{ sitio_id: 'A', rol: 'administrador' }] }), P)).toBeNull();
    expect(rechazoDeCambio(['A'], true, [], cambio({ activo: false, clave_temporal: true }), P)).toBeNull();
    expect(rechazoDeCambio(['A'], false, ['B'], cambio({ activo: false }), P)).toMatch(/^la persona ya no está en ninguno de tus sitios/);
    expect(rechazoDeCambio(['A'], false, ['B'], cambio({ sitios: [{ sitio_id: 'A', rol: 'consulta' }] }), P)).toBeNull();
    expect(rechazoDeCambio(null, true, [], cambio({ activo: false }), P)).toBeNull();
    expect([tocaCuenta(cambio({ sitios: [] })), tocaCuenta(cambio({ nombre: 'x' })), tocaAdministradores(cambio({ nombre: 'x' })), tocaAdministradores(cambio({ activo: true }))])
      .toEqual([false, true, false, true]);
  });

  it('administrador de A: desactivar, clave temporal o renombrar a quien también está en B → 403; a quien solo está en A → 200', async () => {
    const { servicio, personas: p } = armar(personas());
    for (const c of [{ activo: false, motivo: 'prueba' }, { clave_temporal: true as const }, { nombre: 'Beto renombrado' }]) {
      const e = await servicio.actualizar(ADMIN_A, 'beto', cambio(c)).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).message).toBe('la cuenta pertenece también a otros sitios: pídelo a un administrador del sistema');
    }
    expect(p.find((x) => x.id === 'beto')!.activo).toBe(true);
    expect(await codigo(servicio.actualizar(ADMIN_A, 'beto', cambio({ sitios: [{ sitio_id: 'A', rol: 'administrador' }] })))).toBe(200); // su rol en MI sitio
    expect(await codigo(servicio.actualizar(ADMIN_A, 'beto', cambio({ sitios: [{ sitio_id: 'B', rol: null }] })))).toBe(404); // B no es mío
    expect(await codigo(servicio.actualizar(ADMIN_A, 'carla', cambio({ activo: false, clave_temporal: true })))).toBe(200);
    expect(p.find((x) => x.id === 'carla')!.activo).toBe(false);
  });

  it('a quien solo «estuvo» en A: devolverle A sí; tocar su cuenta, 403; a quien nunca estuvo en A, 404 (RF-41)', async () => {
    const { servicio } = armar(personas());
    expect(await codigo(servicio.actualizar(ADMIN_A, 'dora', cambio({ activo: false })))).toBe(403);
    expect(await codigo(servicio.actualizar(ADMIN_A, 'dora', cambio({ sitios: [{ sitio_id: 'A', rol: 'consulta' }] })))).toBe(200);
    expect(await codigo(servicio.actualizar(ADMIN_A, 'eva', cambio({ activo: false })))).toBe(404);
  });

  it('el usuario del sistema cambia cualquier cuenta mientras no haya administradores; después, 403', async () => {
    const sinAdmin = armar([{ id: 'beto', activo: true, sitios: [{ sitio: 'A', rol: 'consulta', activo: true }, { sitio: 'B', rol: 'consulta', activo: true }] }]);
    expect(await codigo(sinAdmin.servicio.actualizar(usuarioSistema(), 'beto', cambio({ sitios: [{ sitio_id: 'A', rol: 'administrador' }], nombre: 'Beto' })))).toBe(200);
    expect(await codigo(armar(personas()).servicio.actualizar(usuarioSistema(), 'carla', cambio({ nombre: 'x' })))).toBe(403);
  });
});

// Revisión del 11/11/2026: la cuenta de un administrador del sistema que además está en mi sitio, y la baja que hizo un administrador del
// sistema, no las toca un administrador de sitio (antes: clave temporal → entraba como él; reactivar → volvía con el hash de antes).
describe('Administrador del sistema y bajas del sistema: solo el alcance global (revisión del 11/11/2026)', () => {
  const SISTEMA: UsuarioSesion = { ...ADMIN_A, id: 'sis', nombre: 'Sistema', todos: true, sitios: new Map() };
  const conSistema = (): Persona[] => [
    ...personas(),
    { id: 'gloria', activo: true, sistema: true, sitios: [{ sitio: 'A', rol: 'consulta', activo: true }] },
    { id: 'hugo', activo: false, bajaDelSistema: true, sitios: [{ sitio: 'A', rol: 'consulta', activo: true }] },
    { id: 'ines', activo: false, bajaDelSistema: false, sitios: [{ sitio: 'A', rol: 'consulta', activo: true }] },
  ];
  it('la regla: un objetivo administrador del sistema → 403 para todo cambio de un alcance por sitios; el global, sí', () => {
    const G = { administradorSistema: true, bajaDelSistema: false };
    for (const c of [{ clave_temporal: true as const }, { activo: false, motivo: 'x' }, { nombre: 'Otro' }, { sitios: [{ sitio_id: 'A', rol: null }] }]) {
      expect(rechazoDeCambio(['A'], true, [], cambio(c), G)).toBe('la cuenta es de un administrador del sistema: solo otro administrador del sistema la cambia');
      expect(rechazoDeCambio(null, true, [], cambio(c), G)).toBeNull();
    }
    expect(rechazoDeCambio(['A'], true, [], cambio({ activo: true, clave_temporal: true }), { administradorSistema: false, bajaDelSistema: true })).toMatch(/^la dio de baja un administrador del sistema/);
    expect(rechazoDeCambio(['A'], true, [], cambio({ activo: true, clave_temporal: true }), { administradorSistema: false, bajaDelSistema: false })).toBeNull();
    expect(rechazoDeCambio(null, true, [], cambio({ activo: true, clave_temporal: true }), { administradorSistema: false, bajaDelSistema: true })).toBeNull();
  });
  it('administrador de A contra un administrador del sistema que también está en A: clave temporal, baja, nombre y sitios → 403; nada cambia', async () => {
    const { servicio, personas: p, consultas } = armar(conSistema());
    for (const c of [{ clave_temporal: true as const }, { activo: false, motivo: 'x' }, { nombre: 'Otro' }, { sitios: [{ sitio_id: 'A', rol: null }] }]) {
      expect(await codigo(servicio.actualizar(ADMIN_A, 'gloria', cambio(c)))).toBe(403);
    }
    expect(p.find((x) => x.id === 'gloria')!.activo).toBe(true);
    expect(consultas.some((q) => q.includes('UPDATE usuario SET nombre'))).toBe(false);
    expect(await codigo(servicio.actualizar(SISTEMA, 'gloria', cambio({ nombre: 'Gloria' })))).toBe(200);
  });
  it('reactivar: la baja del sistema solo la deshace el global; la de un administrador de sitio, él mismo (siempre con clave temporal nueva)', async () => {
    const { servicio, personas: p } = armar(conSistema());
    expect(await codigo(servicio.actualizar(ADMIN_A, 'hugo', cambio({ activo: true, clave_temporal: true })))).toBe(403);
    expect(p.find((x) => x.id === 'hugo')!.activo).toBe(false);
    expect(await codigo(servicio.actualizar(SISTEMA, 'hugo', cambio({ activo: true, clave_temporal: true })))).toBe(200);
    const r = await servicio.actualizar(ADMIN_A, 'ines', cambio({ activo: true, clave_temporal: true }));
    expect(typeof (r as { clave?: unknown }).clave).toBe('string');
    expect(p.find((x) => x.id === 'ines')!.activo).toBe(true);
  });
});

describe('Candado de los administradores (revisión del 08/11/2026: dos desactivaciones cruzadas)', () => {
  // Con el pool simulado no hay dos transacciones de verdad: se prueba el ORDEN, que es lo que hace correcta la exclusión (el candado
  // antes de leer la fila y antes de contar administradores). La carrera real la planta el paso 4b contra la base.
  it('un cambio de activo, clave temporal o roles toma el candado antes de leer la fila y de contar; un cambio de nombre, no', async () => {
    const { servicio, consultas } = armar(personas());
    for (const c of [{ activo: false }, { clave_temporal: true as const }, { sitios: [{ sitio_id: 'A', rol: 'consulta' as const }] }]) {
      consultas.length = 0;
      await servicio.actualizar(ADMIN_A, 'carla', cambio(c));
      const candado = consultas.indexOf(CANDADO_ADMINISTRADORES);
      expect(candado).toBeGreaterThan(-1);
      expect(candado).toBeLessThan(consultas.findIndex((q) => q.includes('FOR NO KEY UPDATE')));
      expect(candado).toBeLessThan(consultas.findIndex((q) => q.includes('AS hay')));
    }
    consultas.length = 0;
    await servicio.actualizar(ADMIN_A, 'carla', cambio({ nombre: 'Carla' }));
    expect(consultas).not.toContain(CANDADO_ADMINISTRADORES);
  });

  it('crear usa el MISMO candado (dos candados distintos no se esperarían entre sí)', async () => {
    const { servicio, consultas } = armar([]);
    await servicio.crear(usuarioSistema(), { nombre: 'Primera', email: 'primera@ejemplo.invalid', sitios: [{ sitio_id: 'A', rol: 'administrador' }], administrador_sistema: false });
    expect(consultas).toContain(CANDADO_ADMINISTRADORES);
  });
});

// docs/20 §10 (revisión del 11/11/2026): el 409 por correo existente no depende del alcance; el tope de altas por persona acota cuántos
// correos se pueden probar. Todo intento cuenta (también el que termina en 409) y otra persona no se ve afectada.
describe('POST /usuarios: tope de altas por persona y minuto', () => {
  it(`${ALTAS_POR_MINUTO} intentos pasan al servicio; el siguiente, 429 sin tocarlo; otra persona, sí`, async () => {
    let llamadas = 0;
    const c = new UsuariosController({ crear: () => { llamadas++; return Promise.reject(new HttpException('ya existe un usuario con ese email', 409)); } } as never);
    const cuerpo = { nombre: 'X', email: 'x@ejemplo.invalid', sitios: [{ sitio_id: '00000000-0000-4000-8000-000000000001', rol: 'consulta' }] };
    const r = await Promise.all(Array.from({ length: ALTAS_POR_MINUTO + 3 }, () => codigo(c.crear(ADMIN_A, cuerpo))));
    expect(r.filter((x) => x === 409)).toHaveLength(ALTAS_POR_MINUTO);
    expect(r.filter((x) => x === 429)).toHaveLength(3);
    expect(llamadas).toBe(ALTAS_POR_MINUTO);
    expect(await codigo(c.crear({ ...ADMIN_A, id: 'otra' }, cuerpo))).toBe(409);
  });
});

describe('GET /usuarios con la clave de administrador (revisión del 08/11/2026)', () => {
  it('lista solo mientras no hay ningún administrador; después, 403 como en crear y en cambiar', async () => {
    expect(await codigo(armar([]).servicio.listar(usuarioSistema()))).toBe(200);
    expect(await codigo(armar(personas()).servicio.listar(usuarioSistema()))).toBe(403);
    expect(await codigo(armar(personas()).servicio.listar(ADMIN_A))).toBe(200);
  });
});

// Vigencia de la clave temporal (docs/20 §4; decidido el 08/11/2026): CLAVE_TEMPORAL_HORAS, 1–72 h, 2 por defecto. El reloj es el de la
// base falsa (12:00 UTC): el vencimiento que llega al SQL es ese más la vigencia configurada.
describe('Vigencia de la clave temporal configurable', () => {
  const conHoras = (v: string): ConfigService => ({ get: (k: string) => (k === 'CLAVE_TEMPORAL_HORAS' ? v : undefined) }) as unknown as ConfigService;
  const venceEnSql = (d: ReturnType<typeof armar>, marca: string, i: number): unknown => d.parametros[d.consultas.findIndex((q) => q.includes(marca))]?.[i];
  it('sin la variable, 2 h: el alta y «asignar clave temporal» guardan el vencimiento a las 14:00 UTC', async () => {
    const d = armar(personas());
    expect(d.servicio.horasTemporal).toBe(2);
    await d.servicio.crear(ADMIN_A, { nombre: 'Nueva', email: 'nueva@ejemplo.invalid', sitios: [{ sitio_id: 'A', rol: 'consulta' }], administrador_sistema: false }).catch(() => undefined);
    expect(venceEnSql(d, 'INSERT INTO usuario (', 3)).toEqual(new Date('2026-11-08T14:00:00Z'));
    expect(await codigo(d.servicio.actualizar(ADMIN_A, 'carla', cambio({ clave_temporal: true })))).toBe(200);
    expect(venceEnSql(d, 'UPDATE usuario SET nombre', 5)).toEqual(new Date('2026-11-08T14:00:00Z'));
  });
  it('con CLAVE_TEMPORAL_HORAS=5, la suya (17:00 UTC); con 0, 73 o texto, el servicio no se construye (el backend no arranca)', async () => {
    const d = armar(personas(), conHoras('5'));
    expect(await codigo(d.servicio.actualizar(ADMIN_A, 'carla', cambio({ clave_temporal: true })))).toBe(200);
    expect(venceEnSql(d, 'UPDATE usuario SET nombre', 5)).toEqual(new Date('2026-11-08T17:00:00Z'));
    for (const malo of ['0', '73', 'dos']) expect(() => armar(personas(), conHoras(malo))).toThrow(/^CLAVE_TEMPORAL_HORAS=".*" no es válido/);
  });
});

