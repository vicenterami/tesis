import { Controller, Get } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AltaService } from './alta.service.js';

// El catálogo de magnitudes (docs/19 §4, N4): código, nombre y unidad canónica, a cualquier sesión (no es de ningún sitio). Lo usan la
// ayuda de `canales` del alta por lote, su vista previa y el selector del asistente (F1).
@ApiTags('magnitudes')
@ApiCookieAuth('sesion')
@ApiUnauthorizedResponse({ description: 'sesión requerida' })
@Controller('magnitudes')
export class MagnitudesController {
  constructor(private readonly alta: AltaService) {}

  @Get()
  @ApiOperation({ summary: 'Catálogo de magnitudes (Etapa 4)', description: 'Las magnitudes del catálogo con `codigo, nombre, unidad` (la unidad canónica, símbolo SenML), ordenadas por código. Con cualquier sesión (docs/20 §6).' })
  @ApiOkResponse({ description: 'Lista de magnitudes' })
  listar(): Promise<{ codigo: string; nombre: string; unidad: string }[]> {
    return this.alta.magnitudes();
  }
}
