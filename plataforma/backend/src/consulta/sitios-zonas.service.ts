import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { POOL } from '../db/db.module.js';
import { errorDeCliente } from '../db/cliente.js';
import { registrarEvento } from '../db/evento.js';
import {
  CODIGO_REPETIDO, CambioSitio, CambioZona, EN_CURSO, SitioNuevo, ZONA_CON_DISPOSITIVOS, ZONA_HORARIA_DESCONOCIDA, ZONA_REPETIDA, ZONA_RETIRADA,
} from './sitios-zonas.js';

export interface ZonaDeSitio { id: string; sitio_id: string; nombre: string; activo: boolean; dispositivos: number }
export interface SitioCreado { id: string; codigo: string; nombre: string; zona_horaria: string; descripcion: string | null; zonas: ZonaDeSitio[] }

// Crear y cambiar sitios y zonas (docs/19 §4 U; migración 28). El permiso (acción `sistema` para sitios, `ajustes` en el sitio para zonas)
// lo resuelve el controlador antes de llegar aquí. Cada escritura va en una transacción con su evento (P14 Actividad, con la persona); los
// choques con los índices únicos (código del sitio; nombre de zona normalizado) se traducen a 409 con palabras de la persona. Un sitio
// inactivo es, para estas rutas, un sitio que no existe (404). Un bloqueo que no llega a tiempo (55P03, 57014) es 503: otro cambio sobre
// lo mismo está en curso, y se puede reintentar.
@Injectable()
export class SitiosZonasService {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  async crearSitio(s: SitioNuevo, usuarioId: string | null): Promise<SitioCreado> {
    return this.enTransaccion(async (c) => {
      // La zona horaria la decide la base: la misma lista que usa su disparador validar_zona_horaria (migración 03).
      const tz = await c.query('SELECT 1 FROM pg_timezone_names WHERE name = $1', [s.zona_horaria]);
      if (tz.rows.length === 0) throw new BadRequestException([ZONA_HORARIA_DESCONOCIDA(s.zona_horaria)]);
      const r = await c.query<{ id: string }>(
        'INSERT INTO sitio (nombre, codigo, zona_horaria, descripcion) VALUES ($1, $2, $3, $4) RETURNING id', [s.nombre, s.codigo, s.zona_horaria, s.descripcion],
      ).catch((e: unknown) => { throw traducir(e, { codigo: s.codigo }); });
      const id = r.rows[0].id;
      const zonaId = await insertarZona(c, id, s.primera_zona);
      await registrarEvento(c, { dispositivoId: null, tipo: 'sitio_alta', usuarioId, detalle: { sitio_id: id, codigo: s.codigo, nombre: s.nombre, zona_horaria: s.zona_horaria } });
      await registrarEvento(c, { dispositivoId: null, tipo: 'zona_alta', usuarioId, detalle: { sitio_id: id, zona_id: zonaId, nombre: s.primera_zona } });
      return this.leerSitio(c, id);
    });
  }

  async cambiarSitio(sitioId: string, cambio: CambioSitio, usuarioId: string | null): Promise<SitioCreado> {
    return this.enTransaccion(async (c) => {
      const a = await c.query<{ nombre: string; descripcion: string | null }>('SELECT nombre, descripcion FROM sitio WHERE id = $1 AND activo FOR NO KEY UPDATE', [sitioId]);
      const antes = a.rows[0];
      if (antes === undefined) throw new NotFoundException('sitio no encontrado');
      const nombre = cambio.nombre ?? antes.nombre;
      const descripcion = cambio.descripcion !== undefined ? cambio.descripcion : antes.descripcion;
      if (nombre !== antes.nombre || descripcion !== antes.descripcion) {
        await c.query('UPDATE sitio SET nombre = $2, descripcion = $3 WHERE id = $1', [sitioId, nombre, descripcion]);
        await registrarEvento(c, {
          dispositivoId: null, tipo: 'sitio_cambio', usuarioId,
          detalle: { sitio_id: sitioId, nombre, nombre_anterior: antes.nombre, descripcion_cambiada: descripcion !== antes.descripcion },
        });
      }
      return this.leerSitio(c, sitioId);
    });
  }

  async crearZona(sitioId: string, nombre: string, usuarioId: string | null): Promise<ZonaDeSitio> {
    return this.enTransaccion(async (c) => {
      const s = await c.query('SELECT 1 FROM sitio WHERE id = $1 AND activo', [sitioId]);
      if (s.rowCount === 0) throw new NotFoundException('sitio no encontrado');
      await exigirNombreLibre(c, sitioId, nombre, null);
      const id = await insertarZona(c, sitioId, nombre);
      await registrarEvento(c, { dispositivoId: null, tipo: 'zona_alta', usuarioId, detalle: { sitio_id: sitioId, zona_id: id, nombre } });
      return this.leerZona(c, id);
    });
  }

  // Renombrar y retirar (o volver a ofrecer). Retirar exige cero dispositivos activos (los de mantenimiento cuentan: siguen en servicio);
  // los dados de baja no impiden: su historia queda en dispositivo_zona. La fila de la zona se bloquea (FOR NO KEY UPDATE) y los dispositivos
  // se cuentan dentro de la misma transacción. Quien da de alta en esa zona toma antes FOR SHARE de la fila de la zona, que choca con este
  // bloqueo: el alta de a uno (AltaService.sitioDe), mover un dispositivo de zona (ConfiguracionService) y el alta masiva
  // (AltaService.crearLote, todas las zonas existentes del lote, exigiendo que sigan activas; la clave foránea del INSERT sola no basta:
  // toma un bloqueo que no choca con este). Así, o el alta termina antes y aquí se cuentan sus equipos (409), o espera a este retiro y la
  // ve retirada.
  async cambiarZona(zonaId: string, cambio: CambioZona, usuarioId: string | null): Promise<ZonaDeSitio> {
    return this.enTransaccion(async (c) => {
      const a = await c.query<{ sitio_id: string; nombre: string; activo: boolean }>(
        'SELECT z.sitio_id, z.nombre, z.activo FROM zona z JOIN sitio s ON s.id = z.sitio_id WHERE z.id = $1 AND s.activo FOR NO KEY UPDATE OF z', [zonaId]);
      const antes = a.rows[0];
      if (antes === undefined) throw new NotFoundException('zona no encontrada');
      if (cambio.activo === false && antes.activo) {
        const n = await c.query<{ n: number }>("SELECT count(*)::int AS n FROM dispositivo WHERE zona_id = $1 AND estado <> 'baja'", [zonaId]);
        if (n.rows[0].n > 0) throw new ConflictException({ statusCode: 409, error: 'Conflict', codigo: 'zona_con_dispositivos', dispositivos: n.rows[0].n, message: ZONA_CON_DISPOSITIVOS(n.rows[0].n) });
      }
      const nombre = cambio.nombre ?? antes.nombre;
      const activo = cambio.activo ?? antes.activo;
      if (nombre !== antes.nombre) await exigirNombreLibre(c, antes.sitio_id, nombre, zonaId);
      if (nombre !== antes.nombre || activo !== antes.activo) {
        await c.query('UPDATE zona SET nombre = $2, activo = $3 WHERE id = $1', [zonaId, nombre, activo])
          .catch((e: unknown) => { throw traducir(e, { zona: nombre }); });
        await registrarEvento(c, {
          dispositivoId: null, tipo: 'zona_cambio', usuarioId,
          detalle: { sitio_id: antes.sitio_id, zona_id: zonaId, nombre, nombre_anterior: antes.nombre, activo, activo_anterior: antes.activo },
        });
      }
      return this.leerZona(c, zonaId);
    });
  }

  private async leerZona(c: Pick<PoolClient, 'query'>, id: string): Promise<ZonaDeSitio> {
    const r = await c.query<ZonaDeSitio>(
      `SELECT z.id, z.sitio_id, z.nombre, z.activo,
              (SELECT count(*)::int FROM dispositivo d WHERE d.zona_id = z.id AND d.estado <> 'baja') AS dispositivos
         FROM zona z WHERE z.id = $1`, [id]);
    return r.rows[0];
  }

  private async leerSitio(c: Pick<PoolClient, 'query'>, id: string): Promise<SitioCreado> {
    const s = await c.query<Omit<SitioCreado, 'zonas'>>('SELECT id, codigo, nombre, zona_horaria, descripcion FROM sitio WHERE id = $1', [id]);
    const z = await c.query<ZonaDeSitio>(
      `SELECT z.id, z.sitio_id, z.nombre, z.activo,
              (SELECT count(*)::int FROM dispositivo d WHERE d.zona_id = z.id AND d.estado <> 'baja') AS dispositivos
         FROM zona z WHERE z.sitio_id = $1 ORDER BY z.nombre`, [id]);
    return { ...s.rows[0], zonas: z.rows };
  }

  private async enTransaccion<T>(f: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    c.on('error', errorDeCliente); // si la base corta la conexión a mitad, falla esta petición y no el proceso (db/cliente.ts)
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL lock_timeout = '5s'");
      await c.query("SET LOCAL statement_timeout = '10s'");
      const r = await f(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw enCurso(e);
    } finally {
      c.off('error', errorDeCliente);
      c.release();
    }
  }
}

// ¿Hay ya en el sitio otra zona con ese nombre normalizado, según la base (lower(btrim()), la clave del índice de la migración 28)? Si está
// retirada, 409 `zona_retirada` (se vuelve a ofrecer, no se crea otra: la persona tiene que saber que existe); si está activa,
// `zona_repetida`. Dentro de la transacción; la carrera entre dos que crean a la vez la sigue resolviendo el índice (23505, traducir).
async function exigirNombreLibre(c: Pick<PoolClient, 'query'>, sitioId: string, nombre: string, excepto: string | null): Promise<void> {
  const r = await c.query<{ nombre: string; activo: boolean }>(
    `SELECT nombre, activo FROM zona WHERE sitio_id = $1 AND lower(btrim(nombre)) = lower(btrim($2)) AND ($3::uuid IS NULL OR id <> $3::uuid)
      ORDER BY activo DESC LIMIT 1`, [sitioId, nombre, excepto]);
  const otra = r.rows[0];
  if (otra === undefined) return;
  if (!otra.activo) throw new ConflictException({ statusCode: 409, error: 'Conflict', codigo: 'zona_retirada', message: ZONA_RETIRADA(otra.nombre) });
  throw new ConflictException({ statusCode: 409, error: 'Conflict', codigo: 'zona_repetida', message: ZONA_REPETIDA(nombre) });
}

// Crear una zona en una transacción ya abierta (POST /sitios/{id}/zonas y la primera zona de POST /sitios). El choque con el índice
// normalizado es 409 con el nombre. (El lote con `zonas_nuevas_en` inserta las suyas en AltaService.crearLote, donde el 23505 es un plan
// que cambió.)
export async function insertarZona(c: Pick<PoolClient, 'query'>, sitioId: string, nombre: string): Promise<string> {
  const r = await c.query<{ id: string }>('INSERT INTO zona (sitio_id, nombre) VALUES ($1, $2) RETURNING id', [sitioId, nombre])
    .catch((e: unknown) => { throw traducir(e, { zona: nombre }); });
  return r.rows[0].id;
}

// Un bloqueo que no llegó a tiempo (55P03 lock_not_available por lock_timeout; 57014 por statement_timeout) → 503, como en
// sesion/usuarios.service.ts; lo demás sigue su camino.
function enCurso(e: unknown): unknown {
  const code = (e as { code?: string }).code;
  return code === '55P03' || code === '57014' ? new ServiceUnavailableException(EN_CURSO) : e;
}

// 23505 (unique_violation) del código del sitio o del nombre de una zona → 409 con palabras de la persona; lo demás sigue su camino.
function traducir(e: unknown, que: { codigo?: string; zona?: string }): unknown {
  const pg = e as { code?: string; constraint?: string };
  if (pg.code !== '23505') return e;
  if (que.codigo !== undefined && pg.constraint === 'uq_sitio_codigo') {
    return new ConflictException({ statusCode: 409, error: 'Conflict', codigo: 'codigo_repetido', message: CODIGO_REPETIDO(que.codigo) });
  }
  if (que.zona !== undefined && (pg.constraint === 'uq_zona_sitio_nombre_normalizado' || pg.constraint === 'zona_sitio_id_nombre_key')) {
    return new ConflictException({ statusCode: 409, error: 'Conflict', codigo: 'zona_repetida', message: ZONA_REPETIDA(que.zona) });
  }
  return e;
}
