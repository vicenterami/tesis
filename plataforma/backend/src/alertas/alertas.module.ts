import { Module } from '@nestjs/common';
import { TiempoRealModule } from '../tiempo-real/tiempo-real.module.js';
import { AlertasService } from './alertas.service.js';

@Module({ imports: [TiempoRealModule], providers: [AlertasService], exports: [AlertasService] })
export class AlertasModule {}
