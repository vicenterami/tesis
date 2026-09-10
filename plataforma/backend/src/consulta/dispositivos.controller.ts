import { Controller, Get, Param } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ConsultaService } from './consulta.service';
import { uuid } from './validacion';

@ApiTags('dispositivos')
@Controller('dispositivos')
export class DispositivosController {
  constructor(private readonly consulta: ConsultaService) {}

  // Inventario con estado: base de la vista "salud del sitio" (HU-19).
  @Get()
  @ApiOperation({ summary: 'Inventario de dispositivos con estado', description: 'Cada dispositivo con su sitio, zona horaria, canales, `en_linea` (última trama hace menos de 2 × intervalo esperado) y número de condiciones abiertas.' })
  @ApiOkResponse({ description: 'Lista de dispositivos' })
  listar() { return this.consulta.dispositivos(); }

  // Ficha completa: canales, reglas, última medición y condiciones abiertas (HU-21).
  @Get(':id')
  @ApiOperation({ summary: 'Ficha de un dispositivo', description: 'Canales con sus reglas de umbral y última medición, y condiciones abiertas.' })
  @ApiParam({ name: 'id', description: 'UUID del dispositivo' })
  @ApiOkResponse({ description: 'Ficha del dispositivo' })
  @ApiNotFoundResponse({ description: 'No existe' })
  detalle(@Param('id') id: string) { return this.consulta.dispositivo(uuid(id)); }
}
