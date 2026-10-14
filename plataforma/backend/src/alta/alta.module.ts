import { Module } from '@nestjs/common';
import { BrokerModule } from '../broker/broker.module';
import { DbModule } from '../db/db.module';
import { AltaController } from './alta.controller';
import { AltaService } from './alta.service';

// M3 Aprovisionamiento por API (docs/10 §1 y §3): alta (HU-11), baja y rotación de la credencial (sin historia propia: completan HU-11).
@Module({ imports: [DbModule, BrokerModule], controllers: [AltaController], providers: [AltaService], exports: [AltaService] })
export class AltaModule {}
