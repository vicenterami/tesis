import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, HttpException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { SQL_HISTORICO_SITIO, SQL_PUBLICO_AHORA, SQL_PUBLICO_SERIES } from '../consulta/tablero.js';
import { TableroService } from '../consulta/tablero.service.js';
import { NO_DISPONIBLE, PUBLICO, generarToken, hashToken } from './publico.js';
import { ConsultaLenta, EnlaceVigente, VistaPublicaService } from './vista-publica.service.js';

// GET /publico contra una base falsa (docs/19 §4, O, puntos 6 a 8 y 13): el orden validar → guardado, la misma 404, el cupo propio, el
// tiempo máximo y el contador. La misma lógica contra una base real: backend/integracion/publico.ts (docs/16 §79).
const ZN = '11111111-1111-4111-8111-111111111111';
const filaDe = (token: string, extra: Partial<EnlaceVigente> = {}): EnlaceVigente => ({
  id: `e-${token.slice(0, 6)}`, sitio_id: 's1', token_hash: hashToken(token), titulo: 'Clima', descripcion: null, magnitudes: ['temperatura'],
  ventana_maxima: '7d', zonas: [{ id: ZN, nombre: 'Norte' }], sitio: 'Sitio', zona_horaria: 'UTC', k_sitio: 3, ...extra,
});

interface Opciones { filas?: Map<string, EnlaceVigente>; datos?: 'ok' | 'tarda' | 'cuelga' | 'falla'; conectar?: 'falla'; rollback?: 'cuelga'; retener?: Promise<void>; entorno?: Record<string, string>; volcadoFalla?: boolean }
function base(o: Opciones = {}) {
  const filas = o.filas ?? new Map<string, EnlaceVigente>();
  const sentencias: string[] = [];
  const clientes: { release: ReturnType<typeof vi.fn> }[] = [];
  const pool = {
    query: vi.fn(async (sql: string, p: unknown[] = []) => {
      await Promise.resolve();
      sentencias.push(sql);
      if (sql.includes('FROM enlace_publico e JOIN sitio')) {
        const f = [...filas.values()].find((x) => x.token_hash === p[0]);
        return { rows: f === undefined ? [] : [f] };
      }
      if (sql.includes('INSERT INTO enlace_publico_acceso')) {
        if (o.volcadoFalla) throw new Error('sin conexión');
        return { rows: [] };
      }
      if (sql.includes('AS cota')) return { rows: [{ zona_horaria: 'UTC', unidad: 'Cel', nombre: 'Temperatura', cota: '2026-11-16T00:00:00.000Z' }] };
      throw new Error(`sentencia inesperada: ${sql.slice(0, 60)}`);
    }),
    connect: vi.fn(async () => {
      await Promise.resolve();
      if (o.conectar === 'falla') throw Object.assign(new Error('connect ECONNREFUSED base-de-prueba:5432'), { code: 'ECONNREFUSED' });
      const cliente = {
        on: vi.fn(), off: vi.fn(), release: vi.fn(),
        query: vi.fn(async (sql: string) => {
          sentencias.push(sql);
          if (sql === 'ROLLBACK' && o.rollback === 'cuelga') return new Promise<never>(() => undefined);
          if (sql.startsWith('SET LOCAL statement_timeout') || ['BEGIN READ ONLY', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
          if (sql.startsWith('SET statement_timeout') || sql === 'RESET statement_timeout') return { rows: [] }; // el histórico del sitio (Tendencias)
          if (sql.includes('AS catalogo')) {
            if (o.retener) await o.retener;
            if (o.datos === 'tarda') throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
            if (o.datos === 'cuelga') return new Promise<never>(() => undefined); // la base no responde nunca
            if (o.datos === 'falla') throw new Error('relation does not exist');
            return { rows: [{ cota: '2026-11-16T00:00:00.000Z', catalogo: [{ codigo: 'temperatura', nombre: 'Temperatura', unidad: 'Cel' }] }] };
          }
          if (sql === SQL_PUBLICO_SERIES) {
            return { rows: [{ magnitud: 'temperatura', zona_id: null, t: '100', v: 20, n: 4, mn: 1, mx: 99 }, { magnitud: 'temperatura', zona_id: ZN, t: '100', v: 19, n: 3 }] };
          }
          if (sql === SQL_PUBLICO_AHORA) return { rows: [{ magnitud: 'temperatura', zona_id: null, v: 20, n: 4, ultimo: '2026-11-17T12:00:00.000Z' }] };
          if (sql === SQL_HISTORICO_SITIO) return { rows: [] };
          throw new Error(`sentencia inesperada en la conexión: ${sql.slice(0, 60)}`);
        }),
      };
      clientes.push(cliente);
      return cliente;
    }),
  };
  const config = { get: (k: string) => o.entorno?.[k] } as unknown as ConfigService;
  return { servicio: new VistaPublicaService(pool as unknown as Pool, config), pool, sentencias, clientes, filas };
}
async function respuesta(p: Promise<unknown>): Promise<{ estado: number; cuerpo: string }> {
  try {
    await p;
    return { estado: 200, cuerpo: '' };
  } catch (e) {
    if (e instanceof HttpException) return { estado: e.getStatus(), cuerpo: JSON.stringify(e.getResponse()) };
    throw e;
  }
}
afterEach(() => vi.restoreAllMocks());

describe('GET /publico: el token se valida antes que nada, y la 404 es una sola', () => {
  it('ausente, repetido, mal formado o inexistente: la misma 404 byte a byte; sin forma, ni siquiera consulta la base', async () => {
    const t = generarToken();
    const { servicio, pool } = base();
    const casos = await Promise.all([undefined, [t, t], 'corto', `${t}!`].map((c) => respuesta(servicio.servir(c as string, undefined, false))));
    expect(pool.query).not.toHaveBeenCalled();
    casos.push(await respuesta(servicio.servir(t, undefined, false)));
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(new Set(casos.map((c) => `${c.estado} ${c.cuerpo}`))).toEqual(new Set([`404 ${JSON.stringify(new NotFoundException(NO_DISPONIBLE).getResponse())}`]));
  });
  it('una ventana inválida con un token que no vale es 404, no 400 (no se revela nada antes de validar); con uno vigente, 400', async () => {
    const t = generarToken();
    const { servicio, filas } = base();
    expect((await respuesta(servicio.servir(generarToken(), '1y', false))).estado).toBe(404);
    filas.set(t, filaDe(t, { ventana_maxima: '24h' }));
    await expect(servicio.servir(t, '7d', false)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('revocar corta en la petición siguiente aunque la respuesta siga guardada (la fila se lee antes que lo guardado)', async () => {
    const t = generarToken();
    const { servicio, filas, pool } = base();
    filas.set(t, filaDe(t));
    expect((await servicio.servir(t, undefined, false)).titulo).toBe('Clima');
    filas.delete(t); // revocado o vencido: la consulta por el resumen ya no lo trae
    expect((await respuesta(servicio.servir(t, undefined, false))).estado).toBe(404);
    expect(pool.connect).toHaveBeenCalledTimes(1); // los datos siguen guardados; aun así no se sirvieron
  });
  it('la respuesta: lo del enlace y los datos, nunca n, mínimo ni máximo; el k que rige nunca baja del piso vigente', async () => {
    const t = generarToken();
    const { servicio, filas } = base({ entorno: { PUBLICO_MINIMO_DISPOSITIVOS_PISO: '2' } });
    filas.set(t, filaDe(t, { k_sitio: 1 }));
    const v = await servicio.servir(t, '24h', false);
    expect(v.magnitudes[0].protegido).toBe(true); // k = 2 > 1: depende solo de la configuración
    expect(Object.keys(v).sort()).toEqual(['descripcion', 'desde', 'hasta', 'intervalo', 'magnitudes', 'minimo_dispositivos', 'sitio', 'tiempos', 'titulo', 'ultimo_dato', 'ventana', 'ventanas', 'zona_horaria']);
    expect(v.minimo_dispositivos).toBe(2);
    expect(v.intervalo).toBe('5 minutes');
    expect(v.ventanas).toEqual(['24h', '7d']);
    expect(JSON.stringify(v)).not.toMatch(/"n":|"mn"|"mx"|:99[,}\]]|"e-|"s1"/); // ni n, mínimo, máximo, el id del enlace ni el del sitio
    expect(v.magnitudes[0].zonas[0]).toEqual({ nombre: 'Norte', ahora: null, serie: [19] });
    expect(v.magnitudes[0]).toMatchObject({ ahora: 20, serie: [20] });
  });
});

describe('k es del sitio (tercera revisión del 17/11/2026)', () => {
  it('un k de omisión menor que 3 queda dicho en el registro al arrancar (responsabilidad del operador); con 3 o más, nada', () => {
    const escritos: string[] = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => { escritos.push(String(m)); });
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    for (const k of ['2', '3']) {
      const { servicio } = base({ entorno: { PUBLICO_MINIMO_DISPOSITIVOS: k } });
      servicio.onModuleInit();
      void servicio.onModuleDestroy();
    }
    expect(escritos.filter((x) => x.includes('PUBLICO_MINIMO_DISPOSITIVOS='))).toEqual([expect.stringContaining('PUBLICO_MINIMO_DISPOSITIVOS=2, menos que 3')]);
  });
  it('el k del sitio entra al cálculo y a la clave de lo guardado: cambiarlo se nota en la petición siguiente; un enlace anonimizado no se sirve', async () => {
    const t = generarToken();
    const { servicio, filas, pool } = base();
    filas.set(t, filaDe(t, { k_sitio: 3 }));
    expect((await servicio.servir(t, undefined, false)).minimo_dispositivos).toBe(3);
    await servicio.servir(t, undefined, false);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    filas.set(t, filaDe(t, { k_sitio: 5 })); // el administrador subió el k del sitio
    expect((await servicio.servir(t, undefined, false)).minimo_dispositivos).toBe(5);
    expect(pool.connect).toHaveBeenCalledTimes(2);
    filas.set(t, filaDe(t, { k_sitio: null })); // sin fijar: el del despliegue
    expect((await servicio.servir(t, undefined, false)).minimo_dispositivos).toBe(3);
    const sql = String(pool.query.mock.calls.find(([s]) => String(s).includes('FROM enlace_publico e JOIN sitio'))?.[0]);
    expect(sql).toContain('s.publico_minimo_dispositivos');
    expect(sql).toContain('e.anonimizado_en IS NULL');
    expect(sql).not.toContain('e.minimo_dispositivos');
  });
});

describe('cupo propio y tiempo máximo', () => {
  it('sin conexión por otra causa que el plazo: no es una consulta lenta, no se guarda como fallo y queda en el registro (revisión final)', async () => {
    const escritos: string[] = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => { escritos.push(String(m)); });
    const t = generarToken();
    const { servicio, filas, pool } = base({ conectar: 'falla' });
    filas.set(t, filaDe(t));
    const errores = [];
    for (let i = 0; i < 2; i++) errores.push(await servicio.servir(t, undefined, false).then(() => null, (e: unknown) => e));
    for (const e of errores) {
      expect(e).toBeInstanceOf(Error);
      expect(e).not.toBeInstanceOf(ConsultaLenta);
      expect((e as Error).message).toBe('connect ECONNREFUSED base-de-prueba:5432');
    }
    expect(pool.connect).toHaveBeenCalledTimes(2); // no quedó guardado: la segunda vuelve a intentar
    expect(escritos.some((x) => x.includes('no se pudo pedir una conexión para la vista pública (código ECONNREFUSED)'))).toBe(true);
    expect(escritos.some((x) => x.includes('base-de-prueba'))).toBe(false); // el registro no lleva el nombre ni el puerto de la base
  });
  it('un ROLLBACK que no vuelve tras un error de la consulta también tiene tope: el error sale, la conexión se suelta con error', async () => {
    vi.useFakeTimers();
    try {
      const t = generarToken();
      const { servicio, filas, clientes } = base({ datos: 'falla', rollback: 'cuelga' });
      filas.set(t, filaDe(t));
      const r = servicio.servir(t, undefined, false).then(() => 'ok', (e: unknown) => (e as Error).message);
      await vi.advanceTimersByTimeAsync(PUBLICO.tiempoMaximoMs + 600);
      expect(await r).toBe('relation does not exist');
      expect(clientes[0].release).toHaveBeenCalledWith(expect.any(Error));
    } finally {
      vi.useRealTimers();
    }
  });
  it('una conexión que no responde: el reloj del proceso la da por vencida (503), la suelta con error para que se destruya, sin ROLLBACK, y el cupo queda libre', async () => {
    vi.useFakeTimers();
    try {
      const t = generarToken();
      const { servicio, filas, clientes, sentencias } = base({ datos: 'cuelga' });
      filas.set(t, filaDe(t));
      const r = servicio.servir(t, undefined, false).then(() => 'ok', (e: unknown) => (e instanceof ConsultaLenta ? '503' : String(e)));
      await vi.advanceTimersByTimeAsync(PUBLICO.tiempoMaximoMs + 600);
      expect(await r).toBe('503');
      expect(clientes[0].release).toHaveBeenCalledWith(expect.any(Error));
      expect(sentencias).not.toContain('ROLLBACK');
      // El cupo (uno a la vez) quedó libre: otro enlace calcula enseguida.
      const t2 = generarToken();
      filas.set(t2, filaDe(t2));
      const otra = servicio.servir(t2, undefined, false).then(() => 'ok', () => 'falló');
      await vi.advanceTimersByTimeAsync(PUBLICO.tiempoMaximoMs + 600);
      expect(await otra).toBe('falló'); // también cuelga (misma base falsa), pero llegó a pedir su conexión: el cupo no estaba tomado
      expect(clientes).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it('si la consulta pasa el tiempo máximo: 503, en una transacción de solo lectura que se deshace (el tope muere con ella)', async () => {
    const t = generarToken();
    const { servicio, filas, clientes, sentencias } = base({ datos: 'tarda' });
    filas.set(t, filaDe(t));
    await expect(servicio.servir(t, undefined, false)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(sentencias[sentencias.indexOf('BEGIN READ ONLY') + 1]).toMatch(/^SET LOCAL statement_timeout = \d+$/);
    expect(sentencias).toContain('ROLLBACK');
    expect(clientes[0].release).toHaveBeenCalledWith(undefined);
  });
  it('el plazo es del cálculo entero, no de cada sentencia: cada consulta recibe lo que queda, y si ya no queda, 503 sin consultar', async () => {
    const t = generarToken();
    const { servicio, filas, sentencias } = base();
    filas.set(t, filaDe(t));
    await servicio.servir(t, undefined, false);
    const topes = sentencias.filter((s) => s.startsWith('SET LOCAL statement_timeout')).map((s) => Number(s.split('= ')[1]));
    expect(topes).toHaveLength(3);
    expect(topes.every((x, i) => x <= PUBLICO.tiempoMaximoMs && (i === 0 || x <= topes[i - 1]))).toBe(true);
    expect(sentencias).toContain('COMMIT');
    // Después de la primera consulta el reloj salta más allá del plazo: la segunda no se manda.
    const t2 = generarToken();
    const b = base();
    b.filas.set(t2, filaDe(t2));
    const ahora = Date.now();
    let llamadas = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (llamadas++ < 2 ? ahora : ahora + PUBLICO.tiempoMaximoMs + 1));
    await expect(b.servicio.servir(t2, undefined, false)).rejects.toBeInstanceOf(ConsultaLenta);
    expect(b.sentencias.filter((s) => s === SQL_PUBLICO_SERIES)).toHaveLength(0);
  });
  it('un cálculo que pasó el tiempo máximo se guarda como fallo: las peticiones siguientes de ese enlace y ventana, 503 sin consultar', async () => {
    const t = generarToken();
    const { servicio, filas, pool } = base({ datos: 'tarda' });
    filas.set(t, filaDe(t));
    await expect(servicio.servir(t, undefined, false)).rejects.toBeInstanceOf(ConsultaLenta);
    const r = await Promise.all(Array.from({ length: 20 }, () => respuesta(servicio.servir(t, undefined, false))));
    expect(r.every((x) => x.estado === 503)).toBe(true);
    expect(pool.connect).toHaveBeenCalledTimes(1); // una sola consulta de datos para las 21 peticiones
    expect(pool.query.mock.calls.filter(([sql]) => String(sql).includes('FROM enlace_publico e JOIN sitio'))).toHaveLength(21); // la vigencia, en cada una
    expect((await respuesta(servicio.servir(t, '7d', false))).estado).toBe(503);
    expect(pool.connect).toHaveBeenCalledTimes(2); // otra ventana es otra clave
  });
  it('con el cupo público lleno (1 en curso y 20 en fila), la siguiente vista es 503 sin tocar la base, y las Tendencias del tablero siguen respondiendo', async () => {
    let soltar!: () => void;
    const retener = new Promise<void>((r) => { soltar = r; });
    const { servicio, filas, pool } = base({ retener });
    const tokens = Array.from({ length: PUBLICO.maxEnCurso + PUBLICO.maxEnEspera + 1 }, () => generarToken());
    for (const t of tokens) filas.set(t, filaDe(t));
    const enVuelo = tokens.slice(0, -1).map((t) => servicio.servir(t, undefined, false));
    await new Promise((r) => setTimeout(r, 0));
    const conexiones = pool.connect.mock.calls.length;
    await expect(servicio.servir(tokens[tokens.length - 1], undefined, false)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(pool.connect.mock.calls.length).toBe(conexiones);
    // El histórico del sitio (pestaña Tendencias) tiene su propio cupo: responde aunque lo público esté lleno.
    const h = await new TableroService(pool as unknown as Pool).historicoSitio('s1', 'temperatura', new Date('2026-11-17T00:00:00Z'), new Date('2026-11-17T01:00:00Z'), '5 minutes');
    expect(h.puntos).toBe(0);
    soltar();
    expect((await Promise.all(enVuelo)).length).toBe(tokens.length - 1);
  });
});

describe('contador de accesos', () => {
  it('cuenta solo las cargas (carga=si) de un enlace que vale; el volcado suma con ON CONFLICT; si falla, lo contado vuelve y se reintenta', async () => {
    const t = generarToken();
    const b = base({ volcadoFalla: true });
    b.filas.set(t, filaDe(t));
    await b.servicio.servir(t, undefined, true);
    await b.servicio.servir(t, undefined, false);
    await respuesta(b.servicio.servir(generarToken(), undefined, true));
    expect(b.servicio.contador.claves).toBe(1);
    await b.servicio.volcar();
    expect(b.servicio.contador.claves).toBe(1); // volvió a la memoria
    const insercion = b.pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO enlace_publico_acceso'));
    expect(String(insercion?.[0])).toContain('ON CONFLICT (enlace_id, dia) DO UPDATE SET cuenta = enlace_publico_acceso.cuenta + EXCLUDED.cuenta');
    expect(insercion?.[1]).toEqual([[filaDe(t).id], [new Date().toISOString().slice(0, 10)], [1]]);
  });
  it('sin nada que volcar no toca la base', async () => {
    const { servicio, pool } = base();
    await servicio.volcar();
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('el token no queda en ningún registro', () => {
  it('ni al servir, ni al fallar por tiempo, ni al fallar el volcado', async () => {
    const escritos: string[] = [];
    for (const nivel of ['log', 'warn', 'error'] as const) vi.spyOn(Logger.prototype, nivel).mockImplementation((m: unknown) => { escritos.push(String(m)); });
    const t = generarToken();
    const b = base({ datos: 'tarda', volcadoFalla: true });
    b.filas.set(t, filaDe(t));
    b.servicio.onModuleInit();
    await respuesta(b.servicio.servir(t, undefined, true));
    await b.servicio.onModuleDestroy();
    expect(escritos.length).toBeGreaterThan(1);
    expect(escritos.join('\n')).not.toContain(t);
  });
});
