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
  // Las cuarentenas que esta prueba provoca a propósito escriben WARN en el registro. Se dejan ver a
  // propósito (decisión del 23/09): el ruido de un rechazo es evidencia de que el filtro actúa; silenciarlo
  // esconde comportamiento.
  const TOPICO = 'sitio/uct/dispositivo/dev-0001/temperatura';

  function armar(dispositivo: { id: string; estado: string } | undefined) {
    const canal = { id: 'k1', magnitud: 'temperatura', unidad_canonica: 'Cel', rango_min: -40, rango_max: 85 };
    const query = jest.fn((sql: string, params?: unknown[]) => {
      if (sql.startsWith('SELECT id, estado FROM dispositivo')) return Promise.resolve({ rows: dispositivo ? [dispositivo] : [], rowCount: dispositivo ? 1 : 0 });
      // Solo el canal «temperatura» está declarado para el dispositivo de prueba; cualquier otro, no.
      if (sql.trimStart().startsWith('SELECT c.id, m.codigo AS magnitud')) return Promise.resolve({ rows: params?.[1] === 'temperatura' ? [canal] : [], rowCount: params?.[1] === 'temperatura' ? 1 : 0 });
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

  it('filtro 3: canal no declarado → cuarentena "invalida", pero el dispositivo se marca vivo', async () => {
    const { servicio, query, marcarVivo, evaluar } = armar({ id: 'd1', estado: 'activo' });
    await servicio.procesar('sitio/uct/dispositivo/dev-0001/presion', Buffer.from('1013'));
    expect(cuarentenas(query)).toEqual(['invalida']);
    expect(marcarVivo).toHaveBeenCalledTimes(1);
    expect(evaluar).not.toHaveBeenCalled();
  });

  it('filtro 3: unidad no convertible a la canónica → cuarentena "invalida"', async () => {
    const { servicio, query, evaluar } = armar({ id: 'd1', estado: 'activo' });
    await servicio.procesar(TOPICO, Buffer.from('{"v":300,"u":"furlongs"}'));
    expect(cuarentenas(query)).toEqual(['invalida']);
    expect(evaluar).not.toHaveBeenCalled();
  });

  it('filtro 3: valor fuera del rango físico del canal → cuarentena "invalida"', async () => {
    const { servicio, query, evaluar } = armar({ id: 'd1', estado: 'activo' });
    await servicio.procesar(TOPICO, Buffer.from('500'));
    expect(cuarentenas(query)).toEqual(['invalida']);
    expect(evaluar).not.toHaveBeenCalled();
  });

  it('lectura válida → INSERT en medicion, alerta evaluada una vez, vivo una vez', async () => {
    const { servicio, query, marcarVivo, evaluar } = armar({ id: 'd1', estado: 'activo' });
    await servicio.procesar(TOPICO, Buffer.from('22.4'));
    expect(cuarentenas(query)).toEqual([]);
    expect(query.mock.calls.some(([sql]) => String(sql).trimStart().startsWith('INSERT INTO medicion'))).toBe(true);
    expect(evaluar).toHaveBeenCalledTimes(1);
    expect(marcarVivo).toHaveBeenCalledTimes(1);
  });

  it('tópico fuera del patrón → cuarentena "malformada" ANTES del filtro 1: sin identidad no hay a quién marcar vivo', async () => {
    const { servicio, query, marcarVivo } = armar({ id: 'd1', estado: 'activo' });
    await servicio.procesar('otra/cosa', Buffer.from('22.4'));
    expect(cuarentenas(query)).toEqual(['malformada']);
    expect(marcoVisto(query)).toBe(false);
    expect(marcarVivo).not.toHaveBeenCalled();
  });

  it('cuerpo vacío → ningún adaptador lo reconoce → cuarentena "malformada", y vivo (el dispositivo sí se autenticó)', async () => {
    const { servicio, query, marcarVivo } = armar({ id: 'd1', estado: 'activo' });
    await servicio.procesar(TOPICO, Buffer.alloc(0));
    expect(cuarentenas(query)).toEqual(['malformada']);
    expect(marcarVivo).toHaveBeenCalledTimes(1);
  });

  it('dispositivo dado de baja → tratado como desconocido', async () => {
    const { servicio, query, marcarVivo } = armar({ id: 'd9', estado: 'baja' });
    await servicio.procesar(TOPICO, Buffer.from('21.5'));

    expect(cuarentenas(query)).toEqual(['desconocido']);
    expect(marcarVivo).not.toHaveBeenCalled();
  });
});
