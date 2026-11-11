import { Module } from '@nestjs/common';
import { BrokerService } from './broker.service.js';
import { DynsecService } from './dynsec.service.js';
import { MetricasBrokerService } from './metricas.service.js';
import { DbModule } from '../db/db.module.js';
import { TiempoRealModule } from '../tiempo-real/tiempo-real.module.js';

// Dos conexiones con dos identidades (docs/10 §8.4 punto 41): `backend` recibe tramas; `backend-admin` administra el plugin.
// La administradora también lee los contadores $SYS, que MetricasBrokerService muestrea y vigila (docs/10 §8.4 punto 43).
@Module({ imports: [DbModule, TiempoRealModule], providers: [BrokerService, DynsecService, MetricasBrokerService], exports: [BrokerService, DynsecService, MetricasBrokerService] })
export class BrokerModule {}
