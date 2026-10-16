import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { ErrorDynsec, OrdenDynsec, ROL_PASARELA } from '../broker/dynsec';
import type { DynsecService } from '../broker/dynsec.service';
import { AltaService } from './alta.service';
import { verificarScrypt } from './credenciales';
import { validarPasarela } from './pasarela.dto';

// Pasarelas por API (docs/10 §8.4 punto 47): el mismo todo o nada que un dispositivo, con base y broker falsos.
const S = '55555555-5555-4555-8555-555555555555';
const P = '66666666-6666-4666-8666-666666666666';
const cuerpo = { id_fisico: 'chirpstack-campus', nombre: 'ChirpStack del campus', sitio_id: S, formato: 'chirpstack' };

function armar(opciones: { sitio?: { codigo: string; activo: boolean } | null; fila?: { activo: boolean; formato?: string } | null; brokerFalla?: Error; disponible?: boolean; insertFalla?: string } = {}) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const cliente = {
    query: async (texto: string, p: unknown[] = []) => {
      await Promise.resolve();
      sql.push(texto);
      params.push(p);
      if (texto.startsWith('SELECT codigo, activo FROM sitio')) return { rows: opciones.sitio === null ? [] : [opciones.sitio ?? { codigo: 'uct', activo: true }] };
      if (texto.startsWith('INSERT INTO pasarela')) {
        if (opciones.insertFalla) throw Object.assign(new Error('duplicate key'), { code: opciones.insertFalla });
        return { rows: [{ id: P, creado_en: new Date('2026-10-15T23:00:00Z') }] };
      }
      if (texto.trimStart().startsWith('SELECT p.id, p.id_fisico, p.activo')) {
        return { rows: opciones.fila === null ? [] : [{ id: P, id_fisico: 'chirpstack-campus', sitio_codigo: 'uct', formato: 'chirpstack', ...(opciones.fila ?? { activo: true }) }] };
      }
      if (texto.startsWith('UPDATE credencial')) return { rows: [], rowCount: 1 };
      if (texto.startsWith('SELECT count(*) AS n FROM dispositivo')) return { rows: [{ n: '3' }] };
      if (texto.startsWith('INSERT INTO evento')) return { rows: [{ ocurrido_en: new Date('2026-10-15T23:05:00Z') }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
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
  return { servicio: new AltaService(pool, dynsec), sql, params, ordenes };
}

describe('validarPasarela', () => {
  it('normaliza el identificador y exige un formato de pasarela', () => {
    expect(validarPasarela({ ...cuerpo, id_fisico: 'ChirpStack-Campus' }).id_fisico).toBe('chirpstack-campus');
    expect(() => validarPasarela({ ...cuerpo, formato: 'senml' })).toThrow(BadRequestException);
    expect(() => validarPasarela({ ...cuerpo, activo: false })).toThrow(BadRequestException); // lo que pone el sistema no entra
    expect(() => validarPasarela({ ...cuerpo, id_fisico: 'backend' })).toThrow(BadRequestException);
  });
});

describe('AltaService: pasarelas (rutas B y C)', () => {
  it('alta: pasarela, hash de su credencial, evento sin dispositivo y cliente con rol pasarela ANTES del COMMIT; plantillas de ChirpStack', async () => {
    const { servicio, sql, params, ordenes } = armar();
    const r = await servicio.crearPasarela(validarPasarela(cuerpo));
    const i = (prefijo: string) => sql.findIndex((s) => s.startsWith(prefijo));
    expect(i('INSERT INTO pasarela')).toBeLessThan(i('INSERT INTO credencial'));
    expect(ordenes[0][0]).toMatchObject({ command: 'createClient', username: 'chirpstack-campus', roles: [{ rolename: ROL_PASARELA }] });
    expect(i('INSERT INTO evento')).toBeLessThan(sql.indexOf('COMMIT'));
    const hash = params[i('INSERT INTO credencial')][1] as string;
    expect(await verificarScrypt(r.conexion.credencial, hash)).toBe(true);
    expect(params.flat()).not.toContain(r.conexion.credencial); // el secreto no está en ningún parámetro SQL
    expect(r.conexion.plantillas).toEqual({
      event_topic: 'sitio/uct/pasarela/chirpstack-campus/{{dev_eui}}/{{event}}',
      command_topic: 'sitio/uct/pasarela/chirpstack-campus/{{dev_eui}}/command/{{command}}',
    });
    expect(JSON.parse(params[i('INSERT INTO evento')][1] as string)).toMatchObject({ pasarela_id: P, formato: 'chirpstack' });
  });
  it('alta milesight: la plantilla es el uplink con $devEUI, y la línea del puente de Mosquitto para el tópico nativo (16/10)', async () => {
    const r = await armar().servicio.crearPasarela(validarPasarela({ ...cuerpo, id_fisico: 'ug63-campus', formato: 'milesight' }));
    expect(r.conexion.plantillas).toEqual({
      uplink: 'sitio/uct/pasarela/ug63-campus/$devEUI/up',
      puente_mosquitto: 'topic device/# out 1 application/<app>/ sitio/uct/pasarela/ug63-campus/',
    });
  });
  it('alta: sitio inexistente o inactivo → 400 sin tocar el broker; sin administración del broker → 503', async () => {
    for (const sitio of [null, { codigo: 'uct', activo: false }]) {
      const { servicio, ordenes } = armar({ sitio });
      await expect(servicio.crearPasarela(validarPasarela(cuerpo))).rejects.toThrow(BadRequestException);
      expect(ordenes).toHaveLength(0);
    }
    await expect(armar({ disponible: false }).servicio.crearPasarela(validarPasarela(cuerpo))).rejects.toThrow(ServiceUnavailableException);
  });
  it('alta: el broker no responde (ambiguo) → ROLLBACK y se ordena borrar el cliente por si llegó a crearse', async () => {
    const { servicio, sql, ordenes } = armar({ brokerFalla: new ErrorDynsec('createClient', 'sin respuesta', true) });
    await expect(servicio.crearPasarela(validarPasarela(cuerpo))).rejects.toThrow();
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
    expect(ordenes.map((o) => o[0].command)).toEqual(['createClient', 'deleteClient']);
  });
  it('alta con un identificador ya usado (por una pasarela o un dispositivo) → 409, sin tocar el broker', async () => {
    const { servicio, ordenes } = armar({ insertFalla: '23505' });
    await expect(servicio.crearPasarela(validarPasarela(cuerpo))).rejects.toThrow(ConflictException);
    expect(ordenes).toHaveLength(0);
  });
  it('baja: activo = false, credenciales revocadas, nodos contados, evento y deleteClient ANTES del COMMIT', async () => {
    const { servicio, sql, ordenes } = armar();
    const r = await servicio.darDeBajaPasarela(P);
    expect(sql.find((s) => s.trimStart().startsWith('SELECT p.id'))).toContain('FOR NO KEY UPDATE OF p');
    expect(sql).toContain('UPDATE pasarela SET activo = false WHERE id = $1');
    expect(ordenes[0][0]).toMatchObject({ command: 'deleteClient', username: 'chirpstack-campus' });
    expect(r).toMatchObject({ activo: false, credenciales_revocadas: 1, nodos_sin_pasarela: 3 });
  });
  it('baja o rotación de una dada de baja → 409; de una inexistente → 404', async () => {
    await expect(armar({ fila: { activo: false } }).servicio.darDeBajaPasarela(P)).rejects.toThrow(ConflictException);
    await expect(armar({ fila: { activo: false } }).servicio.rotarPasarela(P)).rejects.toThrow(ConflictException);
    await expect(armar({ fila: null }).servicio.darDeBajaPasarela(P)).rejects.toThrow(NotFoundException);
  });
  it('rotación: credencial nueva con su hash, la anterior inactiva, setClientPassword antes del COMMIT, mismas plantillas', async () => {
    const { servicio, sql, ordenes } = armar();
    const r = await servicio.rotarPasarela(P);
    expect(sql.findIndex((s) => s.startsWith('UPDATE credencial'))).toBeLessThan(sql.findIndex((s) => s.startsWith('INSERT INTO credencial')));
    expect(ordenes[0][0]).toMatchObject({ command: 'setClientPassword', username: 'chirpstack-campus' });
    expect(r.conexion.plantillas.event_topic).toBe('sitio/uct/pasarela/chirpstack-campus/{{dev_eui}}/{{event}}');
  });
});
