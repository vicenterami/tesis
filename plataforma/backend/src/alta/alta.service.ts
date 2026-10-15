import {
  BadGatewayException, BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, InternalServerErrorException,
  Logger, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { POOL } from '../db/db.module';
import { ErrorDynsec, ROL_DISPOSITIVO, ROL_PASARELA, ordenBaja, ordenRotacion, ordenesAlta, ordenesAltaDispositivo, ordenesAltaPasarela } from '../broker/dynsec';
import { DynsecService } from '../broker/dynsec.service';
import { AltaValidada, Formato, Via } from './alta.dto';
import { generarSecreto, hashScrypt } from './credenciales';
import { FormatoPasarela, PasarelaValidada } from './pasarela.dto';

export interface CanalCreado {
  id: string;
  magnitud: string;
  unidad: string;
  etiqueta: string | null;
}
// Lo que el dispositivo necesita para conectarse, según su vía (docs/10 §3). La credencial aparece aquí UNA vez.
export interface ConexionMqtt {
  via: 'mqtt';
  usuario: string;
  credencial: string;
  topico: string;
  ejemplo: { topico: string; carga: string };
}
export interface ConexionHttp {
  via: 'http';
  token: string;
  nota: string;
}
export interface ConexionLorawan {
  via: 'lorawan';
  pasarela_id: string;
  nota: string;
}
export interface DispositivoCreado {
  id: string;
  id_fisico: string;
  nombre: string;
  estado: 'activo';
  zona_id: string;
  sitio_codigo: string;
  via: Via;
  formato: Formato;
  intervalo_esperado_s: number;
  creado_en: string;
  canales: CanalCreado[];
  conexion: ConexionMqtt | ConexionHttp | ConexionLorawan;
}
// Resultado de la baja (docs/10 §3): el dispositivo queda, con historial, pero ya no se le acepta nada.
export interface DispositivoDadoDeBaja {
  id: string;
  id_fisico: string;
  estado: 'baja';
  estado_anterior: 'activo' | 'mantenimiento';
  via: Via;
  credenciales_revocadas: number;
  condiciones_cerradas: number;
  dado_de_baja_en: string;
}
// Resultado de la rotación (docs/10 §3): la credencial nueva se muestra UNA vez; la anterior deja de valer al confirmar.
// Pasarelas (rutas B y C, docs/10 §8.4 punto 47). La conexión trae el puerto con TLS, el usuario, la credencial (una sola vez) y las
// plantillas de tópico del formato declarado, listas para copiar en ChirpStack o en la pasarela Milesight.
export interface ConexionPasarela {
  usuario: string;
  credencial: string;
  puerto: number;
  publica_en: string;
  comandos: string;
  plantillas: Record<string, string>;
  nota: string;
}
export interface PasarelaCreada {
  id: string;
  id_fisico: string;
  nombre: string;
  sitio_codigo: string;
  formato: FormatoPasarela;
  activo: true;
  creado_en: string;
  conexion: ConexionPasarela;
}
export interface PasarelaDadaDeBaja {
  id: string;
  id_fisico: string;
  activo: false;
  credenciales_revocadas: number;
  nodos_sin_pasarela: number;
  dada_de_baja_en: string;
}
export interface CredencialPasarelaRotada {
  id: string;
  id_fisico: string;
  rotada_en: string;
  conexion: ConexionPasarela;
}
export interface PasarelaListada {
  id: string;
  id_fisico: string;
  nombre: string;
  sitio_codigo: string;
  formato: FormatoPasarela;
  activo: boolean;
  nodos: number;
  vista_por_ultima_vez: string | null;
  creado_en: string;
}
interface PasarelaBloqueada { id: string; id_fisico: string; activo: boolean; formato: FormatoPasarela; sitio_codigo: string }

export interface CredencialRotada {
  id: string;
  id_fisico: string;
  via: 'mqtt' | 'http';
  sitio_codigo: string;
  rotada_en: string;
  conexion: ConexionMqtt | ConexionHttp;
}

interface ErrorPg {
  code?: string;
  detail?: string;
  constraint?: string;
  message: string;
}
// La fila que bloquea la baja y la rotación: ninguna otra baja o rotación la toca hasta confirmar (FOR NO KEY UPDATE: las tramas
// y eventos que la referencian por clave foránea siguen entrando; con FOR UPDATE esperaban mientras se esperaba al broker, 15/10).
interface FilaBloqueada {
  id: string;
  id_fisico: string;
  estado: 'activo' | 'mantenimiento' | 'baja';
  via: Via;
  pasarela_id: string | null;
  sitio_codigo: string;
}
type Operacion = 'alta' | 'baja' | 'rotación';

// Operaciones de escritura simultáneas admitidas por proceso (alta, baja o rotación): cada una retiene una conexión del pool
// (de 5, compartido con la recepción de tramas) mientras espera al broker (hasta 5 s). Más que esto, 429: el pool no se agota
// por administrar.
export const MAX_ALTAS_EN_CURSO = 2;

// Aprovisionamiento por API (docs/10 §3 y §8.4 puntos 25, 41 y 42): alta (HU-11), baja y rotación de la credencial. Todo o
// nada: lo de la base va en UNA transacción y la orden al broker se ejecuta dentro de ella, antes de confirmar. Si el broker
// falla, la transacción se deshace; si la base falla al confirmar después de tocar el broker, se deja el broker como estaba
// cuando se puede (alta: se borra el cliente) o se dice qué repetir cuando no (rotación: la clave anterior puede ya no valer).
// Dos operaciones simultáneas sobre el mismo dispositivo: la base las serializa (bloqueo por identificador del disparador de
// la migración 11 en el alta; FOR NO KEY UPDATE de la fila en la baja y la rotación) y la segunda recibe 409 o espera su turno.
@Injectable()
export class AltaService {
  private readonly log = new Logger('alta');
  private enCurso = 0;

  constructor(
    @Inject(POOL) private readonly pool: Pool,
    private readonly dynsec: DynsecService,
  ) {}

  // Operaciones de aprovisionamiento en curso (las ve GET /salud, docs/10 §8.4 punto 43).
  get operacionesEnCurso(): number {
    return this.enCurso;
  }

  async crear(a: AltaValidada): Promise<DispositivoCreado> {
    // Sin administración del broker no se abre siquiera la transacción: un dispositivo sin credencial no sirve de nada.
    if (a.via === 'mqtt' && !this.dynsec.disponible) throw this.sinBroker();
    const c = await this.tomar();
    let enBroker = false;
    try {
      await this.abrir(c);
      const sitio = await this.sitioDe(c, a);
      // Un nodo lorawan copia el formato de su pasarela (la base exige que sean iguales: migración 15); uno directo trae el suyo.
      const formato: Formato = a.formato ?? sitio.formatoPasarela ?? 'senml';
      const unidades = await this.unidadesDe(c, a);
      const d = await c.query<{ id: string; creado_en: Date }>(
        'INSERT INTO dispositivo (zona_id, id_fisico, nombre, intervalo_esperado_s, via, formato, pasarela_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, creado_en',
        [a.zona_id, a.id_fisico, a.nombre, a.intervalo_esperado_s, a.via, formato, a.pasarela_id],
      );
      const id = d.rows[0].id;
      const canales: CanalCreado[] = [];
      for (const k of a.canales) {
        const r = await c.query<{ id: string }>('INSERT INTO canal (dispositivo_id, magnitud_codigo, etiqueta) VALUES ($1, $2, $3) RETURNING id', [id, k.magnitud, k.etiqueta]);
        canales.push({ id: r.rows[0].id, magnitud: k.magnitud, unidad: unidades.get(k.magnitud) ?? '', etiqueta: k.etiqueta });
      }
      const secreto = a.via === 'lorawan' ? null : generarSecreto(); // la pasarela autentica a los lorawan (docs/10 §3)
      if (secreto !== null) await c.query('INSERT INTO credencial (dispositivo_id, hash) VALUES ($1, $2)', [id, await hashScrypt(secreto)]); // nunca el secreto
      await c.query('INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES ($1, $2, $3)', [
        id, 'alta', JSON.stringify({ via: a.via, formato, canales: a.canales.map((k) => k.magnitud), origen: 'api' }),
      ]);
      if (a.via === 'mqtt' && secreto !== null) {
        await this.dynsec.ordenar(ordenesAltaDispositivo(a.id_fisico, secreto));
        enBroker = true;
      }
      await c.query('COMMIT');
      this.log.log(`alta: ${a.id_fisico} (${a.via}/${formato}, ${canales.length} canal(es)) en el sitio ${sitio.codigo}`);
      return {
        id, id_fisico: a.id_fisico, nombre: a.nombre, estado: 'activo', zona_id: a.zona_id, sitio_codigo: sitio.codigo, via: a.via,
        formato, intervalo_esperado_s: a.intervalo_esperado_s, creado_en: d.rows[0].creado_en.toISOString(), canales,
        conexion: this.conexion(a.via, a.id_fisico, sitio.codigo, canales, secreto, a.pasarela_id),
      };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      // Se deshace en el broker si la orden se confirmó, o si pudo ejecutarse sin confirmación (sin respuesta, conexión perdida):
      // borrar un cliente que no existe solo devuelve un error inofensivo; dejarlo vivo sería una credencial huérfana.
      if (enBroker || (e instanceof ErrorDynsec && e.ambiguo)) await this.deshacerEnBroker(a.id_fisico);
      throw this.traducir(e, a.id_fisico, 'alta');
    } finally {
      this.soltar(c);
    }
  }

  // Baja (docs/10 §3): `estado = baja`, credenciales desactivadas, condiciones abiertas cerradas (ya nada va a cerrarlas) y
  // evento, en una transacción; el cliente del broker se borra dentro de ella, antes de confirmar. Un cliente que el broker ya
  // no tiene cuenta como borrado (una baja repetida tras un corte deja el mismo estado final). La fila queda: el historial de
  // mediciones y eventos no se pierde, y el filtro 1 manda a cuarentena («dado_de_baja») lo que llegue por otra vía.
  async darDeBaja(id: string): Promise<DispositivoDadoDeBaja> {
    const c = await this.tomar();
    let idFisico = id;
    try {
      await this.abrir(c);
      const d = await this.bloquear(c, id);
      idFisico = d.id_fisico;
      if (d.estado === 'baja') throw new ConflictException(`«${d.id_fisico}» ya está dado de baja`);
      if (d.via === 'mqtt' && !this.dynsec.disponible) throw this.sinBroker();
      await c.query('UPDATE dispositivo SET estado = $2 WHERE id = $1', [id, 'baja']);
      const cred = await c.query('UPDATE credencial SET activa = false WHERE dispositivo_id = $1 AND activa', [id]);
      const cond = await c.query('UPDATE condicion SET cerrada_en = now() WHERE dispositivo_id = $1 AND cerrada_en IS NULL', [id]);
      const ev = await c.query<{ ocurrido_en: Date }>('INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES ($1, $2, $3) RETURNING ocurrido_en', [
        id, 'baja', JSON.stringify({ via: d.via, estado_anterior: d.estado, credenciales_revocadas: cred.rowCount ?? 0, condiciones_cerradas: cond.rowCount ?? 0, origen: 'api' }),
      ]);
      if (d.via === 'mqtt') await this.borrarEnBroker(d.id_fisico);
      await c.query('COMMIT');
      this.log.log(`baja: ${d.id_fisico} (${d.via}; ${cred.rowCount ?? 0} credencial(es) revocada(s), ${cond.rowCount ?? 0} condición(es) cerrada(s))`);
      return {
        id, id_fisico: d.id_fisico, estado: 'baja', estado_anterior: d.estado, via: d.via, credenciales_revocadas: cred.rowCount ?? 0,
        condiciones_cerradas: cond.rowCount ?? 0, dado_de_baja_en: ev.rows[0].ocurrido_en.toISOString(),
      };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      // Nada que deshacer en el broker: si el cliente llegó a borrarse, repetir la baja lo da por borrado y termina bien.
      throw this.traducir(e, idFisico, 'baja');
    } finally {
      this.soltar(c);
    }
  }

  // Rotación (docs/10 §3; RF-45): la credencial perdida no se recupera, se reemplaza. Nueva fila en `credencial` (la anterior
  // queda inactiva), evento, y `setClientPassword` en el broker dentro de la transacción. Si el broker no conoce al cliente
  // (huérfano al revés: la base lo tiene y el broker no), se crea con su rol: rotar es también la reparación. Un corte después
  // de cambiar la clave en el broker deja al dispositivo sin poder entrar con la anterior: el remedio es repetir la rotación.
  async rotarCredencial(id: string): Promise<CredencialRotada> {
    const c = await this.tomar();
    let idFisico = id;
    try {
      await this.abrir(c);
      const d = await this.bloquear(c, id);
      idFisico = d.id_fisico;
      if (d.estado === 'baja') throw new ConflictException(`«${d.id_fisico}» está dado de baja: no se rota su credencial`);
      if (d.via === 'lorawan') throw new BadRequestException(['un dispositivo lorawan no tiene credencial propia: lo autentica su pasarela']);
      if (d.via === 'mqtt' && !this.dynsec.disponible) throw this.sinBroker();
      const canales = await this.canalesDe(c, id);
      const secreto = generarSecreto();
      await c.query('UPDATE credencial SET activa = false WHERE dispositivo_id = $1 AND activa', [id]);
      await c.query('INSERT INTO credencial (dispositivo_id, hash) VALUES ($1, $2)', [id, await hashScrypt(secreto)]); // nunca el secreto
      const ev = await c.query<{ ocurrido_en: Date }>('INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES ($1, $2, $3) RETURNING ocurrido_en', [
        id, 'rotacion', JSON.stringify({ via: d.via, origen: 'api' }),
      ]);
      if (d.via === 'mqtt') await this.rotarEnBroker(d.id_fisico, secreto);
      await c.query('COMMIT');
      this.log.log(`rotación: ${d.id_fisico} (${d.via})`);
      return {
        id, id_fisico: d.id_fisico, via: d.via, sitio_codigo: d.sitio_codigo, rotada_en: ev.rows[0].ocurrido_en.toISOString(),
        conexion: this.conexion(d.via, d.id_fisico, d.sitio_codigo, canales, secreto, null) as ConexionMqtt | ConexionHttp,
      };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw this.traducir(e, idFisico, 'rotación');
    } finally {
      this.soltar(c);
    }
  }

  // Alta de una pasarela: la misma forma que la de un dispositivo (todo o nada; el cliente del broker nace con su rol en una orden).
  async crearPasarela(p: PasarelaValidada): Promise<PasarelaCreada> {
    if (!this.dynsec.disponible) throw this.sinBroker();
    const c = await this.tomar();
    let enBroker = false;
    try {
      await this.abrir(c);
      const s = await c.query<{ codigo: string; activo: boolean }>('SELECT codigo, activo FROM sitio WHERE id = $1', [p.sitio_id]);
      if (s.rows.length === 0) throw new BadRequestException(['sitio_id no existe']);
      if (!s.rows[0].activo) throw new BadRequestException(['el sitio está inactivo']);
      const r = await c.query<{ id: string; creado_en: Date }>(
        'INSERT INTO pasarela (sitio_id, id_fisico, nombre, formato) VALUES ($1, $2, $3, $4) RETURNING id, creado_en',
        [p.sitio_id, p.id_fisico, p.nombre, p.formato],
      );
      const id = r.rows[0].id;
      const secreto = generarSecreto();
      await c.query('INSERT INTO credencial (pasarela_id, hash) VALUES ($1, $2)', [id, await hashScrypt(secreto)]); // nunca el secreto
      await c.query('INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES (NULL, $1, $2)', [
        'pasarela_alta', JSON.stringify({ pasarela_id: id, id_fisico: p.id_fisico, formato: p.formato, origen: 'api' }),
      ]);
      await this.dynsec.ordenar(ordenesAltaPasarela(p.id_fisico, secreto));
      enBroker = true;
      await c.query('COMMIT');
      this.log.log(`alta de pasarela: ${p.id_fisico} (${p.formato}) en el sitio ${s.rows[0].codigo}`);
      return {
        id, id_fisico: p.id_fisico, nombre: p.nombre, sitio_codigo: s.rows[0].codigo, formato: p.formato, activo: true,
        creado_en: r.rows[0].creado_en.toISOString(), conexion: this.conexionPasarela(p.formato, s.rows[0].codigo, p.id_fisico, secreto),
      };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      if (enBroker || (e instanceof ErrorDynsec && e.ambiguo)) await this.deshacerEnBroker(p.id_fisico);
      throw this.traducir(e, p.id_fisico, 'alta');
    } finally {
      this.soltar(c);
    }
  }

  // Baja de una pasarela: `activo = false`, credenciales revocadas, evento y cliente borrado del broker, en una transacción. Sus nodos
  // quedan sin quien publique por ellos; lo que llegue con una credencial vieja va a cuarentena («pasarela inactiva»).
  async darDeBajaPasarela(id: string): Promise<PasarelaDadaDeBaja> {
    const c = await this.tomar();
    let idFisico = id;
    try {
      await this.abrir(c);
      const p = await this.bloquearPasarela(c, id);
      idFisico = p.id_fisico;
      if (!p.activo) throw new ConflictException(`la pasarela «${p.id_fisico}» ya está dada de baja`);
      if (!this.dynsec.disponible) throw this.sinBroker();
      await c.query('UPDATE pasarela SET activo = false WHERE id = $1', [id]);
      const cred = await c.query('UPDATE credencial SET activa = false WHERE pasarela_id = $1 AND activa', [id]);
      const nodos = await c.query<{ n: string }>("SELECT count(*) AS n FROM dispositivo WHERE pasarela_id = $1 AND estado <> 'baja'", [id]);
      const ev = await c.query<{ ocurrido_en: Date }>('INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES (NULL, $1, $2) RETURNING ocurrido_en', [
        'pasarela_baja', JSON.stringify({ pasarela_id: id, id_fisico: p.id_fisico, credenciales_revocadas: cred.rowCount ?? 0, origen: 'api' }),
      ]);
      await this.borrarEnBroker(p.id_fisico);
      await c.query('COMMIT');
      this.log.log(`baja de pasarela: ${p.id_fisico} (${cred.rowCount ?? 0} credencial(es) revocada(s), ${nodos.rows[0].n} nodo(s) sin pasarela)`);
      return {
        id, id_fisico: p.id_fisico, activo: false, credenciales_revocadas: cred.rowCount ?? 0, nodos_sin_pasarela: Number(nodos.rows[0].n),
        dada_de_baja_en: ev.rows[0].ocurrido_en.toISOString(),
      };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw this.traducir(e, idFisico, 'baja');
    } finally {
      this.soltar(c);
    }
  }

  // Rotación de la credencial de una pasarela: la misma que la de un dispositivo (rotar también repara un cliente que falta).
  async rotarPasarela(id: string): Promise<CredencialPasarelaRotada> {
    const c = await this.tomar();
    let idFisico = id;
    try {
      await this.abrir(c);
      const p = await this.bloquearPasarela(c, id);
      idFisico = p.id_fisico;
      if (!p.activo) throw new ConflictException(`la pasarela «${p.id_fisico}» está dada de baja: no se rota su credencial`);
      if (!this.dynsec.disponible) throw this.sinBroker();
      const secreto = generarSecreto();
      await c.query('UPDATE credencial SET activa = false WHERE pasarela_id = $1 AND activa', [id]);
      await c.query('INSERT INTO credencial (pasarela_id, hash) VALUES ($1, $2)', [id, await hashScrypt(secreto)]); // nunca el secreto
      const ev = await c.query<{ ocurrido_en: Date }>('INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES (NULL, $1, $2) RETURNING ocurrido_en', [
        'pasarela_rotacion', JSON.stringify({ pasarela_id: id, id_fisico: p.id_fisico, origen: 'api' }),
      ]);
      await this.rotarEnBroker(p.id_fisico, secreto, ROL_PASARELA);
      await c.query('COMMIT');
      this.log.log(`rotación de pasarela: ${p.id_fisico}`);
      return { id, id_fisico: p.id_fisico, rotada_en: ev.rows[0].ocurrido_en.toISOString(), conexion: this.conexionPasarela(p.formato, p.sitio_codigo, p.id_fisico, secreto) };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw this.traducir(e, idFisico, 'rotación');
    } finally {
      this.soltar(c);
    }
  }

  // Lista de pasarelas con sus nodos y la última vez vista, derivada de ellos (la recepción no escribe la fila de la pasarela: punto 27).
  async listarPasarelas(): Promise<PasarelaListada[]> {
    const r = await this.pool.query<{ id: string; id_fisico: string; nombre: string; sitio_codigo: string; formato: FormatoPasarela; activo: boolean; nodos: string; vista: Date | null; creado_en: Date }>(
      `SELECT p.id, p.id_fisico, p.nombre, s.codigo AS sitio_codigo, p.formato, p.activo, p.creado_en,
              count(d.id) FILTER (WHERE d.estado <> 'baja') AS nodos, max(e.visto_por_ultima_vez) AS vista
         FROM pasarela p JOIN sitio s ON s.id = p.sitio_id
         LEFT JOIN dispositivo d ON d.pasarela_id = p.id LEFT JOIN estado_dispositivo e ON e.dispositivo_id = d.id
        GROUP BY p.id, s.codigo ORDER BY p.id_fisico`,
    );
    return r.rows.map((x) => ({
      id: x.id, id_fisico: x.id_fisico, nombre: x.nombre, sitio_codigo: x.sitio_codigo, formato: x.formato, activo: x.activo,
      nodos: Number(x.nodos), vista_por_ultima_vez: x.vista ? x.vista.toISOString() : null, creado_en: x.creado_en.toISOString(),
    }));
  }

  private async bloquearPasarela(c: PoolClient, id: string): Promise<PasarelaBloqueada> {
    const r = await c.query<PasarelaBloqueada>(
      `SELECT p.id, p.id_fisico, p.activo, p.formato, s.codigo AS sitio_codigo
         FROM pasarela p JOIN sitio s ON s.id = p.sitio_id WHERE p.id = $1 FOR NO KEY UPDATE OF p`,
      [id],
    );
    if (r.rows.length === 0) throw new NotFoundException('pasarela no encontrada');
    return r.rows[0];
  }

  private conexionPasarela(formato: FormatoPasarela, codigo: string, idFisico: string, secreto: string): ConexionPasarela {
    const base = `sitio/${codigo}/pasarela/${idFisico}`;
    const plantillas: Record<string, string> = formato === 'chirpstack'
      ? { event_topic: `${base}/{{dev_eui}}/{{event}}`, command_topic: `${base}/{{dev_eui}}/command/{{command}}` }
      : { uplink: `${base}/$devEUI/up` };
    return {
      usuario: idFisico, credencial: secreto, puerto: 8883, publica_en: `${base}/<deveui>/<evento>`, comandos: `${base}/<deveui>/command/#`, plantillas,
      nota: 'MQTT sobre TLS con la CA del servidor; la credencial solo se muestra ahora (docs/10 §8.4 punto 47)',
    };
  }

  private async tomar(): Promise<PoolClient> {
    if (this.enCurso >= MAX_ALTAS_EN_CURSO) throw new HttpException(`hay ${MAX_ALTAS_EN_CURSO} operaciones de aprovisionamiento en curso; inténtalo en un momento`, HttpStatus.TOO_MANY_REQUESTS);
    this.enCurso++;
    try {
      return await this.pool.connect();
    } catch (e) {
      this.enCurso--;
      throw e;
    }
  }

  private soltar(c: PoolClient): void {
    c.release();
    this.enCurso--;
  }

  private async abrir(c: PoolClient): Promise<void> {
    await c.query('BEGIN');
    await c.query("SET LOCAL lock_timeout = '5s'"); // otra operación sobre el mismo dispositivo en curso: esperar poco y avisar
    await c.query("SET LOCAL statement_timeout = '10s'");
    await c.query("SET LOCAL idle_in_transaction_session_timeout = '15s'"); // la espera al broker ocurre ENTRE sentencias: también acotada
  }

  private sinBroker(): HttpException {
    return new ServiceUnavailableException('sin conexión de administración con el broker (MQTT_ADMIN_CLAVE): nada cambió');
  }

  // La fila del dispositivo, bloqueada hasta confirmar: dos bajas o rotaciones a la vez se ordenan, no se cruzan. NO KEY porque
  // ninguna cambia la clave: una inserción hija (trama, evento: FOR KEY SHARE) no espera; con FOR UPDATE esperaba hasta 5 s.
  private async bloquear(c: PoolClient, id: string): Promise<FilaBloqueada> {
    const r = await c.query<FilaBloqueada>(
      `SELECT d.id, d.id_fisico, d.estado, d.via, d.pasarela_id, s.codigo AS sitio_codigo
         FROM dispositivo d JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id
        WHERE d.id = $1 FOR NO KEY UPDATE OF d`,
      [id],
    );
    if (r.rows.length === 0) throw new NotFoundException('dispositivo no encontrado');
    return r.rows[0];
  }

  private async canalesDe(c: PoolClient, id: string): Promise<CanalCreado[]> {
    const r = await c.query<CanalCreado>(
      `SELECT c.id, c.magnitud_codigo AS magnitud, m.unidad_canonica AS unidad, c.etiqueta
         FROM canal c JOIN magnitud m ON m.codigo = c.magnitud_codigo WHERE c.dispositivo_id = $1 ORDER BY c.magnitud_codigo`,
      [id],
    );
    return r.rows;
  }

  // La zona existe y, si hay pasarela, es del mismo sitio y está activa. Lo que falta aquí es 400: es un dato del cuerpo.
  private async sitioDe(c: PoolClient, a: AltaValidada): Promise<{ id: string; codigo: string; formatoPasarela: Formato | null }> {
    const z = await c.query<{ sitio_id: string; codigo: string }>('SELECT z.sitio_id, s.codigo FROM zona z JOIN sitio s ON s.id = z.sitio_id WHERE z.id = $1', [a.zona_id]);
    if (z.rows.length === 0) throw new BadRequestException(['zona_id no existe']);
    const sitio: { id: string; codigo: string; formatoPasarela: Formato | null } = { id: z.rows[0].sitio_id, codigo: z.rows[0].codigo, formatoPasarela: null };
    if (a.pasarela_id !== null) {
      const p = await c.query<{ sitio_id: string; activo: boolean; formato: Formato }>('SELECT sitio_id, activo, formato FROM pasarela WHERE id = $1', [a.pasarela_id]);
      if (p.rows.length === 0) throw new BadRequestException(['pasarela_id no existe']);
      if (p.rows[0].sitio_id !== sitio.id) throw new BadRequestException(['la pasarela pertenece a otro sitio']);
      if (!p.rows[0].activo) throw new BadRequestException(['la pasarela está inactiva']);
      sitio.formatoPasarela = p.rows[0].formato;
    }
    return sitio;
  }

  // Cada magnitud debe estar en el catálogo (docs/08): el mensaje nombra las desconocidas y las que existen.
  private async unidadesDe(c: PoolClient, a: AltaValidada): Promise<Map<string, string>> {
    const r = await c.query<{ codigo: string; unidad_canonica: string }>('SELECT codigo, unidad_canonica FROM magnitud ORDER BY codigo');
    const unidades = new Map(r.rows.map((m) => [m.codigo, m.unidad_canonica]));
    const desconocidas = a.canales.map((k) => k.magnitud).filter((m) => !unidades.has(m));
    if (desconocidas.length > 0) throw new BadRequestException([`magnitud desconocida: ${desconocidas.join(', ')} (catálogo: ${[...unidades.keys()].join(', ')})`]);
    return unidades;
  }

  private conexion(via: Via, idFisico: string, codigo: string, canales: CanalCreado[], secreto: string | null, pasarelaId: string | null): DispositivoCreado['conexion'] {
    if (via === 'lorawan') return { via: 'lorawan', pasarela_id: pasarelaId ?? '', nota: 'sin credencial propia: lo autentica su pasarela (docs/10 §3)' };
    if (via === 'http') return { via: 'http', token: secreto ?? '', nota: 'token para la recepción por HTTP (tanda posterior); solo se muestra ahora' };
    const primero = canales[0] ?? { magnitud: 'temperatura', unidad: 'Cel' };
    return {
      via: 'mqtt',
      usuario: idFisico,
      credencial: secreto ?? '',
      topico: `sitio/${codigo}/dispositivo/${idFisico}/<magnitud>`,
      ejemplo: { topico: `sitio/${codigo}/dispositivo/${idFisico}/${primero.magnitud}`, carga: JSON.stringify([{ n: primero.magnitud, u: primero.unidad, v: 21.5 }]) },
    };
  }

  // Baja: un cliente que el broker ya no tiene se da por borrado (baja repetida tras un corte; cliente borrado a mano).
  private async borrarEnBroker(idFisico: string): Promise<void> {
    try {
      await this.dynsec.ordenar(ordenBaja(idFisico));
    } catch (e) {
      if (!(e instanceof ErrorDynsec) || e.ambiguo || !/not found/i.test(e.message)) throw e;
      this.log.warn(`baja de ${idFisico}: el broker no tenía ese cliente; se da por borrado`);
    }
  }

  // Rotación: si el broker no conoce al cliente, se crea con su rol (reparación de un huérfano al revés).
  private async rotarEnBroker(idFisico: string, secreto: string, rol: string = ROL_DISPOSITIVO): Promise<void> {
    try {
      await this.dynsec.ordenar(ordenRotacion(idFisico, secreto));
    } catch (e) {
      if (!(e instanceof ErrorDynsec) || e.ambiguo || !/not found/i.test(e.message)) throw e;
      this.log.warn(`rotación de ${idFisico}: el broker no tenía ese cliente; se crea con su rol`);
      await this.dynsec.ordenar(ordenesAlta(idFisico, secreto, rol));
    }
  }

  // La base no confirmó después de crear el cliente en el broker: se borra para no dejar una credencial sin dispositivo. Si
  // tampoco se puede, queda registrado cómo limpiarlo a mano.
  private async deshacerEnBroker(idFisico: string): Promise<void> {
    try {
      await this.dynsec.ordenar(ordenBaja(idFisico));
    } catch (e) {
      this.log.error(`cliente huérfano en el broker: ${idFisico}; borrarlo con pruebas/broker-cliente.sh --borrar ${idFisico} (${(e as Error).message})`);
    }
  }

  private traducir(e: unknown, idFisico: string, op: Operacion): HttpException {
    if (e instanceof HttpException) return e;
    // Después de cambiar la clave en el broker nada la devuelve: la anterior puede ya no valer y la nueva no se mostró.
    const remedio = op === 'rotación' ? '; repetir la rotación: la clave anterior puede haber dejado de valer' : '';
    if (e instanceof ErrorDynsec) {
      if (op === 'alta' && /already exists/i.test(e.message)) {
        this.log.warn(`alta de ${idFisico}: el broker ya tiene ese cliente sin alta en la base (huérfano)`);
        return new ConflictException(`«${idFisico}» ya existe en el broker sin alta en la base: borrarlo con pruebas/broker-cliente.sh --borrar ${idFisico} y repetir`);
      }
      this.log.error(`${op} de ${idFisico}: el broker no aceptó la orden (${e.message})`);
      return new BadGatewayException(`el broker no confirmó la ${op}; nada cambió en la base${e.ambiguo ? remedio : ''}`);
    }
    const pg = e as ErrorPg;
    switch (pg.code) {
      case '23505': // unique_violation: id_fisico en dispositivo, o en pasarela (disparador de la migración 11)
        return new ConflictException(`id_fisico «${idFisico}» ya existe`);
      case '23503': // foreign_key_violation: la zona o la pasarela desaparecieron entre la comprobación y el INSERT
        // …o el formato de la pasarela cambió entre la lectura y el INSERT (fk_dispositivo_pasarela_formato, migración 15).
        if (pg.constraint === 'fk_dispositivo_pasarela_formato') return new ConflictException('el formato de la pasarela cambió durante el alta: repetirla');
        return new BadRequestException(['zona_id o pasarela_id no existe']);
      case '23514': // check_violation: la base exige algo que el validador no cubrió; el detalle (trae la fila) va al registro, no a la API
        this.log.warn(`${op} de ${idFisico}: la base rechazó la fila (${pg.constraint ?? 'restricción'}): ${pg.detail ?? pg.message}`);
        return new BadRequestException([`la base rechazó la ${op}: no cumple ${pg.constraint ?? 'una restricción'}`]);
      case '55P03': // lock_not_available
      case '57014': // query_canceled (statement_timeout)
      case '25P03': // idle_in_transaction_session_timeout
        return new ServiceUnavailableException(`otra operación sobre el mismo dispositivo está en curso o la base no responde; reintentar en unos segundos${remedio}`);
      default:
        this.log.error(`${op} de ${idFisico}: ${pg.message}`);
        return new InternalServerErrorException(`no se pudo completar la ${op}; nada cambió en la base${remedio}`);
    }
  }
}
