import { OrigenTiempo } from './lectura.js';

// Marca de tiempo del emisor: se acepta solo si es plausible (docs/13, reglas 7 y 18).
//  · sin marca                      → hora de recepción (nodo sin reloj)
//  · anterior al año 2000           → hora de recepción (reloj sin inicializar: epoch 0 = 1970)
//  · hasta 2 min en el futuro       → se RESPETA la marca: deriva normal de un reloj barato; conservarla
//                                     mantiene el espaciado real entre lecturas del mismo nodo
//  · más de 2 min en el futuro      → hora de recepción (reloj adelantado horas o días: nunca es válido)
//  · antigua pero posterior a 2000  → se RESPETA si la puso el dispositivo: un nodo que guardó lecturas sin
//                                     cobertura y las envía después reporta tiempos legítimamente viejos
//  · de PASARELA, más de 10 min atrasada o más de 2 min adelantada → hora de recepción y condición reloj_desviado (regla 18,
//                                     decidido el 21/10/2026; revisado el 22/10: toda marca de pasarela que se reemplaza avisa):
//                                     la pasarela publica en línea; si su marca se aleja tanto, falla su reloj
//                                     (UG65 sin NTP, 4 días atrasada el 20/10/2026, docs/16 §45)
//  · SenML, tiempo RELATIVO (bt + t menor que 2^28, RFC 8428 §4.5.3; regla 19 de docs/13): negativo → «ahora» menos esos segundos
//                                     (y desde ahí rige lo de arriba: un pasado anterior a 2000 es la hora de recepción); cero o positivo
//                                     → hora de recepción (un positivo es futuro relativo, que la RFC usa para actuar, no para medir)
const ANIO_2000 = Date.UTC(2000, 0, 1);
const DERIVA_MAX_MS = 2 * 60 * 1000;
export const DESVIO_PASARELA_MAX_MS = 10 * 60 * 1000;

export function tiempoPlausible(emisor: Date | undefined, recibidoEn: Date, origen: OrigenTiempo = 'dispositivo'): Date {
  if (!emisor) return recibidoEn;
  const t = emisor.getTime();
  if (Number.isNaN(t) || t < ANIO_2000) return recibidoEn;
  if (t > recibidoEn.getTime() + DERIVA_MAX_MS) return recibidoEn;
  if (desvioDePasarela(emisor, recibidoEn, origen) !== undefined) return recibidoEn;
  return emisor;
}

// Desvío (marca − llegada, en ms, con signo: negativo = atrasada) de una marca de pasarela que supera la tolerancia de la regla 18
// (10 min hacia el pasado; hacia el futuro, los mismos 2 min de la regla 7: una pasarela publica en línea y no tiene por qué adelantarse);
// undefined si la marca no es de pasarela, falta, es inválida o anterior a 2000 (esos casos los resuelve la regla 7, sin condición)
// o está dentro de la tolerancia. Con él el pipeline abre la condición reloj_desviado (docs/10 §8.4 punto 54).
export function desvioDePasarela(emisor: Date | undefined, recibidoEn: Date, origen: OrigenTiempo): number | undefined {
  if (origen !== 'pasarela' || !emisor) return undefined;
  const t = emisor.getTime();
  if (Number.isNaN(t) || t < ANIO_2000) return undefined;
  const desvio = t - recibidoEn.getTime();
  return desvio < -DESVIO_PASARELA_MAX_MS || desvio > DERIVA_MAX_MS ? desvio : undefined;
}

// Tiempo de un registro SenML (RFC 8428 §4.5.3: «Values less than 268,435,456 (2**28) represent time relative to the current time»).
// `segundos` es bt + t ya sumados; `ahora` es la hora de recepción. Devuelve la marca del emisor o undefined (rige la hora de recepción).
// Desde 2^28 es absoluto (segundos Unix); negativo es «ahora» menos esos segundos; cero y positivo (futuro relativo) no son una medición
// pasada y rigen con la hora de recepción. Lo que devuelve pasa después por `tiempoPlausible` como cualquier otra marca (regla 7).
export const SENML_ABSOLUTO_DESDE_S = 2 ** 28;
export function tiempoSenml(segundos: number, ahora: Date): Date | undefined {
  if (segundos >= SENML_ABSOLUTO_DESDE_S) return new Date(segundos * 1000);
  if (segundos < 0) return new Date(ahora.getTime() + segundos * 1000);
  return undefined;
}
