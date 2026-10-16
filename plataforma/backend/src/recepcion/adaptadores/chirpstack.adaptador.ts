import { Inject, Injectable } from '@nestjs/common';
import { ContextoTrama, Lectura } from '../lectura';
import { Adaptador, TramaMalformada } from './adaptador';
import { IdentidadNoVerificada, exigirDevEui, lecturasDe, objetoJson } from './lorawan';
import { RESOLVER_CLAVE } from './mapa-claves';
import type { ResolverClave } from './mapa-claves';

// Evento `up` de la integración MQTT de ChirpStack v4 (docs/10 §8.4 punto 47; ruta C, y la A si algún día hay un ChirpStack propio).
// JSON por defecto (`json=true`), con el mapeo JSON de Protocol Buffers: nombres en camelCase. Lo que se usa:
//   deviceInfo.devEui   identidad del nodo; debe coincidir con el DevEUI del tópico
//   time                marca del servidor de red, RFC 3339 con zona → origen «pasarela» (docs/13, regla 17)
//   object              lo que devolvió el decodificador del perfil del dispositivo; sin decodificador no existe
// rxInfo[] (gatewayId, rssi, snr) queda en la trama cruda para HU-15; data (la carga en base64) no se decodifica aquí.
const ZONA_RFC3339 = /(Z|[+-]\d{2}:\d{2})$/;

@Injectable()
export class ChirpstackAdaptador implements Adaptador {
  readonly nombre = 'chirpstack';
  readonly origenTiempo = 'pasarela';

  constructor(@Inject(RESOLVER_CLAVE) private readonly resolver: ResolverClave) {}

  reconoce(ctx: ContextoTrama): boolean {
    const texto = ctx.carga.toString('utf8').trimStart();
    return texto.startsWith('{') && texto.includes('"deviceInfo"');
  }

  analizar(ctx: ContextoTrama): Lectura[] {
    const evento = objetoJson(ctx.carga.toString('utf8'));
    const info = evento.deviceInfo;
    if (typeof info !== 'object' || info === null) throw new IdentidadNoVerificada('sin deviceInfo');
    exigirDevEui((info as Record<string, unknown>).devEui, ctx, 'deviceInfo.devEui');
    const objeto = evento.object;
    if (typeof objeto !== 'object' || objeto === null || Array.isArray(objeto)) {
      throw new TramaMalformada('sin object: el perfil del dispositivo en ChirpStack no tiene decodificador');
    }
    return lecturasDe(objeto as Record<string, unknown>, this.resolver, ctx, tiempoDe(evento.time));
  }
}

// Una hora sin zona no se adivina: sin marca, rige la hora de recepción.
function tiempoDe(v: unknown): Date | undefined {
  if (typeof v !== 'string' || !ZONA_RFC3339.test(v)) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
