import { Controller, Get, Param } from '@nestjs/common';
import { ConsultaService } from './consulta.service';
import { uuid } from './validacion';

@Controller('dispositivos')
export class DispositivosController {
  constructor(private readonly consulta: ConsultaService) {}

  // Inventario con estado: base de la vista "salud del sitio" (HU-19).
  @Get()
  listar() { return this.consulta.dispositivos(); }

  // Ficha completa: canales, reglas, última medición y condiciones abiertas (HU-21).
  @Get(':id')
  detalle(@Param('id') id: string) { return this.consulta.dispositivo(uuid(id)); }
}
