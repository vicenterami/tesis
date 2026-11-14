import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import {
  CUBOS_CHISPA, CanalConUltima, FilaMagnitud, MAGNITUDES_SALUD, MAX_CANALES_AHORA, SQL_ESTADO_VISUAL, SQL_LECTURA_VIGENTE, TENDENCIA, armarChispas,
  elegirCanales, porMagnitud, ventanaChispa,
} from './tablero.js';
import { TableroService } from './tablero.service.js';
import { SitiosController } from './sitios.controller.js';
import { SQL_ULTIMA_MEDICION } from './consulta.service.js';
import type { AlcanceService } from '../sesion/alcance.service.js';
import { usuarioSistema } from '../sesion/permisos.js';

// GET /sitios/{id}/ahora (docs/19 §4, bloque L, puntos 3 y 6; docs/10 §8.4 punto 65 viii): lo que se mide en este momento.
const AHORA = '2026-11-13T12:34:56.000Z';
const AHORA_MS = Date.parse(AHORA);
const hace = (s: number): string => new Date(AHORA_MS - s * 1000).toISOString();
const canal = (id: string, magnitud: string, valor: number | null, edadS = 30, intervalo = 60, dispositivo = 'd1'): CanalConUltima => ({
  id, dispositivo_id: dispositivo, magnitud, magnitud_nombre: magnitud, unidad: 'u', intervalo_esperado_s: intervalo, escala_cero: null, escala_cien: null,
  ultima: valor === null ? null : { valor, tiempo: hace(edadS) },
});

describe('salud del equipo: un solo conjunto, con los códigos del catálogo', () => {
  it('batería (nivel y tensión) y señal', () => expect([...MAGNITUDES_SALUD]).toEqual(['bateria', 'tension', 'rssi']));
});

describe('elegirCanales: hasta tres, primero lo que se mide y al final la salud', () => {
  it('cinco canales con dos de salud → los tres de medida, por código; la salud no entra', () => {
    const r = elegirCanales([canal('a', 'rssi', 1), canal('b', 'temperatura', 1), canal('c', 'bateria', 1), canal('d', 'humedad', 1), canal('e', 'presion', 1)]);
    expect(r.map((k) => k.magnitud)).toEqual(['humedad', 'presion', 'temperatura']);
    expect(r).toHaveLength(MAX_CANALES_AHORA);
  });
  it('una medida y dos de salud → la medida primero y la salud al final (batería antes que señal, por código)', () => {
    expect(elegirCanales([canal('a', 'rssi', 1), canal('b', 'bateria', 1), canal('c', 'humedad', 1)]).map((k) => k.magnitud)).toEqual(['humedad', 'bateria', 'rssi']);
  });
  it('no cambia la lista de entrada', () => {
    const l = [canal('a', 'rssi', 1), canal('b', 'humedad', 1)];
    elegirCanales(l);
    expect(l.map((k) => k.id)).toEqual(['a', 'b']);
  });
});

// Desde el 13/11/2026 el agregado por magnitud se calcula en la base (una fila por magnitud); aquí, lo que queda en el proceso y la regla.
const fila = (codigo: string, canales: number, promedio: number, minimo = promedio, maximo = promedio): FilaMagnitud =>
  ({ codigo, nombre: codigo, unidad: 'u', canales, promedio, minimo, maximo });
describe('porMagnitud: sobre la última lectura vigente de cada canal (menos de dos intervalos), agregada en la base', () => {
  it('la regla de vigencia es estricta (exactamente 2 × intervalo ya no es de «ahora») y usa el intervalo de cada dispositivo', () => {
    expect(SQL_LECTURA_VIGENTE).toBe("u.tiempo > now() - dev.intervalo_esperado_s * 2 * INTERVAL '1 second'");
  });
  it('la salud va al final y, dentro, por código; el promedio con tres decimales; mínimo y máximo, tal cual', () => {
    const r = porMagnitud([fila('bateria', 1, 80), fila('temperatura', 3, 5 / 3, 1, 2), fila('humedad', 2, 60.0004, 50, 70.25)]);
    expect(r.map((x) => [x.codigo, x.salud])).toEqual([['humedad', false], ['temperatura', false], ['bateria', true]]);
    expect(r[1]).toEqual({ codigo: 'temperatura', nombre: 'temperatura', unidad: 'u', salud: false, canales: 3, promedio: 1.667, minimo: 1, maximo: 2 });
    expect(r[0]?.promedio).toBe(60);
    expect(r[0]?.maximo).toBe(70.25);
  });
  it('sin ninguna magnitud vigente, lista vacía (una magnitud sin lecturas vigentes no aparece: no es 0)', () => expect(porMagnitud([])).toEqual([]));
});

describe('tendencia: 24 cubos de una hora alineados a la hora UTC', () => {
  it('desde el inicio de la hora en curso menos 23 h; hasta el fin de la hora en curso', () => {
    const v = ventanaChispa(AHORA_MS);
    expect(v.desde.toISOString()).toBe('2026-11-12T13:00:00.000Z');
    expect(v.hasta.toISOString()).toBe('2026-11-13T13:00:00.000Z');
  });
  it('un cubo sin lecturas es null, no 0; el último es la hora en curso; un canal sin filas, todo null', () => {
    const { desde } = ventanaChispa(AHORA_MS);
    const t0 = desde.getTime() / 1000;
    const r = armarChispas([{ canal_id: 'a', t: t0, v: 1.5 }, { canal_id: 'a', t: t0 + 23 * 3600, v: 0 }, { canal_id: 'a', t: t0 + 24 * 3600, v: 9 }], ['a', 'b'], desde);
    const a = r.get('a') ?? [];
    expect(a).toHaveLength(CUBOS_CHISPA);
    expect([a[0], a[1], a[23]]).toEqual([1.5, null, 0]);
    expect(r.get('b')).toEqual(new Array(CUBOS_CHISPA).fill(null));
  });
});

// El servicio contra una base falsa: cuenta las sentencias (las del pool y las de la conexión propia de la tendencia) y arma la respuesta
// con lo que la base devolvería. `n` dispositivos reportan; la base devuelve los de la página (el LIMIT) y, de canales, los de los ids que
// se le pasan. `tendencia`: 'ok', 'tarda' (un tiempo vencido: error 57014), 'falla' (otro error), o una promesa que la retiene.
interface OpcionesBase { existe?: boolean; sinCanales?: boolean; tendencia?: 'ok' | 'tarda' | 'falla' | Promise<void> }
function base(n: number, opciones: OpcionesBase = {}) {
  const ids = Array.from({ length: n }, (_, i) => `d${i}`);
  const consultas: string[] = [];
  const parametros: unknown[][] = [];
  const enCliente: string[] = [];
  const liberadas = { n: 0 };
  const responder = (sql: string, p: unknown[]) => {
    if (sql.includes('WITH dev AS')) {
      return { rows: [{
        existe: opciones.existe ?? true, ahora: AHORA, reportan: n, sin_senal: 2,
        por_magnitud: [fila('bateria', n, 90), fila('temperatura', n, 20), fila('humedad', n, 50)],
        pagina: ids.slice(0, p[1] as number).map((id, i) => ({
          id, nombre: `nodo ${i}`, zona: 'Invernadero', estado_visual: i === 0 ? 'alerta' : 'normal', visto_por_ultima_vez: hace(30), intervalo_esperado_s: 60,
        })),
      }] };
    }
    if (sql.includes(SQL_ULTIMA_MEDICION)) {
      if (opciones.sinCanales) return { rows: [] };
      return { rows: (p[0] as string[]).flatMap((d) => [
        canal(`${d}-t`, 'temperatura', 20, 30, 60, d), canal(`${d}-b`, 'bateria', 90, 30, 60, d), canal(`${d}-h`, 'humedad', 50, 30, 60, d),
        { ...canal(`${d}-s`, 'humedad_suelo', 1.2, 30, 60, d), escala_cero: 2, escala_cien: 1 }, canal(`${d}-r`, 'rssi', -90, 500, 60, d),
      ]) };
    }
    if (sql.includes('time_bucket')) {
      const t0 = ventanaChispa(AHORA_MS).desde.getTime() / 1000;
      return { rows: (p[0] as string[]).map((c) => ({ canal_id: c, t: String(t0 + 22 * 3600), v: 1 })) };
    }
    return { rows: [] };
  };
  const query = vi.fn((sql: string, p: unknown[] = []) => {
    consultas.push(sql);
    parametros.push(p);
    return Promise.resolve(responder(sql, p));
  });
  const cliente = {
    on: vi.fn(), off: vi.fn(), release: vi.fn(() => { liberadas.n++; }),
    query: vi.fn(async (sql: string, p: unknown[] = []) => {
      enCliente.push(sql);
      if (sql.includes('time_bucket')) {
        consultas.push(sql);
        parametros.push(p);
        const t = opciones.tendencia ?? 'ok';
        if (t === 'tarda') throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
        if (t === 'falla') throw Object.assign(new Error('la base no responde'), { code: '57P01' });
        if (t !== 'ok') await t;
      }
      return responder(sql, p);
    }),
  };
  const connect = vi.fn(() => Promise.resolve(cliente));
  return { servicio: new TableroService({ query, connect } as unknown as Pool), consultas, parametros, enCliente, connect, liberadas };
}

describe('TableroService.ahora: como mucho tres consultas, sin consultas por fila', () => {
  it('sin tendencia, dos; con tendencia, tres; con 1 o con 60 dispositivos, las mismas', async () => {
    for (const [n, tendencia, esperadas] of [[1, false, 2], [60, false, 2], [1, true, 3], [60, true, 3]] as const) {
      const { servicio, consultas } = base(n);
      await servicio.ahora('s1', 60, tendencia);
      expect(consultas, `${n} dispositivos, tendencia ${tendencia}`).toHaveLength(esperadas);
    }
  });
  it('con tendencia=si y ningún canal que mostrar, dos (no hay tendencia que calcular, ni conexión propia); sin nadie que reporte, una', async () => {
    const sin = base(3, { sinCanales: true });
    const r = await sin.servicio.ahora('s1', 24, true);
    expect(sin.consultas).toHaveLength(2);
    expect(sin.connect).not.toHaveBeenCalled();
    expect(r.tendencia).toBe(true); // se pidió y no se omitió: no hay canales a los que ponerle chispa
    const vacio = base(0);
    await vacio.servicio.ahora('s1', 24, true);
    expect(vacio.consultas).toHaveLength(1);
  });
  it('la primera aplica la regla del estado visual del inventario, el orden de L3b (alerta, zona, nombre) con el límite como parámetro y el agregado por magnitud en SQL', async () => {
    const { servicio, consultas, parametros } = base(3);
    await servicio.ahora('s1', 7, false);
    const sql = (consultas[0] ?? '').replace(/\s+/g, ' ');
    expect(sql).toContain(SQL_ESTADO_VISUAL.replace(/\s+/g, ' '));
    expect(sql).toContain("CASE dev.estado_visual WHEN 'alerta' THEN 0 ELSE 1 END AS orden");
    expect(sql).toContain('ORDER BY orden, dev.zona, dev.nombre, dev.id LIMIT $2');
    expect(sql).toContain(`WHERE dev.estado_visual IN ('normal', 'alerta') AND ${SQL_LECTURA_VIGENTE} GROUP BY c.magnitud_codigo`);
    expect(parametros[0]).toEqual(['s1', 7]);
  });
  it('un sitio con 2 000 que reportan y limite=2: la consulta de canales lleva solo los dos de la página, no los del sitio', async () => {
    const { servicio, parametros } = base(2000);
    const r = await servicio.ahora('s1', 2, false);
    expect(parametros[1]).toEqual([['d0', 'd1']]);
    expect(r.reportan).toBe(2000);
    expect(r.por_magnitud.map((m) => `${m.codigo}:${m.canales}`)).toEqual(['humedad:2000', 'temperatura:2000', 'bateria:2000']);
  });
  it('la tendencia, una sentencia con canal_id = ANY y cota de tiempo, solo de los canales mostrados', async () => {
    const { servicio, consultas, parametros } = base(2);
    await servicio.ahora('s1', 24, true);
    expect(consultas[2]).toContain('x.canal_id = ANY($1::uuid[]) AND x.tiempo >= $2 AND x.tiempo < $3');
    expect(parametros[2]?.[0]).toEqual(['d0-h', 'd0-s', 'd0-t', 'd1-h', 'd1-s', 'd1-t']);
  });
  it('la forma: exactamente los campos del contrato; tres canales con su total; el % con la calibración; sin tendencia, tendencia: false y ninguna chispa', async () => {
    const { servicio } = base(2);
    const r = await servicio.ahora('s1', 24, false);
    expect(Object.keys(r).sort()).toEqual(['dispositivos', 'por_magnitud', 'reportan', 'sin_senal', 'tendencia']);
    expect(r.tendencia).toBe(false);
    expect(r.dispositivos.map((d) => d.id)).toEqual(['d0', 'd1']); // el orden de la base se respeta
    const d = r.dispositivos[0];
    expect(Object.keys(d ?? {}).sort()).toEqual(['canales', 'canales_total', 'estado_visual', 'id', 'intervalo_esperado_s', 'nombre', 'visto_por_ultima_vez', 'zona']);
    expect(d?.canales_total).toBe(5);
    expect(d?.canales.map((k) => k.magnitud)).toEqual(['humedad', 'humedad_suelo', 'temperatura']);
    expect(Object.keys(d?.canales[0] ?? {}).sort()).toEqual(['id', 'magnitud', 'magnitud_nombre', 'salud', 'ultima', 'unidad']);
    expect(d?.canales[1]?.ultima).toEqual({ valor: 1.2, tiempo: hace(30), porcentaje: 80 });
    // la salud al final, como en las tarjetas
    expect(r.por_magnitud.map((m) => `${m.codigo}:${m.salud}`)).toEqual(['humedad:false', 'temperatura:false', 'bateria:true']);
  });
  it('con tendencia=si: tendencia: true, chispa arriba y en cada canal mostrado, 24 posiciones con null donde no hubo lecturas', async () => {
    const { servicio } = base(1);
    const r = await servicio.ahora('s1', 24, true);
    expect(r.tendencia).toBe(true);
    expect(r.chispa).toEqual({ desde: '2026-11-12T13:00:00.000Z', intervalo: '1 hour', puntos: 24 });
    const c = r.dispositivos[0]?.canales[0] as { chispa?: (number | null)[] } | undefined;
    expect(c?.chispa).toHaveLength(24);
    expect(c?.chispa?.[22]).toBe(1);
    expect(c?.chispa?.filter((x) => x === null)).toHaveLength(23);
  });
  it('un sitio que no existe → 404, sin pedir los canales', async () => {
    const { servicio, consultas } = base(0, { existe: false });
    await expect(servicio.ahora('s1', 24, false)).rejects.toBeInstanceOf(NotFoundException);
    expect(consultas).toHaveLength(1);
  });
});

describe('TableroService.ahora: los topes de la tendencia (docs/19 §4, L6; docs/11 §4)', () => {
  const sinChispa = (r: Awaited<ReturnType<TableroService['ahora']>>): boolean =>
    !('chispa' in r) && r.dispositivos.every((d) => d.canales.every((k) => !('chispa' in k)));
  it(`en una conexión propia con SET statement_timeout de ${TENDENCIA.tiempoMaximoMs} ms y RESET al soltarla`, async () => {
    const { servicio, enCliente, liberadas } = base(2);
    await servicio.ahora('s1', 24, true);
    expect(enCliente[0]).toBe(`SET statement_timeout TO ${TENDENCIA.tiempoMaximoMs}`);
    expect(enCliente[2]).toBe('RESET statement_timeout');
    expect(liberadas.n).toBe(1);
  });
  it('si vence el tiempo, responde igual: tendencia: false, sin ninguna chispa, con las tarjetas y el agregado; la conexión se suelta con RESET', async () => {
    const { servicio, enCliente, liberadas } = base(2, { tendencia: 'tarda' });
    const r = await servicio.ahora('s1', 24, true);
    expect(r.tendencia).toBe(false);
    expect(sinChispa(r)).toBe(true);
    expect(r.dispositivos).toHaveLength(2);
    expect(r.por_magnitud).toHaveLength(3);
    expect(enCliente.at(-1)).toBe('RESET statement_timeout');
    expect(liberadas.n).toBe(1);
  });
  it('otro error de la base no se disfraza de «sin tendencia»: sigue siendo un error, y la conexión se suelta igual', async () => {
    const { servicio, liberadas } = base(2, { tendencia: 'falla' });
    await expect(servicio.ahora('s1', 24, true)).rejects.toThrow('la base no responde');
    expect(liberadas.n).toBe(1);
  });
  it(`como mucho ${TENDENCIA.maxEnCurso} a la vez: la tercera responde sin tendencia y sin pedir conexión; al terminar una, vuelve a haber cupo`, async () => {
    let soltar: () => void = () => undefined;
    const retenida = new Promise<void>((r) => { soltar = r; });
    const { servicio, connect } = base(2, { tendencia: retenida });
    const enCurso = [servicio.ahora('s1', 24, true), servicio.ahora('s1', 24, true)];
    await new Promise((r) => setImmediate(r));
    expect(connect).toHaveBeenCalledTimes(TENDENCIA.maxEnCurso);
    const tercera = await servicio.ahora('s1', 24, true);
    expect(tercera.tendencia).toBe(false);
    expect(sinChispa(tercera)).toBe(true);
    expect(connect).toHaveBeenCalledTimes(TENDENCIA.maxEnCurso);
    soltar();
    expect((await Promise.all(enCurso)).map((r) => r.tendencia)).toEqual([true, true]);
    expect((await servicio.ahora('s1', 24, true)).tendencia).toBe(true);
  });
  it('si no se pidió, tendencia: false sin tocar la conexión propia', async () => {
    const { servicio, connect } = base(2);
    expect((await servicio.ahora('s1', 24, false)).tendencia).toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('SitiosController.ahora: entrada validada antes de tocar la base', () => {
  const S = '11111111-1111-4111-8111-111111111111';
  function armar() {
    const ahora = vi.fn(() => Promise.resolve({}));
    const exigirSitio = vi.fn(() => Promise.resolve());
    const c = new SitiosController({ ahora } as unknown as TableroService, { exigirSitio } as unknown as AlcanceService, {} as never);
    return { c, ahora, exigirSitio };
  }
  it('limite fuera de 1–60, no entero o repetido → 400, sin consultar el alcance ni la base', async () => {
    for (const malo of ['0', '61', '2.5', 'x', ['1', '2']]) {
      const { c, ahora, exigirSitio } = armar();
      await expect(c.ahora(usuarioSistema(), S, malo as string)).rejects.toBeInstanceOf(BadRequestException);
      expect(ahora).not.toHaveBeenCalled();
      expect(exigirSitio).not.toHaveBeenCalled();
    }
  });
  it('sin limite, 24; con 60, 60; el alcance se exige con «leer» sobre el sitio', async () => {
    const { c, ahora, exigirSitio } = armar();
    await c.ahora(usuarioSistema(), S);
    await c.ahora(usuarioSistema(), S, '60');
    expect(ahora.mock.calls).toEqual([[S, 24, false], [S, 60, false]]);
    expect(exigirSitio).toHaveBeenCalledWith(expect.anything(), 'leer', S);
  });
  it('tendencia: solo «si» la pide; ausente o cualquier otro valor, no', async () => {
    const { c, ahora } = armar();
    for (const t of [undefined, 'si', 'SI', '1', 'true', '']) await c.ahora(usuarioSistema(), S, undefined, t);
    expect(ahora.mock.calls.map((x) => (x as unknown[])[2])).toEqual([false, true, false, false, false, false]);
  });
  it('un id que no es UUID → 400', async () => {
    const { c } = armar();
    await expect(c.ahora(usuarioSistema(), 'no-uuid')).rejects.toBeInstanceOf(BadRequestException);
  });
});
