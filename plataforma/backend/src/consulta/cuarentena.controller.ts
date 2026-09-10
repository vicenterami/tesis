import { Controller, Get, Query } from '@nestjs/common';
import { ConsultaService } from './consulta.service';
import { limite } from './validacion';

@Controller('cuarentena')
export class CuarentenaController {
  constructor(private readonly consulta: ConsultaService) {}

  // GET /cuarentena?limite=50 — últimas tramas rechazadas con su motivo (diagnóstico, RF-13).
  @Get()
  listar(@Query('limite') lim?: string) { return this.consulta.cuarentena(limite(lim)); }
}
