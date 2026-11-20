import { describe, expect, it, vi, type Mock } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { EventoPanel, EventosService } from '../tiempo-real/eventos.service.js';
import { SupervisionService, intervaloSupervision } from './supervision.service.js';

// La consulta de quien nunca reportó (docs/10 §8.4 punto 68) empieza igual que la de caídos: se distingue por el plazo del sitio.
const esNunca = (sql: string): boolean => sql.startsWith('SELECT d.id, d.id_fisico') && sql.includes('espera_primera_trama_h');
// Cada apertura de condición y su evento es UNA sentencia (CTE): ninguna llamada suelta `INSERT INTO condicion` ni `INSERT INTO evento`.
const esApertura = (sql: string): boolean => sql.startsWith('WITH abre AS');
const esCierreBarrido = (sql: string): boolean => sql.startsWith('WITH cierra AS') && sql.includes("'por', 'barrido'");
const esCierreMantenimiento = (sql: string): boolean => sql.startsWith('WITH cierra AS') && sql.includes("'por', 'mantenimiento'");

// El barrido corre en un temporizador, sin petición HTTP que atrape un rechazo (a diferencia del
// pipeline, docs/10 §4.1): una consulta que falla no debe tirar el proceso abajo (hallazgo 23/09/2026,
// visto al dockerizar y apagar la base: el proceso se caía y Docker lo reiniciaba en bucle).
describe('SupervisionService.barridoSeguro: una base caída no debe tumbar el proceso', () => {
  function armar(fallaConsulta: boolean) {
    const query = vi.fn(() =>
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
    const query = vi.fn((sql: string) => {
      const s = sql.trim();
      if (esNunca(s)) return Promise.resolve({ rows: [], rowCount: 0 }); // nadie que nunca haya reportado
      if (s.startsWith('SELECT d.id, d.id_fisico')) return Promise.resolve({ rows: [{ id: 'd1', id_fisico: 'dev-0001', silencio_s: 99 }], rowCount: 1 });
      if (esCierreBarrido(s) || esCierreMantenimiento(s)) return Promise.resolve({ rows: [], rowCount: 0 });
      if (s.startsWith('UPDATE condicion tc SET')) return Promise.resolve({ rows: [], rowCount: 0 }); // el cierre de tope_superado: nada que cerrar
      escrituras.push(s.split(/\s+/).slice(0, 3).join(' '));
      return Promise.resolve({ rows: [], rowCount: esApertura(s) ? 0 : 1 });
    });
    const eventos = new EventosService();
    const publicados: EventoPanel[] = [];
    eventos.flujo().subscribe((e) => publicados.push(e));
    const servicio = new SupervisionService({ query } as unknown as Pool, { get: () => 60 } as unknown as ConfigService, eventos);
    await expect(servicio.barrer()).resolves.toBeUndefined();
    expect(escrituras).toEqual(['WITH abre AS']); // la apertura es una sola sentencia: sin `INSERT INTO evento` aparte
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
  function armar(cierraAlMarcarVivo: boolean, topeDentro = false, nuncaReporto = false, enMantenimiento = false) {
    const query = vi.fn((sql: string, _params?: unknown[]) => {
      const s = sql.trim();
      if (esNunca(s)) return Promise.resolve(nuncaReporto ? { rows: [{ id: 'd4', id_fisico: 'dev-0004' }], rowCount: 1 } : { rows: [], rowCount: 0 });
      if (s.startsWith('SELECT d.id, d.id_fisico')) return Promise.resolve({ rows: [{ id: 'd1', id_fisico: 'dev-0001', silencio_s: 99 }], rowCount: 1 });
      if (esApertura(s)) return Promise.resolve(s.includes("'nunca_reporto'") ? { rows: [{ espera_h: 168 }], rowCount: 1 } : { rows: [{ silencio_s: 99 }], rowCount: 1 });
      if (esCierreBarrido(s)) return Promise.resolve({ rows: [{ id: 'd2', id_fisico: 'dev-0002', motivo: 'comunicación restablecida' }], rowCount: 1 });
      if (esCierreMantenimiento(s)) return Promise.resolve(enMantenimiento ? { rows: [{ id: 'd5', id_fisico: 'dev-0005', tipo: 'umbral' }], rowCount: 1 } : { rows: [], rowCount: 0 });
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
  it('quien nunca reportó y venció su plazo (docs/19 §2): la condición se abre con «nunca_reporto» en el evento, entre la de los caídos y el cierre', async () => {
    const { servicio, publicados, query } = armar(false, false, true);
    await servicio.barrer();
    expect(publicados).toEqual([evento('d1', 'abierta'), evento('d4', 'abierta'), evento('d2', 'cerrada')]);
    const llamadas = (query as Mock).mock.calls as [string, unknown[]][];
    const apertura = llamadas.find(([sql, params]) => esApertura(String(sql).trim()) && params[0] === 'd4');
    const sql = String(apertura?.[0]).replace(/\s+/g, ' ');
    // Una sola sentencia hace las dos cosas; vuelve a mirar que siga activo, sin fila de estado y con el plazo vencido, y el evento toma el
    // plazo y la fecha de lo que ve ESA sentencia (no de la búsqueda anterior, que puede estar vieja).
    expect(sql).toContain("INSERT INTO condicion");
    expect(sql).toContain("INSERT INTO evento");
    expect(sql).toContain("AND d.estado = 'activo' AND NOT EXISTS (SELECT 1 FROM estado_dispositivo e WHERE e.dispositivo_id = d.id) AND d.en_servicio_desde + s.espera_primera_trama_h * INTERVAL '1 hour' <= now()");
    expect(sql).toContain("'nunca_reporto', true, 'en_servicio_desde', iso_utc(d.en_servicio_desde), 'espera_primera_trama_h', s.espera_primera_trama_h");
    expect(llamadas.some(([q]) => String(q).trim().startsWith('INSERT INTO evento') || String(q).trim().startsWith('INSERT INTO condicion'))).toBe(false);
  });
  it('la condición y su evento de «sin comunicación» son UNA sentencia (si el proceso muere a mitad no queda una sin el otro)', async () => {
    const { servicio, query } = armar(false);
    await servicio.barrer();
    const llamadas = (query as Mock).mock.calls as [string, unknown[]][];
    const apertura = llamadas.find(([sql, params]) => esApertura(String(sql).trim()) && params[0] === 'd1');
    const sql = String(apertura?.[0]).replace(/\s+/g, ' ');
    expect(sql).toContain('INSERT INTO condicion');
    expect(sql).toContain("INSERT INTO evento");
    expect(sql).toContain("SELECT d.id, 'sin_comunicacion' FROM dispositivo d WHERE d.id = $1 AND d.estado = 'activo'"); // sigue activo (RF-22)
    expect(sql).toContain("'silencio_s', EXTRACT(EPOCH FROM now() - greatest(e.visto_por_ultima_vez, d.en_servicio_desde))::int");
    expect(llamadas.filter(([q]) => /^\s*INSERT INTO (condicion|evento)/.test(String(q)))).toEqual([]);
  });
  it('la red de seguridad deja su evento al cerrar (antes no lo dejaba) y cuenta el silencio desde el más reciente entre la última trama y en_servicio_desde', async () => {
    const { servicio, query } = armar(false);
    await servicio.barrer();
    const llamadas = (query as Mock).mock.calls as [string, unknown[]][];
    // El cierre y su evento son una sola sentencia, y el evento dice POR QUÉ cerró (los tres motivos de siempre, antes solo en el registro).
    const cierre = llamadas.find(([sql]) => esCierreBarrido(String(sql).trim()));
    const sqlCierre = String(cierre?.[0]).replace(/\s+/g, ' ');
    expect(sqlCierre).toContain("INSERT INTO evento");
    expect(sqlCierre).toContain("c.cerrada_en IS NULL AND d.estado = 'activo'"); // los de mantenimiento los cierra solo el paso (4), con su motivo
    expect(sqlCierre).toContain("jsonb_build_object('tipo', 'sin_comunicacion', 'por', 'barrido', 'motivo', motivo)");
    expect(cierre?.[1]).toEqual(['de vuelta dentro del plazo de la primera trama', 'comunicación restablecida', 'de vuelta en servicio (otra vez un intervalo completo)']);
    const caidos = llamadas.find(([sql]) => String(sql).trim().startsWith('SELECT d.id, d.id_fisico') && !esNunca(String(sql).trim()));
    expect(String(caidos?.[0]).replace(/\s+/g, ' ')).toContain("greatest(e.visto_por_ultima_vez, d.en_servicio_desde) < now() - (d.intervalo_esperado_s * 2) * INTERVAL '1 second'");
  });
  it('el barrido cierra una tope_superado cuando la fila de estado ya muestra una hora nueva dentro del presupuesto (docs/10 §8.4 punto 53) → evento y aviso', async () => {
    const { servicio, publicados, query } = armar(false, true);
    await servicio.barrer();
    expect(publicados[2]).toEqual({ tipo: 'condicion', dispositivo_id: 'd3', condicion: 'tope_superado', estado: 'cerrada' });
    const llamadas = (query as Mock).mock.calls as [string, unknown[]][];
    const cierre = llamadas.find(([sql, params]) => String(sql).startsWith('INSERT INTO evento') && params[0] === 'd3');
    expect(cierre?.[1][1]).toEqual({ tipo: 'tope_superado', por: 'barrido' });
  });

  it('red de seguridad de mantenimiento (RF-22): cierra TODA condición abierta de un equipo en mantenimiento, con su evento en la misma sentencia, y avisa al panel', async () => {
    const { servicio, publicados, query } = armar(false, false, false, true);
    await servicio.barrer();
    expect(publicados).toContainEqual({ tipo: 'condicion', dispositivo_id: 'd5', condicion: 'umbral', estado: 'cerrada' });
    const llamadas = (query as Mock).mock.calls as [string, unknown[]][];
    const cierre = llamadas.find(([sql]) => esCierreMantenimiento(String(sql).trim()));
    const sql = String(cierre?.[0]).replace(/\s+/g, ' ');
    expect(sql).toContain("d.estado = 'mantenimiento' AND c.cerrada_en IS NULL");
    expect(sql).not.toContain('c.tipo ='); // todas, de cualquier tipo, como la baja
    expect(sql).toContain("INSERT INTO evento");
    const sin = armar(false);
    await sin.servicio.barrer();
    expect(sin.publicados.some((e) => e.tipo === 'condicion' && e.dispositivo_id === 'd5')).toBe(false);
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
    const query = vi.fn((sql: string, _params?: unknown[]) =>
      Promise.resolve({ rows: [], rowCount: /^\s*(INSERT INTO condicion|UPDATE condicion|WITH abre AS)/.test(sql) ? filasCondicion : 1 }));
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
    // Una sola sentencia (condición y evento) y solo para un equipo activo: en mantenimiento no se abre nada (RF-22).
    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0][0]).replace(/\s+/g, ' ');
    expect(sql).toContain("SELECT d.id, 'reloj_desviado' FROM dispositivo d WHERE d.id = $1 AND d.estado = 'activo'");
    expect(sql).toContain("INSERT INTO evento");
    expect(sql).toContain("'condicion_abierta'");
    expect(query.mock.calls[0][1]).toEqual(['n1', { tipo: 'reloj_desviado', ...DETALLE }]);
    expect(publicados).toEqual([{ tipo: 'condicion', dispositivo_id: 'n1', condicion: 'reloj_desviado', estado: 'abierta' }]);
  });
  it('abrir con una ya abierta (el índice único devuelve 0 filas) → sin evento ni aviso repetidos', async () => {
    const { servicio, query, publicados } = armar(0);
    await servicio.abrirRelojDesviado('n1', '0101010101010101', DETALLE);
    expect(query).toHaveBeenCalledTimes(1);
    expect(publicados).toEqual([]);
  });
  it('tope_superado: la misma guarda (solo equipo activo) y una sola sentencia con su evento; sin filas, ni aviso', async () => {
    const { servicio, query, publicados } = armar(1);
    await servicio.abrirTope('n1', '0101010101010101', { tope: 600 });
    const sql = String(query.mock.calls[0][0]).replace(/\s+/g, ' ');
    expect(query).toHaveBeenCalledTimes(1);
    expect(sql).toContain("SELECT d.id, 'tope_superado' FROM dispositivo d WHERE d.id = $1 AND d.estado = 'activo'");
    expect(sql).toContain('INSERT INTO evento');
    expect(query.mock.calls[0][1]).toEqual(['n1', { tipo: 'tope_superado', tope: 600 }]);
    expect(publicados).toEqual([{ tipo: 'condicion', dispositivo_id: 'n1', condicion: 'tope_superado', estado: 'abierta' }]);
    const mant = armar(0); // equipo en mantenimiento: la sentencia no inserta nada
    await mant.servicio.abrirTope('n1', '0101010101010101', { tope: 600 });
    expect(mant.publicados).toEqual([]);
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

// SUPERVISION_INTERVALO_S (docs/10 §4.1; 20/11/2026): ausente → 60; un entero de 1 a 3600; todo lo demás detiene el arranque.
describe('intervaloSupervision: el período del barrido, 1–3600 s, 60 por defecto', () => {
  const MENSAJE = /^SUPERVISION_INTERVALO_S=".*" no es válido: se espera un entero de segundos entre 1 y 3600 \(por defecto 60\)$/;
  it('ausente → 60', () => expect(intervaloSupervision(undefined)).toBe(60));
  it('un entero entre 1 y 3600 se respeta (también con espacios, y el número que entrega una configuración ya convertida)', () => {
    expect(intervaloSupervision('1')).toBe(1);
    expect(intervaloSupervision(' 5 ')).toBe(5);
    expect(intervaloSupervision('3600')).toBe(3600);
    expect(intervaloSupervision(60)).toBe(60);
  });
  it('vacía, con decimales, negativa, cero, mayor que 3600 o con texto → el arranque se detiene con un mensaje que dice qué se espera', () => {
    for (const malo of ['', ' ', '1.5', '-5', '0', '3601', 'sesenta', '60s', '1e2', 'NaN']) expect(() => intervaloSupervision(malo)).toThrow(MENSAJE);
  });
  it('el servicio la valida al construirse: un valor vacío no llega a programar un barrido sin pausa', () => {
    const config = { get: () => '' } as unknown as ConfigService;
    expect(() => new SupervisionService({ query: vi.fn() } as unknown as Pool, config, new EventosService())).toThrow(MENSAJE);
  });
  it('y con el valor por defecto programa el barrido cada 60 s', () => {
    vi.useFakeTimers();
    try {
      const espiar = vi.spyOn(globalThis, 'setInterval');
      const servicio = new SupervisionService({ query: vi.fn() } as unknown as Pool, { get: () => undefined } as unknown as ConfigService, new EventosService());
      servicio.onModuleInit();
      expect(espiar).toHaveBeenCalledWith(expect.any(Function), 60_000);
      servicio.onModuleDestroy();
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});
