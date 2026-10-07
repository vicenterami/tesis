import { Module } from '@nestjs/common';
import { RetencionService } from './retencion.service';

@Module({ providers: [RetencionService] })
export class RetencionModule {}
