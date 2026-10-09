import { Module } from '@nestjs/common';
import { EventosController } from './eventos.controller';
import { EventosService } from './eventos.service';

// TT-39 · Canal de tiempo real hacia el panel (SSE). Lo importan quienes publican (recepción, alertas, supervisión);
// Nest crea un solo EventosService para toda la aplicación.
@Module({ controllers: [EventosController], providers: [EventosService], exports: [EventosService] })
export class TiempoRealModule {}
