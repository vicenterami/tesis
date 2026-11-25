import { Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, HttpException, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse,
  ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AltaValidada, FORMATOS_DIRECTOS, FORMA_ID_FISICO, MAX_CANALES, VIAS, validarAlta } from './alta.dto.js';
import { AltaService, CredencialRotada, DispositivoCreado, DispositivoDadoDeBaja } from './alta.service.js';
import { uuid } from '../consulta/validacion.js';
import { AlcanceService } from '../sesion/alcance.service.js';
import { Usuario } from '../sesion/guardia.js';
import { alcanceDeLectura, exigirEnAlguno, permitir } from '../sesion/permisos.js';
import { ConfiguracionService } from './configuracion.service.js';
import { validarCambioDispositivo } from './configuracion.dto.js';
import { FORMA_ACTUALIZADO_EN } from './calibracion.dto.js';
import { ConsultaService } from '../consulta/consulta.service.js';
import {
  CABECERA_LLAVE, COLUMNAS_LOTE, ChoqueDeLote, LOTES_POR_MINUTO, REINTENTOS_POR_MINUTO, MAX_BYTES_LOTE, MAX_FILAS_LOTE, MODOS_LOTE, RespuestasPorLlave, TasaPorPersona, filasDelCuerpo,
  MAX_ZONAS_NUEVAS_LOTE, candidatasZonasNuevas, destinoDe, firmaDelCuerpo, huellaDelPlan, llaveDeReintento, modoLote, plantillaLote, respuestaLote, validarLote,
  zonasNuevasDelLote, zonasNuevasEn,
} from './lote.js';
import type { FilaEntrada, FilaInforme, PlantillaLote, RespuestaLote, ZonasNuevasExcedidas } from './lote.js';
import type { UsuarioSesion } from '../sesion/permisos.js';

// Aprovisionamiento por API (docs/10 §3, §8.4 puntos 41 y 42; docs/19 P7 «Propuesta»): POST /dispositivos (HU-11, RF-19),
// DELETE /dispositivos/{id} (baja) y POST /dispositivos/{id}/credencial (rotación por dispositivo; RF-45 pide rotar la credencial de recepción de un SITIO sin
// interrumpir el servicio, que aún no existe: esta la interrumpe para ese dispositivo hasta que cargue la nueva). Desde el 08/11/2026 (M7, docs/20 §5)
// las protege el guardia central: sesión de administrador del sitio del dispositivo (o de la zona, en el alta) o la clave de administrador. El
// orden no cambia: sin sesión, 401 antes de mirar nada; con rol de consulta en todos sus sitios, 403 antes de validar; después, el
// sitio del recurso: 404 si no existe o es de otro sitio (RF-41), 403 si es suyo y su rol no puede.
// El 429 del lote, con cuánto esperar (`reintentar_en_s` y `codigo`, aditivos: revisión del 15/11/2026; el panel ya lee `reintentar_en_s`).
function demasiadas(texto: string, esperaS: number): HttpException {
  return new HttpException({ statusCode: 429, error: 'Too Many Requests', codigo: 'demasiadas_peticiones', reintentar_en_s: esperaS, message: `${texto}: reintenta en ${esperaS} s` }, HttpStatus.TOO_MANY_REQUESTS);
}

// El 409 de un plan que cambió entre la vista previa y la creación (docs/19 §4, N8): el plan nuevo va en `plan`; nada se creó.
function planCambio(plan: RespuestaLote): HttpException {
  return new HttpException({ statusCode: 409, error: 'Conflict', codigo: 'plan_cambio', message: 'el plan cambió desde que lo revisaste: revísalo de nuevo; no se creó ninguno', plan }, HttpStatus.CONFLICT);
}

// El choque que solo ve la base cuando el plan recalculado es EL MISMO (misma huella y todas las filas siguen entrando): no es un plan que
// cambió, y responder `plan_cambio` llevaría a la persona a confirmar lo mismo una y otra vez (corregido el 24/11/2026). Su caso típico es
// una zona nueva que choca con el índice normalizado de la base sin que el cálculo en memoria lo vea (docs/19 §4 U2 punto 1); el plan ya
// agrupa las candidatas y pregunta a la base con su propia normalización, así que queda como defensa ante lo que el plan no alcance a ver.
export const CHOQUE_SIN_CAMBIO = 'Una zona nueva del archivo coincide con otra (del mismo archivo o del sitio) que solo cambia en mayúsculas o espacios. Escríbela igual en todas las filas y vuelve a validar.';
function choqueSinCambio(): HttpException {
  return new HttpException({ statusCode: 409, error: 'Conflict', codigo: 'choque_sin_cambio', message: CHOQUE_SIN_CAMBIO }, HttpStatus.CONFLICT);
}

@ApiTags('dispositivos')
@ApiCookieAuth('sesion')
@Controller('dispositivos')
export class AltaController {
  // El usuario de la sonda del chequeo de salud es configurable (MQTT_SONDA_USUARIO): también queda reservado.
  private readonly reservados: string[];
  private readonly tasaLote = new TasaPorPersona();
  private readonly tasaReintentos = new TasaPorPersona(REINTENTOS_POR_MINUTO);
  private readonly respuestasLote = new RespuestasPorLlave<RespuestaLote>();
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
        decodificador: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{2,62}$', nullable: true, description: 'Solo vía lorawan: el código de una receta de decodificación (GET /recetas-decodificacion) con que la plataforma decodifica la carga cuando la pasarela la entrega sin decodificar' },
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

  // Alta masiva (docs/19 §4, F2 y bloque N; docs/10 §8.4 puntos 65 iv y 67). `validar` no escribe nada y devuelve el plan por fila con su
  // huella; `crear` recibe las filas confirmadas, la huella y una llave de reintento, vuelve a calcular y crea todo o nada.
  @Post('lote')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Alta por lote: vista previa o creación, todo o nada (Etapa 4)',
    description:
      `Recibe \`filas[{n, ${COLUMNAS_LOTE.join(', ')}}]\`: \`n\` es la fila del origen (en un CSV, la línea contando las vacías, con la cabecera en la 1; en ` +
      'JSON, la posición más 1), un entero positivo, único y creciente, que se devuelve tal cual. Columnas, topes y ejemplos en ' +
      '`GET /dispositivos/lote/plantilla`; `zona` es el nombre o el UUID de una zona de un sitio donde la persona puede dar de alta; `canales`, ' +
      '«magnitud:unidad | magnitud:unidad» (también con «;»), con la unidad del catálogo (`GET /magnitudes`) o una escritura común de la misma («°C», «ºC», «C» o «degC» por Cel; ' +
      '«%» por la unidad porcentual de la magnitud), que se guarda como la del catálogo, con aviso; `pasarela`, su id_fisico o UUID, ' +
      'solo en la vía lorawan. Cada fila pasa por la misma validación del alta de a uno. Responde `leidas, validas, existentes, rechazadas, con_aviso, ' +
      'huella` (validas + existentes + rechazadas = leidas; solo las filas que entran traen avisos), `zonas_por_nombre[{zona, sitio, filas, nueva?}]` (las zonas escritas ' +
      'por su nombre en las filas que entran; `nueva: true` si el lote la creará) y `filas[{n, id_fisico, resultado, interpretada, legible, por_defecto, ' +
      'avisos[{campo, texto}], motivos[{campo, texto}], motivo, id, credencial, topico}]`: el `texto` de avisos y motivos está en palabras para personas y `campo` ' +
      'nombra la columna; `legible` es lo interpretado como se lee (`donde`, `resumen` y `campos`) o null; `interpretada` es lo que se creará (identificador normalizado, ' +
      'nombre, sitio, zona, vía, formato resuelto, intervalo, canales con nombre y unidad, pasarela, decodificador y tópico) o null; `motivo`, la unión de ' +
      '`motivos`; `resultado` en `valida | creada | rechazada | existe`. `huella` es el SHA-256 de `[n, interpretada]` de las filas que entran, en orden ' +
      '(JSON con las claves ordenadas). Cada celda, dentro de su tope, sin caracteres de control y, salvo `nombre` y `zona`, solo ASCII imprimible (en `canales`, ' +
      'también «°» y «º», y el tope en bytes UTF-8); una ' +
      'columna que no es de la plantilla es 400. **Con `modo=crear`** el ' +
      'cuerpo trae también `huella` (la de la vista previa) y la cabecera `Idempotency-Key`; se vuelve a calcular y, si el plan cambió (una fila dejó de ' +
      'entrar o crearía otra cosa) o alguna fila no entra o ya existe, 409 `codigo: plan_cambio` con el plan nuevo en `plan` y nada creado; si no, todas se crean en una transacción ' +
      '(dos sentencias) y las credenciales vienen UNA sola vez. Repetir con la misma llave y el mismo cuerpo, durante 2 minutos, devuelve la misma ' +
      `respuesta sin crear nada (con su propio cupo de ${REINTENTOS_POR_MINUTO} por minuto, y si la persona conserva el permiso en los sitios de lo creado). Hasta ${MAX_FILAS_LOTE} filas (más: 413) y ${MAX_BYTES_LOTE} bytes de cuerpo, ${LOTES_POR_MINUTO} lotes por minuto por persona (429) y ` +
      'una creación a la vez (409 `codigo: lote_en_curso`). Un id_fisico que ya usa un dispositivo o una pasarela de otro sitio se rechaza como ' +
      '«ese identificador ya está en uso en la plataforma: elige otro», sin id, estado ni `interpretada` (RF-41). En `crear`, cada fila creada trae ' +
      '`destino`, a dónde envía según su vía: el tópico MQTT, «POST /recepcion/<id_fisico>» o «por su pasarela <id_fisico>». ' +
      '**Zonas nuevas** (docs/19 §4 U2): con `zonas_nuevas_en` (el UUID de un sitio donde la persona tiene la acción `ajustes`; si no, 403; ajeno o inexistente, 404), ' +
      'una zona escrita por su nombre que no existe en los sitios de la persona entra como zona nueva de ese sitio (una por nombre, sin distinguir mayúsculas ni ' +
      'espacios en los extremos) y se crea en la misma transacción, con su evento `zona_alta`. No se ofrece como nueva: la que coincide con una zona retirada ' +
      '(«está retirada»), la que la base ya tiene en ese sitio escrita de otra forma («ya existe en el sitio con otra escritura») ni la que trae un carácter ' +
      `invisible. Más de ${MAX_ZONAS_NUEVAS_LOTE} zonas nuevas distintas: no se ofrece ninguna y la respuesta (también el \`plan\` del 409) suma ` +
      `\`zonas_nuevas_excedidas: {pedidas, maximo}\` (maximo = ${MAX_ZONAS_NUEVAS_LOTE}). Si al crear la base rechaza algo que el plan recalculado no ve (misma huella y ` +
      'todas las filas entran), 409 `codigo: choque_sin_cambio`, sin `plan` y nada creado.',
  })
  @ApiBody({
    schema: {
      type: 'object', required: ['filas'],
      properties: {
        filas: { type: 'array', minItems: 1, maxItems: MAX_FILAS_LOTE, items: { type: 'object', required: ['n'], properties: { n: { type: 'integer', minimum: 1 } }, additionalProperties: { type: 'string' } } },
        huella: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'Obligatoria con modo=crear: la de la vista previa' },
        zonas_nuevas_en: { type: 'string', format: 'uuid', description: 'Opcional: el sitio donde crear las zonas que falten; exige la acción `ajustes` en ese sitio (403); ajeno o inexistente, 404' },
      },
    },
  })
  @ApiHeader({ name: 'X-Clave-Admin', required: false, description: 'Sin sesión: la clave de administrador (HTTP_CLAVE_ADMIN), como usuario del sistema (docs/20 §5)' })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Obligatoria con modo=crear: de 16 a 128 caracteres entre letras, dígitos, «-» y «_», generada por el cliente para cada creación' })
  @ApiQuery({ name: 'modo', required: true, enum: MODOS_LOTE })
  @ApiOkResponse({ description: 'El plan fila por fila (en crear, con las credenciales una sola vez)' })
  @ApiBadRequestResponse({ description: 'Modo o cuerpo inválidos (una celda sobre su tope, que no es texto ni número o con NUL; `n` que no es entero creciente; sin huella o sin Idempotency-Key en crear): `message` dice la fila' })
  @ApiForbiddenResponse({ description: 'Sin ningún sitio donde dar de alta, sin la acción `ajustes` en el sitio de `zonas_nuevas_en`, sesión sin la cabecera X-Pedido: panel, o un reintento de quien ya no puede dar de alta en un sitio de lo creado' })
  @ApiNotFoundResponse({ description: 'El sitio de `zonas_nuevas_en` no existe, está inactivo o es de otro (RF-41)' })
  @ApiConflictResponse({ description: '`codigo: plan_cambio` (con el plan nuevo en `plan`, que puede traer `zonas_nuevas_excedidas`; nada creado), `codigo: choque_sin_cambio` (la base rechazó algo que el plan no ve, por ejemplo una zona nueva que ya existe con otra escritura; nada creado) o `codigo: lote_en_curso`' })
  @ApiUnauthorizedResponse({ description: 'Sin sesión (sin la cookie de sesión ni X-Clave-Admin, antes de leer el cuerpo), o sesión inválida' })
  @ApiResponse({ status: 413, description: `Más de ${MAX_FILAS_LOTE} filas o de ${MAX_BYTES_LOTE} bytes (solo con POST; otro método, 100 KiB)` })
  @ApiResponse({ status: 422, description: '`codigo: llave_reutilizada`: la Idempotency-Key ya se usó con otro cuerpo' })
  @ApiResponse({ status: 429, description: `Límite de tasa: ${LOTES_POR_MINUTO} lotes por minuto por persona; los reintentos, ${REINTENTOS_POR_MINUTO} aparte` })
  @ApiResponse({ status: 503, description: 'No se pudo confirmar si el lote quedó creado (el COMMIT falló y la base no respondió): revisar el inventario y rotar la credencial de los que aparezcan' })
  async lote(
    @Usuario() u: UsuarioSesion, @Query('modo') m: unknown, @Body() cuerpo: unknown, @Headers(CABECERA_LLAVE) cabeceraLlave: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RespuestaLote> {
    exigirEnAlguno(u, 'escribir');
    const modo = modoLote(m);
    const persona = u.id ?? 'sistema';
    // Primero la tasa, antes de firmar el cuerpo (revisión del 15/11/2026). Un reintento de una creación guardada gasta su propio cupo y
    // no el de los lotes: así una respuesta perdida no queda tras un 429, pero repetirla tampoco es gratis.
    let llave = '';
    if (modo === 'crear') {
      llave = llaveDeReintento(cabeceraLlave);
      if (this.respuestasLote.tiene(persona, llave)) {
        if (!this.tasaReintentos.admitir(persona)) throw demasiadas(`más de ${REINTENTOS_POR_MINUTO} reintentos en un minuto`, this.tasaReintentos.esperaS(persona));
        const previa = this.respuestasLote.buscar(persona, llave, firmaDelCuerpo(cuerpo));
        if (previa !== undefined) {
          // Solo si la persona conserva «escribir» en todos los sitios de lo creado (un rol quitado en esos 2 minutos corta el reintento).
          if (previa.sitios.some((s) => permitir(u, 'escribir', s) !== 'permitido')) throw new ForbiddenException('tu rol ya no permite dar de alta en un sitio de este lote');
          res.setHeader('Cache-Control', 'no-store');
          return previa.respuesta;
        }
      }
    }
    if (!this.tasaLote.admitir(persona)) throw demasiadas(`más de ${LOTES_POR_MINUTO} lotes en un minuto`, this.tasaLote.esperaS(persona));
    const { filas, huella } = filasDelCuerpo(cuerpo, modo);
    const sitioZonas = zonasNuevasEn(cuerpo);
    if (sitioZonas !== null) await this.alcance.exigirSitio(u, 'ajustes', sitioZonas); // crear zonas: `ajustes` en ese sitio (U2); 404 si es de otro
    if (modo === 'validar') {
      const plan = await this.planLote(u, filas, sitioZonas);
      return respuestaLote(plan.informe, plan.zonas, plan.excedidas);
    }
    const firma = firmaDelCuerpo(cuerpo);
    // Una creación a la vez, y el plan se recalcula dentro del candado: dos creaciones no se pisan entre la lectura y la inserción.
    if (this.loteEnCurso) throw new HttpException({ statusCode: 409, error: 'Conflict', codigo: 'lote_en_curso', message: 'hay otra alta por lote en curso: espera a que termine y vuelve a intentarlo' }, HttpStatus.CONFLICT);
    this.loteEnCurso = true;
    try {
      const { informe, altas, zonas, excedidas } = await this.planLote(u, filas, sitioZonas);
      // Todo o nada al pie de la letra (revisión del 15/11/2026): en `crear` toda fila debe entrar; una que no entra o que ya existe es un
      // plan distinto del confirmado, aunque la huella (que solo mira las que entran) coincida.
      if (huellaDelPlan(informe) !== huella || informe.some((f) => f.resultado !== 'valida')) throw planCambio(respuestaLote(informe, zonas, excedidas));
      let creadas: Awaited<ReturnType<AltaService['crearLote']>>;
      try {
        creadas = await this.alta.crearLote(altas, u.id);
      } catch (e) {
        if (!(e instanceof ChoqueDeLote)) throw e;
        const nuevo = await this.planLote(u, filas, sitioZonas);
        if (huellaDelPlan(nuevo.informe) === huella && nuevo.informe.every((f) => f.resultado === 'valida')) throw choqueSinCambio();
        throw planCambio(respuestaLote(nuevo.informe, nuevo.zonas, nuevo.excedidas));
      }
      for (const f of informe) {
        const c = creadas.get(f.n);
        if (c !== undefined && f.interpretada !== null) {
          Object.assign(f, { resultado: 'creada', id: c.id, credencial: c.credencial, topico: c.topico, destino: destinoDe(f.interpretada) } satisfies Partial<FilaInforme>);
        }
      }
      const respuesta = respuestaLote(informe, zonas, excedidas);
      // Solo se guarda lo que creó algo (siempre, desde que toda fila debe entrar), con los sitios de lo creado.
      if (creadas.size > 0) this.respuestasLote.guardar(persona, llave, firma, respuesta, [...new Set(altas.map((a) => a.sitio_id))], Buffer.byteLength(JSON.stringify(respuesta)));
      res.setHeader('Cache-Control', 'no-store'); // la respuesta lleva credenciales
      return respuesta;
    } finally {
      this.loteEnCurso = false;
    }
  }

  // Los catálogos (una vez para todo el archivo: seis consultas, ninguna por fila) y el plan de cada fila.
  // Con `sitioZonas` (U2, ya autorizado), las zonas escritas por su nombre que no existen en ningún sitio de la persona se suman al catálogo
  // como zonas nuevas de ese sitio: entran, y crearLote las inserta en la misma transacción. Su id provisional (`nueva:<nombre>`) entra en
  // la huella, así que el plan confirmado es el mismo que se vio. Dos consultas más: el sitio, y cuáles de las candidatas ya existen en él
  // según la base (las que sí, no se ofrecen y la fila dice por qué). Más de MAX_ZONAS_NUEVAS_LOTE: ninguna, y `excedidas`.
  private async planLote(u: UsuarioSesion, filas: FilaEntrada[], sitioZonas: string | null = null): Promise<ReturnType<typeof validarLote> & { excedidas: ZonasNuevasExcedidas | null }> {
    const sitios = alcanceDeLectura(u)?.filter((s) => permitir(u, 'escribir', s) === 'permitido') ?? null;
    const ids = filas.map((f) => (typeof f.id_fisico === 'string' ? f.id_fisico.trim().toLowerCase() : '')).filter((x) => x !== '');
    const cat = await this.alta.catalogosLote(sitios, ids);
    if (sitioZonas === null) return { ...validarLote(filas, cat, this.reservados), excedidas: null };
    const sitio = await this.alta.sitioParaZonasNuevas(sitioZonas);
    const enLaBase = await this.alta.zonasEnLaBase(sitio.id, candidatasZonasNuevas(filas, cat.zonas));
    const nuevas = zonasNuevasDelLote(filas, cat.zonas, sitio, enLaBase);
    return { ...validarLote(filas, { ...cat, zonas: [...cat.zonas, ...nuevas.zonas], zonasNoOfrecidas: nuevas.noOfrecidas }, this.reservados), excedidas: nuevas.excedidas };
  }

  // La plantilla del lote (docs/19 §4, N4): la única casa de las columnas, sus topes, `max_filas`, `max_bytes` y los separadores. La lee
  // quien puede usar la ruta del lote (la acción «escribir», docs/20 §6).
  @Get('lote/plantilla')
  @ApiOperation({
    summary: 'Plantilla del alta por lote (Etapa 4)',
    description: 'Las columnas del lote en su orden (`nombre, obligatoria, tope` en caracteres, `texto_libre, ayuda, ejemplo`, `rotulo` para las personas y `simbolos`, lo que una columna de códigos admite además del ASCII, con el tope en bytes UTF-8), `max_filas`, `max_bytes` (el tope del cuerpo de POST /dispositivos/lote) y `separadores{columnas, canales}`. Exige el permiso de dar de alta en algún sitio (docs/20 §6).',
  })
  @ApiOkResponse({ description: 'La plantilla' })
  @ApiUnauthorizedResponse({ description: 'sesión requerida' })
  @ApiForbiddenResponse({ description: 'Sin ningún sitio donde dar de alta' })
  async plantilla(@Usuario() u: UsuarioSesion): Promise<PlantillaLote> {
    exigirEnAlguno(u, 'escribir');
    return plantillaLote(await this.alta.recetas());
  }

  // Configurar un dispositivo desde el panel (docs/19 §4, E; docs/10 §8.4 punto 28), con bloqueo optimista; responde la ficha.
  @Patch(':id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Configurar un dispositivo (Etapa 4)',
    description:
      'Cambia `nombre`, `estado` (activo o mantenimiento; la baja es DELETE), `intervalo_esperado_s` (5–86400), `zona_id` (otra zona del mismo sitio) y, en un nodo lorawan, `decodificador` (una receta del catálogo, o null). ' +
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
        decodificador: { type: 'string', nullable: true, pattern: '^[a-z0-9][a-z0-9-]{2,62}$', description: 'Solo vía lorawan: la receta de decodificación (GET /recetas-decodificacion); null la quita (TT-12)' },
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
