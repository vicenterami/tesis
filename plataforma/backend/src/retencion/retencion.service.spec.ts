import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { leerEntero, PLAZOS, RetencionService } from './retencion.service';

// La retención borra datos: lo primero que se prueba es que un valor mal escrito NO borre de más.
describe('RetencionService', () => {
  const medicion = PLAZOS.find((p) => p.tabla === 'medicion')!;

  it('variable ausente → valor por defecto (mediciones: sin límite); presente y válida → ese valor', () => {
    expect(leerEntero(undefined, medicion)).toBeNull();
    expect(leerEntero(undefined, PLAZOS.find((p) => p.tabla === 'trama')!)).toBe(30);
    expect(leerEntero('365', medicion)).toBe(365);
  });

  it('vacía, no entera, cero o bajo el mínimo → error al arrancar, nunca un 0 silencioso', () => {
    for (const malo of ['', '  ', 'abc', '0', '7', '30.5', '-1']) {
      expect(() => leerEntero(malo, medicion)).toThrow(/RETENCION_MEDICION_DIAS/);
    }
  });

  function armar(fallaEn?: string, entorno: Record<string, string> = {}) {
    const consultas: string[] = [];
    const query = jest.fn((sql: string, params?: unknown[]) => {
      consultas.push(sql);
      if (sql.includes('drop_chunks')) {
        if (params?.[0] === fallaEn) return Promise.reject(new Error('canceling statement due to lock timeout'));
        return Promise.resolve({ rows: [{ n: params?.[0] === 'trama' ? '2' : '0' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const release = jest.fn();
    // pool.query: la limpieza de sesiones (fn_limpiar_sesiones, migración 22) y la fila de la corrida en `evento`.
    const registrar = jest.fn((sql: string, _params?: unknown[]) => {
      if (sql.includes('fn_limpiar_sesiones')) return fallaEn === 'sesiones' ? Promise.reject(new Error('sin conexión')) : Promise.resolve({ rows: [{ n: 3 }] });
      return Promise.resolve({ rows: [] });
    });
    const pool = { connect: jest.fn(() => Promise.resolve({ query, release })), query: registrar } as unknown as Pool;
    const config = { get: jest.fn((k: string) => entorno[k]) } as unknown as ConfigService;
    return { servicio: new RetencionService(pool, config), query, release, consultas, registrar };
  }

  it('por defecto las mediciones NO se tocan: solo trama, cuarentena, metrica_broker y acceso; limpia sesiones y la corrida lo deja escrito', async () => {
    const { servicio, query, release, consultas, registrar } = armar();
    await servicio.corridaSegura();
    expect(query.mock.calls.filter(([sql]) => String(sql).includes('drop_chunks')).map(([, p]) => p)).toEqual([
      ['trama', 30], ['cuarentena', 30], ['metrica_broker', 90], ['acceso', 90],
    ]);
    expect(consultas.filter((c) => c.includes('lock_timeout'))).toHaveLength(4);
    expect(release).toHaveBeenCalledTimes(4);
    // Las sesiones que dejaron de valer se limpian con el plazo de acceso (90 días), por la función del dueño.
    expect(registrar.mock.calls[0]).toEqual(['SELECT fn_limpiar_sesiones($1) AS n', [90]]);
    // Borrar es destructivo: la corrida queda en la base, no solo en el log que vence.
    expect(registrar).toHaveBeenCalledTimes(2);
    const [sql, params] = registrar.mock.calls[1];
    expect(sql).toContain("'retencion'");
    expect(params?.[0]).toMatchObject({
      plazos_dias: { medicion: null, trama: 30, cuarentena: 30, acceso: 90 },
      fragmentos_borrados: { medicion: 'sin_limite', trama: 2, cuarentena: 0, acceso: 0, sesiones: 3 },
      fallos: 0,
    });
  });

  it('si se define RETENCION_MEDICION_DIAS, las mediciones también se recortan, cada tabla con su lock_timeout', async () => {
    const { servicio, query, consultas, release } = armar(undefined, { RETENCION_MEDICION_DIAS: '730' });
    await servicio.corridaSegura();
    expect(query.mock.calls.filter(([sql]) => String(sql).includes('drop_chunks')).map(([, p]) => p)).toEqual([
      ['medicion', 730], ['trama', 30], ['cuarentena', 30], ['metrica_broker', 90], ['acceso', 90],
    ]);
    expect(consultas.filter((c) => c.includes('lock_timeout'))).toHaveLength(5);
    expect(release).toHaveBeenCalledTimes(5);
  });

  it('al arrancar NO borra nada de inmediato: un proceso de corta vida (pnpm openapi) se cierra antes', async () => {
    jest.useFakeTimers();
    try {
      const corto = armar();
      corto.servicio.onModuleInit();
      corto.servicio.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(25 * 3600 * 1000);
      expect(corto.query).not.toHaveBeenCalled();

      const largo = armar();
      largo.servicio.onModuleInit();
      await jest.advanceTimersByTimeAsync(59_000);
      expect(largo.query).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1_000);
      expect(largo.consultas.filter((c) => c.includes('drop_chunks'))).toHaveLength(4);
      largo.servicio.onModuleDestroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('si una tabla falla (candado), las otras se recortan igual y la falla no tumba el proceso', async () => {
    const { servicio, query, release, registrar } = armar('trama');
    await expect(servicio.corridaSegura()).resolves.toBeUndefined();
    expect(query.mock.calls.filter(([sql]) => String(sql) === 'ROLLBACK')).toHaveLength(1);
    expect(query.mock.calls.filter(([, p]) => p?.[0] === 'cuarentena')).toHaveLength(1);
    expect(release).toHaveBeenCalledTimes(4);
    expect(registrar.mock.calls[1][1]?.[0]).toMatchObject({ fragmentos_borrados: { trama: 'error' }, fallos: 1 });
  });

  it('si la limpieza de sesiones falla, las tablas se recortan igual y la corrida cuenta la falla', async () => {
    const { servicio, query, registrar } = armar('sesiones');
    await expect(servicio.corridaSegura()).resolves.toBeUndefined();
    expect(query.mock.calls.filter(([sql]) => String(sql).includes('drop_chunks'))).toHaveLength(4);
    expect(registrar.mock.calls[1][1]?.[0]).toMatchObject({ fragmentos_borrados: { sesiones: 'error', acceso: 0 }, fallos: 1 });
  });
});
