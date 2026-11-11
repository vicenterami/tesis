import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { POOL } from '../db/db.module.js';
import { EventosService } from '../tiempo-real/eventos.service.js';

interface Regla {
  id: string; umbral_alto: number | null; umbral_bajo: number | null; histeresis: number; retardo_s: number; fuera_de_banda_desde: Date | null;
}

// Qué hacer con una regla ante una medición (función pura, probada en alertas.service.spec.ts). Retardo de activación (RF-14; docs/10
// §8.4 punto 65 vi): con `retardo_s` > 0, la condición se abre solo cuando la medición lleva al menos ese tiempo fuera de la banda, contado
// desde `fuera_de_banda_desde`, que se guarda en la base (un reinicio no reinicia la cuenta). Con 0, abre con la primera lectura que cruza,
// como antes. Una lectura dentro de la banda (sin cruzar) borra la marca: la cuenta vuelve a empezar. La histéresis sigue cerrando.
export type DecisionUmbral = 'abrir' | 'marcar' | 'esperar' | 'cerrar' | 'desmarcar' | 'nada';
export function decidirUmbral(r: Pick<Regla, 'umbral_alto' | 'umbral_bajo' | 'histeresis' | 'retardo_s' | 'fuera_de_banda_desde'>, valor: number, abierta: boolean, ahora: Date): DecisionUmbral {
  const cruza = (r.umbral_alto !== null && valor > r.umbral_alto) || (r.umbral_bajo !== null && valor < r.umbral_bajo);
  const dentroConHisteresis =
    (r.umbral_alto === null || valor < r.umbral_alto - r.histeresis) &&
    (r.umbral_bajo === null || valor > r.umbral_bajo + r.histeresis);
  if (abierta) return dentroConHisteresis ? 'cerrar' : 'nada';
  if (!cruza) return r.fuera_de_banda_desde !== null ? 'desmarcar' : 'nada';
  if (r.retardo_s <= 0) return 'abrir';
  if (r.fuera_de_banda_desde === null) return 'marcar';
  return ahora.getTime() - r.fuera_de_banda_desde.getTime() >= r.retardo_s * 1000 ? 'abrir' : 'esperar';
}

// La marca solo vale si el episodio sigue vivo (revisión del 11/11/2026): una marca más vieja que retardo_s + 2 × intervalo esperado
// es de un episodio que se cortó sin lectura dentro de la banda (mantenimiento, silencio largo, la regla editada sin pasar por la API),
// y abriría la condición con la PRIMERA lectura fuera, sin retardo. Se trata como nula: la cuenta empieza de nuevo.
export function marcaVigente(marca: Date | null, retardoS: number, intervaloS: number, ahora: Date): Date | null {
  if (marca === null) return null;
  return ahora.getTime() - marca.getTime() > (retardoS + 2 * intervaloS) * 1000 ? null : marca;
}

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

  // `tiempo`: el instante de la lectura (el que guardó la base): la marca y la cuenta del retardo usan ese reloj, no el de Node ni now() de
  // la base, que podían diferir. `intervaloS`: el intervalo esperado del dispositivo, para la vigencia de la marca (marcaVigente).
  async evaluar(
    dispositivoId: string, canalId: string, idFisico: string, valor: number, unidad: string, enMantenimiento = false,
    { tiempo = new Date(), intervaloS = 300 }: { tiempo?: Date; intervaloS?: number } = {},
  ): Promise<void> {
    const reglas = await this.pool.query<Regla>(
      'SELECT id, umbral_alto, umbral_bajo, histeresis, retardo_s, fuera_de_banda_desde FROM regla_umbral WHERE canal_id = $1',
      [canalId],
    );
    for (const r of reglas.rows) {
      const abierta = await this.condicionAbierta(dispositivoId, r.id);
      const retardo = r.retardo_s ?? 0;
      const marca = marcaVigente(r.fuera_de_banda_desde ?? null, retardo, intervaloS, tiempo);
      const decision = decidirUmbral({ ...r, retardo_s: retardo, fuera_de_banda_desde: marca }, valor, abierta !== undefined, tiempo);
      const cruzaAlto = r.umbral_alto !== null && valor > r.umbral_alto;

      if (decision === 'marcar') {
        // Primera lectura fuera de la banda con retardo: se anota desde cuándo (la hora de la lectura), si no estaba anotado o la marca
        // era de un episodio vencido (una escritura por episodio; si otra trama la anotó un instante antes, gana esa).
        await this.pool.query('UPDATE regla_umbral SET fuera_de_banda_desde = $2 WHERE id = $1 AND (fuera_de_banda_desde IS NULL OR fuera_de_banda_desde < $3)',
          [r.id, tiempo, new Date(tiempo.getTime() - (retardo + 2 * intervaloS) * 1000)]);
        this.log.log(`${idFisico}: umbral cruzado (${valor} ${unidad}) · se abre si sigue fuera ${r.retardo_s} s (retardo de activación)`);
      } else if (decision === 'desmarcar') {
        await this.pool.query('UPDATE regla_umbral SET fuera_de_banda_desde = NULL WHERE id = $1 AND fuera_de_banda_desde IS NOT NULL', [r.id]);
      } else if (decision === 'abrir') {
        // RF-22: en mantenimiento no se abren condiciones (el estado es la decisión administrativa, docs/10 §8.1);
        // la lectura igual se guarda y una condición ya abierta sí se cierra al volver a rango (rama siguiente).
        if (enMantenimiento) {
          this.log.log(`${idFisico}: umbral cruzado (${valor} ${unidad}) con el equipo en mantenimiento · no se abre condición (RF-22)`);
          // Y la marca se limpia: al volver a activo, la cuenta del retardo empieza de cero, no desde antes del mantenimiento.
          if (r.fuera_de_banda_desde !== null && r.fuera_de_banda_desde !== undefined) {
            await this.pool.query('UPDATE regla_umbral SET fuera_de_banda_desde = NULL WHERE id = $1', [r.id]);
          }
          continue;
        }
        const nueva = await this.abrir(dispositivoId, r.id, { valor, unidad, umbral: cruzaAlto ? r.umbral_alto : r.umbral_bajo, retardo_s: retardo });
        if (r.fuera_de_banda_desde !== null && r.fuera_de_banda_desde !== undefined) {
          await this.pool.query('UPDATE regla_umbral SET fuera_de_banda_desde = NULL WHERE id = $1', [r.id]);
        }
        if (nueva) this.log.warn(`${idFisico}: umbral ${cruzaAlto ? 'alto' : 'bajo'} cruzado (${valor} ${unidad}) · condición abierta`);
        else this.log.log(`${idFisico}: umbral cruzado (${valor} ${unidad}) · otra trama abrió la condición un instante antes`);
      } else if (decision === 'cerrar' && abierta !== undefined) {
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
