// Instante en ISO 8601 UTC con MICROSEGUNDOS, armado por la base: un timestamptz guarda microsegundos y un Date de JavaScript solo
// milisegundos. Lo que vuelve a la base para compararse por igualdad (el bloqueo optimista de PATCH /canales/{id}, la paginación de la
// exportación) debe viajar como este texto, nunca pasar por un Date. Solo con nombres de columna fijos del código, nunca con datos.
export const isoUs = (columna: string): string => `to_char(${columna} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
