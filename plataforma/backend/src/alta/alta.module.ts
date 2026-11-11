import { Module } from '@nestjs/common';
import { BrokerModule } from '../broker/broker.module.js';
import { DbModule } from '../db/db.module.js';
import { AltaController } from './alta.controller.js';
import { AltaService } from './alta.service.js';
import { CanalesAdminController } from './canales.controller.js';
import { PasarelasController } from './pasarelas.controller.js';

// M3 Aprovisionamiento por API (docs/10 §1 y §3): alta (HU-11), baja y rotación de la credencial (sin historia propia: completan HU-11),
// de dispositivos y de pasarelas (rutas B y C, docs/10 §8.4 punto 47), y la calibración de un canal (PATCH /canales/{id}, punto 51).
@Module({ imports: [DbModule, BrokerModule], controllers: [AltaController, PasarelasController, CanalesAdminController], providers: [AltaService], exports: [AltaService] })
export class AltaModule {}
