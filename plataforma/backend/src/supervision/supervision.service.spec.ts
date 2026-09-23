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

  it('base sana: barridoSeguro no rechaza', async () => {
    const servicio = armar(false);
    await expect(servicio.barridoSeguro()).resolves.toBeUndefined();
  });
});
