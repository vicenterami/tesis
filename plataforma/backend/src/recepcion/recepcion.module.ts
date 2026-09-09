import { Module } from '@nestjs/common';
import { BrokerModule } from '../broker/broker.module';
import { RecepcionService } from './recepcion.service';

@Module({ imports: [BrokerModule], providers: [RecepcionService] })
export class RecepcionModule {}
