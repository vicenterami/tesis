# Ensayo en seco del guion de demostración — 27 de septiembre de 2026

- **Sesión de trabajo individual;** registro de lo encontrado al recorrer `docs/15` contra la pila real,
  antes del ensayo con cronómetro del 29/09.

## 1. Lo verificado sin credenciales

| Paso del guion | Resultado |
|---|---|
| 1 · consumo en reposo | TimescaleDB 58 MB + Mosquitto 1,4 MB: calza con «decenas de MB» |
| 4 · camino de repuesto | Hay una condición `sin_comunicacion` abierta y varias cerradas de pruebas previas: la tabla se puede mostrar tal como dice el guion |
| 5 · API | `GET /dispositivos` con `en_linea` y condiciones abiertas; instantes con `Z`; UUID inválido → 400. El histórico por hora da 0 puntos porque el último dato es del 15/09 (fuera de las 24 h por defecto); con `desde=` anterior trae el dato. Es el caso que la tabla «Si algo falla en vivo» ya prevé |
| 6 · verificación | 49 pruebas; guardián en verde |

## 2. Lo que costó publicar, y por qué

Los pasos 2 a 4 publican como `dev-0001` y necesitan su clave, que vive solo en el gestor de
contraseñas. Al intentar crear una clave de prueba para el ensayo aparecieron tres hechos:

- **La configuración del broker se monta en solo lectura** (`:ro`, `docs/11 §3`): `mosquitto_passwd`
  no puede correr dentro del contenedor. Correcto por diseño, pero `docs/11 §7` decía *qué* hacer
  (rotar con `mosquitto_passwd`, dueño 1883, modo 0640) y no *cómo* hacerlo con esa restricción.
- **El arranque de la imagen `eclipse-mosquitto`, cuando corre como root, hace `chown -R` sobre
  `/mosquitto`** (leído en su `/docker-entrypoint.sh`). Un contenedor auxiliar que montó la carpeta
  del portátil en `/mosquitto/config` le cambió el dueño a `acl`, `mosquitto.conf` y a la carpeta
  misma (de la cuenta del operador a uid 1883). No cambia nada versionado (git no registra dueños),
  pero el operador ya no puede editar esos archivos sin `sudo`. Se restituye con `sudo chown`.
  El procedimiento de puesta en marcha del README monta en `/c`, fuera del alcance de ese `chown`:
  por eso nunca había pasado.
- **La clave de `dev-0001` quedó reemplazada** por una de prueba que no se conserva: hay que crear una
  nueva antes del ensayo. Una credencial se rota, no se recupera (`docs/11 §7`), así que el costo es
  un comando.

Una afirmación hecha durante la sesión resultó falsa al verificarla: que una señal `HUP` había
«matado» al broker. Los eventos de Docker y el contador de reinicios dicen que el único reinicio fue el
deliberado (`docker compose restart`).

## 3. Qué se cambió

| Qué | Por qué | Verificado |
|---|---|---|
| `plataforma/pruebas/clave-dispositivo.sh <id>` y `--borrar <id>` | Un solo comando para crear, rotar o borrar la clave de un dispositivo: la clave se pega en un aviso oculto y llega a `mosquitto_passwd` por la entrada estándar (nunca como argumento ni en el historial); contenedor auxiliar con `--entrypoint`, montado en `/c`, para no disparar el `chown`; restituye dueño 1883 y modo 0640; reinicia el broker y **verifica** que la clave autentica o que el dispositivo ya no existe | Con un dispositivo de descarte, nueve casos: crear → autentica; publicar con la clave → llega al backend (y cae en cuarentena `desconocido`, el filtro 1 funcionando); clave incorrecta → rechazada; clave de 5 caracteres → rechazada sin tocar nada; `sonda` → se niega; borrar → ya no autentica. Dueños y modo de la carpeta, idénticos antes y después |
| `plataforma/pruebas/publicar.sh <magnitud> <carga>` | Los pasos 2 a 4 en vivo con menos que teclear; QoS 1 como exige el diseño; la clave desde `CLAVE_DEV` o un aviso oculto | Clave correcta → publicado; incorrecta → falla con el motivo del broker |
| `docs/11 §7` | El *cómo* que faltaba, con la razón del `--entrypoint` | Texto |
| `docs/15` | Clave con `read -rs` (no escrita en la línea de comandos); pasos 2 a 4 con `publicar.sh`; tabla de fallas corregida: «el broker rechaza sin avisar» era cierto para un **tópico ajeno** (la ACL lo descarta y el cliente recibe éxito), no para una **clave mala** (el cliente recibe `not authorised`). Ambos casos probados | Probado publicando en el tópico de otro dispositivo: el cliente ve éxito, al backend no llega nada |
| Dos README | Enseñaban a escribir claves en la línea de comandos (`-P 'LA_CLAVE…'`, `mosquitto_passwd -b … 'clave'`), que quedan en el historial de la terminal; ahora con aviso oculto y entrada estándar, o con `publicar.sh` | Texto; la forma de entrada estándar se probó antes en un broker aislado |
| Paso 2i del guardián | Detecta solo lo que pasó hoy: carpeta, `acl` y `mosquitto.conf` deben ser del operador, y `passwd` de uid 1883 con modo 640; lee solo metadatos, nunca el contenido | Con dueños plantados en una carpeta de descarte → falla nombrando cada archivo; con la carpeta real → pasa |
| `.env.example` | Apuntaba al README del backend, que no explica `mosquitto_passwd`; el que lo explica es `plataforma/README.md` | Texto |

## 4. Primer paso del guion, ensayado con la clave nueva

La publicación del paso 2 llegó de punta a punta: `publicado` en el cliente, `1/1 lecturas guardadas vía
senml` en el backend y la medición de 22,4 Cel en la base. En el mismo instante se cerró sola la
condición `sin_comunicacion` que `dev-0001` tenía abierta desde el 15/09: la supervisión funcionando sin
que el guion lo pidiera, útil para mostrar. Dos ajustes de lo visto: `pila.sh logs` oculta de la vista
el chequeo de salud del broker (una conexión de `sonda` cada 15 s tapaba todo; la copia cruda lo
conserva, `PILA_TODO=1` lo muestra), y `docs/10 §6` describe ahora los chequeos de salud de los tres
servicios, que existían pero no estaban en la vista de despliegue.

## 5. Ensayo completo de los pasos 3 y 4 (27/09, tarde)

Con la clave nueva, los pasos 3 y 4 del guion salieron exactamente como están escritos, verificados en
registros **y** en la base: `abc` → `malformada`; `500` → `invalida` (fuera de rango); `{"v":300,"u":"K"}`
→ guardada como 26,85 Cel (filtro 4); `1013` en presión → `invalida` (canal no declarado); `35` → condición
`umbral` abierta; `29` → nada (histéresis); `27` → cerrada a los 22 s; silencio → `sin_comunicacion`
abierta sola a los 42 s. El broker se revisó contra su configuración real: sin anónimos, ACL de mínimo
privilegio (cada dispositivo escribe solo bajo su nombre; `backend` solo lee; `sonda` solo estadísticas),
puertos solo en `127.0.0.1` en desarrollo y ninguno en la forma de producción.

Tres observaciones que no cambian el guion pero sí van a pendientes: (1) el **motivo fino** del rechazo
(«ningún adaptador reconoce el formato», «fuera de rango: 500 Cel») vive solo en el registro; la tabla
`cuarentena` guarda la categoría y la trama cruda, no la regla incumplida que `docs/10 §8.1` propone
guardar; (2) 300 K se guarda como `26.850000000000023`: la **precisión por magnitud** no está definida en
el modelo (`docs/08`, tabla `magnitud`); (3) todo el ensayo es con **un** dispositivo publicando a mano:
la carga con muchos nodos y cadencia real es TT-28 (emulador) y TT-29 (≥ 50 eventos/s, RNF-01), Etapa 4.

## 6. Fuga de privacidad encontrada al preparar las entrevistas

Al revisar el material para llevar el martes, el nombre de pila del compañero de la red LoRaWAN apareció
en seis archivos versionados (RESUMEN.md, cuatro bitácoras, `docs/06`), contra la regla del repositorio
público. Reemplazado por su rol en los 15 lugares. Como el guardián 2f solo detecta la herramienta y las
rutas personales, se agregó el paso 2j: lee una lista privada de nombres (fuera del repo, porque
tenerla dentro sería la fuga) y falla si algún archivo versionado los contiene. Probado con la violación
presente, sin lista y con el árbol corregido. El nombre sigue en la historia de git y se limpia con el
resto antes de publicar el repositorio.

## 7. Pendiente registrado, no resuelto hoy

Mosquitto 2.0.22 advierte en cada arranque (doce veces en el registro del contenedor, desde antes de
hoy) que `acl` es legible por todos y que `passwd` no es de root, y que «versiones futuras se negarán a
cargarlos». `docs/11 §7` ya documenta que con `passwd` de root el broker **no arranca** hoy: las dos
exigencias chocan. Se decide dueño y modo de ambos archivos antes de actualizar la imagen, no ahora.
