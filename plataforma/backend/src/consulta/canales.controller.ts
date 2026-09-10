import { Controller, Get, Param, Query } from '@nestjs/common';
import { ConsultaService } from './consulta.service';
import { ApiBadRequestResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { INTERVALOS, fecha, intervalo, uuid } from './validacion';

@ApiTags('canales')
@Controller('canales')
export class CanalesController {
  constructor(private readonly consulta: ConsultaService) {}

  // GET /canales/:id/historico?desde=ISO&hasta=ISO&intervalo=15%20minutes
  // Por defecto: últimas 24 h agregadas cada 15 minutos. Formato columnar para uPlot (HU-07).
  @Get(':id/historico')
  @ApiOperation({
    summary: 'Histórico agregado de un canal',
    description:
      'Promedio por intervalo calculado con time_bucket EN LA ZONA HORARIA DEL SITIO. Formato columnar para uPlot: ' +
      '`tiempos` (segundos Unix), `valores`, `muestras` (cuántas lecturas hay detrás de cada promedio). Rango semiabierto [desde, hasta). ' +
      'Por defecto: últimas 24 h cada 15 minutos.',
  })
  @ApiParam({ name: 'id', description: 'UUID del canal' })
  @ApiQuery({ name: 'desde', required: false, description: 'ISO 8601; por defecto hasta − 24 h' })
  @ApiQuery({ name: 'hasta', required: false, description: 'ISO 8601; por defecto ahora' })
  @ApiQuery({ name: 'intervalo', required: false, enum: INTERVALOS, description: 'Lista cerrada: nunca texto libre en SQL' })
  @ApiOkResponse({ description: 'Serie agregada' })
  @ApiBadRequestResponse({ description: 'UUID, fecha o intervalo inválidos' })
  @ApiNotFoundResponse({ description: 'Canal inexistente' })
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
