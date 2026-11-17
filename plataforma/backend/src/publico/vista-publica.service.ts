import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';
import { POOL } from '../db/db.module.js';
import { errorDeCliente } from '../db/cliente.js';
import { AvisosAcotados } from '../arranque.js';
import { SQL_PUBLICO_AHORA, SQL_PUBLICO_SERIES, intervaloParaRango, sqlLimiteVigencia } from '../consulta/tablero.js';
import { INTERVALOS, SEGUNDOS_INTERVALO } from '../consulta/validacion.js';
import { ContadorAccesos, Cupo, RespuestaGuardada } from './memoria.js';
import {
  avisoKOmision,
  DatosConVentana, FilaAhoraPublica, FilaSeriePublica, HORAS_VENTANA, LimitesPublico, MagnitudCatalogo, NO_DISPONIBLE, PUBLICO, VentanaPublica,
  VistaPublica, ZonaPublicada, armarDatos, armarVista, diaEnZona, hashToken, kSitio, leerToken, limitesPublico, mismoResumen, ventanaPedida,
} from './publico.js';

// El cálculo de una vista que pasó el tiempo máximo: 503, y la respuesta guardada lo guarda como fallo 60 s (docs/19 §4, O, «Decidido al
// implementar»), para no volver a consultar en cada petición.
export const MENSAJE_LENTA = 'los datos están tardando: la página volverá a intentarlo en un minuto';
export class ConsultaLenta extends ServiceUnavailableException {
  constructor() {
    super(MENSAJE_LENTA);
  }
}

// Lo que se publica de un enlace, leído de su fila en CADA petición (punto 6: revocar corta de inmediato en todas las instancias).
export interface EnlaceVigente {
  id: string; sitio_id: string; token_hash: string; titulo: string; descripcion: string | null; magnitudes: string[];
  ventana_maxima: VentanaPublica; zonas: ZonaPublicada[]; sitio: string; zona_horaria: string;
  k_sitio: number | null; // el k que fijó el administrador del sitio (nulo = el del despliegue); kSitio() le aplica el piso
}
// Lo que hace falta para calcular los datos (de un enlace o de la vista previa, que aún no es un enlace). `k`: el del sitio, con el piso.
export interface EntradaDatos { sitioId: string; zonaHoraria: string; magnitudes: string[]; zonas: ZonaPublicada[]; k: number; ventana: VentanaPublica }

// GET /publico (docs/19 §4, O): validar el token contra la fila (una lectura por índice), y recién después la respuesta guardada; los datos
// salen de calcular(), la misma función que usa la vista previa del administrador (punto 3). El contador de accesos vive aquí también.
@Injectable()
export class VistaPublicaService implements OnModuleInit, OnModuleDestroy {
  readonly limites: LimitesPublico;
  private readonly log = new Logger('publico');
  private readonly avisos = new AvisosAcotados();
  private readonly guardadas = new RespuestaGuardada<DatosConVentana>({
    duracionMs: PUBLICO.guardadaMs, maxEntradas: PUBLICO.maxGuardadas, maxBytes: PUBLICO.maxBytesGuardados,
    medir: (d) => Buffer.byteLength(JSON.stringify(d), 'utf8'),
    guardarFallo: (e) => e instanceof ConsultaLenta,
  });
  private readonly cupo = new Cupo(PUBLICO.maxEnCurso, PUBLICO.maxEnEspera);
  // La vista previa del administrador, con su propio cupo (decidido el 17/11/2026): la visita pública no la deja sin respuesta.
  private readonly cupoPrevia = new Cupo(PUBLICO.previaEnCurso, PUBLICO.previaEnEspera);
  readonly contador = new ContadorAccesos(PUBLICO.maxClavesContador);
  private temporizador?: NodeJS.Timeout;
  private volcando: Promise<void> | null = null;

  constructor(@Inject(POOL) private readonly pool: Pool, config: ConfigService) {
    // Un valor inválido detiene el arranque (publico.ts, limitesPublico). Cada variable leída por su nombre, a la vista del guardián (paso 2d:
    // toda variable que lee el backend está en .env.example).
    const entorno: Record<string, string | undefined> = {
      PUBLICO_MINIMO_DISPOSITIVOS: config.get<string>('PUBLICO_MINIMO_DISPOSITIVOS'),
      PUBLICO_MINIMO_DISPOSITIVOS_PISO: config.get<string>('PUBLICO_MINIMO_DISPOSITIVOS_PISO'),
      PUBLICO_VENCIMIENTO_MAX_DIAS: config.get<string>('PUBLICO_VENCIMIENTO_MAX_DIAS'),
      PUBLICO_MAX_ENLACES_POR_SITIO: config.get<string>('PUBLICO_MAX_ENLACES_POR_SITIO'),
      PUBLICO_MAX_ENLACES_TECHO: config.get<string>('PUBLICO_MAX_ENLACES_TECHO'),
    };
    this.limites = limitesPublico((k) => entorno[k]);
  }

  onModuleInit(): void {
    const l = this.limites;
    this.log.log(`vista pública: k por omisión ${l.kPorOmision} (piso ${l.kPiso}), vencimiento máximo ${l.vencimientoMaxDias} días, hasta ${l.maxEnlacesPorSitio} enlaces vivos por sitio (techo ${l.maxEnlacesTecho})`);
    // Responsabilidad del operador (revisión final del 17/11/2026; docs/19 §4, O, punto 2): el k de omisión rige en todo sitio que no fijó
    // el suyo, así que bajarlo baja el de esos sitios sin un evento en su actividad. Queda dicho en el registro cada vez que arranca.
    const aviso = avisoKOmision(l.kPorOmision);
    if (aviso !== null) this.log.warn(aviso);
    this.temporizador = setInterval(() => void this.volcar(), PUBLICO.volcadoMs);
  }
  async onModuleDestroy(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.volcar();
  }

  // La fila del enlace si el token vale AHORA (no vencido, no revocado, no anonimizado, sitio activo), o null. Una lectura por el índice único
  // del resumen, que trae también el k del sitio (sitio.publico_minimo_dispositivos; nulo = el de omisión).
  async vigente(token: string): Promise<EnlaceVigente | null> {
    const resumen = hashToken(token);
    const r = await this.pool.query<EnlaceVigente>(`
      SELECT e.id, e.sitio_id, e.token_hash, e.titulo, e.descripcion, e.magnitudes, e.ventana_maxima, e.zonas,
             s.nombre AS sitio, s.zona_horaria, s.publico_minimo_dispositivos AS k_sitio
        FROM enlace_publico e JOIN sitio s ON s.id = e.sitio_id
       WHERE e.token_hash = $1 AND e.revocado_en IS NULL AND e.anonimizado_en IS NULL AND e.expira_en > now() AND s.activo`, [resumen]);
    const fila = r.rows[0];
    return fila !== undefined && mismoResumen(fila.token_hash, resumen) ? fila : null;
  }

  // GET /publico. Orden: (1) el token (forma y fila): si no vale, la MISMA 404 en todos los casos; (2) la ventana; (3) el contador, si es
  // una carga de la pantalla; (4) los datos, guardados o calculados. Nunca se mira lo guardado antes de validar.
  async servir(cabecera: string | string[] | undefined, ventana: unknown, carga: boolean): Promise<VistaPublica> {
    const token = leerToken(cabecera);
    const e = token === null ? null : await this.vigente(token);
    if (e === null) throw new NotFoundException(NO_DISPONIBLE);
    const v = ventanaPedida(ventana, e.ventana_maxima);
    if (carga && !this.contador.sumar(e.id, diaEnZona(new Date(), e.zona_horaria))) this.avisar('contador de accesos lleno: una carga sin contar');
    // El k es del sitio y entra a la clave de lo guardado: cambiarlo rige en la petición siguiente, en todas las instancias.
    const k = kSitio(e.k_sitio, this.limites);
    const datos = await this.guardadas.obtener(`${e.id}|${v}|${k}`, () =>
      this.calcular({ sitioId: e.sitio_id, zonaHoraria: e.zona_horaria, magnitudes: e.magnitudes, zonas: e.zonas, k, ventana: v }));
    return armarVista({ titulo: e.titulo, descripcion: e.descripcion, sitio: e.sitio, zona_horaria: e.zona_horaria, k, ventana: v, ventana_maxima: e.ventana_maxima }, datos);
  }

  // Al revocar: libera lo guardado de ese enlace en este proceso (el corte lo hace la lectura de la fila, no esto).
  olvidar(enlaceId: string): void {
    this.guardadas.olvidar(`${enlaceId}|`);
  }

  // Los datos de una vista: con el cupo propio de lo público (la vista previa, con el suyo; la espera en la fila, con tope) y con un plazo
  // TOTAL para el cálculo (el tiempo máximo de las tendencias del tablero), no por sentencia: las tres consultas van en una transacción de
  // solo lectura y cada una recibe lo que queda (segunda revisión del 17/11/2026). Las consultas: el catálogo y la cota de lo que se lee; las
  // series (SQL_PUBLICO_SERIES, agrupada por zona); el «ahora» (SQL_PUBLICO_AHORA). Después, armarDatos aplica la regla de k. Si vence el
  // plazo, 503 (y la respuesta guardada guarda el fallo); sin cupo, 503.
  calcularPrevia(x: EntradaDatos): Promise<DatosConVentana> {
    return this.calcular(x, this.cupoPrevia);
  }
  async calcular(x: EntradaDatos, cupo: Cupo = this.cupo): Promise<DatosConVentana> {
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - HORAS_VENTANA[x.ventana] * 3_600_000);
    const intervalo = intervaloParaRango(desde, hasta, INTERVALOS, SEGUNDOS_INTERVALO);
    // El plazo se mide desde ANTES de pedir el cupo (tercera revisión del 17/11/2026): la espera en la fila cuenta.
    const limite = Date.now() + PUBLICO.tiempoMaximoMs;
    await cupo.tomar(Math.max(0, limite - Date.now()));
    let r: { catalogo: MagnitudCatalogo[]; series: FilaSeriePublica[]; ahora: FilaAhoraPublica[] } | null;
    try {
      r = await this.conPlazo(limite, async (c) => {
        const m = await c<{ cota: string; catalogo: MagnitudCatalogo[] }>(`
          SELECT iso_utc(${sqlLimiteVigencia('time_bucket($2::interval, $3::timestamptz, s.zona_horaria)', 'mx.i')}) AS cota,
                 (SELECT coalesce(json_agg(json_build_object('codigo', m.codigo, 'nombre', m.nombre, 'unidad', m.unidad_canonica)), '[]'::json)
                    FROM magnitud m WHERE m.codigo = ANY($4::text[])) AS catalogo
            FROM sitio s CROSS JOIN LATERAL (
                 SELECT coalesce(max(d.intervalo_esperado_s), 0) AS i
                   FROM dispositivo_zona h JOIN zona z ON z.id = h.zona_id JOIN dispositivo d ON d.id = h.dispositivo_id
                   JOIN canal c ON c.dispositivo_id = d.id
                  WHERE z.sitio_id = s.id AND c.magnitud_codigo = ANY($4::text[])) mx
           WHERE s.id = $1`, [x.sitioId, intervalo, desde, x.magnitudes]);
        const meta = m.rows[0];
        if (meta === undefined) return { catalogo: [], series: [], ahora: [] };
        const s = await c<FilaSeriePublica>(SQL_PUBLICO_SERIES, [x.sitioId, desde, hasta, intervalo, x.zonaHoraria, x.magnitudes, meta.cota]);
        const a = await c<FilaAhoraPublica>(SQL_PUBLICO_AHORA, [x.sitioId, x.magnitudes, intervalo, x.zonaHoraria]);
        return { catalogo: meta.catalogo, series: s.rows, ahora: a.rows };
      });
    } finally {
      cupo.soltar();
    }
    if (r === null) {
      this.avisar(`consulta de la vista pública pasó ${PUBLICO.tiempoMaximoMs} ms`);
      throw new ConsultaLenta();
    }
    // En el orden publicado; una magnitud que ya no está en el catálogo no sale.
    const porCodigo = new Map(r.catalogo.map((m) => [m.codigo, m]));
    const magnitudes = x.magnitudes.map((c) => porCodigo.get(c)).filter((m): m is MagnitudCatalogo => m !== undefined);
    const datos = armarDatos({ magnitudes, zonas: x.zonas, k: x.k, series: r.series, ahora: r.ahora });
    return { ...datos, intervalo, desde: desde.toISOString(), hasta: hasta.toISOString() };
  }

  // Un cálculo con plazo TOTAL hasta `limite` (ms de Date.now): la conexión con tope de espera, una transacción de solo lectura y, antes de
  // cada consulta, `SET LOCAL statement_timeout` con lo que queda. Además el proceso vigila cada consulta con su propio reloj (tercera
  // revisión del 17/11/2026): si la base no responde (una conexión colgada), la consulta se da por vencida, la conexión se suelta con error
  // —el grupo la destruye, no se reusa— y no se intenta el ROLLBACK, que quedaría en cola detrás de la colgada. null = venció el plazo;
  // otro error sigue siendo un error. SET LOCAL muere con la transacción: una conexión sana vuelve sin tope.
  private async conPlazo<T>(limite: number, trabajo: (consultar: <R extends object>(sql: string, p: unknown[]) => Promise<{ rows: R[] }>) => Promise<T>): Promise<T | null> {
    const restante = (): number => limite - Date.now();
    const vencido = (): Error => Object.assign(new Error('plazo del cálculo vencido'), { code: '57014' });
    // Una promesa con el reloj del proceso: si `limite` llega antes, falla con 57014 (y lo que llegue tarde se descarta sin quedar suelto).
    // `margen`: en las consultas, medio segundo más que el tope de la base, para que una consulta lenta la corte la base (57014, la conexión
    // sigue sana) y el reloj del proceso solo actúe cuando la base no responde.
    const conTope = async <V>(pendiente: Promise<V>, margen = 0): Promise<V> => {
      let reloj: NodeJS.Timeout | undefined;
      const tope = new Promise<never>((_, fallar) => { reloj = setTimeout(() => fallar(vencido()), Math.max(0, restante()) + margen); });
      pendiente.catch(() => undefined);
      try {
        return await Promise.race([pendiente, tope]);
      } finally {
        clearTimeout(reloj);
      }
    };
    const pedida = this.pool.connect();
    let cliente: PoolClient;
    try {
      cliente = await conTope(pedida);
    } catch (e) {
      void pedida.then((c) => c.release(), () => undefined); // si llega tarde, se devuelve sin usarla
      // Solo el vencimiento del plazo es una «consulta lenta» (503 y se guarda el fallo). Otro error al pedir la conexión (la base caída, el
      // grupo cerrado) no se guarda ni se pierde: queda en el registro y sigue como error (revisión final del 17/11/2026).
      if (e instanceof Error && e.message === 'plazo del cálculo vencido') return null;
      // Solo el código del error: el mensaje de `pg` puede traer el nombre y el puerto de la base.
      const codigo = (e as { code?: unknown } | null)?.code;
      this.avisar(`no se pudo pedir una conexión para la vista pública (código ${typeof codigo === 'string' ? codigo : 'desconocido'})`);
      throw e;
    }
    cliente.on('error', errorDeCliente);
    let rota: Error | undefined;
    let colgada = false;
    const pedir = async <R extends object>(sql: string, p?: unknown[]): Promise<{ rows: R[] }> => {
      try {
        return await conTope(cliente.query<R>(sql, p), 500);
      } catch (e) {
        if ((e as Error).message === 'plazo del cálculo vencido') {
          colgada = true;
          rota = e as Error;
        }
        throw e;
      }
    };
    try {
      await pedir('BEGIN READ ONLY');
      const consultar = async <R extends object>(sql: string, p: unknown[]): Promise<{ rows: R[] }> => {
        const queda = Math.floor(restante());
        if (queda <= 0) throw vencido();
        await pedir(`SET LOCAL statement_timeout = ${queda}`);
        return pedir<R>(sql, p);
      };
      const t = await trabajo(consultar);
      await pedir('COMMIT');
      return t;
    } catch (e) {
      if (!colgada) {
        try {
          // También con el reloj del proceso (medio segundo de margen): un ROLLBACK que no vuelve no retiene la petición ni el cupo.
          await conTope(cliente.query('ROLLBACK'), 500);
        } catch (f) {
          rota = f instanceof Error ? f : new Error(String(f));
        }
      }
      if ((e as { code?: string }).code !== '57014') throw e;
      return null;
    } finally {
      cliente.off('error', errorDeCliente);
      cliente.release(rota);
    }
  }

  // Vuelca el contador sumando a lo que ya hay (varias instancias suman sin pisarse). Si falla, lo tomado vuelve a la memoria y se
  // reintenta en el siguiente minuto. Nunca dos volcados a la vez.
  async volcar(): Promise<void> {
    if (this.volcando !== null) return this.volcando;
    const filas = this.contador.tomar();
    if (filas.length === 0) return;
    this.volcando = (async () => {
      try {
        await this.pool.query(`
          INSERT INTO enlace_publico_acceso (enlace_id, dia, cuenta)
          SELECT * FROM unnest($1::uuid[], $2::date[], $3::int[])
          ON CONFLICT (enlace_id, dia) DO UPDATE SET cuenta = enlace_publico_acceso.cuenta + EXCLUDED.cuenta`,
          [filas.map((f) => f.enlace_id), filas.map((f) => f.dia), filas.map((f) => f.cuenta)]);
      } catch (e) {
        this.contador.devolver(filas);
        this.avisar(`no se pudo volcar el contador de accesos públicos: ${(e as Error).message}`);
      } finally {
        this.volcando = null;
      }
    })();
    return this.volcando;
  }

  private avisar(motivo: string): void {
    const aviso = this.avisos.registrar(motivo);
    if (aviso !== null) this.log.warn(aviso);
  }
}
