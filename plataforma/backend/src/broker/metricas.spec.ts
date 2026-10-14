import type { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';
import { EventoPanel, EventosService } from '../tiempo-real/eventos.service';
import type { DynsecService } from './dynsec.service';
import { Contador, Muestra, armarMuestra, evaluar, valorSys } from './metricas';
import { MetricasBrokerService } from './metricas.service';

const muestra = (extra: Partial<Muestra> = {}): Muestra => ({
  tiempo: new Date('2026-10-13T22:00:00Z'), mensajes_descartados: 0, mensajes_en_cola: 0, bytes_en_cola: 0, clientes_conectados: 3, memoria_bytes: null, ...extra,
});

describe('métricas del broker: lectura de $SYS y regla de la alarma (docs/10 §8.4 punto 43)', () => {
  it('valorSys acepta solo un entero en texto', () => {
    expect(valorSys('42')).toBe(42);
    expect(valorSys(' 7\n')).toBe(7);
    expect(valorSys('')).toBeNull();
    expect(valorSys('-1')).toBeNull();
    expect(valorSys('1.5')).toBeNull();
    expect(valorSys('abc')).toBeNull();
  });

  it('armarMuestra exige los cuatro contadores obligatorios; la memoria es opcional', () => {
    const u = new Map<Contador, number>([['mensajes_descartados', 1], ['mensajes_en_cola', 2], ['bytes_en_cola', 3]]);
    expect(armarMuestra(u, new Date())).toBeNull();
    u.set('clientes_conectados', 4);
    expect(armarMuestra(u, new Date('2026-10-13T22:00:00Z'))).toEqual(muestra({ mensajes_descartados: 1, mensajes_en_cola: 2, bytes_en_cola: 3, clientes_conectados: 4 }));
    u.set('memoria_bytes', 5);
    expect(armarMuestra(u, new Date())?.memoria_bytes).toBe(5);
  });

  it('evaluar: descartes que crecen → anormal; cola al 80 % del tope → anormal; contador que baja (broker reiniciado) → no', () => {
    expect(evaluar(muestra(), muestra({ mensajes_descartados: 5 }), 10000)).toMatchObject({ anormal: true, motivos: ['descartes'], descartes_delta: 5 });
    expect(evaluar(muestra({ mensajes_descartados: 5 }), muestra({ mensajes_descartados: 5 }), 10000)).toMatchObject({ anormal: false, motivos: [], descartes_delta: 0 });
    expect(evaluar(muestra(), muestra({ mensajes_en_cola: 8000 }), 10000)).toMatchObject({ anormal: true, motivos: ['cola_alta'], umbral_cola: 8000 });
    expect(evaluar(muestra(), muestra({ mensajes_en_cola: 7999 }), 10000).anormal).toBe(false);
    expect(evaluar(muestra({ mensajes_descartados: 900 }), muestra({ mensajes_descartados: 3 }), 10000)).toMatchObject({ anormal: false, descartes_delta: 0 });
    expect(evaluar(null, muestra({ mensajes_descartados: 50 }), 10000).anormal).toBe(false); // sin anterior solo cuenta la cola
    expect(evaluar(muestra(), muestra({ mensajes_descartados: 1, mensajes_en_cola: 9000 }), 10000).motivos).toEqual(['descartes', 'cola_alta']);
  });
});

// Servicio con base, broker y bus falsos: cada consulta se registra; el broker entrega los contadores que diga la prueba.
function armar(opciones: { contadores?: Partial<Record<Contador, number>>; ultimaGuardada?: Muestra | null; abiertaEnBase?: boolean; tope?: string } = {}) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const pool = {
    query: async (texto: string, p: unknown[] = []) => {
      await Promise.resolve();
      sql.push(texto);
      params.push(p);
      if (texto.startsWith('SELECT tiempo, mensajes_descartados')) return { rows: opciones.ultimaGuardada ? [opciones.ultimaGuardada] : [] };
      if (texto.startsWith('SELECT id FROM condicion_sistema')) return { rows: opciones.abiertaEnBase ? [{ id: 'CS-viejo' }] : [] };
      if (texto.startsWith('INSERT INTO condicion_sistema')) return { rows: [{ id: 'CS1' }] };
      return { rows: [], rowCount: 1 };
    },
  } as unknown as Pool;
  const contadores = new Map<Contador, number>(Object.entries({ mensajes_descartados: 0, mensajes_en_cola: 0, bytes_en_cola: 0, clientes_conectados: 2, ...opciones.contadores }) as [Contador, number][]);
  const dynsec = { conectado: true, disponible: true, contadores: () => new Map(contadores) } as unknown as DynsecService;
  const eventos = new EventosService();
  const emitidos: EventoPanel[] = [];
  eventos.flujo().subscribe((e) => emitidos.push(e));
  const config = { get: (k: string) => (k === 'METRICA_BROKER_COLA_TOPE' ? opciones.tope : undefined) } as unknown as ConfigService;
  const servicio = new MetricasBrokerService(pool, dynsec, eventos, config);
  return { servicio, sql, params, contadores, emitidos };
}

describe('MetricasBrokerService: muestra, abre con descartes, cierra tras dos muestras normales, recupera el estado al arrancar', () => {
  it('guarda la muestra; con descartes nuevos abre la condición, registra el evento y lo anuncia por el canal en vivo', async () => {
    const { servicio, sql, params, contadores, emitidos } = armar();
    expect(await servicio.muestrear(new Date('2026-10-13T22:00:00Z'))).toMatchObject({ anormal: false });
    expect(sql.filter((s) => s.startsWith('INSERT INTO metrica_broker'))).toHaveLength(1);
    expect(sql.some((s) => s.startsWith('INSERT INTO condicion_sistema'))).toBe(false);
    contadores.set('mensajes_descartados', 120);
    const ev = await servicio.muestrear(new Date('2026-10-13T22:01:00Z'));
    expect(ev).toMatchObject({ anormal: true, motivos: ['descartes'], descartes_delta: 120 });
    expect(sql.some((s) => s.startsWith('INSERT INTO condicion_sistema'))).toBe(true);
    const evento = params[sql.findIndex((s) => s.startsWith('INSERT INTO evento'))][0] as string;
    expect(JSON.parse(evento)).toMatchObject({ tipo: 'broker_descarte', motivos: ['descartes'], descartes_delta: 120, tope: 10000 });
    expect(emitidos).toEqual([{ tipo: 'sistema', condicion: 'broker_descarte', estado: 'abierta', motivos: ['descartes'], mensajes_en_cola: 0, descartes_delta: 120 }]);
    expect(servicio.estado()).toMatchObject({ condicion_abierta: 'broker_descarte', mensajes_descartados: 120, cola_tope: 10000, conectado: true });
    // sigue anormal: no abre otra; una muestra normal no cierra; la segunda normal sí
    contadores.set('mensajes_descartados', 130);
    await servicio.muestrear(new Date('2026-10-13T22:02:00Z'));
    expect(sql.filter((s) => s.startsWith('INSERT INTO condicion_sistema'))).toHaveLength(1);
    await servicio.muestrear(new Date('2026-10-13T22:03:00Z'));
    expect(sql.some((s) => s.startsWith('UPDATE condicion_sistema'))).toBe(false);
    await servicio.muestrear(new Date('2026-10-13T22:04:00Z'));
    expect(sql.some((s) => s.startsWith('UPDATE condicion_sistema SET cerrada_en'))).toBe(true);
    expect(emitidos.at(-1)).toMatchObject({ tipo: 'sistema', estado: 'cerrada' });
    expect(servicio.estado().condicion_abierta).toBeNull();
  });

  it('cola al 80 % del tope (configurable) abre con motivo cola_alta aunque no haya descartes', async () => {
    const { servicio, contadores, emitidos } = armar({ tope: '1000', contadores: { mensajes_en_cola: 800 } });
    expect(servicio.tope).toBe(1000);
    contadores.set('mensajes_en_cola', 800);
    expect(await servicio.muestrear(new Date())).toMatchObject({ anormal: true, motivos: ['cola_alta'], umbral_cola: 800 });
    expect(emitidos[0]).toMatchObject({ estado: 'abierta', motivos: ['cola_alta'], mensajes_en_cola: 800 });
  });

  it('al arrancar compara con la última muestra guardada (descartes mientras el backend estaba caído) y retoma la condición abierta', async () => {
    const guardada = muestra({ tiempo: new Date('2026-10-13T21:50:00Z'), mensajes_descartados: 40 });
    const a = armar({ ultimaGuardada: guardada, contadores: { mensajes_descartados: 2000 } });
    expect(await a.servicio.muestrear(new Date())).toMatchObject({ anormal: true, descartes_delta: 1960 });
    const b = armar({ ultimaGuardada: guardada, abiertaEnBase: true, contadores: { mensajes_descartados: 40 } });
    await b.servicio.muestrear(new Date());
    expect(b.servicio.estado().condicion_abierta).toBe('broker_descarte'); // la retomó, sin abrir otra
    expect(b.sql.some((s) => s.startsWith('INSERT INTO condicion_sistema'))).toBe(false);
  });

  it('sin contadores (recién conectado) no guarda nada ni evalúa; un tope inválido impide arrancar', async () => {
    const { servicio, sql } = armar({ contadores: { mensajes_descartados: undefined as unknown as number } });
    const dynsecVacio = { conectado: true, disponible: true, contadores: () => new Map() } as unknown as DynsecService;
    const s2 = new MetricasBrokerService({ query: () => Promise.resolve({ rows: [] }) } as unknown as Pool, dynsecVacio, new EventosService(), { get: () => undefined } as unknown as ConfigService);
    expect(await s2.muestrear(new Date())).toBeNull();
    expect(sql).toHaveLength(0);
    expect(servicio.estado().ultima_muestra).toBeNull();
    expect(() => armar({ tope: '0' })).toThrow(/METRICA_BROKER_COLA_TOPE/);
    const desconectado = { conectado: false, disponible: false, contadores: () => new Map([['mensajes_descartados', 9], ['mensajes_en_cola', 0], ['bytes_en_cola', 0], ['clientes_conectados', 1]]) } as unknown as DynsecService;
    const s3 = new MetricasBrokerService({ query: () => Promise.reject(new Error('no debía consultar')) } as unknown as Pool, desconectado, new EventosService(), { get: () => undefined } as unknown as ConfigService);
    expect(await s3.muestrear(new Date())).toBeNull(); // contadores viejos con el broker caído: ni se guardan ni se evalúan
  });
});
