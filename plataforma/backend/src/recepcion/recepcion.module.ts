import { Module } from '@nestjs/common';
import { AlertasModule } from '../alertas/alertas.module.js';
import { BrokerModule } from '../broker/broker.module.js';
import { SupervisionModule } from '../supervision/supervision.module.js';
import { TiempoRealModule } from '../tiempo-real/tiempo-real.module.js';
import { ChirpstackAdaptador } from './adaptadores/chirpstack.adaptador.js';
import { MilesightAdaptador } from './adaptadores/milesight.adaptador.js';
import { PlanoAdaptador } from './adaptadores/plano.adaptador.js';
import { SenmlAdaptador } from './adaptadores/senml.adaptador.js';
import { RecepcionHttpController } from './http/recepcion-http.controller.js';
import { Cupo } from './http/topes.js';
import { VerificacionDeTokens } from './http/verificacion.js';
import { RecepcionService } from './recepcion.service.js';
import { SinGuardarController } from './sin-guardar.controller.js';

// Para admitir un formato nuevo: crear su adaptador y registrarlo aquí y en el constructor del servicio.
@Module({
  imports: [BrokerModule, AlertasModule, SupervisionModule, TiempoRealModule],
  controllers: [RecepcionHttpController, SinGuardarController], // vía HTTP (docs/10 §8.4 punto 52) y lo que la trama trae y no se guarda (punto 72 i)
  providers: [RecepcionService, SenmlAdaptador, PlanoAdaptador, ChirpstackAdaptador, MilesightAdaptador,
    // Con fábrica: sus parámetros (cupo y tope de la caché) tienen valor por defecto y no son proveedores de Nest; la conversión de las
    // credenciales anteriores la hace el servicio (docs/10 §8.4 punto 52).
    { provide: VerificacionDeTokens, inject: [RecepcionService],
      useFactory: (r: RecepcionService) => new VerificacionDeTokens(new Cupo(), 10_000, (id, anterior, nueva) => r.convertirCredencial(id, anterior, nueva)) }],
})
export class RecepcionModule {}
