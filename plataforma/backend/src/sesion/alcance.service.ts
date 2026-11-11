import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { POOL } from '../db/db.module.js';
import { Accion, UsuarioSesion, exigir } from './permisos.js';

// El sitio de un recurso, resuelto por el SERVIDOR (docs/20 §5): nunca el que mande el cliente. null = el recurso no existe. Cada ruta
// que toca un recurso concreto llama a exigirX() antes de tocar la base con él: 404 si no existe o es de otro sitio (misma forma),
// 403 si es de su sitio y su rol no puede (permisos.ts).
@Injectable()
export class AlcanceService {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  private async sitio(sql: string, id: string): Promise<string | null> {
    const r = await this.pool.query<{ sitio_id: string }>(sql, [id]);
    return r.rows[0]?.sitio_id ?? null;
  }

  sitioDeDispositivo(id: string): Promise<string | null> {
    return this.sitio('SELECT z.sitio_id FROM dispositivo d JOIN zona z ON z.id = d.zona_id WHERE d.id = $1', id);
  }
  sitioDeCanal(id: string): Promise<string | null> {
    return this.sitio('SELECT z.sitio_id FROM canal c JOIN dispositivo d ON d.id = c.dispositivo_id JOIN zona z ON z.id = d.zona_id WHERE c.id = $1', id);
  }
  sitioDeZona(id: string): Promise<string | null> {
    return this.sitio('SELECT sitio_id FROM zona WHERE id = $1', id);
  }
  sitioDePasarela(id: string): Promise<string | null> {
    return this.sitio('SELECT sitio_id FROM pasarela WHERE id = $1', id);
  }
  sitioExistente(id: string): Promise<string | null> {
    return this.sitio('SELECT id AS sitio_id FROM sitio WHERE id = $1', id);
  }

  // Devuelve el sitio (ya comprobado) para quien necesite decidir algo más con él (p. ej. si ve el nombre de quien hizo un cambio).
  async exigirDispositivo(u: UsuarioSesion, accion: Accion, id: string): Promise<string> {
    const sitio = await this.sitioDeDispositivo(id);
    exigir(u, accion, sitio, 'dispositivo no encontrado');
    return sitio as string;
  }
  async exigirCanal(u: UsuarioSesion, accion: Accion, id: string): Promise<void> {
    exigir(u, accion, await this.sitioDeCanal(id), 'canal no encontrado');
  }
  async exigirZona(u: UsuarioSesion, accion: Accion, id: string): Promise<void> {
    exigir(u, accion, await this.sitioDeZona(id), 'zona no encontrada');
  }
  async exigirPasarela(u: UsuarioSesion, accion: Accion, id: string): Promise<void> {
    exigir(u, accion, await this.sitioDePasarela(id), 'pasarela no encontrada');
  }
  async exigirSitio(u: UsuarioSesion, accion: Accion, id: string): Promise<void> {
    exigir(u, accion, await this.sitioExistente(id), 'sitio no encontrado');
  }
}
