import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { EventoPanel, EventosService } from '../tiempo-real/eventos.service';
import { SupervisionService } from './supervision.service';

// El barrido corre en un temporizador, sin petición HTTP que atrape un rechazo (a diferencia del
// pipeline, docs/10 §4.1): una consulta que falla no debe tirar el proceso abajo (hallazgo 23/09/2026,
// visto al dockerizar y apagar la base: el proceso se caía y Docker lo reiniciaba en bucle).
describe('SupervisionService.barridoSeguro: una base caída no debe tumbar el proceso', () => {
  function armar(fallaConsulta: boolean) {
    const query = jest.fn(() =>
      fallaConsulta ? Promise.reject(new Error('getaddrinfo EAI_AGAIN timescaledb')) : Promise.resolve({ rows: [] }),
    );
    const pool = { query } as unknown as Pool;
    const config = { get: () => 60 } as unknown as ConfigService;
    return new SupervisionService(pool, config, new EventosService());
  }

  it('la base caída: barridoSeguro NO rechaza (el temporizador puede seguir llamándolo)', async () => {
    const servicio = armar(true);
    await expect(servicio.barridoSeguro()).resolves.toBeUndefined();
  });

  it('la base caída: barrer() SÍ rechaza (el error es real, solo se atrapa un nivel más arriba)', async () => {
    const conFalla = armar(true);
    await expect(conFalla.barrer()).rejects.toThrow('EAI_AGAIN');
  });

  // Misma guarda que en alertas (07/10): si otro barrido abrió la condición entre el SELECT y el INSERT, la base
  // devuelve 0 filas; no hay error ni evento «condicion_abierta» repetido.
  it('carrera entre barridos: la condición ya estaba abierta (INSERT devuelve 0 filas) → sin evento repetido', async () => {
    const escrituras: string[] = [];
    const query = jest.fn((sql: string) => {
      const s = sql.trim();
      if (s.startsWith('SELECT d.id, d.id_fisico')) return Promise.resolve({ rows: [{ id: 'd1', id_fisico: 'dev-0001', silencio_s: 99 }], rowCount: 1 });
      if (s.startsWith('UPDATE condicion c SET')) return Promise.resolve({ rows: [], rowCount: 0 });
      if (s.startsWith('UPDATE condicion tc SET')) return Promise.resolve({ rows: [], rowCount: 0 }); // el cierre de tope_superado: nada que cerrar
      escrituras.push(s.split(/\s+/).slice(0, 3).join(' '));
      return Promise.resolve({ rows: [], rowCount: s.startsWith('INSERT INTO condicion') ? 0 : 1 });
    });
    const eventos = new EventosService();
    const publicados: EventoPanel[] = [];
    eventos.flujo().subscribe((e) => publicados.push(e));
    const servicio = new SupervisionService({ query } as unknown as Pool, { get: () => 60 } as unknown as ConfigService, eventos);
    await expect(servicio.barrer()).resolves.toBeUndefined();
    expect(escrituras).toEqual(['INSERT INTO condicion']);
    expect(publicados).toEqual([]); // tampoco un aviso repetido al panel
  });

  it('base sana: barridoSeguro no rechaza', async () => {
    const servicio = armar(false);
    await expect(servicio.barridoSeguro()).resolves.toBeUndefined();
  });
});

// TT-39: el panel se entera de cada condición «sin comunicación» que se abre o se cierra, después de escribirla.
describe('SupervisionService: avisa al panel en vivo (TT-39)', () => {
  const evento = (dispositivo_id: string, estado: 'abierta' | 'cerrada'): EventoPanel =>
    ({ tipo: 'condicion', dispositivo_id, condicion: 'sin_comunicacion', estado });

  // topeDentro: un dispositivo cuya fila de estado ya muestra una hora nueva dentro del presupuesto con la condición tope_superado abierta.
  function armar(cierraAlMarcarVivo: boolean, topeDentro = false) {
    const query = jest.fn((sql: string) => {
      const s = sql.trim();
      if (s.startsWith('SELECT d.id, d.id_fisico')) return Promise.resolve({ rows: [{ id: 'd1', id_fisico: 'dev-0001', silencio_s: 99 }], rowCount: 1 });
      if (s.startsWith('UPDATE condicion c SET')) return Promise.resolve({ rows: [{ id: 'd2', id_fisico: 'dev-0002' }], rowCount: 1 });
      if (s.startsWith('UPDATE condicion tc SET')) return Promise.resolve(topeDentro ? { rows: [{ id: 'd3', id_fisico: 'dev-0003' }], rowCount: 1 } : { rows: [], rowCount: 0 });
      if (s.startsWith('UPDATE condicion SET')) return Promise.resolve({ rows: [], rowCount: cierraAlMarcarVivo ? 1 : 0 });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const eventos = new EventosService();
    const publicados: EventoPanel[] = [];
    eventos.flujo().subscribe((e) => publicados.push(e));
    const servicio = new SupervisionService({ query } as unknown as Pool, { get: () => 60 } as unknown as ConfigService, eventos);
    return { servicio, publicados, query };
  }

  it('el barrido abre la de uno y cierra la de otro (red de seguridad) → dos avisos, en ese orden', async () => {
    const { servicio, publicados } = armar(false);
    await servicio.barrer();
    expect(publicados).toEqual([evento('d1', 'abierta'), evento('d2', 'cerrada')]);
  });
  it('el barrido cierra una tope_superado cuando la fila de estado ya muestra una hora nueva dentro del presupuesto (docs/10 §8.4 punto 53) → evento y aviso', async () => {
    const { servicio, publicados, query } = armar(false, true);
    await servicio.barrer();
    expect(publicados[2]).toEqual({ tipo: 'condicion', dispositivo_id: 'd3', condicion: 'tope_superado', estado: 'cerrada' });
    const llamadas = (query as jest.Mock).mock.calls as [string, unknown[]][];
    const cierre = llamadas.find(([sql, params]) => String(sql).startsWith('INSERT INTO evento') && params[0] === 'd3');
    expect(cierre?.[1][1]).toEqual({ tipo: 'tope_superado', por: 'barrido' });
  });

  it('marcarVivo: si cerró una condición avisa; si no había ninguna abierta, calla', async () => {
    const cierra = armar(true);
    await cierra.servicio.marcarVivo('d1', 'dev-0001');
    expect(cierra.publicados).toEqual([evento('d1', 'cerrada')]);
    const nada = armar(false);
    await nada.servicio.marcarVivo('d1', 'dev-0001');
    expect(nada.publicados).toEqual([]);
  });
});

// Reloj de la pasarela desviado (docs/10 §8.4 punto 54): la abre y la cierra el pipeline; escribe y avisa solo en la transición.
describe('SupervisionService: condición reloj_desviado', () => {
  function armar(filasCondicion: number) {
    const query = jest.fn((sql: string, _params?: unknown[]) =>
      Promise.resolve({ rows: [], rowCount: /^\s*(INSERT INTO condicion|UPDATE condicion)/.test(sql) ? filasCondicion : 1 }));
    const eventos = new EventosService();
    const publicados: EventoPanel[] = [];
    eventos.flujo().subscribe((e) => publicados.push(e));
    const servicio = new SupervisionService({ query } as unknown as Pool, { get: () => 60 } as unknown as ConfigService, eventos);
    return { servicio, query, publicados };
  }
  const DETALLE = { pasarela: 'ug65-campus', desvio_s: -345600, marca_pasarela: '2026-10-16T15:00:00.000Z' };

  it('abrir: inserta la condición, anota el evento con pasarela, desvío y marca, y avisa al panel', async () => {
    const { servicio, query, publicados } = armar(1);
    await servicio.abrirRelojDesviado('n1', '0101010101010101', DETALLE);
    expect(String(query.mock.calls[0][0])).toContain("VALUES ($1, 'reloj_desviado')");
    expect(query.mock.calls[1][1]).toEqual(['n1', { tipo: 'reloj_desviado', ...DETALLE }]);
    expect(String(query.mock.calls[1][0])).toContain("'condicion_abierta'");
    expect(publicados).toEqual([{ tipo: 'condicion', dispositivo_id: 'n1', condicion: 'reloj_desviado', estado: 'abierta' }]);
  });
  it('abrir con una ya abierta (el índice único devuelve 0 filas) → sin evento ni aviso repetidos', async () => {
    const { servicio, query, publicados } = armar(0);
    await servicio.abrirRelojDesviado('n1', '0101010101010101', DETALLE);
    expect(query).toHaveBeenCalledTimes(1);
    expect(publicados).toEqual([]);
  });
  it('cerrar: actualiza la abierta, anota condicion_cerrada y avisa; sin ninguna abierta, calla', async () => {
    const { servicio, query, publicados } = armar(1);
    await servicio.cerrarRelojDesviado('n1', '0101010101010101', { pasarela: 'ug65-campus' });
    expect(String(query.mock.calls[0][0])).toContain("tipo = 'reloj_desviado' AND cerrada_en IS NULL");
    expect(query.mock.calls[1][1]).toEqual(['n1', { tipo: 'reloj_desviado', pasarela: 'ug65-campus' }]);
    expect(publicados).toEqual([{ tipo: 'condicion', dispositivo_id: 'n1', condicion: 'reloj_desviado', estado: 'cerrada' }]);
    const nada = armar(0);
    await nada.servicio.cerrarRelojDesviado('n1', '0101010101010101', { pasarela: 'ug65-campus' });
    expect(nada.query).toHaveBeenCalledTimes(1);
    expect(nada.publicados).toEqual([]);
  });
});
