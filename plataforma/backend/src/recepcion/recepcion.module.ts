import { Module } from '@nestjs/common';
import { AlertasModule } from '../alertas/alertas.module';
import { BrokerModule } from '../broker/broker.module';
import { SupervisionModule } from '../supervision/supervision.module';
import { TiempoRealModule } from '../tiempo-real/tiempo-real.module';
import { ChirpstackAdaptador } from './adaptadores/chirpstack.adaptador';
import { RESOLVER_CLAVE, resolverClave } from './adaptadores/mapa-claves';
import { MilesightAdaptador } from './adaptadores/milesight.adaptador';
import { PlanoAdaptador } from './adaptadores/plano.adaptador';
import { SenmlAdaptador } from './adaptadores/senml.adaptador';
import { RecepcionHttpController } from './http/recepcion-http.controller';
import { RecepcionService } from './recepcion.service';

// Para admitir un formato nuevo: crear su adaptador y registrarlo aquí y en el constructor del servicio.
@Module({
  imports: [BrokerModule, AlertasModule, SupervisionModule, TiempoRealModule],
  controllers: [RecepcionHttpController], // vía HTTP (docs/10 §8.4 punto 52)
  // El resolvedor del mapa de claves se inyecta: en la Etapa 4 pasa a leer `magnitud.alias` sin tocar los adaptadores (punto 47).
  providers: [RecepcionService, SenmlAdaptador, PlanoAdaptador, ChirpstackAdaptador, MilesightAdaptador,
    { provide: RESOLVER_CLAVE, useValue: resolverClave }],
})
export class RecepcionModule {}
