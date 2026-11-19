import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { POOL } from '../db/db.module.js';
import { EventosService } from '../tiempo-real/eventos.service.js';

const MOTIVO_REPORTA = 'comunicación restablecida';
const MOTIVO_EN_SERVICIO = 'de vuelta en servicio (otra vez un intervalo completo)';
const MOTIVO_DENTRO_DEL_PLAZO = 'de vuelta dentro del plazo de la primera trama';

// M4 Supervisión de salud — filtro 6 completo.
//
// El pipeline solo corre cuando LLEGA una trama; por eso no puede notar que un dispositivo DEJÓ
// de transmitir. Este servicio barre la tabla periódicamente y compara "visto por última vez"
// (o, si es más reciente, desde cuándo está en servicio) con el intervalo esperado de cada dispositivo.
// Tolerancia: 2 intervalos (un mensaje perdido no es una caída; dos seguidos, sí). Abre la condición
// `sin_comunicacion`, también a quien nunca envió una trama y venció el plazo de su sitio (docs/19 §2);
// la cierra el propio pipeline cuando vuelve a llegar una trama (RecepcionService.marcarVivo), o este
// barrido si la encuentra abierta con el dispositivo ya visto o de vuelta en su plazo.
@Injectable()
export class SupervisionService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('supervision');
  private temporizador?: NodeJS.Timeout;

  constructor(
    @Inject(POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
    private readonly eventos: EventosService,
  ) {}

  onModuleInit(): void {
    const cadaSeg = this.config.get<number>('SUPERVISION_INTERVALO_S', 60);
    this.temporizador = setInterval(() => void this.barridoSeguro(), cadaSeg * 1000);
    this.log.log(`barrido de salud cada ${cadaSeg} s`);
  }

  onModuleDestroy(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  // El temporizador NO tiene quien atrape una promesa rechazada (no hay petición HTTP de por medio,
  // a diferencia del pipeline): sin este try/catch, una base caída al momento del barrido tira abajo
  // TODO el proceso con un rechazo no manejado (docs/10 §4.1; hallazgo del 23/09/2026, visto al
  // dockerizar: la base caída dejaba al backend en un ciclo de caídas en vez de saltarse el ciclo).
  async barridoSeguro(): Promise<void> {
    try {
      await this.barrer();
    } catch (e) {
      this.log.error(`barrido de salud falló, se reintenta en el próximo ciclo: ${(e as Error).message}`);
    }
  }

  async barrer(): Promise<void> {
    // 1) Dispositivos activos, vistos alguna vez (tienen fila en estado_dispositivo), cuyo silencio supera 2 × intervalo esperado y
    //    que aún no tienen la condición abierta → abrirla. El silencio se cuenta desde el más reciente entre la última trama y
    //    `en_servicio_desde` (migración 26; docs/10 §8.4 punto 68): quien vuelve de mantenimiento con su última trama vieja tiene otra vez
    //    un intervalo completo, sin falsa alarma en el primer barrido.
    const caidos = await this.pool.query<{ id: string; id_fisico: string; silencio_s: number }>(
      `SELECT d.id, d.id_fisico,
              EXTRACT(EPOCH FROM now() - greatest(e.visto_por_ultima_vez, d.en_servicio_desde))::int AS silencio_s
         FROM dispositivo d JOIN estado_dispositivo e ON e.dispositivo_id = d.id
        WHERE d.estado = 'activo'
          AND greatest(e.visto_por_ultima_vez, d.en_servicio_desde) < now() - (d.intervalo_esperado_s * 2) * INTERVAL '1 second'
          AND NOT EXISTS (SELECT 1 FROM condicion c
                           WHERE c.dispositivo_id = d.id AND c.tipo = 'sin_comunicacion' AND c.cerrada_en IS NULL)`,
    );
    for (const d of caidos.rows) {
      // (1) Caídos. Misma guarda que en alertas: el índice único parcial decide; la sentencia vuelve a mirar que siga `activo` (RF-22); si otro barrido (uno que se alargó más que el intervalo) la abrió
      // entre el SELECT y esta sentencia, no hay error ni evento repetido. La condición y su evento son UNA sentencia (CTE): o quedan las
      // dos o ninguna, aunque el proceso muera a mitad (antes eran dos y podía quedar la condición sin evento, que nadie volvía a escribir).
      // El silencio del evento se calcula aquí mismo, con la misma regla de la búsqueda, y no se arrastra de ella.
      const r = await this.pool.query<{ silencio_s: number }>(
        `WITH abre AS (
           INSERT INTO condicion (dispositivo_id, tipo)
           SELECT d.id, 'sin_comunicacion' FROM dispositivo d WHERE d.id = $1 AND d.estado = 'activo'
           ON CONFLICT (dispositivo_id, tipo, COALESCE(regla_id, '00000000-0000-0000-0000-000000000000'::uuid))
           WHERE cerrada_en IS NULL DO NOTHING
           RETURNING dispositivo_id
         )
         INSERT INTO evento (dispositivo_id, tipo, detalle)
         SELECT a.dispositivo_id, 'condicion_abierta',
                jsonb_build_object('tipo', 'sin_comunicacion',
                                   'silencio_s', EXTRACT(EPOCH FROM now() - greatest(e.visto_por_ultima_vez, d.en_servicio_desde))::int)
           FROM abre a JOIN dispositivo d ON d.id = a.dispositivo_id LEFT JOIN estado_dispositivo e ON e.dispositivo_id = d.id
         RETURNING (detalle->>'silencio_s')::int AS silencio_s`,
        [d.id],
      );
      if (r.rowCount === 0) continue;
      const silencio = r.rows[0]?.silencio_s ?? d.silencio_s;
      this.log.warn(`${d.id_fisico}: sin comunicación hace ${silencio} s · condición abierta`);
      this.eventos.publicar({ tipo: 'condicion', dispositivo_id: d.id, condicion: 'sin_comunicacion', estado: 'abierta' });
    }

    // (2) Nunca reportaron (docs/19 §2; docs/10 §8.4 punto 68): activos SIN fila en estado_dispositivo cuyo plazo de la primera trama
    //     (en_servicio_desde + sitio.espera_primera_trama_h) ya venció → la misma condición, con «nunca reportó» en el evento. La sentencia
    //     vuelve a mirar que siga activo, sin fila de estado y vencido, y toma el plazo y la fecha del evento de lo que ve ahora (no de la
    //     búsqueda). Con las instantáneas de lectura confirmada, una primera trama que se confirmó entre la búsqueda y esta sentencia puede
    //     no verse todavía y la condición se abre igual: el paso (3) la cierra en el barrido siguiente, y marcarVivo si la trama llega después.
    //     El índice único parcial decide entre dos barridos, como arriba.
    const nunca = await this.pool.query<{ id: string; id_fisico: string }>(
      `SELECT d.id, d.id_fisico
         FROM dispositivo d JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id
        WHERE d.estado = 'activo'
          AND NOT EXISTS (SELECT 1 FROM estado_dispositivo e WHERE e.dispositivo_id = d.id)
          AND d.en_servicio_desde + s.espera_primera_trama_h * INTERVAL '1 hour' <= now()
          AND NOT EXISTS (SELECT 1 FROM condicion c
                           WHERE c.dispositivo_id = d.id AND c.tipo = 'sin_comunicacion' AND c.cerrada_en IS NULL)`,
    );
    for (const d of nunca.rows) {
      const r = await this.pool.query<{ espera_h: number }>(
        `WITH abre AS (
           INSERT INTO condicion (dispositivo_id, tipo)
           SELECT d.id, 'sin_comunicacion' FROM dispositivo d JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id
            WHERE d.id = $1 AND d.estado = 'activo'
              AND NOT EXISTS (SELECT 1 FROM estado_dispositivo e WHERE e.dispositivo_id = d.id)
              AND d.en_servicio_desde + s.espera_primera_trama_h * INTERVAL '1 hour' <= now()
           ON CONFLICT (dispositivo_id, tipo, COALESCE(regla_id, '00000000-0000-0000-0000-000000000000'::uuid))
           WHERE cerrada_en IS NULL DO NOTHING
           RETURNING dispositivo_id
         )
         INSERT INTO evento (dispositivo_id, tipo, detalle)
         SELECT a.dispositivo_id, 'condicion_abierta',
                jsonb_build_object('tipo', 'sin_comunicacion', 'nunca_reporto', true, 'en_servicio_desde', iso_utc(d.en_servicio_desde),
                                   'espera_primera_trama_h', s.espera_primera_trama_h)
           FROM abre a JOIN dispositivo d ON d.id = a.dispositivo_id JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id
         RETURNING (detalle->>'espera_primera_trama_h')::int AS espera_h`,
        [d.id],
      );
      if (r.rowCount === 0) continue;
      this.log.warn(`${d.id_fisico}: nunca reportó en ${r.rows[0]?.espera_h} h desde que entró en servicio · condición abierta`);
      this.eventos.publicar({ tipo: 'condicion', dispositivo_id: d.id, condicion: 'sin_comunicacion', estado: 'abierta' });
    }

    // (3) Red de seguridad de los activos: condiciones abiertas de dispositivos que ya no están callados por la misma regla → cerrarlas, con su evento
    //    (el cierre y el evento son una sola sentencia; el evento dice por qué: `motivo`). Ya envió y está dentro de su intervalo contado
    //    desde el más reciente entre la última trama y en_servicio_desde (volvió a reportar, o volvió de mantenimiento); o nunca envió y su
    //    plazo aún no vence (volvió de mantenimiento, o el sitio alargó el plazo).
    const recuperados = await this.pool.query<{ id: string; id_fisico: string; motivo: string }>(
      `WITH cierra AS (
         UPDATE condicion c SET cerrada_en = now()
           FROM dispositivo d JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id
           LEFT JOIN estado_dispositivo e ON e.dispositivo_id = d.id
          WHERE c.dispositivo_id = d.id AND c.tipo = 'sin_comunicacion' AND c.cerrada_en IS NULL AND d.estado = 'activo'
            AND CASE WHEN e.visto_por_ultima_vez IS NULL
                     THEN now() < d.en_servicio_desde + s.espera_primera_trama_h * INTERVAL '1 hour'
                     ELSE greatest(e.visto_por_ultima_vez, d.en_servicio_desde) >= now() - (d.intervalo_esperado_s * 2) * INTERVAL '1 second' END
          RETURNING d.id AS dispositivo_id, d.id_fisico,
                    CASE WHEN e.visto_por_ultima_vez IS NULL THEN $1::text
                         WHEN e.visto_por_ultima_vez >= now() - (d.intervalo_esperado_s * 2) * INTERVAL '1 second' THEN $2::text
                         ELSE $3::text END AS motivo
       ), ev AS (
         INSERT INTO evento (dispositivo_id, tipo, detalle)
         SELECT dispositivo_id, 'condicion_cerrada', jsonb_build_object('tipo', 'sin_comunicacion', 'por', 'barrido', 'motivo', motivo) FROM cierra
       )
       SELECT dispositivo_id AS id, id_fisico, motivo FROM cierra`,
      [MOTIVO_DENTRO_DEL_PLAZO, MOTIVO_REPORTA, MOTIVO_EN_SERVICIO],
    );
    for (const d of recuperados.rows) {
      this.log.log(`${d.id_fisico}: ${d.motivo} · condición cerrada`);
      this.eventos.publicar({ tipo: 'condicion', dispositivo_id: d.id, condicion: 'sin_comunicacion', estado: 'cerrada' });
    }

    // (4) Red de seguridad de mantenimiento (RF-22; docs/19 §2): un equipo en mantenimiento no abre ni conserva condiciones, de ningún tipo
    //     (abrirTope y abrirRelojDesviado, y el paso (1), solo abren a un equipo `activo`). PATCH /dispositivos/{id} las cierra al pasar a
    //     mantenimiento; esto cubre las que ya existían, un cambio hecho sin la API y la trama en vuelo que leyó `activo` antes del cambio.
    const enMantenimiento = await this.pool.query<{ id: string; id_fisico: string; tipo: 'umbral' | 'sin_comunicacion' | 'tope_superado' | 'reloj_desviado' }>(
      `WITH cierra AS (
         UPDATE condicion c SET cerrada_en = now() FROM dispositivo d
          WHERE c.dispositivo_id = d.id AND d.estado = 'mantenimiento' AND c.cerrada_en IS NULL
          RETURNING c.id AS condicion_id, c.tipo, d.id AS dispositivo_id, d.id_fisico
       ), ev AS (
         INSERT INTO evento (dispositivo_id, tipo, detalle)
         SELECT dispositivo_id, 'condicion_cerrada', jsonb_build_object('tipo', tipo, 'condicion_id', condicion_id, 'por', 'mantenimiento') FROM cierra
       )
       SELECT dispositivo_id AS id, id_fisico, tipo FROM cierra`,
    );
    for (const d of enMantenimiento.rows) {
      this.log.log(`${d.id_fisico}: en mantenimiento · condición ${d.tipo} cerrada (RF-22)`);
      this.eventos.publicar({ tipo: 'condicion', dispositivo_id: d.id, condicion: d.tipo, estado: 'cerrada' });
    }

    // Tope por emisor (aparte de los cuatro pasos de arriba; docs/10 §8.4 punto 53): una condición abierta cuyo dispositivo ya muestra una hora posterior dentro del
    //    presupuesto (lecturas y ninguna trama sobre el tope). El pipeline la cierra con la primera trama que cabe en la hora nueva; si esa
    //    hora empezó con tramas sin lecturas, la fila ya no dice «sobre el tope» y solo este barrido la cierra (revisión del 17/10).
    const dentro = await this.pool.query<{ id: string; id_fisico: string }>(
      `UPDATE condicion tc SET cerrada_en = now()
         FROM dispositivo d JOIN estado_dispositivo e ON e.dispositivo_id = d.id
        WHERE tc.dispositivo_id = d.id AND tc.tipo = 'tope_superado' AND tc.cerrada_en IS NULL
          AND e.ventana_inicio > date_trunc('hour', tc.abierta_en AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          AND e.ventana_sobre_tope = 0 AND e.ventana_lecturas > 0
        RETURNING d.id, d.id_fisico`,
    );
    for (const d of dentro.rows) {
      await this.pool.query(
        "INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES ($1, 'condicion_cerrada', $2)",
        [d.id, { tipo: 'tope_superado', por: 'barrido' }],
      );
      this.log.log(`${d.id_fisico}: de vuelta dentro del presupuesto de la hora · condición cerrada por el barrido`);
      this.eventos.publicar({ tipo: 'condicion', dispositivo_id: d.id, condicion: 'tope_superado', estado: 'cerrada' });
    }
  }

  // Lo llama el pipeline en cada trama aceptada: cierra la condición si estaba abierta.
  async marcarVivo(dispositivoId: string, idFisico: string): Promise<void> {
    const r = await this.pool.query(
      "UPDATE condicion SET cerrada_en = now() WHERE dispositivo_id = $1 AND tipo = 'sin_comunicacion' AND cerrada_en IS NULL",
      [dispositivoId],
    );
    if (r.rowCount) {
      await this.pool.query(
        "INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES ($1, 'condicion_cerrada', $2)",
        [dispositivoId, { tipo: 'sin_comunicacion' }],
      );
      this.log.log(`${idFisico}: comunicación restablecida · condición cerrada`);
      this.eventos.publicar({ tipo: 'condicion', dispositivo_id: dispositivoId, condicion: 'sin_comunicacion', estado: 'cerrada' });
    }
  }

  // Tope por emisor (docs/10 §8.4 punto 53): la abre el pipeline al rechazar la trama que no cabe en el presupuesto de lecturas de la
  // hora (una sola vez por ventana: el índice único parcial decide, como en las demás) y la cierra la primera trama que entra dentro
  // del presupuesto en una hora posterior. Es una condición del dispositivo, no del enlace: el dispositivo sigue vivo.
  async abrirTope(dispositivoId: string, idFisico: string, detalle: object): Promise<void> {
    // Una sola sentencia (condición y evento) y solo para un equipo `activo`: en mantenimiento no se abre nada (RF-22), sin evento ni aviso.
    const r = await this.pool.query(
      `WITH abre AS (
         INSERT INTO condicion (dispositivo_id, tipo) SELECT d.id, 'tope_superado' FROM dispositivo d WHERE d.id = $1 AND d.estado = 'activo'
         ON CONFLICT (dispositivo_id, tipo, COALESCE(regla_id, '00000000-0000-0000-0000-000000000000'::uuid))
         WHERE cerrada_en IS NULL DO NOTHING
         RETURNING dispositivo_id
       )
       INSERT INTO evento (dispositivo_id, tipo, detalle) SELECT dispositivo_id, 'condicion_abierta', $2::jsonb FROM abre`,
      [dispositivoId, { tipo: 'tope_superado', ...detalle }],
    );
    if (r.rowCount === 0) return;
    this.log.warn(`${idFisico}: tope por emisor superado · condición abierta`);
    this.eventos.publicar({ tipo: 'condicion', dispositivo_id: dispositivoId, condicion: 'tope_superado', estado: 'abierta' });
  }

  async cerrarTope(dispositivoId: string, idFisico: string, detalle: object): Promise<void> {
    const r = await this.pool.query(
      "UPDATE condicion SET cerrada_en = now() WHERE dispositivo_id = $1 AND tipo = 'tope_superado' AND cerrada_en IS NULL",
      [dispositivoId],
    );
    if (r.rowCount) {
      await this.pool.query(
        "INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES ($1, 'condicion_cerrada', $2)",
        [dispositivoId, { tipo: 'tope_superado', ...detalle }],
      );
      this.log.log(`${idFisico}: de vuelta dentro del presupuesto de la hora · condición cerrada`);
      this.eventos.publicar({ tipo: 'condicion', dispositivo_id: dispositivoId, condicion: 'tope_superado', estado: 'cerrada' });
    }
  }

  // Reloj de la pasarela desviado (docs/10 §8.4 punto 54; docs/13 regla 18): la abre el pipeline cuando la marca de la pasarela difiere
  // más de 10 min de la llegada (la medición queda fechada por la recepción) y la cierra la primera trama del mismo dispositivo con marca
  // de pasarela plausible. Es del dispositivo cuya trama llegó: el modelo no tiene estado propio de pasarela. El detalle lleva la
  // pasarela, el desvío en segundos (negativo = atrasada) y la marca recibida.
  async abrirRelojDesviado(dispositivoId: string, idFisico: string, detalle: object): Promise<void> {
    // Una sola sentencia (condición y evento) y solo para un equipo `activo`, como abrirTope (RF-22).
    const r = await this.pool.query(
      `WITH abre AS (
         INSERT INTO condicion (dispositivo_id, tipo) SELECT d.id, 'reloj_desviado' FROM dispositivo d WHERE d.id = $1 AND d.estado = 'activo'
         ON CONFLICT (dispositivo_id, tipo, COALESCE(regla_id, '00000000-0000-0000-0000-000000000000'::uuid))
         WHERE cerrada_en IS NULL DO NOTHING
         RETURNING dispositivo_id
       )
       INSERT INTO evento (dispositivo_id, tipo, detalle) SELECT dispositivo_id, 'condicion_abierta', $2::jsonb FROM abre`,
      [dispositivoId, { tipo: 'reloj_desviado', ...detalle }],
    );
    if (r.rowCount === 0) return;
    this.log.warn(`${idFisico}: reloj de la pasarela desviado · se usa la hora de recepción · condición abierta`);
    this.eventos.publicar({ tipo: 'condicion', dispositivo_id: dispositivoId, condicion: 'reloj_desviado', estado: 'abierta' });
  }

  async cerrarRelojDesviado(dispositivoId: string, idFisico: string, detalle: object): Promise<void> {
    const r = await this.pool.query(
      "UPDATE condicion SET cerrada_en = now() WHERE dispositivo_id = $1 AND tipo = 'reloj_desviado' AND cerrada_en IS NULL",
      [dispositivoId],
    );
    if (r.rowCount) {
      await this.pool.query(
        "INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES ($1, 'condicion_cerrada', $2)",
        [dispositivoId, { tipo: 'reloj_desviado', ...detalle }],
      );
      this.log.log(`${idFisico}: la marca de la pasarela volvió a ser plausible · condición cerrada`);
      this.eventos.publicar({ tipo: 'condicion', dispositivo_id: dispositivoId, condicion: 'reloj_desviado', estado: 'cerrada' });
    }
  }
}
