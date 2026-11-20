# 20/11/2026 — Parches de seguridad de la base y de Node, homónimos en la actividad y el diseño del catálogo editable

**Contexto.** El despliegue del 19/11 había dejado un aviso del escáner: el servidor PostgreSQL de la imagen de la base era 16.15 y ya
existía 16.16. Por la regla de que lo de seguridad no espera, la jornada empezó por ahí; después siguieron dos bloques del núcleo: distinguir
a dos personas con el mismo nombre donde se muestra quién hizo algo, y el diseño del catálogo editable (TT-12).

**La base en TimescaleDB 2.32.1 y PostgreSQL 16.16.** La actualización que proponía la herramienta de dependencias (2.32.0) seguía trayendo
16.15; la primera imagen con 16.16 es la 2.32.1, publicada el día anterior, y sus notas oficiales dicen que las versiones anteriores fallan en
sus trabajos de fondo con las nuevas menores de PostgreSQL. Antes de tocar la base se leyeron las notas de las tres versiones intermedias y
se buscó en el código lo que podían romper: desde la 2.32 la creación de un fragmento nuevo ya no cambia al dueño del catálogo, y en este
sistema los fragmentos los crea un rol que no es dueño de las tablas. Se probó en una transacción deshecha: el fragmento se crea y la
retención responde. La base local se actualizó con respaldo, simulacro de restauración, recreación de la imagen y `ALTER EXTENSION`, y la
huella de las 25 tablas quedó idéntica salvo la versión de la extensión; en el servidor de prueba, lo mismo, con la recepción detenida para
que la comparación fuera válida (las tramas esperaron en la cola persistente del broker). `docs/16 §92`.

**Node 22.23.5 y el hueco del escáner.** La misma revisión mostró que la actualización de Node proponía un parche de seguridad publicado nueve
días antes (seis CVE de severidad alta en http2, TLS y HTTP), retenido por la espera de siete días de la herramienta de dependencias. El
escáner de imágenes no lo había visto: lee paquetes del sistema y no el binario de Node, como antes no veía el servidor PostgreSQL compilado.
Se le sumó la misma comparación que ya tenía para PostgreSQL —la versión de la imagen frente a la última publicada de su serie—, con una
prueba sin red que el verificador corre en cada pasada y que falla si se le quita el orden de versiones.

**Homónimos.** En la actividad del sitio, dos cuentas con el mismo nombre se veían iguales, y «saber quién hizo qué» (RF-46) fallaba. En los
cuatro lugares donde un administrador ve quién hizo algo, la persona viaja ahora con su correo; una cuenta anonimizada, sin él. Como cambia
quién ve el correo, primero cambiaron la regla escrita y la página de privacidad, que pasó a su versión 4 (`docs/16 §93`). La revisión
independiente encontró que el texto de la regla decía que no se ampliaba quién ve el correo, y sí se amplía a quien ya veía el nombre: se
corrigió el texto, que la página de privacidad ya decía bien.

**El catálogo editable: diseño refutado antes de construir.** Se decidió que las recetas para leer los bytes de un sensor nuevo se escriban
como datos en el panel, sin programar. El primer diseño se entregó a una revisión adversarial contra el código real, que encontró cinco
fallas graves: le daba a la aplicación un permiso de borrado que hoy no tiene a propósito; una migración anterior, al reaplicarse, deshacía el
cambio; una receta mal escrita podía dejar a toda la flota de una pasarela «sin comunicación»; un tipo de columna hacía que una suma
concatenara texto en silencio; y no existía cómo corregir la receta de un equipo ya asignado. El diseño corregido quedó en los documentos
(`docs/08 §8`, `docs/10 §8.4` punto 69, `docs/19 §4` bloque T y `docs/20 §6`); la construcción va en la próxima sesión.

**Lecciones.** (1) Una actualización propuesta no es la corrección del aviso: hay que comprobar en la fuente qué trae cada imagen; la
propuesta seguía con la versión vulnerable. (2) Un escáner solo ve lo que sabe leer: un binario compilado fuera de los paquetes necesita su
propia comprobación, y la espera de la herramienta de dependencias puede retener un parche de seguridad. (3) Una cifra de pruebas tiene que
decir qué cuenta: las pruebas escritas y las ejecutadas difieren cuando hay casos parametrizados, y el proyecto cita las escritas. (4) Una
figura generada se comprueba abriendo el PDF: la fuente del informe se había editado a mano y el generador no redibujó. (5) Refutar un diseño
cuesta menos que corregir una migración aplicada: la revisión encontró cinco fallas graves en diez minutos y ninguna llegó al código.
