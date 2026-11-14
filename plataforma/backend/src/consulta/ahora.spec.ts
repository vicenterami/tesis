import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import {
  CUBOS_CHISPA, CanalConUltima, MAGNITUDES_SALUD, MAX_CANALES_AHORA, SQL_ESTADO_VISUAL, armarChispas, elegirCanales, lecturaVigente, porMagnitud,
  ventanaChispa,
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

describe('porMagnitud: sobre la última lectura vigente de cada canal (menos de dos intervalos)', () => {
  it('una lectura vieja (más de 2 × intervalo) no entra al promedio ni a la cuenta', () => {
    const r = porMagnitud([canal('a', 'temperatura', 10, 30), canal('b', 'temperatura', 20, 60), canal('c', 'temperatura', 99, 121)], AHORA_MS);
    expect(r).toEqual([{ codigo: 'temperatura', nombre: 'temperatura', unidad: 'u', salud: false, canales: 2, promedio: 15, minimo: 10, maximo: 20 }]);
  });
  it('el borde: exactamente 2 × intervalo ya no es de «ahora»; un segundo menos, sí', () => {
    expect(lecturaVigente(canal('a', 'temperatura', 1, 120), AHORA_MS)).toBe(false);
    expect(lecturaVigente(canal('a', 'temperatura', 1, 119), AHORA_MS)).toBe(true);
    expect(lecturaVigente(canal('a', 'temperatura', null), AHORA_MS)).toBe(false);
  });
  it('el intervalo es el de cada dispositivo: 10 min de antigüedad es vigente a 3 600 s y vieja a 60 s', () => {
    expect(porMagnitud([canal('a', 'humedad', 50, 600, 3600), canal('b', 'humedad', 70, 600, 60)], AHORA_MS)[0]).toMatchObject({ canales: 1, promedio: 50 });
  });
  it('magnitud sin lecturas vigentes: no aparece (no es 0); la salud va al final; el promedio con tres decimales', () => {
    const r = porMagnitud([canal('a', 'bateria', 80), canal('b', 'temperatura', 1), canal('c', 'temperatura', 2), canal('d', 'temperatura', 2), canal('e', 'humedad', null)], AHORA_MS);
    expect(r.map((x) => [x.codigo, x.salud])).toEqual([['temperatura', false], ['bateria', true]]);
    expect(r[0]?.promedio).toBe(1.667);
  });
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

// El servicio contra una base falsa: cuenta las sentencias y arma la respuesta con lo que la base devolvería.
function base(n: number, opciones: { existe?: boolean } = {}) {
  const ids = Array.from({ length: n }, (_, i) => `d${i}`);
  const consultas: string[] = [];
  const parametros: unknown[][] = [];
  const query = vi.fn((sql: string, p: unknown[] = []) => {
    consultas.push(sql);
    parametros.push(p);
    if (sql.includes('WITH dev AS')) {
      return Promise.resolve({ rows: [{
        existe: opciones.existe ?? true, ahora: AHORA, reportan: n, sin_senal: 2, ids,
        pagina: ids.slice(0, p[1] as number).map((id, i) => ({
          id, nombre: `nodo ${i}`, zona: 'Invernadero', estado_visual: i === 0 ? 'alerta' : 'normal', visto_por_ultima_vez: hace(30), intervalo_esperado_s: 60,
        })),
      }] });
    }
    if (sql.includes(SQL_ULTIMA_MEDICION)) {
      return Promise.resolve({ rows: ids.flatMap((d) => [
        canal(`${d}-t`, 'temperatura', 20, 30, 60, d), canal(`${d}-b`, 'bateria', 90, 30, 60, d), canal(`${d}-h`, 'humedad', 50, 30, 60, d),
        { ...canal(`${d}-s`, 'humedad_suelo', 1.2, 30, 60, d), escala_cero: 2, escala_cien: 1 }, canal(`${d}-r`, 'rssi', -90, 500, 60, d),
      ]) });
    }
    if (sql.includes('time_bucket')) {
      const t0 = ventanaChispa(AHORA_MS).desde.getTime() / 1000;
      return Promise.resolve({ rows: (p[0] as string[]).map((c) => ({ canal_id: c, t: String(t0 + 22 * 3600), v: 1 })) });
    }
    return Promise.resolve({ rows: [] });
  });
  return { servicio: new TableroService({ query } as unknown as Pool), consultas, parametros };
}

describe('TableroService.ahora: un número fijo de sentencias, sin consultas por fila', () => {
  it('sin tendencia, dos; con tendencia, tres; con 1 o con 60 dispositivos, las mismas', async () => {
    for (const [n, tendencia, esperadas] of [[1, false, 2], [60, false, 2], [1, true, 3], [60, true, 3]] as const) {
      const { servicio, consultas } = base(n);
      await servicio.ahora('s1', 60, tendencia);
      expect(consultas, `${n} dispositivos, tendencia ${tendencia}`).toHaveLength(esperadas);
    }
  });
  it('la primera aplica la regla del estado visual del inventario y el orden de L3b (alerta, zona, nombre) con el límite como parámetro', async () => {
    const { servicio, consultas, parametros } = base(3);
    await servicio.ahora('s1', 7, false);
    const sql = (consultas[0] ?? '').replace(/\s+/g, ' ');
    expect(sql).toContain(SQL_ESTADO_VISUAL.replace(/\s+/g, ' '));
    expect(sql).toContain("CASE dev.estado_visual WHEN 'alerta' THEN 0 ELSE 1 END AS orden");
    expect(sql).toContain('ORDER BY orden, dev.zona, dev.nombre, dev.id LIMIT $2');
    expect(parametros[0]).toEqual(['s1', 7]);
    // la segunda, los canales de TODOS los que reportan (para el promedio por magnitud), de una vez
    expect(parametros[1]).toEqual([['d0', 'd1', 'd2']]);
  });
  it('la tendencia, una sentencia con canal_id = ANY y cota de tiempo, solo de los canales mostrados', async () => {
    const { servicio, consultas, parametros } = base(2);
    await servicio.ahora('s1', 24, true);
    expect(consultas[2]).toContain('x.canal_id = ANY($1::uuid[]) AND x.tiempo >= $2 AND x.tiempo < $3');
    expect(parametros[2]?.[0]).toEqual(['d0-h', 'd0-s', 'd0-t', 'd1-h', 'd1-s', 'd1-t']);
  });
  it('la forma: exactamente los campos del contrato; tres canales con su total; el % con la calibración; sin tendencia, ninguna chispa', async () => {
    const { servicio } = base(2);
    const r = await servicio.ahora('s1', 24, false);
    expect(Object.keys(r).sort()).toEqual(['dispositivos', 'por_magnitud', 'reportan', 'sin_senal']);
    expect(r.dispositivos.map((d) => d.id)).toEqual(['d0', 'd1']); // el orden de la base se respeta
    const d = r.dispositivos[0];
    expect(Object.keys(d ?? {}).sort()).toEqual(['canales', 'canales_total', 'estado_visual', 'id', 'intervalo_esperado_s', 'nombre', 'visto_por_ultima_vez', 'zona']);
    expect(d?.canales_total).toBe(5);
    expect(d?.canales.map((k) => k.magnitud)).toEqual(['humedad', 'humedad_suelo', 'temperatura']);
    expect(Object.keys(d?.canales[0] ?? {}).sort()).toEqual(['id', 'magnitud', 'magnitud_nombre', 'salud', 'ultima', 'unidad']);
    expect(d?.canales[1]?.ultima).toEqual({ valor: 1.2, tiempo: hace(30), porcentaje: 80 });
    // rssi tiene 500 s con intervalo 60: vieja, fuera del promedio; la batería sí entra, al final
    expect(r.por_magnitud.map((m) => `${m.codigo}:${m.canales}`)).toEqual(['humedad:2', 'humedad_suelo:2', 'temperatura:2', 'bateria:2']);
  });
  it('con tendencia=si: chispa arriba y en cada canal mostrado, 24 posiciones con null donde no hubo lecturas', async () => {
    const { servicio } = base(1);
    const r = await servicio.ahora('s1', 24, true);
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
