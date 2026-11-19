# 19/11/2026 — Exportar el sitio entero (HU-08), el alta masiva sin fricción y su lector XLSX

**Contexto.** Quedaban cinco elementos del núcleo y quince días para la Entrega 4. El orden acordado fue: la exportación (HU-08), el alta
masiva sin fricción, el catálogo editable (TT-12) y, desde el 28/11, solo el informe. La jornada siguió un bloque a la vez: diseño escrito
antes del código, construcción, una revisión independiente, el verificador una vez y un commit por bloque.

**Exportar el sitio entero (HU-08).** Hasta hoy se exportaban las mediciones de un dispositivo. Ahora un sitio sale entero en un solo
archivo —mediciones, tramas aceptadas con su carga exacta en base64 y su huella SHA-256, y eventos del ciclo de vida, sin datos de
personas— en CSV (dentro de un zip), XLSX y JSON, según el rol y solo del sitio pedido, con una estimación del tamaño antes de descargar
y su pantalla (`docs/19 §4`, bloque R). El zip y el XLSX se escriben en flujo con código propio, como se decidió para leerlos el 15/11;
los límites de Excel salen de la página oficial (filas por hoja y caracteres por celda), y por eso una trama de 64 KiB se reparte en hasta
tres columnas. El criterio «reimportable sin pérdida» se demostró sin construir una importación: una prueba de ida y vuelta en los tres
formatos, con lectores escritos aparte, da 0 diferencias contra la base, y el libro abre sin aviso de reparación en LibreOffice y en Excel
(`docs/16 §89`). Al diseñar apareció un defecto anterior: la protección contra fórmulas del CSV anteponía un apóstrofo sin poder
deshacerse; ahora es reversible. Exportar un millón de mediciones (con 100 000 tramas y 10 000 eventos) toma de 3,6 a 7,4 s según el formato, con un
pico de memoria de 290 MB frente a los 537 MB del contenedor. Núcleo:
31 de 35 (89 %).

**El alta masiva sin fricción.** Antes de rediseñar se recorrió en navegador real, en dos navegadores y dos anchos, con 500 filas y un
archivo de 60 casos con errores (`docs/16 §90`). La velocidad sobraba; la fricción no: una fila mal formada rechazaba el archivo entero,
«°C» no se aceptaba, los motivos usaban nombres de columnas, un aviso salía en las 500 filas y, en el teléfono, una ayuda flotante tapaba
los botones. Se corrigieron once puntos (`docs/19 §4`, bloque S): la fila mala queda como «No entra» con su motivo, las unidades se leen
con su escritura común, cada motivo trae su remedio, «atrás» no pierde las credenciales y el archivo de credenciales dice a dónde envía
cada equipo. La revisión independiente encontró que, si la sesión vencía, la siguiente persona que entrara en la misma pestaña veía el
archivo leído; ahora el borrador se guarda con quién lo leyó.

**El alta masiva lee XLSX.** Lo decidido el 15/11 quedó construido: un lector propio que corre en el navegador, se descarga solo al
elegir un libro (5 kB comprimido) y lleva la primera hoja visible a la misma revisión que un CSV. Como abre archivos de terceros, cuenta los
bytes mientras descomprime, limita partes y cadenas, rechaza las declaraciones del XML y se detiene en la fila 501; un identificador que la
planilla guardó como número no entra («escríbelo como texto»), porque pudo perder sus ceros. Antes de construirlo se comprobó en la fuente
qué navegadores traen la descompresión que usa (`docs/16 §91`). La revisión independiente encontró que una etiqueta de nombre larguísimo
hacía retroceder sin fin al patrón que leía los atributos; quedó acotada y medida.

**El verificador.** Dos de sus detectores tenían un error propio: uno filtraba las pruebas por un texto que su salida no traía y tomó
una prueba por una variable de entorno; otro tomaba un número de sección de una norma (§4.3.9.4) por una dirección de red. Los dos se
corrigieron y se probaron plantando la violación.

**Lecciones.** (1) Antes de rediseñar una pantalla que «no se siente bien», recorrerla en navegador real y medirla: dio quince brechas con
evidencia y mostró que la velocidad no era el problema. (2) Un revisor también se equivoca: uno afirmó que un índice no existía, y lo
crea una migración con un nombre armado; se verifica antes de corregir. (3) Una guardia que filtra la salida de otra herramienta se
prueba con un caso plantado: si el filtro no ve lo que cree ver, no excluye nada. (4) Un lector de archivos de terceros se revisa preguntando
por los patrones que retroceden: así apareció uno que, con una hoja de 1 kB comprimida, dejaba la pestaña colgada más de un minuto; se
corrigió con un tope por etiqueta y una lectura de un solo paso, y la misma búsqueda encontró dos patrones más.
