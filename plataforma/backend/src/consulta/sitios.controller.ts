import { BadRequestException, Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBadRequestResponse, ApiCookieAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CABECERA_X_SIGUIENTE, ISO_8601, INTERVALOS, MAX_CUBOS, MAX_DIAS_VENTANA, SEGUNDOS_INTERVALO, exigirTopeCubos, fecha, intervalo, limite, uuid } from './validacion.js';
import { DIAS_ACTIVIDAD_POR_DEFECTO, MAX_DIAS_ACTIVIDAD, tipoValido } from './actividad.js';
import { ActividadService, FilaActividad } from './actividad.service.js';
import { CUBOS_CHISPA, LIMITE_AHORA, MAGNITUDES_SALUD, MAX_CANALES_AHORA, TENDENCIA, intervaloParaRango, leerCursor, siguiente } from './tablero.js';
import { MAX_ENTREGA_RESUMEN, TableroService } from './tablero.service.js';

// El histórico del sitio lee TODOS los canales de la magnitud: medido en el banco (docs/16 §61), 30 días de 120 canales a una lectura cada
// 300 s (1 036 800 filas) tardan ≈ 1,1 s, ≈ 1 µs por lectura. Con el tope general de 366 días serían ≈ 13 s: se acota a 31 (un mes entero
// en la zona del sitio); más largo, por canal o con la exportación.
export const MAX_DIAS_SITIO = 31;
import { AlcanceService } from '../sesion/alcance.service.js';
import { Usuario } from '../sesion/guardia.js';
import { alcanceDeLectura } from '../sesion/permisos.js';
import type { UsuarioSesion } from '../sesion/permisos.js';

// Tablero del sitio (docs/19 §4, bloque «Tablero v2», B e I; docs/10 §8.4 punto 65). Lecturas con sesión: consulta o más en su sitio;
// un sitio de otro (o que no existe) responde 404 (RF-41). La ventana y la resolución se validan antes de tocar la base, con los mismos
// topes del histórico de un canal (5 000 cubos, 366 días).
@ApiTags('sitios')
@ApiCookieAuth('sesion')
@ApiUnauthorizedResponse({ description: 'sesión requerida' })
@Controller('sitios')
export class SitiosController {
  constructor(private readonly tablero: TableroService, private readonly alcance: AlcanceService, private readonly actividadSitio: ActividadService) {}

  @Get()
  @ApiOperation({
    summary: 'Mis sitios (Etapa 4)',
    description: 'Los sitios activos de la sesión con `id, codigo, nombre, zona_horaria, rol` (el perfil de la persona en ese sitio) y `zonas[{id, nombre}]`. El administrador del sistema y el usuario del sistema ven todos, con rol administrador (su perfil global va en `administrador_sistema` de GET /sesion).',
  })
  @ApiOkResponse({ description: 'Lista de sitios' })
  async listar(@Usuario() u: UsuarioSesion) {
    const filas = await this.tablero.sitios(alcanceDeLectura(u));
    return filas.map((s) => ({ ...s, rol: u.todos ? 'administrador' : (u.sitios.get(s.id) ?? 'consulta') }));
  }

  @Get(':id/resumen')
  @ApiOperation({
    summary: 'Resumen del sitio para el tablero (Etapa 4)',
    description:
      'Una consulta por petición (docs/10 §8.4 punto 65 iii). `sitio`, `ventana{desde, hasta, intervalo}`, `dispositivos{total, normal, alerta, sin_senal, inactivo}` ' +
      '(estado visual de docs/19 §2), `salud{reportan, supervisados, porcentaje}` (en línea ÷ no inactivos), `condiciones_abiertas[{tipo, n}]`, ' +
      '`tramas{recibidas, rechazadas, cubos[{tiempo, recibidas, rechazadas}]}` (tiempo en segundos Unix, como `tiempos` de los históricos; cubos en la zona del ' +
      'sitio; los cubos sin datos no se emiten: no son 0), ' +
      '`atencion[{id, nombre, estado_visual, visto_por_ultima_vez, tipos}]` (hasta diez, sin señal primero), `magnitudes[{codigo, nombre, unidad, canales}]` ' +
      `y \`entrega[{id, nombre, recibidas, esperadas, porcentaje}]\`: los ${MAX_ENTREGA_RESUMEN} dispositivos activos con peor entrega, de peor a mejor, y ` +
      '`total_activos`, cuántos hay (todos, en `GET /dispositivos?orden=entrega`). Porcentaje nulo si no hay una trama esperada completa en la ventana, contada ' +
      'desde su alta y dentro de la retención de tramas (medida desde ahora); 0 % si se esperaban y no llegó ninguna. Sin `intervalo`, el más fino que deja la ' +
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
      'Por cubo (time_bucket en la zona del sitio): `valores` (promedio), `minimos`, `maximos`, `muestras` (lecturas) y `n` (canales que aportan) de todos ' +
      'los canales de esa magnitud del sitio; `dispositivos`, cuántos aportan en la ventana. La forma del histórico de un canal más esos campos, con ' +
      '`magnitud` y `unidad`; sin calibración (`escala` y `porcentajes` nulos). `tiempos` en segundos Unix; los cubos sin datos no se emiten (no son 0). Topes: ' +
      MAX_CUBOS + ' cubos y ' + MAX_DIAS_SITIO + ' días (menos que los ' + MAX_DIAS_VENTANA + ' de un canal: lee todos los canales de la magnitud; medido en docs/16 §61).',
  })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiQuery({ name: 'magnitud', required: true, description: 'Código del catálogo (temperatura, humedad, …)' })
  @ApiQuery({ name: 'desde', required: false, description: `${ISO_8601}; por defecto hasta − 24 h` })
  @ApiQuery({ name: 'hasta', required: false, description: `${ISO_8601}; por defecto ahora` })
  @ApiQuery({ name: 'intervalo', required: false, enum: INTERVALOS, description: 'Por defecto 15 minutes' })
  @ApiOkResponse({ description: 'Serie agregada del sitio' })
  @ApiBadRequestResponse({ description: `UUID, fecha, intervalo o magnitud inválidos, o una ventana de más de ${MAX_DIAS_SITIO} días o de más de ${MAX_CUBOS} cubos` })
  @ApiNotFoundResponse({ description: 'Sitio inexistente o de otro' })
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
      'en él (accesos), mezclados del más reciente al más antiguo: `id, instante, clase (evento|acceso), tipo, texto, usuario{id, nombre}|null, dispositivo{id, nombre}|null`. ' +
      'Sin correos ni direcciones IP. Filtros: `tipo` (un tipo de evento o un resultado de acceso), `usuario` (UUID) y [desde, hasta) (por defecto, los últimos ' +
      `${DIAS_ACTIVIDAD_POR_DEFECTO} días; hasta ${MAX_DIAS_ACTIVIDAD}). Página por clave: la cabecera \`X-Siguiente\` trae el cursor de la siguiente. ` +
      'Administrador del sitio en sus sitios; administrador del sistema en todos; los demás perfiles, 403; otro sitio, 404.',
  })
  @ApiParam({ name: 'id', description: 'UUID del sitio' })
  @ApiQuery({ name: 'desde', required: false, description: `${ISO_8601}; por defecto hasta − ${DIAS_ACTIVIDAD_POR_DEFECTO} días` })
  @ApiQuery({ name: 'hasta', required: false, description: `${ISO_8601}; por defecto ahora` })
  @ApiQuery({ name: 'tipo', required: false, description: 'Tipo de evento (alta, baja, reglas_cambiadas, …) o resultado de acceso (ok, cierre, clave_incorrecta, bloqueado, inactivo)' })
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
