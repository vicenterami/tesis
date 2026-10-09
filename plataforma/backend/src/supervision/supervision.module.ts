import { Module } from '@nestjs/common';
import { TiempoRealModule } from '../tiempo-real/tiempo-real.module';
import { SupervisionService } from './supervision.service';

@Module({ imports: [TiempoRealModule], providers: [SupervisionService], exports: [SupervisionService] })
export class SupervisionModule {}
