import { Pool } from 'pg';
import { AlertasService } from '../alertas/alertas.service';
import { BrokerService } from '../broker/broker.service';
import { SupervisionService } from '../supervision/supervision.service';
import { PlanoAdaptador } from './adaptadores/plano.adaptador';
import { SenmlAdaptador } from './adaptadores/senml.adaptador';
import { RecepcionService } from './recepcion.service';

// Prueba el CONTRATO del pipeline con la base y los módulos vecinos simulados (docs/10 §4):
// «vivo» es salud del enlace, no calidad del dato. Un dispositivo autenticado que manda una trama
// que ningún adaptador entiende va a cuarentena Y se marca vivo; uno desconocido, ni lo uno ni lo otro.
describe('RecepcionService: filtro 6 (supervisar) corre siempre tras autenticar', () => {
  const TOPICO = 'sitio/uct/dispositivo/dev-0001/temperatura';

  function armar(dispositivo: { id: string; estado: string } | undefined) {
    const query = jest.fn((sql: string) => {
      if (sql.startsWith('SELECT id, estado FROM dispositivo')) return Promise.resolve({ rows: dispositivo ? [dispositivo] : [], rowCount: dispositivo ? 1 : 0 });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const pool = { query } as unknown as Pool;
    const broker = { alRecibir: jest.fn() } as unknown as BrokerService;
    const evaluar = jest.fn();
    const marcarVivo = jest.fn();
    const alertas = { evaluar } as unknown as AlertasService;
    const supervision = { marcarVivo } as unknown as SupervisionService;
    const servicio = new RecepcionService(pool, broker, alertas, supervision, new SenmlAdaptador(), new PlanoAdaptador());
    return { servicio, query, marcarVivo, evaluar };
  }

  const cuarentenas = (query: jest.Mock) =>
    query.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT INTO cuarentena')).map(([, params]) => (params as unknown[])[2]);
  const marcoVisto = (query: jest.Mock) => query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE dispositivo SET visto_por_ultima_vez'));

  it('trama malformada de un dispositivo conocido → cuarentena "malformada" Y marcado vivo', async () => {
    const { servicio, query, marcarVivo, evaluar } = armar({ id: 'd1', estado: 'activo' });
    await servicio.procesar(TOPICO, Buffer.from('hola')); // ni SenML, ni JSON, ni número

    expect(cuarentenas(query)).toEqual(['malformada']);
    expect(marcoVisto(query)).toBe(true);
    expect(marcarVivo).toHaveBeenCalledWith('d1', 'dev-0001');
    expect(evaluar).not.toHaveBeenCalled(); // sin lecturas no hay umbral que evaluar
  });

  it('dispositivo desconocido → cuarentena "desconocido" y NO se marca vivo (no pasó el filtro 1)', async () => {
    const { servicio, query, marcarVivo } = armar(undefined);
    await servicio.procesar(TOPICO, Buffer.from('hola'));

    expect(cuarentenas(query)).toEqual(['desconocido']);
    expect(marcoVisto(query)).toBe(false);
    expect(marcarVivo).not.toHaveBeenCalled();
  });

  it('dispositivo dado de baja → tratado como desconocido', async () => {
    const { servicio, query, marcarVivo } = armar({ id: 'd9', estado: 'baja' });
    await servicio.procesar(TOPICO, Buffer.from('21.5'));

    expect(cuarentenas(query)).toEqual(['desconocido']);
    expect(marcarVivo).not.toHaveBeenCalled();
  });
});
