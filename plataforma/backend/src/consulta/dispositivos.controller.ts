import { BadRequestException, Controller, Get, HttpException, HttpStatus, Logger, Param, Query, Res } from '@nestjs/common';
import { once } from 'node:events';
import {
  ApiBadRequestResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiQuery, ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ConsultaService } from './consulta.service.js';
import { CABECERA_CSV, FORMATOS, filaCsv, filaJson, formato, nombreDeArchivo, rangoRazonable } from './exportar.js';

// Exportaciones simultáneas admitidas por proceso: cada una ocupa una conexión a la base durante toda la descarga.
export const MAX_EXPORTACIONES = 2;
import { CABECERA_X_SIGUIENTE, CABECERA_X_TOTAL, ISO_8601, INTERVALOS, MAX_CUBOS, MAX_DIAS_VENTANA, fecha, limite, uuid } from './validacion.js';
import { ORDENES_INVENTARIO, filtroInventario, leerCursor, siguiente } from './tablero.js';
import { TableroService } from './tablero.service.js';
import { ventana } from './sitios.controller.js';
import { AlcanceService } from '../sesion/alcance.service.js';
import { Usuario } from '../sesion/guardia.js';
import { alcanceDeLectura, permitir } from '../sesion/permisos.js';
import type { UsuarioSesion } from '../sesion/permisos.js';

// «Quién hizo el cambio» (evento.usuario_id) es un dato personal (docs/21 §2; decidido el 11/11/2026): el nombre lo ven quienes administran
// el sitio (la acción `usuarios`: administrador de ese sitio y usuario del sistema); los demás perfiles reciben `usuario: null`.
export function verAutor(u: UsuarioSesion, sitio: string): boolean {
  return permitir(u, 'usuarios', sitio) === 'permitido';
}
export function conAutor<T extends { usuario: unknown }>(filas: readonly T[], ver: boolean): T[] {
  return ver ? [...filas] : filas.map((f) => ({ ...f, usuario: null }));
}

// Lecturas con sesión (docs/20 §6, desde el 08/11/2026): 401 sin sesión; la lista sale filtrada por los sitios del usuario en el WHERE;
// un dispositivo de otro sitio responde 404, igual que uno inexistente (RF-41); exportar, administrador de sitio o del sistema e investigador
// (403 a consulta y operador técnico; docs/20 §6, desde el 11/11/2026).
@ApiTags('dispositivos')
@ApiCookieAuth('sesion')
@ApiUnauthorizedResponse({ description: 'sesión requerida' })
@Controller('dispositivos')
export class DispositivosController {
  private readonly log = new Logger('exportar');
  private exportacionesEnCurso = 0;
  constructor(private readonly consulta: ConsultaService, private readonly alcance: AlcanceService, private readonly tablero: TableroService) {}

  // Inventario con estado: base de la vista "salud del sitio" (HU-19).
  @Get()
  @ApiOperation({
    summary: 'Inventario de dispositivos con estado',
    description:
      'Cada dispositivo de los sitios del usuario con su sitio y zona (nombres, y `sitio_codigo` y `zona_id` para filtrar: los nombres pueden repetirse), zona ' +
      'horaria, canales, `en_linea` (última trama hace menos de 2 × intervalo esperado), número de condiciones abiertas, `estado_visual` (docs/19 §2: ' +
      'inactivo, sin_senal, alerta o normal) y `entrega` (% de tramas recibidas sobre las esperadas en las últimas 24 h, acotado a 100; nulo si no hay una ' +
      'trama esperada completa en la ventana). Filtros opcionales en el servidor (docs/19 §4, C) y, con `limite` o `desplazamiento`, una página; el total ' +
      'que cumple los filtros va en la cabecera `X-Total` (Etapa 4). Sin parámetros, la lista completa como antes. `entrega` usa siempre una ventana fija de 24 h ' +
      '(la del resumen del sitio es la del rango pedido); `orden=entrega` ordena de peor a mejor con los nulos al final; `orden=atencion`, por estado visual ' +
      '(sin señal, alerta, normal, inactivo) y nombre.',
  })
  @ApiQuery({ name: 'sitio', required: false, description: 'UUID del sitio' })
  @ApiQuery({ name: 'zona', required: false, description: 'UUID de la zona' })
  @ApiQuery({ name: 'via', required: false, enum: ['mqtt', 'http', 'lorawan'] })
  @ApiQuery({ name: 'estado', required: false, enum: ['inactivo', 'sin_senal', 'alerta', 'normal'], description: 'Estado visual' })
  @ApiQuery({ name: 'q', required: false, description: 'Busca en id_fisico y nombre, sin distinguir mayúsculas (hasta 80 caracteres)' })
  @ApiQuery({ name: 'orden', required: false, enum: ORDENES_INVENTARIO, description: 'nombre (por defecto: sitio, zona, nombre), entrega (de peor a mejor, nulos al final) o atencion (sin señal, alerta, normal, inactivo; dentro, por nombre)' })
  @ApiQuery({ name: 'limite', required: false, description: '1–500; con desplazamiento y sin limite, 50' })
  @ApiQuery({ name: 'desplazamiento', required: false, description: 'Filas a saltar (0 por defecto)' })
  @ApiOkResponse({ description: 'Lista de dispositivos; cabecera X-Total con el total que cumple los filtros', headers: { ...CABECERA_X_TOTAL } })
  @ApiBadRequestResponse({ description: 'Un filtro inválido' })
  async listar(@Usuario() u: UsuarioSesion, @Query() parametros: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const r = await this.consulta.inventario(alcanceDeLectura(u), filtroInventario(parametros));
    res.setHeader('X-Total', String(r.total));
    return r.filas;
  }

  // GET /dispositivos/:id/historico — todos los canales del dispositivo en una respuesta, alineados por cubo (docs/19 §4, D2).
  @Get(':id/historico')
  @ApiOperation({
    summary: 'Histórico de todos los canales de un dispositivo (Etapa 4)',
    description:
      '`tiempos` (segundos Unix, la unión de los cubos de todos los canales) y `canales[{id, magnitud, magnitud_nombre, unidad, valores, minimos, maximos, muestras}]`, ' +
      'con null donde un canal no tiene dato en ese cubo (y 0 en `muestras`, las lecturas del cubo). Los cubos sin datos de ningún canal no se emiten (no son 0). time_bucket en la zona del sitio; rango semiabierto; mismos topes que el histórico de un canal ' +
      `(${MAX_CUBOS} cubos, ${MAX_DIAS_VENTANA} días). Por defecto, las últimas 24 h cada 15 minutos.`,
  })
  @ApiParam({ name: 'id', description: 'UUID del dispositivo' })
  @ApiQuery({ name: 'desde', required: false, description: `${ISO_8601}; por defecto hasta − 24 h` })
  @ApiQuery({ name: 'hasta', required: false, description: `${ISO_8601}; por defecto ahora` })
  @ApiQuery({ name: 'intervalo', required: false, enum: INTERVALOS })
  @ApiOkResponse({ description: 'Series alineadas' })
  @ApiBadRequestResponse({ description: 'UUID, fecha o intervalo inválidos, o ventana excesiva' })
  @ApiNotFoundResponse({ description: 'No existe, o es de otro sitio' })
  async historico(@Usuario() u: UsuarioSesion, @Param('id') id: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string, @Query('intervalo') inter?: string) {
    const { d, h, i } = ventana(desde, hasta, inter, false);
    const dispositivoId = uuid(id, 'dispositivo');
    await this.alcance.exigirDispositivo(u, 'leer', dispositivoId);
    return this.tablero.historicoDispositivo(dispositivoId, d, h, i);
  }

  // GET /dispositivos/:id/eventos — historial del dispositivo por cursor (docs/19 §4, D5; docs/10 §8.4 punto 58).
  @Get(':id/eventos')
  @ApiOperation({
    summary: 'Eventos de un dispositivo, por páginas (Etapa 4)',
    description:
      '`id, tipo, detalle, ocurrido_en, usuario{id, nombre}|null` (quién lo hizo, si fue una persona: HU-11; el nombre lo reciben solo el administrador de ese ' +
      'sitio y el del sistema, los demás perfiles reciben `usuario: null`: docs/21 §2), del más reciente al más antiguo, en [desde, hasta) ' +
      '(por defecto, los últimos 30 días). Página por clave: si hay más, la cabecera `X-Siguiente` trae el cursor que se devuelve tal cual en `cursor`.',
  })
  @ApiParam({ name: 'id', description: 'UUID del dispositivo' })
  @ApiQuery({ name: 'desde', required: false, description: `${ISO_8601}; por defecto hasta − 30 días` })
  @ApiQuery({ name: 'hasta', required: false, description: `${ISO_8601}; por defecto ahora` })
  @ApiQuery({ name: 'limite', required: false, description: '1–500, por defecto 50' })
  @ApiQuery({ name: 'cursor', required: false, description: 'El de la cabecera X-Siguiente de la página anterior' })
  @ApiOkResponse({ description: 'Lista de eventos; X-Siguiente si hay otra página', headers: { ...CABECERA_X_SIGUIENTE } })
  @ApiBadRequestResponse({ description: 'UUID, fecha, límite o cursor inválidos' })
  @ApiNotFoundResponse({ description: 'No existe, o es de otro sitio' })
  async eventos(
    @Usuario() u: UsuarioSesion, @Param('id') id: string, @Res({ passthrough: true }) res: Response,
    @Query('desde') desde?: string, @Query('hasta') hasta?: string, @Query('limite') lim?: string, @Query('cursor') cursor?: string,
  ) {
    const h = fecha(hasta, new Date(), 'hasta');
    const d = fecha(desde, new Date(h.getTime() - 30 * 86_400_000), 'desde');
    const l = limite(lim);
    const c = leerCursor(cursor);
    const dispositivoId = uuid(id, 'dispositivo');
    const sitio = await this.alcance.exigirDispositivo(u, 'leer', dispositivoId);
    const filas = await this.tablero.eventosDispositivo(dispositivoId, d, h, l, c);
    const sig = siguiente(filas, l, (f) => ({ t: f.ocurrido_en, id: f.id }));
    if (sig !== null) res.setHeader('X-Siguiente', sig);
    return conAutor(filas, verAutor(u, sitio));
  }

  // Ficha completa: canales, reglas, última medición y condiciones abiertas (HU-21).
  @Get(':id')
  @ApiOperation({
    summary: 'Ficha de un dispositivo',
    description:
      'Canales con sus reglas de umbral y última medición, y condiciones abiertas. `intervalo_observado_s` (entero o null): mediana, ' +
      'en segundos, de las diferencias entre los instantes de recepción (truncados al segundo) de las últimas 20 tramas del ' +
      'dispositivo; null con menos de 3 instantes o sin tramas retenidas (RETENCION_TRAMA_DIAS, 30 días por defecto). Informa: la alarma de silencio ' +
      'usa `intervalo_esperado_s`. Por canal: `escala_cero` y `escala_cien` (calibración; null sin ella), `porcentaje` en la última ' +
      'medición, y `actualizado_en` (ISO 8601 UTC con microsegundos), el que se manda tal cual en `PATCH /canales/{id}` (bloqueo optimista).',
  })
  @ApiParam({ name: 'id', description: 'UUID del dispositivo' })
  @ApiOkResponse({ description: 'Ficha del dispositivo' })
  @ApiNotFoundResponse({ description: 'No existe, o es de otro sitio' })
  async detalle(@Usuario() u: UsuarioSesion, @Param('id') id: string) {
    const dispositivoId = uuid(id);
    await this.alcance.exigirDispositivo(u, 'leer', dispositivoId);
    return this.consulta.dispositivo(dispositivoId);
  }

  // GET /dispositivos/:id/exportar?formato=csv|json&desde&hasta — mediciones crudas en flujo (RF-34, HU-08; docs/19 P8).
  // Se escribe fila a fila al responder, por tandas de 10 000 (consulta.service.ts): un rango de años no cabe en memoria y
  // tampoco hace falta. Por defecto, los últimos 30 días. Solo administrador del sitio (docs/20 §6: datos crudos, no públicos).
  @Get(':id/exportar')
  @ApiOperation({
    summary: 'Exportar las mediciones crudas de un dispositivo',
    description:
      'CSV estándar (coma, punto decimal, UTF-8, CRLF; cabecera `' + CABECERA_CSV + '`) o JSON (lista de objetos con los mismos campos), ' +
      'en flujo por tandas. Rango semiabierto [desde, hasta); por defecto, los últimos 30 días. Instantes en UTC (ISO 8601).',
  })
  @ApiParam({ name: 'id', description: 'UUID del dispositivo' })
  @ApiQuery({ name: 'formato', required: false, enum: FORMATOS, description: 'csv (por defecto) o json' })
  @ApiQuery({ name: 'desde', required: false, description: `${ISO_8601}; por defecto hasta − 30 días` })
  @ApiQuery({ name: 'hasta', required: false, description: `${ISO_8601}; por defecto ahora` })
  @ApiProduces('text/csv', 'application/json')
  @ApiOkResponse({ description: 'Archivo descargable (Content-Disposition: attachment)' })
  @ApiBadRequestResponse({ description: 'UUID, fecha o formato inválidos' })
  @ApiForbiddenResponse({ description: 'Consulta u operador técnico: exportar es del administrador (de sitio o del sistema) y del investigador (docs/20 §6)' })
  @ApiNotFoundResponse({ description: 'Dispositivo inexistente o de otro sitio' })
  async exportar(
    @Usuario() u: UsuarioSesion,
    @Param('id') id: string,
    @Res() res: Response,
    @Query('formato') f?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ): Promise<void> {
    const dispositivoId = uuid(id, 'dispositivo');
    await this.alcance.exigirDispositivo(u, 'exportar', dispositivoId);
    let fmt;
    try {
      fmt = formato(f);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const h = fecha(hasta, new Date(), 'hasta');
    const d = fecha(desde, new Date(h.getTime() - 30 * 86_400_000), 'desde');
    const motivo = rangoRazonable(d, h);
    if (motivo !== null) throw new BadRequestException(motivo);
    const { id_fisico } = await this.consulta.identidad(dispositivoId); // 404 antes de escribir cabeceras
    if (this.exportacionesEnCurso >= MAX_EXPORTACIONES) {
      throw new HttpException(`hay ${MAX_EXPORTACIONES} exportaciones en curso; inténtalo en un momento`, HttpStatus.TOO_MANY_REQUESTS);
    }
    this.exportacionesEnCurso++;
    res.setHeader('Content-Type', fmt === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreDeArchivo(id_fisico, d, h, fmt)}"`);
    res.setHeader('Cache-Control', 'no-store');
    // Cada escritura respeta la contrapresión: si el socket está lleno, se espera `drain` antes de pedir la siguiente tanda,
    // así un cliente lento no hace que Node acumule el archivo entero en memoria.
    const escribir = async (trozo: string): Promise<void> => {
      if (!res.write(trozo)) await once(res, 'drain');
    };
    try {
      await escribir(fmt === 'csv' ? CABECERA_CSV + '\r\n' : '[');
      let primera = true;
      for await (const fila of this.consulta.mediciones(dispositivoId, d, h)) {
        if (res.destroyed) return; // el cliente cortó la descarga: se deja de consultar
        await escribir(fmt === 'csv' ? filaCsv(fila) : (primera ? '' : ',') + '\n' + filaJson(fila));
        primera = false;
      }
      if (fmt === 'json') await escribir('\n]\n');
      res.end();
    } catch (e) {
      // Las cabeceras ya salieron: no hay cómo responder un error limpio. Se corta la conexión para que el cliente vea un
      // archivo incompleto en vez de uno que parece entero, y queda en el registro.
      this.log.error(`exportación interrumpida (${id_fisico}): ${(e as Error).message}`);
      res.destroy(e as Error);
    } finally {
      this.exportacionesEnCurso--;
    }
  }
}
