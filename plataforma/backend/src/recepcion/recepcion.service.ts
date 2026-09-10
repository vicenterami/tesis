import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { AlertasService } from '../alertas/alertas.service';
import { BrokerService } from '../broker/broker.service';
import { POOL } from '../db/db.module';
import { SupervisionService } from '../supervision/supervision.service';
import { Adaptador, TramaMalformada } from './adaptadores/adaptador';
import { PlanoAdaptador } from './adaptadores/plano.adaptador';
import { SenmlAdaptador } from './adaptadores/senml.adaptador';
import { ContextoTrama, Lectura } from './lectura';
import { aCanonica } from './unidades';

// Forma del tópico acordada: sitio/<sitio>/dispositivo/<id_fisico>/<magnitud>
const PATRON_TOPICO = /^sitio\/([^/]+)\/dispositivo\/([^/]+)\/([^/]+)$/;

// Marca de tiempo del emisor: se acepta solo si es plausible (docs/13, regla 7).
//  · sin marca                      → hora de recepción (nodo sin reloj)
//  · anterior al año 2000           → hora de recepción (reloj sin inicializar: epoch 0 = 1970)
//  · más de 2 min en el futuro      → hora de recepción (reloj adelantado); ≤ 2 min se tolera como deriva
//  · antigua pero posterior a 2000  → se RESPETA: un nodo que guardó lecturas sin cobertura y las
//                                     envía después reporta tiempos legítimamente viejos
const ANIO_2000 = Date.UTC(2000, 0, 1);
const DERIVA_MAX_MS = 2 * 60 * 1000;
function tiempoPlausible(emisor: Date | undefined, recibidoEn: Date): Date {
  if (!emisor) return recibidoEn;
  const t = emisor.getTime();
  if (Number.isNaN(t) || t < ANIO_2000) return recibidoEn;
  if (t > recibidoEn.getTime() + DERIVA_MAX_MS) return recibidoEn;
  return t > recibidoEn.getTime() ? recibidoEn : emisor;
}

interface Dispositivo { id: string; estado: 'activo' | 'mantenimiento' | 'baja' }
interface Canal { id: string; magnitud: string; unidad_canonica: string; rango_min: number | null; rango_max: number | null }

// M1 Recepción + M2 Pipeline. Los seis filtros: 1 autenticar · 2 analizar · 3 validar ·
// 4 normalizar · 5 supervisar (con SupervisionService) · 6 alertar (con AlertasService).
//
//   trama ─► [1] ¿registrado y activo? ──no──► cuarentena "desconocido"
//             │
//             ▼
//           [2] ¿algún adaptador la entiende? ──no──► cuarentena "malformada"
//             │  (SenML nativo · plano · próximamente ChirpStack)
//             ▼  lecturas {magnitud, valor, unidad, tiempo}
//           [3] ¿canal declarado? ¿unidad convertible? ¿valor en rango? ──no──► cuarentena "invalida"
//             │
//             ▼
//           [4] convertir a unidad canónica · fijar tiempo · INSERT medicion (hypertable)
//             │
//             ▼
//           [6] umbrales con histéresis → abre/cierra condición "umbral" (AlertasService)
//             │
//             ▼
//           [5] visto_por_ultima_vez = now() · cierra "sin_comunicacion" si estaba abierta
//               (la APERTURA de "sin_comunicacion" la hace el barrido periódico de SupervisionService)
@Injectable()
export class RecepcionService implements OnModuleInit {
  private readonly log = new Logger('recepcion');
  private readonly adaptadores: Adaptador[];

  constructor(
    @Inject(POOL) private readonly pool: Pool,
    private readonly broker: BrokerService,
    private readonly alertas: AlertasService,
    private readonly supervision: SupervisionService,
    senml: SenmlAdaptador,
    plano: PlanoAdaptador,
  ) {
    // Orden de prueba: del más específico al más genérico.
    this.adaptadores = [senml, plano];
  }

  onModuleInit(): void {
    this.broker.alRecibir((topico, carga) => this.procesar(topico, carga));
  }

  async procesar(topico: string, carga: Buffer): Promise<void> {
    const partes = PATRON_TOPICO.exec(topico);
    if (!partes) return this.cuarentena(topico, carga, 'malformada', 'tópico fuera del patrón');
    const ctx: ContextoTrama = { topico, idFisico: partes[2], magnitudTopico: partes[3].toLowerCase(), carga };

    // ── [1] Autenticar: credencial válida (ya la verificó el broker) ≠ dispositivo dado de alta ──
    const dispositivo = await this.buscarDispositivo(ctx.idFisico);
    if (!dispositivo || dispositivo.estado === 'baja') {
      return this.cuarentena(topico, carga, 'desconocido', `id_fisico=${ctx.idFisico}`);
    }

    // ── [2] Analizar: el primer adaptador que reconozca el formato la traduce a lecturas ──
    let lecturas: Lectura[];
    const adaptador = this.adaptadores.find((a) => a.reconoce(ctx));
    if (!adaptador) return this.cuarentena(topico, carga, 'malformada', 'ningún adaptador reconoce el formato');
    try {
      lecturas = adaptador.analizar(ctx);
    } catch (e) {
      if (e instanceof TramaMalformada) return this.cuarentena(topico, carga, 'malformada', `${adaptador.nombre}: ${e.message}`);
      throw e;
    }

    // ── [3] Validar y [4] Normalizar, lectura por lectura ──
    const recibidoEn = new Date();
    let guardadas = 0;
    for (const l of lecturas) {
      const canal = await this.buscarCanal(dispositivo.id, l.magnitud);
      if (!canal) {
        await this.cuarentena(topico, carga, 'invalida', `canal no declarado: ${l.magnitud}`);
        continue;
      }
      const valor = aCanonica(l.valor, l.unidad, canal.unidad_canonica);
      if (valor === undefined) {
        await this.cuarentena(topico, carga, 'invalida', `unidad ${l.unidad} no convertible a ${canal.unidad_canonica}`);
        continue;
      }
      if ((canal.rango_min !== null && valor < canal.rango_min) || (canal.rango_max !== null && valor > canal.rango_max)) {
        await this.cuarentena(topico, carga, 'invalida', `fuera de rango: ${valor} ${canal.unidad_canonica}`);
        continue;
      }
      const tiempo = tiempoPlausible(l.tiempo, recibidoEn);
      await this.pool.query(
        'INSERT INTO medicion (canal_id, tiempo, valor, unidad) VALUES ($1, $2, $3, $4)',
        [canal.id, tiempo, valor, canal.unidad_canonica],
      );
      guardadas++;
      // ── [6] Alertar: ¿la medición cruza un umbral de este canal? ──
      await this.alertas.evaluar(dispositivo.id, canal.id, ctx.idFisico, valor, canal.unidad_canonica);
    }

    // ── [5] Supervisar: el dispositivo dio señales de vida; si estaba "sin comunicación", se cierra ──
    await this.pool.query('UPDATE dispositivo SET visto_por_ultima_vez = now() WHERE id = $1', [dispositivo.id]);
    await this.supervision.marcarVivo(dispositivo.id, ctx.idFisico);
    if (guardadas) this.log.log(`${ctx.idFisico}: ${guardadas}/${lecturas.length} lecturas guardadas vía ${adaptador.nombre}`);
  }

  private async buscarDispositivo(idFisico: string): Promise<Dispositivo | undefined> {
    const r = await this.pool.query<Dispositivo>('SELECT id, estado FROM dispositivo WHERE id_fisico = $1', [idFisico]);
    return r.rows[0];
  }

  // El canal une dispositivo + magnitud y trae del catálogo la unidad canónica y el rango válido.
  private async buscarCanal(dispositivoId: string, magnitud: string): Promise<Canal | undefined> {
    const r = await this.pool.query<Canal>(
      `SELECT c.id, m.codigo AS magnitud, m.unidad_canonica, m.rango_min, m.rango_max
         FROM canal c JOIN magnitud m ON m.codigo = c.magnitud_codigo
        WHERE c.dispositivo_id = $1 AND c.magnitud_codigo = $2`,
      [dispositivoId, magnitud],
    );
    return r.rows[0];
  }

  // La trama rechazada se guarda CRUDA con su motivo y un detalle: no contamina las series,
  // pero permite diagnosticar ("¿por qué el nodo 7 manda basura desde ayer?").
  private async cuarentena(topico: string, carga: Buffer, motivo: string, detalle: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO cuarentena (origen, topico, motivo, payload_crudo) VALUES ($1, $2, $3, $4)',
      ['mqtt', topico, motivo, carga],
    );
    this.log.warn(`cuarentena (${motivo}) ${topico} · ${detalle}`);
  }
}
