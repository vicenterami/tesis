import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { POOL } from '../db/db.module.js';
import { registrarEvento } from '../db/evento.js';
import { isoUs } from '../db/iso-us.js';
import { CambioDispositivo, ReglaValidada, rechazo, validarReglas } from './configuracion.dto.js';
import { errorDeCliente } from '../db/cliente.js';

// Configuración desde el panel (docs/19 §4, E; docs/10 §8.4 punto 28) con BLOQUEO OPTIMISTA: el cambio exige el `actualizado_en` que
// entregó la ficha y es `UPDATE … WHERE id = $1 AND actualizado_en = $2`; si otra persona cambió la fila entretanto, 409 con el vigente y
// nada se pisa. El «antes» se lee con FOR NO KEY UPDATE en la misma transacción (dos ediciones a la vez no registran el mismo «antes»;
// NO KEY: las tramas del dispositivo no esperan, docs/16 §26). Cada guardado deja su `evento` con la persona (registrarEvento).

interface DispositivoBloqueado {
  id: string; nombre: string; estado: string; intervalo_esperado_s: number; zona_id: string; sitio_id: string; actualizado_en: string; al_dia: boolean;
}
interface CanalBloqueado {
  id: string; dispositivo_id: string; magnitud: string; unidad: string; etiqueta: string | null; actualizado_en: string;
  rango_min: number | null; rango_max: number | null;
}
interface ReglaGuardada extends ReglaValidada { id: string }

export interface CanalConReglas {
  id: string; dispositivo_id: string; magnitud: string; unidad: string; etiqueta: string | null; actualizado_en: string; reglas: ReglaGuardada[];
}

// Una fecha que la validación dejó pasar y la base no acepta (22007, 22008, 22P02) es 400, como en las demás escrituras (traducir de
// alta.service.ts); antes llegaba como 500. Lo demás sigue su curso.
export function traducirFecha(e: unknown): unknown {
  const codigo = (e as { code?: string } | null)?.code;
  if (codigo === '22007' || codigo === '22008' || codigo === '22P02') {
    return new BadRequestException({ statusCode: 400, error: 'Bad Request', message: ['actualizado_en: no es una fecha que la base acepte'], errores: [{ campo: 'actualizado_en', motivo: 'no es una fecha que la base acepte' }] });
  }
  return e;
}

function conflicto(vigente: string): ConflictException {
  return new ConflictException({
    statusCode: 409, error: 'Conflict', actualizado_en: vigente,
    message: `alguien lo cambió a las ${vigente.slice(11, 16)} UTC (${vigente}); recarga`,
  });
}

@Injectable()
export class ConfiguracionService {
  private readonly log = new Logger('configuracion');
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  private async transaccion<T>(trabajo: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    c.on('error', errorDeCliente); // si la base corta la conexión a mitad, falla esta petición y no el proceso (db/cliente.ts)
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL lock_timeout = '5s'");
      await c.query("SET LOCAL statement_timeout = '10s'");
      const r = await trabajo(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw traducirFecha(e);
    } finally {
      c.off('error', errorDeCliente);
      c.release();
    }
  }

  // PATCH /dispositivos/{id}: nombre, estado (activo o mantenimiento), intervalo esperado y zona (solo del mismo sitio). Devuelve el
  // `actualizado_en` nuevo; el controlador responde con la ficha completa.
  async cambiarDispositivo(id: string, cambio: CambioDispositivo, usuarioId: string | null): Promise<void> {
    await this.transaccion(async (c) => {
      const a = await c.query<DispositivoBloqueado>(
        `SELECT d.id, d.nombre, d.estado, d.intervalo_esperado_s, d.zona_id, z.sitio_id, ${isoUs('d.actualizado_en')} AS actualizado_en,
                (d.actualizado_en = $2::timestamptz) AS al_dia
           FROM dispositivo d JOIN zona z ON z.id = d.zona_id WHERE d.id = $1 FOR NO KEY UPDATE OF d`, [id, cambio.actualizado_en]);
      const antes = a.rows[0];
      if (antes === undefined) throw new NotFoundException('dispositivo no encontrado');
      // La comparación la hace la base, con microsegundos: un Date de JavaScript los perdería (punto 51).
      if (!antes.al_dia) throw conflicto(antes.actualizado_en);
      if (antes.estado === 'baja') throw new ConflictException('el dispositivo está dado de baja: no se configura');
      if (cambio.zona_id !== undefined && cambio.zona_id !== antes.zona_id) {
        const z = await c.query<{ sitio_id: string }>('SELECT sitio_id FROM zona WHERE id = $1', [cambio.zona_id]);
        // Otra zona del mismo sitio; una de otro sitio (o que no existe) se dice igual: no se revela que existe (RF-41).
        if (z.rows[0]?.sitio_id !== antes.sitio_id) throw rechazo([{ campo: 'zona_id', motivo: 'no es una zona de este sitio' }]);
      }
      const despues = {
        nombre: cambio.nombre ?? antes.nombre, estado: cambio.estado ?? antes.estado,
        intervalo_esperado_s: cambio.intervalo_esperado_s ?? antes.intervalo_esperado_s, zona_id: cambio.zona_id ?? antes.zona_id,
      };
      const cambiados = (Object.keys(despues) as (keyof typeof despues)[]).filter((k) => despues[k] !== antes[k]);
      if (cambiados.length === 0) return; // nada cambia: sin UPDATE ni evento, la marca sigue siendo la vigente
      const u = await c.query(
        `UPDATE dispositivo SET nombre = $2, estado = $3, intervalo_esperado_s = $4, zona_id = $5
          WHERE id = $1 AND actualizado_en = $6::timestamptz`,
        [id, despues.nombre, despues.estado, despues.intervalo_esperado_s, despues.zona_id, cambio.actualizado_en]);
      if (u.rowCount === 0) throw conflicto(antes.actualizado_en);
      await registrarEvento(c, {
        dispositivoId: id, tipo: 'dispositivo_configurado', usuarioId,
        detalle: {
          antes: Object.fromEntries(cambiados.map((k) => [k, antes[k]])),
          despues: Object.fromEntries(cambiados.map((k) => [k, despues[k]])),
          origen: 'api',
        },
      });
      this.log.log(`configuración: dispositivo ${id} (${cambiados.join(', ')})`);
    });
  }

  // PUT /canales/{id}/reglas: REEMPLAZA las reglas del canal (y su etiqueta). La marca es la del canal (`canal.actualizado_en`, la misma
  // de la calibración): se toca la fila del canal en cada guardado, así una sola marca protege la configuración entera del canal. Las
  // reglas se emparejan por `id` (decidido el 11/11/2026; antes, por posición, y una condición abierta quedaba apuntando a una regla con
  // otros umbrales): una con `id` actualiza esa regla (la condición abierta sigue con ella y se reevalúa con la trama siguiente); una sin
  // `id` es nueva; las guardadas que no vienen se cierran (con su evento) y se borran por fn_quitar_reglas (migración 23).
  // `fuera_de_banda_desde` vuelve a nulo: con umbrales nuevos, la cuenta del retardo empieza de cero.
  async reemplazarReglas(canalId: string, cuerpo: unknown, usuarioId: string | null): Promise<CanalConReglas> {
    return this.transaccion(async (c) => {
      const a = await c.query<CanalBloqueado>(
        `SELECT c.id, c.dispositivo_id, c.magnitud_codigo AS magnitud, m.unidad_canonica AS unidad, c.etiqueta, m.rango_min, m.rango_max,
                ${isoUs('c.actualizado_en')} AS actualizado_en
           FROM canal c JOIN magnitud m ON m.codigo = c.magnitud_codigo WHERE c.id = $1 FOR NO KEY UPDATE OF c`, [canalId]);
      const canal = a.rows[0];
      if (canal === undefined) throw new NotFoundException('canal no encontrado');
      const v = validarReglas(cuerpo, canal);
      const u = await c.query<{ actualizado_en: string }>(
        `UPDATE canal SET etiqueta = $2 WHERE id = $1 AND actualizado_en = $3::timestamptz RETURNING ${isoUs('actualizado_en')} AS actualizado_en`,
        [canalId, v.etiqueta, v.actualizado_en]);
      const nueva = u.rows[0];
      if (nueva === undefined) throw conflicto(canal.actualizado_en);
      const previas = await c.query<ReglaGuardada>(
        'SELECT id, umbral_alto, umbral_bajo, histeresis, retardo_s FROM regla_umbral WHERE canal_id = $1 ORDER BY id FOR UPDATE', [canalId]);
      const guardadas: ReglaGuardada[] = [];
      const ajenas = v.reglas.map((r, i) => ({ r, i })).filter(({ r }) => r.id !== undefined && !previas.rows.some((p) => p.id === r.id));
      if (ajenas.length > 0) throw rechazo(ajenas.map(({ i }) => ({ campo: `reglas[${i}].id`, motivo: 'no es una regla de este canal (recarga la ficha)' })));
      for (const { id: reglaId, ...r } of v.reglas) {
        if (reglaId !== undefined) {
          await c.query(
            `UPDATE regla_umbral SET umbral_alto = $2, umbral_bajo = $3, histeresis = $4, retardo_s = $5, fuera_de_banda_desde = NULL WHERE id = $1`,
            [reglaId, r.umbral_alto, r.umbral_bajo, r.histeresis, r.retardo_s]);
          guardadas.push({ id: reglaId, ...r });
        } else {
          const ins = await c.query<{ id: string }>(
            'INSERT INTO regla_umbral (canal_id, umbral_alto, umbral_bajo, histeresis, retardo_s) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [canalId, r.umbral_alto, r.umbral_bajo, r.histeresis, r.retardo_s]);
          guardadas.push({ id: ins.rows[0]?.id ?? '', ...r });
        }
      }
      const sobrantes = previas.rows.filter((p) => !guardadas.some((g) => g.id === p.id)).map((r) => r.id);
      let cerradas = 0;
      if (sobrantes.length > 0) {
        // Una condición de una regla que se quita ya no la cierra nadie: se cierra aquí, con su evento, antes de borrar la regla.
        const cc = await c.query<{ id: string }>(
          'UPDATE condicion SET cerrada_en = now() WHERE regla_id = ANY($1::uuid[]) AND cerrada_en IS NULL RETURNING id', [sobrantes]);
        cerradas = cc.rowCount ?? 0;
        for (const k of cc.rows) {
          await registrarEvento(c, { dispositivoId: canal.dispositivo_id, tipo: 'condicion_cerrada', usuarioId, detalle: { tipo: 'umbral', condicion_id: k.id, motivo: 'regla quitada' } });
        }
      }
      await c.query('SELECT fn_quitar_reglas($1::uuid, $2::uuid[])', [canalId, guardadas.map((g) => g.id)]);
      await registrarEvento(c, {
        dispositivoId: canal.dispositivo_id, tipo: 'reglas_cambiadas', usuarioId,
        detalle: {
          canal_id: canalId, magnitud: canal.magnitud, etiqueta: { antes: canal.etiqueta, despues: v.etiqueta },
          antes: previas.rows, despues: guardadas, condiciones_cerradas: cerradas, origen: 'api',
        },
      });
      this.log.log(`reglas: canal ${canalId} (${canal.magnitud}) ${previas.rows.length} → ${v.reglas.length}`);
      return { id: canal.id, dispositivo_id: canal.dispositivo_id, magnitud: canal.magnitud, unidad: canal.unidad, etiqueta: v.etiqueta, actualizado_en: nueva.actualizado_en, reglas: guardadas };
    });
  }
}
