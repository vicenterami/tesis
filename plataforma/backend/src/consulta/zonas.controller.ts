import { Body, Controller, Param, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam,
  ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AlcanceService } from '../sesion/alcance.service.js';
import { Usuario } from '../sesion/guardia.js';
import { exigirEnAlguno } from '../sesion/permisos.js';
import type { UsuarioSesion } from '../sesion/permisos.js';
import { MAX_NOMBRE_ZONA, validarCambioZona } from './sitios-zonas.js';
import { SitiosZonasService, ZonaDeSitio } from './sitios-zonas.service.js';
import { uuid } from './validacion.js';

// Renombrar y retirar una zona (docs/19 §4 U; docs/20 §6): la acción `ajustes` en el sitio de la zona. Sin la acción en ningún sitio, 403
// antes de mirar el cuerpo; el cuerpo, 400; la zona: 404 si no existe o es de otro sitio (RF-41), 403 si su perfil no puede.
@ApiTags('sitios')
@ApiCookieAuth('sesion')
@ApiUnauthorizedResponse({ description: 'sesión requerida' })
@Controller('zonas')
export class ZonasController {
  constructor(private readonly alcance: AlcanceService, private readonly estructura: SitiosZonasService) {}

  @Patch(':id')
  @ApiOperation({
    summary: 'Renombrar o retirar una zona (Etapa 4)',
    description:
      'Quien administra el sitio (acción `ajustes`). `activo: false` la retira: deja de ofrecerse en el alta y al configurar, y se sigue viendo en la ' +
      'historia; solo sin dispositivos activos (los de mantenimiento cuentan). `activo: true` la vuelve a ofrecer. Deja el evento `zona_cambio`.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la zona' })
  @ApiBody({ schema: { type: 'object', properties: { nombre: { type: 'string', maxLength: MAX_NOMBRE_ZONA }, activo: { type: 'boolean' } } } })
  @ApiOkResponse({ description: 'La zona `{id, sitio_id, nombre, activo, dispositivos}` (dispositivos: cuántos activos tiene)' })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido o nada que cambiar; un nombre con caracteres de control o invisibles' })
  @ApiForbiddenResponse({ description: 'Un perfil sin la acción «ajustes» (docs/20 §6), o sesión sin la cabecera X-Pedido: panel' })
  @ApiConflictResponse({ description: '`codigo: zona_repetida` (el nombre ya existe en el sitio, en una zona activa), `zona_retirada` (existe en una retirada: se vuelve a ofrecer esa) o `zona_con_dispositivos` (con `dispositivos`: cuántos activos impiden retirarla)' })
  @ApiNotFoundResponse({ description: 'Zona inexistente, de otro sitio o de un sitio inactivo' })
  @ApiServiceUnavailableResponse({ description: 'Otro cambio sobre esta zona está en curso (bloqueo agotado): reintentar' })
  async cambiar(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Body() cuerpo: unknown): Promise<ZonaDeSitio> {
    exigirEnAlguno(u, 'ajustes');
    const cambio = validarCambioZona(cuerpo);
    const zonaId = uuid(id, 'zona');
    await this.alcance.exigirZona(u, 'ajustes', zonaId);
    return this.estructura.cambiarZona(zonaId, cambio, u.id);
  }
}
