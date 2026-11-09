import { BadRequestException, Controller, Get, HttpException, HttpStatus, Logger, Param, Query, Res } from '@nestjs/common';
import { once } from 'node:events';
import {
  ApiBadRequestResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiQuery, ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ConsultaService } from './consulta.service';
import { CABECERA_CSV, FORMATOS, filaCsv, filaJson, formato, nombreDeArchivo, rangoRazonable } from './exportar';

// Exportaciones simultáneas admitidas por proceso: cada una ocupa una conexión a la base durante toda la descarga.
export const MAX_EXPORTACIONES = 2;
import { fecha, uuid } from './validacion';
import { AlcanceService } from '../sesion/alcance.service';
import { Usuario } from '../sesion/guardia';
import { alcanceDeLectura } from '../sesion/permisos';
import type { UsuarioSesion } from '../sesion/permisos';

// Lecturas con sesión (docs/20 §6, desde el 08/11/2026): 401 sin sesión; la lista sale filtrada por los sitios del usuario en el WHERE;
// un dispositivo de otro sitio responde 404, igual que uno inexistente (RF-41); exportar exige rol administrador (403 al de consulta).
@ApiTags('dispositivos')
@ApiCookieAuth('sesion')
@ApiUnauthorizedResponse({ description: 'sesión requerida' })
@Controller('dispositivos')
export class DispositivosController {
  private readonly log = new Logger('exportar');
  private exportacionesEnCurso = 0;
  constructor(private readonly consulta: ConsultaService, private readonly alcance: AlcanceService) {}

  // Inventario con estado: base de la vista "salud del sitio" (HU-19).
  @Get()
  @ApiOperation({ summary: 'Inventario de dispositivos con estado', description: 'Cada dispositivo de los sitios del usuario con su sitio y zona (nombres, y `sitio_codigo` y `zona_id` para filtrar: los nombres pueden repetirse), zona horaria, canales, `en_linea` (última trama hace menos de 2 × intervalo esperado) y número de condiciones abiertas.' })
  @ApiOkResponse({ description: 'Lista de dispositivos' })
  listar(@Usuario() u: UsuarioSesion) { return this.consulta.dispositivos(alcanceDeLectura(u)); }

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
  @ApiQuery({ name: 'desde', required: false, description: 'ISO 8601; por defecto hasta − 30 días' })
  @ApiQuery({ name: 'hasta', required: false, description: 'ISO 8601; por defecto ahora' })
  @ApiProduces('text/csv', 'application/json')
  @ApiOkResponse({ description: 'Archivo descargable (Content-Disposition: attachment)' })
  @ApiBadRequestResponse({ description: 'UUID, fecha o formato inválidos' })
  @ApiForbiddenResponse({ description: 'Rol de consulta: exportar exige administrador' })
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
