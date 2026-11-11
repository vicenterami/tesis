import { Module } from '@nestjs/common';
import { CuentaController } from './cuenta.controller.js';
import { CuentaService } from './cuenta.service.js';

// Lo propio de cada persona (docs/20 §6; docs/19 §4, H y P13): preferencias, sesiones abiertas, exportar mis datos y darme de baja. Usa el
// SesionService del módulo global de sesión (verificar la clave, registrar el cierre en `acceso`).
@Module({ controllers: [CuentaController], providers: [CuentaService] })
export class CuentaModule {}
