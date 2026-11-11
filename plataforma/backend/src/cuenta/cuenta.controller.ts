import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCookieAuth, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse,
  ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { claveOpcional } from '../arranque.js';
import { direccionDelCliente } from '../recepcion/http/direccion.js';
import { cabeceraBorrarCookie } from '../sesion/cookie.js';
import { Usuario } from '../sesion/guardia.js';
import type { UsuarioSesion } from '../sesion/permisos.js';
import { CuentaService, SesionPropia } from './cuenta.service.js';
import { PANTALLAS_VISTA, PreferenciasLeidas, TEMAS, TIPOS_CONDICION, UNIDADES_LONGITUD, UNIDADES_TEMPERATURA, validarPreferencias } from './preferencias.js';

const ID_SESION = /^[0-9a-f]{64}$/;
const ESQUEMA_PREFERENCIAS = {
  type: 'object',
  required: ['actualizado_en', 'unidad_temperatura', 'unidad_longitud', 'zona_horaria', 'tema', 'notificar', 'vistas', 'sitio_predeterminado'],
  properties: {
    actualizado_en: { type: 'string', nullable: true, description: 'El de GET /preferencias, tal cual (null si aún no había ninguna guardada)' },
    unidad_temperatura: { type: 'string', enum: [...UNIDADES_TEMPERATURA] },
    unidad_longitud: { type: 'string', enum: [...UNIDADES_LONGITUD] },
    zona_horaria: { type: 'string', description: '«sitio» (la del sitio) o una zona IANA (p. ej. America/Santiago)' },
    tema: { type: 'string', enum: [...TEMAS] },
    notificar: { type: 'array', items: { type: 'string', enum: [...TIPOS_CONDICION] } },
    vistas: {
      type: 'array', maxItems: 20,
      items: { type: 'object', required: ['nombre', 'pantalla', 'parametros'], properties: { nombre: { type: 'string', maxLength: 60 }, pantalla: { type: 'string', enum: [...PANTALLAS_VISTA] }, parametros: { type: 'object', additionalProperties: { type: 'string', maxLength: 200 } } } },
    },
    sitio_predeterminado: { type: 'string', format: 'uuid', nullable: true },
  },
} as const;

// Lo propio de cada persona (Etapa 4; docs/20 §6, última fila; docs/19 §4, H y P13; docs/21 §8). Con sesión de una persona y para todos
// los perfiles; la clave de administrador por cabecera no es una cuenta (400). Las rutas que escriben exigen `X-Pedido: panel` (guardia).
@ApiTags('cuenta')
@ApiCookieAuth('sesion')
@ApiUnauthorizedResponse({ description: 'sesión requerida' })
@ApiForbiddenResponse({ description: 'Clave temporal o términos de uso pendientes (403 `terminos_pendientes`), o sin la cabecera X-Pedido: panel en una ruta que escribe' })
@Controller()
export class CuentaController {
  private readonly secretoProxy: string | undefined;
  constructor(private readonly cuenta: CuentaService, config: ConfigService) {
    this.secretoProxy = claveOpcional('PROXY_SECRETO', config.get<string>('PROXY_SECRETO'));
  }

  private ip(req: Request): string {
    return direccionDelCliente(req, this.secretoProxy).direccion;
  }

  @Get('preferencias')
  @ApiOperation({
    summary: 'Mis preferencias (Etapa 4)',
    description: 'Unidades de visualización, zona horaria, tema, tipos de condición con notificación, vistas guardadas y sitio por defecto. Si aún no guardaste ninguna, las de por defecto con `actualizado_en: null`. La base guarda siempre la unidad estándar: esto solo cambia cómo se muestra.',
  })
  @ApiOkResponse({ description: '`unidad_temperatura, unidad_longitud, zona_horaria, tema, notificar, vistas, sitio_predeterminado, actualizado_en`' })
  leer(@Usuario() u: UsuarioSesion): Promise<PreferenciasLeidas> {
    return this.cuenta.preferencias(u);
  }

  @Put('preferencias')
  @ApiOperation({
    summary: 'Guardar mis preferencias (Etapa 4)',
    description: 'Reemplaza todas (PUT). Bloqueo optimista: `actualizado_en` es el de GET /preferencias, tal cual (null la primera vez); si cambiaron entretanto, 409 con las vigentes. La zona IANA se valida contra la lista del servidor; `sitio_predeterminado` debe ser uno de tus sitios.',
  })
  @ApiHeader({ name: 'X-Pedido', required: true, description: 'Siempre `panel`' })
  @ApiBody({ schema: ESQUEMA_PREFERENCIAS as unknown as Record<string, unknown> })
  @ApiOkResponse({ description: 'Las preferencias guardadas, con el `actualizado_en` nuevo' })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido: `message` es la lista de motivos' })
  @ApiConflictResponse({ description: 'Cambiaron desde que se leyeron: `preferencias` trae las vigentes' })
  guardar(@Usuario() u: UsuarioSesion, @Body() cuerpo: unknown): Promise<PreferenciasLeidas> {
    return this.cuenta.guardarPreferencias(u, validarPreferencias(cuerpo));
  }

  @Get('sesiones')
  @ApiOperation({
    summary: 'Mis sesiones abiertas (Etapa 4)',
    description: '`id` (el hash que guarda la base: no autentica nada), `creada_en`, `ultima_actividad`, `agente` (navegador, hasta 120 caracteres), `origen` (dirección truncada a /24 o /48) y `actual` (la de esta petición). Solo las vivas, de la más reciente a la más antigua.',
  })
  @ApiOkResponse({ description: 'Lista de sesiones vivas' })
  sesiones(@Usuario() u: UsuarioSesion): Promise<SesionPropia[]> {
    return this.cuenta.sesionesPropias(u);
  }

  @Delete('sesiones/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cerrar una de mis sesiones (Etapa 4)', description: 'Revoca esa sesión (si es la actual, también borra la cookie) y deja la fila `cierre` en `acceso`. La de otra persona, o una que no existe o ya se cerró: 404.' })
  @ApiParam({ name: 'id', description: 'El `id` de GET /sesiones (64 caracteres hexadecimales)' })
  @ApiHeader({ name: 'X-Pedido', required: true, description: 'Siempre `panel`' })
  @ApiOkResponse({ description: '`revocada: true`, `actual`' })
  @ApiNotFoundResponse({ description: 'sesión no encontrada' })
  async cerrar(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!ID_SESION.test(id)) throw new BadRequestException(['id debe ser el de GET /sesiones (64 caracteres hexadecimales)']);
    const r = await this.cuenta.cerrarSesionPropia(u, id, this.ip(req));
    if (r.actual) res.setHeader('Set-Cookie', cabeceraBorrarCookie());
    return r;
  }

  @Get('cuenta/exportar')
  @ApiOperation({
    summary: 'Exportar los datos de mi cuenta (Etapa 4)',
    description: 'Un JSON con lo que el sistema guarda de ti (docs/21 §8): cuenta, sitios y perfiles, preferencias, sesiones e intentos de acceso (con su dirección y navegador: son tus datos), cambios que hiciste y tus mensajes de soporte. Se descarga como archivo (`Content-Disposition: attachment`).',
  })
  @ApiProduces('application/json')
  @ApiOkResponse({ description: 'Los datos de la cuenta' })
  async exportar(@Usuario() u: UsuarioSesion, @Res({ passthrough: true }) res: Response): Promise<Record<string, unknown>> {
    const datos = await this.cuenta.exportar(u);
    res.setHeader('Content-Disposition', `attachment; filename="mi-cuenta-${new Date().toISOString().slice(0, 10)}.json"`);
    return datos;
  }

  @Post('cuenta/baja')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Darme de baja (Etapa 4; anonimización)',
    description:
      'Con la clave actual (`clave`): una sesión olvidada abierta no basta. Irreversible: nombre y correo pasan a marcadores derivados del id, la clave deja de valer, ' +
      'se revocan todas tus sesiones, tus sitios quedan inactivos y se borran tus preferencias y mensajes de soporte; lo que hiciste queda en el historial del sitio sin tus ' +
      'datos (docs/20 §11). El último administrador del sistema, o quien dejaría la plataforma sin administradores, recibe 409. Borra la cookie.',
  })
  @ApiHeader({ name: 'X-Pedido', required: true, description: 'Siempre `panel`' })
  @ApiBody({ schema: { type: 'object', required: ['clave'], properties: { clave: { type: 'string', description: 'Tu clave actual' } } } })
  @ApiOkResponse({ description: '`anonimizado_en`' })
  @ApiBadRequestResponse({ description: 'Sin la clave, o la clave actual no es correcta' })
  @ApiConflictResponse({ description: 'Eres el último administrador del sistema, o tu baja dejaría la plataforma sin administradores' })
  @ApiResponse({ status: 429, description: 'bloqueado: demasiados intentos fallidos' })
  async baja(@Usuario() u: UsuarioSesion, @Body() cuerpo: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.cuenta.darseDeBaja(u, cuerpo, this.ip(req));
    res.setHeader('Set-Cookie', cabeceraBorrarCookie());
    return r;
  }
}
