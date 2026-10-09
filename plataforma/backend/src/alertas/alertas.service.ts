import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { POOL } from '../db/db.module';
import { EventosService } from '../tiempo-real/eventos.service';

interface Regla { id: string; umbral_alto: number | null; umbral_bajo: number | null; histeresis: number }

// M6 Alertas — filtro 5 del pipeline. Evalúa cada medición aceptada contra las reglas de umbral
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
  constructor(
    @Inject(POOL) private readonly pool: Pool,
    private readonly eventos: EventosService,
  ) {}

  async evaluar(dispositivoId: string, canalId: string, idFisico: string, valor: number, unidad: string, enMantenimiento = false): Promise<void> {
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
        // RF-22: en mantenimiento no se abren condiciones (el estado es la decisión administrativa, docs/10 §8.1);
        // la lectura igual se guarda y una condición ya abierta sí se cierra al volver a rango (rama siguiente).
        if (enMantenimiento) {
          this.log.log(`${idFisico}: umbral cruzado (${valor} ${unidad}) con el equipo en mantenimiento · no se abre condición (RF-22)`);
          continue;
        }
        const nueva = await this.abrir(dispositivoId, r.id, { valor, unidad, umbral: cruzaAlto ? r.umbral_alto : r.umbral_bajo });
        if (nueva) this.log.warn(`${idFisico}: umbral ${cruzaAlto ? 'alto' : 'bajo'} cruzado (${valor} ${unidad}) · condición abierta`);
        else this.log.log(`${idFisico}: umbral cruzado (${valor} ${unidad}) · otra trama abrió la condición un instante antes`);
      } else if (abierta && dentroConHisteresis) {
        const cerrada = await this.cerrar(abierta, dispositivoId, { valor, unidad });
        if (cerrada) this.log.log(`${idFisico}: valor de vuelta en rango (${valor} ${unidad}) · condición cerrada`);
        else this.log.log(`${idFisico}: valor de vuelta en rango (${valor} ${unidad}) · otra trama cerró la condición un instante antes`);
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

  // Abrir es «insertar si no hay otra abierta». La guarda real es el índice único parcial condicion_abierta_unica
  // (migración 02); el SELECT de condicionAbierta solo ahorra trabajo. Dos lecturas que cruzan el umbral a la vez
  // (prueba de carrera del 07/10) llegaban aquí las dos: la segunda rompía con 23505 y abortaba el pipeline a mitad,
  // sin trama cruda ni filtro 6. Con ON CONFLICT la segunda ve que ya está abierta y sigue. Devuelve si la abrió.
  private async abrir(dispositivoId: string, reglaId: string, detalle: object): Promise<boolean> {
    const r = await this.pool.query(
      `INSERT INTO condicion (dispositivo_id, regla_id, tipo) VALUES ($1, $2, 'umbral')
       ON CONFLICT (dispositivo_id, tipo, COALESCE(regla_id, '00000000-0000-0000-0000-000000000000'::uuid))
       WHERE cerrada_en IS NULL DO NOTHING`,
      [dispositivoId, reglaId],
    );
    if (r.rowCount === 0) return false;
    await this.pool.query(
      "INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES ($1, 'condicion_abierta', $2)",
      [dispositivoId, { tipo: 'umbral', ...detalle }],
    );
    this.eventos.publicar({ tipo: 'condicion', dispositivo_id: dispositivoId, condicion: 'umbral', estado: 'abierta' });
    return true;
  }

  // Cerrar es «cerrar si sigue abierta»: dos lecturas que vuelven a rango a la vez ven la misma condición abierta, y la
  // segunda no debe mover la hora de cierre ni repetir el evento ni el aviso al panel (la misma carrera que al abrir).
  private async cerrar(condicionId: string, dispositivoId: string, detalle: object): Promise<boolean> {
    const r = await this.pool.query('UPDATE condicion SET cerrada_en = now() WHERE id = $1 AND cerrada_en IS NULL', [condicionId]);
    if (r.rowCount === 0) return false;
    await this.pool.query(
      "INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES ($1, 'condicion_cerrada', $2)",
      [dispositivoId, { tipo: 'umbral', ...detalle }],
    );
    this.eventos.publicar({ tipo: 'condicion', dispositivo_id: dispositivoId, condicion: 'umbral', estado: 'cerrada' });
    return true;
  }
}
