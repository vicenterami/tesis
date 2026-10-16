import { Inject, Injectable } from '@nestjs/common';
import { ContextoTrama, Lectura } from '../lectura';
import { Adaptador, TramaMalformada } from './adaptador';
import { IdentidadNoVerificada, anotarFcnt, exigirDevEui, lecturasDe, objetoJson, tiempoDe } from './lorawan';
import { RESOLVER_CLAVE } from './mapa-claves';
import type { ResolverClave } from './mapa-claves';
import { decodificar } from './perfiles';

// Uplink del servidor de red embebido de una pasarela Milesight (UG63, UG65 y familia; ruta B; docs/10 §8.4 punto 47). Dos formas:
//   con «Payload Codec» y «Metadata»: lo que devuelve el decodificador más devEUI, deviceName y applicationID. Ejemplo:
//     {"devEUI":"…","deviceName":"EM300","applicationID":"1","temperature":30.8,"humidity":50.5,"battery":92}
//   sin códec (la de la UG65 del campus, captura del 15/10): data en base64, fPort, fCnt, rxInfo y time. Se decodifica con el perfil
//     del nodo (migración 17); si no tiene, va a cuarentena diciendo qué activar.
// Hora: con códec no hay hora civil (el `time` del objeto LoRa cuenta desde que arrancó el reenviador de paquetes) y rige la de
// recepción; sin códec, `time` con zona es la marca del servidor de red y sin zona no se adivina (docs/13, regla 17).
const METADATOS = new Set(['devEUI', 'deviceName', 'applicationID', 'applicationName']);

@Injectable()
export class MilesightAdaptador implements Adaptador {
  readonly nombre = 'milesight';
  readonly origenTiempo = 'pasarela';

  constructor(@Inject(RESOLVER_CLAVE) private readonly resolver: ResolverClave) {}

  reconoce(ctx: ContextoTrama): boolean {
    return ctx.carga.toString('utf8').trimStart().startsWith('{');
  }

  analizar(ctx: ContextoTrama): Lectura[] {
    const cuerpo = objetoJson(ctx.carga.toString('utf8'));
    // La identidad primero: sin devEUI (o con otro) no hay certeza de que la trama sea del nodo y no se marca vivo.
    if (!('devEUI' in cuerpo)) throw new IdentidadNoVerificada('sin devEUI: activar Metadata en la aplicación de la pasarela');
    exigirDevEui(cuerpo.devEUI, ctx, 'devEUI');
    if (typeof cuerpo.data === 'string' && ('fPort' in cuerpo || 'rxInfo' in cuerpo)) {
      if (!ctx.decodificador) {
        throw new TramaMalformada('llegó sin decodificar: activar Payload Codec y Metadata en la aplicación de la pasarela, o declarar el perfil de decodificación del nodo');
      }
      anotarFcnt(cuerpo.fCnt, ctx);
      ctx.ignoradas = [];
      return decodificar(ctx.decodificador, cuerpo.data, tiempoDe(cuerpo.time));
    }
    return lecturasDe(cuerpo, this.resolver, ctx, undefined, METADATOS);
  }
}
