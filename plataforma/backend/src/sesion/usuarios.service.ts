import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';
import { POOL } from '../db/db.module.js';
import { errorDeCliente } from '../db/cliente.js';
import { registrarEvento } from '../db/evento.js';
import { isoUs } from '../db/iso-us.js';
import { AlcanceService } from './alcance.service.js';
import { generarClaveTemporal } from './claves.js';
import { horasClaveTemporal } from '../arranque.js';
import { venceClaveTemporal } from './cookie.js';
import { Rol, UsuarioSesion, exigirEnAlguno, permitirGlobal } from './permisos.js';
import { SesionService } from './sesion.service.js';
import { AltaUsuario, CambioUsuario } from './usuarios.dto.js';

// Usuarios y sus roles por sitio (HU-18, RF-43, RF-44; docs/20 §4). Sin registro abierto: solo un administrador da de alta, y solo en
// sus sitios. El primer administrador lo crea la clave de administrador (el «usuario del sistema») mientras no exista NINGUNO; después
// esa clave ya no gestiona usuarios y la variable se retira del .env (decidido el 12/10/2026). Nadie se borra: se desactiva (su rastro
// en `evento` y `acceso` lo necesita), y un sitio se le quita con una baja lógica de `usuario_sitio` (migración 22). La clave inicial
// y la de «olvidé mi clave» son temporales: se muestran una vez, la base guarda su hash y vencen
// a las CLAVE_TEMPORAL_HORAS (1–72, 2 por defecto; arranque.ts): la respuesta trae `clave_temporal_vence_en` para que el panel lo diga.

export interface UsuarioListado {
  id: string;
  nombre: string;
  email: string;
  // false = ya no está en ninguno de los sitios de quien pregunta, pero estuvo (aparece para devolverle el sitio); para el usuario del
  // sistema, que no tiene ningún sitio activo.
  en_mis_sitios: boolean;
  activo: boolean;
  administrador_sistema: boolean;
  desactivado_en: string | null; // baja con motivo (migración 24): cuándo, quién y por qué; nulos si está activa
  desactivado_por: string | null;
  motivo_baja: string | null;
  anonimizado: boolean; // dada de baja por anonimización (docs/20 §11): no se reactiva
  clave_temporal: boolean;
  clave_temporal_vence_en: string | null;
  sitios: { sitio_id: string; codigo: string; rol: Rol }[];
  creado_en: string;
  actualizado_en: string; // ISO con microsegundos: el que se manda tal cual en PATCH /usuarios/{id}
}
export interface UsuarioConClave extends UsuarioListado {
  clave: string; // la clave temporal, UNA sola vez
}

const COLUMNAS = (alcance: string): string => `
  u.id, u.nombre, u.email,
  EXISTS (SELECT 1 FROM usuario_sitio v WHERE v.usuario_id = u.id AND v.activo AND (${alcance}::uuid[] IS NULL OR v.sitio_id = ANY(${alcance}::uuid[]))) AS en_mis_sitios,
  u.activo, u.administrador_sistema, iso_utc(u.desactivado_en) AS desactivado_en, u.desactivado_por, u.motivo_baja,
  u.anonimizado_en IS NOT NULL AS anonimizado,
  u.clave_temporal, iso_utc(u.clave_temporal_vence_en) AS clave_temporal_vence_en,
  iso_utc(u.creado_en) AS creado_en, ${isoUs('u.actualizado_en')} AS actualizado_en,
  coalesce((SELECT json_agg(json_build_object('sitio_id', us.sitio_id, 'codigo', s.codigo, 'rol', us.rol) ORDER BY s.codigo)
              FROM usuario_sitio us JOIN sitio s ON s.id = us.sitio_id
             WHERE us.usuario_id = u.id AND us.activo AND (${alcance}::uuid[] IS NULL OR us.sitio_id = ANY(${alcance}::uuid[]))), '[]'::json) AS sitios`;

@Injectable()
export class UsuariosService {
  private readonly log = new Logger('usuarios');
  // Vigencia de la clave temporal en horas: se lee y valida al construir (al arrancar); un valor inválido detiene el arranque.
  readonly horasTemporal: number;
  constructor(
    @Inject(POOL) private readonly pool: Pool,
    private readonly sesiones: SesionService,
    private readonly alcance: AlcanceService,
    @Optional() config?: ConfigService,
  ) {
    this.horasTemporal = horasClaveTemporal(config?.get<string>('CLAVE_TEMPORAL_HORAS'));
  }

  // Los sitios donde `por` administra usuarios; null = todos (usuario del sistema).
  private sitiosQueAdministra(por: UsuarioSesion): string[] | null {
    if (por.todos) return null;
    return [...por.sitios].filter(([, rol]) => rol === 'administrador').map(([id]) => id);
  }

  // La clave de administrador gestiona usuarios (listar, crear, cambiar) solo mientras no haya ningún administrador activo (revisión del
  // 08/11/2026: la lista también; antes, con un administrador ya creado, la clave seguía viendo a todas las personas).
  private async exigirSinAdministrador(por: UsuarioSesion, mensaje: string): Promise<void> {
    if (por.sistema && (await this.hayAdministrador(this.pool))) throw new ForbiddenException(mensaje);
  }

  // ¿Hay algún administrador activo (de un sitio, o del sistema desde la migración 24)? La clave de administrador gestiona usuarios solo
  // mientras la respuesta sea no.
  private async hayAdministrador(c: PoolClient | Pool): Promise<boolean> {
    const r = await c.query<{ hay: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM usuario_sitio us JOIN usuario u ON u.id = us.usuario_id
                       WHERE us.rol = 'administrador' AND us.activo AND u.activo)
           OR EXISTS (SELECT 1 FROM usuario WHERE administrador_sistema AND activo) AS hay`);
    return r.rows[0].hay;
  }

  // Cuántos administradores del sistema activos hay (dentro del candado de los administradores). Ningún cambio ni baja puede dejar la
  // plataforma sin ninguno si había (docs/20 §11; 409).
  private async administradoresDelSistema(c: PoolClient): Promise<number> {
    const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM usuario WHERE administrador_sistema AND activo');
    return r.rows[0].n;
  }

  private async exigirSitios(por: UsuarioSesion, sitios: { sitio_id: string }[]): Promise<void> {
    for (const s of sitios) await this.alcance.exigirSitio(por, 'usuarios', s.sitio_id);
  }

  async listar(por: UsuarioSesion): Promise<UsuarioListado[]> {
    exigirEnAlguno(por, 'usuarios');
    await this.exigirSinAdministrador(por, 'ya existe un administrador: la lista de usuarios exige su sesión');
    const alcance = this.sitiosQueAdministra(por);
    // Se ve a quien está, o estuvo, en alguno de mis sitios (así se le puede devolver un sitio quitado: en_mis_sitios = false); de sus
    // sitios, solo los míos.
    const r = await this.pool.query<UsuarioListado>(
      `SELECT ${COLUMNAS('$1')} FROM usuario u
        WHERE $1::uuid[] IS NULL OR EXISTS (SELECT 1 FROM usuario_sitio x WHERE x.usuario_id = u.id AND x.sitio_id = ANY($1::uuid[]))
        ORDER BY u.nombre, u.email`, [alcance]);
    return r.rows;
  }

  async crear(por: UsuarioSesion, a: AltaUsuario): Promise<UsuarioConClave> {
    if (por.sistema && !a.administrador_sistema && !a.sitios.some((s) => s.rol === 'administrador')) {
      throw new BadRequestException(['con la clave de administrador solo se crea el primer administrador: al menos un sitio con rol administrador, o administrador_sistema']);
    }
    // El perfil global lo da solo quien ya lo tiene (o la clave de administrador, mientras cree el primero): docs/20 §5.
    if (a.administrador_sistema && !permitirGlobal(por, 'sistema')) throw new ForbiddenException('solo el administrador del sistema da el perfil de administrador del sistema');
    await this.exigirSitios(por, a.sitios);
    const clave = generarClaveTemporal();
    const hash = await this.sesiones.hashClave(clave); // antes de abrir la transacción: no se retienen candados mientras se calcula
    const vence = venceClaveTemporal(this.sesiones.ahora(), this.horasTemporal);
    const c = await this.pool.connect();
    c.on('error', errorDeCliente); // un corte de la base a mitad falla esta petición, no el proceso (db/cliente.ts)
    try {
      await abrir(c);
      // Dos «primeros administradores» a la vez: el candado los ordena y el segundo ya ve al primero. Es el mismo candado que toma
      // actualizar() cuando un cambio puede quitar administradores (CANDADO_ADMINISTRADORES).
      await c.query(CANDADO_ADMINISTRADORES);
      if (por.sistema && (await this.hayAdministrador(c))) {
        throw new ForbiddenException('ya existe un administrador: el alta de usuarios exige su sesión (la clave de administrador solo crea el primero)');
      }
      // Un correo que ya existe INACTIVO no se duplica (docs/20 §10, R25): 409 con la ficha y `reactivable: true`; la
      // reactivación es la acción de siempre (PATCH con activo: true), no una ruta nueva. La ficha, solo si quien pregunta la puede ver
      // (estuvo en alguno de sus sitios, o es administrador del sistema); si no, 409 sin ficha: pídelo a quien sí puede.
      await this.exigirCorreoLibre(c, a.email, this.sitiosQueAdministra(por));
      const r = await c.query<{ id: string }>(
        `INSERT INTO usuario (nombre, email, hash_password, clave_temporal, clave_temporal_vence_en, administrador_sistema) VALUES ($1, $2, $3, true, $4, $5) RETURNING id`,
        [a.nombre, a.email, hash, vence, a.administrador_sistema]);
      const id = r.rows[0].id;
      for (const s of a.sitios) await c.query('INSERT INTO usuario_sitio (usuario_id, sitio_id, rol) VALUES ($1, $2, $3)', [id, s.sitio_id, s.rol]);
      await registrarEvento(c, {
        dispositivoId: null, tipo: 'usuario_alta', usuarioId: por.id,
        detalle: { usuario_id: id, por: por.id ?? 'sistema', sitios: a.sitios, administrador_sistema: a.administrador_sistema },
      });
      const fila = await this.leer(c, id, null);
      await c.query('COMMIT');
      this.log.log(`usuario dado de alta con ${a.sitios.length} sitio(s), por ${por.sistema ? 'la clave de administrador' : 'un administrador'}`);
      return { ...fila, clave };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw traducir(e);
    } finally {
      c.off('error', errorDeCliente);
      c.release();
    }
  }

  private async exigirCorreoLibre(c: PoolClient, email: string, alcance: string[] | null): Promise<void> {
    const r = await c.query<{ id: string; activo: boolean; visible: boolean }>(
      `SELECT u.id, u.activo,
              ($2::uuid[] IS NULL OR EXISTS (SELECT 1 FROM usuario_sitio x WHERE x.usuario_id = u.id AND x.sitio_id = ANY($2::uuid[]))) AS visible
         FROM usuario u WHERE u.email = $1`, [email, alcance]);
    const e = r.rows[0];
    if (e === undefined) return;
    if (e.activo) throw new ConflictException('ya existe un usuario con ese email');
    if (!e.visible) {
      throw new ConflictException({
        statusCode: 409, error: 'Conflict', reactivable: false,
        message: 'existe una cuenta inactiva con ese email en sitios que no administras: pide su reactivación a un administrador del sistema',
      });
    }
    throw new ConflictException({
      statusCode: 409, error: 'Conflict', reactivable: true, usuario: await this.leer(c, e.id, alcance),
      message: 'existe una cuenta inactiva con ese email: reactívala (PATCH /usuarios/{id} con activo: true y clave_temporal: true) en vez de crear otra',
    });
  }

  async actualizar(por: UsuarioSesion, id: string, cambio: CambioUsuario): Promise<UsuarioListado | UsuarioConClave> {
    await this.exigirSinAdministrador(por, 'ya existe un administrador: los cambios de usuarios exigen su sesión');
    const alcance = this.sitiosQueAdministra(por);
    if (por.id === id && cambio.activo === false) throw new ConflictException('no puedes desactivarte a ti mismo');
    if (cambio.administrador_sistema !== undefined && !permitirGlobal(por, 'sistema')) {
      throw new ForbiddenException('solo el administrador del sistema da o quita el perfil de administrador del sistema');
    }
    if (cambio.sitios) await this.exigirSitios(por, cambio.sitios);
    const clave = cambio.clave_temporal ? generarClaveTemporal() : null;
    const hash = clave === null ? null : await this.sesiones.hashClave(clave);
    const ahora = this.sesiones.ahora();
    const c = await this.pool.connect();
    c.on('error', errorDeCliente);
    try {
      await abrir(c);
      // Un cambio que puede dejar la plataforma sin administradores (activo, clave temporal, roles) toma el candado de los
      // administradores ANTES de leer nada (revisión del 08/11/2026): dos administradores que se desactivan el uno al otro a la vez
      // leían cada uno al otro todavía activo, y los dos cambios pasaban. Con el candado, el segundo espera al primero y su recuento
      // (hayAdministrador, más abajo) ya ve el cambio confirmado: 409. Siempre antes del candado de la fila, en el mismo orden que crear().
      if (tocaAdministradores(cambio)) await c.query(CANDADO_ADMINISTRADORES);
      const globalesAntes = tocaAdministradores(cambio) ? await this.administradoresDelSistema(c) : 0;
      const a = await c.query<{ actualizado_en: string; en_mis_sitios: boolean; ajenos: string[]; anonimizado: boolean } & Objetivo>(
        `SELECT ${isoUs('u.actualizado_en')} AS actualizado_en, u.anonimizado_en IS NOT NULL AS anonimizado,
                u.administrador_sistema AS "administradorSistema",
                -- Baja hecha por un administrador del sistema (o por la clave de administrador: desactivado_por nulo): solo la deshace el alcance global.
                (NOT u.activo AND (u.desactivado_por IS NULL
                  OR EXISTS (SELECT 1 FROM usuario d WHERE d.id = u.desactivado_por AND d.administrador_sistema))) AS "bajaDelSistema",
                EXISTS (SELECT 1 FROM usuario_sitio x WHERE x.usuario_id = u.id AND x.activo AND ($2::uuid[] IS NULL OR x.sitio_id = ANY($2::uuid[]))) AS en_mis_sitios,
                coalesce((SELECT array_agg(x.sitio_id::text) FROM usuario_sitio x
                           WHERE x.usuario_id = u.id AND x.activo AND $2::uuid[] IS NOT NULL AND NOT x.sitio_id = ANY($2::uuid[])), '{}') AS ajenos
           FROM usuario u
          WHERE u.id = $1 AND ($2::uuid[] IS NULL OR EXISTS (SELECT 1 FROM usuario_sitio x WHERE x.usuario_id = u.id AND x.sitio_id = ANY($2::uuid[])))
          FOR NO KEY UPDATE OF u`, [id, alcance]);
      if (a.rows.length === 0) throw new NotFoundException('usuario no encontrado'); // inexistente o de otros sitios: la misma forma (RF-41)
      const rechazo = rechazoDeCambio(alcance, a.rows[0].en_mis_sitios, a.rows[0].ajenos, cambio, a.rows[0]);
      if (rechazo !== null) throw new ForbiddenException(rechazo);
      if (a.rows[0].anonimizado) throw new ConflictException('la cuenta se dio de baja por anonimización: no se reactiva ni se cambia (docs/20 §11); crea una cuenta nueva');
      // El UPDATE va siempre (aunque solo cambien sitios): mueve actualizado_en, así dos cambios simultáneos se ordenan por el bloqueo optimista.
      // Baja con motivo (migración 24, ck_usuario_baja): desactivar guarda cuándo, quién y por qué; reactivar los limpia (el motivo queda en
      // el evento usuario_cambio, la única copia desde entonces).
      const u = await c.query(
        `UPDATE usuario SET nombre = coalesce($3, nombre), activo = coalesce($4::boolean, activo),
                hash_password = coalesce($5, hash_password),
                clave_temporal = CASE WHEN $5::text IS NULL THEN clave_temporal ELSE true END,
                clave_temporal_vence_en = CASE WHEN $5::text IS NULL THEN clave_temporal_vence_en ELSE $6::timestamptz END,
                desactivado_en = CASE WHEN $4::boolean IS NULL THEN desactivado_en WHEN $4::boolean THEN NULL ELSE $7::timestamptz END,
                desactivado_por = CASE WHEN $4::boolean IS NULL THEN desactivado_por WHEN $4::boolean THEN NULL ELSE $8::uuid END,
                motivo_baja = CASE WHEN $4::boolean IS NULL THEN motivo_baja WHEN $4::boolean THEN NULL ELSE $9::text END,
                administrador_sistema = coalesce($10::boolean, administrador_sistema)
          WHERE id = $1 AND actualizado_en = $2::timestamptz RETURNING id`,
        [id, cambio.actualizado_en, cambio.nombre ?? null, cambio.activo ?? null, hash, venceClaveTemporal(ahora, this.horasTemporal),
          ahora, por.id, cambio.motivo ?? null, cambio.administrador_sistema ?? null]);
      if (u.rowCount === 0) {
        throw new ConflictException({
          statusCode: 409, error: 'Conflict', actualizado_en: a.rows[0].actualizado_en,
          message: `alguien lo cambió a las ${a.rows[0].actualizado_en.slice(11, 16)} UTC (${a.rows[0].actualizado_en}); recarga`,
        });
      }
      for (const s of cambio.sitios ?? []) {
        if (s.rol === null) await c.query('UPDATE usuario_sitio SET activo = false WHERE usuario_id = $1 AND sitio_id = $2', [id, s.sitio_id]);
        else {
          await c.query(
            `INSERT INTO usuario_sitio (usuario_id, sitio_id, rol) VALUES ($1, $2, $3)
             ON CONFLICT (usuario_id, sitio_id) DO UPDATE SET rol = EXCLUDED.rol, activo = true`, [id, s.sitio_id, s.rol]);
        }
      }
      // Desactivar o asignar una clave temporal corta las sesiones abiertas de esa persona.
      if (cambio.activo === false || clave !== null) {
        await c.query('UPDATE sesion SET revocada_en = $2 WHERE usuario_id = $1 AND revocada_en IS NULL', [id, ahora]);
      }
      if (!(await this.hayAdministrador(c))) throw new ConflictException('el cambio dejaría la plataforma sin ningún administrador activo');
      if (globalesAntes > 0 && (await this.administradoresDelSistema(c)) === 0) {
        throw new ConflictException('el cambio dejaría la plataforma sin ningún administrador del sistema activo');
      }
      await registrarEvento(c, {
        dispositivoId: null, tipo: 'usuario_cambio', usuarioId: por.id,
        detalle: {
          usuario_id: id, por: por.id ?? 'sistema', nombre: cambio.nombre !== undefined, activo: cambio.activo ?? null, motivo: cambio.motivo ?? null,
          clave_temporal: clave !== null, sitios: cambio.sitios ?? null, administrador_sistema: cambio.administrador_sistema ?? null,
        },
      });
      const fila = await this.leer(c, id, alcance);
      await c.query('COMMIT');
      return clave === null ? fila : { ...fila, clave };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw traducir(e);
    } finally {
      c.off('error', errorDeCliente);
      c.release();
    }
  }

  private async leer(c: PoolClient, id: string, alcance: string[] | null): Promise<UsuarioListado> {
    const r = await c.query<UsuarioListado>(`SELECT ${COLUMNAS('$2')} FROM usuario u WHERE u.id = $1`, [id, alcance]);
    return r.rows[0];
  }
}

// El candado de la base que ordena todo lo que crea o quita administradores (pg_advisory_xact_lock: se suelta solo al terminar la
// transacción). Una sola clave para crear y para cambiar: dos candados distintos no se esperarían entre sí.
export const CANDADO_ADMINISTRADORES = "SELECT pg_advisory_xact_lock(hashtext('administradores'))";

// Campos de la CUENTA (valen en todos los sitios de la persona) frente a los roles (uno por sitio).
export function tocaCuenta(c: CambioUsuario): boolean {
  return c.nombre !== undefined || c.activo !== undefined || c.clave_temporal === true || c.administrador_sistema !== undefined;
}
export function tocaAdministradores(c: CambioUsuario): boolean {
  return c.activo !== undefined || c.clave_temporal === true || (c.sitios?.length ?? 0) > 0 || c.administrador_sistema !== undefined;
}

// Quién puede cambiar la cuenta de una persona (revisión del 08/11/2026, docs/20 §10). Antes bastaba con compartir UN sitio: el
// administrador del sitio A podía desactivar o asignar una clave temporal (y así entrar como ella) a una persona que además
// administra el sitio B, y con eso tomar B. Ahora:
//  · los campos de la cuenta (nombre, activo, clave temporal), solo el usuario del sistema (alcance null, mientras rija) o un
//    administrador cuyo alcance cubre TODOS los sitios activos de la persona; si tiene alguno fuera → 403 (no 404: la persona sí
//    aparece en su lista por el sitio en común);
//  · a quien ya no está en ninguno de mis sitios (pero estuvo: aparece en la lista para eso) solo se le puede devolver un sitio mío;
//  · los roles, solo en sitios propios (eso lo exige exigirSitios antes de abrir la transacción).
//  · la cuenta de un administrador del sistema (nombre, activo, clave temporal y también sus sitios), solo el alcance global (revisión
//    del 11/11/2026): antes, un administrador de sitio podía asignarle una clave temporal (y entrar como él) si compartían un sitio;
//  · una baja hecha por un administrador del sistema (o por la clave de administrador) solo la deshace el alcance global.
// Devuelve el mensaje del 403, o null si se permite.
export interface Objetivo { administradorSistema: boolean; bajaDelSistema: boolean }
export function rechazoDeCambio(alcance: string[] | null, enMisSitios: boolean, ajenos: readonly string[], cambio: CambioUsuario,
  objetivo: Objetivo): string | null {
  if (alcance === null) return null;
  if (objetivo.administradorSistema) return 'la cuenta es de un administrador del sistema: solo otro administrador del sistema la cambia';
  if (cambio.activo === true && objetivo.bajaDelSistema) return 'la dio de baja un administrador del sistema: solo un administrador del sistema la reactiva';
  if (!tocaCuenta(cambio)) return null;
  if (!enMisSitios) return 'la persona ya no está en ninguno de tus sitios: solo puedes devolverle uno (sitios)';
  if (ajenos.length > 0) return 'la cuenta pertenece también a otros sitios: pídelo a un administrador del sistema';
  return null;
}

async function abrir(c: PoolClient): Promise<void> {
  await c.query('BEGIN');
  await c.query("SET LOCAL lock_timeout = '5s'");
  await c.query("SET LOCAL statement_timeout = '10s'");
}

interface ErrorPg { code?: string; constraint?: string; message: string }

function traducir(e: unknown): unknown {
  const pg = e as ErrorPg;
  switch (pg.code) {
    case '23505': return new ConflictException('ya existe un usuario con ese email');
    case '23503': return new NotFoundException('sitio no encontrado'); // el sitio desapareció entre la comprobación y el INSERT
    case '23514': return new BadRequestException([`la base rechazó el usuario: no cumple ${pg.constraint ?? 'una restricción'}`]);
    case '22007': case '22008': case '22P02': return new BadRequestException(['actualizado_en no es una fecha que la base acepte']);
    case '55P03': case '57014': return new ServiceUnavailableException('otro cambio sobre el mismo usuario está en curso; reintentar en unos segundos');
    default: return e;
  }
}
