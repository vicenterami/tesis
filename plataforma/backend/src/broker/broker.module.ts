import { Module } from '@nestjs/common';
import { BrokerService } from './broker.service';
import { DynsecService } from './dynsec.service';

// Dos conexiones con dos identidades (docs/10 §8.4 punto 41): `backend` recibe tramas; `backend-admin` administra el plugin.
@Module({ providers: [BrokerService, DynsecService], exports: [BrokerService, DynsecService] })
export class BrokerModule {}
