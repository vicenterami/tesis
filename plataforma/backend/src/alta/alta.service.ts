import {
  BadGatewayException, BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, InternalServerErrorException,
  Logger, ServiceUnavailableException,
} from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { POOL } from '../db/db.module';
import { ErrorDynsec, ordenBaja, ordenesAltaDispositivo } from '../broker/dynsec';
import { DynsecService } from '../broker/dynsec.service';
import { AltaValidada, Formato, Via } from './alta.dto';
import { generarSecreto, hashScrypt } from './credenciales';

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

interface ErrorPg {
  code?: string;
  detail?: string;
  constraint?: string;
  message: string;
}

// Altas simultáneas admitidas por proceso: cada una retiene una conexión del pool (de 5, compartido con la recepción de tramas)
// mientras espera al broker (hasta 5 s). Más que esto, 429: el pool no se agota por administrar.
export const MAX_ALTAS_EN_CURSO = 2;

// Alta de un dispositivo (HU-11; docs/10 §3 y §8.4 puntos 25, 41 y 42). Todo o nada: la fila, sus canales, el hash de la
// credencial y el evento van en UNA transacción, y el cliente del broker se crea dentro de ella, antes de confirmar. Si el
// broker falla, la transacción se deshace y no queda nada; si la base falla al confirmar después de crear el cliente, se borra
// del broker. Dos altas simultáneas del mismo identificador: la base las serializa (bloqueo por identificador del disparador de
// la migración 11) y la segunda recibe 409. Repetir una alta que ya se hizo también da 409: nunca pisa ni duplica.
@Injectable()
export class AltaService {
  private readonly log = new Logger('alta');
  private enCurso = 0;

  constructor(
    @Inject(POOL) private readonly pool: Pool,
    private readonly dynsec: DynsecService,
  ) {}

  async crear(a: AltaValidada): Promise<DispositivoCreado> {
    // Sin administración del broker no se abre siquiera la transacción: un dispositivo sin credencial no sirve de nada.
    if (a.via === 'mqtt' && !this.dynsec.disponible) {
      throw new ServiceUnavailableException('sin conexión de administración con el broker (MQTT_ADMIN_CLAVE): nada quedó creado');
    }
    if (this.enCurso >= MAX_ALTAS_EN_CURSO) throw new HttpException(`hay ${MAX_ALTAS_EN_CURSO} altas en curso; inténtalo en un momento`, HttpStatus.TOO_MANY_REQUESTS);
    this.enCurso++;
    const c = await this.pool.connect();
    let enBroker = false;
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL lock_timeout = '5s'"); // otra alta del mismo identificador en curso: esperar poco y avisar
      await c.query("SET LOCAL statement_timeout = '10s'");
      await c.query("SET LOCAL idle_in_transaction_session_timeout = '15s'"); // la espera al broker ocurre ENTRE sentencias: también acotada
      const sitio = await this.sitioDe(c, a);
      const unidades = await this.unidadesDe(c, a);
      const d = await c.query<{ id: string; creado_en: Date }>(
        'INSERT INTO dispositivo (zona_id, id_fisico, nombre, intervalo_esperado_s, via, formato, pasarela_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, creado_en',
        [a.zona_id, a.id_fisico, a.nombre, a.intervalo_esperado_s, a.via, a.formato, a.pasarela_id],
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
        id, 'alta', JSON.stringify({ via: a.via, formato: a.formato, canales: a.canales.map((k) => k.magnitud), origen: 'api' }),
      ]);
      if (a.via === 'mqtt' && secreto !== null) {
        await this.dynsec.ordenar(ordenesAltaDispositivo(a.id_fisico, secreto));
        enBroker = true;
      }
      await c.query('COMMIT');
      this.log.log(`alta: ${a.id_fisico} (${a.via}/${a.formato}, ${canales.length} canal(es)) en el sitio ${sitio.codigo}`);
      return {
        id, id_fisico: a.id_fisico, nombre: a.nombre, estado: 'activo', zona_id: a.zona_id, sitio_codigo: sitio.codigo, via: a.via,
        formato: a.formato, intervalo_esperado_s: a.intervalo_esperado_s, creado_en: d.rows[0].creado_en.toISOString(), canales,
        conexion: this.conexion(a, sitio.codigo, canales, secreto),
      };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      // Se deshace en el broker si la orden se confirmó, o si pudo ejecutarse sin confirmación (sin respuesta, conexión perdida):
      // borrar un cliente que no existe solo devuelve un error inofensivo; dejarlo vivo sería una credencial huérfana.
      if (enBroker || (e instanceof ErrorDynsec && e.ambiguo)) await this.deshacerEnBroker(a.id_fisico);
      throw this.traducir(e, a.id_fisico);
    } finally {
      c.release();
      this.enCurso--;
    }
  }

  // La zona existe y, si hay pasarela, es del mismo sitio y está activa. Lo que falta aquí es 400: es un dato del cuerpo.
  private async sitioDe(c: PoolClient, a: AltaValidada): Promise<{ id: string; codigo: string }> {
    const z = await c.query<{ sitio_id: string; codigo: string }>('SELECT z.sitio_id, s.codigo FROM zona z JOIN sitio s ON s.id = z.sitio_id WHERE z.id = $1', [a.zona_id]);
    if (z.rows.length === 0) throw new BadRequestException(['zona_id no existe']);
    const sitio = { id: z.rows[0].sitio_id, codigo: z.rows[0].codigo };
    if (a.pasarela_id !== null) {
      const p = await c.query<{ sitio_id: string; activo: boolean }>('SELECT sitio_id, activo FROM pasarela WHERE id = $1', [a.pasarela_id]);
      if (p.rows.length === 0) throw new BadRequestException(['pasarela_id no existe']);
      if (p.rows[0].sitio_id !== sitio.id) throw new BadRequestException(['la pasarela pertenece a otro sitio']);
      if (!p.rows[0].activo) throw new BadRequestException(['la pasarela está inactiva']);
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

  private conexion(a: AltaValidada, codigo: string, canales: CanalCreado[], secreto: string | null): DispositivoCreado['conexion'] {
    if (a.via === 'lorawan') return { via: 'lorawan', pasarela_id: a.pasarela_id ?? '', nota: 'sin credencial propia: lo autentica su pasarela (docs/10 §3)' };
    if (a.via === 'http') return { via: 'http', token: secreto ?? '', nota: 'token para la recepción por HTTP (tanda posterior); solo se muestra ahora' };
    const primero = canales[0];
    return {
      via: 'mqtt',
      usuario: a.id_fisico,
      credencial: secreto ?? '',
      topico: `sitio/${codigo}/dispositivo/${a.id_fisico}/<magnitud>`,
      ejemplo: { topico: `sitio/${codigo}/dispositivo/${a.id_fisico}/${primero.magnitud}`, carga: JSON.stringify([{ n: primero.magnitud, u: primero.unidad, v: 21.5 }]) },
    };
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

  private traducir(e: unknown, idFisico: string): HttpException {
    if (e instanceof HttpException) return e;
    if (e instanceof ErrorDynsec) {
      if (/already exists/i.test(e.message)) {
        this.log.warn(`alta de ${idFisico}: el broker ya tiene ese cliente sin alta en la base (huérfano)`);
        return new ConflictException(`«${idFisico}» ya existe en el broker sin alta en la base: borrarlo con pruebas/broker-cliente.sh --borrar ${idFisico} y repetir`);
      }
      this.log.error(`alta de ${idFisico}: el broker no aceptó la credencial (${e.message})`);
      return new BadGatewayException('el broker no aceptó el alta; nada quedó creado');
    }
    const pg = e as ErrorPg;
    switch (pg.code) {
      case '23505': // unique_violation: id_fisico en dispositivo, o en pasarela (disparador de la migración 11)
        return new ConflictException(`id_fisico «${idFisico}» ya existe`);
      case '23503': // foreign_key_violation: la zona o la pasarela desaparecieron entre la comprobación y el INSERT
        return new BadRequestException(['zona_id o pasarela_id no existe']);
      case '23514': // check_violation: la base exige algo que el validador no cubrió; el detalle (trae la fila) va al registro, no a la API
        this.log.warn(`alta de ${idFisico}: la base rechazó la fila (${pg.constraint ?? 'restricción'}): ${pg.detail ?? pg.message}`);
        return new BadRequestException([`la base rechazó el alta: no cumple ${pg.constraint ?? 'una restricción'}`]);
      case '55P03': // lock_not_available
      case '57014': // query_canceled (statement_timeout)
      case '25P03': // idle_in_transaction_session_timeout
        return new ServiceUnavailableException('otra alta del mismo identificador está en curso o la base no responde; reintentar en unos segundos');
      default:
        this.log.error(`alta de ${idFisico}: ${pg.message}`);
        return new InternalServerErrorException('no se pudo completar el alta; nada quedó creado');
    }
  }
}
