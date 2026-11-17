# 16/11/2026 — HU-07 en navegador real, la vista previa del alta masiva en pantalla y el diseño de la vista pública

**Contexto.** Dentro del plan de la Etapa 4 (`docs/04 §8`), la jornada siguió el ciclo de siempre —diseño escrito antes del código,
construcción, revisión independiente, verificador en verde y un commit por bloque— y cerró seis bloques. El núcleo pasó de 28 a 29
elementos hechos; al sumar la vista pública como elemento nuevo del núcleo (HU-32) queda en 29 de 35 (80 % de sus horas).

**Plan.** La vista pública por enlace y lo que queda de las preferencias (aplicar la zona horaria propia) pasan a la iteración 1; la
comparación con los referentes se escribe por pantalla, dentro de cada diseño, y el despliegue comparativo con mediciones propias sigue en
la iteración 2 (`docs/04 §8`).

**HU-07 (historial por rango) cerrada.** Le faltaba verse en un navegador real. El recorrido de la ficha ganó el paso «a medida»: por
cada ancho (1 280 y 390 px) comprueba que un rango imposible dice su motivo y no pide nada, que la hora del sitio tecleada llega a la URL
como el instante correcto, que el histórico, las condiciones y los eventos piden la misma ventana, que lo dibujado es lo que tiene la API,
que lo de fuera queda fuera, que el formulario cabe y que al recargar se conserva. 50 de 50 comprobaciones en Firefox y en Chromium; con
dos defectos plantados, 3 de 50 en rojo, las esperadas (`docs/16 §75`).

**Contrato de trama.** Se cerró lo que había dejado la revisión del perfil de SenML: un valor que deja de ser finito al convertir
unidades va a cuarentena, `-0` se guarda como `0`, el «ahora» de los tiempos relativos es uno por trama, y `bt`, `t`, `bu`, `n` y `u`
con tipo equivocado o un `bver` distinto dentro del pack se rechazan en vez de ignorarse. La matriz quedó en 104 reglas (`docs/16 §73` y
§74). El verificador ganó dos pasos (55 en total): la matriz contra su tabla y sus cifras citadas, y ninguna cadena de 16 hexadecimales
con forma de identificador real, tampoco escrita con separadores o pegada a un prefijo.

**Alta masiva en pantalla (bloque N de `docs/19 §4`).** La pantalla quedó en tres pasos: origen (archivo CSV o JSON, o pegado desde la
planilla), revisión fila por fila —cinco tarjetas que filtran, «qué pasa» con cada fila en una frase, el detalle campo por campo con lo
que se completó por omisión— y resultado, con las credenciales una sola vez. Los números de fila son los de la planilla aunque haya
filas vacías; «las que no entran» se descarga con su motivo y, vuelta a subir sin tocar, da el mismo plan; las celdas que una planilla
leería como fórmula salen neutralizadas. El panel pasó de 365 a 404 pruebas, y el recorrido nuevo de navegador da 24 de 24 comprobaciones
en Firefox y en Chromium, a 1 280 y 390 px (`docs/16 §76`). Quedan el lector de XLSX y medir el dibujo de 500 filas.

**Vista pública por enlace (bloque O de `docs/19 §4`): diseño.** El diseño se escribió y se intentó refutar antes de construir: 15
objeciones, todas atendidas en el texto. Las que lo cambiaron: el mínimo y el máximo del histórico del sitio son la lectura real de un
equipo, así que no se publican; el promedio de un solo equipo también es su lectura, y por eso un valor se publica solo si lo aportan al
menos k dispositivos (3 por omisión, configurable), comprobado cada vez que se sirve y no solo al publicar; la dirección con el token
no puede guardarse como «vista» ni llegar al informe de errores del panel; y lo público tiene su propio cupo de consultas, para no
quitarle el tablero a quien tiene sesión. Todo enlace vence y se puede renovar o revocar. La vista entra al backlog como HU-32, dentro del
núcleo, con su requisito RF-62: no tenía ninguno de los dos.

**Respaldo que se demuestra restaurando (primera parte de TT-46).** Tras redesplegar el servidor de prueba quedó a la vista que el guion
de respaldo vivía solo allá y que restaurar se comprobaba contando las filas de una tabla. Ahora el respaldo está versionado y deja,
junto al volcado, la huella de la base —filas y suma de comprobación por tabla, tomadas en la misma instantánea—; un simulacro lo
restaura en una base desechable, sin red, y exige una huella idéntica; y el verificador lo hace en cada pasada (56 pasos). En el
servidor de prueba: 18 647 filas en 22 tablas, restauradas e idénticas, allá y en una copia llevada a otro equipo (`docs/16 §77`).
Quedan el cifrado del respaldo, la alarma por respaldo atrasado y la papelera.

**Revisiones de la jornada.** Cinco pasadas independientes sobre el código y una sobre el diseño; cada hallazgo se verificó antes de
corregir. Lo que el verificador no habría visto: en el alta masiva, las credenciales se perdían al ir al inventario sin descargarlas; la
respuesta de una revisión vieja podía caer sobre un archivo recién elegido; y un error del servidor al crear ofrecía reintentar con una
llave nueva, que habría dejado las credenciales sin recuperar. Y lo que el verificador sí vio y la construcción no: un botón hecho fuera
del componente común y una prueba de sesión que seguía buscando la pantalla anterior.

**Lecciones.** (1) Un promedio de un solo equipo es un dato crudo: una regla de agregación que protege a cada equipo se aplica al servir,
no al publicar. (2) Al propagar una cifra se busca el número solo: en el informe el porcentaje va escrito con otro espaciado, y la
búsqueda con el formato de los documentos no encontró tres lugares que el verificador sí. (3) Un recorrido de navegador que se corre
varias veces seguidas topa con los límites del propio sistema: la prueba hace lo que haría una persona —esperar lo que dice el aviso y
reintentar— y de paso prueba ese aviso. (4) Las reglas del verificador que aplican a una pantalla se leen antes de construirla, no
después. (5) Una prueba que solo comprueba que un botón existe no prueba lo que hace. (6) Un respaldo se da por bueno cuando restaurarlo
reproduce la base, no cuando el comando termina: un volcado cortado empieza igual que uno completo.
