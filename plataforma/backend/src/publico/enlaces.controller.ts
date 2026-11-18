import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse,
  ApiOperation, ApiParam, ApiQuery, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { uuid } from '../consulta/validacion.js';
import { AlcanceService } from '../sesion/alcance.service.js';
import { Usuario } from '../sesion/guardia.js';
import { exigirEnAlguno } from '../sesion/permisos.js';
import type { UsuarioSesion } from '../sesion/permisos.js';
import { EnlaceCreado, EnlaceListado, EnlaceRenovado, EnlacesService, MinimoSitio, TopeEnlaces, VistaPrevia } from './enlaces.service.js';
import {
  MAX_DESCRIPCION, MAX_MAGNITUDES, MAX_TITULO, MAX_ZONAS, PLAZOS_DIAS, PLAZO_POR_OMISION, PUBLICO, RENOVAR_HASTA_EDAD_DIAS, RENOVAR_VENCIDO_HASTA_DIAS,
  K_MAXIMO, RETENCION_TEXTO, SIN_MAGNITUDES, validarCambioDeMinimo, validarTope, VENCE_PRONTO_DIAS, VENTANAS_PUBLICAS, validarRenovacion, validarVista,
} from './publico.js';
import { VistaPublicaService } from './vista-publica.service.js';
import { ESQUEMA_VISTA } from './publico.controller.js';

const PROPIEDADES_VISTA = {
  titulo: { type: 'string', maxLength: MAX_TITULO, description: 'Público: lo verá cualquiera con el enlace (sin nombres de personas ni datos personales)' },
  descripcion: { type: 'string', maxLength: MAX_DESCRIPCION, nullable: true, description: 'Pública, con el mismo aviso; vacía o null = sin descripción' },
  magnitudes: { type: 'array', minItems: 1, maxItems: MAX_MAGNITUDES, items: { type: 'string' }, description: `Códigos del catálogo (GET /magnitudes), en el orden en que se muestran. Vacía: 400 «${SIN_MAGNITUDES}»` },
  ventana_maxima: { type: 'string', enum: [...VENTANAS_PUBLICAS], description: 'La ventana más larga que podrá pedir quien visita' },
  zonas: { type: 'array', maxItems: MAX_ZONAS, items: { type: 'string', format: 'uuid' }, description: 'Desglose por zona: las zonas del sitio que se publican, con el nombre que tienen hoy (queda fijado). Vacía o ausente = sin desglose' },
  retencion_dias: { type: 'integer', minimum: RETENCION_TEXTO.minimo, maximum: RETENCION_TEXTO.maximo, description: `Días que se conservan título, descripción y nombres de zona después de que el enlace deja de valer (por omisión ${RETENCION_TEXTO.porDefecto}); después se anonimizan` },
  plazo_dias: { type: 'integer', enum: [...PLAZOS_DIAS], description: `Vence en hoy + plazo (por omisión ${PLAZO_POR_OMISION}); solo los plazos que no pasan PUBLICO_VENCIMIENTO_MAX_DIAS` },
};

// Lo que un visitante podría deducir de lo publicado, en palabras (decidido el 17/11/2026): la pantalla los muestra antes de publicar.
const AVISOS = { type: 'array', items: { type: 'string' }, description: 'Avisos para quien publica, por magnitud (con más de una con datos, cada aviso empieza por su nombre): k bajo, una zona de un equipo, lo deducible por resta, lo que saldrá sin valor' };

const DESCRIPCION_ENLACE =
  '`id, titulo, descripcion, magnitudes[{codigo, nombre, unidad}], ventana_maxima, zonas[{id, nombre}]` (el nombre publicado), ' +
  '`creado_por{id, nombre}|null, creado_en, expira_en, renovado_en, revocado_en, revocado_por{id, nombre}|null`, `accesos_7d` (cargas de la pantalla ' +
  `de los últimos 7 días del sitio), \`estado\` (vigente, vence_pronto —${VENCE_PRONTO_DIAS} días o menos—, vencido, revocado), \`renovable\`, ` +
  '`retencion_dias` y `anonimizado_en` (cuándo se anonimizó su texto, o null). Nunca el token.';

// Administrar los enlaces públicos de un sitio y su vista previa (docs/19 §4, O, puntos 3, 4 y 10; docs/20 §6, la fila «Administrar los
// enlaces públicos»): sesión y la acción `enlaces` en ese sitio (administrador de sitio o del sistema). Orden de los códigos, como en las
// demás rutas que escriben (docs/20 §10): sin sesión 401 (la guardia); sin la acción en ningún sitio, 403 antes de mirar el cuerpo; el
// cuerpo, 400; el sitio: 404 si no existe o es de otro, 403 si es suyo y su perfil no puede. Con sesión, lo que escribe exige `X-Pedido: panel`.
@ApiTags('enlaces')
@ApiCookieAuth('sesion')
@ApiUnauthorizedResponse({ description: 'sesión requerida' })
@ApiForbiddenResponse({ description: 'Un perfil sin la acción «enlaces» (docs/20 §6), o sesión sin la cabecera X-Pedido: panel en lo que escribe' })
@ApiNotFoundResponse({ description: 'Sitio (o enlace) inexistente o de otro sitio' })
@Controller('sitios/:id/enlaces')
export class EnlacesController {
  constructor(private readonly enlaces: EnlacesService, private readonly vista: VistaPublicaService, private readonly alcance: AlcanceService) {}

  @Get()
  @ApiOperation({
    summary: 'Enlaces públicos del sitio (P9)',
    description: `Del más reciente al más antiguo. Por omisión, solo los vivos (no revocados, vigentes o aún renovables); con \`incluir=todos\`, también los revocados y los que ya no se pueden renovar (sus filas no se borran: su texto se anonimiza a su plazo). Cada uno: ${DESCRIPCION_ENLACE}`,
  })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiQuery({ name: 'incluir', required: false, enum: ['todos'], description: '`todos`: también los enlaces muertos' })
  @ApiOkResponse({ description: 'Lista de enlaces del sitio' })
  @ApiBadRequestResponse({ description: 'UUID inválido o `incluir` distinto de `todos`' })
  async listar(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Query('incluir') incluir?: unknown): Promise<EnlaceListado[]> {
    if (incluir !== undefined && incluir !== 'todos') throw new BadRequestException('incluir solo admite «todos»');
    const sitioId = uuid(id, 'sitio');
    await this.alcance.exigirSitio(u, 'enlaces', sitioId);
    return this.enlaces.listar(sitioId, incluir === 'todos');
  }

  @Get('tope')
  @ApiOperation({ summary: 'Tope de enlaces vivos del sitio (P9)', description: 'El tope que rige (`max_enlaces`), si lo fijó el administrador (`fijado`), el valor por omisión del despliegue (`por_omision`), el techo (`techo`) y cuántos enlaces vivos hay (`vivos`).' })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiOkResponse({ description: 'El tope de enlaces del sitio' })
  async leerTope(@Usuario() u: UsuarioSesion, @Param('id') id: string): Promise<TopeEnlaces> {
    const sitioId = uuid(id, 'sitio');
    await this.alcance.exigirSitio(u, 'enlaces', sitioId);
    return this.enlaces.tope(sitioId);
  }

  @Get('minimo')
  @ApiOperation({
    summary: 'Mínimo de dispositivos (k) de la vista pública del sitio (P9)',
    description: 'k es del sitio: todos sus enlaces ocultan lo mismo (docs/19 §4, O, punto 2). `minimo_dispositivos` (el que rige, nunca bajo el piso), `fijado` (si lo fijó el administrador), `por_omision`, `piso` y `maximo`.',
  })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiOkResponse({ description: 'El k del sitio' })
  async leerMinimo(@Usuario() u: UsuarioSesion, @Param('id') id: string): Promise<MinimoSitio> {
    const sitioId = uuid(id, 'sitio');
    await this.alcance.exigirSitio(u, 'enlaces', sitioId);
    return this.enlaces.minimo(sitioId);
  }

  @Put('minimo')
  @ApiOperation({
    summary: 'Fijar el mínimo de dispositivos (k) de la vista pública del sitio (P9)',
    description:
      `De PUBLICO_MINIMO_DISPOSITIVOS_PISO a ${K_MAXIMO}. Rige en la petición siguiente de TODOS los enlaces del sitio. Responde el k nuevo y \`avisos\`: «afecta a ` +
      'todos los enlaces públicos de este sitio» y lo que un visitante podría deducir con ese k (con 1, la lectura de un equipo solo sale tal cual). Deja el evento `enlace_minimo`. ' +
      'Con `anterior` (el k que se leyó), si ya no es el que rige: 409 `codigo: minimo_cambio` con `minimo_dispositivos` (el que rige), sin cambiar nada.',
  })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiBody({ schema: { type: 'object', required: ['minimo_dispositivos'], properties: { minimo_dispositivos: { type: 'integer', minimum: 1, maximum: K_MAXIMO, description: 'Desde el piso del despliegue' }, anterior: { type: 'integer', minimum: 1, maximum: K_MAXIMO, description: 'El k que rige y que se leyó (GET …/minimo): si cambió entretanto, 409 (bloqueo optimista)' } } } })
  @ApiOkResponse({ description: 'El k nuevo con sus avisos' })
  @ApiBadRequestResponse({ description: 'Fuera del piso a 20, `anterior` fuera de 1 a 20, o un campo de más' })
  @ApiConflictResponse({ description: '`codigo: minimo_cambio`: el k cambió desde que se leyó (`anterior`); trae el que rige en `minimo_dispositivos`' })
  async fijarMinimo(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Body() cuerpo: unknown): Promise<MinimoSitio & { avisos: string[] }> {
    exigirEnAlguno(u, 'enlaces');
    const { k, anterior } = validarCambioDeMinimo(cuerpo, this.vista.limites);
    const sitioId = uuid(id, 'sitio');
    await this.alcance.exigirSitio(u, 'enlaces', sitioId);
    return this.enlaces.fijarMinimo(sitioId, k, u.id, anterior);
  }

  @Put('tope')
  @ApiOperation({
    summary: 'Fijar el tope de enlaces vivos del sitio (P9)',
    description: 'Lo fija el administrador del sitio, de 1 al techo del despliegue (PUBLICO_MAX_ENLACES_TECHO, 200 por omisión). Bajarlo no revoca nada: impide crear otro hasta que haya lugar. Deja el evento `enlace_tope`.',
  })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiBody({ schema: { type: 'object', required: ['max_enlaces'], properties: { max_enlaces: { type: 'integer', minimum: 1, description: 'Hasta el techo del despliegue' } } } })
  @ApiOkResponse({ description: 'El tope nuevo' })
  @ApiBadRequestResponse({ description: 'Fuera de 1 al techo, o un campo de más' })
  async fijarTope(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Body() cuerpo: unknown): Promise<TopeEnlaces> {
    exigirEnAlguno(u, 'enlaces');
    const max = validarTope(cuerpo, this.vista.limites);
    const sitioId = uuid(id, 'sitio');
    await this.alcance.exigirSitio(u, 'enlaces', sitioId);
    return this.enlaces.fijarTope(sitioId, max, u.id);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Publicar una vista: crear un enlace (P9)',
    description:
      `Crea el enlace y devuelve, UNA sola vez, \`token\` y \`direccion\` (\`/panel/#/v/<token>\`: el token va en el fragmento). La base guarda solo su resumen SHA-256. ${DESCRIPCION_ENLACE} ` +
      'Un sitio admite hasta su tope de enlaces vivos (GET /sitios/{id}/enlaces/tope; 50 por omisión): el siguiente, 409 `codigo: tope_enlaces` con ese número en el texto. Deja el evento `enlace_creado` ' +
      'con el k del sitio que rige (el enlace no lleva k: es del sitio, PUT /sitios/{id}/enlaces/minimo) y cuántos avisos se mostraron. `avisos`: lo que ' +
      'un visitante podría deducir, por magnitud (la protección por omisión es de la plataforma; bajarla, del administrador del sitio).',
  })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiBody({ schema: { type: 'object', required: ['titulo', 'magnitudes', 'ventana_maxima'], properties: PROPIEDADES_VISTA } })
  @ApiCreatedResponse({ description: 'Enlace creado: el token y la dirección, una sola vez, y `avisos` (lo que un visitante podría deducir de lo publicado)' })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido: sin magnitudes, una magnitud fuera del catálogo, una zona que no es del sitio, un plazo fuera de lo permitido, un campo de más (también `minimo_dispositivos`: k es del sitio)' })
  @ApiConflictResponse({ description: '`codigo: tope_enlaces`: «Este sitio ya tiene N enlaces. Revoca uno para crear otro.», con N el tope del sitio' })
  async crear(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Body() cuerpo: unknown): Promise<EnlaceCreado> {
    exigirEnAlguno(u, 'enlaces');
    const v = validarVista(cuerpo, this.vista.limites);
    const sitioId = uuid(id, 'sitio');
    await this.alcance.exigirSitio(u, 'enlaces', sitioId);
    return this.enlaces.crear(sitioId, v, u.id);
  }

  @Post('vista-previa')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Vista previa de lo que verá quien visita (P9)',
    description:
      'Con el mismo formulario que crear (el título puede ir vacío) y `ventana` (cuál dibujar, hasta `ventana_maxima`; por defecto 24h): la MISMA respuesta ' +
      'que GET /publico, armada con la misma función y la regla de k, con los datos de hoy y los nombres de zona que quedarían publicados. No guarda nada ' +
      `ni crea un enlace. Tiene su propio cupo, separado del de las visitas (503 si pasa ${PUBLICO.tiempoMaximoMs / 1000} s o no hay cupo). Más \`avisos\`: lo ` +
      'que un visitante podría deducir de lo que se va a publicar, para mostrarlo antes de publicar.',
  })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiBody({ schema: { type: 'object', required: ['magnitudes'], properties: { ...PROPIEDADES_VISTA, ventana: { type: 'string', enum: [...VENTANAS_PUBLICAS] } } } })
  @ApiOkResponse({
    description: 'La vista como la verá quien visita (la misma forma que GET /publico) y `avisos`',
    schema: { ...ESQUEMA_VISTA, required: [...ESQUEMA_VISTA.required, 'avisos'], properties: { ...ESQUEMA_VISTA.properties, avisos: AVISOS } },
  })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido (como al crear)' })
  @ApiServiceUnavailableResponse({ description: 'La consulta pasó su tiempo máximo o no hay cupo' })
  async previa(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Body() cuerpo: unknown): Promise<VistaPrevia> {
    exigirEnAlguno(u, 'enlaces');
    const v = validarVista(cuerpo, this.vista.limites, true);
    const sitioId = uuid(id, 'sitio');
    await this.alcance.exigirSitio(u, 'enlaces', sitioId);
    return this.enlaces.previa(sitioId, v);
  }

  @Post(':enlace/renovar')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Renovar un enlace (P9)',
    description:
      'Fija el vencimiento en hoy + `plazo_dias`, sin cambiar el token (el enlace ya compartido sigue sirviendo). Solo un enlace no revocado, vigente o vencido ' +
      `hace ${RENOVAR_VENCIDO_HASTA_DIAS} días o menos y con menos de ${RENOVAR_HASTA_EDAD_DIAS} días desde su creación; si no, 409 \`codigo: no_renovable\`. Si el plazo ` +
      'acorta el vencimiento, 409 `codigo: acorta` con `expira_en_actual` y `expira_en_nueva`, salvo que venga `acortar: true`. Responde el enlace con ' +
      '`expira_en_anterior` y `acorta`. Deja el evento `enlace_renovado`.',
  })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiParam({ name: 'enlace', description: 'UUID del enlace' })
  @ApiBody({ schema: { type: 'object', required: ['plazo_dias'], properties: { plazo_dias: PROPIEDADES_VISTA.plazo_dias, acortar: { type: 'boolean', description: 'Confirma un plazo que acorta el vencimiento' } } } })
  @ApiOkResponse({ description: 'Enlace renovado' })
  @ApiBadRequestResponse({ description: 'UUID o plazo inválidos' })
  @ApiConflictResponse({ description: '`no_renovable` («Este enlace ya no se puede renovar. Crea uno nuevo.») o `acorta`' })
  async renovar(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Param('enlace') enlace: string, @Body() cuerpo: unknown): Promise<EnlaceRenovado> {
    exigirEnAlguno(u, 'enlaces');
    const r = validarRenovacion(cuerpo, this.vista.limites);
    const sitioId = uuid(id, 'sitio');
    const enlaceId = uuid(enlace, 'enlace');
    await this.alcance.exigirSitio(u, 'enlaces', sitioId);
    return this.enlaces.renovar(sitioId, enlaceId, r, u.id);
  }

  @Delete(':enlace')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Revocar un enlace (P9)',
    description: 'Revoca el enlace: no se deshace y corta en la petición siguiente (también con la respuesta guardada). La fila queda, revocada. Deja el evento `enlace_revocado`.',
  })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiParam({ name: 'enlace', description: 'UUID del enlace' })
  @ApiOkResponse({ description: 'Enlace revocado' })
  @ApiBadRequestResponse({ description: 'UUID inválido' })
  @ApiConflictResponse({ description: 'Ya estaba revocado' })
  async revocar(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Param('enlace') enlace: string): Promise<EnlaceListado> {
    exigirEnAlguno(u, 'enlaces');
    const sitioId = uuid(id, 'sitio');
    const enlaceId = uuid(enlace, 'enlace');
    await this.alcance.exigirSitio(u, 'enlaces', sitioId);
    return this.enlaces.revocar(sitioId, enlaceId, u.id);
  }
}
