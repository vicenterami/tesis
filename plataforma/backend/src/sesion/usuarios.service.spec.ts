import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Pool } from 'pg';
import type { AlcanceService } from './alcance.service.js';
import { Rol, UsuarioSesion, usuarioSistema } from './permisos.js';
import type { SesionService } from './sesion.service.js';
import type { CambioUsuario } from './usuarios.dto.js';
import { CANDADO_ADMINISTRADORES, UsuariosService, rechazoDeCambio, tocaAdministradores, tocaCuenta } from './usuarios.service.js';

// Usuarios contra una base falsa (docs/20 §4 y §10; revisión del 08/11/2026): quién puede cambiar la cuenta de quién, el candado de los
// administradores y la clave de administrador en la lista. Sitios: A y B. El SQL real lo ejercita el paso 4b del guardián.
interface Persona { id: string; activo: boolean; sitios: { sitio: string; rol: Rol; activo: boolean }[] }

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
    if (sql.startsWith('INSERT INTO usuario ')) return filas([{ id: 'nueva' }]);
    if (sql.includes('FROM usuario u')) return filas(personas.map((u) => ({ id: u.id }))); // listar y leer
    return filas([]); // BEGIN, SET LOCAL, candado, evento, sesiones, COMMIT, ROLLBACK
  });
  const pool = { query, connect: () => Promise.resolve({ query, release: () => undefined }) } as unknown as Pool;
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
    expect(rechazoDeCambio(['A'], true, ['B'], cambio({ activo: false }))).toMatch(/^la cuenta pertenece también a otros sitios/);
    expect(rechazoDeCambio(['A'], true, ['B'], cambio({ clave_temporal: true }))).not.toBeNull();
    expect(rechazoDeCambio(['A'], true, ['B'], cambio({ nombre: 'Otro' }))).not.toBeNull();
    expect(rechazoDeCambio(['A'], true, ['B'], cambio({ sitios: [{ sitio_id: 'A', rol: 'administrador' }] }))).toBeNull();
    expect(rechazoDeCambio(['A'], true, [], cambio({ activo: false, clave_temporal: true }))).toBeNull();
    expect(rechazoDeCambio(['A'], false, ['B'], cambio({ activo: false }))).toMatch(/^la persona ya no está en ninguno de tus sitios/);
    expect(rechazoDeCambio(['A'], false, ['B'], cambio({ sitios: [{ sitio_id: 'A', rol: 'consulta' }] }))).toBeNull();
    expect(rechazoDeCambio(null, true, [], cambio({ activo: false }))).toBeNull();
    expect([tocaCuenta(cambio({ sitios: [] })), tocaCuenta(cambio({ nombre: 'x' })), tocaAdministradores(cambio({ nombre: 'x' })), tocaAdministradores(cambio({ activo: true }))])
      .toEqual([false, true, false, true]);
  });

  it('administrador de A: desactivar, clave temporal o renombrar a quien también está en B → 403; a quien solo está en A → 200', async () => {
    const { servicio, personas: p } = armar(personas());
    for (const c of [{ activo: false }, { clave_temporal: true as const }, { nombre: 'Beto renombrado' }]) {
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
    await servicio.crear(usuarioSistema(), { nombre: 'Primera', email: 'primera@ejemplo.invalid', sitios: [{ sitio_id: 'A', rol: 'administrador' }] });
    expect(consultas).toContain(CANDADO_ADMINISTRADORES);
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
    await d.servicio.crear(ADMIN_A, { nombre: 'Nueva', email: 'nueva@ejemplo.invalid', sitios: [{ sitio_id: 'A', rol: 'consulta' }] }).catch(() => undefined);
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

