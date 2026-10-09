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
import { tiempoPlausible } from './tiempo';
import { aCanonica } from './unidades';

// Forma del tópico acordada: sitio/<sitio>/dispositivo/<id_fisico>/<magnitud>
const PATRON_TOPICO = /^sitio\/([^/]+)\/dispositivo\/([^/]+)\/([^/]+)$/;

interface Dispositivo { id: string; estado: 'activo' | 'mantenimiento' | 'baja'; sitio_codigo: string }
// Dominio cerrado: el mismo CHECK de la migración 09. Agregar un motivo exige migración, no solo código.
type Motivo = 'no_registrado' | 'dado_de_baja' | 'malformada' | 'invalida';
// Lo que se sabe de la trama al rechazarla. dispositivoId solo existe si el filtro 1 pudo atribuirla.
interface TramaRecibida { topico: string; carga: Buffer; recibidoEn: Date; dispositivoId?: string }
interface Canal { id: string; magnitud: string; unidad_canonica: string; rango_min: number | null; rango_max: number | null }

// M1 Recepción + M2 Normalización (pipeline). Los seis filtros: 1 autenticar · 2 analizar · 3 validar ·
// 4 normalizar · 5 alertar (con AlertasService) · 6 supervisar (con SupervisionService).
//
//   trama ─► [1] ¿registrado, activo y en su sitio? ──no──► cuarentena "no_registrado" o "dado_de_baja"
//             │
//             ▼
//           [2] ¿algún adaptador la entiende? ──no──► cuarentena "malformada"
//             │  (SenML nativo · plano · próximamente el de la pasarela, ruta B)
//             ▼  lecturas {magnitud, valor, unidad, tiempo}
//           [3] ¿canal declarado? ¿unidad convertible? ¿valor en rango? ──no──► cuarentena "invalida"
//             │
//             ▼
//           [4] convertir a unidad canónica · fijar tiempo · INSERT medicion (hypertable)
//             │  (rechazos de [3] acumulados → UNA fila de cuarentena con todos los porqués)
//             │  (si guardó al menos una lectura → INSERT trama cruda, 30 días)
//             │
//             ▼
//           [5] umbrales con histéresis → abre/cierra condición "umbral" (AlertasService)
//             │
//             ▼
//           [6] estado_dispositivo.visto_por_ultima_vez = now() · cierra "sin_comunicacion" si estaba abierta
//               (corre SIEMPRE tras [1], aunque [2] o [3] hayan mandado la trama a cuarentena)
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
    // La hora de llegada se toma ANTES de consultar la base: es la del mensaje, no la del final del pipeline.
    const recibidoEn = new Date();
    const partes = PATRON_TOPICO.exec(topico);
    const trama: TramaRecibida = { topico, carga, recibidoEn };
    if (!partes) return this.cuarentena(trama, 'malformada', 'tópico fuera del patrón sitio/<sitio>/dispositivo/<id>/<magnitud>');
    const ctx: ContextoTrama = { topico, idFisico: partes[2], magnitudTopico: partes[3].toLowerCase(), carga };

    // ── [1] Autenticar: credencial válida (ya la verificó el broker) ≠ dispositivo dado de alta ──
    const dispositivo = await this.buscarDispositivo(ctx.idFisico);
    // Sin credencial la trama ni siquiera llega aquí: la corta el broker (allow_anonymous false + ACL).
    // Llega con credencial válida y sin alta, o con alta dada de baja: la clave vive en el passwd del broker
    // y el alta en la base. Un dado de baja SÍ queda identificado: es la señal de que su clave sigue viva.
    if (!dispositivo) return this.cuarentena(trama, 'no_registrado', `id_fisico=${ctx.idFisico} sin alta en la plataforma`);
    if (dispositivo.estado === 'baja') {
      return this.cuarentena({ ...trama, dispositivoId: dispositivo.id },
        'dado_de_baja', `id_fisico=${ctx.idFisico}: revocar su credencial en el broker`);
    }
    // El sitio del tópico debe ser el registrado (08/10, docs/10 §8.4 punto 24): la ACL acepta cualquiera en ese nivel (`+`),
    // así que lo comprueba el pipeline. Sin esto, un dispositivo podría publicar bajo el sitio de otra sede. No se marca
    // vivo: no pasó el filtro 1.
    if (dispositivo.sitio_codigo !== partes[1]) {
      return this.cuarentena({ ...trama, dispositivoId: dispositivo.id }, 'no_registrado',
        `id_fisico=${ctx.idFisico} está registrado en el sitio «${dispositivo.sitio_codigo}», no en «${partes[1]}»`);
    }
    trama.dispositivoId = dispositivo.id;

    // ── [2] Analizar: el primer adaptador que reconozca el formato la traduce a lecturas ──
    // Una trama que no se entiende va a cuarentena, pero el pipeline NO termina aquí: el dispositivo ya
    // se autenticó, así que el filtro 6 debe marcarlo vivo igual (docs/10 §4: «vivo» es salud del enlace,
    // no calidad del dato; un nodo mal configurado está vivo, no en silencio). Con lecturas vacías, los
    // filtros 3 a 5 simplemente no tienen nada que hacer.
    let lecturas: Lectura[] = [];
    const adaptador = this.adaptadores.find((a) => a.reconoce(ctx));
    if (!adaptador) {
      await this.cuarentena(trama, 'malformada', 'ningún adaptador reconoce el formato (SenML, plano)');
    } else {
      try {
        lecturas = adaptador.analizar(ctx);
      } catch (e) {
        if (!(e instanceof TramaMalformada)) throw e;
        await this.cuarentena(trama, 'malformada', `${adaptador.nombre}: ${e.message}`);
      }
    }

    // ── [3] Validar y [4] Normalizar, lectura por lectura ──
    // Los rechazos se acumulan: una trama con tres lecturas malas deja UNA fila de cuarentena (con su payload
    // una sola vez) y los tres porqués en el detalle, no tres copias del mismo payload.
    const rechazos: string[] = [];
    let guardadas = 0;
    let duplicadas = 0;
    for (const l of lecturas) {
      const canal = await this.buscarCanal(dispositivo.id, l.magnitud);
      if (!canal) {
        rechazos.push(`${l.magnitud}: canal no declarado para este dispositivo`);
        continue;
      }
      const valor = aCanonica(l.valor, l.unidad, canal.unidad_canonica);
      if (valor === undefined) {
        rechazos.push(`${l.magnitud}: unidad ${l.unidad} no convertible a ${canal.unidad_canonica}`);
        continue;
      }
      if ((canal.rango_min !== null && valor < canal.rango_min) || (canal.rango_max !== null && valor > canal.rango_max)) {
        rechazos.push(`${l.magnitud}: ${valor} ${canal.unidad_canonica} fuera del rango físico [${canal.rango_min ?? '−∞'}, ${canal.rango_max ?? '∞'}]`);
        continue;
      }
      const tiempo = tiempoPlausible(l.tiempo, recibidoEn);
      // Idempotente: la misma lectura (canal + instante) puede llegar dos veces con QoS 1 —reentrega
      // tras una reconexión, o un nodo que reenvía su cola— y debe contar una sola vez (RF-10).
      // La deduplicación solo tiene sentido si el INSTANTE LO PUSO EL EMISOR. Si la marca no es plausible
      // y se usa la hora de recepción, cada llegada es una lectura distinta por definición: la base pone
      // clock_timestamp() (microsegundos) en vez del Date de JavaScript (milisegundos), porque una ráfaga
      // de tramas en cola se procesa en el mismo milisegundo y colisionaría entre sí (visto el 15/09).
      const tiempoDelEmisor = tiempo !== recibidoEn;
      // recibido_en y origen_tiempo (migración 08): la fila dice de dónde salió `tiempo` y permite medir la
      // deriva del reloj del emisor (recibido_en − tiempo, RF-47). Con origen 'recepcion' esa deriva no
      // significa nada (tiempo lo puso la base microsegundos después): la vista de salud la excluye.
      const r = await this.pool.query(
        `INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo)
         VALUES ($1, COALESCE($2::timestamptz, clock_timestamp()), $3, $4, $5, $6)
         ON CONFLICT (canal_id, tiempo) DO NOTHING`,
        [canal.id, tiempoDelEmisor ? tiempo : null, valor, canal.unidad_canonica, recibidoEn,
          tiempoDelEmisor ? adaptador?.origenTiempo : 'recepcion'],
      );
      if (r.rowCount === 0) {
        duplicadas++;
        continue; // ya estaba: no se reevalúa el umbral ni se cuenta como nueva
      }
      guardadas++;
      // ── [5] Alertar: ¿la medición cruza un umbral de este canal? (en mantenimiento no abre condiciones, RF-22) ──
      await this.alertas.evaluar(dispositivo.id, canal.id, ctx.idFisico, valor, canal.unidad_canonica, dispositivo.estado === 'mantenimiento');
    }

    if (rechazos.length) await this.cuarentena(trama, 'invalida', rechazos.join('; '));
    // Trama cruda aceptada (migración 09): solo si dejó al menos una lectura nueva. Una reentrega duplicada
    // no se vuelve a guardar: su original ya está. Vence a los RETENCION_TRAMA_DIAS (RetencionService).
    if (guardadas) {
      await this.pool.query(
        'INSERT INTO trama (dispositivo_id, recibido_en, topico, payload, adaptador) VALUES ($1, $2, $3, $4, $5)',
        [dispositivo.id, recibidoEn, topico, carga, adaptador?.nombre],
      );
    }

    // ── [6] Supervisar: el dispositivo dio señales de vida; si estaba "sin comunicación", se cierra ──
    // En estado_dispositivo, no en dispositivo: la fila que edita una persona no cambia con cada trama (migración 11).
    await this.pool.query(
      `INSERT INTO estado_dispositivo (dispositivo_id, visto_por_ultima_vez) VALUES ($1, now())
       ON CONFLICT (dispositivo_id) DO UPDATE SET visto_por_ultima_vez = EXCLUDED.visto_por_ultima_vez`,
      [dispositivo.id],
    );
    await this.supervision.marcarVivo(dispositivo.id, ctx.idFisico);
    if (guardadas || duplicadas) {
      const dup = duplicadas ? ` · ${duplicadas} duplicada(s) ignorada(s)` : '';
      this.log.log(`${ctx.idFisico}: ${guardadas}/${lecturas.length} lecturas guardadas vía ${adaptador?.nombre}${dup}`);
    }
  }

  private async buscarDispositivo(idFisico: string): Promise<Dispositivo | undefined> {
    const r = await this.pool.query<Dispositivo>(
      `SELECT d.id, d.estado, s.codigo AS sitio_codigo FROM dispositivo d
         JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id
        WHERE d.id_fisico = $1`,
      [idFisico],
    );
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

  // La trama rechazada se guarda CRUDA con su motivo y su detalle: no contamina las series,
  // pero permite diagnosticar ("¿por qué el nodo 7 manda basura desde ayer?"). El detalle va a la base
  // (lo consulta el usuario y no vence con la rotación de logs) y también al log (lo observa el equipo).
  private async cuarentena(t: TramaRecibida, motivo: Motivo, detalle: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO cuarentena (origen, topico, motivo, payload_crudo, detalle, dispositivo_id, recibido_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['mqtt', t.topico, motivo, t.carga, detalle, t.dispositivoId ?? null, t.recibidoEn],
    );
    this.log.warn(`cuarentena (${motivo}) ${t.topico} · ${detalle}`);
  }
}
