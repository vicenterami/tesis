import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { HISTORICO_SITIO, SQL_HISTORICO_SITIO, SQL_LECTURA_VIGENTE, TENDENCIA, VIGENCIA_INTERVALOS, sqlLecturaVigente, sqlLimiteVigencia } from './tablero.js';
import { TableroService } from './tablero.service.js';

// GET /sitios/{id}/historico (docs/19 §4, M; docs/10 §8.4 punto 66): el promedio del sitio es el de sus dispositivos. Lo que se prueba
// aquí, sin base: la regla de vigencia con una sola casa, dónde la usa la consulta, y el tiempo máximo con su 503 y la conexión que vuelve
// al grupo sin el tope. La consulta contra datos sembrados a propósito (los cinco casos de M7) es `banco.sh historico` (docs/16 §68).

describe('la regla de vigencia: una sola casa (sqlLecturaVigente) para «Ahora» y el histórico del sitio', () => {
  it('menos de dos intervalos esperados, estricta, en el instante que se le pida', () => {
    expect(sqlLecturaVigente('l.t', 'r.b', 'd.i')).toBe("l.t > r.b - d.i * 2 * INTERVAL '1 second'");
  });
  it('«Ahora» la evalúa con el reloj de la base (el mismo texto de antes)', () => {
    expect(SQL_LECTURA_VIGENTE).toBe(sqlLecturaVigente('u.tiempo', 'now()', 'dev.intervalo_esperado_s'));
  });
  it('el histórico arrastra una lectura solo si sigue vigente AL EMPEZAR cada tramo, con el intervalo de su dispositivo', () => {
    expect(SQL_HISTORICO_SITIO).toContain(sqlLecturaVigente('p.ut', 'u.b', 'p.intervalo_esperado_s'));
  });
  it('la lectura anterior a la ventana se busca hasta dos intervalos antes del inicio del primer tramo, no de `desde`', () => {
    expect(SQL_HISTORICO_SITIO).toContain(sqlLecturaVigente('x.tiempo', 'time_bucket($4::interval, $2::timestamptz, $5)', 'c.intervalo_esperado_s'));
  });
  it('ninguna regla de vigencia escrita a mano en la consulta: toda comparación con «* 2 * INTERVAL» sale de sqlLecturaVigente', () => {
    const usos = SQL_HISTORICO_SITIO.split("* 2 * INTERVAL '1 second'").length - 1;
    expect(usos).toBe(2);
  });
  it('cada canal se agrega por su cuenta (LATERAL) y lo que se lee empieza en la cota $7, una constante al planificar', () => {
    expect(SQL_HISTORICO_SITIO).toMatch(/FROM c CROSS JOIN LATERAL \(/);
    expect(SQL_HISTORICO_SITIO).toContain('x.tiempo >= $7 AND x.tiempo < $3');
  });
});

// Un doble del grupo de conexiones: la primera consulta (meta) va por el grupo; la del histórico, por una conexión propia.
function doble(opciones: { historico?: 'ok' | 'tarda' | 'falla' | 'vacio' | 'retenida'; reset?: 'ok' | 'falla'; meta?: boolean } = {}) {
  const retenidas: (() => void)[] = []; // con «retenida», cada consulta del histórico espera a que la prueba la suelte
  const enGrupo: { sql: string; p: unknown[] }[] = [];
  const enCliente: { sql: string; p: unknown[] }[] = [];
  const liberadas: unknown[] = [];
  const query = vi.fn((sql: string, p: unknown[] = []) => {
    enGrupo.push({ sql, p });
    if (sql.includes('FROM sitio s CROSS JOIN magnitud m')) {
      return Promise.resolve({ rows: opciones.meta === false ? [] : [{ zona_horaria: 'America/Santiago', unidad: 'Cel', nombre: 'Temperatura', cota: '2026-11-13T10:00:00.000Z' }] });
    }
    return Promise.resolve({ rows: [] });
  });
  const cliente = {
    on: vi.fn(), off: vi.fn(), release: vi.fn((e?: unknown) => { liberadas.push(e); }),
    query: vi.fn((sql: string, p: unknown[] = []) => {
      enCliente.push({ sql, p });
      if (sql === 'RESET statement_timeout' && opciones.reset === 'falla') return Promise.reject(new Error('Connection terminated unexpectedly'));
      if (sql === SQL_HISTORICO_SITIO) {
        const h = opciones.historico ?? 'ok';
        if (h === 'tarda') return Promise.reject(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }));
        if (h === 'falla') return Promise.reject(Object.assign(new Error('la base no responde'), { code: '57P01' }));
        if (h === 'vacio') return Promise.resolve({ rows: [] });
        if (h === 'retenida') return new Promise((ok) => retenidas.push(() => ok({ rows: [] })));
        return Promise.resolve({ rows: [
          { t: '1794600000', v: 14.167, mn: 11.5, mx: 17, muestras: 6, n: 3, dispositivos: 3 },
          { t: '1794600900', v: 14.167, mn: 11.5, mx: 17, muestras: 5, n: 3, dispositivos: 3 },
        ] });
      }
      return Promise.resolve({ rows: [] });
    }),
  };
  const connect = vi.fn(() => Promise.resolve(cliente));
  return { servicio: new TableroService({ query, connect } as unknown as Pool), enGrupo, enCliente, liberadas, connect, retenidas };
}
const DESDE = new Date('2026-11-13T12:00:00Z');
const HASTA = new Date('2026-11-13T13:15:00Z');

describe('TableroService.historicoSitio: dos consultas y la segunda con tiempo máximo (docs/19 §4, M5)', () => {
  it(`la del histórico va en una conexión propia con SET statement_timeout de ${HISTORICO_SITIO.tiempoMaximoMs} ms y RESET al soltarla`, async () => {
    const { servicio, enGrupo, enCliente, liberadas } = doble();
    await servicio.historicoSitio('s1', 'temperatura', DESDE, HASTA, '15 minutes');
    expect(enGrupo).toHaveLength(1);
    expect(enCliente.map((x) => x.sql)).toEqual([`SET statement_timeout TO ${HISTORICO_SITIO.tiempoMaximoMs}`, SQL_HISTORICO_SITIO, 'RESET statement_timeout']);
    expect(liberadas).toEqual([undefined]);
  });
  it('los parámetros: sitio, ventana, intervalo, zona del sitio, magnitud y la cota que calculó la primera consulta', async () => {
    const { servicio, enCliente } = doble();
    await servicio.historicoSitio('s1', 'temperatura', DESDE, HASTA, '15 minutes');
    expect(enCliente[1]?.p).toEqual(['s1', DESDE, HASTA, '15 minutes', 'America/Santiago', 'temperatura', '2026-11-13T10:00:00.000Z']);
  });
  it('la forma de siempre; `dispositivos`, de la consulta (los que aportan en algún tramo) y 0 sin ningún punto', async () => {
    const r = await doble().servicio.historicoSitio('s1', 'temperatura', DESDE, HASTA, '15 minutes');
    expect(r).toMatchObject({ puntos: 2, dispositivos: 3, tiempos: [1794600000, 1794600900], valores: [14.167, 14.167], minimos: [11.5, 11.5],
      maximos: [17, 17], muestras: [6, 5], n: [3, 3], escala: null, porcentajes: null, unidad: 'Cel', zona_horaria: 'America/Santiago' });
    const v = await doble({ historico: 'vacio' }).servicio.historicoSitio('s1', 'temperatura', DESDE, HASTA, '15 minutes');
    expect(v).toMatchObject({ puntos: 0, dispositivos: 0, tiempos: [], n: [] });
  });
  it('si vence el tiempo máximo → 503 (ServiceUnavailableException), y la conexión vuelve al grupo con RESET', async () => {
    const { servicio, enCliente, liberadas } = doble({ historico: 'tarda' });
    await expect(servicio.historicoSitio('s1', 'temperatura', DESDE, HASTA, '15 minutes')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(enCliente.at(-1)?.sql).toBe('RESET statement_timeout');
    expect(liberadas).toEqual([undefined]);
  });
  it('otro error de la base sigue siendo ese error (no un 503), y la conexión vuelve igual', async () => {
    const { servicio, liberadas } = doble({ historico: 'falla' });
    const e = await servicio.historicoSitio('s1', 'temperatura', DESDE, HASTA, '15 minutes').catch((x: unknown) => x);
    expect(e).not.toBeInstanceOf(ServiceUnavailableException);
    expect((e as Error).message).toBe('la base no responde');
    expect(liberadas).toEqual([undefined]);
  });
  it('si ni el RESET se puede (la conexión se cortó), se suelta CON el error: el grupo la destruye en vez de reusarla con el tope puesto', async () => {
    const { servicio, liberadas } = doble({ historico: 'tarda', reset: 'falla' });
    await expect(servicio.historicoSitio('s1', 'temperatura', DESDE, HASTA, '15 minutes')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(liberadas).toHaveLength(1);
    expect(liberadas[0]).toBeInstanceOf(Error);
  });
  it('la cota de lo que se lee sale de la misma regla (sqlLimiteVigencia): si el factor cambia, cambian juntas', async () => {
    expect(sqlLimiteVigencia('r.b', 'd.i')).toBe(`r.b - d.i * ${VIGENCIA_INTERVALOS} * INTERVAL '1 second'`);
    expect(sqlLecturaVigente('l.t', 'r.b', 'd.i')).toBe(`l.t > ${sqlLimiteVigencia('r.b', 'd.i')}`);
    const { servicio, enGrupo } = doble();
    await servicio.historicoSitio('s1', 'temperatura', DESDE, HASTA, '15 minutes');
    expect(enGrupo[0]?.sql).toContain(`iso_utc(${sqlLimiteVigencia('time_bucket($3::interval, $4::timestamptz, s.zona_horaria)', 'mx.i')}) AS cota`);
    expect(enGrupo[0]?.sql.split("INTERVAL '1 second'").length).toBe(2); // una sola vez, y es la de la función
  });
  it(`cupo: como mucho ${HISTORICO_SITIO.maxEnCurso} consultas a la vez; las demás esperan en fila y pasan en orden al soltarse un cupo`, async () => {
    const { servicio, connect, retenidas } = doble({ historico: 'retenida' });
    const tic = (): Promise<void> => new Promise((r) => setTimeout(r, 5));
    const pedidos = Array.from({ length: 4 }, () => servicio.historicoSitio('s1', 'temperatura', DESDE, HASTA, '15 minutes'));
    await tic();
    expect(connect).toHaveBeenCalledTimes(HISTORICO_SITIO.maxEnCurso); // la tercera y la cuarta no tomaron conexión todavía
    retenidas[0]();
    await tic();
    expect(connect).toHaveBeenCalledTimes(HISTORICO_SITIO.maxEnCurso + 1); // al terminar una, entra la siguiente (no las dos)
    for (const soltar of retenidas.slice(1)) soltar();
    await tic();
    retenidas.at(-1)!();
    await tic();
    for (const soltar of retenidas) soltar();
    await Promise.all(pedidos);
    expect(connect).toHaveBeenCalledTimes(4);
  });
  it(`cupo: con la fila llena (${HISTORICO_SITIO.maxEnEspera} en espera) responde 503 sin pedir conexión; al vaciarse, vuelve a atender`, async () => {
    const { servicio, connect, retenidas } = doble({ historico: 'retenida' });
    const tic = (): Promise<void> => new Promise((r) => setTimeout(r, 5));
    const n = HISTORICO_SITIO.maxEnCurso + HISTORICO_SITIO.maxEnEspera;
    const pedidos = Array.from({ length: n }, () => servicio.historicoSitio('s1', 'temperatura', DESDE, HASTA, '15 minutes'));
    await tic();
    const e = await servicio.historicoSitio('s1', 'temperatura', DESDE, HASTA, '15 minutes').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ServiceUnavailableException);
    expect((e as Error).message).toContain('en espera');
    expect(connect).toHaveBeenCalledTimes(HISTORICO_SITIO.maxEnCurso);
    // Se vacía: cada consulta retenida se suelta a medida que entra
    for (let i = 0; i < n; i++) {
      while (retenidas.length <= i) await tic();
      retenidas[i]();
    }
    await Promise.all(pedidos);
    expect(connect).toHaveBeenCalledTimes(n);
    await tic();
    const despues = servicio.historicoSitio('s1', 'temperatura', DESDE, HASTA, '15 minutes');
    await tic();
    expect(connect).toHaveBeenCalledTimes(n + 1); // el cupo quedó libre: ni fugado ni negativo
    retenidas.at(-1)!();
    await despues;
  });
  it('cupo: una consulta que falla (otro error de la base) o que vence también suelta su cupo', async () => {
    for (const modo of ['falla', 'tarda'] as const) {
      const { servicio, connect } = doble({ historico: modo });
      for (let i = 0; i < HISTORICO_SITIO.maxEnCurso + 2; i++) {
        await expect(servicio.historicoSitio('s1', 'temperatura', DESDE, HASTA, '15 minutes')).rejects.toThrow();
      }
      expect(connect).toHaveBeenCalledTimes(HISTORICO_SITIO.maxEnCurso + 2); // todas llegaron a la base: ninguna quedó sin cupo
    }
  });
  it('una magnitud que no está en el catálogo → 400, sin pedir conexión', async () => {
    const { servicio, connect } = doble({ meta: false });
    await expect(servicio.historicoSitio('s1', 'nada', DESDE, HASTA, '15 minutes')).rejects.toBeInstanceOf(BadRequestException);
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('la tendencia de «Ahora» comparte el mecanismo: tampoco devuelve al grupo una conexión con el tope puesto', () => {
  it(`con el RESET fallido, la conexión se suelta con el error (tope de ${TENDENCIA.tiempoMaximoMs} ms)`, async () => {
    const { servicio, liberadas, enCliente } = doble({ reset: 'falla' });
    // «Ahora» con tendencia y sin dispositivos no pide la tendencia: se llama directo al cálculo, que es privado.
    const r = await (servicio as unknown as { tendencias: (c: string[], d: Date, h: Date) => Promise<unknown> }).tendencias(['c1'], DESDE, HASTA);
    expect(r).toEqual([]);
    expect(enCliente[0]?.sql).toBe(`SET statement_timeout TO ${TENDENCIA.tiempoMaximoMs}`);
    expect(liberadas).toHaveLength(1);
    expect(liberadas[0]).toBeInstanceOf(Error);
  });
});
