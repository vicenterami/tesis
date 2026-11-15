import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Pool } from 'pg';
import { AltaController } from './alta.controller.js';
import { AltaService } from './alta.service.js';
import { MagnitudesController } from './magnitudes.controller.js';
import type { DynsecService } from '../broker/dynsec.service.js';
import { usuarioSistema, type Rol, type UsuarioSesion } from '../sesion/permisos.js';
import { AltaDeLote, Catalogos, ChoqueDeLote, MAX_FILAS_LOTE, RespuestaLote, plantillaLote } from './lote.js';

// La ruta del lote de punta a punta en el proceso (docs/19 §4, N8 y N11), con la base falsa: la creación vuelve a calcular y, si el plan
// cambió por algo que la base NO impide (la pasarela se desactivó o cambió de formato entre validar y crear), responde 409 `plan_cambio`
// con el plan nuevo y no crea nada; una creación a la vez (409 `lote_en_curso`); el choque que solo ve la base también es `plan_cambio`;
// el reintento con la misma llave devuelve la misma respuesta sin crear de más; lo creado es lo anunciado, fila por fila; la vista previa
// de 500 filas lee los catálogos una vez.
const S1 = '00000000-0000-4000-8000-000000000001';
const Z1 = '00000000-0000-4000-8000-0000000000a1';
const P1 = '00000000-0000-4000-8000-0000000000c1';
const LLAVE = '3f2b1c8e-7d6a-4e5f-9a0b-1c2d3e4f5a6b';
const catalogos = (x: Partial<Catalogos> = {}): Catalogos => ({
  zonas: [{ id: Z1, nombre: 'Laboratorio', sitio_id: S1, sitio_codigo: 'uct' }],
  magnitudes: new Map([['temperatura', { nombre: 'Temperatura', unidad: 'Cel' }], ['humedad', { nombre: 'Humedad relativa', unidad: '%RH' }]]),
  pasarelas: [{ id: P1, id_fisico: 'ug65-campus', sitio_id: S1, activo: true, formato: 'milesight' }],
  existentes: new Map(), idsDePasarela: new Set(['ug65-campus']), ajenos: new Set(), ...x,
});
const filas = [
  { n: 2, id_fisico: 'nodo-01', nombre: 'Uno', zona: 'Laboratorio', via: 'http', intervalo_esperado_s: '60', canales: 'temperatura:Cel' },
  { n: 4, id_fisico: 'a84041000181b0e1', nombre: 'LoRa', zona: 'Laboratorio', via: 'lorawan', pasarela: 'ug65-campus', intervalo_esperado_s: '300', canales: 'temperatura | humedad' },
];
const res = (): Response & { cabeceras: Record<string, string> } => {
  const cabeceras: Record<string, string> = {};
  return { cabeceras, setHeader: (k: string, v: string) => { cabeceras[k] = v; } } as unknown as Response & { cabeceras: Record<string, string> };
};
const config = { get: (_k: string, d: string) => d } as unknown as ConfigService;
const persona = (rol: Rol): UsuarioSesion => ({ ...usuarioSistema(), id: `u-${rol}`, nombre: rol, sistema: false, todos: false, sitios: new Map([[S1, rol]]) });

function conServicioFalso(cat: () => Catalogos) {
  const creadas: AltaDeLote[][] = [];
  const servicio = {
    catalogosLote: vi.fn(() => Promise.resolve(cat())),
    crearLote: vi.fn(async (altas: readonly AltaDeLote[]) => {
      await Promise.resolve();
      creadas.push([...altas]);
      return new Map(altas.map((a, i) => [a.n, { id: `D${creadas.length}-${i}`, credencial: a.alta.via === 'lorawan' ? null : `cred-${a.n}`, topico: null }]));
    }),
  };
  const ctrl = new AltaController(servicio as unknown as AltaService, {} as never, config, {} as never, {} as never);
  return { ctrl, servicio, creadas };
}
const error = async (p: Promise<unknown>): Promise<HttpException> => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(HttpException);
  return e as HttpException;
};

describe('POST /dispositivos/lote?modo=crear: todo o nada', () => {
  it('vista previa y creación con la huella: crea y devuelve el mismo plan con las credenciales una vez (Cache-Control: no-store)', async () => {
    const { ctrl, servicio } = conServicioFalso(() => catalogos());
    const u = usuarioSistema();
    const vista = await ctrl.lote(u, 'validar', { filas }, undefined, res());
    expect(vista).toMatchObject({ leidas: 2, validas: 2, rechazadas: 0, existentes: 0 });
    expect(servicio.crearLote).not.toHaveBeenCalled();
    const r = res();
    const hecho = await ctrl.lote(u, 'crear', { filas, huella: vista.huella }, LLAVE, r);
    expect(hecho.huella).toBe(vista.huella);
    expect(hecho.filas.map((f) => [f.n, f.resultado, f.credencial])).toEqual([[2, 'creada', 'cred-2'], [4, 'creada', null]]);
    expect(hecho.filas.map((f) => f.interpretada)).toEqual(vista.filas.map((f) => f.interpretada));
    expect(r.cabeceras['Cache-Control']).toBe('no-store');
  });
  it('409 plan_cambio si entre validar y crear la pasarela se desactivó, o cambió de formato (la fila sigue entrando, pero crearía otra cosa): el plan nuevo en la respuesta y ningún dispositivo creado', async () => {
    const cambios: ((c: Catalogos) => Catalogos)[] = [
      (c) => ({ ...c, pasarelas: [{ ...c.pasarelas[0], activo: false }] }),
      (c) => ({ ...c, pasarelas: [{ ...c.pasarelas[0], formato: 'chirpstack' }] }),
    ];
    for (const cambiar of cambios) {
      let cat = catalogos();
      const { ctrl, servicio } = conServicioFalso(() => cat);
      const u = usuarioSistema();
      const vista = await ctrl.lote(u, 'validar', { filas }, undefined, res());
      cat = cambiar(cat);
      const e = await error(ctrl.lote(u, 'crear', { filas, huella: vista.huella }, LLAVE, res()));
      expect(e.getStatus()).toBe(409);
      const cuerpo = e.getResponse() as { codigo: string; plan: RespuestaLote };
      expect(cuerpo.codigo).toBe('plan_cambio');
      expect(cuerpo.plan.huella).not.toBe(vista.huella);
      expect(cuerpo.plan.filas[1]?.n).toBe(4);
      expect(servicio.crearLote).not.toHaveBeenCalled();
    }
  });
  it('409 lote_en_curso mientras otra creación no termina; al terminar, la siguiente pasa', async () => {
    let soltar: () => void = () => {};
    const { ctrl, servicio } = conServicioFalso(() => catalogos());
    servicio.crearLote.mockImplementationOnce((altas: readonly AltaDeLote[]) => new Promise((ok) => {
      soltar = () => ok(new Map(altas.map((a) => [a.n, { id: 'x', credencial: 'c', topico: null }])));
    }));
    const u = usuarioSistema();
    const vista = await ctrl.lote(u, 'validar', { filas }, undefined, res());
    const primera = ctrl.lote(u, 'crear', { filas, huella: vista.huella }, LLAVE, res());
    await vi.waitFor(() => expect(servicio.crearLote).toHaveBeenCalledTimes(1));
    const e = await error(ctrl.lote(u, 'crear', { filas, huella: vista.huella }, 'otra-llave-0000000000', res()));
    expect([e.getStatus(), (e.getResponse() as { codigo: string }).codigo]).toEqual([409, 'lote_en_curso']);
    soltar();
    await primera;
    await ctrl.lote(u, 'crear', { filas, huella: vista.huella }, 'otra-llave-0000000000', res());
    expect(servicio.crearLote).toHaveBeenCalledTimes(2);
  });
  it('el choque que solo ve la base (23505 entre la validación y la inserción) responde plan_cambio con el plan recalculado', async () => {
    let cat = catalogos();
    const { ctrl, servicio } = conServicioFalso(() => cat);
    servicio.crearLote.mockImplementationOnce(async () => {
      await Promise.resolve();
      cat = catalogos({ existentes: new Map([['nodo-01', { id: 'D-otro', estado: 'activo' }]]) }); // otra petición lo creó
      throw new ChoqueDeLote();
    });
    const u = usuarioSistema();
    const vista = await ctrl.lote(u, 'validar', { filas }, undefined, res());
    const e = await error(ctrl.lote(u, 'crear', { filas, huella: vista.huella }, LLAVE, res()));
    const cuerpo = e.getResponse() as { codigo: string; plan: RespuestaLote };
    expect([e.getStatus(), cuerpo.codigo]).toEqual([409, 'plan_cambio']);
    expect(cuerpo.plan.filas.map((f) => f.resultado)).toEqual(['existe', 'valida']);
    expect(servicio.catalogosLote).toHaveBeenCalledTimes(3); // validar, crear y el recálculo tras el choque
  });
  it('reintento con la misma llave y el mismo cuerpo: la misma respuesta y ningún dispositivo de más; otro cuerpo con esa llave, 422', async () => {
    const { ctrl, servicio } = conServicioFalso(() => catalogos());
    const u = usuarioSistema();
    const vista = await ctrl.lote(u, 'validar', { filas }, undefined, res());
    const cuerpo = { filas, huella: vista.huella };
    const a = await ctrl.lote(u, 'crear', cuerpo, LLAVE, res());
    const b = await ctrl.lote(u, 'crear', JSON.parse(JSON.stringify(cuerpo)), LLAVE, res());
    expect(b).toEqual(a);
    expect(servicio.crearLote).toHaveBeenCalledTimes(1);
    const e = await error(ctrl.lote(u, 'crear', { filas: filas.slice(0, 1), huella: vista.huella }, LLAVE, res()));
    expect([e.getStatus(), (e.getResponse() as { codigo: string }).codigo]).toEqual([422, 'llave_reutilizada']);
    // Otra persona con la misma llave no ve la respuesta de la primera: se calcula de nuevo.
    await ctrl.lote(persona('operador'), 'crear', cuerpo, LLAVE, res());
    expect(servicio.crearLote).toHaveBeenCalledTimes(2);
  });
  it('sin Idempotency-Key o sin huella, crear es 400 y no lee la base', async () => {
    const { ctrl, servicio } = conServicioFalso(() => catalogos());
    expect((await error(ctrl.lote(usuarioSistema(), 'crear', { filas, huella: 'a'.repeat(64) }, undefined, res()))).getStatus()).toBe(400);
    expect((await error(ctrl.lote(usuarioSistema(), 'crear', { filas }, LLAVE, res()))).getStatus()).toBe(400);
    expect(servicio.catalogosLote).not.toHaveBeenCalled();
  });
});

describe('plantilla y magnitudes por perfil (docs/20 §6)', () => {
  it('la plantilla: operador técnico, administrador de sitio y del sistema sí; consulta e investigador, 403', () => {
    const { ctrl } = conServicioFalso(() => catalogos());
    for (const rol of ['operador', 'administrador'] as const) expect(ctrl.plantilla(persona(rol))).toEqual(plantillaLote());
    expect(ctrl.plantilla(usuarioSistema())).toEqual(plantillaLote());
    for (const rol of ['consulta', 'investigador'] as const) expect(() => ctrl.plantilla(persona(rol))).toThrow(ForbiddenException);
  });
  it('el lote: consulta e investigador, 403 antes de leer el cuerpo', async () => {
    const { ctrl, servicio } = conServicioFalso(() => catalogos());
    for (const rol of ['consulta', 'investigador'] as const) await expect(ctrl.lote(persona(rol), 'validar', { filas }, undefined, res())).rejects.toBeInstanceOf(ForbiddenException);
    expect(servicio.catalogosLote).not.toHaveBeenCalled();
  });
  it('las magnitudes: cualquier sesión (la ruta no pide permiso propio), con código, nombre y unidad, ordenadas por código', async () => {
    const pool = { query: vi.fn((_texto: string) => Promise.resolve({ rows: [{ codigo: 'humedad', nombre: 'Humedad relativa', unidad: '%RH' }] })) };
    const ctrl = new MagnitudesController(new AltaService(pool as unknown as Pool, {} as DynsecService));
    expect(await ctrl.listar()).toEqual([{ codigo: 'humedad', nombre: 'Humedad relativa', unidad: '%RH' }]);
    expect(pool.query.mock.calls[0]?.[0]).toBe('SELECT codigo, nombre, unidad_canonica AS unidad FROM magnitud ORDER BY codigo');
    expect(ctrl.listar.length).toBe(0); // sin usuario: ninguna comprobación de perfil más allá de la sesión del guardia central
  });
});

// Con el servicio real y una base falsa que responde por el comienzo de cada consulta.
function conBaseFalsa() {
  const consultasPool: string[] = [];
  const insertados: unknown[][] = [];
  const pool = {
    query: vi.fn(async (texto: string) => {
      await Promise.resolve();
      consultasPool.push(texto);
      if (texto.startsWith('SELECT z.id')) return { rows: [{ id: Z1, nombre: 'Laboratorio', sitio_id: S1, sitio_codigo: 'uct' }] };
      if (texto.startsWith('SELECT codigo, nombre, unidad_canonica FROM magnitud')) return { rows: [{ codigo: 'temperatura', nombre: 'Temperatura', unidad_canonica: 'Cel' }, { codigo: 'humedad', nombre: 'Humedad relativa', unidad_canonica: '%RH' }] };
      if (texto.startsWith('SELECT id, id_fisico, sitio_id, activo, formato FROM pasarela')) return { rows: [{ id: P1, id_fisico: 'ug65-campus', sitio_id: S1, activo: true, formato: 'milesight' }] };
      return { rows: [] };
    }),
    connect: () => Promise.resolve({
      query: async (texto: string, p: unknown[] = []) => {
        await Promise.resolve();
        if (texto.trim().startsWith('WITH d AS')) {
          insertados.push(p);
          return { rows: (p[1] as string[]).map((f, i) => ({ id: `D${i}`, id_fisico: f, via: (p[4] as string[])[i], formato: (p[5] as string[])[i] })) };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => {}, on: () => {}, off: () => {},
    }),
  };
  const dynsec = { disponible: true, ordenar: vi.fn(() => Promise.resolve([])) } as unknown as DynsecService;
  const ctrl = new AltaController(new AltaService(pool as unknown as Pool, dynsec), {} as never, config, {} as never, {} as never);
  return { ctrl, consultasPool, insertados };
}

describe('con el servicio real', () => {
  it('«vista previa = creación»: lo que se inserta es, fila por fila, lo que anunció `interpretada`', async () => {
    const { ctrl, insertados } = conBaseFalsa();
    const varias = [
      ...filas,
      { n: 7, id_fisico: 'Nodo-MQTT', nombre: 'Por mqtt', zona: Z1, via: '', intervalo_esperado_s: '30', canales: 'humedad;temperatura:Cel' },
      { n: 9, id_fisico: 'nodo-plano', nombre: 'Plano', zona: 'laboratorio', via: 'mqtt', formato: 'plano', intervalo_esperado_s: '86400', canales: 'temperatura' },
    ];
    const u = usuarioSistema();
    const vista = await ctrl.lote(u, 'validar', { filas: varias }, undefined, res());
    const hecho = await ctrl.lote(u, 'crear', { filas: varias, huella: vista.huella }, LLAVE, res());
    expect(insertados).toHaveLength(1);
    const p = insertados[0];
    const [zona, id, nombre, intervalo, via, formato, pasarela, decodificador, canalId, canalMag] = p as string[][];
    const anunciadas = vista.filas.map((f) => f.interpretada!);
    expect(anunciadas).toHaveLength(4);
    anunciadas.forEach((a, i) => {
      expect([zona[i], id[i], nombre[i], intervalo[i], via[i], formato[i], pasarela[i], decodificador[i]])
        .toEqual([a.zona_id, a.id_fisico, a.nombre, a.intervalo_esperado_s, a.via, a.formato, a.pasarela_id, a.decodificador]);
      expect(canalMag.filter((_, k) => canalId[k] === a.id_fisico)).toEqual(a.canales.map((k) => k.magnitud));
    });
    expect(hecho.filas.map((f) => [f.n, f.resultado])).toEqual([[2, 'creada'], [4, 'creada'], [7, 'creada'], [9, 'creada']]);
    expect(hecho.filas[2]?.topico).toBe(anunciadas[2]?.topico);
  });
  it(`la vista previa de ${MAX_FILAS_LOTE} filas hace 5 consultas (los catálogos, una vez cada uno), ninguna por fila`, async () => {
    const { ctrl, consultasPool } = conBaseFalsa();
    const muchas = Array.from({ length: MAX_FILAS_LOTE }, (_, i) => ({ n: i + 2, id_fisico: `nodo-${i}`, nombre: `N ${i}`, zona: 'Laboratorio', via: 'http', intervalo_esperado_s: '60', canales: 'temperatura' }));
    const r = await ctrl.lote(usuarioSistema(), 'validar', { filas: muchas }, undefined, res());
    expect(r.validas).toBe(MAX_FILAS_LOTE);
    expect(consultasPool).toHaveLength(5);
  });
});
