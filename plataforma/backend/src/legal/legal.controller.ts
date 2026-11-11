import { BadRequestException, Body, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse, ApiBody, ApiCookieAuth, ApiForbiddenResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiQuery, ApiResponse, ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import { POOL } from '../db/db.module.js';
import { errorDeCliente } from '../db/cliente.js';
import { registrarEvento } from '../db/evento.js';
import { isoUs } from '../db/iso-us.js';
import { CABECERA_X_SIGUIENTE, limite } from '../consulta/validacion.js';
import { leerCursor, siguiente } from '../consulta/tablero.js';
import { exigirPersona } from '../cuenta/cuenta.service.js';
import { ConTerminosPendientes, Publica, Usuario } from '../sesion/guardia.js';
import { exigirGlobal } from '../sesion/permisos.js';
import type { UsuarioSesion } from '../sesion/permisos.js';
import { acerca, acercaSegunSesion, commitDeEntorno, urlCodigoFuente } from './acerca.js';
import { leerCookie } from '../sesion/cookie.js';
import { SesionService } from '../sesion/sesion.service.js';
import type { Acerca } from './acerca.js';
import { privacidad, responsableDeEntorno } from './privacidad.js';
import type { Privacidad } from './privacidad.js';
import { MAX_TEXTO_SOPORTE, TasaSoporte, textoDeSoporte } from './soporte.js';
import { TERMINOS_VERSION, terminos } from './terminos.js';
import type { Terminos } from './terminos.js';

// Legal y acerca de (docs/19 §4, P11; docs/21 §7; docs/20 §12; RF-53, RF-54, RF-61; HU-27, HU-31). Las tres páginas son públicas: se leen
// también antes de entrar (P11: «al pie de toda pantalla, también antes de entrar») y con la sesión restringida por los términos.
// Aceptar exige sesión (y vale con los términos pendientes, para eso existe); el soporte, sesión sin restricciones.
@ApiTags('legal')
@Controller()
export class LegalController {
  private readonly tasa = new TasaSoporte();
  private readonly responsable: ReturnType<typeof responsableDeEntorno>;
  private readonly commit: string | null;
  private readonly codigoFuente: string | null;

  constructor(@Inject(POOL) private readonly pool: Pool, config: ConfigService, private readonly sesiones: SesionService) {
    this.responsable = responsableDeEntorno(config.get<string>('RESPONSABLE_NOMBRE'), config.get<string>('RESPONSABLE_CONTACTO'));
    this.commit = commitDeEntorno(config.get<string>('COMPILACION_COMMIT'));
    this.codigoFuente = urlCodigoFuente(config.get<string>('CODIGO_FUENTE_URL'));
  }

  @Get('terminos')
  @Publica()
  @ApiOperation({ summary: 'Términos de uso (Etapa 4)', description: 'Texto (Markdown simple), versión vigente y fecha. Pública: se lee antes de entrar y con la sesión restringida.' })
  @ApiOkResponse({ description: '`version`, `fecha`, `texto`' })
  leerTerminos(): Terminos {
    return terminos();
  }

  @Post('terminos/aceptar')
  @ConTerminosPendientes()
  @HttpCode(200)
  @ApiCookieAuth('sesion')
  @ApiOperation({
    summary: 'Aceptar los términos de uso (Etapa 4)',
    description: 'Con `version` (la vigente, la que se mostró): guarda versión e instante en la cuenta y deja un evento `terminos_aceptados`. Desde entonces la sesión deja de estar restringida. Una versión distinta de la vigente → 409 (se mostró un texto viejo: recargar).',
  })
  @ApiHeader({ name: 'X-Pedido', required: true, description: 'Siempre `panel`' })
  @ApiBody({ schema: { type: 'object', required: ['version'], properties: { version: { type: 'integer', minimum: 1 } } } })
  @ApiOkResponse({ description: '`version`, `aceptados_en`' })
  @ApiBadRequestResponse({ description: 'Sin `version`, o la clave de administrador (no es una cuenta)' })
  @ApiUnauthorizedResponse({ description: 'sesión requerida' })
  @ApiResponse({ status: 409, description: 'La versión no es la vigente' })
  async aceptar(@Usuario() u: UsuarioSesion, @Body() cuerpo: unknown): Promise<{ version: number; aceptados_en: string }> {
    const id = exigirPersona(u);
    const v = typeof cuerpo === 'object' && cuerpo !== null ? (cuerpo as Record<string, unknown>).version : undefined;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new BadRequestException(['version es obligatoria: la de GET /terminos']);
    if (v !== TERMINOS_VERSION) {
      throw new HttpException({ statusCode: 409, error: 'Conflict', version: TERMINOS_VERSION, message: `la versión vigente es ${TERMINOS_VERSION}: recarga los términos` }, HttpStatus.CONFLICT);
    }
    const c = await this.pool.connect();
    c.on('error', errorDeCliente);
    try {
      await c.query('BEGIN');
      const r = await c.query<{ aceptados_en: string }>(
        `UPDATE usuario SET terminos_version_aceptada = $2, terminos_aceptados_en = now() WHERE id = $1 RETURNING iso_utc(terminos_aceptados_en) AS aceptados_en`,
        [id, v]);
      await registrarEvento(c, { dispositivoId: null, tipo: 'terminos_aceptados', detalle: { usuario_id: id, version: v }, usuarioId: id });
      await c.query('COMMIT');
      return { version: v, aceptados_en: r.rows[0].aceptados_en };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.off('error', errorDeCliente);
      c.release();
    }
  }

  @Get('privacidad')
  @Publica()
  @ApiOperation({
    summary: 'Política de privacidad (Etapa 4)',
    description: 'Generada desde el inventario de docs/21 §2 (`datos`: dato, dónde, para qué, cuánto tiempo y quién accede) y los apartados de terceros, cookies, permisos y derechos (`secciones`); el responsable y su contacto, de RESPONSABLE_NOMBRE y RESPONSABLE_CONTACTO (null y `aviso_responsable` si no están configurados). Pública.',
  })
  @ApiOkResponse({ description: '`version`, `fecha`, `responsable`, `aviso_responsable`, `datos[]`, `secciones[{titulo, parrafos}]`' })
  leerPrivacidad(): Privacidad {
    return privacidad(this.responsable);
  }

  @Get('acerca')
  @Publica()
  @ApiOperation({ summary: 'Acerca de (Etapa 4)', description: 'Licencia AGPL-3.0-only con su aviso, enlace al código fuente (CODIGO_FUENTE_URL, o null) y la ruta de los avisos de terceros: pública. La versión del backend y el commit de la compilación, solo con sesión (sin ella, null).' })
  @ApiOkResponse({ description: '`nombre`, `version` (null sin sesión), `commit` (null sin sesión o si la imagen no lo trae), `licencia`, `aviso_licencia`, `codigo_fuente`, `avisos_terceros`' })
  async leerAcerca(@Req() req: Request): Promise<Acerca> {
    // Ruta pública: el guardia no resuelve la sesión. Se mira aquí, sin exigirla (una cookie que no vale es lo mismo que no traerla).
    const id = leerCookie(req.headers.cookie);
    const conSesion = id !== null && (await this.sesiones.cargar(id).catch(() => null)) !== null;
    return acercaSegunSesion(acerca(this.commit, this.codigoFuente), conSesion);
  }

  @Post('soporte')
  @HttpCode(201)
  @ApiCookieAuth('sesion')
  @ApiOperation({
    summary: 'Enviar un mensaje de soporte (Etapa 4)',
    description: `Texto de 1 a ${MAX_TEXTO_SOPORTE} caracteres, sin adjuntos; se guarda para el administrador del sistema. Como mucho 5 por persona y hora (429 con \`reintentar_en_s\`).`,
  })
  @ApiHeader({ name: 'X-Pedido', required: true, description: 'Siempre `panel`' })
  @ApiBody({ schema: { type: 'object', required: ['texto'], properties: { texto: { type: 'string', maxLength: MAX_TEXTO_SOPORTE } } } })
  @ApiOkResponse({ description: '`id`, `creado_en`' })
  @ApiBadRequestResponse({ description: 'Texto vacío o demasiado largo, o la clave de administrador (no es una cuenta)' })
  @ApiUnauthorizedResponse({ description: 'sesión requerida' })
  @ApiForbiddenResponse({ description: 'Clave temporal o términos pendientes' })
  @ApiResponse({ status: 429, description: 'Demasiados mensajes en la última hora' })
  async enviar(@Usuario() u: UsuarioSesion, @Body() cuerpo: unknown): Promise<{ id: string; creado_en: string }> {
    const id = exigirPersona(u);
    const t = textoDeSoporte(cuerpo);
    if ('motivos' in t) throw new BadRequestException(t.motivos);
    // El cupo se reserva ANTES del INSERT, sin un await entre comprobar y anotar: una ráfaga simultánea no pasa entera.
    const espera = this.tasa.intentar(id);
    if (espera > 0) {
      const s = Math.ceil(espera / 1000);
      throw new HttpException({ statusCode: 429, message: `demasiados mensajes de soporte; reintenta en ${s} s`, reintentar_en_s: s }, HttpStatus.TOO_MANY_REQUESTS);
    }
    try {
      const r = await this.pool.query<{ id: string; creado_en: string }>(
        'INSERT INTO mensaje_soporte (usuario_id, texto) VALUES ($1, $2) RETURNING id, iso_utc(creado_en) AS creado_en', [id, t.texto]);
      return r.rows[0];
    } catch (e) {
      this.tasa.devolver(id); // no se guardó nada: el cupo vuelve
      throw e;
    }
  }

  @Get('soporte')
  @ApiCookieAuth('sesion')
  @ApiOperation({
    summary: 'Mensajes de soporte (Etapa 4; administrador del sistema)',
    description: 'Del más reciente al más antiguo: `id, creado_en, leido_en, texto, usuario{id, nombre}`. Página por clave: la cabecera `X-Siguiente` trae el cursor de la siguiente. Solo el administrador del sistema (403 a los demás perfiles).',
  })
  @ApiQuery({ name: 'limite', required: false, description: '1–500, por defecto 50' })
  @ApiQuery({ name: 'cursor', required: false, description: 'El de la cabecera X-Siguiente de la página anterior' })
  @ApiOkResponse({ description: 'Lista de mensajes; X-Siguiente si hay otra página', headers: { ...CABECERA_X_SIGUIENTE } })
  @ApiUnauthorizedResponse({ description: 'sesión requerida' })
  @ApiForbiddenResponse({ description: 'No eres administrador del sistema' })
  async listar(@Usuario() u: UsuarioSesion, @Res({ passthrough: true }) res: Response, @Query('limite') lim?: string, @Query('cursor') cursor?: string) {
    exigirGlobal(u, 'sistema');
    const l = limite(lim);
    const c = leerCursor(cursor);
    const r = await this.pool.query<{ id: string; creado_en: string; leido_en: string | null; texto: string; usuario: { id: string; nombre: string } }>(
      `SELECT m.id, ${isoUs('m.creado_en')} AS creado_en, iso_utc(m.leido_en) AS leido_en, m.texto, json_build_object('id', u.id, 'nombre', u.nombre) AS usuario
         FROM mensaje_soporte m JOIN usuario u ON u.id = m.usuario_id
        WHERE ($1::timestamptz IS NULL OR (m.creado_en, m.id) < ($1::timestamptz, $2::uuid))
        ORDER BY m.creado_en DESC, m.id DESC LIMIT $3`, [c?.t ?? null, c?.id ?? null, l]);
    const sig = siguiente(r.rows, l, (f) => ({ t: f.creado_en, id: f.id }));
    if (sig !== null) res.setHeader('X-Siguiente', sig);
    return r.rows;
  }
}
