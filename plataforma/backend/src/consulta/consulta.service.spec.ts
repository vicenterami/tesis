import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { ConsultaService, SQL_INTERVALO_OBSERVADO } from './consulta.service.js';

// Contrato de GET /dispositivos/{id} con el intervalo observado (docs/19 §4, incremento 1, punto 3). La mediana la calcula la
// base: aquí se fija qué se le pide (las piezas de la regla) y que el campo llega a la respuesta tal cual, número o null.
describe('ConsultaService.dispositivo: intervalo_observado_s', () => {
  const ID = '00000000-0000-4000-8000-000000000001';
  function armar(fila: Record<string, unknown> | undefined) {
    const consultas: string[] = [];
    const query = vi.fn((sql: string) => {
      consultas.push(sql);
      if (sql.includes('FROM dispositivo d')) return Promise.resolve({ rows: fila ? [fila] : [] });
      return Promise.resolve({ rows: [] });
    });
    return { servicio: new ConsultaService({ query } as unknown as Pool), consultas, query };
  }

  it('la regla vive en una subconsulta de la ficha: sin una ida más a la base por petición', async () => {
    const { servicio, consultas } = armar({ id: ID, intervalo_observado_s: 17 });
    await servicio.dispositivo(ID);
    expect(consultas).toHaveLength(3); // ficha, canales, condiciones abiertas: las mismas tres de antes
    expect(consultas[0]).toContain(`${SQL_INTERVALO_OBSERVADO} AS intervalo_observado_s`);
  });

  it('pide la mediana de las diferencias entre los instantes de recepción de las últimas 20 tramas, al segundo, y null con menos de 3', () => {
    const sql = SQL_INTERVALO_OBSERVADO.replace(/\s+/g, ' ');
    // las últimas 20 tramas del dispositivo de la ficha, por el índice (dispositivo_id, recibido_en DESC)
    expect(sql).toContain('FROM trama tr WHERE tr.dispositivo_id = d.id ORDER BY tr.recibido_en DESC LIMIT 20');
    expect(sql).toContain("SELECT DISTINCT date_trunc('second', x.recibido_en) AS t"); // instantes distintos, truncados
    expect(sql).toContain('lag(u.t) OVER (ORDER BY u.t)'); // diferencias entre instantes consecutivos
    expect(sql).toContain('CASE WHEN count(*) >= 2 THEN round(percentile_cont(0.5) WITHIN GROUP (ORDER BY w.dif))::int END'); // 3 instantes = 2 diferencias
    expect(sql).not.toContain('medicion'); // una trama es un mensaje; las mediciones son sus lecturas
  });

  it('el campo llega a la respuesta tal cual: número o null', async () => {
    for (const valor of [17, null]) {
      const { servicio } = armar({ id: ID, intervalo_esperado_s: 180, intervalo_observado_s: valor });
      const r = await servicio.dispositivo(ID);
      expect(r).toMatchObject({ id: ID, intervalo_esperado_s: 180, intervalo_observado_s: valor, canales: [], condiciones_abiertas: [] });
    }
  });

  it('un dispositivo que no existe sigue dando 404, sin pedir canales', async () => {
    const { servicio, consultas } = armar(undefined);
    await expect(servicio.dispositivo(ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(consultas).toHaveLength(1);
  });
});

// Cliente prestado para las exportaciones y la estimación (revisión del 19/11/2026): si la base corta la conexión mientras está prestado, el
// cliente vuelve al pool con su error (`release(err)`) y pg-pool lo descarta; si no, vuelve sano, con su tope reiniciado.
describe('ConsultaService: el cliente roto no vuelve al pool', () => {
  function doble(fallaReset = false) {
    const cliente = Object.assign(new EventEmitter(), {
      consultas: [] as string[],
      query: vi.fn(function (this: { consultas: string[] }, sql: string) {
        cliente.consultas.push(sql);
        if (sql.startsWith('RESET') && fallaReset) return Promise.reject(new Error('conexión cerrada'));
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    });
    cliente.on('error', () => undefined); // como pg: el servicio pone el suyo además
    const pool = { connect: vi.fn(() => Promise.resolve(cliente)) };
    return { servicio: new ConsultaService(pool as unknown as Pool), cliente };
  }
  it('conConexionExportacion: un «error» del cliente durante la consulta → release(ese error), sin RESET', async () => {
    const { servicio, cliente } = doble();
    const corte = new Error('terminating connection due to administrator command');
    await servicio.conConexionExportacion(() => { cliente.emit('error', corte); return Promise.resolve(); });
    expect(cliente.release).toHaveBeenCalledWith(corte);
    expect(cliente.consultas).toEqual(['SET statement_timeout TO 30000']);
  });
  it('conConexionExportacion sana: release() sin error, con RESET; el tope de la estimación es el que se pide', async () => {
    const { servicio, cliente } = doble();
    await servicio.conConexionExportacion(() => Promise.resolve(), 10_000);
    expect(cliente.release).toHaveBeenCalledWith(undefined);
    expect(cliente.consultas).toEqual(['SET statement_timeout TO 10000', 'RESET statement_timeout']);
  });
  it('si el RESET final falla, el cliente también se descarta', async () => {
    const { servicio, cliente } = doble(true);
    await servicio.conConexionExportacion(() => Promise.resolve());
    expect((cliente.release.mock.calls[0] as unknown[])[0]).toBeInstanceOf(Error);
  });
  it('mediciones() (la exportación por dispositivo): el mismo trato', async () => {
    const { servicio, cliente } = doble();
    const corte = new Error('conexión cortada');
    const g = servicio.mediciones('00000000-0000-4000-8000-000000000001', new Date(0), new Date());
    cliente.query.mockImplementationOnce((sql: string) => { cliente.consultas.push(sql); return Promise.resolve({ rows: [] }); }); // el SET
    cliente.query.mockImplementationOnce(() => { cliente.emit('error', corte); return Promise.reject(corte); }); // la primera tanda
    await expect(g.next()).rejects.toBe(corte);
    expect(cliente.release).toHaveBeenCalledWith(corte);
  });
});
