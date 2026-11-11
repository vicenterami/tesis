import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module.js';
import { BrokerModule } from './broker/broker.module.js';
import { RecepcionModule } from './recepcion/recepcion.module.js';
import { ConsultaModule } from './consulta/consulta.module.js';
import { SaludModule } from './salud/salud.module.js';
import { RetencionModule } from './retencion/retencion.module.js';
import { TiempoRealModule } from './tiempo-real/tiempo-real.module.js';
import { AltaModule } from './alta/alta.module.js';
import { SesionModule } from './sesion/sesion.module.js';

// Módulo raíz. Cada módulo de aquí corresponde a un módulo funcional del diseño (docs/10 §1):
//   DbModule        → acceso a TimescaleDB (infraestructura compartida)
//   BrokerModule    → conexión al broker MQTT como usuario "backend" (infraestructura compartida)
//   RecepcionModule → M1 Recepción + M2 Normalización (pipeline de seis filtros). Importa por dentro a
//                     SupervisionModule (M4, barrido periódico "sin comunicación") y AlertasModule (M6,
//                     umbrales con histéresis → condiciones): por eso no aparecen en `imports` de aquí.
//   ConsultaModule  → M5 Persistencia y consulta: API de solo lectura para el panel (patrón B)
//   SaludModule     → endpoint de salud para healthchecks y pruebas
//   RetencionModule → tarea periódica que borra con drop_chunks lo vencido de medicion, trama y cuarentena
//                     (docs/10 §8.4 punto 11): la edición Apache de TimescaleDB no trae políticas de retención
//   TiempoRealModule → canal de tiempo real hacia el panel (SSE, TT-39): GET /eventos
//   AltaModule      → M3 Aprovisionamiento (HU-11): POST /dispositivos, DELETE /dispositivos/{id} y POST /dispositivos/{id}/credencial, con clave de administrador por cabecera
//                     (docs/10 §8.4 punto 41) y la credencial del broker creada en el plugin (punto 42)
//   SesionModule    → M7 Seguridad e identidad (docs/20, Etapa 4): POST/GET/DELETE /sesion, POST /sesion/clave, /usuarios y el guardia
//                     central GLOBAL (APP_GUARD): toda ruta exige la cookie de sesión o la clave de administrador, salvo las @Publica();
//                     cada ruta decide con permitir() sobre el sitio del recurso (docs/10 §8.4 punto 36). Va antes que los que lo usan.
// M8 es el panel (backend/panel).
@Module({
  imports: [
    // Lee variables de entorno. En desarrollo toma el .env de la carpeta plataforma/ (el mismo que
    // usa Docker Compose): una sola fuente de secretos, nunca dos copias que se desincronicen.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env', '.env'] }),
    DbModule,
    SesionModule,
    BrokerModule,
    RecepcionModule,
    ConsultaModule,
    SaludModule,
    RetencionModule,
    TiempoRealModule,
    AltaModule,
  ],
})
export class AppModule {}
