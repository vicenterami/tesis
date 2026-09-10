import { Controller, Get, Param, Query } from '@nestjs/common';
import { ConsultaService } from './consulta.service';
import { fecha, intervalo, uuid } from './validacion';

@Controller('canales')
export class CanalesController {
  constructor(private readonly consulta: ConsultaService) {}

  // GET /canales/:id/historico?desde=ISO&hasta=ISO&intervalo=15%20minutes
  // Por defecto: últimas 24 h agregadas cada 15 minutos. Formato columnar para uPlot (HU-07).
  @Get(':id/historico')
  historico(
    @Param('id') id: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('intervalo') inter?: string,
  ) {
    const h = fecha(hasta, new Date(), 'hasta');
    const d = fecha(desde, new Date(h.getTime() - 24 * 3600 * 1000), 'desde');
    return this.consulta.historico(uuid(id, 'canal'), d, h, intervalo(inter));
  }
}
