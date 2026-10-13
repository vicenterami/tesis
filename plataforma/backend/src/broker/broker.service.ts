import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mqtt, { IPublishPacket, MqttClient, Packet } from 'mqtt';

export type ManejadorTrama = (topico: string, carga: Buffer) => void | Promise<void>;

// Si el pipeline falla (la base no responde), se reintenta el MISMO mensaje con estas esperas antes de rendirse: suman
// 15 s, menos que el keepalive de 60 s (si el manejador bloqueara más, la librería no leería el PINGRESP y cortaría).
export const REINTENTOS_MS = [1000, 2000, 4000, 8000];

// Conexión al broker como usuario "backend" (rol `recepcion` del plugin: lee sitio/#; docs/10 §8.4 punto 42). La administración
// del plugin va por otra identidad y otra conexión (dynsec.service.ts), como manda el punto 41. El envío de órdenes al
// dispositivo (downlink) está fuera de alcance (docs/02 §4.3).
// El resto de la aplicación no toca MQTT directamente: se registra como "manejador" y recibe
// cada trama con su tópico. Así el transporte queda aislado del pipeline (M1 → M2).
@Injectable()
export class BrokerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('broker');
  private cliente?: MqttClient;
  private readonly manejadores: ManejadorTrama[] = [];

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const url = this.config.get<string>('MQTT_URL', 'mqtt://127.0.0.1:1883');
    this.cliente = mqtt.connect(url, {
      username: 'backend',
      password: this.config.getOrThrow<string>('MQTT_BACKEND_CLAVE'),
      // Sesión PERSISTENTE (clientId fijo + clean:false): si el backend cae, el broker guarda en cola
      // los mensajes QoS 1 de sitio/# y los entrega al reconectar (Mosquitto: persistence true,
      // max_queued_messages). Con clean:true la cola se descartaba: "al menos una vez" solo valía
      // mientras la conexión estuviera viva. Una segunda instancia con el mismo id desconecta a la
      // primera: es deliberado, el pipeline debe correr en un solo proceso.
      clientId: this.config.get<string>('MQTT_CLIENT_ID', 'backend'),
      clean: false,
      reconnectPeriod: 2000, // si el broker cae, reintenta cada 2 s (RNF de recuperación)
    });

    this.cliente.on('connect', () => {
      this.log.log(`conectado a ${url}`);
      // QoS 1: el broker reintenta la entrega hasta que el backend confirme (al menos una vez).
      // La contraparte de "al menos una vez" es que puede llegar dos veces: el INSERT de medicion es
      // idempotente (índice único canal+tiempo, ON CONFLICT DO NOTHING), así el efecto es exactamente una.
      this.cliente?.subscribe('sitio/#', { qos: 1 }, (err) => {
        if (err) this.log.error(`no se pudo suscribir: ${err.message}`);
        else this.log.log('suscrito a sitio/#');
      });
    });
    // Decisión 4 (docs/10 §8.4): UN mensaje a la vez y PUBACK después de guardar. Leído en mqtt 5.16
    // (build/lib/client.js, work()/nextTickWork; handlers/publish.js): los paquetes se procesan de a uno y el siguiente
    // no se toma hasta que handleMessage llama a su callback; para QoS 1 el PUBACK se envía recién entonces. El evento
    // 'message' se emite ANTES y no espera a nadie: por eso el pipeline ya no cuelga de él (así N mensajes seguidos
    // corrían en paralelo, carrera medida el 07/10 en docs/16 §4, y el PUBACK salía antes del INSERT, §4.1).
    this.cliente.handleMessage = (packet: Packet, cb: (error?: Error) => void) => {
      if (packet.cmd !== 'publish') return cb();
      void this.manejar(packet, cb);
    };
    this.cliente.on('error', (e) => this.log.error(`error MQTT: ${e.message}`));
    this.cliente.on('offline', () => this.log.warn('broker fuera de línea; reintentando'));
  }

  alRecibir(manejador: ManejadorTrama): void {
    this.manejadores.push(manejador);
  }

  // Corre los manejadores en orden y confirma (cb sin error → PUBACK). Si uno falla, reintenta el mismo mensaje con
  // REINTENTOS_MS; agotados, NO confirma y reconecta: con sesión persistente (clean: false) el broker reenvía lo no
  // confirmado al volver, y el INSERT idempotente absorbe la repetición. Mientras tanto la cola del broker amortigua
  // (docs/10 §4.1). Nada se descarta en silencio: cada reintento y la rendición quedan en el registro.
  async manejar(packet: IPublishPacket, cb: (error?: Error) => void): Promise<void> {
    const topico = packet.topic.toString();
    const carga = Buffer.isBuffer(packet.payload) ? packet.payload : Buffer.from(packet.payload);
    for (let intento = 0; ; intento++) {
      try {
        for (const m of this.manejadores) await m(topico, carga);
        return cb();
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (intento >= REINTENTOS_MS.length) {
          this.log.error(`${topico}: falló ${intento + 1} veces (${err.message}); no se confirma al broker y se reconecta para que lo reenvíe`);
          cb(err);
          this.cliente?.reconnect();
          return;
        }
        this.log.warn(`${topico}: manejador falló (${err.message}); reintento ${intento + 1}/${REINTENTOS_MS.length} en ${REINTENTOS_MS[intento]} ms`);
        await this.dormir(REINTENTOS_MS[intento]);
      }
    }
  }

  protected dormir(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  onModuleDestroy(): void {
    this.cliente?.end(true);
  }
}
