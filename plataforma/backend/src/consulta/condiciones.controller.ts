import { Controller, Get, Query } from '@nestjs/common';
import { ConsultaService } from './consulta.service';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { limite, uuid } from './validacion';

@ApiTags('condiciones')
@Controller('condiciones')
export class CondicionesController {
  constructor(private readonly consulta: ConsultaService) {}

  // GET /condiciones?abiertas=true|false&limite=50&dispositivo=<uuid>  (sin `abiertas`: todas; sin `dispositivo`: de todos)
  @Get()
  @ApiOperation({ summary: 'Condiciones (estados anómalos) con duración', description: 'Cada condición con `duracion_s`, dispositivo y regla que la disparó. `sin_comunicacion` la abre el supervisor periódico; `umbral`, el filtro de alertas con histéresis.' })
  @ApiQuery({ name: 'abiertas', required: false, enum: ['true', 'false'], description: 'Sin el parámetro: todas' })
  @ApiQuery({ name: 'limite', required: false, description: '1–500, por defecto 50' })
  @ApiQuery({ name: 'dispositivo', required: false, description: 'UUID del dispositivo: solo sus condiciones (ficha del panel)' })
  @ApiOkResponse({ description: 'Lista de condiciones' })
  listar(@Query('abiertas') abiertas?: string, @Query('limite') lim?: string, @Query('dispositivo') dispositivo?: string) {
    const filtro = abiertas === undefined ? undefined : abiertas === 'true';
    return this.consulta.condiciones(filtro, limite(lim), dispositivo === undefined ? undefined : uuid(dispositivo, 'dispositivo'));
  }
}
