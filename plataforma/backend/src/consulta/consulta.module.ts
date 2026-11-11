import { Module } from '@nestjs/common';
import { CanalesController } from './canales.controller.js';
import { CondicionesController } from './condiciones.controller.js';
import { ConsultaService } from './consulta.service.js';
import { CuarentenaController } from './cuarentena.controller.js';
import { DispositivosController } from './dispositivos.controller.js';
import { SitiosController } from './sitios.controller.js';
import { ActividadService } from './actividad.service.js';
import { TableroService } from './tablero.service.js';

// M5 Persistencia y consulta — la API que consumirá el panel (patrón B: el navegador solo habla con el backend).
// Solo lectura. Desde el 08/11/2026 con sesión (M7, docs/20): el guardia central identifica a quien pregunta y cada ruta filtra o
// decide con permitir() por el sitio del recurso (AlcanceService, del módulo global de sesión).
@Module({
  controllers: [DispositivosController, CanalesController, CondicionesController, CuarentenaController, SitiosController],
  providers: [ConsultaService, TableroService, ActividadService],
  exports: [ConsultaService],
})
export class ConsultaModule {}
