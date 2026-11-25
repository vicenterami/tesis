import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { AlcanceService } from '../sesion/alcance.service.js';
import { Accion, Rol, UsuarioSesion, exigir, usuarioSistema } from '../sesion/permisos.js';
import {
  FORMA_CODIGO_SITIO, FORMA_ZONA_HORARIA, ZONA_CON_DISPOSITIVOS, ZONA_INICIAL_POR_OMISION, claveZona, validarCambioSitio, validarCambioZona, validarSitioNuevo,
  validarZonaNueva,
} from './sitios-zonas.js';
import { SitiosController } from './sitios.controller.js';
import { ZonasController } from './zonas.controller.js';
import { SitiosZonasService } from './sitios-zonas.service.js';
import type { TableroService } from './tablero.service.js';

// Sitios y zonas desde el panel (docs/19 §4 U; docs/20 §6, filas de sitios y zonas; migración 28). La prueba contra una base real (el
// índice normalizado, los permisos por columna del rol de la aplicación, los eventos) va en la integración y en el paso de la migración.
const S = '55555555-5555-4555-8555-555555555555';
const OTRO = '77777777-7777-4777-8777-777777777777';
const Z = '66666666-6666-4666-8666-666666666666';
const persona = (sitios: [string, Rol][]): UsuarioSesion =>
  ({ ...usuarioSistema(), id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid', sistema: false, todos: false, sitios: new Map(sitios), sesionId: 'a'.repeat(64) });
const adminSistema = (): UsuarioSesion => ({ ...usuarioSistema(), id: 'u0', sistema: false, todos: true });
const codigo = async (p: Promise<unknown> | (() => unknown)): Promise<number> => {
  try { await (typeof p === 'function' ? p() : p); return 200; } catch (e) { if (e instanceof HttpException) return e.getStatus(); throw e; }
};

describe('validarSitioNuevo: el cuerpo de POST /sitios', () => {
  it('la forma del código es la de ck_sitio_codigo (migración 11)', () => {
    expect(FORMA_CODIGO_SITIO.source).toBe('^[a-z0-9][a-z0-9-]{1,62}$');
  });
  it('un sitio válido; la primera zona es «General» si no viene, y los nombres se recortan', () => {
    expect(validarSitioNuevo({ nombre: '  Sede Norte ', codigo: 'sede-norte', zona_horaria: 'America/Santiago' }))
      .toEqual({ nombre: 'Sede Norte', codigo: 'sede-norte', zona_horaria: 'America/Santiago', primera_zona: ZONA_INICIAL_POR_OMISION, descripcion: null });
    expect(validarSitioNuevo({ nombre: 'Caseta', codigo: 'ca', zona_horaria: 'America/Punta_Arenas', primera_zona: ' Norte ' }).primera_zona).toBe('Norte');
  });
  it('código con mayúsculas, tilde, espacio, de 1 carácter o que empieza con guion; zona horaria con otra forma; nombre vacío; campo de más → 400', () => {
    const base = { nombre: 'X', codigo: 'xx', zona_horaria: 'America/Santiago' };
    for (const malo of [{ ...base, codigo: 'Sede' }, { ...base, codigo: 'año' }, { ...base, codigo: 'a b' }, { ...base, codigo: 'a' }, { ...base, codigo: '-ab' },
      { ...base, zona_horaria: 'America/Santiago de Chile' }, { ...base, zona_horaria: '' }, { ...base, zona_horaria: 'x'.repeat(65) }, { ...base, zona_horaria: 3 },
      { ...base, nombre: '   ' }, { ...base, nombre: 'x'.repeat(81) },
      { ...base, primera_zona: '' }, { ...base, primera_zona: 'a\u0007b' }, { ...base, activo: false }, { ...base, descripcion: 5 }, { ...base, descripcion: 'x'.repeat(501) },
      null, [], 'sitio']) {
      expect(() => validarSitioNuevo(malo), JSON.stringify(malo)).toThrow(BadRequestException);
    }
  });
  it('la zona horaria: aquí solo la forma (si existe lo decide la base); un nombre bien formado que no existe pasa este filtro', () => {
    for (const z of ['America/Santiago', 'UTC', 'Etc/GMT+4', 'America/Argentina/Buenos_Aires', 'Marte/Olympus']) expect(FORMA_ZONA_HORARIA.test(z), z).toBe(true);
    expect(validarSitioNuevo({ nombre: 'X', codigo: 'xx', zona_horaria: 'Marte/Olympus' }).zona_horaria).toBe('Marte/Olympus');
  });
  it('la descripción, opcional: recortada; vacía, sin descripción', () => {
    const base = { nombre: 'X', codigo: 'xx', zona_horaria: 'UTC' };
    expect(validarSitioNuevo({ ...base, descripcion: '  Sede de pruebas ' }).descripcion).toBe('Sede de pruebas');
    expect(validarSitioNuevo({ ...base, descripcion: '   ' }).descripcion).toBeNull();
    expect(validarSitioNuevo({ ...base, descripcion: 'x'.repeat(500) }).descripcion).toHaveLength(500);
  });
  it('la descripción es de una línea: un carácter de control (NUL, salto de línea, tabulador) o invisible → 400 con su motivo, al crear y al cambiar', () => {
    const motivo = (f: () => unknown): string => { try { f(); return ''; } catch (e) { return JSON.stringify((e as BadRequestException).getResponse()); } };
    const base = { nombre: 'X', codigo: 'xx', zona_horaria: 'UTC' };
    for (const d of ['a\u0000b', 'línea 1\nlínea 2', 'a\tb']) {
      expect(motivo(() => validarSitioNuevo({ ...base, descripcion: d })), JSON.stringify(d)).toContain('descripción: trae un carácter de control que no se admite');
      expect(motivo(() => validarCambioSitio({ descripcion: d })), JSON.stringify(d)).toContain('descripción: trae un carácter de control que no se admite');
    }
    expect(motivo(() => validarSitioNuevo({ ...base, descripcion: 'Sede\u200Bde pruebas' }))).toContain('descripción: trae un carácter invisible que no se admite');
    expect(motivo(() => validarCambioSitio({ descripcion: '\u202Eal revés' }))).toContain('descripción: trae un carácter invisible que no se admite');
  });
  it('los separadores de línea y de párrafo de Unicode (U+2028, U+2029) también parten la línea: 400 en nombres y descripción', () => {
    const motivo = (f: () => unknown): string => { try { f(); return ''; } catch (e) { return JSON.stringify((e as BadRequestException).getResponse()); } };
    const base = { nombre: 'X', codigo: 'xx', zona_horaria: 'UTC' };
    for (const x of ['\u2028', '\u2029']) {
      expect(motivo(() => validarSitioNuevo({ ...base, descripcion: `a${x}b` })), JSON.stringify(x)).toContain('descripción: trae un carácter de control que no se admite');
      expect(motivo(() => validarCambioSitio({ descripcion: `a${x}b` })), JSON.stringify(x)).toContain('descripción: trae un carácter de control que no se admite');
      expect(motivo(() => validarSitioNuevo({ ...base, nombre: `Sede${x}Sur` })), JSON.stringify(x)).toContain('nombre del sitio: trae un carácter de control que no se admite');
      expect(motivo(() => validarSitioNuevo({ ...base, primera_zona: `Patio${x}Norte` })), JSON.stringify(x)).toContain('primera zona: trae un carácter de control que no se admite');
      expect(motivo(() => validarZonaNueva({ nombre: `Lab${x}2` })), JSON.stringify(x)).toContain('nombre de la zona: trae un carácter de control que no se admite');
      expect(motivo(() => validarCambioZona({ nombre: `Lab${x}2` })), JSON.stringify(x)).toContain('nombre de la zona: trae un carácter de control que no se admite');
    }
  });
  it('un nombre de sitio o de zona con un carácter invisible (ancho cero, inversión bidi): 400 con su motivo', () => {
    const motivos = (f: () => unknown): string[] => { try { f(); return []; } catch (e) { return (e as BadRequestException).getResponse() as unknown as string[]; } };
    const base = { nombre: 'X', codigo: 'xx', zona_horaria: 'UTC' };
    expect(JSON.stringify(motivos(() => validarSitioNuevo({ ...base, nombre: 'Sede\u200BNorte' })))).toContain('nombre del sitio: trae un carácter invisible que no se admite');
    expect(JSON.stringify(motivos(() => validarZonaNueva({ nombre: '\u202ENorte' })))).toContain('nombre de la zona: trae un carácter invisible que no se admite');
    expect(JSON.stringify(motivos(() => validarCambioZona({ nombre: 'Nor\u2060te' })))).toContain('trae un carácter invisible');
    expect(JSON.stringify(motivos(() => validarCambioSitio({ nombre: 'Se\uFEFFde' })))).toContain('trae un carácter invisible');
  });
});

describe('validarCambioSitio, validarZonaNueva y validarCambioZona', () => {
  it('cambiar el nombre o la descripción; vacía o null la borra; nada que cambiar o el código → 400', () => {
    expect(validarCambioSitio({ nombre: ' Campus ' })).toEqual({ nombre: 'Campus' });
    expect(validarCambioSitio({ descripcion: '  ' })).toEqual({ descripcion: null });
    expect(validarCambioSitio({ descripcion: null })).toEqual({ descripcion: null });
    for (const malo of [{}, { codigo: 'otro' }, { zona_horaria: 'UTC' }, { descripcion: 5 }, { descripcion: 'x'.repeat(501) }]) {
      expect(() => validarCambioSitio(malo), JSON.stringify(malo)).toThrow(BadRequestException);
    }
  });
  it('una zona nueva: nombre recortado; vacío, largo o con un campo de más → 400', () => {
    expect(validarZonaNueva({ nombre: ' Galpón Sur ' })).toBe('Galpón Sur');
    for (const malo of [{}, { nombre: '' }, { nombre: 'x'.repeat(81) }, { nombre: 'Norte', sitio_id: S }]) {
      expect(() => validarZonaNueva(malo), JSON.stringify(malo)).toThrow(BadRequestException);
    }
  });
  it('cambiar una zona: nombre y/o activo booleano; nada, o activo que no es booleano → 400', () => {
    expect(validarCambioZona({ activo: false })).toEqual({ activo: false });
    expect(validarCambioZona({ nombre: 'Sur', activo: true })).toEqual({ nombre: 'Sur', activo: true });
    for (const malo of [{}, { activo: 'false' }, { activo: 0 }, { sitio_id: S }]) {
      expect(() => validarCambioZona(malo), JSON.stringify(malo)).toThrow(BadRequestException);
    }
  });
  it('claveZona, la forma del índice de la migración 28 escrita en JS: sin espacios en los extremos y en minúsculas; ni tildes ni espacios interiores se tocan', () => {
    expect(claveZona(' Norte ')).toBe('norte');
    expect(claveZona('GALPÓN Sur')).toBe('galpón sur');
    expect(claveZona('Galpón Sur')).not.toBe(claveZona('Galpon Sur')); // las tildes distinguen, como lower() en la base
    expect(claveZona('Galpón  Sur')).not.toBe(claveZona('Galpón Sur')); // los espacios interiores también, como btrim() en la base
  });
  it('el texto del 409 al retirar con dispositivos, en singular y en plural', () => {
    expect(ZONA_CON_DISPOSITIVOS(1)).toBe('la zona tiene 1 dispositivo activo: muévelo de zona o dalo de baja antes de retirarla');
    expect(ZONA_CON_DISPOSITIVOS(3)).toBe('la zona tiene 3 dispositivos activos: muévelos de zona o dalos de baja antes de retirarla');
  });
});

describe('quién crea sitios y zonas, y en qué orden se responde (docs/20 §6 y §10)', () => {
  function controladores() {
    const estructura = {
      crearSitio: vi.fn(() => Promise.resolve({})), cambiarSitio: vi.fn(() => Promise.resolve({})),
      crearZona: vi.fn(() => Promise.resolve({})), cambiarZona: vi.fn(() => Promise.resolve({})),
    };
    const sitioDe = (id: string): string | null => ([S, OTRO].includes(id) ? id : null);
    const alcance = {
      exigirSitio: vi.fn((u: UsuarioSesion, a: Accion, id: string) => Promise.resolve().then(() => exigir(u, a, sitioDe(id), 'sitio no encontrado'))),
      exigirZona: vi.fn((u: UsuarioSesion, a: Accion, id: string) => Promise.resolve().then(() => exigir(u, a, id === Z ? S : null, 'zona no encontrada'))),
    };
    const sitios = new SitiosController({} as TableroService, alcance as unknown as AlcanceService, {} as never, {} as never, {} as never, {} as never,
      estructura as unknown as SitiosZonasService);
    const zonas = new ZonasController(alcance as unknown as AlcanceService, estructura as unknown as SitiosZonasService);
    return { sitios, zonas, estructura };
  }
  const sitioOk = { nombre: 'Nuevo', codigo: 'nuevo', zona_horaria: 'America/Santiago' };

  it('crear y cambiar un sitio: solo el administrador del sistema; los cinco perfiles de sitio, 403 antes de mirar el cuerpo', async () => {
    const { sitios, estructura } = controladores();
    for (const rol of ['administrador', 'operador', 'investigador', 'consulta'] as Rol[]) {
      expect(await codigo(() => sitios.crearSitio(persona([[S, rol]]), {})), rol).toBe(403);
      expect(await codigo(() => sitios.cambiarSitio(persona([[S, rol]]), S, { nombre: 'x' })), rol).toBe(403);
    }
    expect(await codigo(() => sitios.crearSitio(adminSistema(), { ...sitioOk, codigo: 'MAL' }))).toBe(400);
    expect(await codigo(() => sitios.crearSitio(adminSistema(), sitioOk))).toBe(200);
    expect(estructura.crearSitio).toHaveBeenCalledWith({ ...sitioOk, primera_zona: 'General', descripcion: null }, 'u0');
  });

  it('crear una zona: `ajustes` en el sitio; operador, investigador y consulta 403; otro sitio 404; el cuerpo antes que el sitio', async () => {
    const { sitios, estructura } = controladores();
    for (const rol of ['operador', 'investigador', 'consulta'] as Rol[]) {
      expect(await codigo(() => sitios.crearZona(persona([[S, rol]]), S, { nombre: 'Norte' })), rol).toBe(403);
    }
    const admin = persona([[S, 'administrador']]);
    expect(await codigo(() => sitios.crearZona(admin, OTRO, { nombre: 'Norte' }))).toBe(404);
    expect(await codigo(() => sitios.crearZona(admin, OTRO, { nombre: '' }))).toBe(400);
    expect(await codigo(() => sitios.crearZona(admin, S, { nombre: ' Norte ' }))).toBe(200);
    expect(estructura.crearZona).toHaveBeenCalledWith(S, 'Norte', 'u1');
    expect(await codigo(() => sitios.crearZona(adminSistema(), OTRO, { nombre: 'Sur' }))).toBe(200);
  });

  it('renombrar o retirar una zona: `ajustes` en su sitio; de otro sitio, 404', async () => {
    const { zonas, estructura } = controladores();
    expect(await codigo(() => zonas.cambiar(persona([[S, 'operador']]), Z, { activo: false }))).toBe(403);
    expect(await codigo(() => zonas.cambiar(persona([[OTRO, 'administrador']]), Z, { activo: false }))).toBe(404);
    expect(await codigo(() => zonas.cambiar(persona([[S, 'administrador']]), Z, { activo: 'no' }))).toBe(400);
    expect(await codigo(() => zonas.cambiar(persona([[S, 'administrador']]), Z, { activo: false }))).toBe(200);
    expect(estructura.cambiarZona).toHaveBeenCalledWith(Z, { activo: false }, 'u1');
  });
});

// El servicio con una base simulada que responde por el comienzo de cada consulta (la base real, en la integración).
function servicioCon(responder: (sql: string, p: unknown[]) => { rows: unknown[]; rowCount?: number } | Error) {
  const sql: string[] = [];
  const cliente = {
    query: vi.fn((texto: string, p: unknown[] = []) => {
      sql.push(texto.replace(/\s+/g, ' ').trim());
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(texto) || texto.startsWith('SET LOCAL')) return Promise.resolve({ rows: [] });
      const r = responder(texto.replace(/\s+/g, ' ').trim(), p);
      return r instanceof Error ? Promise.reject(r) : Promise.resolve({ rowCount: r.rows.length, ...r });
    }),
    release: vi.fn(), on: vi.fn(), off: vi.fn(),
  };
  return { servicio: new SitiosZonasService({ connect: () => Promise.resolve(cliente) } as unknown as Pool), sql };
}
const fallaCon = async (p: Promise<unknown>): Promise<unknown> => p.then(() => null, (e: unknown) => e);
const sitioNuevo = { nombre: 'Sede Norte', codigo: 'sede-norte', zona_horaria: 'America/Santiago', primera_zona: 'General', descripcion: 'Sede de pruebas' };

describe('SitiosZonasService con una base simulada', () => {
  it('crear un sitio: la zona horaria la decide pg_timezone_names; si la base no la conoce, 400 con el nombre y sin INSERT', async () => {
    const { servicio, sql } = servicioCon((t) => (t.startsWith('SELECT 1 FROM pg_timezone_names') ? { rows: [] } : { rows: [] }));
    const e = await fallaCon(servicio.crearSitio({ ...sitioNuevo, zona_horaria: 'Marte/Olympus' }, 'u0'));
    expect(e).toBeInstanceOf(BadRequestException);
    expect((e as BadRequestException).getResponse()).toMatchObject({ message: ['zona horaria: la base no conoce «Marte/Olympus»; elige un nombre IANA, como America/Santiago'] });
    expect(sql.some((x) => x.startsWith('INSERT'))).toBe(false);
  });
  it('crear un sitio: inserta la descripción', async () => {
    const { servicio, sql } = servicioCon((t) => {
      if (t.startsWith('SELECT 1 FROM pg_timezone_names')) return { rows: [{}] };
      if (t.startsWith('INSERT INTO sitio')) return { rows: [{ id: S }] };
      if (t.startsWith('INSERT INTO zona')) return { rows: [{ id: Z }] };
      if (t.startsWith('SELECT id, codigo')) return { rows: [{ id: S, codigo: 'sede-norte', nombre: 'Sede Norte', zona_horaria: 'America/Santiago', descripcion: 'Sede de pruebas' }] };
      return { rows: [] };
    });
    const r = await servicio.crearSitio(sitioNuevo, 'u0');
    expect(sql.find((x) => x.startsWith('INSERT INTO sitio'))).toContain('descripcion');
    expect(r.descripcion).toBe('Sede de pruebas');
  });
  it('cambiar un sitio o una zona de un sitio inactivo: 404 (la consulta exige el sitio activo)', async () => {
    const { servicio, sql } = servicioCon(() => ({ rows: [] }));
    expect(await fallaCon(servicio.cambiarSitio(S, { nombre: 'x' }, 'u0'))).toBeInstanceOf(NotFoundException);
    expect(await fallaCon(servicio.cambiarZona(Z, { activo: false }, 'u0'))).toBeInstanceOf(NotFoundException);
    expect(sql.find((x) => x.startsWith('SELECT nombre, descripcion FROM sitio'))).toContain('AND activo FOR NO KEY UPDATE');
    expect(sql.find((x) => x.startsWith('SELECT z.sitio_id'))).toContain('AND s.activo FOR NO KEY UPDATE OF z');
  });
  it('un bloqueo que no llega a tiempo (55P03, 57014): 503 «otro cambio … en curso»', async () => {
    for (const code of ['55P03', '57014']) {
      const { servicio } = servicioCon(() => Object.assign(new Error('canceling statement due to lock timeout'), { code }));
      const e = await fallaCon(servicio.cambiarZona(Z, { activo: false }, 'u0'));
      expect(e, code).toBeInstanceOf(ServiceUnavailableException);
      expect((e as ServiceUnavailableException).message).toBe('otro cambio sobre este sitio o esta zona está en curso; vuelve a intentarlo');
    }
  });
  it('crear o renombrar a un nombre que ya existe en el sitio: retirada → 409 zona_retirada; activa → zona_repetida; nada se inserta ni se cambia', async () => {
    for (const [activo, codigoEsperado] of [[false, 'zona_retirada'], [true, 'zona_repetida']] as const) {
      const { servicio, sql } = servicioCon((t) => {
        if (t.startsWith('SELECT 1 FROM sitio')) return { rows: [{}] };
        if (t.startsWith('SELECT z.sitio_id')) return { rows: [{ sitio_id: S, nombre: 'Sur', activo: true }] };
        if (t.startsWith('SELECT nombre, activo FROM zona')) return { rows: [{ nombre: 'Norte', activo }] };
        return { rows: [] };
      });
      for (const intento of [servicio.crearZona(S, 'norte ', 'u1'), servicio.cambiarZona(Z, { nombre: 'NORTE' }, 'u1')]) {
        const e = await fallaCon(intento);
        expect(e).toBeInstanceOf(ConflictException);
        expect((e as ConflictException).getResponse()).toMatchObject({ codigo: codigoEsperado });
      }
      expect(sql.some((x) => x.startsWith('INSERT INTO zona') || x.startsWith('UPDATE zona'))).toBe(false);
    }
  });
  it('el 23505 de una carrera (otra petición creó la misma zona después de la consulta previa) sigue siendo zona_repetida', async () => {
    const { servicio } = servicioCon((t) => {
      if (t.startsWith('SELECT 1 FROM sitio')) return { rows: [{}] };
      if (t.startsWith('INSERT INTO zona')) return Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'uq_zona_sitio_nombre_normalizado' });
      return { rows: [] };
    });
    const e = await fallaCon(servicio.crearZona(S, 'Norte', 'u1'));
    expect((e as ConflictException).getResponse()).toMatchObject({ codigo: 'zona_repetida' });
  });
});
