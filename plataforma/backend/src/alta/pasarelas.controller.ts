import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam,
  ApiResponse, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { uuid } from '../consulta/validacion';
import { FORMA_ID_FISICO, FORMATOS_PASARELA } from './alta.dto';
import { AltaService, CredencialPasarelaRotada, PasarelaCreada, PasarelaDadaDeBaja, PasarelaListada } from './alta.service';
import { ClaveAdminGuard } from './clave-admin.guard';
import { validarPasarela } from './pasarela.dto';

// Pasarelas y servidores de red externos (rutas B y C; docs/10 §3 y §8.4 punto 47). Las rutas que escriben exigen la clave de
// administrador, como las de dispositivos; la lista es de lectura, como el resto de las consultas hasta la sesión (M7).
@ApiTags('pasarelas')
@Controller('pasarelas')
export class PasarelasController {
  private readonly reservados: string[];
  constructor(private readonly alta: AltaService, config: ConfigService) {
    this.reservados = [config.get<string>('MQTT_SONDA_USUARIO', 'sonda').trim().toLowerCase()];
  }

  @Get()
  @ApiOperation({ summary: 'Listar pasarelas', description: 'Cada pasarela con su formato, su estado, sus nodos y la última vez vista, derivada de ellos.' })
  @ApiOkResponse({ description: 'Lista de pasarelas' })
  listar(): Promise<PasarelaListada[]> {
    return this.alta.listarPasarelas();
  }

  @Post()
  @HttpCode(201)
  @UseGuards(ClaveAdminGuard)
  @ApiOperation({
    summary: 'Dar de alta una pasarela o un servidor de red externo',
    description:
      'Crea la pasarela, su credencial (solo el hash en la base) y su cliente del broker con el rol `pasarela`, todo o nada. La respuesta ' +
      'trae, UNA sola vez, la credencial y las plantillas de tópico del formato declarado (ChirpStack: `event_topic` y `command_topic`; ' +
      'Milesight: el tópico del uplink con `$devEUI`). Sus nodos se dan de alta con `POST /dispositivos` y `via = lorawan`. Exige `X-Clave-Admin`.',
  })
  @ApiHeader({ name: 'X-Clave-Admin', required: true, description: 'Clave de administrador (HTTP_CLAVE_ADMIN del servidor)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['id_fisico', 'nombre', 'sitio_id', 'formato'],
      properties: {
        id_fisico: { type: 'string', pattern: FORMA_ID_FISICO.source, description: 'Identificador de la pasarela; también su usuario del broker' },
        nombre: { type: 'string', maxLength: 80 },
        sitio_id: { type: 'string', format: 'uuid' },
        formato: { type: 'string', enum: [...FORMATOS_PASARELA], description: 'Lo que publica: servidor de red embebido (milesight) o ChirpStack' },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Pasarela creada; `conexion` trae la credencial (una sola vez) y las plantillas de tópico' })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido, sitio inexistente o inactivo' })
  @ApiUnauthorizedResponse({ description: 'Cabecera X-Clave-Admin ausente o incorrecta' })
  @ApiConflictResponse({ description: 'El id_fisico ya existe (pasarela o dispositivo, o huérfano en el broker)' })
  @ApiResponse({ status: 502, description: 'El broker no aceptó la credencial; nada quedó creado' })
  @ApiResponse({ status: 503, description: 'Sin clave de administrador configurada, o sin conexión de administración con el broker' })
  @ApiResponse({ status: 429, description: 'Ya hay 2 operaciones de aprovisionamiento en curso; reintentar en un momento' })
  crear(@Body() cuerpo: unknown, @Res({ passthrough: true }) res: Response): Promise<PasarelaCreada> {
    const p = validarPasarela(cuerpo, this.reservados);
    res.setHeader('Cache-Control', 'no-store'); // la respuesta lleva una credencial
    return this.alta.crearPasarela(p);
  }

  @Delete(':id')
  @HttpCode(200)
  @UseGuards(ClaveAdminGuard)
  @ApiOperation({ summary: 'Dar de baja una pasarela', description: '`activo = false`, credenciales revocadas, evento y cliente borrado del broker, en una transacción. Exige `X-Clave-Admin`.' })
  @ApiHeader({ name: 'X-Clave-Admin', required: true, description: 'Clave de administrador (HTTP_CLAVE_ADMIN del servidor)' })
  @ApiParam({ name: 'id', description: 'UUID de la pasarela' })
  @ApiOkResponse({ description: 'Dada de baja: credenciales revocadas y nodos que quedan sin pasarela' })
  @ApiNotFoundResponse({ description: 'No existe' })
  @ApiConflictResponse({ description: 'Ya estaba dada de baja' })
  darDeBaja(@Param('id') id: string): Promise<PasarelaDadaDeBaja> {
    return this.alta.darDeBajaPasarela(uuid(id, 'pasarela'));
  }

  @Post(':id/credencial')
  @HttpCode(201)
  @UseGuards(ClaveAdminGuard)
  @ApiOperation({ summary: 'Rotar la credencial de una pasarela', description: 'Credencial nueva (una sola vez), la anterior inactiva y `setClientPassword` en el broker. Exige `X-Clave-Admin`.' })
  @ApiHeader({ name: 'X-Clave-Admin', required: true, description: 'Clave de administrador (HTTP_CLAVE_ADMIN del servidor)' })
  @ApiParam({ name: 'id', description: 'UUID de la pasarela' })
  @ApiCreatedResponse({ description: 'Credencial rotada; `conexion` trae la nueva y las plantillas de tópico' })
  @ApiNotFoundResponse({ description: 'No existe' })
  @ApiConflictResponse({ description: 'Está dada de baja' })
  rotar(@Param('id') id: string, @Res({ passthrough: true }) res: Response): Promise<CredencialPasarelaRotada> {
    const pasarelaId = uuid(id, 'pasarela');
    res.setHeader('Cache-Control', 'no-store');
    return this.alta.rotarPasarela(pasarelaId);
  }
}
