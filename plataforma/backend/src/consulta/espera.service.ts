import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { POOL } from '../db/db.module.js';
import { errorDeCliente } from '../db/cliente.js';
import { registrarEvento } from '../db/evento.js';
import { ESPERA_CAMBIO, ESPERA_PRIMERA_TRAMA, EsperaSitio } from './espera.js';
import { SQL_ESPERA_HASTA } from './tablero.js';

// Cuántos equipos ACTIVOS del sitio que nunca enviaron una trama están hoy dentro de su plazo y con el propuesto quedarían vencidos. «Hoy
// dentro»: la misma expresión del estado visual (SQL_ESPERA_HASTA, el plazo del sitio) todavía en el futuro; «vencido con el propuesto»: su
// en_servicio_desde más el propuesto, ya pasado o ahora. Nunca enviaron: sin fila de estado o sin última trama (como el estado visual).
// En mantenimiento, de baja, ya vencidos, los de otro sitio y los que ya figuran «Sin señal» por una condición `sin_comunicacion` abierta
// (pueden estar dentro del plazo tras alargarlo, hasta el barrido siguiente: el estado visual ya los muestra así) no cuentan. Una sola consulta, de solo lectura.
export const SQL_AFECTADOS_POR_PLAZO = `SELECT count(*)::int AS n
  FROM dispositivo d JOIN zona z ON z.id = d.zona_id LEFT JOIN estado_dispositivo e ON e.dispositivo_id = d.id
  WHERE z.sitio_id = $1 AND d.estado = 'activo' AND e.visto_por_ultima_vez IS NULL
    AND NOT EXISTS (SELECT 1 FROM condicion cv WHERE cv.dispositivo_id = d.id AND cv.cerrada_en IS NULL AND cv.tipo = 'sin_comunicacion')
    AND now() < ${SQL_ESPERA_HASTA}
    AND d.en_servicio_desde + $2 * INTERVAL '1 hour' <= now()`;

// Leer y fijar el plazo de la primera trama de un sitio (docs/19 §4, P; docs/10 §8.4 punto 68). El permiso (leer o `ajustes` en ese sitio)
// lo resuelve el controlador antes de llegar aquí; el sitio es siempre el de la ruta.
@Injectable()
export class EsperaService {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  // Con `propuesto` (horas, ya validadas), suma `afectados` (SQL_AFECTADOS_POR_PLAZO): el aviso para quien acorta el plazo. Sin él, la respuesta
  // es la de siempre.
  async leer(sitioId: string, propuesto: number | null = null): Promise<EsperaSitio> {
    const r = await this.leerCon(this.pool, sitioId, false);
    if (propuesto === null) return r;
    const n = await this.pool.query<{ n: number }>(SQL_AFECTADOS_POR_PLAZO, [sitioId, propuesto]);
    return { ...r, afectados: n.rows[0]?.n ?? 0 };
  }

  // Fijarlo, con el mecanismo del k de la vista pública (EnlacesService.fijarMinimo): en una transacción, la fila del sitio bloqueada
  // (FOR NO KEY UPDATE: dos cambios a la vez se ordenan y el segundo ve lo que dejó el primero); con `anterior` (el que leyó quien lo cambia),
  // si ya no es el que rige, 409 `espera_cambio` con el vigente y nada cambia. Un valor igual al vigente no escribe ni deja evento. El evento
  // `espera_primera_trama` lleva quién lo fijó (usuario de la sesión), el valor y el anterior; la actividad del sitio (P14) lo muestra.
  // Rige en el barrido siguiente del supervisor.
  async fijar(sitioId: string, horas: number, usuarioId: string | null, anterior: number | null = null): Promise<EsperaSitio> {
    const c = await this.pool.connect();
    c.on('error', errorDeCliente); // si la base corta la conexión a mitad, falla esta petición y no el proceso (db/cliente.ts)
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL lock_timeout = '5s'");
      const antes = await this.leerCon(c, sitioId, true);
      if (anterior !== null && anterior !== antes.espera_primera_trama_h) {
        throw new ConflictException({ statusCode: 409, error: 'Conflict', codigo: 'espera_cambio', espera_primera_trama_h: antes.espera_primera_trama_h, message: ESPERA_CAMBIO(antes.espera_primera_trama_h) });
      }
      if (horas !== antes.espera_primera_trama_h) {
        await c.query('UPDATE sitio SET espera_primera_trama_h = $2 WHERE id = $1', [sitioId, horas]);
        await registrarEvento(c, { dispositivoId: null, tipo: 'espera_primera_trama', usuarioId, detalle: { sitio_id: sitioId, espera_primera_trama_h: horas, anterior: antes.espera_primera_trama_h } });
      }
      const despues = await this.leerCon(c, sitioId, false);
      await c.query('COMMIT');
      return despues;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.off('error', errorDeCliente);
      c.release();
    }
  }

  private async leerCon(c: Pick<PoolClient, 'query'>, sitioId: string, bloquear: boolean): Promise<EsperaSitio> {
    const r = await c.query<{ h: number }>(`SELECT espera_primera_trama_h AS h FROM sitio WHERE id = $1${bloquear ? ' FOR NO KEY UPDATE' : ''}`, [sitioId]);
    const f = r.rows[0];
    if (f === undefined) throw new NotFoundException('sitio no encontrado');
    return { espera_primera_trama_h: f.h, por_omision: ESPERA_PRIMERA_TRAMA.porOmision, minimo: ESPERA_PRIMERA_TRAMA.minimo, maximo: ESPERA_PRIMERA_TRAMA.maximo };
  }
}
