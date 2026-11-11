import { Module } from '@nestjs/common';
import { EventosController } from './eventos.controller.js';
import { EventosService } from './eventos.service.js';
import { SitiosDeDispositivos } from './sitios-de-dispositivos.js';

// TT-39 · Canal de tiempo real hacia el panel (SSE). Lo importan quienes publican (recepción, alertas, supervisión);
// Nest crea un solo EventosService para toda la aplicación.
// SitiosDeDispositivos filtra el canal por los sitios del usuario (docs/20 §3); AlcanceService llega del módulo global de sesión.
@Module({ controllers: [EventosController], providers: [EventosService, SitiosDeDispositivos], exports: [EventosService] })
export class TiempoRealModule {}
