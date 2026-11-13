import { describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { AlertasService } from '../../alertas/alertas.service.js';
import { BrokerService } from '../../broker/broker.service.js';
import { SupervisionService } from '../../supervision/supervision.service.js';
import { EventosService } from '../../tiempo-real/eventos.service.js';
import { ChirpstackAdaptador } from '../adaptadores/chirpstack.adaptador.js';
import { resolverClave } from '../adaptadores/mapa-claves.js';
import { MilesightAdaptador } from '../adaptadores/milesight.adaptador.js';
import { PlanoAdaptador } from '../adaptadores/plano.adaptador.js';
import { SenmlAdaptador } from '../adaptadores/senml.adaptador.js';
import { RecepcionService } from '../recepcion.service.js';

// La consulta de la credencial para la vía HTTP (docs/10 §8.4 punto 52): la fila tal cual, con tiempo máximo.
function servicio(fila: { id: string; via: string; estado: string; credencial_id: string | null; hash: string | null } | undefined, rowCount?: number) {
  const query = vi.fn(() => Promise.resolve({ rows: fila ? [fila] : [], rowCount: rowCount ?? (fila ? 1 : 0) }));
  const s = new RecepcionService({ query } as unknown as Pool, { alRecibir: vi.fn() } as unknown as BrokerService, {} as AlertasService,
    {} as SupervisionService, new EventosService(), new SenmlAdaptador(), new PlanoAdaptador(), new ChirpstackAdaptador(resolverClave), new MilesightAdaptador(resolverClave));
  return { s, query };
}

describe('RecepcionService.credencialHttp', () => {
  it('entrega la fila de la credencial activa, y la consulta lleva tiempo máximo (corre fuera del cupo; acota la petición)', async () => {
    const fila = { id: 'd1', via: 'http', estado: 'activo', credencial_id: 'c1', hash: 'huella' };
    const { s, query } = servicio(fila);
    expect(await s.credencialHttp('nodo-01')).toEqual(fila);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ query_timeout: 5_000, values: ['nodo-01'] }));
  });
  it('sin dispositivo → undefined (la capa HTTP verifica igual contra una huella de relleno)', async () => {
    const { s } = servicio(undefined);
    expect(await s.credencialHttp('nadie-0001')).toBeUndefined();
  });
  it('la consulta trae el id de la fila de credencial (para convertir una huella anterior)', async () => {
    const { s, query } = servicio(undefined);
    await s.credencialHttp('nodo-01');
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('c.id AS credencial_id') }));
  });
});

// La conversión de una credencial anterior (docs/10 §8.4 punto 52): una sentencia condicionada a la fila activa y a la huella verificada,
// con tiempo máximo.
describe('RecepcionService.convertirCredencial', () => {
  it('UPDATE de esa fila solo si sigue activa y su huella sigue siendo la verificada; true si la cambió, false si no (se rotó o ya estaba convertida)', async () => {
    const { s, query } = servicio(undefined, 1);
    expect(await s.convertirCredencial('c1', 'anterior', 'nueva')).toBe(true);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      text: 'UPDATE credencial SET hash = $3 WHERE id = $1 AND activa AND hash = $2', values: ['c1', 'anterior', 'nueva'], query_timeout: 5_000,
    }));
    expect(await servicio(undefined, 0).s.convertirCredencial('c1', 'anterior', 'nueva')).toBe(false);
  });
});
