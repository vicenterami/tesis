import { Inject, Injectable } from '@nestjs/common';
import { ContextoTrama, Lectura } from '../lectura';
import { Adaptador, TramaMalformada } from './adaptador';
import { IdentidadCruzada, exigirDevEui, lecturasDe, objetoJson } from './lorawan';
import { RESOLVER_CLAVE } from './mapa-claves';
import type { ResolverClave } from './mapa-claves';

// Uplink del servidor de red embebido de una pasarela Milesight (UG63 y familia; ruta B; docs/10 §8.4 punto 47), con «Payload
// Codec» y «Metadata» activados: el mensaje es lo que devuelve el decodificador más devEUI, deviceName y applicationID. Ejemplo:
//   {"devEUI":"…","deviceName":"EM300","applicationID":"1","temperature":30.8,"humidity":50.5,"battery":92}
// Sin códec llega otra forma (data en base64, fPort, rxInfo): no se decodifica aquí y va a cuarentena diciendo qué activar.
// Hora: con códec no hay hora civil y sin códec llega sin zona (docs/13, regla 17): el adaptador no entrega marca, así que siempre rige
// la hora de recepción. `origenTiempo` dice qué origen tendría una marca si la entregara (la de la pasarela); hoy no se usa.
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
    if (!('devEUI' in cuerpo)) throw new IdentidadCruzada('sin devEUI: activar Metadata en la aplicación de la pasarela');
    exigirDevEui(cuerpo.devEUI, ctx, 'devEUI');
    if (typeof cuerpo.data === 'string' && ('fPort' in cuerpo || 'rxInfo' in cuerpo)) {
      throw new TramaMalformada('llegó sin decodificar: activar Payload Codec y Metadata en la aplicación de la pasarela');
    }
    return lecturasDe(cuerpo, this.resolver, ctx, undefined, METADATOS);
  }
}
