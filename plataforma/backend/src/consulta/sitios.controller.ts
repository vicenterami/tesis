import { BadRequestException, Body, Controller, Get, HttpCode, Logger, Param, Patch, Post, Put, Query, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProduces,
  ApiQuery, ApiServiceUnavailableResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CABECERA_X_SIGUIENTE, ISO_8601, INTERVALOS, MAX_CUBOS, MAX_DIAS_VENTANA, SEGUNDOS_INTERVALO, exigirTopeCubos, fecha, intervalo, limite, uuid } from './validacion.js';
import { DIAS_ACTIVIDAD_POR_DEFECTO, MAX_DIAS_ACTIVIDAD, tipoValido } from './actividad.js';
import { ActividadService, FilaActividad } from './actividad.service.js';
import { CUBOS_CHISPA, HISTORICO_SITIO, LIMITE_AHORA, MAGNITUDES_SALUD, MAX_CANALES_AHORA, TENDENCIA, intervaloParaRango, leerCursor, siguiente } from './tablero.js';
import { MAX_ENTREGA_RESUMEN, TableroService } from './tablero.service.js';
import { ESPERA_PRIMERA_TRAMA, EsperaSitio, validarEspera, validarPropuesto } from './espera.js';
import { EsperaService } from './espera.service.js';
import { ConsultaService } from './consulta.service.js';
import { CODIGO_CUPO, CupoExportaciones, MAX_EXPORTACIONES } from './cupo-exportaciones.js';
import { DescargaCortada, escritorDeDescarga, responderFalla } from './descarga.js';
import { rangoRazonable } from './exportar.js';
import {
  COLUMNAS, FORMATOS_SITIO, TIEMPO_ESTIMACION_MS, TIPO_CONTENIDO, TOPE_ESTIMACION, VERSION_FORMATO, estimacion, escribirExportacionSitio, formatoSitio,
  nombreDeArchivoSitio,
} from './exportar-sitio.js';
import { diasRetencionTrama } from './tablero.service.js';

// El histórico del sitio lee TODOS los canales de la magnitud: medido en el banco (docs/16 §61), 30 días de 120 canales a una lectura cada
// 300 s (1 036 800 filas) tardan ≈ 1,1 s, ≈ 1 µs por lectura. Con el tope general de 366 días serían ≈ 13 s: se acota a 31 (un mes entero
// en la zona del sitio); más largo, por canal o con la exportación.
export const MAX_DIAS_SITIO = 31;
import { AlcanceService } from '../sesion/alcance.service.js';
import { Usuario } from '../sesion/guardia.js';
import { alcanceDeLectura, exigirEnAlguno, exigirGlobal } from '../sesion/permisos.js';
import { FORMA_CODIGO_SITIO, MAX_DESCRIPCION_SITIO, MAX_NOMBRE_SITIO, MAX_NOMBRE_ZONA, ZONA_INICIAL_POR_OMISION, validarCambioSitio, validarSitioNuevo, validarZonaNueva } from './sitios-zonas.js';
import { SitioCreado, SitiosZonasService, ZonaDeSitio } from './sitios-zonas.service.js';
import type { UsuarioSesion } from '../sesion/permisos.js';

// Tablero del sitio (docs/19 §4, bloque «Tablero v2», B e I; docs/10 §8.4 punto 65). Lecturas con sesión: consulta o más en su sitio;
// un sitio de otro (o que no existe) responde 404 (RF-41). La ventana y la resolución se validan antes de tocar la base, con los mismos
// topes del histórico de un canal (5 000 cubos, 366 días).
@ApiTags('sitios')
@ApiCookieAuth('sesion')
@ApiUnauthorizedResponse({ description: 'sesión requerida' })
@Controller('sitios')
export class SitiosController {
  private readonly log = new Logger('exportar');
  constructor(
    private readonly tablero: TableroService, private readonly alcance: AlcanceService, private readonly actividadSitio: ActividadService,
    private readonly espera: EsperaService, private readonly consulta: ConsultaService, private readonly cupo: CupoExportaciones,
    private readonly estructura: SitiosZonasService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Mis sitios (Etapa 4)',
    description: 'Los sitios activos de la sesión con `id, codigo, nombre, zona_horaria`, `descripcion` (la del sitio: texto o null), `rol` (el perfil de la persona en ese sitio) y `zonas[{id, nombre, activo, dispositivos}]` (por zona: `activo` false = zona retirada, que no se ofrece en el alta; `dispositivos`, los que no están de baja). El administrador del sistema y el usuario del sistema ven todos, con rol administrador (su perfil global va en `administrador_sistema` de GET /sesion).',
  })
  @ApiOkResponse({ description: 'Lista de sitios' })
  async listar(@Usuario() u: UsuarioSesion) {
    const filas = await this.tablero.sitios(alcanceDeLectura(u));
    return filas.map((s) => ({ ...s, rol: u.todos ? 'administrador' : (u.sitios.get(s.id) ?? 'consulta') }));
  }

  // Crear un sitio con su primera zona y cambiar su nombre o descripción (docs/19 §4 U; docs/20 §6): solo el administrador del sistema
  // (acción `sistema`, sin sitio en la ruta: un sitio nuevo no es de nadie todavía). 403 antes de mirar el cuerpo; el cuerpo, 400.
  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Crear un sitio con su primera zona (Etapa 4)',
    description:
      'Solo el administrador del sistema (acción `sistema`). Crea el sitio y su primera zona (por omisión «' + ZONA_INICIAL_POR_OMISION + '») en una transacción, ' +
      'con los eventos `sitio_alta` y `zona_alta`. El código va en los tópicos (`sitio/<codigo>/…`) y no cambia después; la zona horaria tampoco. ' +
      'La zona horaria se valida contra la base (`pg_timezone_names`). Responde `{id, codigo, nombre, zona_horaria, descripcion, zonas[{id, sitio_id, nombre, activo, dispositivos}]}`.',
  })
  @ApiBody({ schema: { type: 'object', required: ['nombre', 'codigo', 'zona_horaria'], properties: {
    nombre: { type: 'string', maxLength: MAX_NOMBRE_SITIO },
    codigo: { type: 'string', pattern: FORMA_CODIGO_SITIO.source, description: 'Segmento del tópico; único' },
    zona_horaria: { type: 'string', description: 'Nombre IANA, como America/Santiago' },
    primera_zona: { type: 'string', maxLength: MAX_NOMBRE_ZONA, description: `Por omisión «${ZONA_INICIAL_POR_OMISION}»` },
    descripcion: { type: 'string', maxLength: MAX_DESCRIPCION_SITIO, description: 'Opcional; se recorta; vacía = sin descripción' },
  } } })
  @ApiCreatedResponse({ description: 'El sitio creado con sus zonas' })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido: nombre, código, zona horaria (forma, o un nombre que la base no conoce), primera zona o descripción; un nombre con caracteres de control o invisibles' })
  @ApiForbiddenResponse({ description: 'No es el administrador del sistema (docs/20 §6), o sesión sin la cabecera X-Pedido: panel' })
  @ApiConflictResponse({ description: '`codigo: codigo_repetido`: ya existe un sitio con ese código' })
  @ApiServiceUnavailableResponse({ description: 'Otro cambio sobre este sitio está en curso (bloqueo agotado): reintentar' })
  async crearSitio(@Usuario() u: UsuarioSesion, @Body() cuerpo: unknown): Promise<SitioCreado> {
    exigirGlobal(u, 'sistema');
    return this.estructura.crearSitio(validarSitioNuevo(cuerpo), u.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cambiar el nombre o la descripción de un sitio (Etapa 4)', description: 'Solo el administrador del sistema (acción `sistema`). El código y la zona horaria no cambian. Deja el evento `sitio_cambio` si algo cambia.' })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiBody({ schema: { type: 'object', properties: { nombre: { type: 'string', maxLength: MAX_NOMBRE_SITIO }, descripcion: { type: 'string', nullable: true, maxLength: MAX_DESCRIPCION_SITIO, description: 'null o vacía la borra' } } } })
  @ApiOkResponse({ description: 'El sitio con sus zonas (la misma forma que POST /sitios)' })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido o nada que cambiar' })
  @ApiForbiddenResponse({ description: 'No es el administrador del sistema (docs/20 §6), o sesión sin la cabecera X-Pedido: panel' })
  @ApiNotFoundResponse({ description: 'Sitio inexistente o inactivo' })
  @ApiServiceUnavailableResponse({ description: 'Otro cambio sobre este sitio está en curso (bloqueo agotado): reintentar' })
  async cambiarSitio(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Body() cuerpo: unknown): Promise<SitioCreado> {
    exigirGlobal(u, 'sistema');
    const cambio = validarCambioSitio(cuerpo);
    return this.estructura.cambiarSitio(uuid(id, 'sitio'), cambio, u.id);
  }

  // Crear una zona en un sitio (docs/19 §4 U; docs/20 §6): la acción `ajustes` en ese sitio. Mismo orden de códigos que las demás rutas
  // que escriben: sin la acción en ningún sitio, 403; el cuerpo, 400; el sitio: 404 si no existe o es de otro, 403 si su perfil no puede.
  @Post(':id/zonas')
  @HttpCode(201)
  @ApiOperation({ summary: 'Crear una zona en un sitio (Etapa 4)', description: 'Quien administra el sitio (acción `ajustes`). El nombre no se repite en el sitio sin distinguir mayúsculas ni espacios en los extremos. Deja el evento `zona_alta`.' })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiBody({ schema: { type: 'object', required: ['nombre'], properties: { nombre: { type: 'string', maxLength: MAX_NOMBRE_ZONA } } } })
  @ApiCreatedResponse({ description: 'La zona creada' })
  @ApiBadRequestResponse({ description: 'Nombre vacío, demasiado largo o con caracteres de control o invisibles' })
  @ApiForbiddenResponse({ description: 'Un perfil sin la acción «ajustes» (docs/20 §6), o sesión sin la cabecera X-Pedido: panel' })
  @ApiConflictResponse({ description: '`codigo: zona_repetida` (ya hay una zona activa con ese nombre en el sitio) o `zona_retirada` (la hay, retirada: se vuelve a ofrecer con PATCH /zonas/{id})' })
  @ApiNotFoundResponse({ description: 'Sitio inexistente, inactivo o de otro' })
  @ApiServiceUnavailableResponse({ description: 'Otro cambio sobre este sitio está en curso (bloqueo agotado): reintentar' })
  async crearZona(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Body() cuerpo: unknown): Promise<ZonaDeSitio> {
    exigirEnAlguno(u, 'ajustes');
    const nombre = validarZonaNueva(cuerpo);
    const sitioId = uuid(id, 'sitio');
    await this.alcance.exigirSitio(u, 'ajustes', sitioId);
    return this.estructura.crearZona(sitioId, nombre, u.id);
  }

  @Get(':id/resumen')
  @ApiOperation({
    summary: 'Resumen del sitio para el tablero (Etapa 4)',
    description:
      'Una consulta por petición (docs/10 §8.4 punto 65 iii). `sitio`, `ventana{desde, hasta, intervalo}`, `dispositivos{total, normal, alerta, sin_senal, esperando, inactivo}` ' +
      '(estado visual de docs/19 §2), `salud{reportan, supervisados, porcentaje}` (en línea ÷ supervisados: ni inactivos ni esperando su primera trama), `condiciones_abiertas[{tipo, n}]`, ' +
      '`tramas{recibidas, rechazadas, cubos[{tiempo, recibidas, rechazadas}]}` (tiempo en segundos Unix, como `tiempos` de los históricos; cubos en la zona del ' +
      'sitio; los cubos sin datos no se emiten: no son 0), ' +
      '`atencion[{id, nombre, estado_visual, visto_por_ultima_vez, tipos}]` (hasta diez, sin señal primero), `magnitudes[{codigo, nombre, unidad, canales}]` ' +
      `y \`entrega[{id, nombre, recibidas, esperadas, porcentaje}]\`: los ${MAX_ENTREGA_RESUMEN} dispositivos activos con peor entrega, de peor a mejor, y ` +
      '`total_activos`, cuántos hay (todos, en `GET /dispositivos?orden=entrega`). Porcentaje nulo si no hay una trama esperada completa en la ventana, contada ' +
      'desde su entrada en servicio (`en_servicio_desde`) y dentro de la retención de tramas (medida desde ahora), y nulo para quien espera su primera trama; 0 % si se esperaban y no llegó ninguna. Sin `intervalo`, el más fino que deja la ' +
      'ventana en 300 cubos o menos.',
  })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiQuery({ name: 'desde', required: false, description: `${ISO_8601}; por defecto hasta − 24 h` })
  @ApiQuery({ name: 'hasta', required: false, description: `${ISO_8601}; por defecto ahora` })
  @ApiQuery({ name: 'intervalo', required: false, enum: INTERVALOS, description: 'Resolución de los cubos de tramas; por defecto, según el rango' })
  @ApiOkResponse({ description: 'Resumen del sitio' })
  @ApiBadRequestResponse({ description: `UUID, fecha o intervalo inválidos, o una ventana de más de ${MAX_DIAS_VENTANA} días o de más de ${MAX_CUBOS} cubos` })
  @ApiNotFoundResponse({ description: 'Sitio inexistente o de otro' })
  async resumen(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string, @Query('intervalo') inter?: string) {
    const { d, h, i } = ventana(desde, hasta, inter, true);
    const sitioId = uuid(id, 'sitio');
    await this.alcance.exigirSitio(u, 'leer', sitioId);
    return this.tablero.resumen(sitioId, d, h, i);
  }

  @Get(':id/ahora')
  @ApiOperation({
    summary: 'Lo que se mide ahora en el sitio (Etapa 4; tablero v3, «Ahora»)',
    description:
      'Como mucho tres consultas por petición, sin una por dispositivo (docs/10 §8.4 punto 65 viii). `reportan` y `sin_senal`: cuántos dispositivos del sitio ' +
      'tienen estado visual normal o alerta, y sin señal (la regla de docs/19 §2, la misma del inventario y del resumen). ' +
      '`por_magnitud[{codigo, nombre, unidad, salud, canales, promedio, minimo, maximo}]`: sobre la última lectura de cada canal de los que reportan, solo si ' +
      'tiene menos de dos intervalos esperados del dispositivo (una lectura vieja no entra); `canales`, cuántos aportan; las de salud del equipo al final. ' +
      '`dispositivos[{id, nombre, zona, estado_visual, visto_por_ultima_vez, intervalo_esperado_s, canales_total, canales}]`: los que reportan, primero los de ' +
      'alerta y después por zona y nombre, hasta `limite`; `canales` trae hasta ' + MAX_CANALES_AHORA + ' `{id, magnitud, magnitud_nombre, unidad, salud, ' +
      'ultima{valor, tiempo, porcentaje}|null}`: primero lo que se mide y al final la salud del equipo (' + MAGNITUDES_SALUD.join(', ') + '). Con `tendencia=si`, ' +
      `además \`chispa{desde, intervalo, puntos}\` y, en cada canal, \`chispa\`: ${CUBOS_CHISPA} promedios por hora alineados a la hora UTC, el último de la hora ` +
      'en curso (parcial); un cubo sin lecturas es null, no 0. `tendencia` va siempre: true si la tendencia está en la respuesta; false si no se ' +
      `pidió o si se omitió porque su cálculo pasó de ${TENDENCIA.tiempoMaximoMs} ms o ya había ${TENDENCIA.maxEnCurso} en curso (no es un error: el resto ` +
      'de la respuesta es el mismo). Consulta o más en su sitio; otro sitio, 404.',
  })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiQuery({ name: 'limite', required: false, description: `Tarjetas de dispositivo: 1–${LIMITE_AHORA.maximo}, por defecto ${LIMITE_AHORA.porDefecto}` })
  @ApiQuery({ name: 'tendencia', required: false, enum: ['si'], description: '`si` pide las líneas de tendencia de 24 h (si no alcanzan el tiempo o el cupo, `tendencia: false`); cualquier otro valor o ausente, no' })
  @ApiOkResponse({ description: 'Lo que reporta cada dispositivo ahora y el resumen por magnitud' })
  @ApiBadRequestResponse({ description: `UUID inválido o limite fuera de 1–${LIMITE_AHORA.maximo}` })
  @ApiNotFoundResponse({ description: 'Sitio inexistente o de otro' })
  async ahora(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Query('limite') lim?: string, @Query('tendencia') tendencia?: string) {
    const l = limite(lim, LIMITE_AHORA.porDefecto, LIMITE_AHORA.maximo);
    const sitioId = uuid(id, 'sitio');
    await this.alcance.exigirSitio(u, 'leer', sitioId);
    return this.tablero.ahora(sitioId, l, tendencia === 'si');
  }

  @Get(':id/historico')
  @ApiOperation({
    summary: 'Histórico de una magnitud en todo el sitio (Etapa 4)',
    description:
      'Por cubo (time_bucket en la zona del sitio), el promedio de los DISPOSITIVOS de esa magnitud del sitio (docs/19 §4, M): en cada cubo, cada ' +
      'dispositivo aporta un valor, el promedio de sus lecturas del cubo o, si no reportó en él, su última lectura mientras tenga menos de dos ' +
      'intervalos esperados al empezar el cubo (la regla de «Ahora»). `valores` (el promedio de esos aportes: cada dispositivo pesa lo mismo), `minimos` y ' +
      '`maximos` (entre dispositivos), `muestras` (las lecturas reales del cubo; las vigentes no cuentan) y `n` (cuántos aportan); `dispositivos`, cuántos ' +
      'aportan en algún cubo de la ventana. La forma del histórico de un canal más esos campos, con `magnitud` y `unidad`; sin calibración (`escala` y ' +
      '`porcentajes` nulos). `tiempos` en segundos Unix; un cubo sin ningún aporte no se emite (no es 0). Topes: ' +
      MAX_CUBOS + ' cubos y ' + MAX_DIAS_SITIO + ' días (menos que los ' + MAX_DIAS_VENTANA + ' de un canal: lee todos los canales de la magnitud; medido en docs/16 §61 y §68) ' +
      'y ' + HISTORICO_SITIO.tiempoMaximoMs / 1000 + ' s de tiempo máximo de la consulta (si lo excede, 503).',
  })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiQuery({ name: 'magnitud', required: true, description: 'Código del catálogo (temperatura, humedad, …)' })
  @ApiQuery({ name: 'desde', required: false, description: `${ISO_8601}; por defecto hasta − 24 h` })
  @ApiQuery({ name: 'hasta', required: false, description: `${ISO_8601}; por defecto ahora` })
  @ApiQuery({ name: 'intervalo', required: false, enum: INTERVALOS, description: 'Por defecto 15 minutes' })
  @ApiOkResponse({ description: 'Serie agregada del sitio' })
  @ApiBadRequestResponse({ description: `UUID, fecha, intervalo o magnitud inválidos, o una ventana de más de ${MAX_DIAS_SITIO} días o de más de ${MAX_CUBOS} cubos` })
  @ApiNotFoundResponse({ description: 'Sitio inexistente o de otro' })
  @ApiServiceUnavailableResponse({ description: `La consulta pasó su tiempo máximo (${HISTORICO_SITIO.tiempoMaximoMs / 1000} s): el panel lo dice con «Reintentar»` })
  async historico(
    @Usuario() u: UsuarioSesion, @Param('id') id: string, @Query('magnitud') magnitud?: string,
    @Query('desde') desde?: string, @Query('hasta') hasta?: string, @Query('intervalo') inter?: string,
  ) {
    const { d, h, i } = ventana(desde, hasta, inter, false, MAX_DIAS_SITIO);
    if (typeof magnitud !== 'string' || !/^[a-z0-9_]{1,40}$/.test(magnitud)) throw new BadRequestException('magnitud es obligatoria: el código del catálogo (temperatura, humedad, …)');
    const sitioId = uuid(id, 'sitio');
    await this.alcance.exigirSitio(u, 'leer', sitioId);
    return this.tablero.historicoSitio(sitioId, magnitud, d, h, i);
  }

  @Get(':id/actividad')
  @ApiOperation({
    summary: 'Actividad del sitio (Etapa 4; P14)',
    description:
      'Lo que hicieron las personas sobre los dispositivos del sitio (eventos, con quién) y las entradas, salidas y bloqueos de quienes tienen membresía activa ' +
      'en él (accesos), mezclados del más reciente al más antiguo: `id, instante, clase (evento|acceso), tipo, texto, usuario{id, nombre, correo}|null, dispositivo{id, nombre}|null`. ' +
      'Con el correo de quien lo hizo (null en una cuenta anonimizada; distingue a dos personas con el mismo nombre) y sin direcciones IP. Filtros: `tipo` (un tipo de evento o un resultado de acceso), `usuario` (UUID) y [desde, hasta) (por defecto, los últimos ' +
      `${DIAS_ACTIVIDAD_POR_DEFECTO} días; hasta ${MAX_DIAS_ACTIVIDAD}). Página por clave: la cabecera \`X-Siguiente\` trae el cursor de la siguiente. ` +
      'Administrador del sitio en sus sitios; administrador del sistema en todos; los demás perfiles, 403; otro sitio, 404.',
  })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiQuery({ name: 'desde', required: false, description: `${ISO_8601}; por defecto hasta − ${DIAS_ACTIVIDAD_POR_DEFECTO} días` })
  @ApiQuery({ name: 'hasta', required: false, description: `${ISO_8601}; por defecto ahora` })
  @ApiQuery({ name: 'tipo', required: false, description: 'Tipo de evento (alta, baja, reglas_cambiadas, sitio_alta, sitio_cambio, zona_alta, zona_cambio, …) o resultado de acceso (ok, cierre, clave_incorrecta, bloqueado, inactivo)' })
  @ApiQuery({ name: 'usuario', required: false, description: 'UUID de la persona' })
  @ApiQuery({ name: 'limite', required: false, description: '1–500, por defecto 100' })
  @ApiQuery({ name: 'cursor', required: false, description: 'El de la cabecera X-Siguiente de la página anterior' })
  @ApiOkResponse({ description: 'Lista de actividad; X-Siguiente si hay otra página', headers: { ...CABECERA_X_SIGUIENTE } })
  @ApiBadRequestResponse({ description: 'UUID, fecha, tipo, límite o cursor inválidos, o una ventana de más de ' + MAX_DIAS_ACTIVIDAD + ' días' })
  @ApiNotFoundResponse({ description: 'Sitio inexistente o de otro' })
  async actividad(
    @Usuario() u: UsuarioSesion, @Param('id') id: string, @Res({ passthrough: true }) res: Response,
    @Query('desde') desde?: string, @Query('hasta') hasta?: string, @Query('tipo') tipo?: string, @Query('usuario') usuario?: string,
    @Query('limite') lim?: string, @Query('cursor') cursor?: string,
  ): Promise<FilaActividad[]> {
    const h = fecha(hasta, new Date(), 'hasta');
    const d = fecha(desde, new Date(h.getTime() - DIAS_ACTIVIDAD_POR_DEFECTO * 86_400_000), 'desde');
    if (d.getTime() >= h.getTime()) throw new BadRequestException('desde debe ser anterior a hasta');
    if ((h.getTime() - d.getTime()) / 86_400_000 > MAX_DIAS_ACTIVIDAD) throw new BadRequestException(`la ventana de actividad es de ${MAX_DIAS_ACTIVIDAD} días como máximo`);
    if (tipo !== undefined && !tipoValido(tipo)) throw new BadRequestException('tipo: un tipo de evento o de acceso, en minúsculas (p. ej. reglas_cambiadas, ok)');
    const persona = usuario === undefined ? undefined : uuid(usuario, 'usuario');
    const l = limite(lim, 100);
    const c = leerCursor(cursor);
    const sitioId = uuid(id, 'sitio');
    await this.alcance.exigirSitio(u, 'auditoria', sitioId);
    const filas = await this.actividadSitio.actividad(sitioId, { desde: d, hasta: h, tipo, usuario: persona, limite: l, cursor: c });
    const sig = siguiente(filas, l, (f) => ({ t: f.instante, id: f.id }));
    if (sig !== null) res.setHeader('X-Siguiente', sig);
    return filas;
  }

  // GET /sitios/:id/exportar?formato=csv|xlsx|json&desde&hasta — el sitio entero en un archivo (HU-08; docs/19 §4, bloque R; 19/11/2026).
  // Orden de los códigos, como en la exportación por dispositivo: el sitio (404 si no existe o es de otro, 403 si su perfil no exporta), el
  // formato y el rango (400) y, al final, el cupo compartido (429). Después, el archivo en flujo: un error antes de enviar nada responde 503
  // en JSON; uno a mitad corta la conexión (el cliente ve un archivo incompleto, no uno que parece entero). Los dos quedan en el registro.
  @Get(':id/exportar')
  @ApiOperation({
    summary: 'Exportar todo el sitio: mediciones, tramas y eventos (HU-08)',
    description:
      `Un archivo por descarga con los tres conjuntos del rango [desde, hasta) de todos los dispositivos del sitio, en cualquier estado, sin datos de personas ` +
      `(versión del formato \`${VERSION_FORMATO}\`): mediciones (\`${COLUMNAS.mediciones.join(', ')}\`), tramas aceptadas con su carga exacta en base64 y su huella ` +
      `SHA-256 calculada en la base (\`${COLUMNAS.tramas.join(', ')}\`; solo las que siguen guardadas: RETENCION_TRAMA_DIAS, 30 por omisión) y eventos del ciclo ` +
      `de vida (\`${COLUMNAS.eventos.join(', ')}\`), ordenados por dispositivo, magnitud y tiempo. \`csv\` (por omisión): un .zip con mediciones.csv, tramas.csv, ` +
      'eventos.csv (coma, punto decimal, UTF-8, CRLF; apóstrofo reversible contra fórmulas) y LEEME.txt con los conteos al final; un CSV que pasaría de 1 GiB sigue en ' +
      '`mediciones-2.csv`. `xlsx`: un libro con las hojas «Acerca de» (primera pestaña), «Mediciones», «Tramas» y «Eventos», la primera fila fija, una columna ' +
      '`fecha_utc` con la fecha nativa de planilla y la carga partida en `payload_base64`, `payload_base64_2` y `payload_base64_3`; una hoja que llega a 1 048 575 ' +
      'filas sigue en «Mediciones (2)». `json`: `{formato, sitio{codigo, nombre}, desde, hasta, generado_en, retencion_tramas_dias, mediciones[], tramas[], ' +
      'eventos[], conteos{}}`, con `detalle` como objeto. Por omisión, los últimos 30 días; instantes en UTC con microsegundos. Nombre: ' +
      '`sitio_<código>_<desde>_<hasta>.<zip|xlsx|json>`. Cupo de ' + MAX_EXPORTACIONES + ' exportaciones o estimaciones simultáneas por proceso, compartido con ' +
      'GET /dispositivos/{id}/exportar y GET /sitios/{id}/exportar/estimacion. Si falla antes de enviar nada (la primera consulta), 503 en JSON; a mitad, se ' +
      'corta la conexión.',
  })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiQuery({ name: 'formato', required: false, enum: FORMATOS_SITIO, description: 'csv (por omisión, un .zip), xlsx o json' })
  @ApiQuery({ name: 'desde', required: false, description: `${ISO_8601}; por defecto hasta − 30 días; no antes del año 2000` })
  @ApiQuery({ name: 'hasta', required: false, description: `${ISO_8601}; por defecto ahora; como mucho un día en el futuro` })
  @ApiProduces(TIPO_CONTENIDO.csv, TIPO_CONTENIDO.xlsx, 'application/json')
  @ApiOkResponse({
    description: 'Archivo descargable en flujo',
    headers: {
      'Content-Disposition': { description: 'attachment; filename="sitio_<código>_<desde>_<hasta>.<zip|xlsx|json>"', schema: { type: 'string' } },
      'Cache-Control': { description: 'no-store', schema: { type: 'string' } },
    },
  })
  @ApiBadRequestResponse({ description: 'UUID, fecha, rango o formato inválidos' })
  @ApiForbiddenResponse({ description: 'Consulta u operador técnico: exportar es del administrador (de sitio o del sistema) y del investigador (docs/20 §6)' })
  @ApiNotFoundResponse({ description: 'Sitio inexistente o de otro' })
  @ApiTooManyRequestsResponse({ description: `\`codigo: ${CODIGO_CUPO}\`: ya hay ${MAX_EXPORTACIONES} exportaciones o estimaciones en curso en el proceso (cupo único con GET /dispositivos/{id}/exportar y GET /sitios/{id}/exportar/estimacion)` })
  @ApiServiceUnavailableResponse({ description: 'La exportación falló antes de enviar nada (la primera consulta): 503 en JSON; si falla a mitad, se corta la conexión' })
  async exportar(
    @Usuario() u: UsuarioSesion, @Param('id') id: string, @Res() res: Response,
    @Query('formato') f?: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string,
  ): Promise<void> {
    const sitioId = uuid(id, 'sitio');
    await this.alcance.exigirSitio(u, 'exportar', sitioId);
    let fmt;
    try {
      fmt = formatoSitio(f);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const { d, h } = rangoExportacion(desde, hasta);
    const sitio = await this.consulta.sitioExportable(sitioId);
    this.cupo.tomar();
    try {
      const meta = { ...sitio, desde: d, hasta: h, generadoEn: new Date(), retencionTramasDias: diasRetencionTrama() };
      res.setHeader('Content-Type', TIPO_CONTENIDO[fmt]);
      res.setHeader('Content-Disposition', `attachment; filename="${nombreDeArchivoSitio(sitio.codigo, d, h, fmt)}"`);
      res.setHeader('Cache-Control', 'no-store');
      // Los primeros 64 KiB (las cabeceras del zip o del libro) se retienen hasta después de la primera consulta (descarga.ts).
      const descarga = escritorDeDescarga(res);
      await this.consulta.conConexionExportacion((c) => escribirExportacionSitio(fmt, {
        mediciones: () => this.consulta.medicionesSitio(c, sitioId, d, h),
        tramas: () => this.consulta.tramasSitio(c, sitioId, d, h),
        eventos: () => this.consulta.eventosSitio(c, sitioId, d, h),
      }, meta, (b) => descarga.escribir(b)));
      await descarga.terminar();
    } catch (e) {
      const hecho = responderFalla(res, e);
      if (e instanceof DescargaCortada) this.log.warn(`exportación del sitio ${sitio.codigo} cortada: el cliente cerró la conexión`);
      else this.log.error(`exportación del sitio ${sitio.codigo} ${hecho === 'respondida' ? 'no empezó (503)' : 'interrumpida'}: ${(e as Error).message}`);
    } finally {
      this.cupo.soltar();
    }
  }

  @Get(':id/exportar/estimacion')
  @ApiOperation({
    summary: 'Cuánto trae la exportación de un sitio, antes de descargarla (HU-08)',
    description:
      `Mismos permisos y mismo rango que GET /sitios/{id}/exportar. \`mediciones\`, \`tramas\` y \`eventos\`: \`{filas, supera_tope}\`, contadas con tope ` +
      `(\`tope_conteo\`, ${TOPE_ESTIMACION}: el conteo nunca recorre más; con \`supera_tope\`, «más de ${TOPE_ESTIMACION}»); \`tramas.desde\`: la trama más antigua ` +
      'del rango (las tramas se guardan `retencion_tramas_dias`), o null si no hay; `bytes_aproximados{csv, xlsx, json}`: filas × bytes por fila medidos en el ' +
      'banco (docs/16 §89; con `supera_tope`, un mínimo). Toma el mismo cupo que las exportaciones (' + MAX_EXPORTACIONES + ' por proceso: cancelarla en el ' +
      `panel no cancela su consulta en la base) y tiene ${TIEMPO_ESTIMACION_MS / 1000} s por consulta (si los pasa, 503).`,
  })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiQuery({ name: 'desde', required: false, description: `${ISO_8601}; por defecto hasta − 30 días; no antes del año 2000` })
  @ApiQuery({ name: 'hasta', required: false, description: `${ISO_8601}; por defecto ahora; como mucho un día en el futuro` })
  @ApiOkResponse({ description: 'Conteos con tope y tamaño aproximado por formato' })
  @ApiBadRequestResponse({ description: 'UUID, fecha o rango inválidos' })
  @ApiForbiddenResponse({ description: 'Consulta u operador técnico (docs/20 §6)' })
  @ApiNotFoundResponse({ description: 'Sitio inexistente o de otro' })
  @ApiTooManyRequestsResponse({ description: `\`codigo: ${CODIGO_CUPO}\`: ya hay ${MAX_EXPORTACIONES} exportaciones o estimaciones en curso en el proceso` })
  @ApiServiceUnavailableResponse({ description: `Una consulta pasó de ${TIEMPO_ESTIMACION_MS / 1000} s` })
  async estimacion(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    const sitioId = uuid(id, 'sitio');
    await this.alcance.exigirSitio(u, 'exportar', sitioId);
    const { d, h } = rangoExportacion(desde, hasta);
    // Con cupo (revisión del 19/11/2026): el panel cancela la estimación anterior al cambiar el rango, pero cancelar la petición NO cancela
    // la consulta en la base, que sigue hasta terminar con su conexión tomada. El cupo compartido con las exportaciones (a lo más 2
    // conexiones pesadas, de las 5 del pool) y el tope de 10 s por consulta (contar 1 000 000 tarda ≈ 0,5 s, docs/16 §89) acotan lo que
    // pueden ocupar las que quedaron huérfanas.
    this.cupo.tomar();
    try {
      const n = await this.consulta.conConexionExportacion((c) => this.consulta.estimarSitio(c, sitioId, d, h, TOPE_ESTIMACION), TIEMPO_ESTIMACION_MS);
      return estimacion(d, h, n, diasRetencionTrama());
    } catch (e) {
      if ((e as { code?: string }).code === '57014') {
        throw new ServiceUnavailableException(`la estimación tardó más de ${TIEMPO_ESTIMACION_MS / 1000} s: prueba con un rango más corto o en un momento`);
      }
      throw e;
    } finally {
      this.cupo.soltar();
    }
  }

  // El plazo de la primera trama del sitio (docs/19 §2 y §4, P; docs/10 §8.4 punto 68; docs/20 §6): leerlo, cualquier perfil del sitio (la
  // ficha dice cuándo pasaría a «Sin señal»); fijarlo, la acción `ajustes` (quien administra el sitio). Orden de los códigos, como en las
  // demás rutas que escriben (docs/20 §10): sin la acción en ningún sitio, 403 antes de mirar el cuerpo; el cuerpo, 400; el sitio: 404 si no
  // existe o es de otro, 403 si es suyo y su perfil no puede.
  @Get(':id/espera-primera-trama')
  @ApiOperation({
    summary: 'Plazo de la primera trama del sitio (Etapa 4)',
    description:
      'Cuántas horas espera el sitio la primera trama de un equipo desde que entró en servicio antes de darlo por «Sin señal» (docs/19 §2): ' +
      `\`espera_primera_trama_h\` (el que rige), \`por_omision\` (${ESPERA_PRIMERA_TRAMA.porOmision}), \`minimo\` y \`maximo\` (${ESPERA_PRIMERA_TRAMA.minimo} a ${ESPERA_PRIMERA_TRAMA.maximo}).`,
  })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiQuery({ name: 'propuesto', required: false, description: `Horas (entero de ${ESPERA_PRIMERA_TRAMA.minimo} a ${ESPERA_PRIMERA_TRAMA.maximo}): suma \`afectados\` a la respuesta, cuántos equipos activos del sitio que nunca enviaron una trama están hoy dentro de su plazo y con ese plazo quedarían vencidos (el aviso de quien lo acorta; no una garantía)` })
  @ApiOkResponse({ description: 'El plazo del sitio (y `afectados`, con `propuesto`)' })
  @ApiBadRequestResponse({ description: '`propuesto` que no es un entero de horas dentro del rango' })
  @ApiNotFoundResponse({ description: 'Sitio inexistente o de otro' })
  async leerEspera(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Query('propuesto') propuesto?: string): Promise<EsperaSitio> {
    const sitioId = uuid(id, 'sitio');
    const horas = validarPropuesto(propuesto);
    await this.alcance.exigirSitio(u, 'leer', sitioId);
    return this.espera.leer(sitioId, horas);
  }

  @Put(':id/espera-primera-trama')
  @ApiOperation({
    summary: 'Fijar el plazo de la primera trama del sitio (Etapa 4)',
    description:
      `De ${ESPERA_PRIMERA_TRAMA.minimo} a ${ESPERA_PRIMERA_TRAMA.maximo} horas. Lo fija quien administra el sitio (acción \`ajustes\`, docs/20 §6) y rige en el ` +
      'barrido siguiente del supervisor: alargarlo devuelve a «Esperando primera trama» a quien había vencido (y cierra su condición); acortarlo puede ' +
      'abrirla. Deja el evento `espera_primera_trama` con quién, el valor y el anterior (si no cambia nada, ninguno). Con `anterior` (el plazo que se leyó), ' +
      'si ya no es el que rige: 409 `codigo: espera_cambio` con `espera_primera_trama_h` (el que rige), sin cambiar nada.',
  })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiBody({ schema: { type: 'object', required: ['espera_primera_trama_h'], properties: {
    espera_primera_trama_h: { type: 'integer', minimum: ESPERA_PRIMERA_TRAMA.minimo, maximum: ESPERA_PRIMERA_TRAMA.maximo, description: 'Horas' },
    anterior: { type: 'integer', minimum: ESPERA_PRIMERA_TRAMA.minimo, maximum: ESPERA_PRIMERA_TRAMA.maximo, description: 'El plazo que rige y que se leyó (GET …/espera-primera-trama): si cambió entretanto, 409 (bloqueo optimista)' },
  } } })
  @ApiOkResponse({ description: 'El plazo nuevo' })
  @ApiBadRequestResponse({ description: `Fuera de ${ESPERA_PRIMERA_TRAMA.minimo} a ${ESPERA_PRIMERA_TRAMA.maximo}, no entero, o un campo de más` })
  @ApiForbiddenResponse({ description: 'Un perfil sin la acción «ajustes» (docs/20 §6), o sesión sin la cabecera X-Pedido: panel' })
  @ApiConflictResponse({ description: '`codigo: espera_cambio`: el plazo cambió desde que se leyó (`anterior`); trae el que rige en `espera_primera_trama_h`' })
  @ApiNotFoundResponse({ description: 'Sitio inexistente o de otro' })
  async fijarEspera(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Body() cuerpo: unknown): Promise<EsperaSitio> {
    exigirEnAlguno(u, 'ajustes');
    const { horas, anterior } = validarEspera(cuerpo);
    const sitioId = uuid(id, 'sitio');
    await this.alcance.exigirSitio(u, 'ajustes', sitioId);
    return this.espera.fijar(sitioId, horas, u.id, anterior);
  }
}

// El rango de las dos exportaciones: por omisión, los últimos 30 días; el mismo rango razonable que la exportación por dispositivo.
export function rangoExportacion(desde: unknown, hasta: unknown): { d: Date; h: Date } {
  const h = fecha(hasta, new Date(), 'hasta');
  const d = fecha(desde, new Date(h.getTime() - 30 * 86_400_000), 'desde');
  const motivo = rangoRazonable(d, h);
  if (motivo !== null) throw new BadRequestException(motivo);
  return { d, h };
}

// La ventana de una lectura del tablero: por defecto, las últimas 24 h; los topes de siempre (validacion.ts), antes de tocar la base.
// `automatico`: sin intervalo pedido, el que da la resolución del rango (resumen); si no, 15 minutos (histórico, como el de un canal).
// `maxDias`: un tope de ventana más corto que el general (el histórico del sitio, MAX_DIAS_SITIO).
export function ventana(desde: unknown, hasta: unknown, inter: unknown, automatico: boolean, maxDias = MAX_DIAS_VENTANA) {
  const h = fecha(hasta, new Date(), 'hasta');
  const d = fecha(desde, new Date(h.getTime() - 24 * 3600 * 1000), 'desde');
  if (d.getTime() >= h.getTime()) throw new BadRequestException('desde debe ser anterior a hasta');
  const dias = (h.getTime() - d.getTime()) / 86_400_000;
  if (dias > maxDias) throw new BadRequestException(`la ventana pedida abarca ${Math.ceil(dias)} días y el máximo de esta ruta es ${maxDias}: acórtala o usa la exportación`);
  const i = automatico && inter === undefined ? intervaloParaRango(d, h, INTERVALOS, SEGUNDOS_INTERVALO) : intervalo(inter);
  exigirTopeCubos(d, h, i);
  return { d, h, i };
}
