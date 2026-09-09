import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { BrokerService } from '../broker/broker.service';
import { POOL } from '../db/db.module';

// Forma del tópico acordada: sitio/<sitio>/dispositivo/<id_fisico>/<magnitud>
const PATRON_TOPICO = /^sitio\/([^/]+)\/dispositivo\/([^/]+)\/([^/]+)$/;

interface Dispositivo {
  id: string;
  estado: 'activo' | 'mantenimiento' | 'baja';
}

// M1 Recepción + M2 Pipeline. Hoy implementa el FILTRO 1 (autenticar) y el destino "cuarentena".
// Cada trama que llega del broker pasa por aquí; ninguna llega a las series sin cruzar los filtros.
//
//   trama ──► ¿tópico bien formado? ──no──► cuarentena "malformada"
//               │ sí
//               ▼
//           ¿dispositivo conocido y activo? ──no──► cuarentena "desconocido"
//               │ sí
//               ▼
//           filtros 2–6 (próximas tandas) · por ahora: registra "visto por última vez"
@Injectable()
export class RecepcionService implements OnModuleInit {
  private readonly log = new Logger('recepcion');

  constructor(
    @Inject(POOL) private readonly pool: Pool,
    private readonly broker: BrokerService,
  ) {}

  onModuleInit(): void {
    this.broker.alRecibir((topico, carga) => this.procesar(topico, carga));
  }

  async procesar(topico: string, carga: Buffer): Promise<void> {
    const partes = PATRON_TOPICO.exec(topico);
    if (!partes) {
      await this.cuarentena(topico, carga, 'malformada');
      return;
    }
    const [, , idFisico, magnitud] = partes;

    // ── Filtro 1: autenticar ──────────────────────────────────────────────────────────────
    // El broker ya verificó la credencial; aquí se verifica que el dispositivo esté REGISTRADO
    // en la plataforma y activo. Credencial válida ≠ dispositivo dado de alta: son dos capas.
    const dispositivo = await this.buscarDispositivo(idFisico);
    if (!dispositivo || dispositivo.estado === 'baja') {
      await this.cuarentena(topico, carga, 'desconocido');
      return;
    }

    // ── Filtros 2–6: pendientes ──────────────────────────────────────────────────────────
    await this.pool.query('UPDATE dispositivo SET visto_por_ultima_vez = now() WHERE id = $1', [
      dispositivo.id,
    ]);
    this.log.log(`aceptada: ${idFisico}/${magnitud} (${carga.length} B) · filtros 2–6 pendientes`);
  }

  private async buscarDispositivo(idFisico: string): Promise<Dispositivo | undefined> {
    const r = await this.pool.query<Dispositivo>(
      'SELECT id, estado FROM dispositivo WHERE id_fisico = $1',
      [idFisico],
    );
    return r.rows[0];
  }

  // La trama rechazada se guarda CRUDA (bytes tal cual) con su motivo: no contamina las series,
  // pero permite diagnosticar. Nunca se descarta en silencio.
  private async cuarentena(topico: string, carga: Buffer, motivo: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO cuarentena (origen, topico, motivo, payload_crudo) VALUES ($1, $2, $3, $4)',
      ['mqtt', topico, motivo, carga],
    );
    this.log.warn(`cuarentena (${motivo}): ${topico}`);
  }
}
