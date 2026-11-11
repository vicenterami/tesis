import { Module } from '@nestjs/common';
import { AltaModule } from '../alta/alta.module.js';
import { BrokerModule } from '../broker/broker.module.js';
import { DbModule } from '../db/db.module.js';
import { SaludController } from './salud.controller.js';

@Module({ imports: [DbModule, BrokerModule, AltaModule], controllers: [SaludController] })
export class SaludModule {}
