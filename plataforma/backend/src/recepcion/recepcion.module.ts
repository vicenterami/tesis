import { Module } from '@nestjs/common';
import { BrokerModule } from '../broker/broker.module';
import { PlanoAdaptador } from './adaptadores/plano.adaptador';
import { SenmlAdaptador } from './adaptadores/senml.adaptador';
import { RecepcionService } from './recepcion.service';

// Para admitir un formato nuevo: crear su adaptador y registrarlo aquí y en el constructor del servicio.
@Module({
  imports: [BrokerModule],
  providers: [RecepcionService, SenmlAdaptador, PlanoAdaptador],
})
export class RecepcionModule {}
