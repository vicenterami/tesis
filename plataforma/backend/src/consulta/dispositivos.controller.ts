import { BadRequestException, Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBadRequestResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ConsultaService } from './consulta.service';
import { CABECERA_CSV, FORMATOS, filaCsv, filaJson, formato, nombreDeArchivo } from './exportar';
import { fecha, uuid } from './validacion';

@ApiTags('dispositivos')
@Controller('dispositivos')
export class DispositivosController {
  constructor(private readonly consulta: ConsultaService) {}

  // Inventario con estado: base de la vista "salud del sitio" (HU-19).
  @Get()
  @ApiOperation({ summary: 'Inventario de dispositivos con estado', description: 'Cada dispositivo con su sitio, zona horaria, canales, `en_linea` (última trama hace menos de 2 × intervalo esperado) y número de condiciones abiertas.' })
  @ApiOkResponse({ description: 'Lista de dispositivos' })
  listar() { return this.consulta.dispositivos(); }

  // Ficha completa: canales, reglas, última medición y condiciones abiertas (HU-21).
  @Get(':id')
  @ApiOperation({ summary: 'Ficha de un dispositivo', description: 'Canales con sus reglas de umbral y última medición, y condiciones abiertas.' })
  @ApiParam({ name: 'id', description: 'UUID del dispositivo' })
  @ApiOkResponse({ description: 'Ficha del dispositivo' })
  @ApiNotFoundResponse({ description: 'No existe' })
  detalle(@Param('id') id: string) { return this.consulta.dispositivo(uuid(id)); }

  // GET /dispositivos/:id/exportar?formato=csv|json&desde&hasta — mediciones crudas en flujo (RF-34, HU-08; docs/19 P8).
  // Se escribe fila a fila al responder, por tandas de 10 000 (consulta.service.ts): un rango de años no cabe en memoria y
  // tampoco hace falta. Por defecto, los últimos 30 días. Sin sesión hasta M7, como toda la API (docs/11 §4).
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
  @ApiNotFoundResponse({ description: 'Dispositivo inexistente' })
  async exportar(
    @Param('id') id: string,
    @Res() res: Response,
    @Query('formato') f?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ): Promise<void> {
    const dispositivoId = uuid(id, 'dispositivo');
    let fmt;
    try {
      fmt = formato(f);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const h = fecha(hasta, new Date(), 'hasta');
    const d = fecha(desde, new Date(h.getTime() - 30 * 86_400_000), 'desde');
    if (d >= h) throw new BadRequestException('desde debe ser anterior a hasta');
    const { id_fisico } = await this.consulta.identidad(dispositivoId); // 404 antes de escribir cabeceras
    res.setHeader('Content-Type', fmt === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreDeArchivo(id_fisico, d, h, fmt)}"`);
    res.setHeader('Cache-Control', 'no-store');
    if (fmt === 'csv') res.write(CABECERA_CSV + '\r\n');
    else res.write('[');
    let primera = true;
    for await (const fila of this.consulta.mediciones(dispositivoId, d, h)) {
      if (fmt === 'csv') res.write(filaCsv(fila));
      else {
        res.write((primera ? '' : ',') + '\n' + filaJson(fila));
        primera = false;
      }
      if (res.destroyed) return; // el cliente cortó la descarga: se deja de consultar
    }
    if (fmt === 'json') res.write('\n]\n');
    res.end();
  }
}
