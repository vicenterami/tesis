import { Module } from '@nestjs/common';
import { BrokerModule } from '../broker/broker.module';
import { DbModule } from '../db/db.module';
import { AltaController } from './alta.controller';
import { AltaService } from './alta.service';

// M3 Aprovisionamiento, primera parte (docs/10 §1 y §3): el alta por API. La baja y la rotación llegan con HU-12 y HU-13.
@Module({ imports: [DbModule, BrokerModule], controllers: [AltaController], providers: [AltaService] })
export class AltaModule {}
