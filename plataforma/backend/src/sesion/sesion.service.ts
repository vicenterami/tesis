import {
  BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, OnModuleInit, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { isIP } from 'node:net';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { POOL } from '../db/db.module';
import { AvisosAcotados } from '../arranque';
import { hashScrypt, N_PERSONA, verificarScrypt } from '../alta/credenciales';
import { Bloqueos } from './bloqueos';
import { motivosDeClave } from './claves';
import {
  VIDA_ABSOLUTA_MS, claveTemporalVencida, debeRenovar, generarIdentificador, hashIdentificador, motivoDeVencimiento,
} from './cookie';
import { ROLES, Rol, UsuarioSesion } from './permisos';
import { Turnos } from './turnos';

// M7 · Sesión de personas (docs/20 §3 y §4). Una cookie opaca con estado en la base: aquí se abre, se carga en cada petición (el
// guardia central la usa), se renueva, se cierra y se rota al cambiar la clave. Todo intento de inicio de sesión y todo cierre deja una
// fila en `acceso` (RF-46). Los instantes los pone el reloj de la aplicación (`ahora`), no now() de la base: así la vida de la sesión se
// prueba con un reloj simulado y la base guarda exactamente lo que se comparó.

export const MENSAJE_CREDENCIALES = 'credenciales no válidas'; // el mismo para usuario inexistente, inactivo y clave mala (docs/20 §4)
export const MENSAJE_SIN_SESION = 'sesión requerida'; // el cuerpo fijo del 401 (docs/20 §5)
export type ResultadoAcceso = 'ok' | 'clave_incorrecta' | 'bloqueado' | 'inactivo' | 'cierre';

export interface SesionAbierta {
  identificador: string; // va SOLO a la cookie; la base guarda su hash
  usuario: { id: string; nombre: string; email: string; clave_temporal: boolean };
  expira_en: string;
}

// Lo que vuelve al cliente: todo menos el identificador, que viaja solo en la cookie.
export type SesionAbiertaRespuesta = Omit<SesionAbierta, 'identificador'>;

interface FilaUsuario {
  id: string;
  nombre: string;
  email: string;
  hash_password: string;
  activo: boolean;
  clave_temporal: boolean;
  clave_temporal_vence_en: Date | null;
}

// Email tal como se compara y se guarda (ck_usuario_email, migración 22): sin espacios en los bordes, en minúsculas, acotado.
export function normalizarEmail(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase().slice(0, 254) : '';
}

// Una dirección que la base acepta como inet, o null (la de un socket ya cerrado llega como «desconocida»).
export function ipParaLaBase(ip: string): string | null {
  return isIP(ip) !== 0 ? ip : null;
}

// A los registros (logs) nunca va la dirección completa (docs/10 §8.4 punto 43; revisión del 08/11/2026): IPv4 truncada a /24, IPv6 a
// /48; lo que no es una dirección, «desconocida». La base sí guarda la completa en `sesion` y `acceso` (docs/20 §2: registro de seguridad).
export function ipParaRegistro(ip: string): string {
  const v = isIP(ip);
  if (v === 4) return ip.split('.').slice(0, 3).join('.') + '.0/24';
  if (v === 6) return ip.split(':').slice(0, 3).join(':') + '::/48';
  return 'desconocida';
}

// Lo que `acceso.email_intentado` guarda: solo si tiene forma de correo (algo@dominio.algo, 254 como máximo); cualquier otro texto no se
// guarda (revisión del 08/11/2026: una clave pegada en el campo equivocado o la basura de un escáner quedarían 90 días en la base).
const FORMA_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function emailParaRegistro(email: string | null): string | null {
  if (email === null || email.length === 0 || email.length > 254) return null;
  return FORMA_EMAIL.test(email) ? email : null;
}

@Injectable()
export class SesionService implements OnModuleInit {
  private readonly log = new Logger('sesion');
  private readonly avisos = new AvisosAcotados();
  readonly bloqueos: Bloqueos;
  private readonly turnos = new Turnos();
  private relleno?: Promise<string>;
  // Reloj de la aplicación: las pruebas lo reemplazan.
  ahora: () => Date = () => new Date();

  constructor(@Inject(POOL) private readonly pool: Pool) {
    this.bloqueos = new Bloqueos(() => this.ahora().getTime());
  }

  // El hash de relleno se calcula al arrancar (revisión del 08/11/2026): calculado al primer usuario inexistente, ese primer intento
  // tardaba el doble y revelaba que el email no existe. Con su turno, como cualquier otro cálculo (memoria, turnos.ts).
  async onModuleInit(): Promise<void> {
    await this.hashDeRelleno();
  }

  // Hash de una clave de persona (N = 2^17), con turno: como mucho dos a la vez (turnos.ts).
  hashClave(clave: string): Promise<string> {
    return this.turnos.con(() => hashScrypt(clave, undefined, N_PERSONA));
  }

  // Verifica SIEMPRE contra un hash del mismo costo, exista o no el usuario: la respuesta tarda lo mismo (docs/20 §4). El de relleno se
  // calcula una vez, de un secreto aleatorio que nadie conoce. `origen` (la dirección del cliente) activa el tope por dirección.
  async verificarClave(clave: string, hash: string | null, origen?: string): Promise<boolean> {
    const contra = hash ?? (await this.hashDeRelleno());
    const valida = await this.turnos.con(() => verificarScrypt(clave, contra), origen);
    return hash !== null && valida;
  }

  // La verificación de un intento: un 503 por la cola llena cuenta como fallo de la dirección (revisión del 08/11/2026).
  private async verificarIntento(clave: string, hash: string | null, ip: string): Promise<boolean> {
    try {
      return await this.verificarClave(clave, hash, ip);
    } catch (e) {
      if (e instanceof ServiceUnavailableException) this.bloqueos.registrarFalloIp(ip);
      throw e;
    }
  }

  private hashDeRelleno(): Promise<string> {
    this.relleno ??= this.turnos.con(() => hashScrypt(randomBytes(24).toString('base64url'), undefined, N_PERSONA)).catch((e: unknown) => {
      this.relleno = undefined;
      throw e;
    });
    return this.relleno;
  }

  // 429 «bloqueado». La fila en `acceso` va una sola vez por (email, dirección) y ventana de 15 min (bloqueos.ts); el aviso, acotado.
  private async rechazarBloqueado(email: string, ip: string, espera: number): Promise<never> {
    if (this.bloqueos.debeRegistrarBloqueo(email, ip)) await this.registrar({ resultado: 'bloqueado', email, ip });
    const motivo = this.bloqueos.restanteIp(ip) > 0 ? `inicio de sesión bloqueado por IP ${ipParaRegistro(ip)}`
      : this.bloqueos.restanteUsuario(email) > 0 ? 'inicio de sesión bloqueado por usuario' : 'inicio de sesión rechazado: registro de bloqueos lleno';
    const aviso = this.avisos.registrar(motivo);
    if (aviso !== null) this.log.warn(aviso);
    throw new HttpException(
      { statusCode: 429, message: `bloqueado: demasiados intentos fallidos; reintenta en ${Math.ceil(espera / 1000)} s`, reintentar_en_s: Math.ceil(espera / 1000) },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  // POST /sesion. Orden: bloqueo por IP, bloqueo por usuario (sin calcular el hash: un bloqueo no cuesta CPU), verificación (siempre,
  // aunque el usuario no exista), otra vez el bloqueo y recién entonces el resultado. Todo intento va a `acceso` (el bloqueado, una vez
  // por ventana). El segundo vistazo al bloqueo cierra la ventana entre comprobar y actuar (revisión del 08/11/2026): mientras este
  // intento esperaba su turno del hash, otros desde la misma dirección o con el mismo email pudieron completar el bloqueo; si ya rige,
  // la respuesta es 429 aunque la clave sea la correcta, como si hubiera llegado un instante después.
  async iniciar(cuerpo: unknown, ip: string, agente: string | undefined): Promise<SesionAbierta> {
    const { email, clave } = credencialesDelCuerpo(cuerpo);
    const espera = this.bloqueos.restante(email, ip);
    if (espera > 0) return this.rechazarBloqueado(email, ip, espera);
    const r = await this.pool.query<FilaUsuario>(
      'SELECT id, nombre, email, hash_password, activo, clave_temporal, clave_temporal_vence_en FROM usuario WHERE email = $1', [email]);
    const u = r.rows[0];
    const valida = await this.verificarIntento(clave, u?.hash_password ?? null, ip);
    const esperaTras = Math.max(this.bloqueos.restanteIp(ip), this.bloqueos.restanteUsuario(email));
    if (esperaTras > 0) return this.rechazarBloqueado(email, ip, esperaTras);
    const ahora = this.ahora();
    let resultado: ResultadoAcceso = 'ok';
    if (u === undefined || !valida) resultado = 'clave_incorrecta';
    else if (!u.activo) resultado = 'inactivo';
    else if (u.clave_temporal && claveTemporalVencida(u.clave_temporal_vence_en, ahora)) resultado = 'clave_incorrecta'; // vencida: ya no vale
    if (resultado !== 'ok' || u === undefined) {
      const bloqueo = this.bloqueos.registrarFallo(email, ip);
      await this.registrar({ resultado, email, ip, usuarioId: u?.id ?? null });
      if (bloqueo > 0) this.log.warn(`usuario bloqueado ${bloqueo / 1000} s tras ${resultado} repetidos`);
      throw new UnauthorizedException(MENSAJE_CREDENCIALES);
    }
    this.bloqueos.registrarExito(email);
    const abierta = await this.abrirSesion(u, ip, agente);
    return abierta;
  }

  // Identificador nuevo en cada inicio de sesión y en cada cambio de clave: nunca se reutiliza uno anterior (docs/20 §3).
  private async abrirSesion(u: Pick<FilaUsuario, 'id' | 'nombre' | 'email' | 'clave_temporal'>, ip: string, agente: string | undefined): Promise<SesionAbierta> {
    const identificador = generarIdentificador();
    const id = hashIdentificador(identificador);
    const ahora = this.ahora();
    const expira = new Date(ahora.getTime() + VIDA_ABSOLUTA_MS);
    await this.pool.query(
      'INSERT INTO sesion (id, usuario_id, creada_en, ultima_actividad, expira_en, ip, agente) VALUES ($1, $2, $3, $3, $4, $5, $6)',
      [id, u.id, ahora, expira, ipParaLaBase(ip), agente === undefined ? null : agente.slice(0, 200)],
    );
    await this.registrar({ resultado: 'ok', email: u.email, ip, usuarioId: u.id, sesionId: id });
    return { identificador, usuario: { id: u.id, nombre: u.nombre, email: u.email, clave_temporal: u.clave_temporal }, expira_en: expira.toISOString() };
  }

  // La sesión viva de un identificador, con el usuario y sus sitios, o null (no existe, vencida, revocada, usuario inactivo o clave
  // temporal vencida). Renueva ultima_actividad si pasó más de un minuto (cookie.ts, RENOVAR_CADA_MS).
  cargar(identificador: string): Promise<UsuarioSesion | null> {
    return this.cargarPorId(hashIdentificador(identificador), { renovar: true });
  }

  // Lo mismo a partir del hash que guarda la base (`UsuarioSesion.sesionId`). El canal en vivo revalida así su sesión en cada latido
  // (revisión del 08/11/2026) con `renovar: false`: un flujo abierto no es actividad de la persona, y renovar en cada latido dejaría viva
  // para siempre la sesión de una pantalla sin nadie delante (docs/20 §3).
  async cargarPorId(id: string, opciones: { renovar: boolean }): Promise<UsuarioSesion | null> {
    const r = await this.pool.query<{
      creada_en: Date; ultima_actividad: Date; expira_en: Date; revocada_en: Date | null; usuario_id: string; nombre: string; email: string;
      activo: boolean; clave_temporal: boolean; clave_temporal_vence_en: Date | null; sitios: { sitio_id: string; rol: string }[];
    }>(
      `SELECT s.creada_en, s.ultima_actividad, s.expira_en, s.revocada_en, u.id AS usuario_id, u.nombre, u.email, u.activo, u.clave_temporal,
              u.clave_temporal_vence_en,
              coalesce((SELECT json_agg(json_build_object('sitio_id', us.sitio_id, 'rol', us.rol))
                          FROM usuario_sitio us WHERE us.usuario_id = u.id AND us.activo), '[]'::json) AS sitios
         FROM sesion s JOIN usuario u ON u.id = s.usuario_id
        WHERE s.id = $1`,
      [id],
    );
    const s = r.rows[0];
    if (s === undefined || !s.activo) return null;
    const ahora = this.ahora();
    if (motivoDeVencimiento(s, ahora) !== null) return null;
    // Una clave temporal vencida tampoco sirve en una sesión ya abierta (revisión del 08/11/2026): sin esto, quien entró con ella a las
    // 23 h seguía hasta 8 h más con una clave que ya no abre sesión.
    if (s.clave_temporal && claveTemporalVencida(s.clave_temporal_vence_en, ahora)) return null;
    if (opciones.renovar && debeRenovar(s.ultima_actividad, ahora)) {
      await this.pool.query('UPDATE sesion SET ultima_actividad = $2 WHERE id = $1 AND revocada_en IS NULL', [id, ahora]);
    }
    const sitios = new Map<string, Rol>();
    for (const x of s.sitios) if ((ROLES as readonly string[]).includes(x.rol)) sitios.set(x.sitio_id, x.rol as Rol);
    return { id: s.usuario_id, nombre: s.nombre, email: s.email, sistema: false, todos: false, sitios, claveTemporal: s.clave_temporal, sesionId: id };
  }

  // Lo que devuelve GET /sesion: quién soy, mis sitios con su rol y cuándo vence la sesión.
  async describir(u: UsuarioSesion): Promise<Record<string, unknown>> {
    if (u.sistema) return { sistema: true, nombre: u.nombre, sitios: 'todos', rol: 'administrador' };
    const r = await this.pool.query<{ sitio_id: string; codigo: string; nombre: string; rol: string }>(
      `SELECT us.sitio_id, s.codigo, s.nombre, us.rol FROM usuario_sitio us JOIN sitio s ON s.id = us.sitio_id
        WHERE us.usuario_id = $1 AND us.activo ORDER BY s.nombre`, [u.id]);
    const v = await this.pool.query<{ expira_en: Date; ultima_actividad: Date }>('SELECT expira_en, ultima_actividad FROM sesion WHERE id = $1', [u.sesionId]);
    const fila = v.rows[0];
    return {
      sistema: false, usuario: { id: u.id, nombre: u.nombre, email: u.email }, clave_temporal: u.claveTemporal, sitios: r.rows,
      expira_en: fila?.expira_en.toISOString() ?? null,
      inactividad_vence_en: fila ? new Date(fila.ultima_actividad.getTime() + 30 * 60_000).toISOString() : null,
    };
  }

  // DELETE /sesion: revoca la sesión (o todas las del usuario) y deja la fila «cierre» en acceso.
  async cerrar(u: UsuarioSesion, todas: boolean, ip: string): Promise<number> {
    if (u.sistema || u.id === null || u.sesionId === null) throw new BadRequestException('la clave de administrador no abre sesión: no hay nada que cerrar');
    const ahora = this.ahora();
    const r = todas
      ? await this.pool.query('UPDATE sesion SET revocada_en = $2 WHERE usuario_id = $1 AND revocada_en IS NULL', [u.id, ahora])
      : await this.pool.query('UPDATE sesion SET revocada_en = $2 WHERE id = $1 AND revocada_en IS NULL', [u.sesionId, ahora]);
    await this.registrar({ resultado: 'cierre', email: u.email, ip, usuarioId: u.id, sesionId: u.sesionId });
    return r.rowCount ?? 0;
  }

  // POST /sesion/clave: la clave actual, la nueva con sus reglas; revoca todas las sesiones del usuario y abre una nueva (identificador
  // regenerado, docs/20 §3). Una clave actual mala cuenta como intento fallido para el bloqueo por usuario y por IP.
  async cambiarClave(u: UsuarioSesion, cuerpo: unknown, ip: string, agente: string | undefined): Promise<SesionAbierta> {
    if (u.sistema || u.id === null || u.email === null) throw new BadRequestException('la clave de administrador no tiene clave que cambiar');
    if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new BadRequestException(['el cuerpo debe ser un objeto JSON']);
    const c = cuerpo as Record<string, unknown>;
    if (typeof c.actual !== 'string' || typeof c.nueva !== 'string' || c.actual.length > 1024) {
      throw new BadRequestException(['actual y nueva son obligatorias (texto)']);
    }
    const bloqueado = (espera: number): HttpException =>
      new HttpException({ statusCode: 429, message: `bloqueado: demasiados intentos fallidos; reintenta en ${Math.ceil(espera / 1000)} s` }, HttpStatus.TOO_MANY_REQUESTS);
    const espera = this.bloqueos.restante(u.email, ip);
    if (espera > 0) throw bloqueado(espera);
    const r = await this.pool.query<FilaUsuario>(
      'SELECT id, nombre, email, hash_password, activo, clave_temporal, clave_temporal_vence_en FROM usuario WHERE id = $1', [u.id]);
    const fila = r.rows[0];
    const valida = fila !== undefined && (await this.verificarIntento(c.actual, fila.hash_password, ip));
    const esperaTras = Math.max(this.bloqueos.restanteIp(ip), this.bloqueos.restanteUsuario(u.email)); // la misma ventana que en iniciar
    if (esperaTras > 0) throw bloqueado(esperaTras);
    if (fila === undefined || !valida) {
      this.bloqueos.registrarFallo(u.email, ip);
      throw new BadRequestException(['la clave actual no es correcta']);
    }
    const motivos = motivosDeClave(c.nueva, { email: fila.email, anterior: c.actual });
    if (motivos.length > 0) throw new BadRequestException(motivos);
    const hash = await this.hashClave(c.nueva);
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query('UPDATE usuario SET hash_password = $2, clave_temporal = false, clave_temporal_vence_en = NULL WHERE id = $1', [u.id, hash]);
      await cliente.query('UPDATE sesion SET revocada_en = $2 WHERE usuario_id = $1 AND revocada_en IS NULL', [u.id, this.ahora()]);
      await cliente.query("INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES (NULL, 'usuario_clave', $1)", [JSON.stringify({ usuario_id: u.id, por: u.id })]);
      await cliente.query('COMMIT');
    } catch (e) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      cliente.release();
    }
    this.bloqueos.registrarExito(u.email);
    return this.abrirSesion({ ...fila, clave_temporal: false }, ip, agente);
  }

  // Una fila en `acceso`. Si la base no la acepta, se registra el error y la petición sigue: la bitácora no decide si se entra.
  async registrar(a: { resultado: ResultadoAcceso; email: string | null; ip: string; usuarioId?: string | null; sesionId?: string | null }): Promise<void> {
    try {
      await this.pool.query(
        'INSERT INTO acceso (instante, usuario_id, email_intentado, ip, resultado, sesion_id) VALUES ($1, $2, $3, $4, $5, $6)',
        [this.ahora(), a.usuarioId ?? null, emailParaRegistro(a.email), ipParaLaBase(a.ip), a.resultado, a.sesionId ?? null],
      );
    } catch (e) {
      this.log.error(`no se pudo registrar el acceso (${a.resultado}): ${(e as Error).message}`);
    }
  }
}

// Cuerpo de POST /sesion: email y clave, texto. La forma se valida antes de nada (400 no revela si la cuenta existe); una clave de más
// de 1 024 caracteres no se calcula (el máximo de una clave válida es 128).
export function credencialesDelCuerpo(cuerpo: unknown): { email: string; clave: string } {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new BadRequestException(['el cuerpo debe ser un objeto JSON con email y clave']);
  const c = cuerpo as Record<string, unknown>;
  if (typeof c.email !== 'string' || typeof c.clave !== 'string' || c.email.trim() === '' || c.clave === '' || c.clave.length > 1024) {
    throw new BadRequestException(['email y clave son obligatorios (texto)']);
  }
  return { email: normalizarEmail(c.email), clave: c.clave };
}
