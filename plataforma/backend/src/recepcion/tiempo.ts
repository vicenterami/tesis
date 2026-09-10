// Marca de tiempo del emisor: se acepta solo si es plausible (docs/13, regla 7).
//  · sin marca                      → hora de recepción (nodo sin reloj)
//  · anterior al año 2000           → hora de recepción (reloj sin inicializar: epoch 0 = 1970)
//  · hasta 2 min en el futuro       → se RESPETA la marca: deriva normal de un reloj barato; conservarla
//                                     mantiene el espaciado real entre lecturas del mismo nodo
//  · más de 2 min en el futuro      → hora de recepción (reloj adelantado horas o días: nunca es válido)
//  · antigua pero posterior a 2000  → se RESPETA: un nodo que guardó lecturas sin cobertura y las
//                                     envía después reporta tiempos legítimamente viejos
const ANIO_2000 = Date.UTC(2000, 0, 1);
const DERIVA_MAX_MS = 2 * 60 * 1000;

export function tiempoPlausible(emisor: Date | undefined, recibidoEn: Date): Date {
  if (!emisor) return recibidoEn;
  const t = emisor.getTime();
  if (Number.isNaN(t) || t < ANIO_2000) return recibidoEn;
  if (t > recibidoEn.getTime() + DERIVA_MAX_MS) return recibidoEn;
  return emisor;
}
