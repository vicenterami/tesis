import { Body, ConflictException, Controller, Delete, HttpCode, HttpException, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse,
  ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AltaValidada, FORMATOS_DIRECTOS, FORMA_ID_FISICO, MAX_CANALES, VIAS, validarAlta } from './alta.dto.js';
import { PERFILES } from '../recepcion/adaptadores/perfiles.js';
import { AltaService, CredencialRotada, DispositivoCreado, DispositivoDadoDeBaja } from './alta.service.js';
import { uuid } from '../consulta/validacion.js';
import { AlcanceService } from '../sesion/alcance.service.js';
import { Usuario } from '../sesion/guardia.js';
import { alcanceDeLectura, exigirEnAlguno, permitir } from '../sesion/permisos.js';
import { ConfiguracionService } from './configuracion.service.js';
import { validarCambioDispositivo } from './configuracion.dto.js';
import { FORMA_ACTUALIZADO_EN } from './calibracion.dto.js';
import { ConsultaService } from '../consulta/consulta.service.js';
import { COLUMNAS_LOTE, FilaInforme, LOTES_POR_MINUTO, MAX_FILAS_LOTE, MODOS_LOTE, TANDA_CLIENTE_LOTE, TasaPorPersona, filasDelCuerpo, modoLote, totales, validarLote } from './lote.js';
import type { UsuarioSesion } from '../sesion/permisos.js';

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
  private readonly tasaLote = new TasaPorPersona();
  private loteEnCurso = false;
  constructor(
    private readonly alta: AltaService, private readonly alcance: AlcanceService, config: ConfigService,
    private readonly configuracion: ConfiguracionService, private readonly consulta: ConsultaService,
  ) {
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
  @ApiForbiddenResponse({ description: 'Un perfil sin ese permiso en ese sitio (docs/20 §6), o sesión sin la cabecera X-Pedido: panel' })
  @ApiConflictResponse({ description: 'El id_fisico ya existe (en la base o, huérfano, en el broker)' })
  @ApiResponse({ status: 502, description: 'El broker no aceptó la credencial; nada quedó creado' })
  @ApiResponse({ status: 503, description: 'Sin clave de administrador configurada, o sin conexión de administración con el broker' })
  @ApiResponse({ status: 429, description: 'Ya hay 2 operaciones de aprovisionamiento en curso (alta, baja o rotación); reintentar en un momento' })
  async crear(@Usuario() u: UsuarioSesion, @Body() cuerpo: unknown, @Res({ passthrough: true }) res: Response): Promise<DispositivoCreado> {
    exigirEnAlguno(u, 'escribir');
    const a: AltaValidada = validarAlta(cuerpo, this.reservados);
    await this.alcance.exigirZona(u, 'escribir', a.zona_id); // 404 si la zona no existe o es de otro sitio
    res.setHeader('Cache-Control', 'no-store'); // la respuesta lleva una credencial: ningún proxy ni navegador la guarda
    return this.alta.crear(a, u.id);
  }

  // Alta masiva por archivo (docs/19 §4, F2; docs/10 §8.4 punto 65 iv). `validar` no escribe nada; `crear` inserta las válidas en una transacción (dos sentencias).
  @Post('lote')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Alta por lote: validar o crear (Etapa 4)',
    description:
      `Recibe \`filas[{${COLUMNAS_LOTE.join(', ')}}]\` (el panel convierte el CSV; \`zona\` es el nombre o el UUID de una zona de un sitio donde la persona ` +
      'puede dar de alta; `canales` como «magnitud:unidad;magnitud:unidad», con la unidad canónica del catálogo; `pasarela`, su id_fisico o UUID, solo en ' +
      'la vía lorawan). Cada fila pasa por la misma validación del alta de a uno. Responde `validas, rechazadas, existentes` y ' +
      '`filas[{n, id_fisico, resultado, motivo, id, credencial, topico}]`, con `n` la fila del archivo (la 1 es la cabecera) y `resultado` en ' +
      '`valida | creada | rechazada | existe` (un id_fisico ya dado de alta, activo o no: `existe` con su id; reactivarlo es de su ficha). Con `modo=crear`, ' +
      `las válidas se crean en una transacción con dos sentencias (dispositivos, canales y credenciales; eventos), no N inserciones, y las credenciales vienen UNA sola vez. Hasta ${MAX_FILAS_LOTE} filas (más: 413), ` +
      `${LOTES_POR_MINUTO} lotes por minuto por persona (429) y una creación por lote a la vez (409). Un id_fisico que ya usa un dispositivo o una pasarela ` +
      'de otro sitio se rechaza como «identificador no disponible», sin id ni estado (RF-41). **Tiempo:** cada credencial cuesta un resumen scrypt; una creación ' +
      `de ${MAX_FILAS_LOTE} filas tarda ≈ 70 s (docs/16 §61) y detrás de un proxy puede cortarse antes de responder, y las credenciales se muestran una sola ` +
      `vez: el cliente debe validar el archivo entero y crear en tandas de ${TANDA_CLIENTE_LOTE} filas (≈ 7 s cada una), como hace el panel.`,
  })
  @ApiHeader({ name: 'X-Clave-Admin', required: false, description: 'Sin sesión: la clave de administrador (HTTP_CLAVE_ADMIN), como usuario del sistema (docs/20 §5)' })
  @ApiQuery({ name: 'modo', required: true, enum: MODOS_LOTE })
  @ApiOkResponse({ description: 'Informe fila por fila' })
  @ApiBadRequestResponse({ description: 'Modo o cuerpo inválidos' })
  @ApiForbiddenResponse({ description: 'Sin ningún sitio donde dar de alta, o sesión sin la cabecera X-Pedido: panel' })
  @ApiConflictResponse({ description: 'Otra creación por lote en curso' })
  @ApiResponse({ status: 413, description: `Más de ${MAX_FILAS_LOTE} filas` })
  @ApiResponse({ status: 429, description: 'Límite de tasa del lote' })
  async lote(@Usuario() u: UsuarioSesion, @Query('modo') m: unknown, @Body() cuerpo: unknown, @Res({ passthrough: true }) res: Response) {
    exigirEnAlguno(u, 'escribir');
    const modo = modoLote(m);
    if (!this.tasaLote.admitir(u.id ?? 'sistema')) throw new HttpException(`más de ${LOTES_POR_MINUTO} lotes en un minuto: espera un momento`, HttpStatus.TOO_MANY_REQUESTS);
    const filas = filasDelCuerpo(cuerpo);
    const sitios = alcanceDeLectura(u)?.filter((s) => permitir(u, 'escribir', s) === 'permitido') ?? null;
    const ids = filas.map((f) => (typeof f.id_fisico === 'string' ? f.id_fisico.trim().toLowerCase() : '')).filter((x) => x !== '');
    const catalogos = await this.alta.catalogosLote(sitios, ids);
    const { informe, altas } = validarLote(filas, catalogos, this.reservados);
    if (modo === 'crear' && altas.length > 0) {
      if (this.loteEnCurso) throw new ConflictException('hay otra alta por lote en curso: espera a que termine y vuelve a validar');
      this.loteEnCurso = true;
      try {
        const creadas = await this.alta.crearLote(altas, u.id);
        for (const f of informe) {
          const c = creadas.get(f.n);
          if (c !== undefined) Object.assign(f, { resultado: 'creada', id: c.id, credencial: c.credencial, topico: c.topico } satisfies Partial<FilaInforme>);
        }
      } finally {
        this.loteEnCurso = false;
      }
      res.setHeader('Cache-Control', 'no-store'); // la respuesta lleva credenciales
    }
    return { ...totales(informe), filas: informe };
  }

  // Configurar un dispositivo desde el panel (docs/19 §4, E; docs/10 §8.4 punto 28), con bloqueo optimista; responde la ficha.
  @Patch(':id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Configurar un dispositivo (Etapa 4)',
    description:
      'Cambia `nombre`, `estado` (activo o mantenimiento; la baja es DELETE), `intervalo_esperado_s` (5–86400) y `zona_id` (otra zona del mismo sitio). ' +
      '`actualizado_en` es obligatorio: el de la ficha, tal cual (microsegundos); si el dispositivo cambió desde entonces, 409 con el vigente y nada se pisa. ' +
      'Deja el evento `dispositivo_configurado` con lo que cambió (antes y después) y quién. Responde la ficha (`GET /dispositivos/{id}`). Validación: 400 con ' +
      '`errores[{campo, motivo}]`.',
  })
  @ApiHeader({ name: 'X-Clave-Admin', required: false, description: 'Sin sesión: la clave de administrador (HTTP_CLAVE_ADMIN), como usuario del sistema (docs/20 §5)' })
  @ApiParam({ name: 'id', description: 'UUID del dispositivo' })
  @ApiBody({
    schema: {
      type: 'object', required: ['actualizado_en'],
      properties: {
        actualizado_en: { type: 'string', pattern: FORMA_ACTUALIZADO_EN.source },
        nombre: { type: 'string', maxLength: 80 }, estado: { type: 'string', enum: ['activo', 'mantenimiento'] },
        intervalo_esperado_s: { type: 'integer', minimum: 5, maximum: 86400 }, zona_id: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiOkResponse({ description: 'La ficha del dispositivo, con su actualizado_en nuevo' })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido: `errores[{campo, motivo}]`' })
  @ApiForbiddenResponse({ description: 'Un perfil sin ese permiso en ese sitio (docs/20 §6), o sesión sin la cabecera X-Pedido: panel' })
  @ApiNotFoundResponse({ description: 'No existe, o es de otro sitio' })
  @ApiConflictResponse({ description: 'Cambió desde la ficha enviada (`actualizado_en` trae el vigente), o está dado de baja' })
  async configurar(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Body() cuerpo: unknown) {
    exigirEnAlguno(u, 'configurar');
    const dispositivoId = uuid(id, 'dispositivo');
    await this.alcance.exigirDispositivo(u, 'configurar', dispositivoId);
    await this.configuracion.cambiarDispositivo(dispositivoId, validarCambioDispositivo(cuerpo), u.id);
    return this.consulta.dispositivo(dispositivoId);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Dar de baja un dispositivo',
    description:
      'Baja lógica: `estado = baja`, credenciales revocadas, condiciones abiertas cerradas y evento `baja`, en una transacción; si la vía es ' +
      '`mqtt`, el cliente se borra del broker dentro de ella (un cliente que el broker ya no tiene cuenta como borrado). La fila y su historial ' +
      'quedan; lo que llegue después va a cuarentena como `dado_de_baja`. Exige sesión de administrador del sitio o del sistema, o `X-Clave-Admin` (docs/10 §3; docs/20 §6: el operador técnico no da de baja).',
  })
  @ApiHeader({ name: 'X-Clave-Admin', required: false, description: 'Sin sesión: la clave de administrador (HTTP_CLAVE_ADMIN), como usuario del sistema (docs/20 §5)' })
  @ApiParam({ name: 'id', description: 'UUID del dispositivo' })
  @ApiOkResponse({ description: 'Dado de baja: estado anterior, credenciales revocadas y condiciones cerradas' })
  @ApiBadRequestResponse({ description: 'UUID inválido' })
  @ApiUnauthorizedResponse({ description: 'Sin sesión ni X-Clave-Admin, o X-Clave-Admin incorrecta' })
  @ApiForbiddenResponse({ description: 'Un perfil sin ese permiso en ese sitio (docs/20 §6), o sesión sin la cabecera X-Pedido: panel' })
  @ApiNotFoundResponse({ description: 'No existe, o es de otro sitio' })
  @ApiConflictResponse({ description: 'Ya estaba dado de baja' })
  @ApiResponse({ status: 502, description: 'El broker no confirmó el borrado del cliente; nada cambió en la base' })
  @ApiResponse({ status: 503, description: 'Sin clave de administrador configurada, sin conexión de administración con el broker, u otra operación sobre el mismo dispositivo en curso' })
  @ApiResponse({ status: 429, description: 'Ya hay 2 operaciones de aprovisionamiento en curso (alta, baja o rotación); reintentar en un momento' })
  async darDeBaja(@Usuario() u: UsuarioSesion, @Param('id') id: string): Promise<DispositivoDadoDeBaja> {
    exigirEnAlguno(u, 'baja'); // la baja: solo quien administra el sitio (docs/20 §6; el operador técnico, no)
    const dispositivoId = uuid(id, 'dispositivo');
    await this.alcance.exigirDispositivo(u, 'baja', dispositivoId);
    return this.alta.darDeBaja(dispositivoId, u.id);
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
  @ApiForbiddenResponse({ description: 'Un perfil sin ese permiso en ese sitio (docs/20 §6), o sesión sin la cabecera X-Pedido: panel' })
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
    return this.alta.rotarCredencial(dispositivoId, u.id);
  }
}
