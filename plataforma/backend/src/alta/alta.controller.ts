import { Body, Controller, Delete, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse,
  ApiOperation, ApiParam, ApiResponse, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AltaValidada, FORMATOS_DIRECTOS, FORMA_ID_FISICO, MAX_CANALES, VIAS, validarAlta } from './alta.dto';
import { PERFILES } from '../recepcion/adaptadores/perfiles';
import { AltaService, CredencialRotada, DispositivoCreado, DispositivoDadoDeBaja } from './alta.service';
import { uuid } from '../consulta/validacion';
import { AlcanceService } from '../sesion/alcance.service';
import { Usuario } from '../sesion/guardia';
import { exigirEnAlguno } from '../sesion/permisos';
import type { UsuarioSesion } from '../sesion/permisos';

// Aprovisionamiento por API (docs/10 §3, §8.4 puntos 41 y 42; docs/19 P7 «Propuesta»): POST /dispositivos (HU-11, RF-19),
// DELETE /dispositivos/{id} (baja) y POST /dispositivos/{id}/credencial (rotación por dispositivo; RF-45 pide rotar la credencial de recepción de un SITIO sin
// interrumpir el servicio, que aún no existe: esta la interrumpe para ese dispositivo hasta que cargue la nueva). Desde el 08/11/2026 (M7, docs/20 §5)
// las protege el guardia central: sesión de administrador del sitio del dispositivo (o de la zona, en el alta) o la clave de administrador. El
// orden no cambia: sin sesión, 401 antes de mirar nada; con rol de consulta en todos sus sitios, 403 antes de validar; después, el
// sitio del recurso: 404 si no existe o es de otro sitio (RF-41), 403 si es suyo y su rol no puede.
@ApiTags('dispositivos')
@ApiCookieAuth('sesion')
@Controller('dispositivos')
export class AltaController {
  // El usuario de la sonda del chequeo de salud es configurable (MQTT_SONDA_USUARIO): también queda reservado.
  private readonly reservados: string[];
  constructor(private readonly alta: AltaService, private readonly alcance: AlcanceService, config: ConfigService) {
    this.reservados = [config.get<string>('MQTT_SONDA_USUARIO', 'sonda').trim().toLowerCase()];
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Dar de alta un dispositivo',
    description:
      'Crea el dispositivo, sus canales y, según la vía, su credencial: `mqtt` crea el usuario en el broker (plugin Dynamic Security) ' +
      'y devuelve la clave UNA sola vez; `http` devuelve un token (la recepción por HTTP llega en una tanda posterior); `lorawan` no ' +
      'tiene credencial propia (la autentica su pasarela). Todo o nada: si el broker no acepta, nada queda creado. Exige sesión de ' +
      'administrador del sitio de la zona (docs/20 §6) o la cabecera `X-Clave-Admin` (docs/10 §8.4 punto 41).',
  })
  @ApiHeader({ name: 'X-Clave-Admin', required: false, description: 'Sin sesión: la clave de administrador (HTTP_CLAVE_ADMIN), como usuario del sistema (docs/20 §5)' })
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
  @ApiUnauthorizedResponse({ description: 'Sin sesión ni X-Clave-Admin, o X-Clave-Admin incorrecta' })
  @ApiForbiddenResponse({ description: 'Rol de consulta en ese sitio, o sesión sin la cabecera X-Pedido: panel' })
  @ApiConflictResponse({ description: 'El id_fisico ya existe (en la base o, huérfano, en el broker)' })
  @ApiResponse({ status: 502, description: 'El broker no aceptó la credencial; nada quedó creado' })
  @ApiResponse({ status: 503, description: 'Sin clave de administrador configurada, o sin conexión de administración con el broker' })
  @ApiResponse({ status: 429, description: 'Ya hay 2 operaciones de aprovisionamiento en curso (alta, baja o rotación); reintentar en un momento' })
  async crear(@Usuario() u: UsuarioSesion, @Body() cuerpo: unknown, @Res({ passthrough: true }) res: Response): Promise<DispositivoCreado> {
    exigirEnAlguno(u, 'escribir');
    const a: AltaValidada = validarAlta(cuerpo, this.reservados);
    await this.alcance.exigirZona(u, 'escribir', a.zona_id); // 404 si la zona no existe o es de otro sitio
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
      'quedan; lo que llegue después va a cuarentena como `dado_de_baja`. Exige sesión de administrador del sitio o `X-Clave-Admin` (docs/10 §3).',
  })
  @ApiHeader({ name: 'X-Clave-Admin', required: false, description: 'Sin sesión: la clave de administrador (HTTP_CLAVE_ADMIN), como usuario del sistema (docs/20 §5)' })
  @ApiParam({ name: 'id', description: 'UUID del dispositivo' })
  @ApiOkResponse({ description: 'Dado de baja: estado anterior, credenciales revocadas y condiciones cerradas' })
  @ApiBadRequestResponse({ description: 'UUID inválido' })
  @ApiUnauthorizedResponse({ description: 'Sin sesión ni X-Clave-Admin, o X-Clave-Admin incorrecta' })
  @ApiForbiddenResponse({ description: 'Rol de consulta en ese sitio, o sesión sin la cabecera X-Pedido: panel' })
  @ApiNotFoundResponse({ description: 'No existe, o es de otro sitio' })
  @ApiConflictResponse({ description: 'Ya estaba dado de baja' })
  @ApiResponse({ status: 502, description: 'El broker no confirmó el borrado del cliente; nada cambió en la base' })
  @ApiResponse({ status: 503, description: 'Sin clave de administrador configurada, sin conexión de administración con el broker, u otra operación sobre el mismo dispositivo en curso' })
  @ApiResponse({ status: 429, description: 'Ya hay 2 operaciones de aprovisionamiento en curso (alta, baja o rotación); reintentar en un momento' })
  async darDeBaja(@Usuario() u: UsuarioSesion, @Param('id') id: string): Promise<DispositivoDadoDeBaja> {
    exigirEnAlguno(u, 'escribir');
    const dispositivoId = uuid(id, 'dispositivo');
    await this.alcance.exigirDispositivo(u, 'escribir', dispositivoId);
    return this.alta.darDeBaja(dispositivoId);
  }

  @Post(':id/credencial')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Rotar la credencial de un dispositivo',
    description:
      'La credencial perdida no se recupera: se reemplaza. Nueva fila en `credencial` (la anterior queda inactiva), evento `rotacion` y, si la ' +
      'vía es `mqtt`, `setClientPassword` en el broker dentro de la transacción (si el broker no tenía al cliente, se crea con su rol). ' +
      'Devuelve la credencial nueva UNA sola vez. La anterior deja de valer al confirmar; una sesión MQTT ya abierta sigue hasta que ' +
      'el dispositivo reconecte. Si la respuesta no llega, repetir: la anterior puede haber dejado de valer. Exige sesión de administrador del sitio o `X-Clave-Admin`.',
  })
  @ApiHeader({ name: 'X-Clave-Admin', required: false, description: 'Sin sesión: la clave de administrador (HTTP_CLAVE_ADMIN), como usuario del sistema (docs/20 §5)' })
  @ApiParam({ name: 'id', description: 'UUID del dispositivo' })
  @ApiCreatedResponse({ description: 'Credencial rotada; `conexion` trae la nueva (una sola vez), el tópico y una trama de ejemplo' })
  @ApiBadRequestResponse({ description: 'UUID inválido, o dispositivo lorawan (sin credencial propia)' })
  @ApiUnauthorizedResponse({ description: 'Sin sesión ni X-Clave-Admin, o X-Clave-Admin incorrecta' })
  @ApiForbiddenResponse({ description: 'Rol de consulta en ese sitio, o sesión sin la cabecera X-Pedido: panel' })
  @ApiNotFoundResponse({ description: 'No existe, o es de otro sitio' })
  @ApiConflictResponse({ description: 'Está dado de baja' })
  @ApiResponse({ status: 502, description: 'El broker no confirmó la clave nueva; nada cambió en la base (repetir la rotación)' })
  @ApiResponse({ status: 503, description: 'Sin clave de administrador configurada, sin conexión de administración con el broker, u otra operación sobre el mismo dispositivo en curso' })
  @ApiResponse({ status: 429, description: 'Ya hay 2 operaciones de aprovisionamiento en curso (alta, baja o rotación); reintentar en un momento' })
  async rotar(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Res({ passthrough: true }) res: Response): Promise<CredencialRotada> {
    exigirEnAlguno(u, 'escribir');
    const dispositivoId = uuid(id, 'dispositivo');
    await this.alcance.exigirDispositivo(u, 'escribir', dispositivoId);
    res.setHeader('Cache-Control', 'no-store'); // la respuesta lleva una credencial: ningún proxy ni navegador la guarda
    return this.alta.rotarCredencial(dispositivoId);
  }
}
