import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Pool } from 'pg';
import { POOL } from '../db/db.module.js';
import { registrarEvento, registrarEventos } from '../db/evento.js';
import { isoUs } from '../db/iso-us.js';
import { TramaMalformada } from '../recepcion/adaptadores/adaptador.js';
import { aplicarReceta, type CampoReceta, type TipoCampo } from '../recepcion/adaptadores/receta.js';
import { candadoDelCatalogo, transaccionDelCatalogo } from './magnitudes.service.js';
import type { Prueba, RecetaDefinida } from './recetas.dto.js';

// Recetas de decodificación (TT-12, bloque 5; docs/10 §8.4 punto 69 vi a viii; docs/19 §4, T). Escritura única: una receta se crea con sus
// campos, juntos y una sola vez, por fn_crear_receta (la aplicación no tiene INSERT directo en las tablas de recetas), y no se edita ni se
// borra; corregirla es crear la -v2 y «reemplazar por». La recepción lee la receta de cada nodo con cada trama (bloque 3).

export interface Receta {
  codigo: string; nombre: string; largo_bytes: number; creado_en: string; equipos?: number;
  campos: { orden: number; magnitud: string; unidad: string; desplazamiento: number; tipo: string; sumar_antes: number; multiplicar_por: number; dividir_por: number }[];
}

const SELECT_RECETA = (conteos: boolean): string =>
  `SELECT r.codigo, r.nombre, r.largo_bytes, ${isoUs('r.creado_en')} AS creado_en,
          (SELECT json_agg(json_build_object('orden', f.orden, 'magnitud', f.magnitud_codigo, 'unidad', m.unidad_canonica, 'desplazamiento', f.desplazamiento,
                  'tipo', f.tipo, 'sumar_antes', f.sumar_antes, 'multiplicar_por', f.multiplicar_por, 'dividir_por', f.dividir_por) ORDER BY f.orden)
             FROM receta_campo f JOIN magnitud m ON m.codigo = f.magnitud_codigo WHERE f.receta_codigo = r.codigo) AS campos
          ${conteos ? ', (SELECT count(*)::int FROM dispositivo d WHERE d.decodificador = r.codigo) AS equipos' : ''}
     FROM receta_decodificacion r`;

// El motivo de una trama que no se entiende, sin el prefijo «perfil <código>» del registro: «se esperaban 10 bytes y llegaron 9».
const motivoLegible = (m: string): string => m.replace(/^perfil [^:,]*(?:: |, )/, '');

@Injectable()
export class RecetasService {
  private readonly log = new Logger('catalogo');
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  // El conteo de equipos abarca todos los sitios: solo con la acción `sistema` (docs/20 §6).
  async listar(conConteos: boolean): Promise<Receta[]> {
    return (await this.pool.query<Receta>(`${SELECT_RECETA(conConteos)} ORDER BY r.codigo`)).rows;
  }

  async crear(d: RecetaDefinida, usuarioId: string | null): Promise<Receta> {
    return transaccionDelCatalogo(this.pool, async (c) => {
      await candadoDelCatalogo(c);
      await this.exigirMagnitudes(c, d.campos.map((x) => x.magnitud));
      const existe = await c.query('SELECT 1 FROM receta_decodificacion WHERE codigo = $1', [d.codigo]);
      if (existe.rowCount === 1) throw new ConflictException({ statusCode: 409, error: 'Conflict', message: 'Ya hay una receta con ese código: para corregirla, crea otra (…-v2) y usa «Reemplazar por»' });
      // La forma de fn_crear_receta (migración 27): magnitud_codigo, y solo los factores que vinieron (los demás, sus valores por omisión).
      const campos = d.campos.map((x) => ({
        magnitud_codigo: x.magnitud, desplazamiento: x.desplazamiento, tipo: x.tipo,
        ...(x.sumar_antes === undefined ? {} : { sumar_antes: x.sumar_antes }),
        ...(x.multiplicar_por === undefined ? {} : { multiplicar_por: x.multiplicar_por }),
        ...(x.dividir_por === undefined ? {} : { dividir_por: x.dividir_por }),
      }));
      await c.query('SELECT fn_crear_receta($1, $2, $3, $4::jsonb)', [d.codigo, d.nombre, d.largo_bytes, JSON.stringify(campos)]);
      const creada = (await c.query<Receta>(`${SELECT_RECETA(false)} WHERE r.codigo = $1`, [d.codigo])).rows[0];
      if (creada === undefined) throw new NotFoundException('la receta no quedó guardada');
      const despues: Record<string, unknown> = { ...creada };
      delete despues.creado_en;
      await registrarEvento(c, { dispositivoId: null, tipo: 'catalogo_cambio', usuarioId, detalle: { objeto: 'receta', codigo: d.codigo, antes: null, despues } });
      this.log.log(`receta creada: ${d.codigo} (${d.largo_bytes} bytes, ${d.campos.length} campo(s))`);
      return creada;
    });
  }

  // Probar sin guardar (punto 69 viii): solo lee la unidad canónica de cada magnitud; no escribe nada. Una trama que no se entiende no es
  // un error de la petición: 200 con el motivo, para que la pantalla lo muestre junto a la receta.
  async probar(p: Prueba): Promise<{ ok: true; lecturas: { magnitud: string; valor: number; unidad: string }[] } | { ok: false; motivo: string }> {
    const unidades = await this.unidades(p.receta.campos.map((x) => x.magnitud));
    const faltan = p.receta.campos.map((x) => x.magnitud).filter((m) => !unidades.has(m));
    if (faltan.length > 0) throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: [`receta.campos: ${faltan.join(', ')} no es una magnitud del catálogo`] });
    const campos: CampoReceta[] = p.receta.campos.map((x) => ({
      magnitud: x.magnitud, unidad: unidades.get(x.magnitud) ?? '', desplazamiento: x.desplazamiento, tipo: x.tipo as TipoCampo,
      sumar_antes: x.sumar_antes ?? 0, multiplicar_por: x.multiplicar_por ?? 1, dividir_por: x.dividir_por ?? 1,
    }));
    try {
      const lecturas = aplicarReceta({ codigo: p.receta.codigo, largo_bytes: p.receta.largo_bytes, campos }, p.bytes);
      return { ok: true, lecturas: lecturas.map((l) => ({ magnitud: l.magnitud, valor: l.valor, unidad: l.unidad ?? '' })) };
    } catch (e) {
      if (e instanceof TramaMalformada) return { ok: false, motivo: motivoLegible(e.message) };
      throw e;
    }
  }

  // «Reemplazar por» (punto 69 vii): todos los equipos de una receta pasan a otra en una transacción. Un evento del catálogo (quién, de cuál a
  // cuál, cuántos) y uno por equipo (`dispositivo_configurado`, como el PATCH): la actividad de cada sitio lo muestra. Las tramas guardadas no
  // cambian; las siguientes se decodifican con la nueva.
  // Los dados de baja no se mueven (ya no reciben nada). La respuesta avisa si la receta nueva no es compatible a ciegas: otro largo (las tramas
  // del largo viejo quedarán malformadas) o magnitudes que la vieja no leía (los equipos podrían no tener esos canales: cuarentena «canal no
  // declarado»). No se impide: el cambio de firmware y el de receta pueden ir juntos (docs/10 §8.4 punto 69 vii).
  async reemplazar(codigo: string, por: string, usuarioId: string | null): Promise<{ codigo: string; por: string; dispositivos: number; avisos: string[] }> {
    return transaccionDelCatalogo(this.pool, async (c) => {
      await candadoDelCatalogo(c);
      const r = await c.query<{ codigo: string; largo_bytes: number; magnitudes: string[] }>(
        `SELECT r.codigo, r.largo_bytes, (SELECT array_agg(f.magnitud_codigo ORDER BY f.orden) FROM receta_campo f WHERE f.receta_codigo = r.codigo) AS magnitudes
           FROM receta_decodificacion r WHERE r.codigo = ANY($1::text[])`, [[codigo, por]]);
      if (!r.rows.some((x) => x.codigo === codigo)) throw new NotFoundException('receta no encontrada');
      if (!r.rows.some((x) => x.codigo === por)) throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: ['por: no es una receta del catálogo'] });
      const u = await c.query<{ id: string }>(
        `UPDATE dispositivo SET decodificador = $2 WHERE decodificador = $1 AND estado <> 'baja' RETURNING id`, [codigo, por]);
      const vieja = r.rows.find((x) => x.codigo === codigo);
      const nueva = r.rows.find((x) => x.codigo === por);
      const avisos: string[] = [];
      if (vieja && nueva && vieja.largo_bytes !== nueva.largo_bytes) avisos.push(`la receta nueva espera ${nueva.largo_bytes} bytes y la anterior ${vieja.largo_bytes}: las tramas del largo anterior quedarán malformadas`);
      const nuevas = (nueva?.magnitudes ?? []).filter((m) => !(vieja?.magnitudes ?? []).includes(m));
      if (nuevas.length > 0) avisos.push(`la receta nueva lee ${nuevas.join(', ')}, que la anterior no leía: los equipos sin ese canal enviarán esas lecturas a cuarentena`);
      const ids = u.rows.map((x) => x.id);
      await registrarEventos(c, ids.map((id) => ({
        dispositivoId: id, tipo: 'dispositivo_configurado', usuarioId,
        detalle: { antes: { decodificador: codigo }, despues: { decodificador: por }, origen: 'reemplazar_receta' },
      })));
      await registrarEvento(c, { dispositivoId: null, tipo: 'catalogo_cambio', usuarioId, detalle: { objeto: 'receta', codigo, accion: 'reemplazar', por, dispositivos: ids.length, avisos } });
      this.log.log(`receta reemplazada: ${codigo} → ${por} (${ids.length} equipo(s))`);
      return { codigo, por, dispositivos: ids.length, avisos };
    });
  }

  private async unidades(magnitudes: readonly string[]): Promise<Map<string, string>> {
    const r = await this.pool.query<{ codigo: string; unidad: string }>('SELECT codigo, unidad_canonica AS unidad FROM magnitud WHERE codigo = ANY($1::text[])', [magnitudes]);
    return new Map(r.rows.map((x) => [x.codigo, x.unidad]));
  }

  private async exigirMagnitudes(c: { query: Pool['query'] }, magnitudes: readonly string[]): Promise<void> {
    const r = await c.query<{ codigo: string }>('SELECT codigo FROM magnitud WHERE codigo = ANY($1::text[])', [magnitudes]);
    const faltan = magnitudes.filter((m) => !r.rows.some((x) => x.codigo === m));
    if (faltan.length > 0) throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: [`campos: ${faltan.join(', ')} no es una magnitud del catálogo`] });
  }
}
