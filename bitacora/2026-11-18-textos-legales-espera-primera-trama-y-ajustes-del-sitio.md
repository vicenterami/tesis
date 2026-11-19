# 18/11/2026 — Auditoría local, textos legales con versión atada, «Esperando primera trama» y «Ajustes del sitio»

**Contexto.** Dentro del plan de la Etapa 4 (`docs/04 §8`), la jornada empezó por una corrida del CI en rojo y siguió con lo que
habían dejado las capturas del servidor de prueba del día anterior. Ciclo de siempre: diseño escrito antes del código, construcción,
revisión independiente, verificador en verde y un commit por bloque. Dos decisiones del día cambiaron el diseño: toda corrección de un
texto legal sube su versión, y un equipo que nunca envió una trama deja de verse «Normal».

**El CI en rojo sin cambio de código.** Las dos corridas de la vista pública fallaron en la auditoría de dependencias por un aviso alto
de una biblioteca que solo usan las herramientas de desarrollo; el archivo de versiones no había cambiado y el aviso se retiró al día
siguiente. El verificador local decía «todo en concordancia» porque no corría esa auditoría: ahora la corre igual que el CI y mira la
última corrida publicada (`docs/16 §81`). En el servidor de prueba quedó anotado el despliegue de la vista pública (`docs/16 §80`).

**Privacidad para personas y textos con versión atada.** La página de privacidad mostraba jerga interna (secciones de documentos,
nombres de funciones y variables). Ahora `docs/21` tiene dos tablas: la de trazabilidad y la que lee la persona, y una prueba falla si
reaparece la jerga; la fila de los respaldos dice lo que hay y con su condición. El panel tiene icono propio (`docs/16 §82`). Además,
la versión de los textos legales dejó de depender de acordarse: una huella del texto servido, un historial en `docs/21 §7` y dos
guardias (una prueba y un paso del verificador) fallan si el texto cambia sin versión y fecha nuevas, o si se reescribe una versión ya
publicada (`docs/16 §84`). La privacidad pasó a la versión 3.

**Esperando primera trama.** Un equipo dado de alta que nunca reportó se veía «Normal» y nunca alarmaba. Ahora tiene estado propio y,
vencido un plazo de su sitio (7 días por omisión, configurable), pasa a «Sin señal» y abre su alarma. La migración 26 agrega cuándo
entró en servicio cada equipo y el plazo de cada sitio; el silencio y la entrega se cuentan desde la entrada en servicio, así volver de
mantenimiento no alarma en falso (`docs/16 §85`). Tres rondas de revisión independiente encontraron, en orden: que pasar a mantenimiento
no cerraba las alarmas y que la condición y su evento no se escribían juntos; y después un bucle: la red de seguridad cerraba cada minuto
alarmas que la trama siguiente volvía a abrir. Se resolvió con la regla de fondo (en mantenimiento no se abre ninguna alarma, como dice
RF-22), comprobada en cada lugar que abre una, con aviso en vivo de los cierres.

**Ajustes del sitio.** El plazo nuevo, el mínimo de dispositivos y el tope de enlaces de la vista pública quedaron en una pantalla
propia; «Publicar» conserva una línea de lectura. Acortar el plazo dice antes cuántos equipos pasarían a «Sin señal» y pide confirmar;
la revisión encontró que se podía guardar un valor distinto del confirmado, ya corregido (`docs/16 §86`). El recorrido en navegador real
encontró algo que las pruebas sin navegador no ven: a 390 px una ayuda flotante tapaba el enlace nuevo; una sonda del elemento bajo el
clic lo mostró antes de corregir.

**Despliegue con un comando.** Quedó diseñado y sometido a dos revisiones; se decide antes de construirlo.

**Lecciones.** (1) Un aviso de seguridad publicado después del último cambio pone el CI en rojo sin tocar el código: el verificador
local debe mirar lo mismo que el CI y el estado de lo publicado. (2) Una regla que depende de acordarse se convierte en guardia. (3)
Antes de agregar algo que limpia (cerrar alarmas), se buscan todos los lugares que escriben lo mismo: si uno no respeta la regla, la
limpieza y la escritura se alternan para siempre. (4) Ante una prueba de navegador que se corta, se mide qué hay bajo el clic antes de
cambiar la prueba.
