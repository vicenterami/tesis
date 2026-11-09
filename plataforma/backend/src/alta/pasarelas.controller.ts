import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse,
  ApiOperation, ApiParam, ApiResponse, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { uuid } from '../consulta/validacion';
import { AlcanceService } from '../sesion/alcance.service';
import { Usuario } from '../sesion/guardia';
import { alcanceDeLectura, exigirEnAlguno } from '../sesion/permisos';
import type { UsuarioSesion } from '../sesion/permisos';
import { FORMA_ID_FISICO, FORMATOS_PASARELA } from './alta.dto';
import { AltaService, CredencialPasarelaRotada, PasarelaCreada, PasarelaDadaDeBaja, PasarelaListada } from './alta.service';
import { validarPasarela } from './pasarela.dto';

// Pasarelas y servidores de red externos (rutas B y C; docs/10 §3 y §8.4 punto 47). Desde el 08/11/2026 (M7, docs/20 §5): la lista exige
// sesión y muestra solo las de los sitios del usuario; las rutas que escriben exigen administrador del sitio de la pasarela (o la clave
// de administrador), como las de dispositivos.
@ApiTags('pasarelas')
@ApiCookieAuth('sesion')
@Controller('pasarelas')
export class PasarelasController {
  private readonly reservados: string[];
  constructor(private readonly alta: AltaService, private readonly alcance: AlcanceService, config: ConfigService) {
    this.reservados = [config.get<string>('MQTT_SONDA_USUARIO', 'sonda').trim().toLowerCase()];
  }

  @Get()
  @ApiOperation({ summary: 'Listar pasarelas', description: 'Cada pasarela de los sitios del usuario con su formato, su estado, sus nodos y la última vez vista, derivada de ellos.' })
  @ApiOkResponse({ description: 'Lista de pasarelas' })
  @ApiUnauthorizedResponse({ description: 'sesión requerida' })
  listar(@Usuario() u: UsuarioSesion): Promise<PasarelaListada[]> {
    return this.alta.listarPasarelas(alcanceDeLectura(u));
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Dar de alta una pasarela o un servidor de red externo',
    description:
      'Crea la pasarela, su credencial (solo el hash en la base) y su cliente del broker con el rol `pasarela`, todo o nada. La respuesta ' +
      'trae, UNA sola vez, la credencial y las plantillas de tópico del formato declarado (ChirpStack: `event_topic` y `command_topic`; ' +
      'Milesight: el tópico del uplink con `$deveui` (minúsculas: es lo que la pasarela sustituye) y, para mantener el tópico nativo de la pasarela, la línea del puente de Mosquitto ' +
      'en `puente_mosquitto`). Sus nodos se dan de alta con `POST /dispositivos` y `via = lorawan` (con `decodificador` si la pasarela entrega la trama sin decodificar). Exige sesión de administrador del sitio o `X-Clave-Admin`.',
  })
  @ApiHeader({ name: 'X-Clave-Admin', required: false, description: 'Sin sesión: la clave de administrador (HTTP_CLAVE_ADMIN), como usuario del sistema (docs/20 §5)' })
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
  @ApiUnauthorizedResponse({ description: 'Sin sesión ni X-Clave-Admin, o X-Clave-Admin incorrecta' })
  @ApiForbiddenResponse({ description: 'Rol de consulta en ese sitio, o sesión sin la cabecera X-Pedido: panel' })
  @ApiConflictResponse({ description: 'El id_fisico ya existe (pasarela o dispositivo, o huérfano en el broker)' })
  @ApiResponse({ status: 502, description: 'El broker no aceptó la credencial; nada quedó creado' })
  @ApiResponse({ status: 503, description: 'Sin clave de administrador configurada, o sin conexión de administración con el broker' })
  @ApiResponse({ status: 429, description: 'Ya hay 2 operaciones de aprovisionamiento en curso; reintentar en un momento' })
  async crear(@Usuario() u: UsuarioSesion, @Body() cuerpo: unknown, @Res({ passthrough: true }) res: Response): Promise<PasarelaCreada> {
    exigirEnAlguno(u, 'escribir');
    const p = validarPasarela(cuerpo, this.reservados);
    await this.alcance.exigirSitio(u, 'escribir', p.sitio_id); // 404 si el sitio no existe o no es suyo
    res.setHeader('Cache-Control', 'no-store'); // la respuesta lleva una credencial
    return this.alta.crearPasarela(p);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dar de baja una pasarela', description: '`activo = false`, credenciales revocadas, evento y cliente borrado del broker, en una transacción. Exige sesión de administrador del sitio o `X-Clave-Admin`.' })
  @ApiHeader({ name: 'X-Clave-Admin', required: false, description: 'Sin sesión: la clave de administrador (HTTP_CLAVE_ADMIN), como usuario del sistema (docs/20 §5)' })
  @ApiParam({ name: 'id', description: 'UUID de la pasarela' })
  @ApiOkResponse({ description: 'Dada de baja: credenciales revocadas y nodos que quedan sin pasarela' })
  @ApiNotFoundResponse({ description: 'No existe, o es de otro sitio' })
  @ApiConflictResponse({ description: 'Ya estaba dada de baja' })
  async darDeBaja(@Usuario() u: UsuarioSesion, @Param('id') id: string): Promise<PasarelaDadaDeBaja> {
    exigirEnAlguno(u, 'escribir');
    const pasarelaId = uuid(id, 'pasarela');
    await this.alcance.exigirPasarela(u, 'escribir', pasarelaId);
    return this.alta.darDeBajaPasarela(pasarelaId);
  }

  @Post(':id/credencial')
  @HttpCode(201)
  @ApiOperation({ summary: 'Rotar la credencial de una pasarela', description: 'Credencial nueva (una sola vez), la anterior inactiva y `setClientPassword` en el broker. Exige sesión de administrador del sitio o `X-Clave-Admin`.' })
  @ApiHeader({ name: 'X-Clave-Admin', required: false, description: 'Sin sesión: la clave de administrador (HTTP_CLAVE_ADMIN), como usuario del sistema (docs/20 §5)' })
  @ApiParam({ name: 'id', description: 'UUID de la pasarela' })
  @ApiCreatedResponse({ description: 'Credencial rotada; `conexion` trae la nueva y las plantillas de tópico' })
  @ApiNotFoundResponse({ description: 'No existe, o es de otro sitio' })
  @ApiConflictResponse({ description: 'Está dada de baja' })
  async rotar(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Res({ passthrough: true }) res: Response): Promise<CredencialPasarelaRotada> {
    exigirEnAlguno(u, 'escribir');
    const pasarelaId = uuid(id, 'pasarela');
    await this.alcance.exigirPasarela(u, 'escribir', pasarelaId);
    res.setHeader('Cache-Control', 'no-store');
    return this.alta.rotarPasarela(pasarelaId);
  }
}
