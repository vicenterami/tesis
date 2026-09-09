import { Module } from '@nestjs/common';
import { AlertasService } from './alertas.service';

@Module({ providers: [AlertasService], exports: [AlertasService] })
export class AlertasModule {}
