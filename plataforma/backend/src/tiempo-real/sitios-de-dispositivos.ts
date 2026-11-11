import { CanActivate, ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { POOL } from '../db/db.module.js';
import { uuid } from '../consulta/validacion.js';
import { AlcanceService } from '../sesion/alcance.service.js';
import type { PeticionConUsuario } from '../sesion/guardia.js';

// Sitio de cada dispositivo, en memoria, para filtrar el canal en vivo por los sitios del usuario (docs/20 §3). Los eventos del bus
// traen el dispositivo, no el sitio, y el filtro corre por cada evento: no puede ir a la base. Se recarga entero al abrir un flujo con
// sesión y cuando llega un evento de un dispositivo que no conoce (uno recién dado de alta), en los dos casos como mucho una vez cada
// 5 s (revisión del 08/11/2026: antes, cada apertura forzaba la recarga, y abrir flujos en bucle era una consulta entera por petición):
// mientras tanto, ese evento no se le muestra a nadie con alcance acotado (nunca a quien no corresponde). Mudar un dispositivo de sitio
// (Etapa 4, docs/10 §8.4 punto 39) se verá a lo más 5 s después, al abrir el siguiente flujo. Con 1 000 dispositivos son ≈ 100 kB.
export const RECARGA_MINIMA_MS = 5_000;

@Injectable()
export class SitiosDeDispositivos {
  private readonly log = new Logger('tiempo-real');
  private mapa = new Map<string, string>();
  private ultima = 0;
  private enCurso?: Promise<void>;
  // Reloj: las pruebas lo reemplazan.
  ahora: () => number = () => Date.now();

  constructor(@Inject(POOL) private readonly pool: Pool) {}

  sitioDe(dispositivoId: string): string | undefined {
    const s = this.mapa.get(dispositivoId);
    if (s === undefined) void this.refrescar();
    return s;
  }

  // Recarga el mapa si pasaron más de 5 s desde la última carga; si no, no hace nada (o espera la que ya está en curso).
  async refrescar(): Promise<void> {
    if (this.enCurso !== undefined) return this.enCurso;
    if (this.ultima > 0 && this.ahora() - this.ultima <= RECARGA_MINIMA_MS) return;
    this.enCurso = (async () => {
      try {
        const r = await this.pool.query<{ id: string; sitio_id: string }>('SELECT d.id, z.sitio_id FROM dispositivo d JOIN zona z ON z.id = d.zona_id');
        this.mapa = new Map(r.rows.map((x) => [x.id, x.sitio_id]));
      } catch (e) {
        this.log.error(`no se pudo cargar el sitio de los dispositivos: ${(e as Error).message}`);
      } finally {
        this.ultima = this.ahora();
        this.enCurso = undefined;
      }
    })();
    return this.enCurso;
  }
}

// Guardia propia de GET /eventos, después del guardia central: los filtros `dispositivo` y `canal` se validan (400) y deben ser de los
// sitios del usuario (404 si no, igual que uno inexistente: RF-41). El mapa de sitios lo refresca el controlador al abrir el flujo, ya
// pasados el control de origen y los topes de flujos (revisión del 08/11/2026): una petición rechazada no cuesta una consulta.
@Injectable()
export class AlcanceDelFlujo implements CanActivate {
  constructor(private readonly alcance: AlcanceService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PeticionConUsuario>();
    const u = req.usuario;
    if (u === undefined) return true; // sin usuario no hay flujo: lo rechaza el controlador (401)
    const { dispositivo, canal } = req.query;
    if (dispositivo !== undefined) await this.alcance.exigirDispositivo(u, 'leer', uuid(dispositivo, 'dispositivo'));
    if (canal !== undefined) await this.alcance.exigirCanal(u, 'leer', uuid(canal, 'canal'));
    return true;
  }
}
