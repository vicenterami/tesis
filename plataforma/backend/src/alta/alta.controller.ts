import { Body, Controller, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiHeader, ApiOperation, ApiResponse, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AltaValidada, FORMATOS, FORMA_ID_FISICO, MAX_CANALES, VIAS, validarAlta } from './alta.dto';
import { AltaService, DispositivoCreado } from './alta.service';
import { ClaveAdminGuard } from './clave-admin.guard';

// POST /dispositivos (HU-11, RF-50; docs/10 §3, §8.4 punto 41; docs/19 P7 «Propuesta»). La guardia corre antes que la
// validación: sin la clave no se aprende ni la forma del cuerpo.
@ApiTags('dispositivos')
@Controller('dispositivos')
@UseGuards(ClaveAdminGuard)
export class AltaController {
  // El usuario de la sonda del chequeo de salud es configurable (MQTT_SONDA_USUARIO): también queda reservado.
  private readonly reservados: string[];
  constructor(private readonly alta: AltaService, config: ConfigService) {
    this.reservados = [config.get<string>('MQTT_SONDA_USUARIO', 'sonda').trim().toLowerCase()];
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Dar de alta un dispositivo',
    description:
      'Crea el dispositivo, sus canales y, según la vía, su credencial: `mqtt` crea el usuario en el broker (plugin Dynamic Security) ' +
      'y devuelve la clave UNA sola vez; `http` devuelve un token (la recepción por HTTP llega en una tanda posterior); `lorawan` no ' +
      'tiene credencial propia (la autentica su pasarela). Todo o nada: si el broker no acepta, nada queda creado. Mientras no hay ' +
      'sesión, exige la cabecera `X-Clave-Admin` (docs/10 §8.4 punto 41).',
  })
  @ApiHeader({ name: 'X-Clave-Admin', required: true, description: 'Clave de administrador (HTTP_CLAVE_ADMIN del servidor)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['id_fisico', 'nombre', 'zona_id', 'via', 'intervalo_esperado_s', 'canales'],
      properties: {
        id_fisico: { type: 'string', pattern: FORMA_ID_FISICO.source, description: 'Identificador físico; también el usuario del broker' },
        nombre: { type: 'string', maxLength: 80 },
        zona_id: { type: 'string', format: 'uuid' },
        via: { type: 'string', enum: [...VIAS] },
        formato: { type: 'string', enum: [...FORMATOS], default: 'senml' },
        pasarela_id: { type: 'string', format: 'uuid', nullable: true, description: 'Obligatoria si la vía es lorawan; prohibida si no' },
        intervalo_esperado_s: { type: 'integer', minimum: 5, maximum: 86400 },
        canales: {
          type: 'array', minItems: 1, maxItems: MAX_CANALES,
          items: { type: 'object', required: ['magnitud'], properties: { magnitud: { type: 'string', description: 'Código del catálogo (temperatura, humedad, …)' }, etiqueta: { type: 'string', nullable: true, maxLength: 40 } } },
        },
      },
      example: { id_fisico: 'nodo-01', nombre: 'Invernadero norte', zona_id: '00000000-0000-0000-0000-000000000002', via: 'mqtt', intervalo_esperado_s: 60, canales: [{ magnitud: 'temperatura' }, { magnitud: 'humedad', etiqueta: 'suelo' }] },
    },
  })
  @ApiCreatedResponse({ description: 'Dispositivo creado; `conexion` trae la credencial (una sola vez), el tópico y una trama de ejemplo' })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido: `message` es la lista de motivos' })
  @ApiUnauthorizedResponse({ description: 'Cabecera X-Clave-Admin ausente o incorrecta' })
  @ApiConflictResponse({ description: 'El id_fisico ya existe (en la base o, huérfano, en el broker)' })
  @ApiResponse({ status: 502, description: 'El broker no aceptó la credencial; nada quedó creado' })
  @ApiResponse({ status: 503, description: 'Sin clave de administrador configurada, o sin conexión de administración con el broker' })
  async crear(@Body() cuerpo: unknown, @Res({ passthrough: true }) res: Response): Promise<DispositivoCreado> {
    const a: AltaValidada = validarAlta(cuerpo, this.reservados);
    res.setHeader('Cache-Control', 'no-store'); // la respuesta lleva una credencial: ningún proxy ni navegador la guarda
    return this.alta.crear(a);
  }
}
