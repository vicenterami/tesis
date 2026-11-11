import { Body, Controller, HttpCode, Param, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCookieAuth, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation,
  ApiParam, ApiResponse, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AltaService, CanalCalibrado } from './alta.service.js';
import { FORMA_ACTUALIZADO_EN, validarCalibracion } from './calibracion.dto.js';
import { uuid } from '../consulta/validacion.js';
import { AlcanceService } from '../sesion/alcance.service.js';
import { Usuario } from '../sesion/guardia.js';
import { exigirEnAlguno } from '../sesion/permisos.js';
import type { UsuarioSesion } from '../sesion/permisos.js';

// Calibración de un canal por API (docs/10 §8.4 punto 51 (ii)): una ruta que escribe; desde el 08/11/2026 la protege el guardia central
// (sesión de administrador del sitio del canal o la clave de administrador, docs/20 §5). La lectura del canal sigue en el módulo de
// consulta (GET /canales/{id}/historico); el permiso se comprueba antes que la validación del cuerpo.
@ApiTags('canales')
@ApiCookieAuth('sesion')
@Controller('canales')
export class CanalesAdminController {
  constructor(private readonly alta: AltaService, private readonly alcance: AlcanceService) {}

  @Patch(':id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Calibrar un canal (o quitar su calibración)',
    description:
      'Fija `escala_cero` y `escala_cien`, el valor de la magnitud que corresponde al 0 % y al 100 % (las dos con valor), o las quita (las dos ' +
      'null). Las dos o ninguna, números finitos y distintas; `escala_cien` < `escala_cero` es válido (sensor que baja al crecer lo medido). ' +
      '**Bloqueo optimista:** `actualizado_en` es el que entregó la ficha (`GET /dispositivos/{id}`) para este canal, tal cual (trae ' +
      'microsegundos); si el canal cambió desde entonces, 409 con la hora del cambio y el `actualizado_en` vigente. Deja el evento ' +
      '`canal_calibrado` del dispositivo con la escala anterior y la nueva. Nada guardado se reescribe: el porcentaje de la ficha, del ' +
      'histórico y del canal en vivo sale con la escala vigente desde la siguiente consulta o lectura. Exige sesión de administrador del sitio o `X-Clave-Admin` (docs/10 §8.4 punto 51; docs/20 §6).',
  })
  @ApiHeader({ name: 'X-Clave-Admin', required: false, description: 'Sin sesión: la clave de administrador (HTTP_CLAVE_ADMIN), como usuario del sistema (docs/20 §5)' })
  @ApiParam({ name: 'id', description: 'UUID del canal' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['escala_cero', 'escala_cien', 'actualizado_en'],
      properties: {
        escala_cero: { type: 'number', nullable: true, description: 'Valor de la magnitud (unidad canónica) que corresponde al 0 %; null con escala_cien null quita la calibración' },
        escala_cien: { type: 'number', nullable: true, description: 'Valor que corresponde al 100 %; distinto de escala_cero' },
        actualizado_en: { type: 'string', pattern: FORMA_ACTUALIZADO_EN.source, description: 'El `actualizado_en` del canal en la ficha, tal cual (ISO 8601 UTC con microsegundos)' },
      },
      example: { escala_cero: 2.205, escala_cien: 1.17, actualizado_en: '2026-10-22T18:04:31.123456Z' },
    },
  })
  @ApiOkResponse({
    description: 'Canal calibrado: `id`, `dispositivo_id`, `magnitud`, `unidad`, `etiqueta`, `escala_cero`, `escala_cien` y el `actualizado_en` nuevo (el que va en el próximo cambio)',
  })
  @ApiBadRequestResponse({ description: 'UUID inválido, o cuerpo inválido (una sola escala, iguales, no finitas, sin actualizado_en): `message` es la lista de motivos' })
  @ApiUnauthorizedResponse({ description: 'Sin sesión ni X-Clave-Admin, o X-Clave-Admin incorrecta' })
  @ApiForbiddenResponse({ description: 'Rol de consulta en ese sitio, o sesión sin la cabecera X-Pedido: panel' })
  @ApiNotFoundResponse({ description: 'El canal no existe, o es de otro sitio' })
  @ApiConflictResponse({ description: '«alguien lo cambió a las HH:MM UTC (…); recarga»: el canal cambió desde la ficha enviada; `actualizado_en` trae el vigente' })
  @ApiResponse({ status: 503, description: 'Sin clave de administrador configurada, u otra operación sobre el mismo canal en curso' })
  async calibrar(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Body() cuerpo: unknown): Promise<CanalCalibrado> {
    exigirEnAlguno(u, 'escribir');
    const canalId = uuid(id, 'canal');
    await this.alcance.exigirCanal(u, 'escribir', canalId);
    return this.alta.calibrar(canalId, validarCalibracion(cuerpo));
  }
}
