import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
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
    return new SupervisionService(pool, config);
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
      escrituras.push(s.split(/\s+/).slice(0, 3).join(' '));
      return Promise.resolve({ rows: [], rowCount: s.startsWith('INSERT INTO condicion') ? 0 : 1 });
    });
    const servicio = new SupervisionService({ query } as unknown as Pool, { get: () => 60 } as unknown as ConfigService);
    await expect(servicio.barrer()).resolves.toBeUndefined();
    expect(escrituras).toEqual(['INSERT INTO condicion']);
  });

  it('base sana: barridoSeguro no rechaza', async () => {
    const servicio = armar(false);
    await expect(servicio.barridoSeguro()).resolves.toBeUndefined();
  });
});
