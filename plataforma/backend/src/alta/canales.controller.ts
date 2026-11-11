import { Body, Controller, HttpCode, Param, Patch, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCookieAuth, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation,
  ApiParam, ApiResponse, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AltaService, CanalCalibrado } from './alta.service.js';
import { FORMA_ACTUALIZADO_EN, validarCalibracion } from './calibracion.dto.js';
import { CanalConReglas, ConfiguracionService } from './configuracion.service.js';
import { MAX_REGLAS, MAX_RETARDO_S } from './configuracion.dto.js';
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
  constructor(private readonly alta: AltaService, private readonly alcance: AlcanceService, private readonly configuracion: ConfiguracionService) {}

  // Reglas de umbral de un canal desde el panel (docs/19 §4, E; docs/10 §8.4 puntos 28 y 65 vi; RF-14).
  @Put(':id/reglas')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reemplazar las reglas de umbral de un canal (Etapa 4)',
    description:
      `Recibe \`actualizado_en\` (el del canal en la ficha, tal cual), \`etiqueta\` (hasta 40 caracteres o null) y \`reglas[{id?, umbral_alto, umbral_bajo, histeresis, retardo_s}]\` (0 a ${MAX_REGLAS}; ` +
      'vacía quita todas) y REEMPLAZA las del canal, emparejadas por `id`: con `id` (el de la ficha) cambia esa regla y su condición abierta sigue con ella; sin `id`, ' +
      'una regla nueva; las guardadas que no vienen se quitan (un `id` que no es de este canal: 400). Por regla: al menos un umbral; bajo < alto; histéresis ≥ 0 y menor que la mitad de la banda; umbrales dentro ' +
      `del rango físico de la magnitud; \`retardo_s\` entero de 0 a ${MAX_RETARDO_S}: la condición se abre cuando la medición lleva al menos ese tiempo fuera de la banda ` +
      '(RF-14). 400 con `errores[{campo, motivo}]`; 409 si el canal cambió (también por una calibración), con el `actualizado_en` vigente. Una regla quitada cierra ' +
      'su condición abierta. Deja el evento `reglas_cambiadas` (antes y después) con quién. Responde el canal con sus reglas y el `actualizado_en` nuevo.',
  })
  @ApiHeader({ name: 'X-Clave-Admin', required: false, description: 'Sin sesión: la clave de administrador (HTTP_CLAVE_ADMIN), como usuario del sistema (docs/20 §5)' })
  @ApiParam({ name: 'id', description: 'UUID del canal' })
  @ApiBody({
    schema: {
      type: 'object', required: ['actualizado_en', 'reglas'],
      properties: {
        actualizado_en: { type: 'string', pattern: FORMA_ACTUALIZADO_EN.source },
        etiqueta: { type: 'string', nullable: true, maxLength: 40 },
        reglas: {
          type: 'array', maxItems: MAX_REGLAS,
          items: { type: 'object', properties: { id: { type: 'string', format: 'uuid', description: 'La regla guardada que se cambia; sin id, una regla nueva' }, umbral_alto: { type: 'number', nullable: true }, umbral_bajo: { type: 'number', nullable: true }, histeresis: { type: 'number', minimum: 0 }, retardo_s: { type: 'integer', minimum: 0, maximum: MAX_RETARDO_S } } },
        },
      },
      example: { actualizado_en: '2026-11-11T18:04:31.123456Z', etiqueta: null, reglas: [{ umbral_alto: 30, umbral_bajo: 5, histeresis: 1, retardo_s: 120 }] },
    },
  })
  @ApiOkResponse({ description: 'El canal con sus reglas vigentes y su actualizado_en nuevo' })
  @ApiBadRequestResponse({ description: 'UUID inválido o reglas inválidas: `errores[{campo, motivo}]`' })
  @ApiUnauthorizedResponse({ description: 'Sin sesión ni X-Clave-Admin' })
  @ApiForbiddenResponse({ description: 'Un perfil sin ese permiso en ese sitio (docs/20 §6), o sesión sin la cabecera X-Pedido: panel' })
  @ApiNotFoundResponse({ description: 'El canal no existe, o es de otro sitio' })
  @ApiConflictResponse({ description: 'El canal cambió desde la ficha enviada; `actualizado_en` trae el vigente' })
  async reglas(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Body() cuerpo: unknown): Promise<CanalConReglas> {
    exigirEnAlguno(u, 'configurar');
    const canalId = uuid(id, 'canal');
    await this.alcance.exigirCanal(u, 'configurar', canalId);
    return this.configuracion.reemplazarReglas(canalId, cuerpo, u.id);
  }

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
  @ApiForbiddenResponse({ description: 'Un perfil sin ese permiso en ese sitio (docs/20 §6), o sesión sin la cabecera X-Pedido: panel' })
  @ApiNotFoundResponse({ description: 'El canal no existe, o es de otro sitio' })
  @ApiConflictResponse({ description: '«alguien lo cambió a las HH:MM UTC (…); recarga»: el canal cambió desde la ficha enviada; `actualizado_en` trae el vigente' })
  @ApiResponse({ status: 503, description: 'Sin clave de administrador configurada, u otra operación sobre el mismo canal en curso' })
  async calibrar(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Body() cuerpo: unknown): Promise<CanalCalibrado> {
    exigirEnAlguno(u, 'escribir');
    const canalId = uuid(id, 'canal');
    await this.alcance.exigirCanal(u, 'escribir', canalId);
    return this.alta.calibrar(canalId, validarCalibracion(cuerpo), u.id);
  }
}
