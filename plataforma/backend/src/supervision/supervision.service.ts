import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { POOL } from '../db/db.module';

// M4 Supervisión de salud — filtro 6 completo.
//
// El pipeline solo corre cuando LLEGA una trama; por eso no puede notar que un dispositivo DEJÓ
// de transmitir. Este servicio barre la tabla periódicamente y compara "visto por última vez"
// con el intervalo esperado de cada dispositivo. Tolerancia: 2 intervalos (un mensaje perdido no
// es una caída; dos seguidos, sí). Abre la condición `sin_comunicacion`; la cierra el propio
// pipeline cuando vuelve a llegar una trama (RecepcionService.marcarVivo), o este barrido si la
// encuentra abierta con el dispositivo ya visto.
@Injectable()
export class SupervisionService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('supervision');
  private temporizador?: NodeJS.Timeout;

  constructor(@Inject(POOL) private readonly pool: Pool, private readonly config: ConfigService) {}

  onModuleInit(): void {
    const cadaSeg = this.config.get<number>('SUPERVISION_INTERVALO_S', 60);
    this.temporizador = setInterval(() => void this.barrer(), cadaSeg * 1000);
    this.log.log(`barrido de salud cada ${cadaSeg} s`);
  }

  onModuleDestroy(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  async barrer(): Promise<void> {
    // 1) Dispositivos activos, vistos alguna vez, cuyo silencio supera 2 × intervalo esperado y
    //    que aún no tienen la condición abierta → abrirla.
    const caidos = await this.pool.query<{ id: string; id_fisico: string; silencio_s: number }>(
      `SELECT d.id, d.id_fisico,
              EXTRACT(EPOCH FROM now() - d.visto_por_ultima_vez)::int AS silencio_s
         FROM dispositivo d
        WHERE d.estado = 'activo'
          AND d.visto_por_ultima_vez IS NOT NULL
          AND d.visto_por_ultima_vez < now() - (d.intervalo_esperado_s * 2) * INTERVAL '1 second'
          AND NOT EXISTS (SELECT 1 FROM condicion c
                           WHERE c.dispositivo_id = d.id AND c.tipo = 'sin_comunicacion' AND c.cerrada_en IS NULL)`,
    );
    for (const d of caidos.rows) {
      await this.pool.query("INSERT INTO condicion (dispositivo_id, tipo) VALUES ($1, 'sin_comunicacion')", [d.id]);
      await this.pool.query(
        "INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES ($1, 'condicion_abierta', $2)",
        [d.id, { tipo: 'sin_comunicacion', silencio_s: d.silencio_s }],
      );
      this.log.warn(`${d.id_fisico}: sin comunicación hace ${d.silencio_s} s · condición abierta`);
    }

    // 2) Red de seguridad: condiciones abiertas de dispositivos que ya volvieron → cerrarlas.
    const recuperados = await this.pool.query<{ id: string; id_fisico: string }>(
      `UPDATE condicion c SET cerrada_en = now()
         FROM dispositivo d
        WHERE c.dispositivo_id = d.id AND c.tipo = 'sin_comunicacion' AND c.cerrada_en IS NULL
          AND d.visto_por_ultima_vez >= now() - (d.intervalo_esperado_s * 2) * INTERVAL '1 second'
        RETURNING d.id, d.id_fisico`,
    );
    for (const d of recuperados.rows) this.log.log(`${d.id_fisico}: comunicación restablecida · condición cerrada`);
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
    }
  }
}
