# 13 y 14/11/2026 — Credenciales con SHA-256, tablero v3, parches de imágenes, promedio del sitio y limpieza

**Contexto.** Dentro del plan de la Etapa 4 (`docs/04 §8`), que pone primero lo que la persona ve y opera, la jornada siguió el mismo
ciclo de las anteriores —diseño escrito antes del código, construcción, revisión independiente, verificador en verde y un commit por
bloque— y cerró ocho bloques. El servidor de prueba quedó en el commit del diseño (`e2544d5`); falta redesplegar lo demás.

**Credenciales de dispositivo (commit `5175589`).** El secreto de un dispositivo es aleatorio (24 bytes), no una clave elegida por una
persona: encarecer su resumen con scrypt no protegía nada y frenaba el alta masiva. Pasó a SHA-256; scrypt queda para las claves de
personas, y las credenciales anteriores se convierten al primer acierto por HTTP. Crear 500 dispositivos bajó de 72 s a 0,10 s por HTTP y 0,40 s
por MQTT (`docs/16 §65`). La semilla de demostración dejó de pisar las claves que una persona ya eligió.

**Diseño del tablero v3 (commit `e2544d5`).** `docs/19 §4`, bloque L: menú lateral que se contrae a iconos y es un cajón en teléfono,
tablero en tres pestañas (Resumen, Tendencias y Red), «Ahora» con lo que se mide en este momento, gráficas vivas donde sirve y tema con
un botón. Antes de construir, el diseño pasó una revisión que lo intentó refutar: 19 objeciones, todas atendidas en el texto.

**Backend del tablero v3 (commits `2091a64` y `8ddf32c`).** `GET /sitios/{id}/ahora`, los avisos del canal en vivo con su `sitio_id` y
una semilla con un campus creíble. La revisión movió el resumen por magnitud a la base y le puso a la tendencia un tiempo máximo y un
cupo, de modo que la ruta responde igual, sin tendencia, cuando no alcanza (`docs/16 §66`).

**Parches de imágenes (commit `04e7122`).** El escáner pidió actuar tras el despliegue: se quitó de la imagen de la base una copia sin
uso de PostgreSQL y de Python que arrastraba un paquete, y se sumaron dos bibliotecas con parche. El escáner de paquetes no ve el
PostgreSQL compilado de la imagen: el guion compara ahora su versión con la publicada y avisa (`docs/11 §4`, `docs/16 §12`).

**Panel del tablero v3 (commit `55182ed`).** El Resumen pasó de 3 957 a 1 175 px a 1 280 px y de 6 254 a 1 998 px en teléfono, con dos
pedidos al entrar en vez de siete; «Ahora» sigue las tramas sin un pedido por cada una; las pantallas se descargan al abrirlas. Mirar
las capturas encontró tres defectos que ninguna prueba veía (las barras de entrega no eran comparables de fila en fila, un rótulo
cortado y decimales mezclados en la etiqueta). La revisión, 20 hallazgos; y una falla intermitente de la prueba de navegador resultó un
defecto real: una carga en vuelo reescribía la URL justo después de un clic y la navegación se perdía (`docs/16 §67`).

**El promedio del sitio (commit `be9da9c`).** Las gráficas de Tendencias salían en dientes de sierra: cada punto promediaba todas las
lecturas del tramo, así que pesaba más quien más reportaba y el conjunto cambiaba de tramo en tramo. Ahora cada dispositivo aporta un
valor —el promedio de sus lecturas o, si no reportó, su última lectura mientras siga vigente— y el punto es el promedio de esos
aportes (`docs/19 §4`, bloque M). Medido antes y después con 120 y 2 000 dispositivos: de 12 ms a 1,09 s según el rango. El criterio de
costo se corrigió el mismo día: un umbral relativo castigaba diferencias de milisegundos; quedó uno absoluto (`docs/16 §68`).

**Limpieza (commit `544490d`).** Fuera un componente del tablero anterior, dos funciones exportadas y un alias que ya nadie usaba,
cada uno con la búsqueda de quién lo usa. El backend y los guiones no tenían nada suelto (`docs/16 §69`).

**Revisiones de la jornada.** Seis pasadas independientes (una sobre el diseño y cinco sobre el código), cada hallazgo verificado antes de
corregir. Lo que el verificador no habría
visto: la prueba de navegador del banco, que no corre dentro de él, seguía buscando una leyenda que el tablero dejó de dibujar; «Pausar»
no alcanzaba a lo ya programado; un conflicto al guardar una preferencia se repetía hasta recargar la página; y las gráficas del sitio
podían ocupar todas las conexiones que comparte la recepción de tramas. De ahí salió un paso nuevo del verificador (53 pasos).

**Lecciones.** (1) Una prueba que el verificador no corre se rompe sin que nadie lo note: al menos sus selectores se vigilan ahora.
(2) Una falla intermitente de una prueba no se reintenta hasta que pase: se lee el código, porque puede ser un defecto real. (3) Un
umbral relativo sobre tiempos muy pequeños no dice si la pantalla responde; el criterio de costo se escribe en tiempos absolutos y con su
porqué. (4) Los datos de demostración envejecen: una medición hecha sobre datos viejos aprueba sin exigir, así que la comprobación dice
con cuántos datos midió. (5) Mirar la pantalla sigue siendo una prueba: tres defectos del panel solo se veían en las capturas.
