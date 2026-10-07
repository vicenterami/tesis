import { ContextoTrama, Lectura, OrigenTiempo } from '../lectura';

// Contrato de un adaptador de formato (filtro 2). La plataforma tiene un contrato nativo (SenML)
// y admite otros formatos mediante adaptadores: cada uno sabe reconocer su formato y traducirlo
// a lecturas. Agregar un formato nuevo = agregar una clase que cumpla este contrato (RF-04).
export interface Adaptador {
  readonly nombre: string;
  // Quién pone la marca de tiempo en este formato: el nodo, o la pasarela que lo recibió (LoRaWAN).
  // Se guarda en medicion.origen_tiempo cuando la marca es plausible (docs/10 §8.4 punto 12).
  readonly origenTiempo: Exclude<OrigenTiempo, 'recepcion'>;
  // ¿Esta trama es de mi formato? Debe ser barato y no lanzar excepciones.
  reconoce(ctx: ContextoTrama): boolean;
  // Traduce la trama a lecturas. Lanza Error si el contenido es inválido para el formato.
  analizar(ctx: ContextoTrama): Lectura[];
}

// Error propio del filtro 2: distingue "formato irreconocible/malformado" de fallos internos.
export class TramaMalformada extends Error {}
