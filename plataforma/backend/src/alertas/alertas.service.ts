import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { POOL } from '../db/db.module';

interface Regla { id: string; umbral_alto: number | null; umbral_bajo: number | null; histeresis: number }

// M6 Alertas — filtro 6 del pipeline. Evalúa cada medición aceptada contra las reglas de umbral
// de su canal y abre/cierra CONDICIONES (estados con duración), no eventos sueltos.
//
// Histéresis: para evitar que una lectura que oscila alrededor del umbral abra y cierre la
// condición sin parar, se abre al cruzar el umbral y se cierra solo al volver "histeresis" unidades
// más adentro. Ejemplo: alto=30, histéresis=2 → abre con >30, cierra con <28.
//
//        valor ▲
//          30  ┼──────── abre ──►  condición abierta
//          28  ┼──── cierra ◄──┘
//              └──────────────────────────► tiempo
@Injectable()
export class AlertasService {
  private readonly log = new Logger('alertas');
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  async evaluar(dispositivoId: string, canalId: string, idFisico: string, valor: number, unidad: string): Promise<void> {
    const reglas = await this.pool.query<Regla>(
      'SELECT id, umbral_alto, umbral_bajo, histeresis FROM regla_umbral WHERE canal_id = $1',
      [canalId],
    );
    for (const r of reglas.rows) {
      const abierta = await this.condicionAbierta(dispositivoId, r.id);
      const cruzaAlto = r.umbral_alto !== null && valor > r.umbral_alto;
      const cruzaBajo = r.umbral_bajo !== null && valor < r.umbral_bajo;
      const dentroConHisteresis =
        (r.umbral_alto === null || valor < r.umbral_alto - r.histeresis) &&
        (r.umbral_bajo === null || valor > r.umbral_bajo + r.histeresis);

      if (!abierta && (cruzaAlto || cruzaBajo)) {
        await this.abrir(dispositivoId, r.id, { valor, unidad, umbral: cruzaAlto ? r.umbral_alto : r.umbral_bajo });
        this.log.warn(`${idFisico}: umbral ${cruzaAlto ? 'alto' : 'bajo'} cruzado (${valor} ${unidad}) · condición abierta`);
      } else if (abierta && dentroConHisteresis) {
        await this.cerrar(abierta, dispositivoId, { valor, unidad });
        this.log.log(`${idFisico}: valor de vuelta en rango (${valor} ${unidad}) · condición cerrada`);
      }
    }
  }

  private async condicionAbierta(dispositivoId: string, reglaId: string): Promise<string | undefined> {
    const r = await this.pool.query<{ id: string }>(
      "SELECT id FROM condicion WHERE dispositivo_id = $1 AND regla_id = $2 AND tipo = 'umbral' AND cerrada_en IS NULL",
      [dispositivoId, reglaId],
    );
    return r.rows[0]?.id;
  }

  private async abrir(dispositivoId: string, reglaId: string, detalle: object): Promise<void> {
    await this.pool.query(
      "INSERT INTO condicion (dispositivo_id, regla_id, tipo) VALUES ($1, $2, 'umbral')",
      [dispositivoId, reglaId],
    );
    await this.pool.query(
      "INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES ($1, 'condicion_abierta', $2)",
      [dispositivoId, { tipo: 'umbral', ...detalle }],
    );
  }

  private async cerrar(condicionId: string, dispositivoId: string, detalle: object): Promise<void> {
    await this.pool.query('UPDATE condicion SET cerrada_en = now() WHERE id = $1', [condicionId]);
    await this.pool.query(
      "INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES ($1, 'condicion_cerrada', $2)",
      [dispositivoId, { tipo: 'umbral', ...detalle }],
    );
  }
}
