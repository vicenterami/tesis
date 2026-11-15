import { Module } from '@nestjs/common';
import { BrokerModule } from '../broker/broker.module.js';
import { DbModule } from '../db/db.module.js';
import { AltaController } from './alta.controller.js';
import { AltaService } from './alta.service.js';
import { CanalesAdminController } from './canales.controller.js';
import { MagnitudesController } from './magnitudes.controller.js';
import { PasarelasController } from './pasarelas.controller.js';
import { ConfiguracionService } from './configuracion.service.js';
import { ConsultaModule } from '../consulta/consulta.module.js';

// M3 Aprovisionamiento por API (docs/10 §1 y §3): alta (HU-11), baja y rotación de la credencial (sin historia propia: completan HU-11),
// de dispositivos y de pasarelas (rutas B y C, docs/10 §8.4 punto 47), y la calibración de un canal (PATCH /canales/{id}, punto 51).
// Desde el 11/11/2026, la configuración desde el panel (PATCH /dispositivos/{id}, PUT /canales/{id}/reglas) y el alta por lote (docs/19 §4, E y F2); desde el 15/11/2026, su plantilla y el catálogo de magnitudes (bloque N).
@Module({ imports: [DbModule, BrokerModule, ConsultaModule], controllers: [AltaController, PasarelasController, CanalesAdminController, MagnitudesController], providers: [AltaService, ConfiguracionService], exports: [AltaService] })
export class AltaModule {}
