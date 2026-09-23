import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mqtt, { MqttClient } from 'mqtt';

export type ManejadorTrama = (topico: string, carga: Buffer) => void | Promise<void>;

// Conexión única al broker como usuario "backend" (ACL: lee sitio/#). El envío de órdenes al
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
    this.cliente.on('message', (topico, carga) => {
      for (const m of this.manejadores) {
        Promise.resolve(m(topico, carga)).catch((e: Error) =>
          this.log.error(`manejador falló en ${topico}: ${e.message}`),
        );
      }
    });
    this.cliente.on('error', (e) => this.log.error(`error MQTT: ${e.message}`));
    this.cliente.on('offline', () => this.log.warn('broker fuera de línea; reintentando'));
  }

  alRecibir(manejador: ManejadorTrama): void {
    this.manejadores.push(manejador);
  }

  onModuleDestroy(): void {
    this.cliente?.end(true);
  }
}
