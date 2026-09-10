import { Controller, Get, Query } from '@nestjs/common';
import { ConsultaService } from './consulta.service';
import { limite } from './validacion';

@Controller('condiciones')
export class CondicionesController {
  constructor(private readonly consulta: ConsultaService) {}

  // GET /condiciones?abiertas=true|false&limite=50  (sin `abiertas`: todas)
  @Get()
  listar(@Query('abiertas') abiertas?: string, @Query('limite') lim?: string) {
    const filtro = abiertas === undefined ? undefined : abiertas === 'true';
    return this.consulta.condiciones(filtro, limite(lim));
  }
}
