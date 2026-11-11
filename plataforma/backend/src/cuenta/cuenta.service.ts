import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { POOL } from '../db/db.module.js';
import { errorDeCliente } from '../db/cliente.js';
import { registrarEvento } from '../db/evento.js';
import type { UsuarioSesion } from '../sesion/permisos.js';
import { SesionService, ipParaRegistro } from '../sesion/sesion.service.js';
import { CANDADO_ADMINISTRADORES } from '../sesion/usuarios.service.js';
import { CambioPreferencias, PreferenciasLeidas, leerPreferencias } from './preferencias.js';

// Lo propio de cada persona (docs/20 §6, última fila; docs/19 §4, H y P13; docs/21 §8): preferencias, sesiones abiertas, exportar los
// datos de la cuenta y darse de baja. Toda ruta exige sesión de una PERSONA: la clave de administrador por cabecera no es una cuenta (400).

export interface SesionPropia {
  id: string; // el hash de la sesión (lo que guarda la base; no autentica nada: la cookie lleva el identificador, no su hash)
  creada_en: string;
  ultima_actividad: string;
  agente: string | null;
  origen: string; // dirección truncada a /24 (IPv4) o /48 (IPv6): basta para reconocer la red sin exponer la dirección completa
  actual: boolean;
}

// Qué trae y qué no la exportación de la cuenta (docs/21 §8; corrección del 11/11/2026: el aviso lo dice).
export const AVISO_EXPORTAR =
  'Datos de tu cuenta (docs/21 §8): la cuenta (con la fecha y el motivo de una baja), tus sitios y perfiles, preferencias, sesiones, tus intentos ' +
  'de acceso (con el correo tecleado), los cambios que hiciste (con su detalle) y tus mensajes de soporte. No se incluyen: las mediciones, ' +
  'los dispositivos y los eventos de los sitios (se exportan por dispositivo, según tu perfil), los cambios que otras personas hicieron sobre ' +
  'tu cuenta ni los intentos con un correo que no era el tuyo. Las sesiones y los intentos de acceso se borran a los 90 días.';

export function exigirPersona(u: UsuarioSesion): string {
  if (u.sistema || u.id === null) throw new BadRequestException('la clave de administrador no es una cuenta: inicia sesión con una persona');
  return u.id;
}

@Injectable()
export class CuentaService {
  private readonly log = new Logger('cuenta');
  constructor(@Inject(POOL) private readonly pool: Pool, private readonly sesiones: SesionService) {}

  preferencias(u: UsuarioSesion): Promise<PreferenciasLeidas> {
    return leerPreferencias(this.pool, exigirPersona(u));
  }

  // PUT /preferencias, con bloqueo optimista (docs/10 §8.4 punto 28): `actualizado_en` null = la primera vez (no había fila); si otra pestaña
  // la creó o la cambió entretanto, 409 con la vigente.
  async guardarPreferencias(u: UsuarioSesion, p: CambioPreferencias): Promise<PreferenciasLeidas> {
    const id = exigirPersona(u);
    if (p.sitio_predeterminado !== null && !u.todos && !u.sitios.has(p.sitio_predeterminado)) {
      throw new BadRequestException(['sitio_predeterminado no es uno de tus sitios']);
    }
    const valores = [id, p.unidad_temperatura, p.unidad_longitud, p.zona_horaria, p.tema, p.notificar, JSON.stringify(p.vistas), p.sitio_predeterminado];
    const r = p.actualizado_en === null
      ? await this.pool.query(
        `INSERT INTO preferencia (usuario_id, unidad_temperatura, unidad_longitud, zona_horaria, tema, notificar, vistas, sitio_predeterminado)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) ON CONFLICT (usuario_id) DO NOTHING RETURNING usuario_id`, valores)
      : await this.pool.query(
        `UPDATE preferencia SET unidad_temperatura = $2, unidad_longitud = $3, zona_horaria = $4, tema = $5, notificar = $6, vistas = $7::jsonb,
                sitio_predeterminado = $8
          WHERE usuario_id = $1 AND actualizado_en = $9::timestamptz RETURNING usuario_id`, [...valores, p.actualizado_en]);
    if (r.rowCount === 0) {
      const vigente = await leerPreferencias(this.pool, id);
      throw new ConflictException({
        statusCode: 409, error: 'Conflict', actualizado_en: vigente.actualizado_en, preferencias: vigente,
        message: 'tus preferencias cambiaron desde que se leyeron (otra pestaña o equipo): recarga',
      });
    }
    return leerPreferencias(this.pool, id);
  }

  // Las sesiones vivas de la persona (no revocadas ni vencidas por la vida absoluta o la inactividad de docs/20 §3).
  async sesionesPropias(u: UsuarioSesion): Promise<SesionPropia[]> {
    const id = exigirPersona(u);
    const r = await this.pool.query<{ id: string; creada_en: string; ultima_actividad: string; agente: string | null; ip: string | null }>(
      `SELECT id, iso_utc(creada_en) AS creada_en, iso_utc(ultima_actividad) AS ultima_actividad, agente, host(ip) AS ip
         FROM sesion
        WHERE usuario_id = $1 AND revocada_en IS NULL AND expira_en > $2 AND ultima_actividad > $2::timestamptz - INTERVAL '30 minutes'
        ORDER BY ultima_actividad DESC LIMIT 50`, [id, this.sesiones.ahora()]);
    return r.rows.map((s) => ({
      id: s.id, creada_en: s.creada_en, ultima_actividad: s.ultima_actividad, agente: s.agente === null ? null : s.agente.slice(0, 120),
      origen: s.ip === null ? 'desconocido' : ipParaRegistro(s.ip), actual: s.id === u.sesionId,
    }));
  }

  // DELETE /sesiones/{id}: solo una propia y viva; la de otra persona o una inexistente, el mismo 404. Deja la fila «cierre» en `acceso`.
  async cerrarSesionPropia(u: UsuarioSesion, sesionId: string, ip: string): Promise<{ revocada: true; actual: boolean }> {
    const id = exigirPersona(u);
    const r = await this.pool.query('UPDATE sesion SET revocada_en = $3 WHERE id = $1 AND usuario_id = $2 AND revocada_en IS NULL RETURNING id',
      [sesionId, id, this.sesiones.ahora()]);
    if (r.rowCount === 0) throw new NotFoundException('sesión no encontrada');
    await this.sesiones.registrar({ resultado: 'cierre', email: u.email, ip, usuarioId: id, sesionId });
    return { revocada: true, actual: sesionId === u.sesionId };
  }

  // GET /cuenta/exportar (docs/21 §8, portabilidad y acceso): los datos de la CUENTA, no los del sitio (esos, con la exportación por
  // dispositivo según el perfil). Las direcciones y agentes de sus propias sesiones e intentos van completos: son sus datos (docs/21 §2).
  async exportar(u: UsuarioSesion): Promise<Record<string, unknown>> {
    const id = exigirPersona(u);
    const consultas = await Promise.all([
      this.pool.query(
        `SELECT id, nombre, email, activo, administrador_sistema, iso_utc(creado_en) AS creado_en, iso_utc(actualizado_en) AS actualizado_en,
                iso_utc(desactivado_en) AS desactivado_en, motivo_baja,
                terminos_version_aceptada, iso_utc(terminos_aceptados_en) AS terminos_aceptados_en
           FROM usuario WHERE id = $1`, [id]),
      this.pool.query(
        `SELECT s.codigo AS sitio, s.nombre, us.rol, us.activo FROM usuario_sitio us JOIN sitio s ON s.id = us.sitio_id
          WHERE us.usuario_id = $1 ORDER BY s.codigo`, [id]),
      leerPreferencias(this.pool, id),
      this.pool.query(
        `SELECT iso_utc(creada_en) AS creada_en, iso_utc(ultima_actividad) AS ultima_actividad, iso_utc(expira_en) AS expira_en,
                iso_utc(revocada_en) AS revocada_en, host(ip) AS ip, agente
           FROM sesion WHERE usuario_id = $1 ORDER BY creada_en DESC LIMIT 1000`, [id]),
      this.pool.query(
        `SELECT iso_utc(instante) AS instante, resultado, host(ip) AS ip, email_intentado FROM acceso WHERE usuario_id = $1 ORDER BY instante DESC LIMIT 5000`, [id]),
      this.pool.query(
        `SELECT iso_utc(ocurrido_en) AS ocurrido_en, tipo, dispositivo_id, detalle FROM evento WHERE usuario_id = $1 ORDER BY ocurrido_en DESC LIMIT 5000`, [id]),
      this.pool.query(
        `SELECT iso_utc(creado_en) AS creado_en, texto, iso_utc(leido_en) AS leido_en FROM mensaje_soporte WHERE usuario_id = $1 ORDER BY creado_en DESC`, [id]),
    ]);
    const [cuenta, sitios, preferencias, sesiones, accesos, eventos, mensajes] = consultas;
    return {
      exportado_en: this.sesiones.ahora().toISOString(),
      aviso: AVISO_EXPORTAR,
      cuenta: cuenta.rows[0] ?? null, sitios: sitios.rows, preferencias, sesiones: sesiones.rows, accesos: accesos.rows,
      cambios_hechos: eventos.rows, mensajes_de_soporte: mensajes.rows,
    };
  }

  // POST /cuenta/baja (docs/20 §11; docs/10 §8.4 punto 62): la clave actual (con los bloqueos de siempre), el candado de los administradores
  // (el mismo de R3), 409 si es el último administrador del sistema o si la plataforma quedaría sin ningún administrador, y la anonimización
  // en la base (fn_anonimizar_usuario, una función del dueño: borra preferencias y mensajes, que la aplicación no puede borrar). Todo en una
  // transacción: se confirma entero o no pasa nada. Deja un evento usuario_baja (con el id, nunca el nombre de antes) y la fila «cierre».
  async darseDeBaja(u: UsuarioSesion, cuerpo: unknown, ip: string): Promise<{ anonimizado_en: string }> {
    const id = exigirPersona(u);
    const c0 = typeof cuerpo === 'object' && cuerpo !== null && !Array.isArray(cuerpo) ? (cuerpo as Record<string, unknown>) : {};
    for (const k of Object.keys(c0)) if (k !== 'clave') throw new BadRequestException([`campo no admitido: ${k.slice(0, 40)}`]);
    await this.sesiones.exigirClaveActual(u, c0.clave, ip);
    const c = await this.pool.connect();
    c.on('error', errorDeCliente);
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL lock_timeout = '5s'");
      await c.query(CANDADO_ADMINISTRADORES);
      await exigirNoUltimoAdministrador(c, id);
      const r = await c.query<{ instante: Date }>('SELECT fn_anonimizar_usuario($1, $1) AS instante', [id]);
      const instante = r.rows[0].instante;
      await registrarEvento(c, { dispositivoId: null, tipo: 'usuario_baja', detalle: { usuario_id: id, por: id, anonimizada: true }, usuarioId: id });
      await c.query('COMMIT');
      await this.sesiones.registrar({ resultado: 'cierre', email: null, ip, usuarioId: id, sesionId: u.sesionId });
      this.log.log('una cuenta se dio de baja (anonimizada)');
      return { anonimizado_en: instante.toISOString() };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      const pg = e as { code?: string };
      if (pg.code === '55P03') throw new ServiceUnavailableException('otro cambio de administradores está en curso; reintentar en unos segundos');
      throw e;
    } finally {
      c.off('error', errorDeCliente);
      c.release();
    }
  }
}

// Dentro del candado de los administradores: el último administrador del sistema no se da de baja, ni nadie cuya baja dejaría la plataforma
// sin ningún administrador activo (docs/20 §11, la misma regla de R3). Exportada para la prueba del orden.
export async function exigirNoUltimoAdministrador(c: Pick<PoolClient, 'query'>, id: string): Promise<void> {
  const r = await c.query<{ global: boolean; admin: boolean; otros_globales: number; otros_admin: boolean }>(
    `SELECT u.administrador_sistema AS global,
            u.administrador_sistema OR EXISTS (SELECT 1 FROM usuario_sitio x WHERE x.usuario_id = u.id AND x.rol = 'administrador' AND x.activo) AS admin,
            (SELECT count(*)::int FROM usuario o WHERE o.administrador_sistema AND o.activo AND o.id <> $1) AS otros_globales,
            EXISTS (SELECT 1 FROM usuario_sitio us JOIN usuario o ON o.id = us.usuario_id
                     WHERE us.rol = 'administrador' AND us.activo AND o.activo AND o.id <> $1)
              OR EXISTS (SELECT 1 FROM usuario o WHERE o.administrador_sistema AND o.activo AND o.id <> $1) AS otros_admin
       FROM usuario u WHERE u.id = $1 AND u.activo FOR NO KEY UPDATE`, [id]);
  const f = r.rows[0];
  if (f === undefined) throw new NotFoundException('cuenta no encontrada');
  if (f.global && f.otros_globales === 0) throw new ConflictException('eres el último administrador del sistema: nombra a otra persona antes de darte de baja');
  if (f.admin && !f.otros_admin) throw new ConflictException('tu baja dejaría la plataforma sin ningún administrador activo: nombra a otra persona antes');
}
