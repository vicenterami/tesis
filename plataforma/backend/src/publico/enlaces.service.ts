import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { POOL } from '../db/db.module.js';
import { errorDeCliente } from '../db/cliente.js';
import { registrarEvento } from '../db/evento.js';
import { SQL_PUBLICO_LECTURA_VIGENTE } from '../consulta/tablero.js';
import {
  EstadoEnlace, FilaVigencia, MagnitudCatalogo, NO_RENOVABLE, RenovacionValidada, VentanaPublica, VistaPublica, VistaValidada, ZonaPublicada,
  K_MAXIMO, SQL_ENLACE_VIVO, ZonaDelSitio, ZonasDeMagnitud, avisosDeMinimo, armarVista, avisosPorMagnitud, direccionDelEnlace, estadoEnlace, generarToken, hashToken, kSitio, nuevoVencimiento, renovable,
} from './publico.js';
import { VistaPublicaService } from './vista-publica.service.js';

// Un enlace como lo ve quien administra el sitio (docs/19 §4, O, punto 10). Nunca el token ni su resumen: el token se muestra una sola vez,
// al crear.
export interface EnlaceListado {
  id: string; titulo: string; descripcion: string | null; magnitudes: MagnitudCatalogo[]; ventana_maxima: VentanaPublica;
  zonas: ZonaPublicada[]; creado_por: { id: string; nombre: string } | null; creado_en: string;
  expira_en: string; renovado_en: string | null; revocado_en: string | null; revocado_por: { id: string; nombre: string } | null;
  accesos_7d: number; estado: EstadoEnlace; renovable: boolean; retencion_dias: number; anonimizado_en: string | null;
}
export interface EnlaceCreado extends EnlaceListado { token: string; direccion: string; avisos: string[] }
export interface VistaPrevia extends VistaPublica { avisos: string[] }
export interface EnlaceRenovado extends EnlaceListado { expira_en_anterior: string; acorta: boolean }

type FilaEnlace = Omit<EnlaceListado, 'estado' | 'renovable'> & { ahora: string };

// La lectura de la lista (y de un enlace, con $2): lo que la pantalla muestra, con los accesos de los últimos 7 días del sitio (por su zona
// horaria) y la hora de la base, con la que se calculan el estado y si se puede renovar.
const SQL_LISTA = `
      SELECT e.id, e.titulo, e.descripcion, e.ventana_maxima, e.zonas, e.retencion_dias, iso_utc(e.anonimizado_en) AS anonimizado_en,
             (SELECT coalesce(json_agg(json_build_object('codigo', m.codigo, 'nombre', m.nombre, 'unidad', m.unidad_canonica)
                                       ORDER BY array_position(e.magnitudes, m.codigo)), '[]'::json)
                FROM magnitud m WHERE m.codigo = ANY(e.magnitudes)) AS magnitudes,
             CASE WHEN uc.id IS NULL THEN NULL ELSE json_build_object('id', uc.id, 'nombre', uc.nombre) END AS creado_por,
             CASE WHEN ur.id IS NULL THEN NULL ELSE json_build_object('id', ur.id, 'nombre', ur.nombre) END AS revocado_por,
             iso_utc(e.creado_en) AS creado_en, iso_utc(e.expira_en) AS expira_en, iso_utc(e.renovado_en) AS renovado_en,
             iso_utc(e.revocado_en) AS revocado_en,
             (SELECT coalesce(sum(a.cuenta), 0)::int FROM enlace_publico_acceso a
               WHERE a.enlace_id = e.id AND a.dia > (now() AT TIME ZONE s.zona_horaria)::date - 7) AS accesos_7d,
             iso_utc(now()) AS ahora
        FROM enlace_publico e JOIN sitio s ON s.id = e.sitio_id
        LEFT JOIN usuario uc ON uc.id = e.creado_por LEFT JOIN usuario ur ON ur.id = e.revocado_por
       WHERE e.sitio_id = $1 AND ($2::uuid IS NULL OR e.id = $2) AND ($3::boolean OR ${SQL_ENLACE_VIVO})
       ORDER BY e.creado_en DESC, e.id DESC`;

export const TOPE_ENLACES = (n: number): string => `Este sitio ya tiene ${n} enlaces. Revoca uno para crear otro.`;
export interface MinimoSitio { minimo_dispositivos: number; fijado: boolean; por_omision: number; piso: number; maximo: number }
export interface TopeEnlaces { max_enlaces: number; fijado: boolean; por_omision: number; techo: number; vivos: number }

// Crear, listar, renovar y revocar enlaces y la vista previa (docs/19 §4, O, puntos 3, 4 y 10). El permiso (acción `enlaces` en el sitio)
// lo resuelve el controlador antes de llegar aquí; aquí el sitio del enlace es siempre el de la ruta, en el WHERE.
@Injectable()
export class EnlacesService {
  constructor(@Inject(POOL) private readonly pool: Pool, private readonly vista: VistaPublicaService) {}

  // Por omisión, solo los vivos (decidido el 17/11/2026); `todos`, también los muertos (revocados o ya no renovables), que no se borran.
  async listar(sitioId: string, todos = false): Promise<EnlaceListado[]> {
    const r = await this.pool.query<FilaEnlace>(SQL_LISTA, [sitioId, null, todos]);
    return r.rows.map(conEstado);
  }

  // El tope de enlaces vivos del sitio: el que fijó su administrador (o el del despliegue), el techo y cuántos hay vivos.
  async tope(sitioId: string): Promise<TopeEnlaces> {
    return this.leerTope(this.pool, sitioId);
  }
  // Fijarlo: dentro del techo (validado antes); con el candado de las altas de ese sitio, y un evento `enlace_tope` con quién. Bajarlo por
  // debajo de los vivos que hay no revoca nada: solo impide crear otro hasta que haya lugar.
  async fijarTope(sitioId: string, max: number, usuarioId: string | null): Promise<TopeEnlaces> {
    return this.enTransaccion(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('enlace_publico:' || $1::text))", [sitioId]);
      const antes = await this.leerTope(c, sitioId);
      await c.query('UPDATE sitio SET enlaces_publicos_max = $2 WHERE id = $1', [sitioId, max]);
      await registrarEvento(c, { dispositivoId: null, tipo: 'enlace_tope', usuarioId, detalle: { sitio_id: sitioId, max_enlaces: max, anterior: antes.max_enlaces } });
      return this.leerTope(c, sitioId);
    });
  }
  private async leerTope(c: Pick<PoolClient, 'query'>, sitioId: string): Promise<TopeEnlaces> {
    const r = await c.query<{ fijado: number | null; vivos: number }>(`
      SELECT s.enlaces_publicos_max AS fijado, (SELECT count(*)::int FROM enlace_publico e WHERE e.sitio_id = s.id AND ${SQL_ENLACE_VIVO}) AS vivos
        FROM sitio s WHERE s.id = $1`, [sitioId]);
    const f = r.rows[0];
    if (f === undefined) throw new NotFoundException('sitio no encontrado');
    const l = this.vista.limites;
    return { max_enlaces: Math.min(f.fijado ?? l.maxEnlacesPorSitio, l.maxEnlacesTecho), fijado: f.fijado !== null, por_omision: l.maxEnlacesPorSitio, techo: l.maxEnlacesTecho, vivos: f.vivos };
  }

  // La vista previa: los datos con la MISMA función que GET /publico (calcular y armarDatos), con su propio cupo y sin guardar nada; las
  // zonas, con el nombre que tienen hoy (el que se publicaría). Más los avisos de lo que un visitante podría deducir (decidido el 17/11/2026).
  async previa(sitioId: string, v: VistaValidada): Promise<VistaPrevia> {
    const s = await this.pool.query<{ nombre: string; zona_horaria: string; k_sitio: number | null }>(
      'SELECT nombre, zona_horaria, publico_minimo_dispositivos AS k_sitio FROM sitio WHERE id = $1', [sitioId]);
    const sitio = s.rows[0];
    if (sitio === undefined) throw new NotFoundException('sitio no encontrado');
    await this.exigirMagnitudes(this.pool, v.magnitudes);
    const zonas = await this.zonasDelSitio(this.pool, sitioId, v.zonas);
    const k = kSitio(sitio.k_sitio, this.vista.limites); // el k del sitio: todos sus enlaces ocultan lo mismo (punto 2)
    const datos = await this.vista.calcularPrevia({ sitioId, zonaHoraria: sitio.zona_horaria, magnitudes: v.magnitudes, zonas, k, ventana: v.ventana });
    const vista = armarVista({ titulo: v.titulo, descripcion: v.descripcion, sitio: sitio.nombre, zona_horaria: sitio.zona_horaria, k, ventana: v.ventana, ventana_maxima: v.ventana_maxima }, datos);
    return { ...vista, avisos: await this.avisos(this.pool, sitioId, v, k) };
  }

  // Crear: todo o nada. Un candado por sitio ordena dos altas simultáneas para que el tope de enlaces no se pase; el token sale de aquí una
  // sola vez y la base guarda su resumen. Evento `enlace_creado` con el sitio en su detalle (la actividad del sitio lo muestra).
  async crear(sitioId: string, v: VistaValidada, usuarioId: string | null): Promise<EnlaceCreado> {
    return this.enTransaccion(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('enlace_publico:' || $1::text))", [sitioId]);
      await this.exigirMagnitudes(c, v.magnitudes);
      const zonas = await this.zonasDelSitio(c, sitioId, v.zonas);
      // Cuentan solo los vivos (no revocados, vigentes o aún renovables; decidido el 17/11/2026) contra el tope que fijó el administrador.
      const { max_enlaces: tope, vivos } = await this.leerTope(c, sitioId);
      if (vivos >= tope) throw new ConflictException({ statusCode: 409, error: 'Conflict', codigo: 'tope_enlaces', message: TOPE_ENLACES(tope) });
      const ks = await c.query<{ k: number | null }>('SELECT publico_minimo_dispositivos AS k FROM sitio WHERE id = $1', [sitioId]);
      const k = kSitio(ks.rows[0]?.k, this.vista.limites);
      const avisos = await this.avisos(c, sitioId, v, k);
      const token = generarToken();
      const r = await c.query<{ id: string; expira_en: string }>(`
        INSERT INTO enlace_publico (sitio_id, token_hash, magnitudes, ventana_maxima, zonas, titulo, descripcion, creado_por, expira_en, retencion_dias)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(days => $9), $10)
        RETURNING id, iso_utc(expira_en) AS expira_en`,
        [sitioId, hashToken(token), v.magnitudes, v.ventana_maxima, JSON.stringify(zonas), v.titulo, v.descripcion, usuarioId, v.plazo_dias, v.retencion_dias]);
      const id = r.rows[0].id;
      await registrarEvento(c, {
        dispositivoId: null, tipo: 'enlace_creado', usuarioId,
        // El k del sitio que rige al publicar y cuántos avisos se le mostraron a quien publicó: el rastro de su decisión (decidido el 17/11/2026).
        detalle: {
          sitio_id: sitioId, enlace_id: id, plazo_dias: v.plazo_dias, expira_en: r.rows[0].expira_en, k_sitio: k,
          k_por_omision: this.vista.limites.kPorOmision, avisos: avisos.length, retencion_dias: v.retencion_dias,
        },
      });
      const fila = await this.uno(c, sitioId, id);
      return { ...fila, token, direccion: direccionDelEnlace(token), avisos };
    });
  }

  // Renovar: fija el vencimiento en hoy (reloj de la base) más el plazo, sin cambiar el token. Solo un enlace no revocado, vencido hace 30
  // días o menos y de menos de un año (NO_RENOVABLE, 409). Si el plazo acorta el vencimiento que tenía, 409 con las dos fechas salvo que
  // venga `acortar: true` (decidido al implementar, 17/11/2026: el aviso del punto 4 lo confirma el servidor, no solo la pantalla).
  async renovar(sitioId: string, enlaceId: string, r: RenovacionValidada, usuarioId: string | null): Promise<EnlaceRenovado> {
    return this.enTransaccion(async (c) => {
      const f = await c.query<FilaVigencia & { ahora: string }>(`
        SELECT iso_utc(creado_en) AS creado_en, iso_utc(expira_en) AS expira_en, iso_utc(revocado_en) AS revocado_en, iso_utc(now()) AS ahora
          FROM enlace_publico WHERE id = $1 AND sitio_id = $2 FOR UPDATE`, [enlaceId, sitioId]);
      const fila = f.rows[0];
      if (fila === undefined) throw new NotFoundException('enlace no encontrado');
      const ahora = new Date(fila.ahora);
      if (!renovable(fila, ahora)) throw new ConflictException({ statusCode: 409, error: 'Conflict', codigo: 'no_renovable', message: NO_RENOVABLE });
      const nuevo = nuevoVencimiento(fila, ahora, r.plazo_dias);
      if (nuevo.acorta && !r.acortar) {
        throw new ConflictException({
          statusCode: 409, error: 'Conflict', codigo: 'acorta', expira_en_actual: fila.expira_en, expira_en_nueva: nuevo.expira_en.toISOString(),
          message: 'con este plazo el enlace vencerá antes de lo que vencía: confírmalo con «acortar: true» o elige otro plazo',
        });
      }
      const u = await c.query<{ expira_en: string }>(`
        UPDATE enlace_publico SET renovado_en = now(), expira_en = now() + make_interval(days => $3)
         WHERE id = $1 AND sitio_id = $2 RETURNING iso_utc(expira_en) AS expira_en`, [enlaceId, sitioId, r.plazo_dias]);
      await registrarEvento(c, {
        dispositivoId: null, tipo: 'enlace_renovado', usuarioId,
        detalle: { sitio_id: sitioId, enlace_id: enlaceId, plazo_dias: r.plazo_dias, expira_en: u.rows[0].expira_en, expira_en_anterior: fila.expira_en },
      });
      const listado = await this.uno(c, sitioId, enlaceId);
      return { ...listado, expira_en_anterior: fila.expira_en, acorta: nuevo.acorta };
    });
  }

  // Revocar: no se deshace. Uno ya revocado, 409; uno que no existe o es de otro sitio, 404. Corta en la petición siguiente: GET /publico lee
  // la fila antes que lo guardado (y aquí, además, se libera lo guardado en este proceso).
  async revocar(sitioId: string, enlaceId: string, usuarioId: string | null): Promise<EnlaceListado> {
    const listado = await this.enTransaccion(async (c) => {
      const u = await c.query<{ id: string }>(`
        UPDATE enlace_publico SET revocado_en = now(), revocado_por = $3
         WHERE id = $1 AND sitio_id = $2 AND revocado_en IS NULL RETURNING id`, [enlaceId, sitioId, usuarioId]);
      if (u.rows.length === 0) {
        const existe = await c.query('SELECT 1 FROM enlace_publico WHERE id = $1 AND sitio_id = $2', [enlaceId, sitioId]);
        if (existe.rows.length === 0) throw new NotFoundException('enlace no encontrado');
        throw new ConflictException('el enlace ya estaba revocado');
      }
      await registrarEvento(c, { dispositivoId: null, tipo: 'enlace_revocado', usuarioId, detalle: { sitio_id: sitioId, enlace_id: enlaceId } });
      return this.uno(c, sitioId, enlaceId);
    });
    this.vista.olvidar(enlaceId);
    return listado;
  }

  private async uno(c: Pick<PoolClient, 'query'>, sitioId: string, enlaceId: string): Promise<EnlaceListado> {
    const r = await c.query<FilaEnlace>(SQL_LISTA, [sitioId, enlaceId, true]);
    const fila = r.rows[0];
    if (fila === undefined) throw new NotFoundException('enlace no encontrado');
    return conEstado(fila);
  }

  // Los equipos de hoy de cada zona del sitio, POR MAGNITUD (como la regla, revisión final del 17/11/2026): los MISMOS que cuenta «ahora»
  // en la vista (SQL_PUBLICO_LECTURA_VIGENTE: una lectura vigente de esa magnitud, atribuida a la zona donde se tomó). Cada magnitud trae
  // todas las zonas del sitio (con 0 las que no tienen equipos), en el orden en que se pidieron las magnitudes.
  private async equiposPorZona(c: Pick<PoolClient, 'query'>, sitioId: string, magnitudes: string[]): Promise<ZonasDeMagnitud[]> {
    const r = await c.query<ZonaDelSitio & { magnitud: string; codigo: string }>(`
      WITH lectura AS (${SQL_PUBLICO_LECTURA_VIGENTE})
      SELECT m.codigo, mg.nombre AS magnitud, z.id, z.nombre, count(DISTINCT l.dispositivo_id)::int AS equipos
        FROM zona z CROSS JOIN unnest($2::text[]) WITH ORDINALITY AS m(codigo, orden)
        JOIN magnitud mg ON mg.codigo = m.codigo
        LEFT JOIN lectura l ON l.zona_id = z.id AND l.magnitud = m.codigo
       WHERE z.sitio_id = $1 GROUP BY m.orden, m.codigo, mg.nombre, z.id, z.nombre ORDER BY m.orden, z.nombre`, [sitioId, magnitudes]);
    const porMagnitud = new Map<string, ZonasDeMagnitud>();
    for (const f of r.rows) {
      const m = porMagnitud.get(f.codigo) ?? { magnitud: f.magnitud, zonas: [] };
      m.zonas.push({ id: f.id, nombre: f.nombre, equipos: f.equipos });
      porMagnitud.set(f.codigo, m);
    }
    return [...porMagnitud.values()];
  }
  // Los avisos de lo que un visitante podría deducir de una vista (publico.ts, avisosPorMagnitud), con el k del sitio.
  private async avisos(c: Pick<PoolClient, 'query'>, sitioId: string, v: VistaValidada, k: number): Promise<string[]> {
    const magnitudes = await this.equiposPorZona(c, sitioId, v.magnitudes);
    return avisosPorMagnitud({ magnitudes, publicadas: v.zonas, k, kPorOmision: this.vista.limites.kPorOmision });
  }

  // El k de la vista pública del sitio (decidido el 17/11/2026, tras la tercera revisión): el que rige, si lo fijó su administrador, el de
  // omisión, el piso y el máximo.
  async minimo(sitioId: string): Promise<MinimoSitio> {
    return this.leerMinimo(this.pool, sitioId);
  }
  // Fijarlo: rige en la petición siguiente de todos los enlaces del sitio (entra a la clave de lo guardado). Deja el evento `enlace_minimo`
  // y responde con los avisos: «afecta a todos los enlaces públicos de este sitio» y lo que un visitante podría deducir con ese k, contando
  // los equipos de hoy en todas las magnitudes del catálogo.
  async fijarMinimo(sitioId: string, k: number, usuarioId: string | null): Promise<MinimoSitio & { avisos: string[] }> {
    return this.enTransaccion(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('enlace_publico:' || $1::text))", [sitioId]);
      const antes = await this.leerMinimo(c, sitioId);
      await c.query('UPDATE sitio SET publico_minimo_dispositivos = $2 WHERE id = $1', [sitioId, k]);
      await registrarEvento(c, { dispositivoId: null, tipo: 'enlace_minimo', usuarioId, detalle: { sitio_id: sitioId, minimo_dispositivos: k, anterior: antes.minimo_dispositivos } });
      const despues = await this.leerMinimo(c, sitioId);
      const todas = await c.query<{ codigo: string }>('SELECT codigo FROM magnitud ORDER BY codigo');
      const magnitudes = await this.equiposPorZona(c, sitioId, todas.rows.map((m) => m.codigo));
      const l = this.vista.limites;
      return { ...despues, avisos: avisosDeMinimo({ magnitudes, k: despues.minimo_dispositivos, anterior: antes.minimo_dispositivos, kPorOmision: l.kPorOmision }) };
    });
  }
  private async leerMinimo(c: Pick<PoolClient, 'query'>, sitioId: string): Promise<MinimoSitio> {
    const r = await c.query<{ fijado: number | null }>('SELECT publico_minimo_dispositivos AS fijado FROM sitio WHERE id = $1', [sitioId]);
    const f = r.rows[0];
    if (f === undefined) throw new NotFoundException('sitio no encontrado');
    const l = this.vista.limites;
    return { minimo_dispositivos: kSitio(f.fijado, l), fijado: f.fijado !== null, por_omision: l.kPorOmision, piso: l.kPiso, maximo: K_MAXIMO };
  }

  // Cada magnitud, del catálogo (400 con las que no lo son).
  private async exigirMagnitudes(c: Pick<PoolClient, 'query'>, magnitudes: string[]): Promise<void> {
    const r = await c.query<{ codigo: string }>('SELECT codigo FROM magnitud WHERE codigo = ANY($1::text[])', [magnitudes]);
    const hay = new Set(r.rows.map((x) => x.codigo));
    const faltan = magnitudes.filter((m) => !hay.has(m));
    if (faltan.length > 0) throw new BadRequestException([`magnitud desconocida: ${faltan.join(', ')}`]);
  }

  // Las zonas pedidas, con el nombre que tienen hoy (el que queda publicado) y en el orden pedido; una que no es de este sitio (o no existe)
  // es 400, sin decir cuál de las dos (no revela si existe en otro sitio).
  private async zonasDelSitio(c: Pick<PoolClient, 'query'>, sitioId: string, ids: string[]): Promise<ZonaPublicada[]> {
    if (ids.length === 0) return [];
    const r = await c.query<ZonaPublicada>('SELECT id, nombre FROM zona WHERE sitio_id = $1 AND id = ANY($2::uuid[])', [sitioId, ids]);
    const porId = new Map(r.rows.map((z) => [z.id, z]));
    if (ids.some((id) => !porId.has(id))) throw new BadRequestException(['zonas: una o más zonas no son de este sitio']);
    return ids.map((id) => ({ id, nombre: (porId.get(id) as ZonaPublicada).nombre }));
  }

  private async enTransaccion<T>(trabajo: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    c.on('error', errorDeCliente);
    try {
      await c.query('BEGIN');
      const r = await trabajo(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.off('error', errorDeCliente);
      c.release();
    }
  }
}

function conEstado(f: FilaEnlace): EnlaceListado {
  const { ahora, ...resto } = f;
  const t = new Date(ahora);
  return { ...resto, estado: estadoEnlace(f, t), renovable: renovable(f, t) };
}
