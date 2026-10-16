import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { AlertasService } from '../alertas/alertas.service';
import { BrokerService } from '../broker/broker.service';
import { POOL } from '../db/db.module';
import { SupervisionService } from '../supervision/supervision.service';
import { EventosService } from '../tiempo-real/eventos.service';
import { Adaptador, TramaMalformada } from './adaptadores/adaptador';
import { ChirpstackAdaptador } from './adaptadores/chirpstack.adaptador';
import { IdentidadNoVerificada } from './adaptadores/lorawan';
import { MilesightAdaptador } from './adaptadores/milesight.adaptador';
import { PlanoAdaptador } from './adaptadores/plano.adaptador';
import { SenmlAdaptador } from './adaptadores/senml.adaptador';
import { ContextoTrama, Lectura } from './lectura';
import { tiempoPlausible } from './tiempo';
import { limpia } from './texto';
import { aCanonica } from './unidades';

// Forma del tópico acordada: sitio/<sitio>/dispositivo/<id_fisico>/<magnitud>
const PATRON_TOPICO = /^sitio\/([^/]+)\/dispositivo\/([^/]+)\/([^/]+)$/;
// Tópico de pasarela (rutas B y C, docs/10 §8.4 punto 47): sitio/<sitio>/pasarela/<id_pasarela>/<deveui>/<evento>, o su forma
// nativa sitio/<sitio>/pasarela/<id_pasarela>/device/<deveui>/event/<evento> (16/10): la que deja un puente de Mosquitto al cambiar
// el prefijo application/<app>/ de la pasarela Milesight por el nuestro, porque el puente no reordena tópicos.
const PATRON_PASARELA = /^sitio\/([^/]+)\/pasarela\/([^/]+)\/(?:device\/([^/]+)\/event\/([^/]+)|([^/]+)\/([^/]+))$/;
// Formatos que solo llegan por el tópico de su pasarela (el nodo lorawan los hereda de ella: migración 15).
const FORMATOS_PASARELA = new Set(['milesight', 'chirpstack']);

interface Dispositivo {
  id: string; estado: 'activo' | 'mantenimiento' | 'baja'; formato: string; pasarela_id: string | null; sitio_codigo: string;
  decodificador: string | null; // perfil de decodificación (migración 17)
  ultimo_fcnt: string | null; // bigint: node-postgres lo entrega como texto (cabe en un número: 32 bits)
}
interface Pasarela { id: string; activo: boolean; sitio_codigo: string }
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
//           [2] ¿la entiende el adaptador de su formato declarado? ──no──► cuarentena "malformada"
//             │  (senml nativo · plano; milesight y chirpstack, de la pasarela: docs/10 §8.4 punto 47)
//             ▼  lecturas {magnitud, valor, unidad, tiempo}
//           [3] ¿repite el fCnt de la última trama LoRaWAN guardada? ──sí──► se descarta y se anota (no es cuarentena)
//             │  ¿canal declarado? ¿unidad convertible? ¿valor en rango? ──no──► cuarentena "invalida"
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
//           [6] estado_dispositivo.visto_por_ultima_vez = now() · ultimo_fcnt si guardó alguna lectura · cierra "sin_comunicacion"
//               (corre SIEMPRE tras [1], aunque [2] o [3] hayan mandado la trama a cuarentena)
//               (la APERTURA de "sin_comunicacion" la hace el barrido periódico de SupervisionService)
@Injectable()
export class RecepcionService implements OnModuleInit {
  private readonly log = new Logger('recepcion');
  // Uno por formato declarado (docs/10 §8.4 puntos 25 y 47): el filtro 2 no adivina, usa el del alta.
  private readonly adaptadores: Map<string, Adaptador>;

  constructor(
    @Inject(POOL) private readonly pool: Pool,
    private readonly broker: BrokerService,
    private readonly alertas: AlertasService,
    private readonly supervision: SupervisionService,
    private readonly eventos: EventosService,
    senml: SenmlAdaptador,
    plano: PlanoAdaptador,
    chirpstack: ChirpstackAdaptador,
    milesight: MilesightAdaptador,
  ) {
    this.adaptadores = new Map<string, Adaptador>([senml, plano, chirpstack, milesight].map((a) => [a.nombre, a]));
  }

  onModuleInit(): void {
    this.broker.alRecibir((topico, carga) => this.procesar(topico, carga));
  }

  async procesar(topico: string, carga: Buffer): Promise<void> {
    // La hora de llegada se toma ANTES de consultar la base: es la del mensaje, no la del final del pipeline.
    const recibidoEn = new Date();
    const trama: TramaRecibida = { topico, carga, recibidoEn };
    const dePasarela = PATRON_PASARELA.exec(topico);
    if (dePasarela) return this.procesarDePasarela(trama, dePasarela);
    const partes = PATRON_TOPICO.exec(topico);
    if (!partes) {
      return this.cuarentena(trama, 'malformada',
        'tópico fuera de los dos patrones: sitio/<sitio>/dispositivo/<id>/<magnitud> o sitio/<sitio>/pasarela/<id>/[device/]<deveui>/[event/]<evento>');
    }
    const ctx: ContextoTrama = { topico, idFisico: partes[2], magnitudTopico: partes[3].toLowerCase(), carga };

    // ── [1] Autenticar: credencial válida (ya la verificó el broker) ≠ dispositivo dado de alta ──
    const dispositivo = await this.buscarDispositivo(ctx.idFisico);
    // Sin credencial la trama ni siquiera llega aquí: la corta el broker (allow_anonymous false + ACL).
    // Llega con credencial válida y sin alta, o con alta dada de baja: la clave vive en el plugin del broker (docs/10 §8.4
    // punto 42) y el alta en la base. Un dado de baja SÍ queda identificado: es la señal de que su clave sigue viva.
    if (!dispositivo) return this.cuarentena(trama, 'no_registrado', `id_fisico=${limpia(ctx.idFisico, 64)} sin alta en la plataforma`);
    if (dispositivo.estado === 'baja') {
      return this.cuarentena({ ...trama, dispositivoId: dispositivo.id },
        'dado_de_baja', `id_fisico=${limpia(ctx.idFisico, 64)}: revocar su credencial en el broker`);
    }
    // El sitio del tópico debe ser el registrado (08/10, docs/10 §8.4 punto 24): la ACL acepta cualquiera en ese nivel (`+`),
    // así que lo comprueba el pipeline. Sin esto, un dispositivo podría publicar bajo el sitio de otra sede. No se marca
    // vivo: no pasó el filtro 1.
    if (dispositivo.sitio_codigo !== partes[1]) {
      return this.cuarentena({ ...trama, dispositivoId: dispositivo.id }, 'no_registrado',
        `id_fisico=${ctx.idFisico} está registrado en el sitio «${dispositivo.sitio_codigo}», no en «${limpia(partes[1], 64)}»`);
    }
    trama.dispositivoId = dispositivo.id;
    return this.filtros2a6(trama, ctx, dispositivo, false);
  }

  // Rutas B y C (docs/10 §8.4 punto 47). Orden del filtro 1: (i) la pasarela registrada, activa y del sitio del tópico, si no
  // cuarentena con cualquier evento (una credencial publicando donde no le corresponde); (ii) un evento distinto de «up» se anota en el
  // registro de depuración y termina, sin escribir en la base (punto 27); (iii) el DevEUI del tópico, en minúsculas, debe
  // ser un nodo asociado a esa pasarela.
  private async procesarDePasarela(trama: TramaRecibida, partes: RegExpExecArray): Promise<void> {
    const [sitio, idPasarela] = [partes[1], partes[2]];
    const deveuiTopico = partes[3] ?? partes[5]; // forma nativa (device/<deveui>/event/<evento>) o la propia (<deveui>/<evento>)
    const evento = partes[4] ?? partes[6];
    const pasarela = await this.buscarPasarela(idPasarela);
    if (!pasarela) return this.cuarentena(trama, 'no_registrado', `pasarela ${limpia(idPasarela, 64)} sin alta en la plataforma`);
    if (!pasarela.activo) return this.cuarentena(trama, 'no_registrado', `pasarela ${limpia(idPasarela, 64)} inactiva: revocar su credencial en el broker`);
    if (pasarela.sitio_codigo !== sitio) {
      return this.cuarentena(trama, 'no_registrado',
        `pasarela ${limpia(idPasarela, 64)} está registrada en el sitio «${pasarela.sitio_codigo}», no en «${limpia(sitio, 64)}»`);
    }
    if (evento !== 'up') {
      // Depuración, no información: ChirpStack emite status, ack y log por cada nodo, y con muchos nodos llenarían el registro.
      this.log.debug(`pasarela ${limpia(idPasarela, 64)}: evento «${limpia(evento)}» de ${limpia(deveuiTopico)} · no se guarda (docs/10 §8.4 punto 47)`);
      return;
    }
    const deveui = deveuiTopico.toLowerCase();
    const nodo = await this.buscarDispositivo(deveui);
    if (!nodo || nodo.pasarela_id !== pasarela.id) {
      return this.cuarentena(trama, 'no_registrado', `DevEUI ${limpia(deveui)} no está asociado a la pasarela ${limpia(idPasarela, 64)}`);
    }
    if (nodo.estado === 'baja') {
      return this.cuarentena({ ...trama, dispositivoId: nodo.id }, 'dado_de_baja', `DevEUI ${deveui}: dado de baja`);
    }
    // El nodo y su pasarela son del mismo sitio por el alta; se comprueba igual (defensa en profundidad, revisión del 15/10).
    if (nodo.sitio_codigo !== sitio) {
      return this.cuarentena({ ...trama, dispositivoId: nodo.id }, 'no_registrado', `DevEUI ${deveui} está registrado en el sitio «${nodo.sitio_codigo}», no en «${limpia(sitio, 64)}»`);
    }
    trama.dispositivoId = nodo.id;
    const ctx: ContextoTrama = { topico: trama.topico, idFisico: deveui, magnitudTopico: '', carga: trama.carga, deveui, decodificador: nodo.decodificador ?? undefined };
    return this.filtros2a6(trama, ctx, nodo, true);
  }

  // Filtros 2 a 6, comunes a las dos formas de tópico: el dispositivo ya pasó el filtro 1.
  private async filtros2a6(trama: TramaRecibida, ctx: ContextoTrama, dispositivo: Dispositivo, dePasarela: boolean): Promise<void> {
    const { topico, carga, recibidoEn } = trama;

    // ── [2] Analizar: el adaptador del formato declarado en el alta la traduce a lecturas (punto 47: no se adivina) ──
    // Una trama que no se entiende va a cuarentena, pero el pipeline NO termina aquí: el dispositivo ya
    // se autenticó, así que el filtro 6 debe marcarlo vivo igual (docs/10 §4: «vivo» es salud del enlace,
    // no calidad del dato; un nodo mal configurado está vivo, no en silencio). Con lecturas vacías, los
    // filtros 3 a 5 simplemente no tienen nada que hacer.
    let lecturas: Lectura[] = [];
    // Un formato de pasarela solo llega por el tópico de su pasarela, y uno directo solo por el del dispositivo.
    const formatoEnSuTopico = FORMATOS_PASARELA.has(dispositivo.formato) === dePasarela;
    const adaptador = formatoEnSuTopico ? this.adaptadores.get(dispositivo.formato) : undefined;
    if (!adaptador) {
      await this.cuarentena(trama, 'malformada', `formato declarado ${dispositivo.formato}: no se recibe por este tópico`);
      // Por el tópico de pasarela sin un adaptador de pasarela nadie verificó el DevEUI: no se marca vivo (§4.1). Hoy lo impide la
      // clave foránea compuesta de la migración 15; esto cierra el camino si esa regla cambiara (defensa en profundidad).
      if (dePasarela) return;
    } else if (!adaptador.reconoce(ctx)) {
      await this.cuarentena(trama, 'malformada', `formato declarado ${dispositivo.formato}: la trama no tiene esa forma`);
      // Por el tópico de pasarela, una trama que ni siquiera tiene la forma no identifica al nodo: no se marca vivo (§4.1).
      if (dePasarela) return;
    } else {
      try {
        lecturas = adaptador.analizar(ctx);
      } catch (e) {
        if (!(e instanceof TramaMalformada)) throw e;
        // El contador pudo anotarse antes de fallar (p. ej. data corta): una trama que no se entendió no es «la repetida» (§4.1).
        ctx.fcnt = undefined;
        await this.cuarentena(trama, 'malformada', `formato declarado ${adaptador.nombre}: ${e.message}`);
        // El cuerpo no deja verificar el DevEUI (otro, ausente o ilegible): no hay certeza de que sea del nodo, no se marca vivo (§4.1).
        if (e instanceof IdentidadNoVerificada) return;
      }
    }

    // ── [3] Validar: una trama LoRaWAN que repite el contador de trama de la última guardada es la misma trama (docs/10 §4.1) ──
    // Se descarta entera, sin cuarentena; el nodo sí se marca vivo (llegó por su pasarela con su DevEUI verificado). Un contador
    // menor se acepta: vuelve a cero cuando el nodo se une otra vez a la red. Leer, comparar y escribir sin bloqueo basta porque
    // los mensajes se procesan de a uno (decisión 4, BrokerService).
    const repetida = ctx.fcnt !== undefined && dispositivo.ultimo_fcnt !== null && Number(dispositivo.ultimo_fcnt) === ctx.fcnt;
    if (repetida) lecturas = [];

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
      const r = await this.pool.query<{ tiempo: Date }>(
        `INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo)
         VALUES ($1, COALESCE($2::timestamptz, clock_timestamp()), $3, $4, $5, $6)
         ON CONFLICT (canal_id, tiempo) DO NOTHING
         RETURNING tiempo`,
        [canal.id, tiempoDelEmisor ? tiempo : null, valor, canal.unidad_canonica, recibidoEn,
          tiempoDelEmisor ? adaptador?.origenTiempo : 'recepcion'],
      );
      if (r.rowCount === 0) {
        duplicadas++;
        continue; // ya estaba: no se reevalúa el umbral ni se cuenta como nueva
      }
      guardadas++;
      // Al panel en vivo (TT-39), ya guardada: el INSERT se confirma solo (sin transacción por trama).
      this.eventos.publicar({
        tipo: 'medicion', dispositivo_id: dispositivo.id, canal_id: canal.id, valor, unidad: canal.unidad_canonica,
        tiempo: r.rows[0].tiempo.toISOString(), // la marca que puso la base, no la de JavaScript
      });
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
    // El contador de trama se guarda aquí, DESPUÉS de las lecturas y solo si dejó alguna nueva (migración 17): si el proceso se corta
    // antes, la reentrega vuelve a pasar el filtro 3 y la absorbe el índice único de medicion, en vez de perderse (docs/10 §4.1).
    const visto = await this.pool.query<{ visto_por_ultima_vez: Date }>(
      `INSERT INTO estado_dispositivo (dispositivo_id, visto_por_ultima_vez, ultimo_fcnt) VALUES ($1, now(), $2)
       ON CONFLICT (dispositivo_id) DO UPDATE SET visto_por_ultima_vez = EXCLUDED.visto_por_ultima_vez,
         ultimo_fcnt = COALESCE(EXCLUDED.ultimo_fcnt, estado_dispositivo.ultimo_fcnt)
       RETURNING visto_por_ultima_vez`,
      [dispositivo.id, guardadas && ctx.fcnt !== undefined ? ctx.fcnt : null],
    );
    this.eventos.publicar({
      tipo: 'visto', dispositivo_id: dispositivo.id,
      tiempo: visto.rows[0].visto_por_ultima_vez.toISOString(),
    });
    await this.supervision.marcarVivo(dispositivo.id, ctx.idFisico);
    if (repetida) this.log.log(`${ctx.idFisico}: trama repetida (fCnt ${ctx.fcnt}, el de la última guardada) · descartada vía ${adaptador?.nombre}`);
    if (guardadas || duplicadas) {
      const dup = duplicadas ? ` · ${duplicadas} duplicada(s) ignorada(s)` : '';
      const ign = ctx.ignoradas?.length ? ` · ${ctx.ignoradas.length} clave(s) fuera del mapa: ${ctx.ignoradas.slice(0, 5).join(', ')}` : '';
      this.log.log(`${ctx.idFisico}: ${guardadas}/${lecturas.length} lecturas guardadas vía ${adaptador?.nombre}${dup}${ign}`);
    }
  }

  private async buscarPasarela(idFisico: string): Promise<Pasarela | undefined> {
    const r = await this.pool.query<Pasarela>(
      'SELECT p.id, p.activo, s.codigo AS sitio_codigo FROM pasarela p JOIN sitio s ON s.id = p.sitio_id WHERE p.id_fisico = $1',
      [idFisico],
    );
    return r.rows[0];
  }

  private async buscarDispositivo(idFisico: string): Promise<Dispositivo | undefined> {
    const r = await this.pool.query<Dispositivo>(
      `SELECT d.id, d.estado, d.formato, d.pasarela_id, s.codigo AS sitio_codigo, d.decodificador, e.ultimo_fcnt FROM dispositivo d
         JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id
         LEFT JOIN estado_dispositivo e ON e.dispositivo_id = d.id
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
    // El tópico crudo queda en su columna como evidencia; al registro va limpio (revisión del 15/10).
    this.log.warn(`cuarentena (${motivo}) ${limpia(t.topico, 256)} · ${detalle}`);
  }
}
