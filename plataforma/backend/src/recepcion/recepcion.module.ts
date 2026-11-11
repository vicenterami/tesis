import { Module } from '@nestjs/common';
import { AlertasModule } from '../alertas/alertas.module.js';
import { BrokerModule } from '../broker/broker.module.js';
import { SupervisionModule } from '../supervision/supervision.module.js';
import { TiempoRealModule } from '../tiempo-real/tiempo-real.module.js';
import { ChirpstackAdaptador } from './adaptadores/chirpstack.adaptador.js';
import { RESOLVER_CLAVE, resolverClave } from './adaptadores/mapa-claves.js';
import { MilesightAdaptador } from './adaptadores/milesight.adaptador.js';
import { PlanoAdaptador } from './adaptadores/plano.adaptador.js';
import { SenmlAdaptador } from './adaptadores/senml.adaptador.js';
import { RecepcionHttpController } from './http/recepcion-http.controller.js';
import { VerificacionDeTokens } from './http/verificacion.js';
import { RecepcionService } from './recepcion.service.js';

// Para admitir un formato nuevo: crear su adaptador y registrarlo aquí y en el constructor del servicio.
@Module({
  imports: [BrokerModule, AlertasModule, SupervisionModule, TiempoRealModule],
  controllers: [RecepcionHttpController], // vía HTTP (docs/10 §8.4 punto 52)
  // El resolvedor del mapa de claves se inyecta: en la Etapa 4 pasa a leer `magnitud.alias` sin tocar los adaptadores (punto 47).
  providers: [RecepcionService, SenmlAdaptador, PlanoAdaptador, ChirpstackAdaptador, MilesightAdaptador,
    { provide: RESOLVER_CLAVE, useValue: resolverClave },
    // Con fábrica: sus parámetros (cupo y tope de la caché) tienen valor por defecto y no son proveedores de Nest.
    { provide: VerificacionDeTokens, useFactory: () => new VerificacionDeTokens() }],
})
export class RecepcionModule {}
