# Seguridad de dependencias e imágenes, y decisiones de diseño — 8 de octubre de 2026

- **Sesión de trabajo individual.** Origen: la verificación automática del repositorio quedó en rojo desde el 07/10 y había
  decisiones del estudiante tomadas que aún no estaban escritas en el diseño. Cada cambio entró con su prueba y, donde
  se pudo, con la violación plantada para ver la falla.

## Por qué la verificación pasó de verde a rojo sin cambiar el código
- El lockfile era idéntico en la última corrida verde (27/09) y en la primera roja (07/10). Lo que cambió fue la base de
  avisos de GitHub: entre esas fechas se publicaron avisos contra paquetes que ya estaban (uno crítico en `proxy-addr` y
  altos en `brace-expansion` y `braces`). Una verificación de seguridad puede ponerse roja sola.

## Corregido y probado (cifras en `docs/16 §12`; controles en `docs/11 §4`)
1. **Dependencias:** ocho versiones forzadas resolvieron 14 de 16 avisos; las 78 pruebas siguen en verde y las licencias
   no cambiaron. Los dos sin versión corregida publicada solo vienen con la herramienta de pruebas: el alto queda como
   excepción **visible** (advertencia en cada corrida, sin dejarla en rojo) y el guardián falla el día que salga el parche.
2. **Imágenes de contenedor**, escaneadas con una herramienta de código abierto en un contenedor desechable: backend sobre
   Debian 13 y sin npm en la imagen final (de 6 vulnerabilidades críticas a 0), broker reconstruido por su autor (0
   altas), proxy con parches del sistema (0) y base de datos de TimescaleDB 2.24.0 a 2.30.2 con parches (de 7 críticas a
   1). Queda un binario precompilado de la imagen de la base (`gosu`), documentado con su porqué.
3. **Actualización de la base sin perder nada:** respaldo físico del volumen, extensión actualizada y el conteo de cada
   tabla idéntico antes y después. Antes, la pila completa se probó desde cero en el banco: migraciones, pruebas de
   carrera, TLS de punta a punta y una carga de 60 s sin pérdida.
4. **Licencias:** el guardián revisa ahora las licencias de las dependencias de producción (RNF-15): todas permisivas.
   El código propio se publicará bajo AGPL-3.0-only; la titularidad se confirma con la universidad.

## Decisiones escritas en el diseño (`docs/10 §8.4`, puntos 24 a 38)
- LoRaWAN es obligatorio y entra por la pasarela con servidor de red embebido (ruta B); la ruta A sigue opcional.
- La vía de envío, el formato y la pasarela se declaran al dar de alta un dispositivo; la credencial depende de la vía.
- Las credenciales del broker las administrará el backend (plugin de seguridad dinámica de Mosquitto), tras una prueba.
- Lo que escribe el sistema (la última trama) se separa de lo que edita una persona, para que el bloqueo optimista del
  panel no dé conflictos falsos.
- Picos y ataques: nunca una pérdida silenciosa (límites en el proxy, topes de cola y alarma en el broker, tope por
  dispositivo); observabilidad, rendimiento medido antes de optimizar y respaldos (RPO de 24 h, RTO de una hora).
- Roles por sitio con un guardia central de permisos, según lo que hacen los tres referentes abiertos en su código.
- Exportación en CSV, XLSX y JSON, lo que el académico entrevistado calificó de no negociable.
- Imágenes fijadas por su huella (digest), con las actualizaciones propuestas para revisión y una semana de espera.
- De paso se corrigió un diagrama que seguía mostrando WebSocket donde se había decidido SSE.

## Pendiente
- Migración con la vía declarada, la pasarela y el estado del dispositivo; prueba del plugin de credenciales; alta por API.
- Exportación de datos y correo por silencio, lo que el académico entrevistado pidió con más fuerza.
- Laboratorio del nodo de prueba propio (ESP32) y la validación en terreno.
