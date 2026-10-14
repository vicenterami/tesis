import { BadGatewayException, BadRequestException, ConflictException, InternalServerErrorException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { ErrorDynsec, OrdenDynsec } from '../broker/dynsec';
import type { DynsecService } from '../broker/dynsec.service';
import { AltaService } from './alta.service';
import { verificarScrypt } from './credenciales';

const ID = '44444444-4444-4444-8444-444444444444';

// Base y broker falsos, como en alta.service.spec.ts: cada consulta se registra en orden y se responde según su prefijo.
function armar(opciones: {
  fila?: { estado: 'activo' | 'mantenimiento' | 'baja'; via: 'mqtt' | 'http' | 'lorawan' } | null;
  brokerFalla?: Partial<Record<'deleteClient' | 'setClientPassword' | 'createClient', Error>>;
  commitFalla?: boolean;
  disponible?: boolean;
} = {}) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const fila = opciones.fila === undefined ? { estado: 'activo' as const, via: 'mqtt' as const } : opciones.fila;
  const cliente = {
    query: async (texto: string, p: unknown[] = []) => {
      await Promise.resolve();
      sql.push(texto);
      params.push(p);
      if (texto.startsWith('SELECT d.id, d.id_fisico, d.estado')) return { rows: fila === null ? [] : [{ id: ID, id_fisico: 'nodo-07', pasarela_id: null, sitio_codigo: 'uct', ...fila }] };
      if (texto.startsWith('SELECT c.id, c.magnitud_codigo')) return { rows: [{ id: 'C1', magnitud: 'humedad', unidad: '%RH', etiqueta: 'suelo' }, { id: 'C2', magnitud: 'temperatura', unidad: 'Cel', etiqueta: null }] };
      if (texto.startsWith('UPDATE credencial')) return { rows: [], rowCount: 1 };
      if (texto.startsWith('UPDATE condicion')) return { rows: [], rowCount: 2 };
      if (texto.startsWith('INSERT INTO evento')) return { rows: [{ ocurrido_en: new Date('2026-10-13T21:00:00Z') }], rowCount: 1 };
      if (texto === 'COMMIT' && opciones.commitFalla) throw new Error('la base se fue');
      return { rows: [], rowCount: 0 };
    },
    release: jest.fn(),
  };
  const ordenes: OrdenDynsec[][] = [];
  const dynsec = {
    disponible: opciones.disponible ?? true,
    ordenar: async (o: OrdenDynsec[]) => {
      await Promise.resolve();
      ordenes.push(o);
      const falla = opciones.brokerFalla?.[o[0].command as 'deleteClient'];
      if (falla) throw falla;
      return o.map((x) => ({ command: x.command }));
    },
  } as unknown as DynsecService;
  const pool = { connect: () => Promise.resolve(cliente) } as unknown as Pool;
  return { servicio: new AltaService(pool, dynsec), sql, params, ordenes, cliente };
}
const comandos = (ordenes: OrdenDynsec[][]) => ordenes.map((o) => o[0].command);

describe('AltaService.darDeBaja: estado baja, credenciales revocadas, condiciones cerradas y cliente borrado, todo o nada', () => {
  it('vía mqtt: FOR UPDATE → UPDATE estado → credenciales inactivas → condiciones cerradas → evento → deleteClient → COMMIT', async () => {
    const { servicio, sql, params, ordenes, cliente } = armar();
    const r = await servicio.darDeBaja(ID);
    expect(sql[0]).toBe('BEGIN');
    expect(sql.at(-1)).toBe('COMMIT');
    expect(sql.find((s) => s.startsWith('SELECT d.id'))).toContain('FOR UPDATE OF d');
    const i = sql.findIndex((s) => s.startsWith('UPDATE dispositivo SET estado'));
    expect(params[i]).toEqual([ID, 'baja']);
    expect(sql.some((s) => s.startsWith('UPDATE credencial SET activa = false'))).toBe(true);
    expect(sql.some((s) => s.startsWith('UPDATE condicion SET cerrada_en = now()'))).toBe(true);
    const ev = params[sql.findIndex((s) => s.startsWith('INSERT INTO evento'))];
    expect(ev[1]).toBe('baja');
    expect(JSON.parse(ev[2] as string)).toMatchObject({ via: 'mqtt', estado_anterior: 'activo', credenciales_revocadas: 1, condiciones_cerradas: 2, origen: 'api' });
    expect(ordenes).toEqual([[{ command: 'deleteClient', username: 'nodo-07' }]]);
    expect(r).toMatchObject({ id: ID, id_fisico: 'nodo-07', estado: 'baja', estado_anterior: 'activo', via: 'mqtt', credenciales_revocadas: 1, condiciones_cerradas: 2, dado_de_baja_en: '2026-10-13T21:00:00.000Z' });
    expect(cliente.release).toHaveBeenCalledTimes(1);
  });

  it('ya dado de baja → 409 con ROLLBACK, sin escribir ni tocar el broker', async () => {
    const { servicio, sql, ordenes } = armar({ fila: { estado: 'baja', via: 'mqtt' } });
    await expect(servicio.darDeBaja(ID)).rejects.toBeInstanceOf(ConflictException);
    expect(sql).toContain('ROLLBACK');
    expect(sql.some((s) => s.startsWith('UPDATE'))).toBe(false);
    expect(ordenes).toHaveLength(0);
  });

  it('no existe → 404', async () => {
    const { servicio, ordenes } = armar({ fila: null });
    await expect(servicio.darDeBaja(ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(ordenes).toHaveLength(0);
  });

  it('el broker ya no tenía al cliente («not found») → se da por borrado y se confirma (baja repetible tras un corte)', async () => {
    const { servicio, sql } = armar({ brokerFalla: { deleteClient: new ErrorDynsec('deleteClient', 'Client not found') } });
    const r = await servicio.darDeBaja(ID);
    expect(r.estado).toBe('baja');
    expect(sql.at(-1)).toBe('COMMIT');
  });

  it('el broker no responde (ambiguo) → 502, ROLLBACK y nada más que deshacer', async () => {
    const { servicio, sql, ordenes } = armar({ brokerFalla: { deleteClient: new ErrorDynsec('deleteClient', 'sin respuesta del broker en 5000 ms', true) } });
    await expect(servicio.darDeBaja(ID)).rejects.toBeInstanceOf(BadGatewayException);
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
    expect(comandos(ordenes)).toEqual(['deleteClient']);
  });

  it('vía http: sin orden al broker; las credenciales (token) quedan inactivas; funciona aunque no haya administración del broker', async () => {
    const { servicio, sql, ordenes } = armar({ fila: { estado: 'mantenimiento', via: 'http' }, disponible: false });
    const r = await servicio.darDeBaja(ID);
    expect(r).toMatchObject({ estado: 'baja', estado_anterior: 'mantenimiento', via: 'http' });
    expect(ordenes).toHaveLength(0);
    expect(sql.some((s) => s.startsWith('UPDATE credencial'))).toBe(true);
    expect(sql.at(-1)).toBe('COMMIT');
  });

  it('vía mqtt sin administración del broker → 503 y ROLLBACK antes de escribir', async () => {
    const { servicio, sql } = armar({ disponible: false });
    await expect(servicio.darDeBaja(ID)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(sql.some((s) => s.startsWith('UPDATE'))).toBe(false);
    expect(sql).toContain('ROLLBACK');
  });
});

describe('AltaService.rotarCredencial: nueva fila con hash, la anterior inactiva, setClientPassword antes del COMMIT, secreto una vez', () => {
  it('vía mqtt: credencial nueva de 32 caracteres; en la base solo su hash; el broker recibe el secreto; conexión como en el alta', async () => {
    const { servicio, sql, params, ordenes } = armar();
    const r = await servicio.rotarCredencial(ID);
    expect(sql[0]).toBe('BEGIN');
    expect(sql.at(-1)).toBe('COMMIT');
    expect(sql.find((s) => s.startsWith('SELECT d.id'))).toContain('FOR UPDATE OF d');
    const iInactiva = sql.findIndex((s) => s.startsWith('UPDATE credencial SET activa = false'));
    const iNueva = sql.findIndex((s) => s.startsWith('INSERT INTO credencial'));
    const iOrden = sql.findIndex((s) => s === 'COMMIT');
    expect(iInactiva).toBeGreaterThan(0);
    expect(iNueva).toBeGreaterThan(iInactiva);
    expect(iOrden).toBeGreaterThan(iNueva);
    expect(r.conexion.via).toBe('mqtt');
    const credencial = (r.conexion as { credencial: string }).credencial;
    expect(credencial).toHaveLength(32);
    expect(ordenes).toEqual([[{ command: 'setClientPassword', username: 'nodo-07', password: credencial }]]);
    const hash = params[iNueva][1] as string;
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verificarScrypt(credencial, hash)).toBe(true);
    expect(JSON.stringify(params).includes(credencial)).toBe(false);
    expect(params[sql.findIndex((s) => s.startsWith('INSERT INTO evento'))][1]).toBe('rotacion');
    expect((r.conexion as { topico: string }).topico).toBe('sitio/uct/dispositivo/nodo-07/<magnitud>');
    expect((r.conexion as { ejemplo: { topico: string } }).ejemplo.topico).toBe('sitio/uct/dispositivo/nodo-07/humedad');
    expect(r).toMatchObject({ id: ID, id_fisico: 'nodo-07', via: 'mqtt', sitio_codigo: 'uct', rotada_en: '2026-10-13T21:00:00.000Z' });
  });

  it('dado de baja → 409; lorawan → 400 (sin credencial propia); ninguno escribe ni toca el broker', async () => {
    const baja = armar({ fila: { estado: 'baja', via: 'mqtt' } });
    await expect(baja.servicio.rotarCredencial(ID)).rejects.toBeInstanceOf(ConflictException);
    const lora = armar({ fila: { estado: 'activo', via: 'lorawan' } });
    await expect(lora.servicio.rotarCredencial(ID)).rejects.toBeInstanceOf(BadRequestException);
    for (const x of [baja, lora]) {
      expect(x.sql.some((s) => s.startsWith('INSERT') || s.startsWith('UPDATE'))).toBe(false);
      expect(x.ordenes).toHaveLength(0);
      expect(x.sql).toContain('ROLLBACK');
    }
  });

  it('el broker no tenía al cliente («not found») → se crea con su rol y la misma clave, y se confirma (rotar repara)', async () => {
    const { servicio, sql, ordenes } = armar({ brokerFalla: { setClientPassword: new ErrorDynsec('setClientPassword', 'Client not found') } });
    const r = await servicio.rotarCredencial(ID);
    expect(comandos(ordenes)).toEqual(['setClientPassword', 'createClient']);
    expect(ordenes[1][0]).toMatchObject({ username: 'nodo-07', password: (r.conexion as { credencial: string }).credencial, roles: [{ rolename: 'dispositivo' }] });
    expect(sql.at(-1)).toBe('COMMIT');
  });

  it('el broker no responde (ambiguo) → 502 con ROLLBACK y el remedio «repetir la rotación» en el mensaje', async () => {
    const { servicio, sql } = armar({ brokerFalla: { setClientPassword: new ErrorDynsec('setClientPassword', 'sin respuesta del broker en 5000 ms', true) } });
    await expect(servicio.rotarCredencial(ID)).rejects.toThrow(/repetir la rotación/);
    await expect(servicio.rotarCredencial(ID)).rejects.toBeInstanceOf(BadGatewayException);
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
  });

  it('la base falla al confirmar después de cambiar la clave en el broker → 500 con el remedio; vía http no toca el broker', async () => {
    const { servicio, ordenes } = armar({ commitFalla: true });
    await expect(servicio.rotarCredencial(ID)).rejects.toThrow(/repetir la rotación/);
    await expect(servicio.rotarCredencial(ID)).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(comandos(ordenes)).toEqual(['setClientPassword', 'setClientPassword']);
    const http = armar({ fila: { estado: 'activo', via: 'http' }, disponible: false });
    const r = await http.servicio.rotarCredencial(ID);
    expect(r.conexion.via).toBe('http');
    expect((r.conexion as { token: string }).token).toHaveLength(32);
    expect(http.ordenes).toHaveLength(0);
  });

  it('más de 2 operaciones en curso → 429 antes de tocar la base, también para baja y rotación', async () => {
    const { servicio, sql } = armar();
    (servicio as unknown as { enCurso: number }).enCurso = 2;
    await expect(servicio.darDeBaja(ID)).rejects.toMatchObject({ status: 429 });
    await expect(servicio.rotarCredencial(ID)).rejects.toMatchObject({ status: 429 });
    expect(sql).toHaveLength(0);
  });
});
