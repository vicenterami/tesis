import { describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { ConsultaService } from './consulta.service.js';
import { TableroService } from './tablero.service.js';

// Dos cosas que el panel muestra y que se deciden en SQL, probadas aquí sin base (con un doble del grupo de conexiones): qué parámetros y
// qué comparaciones lleva la consulta (HU-07, RF-33: el rango de fechas del historial) y que el porcentaje de la tarjeta «Salud del
// sitio» sale de los dos conteos de la base (HU-16, RF-30). El resultado contra datos reales lo comprueban los casos de
// `plataforma/pruebas/api-smoke.sh` («historial: …» y «resumen: salud …»), que corren con la pila.

const DISP = '00000000-0000-4000-8000-000000000001';
const SITIO = '00000000-0000-4000-8000-0000000000a1';
const DESDE = new Date('2026-10-10T11:00:00Z');
const HASTA = new Date('2026-10-10T23:00:00Z');

function pool(respuestas: (sql: string) => unknown[]) {
  const llamadas: { sql: string; p: unknown[] }[] = [];
  const query = vi.fn((sql: string, p: unknown[] = []) => {
    llamadas.push({ sql: sql.replace(/\s+/g, ' '), p });
    return Promise.resolve({ rows: respuestas(sql) });
  });
  return { pool: { query } as unknown as Pool, llamadas };
}

describe('HU-07: el historial deja fuera lo que cae fuera del rango [desde, hasta)', () => {
  it('eventos del dispositivo: «ocurrido_en >= desde AND ocurrido_en < hasta», con esas fechas como parámetros 2 y 3 (y nada más del dispositivo)', async () => {
    const { pool: p, llamadas } = pool(() => []);
    await new TableroService(p).eventosDispositivo(DISP, DESDE, HASTA, 50);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].sql).toContain('WHERE ev.dispositivo_id = $1 AND ev.ocurrido_en >= $2 AND ev.ocurrido_en < $3');
    expect(llamadas[0].p.slice(0, 3)).toEqual([DISP, DESDE, HASTA]);
    expect(llamadas[0].sql).not.toMatch(/ocurrido_en <= \$3/); // semiabierto: el instante `hasta` no entra (el siguiente rango lo trae)
  });

  it('histórico de un canal: «tiempo >= desde AND tiempo < hasta» sobre las mediciones del canal, con las mismas fechas como parámetros 2 y 3', async () => {
    const { pool: p, llamadas } = pool((sql) => (sql.includes('FROM canal c') ? [{ zona_horaria: 'America/Santiago', magnitud: 'temperatura', unidad: 'Cel', escala_cero: null, escala_cien: null }] : []));
    await new ConsultaService(p).historico(DISP, DESDE, HASTA, '15 minutes');
    const medicion = llamadas.find((l) => l.sql.includes('FROM medicion'))!;
    expect(medicion.sql).toContain('WHERE canal_id = $1 AND tiempo >= $2 AND tiempo < $3');
    expect(medicion.p.slice(0, 4)).toEqual([DISP, DESDE, HASTA, '15 minutes']);
    expect(medicion.sql).not.toMatch(/tiempo <= \$3/);
  });
});

describe('HU-16: la salud del sitio sale de los conteos de la base', () => {
  const fila = (reportan: number, supervisados: number) => ({
    sitio: { id: SITIO, codigo: 'uct', nombre: 'Campus', zona_horaria: 'America/Santiago' },
    r: {
      dispositivos: { total: supervisados, normal: 0, alerta: 0, sin_senal: 0, inactivo: 0 }, salud: { reportan, supervisados },
      condiciones_abiertas: [], tramas: { recibidas: 0, rechazadas: 0, cubos: [] }, atencion: [], magnitudes: [], entrega_base: [],
    },
  });

  it('13 de 14 → 92,9 y los conteos llegan tal cual; 0 de 0 → porcentaje null', async () => {
    const a = pool(() => [fila(13, 14)]);
    const r = await new TableroService(a.pool).resumen(SITIO, DESDE, HASTA, '15 minutes');
    expect(r.salud).toEqual({ reportan: 13, supervisados: 14, porcentaje: 92.9 });
    const b = pool(() => [fila(0, 0)]);
    expect((await new TableroService(b.pool).resumen(SITIO, DESDE, HASTA, '15 minutes')).salud).toEqual({ reportan: 0, supervisados: 0, porcentaje: null });
  });

  it('el SQL define «supervisados» como los no inactivos y «reportan» como los no inactivos en línea (así reportan ≤ supervisados y supervisados = total − inactivos)', async () => {
    const { pool: p, llamadas } = pool(() => [fila(1, 1)]);
    await new TableroService(p).resumen(SITIO, DESDE, HASTA, '15 minutes');
    const sql = llamadas[0].sql;
    expect(sql).toContain("'reportan', (count(*) FILTER (WHERE estado_visual <> 'inactivo' AND en_linea IS TRUE))::int");
    expect(sql).toContain("'supervisados', (count(*) FILTER (WHERE estado_visual <> 'inactivo'))::int");
    expect(sql).toContain("'inactivo', (count(*) FILTER (WHERE estado_visual = 'inactivo'))::int");
  });
});
