import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Pool } from 'pg';
import { POOL } from '../db/db.module.js';
import { leerEntero } from '../retencion/retencion.service.js';
import { EventosService } from '../tiempo-real/eventos.service.js';
import { DynsecService } from './dynsec.service.js';
import { COLA_TOPE_POR_DEFECTO, Evaluacion, Muestra, armarMuestra, evaluar } from './metricas.js';

// Cola del broker vigilada (docs/10 §8.4 punto 43; evidencia SYS-01…05): cada METRICA_BROKER_INTERVALO_S guarda en
// `metrica_broker` los últimos contadores $SYS que recibió la conexión administradora y evalúa la alarma: si el contador de
// descartes creció desde la muestra anterior, o la cola pasa el 80 % del tope, abre la condición del sistema `broker_descarte`
// (una fila en `condicion_sistema`, sin dispositivo) y la anuncia por el canal en vivo; cuando dos muestras seguidas vuelven a
// la normalidad, la cierra sola. Lo que ve el operador: una línea de registro por apertura y cierre (ruido, no silencio) y los
// números en GET /salud. Como el barrido del supervisor, el temporizador atrapa sus propios errores: una base caída no tumba
// el proceso, se salta la muestra.
export interface EstadoBroker {
  conectado: boolean;
  administracion: boolean;
  ultima_muestra: string | null;
  mensajes_descartados: number | null;
  mensajes_en_cola: number | null;
  bytes_en_cola: number | null;
  clientes_conectados: number | null;
  cola_tope: number;
  condicion_abierta: 'broker_descarte' | null;
}

@Injectable()
export class MetricasBrokerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('metricas-broker');
  private temporizador?: NodeJS.Timeout;
  private anterior: Muestra | null = null;
  private abierta: string | null = null; // id de la condición abierta, si la hay
  private normalesSeguidas = 0;
  readonly tope: number;
  readonly cadaSeg: number;

  constructor(
    @Inject(POOL) private readonly pool: Pool,
    private readonly dynsec: DynsecService,
    private readonly eventos: EventosService,
    config: ConfigService,
  ) {
    this.tope = leerEntero(config.get<string>('METRICA_BROKER_COLA_TOPE'), { variable: 'METRICA_BROKER_COLA_TOPE', porDefecto: COLA_TOPE_POR_DEFECTO, minimo: 100 });
    this.cadaSeg = leerEntero(config.get<string>('METRICA_BROKER_INTERVALO_S'), { variable: 'METRICA_BROKER_INTERVALO_S', porDefecto: 60, minimo: 10 });
  }

  onModuleInit(): void {
    this.temporizador = setInterval(() => void this.muestraSegura(), this.cadaSeg * 1000);
    this.log.log(`muestra de la cola del broker cada ${this.cadaSeg} s; tope ${this.tope} mensajes (aviso al 80 %)`);
  }

  onModuleDestroy(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  async muestraSegura(): Promise<void> {
    try {
      await this.muestrear(new Date());
    } catch (e) {
      this.log.error(`muestra del broker falló, se reintenta en el próximo ciclo: ${(e as Error).message}`);
    }
  }

  // Una muestra: persistir, comparar con la anterior (la última guardada, si este proceso acaba de arrancar), abrir o cerrar.
  async muestrear(ahora: Date): Promise<Evaluacion | null> {
    if (!this.dynsec.conectado) return null; // sin conexión no hay datos frescos: no se guarda ni se evalúa nada rancio
    const m = armarMuestra(this.dynsec.contadores(), ahora);
    if (m === null) {
      if (this.dynsec.conectado) this.log.warn('sin muestra del broker: los contadores $SYS aún no llegaron (¿sys_interval, o el rol no lee $SYS/#?)');
      return null;
    }
    if (this.anterior === null) await this.recuperarEstado();
    await this.pool.query(
      'INSERT INTO metrica_broker (tiempo, mensajes_descartados, mensajes_en_cola, bytes_en_cola, clientes_conectados, memoria_bytes) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tiempo) DO NOTHING',
      [m.tiempo, m.mensajes_descartados, m.mensajes_en_cola, m.bytes_en_cola, m.clientes_conectados, m.memoria_bytes],
    );
    const ev = evaluar(this.anterior, m, this.tope);
    this.anterior = m;
    if (ev.anormal) {
      this.normalesSeguidas = 0;
      if (this.abierta === null) await this.abrir(m, ev);
      else this.log.warn(`broker: sigue anormal (${ev.motivos.join('+')}; descartes +${ev.descartes_delta}, cola ${m.mensajes_en_cola}/${this.tope})`);
    } else if (this.abierta !== null && ++this.normalesSeguidas >= 2) {
      await this.cerrar(m, ev); // dos muestras normales seguidas: no se cierra por una muestra tranquila entre dos ráfagas
    }
    return ev;
  }

  // Al arrancar: la última muestra guardada (para que un descarte ocurrido mientras el backend estaba caído se note al volver)
  // y la condición que quedó abierta (para no abrir dos veces ni dejarla huérfana).
  private async recuperarEstado(): Promise<void> {
    const u = await this.pool.query<Muestra>('SELECT tiempo, mensajes_descartados::int, mensajes_en_cola, bytes_en_cola::int, clientes_conectados, memoria_bytes::int FROM metrica_broker ORDER BY tiempo DESC LIMIT 1');
    if (u.rows[0]) this.anterior = u.rows[0];
    const c = await this.pool.query<{ id: string }>("SELECT id FROM condicion_sistema WHERE tipo = 'broker_descarte' AND cerrada_en IS NULL");
    this.abierta = c.rows[0]?.id ?? null;
  }

  private async abrir(m: Muestra, ev: Evaluacion): Promise<void> {
    const detalle = { motivos: ev.motivos, descartes_delta: ev.descartes_delta, mensajes_en_cola: m.mensajes_en_cola, bytes_en_cola: m.bytes_en_cola, tope: this.tope, umbral: ev.umbral_cola };
    const r = await this.pool.query<{ id: string }>(
      `INSERT INTO condicion_sistema (tipo, detalle) VALUES ('broker_descarte', $1)
       ON CONFLICT (tipo) WHERE cerrada_en IS NULL DO UPDATE SET detalle = condicion_sistema.detalle RETURNING id`,
      [JSON.stringify(detalle)],
    );
    this.abierta = r.rows[0].id;
    await this.pool.query("INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES (NULL, 'condicion_abierta', $1)", [JSON.stringify({ tipo: 'broker_descarte', ...detalle })]);
    this.log.error(`broker: condición broker_descarte ABIERTA (${ev.motivos.join('+')}; descartes +${ev.descartes_delta}, cola ${m.mensajes_en_cola}/${this.tope}): el broker está perdiendo o por perder mensajes`);
    this.eventos.publicar({ tipo: 'sistema', condicion: 'broker_descarte', estado: 'abierta', motivos: ev.motivos, mensajes_en_cola: m.mensajes_en_cola, descartes_delta: ev.descartes_delta });
  }

  private async cerrar(m: Muestra, ev: Evaluacion): Promise<void> {
    const detalle = { mensajes_en_cola: m.mensajes_en_cola, tope: this.tope };
    await this.pool.query('UPDATE condicion_sistema SET cerrada_en = now(), detalle = coalesce(detalle, $2::jsonb) || $3::jsonb WHERE id = $1 AND cerrada_en IS NULL', [this.abierta, '{}', JSON.stringify({ al_cerrar: detalle })]);
    await this.pool.query("INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES (NULL, 'condicion_cerrada', $1)", [JSON.stringify({ tipo: 'broker_descarte', ...detalle })]);
    this.log.warn(`broker: condición broker_descarte cerrada (cola ${m.mensajes_en_cola}/${this.tope}, sin descartes en dos muestras)`);
    this.abierta = null;
    this.normalesSeguidas = 0;
    this.eventos.publicar({ tipo: 'sistema', condicion: 'broker_descarte', estado: 'cerrada', motivos: ev.motivos, mensajes_en_cola: m.mensajes_en_cola, descartes_delta: ev.descartes_delta });
  }

  // Para GET /salud: lo último recibido del broker, sin tocar la base.
  estado(): EstadoBroker {
    const u = this.dynsec.contadores();
    const n = (k: Parameters<typeof u.get>[0]) => u.get(k) ?? null;
    return {
      conectado: this.dynsec.conectado,
      administracion: this.dynsec.disponible,
      ultima_muestra: this.anterior?.tiempo instanceof Date ? this.anterior.tiempo.toISOString() : null,
      mensajes_descartados: n('mensajes_descartados'),
      mensajes_en_cola: n('mensajes_en_cola'),
      bytes_en_cola: n('bytes_en_cola'),
      clientes_conectados: n('clientes_conectados'),
      cola_tope: this.tope,
      condicion_abierta: this.abierta === null ? null : 'broker_descarte',
    };
  }
}
