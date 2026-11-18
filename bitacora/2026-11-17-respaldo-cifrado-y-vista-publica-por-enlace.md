# 17/11/2026 — Respaldo cifrado en el servidor y la vista pública por enlace, de la base a las pantallas

**Contexto.** Dentro del plan de la Etapa 4 (`docs/04 §8`), la jornada cerró dos bloques: lo que faltaba de los respaldos para no perder
datos en un despliegue (TT-46) y la vista pública por enlace (HU-32, RF-62), que entró al núcleo el día anterior. Ciclo de siempre:
diseño escrito antes del código, construcción, revisión independiente, verificador en verde y un commit por bloque. El núcleo pasó de
29 a 30 de 35 elementos hechos (87 % de sus horas).

**Respaldo cifrado y guardia de 26 h (TT-46).** El respaldo trae lo mismo que la base: resúmenes de claves, correos y mediciones que no
se publican antes de su publicación científica. Ahora se cifra con `age` para dos claves públicas —la del operador y una de emergencia
que se guarda sin conexión—, en flujo y sin dejar el volcado en claro en ningún disco; el servidor puede cifrar, pero no leer. Si se
pidió cifrar y no se puede, no escribe nada. Una guardia dice `OK` o `ATRASADO` según la edad del último respaldo, su tamaño, su huella,
sus sumas y si volvió a salir en claro; no la engañan un `touch` ni un archivo renombrado. En el servidor de prueba quedó activo el mismo
día: respaldo diario cifrado, guardia diaria una hora después, y el respaldo traído a otro equipo y restaurado con la clave del operador,
idéntico (20 104 filas en 22 tablas, 4 s); sin la clave, el simulacro se niega (`docs/16 §78`). Falta la papelera de dispositivos y el
ensayo de recuperación completa en un equipo vacío.

**Despliegue en el servidor de prueba.** Se desplegó el commit del cierre de la vista pública: la migración 25 y el script del rol de la aplicación corrieron sin ninguna línea `ERROR`, la base pasó de 22 a 25 tablas, el escáner de imágenes no dejó nada «con parche» y los cuatro contenedores quedaron «healthy». El respaldo cifrado tomado antes del despliegue se llevó a otro equipo y se restauró («SIMULACRO OK», 20 186 filas en 22 tablas, lo correcto porque es anterior a la migración). Queda pendiente la comprobación en el navegador contra el servidor (crear, abrir y revocar un enlace de prueba) y un respaldo nuevo, ya con 25 tablas, restaurado fuera (`docs/16 §80`).

**Vista pública por enlace (HU-32).** Quien no tiene cuenta abre una dirección y ve promedios de un sitio, sin datos crudos. Lo difícil
no fue construirla, sino que nadie pudiera despejar la lectura de un solo equipo. La regla inicial —un valor se publica solo si lo
aportan al menos k dispositivos— no bastaba: cuatro revisiones de seguridad sucesivas encontraron cómo despejarlo restando el total del sitio y
las zonas publicadas, combinando dos enlaces con k distintos o comparando una zona antes y después de mover un equipo. Cada parche
cerraba un caso y aparecía otro, así que se cambió el diseño: **un solo k por sitio**, que fija su administrador, y una **historia de
zonas**, para que cada lectura cuente en la zona donde se tomó. Con eso todo enlace oculta lo mismo y cualquier combinación de lo
publicado son grupos de al menos k equipos. Queda declarado el riesgo de comparar tramos de tiempo distintos (`docs/19 §4`, O). La
plataforma protege por omisión y avisa; si el administrador baja la protección, es su decisión y queda en la actividad.

**Pantallas.** La del visitante lee el token antes de montar la aplicación y lo manda solo en una cabecera; no usa cookies ni guarda
nada en el navegador. La de publicar muestra la vista previa igual a la del visitante y, antes de publicar, lo que un visitante podría
deducir; el botón espera la vista previa de la selección actual. Recorrido en navegador real: 178 de 178 comprobaciones en Chromium y
Firefox, a 390 y 1 280 px; el verificador lo corre en cada pasada (`docs/16 §79` y §80).

**Revisiones de la jornada.** Diez pasadas independientes sobre la vista pública (seis sobre la base, el backend y el proxy, y cuatro sobre las pantallas), cada hallazgo verificado antes de corregir. Lo que el verificador no habría
visto: la regla de k aplicada enlace por enlace, que dejaba despejar por resta; un equipo movido de zona que reescribía el pasado del
total; un valor inicial de la migración que bajaba la protección sin que nadie lo decidiera; y «Publicar» activo antes de ver los
avisos de la selección.

**Lecciones.** (1) Una regla de privacidad sobre agregados se demuestra contra todo lo publicado junto, no contra cada publicación por
separado; cuando los parches no convergen, se cambia el diseño. (2) Un paso que destruye (borrar una clave) va aparte y después de
comprobar la copia. (3) Un comando que redirige un grupo de comandos a un archivo puede arrastrar marcas invisibles de la terminal: se
comprueba el archivo, no el comando. (4) Reconstruir la pila con menos capas de configuración que las de siempre deja el servicio sin
sus puertos, y las pruebas fallan por entorno, no por código.
