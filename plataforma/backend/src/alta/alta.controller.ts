import { Body, Controller, Delete, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AltaValidada, FORMATOS_DIRECTOS, FORMA_ID_FISICO, MAX_CANALES, VIAS, validarAlta } from './alta.dto';
import { PERFILES } from '../recepcion/adaptadores/perfiles';
import { AltaService, CredencialRotada, DispositivoCreado, DispositivoDadoDeBaja } from './alta.service';
import { ClaveAdminGuard } from './clave-admin.guard';
import { uuid } from '../consulta/validacion';

// Aprovisionamiento por API (docs/10 §3, §8.4 puntos 41 y 42; docs/19 P7 «Propuesta»): POST /dispositivos (HU-11, RF-19),
// DELETE /dispositivos/{id} (baja) y POST /dispositivos/{id}/credencial (rotación por dispositivo; RF-45 pide rotar la credencial de recepción de un SITIO sin
// interrumpir el servicio, que aún no existe: esta la interrumpe para ese dispositivo hasta que cargue la nueva). La guardia corre antes que la
// validación: sin la clave no se aprende ni la forma del cuerpo ni si el identificador existe.
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
        formato: { type: 'string', enum: [...FORMATOS_DIRECTOS], default: 'senml', description: 'Solo vías mqtt y http; un dispositivo lorawan no lo envía: hereda el de su pasarela' },
        pasarela_id: { type: 'string', format: 'uuid', nullable: true, description: 'Obligatoria si la vía es lorawan; prohibida si no' },
        decodificador: { type: 'string', enum: [...PERFILES], nullable: true, description: 'Solo vía lorawan: perfil con que la plataforma decodifica la carga cuando la pasarela la entrega sin decodificar' },
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
  @ApiResponse({ status: 429, description: 'Ya hay 2 operaciones de aprovisionamiento en curso (alta, baja o rotación); reintentar en un momento' })
  async crear(@Body() cuerpo: unknown, @Res({ passthrough: true }) res: Response): Promise<DispositivoCreado> {
    const a: AltaValidada = validarAlta(cuerpo, this.reservados);
    res.setHeader('Cache-Control', 'no-store'); // la respuesta lleva una credencial: ningún proxy ni navegador la guarda
    return this.alta.crear(a);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Dar de baja un dispositivo',
    description:
      'Baja lógica: `estado = baja`, credenciales revocadas, condiciones abiertas cerradas y evento `baja`, en una transacción; si la vía es ' +
      '`mqtt`, el cliente se borra del broker dentro de ella (un cliente que el broker ya no tiene cuenta como borrado). La fila y su historial ' +
      'quedan; lo que llegue después va a cuarentena como `dado_de_baja`. Exige la cabecera `X-Clave-Admin` (docs/10 §3).',
  })
  @ApiHeader({ name: 'X-Clave-Admin', required: true, description: 'Clave de administrador (HTTP_CLAVE_ADMIN del servidor)' })
  @ApiParam({ name: 'id', description: 'UUID del dispositivo' })
  @ApiOkResponse({ description: 'Dado de baja: estado anterior, credenciales revocadas y condiciones cerradas' })
  @ApiBadRequestResponse({ description: 'UUID inválido' })
  @ApiUnauthorizedResponse({ description: 'Cabecera X-Clave-Admin ausente o incorrecta' })
  @ApiNotFoundResponse({ description: 'No existe' })
  @ApiConflictResponse({ description: 'Ya estaba dado de baja' })
  @ApiResponse({ status: 502, description: 'El broker no confirmó el borrado del cliente; nada cambió en la base' })
  @ApiResponse({ status: 503, description: 'Sin clave de administrador configurada, sin conexión de administración con el broker, u otra operación sobre el mismo dispositivo en curso' })
  @ApiResponse({ status: 429, description: 'Ya hay 2 operaciones de aprovisionamiento en curso (alta, baja o rotación); reintentar en un momento' })
  darDeBaja(@Param('id') id: string): Promise<DispositivoDadoDeBaja> {
    return this.alta.darDeBaja(uuid(id, 'dispositivo'));
  }

  @Post(':id/credencial')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Rotar la credencial de un dispositivo',
    description:
      'La credencial perdida no se recupera: se reemplaza. Nueva fila en `credencial` (la anterior queda inactiva), evento `rotacion` y, si la ' +
      'vía es `mqtt`, `setClientPassword` en el broker dentro de la transacción (si el broker no tenía al cliente, se crea con su rol). ' +
      'Devuelve la credencial nueva UNA sola vez. La anterior deja de valer al confirmar; una sesión MQTT ya abierta sigue hasta que ' +
      'el dispositivo reconecte. Si la respuesta no llega, repetir: la anterior puede haber dejado de valer. Exige `X-Clave-Admin`.',
  })
  @ApiHeader({ name: 'X-Clave-Admin', required: true, description: 'Clave de administrador (HTTP_CLAVE_ADMIN del servidor)' })
  @ApiParam({ name: 'id', description: 'UUID del dispositivo' })
  @ApiCreatedResponse({ description: 'Credencial rotada; `conexion` trae la nueva (una sola vez), el tópico y una trama de ejemplo' })
  @ApiBadRequestResponse({ description: 'UUID inválido, o dispositivo lorawan (sin credencial propia)' })
  @ApiUnauthorizedResponse({ description: 'Cabecera X-Clave-Admin ausente o incorrecta' })
  @ApiNotFoundResponse({ description: 'No existe' })
  @ApiConflictResponse({ description: 'Está dado de baja' })
  @ApiResponse({ status: 502, description: 'El broker no confirmó la clave nueva; nada cambió en la base (repetir la rotación)' })
  @ApiResponse({ status: 503, description: 'Sin clave de administrador configurada, sin conexión de administración con el broker, u otra operación sobre el mismo dispositivo en curso' })
  @ApiResponse({ status: 429, description: 'Ya hay 2 operaciones de aprovisionamiento en curso (alta, baja o rotación); reintentar en un momento' })
  async rotar(@Param('id') id: string, @Res({ passthrough: true }) res: Response): Promise<CredencialRotada> {
    const dispositivoId = uuid(id, 'dispositivo');
    res.setHeader('Cache-Control', 'no-store'); // la respuesta lleva una credencial: ningún proxy ni navegador la guarda
    return this.alta.rotarCredencial(dispositivoId);
  }
}
