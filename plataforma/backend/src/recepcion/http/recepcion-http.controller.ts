import { Controller, Logger, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AvisosAcotados } from '../../arranque';
import { RecepcionService } from '../recepcion.service';
import { limpia } from '../texto';
import { Cupo, FallosPorDireccion, RitmoPorDispositivo } from './topes';

// Recepción por HTTP (RF-01, HU-01; docs/10 §8.4 punto 52, decidido el 16/10/2026). La trama entra por la misma tubería que la de
// MQTT (filtros 1 a 6); aquí solo se autentica con el token, se aplican los topes y se traduce el resultado a un código HTTP. El cuerpo
// llega crudo (Buffer, hasta 64 KiB: el lector de main.ts), así el adaptador ve los mismos bytes que vería por MQTT.
const TIPOS = new Set(['application/json', 'application/senml+json', 'text/plain']);
const BEARER = /^Bearer ([A-Za-z0-9_-]{16,128})$/; // el token del alta: 24 bytes en base64url (32 caracteres)
const FORMA_ID = /^[a-z0-9][a-z0-9-]{2,62}$/; // la de id_fisico (alta.dto.ts y la base): otra forma no puede existir

@ApiTags('recepcion')
@Controller('recepcion')
export class RecepcionHttpController {
  private readonly log = new Logger('recepcion-http');
  private readonly fallos = new FallosPorDireccion();
  private readonly cupo = new Cupo();
  private readonly ritmo = new RitmoPorDispositivo();
  private readonly avisos = new AvisosAcotados();

  constructor(private readonly recepcion: RecepcionService) {}

  @Post(':idFisico')
  @ApiOperation({
    summary: 'Recibir una trama por HTTP',
    description:
      'Para dispositivos de vía `http`. El token que entregó el alta va en `Authorization: Bearer`. El cuerpo, SenML JSON (o, si el ' +
      'formato declarado es `plano`, un número con la magnitud en `?magnitud=`), hasta 64 KiB. Pasa por los mismos filtros que una trama MQTT.',
  })
  @ApiParam({ name: 'idFisico', description: 'Identificador físico del dispositivo (el del alta)' })
  @ApiHeader({ name: 'Authorization', required: true, description: 'Bearer <token del alta>' })
  @ApiQuery({ name: 'magnitud', required: false, description: 'Solo para el formato plano: qué mide el número' })
  @ApiResponse({ status: 202, description: 'Recibida: al menos una lectura válida o repetida; trae el resumen' })
  @ApiResponse({ status: 400, description: 'Cuerpo ilegible (por ejemplo, una codificación declarada que no es la del cuerpo)' })
  @ApiResponse({ status: 401, description: 'Sin token válido para ese dispositivo (no dice el motivo)' })
  @ApiResponse({ status: 413, description: 'Más de 64 KiB' })
  @ApiResponse({ status: 415, description: 'No es JSON ni texto' })
  @ApiResponse({ status: 422, description: 'No se entiende o ninguna lectura es válida; queda en cuarentena' })
  @ApiResponse({ status: 429, description: 'Demasiados fallos desde esta dirección, o más de una trama por segundo del dispositivo' })
  @ApiResponse({ status: 503, description: 'Verificación de tokens saturada; reintentar' })
  async recibir(@Param('idFisico') idFisico: string, @Query('magnitud') magnitud: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const direccion = req.ip ?? 'desconocida';
    const espera = this.fallos.bloqueo(direccion);
    if (espera > 0) {
      res.setHeader('Retry-After', String(Math.ceil(espera / 1000)));
      res.status(429).json({ statusCode: 429, message: 'demasiados fallos de autenticación desde esta dirección; reintentar más tarde' });
      return;
    }
    const tipo = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!TIPOS.has(tipo)) {
      res.status(415).json({ statusCode: 415, message: 'el cuerpo debe ser application/json, application/senml+json o text/plain' });
      return;
    }
    const token = BEARER.exec(req.headers.authorization ?? '')?.[1];
    if (token === undefined || !FORMA_ID.test(idFisico)) return this.noAutorizado(res, direccion, idFisico);
    if (!this.cupo.tomar()) {
      res.setHeader('Retry-After', '1');
      res.status(503).json({ statusCode: 503, message: 'verificación de credenciales saturada; reintentar en un segundo' });
      return;
    }
    let dispositivoId: string | null;
    try {
      dispositivoId = await this.recepcion.autenticarHttp(idFisico, token);
    } finally {
      this.cupo.soltar();
    }
    if (dispositivoId === null) return this.noAutorizado(res, direccion, idFisico);
    if (!this.ritmo.pasar(dispositivoId)) {
      res.setHeader('Retry-After', '1');
      res.status(429).json({ statusCode: 429, message: 'más de una trama por segundo de este dispositivo' });
      return;
    }
    const carga = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const resumen = await this.recepcion.procesarHttp(idFisico, carga, typeof magnitud === 'string' ? magnitud : undefined);
    if (resumen === null) return this.noAutorizado(res, direccion, idFisico); // se dio de baja entre la autenticación y aquí
    const util = resumen.guardadas + resumen.duplicadas + (resumen.repetida ? 1 : 0);
    if (resumen.malformada !== null || util === 0) {
      res.status(422).json({ statusCode: 422, message: resumen.malformada ?? 'ninguna lectura válida', rechazos: resumen.rechazos });
      return;
    }
    res.status(202).json({ guardadas: resumen.guardadas, repetidas: resumen.duplicadas + (resumen.repetida ? 1 : 0), rechazos: resumen.rechazos });
  }

  // Un 401 no escribe en la base (sin autenticación no se escribe nada: así un barrido no la llena); se anota en el registro, acotado.
  private noAutorizado(res: Response, direccion: string, idFisico: string): void {
    this.fallos.registrarFallo(direccion);
    const aviso = this.avisos.registrar(`401 desde ${direccion}`);
    if (aviso !== null) this.log.warn(`recepción HTTP rechazada (401) para ${limpia(idFisico, 63)}: ${aviso}`); // el id viene de la URL: sin saltos de línea que forjen registros
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json({ statusCode: 401, message: 'credencial ausente o inválida' });
  }
}
