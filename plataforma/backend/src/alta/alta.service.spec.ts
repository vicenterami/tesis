import { BadGatewayException, BadRequestException, ConflictException, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { ErrorDynsec, OrdenDynsec } from '../broker/dynsec';
import type { DynsecService } from '../broker/dynsec.service';
import { AltaValidada } from './alta.dto';
import { AltaService } from './alta.service';
import { verificarScrypt } from './credenciales';

// Los 400 llevan la lista de motivos en el cuerpo (`message`), no en el mensaje de la excepción.
const motivosDe = async (p: Promise<unknown>): Promise<string[]> => {
  const e = (await p.catch((x: unknown) => x)) as BadRequestException;
  return (e.getResponse() as { message: string[] }).message;
};

const Z = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';
const alta = (extra: Partial<AltaValidada> = {}): AltaValidada => ({
  id_fisico: 'nodo-01', nombre: 'Nodo', zona_id: Z, via: 'mqtt', formato: 'senml', pasarela_id: null, decodificador: null, intervalo_esperado_s: 60,
  canales: [{ magnitud: 'temperatura', etiqueta: null }, { magnitud: 'humedad', etiqueta: 'suelo' }], ...extra,
});

// Base y broker falsos: se registra cada consulta en orden y se responde según su prefijo.
function armar(opciones: { insertFalla?: string; insertRestriccion?: string; commitFalla?: boolean; brokerFalla?: Error; disponible?: boolean; pasarela?: { sitio_id: string; activo: boolean; formato?: string } | null } = {}) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  let canal = 0;
  const cliente = {
    query: async (texto: string, p: unknown[] = []) => {
      await Promise.resolve();
      sql.push(texto);
      params.push(p);
      if (texto.startsWith('SELECT z.sitio_id')) return { rows: p[0] === Z ? [{ sitio_id: 'S1', codigo: 'uct' }] : [] };
      if (texto.startsWith('SELECT sitio_id, activo, formato, id_fisico FROM pasarela')) return { rows: opciones.pasarela === null ? [] : [{ formato: 'milesight', id_fisico: 'pas-01', ...(opciones.pasarela ?? { sitio_id: 'S1', activo: true }) }] };
      if (texto.startsWith('SELECT codigo, unidad_canonica')) return { rows: [{ codigo: 'humedad', unidad_canonica: '%RH' }, { codigo: 'temperatura', unidad_canonica: 'Cel' }] };
      if (texto.startsWith('INSERT INTO dispositivo')) {
        if (opciones.insertFalla !== undefined) throw Object.assign(new Error('duplicate key'), { code: opciones.insertFalla, constraint: opciones.insertRestriccion });
        return { rows: [{ id: 'D1', creado_en: new Date('2026-10-12T20:00:00Z') }] };
      }
      if (texto.startsWith('INSERT INTO canal')) return { rows: [{ id: `C${++canal}` }] };
      if (texto === 'COMMIT' && opciones.commitFalla) throw new Error('la base se fue');
      return { rows: [] };
    },
    release: jest.fn(),
  };
  const ordenes: OrdenDynsec[][] = [];
  const dynsec = {
    disponible: opciones.disponible ?? true,
    ordenar: async (o: OrdenDynsec[]) => {
      await Promise.resolve();
      ordenes.push(o);
      if (opciones.brokerFalla && o[0].command === 'createClient') throw opciones.brokerFalla;
      return o.map((x) => ({ command: x.command }));
    },
  } as unknown as DynsecService;
  const pool = { connect: () => Promise.resolve(cliente) } as unknown as Pool;
  return { servicio: new AltaService(pool, dynsec), sql, params, ordenes, cliente };
}

describe('AltaService.crear (HU-11): todo o nada entre la base y el broker', () => {
  it('vía mqtt: transacción con dispositivo, canales, hash scrypt, evento; cliente creado en el broker ANTES del COMMIT; credencial una vez', async () => {
    const { servicio, sql, params, ordenes, cliente } = armar();
    const r = await servicio.crear(alta());
    expect(sql[0]).toBe('BEGIN');
    expect(sql.at(-1)).toBe('COMMIT');
    expect(sql.filter((s) => s.startsWith('INSERT INTO canal'))).toHaveLength(2);
    expect(sql.some((s) => s.startsWith('INSERT INTO evento'))).toBe(true);
    expect(ordenes).toHaveLength(1);
    expect(ordenes[0][0]).toMatchObject({ command: 'createClient', username: 'nodo-01', roles: [{ rolename: 'dispositivo' }] });
    expect(r.conexion.via).toBe('mqtt');
    const credencial = (r.conexion as { credencial: string }).credencial;
    expect(credencial).toHaveLength(32);
    expect(ordenes[0][0].password).toBe(credencial); // el broker recibe el secreto…
    const hash = params[sql.findIndex((s) => s.startsWith('INSERT INTO credencial'))][1] as string;
    expect(hash.startsWith('scrypt$')).toBe(true); // …y la base, solo su hash
    expect(await verificarScrypt(credencial, hash)).toBe(true);
    expect(JSON.stringify(params).includes(credencial)).toBe(false);
    expect((r.conexion as { topico: string }).topico).toBe('sitio/uct/dispositivo/nodo-01/<magnitud>');
    expect(r.canales.map((c) => c.unidad)).toEqual(['Cel', '%RH']);
    expect(cliente.release).toHaveBeenCalledTimes(1);
  });

  it('el broker no responde (error ambiguo) → 502, ROLLBACK, sin COMMIT, y se intenta borrar el cliente por si llegó a crearse', async () => {
    const { servicio, sql, ordenes } = armar({ brokerFalla: new ErrorDynsec('createClient', 'sin respuesta del broker en 5000 ms', true) });
    await expect(servicio.crear(alta())).rejects.toBeInstanceOf(BadGatewayException);
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
    expect(ordenes.map((o) => o[0].command)).toEqual(['createClient', 'deleteClient']);
  });

  it('un rechazo explícito del plugin (no ambiguo) no intenta borrar nada', async () => {
    const { servicio, ordenes } = armar({ brokerFalla: new ErrorDynsec('createClient', 'Role not found') });
    await expect(servicio.crear(alta())).rejects.toBeInstanceOf(BadGatewayException);
    expect(ordenes.map((o) => o[0].command)).toEqual(['createClient']);
  });

  it('más de 2 altas en curso → 429 antes de tocar la base', async () => {
    const { servicio, sql } = armar();
    (servicio as unknown as { enCurso: number }).enCurso = 2;
    await expect(servicio.crear(alta())).rejects.toMatchObject({ status: 429 });
    expect(sql).toHaveLength(0);
  });

  it('cliente huérfano en el broker («already exists») → 409 con el remedio, la base se deshace y NO se borra el ajeno', async () => {
    const { servicio, sql, ordenes } = armar({ brokerFalla: new ErrorDynsec('createClient', 'Client already exists') });
    await expect(servicio.crear(alta())).rejects.toThrow(/broker-cliente\.sh --borrar nodo-01/);
    await expect(servicio.crear(alta())).rejects.toBeInstanceOf(ConflictException);
    expect(sql).toContain('ROLLBACK');
    expect(ordenes.every((o) => o[0].command === 'createClient')).toBe(true);
  });

  it('id_fisico repetido en la base (23505) → 409 y el broker no se toca', async () => {
    const { servicio, ordenes } = armar({ insertFalla: '23505' });
    await expect(servicio.crear(alta())).rejects.toBeInstanceOf(ConflictException);
    expect(ordenes).toHaveLength(0);
  });

  it('la base falla al confirmar después de crear el cliente → se borra del broker y 500', async () => {
    const { servicio, ordenes } = armar({ commitFalla: true });
    await expect(servicio.crear(alta())).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(ordenes.map((o) => o[0].command)).toEqual(['createClient', 'deleteClient']);
  });

  it('sin conexión de administración y vía mqtt → 503 antes de abrir la transacción', async () => {
    const { servicio, sql } = armar({ disponible: false });
    await expect(servicio.crear(alta())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(sql).toHaveLength(0);
  });

  it('lorawan: sin credencial ni broker; la pasarela debe existir, estar activa y ser del mismo sitio', async () => {
    const { servicio, sql, ordenes } = armar();
    const r = await servicio.crear(alta({ via: 'lorawan', formato: null, pasarela_id: P }));
    expect(r.conexion.via).toBe('lorawan');
    expect(r.formato).toBe('milesight'); // lo copió de la pasarela: el nodo lorawan no declara formato (migración 15)
    expect(sql.find((s) => s.startsWith('SELECT sitio_id, activo, formato, id_fisico FROM pasarela'))).toContain('FOR SHARE'); // no se cruza con una baja
    expect(sql.some((s) => s.startsWith('INSERT INTO credencial'))).toBe(false);
    expect(ordenes).toHaveLength(0);
    expect(await motivosDe(armar({ pasarela: null }).servicio.crear(alta({ via: 'lorawan', formato: null, pasarela_id: P })))).toEqual(['pasarela_id no existe']);
    expect(await motivosDe(armar({ pasarela: { sitio_id: 'OTRO', activo: true } }).servicio.crear(alta({ via: 'lorawan', formato: null, pasarela_id: P })))).toEqual(['la pasarela pas-01 pertenece a otro sitio']);
    expect(await motivosDe(armar({ pasarela: { sitio_id: 'S1', activo: false } }).servicio.crear(alta({ via: 'lorawan', formato: null, pasarela_id: P })))).toEqual(['la pasarela pas-01 está dada de baja']);
  });

  it('lorawan: el nodo copia el formato de su pasarela (chirpstack) en el INSERT, el evento y la respuesta', async () => {
    const { servicio, sql, params } = armar({ pasarela: { sitio_id: 'S1', activo: true, formato: 'chirpstack' } });
    const r = await servicio.crear(alta({ via: 'lorawan', formato: null, pasarela_id: P }));
    const i = sql.findIndex((s) => s.startsWith('INSERT INTO dispositivo'));
    expect(params[i][5]).toBe('chirpstack');
    const e = sql.findIndex((s) => s.startsWith('INSERT INTO evento'));
    expect(JSON.parse(params[e][2] as string).formato).toBe('chirpstack');
    expect(r.formato).toBe('chirpstack');
  });

  it('la FK compuesta (el formato de la pasarela cambió entre la lectura y el INSERT) → 409 con el remedio', async () => {
    const { servicio } = armar({ insertFalla: '23503', insertRestriccion: 'fk_dispositivo_pasarela_formato' });
    await expect(servicio.crear(alta({ via: 'lorawan', formato: null, pasarela_id: P }))).rejects.toThrow('el formato de la pasarela cambió durante el alta');
  });

  it('zona inexistente o magnitud fuera del catálogo → 400 antes de insertar nada', async () => {
    const { servicio, sql } = armar();
    await expect(servicio.crear(alta({ zona_id: '33333333-3333-4333-8333-333333333333' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(await motivosDe(servicio.crear(alta({ canales: [{ magnitud: 'radiacion', etiqueta: null }] })))).toEqual(['magnitud desconocida: radiacion (catálogo: humedad, temperatura)']);
    expect(sql.some((s) => s.startsWith('INSERT'))).toBe(false);
  });
});
