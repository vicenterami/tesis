// Decisiones de arranque que merecen prueba unitaria (docs/10 §6).

// Interfaz en la que escucha la API. Por defecto SOLO este equipo; en contenedor se fija 0.0.0.0.
// Se usa `||` y no `??` a propósito: una variable presente pero vacía (`HTTP_INTERFAZ=` en un .env)
// haría que Node escuchara en TODAS las interfaces en silencio. Vacío también significa «por defecto».
export function interfazDeEscucha(valor: string | undefined): string {
  return valor?.trim() || '127.0.0.1';
}
