import type { ResolverClave } from './adaptadores/mapa-claves.js';
import type { Receta } from './adaptadores/receta.js';

// Una "lectura" es la unidad mínima que sale del filtro 2 (analizar) y viaja por el resto del
// pipeline: qué magnitud, qué valor, en qué unidad y cuándo. Todo adaptador, venga de donde venga
// la trama, debe producir exactamente esto. Así los filtros 3–6 no saben ni les importa el formato
// original: esa es la frontera que resuelve la causa C1 (formatos dispares).
export interface Lectura {
  magnitud: string;      // código del catálogo `magnitud` (p. ej. 'temperatura')
  valor: number;
  unidad?: string;       // símbolo declarado por el emisor; si falta, se asume la canónica
  tiempo?: Date;         // marca de tiempo del emisor; si falta, se usa la hora de recepción
}

// Quién puso la marca de tiempo de una lectura (medicion.origen_tiempo, migración 08). El adaptador
// declara la suya; 'recepcion' no lo declara nadie: lo pone el pipeline cuando descarta la marca por
// ausente o no plausible (docs/13, regla 7).
export type OrigenTiempo = 'dispositivo' | 'pasarela' | 'recepcion';

export interface ContextoTrama {
  topico: string;
  idFisico: string;      // del tópico: sitio/<sitio>/dispositivo/<id_fisico>/<magnitud>
  magnitudTopico: string;
  carga: Buffer;
  // Hora de recepción de la trama: el «ahora» de un tiempo relativo de SenML (RFC 8428 §4.5.3). Si falta, el adaptador toma la hora de su
  // propia llamada, que difiere de la de recepción en milisegundos.
  recibidoEn?: Date;
  // Del tópico de pasarela (sitio/<s>/pasarela/<id>/<deveui>/<evento>, docs/10 §8.4 punto 47): el adaptador exige que el DevEUI
  // del cuerpo sea este. En el tópico de un dispositivo directo no existe.
  deveui?: string;
  // Receta de decodificación del nodo (dispositivo.decodificador, migraciones 17 y 27): su código y la receta que la recepción leyó de la
  // base en la misma consulta del nodo. Con ella, un adaptador de pasarela decodifica la `data` en base64 cuando la pasarela la entrega
  // sin decodificar (docs/10 §8.4 puntos 47 y 69 vi).
  decodificador?: string;
  receta?: Receta;
  // Los alias del catálogo (magnitud_alias), leídos en la misma consulta: solo los formatos de pasarela los usan (docs/10 §8.4 punto 69 v).
  resolver?: ResolverClave;
  // Salida del adaptador: el contador de trama LoRaWAN (fCnt), con el que el filtro 3 descarta la trama repetida (docs/10 §4.1).
  fcnt?: number;
  // Salida del adaptador: claves del JSON decodificado que no están en el mapa (la línea de registro de la trama dice cuántas y nombra las cinco primeras).
  ignoradas?: string[];
  // Salida LATERAL del adaptador LoRaWAN (docs/10 §8.4 punto 71): la señal del mejor receptor de la trama (`rxInfo`). No son lecturas del
  // adaptador: el pipeline las suma solo si el nodo declaró el canal `rssi` o `snr`, después de las del sensor.
  enlace?: Enlace;
}

// La señal del enlace de una trama LoRaWAN, en las unidades canónicas del catálogo (rssi en dBm, snr en dB). Cada una puede faltar.
export interface Enlace { rssi?: number; snr?: number }
// Las magnitudes del enlace, lista cerrada (docs/10 §8.4 punto 71): un nodo guarda las que declaró como canal.
export const MAGNITUDES_ENLACE = ['rssi', 'snr'] as const;
