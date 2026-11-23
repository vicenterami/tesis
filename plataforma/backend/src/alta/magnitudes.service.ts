import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { POOL } from '../db/db.module.js';
import { errorDeCliente } from '../db/cliente.js';
import { registrarEvento } from '../db/evento.js';
import { isoUs } from '../db/iso-us.js';
import { traducirFecha } from './configuracion.service.js';
import { CambioMagnitud, MagnitudNueva, erroresDeSugeridos } from './magnitudes.dto.js';
import { rechazo } from './configuracion.dto.js';

// Catálogo editable de magnitudes (TT-12, bloque 4; docs/10 §8.4 punto 69 i a v y x; docs/19 §4, T). Escribe solo quien administra el
// sistema (el controlador lo exige). Cada cambio, en una transacción con su evento `catalogo_cambio` (dispositivo nulo, la persona,
// {objeto, codigo, antes, despues}). La recepción lee el rango y los alias de la base con cada trama (bloque 3): lo guardado rige desde la
// trama siguiente, en todas las instancias, sin avisar a nadie.

export interface Magnitud {
  codigo: string; nombre: string; unidad: string; rango_min: number; rango_max: number;
  umbral_alto_sugerido: number | null; umbral_bajo_sugerido: number | null; histeresis_sugerida: number;
  alias: string[]; actualizado_en: string; canales?: number;
}

// Lo que deja fuera un rango más chico (docs/10 §8.4 punto 69 iii): una regla, un sugerido o una calibración existentes.
export interface FueraDeRango { tipo: 'regla' | 'calibracion'; canal_id: string; dispositivo_id: string; dispositivo: string; etiqueta: string | null; valores: number[] }
const MAX_FUERA = 50; // la lista del 409; el total va aparte

const SELECT_MAGNITUD = (conteos: boolean): string =>
  `SELECT m.codigo, m.nombre, m.unidad_canonica AS unidad, m.rango_min, m.rango_max, m.umbral_alto_sugerido, m.umbral_bajo_sugerido,
          m.histeresis_sugerida, coalesce((SELECT array_agg(a.clave ORDER BY a.clave) FROM magnitud_alias a WHERE a.magnitud_codigo = m.codigo), '{}') AS alias,
          ${isoUs('m.actualizado_en')} AS actualizado_en
          ${conteos ? ', (SELECT count(*)::int FROM canal c WHERE c.magnitud_codigo = m.codigo) AS canales' : ''}
     FROM magnitud m`;

const conflicto = (vigente: string): ConflictException => new ConflictException({
  statusCode: 409, error: 'Conflict', actualizado_en: vigente,
  message: `alguien cambió esta magnitud a las ${vigente.slice(11, 16)} UTC (${vigente}); revisa los valores nuevos y vuelve a guardar`,
});

@Injectable()
export class MagnitudesService {
  private readonly log = new Logger('catalogo');
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  // El conteo de canales abarca todos los sitios: solo con la acción `sistema` (docs/20 §6).
  async listar(conConteos: boolean): Promise<Magnitud[]> {
    return (await this.pool.query<Magnitud>(`${SELECT_MAGNITUD(conConteos)} ORDER BY m.codigo`)).rows;
  }

  async crear(n: MagnitudNueva, usuarioId: string | null): Promise<Magnitud> {
    return this.transaccion(async (c) => {
      await this.candadoDelCatalogo(c);
      await this.exigirAliasLibres(c, n.codigo, n.alias);
      try {
        await c.query(
          `INSERT INTO magnitud (codigo, nombre, unidad_canonica, rango_min, rango_max, umbral_alto_sugerido, umbral_bajo_sugerido, histeresis_sugerida)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [n.codigo, n.nombre, n.unidad, n.rango_min, n.rango_max, n.umbral_alto_sugerido, n.umbral_bajo_sugerido, n.histeresis_sugerida]);
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ConflictException({ statusCode: 409, error: 'Conflict', message: 'Ya hay una magnitud con ese código' });
        throw e;
      }
      for (const k of n.alias) await c.query('INSERT INTO magnitud_alias (clave, magnitud_codigo) VALUES ($1, $2)', [k, n.codigo]);
      const creada = await this.leer(c, n.codigo);
      const despues: Record<string, unknown> = { ...creada };
      delete despues.actualizado_en; // la foto es de los valores; la marca la tiene el evento (ocurrido_en)
      await registrarEvento(c, { dispositivoId: null, tipo: 'catalogo_cambio', usuarioId, detalle: { objeto: 'magnitud', codigo: n.codigo, antes: null, despues } });
      this.log.log(`magnitud creada: ${n.codigo} (${n.unidad}, ${n.alias.length} alias)`);
      return creada;
    });
  }

  async cambiar(codigo: string, cambio: CambioMagnitud, usuarioId: string | null): Promise<Magnitud> {
    return this.transaccion(async (c) => {
      await this.candadoDelCatalogo(c);
      // FOR NO KEY UPDATE: choca con el FOR SHARE que toman guardar las reglas de un canal y calibrarlo (configuracion.service.ts,
      // alta.service.ts), así una regla o una calibración nuevas y un rango más chico no se cruzan (docs/10 §8.4 punto 69 iii); y, como el
      // UPDATE no cambia la clave, no hace esperar al alta de un canal de esta magnitud (su clave foránea toma FOR KEY SHARE: revisión del
      // 23/11/2026; con FOR UPDATE esperaba).
      const a = await c.query<Magnitud>(`${SELECT_MAGNITUD(false)} WHERE m.codigo = $1 FOR NO KEY UPDATE OF m`, [codigo]);
      const antes = a.rows[0];
      if (antes === undefined) throw new NotFoundException('magnitud no encontrada');
      // La marca se compara tal cual la entregó GET /magnitudes (microsegundos, UTC): la fila ya está bloqueada, así que nadie la mueve entre
      // esta comparación y el UPDATE.
      if (antes.actualizado_en !== cambio.actualizado_en) throw conflicto(antes.actualizado_en);
      const nuevo = {
        nombre: cambio.nombre ?? antes.nombre,
        rango_min: cambio.rango_min ?? antes.rango_min,
        rango_max: cambio.rango_max ?? antes.rango_max,
        umbral_alto_sugerido: cambio.umbral_alto_sugerido !== undefined ? cambio.umbral_alto_sugerido : antes.umbral_alto_sugerido,
        umbral_bajo_sugerido: cambio.umbral_bajo_sugerido !== undefined ? cambio.umbral_bajo_sugerido : antes.umbral_bajo_sugerido,
        histeresis_sugerida: cambio.histeresis_sugerida ?? antes.histeresis_sugerida,
        alias: cambio.alias ?? antes.alias,
      };
      const errores = !(nuevo.rango_min < nuevo.rango_max)
        ? [{ campo: 'rango_min', motivo: `debe ser menor que rango_max (${nuevo.rango_max})` }]
        : erroresDeSugeridos(nuevo, nuevo);
      if (errores.length > 0) throw rechazo(errores);
      const campos = ['nombre', 'rango_min', 'rango_max', 'umbral_alto_sugerido', 'umbral_bajo_sugerido', 'histeresis_sugerida'] as const;
      const cambiados: string[] = campos.filter((k) => nuevo[k] !== antes[k]);
      const aliasNuevos = nuevo.alias.filter((k) => !antes.alias.includes(k));
      const aliasQuitados = antes.alias.filter((k) => !nuevo.alias.includes(k));
      if (aliasNuevos.length > 0 || aliasQuitados.length > 0) cambiados.push('alias');
      if (cambiados.length === 0) throw rechazo([{ campo: '(cuerpo)', motivo: 'nada que cambiar: los valores son los guardados' }]);

      // Achicar el rango se bloquea si deja fuera algo existente (docs/10 §8.4 punto 69 iii); ampliarlo, nunca.
      if (nuevo.rango_min > antes.rango_min || nuevo.rango_max < antes.rango_max) {
        const fuera = await this.fueraDeRango(c, codigo, nuevo.rango_min, nuevo.rango_max);
        if (fuera.total > 0) {
          throw new ConflictException({
            statusCode: 409, error: 'Conflict', fuera: fuera.lista, total: fuera.total,
            message: `el rango nuevo deja fuera ${fuera.total} regla(s) o calibración(es) de canales de esta magnitud: corrígelas antes o elige otro rango`,
          });
        }
      }
      await this.exigirAliasLibres(c, codigo, aliasNuevos);
      const u = await c.query<{ codigo: string }>(
        `UPDATE magnitud SET nombre = $2, rango_min = $3, rango_max = $4, umbral_alto_sugerido = $5, umbral_bajo_sugerido = $6, histeresis_sugerida = $7
          WHERE codigo = $1 RETURNING codigo`,
        [codigo, nuevo.nombre, nuevo.rango_min, nuevo.rango_max, nuevo.umbral_alto_sugerido, nuevo.umbral_bajo_sugerido, nuevo.histeresis_sugerida]);
      if (u.rowCount !== 1) throw new NotFoundException('magnitud no encontrada');
      for (const k of aliasNuevos) await c.query('INSERT INTO magnitud_alias (clave, magnitud_codigo) VALUES ($1, $2)', [k, codigo]);
      for (const k of aliasQuitados) await c.query('SELECT fn_quitar_alias($1)', [k]);
      const despues = await this.leer(c, codigo);
      const foto = (m: Magnitud): Record<string, unknown> => Object.fromEntries(cambiados.map((k) => [k, m[k as keyof Magnitud]]));
      await registrarEvento(c, { dispositivoId: null, tipo: 'catalogo_cambio', usuarioId, detalle: { objeto: 'magnitud', codigo, antes: foto(antes), despues: foto(despues) } });
      this.log.log(`magnitud cambiada: ${codigo} (${cambiados.join(', ')})`);
      return despues;
    });
  }

  // Cuántas mediciones de los últimos 7 días, y de cuántos canales, habrían quedado fuera del rango propuesto (no guarda nada). Cuenta en
  // todos los sitios: solo la acción `sistema` (docs/20 §6). El valor guardado está en la unidad canónica, la misma del rango.
  async impacto(codigo: string, rango_min: number, rango_max: number): Promise<{ codigo: string; rango_min: number; rango_max: number; dias: number; mediciones: number; canales: number }> {
    // En una transacción corta solo por su statement_timeout (10 s): recorre 7 días de `medicion` y el pool de la aplicación tiene 5 conexiones.
    return this.transaccion(async (c) => {
    const m = await c.query('SELECT 1 FROM magnitud WHERE codigo = $1', [codigo]);
    if (m.rowCount !== 1) throw new NotFoundException('magnitud no encontrada');
    const r = await c.query<{ mediciones: number; canales: number }>(
      `SELECT count(*)::int AS mediciones, count(DISTINCT x.canal_id)::int AS canales
         FROM medicion x JOIN canal k ON k.id = x.canal_id
        WHERE k.magnitud_codigo = $1 AND x.tiempo >= now() - interval '7 days' AND (x.valor < $2 OR x.valor > $3)`,
      [codigo, rango_min, rango_max]);
    return { codigo, rango_min, rango_max, dias: 7, ...(r.rows[0] ?? { mediciones: 0, canales: 0 }) };
    });
  }

  // Las escrituras del catálogo, de a una (pocas y de una sola persona: el administrador del sistema). Sin esto, dos altas o dos cambios
  // que agregan el mismo alias a la vez no se ven en exigirAliasLibres y el segundo chocaba con la clave primaria como 500 (revisión del
  // 23/11/2026). Es un candado de la transacción: se suelta solo con el COMMIT o el ROLLBACK.
  private async candadoDelCatalogo(c: PoolClient): Promise<void> {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('catalogo_magnitudes'))");
  }

  private async leer(c: PoolClient, codigo: string): Promise<Magnitud> {
    const r = await c.query<Magnitud>(`${SELECT_MAGNITUD(false)} WHERE m.codigo = $1`, [codigo]);
    if (r.rows[0] === undefined) throw new NotFoundException('magnitud no encontrada');
    return r.rows[0];
  }

  // Una clave apunta a una sola magnitud en todo el catálogo: si ya es de otra, 409 con su nombre (docs/19 §4, T, punto 3).
  private async exigirAliasLibres(c: PoolClient, codigo: string, claves: readonly string[]): Promise<void> {
    if (claves.length === 0) return;
    const r = await c.query<{ clave: string; nombre: string }>(
      `SELECT a.clave, m.nombre FROM magnitud_alias a JOIN magnitud m ON m.codigo = a.magnitud_codigo
        WHERE a.clave = ANY($1::text[]) AND a.magnitud_codigo <> $2 ORDER BY a.clave`, [claves, codigo]);
    if (r.rows.length > 0) {
      throw new ConflictException({
        statusCode: 409, error: 'Conflict', alias: r.rows,
        message: r.rows.map((x) => `La clave «${x.clave}» ya es alias de «${x.nombre}»`).join('; ') + ': una clave apunta a una sola magnitud',
      });
    }
  }

  // Las reglas y calibraciones de canales de la magnitud con algún valor fuera de [min, max]. Las reglas se leen con la magnitud ya
  // bloqueada (FOR UPDATE): una regla que se esté guardando espera, o ya está aquí.
  private async fueraDeRango(c: PoolClient, codigo: string, min: number, max: number): Promise<{ total: number; lista: FueraDeRango[] }> {
    const r = await c.query<FueraDeRango & { total: number }>(
      `WITH f AS (
         SELECT 'regla' AS tipo, k.id AS canal_id, d.id AS dispositivo_id, d.nombre AS dispositivo, k.etiqueta,
                array_remove(ARRAY[r.umbral_alto, r.umbral_bajo], NULL) AS valores
           FROM regla_umbral r JOIN canal k ON k.id = r.canal_id JOIN dispositivo d ON d.id = k.dispositivo_id
          WHERE k.magnitud_codigo = $1 AND (r.umbral_alto < $2 OR r.umbral_alto > $3 OR r.umbral_bajo < $2 OR r.umbral_bajo > $3)
         UNION ALL
         SELECT 'calibracion', k.id, d.id, d.nombre, k.etiqueta, ARRAY[k.escala_cero, k.escala_cien]
           FROM canal k JOIN dispositivo d ON d.id = k.dispositivo_id
          WHERE k.magnitud_codigo = $1 AND k.escala_cero IS NOT NULL
            AND (k.escala_cero < $2 OR k.escala_cero > $3 OR k.escala_cien < $2 OR k.escala_cien > $3))
       SELECT *, count(*) OVER ()::int AS total FROM f ORDER BY dispositivo, tipo LIMIT ${MAX_FUERA}`,
      [codigo, min, max]);
    return { total: r.rows[0]?.total ?? 0, lista: r.rows.map(({ total: _t, ...x }) => x) };
  }

  private async transaccion<T>(trabajo: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    c.on('error', errorDeCliente);
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL lock_timeout = '5s'");
      await c.query("SET LOCAL statement_timeout = '10s'");
      const r = await trabajo(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      const codigoPg = (e as { code?: string }).code;
      // Una espera de bloqueo vencida o una consulta cortada por tiempo: 503 «reintenta», como alta.service.ts y usuarios.service.ts.
      if (codigoPg === '55P03' || codigoPg === '57014' || codigoPg === '25P03') {
        throw new ServiceUnavailableException('otro cambio del catálogo está en curso o la base no responde; reintenta en unos segundos');
      }
      // Lo que la validación dejó pasar y la base no acepta: 23505 (una carrera que el candado no cubrió) es 409; 23514, 400 con su motivo.
      if (codigoPg === '23505') throw new ConflictException({ statusCode: 409, error: 'Conflict', message: 'el catálogo cambió entretanto (un código o un alias ya existe); recarga y vuelve a intentar' });
      if (codigoPg === '23514') {
        throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: [`la base rechazó el cambio (${(e as { constraint?: string }).constraint ?? 'CHECK'})`] });
      }
      throw traducirFecha(e);
    } finally {
      c.off('error', errorDeCliente);
      c.release();
    }
  }
}
