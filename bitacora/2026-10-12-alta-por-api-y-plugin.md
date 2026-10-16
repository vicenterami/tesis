# Alta por API, credenciales del broker en el plugin y panel con ficha y exportación — 12 de octubre de 2026

- **Sesión de trabajo individual (día completo).** Se cerró la lista de nombres de host contra el *DNS rebinding* (backend y
  proxy), se construyeron los tramos 2 y 3 del panel (inventario con semáforo y ficha con gráfico), la exportación en CSV y
  JSON, y el alta de dispositivos por API (HU-11) con la migración de todas las credenciales del broker al plugin
  Dynamic Security de Mosquitto, adoptando la versión 2.1.2. Cada bloque terminó con una revisión de lo cambiado desde tres
  ángulos (seguridad, concordancia entre documentos, código y configuración, y privacidad) y con las correcciones aplicadas
  antes de seguir. Lo medido está en `docs/16 §15` a `§20`.

## Alta por API (`POST /dispositivos`, `docs/10 §3` y `§8.4` puntos 41 y 42)
- Guardia por cabecera `X-Clave-Admin` mientras no hay sesión: comparación en tiempo constante sobre hashes, clave de 24
  caracteres o más (más corta, el backend no arranca; ausente, 503 y nunca abierta), el mismo 401 para ausente y distinta.
- Todo o nada: dispositivo, canales, hash `scrypt` de la credencial y evento en una transacción; el cliente del broker se crea
  dentro de ella con su rol en un solo comando; sin respuesta del broker en 5 s nada queda creado; si la base no confirma
  después, el cliente se borra. La credencial (24 bytes aleatorios) se muestra una sola vez con `Cache-Control: no-store`.
- La administración del broker usa una identidad propia (`backend-admin`) con conexión aparte de la que recibe tramas.
- Lo que el validador exige salió de la base, no de un borrador: la migración 11 admite `[a-z0-9-]` de 3 a 63 caracteres y el
  primer borrador aceptaba guion bajo y 64; se corrigió antes de la primera prueba.

## Credenciales del broker: del archivo al plugin (`docs/16 §18` y `§20`)
- El laboratorio desechable (tres corridas) mostró que con el plugin activo la ACL de todos la decide el plugin, y que en
  2.0.22 el patrón `%u` no sustituía (habría exigido un rol por dispositivo). Se adoptó Mosquitto 2.1.2-alpine por digest
  (escaneo sin vulnerabilidades altas ni críticas) y se corroboró con el registro de cambios oficial que nada probado antes queda
  desmentido (tope por mensaje, cola, archivos de claves declarados obsoletos).
- `password_file` y `acl_file` salieron de la configuración y el `acl` del repositorio. Un guion crea una sola vez el archivo del
  plugin (sin broker, en un contenedor auxiliar montado en `/c`), los roles `recepcion`, `sonda` y `dispositivo` con negaciones
  explícitas y el acceso por defecto en deny, y los clientes del sistema con las claves del `.env`, verificando que entran.
  Otro guion crea, rota o borra la credencial de un dispositivo a mano (demo y emergencias), con la clave por la entrada estándar.
- Un segundo laboratorio versionado deja medible lo que condicionó el diseño: un cliente que manda usuario sin clave se rechaza
  aunque los anónimos estén permitidos (el emulador del banco conecta sin usuario), y el archivo del plugin con dueño `root`
  deja al plugin vacío.
- El banco de pruebas corre el mismo plugin: los emulados entran por el grupo anónimo con un rol propio, y `banco.sh alta`
  prueba el alta de punta a punta (19 comprobaciones), la capa TLS (11) y el emulador sin pérdida.

## Correcciones de la revisión del mismo día (40 hallazgos; 39 aplicados)
- La administración del broker se declaraba lista al conectar, antes de suscribirse a las respuestas: una orden en esa ventana
  habría dejado un cliente huérfano. Ahora espera la suscripción, y un error ambiguo (sin respuesta, conexión perdida) ordena
  borrar el cliente por si llegó a crearse; un rechazo explícito del plugin no borra nada.
- El guion de inicialización decía «OK» aunque el plugin respondiera error (la herramienta devuelve 0 igual): ahora cada orden
  se verifica y cada clave del sistema se prueba entrando al broker. Recrea el broker solo si el que corre no acepta al
  administrador: la configuración entra por un bind mount y el proceso la lee una sola vez, al arrancar; la primera corrida en
  la pila de desarrollo falló por eso.
- El banco abría el acceso por defecto del plugin y, con eso, un dispositivo real podía publicar como otro: se cerró con el
  grupo anónimo y negaciones explícitas en todos los roles; el banco prueba desde entonces la misma ACL que el servidor.
- Tope de dos altas a la vez y `idle_in_transaction_session_timeout` (la espera al broker retiene una conexión del pool);
  `scrypt` asíncrono; verificación con bordes cubiertos; el nombre de la sonda reservado; citas a guiones que ya no existen,
  cifras del backlog y del estado de la etapa recalculadas; licencia de Mosquitto citada de su repositorio.

## Decisiones del día
- `scrypt` de Node para los hashes (sin dependencias); cabecera propia obligatoria en las rutas que escriben (contra CSRF); la
  clave de administrador se retira al llegar la sesión; clave temporal con vigencia medida para «olvidé mi clave»; Mosquitto
  2.1.2 por digest. El diseño de sesión, usuarios y permisos queda como borrador (`docs/20`) para la Etapa 4.

## Pendientes
- [x] Baja y rotación por API sobre las órdenes ya escritas (hechas el 13/10; en el backlog HU-12 y HU-13 son otras historias: el nombre se corrigió). Pendiente: prueba de dos altas simultáneas.
- [ ] Observabilidad y auditoría de operaciones: diseño antes del código (tabla de auditoría y middleware).
- [ ] Semilla de demostración completa, con el resultado esperado escrito en su cabecera y todos los estados, vías y
  condiciones, para encontrar errores del panel y del backend antes que el usuario.
- [ ] Capítulo de pruebas del informe (TT-36) y preguntas al profesor guía.
