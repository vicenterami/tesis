import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse,
  ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { uuid } from '../consulta/validacion';
import { Usuario } from './guardia';
import { ROLES, exigirEnAlguno } from './permisos';
import type { UsuarioSesion } from './permisos';
import { UsuarioConClave, UsuarioListado, UsuariosService } from './usuarios.service';
import { MAX_SITIOS, validarAltaUsuario, validarCambioUsuario } from './usuarios.dto';

// Usuarios (HU-18, RF-43, RF-44; docs/20 §4 y §6). Solo administradores, y solo en sus sitios: un usuario o un sitio de otro sitio
// responde 404, como uno que no existe (RF-41). Con sesión, toda ruta que escribe exige `X-Pedido: panel` (el guardia central).
@ApiTags('usuarios')
@ApiCookieAuth('sesion')
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  @ApiOperation({ summary: 'Listar usuarios', description: 'Quienes están o estuvieron en alguno de los sitios que administra quien pregunta; de sus sitios, solo esos. Exige rol administrador en algún sitio.' })
  @ApiOkResponse({ description: 'Lista: id, nombre, email, en_mis_sitios (false = ya no está en ninguno de tus sitios, pero estuvo), activo, clave_temporal, clave_temporal_vence_en, sitios [{sitio_id, codigo, rol}], creado_en y actualizado_en (con microsegundos, para el PATCH)' })
  @ApiUnauthorizedResponse({ description: 'sesión requerida' })
  @ApiForbiddenResponse({ description: 'Sin rol administrador en ningún sitio, o la clave de administrador cuando ya existe un administrador' })
  listar(@Usuario() u: UsuarioSesion): Promise<UsuarioListado[]> {
    return this.usuarios.listar(u);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Dar de alta un usuario',
    description:
      'Crea el usuario con una clave TEMPORAL (24 caracteres aleatorios, vence a las 24 h) que se devuelve UNA sola vez en `clave`; al entrar, ' +
      'la sesión solo sirve para cambiarla. Sin registro abierto: exige sesión de administrador en cada sitio que se asigna. Con la ' +
      'cabecera X-Clave-Admin solo mientras no exista ningún administrador (el primero; después, 403).',
  })
  @ApiHeader({ name: 'X-Pedido', required: false, description: 'Con sesión, siempre `panel`' })
  @ApiBody({
    schema: {
      type: 'object', required: ['nombre', 'email', 'sitios'],
      properties: {
        nombre: { type: 'string', maxLength: 80 },
        email: { type: 'string', maxLength: 254, description: 'Nombre de inicio de sesión; se guarda en minúsculas' },
        sitios: { type: 'array', minItems: 1, maxItems: MAX_SITIOS, items: { type: 'object', required: ['sitio_id', 'rol'], properties: { sitio_id: { type: 'string', format: 'uuid' }, rol: { type: 'string', enum: [...ROLES] } } } },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Usuario creado; `clave` trae la clave temporal (una sola vez)' })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido: `message` es la lista de motivos' })
  @ApiUnauthorizedResponse({ description: 'sesión requerida' })
  @ApiForbiddenResponse({ description: 'Rol de consulta, o la clave de administrador cuando ya existe un administrador' })
  @ApiNotFoundResponse({ description: 'Un sitio que no existe o que no administras' })
  @ApiConflictResponse({ description: 'Ya existe un usuario con ese email' })
  async crear(@Usuario() u: UsuarioSesion, @Body() cuerpo: unknown): Promise<UsuarioConClave> {
    exigirEnAlguno(u, 'usuarios'); // antes de validar: un usuario de consulta no aprende la forma del cuerpo
    const a = validarAltaUsuario(cuerpo);
    return this.usuarios.crear(u, a); // la respuesta lleva una clave: Cache-Control: no-store, como toda la API (main.ts)
  }

  @Patch(':id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cambiar un usuario: activar, desactivar, clave temporal y roles por sitio',
    description:
      '`actualizado_en` (obligatorio) es el que entregó `GET /usuarios`, tal cual: si cambió desde entonces, 409 (bloqueo optimista). `activo` ' +
      'false desactiva (no borra) y corta sus sesiones; `clave_temporal: true` asigna una temporal nueva («olvidé mi clave»), la devuelve UNA vez ' +
      'en `clave` y corta sus sesiones; `sitios` asigna o cambia el rol en cada sitio, y `rol: null` le quita ese sitio. Ningún cambio puede ' +
      'dejar la plataforma sin administradores activos (409). Los roles, solo en tus sitios; los campos de la cuenta (`nombre`, `activo`, ' +
      '`clave_temporal`), solo si administras TODOS los sitios activos de la persona (si no, 403). Deja un `evento` usuario_cambio con quién.',
  })
  @ApiParam({ name: 'id', description: 'UUID del usuario' })
  @ApiHeader({ name: 'X-Pedido', required: false, description: 'Con sesión, siempre `panel`' })
  @ApiBody({
    schema: {
      type: 'object', required: ['actualizado_en'],
      properties: {
        actualizado_en: { type: 'string' }, nombre: { type: 'string', maxLength: 80 }, activo: { type: 'boolean' }, clave_temporal: { type: 'boolean', enum: [true] },
        sitios: { type: 'array', items: { type: 'object', required: ['sitio_id', 'rol'], properties: { sitio_id: { type: 'string', format: 'uuid' }, rol: { type: 'string', enum: [...ROLES], nullable: true } } } },
      },
    },
  })
  @ApiOkResponse({ description: 'El usuario como lo lista GET /usuarios (y `clave`, si se asignó una temporal)' })
  @ApiBadRequestResponse({ description: 'UUID o cuerpo inválidos' })
  @ApiUnauthorizedResponse({ description: 'sesión requerida' })
  @ApiForbiddenResponse({ description: 'Rol de consulta; la clave de administrador cuando ya existe un administrador; un campo de la cuenta de alguien que también está en sitios que no administras, o que ya no está en ninguno de los tuyos' })
  @ApiNotFoundResponse({ description: 'El usuario o un sitio no existen, o no son de tus sitios' })
  @ApiConflictResponse({ description: 'Cambió desde que se leyó (recarga), te desactivarías a ti mismo o quedaría sin administradores' })
  async actualizar(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Body() cuerpo: unknown): Promise<UsuarioListado | UsuarioConClave> {
    exigirEnAlguno(u, 'usuarios');
    const usuarioId = uuid(id, 'usuario');
    const cambio = validarCambioUsuario(cuerpo);
    return this.usuarios.actualizar(u, usuarioId, cambio);
  }
}
