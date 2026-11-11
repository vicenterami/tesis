import { Inject, Injectable } from '@nestjs/common';
import { ContextoTrama, Lectura } from '../lectura.js';
import { Adaptador, TramaMalformada } from './adaptador.js';
import { IdentidadNoVerificada, anotarFcnt, exigirDevEui, lecturasDe, objetoJson, tiempoDe } from './lorawan.js';
import { RESOLVER_CLAVE } from './mapa-claves.js';
import type { ResolverClave } from './mapa-claves.js';
import { decodificar } from './perfiles.js';

// Evento `up` de la integración MQTT de ChirpStack v4 (docs/10 §8.4 punto 47; ruta C, y la A si algún día hay un ChirpStack propio).
// JSON por defecto (`json=true`), con el mapeo JSON de Protocol Buffers: nombres en camelCase. Lo que se usa:
//   deviceInfo.devEui   identidad del nodo; debe coincidir con el DevEUI del tópico
//   time                marca del servidor de red, RFC 3339 con zona → origen «pasarela» (docs/13, regla 17)
//   fCnt                contador de trama (`uint32 f_cnt` del UplinkEvent): el filtro 3 descarta la repetida (docs/10 §4.1)
//   object              lo que devolvió el decodificador del perfil del dispositivo; sin decodificador no existe
//   data                la carga en base64: solo se decodifica si no hay object y el nodo declaró un perfil (migración 17)
// rxInfo[] (gatewayId, rssi, snr) queda en la trama cruda para HU-15.

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
    anotarFcnt(evento.fCnt, ctx);
    const objeto = evento.object;
    if (typeof objeto !== 'object' || objeto === null || Array.isArray(objeto)) {
      if (!ctx.decodificador) {
        throw new TramaMalformada('sin object: el perfil del dispositivo en ChirpStack no tiene decodificador, ni el nodo un perfil de decodificación');
      }
      ctx.ignoradas = [];
      return decodificar(ctx.decodificador, evento.data, tiempoDe(evento.time));
    }
    return lecturasDe(objeto as Record<string, unknown>, this.resolver, ctx, tiempoDe(evento.time));
  }
}
