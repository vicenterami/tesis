import { Controller, Logger, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AvisosAcotados, claveOpcional } from '../../arranque';
import { RecepcionService } from '../recepcion.service';
import { limpia } from '../texto';
import { direccionDelCliente } from './direccion';
import { claveDeDireccion, FallosPorClave, RitmoPorDispositivo } from './topes';
import { VerificacionDeTokens } from './verificacion';

// Recepción por HTTP (RF-01, HU-01; docs/10 §8.4 punto 52, decidido el 16/10/2026 y corregido el 17/10). La trama entra por la misma
// tubería que la de MQTT (filtros 1 a 6); aquí solo se autentica con el token, se aplican los topes y se traduce el resultado a un
// código HTTP. El cuerpo llega crudo (Buffer, hasta 64 KiB: el lector de main.ts), así el adaptador ve los mismos bytes que por MQTT.
// Orden de las comprobaciones (punto 52): par bloqueado → tipo de contenido → forma del token y del identificador → dirección bloqueada
// (salvo que el token sea el último verificado para ese identificador) → credencial y caché → cupo → scrypt → ritmo → filtros 2 a 6.
const TIPOS = new Set(['application/json', 'application/senml+json', 'text/plain']);
const BEARER = /^Bearer ([A-Za-z0-9_-]{16,128})$/i; // el token del alta: 24 bytes en base64url (32 caracteres); el esquema no distingue mayúsculas (RFC 9110 §11.1)
const FORMA_ID = /^[a-z0-9][a-z0-9-]{2,62}$/; // la de id_fisico (alta.dto.ts y la base): otra forma no puede existir

@ApiTags('recepcion')
@Controller('recepcion')
export class RecepcionHttpController {
  private readonly log = new Logger('recepcion-http');
  private readonly fallosPar = new FallosPorClave(5); // (b) 5 fallos en 60 s para un par dirección + dispositivo → 60 s
  private readonly fallosDireccion = new FallosPorClave(50); // (c) 50 fallos en 60 s desde una dirección → 60 s sin scrypt
  private readonly ritmo = new RitmoPorDispositivo(); // (e)
  private readonly avisos = new AvisosAcotados();
  private readonly secreto: string | undefined;

  constructor(
    private readonly recepcion: RecepcionService,
    private readonly verificacion: VerificacionDeTokens,
    config: ConfigService,
  ) {
    // El mismo secreto que el proxy pone en X-Proxy-Secreto (direccion.ts). Corto, el arranque falla a propósito, como las claves.
    this.secreto = claveOpcional('PROXY_SECRETO', config.get<string>('PROXY_SECRETO'));
    if (this.secreto === undefined) {
      this.log.warn('PROXY_SECRETO no definido: la dirección del cliente será la del socket (detrás del proxy, todas las peticiones ' +
        'comparten dirección y los topes por dirección pierden sentido); definirlo en el .env, el mismo para el proxy (openssl rand -base64 24)');
    }
  }

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
  @ApiResponse({ status: 422, description: 'No se entiende, ninguna lectura es válida o no cabe en el presupuesto de la hora; queda en cuarentena' })
  @ApiResponse({ status: 429, description: 'Demasiados fallos de autenticación (para este dispositivo desde esta dirección, o desde esta dirección con cualquier dispositivo), o más de una trama por segundo del dispositivo' })
  @ApiResponse({ status: 503, description: 'Verificación de tokens saturada; reintentar' })
  async recibir(@Param('idFisico') idFisico: string, @Query('magnitud') magnitud: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const cliente = direccionDelCliente(req, this.secreto);
    if (cliente.forwardedIgnorado) {
      const aviso = this.avisos.registrar('X-Forwarded-For sin el secreto del proxy');
      if (aviso !== null) this.log.warn(`llegó X-Forwarded-For sin el secreto del proxy (¿PROXY_SECRETO distinto en el proxy y el backend?): ${aviso}`);
    }
    const direccion = claveDeDireccion(cliente.direccion);
    const par = `${direccion}|${FORMA_ID.test(idFisico) ? idFisico : '?'}`;
    const esperaPar = this.fallosPar.bloqueo(par);
    if (esperaPar > 0) return this.bloqueada(res, esperaPar, 'demasiados fallos de autenticación para este dispositivo desde esta dirección; reintentar más tarde');
    const tipo = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!TIPOS.has(tipo)) {
      res.status(415).json({ statusCode: 415, message: 'el cuerpo debe ser application/json, application/senml+json o text/plain' });
      return;
    }
    const token = BEARER.exec(req.headers.authorization ?? '')?.[1];
    if (token === undefined || !FORMA_ID.test(idFisico)) return this.noAutorizado(res, par, direccion, idFisico, false); // sin comprobar: no cuenta
    // (c) Una dirección bloqueada no gasta ni una consulta, salvo que presente el último token verificado para ese identificador (la
    // pista): entonces se consulta la base, y la caché decide con la huella vigente.
    const esperaDireccion = this.fallosDireccion.bloqueo(direccion);
    const bloqueada = 'demasiados fallos de autenticación desde esta dirección; reintentar más tarde';
    if (esperaDireccion > 0 && !this.verificacion.pista(idFisico, token)) return this.bloqueada(res, esperaDireccion, bloqueada);
    const fila = await this.recepcion.credencialHttp(idFisico);
    // (a) Con el token ya verificado contra esta misma huella no hay scrypt, ni cupo, ni bloqueo por dirección que valga.
    if (!this.verificacion.enCache(fila, token)) {
      if (esperaDireccion > 0) return this.bloqueada(res, esperaDireccion, bloqueada);
      const resultado = await this.verificacion.verificar(fila, token, idFisico);
      if (resultado === 'saturado') {
        res.setHeader('Retry-After', '1');
        res.status(503).json({ statusCode: 503, message: 'verificación de credenciales saturada; reintentar en un segundo' });
        return;
      }
      if (resultado === 'no') return this.noAutorizado(res, par, direccion, idFisico);
    }
    const dispositivoId = fila?.id;
    if (dispositivoId === undefined) return this.noAutorizado(res, par, direccion, idFisico); // no puede pasar tras un 'ok'; defensa en profundidad
    if (!this.ritmo.pasar(dispositivoId)) {
      res.setHeader('Retry-After', '1');
      res.status(429).json({ statusCode: 429, message: 'más de una trama por segundo de este dispositivo' });
      return;
    }
    const carga = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const resumen = await this.recepcion.procesarHttp(idFisico, carga, typeof magnitud === 'string' ? magnitud : undefined);
    if (resumen === null) return this.noAutorizado(res, par, direccion, idFisico); // se dio de baja entre la autenticación y aquí
    const util = resumen.guardadas + resumen.duplicadas + (resumen.repetida ? 1 : 0);
    if (resumen.malformada !== null || util === 0) {
      res.status(422).json({ statusCode: 422, message: resumen.malformada ?? 'ninguna lectura válida', rechazos: resumen.rechazos });
      return;
    }
    res.status(202).json({ guardadas: resumen.guardadas, repetidas: resumen.duplicadas + (resumen.repetida ? 1 : 0), rechazos: resumen.rechazos });
  }

  private bloqueada(res: Response, esperaMs: number, mensaje: string): void {
    res.setHeader('Retry-After', String(Math.ceil(esperaMs / 1000)));
    res.status(429).json({ statusCode: 429, message: mensaje });
  }

  // Un 401 no escribe en la base (sin autenticación no se escribe nada: así un barrido no la llena); se anota en el registro, acotado.
  // Cuenta para el par y para la dirección solo si el token llegó a comprobarse (punto 52): un token sin forma no costó nada, y lo que ya
  // estaba bloqueado no llega aquí. Así, peticiones baratas sin cabecera no bloquean a los vecinos de una dirección.
  private noAutorizado(res: Response, par: string, direccion: string, idFisico: string, comprobado = true): void {
    if (comprobado) {
      this.fallosPar.registrarFallo(par);
      this.fallosDireccion.registrarFallo(direccion);
    }
    const aviso = this.avisos.registrar(`401 desde ${direccion}`);
    if (aviso !== null) this.log.warn(`recepción HTTP rechazada (401) para ${limpia(idFisico, 63)}: ${aviso}`); // el id viene de la URL: sin saltos de línea que forjen registros
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json({ statusCode: 401, message: 'credencial ausente o inválida' });
  }
}
