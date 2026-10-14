// Métricas del broker por sus tópicos $SYS y la regla de la alarma (docs/10 §8.4 punto 43; evidencia SYS-01…05 del manual de
// Mosquitto). Sin red ni base: lo prueba `metricas.spec.ts`; el servicio (`metricas.service.ts`) solo persiste y avisa.

// Los cinco contadores que el manual documenta. `heap/current` puede no existir (broker compilado sin seguimiento de memoria).
export const TOPICOS_SYS = {
  mensajes_descartados: '$SYS/broker/publish/messages/dropped',
  mensajes_en_cola: '$SYS/broker/store/messages/count',
  bytes_en_cola: '$SYS/broker/store/messages/bytes',
  clientes_conectados: '$SYS/broker/clients/connected',
  memoria_bytes: '$SYS/broker/heap/current',
} as const;
export type Contador = keyof typeof TOPICOS_SYS;
export const OBLIGATORIOS: Contador[] = ['mensajes_descartados', 'mensajes_en_cola', 'bytes_en_cola', 'clientes_conectados'];

// Tope de la cola por cliente que fija mosquitto.conf (`max_queued_messages 10000`): el guardián 2l comprueba que los dos
// números coincidan. Por encima del 80 % se avisa antes de perder.
export const COLA_TOPE_POR_DEFECTO = 10000;
export const FRACCION_AVISO = 0.8;

export interface Muestra {
  tiempo: Date;
  mensajes_descartados: number;
  mensajes_en_cola: number;
  bytes_en_cola: number;
  clientes_conectados: number;
  memoria_bytes: number | null;
}

// Lo que publica el broker es texto con un entero; cualquier otra cosa se ignora (no se guarda basura).
export function valorSys(carga: string): number | null {
  const t = carga.trim();
  if (!/^\d{1,18}$/.test(t)) return null;
  return Number(t);
}

export function armarMuestra(ultimas: ReadonlyMap<Contador, number>, ahora: Date): Muestra | null {
  for (const k of OBLIGATORIOS) if (!ultimas.has(k)) return null;
  return {
    tiempo: ahora,
    mensajes_descartados: ultimas.get('mensajes_descartados') ?? 0,
    mensajes_en_cola: ultimas.get('mensajes_en_cola') ?? 0,
    bytes_en_cola: ultimas.get('bytes_en_cola') ?? 0,
    clientes_conectados: ultimas.get('clientes_conectados') ?? 0,
    memoria_bytes: ultimas.get('memoria_bytes') ?? null,
  };
}

export type Motivo = 'descartes' | 'cola_alta';
export interface Evaluacion {
  anormal: boolean;
  motivos: Motivo[];
  descartes_delta: number; // 0 si el contador se reinició (el broker arrancó de nuevo): un reinicio no es un descarte
  umbral_cola: number;
}

// La regla: se avisa si el contador de descartes creció desde la muestra anterior, o si la cola pasa el 80 % del tope.
// Un contador menor que el anterior es un reinicio del broker, no un descarte negativo. Sin muestra anterior solo cuenta la cola.
export function evaluar(anterior: Muestra | null, actual: Muestra, tope = COLA_TOPE_POR_DEFECTO): Evaluacion {
  const motivos: Motivo[] = [];
  const delta = anterior !== null && actual.mensajes_descartados >= anterior.mensajes_descartados ? actual.mensajes_descartados - anterior.mensajes_descartados : 0;
  if (delta > 0) motivos.push('descartes');
  const umbral = Math.floor(tope * FRACCION_AVISO);
  if (actual.mensajes_en_cola >= umbral) motivos.push('cola_alta');
  return { anormal: motivos.length > 0, motivos, descartes_delta: delta, umbral_cola: umbral };
}
