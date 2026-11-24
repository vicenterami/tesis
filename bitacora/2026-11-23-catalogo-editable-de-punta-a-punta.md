# 23/11/2026 — El catálogo editable, de punta a punta: esquema, recepción, API y pantalla

**Contexto.** El diseño del catálogo editable quedó refutado y escrito el 20/11; hoy se construyó entero, con el cierre de TT-12 en el
núcleo (32 de 35 elementos, 92 %).

**Qué se hizo.** TT-12 pasó del diseño refutado del 20/11 a un catálogo que se administra sin programar, en seis bloques, cada uno con su
revisión y su verificación antes del siguiente:
1. **Esquema (migración 27).** Las magnitudes ganan rango obligatorio y finito, forma del código y umbrales sugeridos; aparecen los alias de
   claves y las recetas de decodificación, de escritura única; el decodificador de cada equipo pasa a ser clave foránea. La aplicación sigue
   sin poder borrar nada: lo que hay que borrar o crear junto pasa por dos funciones acotadas del dueño de la base. 40 reglas plantadas lo
   comprueban.
2. **Intérprete de recetas.** Una función pura que aplica una receta a los bytes de una trama; da exactamente lo mismo que la decodificación
   anterior en 131 328 valores y nunca falla con otro error que «trama malformada».
3. **Recepción.** La consulta que busca el equipo en cada trama trae también su receta y los alias: un cambio vale desde la trama siguiente,
   sin memoria. Medido con el mismo comando antes y después: el p95 por pasarela quedó en 4 ms, así que no hizo falta memoria intermedia.
4. **API de magnitudes.** Crear y editar con bloqueo optimista, el aviso de cuántas mediciones afecta achicar el rango, el bloqueo si deja
   fuera una regla o una calibración, alias que no se cruzan, y el registro de quién cambió qué.
5. **API de recetas y el alta desde la base.** Crear, probar sin guardar, «reemplazar por»; el alta de a uno, el lote y la configuración de un
   equipo leen las recetas de la base. Ya no queda una lista de recetas en el código.
6. **La pantalla «Catálogo»** y «Usar el sugerido» en la configuración de un canal, probadas por el DOM y en dos navegadores reales a ancho de
   teléfono y de escritorio.

**El servidor de prueba** quedó con todo lo anterior. Al desplegar se encontró que no le llegan datos desde el 04/11: el flujo de la
pasarela hacia él no está activo, y se retomará con quien opera la red del campus.

**Lecciones.**
- **Una prueba que pasa a la primera se planta.** La primera prueba de una carrera entre dos altas con el mismo alias pasaba aun sin
  ninguna de las dos defensas: las peticiones no llegaban a cruzarse. Se reemplazó por dos pruebas que provocan la carrera a propósito, y
  cada una falla sin su defensa.
- **Una tabla de una fuente se lee entera.** Las unidades «no recomendadas» del registro de SenML eran ocho, no cuatro: el asterisco de
  cuatro estaba en la línea de continuación de la tabla.
- **Un agregado ignora los nulos.** Una comprobación con `bool_and` daba verde aunque una función no tuviera fijada su ruta de búsqueda: el
  valor nulo no cuenta. Se encontró plantando la falla.
- **Tras un conflicto se conserva solo lo que la persona tocó.** Releer y restaurar todo lo escrito pisaba en silencio el cambio de otra
  persona; la revisión lo encontró y una prueba lo fija.
- **Las pruebas de tiempo dependen del equipo.** Dos fallaron con la CPU ocupada o a batería y pasaron solas: no se cambió el código, se
  anotaron para darles un tope medido.
