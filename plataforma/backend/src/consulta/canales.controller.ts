import { Controller, Get, Param, Query } from '@nestjs/common';
import { ConsultaService } from './consulta.service.js';
import { ApiBadRequestResponse, ApiCookieAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { INTERVALOS, MAX_CUBOS, MAX_DIAS_VENTANA, exigirTopeCubos, fecha, intervalo, uuid } from './validacion.js';
import { AlcanceService } from '../sesion/alcance.service.js';
import { Usuario } from '../sesion/guardia.js';
import type { UsuarioSesion } from '../sesion/permisos.js';

@ApiTags('canales')
@ApiCookieAuth('sesion')
@Controller('canales')
export class CanalesController {
  constructor(private readonly consulta: ConsultaService, private readonly alcance: AlcanceService) {}

  // GET /canales/:id/historico?desde=ISO&hasta=ISO&intervalo=15%20minutes
  // Por defecto: últimas 24 h agregadas cada 15 minutos. Formato columnar para uPlot (HU-07).
  @Get(':id/historico')
  @ApiOperation({
    summary: 'Histórico agregado de un canal',
    description:
      'Promedio por intervalo calculado con time_bucket EN LA ZONA HORARIA DEL SITIO. Formato columnar para uPlot: ' +
      '`tiempos` (segundos Unix), `valores`, `muestras` (cuántas lecturas hay detrás de cada promedio). Rango semiabierto [desde, hasta). ' +
      'Por defecto: últimas 24 h cada 15 minutos. Una ventana que daría más de ' + MAX_CUBOS + ' cubos (ventana ÷ intervalo) se rechaza con 400 ' +
      'antes de consultar (docs/19 §4, incremento 2, punto 4).',
  })
  @ApiParam({ name: 'id', description: 'UUID del canal' })
  @ApiQuery({ name: 'desde', required: false, description: 'ISO 8601; por defecto hasta − 24 h' })
  @ApiQuery({ name: 'hasta', required: false, description: 'ISO 8601; por defecto ahora' })
  @ApiQuery({ name: 'intervalo', required: false, enum: INTERVALOS, description: 'Lista cerrada: nunca texto libre en SQL' })
  @ApiOkResponse({ description: 'Serie agregada' })
  @ApiBadRequestResponse({ description: `UUID, fecha o intervalo inválidos, o una ventana de más de ${MAX_DIAS_VENTANA} días o de más de ${MAX_CUBOS} cubos` })
  @ApiNotFoundResponse({ description: 'Canal inexistente o de otro sitio' })
  @ApiUnauthorizedResponse({ description: 'sesión requerida' })
  async historico(
    @Usuario() u: UsuarioSesion,
    @Param('id') id: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('intervalo') inter?: string,
  ) {
    const h = fecha(hasta, new Date(), 'hasta');
    const d = fecha(desde, new Date(h.getTime() - 24 * 3600 * 1000), 'desde');
    const i = intervalo(inter);
    exigirTopeCubos(d, h, i); // antes de tocar la base: el costo se acota en la entrada
    const canalId = uuid(id, 'canal');
    await this.alcance.exigirCanal(u, 'leer', canalId); // 404 si es de otro sitio (docs/20 §6)
    return this.consulta.historico(canalId, d, h, i);
  }
}
