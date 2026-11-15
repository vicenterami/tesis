# 15/11/2026 — NestJS 12, alta masiva «todo o nada», contrato de trama como perfil de SenML y dos historias del núcleo

**Contexto.** Dentro del plan de la Etapa 4 (`docs/04 §8`), la jornada siguió el ciclo de siempre —diseño escrito antes del código,
construcción, revisión independiente, verificador en verde y un commit por bloque— y cerró diez bloques. El núcleo pasó de 26 a 28 de
34 elementos (83 % de sus horas). El servidor de prueba sigue en el commit del 13/11; falta redesplegar.

**Dependencias.** NestJS pasó de la 11 a la 12, todos sus paquetes a la vez y con versiones de al menos siete días (`docs/16 §70`). La
guía oficial casi no aplicaba (el backend ya era ESM, con TypeScript 6 y Vitest); lo que no estaba en la guía fue un tipo que dejó de
admitir la opción con que se corta un cuerpo demasiado grande: se conservó, y una prueba la vigila con un servidor real. jsdom subió a
la 31: sus pruebas no arrancaban porque un paquete nuevo declaraba compatible una versión de `parse5` que no le sirve; se unificó la
versión y una prueba que comparaba un ancho como texto pasó a compararlo como número.

**Alta masiva (bloque N de `docs/19 §4`).** El diseño se escribió y se intentó refutar antes de construir: 16 objeciones, todas
atendidas en el texto. La ruta devuelve ahora el **plan por fila** —qué se creará, qué se completó por omisión, avisos y motivos por
campo— con una huella; crear es **una sola petición, todo o nada**: si el plan cambió desde la revisión, no se crea ninguna fila y la
pantalla dice cuáles cambiaron. El número de fila lo manda el cliente (antes, una fila vacía en el archivo corría todos los números),
los límites y la plantilla los publica la API y el tope del cuerpo se midió en vez de estimarse. Si la respuesta con las credenciales
se pierde, repetir la petición con la misma llave devuelve la misma respuesta (`docs/16 §71`).

**Que la persona sepa qué falló.** Al volver estricto el contrato quedó una regla para todo bloque: lo que el servidor rechaza se
acompaña de una tabla en el diseño —qué pasó, por qué, qué texto se ve y qué se puede hacer desde ahí—, de la detección antes de enviar
cuando se puede y de una prueba por caso. El alta masiva tiene 22 casos (`docs/19 §4`, N8b), y una prueba falla si alguno queda sin
mensaje o sin acción.

**Contrato de trama (TT-27).** Una matriz de 98 reglas, cada una con su fuente (RFC 8428, un documento o el código), su resultado
esperado y la prueba que la cubre, con una comprobación que falla si un motivo de cuarentena o un adaptador queda sin caso
(`docs/16 §73`). La matriz encontró dos defectos: una trama con el nombre numérico rompía el adaptador en vez de ir a cuarentena y el
mensaje quedaba sin confirmar, y el nombre y la unidad llegaban sin limpiar al registro. Y mostró que el contrato no era SenML completo
ni lo que decían los documentos: se declaró como **perfil de SenML**, con la identidad tomada del tópico y la credencial y no de la
trama, y lo que se aceptaba mal se corrigió en el sentido estricto (`docs/16 §74`).

**Historias del núcleo.** HU-16 (salud del sitio) se cerró: el porcentaje pasó a una función probada en sus bordes y los conteos se
comprueban contra la base. HU-07 (historial por rango) quedó a una prueba: la ficha ya permite elegir fechas con el mismo formulario del
tablero, y falta verla en un navegador real (`docs/16 §72`).

**Revisiones de la jornada.** Seis pasadas independientes sobre el código y una sobre el diseño; cada hallazgo se verificó antes de
corregir. Lo que el verificador no habría visto: el tope grande del cuerpo regía para cualquier método y sin sesión; las respuestas
guardadas para el reintento se acotaban por cantidad y no por tamaño; si la base confirmaba con error, se podían borrar del broker
dispositivos que sí habían quedado; y un «peor caso medido» que no era el peor, porque la guarda contaba caracteres y no bytes.

**Lecciones.** (1) Una prueba que lleva una copia de la configuración que dice vigilar sigue en verde cuando la configuración cambia:
las dos deben salir del mismo lugar. (2) Una matriz regla por regla contra la especificación encuentra defectos que cientos de pruebas
sueltas no ven, porque obliga a preguntar por cada regla y no por cada función. (3) Corregir código de seguridad merece una segunda
mirada: la revisión de las correcciones encontró cuatro problemas en el camino que acababa de arreglarse. (4) Un identificador de
ejemplo con forma de dato real se reemplaza por uno evidentemente sintético o por el ejemplo textual del estándar. (5) Lo estricto sin
un mensaje claro no está terminado.
