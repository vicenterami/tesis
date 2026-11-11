// El proceso corre SIEMPRE en UTC, sin depender de la zona del sistema que lo aloje (portátil en
// Chile, servidor en UTC, contenedor sin zona). Ninguna operación con Date debe verse afectada por
// dónde corre el backend (docs/13). Es un módulo aparte porque en ES modules las importaciones se
// evalúan antes que el cuerpo del archivo que las declara: cada punto de entrada lo importa primero.
process.env.TZ = 'UTC';
