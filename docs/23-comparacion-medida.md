# Comparación medida con los referentes (TT-40): protocolo

> Versión 1, 25 de noviembre de 2026. **Estado: listo para congelar.** El protocolo se congela con un commit propio ANTES de la primera
> corrida válida, y desde ese commit cada cambio se anota en §10 con su fecha y su motivo (regla 4 de `docs/09 §2`). Las corridas hechas
> antes del congelamiento son pilotos (§9): validan el banco y sus resultados no se informan.
> Banco: `plataforma/pruebas/comparacion/` (su `LEEME.md` dice qué hace cada guion). Método general: `docs/09` §1–§3.

---

## 1. Qué se pregunta (escrito antes de medir)

- **P1 · Tamaño de servidor (resultado principal).** En una máquina de 2 vCPU con 2 GB o con 4 GB de RAM, ¿la plataforma **arranca y
  guarda toda la carga**: sí o no? Es la forma medible de la pregunta que sostiene RNF-17 frente a un referente (`docs/02`: «consumir a lo más
  2 GB de memoria RAM, en reposo y bajo carga, en un servidor de 4 GB (la mitad del servidor recomendado)»).
- **P2 · Completitud.** ¿Guarda todo lo que su broker confirmó (PUBACK, QoS 1)? Se cuenta punto por punto (§5.5).
- **P3 · Memoria (descriptiva).** Cuánta memoria usa la máquina en reposo y con carga, en MiB, solo como descripción (§7.2).
- **P4 · Puesta en marcha (descriptiva).** Cuánto tarda de «arranca Docker» a «lista» (§6.1); los contenedores de cada plataforma y el
  tamaño de sus imágenes quedan en `estado-final.csv` y `versiones.txt` de cada corrida y se cuentan de ahí, a mano.
- **P5 · Alta (descriptiva).** Cuántas llamadas a su API oficial pide dar de alta un dispositivo (las anota el instalador) y cuántos pasos
  de su guía oficial separan una instalación nueva del primer dato visible (se cuentan a mano, con la guía citada). Sin puntaje.
- **No se pregunta ni se afirma:** amplitud de funciones, madurez, rendimiento máximo. Los referentes hacen mucho más que esta plataforma;
  el informe lo dice. **Dónde puede perder la plataforma propia (se reporta igual):** si no aprueba en 2 GB, si pierde un punto confirmado,
  si tarda más en quedar lista, si su alta pide más llamadas.

## 2. Qué se mide y con qué regla se eligió

**Regla de selección, escrita antes de ver resultados.** Plataformas citadas en el estado del arte del informe que: (a) son de código
abierto y se despliegan en un equipo con su Docker Compose oficial; (b) son plataformas completas (reciben, guardan y muestran); (c) su
licencia no declara una cláusula que restrinja publicar mediciones (revisado como se dice bajo la tabla); (d) tienen imagen versionada y fijable; (e) guardan lo recibido sin componentes de pago.

| Referente | Entra | Motivo, con su fuente |
|---|---|---|
| ThingsBoard CE | Sí (principal) | Cumple (a)–(e). Compose oficial de un nodo en su guía de Docker. |
| OpenRemote | Sí, si alcanza el plazo (§4.4) | Cumple (a)–(e); su Compose usa `latest` en las cuatro imágenes y hay que fijar las de la 1.34.1. |
| Magistrala | Comprobación de 30 min | (e) en duda: su guía dice «To store any messages in the Magistrala database, you must first create and save a Rule using Rules Engine» y «Rules Engine is part of Magistrala Enterprise Edition (EE)» (https://www.absmach.eu/docs/magistrala/community/user-guide/users-quick-start/). Si en 30 min la edición abierta no guarda sin regla, «no medida», con ese motivo. |
| IoTSharp | No | (d): su Compose usa `registry.uixe.net/iotsharp/iotsharp:latest` (https://raw.githubusercontent.com/IoTSharp/IoTSharp/master/docker-compose.yml). |
| Eclipse Kapua | No | (d): imágenes `latest` o instantáneas en su Compose de desarrollo (https://raw.githubusercontent.com/eclipse-kapua/kapua/develop/deployment/docker/compose/docker-compose.yml). |
| TagoCore | No | (e): su broker es un complemento que no guarda por omisión (https://raw.githubusercontent.com/tago-io/tagocore/main/plugins/mqtt/README.md). |

Ninguna de las licencias revisadas declara una cláusula que restrinja publicar mediciones (revisado: `LICENSE` de ThingsBoard, de
OpenRemote y de Magistrala; búsqueda de «benchmark» y «compar»: sin coincidencias). Esto se escribe «no declarado», no «permitido».

**Versiones** (regla: al menos 7 días de publicadas a la fecha del protocolo, fijadas por digest; `plataforma/pruebas/comparacion/versiones.env`):

| Plataforma | Versión | Licencia | Papel |
|---|---|---|---|
| ThingsBoard CE | v4.3.1.8 (26/10/2026) | Apache-2.0: «Versions released before 4.4 remain under the Apache 2.0 License» (https://github.com/thingsboard/thingsboard, README) | Principal |
| ThingsBoard CE | v4.4.0.2 (30/10/2026) | Business Source License 1.1 | Sensibilidad: una corrida en 2 GB y una en 4 GB |
| OpenRemote | 1.34.1 (17/11/2026) | AGPL-3.0 | Si alcanza el plazo |
| Plataforma propia | el commit de la entrega | AGPL-3.0 | — |

La guía de Docker de ThingsBoard instalaba el 25/11 la v4.3.1.9 y el último lanzamiento era la 4.4.1, ambas del 24/11: no cumplen la regla
de los 7 días y no se miden. Lo mismo con OpenRemote 1.35.0 (24/11).

## 3. Cómo se iguala el terreno: una máquina virtual idéntica por plataforma

### 3.1 Por qué una máquina virtual y no techos por contenedor
Una JVM moderna sí lee el techo de memoria de su contenedor; lo que no existe es un techo **común** a todos los servicios de una
plataforma que cada proceso vea como «la memoria del servidor». Con techos por contenedor habría que repartir la memoria entre los
servicios de un referente, y ese reparto sería una decisión nuestra, no suya. Y sin techo, la JVM toma su fracción de la RAM del ANFITRIÓN:
ThingsBoard declara que «By default, ThingsBoard sets no heap size, so the JVM falls back to its own ergonomics and caps the heap at 25% of
the machine’s RAM» (https://thingsboard.io/docs/installation/ubuntu/). En una máquina virtual cada plataforma ve exactamente el servidor
que se le da y se configura sola, como lo haría en un servidor real de ese tamaño.

### 3.2 La máquina
- Imagen oficial de **Ubuntu Server 24.04 LTS para la nube**, compilación del 17/10/2026, fijada por su SHA-256 (`versiones.env`).
- **2 vCPU** (fijadas a dos hilos del anfitrión, distintos para cada máquina en paralelo), **disco de 20 GB** qcow2 con `cache=none`
  (la caché de páginas del anfitrión no calienta a unas y a otras no), **RAM de 2 o 4 GB** (8 GB solo si algo falla en 4 GB), **sin
  intercambio**, **sin globo de memoria** (QEMU con `-nodefaults`: no hay dispositivo que no esté escrito en `vm.sh`). Se anota el
  `MemTotal` real que ve la máquina.
- Un guion `cloud-init` versionado (`maquina/user-data.plantilla`) instala **Docker 29.10.0** del repositorio oficial de Docker, con
  versión fijada y retenida, y apaga los temporizadores de apt, las actualizaciones desatendidas, snapd y otros temporizadores que meten
  ruido distinto en cada corrida.
- QEMU directo con KVM y red de usuario, sin privilegios; reenvío de puertos al anfitrión solo en 127.0.0.1.

### 3.3 La red y el tope de conexiones por dirección
El proxy de la plataforma propia corta la conexión 101 de una misma dirección en el 8883 (`plataforma/proxy/nginx.conf`, «Tope de
conexiones simultáneas por dirección»). Con la red de usuario de QEMU todo lo que entra por una interfaz llega desde una sola dirección,
y S2 abre 100 dispositivos más la sonda. **Decisión, igual para todas:** cada máquina tiene **dos interfaces** de red de usuario con
subred propia; el generador manda los dispositivos pares por la primera y los impares por la segunda (50 por dirección, más la sonda en la
primera). El tope queda tal como se despliega, ninguna plataforma recibe una configuración distinta, y la división es la misma para
ThingsBoard (que por omisión no limita por dirección: `ip_limits_enabled: "${TB_TRANSPORT_IP_RATE_LIMITS_ENABLED:false}"` en su
`thingsboard.yml`). Se descartó subir el tope en el proxy propio (sería un ajuste nuestro a favor) y repartir en 99 dispositivos (cambia el
escenario). Si OpenRemote entra, se revisa también si su HAProxy limita por dirección.
Las subredes son bloques de documentación del RFC 5737 y las dos tarjetas llevan direcciones MAC fijas con el prefijo 52:54:00, el que QEMU
usa por convención (bit de administración local: no son de ningún fabricante ni identifican un equipo); el guardián del repositorio
solo admite ese prefijo y el rango de documentación.

### 3.4 Estado inicial idéntico en cada repetición
Cada plataforma se instala una vez en su máquina (`instalar-*.sh`): imágenes descargadas, esquema creado, **un primer arranque completo**,
el alta de los 100 dispositivos y de la sonda por su API, y un **apagado limpio** con Docker deshabilitado al arranque. Ese disco es la
instantánea «instalada». Cada corrida crea un disco nuevo encima de ella (copia en escritura con `qemu-img`) y lo borra al terminar: todas
parten del mismo estado, con el esquema ya creado (el primer arranque, que en unas crea el esquema y en otras no, se cronometra una sola
vez y se reporta aparte, en `fases.csv` de la instalación).

### 3.5 El anfitrión
El generador de carga corre en el anfitrión, fuera de la máquina medida, y no compite por su memoria. Se anotan en cada corrida la versión
del núcleo del anfitrión y de QEMU. Durante la medición: enchufado, sin suspensión (`systemd-inhibit`), sin otras corridas largas.

## 4. Las plataformas y su configuración

### 4.1 La plataforma propia, tal como se despliega
Su `docker-compose.yml` de producción más la capa del proxy TLS (`proxy/compose.proxy.yml`), **sin** el override de desarrollo, con sus
techos de memoria y CPU por contenedor, construida dentro de la máquina desde el commit medido y puesta en marcha con los guiones del
repositorio (`base-rol-app.sh`, `broker-inicializar.sh`). Claves aleatorias de cada instalación. Una muerte por memoria dentro de su techo
cuenta como fallo aunque la máquina tenga memoria libre (los techos la perjudican; se mantienen porque así se despliega). El método de
RNF-17 para la plataforma propia NO cambia: es `docker stats` en un servidor real (`docs/02`, `docs/16 §104`); esta comparación es otra
prueba, más exigente, que responde la pregunta frente a un referente.

Los dispositivos se dan de alta con el intervalo esperado del caso real (60 s). En S2 cada uno publica cada 2 s; su tope por emisor
(`TOPE_LECTURAS_FACTOR` 10 × 2 canales × 60 lecturas por hora = 1 200 lecturas por hora) queda sobre las 900 de S2 más las 40 de S1: no
rechaza nada de la carga, y si rechazara, cuenta en contra (§5.5).

### 4.2 ThingsBoard CE: su Compose de un nodo
El Compose «In Memory (default)» de su guía de Docker (https://thingsboard.io/docs/user-guide/install/docker/), copiado en
`plataforma/pruebas/comparacion/thingsboard/docker-compose.yml`. **Cambios respecto del oficial, todos anotados:** (1) la imagen
`thingsboard/tb-node:4.3.1.9` por la v4.3.1.8 fijada por digest; (2) `postgres:18` por `postgres:18.6` fijada por digest (el 25/11 la
etiqueta `18` apuntaba a la 18.7, publicada el 24/11); (3) solo en la v4.4.0.2, `NON_PRODUCTION_USE=true`, que su configuración pide para
arrancar sin clave de licencia en uso no productivo. Instalación sin datos de demostración (`INSTALL_TB=true`, como su guía). La clave de
la base y la del administrador del sistema son las de ejemplo de su guía. El inquilino, su administrador y los dispositivos se crean por su
API REST. Su cola por omisión es en memoria («In Memory (default) — built-in queue, no extra setup required. Suitable for development and
PoC.»): lo confirmado que esté en esa cola se pierde si el proceso se reinicia (§11).

### 4.3 Dos filas por referente
- **Fila A:** su Compose de inicio rápido, por omisión, en todos los tamaños.
- **Fila B:** lo que prescribe SU documentación, nunca un ajuste nuestro. ThingsBoard: «Set the heap size to half of your total RAM» y
  «It should be set to at least 2G» (https://thingsboard.io/docs/installation/ubuntu/, paso 5): con 4 GB, `-Xms2G -Xmx2G -Xss512k
  -XX:+AlwaysPreTouch` (`thingsboard/fila-b.yml`). En 2 GB la mitad (1 G) queda bajo el mínimo de 2 G que la misma guía fija: la fila B
  de 2 GB se reporta «fuera del mínimo declarado» y no se corre. OpenRemote: los valores de su `profile/deploy.yml`.
- La plataforma propia tiene una sola fila (su despliegue ya es el que su documentación prescribe).

### 4.4 OpenRemote (si alcanza el plazo)
Falta: fijar por digest las cuatro imágenes de la 1.34.1 (su Compose dice `${MANAGER_VERSION:-latest}` y equivalentes; averiguar las
etiquetas de keycloak, postgresql y proxy de esa versión); entrar por `localhost` reenviado con su CA autofirmada; crear el usuario de
servicio y los activos con `storeDataPoints` en los dos atributos por su API; un adaptador del generador con dos publicaciones por mensaje
(`{realm}/{clientId}/writeattribute/{atributo}/{assetId}` con `{"value": …, "timestamp": …}`, un atributo por publicación, según
https://docs.openremote.io/docs/user-guide/manager-apis/); su consulta de conteo sobre `asset_datapoint`; su fila B con `deploy.yml`. Si
no alcanza, el informe dice «OpenRemote no se midió en el plazo y para él se mantiene lo declarado (instancia central: no declarado)».

## 5. La carga: la misma para todas

### 5.1 El generador
`generador.mjs`, en el anfitrión. Por dispositivo y por período, UN mensaje con dos magnitudes (temperatura y humedad) y su marca de tiempo,
con QoS 1 y sesión limpia. Envíos alineados al reloj (el dispositivo i de N publica en k·P + i·P/N) y la marca enviada es ese instante
programado; valores deterministas por semilla, dispositivo e instante (como el instante es la hora real del envío, los valores de una corrida no son
los de otra; el número de mensajes y sus fases sí). **Sin relojes rotos, sin pérdidas emuladas, sin ráfagas** (el emulador del banco propio los
trae fijos y favorecerían a la plataforma propia, que los filtra).

### 5.2 Un adaptador por plataforma: formato y tópico nativos
| Plataforma | Transporte | Autenticación | Tópico | Cuerpo |
|---|---|---|---|---|
| Propia | MQTT sobre TLS (8883, por su proxy), certificado verificado | usuario y clave por dispositivo | el que entrega el alta | SenML: `[{"bt":…,"n":"temperatura","u":"Cel","v":…},{"n":"humedad","u":"%RH","v":…}]` |
| ThingsBoard | MQTT plano (1883, el puerto de su Compose) | token de acceso como usuario, sin clave: «The token acts as the MQTT username; no password is required.» | `v1/devices/me/telemetry` | `{"ts":…,"values":{"temperature":…,"humidity":…}}` («ts is a Unix timestamp in milliseconds», https://thingsboard.io/docs/reference/mqtt-api/telemetry/) |

Cada una usa el transporte que da su despliegue por omisión. La propia paga el costo de TLS y ThingsBoard no: se declara (§11).

### 5.3 Escenarios
| Escenario | Dispositivos | Ritmo | Duración | Además |
|---|---|---|---|---|
| S1 · reposo con el campus | 10 | uno cada 60 s cada uno (0,17 mensajes/s) | 20 min | — |
| S2 · punto de diseño | 100 | uno cada 2 s cada uno (50 mensajes/s, 100 puntos/s) | 15 min | un inicio de sesión y una consulta de historial al empezar, en todas (es el pico conocido de la plataforma propia, `docs/16 §59`) |

S1 y S2 corren seguidos en la misma corrida, después de «lista». Se reportan mensajes por segundo; cada mensaje son dos puntos (en
OpenRemote cada mensaje del dispositivo son dos publicaciones). El inicio de sesión y la consulta de historial de S2 se hacen justo antes
de que empiece su carga, su resultado queda en `s2/sesion.csv` y no entra al veredicto. La sonda que detecta «lista» (un mensaje cada
5 s, de un dispositivo aparte) sigue publicando durante S1 y S2 en todas las plataformas: suma 0,2 mensajes/s a la carga de la tabla,
más que el propio S1, y sus puntos no se cuentan en ningún escenario.

### 5.4 Alta de los dispositivos
Por la API oficial de cada plataforma, con un guion, dentro de la instalación (§3.4): propia, `POST /dispositivos` (una llamada por
dispositivo, que devuelve la credencial); ThingsBoard, `/api/device` (POST) y `/api/device/{id}/credentials` (GET), dos llamadas. Se anotan
las llamadas y el tiempo, de forma descriptiva y sin puntaje: la plataforma propia tiene además un alta por lote, y su ventaja en ese punto
no se cuenta a su favor.

### 5.5 Qué cuenta como guardado
Punto = dispositivo × magnitud × instante; cada mensaje confirmado vale 2 puntos en todas. Se cuenta con SQL en el PostgreSQL de cada
plataforma (`medicion` en la propia, `ts_kv` en ThingsBoard) y se comparan **conjuntos**, no totales: faltantes (confirmados que no están),
ajenos (guardados sin PUBACK) y repetidos (filas brutas menos distintas). El conteo espera a que la base se estabilice: 60 s sin cambios,
con un tope de 10 min (ThingsBoard escribe por lotes).

### 5.6 Contador plantado
`contador-prueba.sh` prueba el evaluador con datos sintéticos (N confirmados y 2N puntos guardados aprueban; quitando uno, no aprueba; un
repetido no cuenta como guardado de más). Y en cada plataforma, en el piloto, `corrida.sh --plantar` borra UN punto de S1 en la base de la
corrida (disco desechable) y vuelve a evaluar: la corrida debe pasar a «no aprueba» con un faltante.

## 6. La corrida y lo que se registra

### 6.1 Secuencia (`corrida.sh`)
Disco nuevo sobre la instantánea instalada → arranque de la máquina con la RAM del caso → muestreo → comprobaciones de la corrida (hora de
la máquina frente al anfitrión < 1 s, memoria, disco, temporizadores) → **t0: arranca Docker** y la plataforma (`docker compose up -d`)
y, en el mismo instante, la **sonda** publica cada 5 s con QoS 1 → **«lista»** = el PUBACK del primer mensaje de la sonda que además quedó
guardado (sus dos magnitudes), con tope de 10 min → S1 → S2 → conteo estable → estado final → apagado y borrado del disco de la corrida.

### 6.2 Muestreo dentro de la máquina, cada 1 s (`dentro/muestreo.sh`)
`MemTotal − MemAvailable` (la memoria que el servidor no puede dar a otro proceso; no cuenta la caché de archivos recuperable), presión de
memoria y de CPU (`/proc/pressure`: distingue un fallo por memoria de uno por CPU), muertes por memoria del núcleo (`/proc/vmstat`) y, por
contenedor, `memory.current`, `memory.peak` y `memory.events` de su cgroup. Sin `docker stats` (lanza un cliente por muestra). El máximo
muestreado es una cota inferior; `memory.peak` guarda el máximo real de cada contenedor. Al final: reinicios y muerte por memoria de cada
contenedor (`docker inspect`), eventos de Docker y el registro del núcleo.

## 7. Resultado

### 7.1 Aprueba o no, por plataforma, fila y tamaño
Una corrida **aprueba** si: queda lista en 10 min o menos, sin ninguna muerte por memoria (del núcleo o de un contenedor), sin ningún
reinicio de contenedor, con todos los mensajes enviados confirmados y **cero** puntos confirmados sin guardar, en S1 y en S2. Además la
corrida tiene que haber medido lo que dice: en cada escenario se envió toda la carga declarada (dispositivos × instantes de la ventana)
con todos los dispositivos conectados al empezar, y existen las muestras del sistema (también dentro de la ventana de cada escenario) y
el estado final de los contenedores. Una corrida del plan que no deja resultado cuenta como «no completó» en el k de n. Por
combinación se reporta k de 3 en 2 GB (con los tres valores) y el resultado de 4 GB.

### 7.2 Qué se publica
Una tabla (plataforma y fila × tamaño: lista en s, aprueba k/n, puntos guardados/esperados, memoria mediana y máxima en S1 y S2) y los
datos de una figura (`tabla.py` arma `tabla.md` y `figura.csv` de los datos crudos; la figura se dibuja de ese CSV). Los MiB son descripción: para una JVM la memoria crece hasta el porcentaje de la RAM que
ve, así que «usa más» no es «necesita más», y **nunca** se escribe «X veces menos». Los datos crudos de cada corrida se publican con los
guiones. Todo resultado se reporta, también los desfavorables a la plataforma propia.

## 8. Conclusiones escritas ANTES de medir

Para cada referente medido, el informe usará la frase del desenlace que ocurra, sin retoques:

- **R1 · No aprueba en 2 GB.** «En un servidor de 2 GB, [referente] no arrancó o no guardó toda la carga ([motivo medido]); su guía
  declara 4 GB para pruebas y 8 GB para una producción pequeña (`docs/01`). Esta plataforma aprobó en ese tamaño [k de 3].»
- **R2 · Aprueba en 2 GB, pero fuera de su mínimo declarado.** «[Referente] funcionó en 2 GB con su configuración por omisión, por debajo
  del mínimo que su propia guía declara (4 GB para pruebas; 8 GB para una producción pequeña, `docs/01`). La ventaja en memoria de esta plataforma es menor que la que sugiere la cifra declarada.»
- **R3 · Aprueba con holgura (2 GB, sin presión de memoria).** «La memoria no distingue a estas plataformas en estas cargas. La
  justificación de esta plataforma descansa en la operación por personal no técnico, el formato abierto, la licencia y el alcance, no en
  la memoria.»
- Si la plataforma propia no aprueba en 2 GB, se dice primero. No refuta por sí solo RNF-17, que se mide de otra forma (`docker stats`,
  a lo más 2 GB dentro de un servidor de 4 GB; §4.1): se informa y se decide con el profesor guía si el requisito se revisa.
- **Si solo se mide ThingsBoard:** «Se midió ThingsBoard CE v4.3.1.8 (Apache 2.0) frente a esta plataforma, con su Compose oficial y en
  máquinas de 2 vCPU y 2 o 4 GB, por omisión y con el heap que indica su guía; OpenRemote no se midió en el plazo y para él se mantiene lo
  declarado. El resultado vale para ThingsBoard y para estas cargas.»
- Lugares donde hoy vive el «4 GB» declarado y que se corrigen con el resultado: `informe-oficial/cap1.tex` (≈ línea 58),
  `informe-oficial/cap3.tex` (≈ 59-60), `informe-oficial/anexos/c-evaluacion.tex` (≈ 303 y 347),
  `informe-oficial/presentacion/presentacion.tex` (≈ 72 y 281), `docs/01` (≈ 161-172), `docs/02` (RNF-17), `docs/07` (≈ 15, 24 y 122) y
  `docs/12` (≈ 86). Donde hoy dicen que ThingsBoard «exige» 4 GB, lo que su guía declara es 4 GB para pruebas y 8 GB para una
  producción pequeña.

## 9. Pilotos declarados

Los pilotos validan el banco y **no** se informan. Cada cambio posterior a un piloto se anota aquí con su motivo.

| Fecha | Piloto | Para qué | Cambios que motivó |
|---|---|---|---|
| 25/11/2026 (1 a 3) | Propia y ThingsBoard v4.3.1.8 (fila A), 4 GB, S1 acortado a 5 min y S2 a 3 min, con `--plantar` | Que el banco funcione de punta a punta | El 1 se interrumpió desde fuera en S2; el 2 y el 3 murieron al recoger las muestras, después del conteo (falla del banco, §10). Sus datos no se usan. Mostraron tres fallas del banco (§10) |
| 25/11/2026 (4) | El mismo, tras corregir las tres fallas | Validar el banco completo: arranque, alta, carga, conteo, muestras, tabla; medir cuánto tarda cada fase | El banco funcionó de punta a punta en las dos plataformas, con el contador plantado detectando el faltante |
| 25/11/2026 (5) | Las dos plataformas en 2 GB, S1 de 5 min y S2 de 3 min | Que el banco funcione también en el tamaño central | ver §10 |
| 25/11/2026 (6) | Propia en 4 GB, S1 y S2 de 1 min | Comprobar las dos subredes nuevas de la red (cambio de §10) con las 101 sesiones de S2 | ver §10 |

## 10. Registro de cambios

| Fecha | Cambio | Motivo |
|---|---|---|
| 25/11/2026 | Criterio de guardado: cero faltantes (el borrador decía ≥ 99,9 %) | La pregunta es «guarda toda la carga» y QoS 1 promete al menos una entrega tras el PUBACK; el contador plantado exige detectar un solo faltante. |
| 25/11/2026 | Instalación de la propia: se borra la caché de construcción de Docker antes de la instantánea | El piloto dejó 3 GB de caché en el disco de la máquina; no cambia la memoria, sí el disco libre. |
| 25/11/2026 | Generador: el instante siguiente de cada dispositivo es siempre el anterior más el período | En el piloto 2, S2 envió 10 492 mensajes en vez de 9 000: recalcular el instante desde el reloj repetía la misma marca cuando el temporizador vencía un milisegundo antes. Los duplicados no cambiaban lo guardado (las dos bases guardan una vez por clave), pero sí la tasa. |
| 25/11/2026 | Máquina: las dos redes internas de QEMU usan los bloques de documentación del RFC 5737 | Para no escribir direcciones privadas en archivos versionados; la red es interna de QEMU y no cambia la medición (comprobado en el piloto 6). |
| 25/11/2026 | Corrida: el muestreo y los eventos se detienen por su pid | En los pilotos 2 y 3 la orden remota que detenía `docker events` con `pkill -f` contenía el mismo texto y se mataba a sí misma; la corrida terminaba sin recoger las muestras. |
| 25/11/2026 | Instalación de la propia: la persona administradora acepta los términos de uso vigentes | En el piloto 2 la consulta de historial de S2 respondió 403 (`terminos_pendientes`, `docs/20 §12`): una persona real los acepta al entrar por primera vez. |
| 27/11/2026 | Veredicto: no aprueba la corrida que no envió toda la carga declarada, con algún dispositivo sin conectar, sin muestras del sistema (tampoco en la ventana de un escenario) o sin estado final de los contenedores | Una revisión del evaluador mostró que una corrida podía aprobar con menos carga que la declarada o sin haber medido memoria ni reinicios. La prueba plantada pasó de 9 a 14 comprobaciones y exige el motivo de cada caso. |
| 27/11/2026 | Tabla: entran solo las corridas del plan de esa medición, y la que no dejó resultado cuenta como «no completó» | Una corrida que abortaba desaparecía del «k de n». |
| 27/11/2026 | Corrida válida: exige las duraciones del protocolo (1200 s y 900 s), los dos escenarios, la semilla 1 y, para la fila B, 4 GB; la base solo queda «lista» si Docker respondió | Antes una corrida sin S2 o con otra semilla entraba a la tabla como válida, y el marcador de la base se imprimía aunque la instalación de Docker fallara. |

## 11. Amenazas a la validez (se declaran en el informe)

Un solo anfitrión (un computador de uso general) y red virtual local: no hay red real entre el generador y la plataforma. Configuración por omisión: un
referente afinado por un experto puede rendir distinto (la fila B lo acota solo a lo que su guía prescribe). Una sola forma de carga, dos
escenarios cortos: 20 y 15 minutos no ejercitan compresión, retención ni el llenado del heap a largo plazo. Versiones de una fecha. El
generador y los guiones los escribió el autor de una de las plataformas (mitigación: protocolo congelado antes, guiones y datos crudos
publicados, formato nativo de cada una). La propia paga TLS y ThingsBoard no (cada una con el transporte de su despliegue por omisión). La
cola en memoria de ThingsBoard pierde lo confirmado si su proceso se reinicia: es su configuración por omisión y se declara. La sobrecarga
de la máquina virtual es la misma para todas. El máximo de memoria muestreado cada segundo es una cota inferior. Las consultas de la medición (la sonda de «lista», el conteo estable y
la lectura final de lo guardado) corren dentro del contenedor de la base de cada plataforma y cuentan en su pico de memoria por
contenedor, que es de toda la vida del contenedor: ese pico es descriptivo y no se compara entre plataformas; la memoria de cada
escenario se toma de su ventana, donde no hay consultas. La consulta de historial de S2 no pide el mismo rango en las dos (la propia,
su rango por omisión; ThingsBoard, 24 h con tope de 10 000 puntos) y la de la propia incluye el apretón TLS: su tiempo es descriptivo. Corridas en paralelo con
núcleos fijados distintos: comparten la memoria caché y el bus del anfitrión. No se mide amplitud de funciones.

## 12. Comprobaciones antes de la primera corrida válida

1. Perfil de inquilino por omisión de ThingsBoard sin límites de transporte (`/api/tenantProfiles`, por GET, en la versión fijada) y sin límite
   por dirección.
2. Tope por dirección del proxy propio resuelto igual para todas (§3.3).
3. OpenRemote: entrada por `localhost` con su CA, `storeDataPoints` en los dos atributos y un dato que llega a `asset_datapoint`.
4. Hora de la máquina frente a la del anfitrión < 1 s al empezar (`corrida.sh` la mide y se detiene si no se cumple).
5. Los 100 dispositivos y la sonda dados de alta dentro de la instantánea; versiones y digests anotados.
6. Contador plantado (§5.6).
7. Contadores de memoria y reinicios en cero al empezar; temporizadores de apt y snapd apagados; disco libre ≥ 5 GB. `corrida.sh` los
   anota en `previas.txt` y no detiene la corrida por ellos: se leen a mano antes de dar por válida la primera.
8. Anfitrión sin otras corridas largas durante la medición, enchufado y sin suspensión.

El resultado de cada una en el piloto queda en el registro del piloto; la primera corrida válida exige las ocho en verde.

## 13. Lo que se recorta, declarado

- De TT-40 se recorta la comparación de **alerta y exportación** (pasos para una alerta, exportación de datos): no cabe en el plazo con el
  método de §3, y contada a mano por el autor no sería imparcial (la regla 3 de `docs/09 §2` pedía un tercero). Se mantiene descriptiva la
  de alta (P5).
- El tamaño de **8 GB** solo se mide si algo falla en 4 GB. Las repeticiones en 4 GB, una por combinación.
- **Magistrala** queda sujeta a la comprobación de 30 minutos (§2).
