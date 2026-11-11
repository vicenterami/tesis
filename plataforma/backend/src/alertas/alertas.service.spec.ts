import { describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { EventoPanel, EventosService } from '../tiempo-real/eventos.service.js';
import { AlertasService, decidirUmbral, marcaVigente } from './alertas.service.js';

// Histéresis (docs/10 §4, RF-36): con umbral alto 30 e histéresis 2, la condición abre al superar 30 y
// cierra solo por debajo de 28. Entre 28 y 30 no pasa nada: ni abre ni cierra. Sin esto, un valor que
// oscila alrededor del umbral abriría y cerraría alertas sin parar.
describe('AlertasService.evaluar: umbral con histéresis', () => {
  const regla = { id: 'r1', umbral_alto: 30, umbral_bajo: null, histeresis: 2 };
  // Lo que se anuncia al panel en vivo (TT-39): solo lo que ya quedó escrito.
  const ABIERTA: EventoPanel = { tipo: 'condicion', dispositivo_id: 'd1', condicion: 'umbral', estado: 'abierta' };
  const CERRADA: EventoPanel = { ...ABIERTA, estado: 'cerrada' };
  function capturar() {
    const eventos = new EventosService();
    const publicados: EventoPanel[] = [];
    eventos.flujo().subscribe((e) => publicados.push(e));
    return { eventos, publicados };
  }

  function armar(abierta: boolean) {
    const escrituras: string[] = [];
    const query = vi.fn((sql: string) => {
      if (sql.startsWith('SELECT id, umbral_alto')) return Promise.resolve({ rows: [regla], rowCount: 1 });
      if (sql.startsWith('SELECT id FROM condicion')) return Promise.resolve({ rows: abierta ? [{ id: 'c1' }] : [], rowCount: abierta ? 1 : 0 });
      escrituras.push(sql.trim().split(/\s+/).slice(0, 3).join(' ')); // "INSERT INTO condicion", "UPDATE condicion SET", …
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const { eventos, publicados } = capturar();
    return { servicio: new AlertasService({ query } as unknown as Pool, eventos), escrituras, publicados };
  }

  it('35 Cel sin condición abierta → abre la condición y registra el evento', async () => {
    const { servicio, escrituras, publicados } = armar(false);
    await servicio.evaluar('d1', 'k1', 'dev-0001', 35, 'Cel');
    expect(escrituras.some((e) => e.startsWith('INSERT INTO condicion'))).toBe(true);
    expect(escrituras.some((e) => e.startsWith('INSERT INTO evento'))).toBe(true);
    expect(publicados).toEqual([ABIERTA]);
  });

  it('29 Cel con la condición abierta → zona de histéresis: no escribe nada', async () => {
    const { servicio, escrituras, publicados } = armar(true);
    await servicio.evaluar('d1', 'k1', 'dev-0001', 29, 'Cel');
    expect(escrituras).toEqual([]);
    expect(publicados).toEqual([]);
  });

  it('27 Cel con la condición abierta → la cierra', async () => {
    const { servicio, escrituras, publicados } = armar(true);
    await servicio.evaluar('d1', 'k1', 'dev-0001', 27, 'Cel');
    expect(escrituras.some((e) => e.startsWith('UPDATE condicion'))).toBe(true);
    expect(publicados).toEqual([CERRADA]);
  });

  // Prueba de carrera del 07/10 (banco): dos lecturas sobre el umbral llegan a la vez; las dos ven «ninguna abierta»
  // y las dos intentan abrir. La guarda es el índice único parcial: el INSERT con ON CONFLICT devuelve 0 filas a la
  // segunda, que debe seguir sin error (antes rompía con 23505 y abortaba el pipeline a mitad) y sin evento repetido.
  it('carrera: otra trama abrió la condición entre el SELECT y el INSERT → sin error ni evento repetido', async () => {
    const escrituras: string[] = [];
    const query = vi.fn((sql: string) => {
      if (sql.startsWith('SELECT id, umbral_alto')) return Promise.resolve({ rows: [regla], rowCount: 1 });
      if (sql.startsWith('SELECT id FROM condicion')) return Promise.resolve({ rows: [], rowCount: 0 });
      escrituras.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      return Promise.resolve({ rows: [], rowCount: sql.trim().startsWith('INSERT INTO condicion') ? 0 : 1 });
    });
    const { eventos, publicados } = capturar();
    const servicio = new AlertasService({ query } as unknown as Pool, eventos);
    await expect(servicio.evaluar('d1', 'k1', 'dev-0001', 35, 'Cel')).resolves.toBeUndefined();
    expect(escrituras).toEqual(['INSERT INTO condicion']);
    expect(publicados).toEqual([]); // la abrió la otra trama: el aviso ya salió desde allá
    const insercion = query.mock.calls.map(([sql]) => String(sql)).find((s) => s.includes('INSERT INTO condicion'));
    expect(insercion).toMatch(/ON CONFLICT[\s\S]*WHERE cerrada_en IS NULL DO NOTHING/);
  });

  it('carrera al cerrar: otra trama la cerró entre el SELECT y el UPDATE → no mueve la hora de cierre ni repite evento ni aviso', async () => {
    const escrituras: string[] = [];
    const query = vi.fn((sql: string) => {
      if (sql.startsWith('SELECT id, umbral_alto')) return Promise.resolve({ rows: [regla], rowCount: 1 });
      if (sql.startsWith('SELECT id FROM condicion')) return Promise.resolve({ rows: [{ id: 'c1' }], rowCount: 1 });
      escrituras.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      return Promise.resolve({ rows: [], rowCount: sql.trim().startsWith('UPDATE condicion') ? 0 : 1 });
    });
    const { eventos, publicados } = capturar();
    const servicio = new AlertasService({ query } as unknown as Pool, eventos);
    await servicio.evaluar('d1', 'k1', 'dev-0001', 27, 'Cel');
    expect(escrituras).toEqual(['UPDATE condicion SET']);
    const cierre = query.mock.calls.map(([sql]) => String(sql)).find((s) => s.startsWith('UPDATE condicion'));
    expect(cierre).toContain('AND cerrada_en IS NULL');
    expect(publicados).toEqual([]);
  });

  it('RF-22: en mantenimiento un cruce de umbral NO abre condición, pero una abierta sí se cierra al volver a rango', async () => {
    const sinAbrir = armar(false);
    await sinAbrir.servicio.evaluar('d1', 'k1', 'dev-0001', 35, 'Cel', true);
    expect(sinAbrir.escrituras).toEqual([]);
    const cierra = armar(true);
    await cierra.servicio.evaluar('d1', 'k1', 'dev-0001', 27, 'Cel', true);
    expect(cierra.escrituras.some((e) => e.startsWith('UPDATE condicion'))).toBe(true);
  });

  it('35 Cel con la condición YA abierta → no la abre dos veces', async () => {
    const { servicio, escrituras } = armar(true);
    await servicio.evaluar('d1', 'k1', 'dev-0001', 35, 'Cel');
    expect(escrituras.filter((e) => e.startsWith('INSERT INTO condicion'))).toEqual([]);
  });

  it('25 Cel sin condición abierta → dentro de rango, no escribe nada', async () => {
    const { servicio, escrituras } = armar(false);
    await servicio.evaluar('d1', 'k1', 'dev-0001', 25, 'Cel');
    expect(escrituras).toEqual([]);
  });
});

// Retardo de activación (RF-14; docs/10 §8.4 punto 65 vi): la condición se abre solo cuando la medición lleva al menos `retardo_s` fuera
// de la banda, contado desde `fuera_de_banda_desde` (en la base). En los dos sentidos: lo que debe abrir y lo que debe esperar.
describe('decidirUmbral: retardo de activación', () => {
  const ahora = new Date('2026-11-11T12:00:00Z');
  const hace = (s: number): Date => new Date(ahora.getTime() - s * 1000);
  const base = { umbral_alto: 30, umbral_bajo: null, histeresis: 2, retardo_s: 60, fuera_de_banda_desde: null as Date | null };

  it('retardo 0: abre con la primera lectura que cruza (como antes)', () => {
    expect(decidirUmbral({ ...base, retardo_s: 0 }, 35, false, ahora)).toBe('abrir');
  });
  it('retardo 60 y primera lectura fuera → marca desde cuándo, no abre', () => {
    expect(decidirUmbral(base, 35, false, ahora)).toBe('marcar');
  });
  it('retardo 60, fuera desde hace 10 s → espera; desde hace 60 s → abre', () => {
    expect(decidirUmbral({ ...base, fuera_de_banda_desde: hace(10) }, 35, false, ahora)).toBe('esperar');
    expect(decidirUmbral({ ...base, fuera_de_banda_desde: hace(60) }, 35, false, ahora)).toBe('abrir');
  });
  it('plantada: sin la guarda del retardo (retardo tratado como 0) la misma lectura abriría antes de tiempo', () => {
    const r = { ...base, fuera_de_banda_desde: hace(10) };
    expect(decidirUmbral({ ...r, retardo_s: 0 }, 35, false, ahora)).toBe('abrir'); // lo que haría el código sin la guarda
    expect(decidirUmbral(r, 35, false, ahora)).toBe('esperar'); // lo que hace con ella
  });
  it('vuelve dentro de la banda antes del retardo → borra la marca (la cuenta vuelve a empezar); sin marca, nada', () => {
    expect(decidirUmbral({ ...base, fuera_de_banda_desde: hace(30) }, 25, false, ahora)).toBe('desmarcar');
    expect(decidirUmbral(base, 25, false, ahora)).toBe('nada');
  });
  it('con la condición abierta: la histéresis cierra (27 < 28) y la zona 28–30 no hace nada, con o sin retardo', () => {
    expect(decidirUmbral(base, 27, true, ahora)).toBe('cerrar');
    expect(decidirUmbral(base, 29, true, ahora)).toBe('nada');
  });
});

describe('AlertasService.evaluar con retardo: escribe la marca en la base, no abre', () => {
  it('35 Cel con retardo 60 y sin marca → UPDATE regla_umbral (fuera_de_banda_desde), sin condición ni evento', async () => {
    const escrituras: string[] = [];
    const query = vi.fn((sql: string) => {
      if (sql.startsWith('SELECT id, umbral_alto')) return Promise.resolve({ rows: [{ id: 'r1', umbral_alto: 30, umbral_bajo: null, histeresis: 2, retardo_s: 60, fuera_de_banda_desde: null }], rowCount: 1 });
      if (sql.startsWith('SELECT id FROM condicion')) return Promise.resolve({ rows: [], rowCount: 0 });
      escrituras.push(sql.trim().split(/\s+/).slice(0, 4).join(' '));
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const servicio = new AlertasService({ query } as unknown as Pool, new EventosService());
    await servicio.evaluar('d1', 'k1', 'dev-0001', 35, 'Cel');
    expect(escrituras).toEqual(['UPDATE regla_umbral SET fuera_de_banda_desde']);
  });
  it('35 Cel con retardo 60 y fuera desde hace 2 min → abre la condición y borra la marca', async () => {
    const escrituras: string[] = [];
    const query = vi.fn((sql: string) => {
      if (sql.startsWith('SELECT id, umbral_alto')) return Promise.resolve({ rows: [{ id: 'r1', umbral_alto: 30, umbral_bajo: null, histeresis: 2, retardo_s: 60, fuera_de_banda_desde: new Date(Date.now() - 120_000) }], rowCount: 1 });
      if (sql.startsWith('SELECT id FROM condicion')) return Promise.resolve({ rows: [], rowCount: 0 });
      escrituras.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const servicio = new AlertasService({ query } as unknown as Pool, new EventosService());
    await servicio.evaluar('d1', 'k1', 'dev-0001', 35, 'Cel');
    expect(escrituras).toEqual(['INSERT INTO condicion', 'INSERT INTO evento', 'UPDATE regla_umbral SET']);
  });
});

// Marca obsoleta (revisión del 11/11/2026): tras un mantenimiento o un silencio largo, una marca vieja abría con la primera lectura fuera,
// sin retardo. La marca vale hasta retardo_s + 2 × intervalo esperado; después es nula y la cuenta empieza de nuevo.
describe('retardo: marca obsoleta, mantenimiento y reloj de la lectura', () => {
  const lectura = new Date('2026-11-11T12:00:00Z');
  const hace = (s: number): Date => new Date(lectura.getTime() - s * 1000);
  it('marcaVigente: retardo 60 e intervalo 60 → vale hasta 180 s; más vieja, nula', () => {
    expect(marcaVigente(hace(180), 60, 60, lectura)).toEqual(hace(180));
    expect(marcaVigente(hace(181), 60, 60, lectura)).toBeNull();
    expect(marcaVigente(null, 60, 60, lectura)).toBeNull();
  });
  function armar(marca: Date | null) {
    const escrituras: [string, unknown[]][] = [];
    const query = vi.fn((sql: string, p: unknown[] = []) => {
      if (sql.startsWith('SELECT id, umbral_alto')) return Promise.resolve({ rows: [{ id: 'r1', umbral_alto: 30, umbral_bajo: null, histeresis: 2, retardo_s: 60, fuera_de_banda_desde: marca }], rowCount: 1 });
      if (sql.startsWith('SELECT id FROM condicion')) return Promise.resolve({ rows: [], rowCount: 0 });
      escrituras.push([sql.trim().split(/\s+/).slice(0, 3).join(' '), p]);
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    return { servicio: new AlertasService({ query } as unknown as Pool, new EventosService()), escrituras };
  }
  it('marca de hace 1 h (episodio vencido) → no abre: vuelve a marcar con la hora de la lectura; plantada: sin la vigencia, abriría', async () => {
    const { servicio, escrituras } = armar(hace(3600));
    await servicio.evaluar('d1', 'k1', 'dev-0001', 35, 'Cel', false, { tiempo: lectura, intervaloS: 60 });
    expect(escrituras.map(([s]) => s)).toEqual(['UPDATE regla_umbral SET']);
    expect(escrituras[0][1][1]).toEqual(lectura); // la hora de la lectura, no now() de la base ni la de Node
    expect(decidirUmbral({ umbral_alto: 30, umbral_bajo: null, histeresis: 2, retardo_s: 60, fuera_de_banda_desde: hace(3600) }, 35, false, lectura)).toBe('abrir');
  });
  it('marca vigente de hace 90 s → abre (el retardo de 60 s se cumplió), contado con la hora de la lectura', async () => {
    const { servicio, escrituras } = armar(hace(90));
    await servicio.evaluar('d1', 'k1', 'dev-0001', 35, 'Cel', false, { tiempo: lectura, intervaloS: 60 });
    expect(escrituras.map(([s]) => s)).toEqual(['INSERT INTO condicion', 'INSERT INTO evento', 'UPDATE regla_umbral SET']);
  });
  it('en mantenimiento, una lectura que abriría no abre y LIMPIA la marca', async () => {
    const { servicio, escrituras } = armar(hace(90));
    await servicio.evaluar('d1', 'k1', 'dev-0001', 35, 'Cel', true, { tiempo: lectura, intervaloS: 60 });
    expect(escrituras.map(([s, p]) => [s, p.length])).toEqual([['UPDATE regla_umbral SET', 1]]);
  });
});
