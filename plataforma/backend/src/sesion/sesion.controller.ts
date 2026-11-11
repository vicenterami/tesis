import { Body, Controller, Delete, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse, ApiBody, ApiCookieAuth, ApiForbiddenResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiQuery, ApiResponse, ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { claveOpcional } from '../arranque.js';
import { direccionDelCliente } from '../recepcion/http/direccion.js';
import { cabeceraBorrarCookie, cabeceraCookie } from './cookie.js';
import { ConClaveTemporal, Publica, Usuario, exigirPedidoDelPanel } from './guardia.js';
import type { UsuarioSesion } from './permisos.js';
import { SesionAbiertaRespuesta, SesionService } from './sesion.service.js';

// M7 · Sesión del panel (docs/20 §3 y §4): abrir, ver, cerrar y cambiar la clave. La cookie `__Host-sesion` va con `HttpOnly; Secure;
// SameSite=Lax; Path=/`; ningún script la lee. Las rutas que escriben exigen `X-Pedido: panel` (CSRF), también el inicio de sesión
// (un formulario de otro sitio no puede hacer entrar a la víctima con la cuenta de quien ataca).
@ApiTags('sesion')
@Controller('sesion')
export class SesionController {
  private readonly secretoProxy: string | undefined;
  constructor(private readonly sesiones: SesionService, config: ConfigService) {
    this.secretoProxy = claveOpcional('PROXY_SECRETO', config.get<string>('PROXY_SECRETO'));
  }

  private ip(req: Request): string {
    return direccionDelCliente(req, this.secretoProxy).direccion;
  }

  @Post()
  @Publica()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Iniciar sesión',
    description:
      'Con `email` y `clave`. Responde la cookie `__Host-sesion` (HttpOnly; Secure; SameSite=Lax; Path=/, sin Domain), con un identificador nuevo en cada inicio. ' +
      'Usuario inexistente, inactivo o clave mala: el mismo 401 «credenciales no válidas», con el mismo tiempo de respuesta. 5 fallos en 15 min ' +
      'bloquean el usuario (1, 5 y 15 min, creciente) y 50 fallos en 15 min desde una dirección la bloquean: 429 «bloqueado». Todo intento ' +
      'queda en `acceso`. Con una clave temporal, la sesión solo sirve para cambiarla (`POST /sesion/clave`).',
  })
  @ApiHeader({ name: 'X-Pedido', required: true, description: 'Siempre `panel` (protección contra peticiones de otros sitios)' })
  @ApiBody({ schema: { type: 'object', required: ['email', 'clave'], properties: { email: { type: 'string', maxLength: 254 }, clave: { type: 'string', maxLength: 128 } } } })
  @ApiOkResponse({ description: 'Sesión abierta: `usuario` (id, nombre, email, clave_temporal) y `expira_en` (vida absoluta, 8 h)' })
  @ApiBadRequestResponse({ description: 'Cuerpo sin email o clave' })
  @ApiUnauthorizedResponse({ description: 'credenciales no válidas' })
  @ApiForbiddenResponse({ description: 'Sin la cabecera X-Pedido: panel' })
  @ApiResponse({ status: 429, description: 'bloqueado: demasiados intentos fallidos (por usuario o por dirección)' })
  async iniciar(@Req() req: Request, @Body() cuerpo: unknown, @Res({ passthrough: true }) res: Response): Promise<SesionAbiertaRespuesta> {
    exigirPedidoDelPanel(req);
    const s = await this.sesiones.iniciar(cuerpo, this.ip(req), req.headers['user-agent']);
    res.setHeader('Set-Cookie', cabeceraCookie(s.identificador));
    return { usuario: s.usuario, expira_en: s.expira_en };
  }

  @Get()
  @ConClaveTemporal()
  @ApiCookieAuth('sesion')
  @ApiOperation({
    summary: 'Quién soy',
    description: 'Usuario, sus sitios con el rol en cada uno y los vencimientos de la sesión (absoluto e inactividad). Renueva la actividad: el panel la llama como mucho cada 5 min mientras la persona interactúa.',
  })
  @ApiOkResponse({ description: '`usuario`, `sitios` [{sitio_id, codigo, nombre, rol}], `clave_temporal`, `expira_en`, `inactividad_vence_en` y `permisos` (rol → acciones que puede: la tabla de permisos que decide, para la guía de perfiles del panel); con X-Clave-Admin, `sistema: true`' })
  @ApiUnauthorizedResponse({ description: 'sesión requerida' })
  quien(@Usuario() u: UsuarioSesion): Promise<Record<string, unknown>> {
    return this.sesiones.describir(u);
  }

  @Delete()
  @ConClaveTemporal()
  @HttpCode(200)
  @ApiCookieAuth('sesion')
  @ApiOperation({ summary: 'Cerrar sesión', description: 'Revoca la sesión en la base y borra la cookie; con `todas=true`, revoca todas las sesiones del usuario («cerrar en todos lados»). Deja la fila `cierre` en `acceso`.' })
  @ApiHeader({ name: 'X-Pedido', required: true, description: 'Siempre `panel`' })
  @ApiQuery({ name: 'todas', required: false, enum: ['true', 'false'], description: 'Cerrar todas las sesiones del usuario' })
  @ApiOkResponse({ description: '`revocadas`: cuántas sesiones se cerraron' })
  @ApiUnauthorizedResponse({ description: 'sesión requerida' })
  async cerrar(@Usuario() u: UsuarioSesion, @Req() req: Request, @Res({ passthrough: true }) res: Response, @Query('todas') todas?: string): Promise<{ revocadas: number }> {
    const revocadas = await this.sesiones.cerrar(u, todas === 'true', this.ip(req));
    res.setHeader('Set-Cookie', cabeceraBorrarCookie());
    return { revocadas };
  }

  @Post('clave')
  @ConClaveTemporal()
  @HttpCode(200)
  @ApiCookieAuth('sesion')
  @ApiOperation({
    summary: 'Cambiar la clave',
    description:
      'Con `actual` y `nueva`. La nueva: 12 a 128 caracteres, fuera de la lista de claves comunes, distinta del email y de la anterior. Revoca ' +
      'todas las sesiones del usuario y abre una nueva (identificador regenerado): la respuesta trae la cookie nueva. Quita la marca de clave temporal.',
  })
  @ApiHeader({ name: 'X-Pedido', required: true, description: 'Siempre `panel`' })
  @ApiBody({ schema: { type: 'object', required: ['actual', 'nueva'], properties: { actual: { type: 'string' }, nueva: { type: 'string', minLength: 12, maxLength: 128 } } } })
  @ApiOkResponse({ description: 'Clave cambiada; sesión nueva en la cookie' })
  @ApiBadRequestResponse({ description: 'La clave actual no es correcta o la nueva no cumple las reglas: `message` es la lista de motivos' })
  @ApiUnauthorizedResponse({ description: 'sesión requerida' })
  @ApiResponse({ status: 429, description: 'bloqueado: demasiados intentos fallidos' })
  async cambiarClave(@Usuario() u: UsuarioSesion, @Req() req: Request, @Body() cuerpo: unknown, @Res({ passthrough: true }) res: Response): Promise<SesionAbiertaRespuesta> {
    const s = await this.sesiones.cambiarClave(u, cuerpo, this.ip(req), req.headers['user-agent']);
    res.setHeader('Set-Cookie', cabeceraCookie(s.identificador));
    return { usuario: s.usuario, expira_en: s.expira_en };
  }
}
