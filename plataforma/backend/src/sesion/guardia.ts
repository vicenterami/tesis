import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, ServiceUnavailableException, SetMetadata, UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AvisosAcotados, claveAdmin } from '../arranque.js';
import { CABECERA_CLAVE_ADMIN, rechazoDeClaveAdmin } from '../alta/clave-admin.guard.js';
import { cabeceraBorrarCookie, leerCookie } from './cookie.js';
import { UsuarioSesion, usuarioSistema } from './permisos.js';
import { MENSAJE_SIN_SESION, SesionService } from './sesion.service.js';
import { TERMINOS_VERSION } from '../legal/terminos.js';

// El guardia central (docs/20 §5; docs/10 §8.4 punto 36). Corre antes de TODA ruta de Nest (APP_GUARD en sesion.module.ts) y deja en la
// petición quién la hace (`usuario`, con su mapa sitio → rol). No decide permisos por recurso: eso lo hace permitir() (permisos.ts),
// que cada ruta llama con el sitio que resolvió el servidor. Rutas públicas: las marcadas con @Publica() (`/salud`, `POST /sesion`, la
// recepción por HTTP, que tiene su propia credencial por dispositivo). Los archivos del panel (`/panel/*`) y `/docs` los sirve Express
// antes de llegar a Nest: tampoco pasan por aquí. `/publico/*` (enlace público) llega con su propio bloque.
//
// Dos formas de identificarse:
//  1. La cookie `__Host-sesion` (una persona). Toda ruta que escribe exige además la cabecera `X-Pedido: panel` (CSRF, decidido el 12/10/2026):
//     un formulario de otro sitio no puede ponerla y el cliente del panel la pone siempre.
//  2. La clave de administrador por cabecera `X-Clave-Admin` (docs/10 §8.4 punto 41): sigue valiendo, como un «usuario del sistema» con
//     rol de administrador en todos los sitios (docs/20 §5). Vale para los guiones, el banco y las pruebas, hasta retirarla del servidor
//     (en el .env). No necesita `X-Pedido`: es ella misma una cabecera
//     que un formulario de otro sitio no puede poner. Si viene, manda ella (una clave mala es 401 aunque haya cookie).
export const CABECERA_PEDIDO = 'x-pedido';
export const VALOR_PEDIDO = 'panel';
const RUTA_PUBLICA = 'ruta_publica';
const CON_CLAVE_TEMPORAL = 'con_clave_temporal';
const CON_TERMINOS_PENDIENTES = 'con_terminos_pendientes';
// Código del 403 de una sesión restringida por los términos (docs/20 §12): el panel lo convierte en la pantalla «Términos de uso».
export const CODIGO_TERMINOS_PENDIENTES = 'terminos_pendientes';

// Ruta sin guardia (docs/20 §6, primera fila).
export const Publica = (): MethodDecorator & ClassDecorator => SetMetadata(RUTA_PUBLICA, true);
// Ruta que puede usar una persona con clave temporal (la que le asignó un administrador): ver su sesión, cerrarla y cambiar la clave.
// Todo lo demás le responde 403 hasta que la cambie (docs/20 §4).
export const ConClaveTemporal = (): MethodDecorator => SetMetadata(CON_CLAVE_TEMPORAL, true);
// Ruta que puede usar una persona que aún no aceptó la versión vigente de los términos (docs/20 §12): ver su sesión, cerrarla, cambiar la
// clave y aceptar. Las páginas legales son públicas (@Publica). Todo lo demás le responde 403 `terminos_pendientes` hasta que acepte.
export const ConTerminosPendientes = (): MethodDecorator => SetMetadata(CON_TERMINOS_PENDIENTES, true);

export interface PeticionConUsuario extends Request {
  usuario?: UsuarioSesion;
}

// En un controlador: `@Usuario() u: UsuarioSesion`. Solo en rutas con guardia (en una pública sería undefined: se lanza 401 por las dudas).
export const Usuario = createParamDecorator((_dato: unknown, ctx: ExecutionContext): UsuarioSesion => {
  const u = ctx.switchToHttp().getRequest<PeticionConUsuario>().usuario;
  if (u === undefined) throw new UnauthorizedException(MENSAJE_SIN_SESION);
  return u;
});

export function escribe(metodo: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(metodo.toUpperCase());
}

// ¿Trae la cabecera anti-CSRF? Exactamente «panel» (sin distinguir mayúsculas); repetida llega unida por «, » y no pasa.
export function traePedidoDelPanel(cabecera: string | string[] | undefined): boolean {
  return typeof cabecera === 'string' && cabecera.trim().toLowerCase() === VALOR_PEDIDO;
}
export function exigirPedidoDelPanel(req: Request): void {
  if (!traePedidoDelPanel(req.headers[CABECERA_PEDIDO])) throw new ForbiddenException('falta la cabecera X-Pedido: panel (protección contra peticiones de otros sitios)');
}

@Injectable()
export class GuardiaCentral implements CanActivate {
  private readonly log = new Logger('guardia');
  private readonly avisos = new AvisosAcotados();
  private readonly clave: string | undefined;

  constructor(private readonly reflector: Reflector, private readonly sesiones: SesionService, config: ConfigService) {
    this.clave = claveAdmin(config.get<string>('HTTP_CLAVE_ADMIN'));
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const objetivos = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(RUTA_PUBLICA, objetivos)) return true;
    const req = ctx.switchToHttp().getRequest<PeticionConUsuario>();

    // 1. Clave de administrador por cabecera: si viene, manda ella.
    const cabecera = req.headers[CABECERA_CLAVE_ADMIN];
    if (cabecera !== undefined) {
      const rechazo = rechazoDeClaveAdmin(cabecera, this.clave);
      if (rechazo === null) {
        req.usuario = usuarioSistema();
        return true;
      }
      if (rechazo === 'sin_configurar') throw new ServiceUnavailableException('sin administrador configurado (HTTP_CLAVE_ADMIN)');
      this.avisar(`clave de administrador ${rechazo} (${req.method} ${req.path})`);
      throw new UnauthorizedException('clave de administrador ausente o incorrecta');
    }

    // 2. Cookie de sesión.
    const identificador = leerCookie(req.headers.cookie);
    const usuario = identificador === null ? null : await this.sesiones.cargar(identificador);
    if (usuario === null) {
      // Una cookie que ya no vale se borra en el navegador: el panel vuelve al inicio de sesión sin seguir mandándola.
      if (identificador !== null) ctx.switchToHttp().getResponse<Response>().setHeader('Set-Cookie', cabeceraBorrarCookie());
      throw new UnauthorizedException(MENSAJE_SIN_SESION);
    }
    if (escribe(req.method)) exigirPedidoDelPanel(req);
    if (usuario.claveTemporal && !this.reflector.get<boolean>(CON_CLAVE_TEMPORAL, ctx.getHandler())) {
      throw new ForbiddenException('debes cambiar la clave temporal antes de seguir (POST /sesion/clave)');
    }
    // Términos de uso después de la clave temporal (docs/20 §12: «una clave temporal pendiente va primero»).
    if (usuario.terminosPendientes && !this.reflector.get<boolean>(CON_TERMINOS_PENDIENTES, ctx.getHandler())) {
      throw new ForbiddenException({
        statusCode: 403, error: 'Forbidden', codigo: CODIGO_TERMINOS_PENDIENTES, version: TERMINOS_VERSION,
        message: `debes aceptar los términos de uso (versión ${TERMINOS_VERSION}) antes de seguir (GET /terminos y POST /terminos/aceptar)`,
      });
    }
    req.usuario = usuario;
    return true;
  }

  private avisar(motivo: string): void {
    const aviso = this.avisos.registrar(motivo);
    if (aviso !== null) this.log.warn(`petición rechazada (401): ${aviso}`);
  }
}
