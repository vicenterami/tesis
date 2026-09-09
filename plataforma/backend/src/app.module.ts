import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module';
import { BrokerModule } from './broker/broker.module';
import { RecepcionModule } from './recepcion/recepcion.module';
import { SaludModule } from './salud/salud.module';

// Módulo raíz. Cada módulo de aquí corresponde a un módulo funcional del diseño (docs/10 §1):
//   DbModule        → acceso a TimescaleDB (infraestructura compartida)
//   BrokerModule    → conexión al broker MQTT como usuario "backend" (infraestructura compartida)
//   RecepcionModule → M1 Recepción + M2 Pipeline (seis filtros)
//   SupervisionModule → M3 Supervisión de salud (barrido periódico "sin comunicación")
//   AlertasModule   → M4 Alertas (umbrales con histéresis → condiciones)
//   SaludModule     → M8 (API): endpoint de salud para healthchecks y pruebas
// Los módulos M5–M7 (aprovisionamiento, consulta, usuarios) se agregan por tandas.
@Module({
  imports: [
    // Lee variables de entorno. En desarrollo toma el .env de la carpeta plataforma/ (el mismo que
    // usa Docker Compose): una sola fuente de secretos, nunca dos copias que se desincronicen.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env', '.env'] }),
    DbModule,
    BrokerModule,
    RecepcionModule,
    SaludModule,
  ],
})
export class AppModule {}
