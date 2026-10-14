import { Module } from '@nestjs/common';
import { AltaModule } from '../alta/alta.module';
import { BrokerModule } from '../broker/broker.module';
import { DbModule } from '../db/db.module';
import { SaludController } from './salud.controller';

@Module({ imports: [DbModule, BrokerModule, AltaModule], controllers: [SaludController] })
export class SaludModule {}
