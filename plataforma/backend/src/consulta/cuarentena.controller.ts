import { Controller, Get, Query } from '@nestjs/common';
import { ConsultaService } from './consulta.service';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { limite, uuid } from './validacion';

@ApiTags('cuarentena')
@Controller('cuarentena')
export class CuarentenaController {
  constructor(private readonly consulta: ConsultaService) {}

  // GET /cuarentena?limite=50&dispositivo=<uuid> — últimas tramas rechazadas con su motivo (diagnóstico, RF-13).
  @Get()
  @ApiOperation({ summary: 'Últimas tramas rechazadas', description: 'Motivo (`no_registrado`, `dado_de_baja`, `malformada`, `invalida`), detalle concreto del rechazo, dispositivo si se identificó, tópico y la carga cruda acotada (texto UTF-8 o, si es binaria, hexadecimal: ver `payload_formato`). Lo que no trae credencial no aparece aquí: lo corta el broker. Para diagnosticar por qué un sensor no aparece.' })
  @ApiQuery({ name: 'limite', required: false, description: '1–500, por defecto 50' })
  @ApiQuery({ name: 'dispositivo', required: false, description: 'UUID del dispositivo: solo lo rechazado que se le atribuyó (ficha del panel)' })
  @ApiOkResponse({ description: 'Lista de tramas en cuarentena' })
  listar(@Query('limite') lim?: string, @Query('dispositivo') dispositivo?: string) {
    return this.consulta.cuarentena(limite(lim), dispositivo === undefined ? undefined : uuid(dispositivo, 'dispositivo'));
  }
}
