import { Module } from '@nestjs/common';
import { TiempoRealModule } from '../tiempo-real/tiempo-real.module';
import { AlertasService } from './alertas.service';

@Module({ imports: [TiempoRealModule], providers: [AlertasService], exports: [AlertasService] })
export class AlertasModule {}
