import { OrigenTiempo } from './lectura';

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
