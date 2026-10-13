import { CanActivate, ExecutionContext, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AvisosAcotados, claveAdmin } from '../arranque';
import { igualesEnTiempoConstante } from './credenciales';

export const CABECERA_CLAVE_ADMIN = 'x-clave-admin';
export type RechazoClaveAdmin = 'sin_configurar' | 'ausente' | 'distinta';

// Por qué se rechaza una petición a una ruta que escribe, o null si pasa (docs/10 §8.4 punto 41). Node une una cabecera repetida
// en un solo texto separado por «, » (solo Set-Cookie llega como lista), así que una repetida no coincide y cae en «distinta»;
// la rama de lista existe por el tipo de Express. La comparación es de tiempo constante sobre hashes: ni el largo se filtra.
export function rechazoDeClaveAdmin(cabecera: string | string[] | undefined, configurada: string | undefined): RechazoClaveAdmin | null {
  if (configurada === undefined) return 'sin_configurar';
  if (typeof cabecera !== 'string' || cabecera === '') return 'ausente';
  return igualesEnTiempoConstante(cabecera, configurada) ? null : 'distinta';
}

// Guardia de toda ruta que escribe mientras no hay sesión (M7, Etapa 4). Una cabecera propia que el navegador no manda sola:
// una página de otro sitio no puede forzarla sin una verificación previa de CORS, que este backend no concede (docs/11 §3).
@Injectable()
export class ClaveAdminGuard implements CanActivate {
  private readonly log = new Logger('clave-admin');
  private readonly avisos = new AvisosAcotados();
  private readonly configurada: string | undefined;

  constructor(config: ConfigService) {
    this.configurada = claveAdmin(config.get<string>('HTTP_CLAVE_ADMIN'));
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const rechazo = rechazoDeClaveAdmin(req.headers[CABECERA_CLAVE_ADMIN], this.configurada);
    if (rechazo === null) return true;
    if (rechazo === 'sin_configurar') throw new ServiceUnavailableException('sin administrador configurado (HTTP_CLAVE_ADMIN)');
    const aviso = this.avisos.registrar(`clave de administrador ${rechazo} (${req.method} ${req.path})`);
    if (aviso !== null) this.log.warn(`petición rechazada (401): ${aviso}`);
    // El mismo mensaje para «ausente» y «distinta»: no se le dice a quien prueba si acertó el formato.
    throw new UnauthorizedException('clave de administrador ausente o incorrecta');
  }
}
