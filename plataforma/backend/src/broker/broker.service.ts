import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mqtt, { MqttClient } from 'mqtt';

export type ManejadorTrama = (topico: string, carga: Buffer) => void | Promise<void>;

// Conexión única al broker como usuario "backend" (ACL: lee sitio/#, escribe sitio/+/dispositivo/+/orden).
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
      clientId: 'backend-' + Math.random().toString(16).slice(2, 8),
      clean: true,
      reconnectPeriod: 2000, // si el broker cae, reintenta cada 2 s (RNF de recuperación)
    });

    this.cliente.on('connect', () => {
      this.log.log(`conectado a ${url}`);
      // QoS 1: el broker reintenta la entrega hasta que el backend confirme (al menos una vez).
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
