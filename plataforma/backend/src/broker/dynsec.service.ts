import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mqtt, { MqttClient } from 'mqtt';
import { claveOpcional } from '../arranque';
import { AdministradorDynsec, ErrorDynsec, OrdenDynsec, RespuestaDynsec, TOPICO_RESPUESTAS, USUARIO_ADMIN } from './dynsec';

// Segunda conexión al broker, como `backend-admin`, solo para administrar el plugin de seguridad (docs/10 §8.4 punto 41: una
// identidad distinta de la que recibe tramas, con el rol `admin` del plugin). Sesión limpia: una respuesta a una orden que ya
// nadie espera no tiene por qué guardarse. Sin MQTT_ADMIN_CLAVE el backend arranca igual, recibe tramas y avisa: el alta por
// API responde 503 hasta que se configure (nunca crea un dispositivo sin credencial en el broker).
@Injectable()
export class DynsecService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('dynsec');
  private cliente?: MqttClient;
  private listo = false; // suscrito a las respuestas: antes de eso una orden saldría y su respuesta se perdería
  private readonly admin = new AdministradorDynsec((topico, carga) => this.publicar(topico, carga));

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const clave = claveOpcional('MQTT_ADMIN_CLAVE', this.config.get<string>('MQTT_ADMIN_CLAVE')); // corta = el arranque falla
    if (clave === undefined) {
      this.log.warn('MQTT_ADMIN_CLAVE ausente: sin administración del broker; el alta por API responde 503');
      return;
    }
    const url = this.config.get<string>('MQTT_URL', 'mqtt://127.0.0.1:1883');
    this.cliente = mqtt.connect(url, { username: USUARIO_ADMIN, password: clave, clientId: USUARIO_ADMIN, clean: true, reconnectPeriod: 2000 });
    this.cliente.on('connect', () => {
      this.cliente?.subscribe(TOPICO_RESPUESTAS, { qos: 1 }, (err) => {
        if (err) this.log.error(`no se pudo suscribir a las respuestas del plugin: ${err.message}`);
        else {
          this.listo = true;
          this.log.log(`administración del broker lista (${USUARIO_ADMIN})`);
        }
      });
    });
    this.cliente.on('message', (topico, carga) => {
      if (topico === TOPICO_RESPUESTAS) this.admin.recibir(carga.toString('utf8'));
    });
    this.cliente.on('offline', () => {
      this.listo = false;
      this.log.warn('administración del broker fuera de línea; reintentando');
      this.admin.cancelarTodo('broker fuera de línea');
    });
    this.cliente.on('close', () => {
      this.listo = false;
    });
    this.cliente.on('error', (e) => this.log.error(`administración del broker: ${e.message}`));
  }

  // Hay conexión administradora y ya está suscrita a las respuestas. Lo consulta el alta ANTES de abrir la transacción: sin
  // broker no se escribe nada; sin suscripción, una orden saldría y su respuesta no llegaría (cliente huérfano).
  get disponible(): boolean {
    return this.cliente?.connected === true && this.listo;
  }

  ordenar(ordenes: OrdenDynsec[]): Promise<RespuestaDynsec[]> {
    if (!this.disponible) {
      return Promise.reject(new ErrorDynsec(ordenes.map((o) => o.command).join('+'), 'sin conexión de administración con el broker'));
    }
    return this.admin.ordenar(ordenes);
  }

  // QoS 1: la orden se da por publicada cuando el broker la confirma.
  private publicar(topico: string, carga: string): Promise<void> {
    return new Promise((resolver, rechazar) => {
      if (this.cliente === undefined || !this.cliente.connected) return rechazar(new Error('sin conexión'));
      this.cliente.publish(topico, carga, { qos: 1 }, (err) => (err ? rechazar(err) : resolver()));
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.admin.cancelarTodo('el backend se apaga');
    await this.cliente?.endAsync();
  }
}
