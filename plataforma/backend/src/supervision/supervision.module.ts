import { Module } from '@nestjs/common';
import { TiempoRealModule } from '../tiempo-real/tiempo-real.module.js';
import { SupervisionService } from './supervision.service.js';

@Module({ imports: [TiempoRealModule], providers: [SupervisionService], exports: [SupervisionService] })
export class SupervisionModule {}
