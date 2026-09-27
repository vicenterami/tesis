// Decisiones de arranque que merecen prueba unitaria (docs/10 §6, docs/11 §3).

// Interfaz en la que escucha la API. Por defecto SOLO este equipo; en contenedor se fija 0.0.0.0.
// Se usa `||` y no `??` a propósito: una variable presente pero vacía (`HTTP_INTERFAZ=` en un .env)
// haría que Node escuchara en TODAS las interfaces en silencio. Vacío también significa «por defecto».
export function interfazDeEscucha(valor: string | undefined): string {
  return valor?.trim() || '127.0.0.1';
}

// ¿Se sirve la documentación interactiva /docs (Swagger UI)? Solo si HTTP_DOCS vale exactamente `si`
// (sin distinguir mayúsculas ni espacios). Ausente, vacía o cualquier otro valor = apagada: un servidor
// que olvide la variable queda cerrado, no abierto (seguro por omisión). En Internet, Swagger UI
// enumera las rutas y exige scripts en línea que la CSP del backend prohíbe; el contrato que se cita
// es el openapi.json versionado.
export function servirDocumentacion(valor: string | undefined): boolean {
  return (valor ?? '').trim().toLowerCase() === 'si';
}

// Formato de los registros (docs/10 §6): `json` = un evento por línea, sin color (contenedor, se filtra
// con jq); cualquier otro valor = texto con color para la terminal de desarrollo.
export function registrosEnJson(valor: string | undefined): boolean {
  return (valor ?? '').trim().toLowerCase() === 'json';
}
