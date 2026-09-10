import { Controller, Get, Query } from '@nestjs/common';
import { ConsultaService } from './consulta.service';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { limite } from './validacion';

@ApiTags('cuarentena')
@Controller('cuarentena')
export class CuarentenaController {
  constructor(private readonly consulta: ConsultaService) {}

  // GET /cuarentena?limite=50 — últimas tramas rechazadas con su motivo (diagnóstico, RF-13).
  @Get()
  @ApiOperation({ summary: 'Últimas tramas rechazadas', description: 'Motivo (`desconocido`, `malformada`, `invalida`), tópico y los primeros 200 caracteres de la carga cruda. Para diagnosticar por qué un sensor no aparece.' })
  @ApiQuery({ name: 'limite', required: false, description: '1–500, por defecto 50' })
  @ApiOkResponse({ description: 'Lista de tramas en cuarentena' })
  listar(@Query('limite') lim?: string) { return this.consulta.cuarentena(limite(lim)); }
}
