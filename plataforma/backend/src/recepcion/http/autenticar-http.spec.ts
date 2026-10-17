import { Pool } from 'pg';
import { AlertasService } from '../../alertas/alertas.service';
import * as credenciales from '../../alta/credenciales';
import { BrokerService } from '../../broker/broker.service';
import { SupervisionService } from '../../supervision/supervision.service';
import { EventosService } from '../../tiempo-real/eventos.service';
import { ChirpstackAdaptador } from '../adaptadores/chirpstack.adaptador';
import { resolverClave } from '../adaptadores/mapa-claves';
import { MilesightAdaptador } from '../adaptadores/milesight.adaptador';
import { PlanoAdaptador } from '../adaptadores/plano.adaptador';
import { SenmlAdaptador } from '../adaptadores/senml.adaptador';
import { RecepcionService } from '../recepcion.service';

// Filtro 1 de la vía HTTP (docs/10 §8.4 punto 52): el token contra la huella de la credencial activa; null por cualquier motivo.
describe('RecepcionService.autenticarHttp', () => {
  const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';
  let huella: string;
  beforeAll(async () => { huella = await credenciales.hashScrypt(TOKEN); });

  function servicio(fila: { id: string; via: string; estado: string; hash: string | null } | undefined) {
    const query = jest.fn(() => Promise.resolve({ rows: fila ? [fila] : [], rowCount: fila ? 1 : 0 }));
    const s = new RecepcionService({ query } as unknown as Pool, { alRecibir: jest.fn() } as unknown as BrokerService, {} as AlertasService,
      {} as SupervisionService, new EventosService(), new SenmlAdaptador(), new PlanoAdaptador(), new ChirpstackAdaptador(resolverClave), new MilesightAdaptador(resolverClave));
    return { s, query };
  }

  it('el token de su credencial activa, vía http, activo → el id del dispositivo', async () => {
    const { s } = servicio({ id: 'd1', via: 'http', estado: 'activo', hash: huella });
    expect(await s.autenticarHttp('nodo-01', TOKEN)).toBe('d1');
  });
  it('token equivocado, otra vía, dado de baja o sin credencial activa → null (el mismo para todos)', async () => {
    for (const fila of [
      { id: 'd1', via: 'http', estado: 'activo', hash: huella, token: 'otro-token-de-treinta-y-dos-chars' },
      { id: 'd1', via: 'mqtt', estado: 'activo', hash: huella, token: TOKEN },
      { id: 'd1', via: 'http', estado: 'baja', hash: huella, token: TOKEN },
      { id: 'd1', via: 'http', estado: 'activo', hash: null, token: TOKEN },
    ]) {
      const { s } = servicio(fila);
      expect(await s.autenticarHttp('nodo-01', fila.token)).toBeNull();
    }
  });
  it('la consulta lleva tiempo máximo (una colgada retendría el cupo)', async () => {
    const { s, query } = servicio(undefined);
    await s.autenticarHttp('nadie-0001', TOKEN);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ query_timeout: 5_000, values: ['nadie-0001'] }));
  });
  it('si calcular la huella de relleno falla una vez, no queda guardado el fallo: la siguiente vez se recalcula', async () => {
    const espia = jest.spyOn(credenciales, 'hashScrypt').mockRejectedValueOnce(new Error('sin memoria'));
    try {
      const { s } = servicio(undefined);
      await expect(s.autenticarHttp('nadie-0001', TOKEN)).rejects.toThrow('sin memoria');
      expect(await s.autenticarHttp('nadie-0001', TOKEN)).toBeNull();
    } finally {
      espia.mockRestore();
    }
  });
  it('un dispositivo que no existe → null, y la huella se verifica igual (el tiempo no revela cuáles existen)', async () => {
    const espia = jest.spyOn(credenciales, 'verificarScrypt');
    try {
      const { s } = servicio(undefined);
      expect(await s.autenticarHttp('nadie-0001', TOKEN)).toBeNull();
      expect(espia).toHaveBeenCalledTimes(1);
    } finally {
      espia.mockRestore();
    }
  });
});
