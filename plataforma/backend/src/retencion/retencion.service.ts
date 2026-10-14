import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { POOL } from '../db/db.module';

// Retención de datos (docs/10 §8.4 punto 11). La edición Apache de TimescaleDB no trae add_retention_policy,
// pero sí drop_chunks: borra fragmentos enteros (archivos), sin filas muertas ni vacuum. Esta tarea lo llama
// para cada hypertable con su plazo. Corre un minuto después de arrancar (un servidor que se reinicia a menudo
// nunca llegaría a las 24 h) y después cada RETENCION_INTERVALO_H. Reejecutarla es inocuo: lo ya borrado no se
// vuelve a borrar. El minuto de espera no es adorno: `pnpm openapi` y las pruebas levantan la aplicación y la
// cierran al instante, y un comando de documentación no debe poder borrar datos (visto el 07/10/2026).
//
// Precisión: se borra un fragmento solo cuando TODO él es más viejo que el plazo; con fragmentos de 7 días
// (medicion) o de 1 día (trama, cuarentena), un dato puede durar hasta un fragmento más que el plazo.
//
// Las mediciones NO vencen por defecto (decisión del 07/10/2026, docs/10 §8.4 punto 19): diez años ocupan ≈ 4,6 GB
// (docs/14) y el historial largo es el dato valioso del caso de uso. Solo se recortan si se define la variable.
// porDefecto null = sin límite: la tabla no se toca.
export interface Limite<D extends number | null = number> { variable: string; porDefecto: D; minimo: number }
export interface Plazo extends Limite<number | null> { tabla: 'medicion' | 'trama' | 'cuarentena' | 'metrica_broker' }

const ESPERA_INICIAL_MS = 60_000;

export const PLAZOS: Plazo[] = [
  // Si se define, el mínimo protege de un error de tipeo («7» por «730») que borraría años de series.
  { tabla: 'medicion', variable: 'RETENCION_MEDICION_DIAS', porDefecto: null, minimo: 30 },
  { tabla: 'trama', variable: 'RETENCION_TRAMA_DIAS', porDefecto: 30, minimo: 1 },
  { tabla: 'cuarentena', variable: 'RETENCION_CUARENTENA_DIAS', porDefecto: 30, minimo: 1 },
  // Muestras por minuto de los contadores $SYS del broker (docs/10 §8.4 punto 43, migración 13): 90 días.
  { tabla: 'metrica_broker', variable: 'RETENCION_METRICA_BROKER_DIAS', porDefecto: 90, minimo: 1 },
];

// Ausente → valor por defecto. Presente pero vacía o no entera → error al arrancar, nunca un 0 silencioso:
// Number('') es 0, y un plazo de 0 días borraría la tabla completa (lección del 23/09 con HTTP_INTERFAZ vacía).
export function leerEntero<D extends number | null>(valor: string | undefined, p: Limite<D>): number | D {
  if (valor === undefined) return p.porDefecto;
  const n = Number(valor);
  if (valor.trim() === '' || !Number.isInteger(n) || n < p.minimo) {
    throw new Error(`${p.variable}="${valor}" no es válido: se espera un entero >= ${p.minimo} (por defecto ${p.porDefecto ?? 'sin límite'})`);
  }
  return n;
}

@Injectable()
export class RetencionService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('retencion');
  private readonly plazos: { p: Plazo; dias: number | null }[];
  private readonly cadaHoras: number;
  private primera?: NodeJS.Timeout;
  private temporizador?: NodeJS.Timeout;

  constructor(@Inject(POOL) private readonly pool: Pool, config: ConfigService) {
    // Se valida en el constructor: un valor malo detiene el arranque antes de tocar la base.
    this.plazos = PLAZOS.map((p) => ({ p, dias: leerEntero(config.get<string>(p.variable), p) }));
    this.cadaHoras = leerEntero(config.get<string>('RETENCION_INTERVALO_H'),
      { variable: 'RETENCION_INTERVALO_H', porDefecto: 24, minimo: 1 });
  }

  onModuleInit(): void {
    const plazos = this.plazos.map(({ p, dias }) => `${p.tabla}=${dias === null ? 'sin_limite' : `${dias}d`}`).join(' ');
    this.log.log(`retención ${plazos} cada ${this.cadaHoras} h`);
    this.primera = setTimeout(() => void this.corridaSegura(), ESPERA_INICIAL_MS);
    this.temporizador = setInterval(() => void this.corridaSegura(), this.cadaHoras * 3600 * 1000);
  }

  onModuleDestroy(): void {
    if (this.primera) clearTimeout(this.primera);
    if (this.temporizador) clearInterval(this.temporizador);
  }

  // Igual que el barrido del supervisor: el temporizador no tiene quien atrape un rechazo. Cada tabla va por
  // separado, así que un candado en una no deja sin limpiar a las otras. Cada corrida deja dos rastros:
  //  · una línea de resumen con forma fija en el log (para el equipo; vence con la rotación);
  //  · una fila en `evento` (tipo 'retencion', sin dispositivo): borrar datos es una operación destructiva y
  //    su registro no puede vencer antes que los datos que explica («¿quién borró las mediciones de 2024?»).
  async corridaSegura(): Promise<void> {
    const inicio = Date.now();
    const partes: string[] = [];
    const borrados: Record<string, number | 'error' | 'sin_limite'> = {};
    let fallos = 0;
    for (const { p, dias } of this.plazos) {
      if (dias === null) {
        borrados[p.tabla] = 'sin_limite';
        partes.push(`${p.tabla}=sin_limite`);
        continue;
      }
      try {
        borrados[p.tabla] = await this.recortar(p.tabla, dias);
        partes.push(`${p.tabla}=${borrados[p.tabla]}`);
      } catch (e) {
        fallos++;
        borrados[p.tabla] = 'error';
        partes.push(`${p.tabla}=error`);
        this.log.error(`retención de ${p.tabla} falló, se reintenta en la próxima corrida: ${(e as Error).message}`);
      }
    }
    const duracion = Date.now() - inicio;
    const linea = `resumen fragmentos_borrados ${partes.join(' ')} fallos=${fallos} duration_ms=${duracion}`;
    if (fallos) this.log.warn(linea); else this.log.log(linea);
    const plazosDias = Object.fromEntries(this.plazos.map(({ p, dias }) => [p.tabla, dias]));
    try {
      await this.pool.query("INSERT INTO evento (dispositivo_id, tipo, detalle) VALUES (NULL, 'retencion', $1)",
        [{ plazos_dias: plazosDias, fragmentos_borrados: borrados, fallos, duration_ms: duracion }]);
    } catch (e) {
      this.log.error(`no se pudo registrar la corrida de retención en evento: ${(e as Error).message}`);
    }
  }

  // Devuelve cuántos fragmentos borró. lock_timeout: si una consulta larga tiene tomado un fragmento viejo,
  // es mejor rendirse a los 5 s y reintentar en la próxima corrida que encolar detrás todas las lecturas.
  async recortar(tabla: Plazo['tabla'], dias: number): Promise<number> {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query("SET LOCAL lock_timeout = '5s'");
      const r = await cliente.query<{ n: string }>(
        // drop_chunks exige ser dueño de la hypertable; la aplicación no lo es (migración 14): lo hace la función acotada del dueño.
        'SELECT fn_retencion_drop_chunks($1, $2) AS n',
        [tabla, dias],
      );
      await cliente.query('COMMIT');
      return Number(r.rows[0].n);
    } catch (e) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      cliente.release();
    }
  }
}
