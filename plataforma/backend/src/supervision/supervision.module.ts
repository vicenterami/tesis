import { Module } from '@nestjs/common';
import { SupervisionService } from './supervision.service';

@Module({ providers: [SupervisionService], exports: [SupervisionService] })
export class SupervisionModule {}
