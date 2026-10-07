import { Pool } from 'pg';
import { AlertasService } from './alertas.service';

// Histéresis (docs/10 §4, RF-36): con umbral alto 30 e histéresis 2, la condición abre al superar 30 y
// cierra solo por debajo de 28. Entre 28 y 30 no pasa nada: ni abre ni cierra. Sin esto, un valor que
// oscila alrededor del umbral abriría y cerraría alertas sin parar.
describe('AlertasService.evaluar: umbral con histéresis', () => {
  const regla = { id: 'r1', umbral_alto: 30, umbral_bajo: null, histeresis: 2 };

  function armar(abierta: boolean) {
    const escrituras: string[] = [];
    const query = jest.fn((sql: string) => {
      if (sql.startsWith('SELECT id, umbral_alto')) return Promise.resolve({ rows: [regla], rowCount: 1 });
      if (sql.startsWith('SELECT id FROM condicion')) return Promise.resolve({ rows: abierta ? [{ id: 'c1' }] : [], rowCount: abierta ? 1 : 0 });
      escrituras.push(sql.trim().split(/\s+/).slice(0, 3).join(' ')); // "INSERT INTO condicion", "UPDATE condicion SET", …
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    return { servicio: new AlertasService({ query } as unknown as Pool), escrituras };
  }

  it('35 Cel sin condición abierta → abre la condición y registra el evento', async () => {
    const { servicio, escrituras } = armar(false);
    await servicio.evaluar('d1', 'k1', 'dev-0001', 35, 'Cel');
    expect(escrituras.some((e) => e.startsWith('INSERT INTO condicion'))).toBe(true);
    expect(escrituras.some((e) => e.startsWith('INSERT INTO evento'))).toBe(true);
  });

  it('29 Cel con la condición abierta → zona de histéresis: no escribe nada', async () => {
    const { servicio, escrituras } = armar(true);
    await servicio.evaluar('d1', 'k1', 'dev-0001', 29, 'Cel');
    expect(escrituras).toEqual([]);
  });

  it('27 Cel con la condición abierta → la cierra', async () => {
    const { servicio, escrituras } = armar(true);
    await servicio.evaluar('d1', 'k1', 'dev-0001', 27, 'Cel');
    expect(escrituras.some((e) => e.startsWith('UPDATE condicion'))).toBe(true);
  });

  // Prueba de carrera del 07/10 (banco): dos lecturas sobre el umbral llegan a la vez; las dos ven «ninguna abierta»
  // y las dos intentan abrir. La guarda es el índice único parcial: el INSERT con ON CONFLICT devuelve 0 filas a la
  // segunda, que debe seguir sin error (antes rompía con 23505 y abortaba el pipeline a mitad) y sin evento repetido.
  it('carrera: otra trama abrió la condición entre el SELECT y el INSERT → sin error ni evento repetido', async () => {
    const escrituras: string[] = [];
    const query = jest.fn((sql: string) => {
      if (sql.startsWith('SELECT id, umbral_alto')) return Promise.resolve({ rows: [regla], rowCount: 1 });
      if (sql.startsWith('SELECT id FROM condicion')) return Promise.resolve({ rows: [], rowCount: 0 });
      escrituras.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      return Promise.resolve({ rows: [], rowCount: sql.trim().startsWith('INSERT INTO condicion') ? 0 : 1 });
    });
    const servicio = new AlertasService({ query } as unknown as Pool);
    await expect(servicio.evaluar('d1', 'k1', 'dev-0001', 35, 'Cel')).resolves.toBeUndefined();
    expect(escrituras).toEqual(['INSERT INTO condicion']);
    const insercion = query.mock.calls.map(([sql]) => String(sql)).find((s) => s.includes('INSERT INTO condicion'));
    expect(insercion).toMatch(/ON CONFLICT[\s\S]*WHERE cerrada_en IS NULL DO NOTHING/);
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
