import { Module } from '@nestjs/common';
import { RetencionService } from './retencion.service.js';

@Module({ providers: [RetencionService] })
export class RetencionModule {}
