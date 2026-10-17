import { Pool } from 'pg';
import { AlertasService } from '../../alertas/alertas.service';
import { BrokerService } from '../../broker/broker.service';
import { SupervisionService } from '../../supervision/supervision.service';
import { EventosService } from '../../tiempo-real/eventos.service';
import { ChirpstackAdaptador } from '../adaptadores/chirpstack.adaptador';
import { resolverClave } from '../adaptadores/mapa-claves';
import { MilesightAdaptador } from '../adaptadores/milesight.adaptador';
import { PlanoAdaptador } from '../adaptadores/plano.adaptador';
import { SenmlAdaptador } from '../adaptadores/senml.adaptador';
import { RecepcionService } from '../recepcion.service';

// La consulta de la credencial para la vía HTTP (docs/10 §8.4 punto 52): la fila tal cual, con tiempo máximo.
describe('RecepcionService.credencialHttp', () => {
  function servicio(fila: { id: string; via: string; estado: string; hash: string | null } | undefined) {
    const query = jest.fn(() => Promise.resolve({ rows: fila ? [fila] : [], rowCount: fila ? 1 : 0 }));
    const s = new RecepcionService({ query } as unknown as Pool, { alRecibir: jest.fn() } as unknown as BrokerService, {} as AlertasService,
      {} as SupervisionService, new EventosService(), new SenmlAdaptador(), new PlanoAdaptador(), new ChirpstackAdaptador(resolverClave), new MilesightAdaptador(resolverClave));
    return { s, query };
  }
  it('entrega la fila de la credencial activa, y la consulta lleva tiempo máximo (corre fuera del cupo; acota la petición)', async () => {
    const fila = { id: 'd1', via: 'http', estado: 'activo', hash: 'huella' };
    const { s, query } = servicio(fila);
    expect(await s.credencialHttp('nodo-01')).toEqual(fila);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ query_timeout: 5_000, values: ['nodo-01'] }));
  });
  it('sin dispositivo → undefined (la capa HTTP verifica igual contra una huella de relleno)', async () => {
    const { s } = servicio(undefined);
    expect(await s.credencialHttp('nadie-0001')).toBeUndefined();
  });
});
