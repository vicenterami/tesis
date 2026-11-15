import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module.js';
import { POOL, DbModule } from './db/db.module.js';
import { BrokerService } from './broker/broker.service.js';
import { DynsecService } from './broker/dynsec.service.js';
import { MetricasBrokerService } from './broker/metricas.service.js';
import { RecepcionService } from './recepcion/recepcion.service.js';
import { RetencionService } from './retencion/retencion.service.js';
import { SesionService } from './sesion/sesion.service.js';
import { SupervisionService } from './supervision/supervision.service.js';
import { EventosController } from './tiempo-real/eventos.controller.js';

// Orden de los ganchos de ciclo de vida con la aplicación completa (docs/16 §70). NestJS 12 llama a los ganchos «por nivel de la
// jerarquía de componentes» (guía de migración 11→12, «Lifecycle hook ordering»): dentro de cada fase puede cambiar quién va antes.
// Lo que este código necesita, y esta prueba fija, es lo que no cambia con eso: la base se cierra la última y todo lo que usa el
// pool (retención, supervisión, métricas del broker, flujos en vivo) termina antes. Sin base ni broker: un pool falso y el broker en
// un puerto sin servicio, de modo que ningún efecto sale del proceso.
const eventos: string[] = [];
const clases: [string, { prototype: object }][] = [
  ['DbModule', DbModule], ['BrokerService', BrokerService], ['DynsecService', DynsecService], ['MetricasBrokerService', MetricasBrokerService],
  ['RecepcionService', RecepcionService], ['RetencionService', RetencionService], ['SesionService', SesionService],
  ['SupervisionService', SupervisionService], ['EventosController', EventosController],
];
const GANCHOS = ['onModuleInit', 'onModuleDestroy', 'beforeApplicationShutdown', 'onApplicationShutdown'];
const originales = new Map<string, unknown>();

beforeAll(() => {
  for (const [nombre, clase] of clases) {
    const c = { prototype: clase.prototype as Record<string, unknown> };
    for (const g of GANCHOS) {
      const original = c.prototype[g];
      if (typeof original !== 'function') continue;
      originales.set(`${nombre}.${g}`, original);
      c.prototype[g] = async function (this: unknown, ...a: unknown[]) {
        eventos.push(`${nombre}.${g} inicio`);
        try {
          return await (original as (...x: unknown[]) => unknown).apply(this, a);
        } finally {
          eventos.push(`${nombre}.${g} fin`);
        }
      };
    }
  }
});
afterAll(() => {
  for (const [nombre, clase] of clases) {
    const proto = clase.prototype as Record<string, unknown>;
    for (const g of GANCHOS) if (originales.has(`${nombre}.${g}`)) proto[g] = originales.get(`${nombre}.${g}`);
  }
  vi.unstubAllEnvs();
});

describe('ciclo de vida de la aplicación completa', () => {
  it('la base se cierra la última; el supervisor y las métricas paran antes que el broker; cada gancho corre una vez', async () => {
    vi.stubEnv('MQTT_URL', 'mqtt://127.0.0.1:1'); // puerto sin servicio
    vi.stubEnv('MQTT_BACKEND_CLAVE', 'descarte-0123456789-abcdefgh');
    vi.stubEnv('MQTT_ADMIN_CLAVE', 'descarte-0123456789-abcdefgh');
    vi.stubEnv('DB_NOMBRE', 'descarte');
    vi.stubEnv('DB_APP_CLAVE', 'descarte-0123456789-abcdefgh');
    const pool = {
      query: () => Promise.resolve({ rows: [], rowCount: 0 }),
      end: () => { eventos.push('pool.end'); return Promise.resolve(); },
      on: () => undefined,
    };
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(POOL).useValue(pool).compile();
    const app = modulo.createNestApplication();
    app.enableShutdownHooks();
    await app.init();
    const tras = eventos.length;
    const inicio = eventos.slice(0, tras);
    await app.close();
    const cierre = eventos.slice(tras);

    const pos = (e: string): number => cierre.indexOf(e);
    // Cada gancho de cierre corre una sola vez.
    for (const e of cierre) expect(cierre.filter((x) => x === e), e).toHaveLength(1);
    // La base es lo último de todo.
    expect(cierre.at(-1)).toBe('DbModule.onApplicationShutdown fin');
    expect(pos('pool.end')).toBe(cierre.length - 2);
    // Todo lo que usa el pool, o el broker, terminó antes de que se cierre el pool.
    for (const e of ['RetencionService.onModuleDestroy fin', 'SupervisionService.onModuleDestroy fin', 'MetricasBrokerService.onModuleDestroy fin',
      'BrokerService.onModuleDestroy fin', 'DynsecService.onModuleDestroy fin', 'EventosController.beforeApplicationShutdown fin']) {
      expect(pos(e), e).toBeGreaterThanOrEqual(0);
      expect(pos(e), e).toBeLessThan(pos('DbModule.onApplicationShutdown inicio'));
    }
    // El orden que promete docs/10 §6 («detiene el supervisor, se desconecta del broker, cierra el pool»): el supervisor termina antes
    // de que el broker empiece a desconectarse.
    expect(pos('SupervisionService.onModuleDestroy fin')).toBeLessThan(pos('BrokerService.onModuleDestroy inicio'));
    // Lo que NestJS 12 reordenó dentro de cada fase (docs/16 §70): las métricas del broker dependen del broker, así que arrancan
    // después de él y se detienen antes de que él se desconecte.
    expect(pos('MetricasBrokerService.onModuleDestroy fin')).toBeLessThan(pos('BrokerService.onModuleDestroy inicio'));
    expect(inicio.indexOf('BrokerService.onModuleInit fin')).toBeGreaterThanOrEqual(0);
    expect(inicio.indexOf('MetricasBrokerService.onModuleInit inicio')).toBeGreaterThan(inicio.indexOf('BrokerService.onModuleInit fin'));
  });
});
