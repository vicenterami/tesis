# Informe de pruebas (Etapa 3 — preliminar, 07/10/2026)

Cubre las **pruebas iniciales** de la Etapa 3 (`docs/04`, rúbrica 30 %): el emulador de nodos (TT-28), la prueba de
carga (TT-29) y las pruebas de carrera, contrastadas con RNF-01, RNF-02, RNF-03 y RNF-17 (`docs/02`). Es preliminar:
corre en un portátil, sin TLS ni proxy y con un broker sin credenciales (§1); los valores son sintéticos. Lo que no
cubría al escribirse se agregó después: TT-32 (sensor físico) en §43, §44 y §53, y TT-30 (recuperación ante reinicio) en §11. El
contrato de trama (TT-27) tiene su matriz desde el 15/11/2026 (§73). Hoy son 919 pruebas unitarias del backend y 583 del panel.
Todo lo de aquí se repite con dos comandos (§8).

## 1. Banco de pruebas desechable

Una segunda pila Compose, proyecto `banco`, montada sobre el **mismo** `docker-compose.yml` con un archivo que lo
suma (`plataforma/pruebas/banco/compose.banco.yml`): mismas imágenes, mismas migraciones, mismos techos de memoria y
CPU que en producción (backend 512 MB / 0,5 CPU; base 768 MB / 1 CPU; broker 256 MB / 0,5 CPU). Diferencias
deliberadas, y solo ahí:

| Diferencia | Por qué |
|---|---|
| Broker sin credenciales ni ACL (`pruebas/banco/mosquitto/mosquitto.conf`) | Cien dispositivos emulados no justifican cien claves reales; escribir claves del broker es tarea de la persona (`docs/11 §7`). La ACL se prueba aparte (`docs/11 §5`). El tope de 64 KiB por mensaje sí se mantiene. |
| Datos en `tmpfs` (RAM) | Nada sobrevive a `apagar`: no hay volúmenes que borrar ni datos que confundir con los de desarrollo. |
| Puertos 127.0.0.1:3001, :1884, :5433 | Convive con la pila de desarrollo (3000, 1883, 5432). |
| `SUPERVISION_INTERVALO_S=5` | Los emulados reportan cada 1–3 s; con 60 s el silencio tardaría minutos en verse. |

Las credenciales del banco son de descarte: se generan en cada `encender`, viven fuera del repositorio y el broker
del banco no las verifica.

## 2. Emulador de nodos (TT-28)

`plataforma/backend/src/emulador/` hace de N dispositivos MQTT a la vez, con el tráfico irregular que pide
`docs/10 §9.6`. El modelo (`modelo.ts`, funciones puras con 9 casos de prueba propios) es determinista a partir de una
semilla: la misma corrida se repite.

| Parámetro (valor usado) | Qué reproduce |
|---|---|
| Periodo por nodo entre 0,5× y 1,5× del nominal (2 s), con fase inicial propia | Dispositivos con periodos distintos y no sincronizados |
| Jitter ± 0,3 s sobre cada periodo | Latencia variable |
| Pérdida 1 % | Tramas que no llegan |
| Deriva ± 20 ms por periodo en el reloj del nodo | Relojes que derivan (la deriva se mide en la base: `recibido_en − tiempo`) |
| 10 % de los nodos con caídas: cada 20–40 periodos, 3–7 periodos sin cobertura, y después descarga su cola en ráfaga con las marcas originales | Nodo que vuelve y envía lo acumulado |
| Dos nodos con reloj roto (uno en 1970, otro una hora en el futuro) | La regla 7 de `docs/13` debe descartar la marca (`origen_tiempo = recepcion`) |
| 1 de cada 10 nodos «caliente»: su temperatura oscila alrededor del umbral alto (30 Cel) | Condiciones de umbral que abren y cierran bajo carga |

Cada nodo publica un pack SenML (`bn`, `bt`, temperatura y humedad) con QoS 1 en `sitio/banco/dispositivo/<id>/temperatura`
y anota cuándo salió cada lectura y cuándo el broker la confirmó (PUBACK). Al terminar deja un CSV que
`pruebas/banco/evaluar.sql` cruza con la base: cada lectura publicada con marca plausible debe estar en `medicion`
exactamente una vez. El emulador también lee `$SYS/broker/#` para ver la cola y los descartes del broker.

## 3. Corridas

| Medida | Corrida 1: 100 nodos, 60 s | Corrida 2: 120 nodos, 90 s | Corrida 3: igual que la 2, **con la decisión 4** |
|---|---|---|---|
| Tramas publicadas | 3 023 | 5 548 | 5 548 |
| Tasa media / pico (tramas por segundo) | 48,1 / 63 | **59,7 / 74** | 59,7 / 81 |
| Lecturas publicadas (2 por trama) | 6 046 | 11 096 | 11 096 |
| Lecturas guardadas con marca plausible / **perdidas** | 5 948 / **0** | 10 944 / **0** | 10 944 / **0** |
| Lecturas de los dos relojes rotos, guardadas con `origen_tiempo = recepcion` | 98 / 98 | 152 / 152 | 152 / 152 |
| Sin PUBACK · descartes del broker · cola máxima del broker | 0 · 0 · 52 | 0 · 0 · 52 | 0 · 0 · 52 |
| PUBACK p50 / p95 / máx (ms) | 0 / 1 / 4 | 0 / 1 / 3 | 0 / 1 / 3 |
| Latencia envío → recepción en el backend p50 / p95 / máx (ms) | 0 / 1 / 33 | 0 / 1 / 20 | 0 / 3 / 39 |
| Deriva medida p95 (ms), solo marcas aceptadas | 452 | 670 | 756 |
| Tramas crudas guardadas (`trama`) | 3 029 (incluye 6 de la carrera) | 5 548 | 5 548 (ni una duplicada) |
| Filas en cuarentena | 0 | 0 | 0 |
| Condiciones `sin_comunicacion` en nodos con caída (verdaderas) / sin caída (**falsas**) | 3 / **52** | 4 / **126** | 18 / **108** |
| Condiciones de umbral abiertas (nodos calientes); máximo abiertas a la vez por dispositivo | 11; 1 | 15; 1 | 12; 1 |
| Errores del backend durante la corrida | 0 | 0 | 0 |
| Memoria a mitad de corrida: backend / base / broker (MiB) | 52 / 90 / 3 | 53 / 118 / 3 | 53 / 103 / 4 |
| CPU a mitad de corrida: backend / base / broker | 5 % / 10 % / 0,7 % | 5 % / 17 % / 0,7 % | 6 % / 10 % / 0,8 % |

La corrida 2 se hizo sobre la misma base que la 1 (sin reiniciar el banco) y sus condiciones se restaron a mano; la 3,
en un banco nuevo, con el evaluador que cuenta solo lo ocurrido desde el inicio de la corrida (condiciones, tramas,
cuarentena, eventos). Las corridas 2 y 3 usan la misma semilla: el tráfico es el mismo, cambia cómo lo procesa el backend
(en paralelo antes, de a uno después). El precio de procesar de a uno se ve en la latencia (p95 de 1 a 3 ms) y en nada más.

## 4. Pruebas de carrera

Veinte (a) y cinco (b) mensajes se publican seguidos por la **misma conexión**: llegan al backend en el mismo
milisegundo. Hasta el 07/10 el pipeline los procesaba a la vez (el evento `message` de la librería no espera a nadie);
desde la decisión 4 (`docs/10 §8.4` punto 4) corren dentro de `handleMessage`, uno a la vez, y el PUBACK sale al terminar.

| Prueba | Esperado | Antes del arreglo | Después |
|---|---|---|---|
| (a) La misma lectura ×20 (reentrega QoS 1 extrema) | 1 fila por canal | ✅ 1 fila por canal (índice único `(canal, tiempo)` + `ON CONFLICT`) | ✅ |
| (a) … y una sola trama cruda | 1 | ❌ 2: con procesamiento concurrente, dos copias distintas «ganan» un canal cada una y las dos guardan su trama | ✅ 1 con la decisión 4 (quedó roja a propósito hasta implementarla, como su prueba de aceptación) |
| (b) Cinco lecturas sobre el umbral a la vez | 5 mediciones, **1** condición, 5 tramas, 0 errores | ❌ 1 condición (el índice único parcial aguantó), pero el mensaje que perdió la carrera rompió con 23505 y **abortó a mitad del pipeline**: sin trama cruda ni filtro 6; `manejador falló` en el registro | ✅ todo: el `INSERT` de la condición lleva `ON CONFLICT … DO NOTHING` y «0 filas» se lee como «otra trama la abrió un instante antes» (alertas y supervisión) |

El arreglo tiene prueba unitaria en `alertas.service.spec.ts` y `supervision.service.spec.ts`; quitarle el
`ON CONFLICT` al código hace caer la prueba (comprobado).

## 5. Resultado frente a los requisitos

| Requisito | Resultado preliminar | Observación |
|---|---|---|
| RNF-01: ≥ 50 tramas/s sin pérdida | ✅ 59,7 tramas/s sostenidas 90 s (119 lecturas/s), pico 74/s, 0 perdidas | En el portátil; la cola del broker nunca pasó de 52 mensajes |
| RNF-02: disponible para consulta ≤ 2 s (p95) | ✅ p95 de recepción 1 ms en paralelo, 3 ms de a uno; la confirmación (COMMIT) va a milisegundos de `recibido_en` | Sin red real ni TLS: en el servidor hay que repetirla |
| RNF-03: detectar la pérdida de supervisión en ≤ 2 intervalos | ✅ detecta las caídas (3, 4 y 18 verdaderas) **pero con 52, 126 y 108 alarmas falsas** cuando el intervalo esperado se declara igual al periodo; con `intervalo = 2 × periodo` (corrida 4): 5 verdaderas y **3 falsas** | Ver §6.1: es cómo se declara el intervalo, no un error de código |
| RNF-17: ≤ 2 GB de RAM | ✅ 174 MiB en total bajo carga (backend 53, base 118, broker 3) | Con los techos de producción activos |

## 6. Hallazgos y decisiones que abre

1. **Falsos positivos de silencio (RF-24, RNF-03).** El supervisor abre `sin_comunicacion` cuando el silencio
   supera 2 × `intervalo_esperado_s`. Con periodos de 1–3 s redondeados hacia arriba, jitter de ± 0,3 s y **1 % de
   pérdida, una sola trama perdida ya supera los dos intervalos**: en la corrida 2 hubo 126 alarmas falsas por 59
   pérdidas emuladas. Todas se cierran solas con la trama siguiente, pero cada una deja dos eventos y, cuando exista
   el panel, una alerta que parpadea. Opciones: (a) factor 3 (haría falta perder dos tramas seguidas, probabilidad
   ≈ 1 en 10 000 con 1 % de pérdida), que relaja RNF-03; (b) tolerancia configurable por dispositivo (`docs/10 §9.6`
   ya lo anota como pendiente); (c) mantener 2 intervalos y mostrar la alarma solo si dura más de un barrido. Lo
   decide el estudiante con el profesor guía porque toca un requisito no funcional.
   **Medido después (corrida 4: mismo tráfico y semilla, `intervalo_esperado_s = 2 × periodo`): 5 caídas detectadas y 3
   alarmas falsas**, sin tocar el código ni RNF-03. El intervalo esperado debe declararse como el silencio normal del
   dispositivo (periodo más las pérdidas que admite el medio), no como su periodo. **Decidido así el 07/10/2026**
   (`docs/10 §8.4` punto 23; migración 10 fija la semántica en la base; la semilla del banco usa 2 × periodo por defecto).
2. **Trama cruda duplicada ante duplicados concurrentes** (§4): consecuencia del procesamiento en paralelo. La
   decisión 4 (`docs/10 §8.4`: un mensaje a la vez y PUBACK después del COMMIT), implementada el mismo día, la eliminó:
   su prueba de aceptación (`banco.sh carrera`, comprobación (a) de la trama) pasó y la corrida 3 guardó exactamente una
   trama por mensaje. Si la base no responde, el mensaje se reintenta (1, 2, 4 y 8 s) y, agotados los reintentos, no se
   confirma y el cliente reconecta para que el broker lo reenvíe (probado con cliente falso en `broker.service.spec.ts`).
3. **Carrera al abrir condiciones**: corregida (§4). La guarda real es el índice único parcial; el código ya no
   depende de leer antes de escribir.
4. **Deriva de reloj medible**: la columna `recibido_en` (migración 08) permite ver la deriva por dispositivo
   (p95 670 ms con la deriva emulada): es el dato para la vista de salud (RF-47).

## 7. Limitaciones de esta medición

Portátil, no el servidor de referencia (`docs/09`); sin TLS, sin proxy, broker sin autenticación (§1); 60 y 90 s, no
horas; un solo proceso emulador (Node) para todos los nodos, así que sus latencias incluyen las de la máquina; la
base del banco no se reinició entre corridas; el supervisor corrió cada 5 s (en producción, 60).

## 8. Cómo repetirlo

```
bash plataforma/pruebas/banco/banco.sh encender 120     # pila aparte, 120 emulados
bash plataforma/pruebas/banco/banco.sh carrera          # pruebas de carrera (las seis comprobaciones en verde desde el 07/10)
bash plataforma/pruebas/banco/banco.sh correr --duracion 90 --dispositivos 120
bash plataforma/pruebas/banco/banco.sh proxy                 # TLS de punta a punta (§9)
bash plataforma/pruebas/banco/banco.sh apagar
```
Opciones del tráfico (`--periodo`, `--jitter`, `--perdida`, `--deriva`, `--caidas`, `--semilla`) en la cabecera de
`plataforma/backend/src/emulador/emulador.ts`.

## 9. TLS de punta a punta con el proxy (07/10/2026)

La capa `plataforma/proxy/` (nginx `1.30.5-alpine`, variante A de `docs/10 §8.4` punto 10) se levantó sobre el banco con
una CA de desarrollo (`proxy/ca-desarrollo.sh`, fuera del repositorio) y se probó lo bueno y lo malo (`banco.sh proxy`):

| Comprobación | Resultado |
|---|---|
| HTTPS 8443 → backend (`/salud`), cliente que confía en la CA | ✅ responde el backend |
| HSTS en la respuesta (lo pone el proxy, no el backend) | ✅ |
| Cliente **sin** la CA | ✅ rechaza el certificado |
| MQTT sobre TLS 8884 → broker → pipeline (`mosquitto_pub --cafile`) | ✅ la lectura queda en `medicion` |
| Conexión **sin** TLS al 8883 | ✅ rechazada |
| Registro del proxy | una línea JSON por petición y por conexión, con la IP real del cliente |

Lo que esta prueba no cubre: el certificado real del servidor (por decidir, `docs/10 §8.4` punto 22), el límite de tasa (`docs/11 §4`) y la
exposición a la red (por defecto el proxy escucha solo en 127.0.0.1; desde el 12/10, una interfaz por tipo de cliente y solo el nombre
público: §15).

## 10. Capacidad, picos y saturación (08/10/2026)

Guion: `pruebas/banco/capacidad.sh` (modos `carga`, `combinada` y `techo`), sobre el mismo banco, con el proxy y los techos
de `docs/10 §6` (el del proxy ya en 100M). El dato decisivo es el contador del broker `$SYS/broker/publish/messages/dropped`:
cuando el backend se atrasa, la cola de su sesión (`max_queued_messages`, 1000 por omisión, `docs/10 §4.1`) se llena y lo que
sobra **se descarta sin aviso al emisor** (el emisor recibió su PUBACK).

| Corrida | Tráfico | Tramas | Descartadas por el broker | Lecturas no guardadas | p95 |
|---|---|---|---|---|---|
| Sostenida | 100 disp. cada 2 s, 60 s | 3 020 (48/s, pico 62) | — | 0 | 3 ms |
| Pico | 400 disp. cada 1 s, 30 s | 12 918 guardadas (≈ 409/s) | 0 | 0 | 69 ms |
| Techo | 800 disp. cada 1 s, 30 s | 25 763 (815/s, pico 894) | 10 169 | 20 296 | 2 215 ms |
| Combinada (dos veces) | pico de 400 + ≈ 10 000 peticiones HTTPS a `/salud` + 3 tormentas de reconexión TLS | 9 925–10 173 guardadas | 2 738 y 2 986 | 5 462 y 5 880 | 3,5–3,7 s |

Memoria y CPU máximas por contenedor (primera corrida exploratoria, con el pico combinado; el modo `carga` las repite sin el
tráfico HTTPS): base 223 MiB y 95 % de su CPU (techo 768M,
1 CPU); backend 62 MiB y 48 % (512M, 0,5); proxy 30 MiB y 53 % (100M, 0,5); broker 9 MiB. Suma 324 MiB frente a 1,6 GB de
techos; ningún contenedor muerto por memoria ni reiniciado.

**Lo que muestran.** (1) En este equipo y con estos techos el pipeline procesa **unas 490 tramas/s** (15 594 guardadas en la
corrida techo); hasta 409/s no se pierde nada. (2) Por encima, la cola de 1000 mensajes se llena en unos 2 s y la pérdida es
silenciosa: solo la delata el contador `$SYS`. (3) El límite es **CPU, no memoria**: la base llega a su núcleo. (4) Un ataque
que no trae ni una trama, solo peticiones a `/salud` (cada una consulta la base), le quita a la recepción la CPU que necesita y
provoca pérdida con un tráfico de datos que sin el ataque se procesaba entero. Para dimensionar: el campus son 0,17 tramas/s y
el piloto de terreno, menos; el margen es de miles de veces en tasa media, y el riesgo real son las **ráfagas** (todos a la
vez, o una pasarela que vacía de golpe lo que guardó durante un corte, `docs/10 §8.4` punto 2) y los **ataques**.

**Lo que abre (diseño antes que código):** límite de tasa y de conexiones por IP en el proxy y un `/salud` público que no
consulte la base; topes de cola explícitos y dimensionados (`max_queued_messages`, `max_queued_bytes`) con alarma sobre el
contador de descartes; inserción por lotes si hiciera falta más capacidad. Limitaciones: el emulador corre en el
mismo equipo de desarrollo que la pila; el broker del banco va sin credenciales ni persistencia; el servidor real tendrá otra CPU.

## 11. Caídas con carga en curso (TT-30 adelantado, 08/10/2026)

Guion: `pruebas/banco/caidas.sh`. Veinte dispositivos reportan cada 1 s (20 tramas/s, bajo la cola de 1000 del broker, para probar
la red de seguridad y no el límite de §10). A los 15 s se provoca la falla; la pérdida se evalúa 30 s después de terminar, para
no confundir atraso con pérdida.

| Falla provocada | Lecturas perdidas | Qué la cubrió | Vuelta |
|---|---|---|---|
| Backend detenido 20 s | **0** | El broker guardó la cola de la sesión persistente (QoS 1) y la entregó al volver | `/salud` en 1 s |
| Base congelada 15 s (`docker pause`) | **0** | Reintentos del pipeline (1, 2, 4 y 8 s) y reenvío del broker de lo no confirmado | inmediata |
| Broker reiniciado (en el banco, **sin persistencia**) | **84** (≈ 2 s de tráfico) | Nada: lo que estaba en la cola del broker se perdió; emulador y backend reconectaron solos | inmediata |

Ningún contenedor murió por memoria ni tuvo reinicios no pedidos. **Cuidado al leer el contador de descartes del broker:** se
reinicia con el broker, así que después de un reinicio «0 descartes» no prueba nada; la pérdida la midió el evaluador.

**Lo que falta probar:** el broker de producción (con persistencia y guardado cada 1800 s en esa fecha; 300 s desde el 13/10): un reinicio ordenado guarda la cola
al cerrar, una muerte brusca pierde lo encolado desde el último guardado (`docs/10 §4.1`); la caída del proxy; la del servidor
completo; y la caída del backend con más tráfico que la cola (§10 dice que ahí se descarta).

## 12. Seguridad de dependencias e imágenes (08/10/2026)

**Por qué.** La verificación automática quedó en rojo desde el 07/10 con el mismo lockfile que había pasado el 27/09: la base
de avisos de GitHub publicó en esos días avisos contra paquetes que ya estaban: `proxy-addr`, crítico
(https://github.com/advisories/GHSA-jqcg-44mw-7w3h); `brace-expansion` (https://github.com/advisories/GHSA-qhr7-859c-m2p7,
https://github.com/advisories/GHSA-6j4f-fj2g-mc7p y https://github.com/advisories/GHSA-q2hr-2g5m-vwhr, que fija las versiones
1.1.21, 2.1.7 y 5.0.12); `braces` (https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

**Dependencias (`pnpm audit`).** De 16 avisos (1 crítico, 7 altos, 8 moderados) a 2, con ocho *overrides* nuevos; las 78
pruebas unitarias de ese día siguen en verde y las licencias de producción no cambiaron (152 paquetes permisivos, paso 2r del guardián).
Los dos que quedan no tienen versión corregida publicada y solo vienen con jest: `braces` (alto; excepción declarada en
`audit.ignore`) y `sprintf-js` (moderado, https://github.com/advisories/GHSA-hp3w-g68c-fv3c). Las dependencias de producción no
tienen ningún aviso, ni siquiera exceptuado (el CI lo comprueba aparte).

**Imágenes** (Trivy 0.74.0 fijado por digest; base de avisos del 08/10/2026; `plataforma/pruebas/escanear-imagenes.sh`).
Vulnerabilidades críticas / altas:

| Imagen | Antes | Después | Qué se hizo |
|---|---|---|---|
| backend | 6 / 67 | 0 / 43 | Base `node:22.23.3-trixie-slim` (Debian 13); sin npm, npx, corepack ni Yarn en la imagen final. Las 43 altas no tienen corrección publicada en Debian |
| broker | 0 / 2 | 0 / 0 | La misma `eclipse-mosquitto:2.0.22`, reconstruida por su autor con OpenSSL corregido (08/10; hoy 2.1.2-alpine, §20) |
| proxy | 0 / 3 | 0 / 0 | `nginx:1.30.5-alpine` más parches de Alpine (`plataforma/proxy/Dockerfile`) |
| base | 7 / 100 | 1 / 21 | `timescale/timescaledb:2.24.0-pg16-oss` → `2.30.2-pg16-oss` más parches de Alpine, y sin `timescaledb-parallel-copy` ni `timescaledb-tune`, que el sistema no ejecuta (`plataforma/db/imagen/Dockerfile`). Queda `gosu`, que el arranque usa para bajar privilegios y no recibe datos de afuera |

**Que siga funcionando.** Antes de tocar la base de desarrollo, el banco se levantó desde cero con las imágenes nuevas: todas
las migraciones, las seis pruebas de carrera, TLS de punta a punta (`banco.sh proxy`) y una carga de 60 s con 100 nodos (48
tramas/s, pico 65) sin pérdidas y con p95 de 3 ms. Hubo 6 alarmas de silencio falsas; la corrida 4 (§6) dio 3, pero no son
comparables (otra duración y otra semilla). La base de desarrollo se actualizó con respaldo del volumen y
`ALTER EXTENSION timescaledb UPDATE`, y el conteo de cada tabla quedó idéntico. Guardián completo en verde.

**Cómo repetirlo:** `bash plataforma/pruebas/escanear-imagenes.sh` (construye con `--pull --no-cache` y sale 1 si queda algo
con versión corregida publicada fuera de los residuos documentados).

**Escaneo del 22/10/2026** (tras el parche de seguridad de Node del 21/10: `node:22.23.3` → `22.23.4-trixie-slim`, digest nuevo en las dos
etapas del Dockerfile; mismo guion, bases frescas con `--pull --no-cache`):

| Imagen | Críticas / altas | Con corrección publicada | Qué se hizo |
|---|---|---|---|
| backend | 0 / 43 | 0 | Node 22.23.4 (`node --version` en el contenedor reconstruido); las 43 altas siguen sin corrección en Debian 13 |
| proxy | 0 / 0 | 0 | `libx11` (1.8.13 → 1.8.14) se sumó a la lista de parches de Alpine, y las tres altas de nginx (CVE-2026-15176, -93479, -97205; 1.30.5 → 1.30.6) no se parchan con `apk` (el paquete oficial viene del repositorio de nginx, no del de Alpine): el `FROM` subió a `nginx:1.30.6-alpine`, publicada el mismo 22/10 (decisión del día: un parche de seguridad del propio servidor no espera los 7 días de la cadena de suministro; se fija por digest y se escanea antes de usarla) |
| base | 1 / 25 | 0 | `libexpat` (2.8.5 → 2.9.0) se sumó a la lista de parches; lo que queda está en `gosu` (binario de Go precompilado, residuo documentado en `docs/11 §4`) |
| broker | 0 / 0 | 0 | sin cambios |

**Escaneo del 09/11/2026** (el servidor de prueba dio «HAY QUE ACTUAR»; mismo guion, Trivy 0.74.0, bases frescas con `--pull --no-cache`).
Críticas / altas y, entre paréntesis, cuántas con versión corregida publicada fuera de los residuos:

| Imagen | Antes | Después | Qué se hizo |
|---|---|---|---|
| broker | 1 / 3 (4) | 0 / 0 (0) | `brotli-libs` 1.2.0 → 1.2.1 (CVE-2026-111497, crítica), `musl`/`musl-utils` 1.2.5-r23 → r24 (CVE-2026-107891) y `zlib` 1.3.2-r0 → r1 (CVE-2026-85091): huella nueva de `eclipse-mosquitto:2.1.2-alpine` que propone el PR #17 de Dependabot (`sha256:860aeb5d…`, construida el 23/10, Alpine 3.23.7); sigue siendo Mosquitto 2.1.2 |
| backend | 0 / 50 (4) | 0 / 46 (0) | `apt`/`libapt-pkg7.0` 3.0.3 → 3.0.4 (CVE-2026-109518): digest de la reconstrucción de `node:22.23.4-trixie-slim` del 05/11 en las dos etapas; `zlib1g` → `1:1.3.dfsg+really1.3.1-1+deb13u1` (CVE-2026-76844, CVE-2026-85091), que esa imagen aún no trae: `apt-get install --only-upgrade zlib1g` en la etapa final. Las 46 altas que quedan no tienen corrección publicada en Debian 13 (`docs/11 §4`) |
| proxy | 1 / 2 (3) | 0 / 0 (0) | `brotli-libs` 1.2.0 → 1.2.1 (CVE-2026-111497, crítica) y `curl`/`libcurl` 8.22.0 → 8.23.0 (CVE-2026-92392): sumadas a la lista de `apk upgrade` y el `FROM` a la reconstrucción de `nginx:1.30.6-alpine` del 05/11 (`sha256:583b7f2f…`), que ya las trae |
| base | 1 / 27 (2) | 1 / 25 (0) | `musl`/`musl-utils` 1.2.5-r23 → r24 (CVE-2026-107891) sumadas a la lista de `apk upgrade`; sin cambiar TimescaleDB (2.30.2). Las 26 que quedan están en `gosu` (residuo documentado) |

Toda huella nueva tiene más de 24 h publicada y va fijada por digest de índice; las versiones se comprobaron dentro de las imágenes
construidas (`dpkg-query`, `apk list -I`). Resultado: `OK    4 imágenes: ninguna vulnerabilidad alta o crítica con versión corregida
publicada fuera de los residuos documentados`; la pila de desarrollo se recreó con las cuatro imágenes y quedó sana.

**Escaneo del 13/11/2026** (el guion dio «HAY QUE ACTUAR»; Trivy 0.74.0, bases frescas con `--pull --no-cache`). Críticas / altas y, entre
paréntesis, cuántas con versión corregida publicada fuera de los residuos. El «antes» de la base y del proxy sale de escanear, el mismo
día y con la misma base de avisos, las imágenes construidas con los Dockerfile anteriores; el broker y el backend no cambiaron:

| Imagen | Antes | Después | Qué se hizo |
|---|---|---|---|
| broker | 0 / 0 (0) | 0 / 0 (0) | Nada: imagen sin cambios |
| backend | 0 / 46 (0) | 0 / 46 (0) | Nada: las 46 altas de Debian 13 (`util-linux` y su familia, `libsqlite3-0`, …) siguen sin versión corregida publicada (`docs/11 §4`) |
| proxy | 0 / 3 (3) | 0 / 0 (0) | `libxslt` 1.1.43-r3 → r4 (3 altas), sumada a la lista de `apk upgrade` |
| base | 1 / 196 (171) | 1 / 25 (0) | Fuera la copia sin uso de PostgreSQL y de Python que arrastraba `postgresql16-plpython3` (14 paquetes; `postgresql16`, `postgresql16-client` y `postgresql16-plpython3` 16.15-r0, con corrección en 16.16-r0, y `libpq` 18.6-r0, en 18.7-r0: 38 altas cada uno, los mismos 38 avisos), con las cuatro bibliotecas y los ocho archivos de extensión de PL/Python de `/usr/local`; `krb5-libs` 1.22.1-r0 → 1.22.3-r0 (16 altas) y `libxslt` 1.1.43-r3 → r4 (3 altas), que sí usa el servidor. Las 26 que quedan están en `gosu` (residuo documentado; la crítica, CVE-2025-68121, es de `crypto/tls`) |

**Que siga funcionando.** En contenedores desechables, la imagen nueva de la base frente a la construida con el Dockerfile anterior: el
registro de arranque trae las mismas líneas (salvo tiempos y el orden de dos de ellas); crea la extensión TimescaleDB 2.30.2 y una
hipertabla, `pgcrypto` calcula un SHA-256, `pg_dump` y `pg_restore -l` funcionan, los lenguajes instalados son los mismos (`c`,
`internal`, `plpgsql`, `sql`) y `CREATE EXTENSION plpython3u` responde «is not available» en vez de fallar al cargar. Pesa 11,6 MB menos
(446,7 → 435,0 MB). Dentro de ella: ninguno de los 14 paquetes, `krb5-libs` 1.22.3-r0 y `libxslt` 1.1.43-r4; `pg_dump` enlaza con
`/usr/local/lib/libpq.so.5`. La pila de desarrollo se recreó con las imágenes nuevas (`pila.sh encender`): la base conservó sus datos y su
extensión.

**El servidor PostgreSQL que el escáner no ve.** Trivy lee los paquetes del sistema, no el servidor compilado en `/usr/local`: hoy 16.15,
y la imagen oficial `postgres:16-alpine` ya trae 16.16, que ninguna imagen de TimescaleDB trae todavía (consultado el 13/11/2026: la
`2.30.2-pg16-oss`, la `2.31.0-pg16-oss` y la `latest-pg16-oss` dicen `PG_VERSION=16.15`; subir de versión no lo corrige). El guion suma
una comprobación propia después de la tabla, con su prueba sin red (`--probar-pg`: ocho casos plantados, los cuatro veredictos, el
orden 16.9 < 16.10 y dos versiones ilegibles, en verde; plantadas: sin `sort -V`, 1 en rojo; los veredictos de actuar y de aviso
cruzados, 4; sin validar la forma, 2). Hoy da el AVISO del riesgo aceptado transitorio de `docs/11 §4`. El guion exporta además `COMMIT`
antes de construir, como `pila.sh`: su reconstrucción dejaba la imagen del backend sin el commit que muestra «Acerca de».

Resultado: la tabla de arriba, `AVISO 26 en residuos documentados (docs/11 §4): usr/local/bin/gosu`, el AVISO del servidor PostgreSQL y
`OK    4 imágenes: ninguna vulnerabilidad alta o crítica con versión corregida publicada fuera de los residuos documentados` (salida 0).

**Dependencias, 25/10/2026.** Con el mismo lockfile que el 23/10 daba 0 avisos, la auditoría volvió a fallar (el PR agrupado de Dependabot
lo destapó en el CI): avisos publicados del 19 al 23/10 contra paquetes que ya estaban. Dos altos **en producción**, ambos de denegación
de servicio: `body-parser` < 2.4.0 (https://github.com/advisories/GHSA-27r3-jxmh-p828, cuerpo comprimido con bytes de sobra; alcanzable
por `POST /recepcion/{id_fisico}`) y `multer` < 2.5.0 (https://github.com/advisories/GHSA-q7qp-rjg7-q26m; el backend no recibe archivos,
pero `@nestjs/platform-express` 11.2.7 todavía fija `multer` 2.4.0). En desarrollo: `fast-uri` < 3.1.9 (cuatro, vía `@nestjs/cli`) y
`undici` < 8.12.2 (tres, vía `jsdom` del panel). Cuatro *overrides* (dos nuevos, `body-parser` y `undici`, y dos que suben de versión, `fast-uri` y `multer`) y un paquete
transitivo nuevo, `qs` 6.16.1, que pide `body-parser` 2.4.0; todas las versiones con más de 24 h publicadas (los parches, del 14 al 22/10).
Resultado: `pnpm audit` sin avisos (también `--prod`), 357 pruebas del backend y 107 del panel en verde.

## 13. Migración 11: vía, pasarela, estado y sitio (08/10/2026)

Se probó en bases desechables (contenedores de un solo uso, datos en RAM) antes de tocar la de desarrollo, y de punta a punta
en el banco.

| Prueba | Resultado |
|---|---|
| Base existente (migraciones 01–10 con datos) → 11 | El «visto» se traslada contado (1 antes, 1 después); el código del sitio se deriva del nombre y la semilla lo fija en `uct`; 16 tablas |
| Instalación nueva (01–11 seguidas) | 16 tablas, cero errores en el arranque |
| Repetir la migración | No duplica ni pisa: salta lo que existe y conserva el «visto» más reciente (convención de docs/08 §6) |
| Backend anterior tras migrar | Sigue escribiendo la columna vieja sin fallar: queda DEPRECADA, no se borra |
| Reglas plantadas | Rechaza: pasarela con el identificador de un dispositivo (y al revés), nodo LoRaWAN sin pasarela, identificador fuera de `[a-z0-9-]`, código de sitio y vía inválidos. Acepta los casos legítimos |
| Dos altas simultáneas con el mismo identificador (dispositivo y pasarela) | La segunda espera a la primera y se rechaza: queda una sola fila |
| Banco, 20 nodos emulados, 20 s | 420 tramas, 0 lecturas perdidas, p95 de 3 ms; `estado_dispositivo` con una fila por nodo |
| Migración 12 (el CHECK de motivos de cuarentena con el nombre de la convención) | Renombra en la tabla y en sus fragmentos (TimescaleDB lo propaga); repetible; la regla sigue rechazando un motivo inventado |
| Comprobaciones nuevas del guardián: convenciones (1b) e identidad (1c) | 7 y 7 OK en la base de desarrollo (09/10); fallan al plantar una restricción sin prefijo o al quitar el disparador de identidad; la de identidad no deja nada en la base: termina en ROLLBACK y, desde el 09/10, lo comprueba (con COMMIT plantado sale FALLA) |
| Repetir las migraciones 07, 09 y 12 (instalación nueva y base anterior a la 12, desechables, 09/10) | La regla de los motivos de cuarentena queda una sola vez, con el nombre de la convención y la lista vigente; repetirlas no la duplica, no la estrecha ni pisa su comentario. Antes, repetir la 09 la duplicaba con el nombre viejo y repetir la 07 intentaba volver a la lista vieja |
| Convenciones de índices, disparadores, funciones y tipos (paso 1b, desde el 09/10) | En la base, 1 índice, 1 disparador y 3 funciones sin prefijo, escritos como excepciones con su origen; los tipos cumplen. Plantados un índice, un disparador, una función y columnas `varchar` y `timestamp` en una transacción que se deshace: las cuatro comprobaciones fallan |
| Chequeo previo de la migración 11 | Con un identificador fuera de la lista blanca o un sitio cuyo código derivado no sirve, se detiene antes de tocar nada y dice cuáles son |
| Trama con el sitio de otra sede (`sitio/otra-sede/…`) | Cuarentena `no_registrado`: «emu-0001 está registrado en el sitio «banco», no en «otra-sede»» |

**Lo que destapó:** la imagen de la base, levantada sola sin el compose, se caía al arrancar porque su guion de inicio llamaba
a `timescaledb-tune`, que se había quitado por seguridad; se quitó también el guion (`db/imagen/Dockerfile`).

## 14. Canal de tiempo real (TT-39, 09/10/2026)

`GET /eventos` (`docs/10 §5`). 31 pruebas en `eventos.spec.ts` (`backend/src/tiempo-real/`; eran 22 cuando se escribió esta sección: la sesión sumó tres, §58, el `sitio_id` de los avisos una, §66, y el mapa puesto al día con el latido otra, también §66); las del bloque «GET /eventos
por HTTP» abren HTTP real en 127.0.0.1 con un puerto libre; más las del pipeline, las alertas y el supervisor sobre lo que cada uno anuncia.

| Prueba | Resultado |
|---|---|
| Qué recibe cada flujo | Sin filtro, todo; con `?dispositivo=`, solo lo suyo; con `?canal=`, solo las mediciones de ese canal |
| Qué anuncia el pipeline | Lectura guardada → `medicion` con la marca de tiempo que puso la base, y después `visto`; lectura repetida → solo `visto`; trama en cuarentena → solo `visto`; no registrado o dado de baja → nada |
| Condiciones | Umbral y sin comunicación: un aviso al abrir y otro al cerrar; ninguno si otra trama u otro barrido la abrió o la cerró un instante antes. La guarda del cierre de umbral se agregó el 09/10: sin ella, dos lecturas que volvían a rango a la vez movían la hora de cierre y repetían el evento y el aviso |
| Origen | `Origin` de otro sitio o `null` → 403, sin ocupar cupo; sin `Origin` pero `Sec-Fetch-Site: cross-site` (una imagen o un `fetch` «no-cors» de otro sitio) → 403; `same-site` → rechazo; mismo host y puerto, `same-origin` o `none` → 200; sin ninguna de las dos (el propio panel, curl) → 200 |
| Cupo | Con 50 flujos abiertos → 503; al cerrarse uno, vuelve a admitir; un flujo pedido que nunca se abrió no cuenta |
| Latido | Uno cada 25 s aunque no haya mediciones |
| Apagado, en los dos sentidos | Con un flujo abierto, el cierre tarda milisegundos porque se cortan solo las conexiones del canal; sin eso, espera a que el navegador se vaya y la prueba falla por tiempo. Con una petición normal en curso, esta termina y responde antes del cierre. El primer arreglo, cortar todas las conexiones (`forceCloseConnections`), también la cortaba («socket hang up»): se descartó al probar este sentido. Con keep-alive, Node además espera a que venza la conexión ociosa: medido a mano el 09/10 con un servidor Node 22 mínimo: respuesta a los 309 ms y cierre a los 4314 ms, dentro de los 10 s de Docker |
| nginx: `$host` frente a `$http_host` (contenedor desechable, HTTP/2 y HTTP/1.1) | `$host` quita el puerto (`localhost`); `$http_host` lo conserva (`localhost:18443`). Con el `nginx.conf` del repositorio, el backend recibe `localhost:18443` |
| Prueba de humo (`api-smoke.sh`) contra el backend completo del banco | Los 8 casos del canal en verde: tipo `text/event-stream`, `X-Accel-Buffering: no`, sin CORS, 403 por `Origin` y por `Sec-Fetch-Site`, 200 con el propio origen y con `same-origin`, y 400 con un filtro inválido. Los dos casos del contrato servido necesitan `/docs`, que el banco no publica: corren en la pila de desarrollo |
| Banco por el proxy (`banco.sh proxy`): flujo abierto por el 8443 con el `Origin` del propio panel y filtrado por el dispositivo que publica, antes de publicar por MQTT sobre TLS | La medición de ese dispositivo llega por el canal en vivo: dispositivo → broker → pipeline → base → canal → nginx → cliente. Con `$host` plantado en el proxy, 403 «origen no permitido» y el caso falla. Desde el 09/10 espera el primer byte del flujo antes de publicar, en vez de un `sleep` fijo |

Cada protección se probó a mano el 09/10 plantando su violación (un cambio temporal, restaurado y comparado con `cmp`): sin
cortar las conexiones del canal, cortándolas todas, sin el control de origen, sin `Sec-Fetch-Site`, con el cupo corrido en
uno y sin la guarda del cierre de condiciones, falla exactamente la prueba que la cubre.

**Lo que destapó:** (1) el proxy reenviaba el `Host` sin el puerto, y en el banco (8443) el canal habría rechazado al propio
panel; (2) una pestaña abierta retenía el apagado del backend, y el primer arreglo cortaba también lo legítimo; (3) `pnpm openapi` iniciaba la aplicación y se conectaba al
broker con la identidad del backend: con la pila arriba, el broker debe desconectar al cliente ya conectado con el mismo
identificador (MQTT 3.1.1, [MQTT-3.1.4-2]), o sea al backend en marcha. Ahora genera el contrato sin iniciarla: no toca la
base ni el broker, y las 6 rutas que ya existían salen idénticas; (4) una imagen o un `fetch` «no-cors» de otro sitio no manda
`Origin` y abría el canal: ahora también se mira `Sec-Fetch-Site`; (5) el cierre de una condición de umbral no tenía guarda.

## 15. Lista de nombres de host contra el *DNS rebinding* (12/10/2026)

`docs/10 §8.4` punto 40; controles en `docs/11 §3`. Backend: 19 pruebas nuevas en `arranque.spec.ts` (lista y su validación, forma
del `Host`, rechazo, avisos acotados); con el rechazo anulado a mano (cambio temporal, restaurado y comparado con `cmp`) fallan
exactamente las 3 que lo cubren. Pila de desarrollo reconstruida y `api-smoke.sh` con 6 casos nuevos (126 pruebas del backend en ese momento). Proxy sobre el
banco (`banco.sh proxy`, puertos 8443 y 8081, `PROXY_NOMBRE` sin definir = `localhost`):

| Comprobación | Resultado |
|---|---|
| Backend, `Host: ataque.example:3000` (una página ajena cuyo nombre resolvió a 127.0.0.1) | 421 sin llegar a ninguna ruta; un WARN acotado en el registro |
| Backend, `Host: localhost.ataque.example`, `usuario@localhost`, sin `Host` | 421: comparación exacta y lo ilegible no se arregla |
| Backend, `Host: localhost:5173` (Vite) y `127.0.0.1:3000` | 200: el puerto no cuenta |
| Proxy, nombre ajeno en el SNI (`--resolve ataque.example:8443:127.0.0.1`) | saludo TLS rechazado («tlsv1 unrecognized name»): ni certificado ni respuesta |
| Proxy, SNI del nombre propio y `Host: ataque.example` | 421 de nginx: el servidor que elige el `Host` es el que rechaza saludos; no llega al backend |
| Proxy, por IP sin SNI (`https://127.0.0.1:8443`) | saludo TLS rechazado; por eso el chequeo de salud del proxy pide por el nombre con `--resolve` |
| Proxy, puerto 80 con `Host` ajeno | conexión cerrada sin respuesta (444); con el nombre propio, 301 a HTTPS |
| Proxy, nombre propio (`https://localhost:8443/salud`) y el canal en vivo por el 8443 | 200, y la medición sigue llegando por el canal: los 6 casos de §9 y §14 en verde con la plantilla y el chequeo de salud nuevos |
| Guardián 2m | renderiza la plantilla con un nombre de prueba y exige `server_name` en 443 y 80, `ssl_reject_handshake` y `Host $http_host`; sin eso, `nginx -t` habría validado la configuración de fábrica de la imagen si la plantilla no se procesara |

Lo que no cubre: un cliente que no es un navegador (curl) manda el `Host` que quiera; lo cubre la sesión (Etapa 4). El registro
del proxy deja una línea por intento (estado 421 o 444) con la IP de origen.

**Revisión del 12/10 sobre este cambio (corregido el mismo día):** (1) el texto de `docs/10` y `docs/11` decía «saludo rechazado»
para todo nombre ajeno, pero con el SNI propio y otro `Host` lo que hay es el 421 de nginx (medido arriba): texto corregido; (2)
un cliente local que insista con un `Host` ajeno escribía una línea WARN por petición: ahora un aviso por motivo y por minuto con
el conteo de los callados, en el backend y en el canal en vivo (3 pruebas); (3) `PROXY_NOMBRE` llegaba a la plantilla de nginx sin
validarse: el backend rechaza al arrancar un `HTTP_HOSTS` sin forma de nombre y, por `depends_on`, el proxy no arranca (2 pruebas).
Limitación conocida del banco: la redirección del 8081 va a `https://localhost/` (443), no al 8443, porque nginx redirige sin el
puerto; en el servidor, 80 → 443, que es el caso real.

## 16. Panel, tramo 2: esqueleto, inventario con semáforo y reenvío de desarrollo (12/10/2026)

`docs/19` (pantalla P2) y `docs/10 §8.4` (panel en `backend/panel/`, mismo workspace de pnpm, servido por el backend en `/panel`).
Versiones elegidas con al menos siete días de publicadas (Svelte 5.57.1, Vite 8.3.2, Vitest 5.0.3; el 23/10/2026 Vite pasó a 8.3.5 por cinco avisos publicados el 20 y el 21/10, entre ellos GHSA-587h-7wmj-h5pm, alto, que afectan hasta 8.3.2: fue una **excepción** a los siete días, porque 8.3.5 tenía dos, y no hacía falta: 8.3.4, publicada el 08/10, ya los corregía y cumplía la regla; el 24/10 se decidió no retroceder y quedarse en 8.3.5, la última publicada, que el 28/10 cumple los siete días; `docs/11 §3`, fila de imágenes fijadas por digest y robot de dependencias: siete días de espera); ninguna
dependencia ejecutó scripts de instalación (`ignore-scripts`). Auditoría del workspace: cero avisos en producción; en desarrollo,
el alto conocido de `braces` y un moderado de `sprintf-js`, los dos solo por Jest y sin parche publicado.

| Comprobación | Resultado |
|---|---|
| 20 pruebas del panel (vitest): estado visual (cuatro reglas y su orden), «en línea» con la regla de la API, orden de atención, «hace cuánto», hora local con UTC, cliente HTTP con acciones por código, canal en vivo (reconexión 1-2-4 s, plazo sin latido, cierre limpio) | ✅ todas |
| 3 de ellas por el DOM (jsdom): un dispositivo en mantenimiento con condición abierta aparece «Inactivo» y **no** «Alerta»; orden Sin señal → Alerta → Normal → Inactivo; conteos; una ficha filtra y vuelve a mostrar; vacío y error con su acción | ✅ |
| `svelte-check` sobre 320 archivos | 0 errores, 0 avisos |
| Build real (tramo 2): `index.html` 0,45 KB, un paquete JS de 47 KB (18,7 KB comprimido), CSS 1,8 KB; sin `.map` | ✅ |
| Imagen del backend reconstruida: el panel compilado en la etapa de build; en la imagen final solo `panel/dist`, y `node_modules` sin `svelte` (6 entradas, solo producción del backend) | ✅ (`--filter` en la instalación de producción) |
| `pruebas/panel-desarrollo.sh`, con el servidor de Vite real: `/panel/` servido; `Origin` propio por el 5173 → 200 y otro → 403 (el reenvío conserva el `Host`); primer byte del canal en menos de 5 s y latido a los 25 s (no retiene el flujo) | ✅ (11 comprobaciones; 12 desde el tramo 3, con «el 5173 queda libre») |
| El mismo guion contra el build servido por el backend: `/panel/` con la CSP estricta, paquete con hash 200, `.map` 404, sin scripts en línea | ✅ |

**Hallazgos:** (1) Vitest cargaba la versión de servidor de Svelte y `onMount` no existía: lo resuelve el plugin de pruebas de
Testing Library (`svelteTesting`), que fuerza la resolución de navegador; (2) Vite trae su propia lista de nombres de host
(`server.allowedHosts`, desde la 6.0.9, por el mismo *DNS rebinding* del punto 40) y corta un `Host` ajeno con 403 antes de
reenviar: el caso del guion acepta ese 403 o el 421 del backend, nunca un 200; (3) `.dockerignore` solo excluía `node_modules`
y `dist` de la raíz: sin las entradas del panel, `COPY panel` habría metido al contexto de build sus dependencias enlazadas.
**Lo que no cubre todavía (hasta el 12/10; desde el 16/10, ver §39):** ninguna prueba abre el panel en un navegador real (las del DOM corren en jsdom); la demostración
(`docs/15`) lo hace a mano; una prueba con navegador llega con la ficha (tramo 3), que es donde hay gráfico.

## 17. Panel, tramo 3: ficha del dispositivo con gráfico (12/10/2026)

`docs/19` (pantalla P3, HU-21 adelantada a la Etapa 3 por decisión del 12/10). Para alimentarla, la API ganó el filtro
`?dispositivo=<uuid>` en `GET /condiciones` y `GET /cuarentena` (UUID validado; otro valor → 400; contrato regenerado y comparado
con el versionado en el humo). uPlot 1.6.32 (MIT, 576 días publicado) entra como dependencia de producción del panel. Medido con el build real: el paquete
quedó en dos fragmentos, el del panel de 61 KB (23 KB comprimido) y el de uPlot de 51 KB (22 KB comprimido), que solo se descarga
al abrir una ficha; el inventario pasó de 44 a 23 KB comprimidos.

| Comprobación | Resultado |
|---|---|
| 43 pruebas del panel (23 nuevas): ventana y URL del histórico por rango, series del gráfico (histórico agregado y lecturas en vivo aparte; inserción en orden; tope de 500 puntos en vivo que nunca borra el histórico), formato con coma decimal, forma de cada evento del canal (el latido trae solo `tiempo`), filtros del inventario por vía, zona y búsqueda | ✅ todas |
| 11 por el DOM (jsdom; uPlot sustituido por un doble que registra los datos): la ficha muestra identidad, estado visual (condición abierta y en línea → «Alerta»), una tarjeta por canal con última lectura y umbrales; pide las condiciones abiertas completas y las recientes, y el histórico del primer canal con el rango por defecto (24 h, 15 minutos) que entrega al gráfico; condiciones abiertas primero; trama rechazada plegada; una medición en vivo actualiza la tarjeta y entra al gráfico en un lote de 250 ms, una de otro dispositivo se descarta y en pausa nada cambia; diez avisos de condición → una sola tanda de consultas (antirrebote); al reconectar tras una caída se repite la ficha y el histórico; un id inexistente → mensaje con la acción y sin gráfico | ✅ |
| Humo de la API: condiciones filtradas por dispositivo (todas suyas), cuarentena filtrada, valores que no son UUID → 400; contrato servido igual al versionado | ✅ (4 casos nuevos) |
| Imagen reconstruida; `panel-desarrollo.sh` completo (12 comprobaciones, incluida la terminación de Vite) | ✅ `PANEL OK` |
| Ficha con datos reales de la pila de desarrollo (`curl`): canal de temperatura con su última lectura; 2 condiciones del dispositivo, todas suyas | ✅ |

**Correcciones del tramo 2 (mismo día):** el lector del canal exigía `tipo` dentro de los datos y descartaba el
latido; el inventario pedía las condiciones con el límite por defecto (50), insuficiente para el semáforo con muchas abiertas
(ahora 500); al reconectar no se repetía nada (ahora inventario y ficha repiten todo); el guion mataba a `pnpm` y dejaba a Vite
vivo en el 5173 (se vio con `ss`; ahora lanza el binario y comprueba el puerto); `.dockerignore` sin `**/` dejaba entrar
`panel/.env` o una llave al contexto de build.
**Correcciones de la revisión del tramo 3 (mismo día):** (1) el repetido al reconectar nunca se disparaba: el canal pasa por
«conectando» antes de «en vivo», así que comparar con el estado anterior no servía; ahora el canal avisa «reconectado» al abrir
tras una caída y la prueba cubre la secuencia real; (2) la ficha pedía solo las 50 condiciones más recientes para decidir el
estado: una `sin_comunicacion` vieja quedaba fuera tras 50 aperturas y cierres de umbral; ahora pide las abiertas completas
(hasta 500) aparte de las recientes, y el inventario avisa si llega al tope; (3) cada aviso de condición repetía la lista y
cada lectura redibujaba el gráfico: antirrebote de 1 s con un solo vuelo y lotes de 250 ms; (4) un parámetro repetido
(`?dispositivo=a&dispositivo=b`) llega como arreglo y daba 500: toda validación exige texto y responde 400 (4 pruebas, 2 casos
de humo); (5) la ficha descarta eventos de otro dispositivo aunque el canal venga filtrado, y un `valor` infinito se rechaza;
(6) los avisos de copyright de `svelte` y `uPlot`, que Vite quita del código, viajan en `/panel/avisos-de-terceros.txt`; (7) el
diagrama de tiempo real de `docs/10 §5` decía `?canal=` y «añade el punto»: ahora `?dispositivo=` y la lectura en vivo aparte.
**Lo que no cubre:** ningún navegador real (jsdom; el gráfico se mira a mano en la demostración, `docs/15`); la reconexión del
canal, la lectura en vivo, la pausa y el antirrebote se prueban con un `EventSource` falso y temporizadores simulados, no
cortando el backend ni publicando por MQTT; los puntos del gráfico se comprueban contra un doble de uPlot, no en un canvas; el
rango a medida por fechas (HU-07) queda para la Etapa 4.

## 18. Credenciales del broker con el plugin Dynamic Security: laboratorio desechable (12/10/2026)

Condición de la decisión del 08/10 (`docs/10 §8.4` punto 26): antes de que el backend administre credenciales del broker, una
prueba en un contenedor desechable con identidades de descarte. `plataforma/pruebas/lab-dynsec.sh` levanta la misma imagen
fijada del compose con el plugin activado y, en un solo guion que no imprime ningún secreto, crea un rol con ACL de publicación
al tópico propio (`%u`), un cliente de descarte, y prueba el ciclo completo. Los secretos los genera y los usa el propio guion en
la máquina de quien lo ejecuta y nunca se imprimen (regla del proyecto desde el 27/09); la salida se pega aquí.

**Primera corrida (12/10, plugin + `password_file` + `acl_file` en el mismo listener):**

| Comprobación | Esperado | Medido |
|---|---|---|
| Cliente del plugin: conectar con su clave | acepta | ✅ acepta (los rechazos de abajo son de publicación, no de conexión) |
| Publicar en el tópico propio (`%u`) | aceptada | ❌ **no autorizada** |
| Publicar en tópico ajeno | no autorizada | ✅ |
| Usuario desconocido | conexión rechazada | ✅ |
| Usuario de `password_file` con `acl_file`: su tópico / ajeno | aceptada / no autorizada | ✅ `RC:16` (aceptada, sin suscriptores) / ✅ |
| Deshabilitar → conectar; rehabilitar | rechazada; aceptada | ✅ rechazada; conecta pero sigue sin poder publicar (lo mismo de arriba) |
| Rotar la clave: vieja / nueva | rechazada / aceptada | ✅ / conecta, sin poder publicar |
| Borrar el cliente → conectar; el JSON vuelve a un cliente | rechazada; 1 cliente, 2 roles | ✅ / ✅ |
| Reinicios del broker | 0 | ✅ 0 |
| Intentos fallidos | solo en el log del broker | ✅ 9 líneas en el log; nada en la base (como dice el registro de evidencia) |
| Avisos al arrancar | ninguno | ⚠️ `passwd` con permisos de lectura para todos y dueño distinto de `mosquitto` («versiones futuras lo rechazarán»): el guion ya lo corrige (dueño 1883, modo 640) |
| `mosquitto_ctrl` sin cifrado | — | ⚠️ aviso en cada orden: las claves nuevas viajan en claro; en el sistema el administrador será el backend por la red interna de Docker, igual que hoy sus propias credenciales, y se anota en `docs/11 §4` |

**Lectura.** El plugin hace todo lo que el diseño necesita (crear, limitar por rol, deshabilitar, rotar, borrar, persistir, sin
reiniciar), **pero un cliente del plugin no pudo publicar ni en su propio tópico mientras `acl_file` estaba configurado**. La
documentación oficial del broker dice que «los chequeos del plugin corren antes que los incorporados» y que con `acl_file` «solo
los tópicos listados tienen acceso» (`mosquitto.conf(5)`, consultado el 12/10); no dice qué pasa cuando el plugin permite y el
archivo niega. La hipótesis, por confirmar con la segunda corrida: el chequeo del `acl_file` niega a quien no figura en él aunque
el plugin lo haya permitido, así que **`acl_file` y el plugin no conviven para el control de acceso**. La segunda versión del
guion corre tres fases (solo plugin; plugin + `password_file`; los tres) para separar autenticación de control de acceso.

**Segunda corrida (12/10, tres fases):**

| Fase | Pregunta | Medido |
|---|---|---|
| A · solo el plugin | ¿El rol con `%u` limita al tópico propio y el ciclo de vida completo funciona? | ❌ el cliente del plugin recibe `RC:135` **también en su propio tópico** (la hipótesis del `acl_file` era incorrecta); ✅ desconocido rechazado, deshabilitar/rehabilitar, rotar, borrar, persistencia, 0 reinicios |
| B · plugin + `password_file` | ¿Un usuario del archivo conecta? ¿Quién le limita el tópico si no hay `acl_file`? | ✅ conecta; ❌ no publica en ningún tópico: el plugin decide la ACL también para los usuarios del archivo, y por defecto niega |
| C · los tres | ¿Se repite el rechazo? | el cliente del plugin sigue en `RC:135`; el usuario del archivo publica en su tópico (`RC:16`) y no en ajeno (`RC:135`): el `acl_file` sí le concede acceso |

**Lectura corregida.** Lo que falla no es la convivencia sino el **patrón `%u` en la ACL del rol**: en la imagen fijada
(2.0.22) no autorizó ni con el plugin solo. La documentación que describe `%c` y `%u` en las ACL (registro DS-06) corresponde a la
rama nueva del broker; para esta versión no está declarado. La tercera versión del guion prueba en la fase A tres formas de ACL
en roles distintos (tópico literal, `%u`, `%c`, esta última con identificador de cliente fijo) para saber qué sostiene el broker.
Si el literal funciona, el backend crea **un rol por dispositivo con su tópico literal** (lo que ya hace el `acl_file` de hoy,
pero sin reiniciar): no hace falta el patrón. La convivencia queda así: la autenticación por archivo sigue (fase B conecta), pero
la ACL la decide el plugin para todos (fase B niega), salvo lo que el `acl_file` conceda (fase C). Consecuencia probable: migrar
todos los usuarios al plugin y retirar los dos archivos, como ya prevé el punto 41.

**Tercera corrida (12/10), contra las dos versiones:**

| Comprobación (fase A, solo el plugin) | Mosquitto 2.0.22 | Mosquitto 2.1.2-alpine (18/09/2026) |
|---|---|---|
| ACL con tópico literal: propio / ajeno | ✅ `RC:16` / `RC:135` | ✅ `RC:16` / `RC:135` |
| ACL con `%u` (usuario): propio / ajeno | ❌ `RC:135` / `RC:135` (no sustituye) | ✅ `RC:16` / `RC:135` |
| ACL con `%c` (identificador de cliente): propio / ajeno | ❌ `RC:135` / `RC:135` | ✅ `RC:16` / `RC:135` |
| Desconocido, deshabilitar, rehabilitar, rotar, borrar; 0 reinicios | ✅ todo | ✅ todo |
| Fase B (plugin + `password_file`): el usuario del archivo conecta pero el plugin le niega todo tópico | igual en las dos | igual en las dos |
| Fase C (los tres): el `acl_file` le concede su tópico al usuario del archivo; el cliente del plugin sigue bien | igual en las dos | igual en las dos |

**Conclusiones.** (1) El plugin sirve en las dos versiones; (2) en 2.0.22 la ACL de cada dispositivo debe ser su tópico literal
(un rol por dispositivo); en 2.1.2 basta un rol con patrón, como describe la documentación actual; (3) no hay convivencia útil:
con el plugin activo, la ACL de todos la decide el plugin (salvo lo que un `acl_file` conceda aparte), así que todos los
usuarios del broker migran al plugin y los dos archivos se retiran (`docs/10 §8.4` punto 42). Decisión del 12/10 (criterio del
estudiante: la versión más nueva que convenza, con licencia y seguridad revisadas): **adoptar 2.1.2-alpine fijada por digest**,
después de escanear la imagen (`escanear-imagenes.sh`) y repetir el banco con TLS. Nota del guion: el conteo «roles 2» tras
borrar el rol de prueba es correcto (el rol `admin` y la referencia a él en el cliente administrador); el guion lo decía mal.

**Resultado (12/10):** A funciona y los archivos no conviven de forma útil → migración hecha en la misma tanda (`docs/10
§8.4` punto 42): `password_file` y `acl_file` fuera de `mosquitto.conf`, `acl` fuera del repo, todos los usuarios en el plugin
(`pruebas/broker-inicializar.sh`, `broker-cliente.sh`, `lib-dynsec.sh`), guardián 2i reescrito. Escaneo de
`eclipse-mosquitto:2.1.2-alpine` por digest: **0 críticas, 0 altas** (`escanear-imagenes.sh`); banco con TLS repetido sobre 2.1.2
y el plugin: 11 de 11 (`banco.sh proxy`); emulador y alta por API: §20.

## 19. Exportación de mediciones crudas en CSV y JSON (12/10/2026)

RF-34 y HU-08, adelantada a la Etapa 3 (`docs/18 §3`): lo que el Académico/Investigador en Ingeniería Civil Geológica entrevistado llamó «crítico y no negociable».
`GET /dispositivos/{id}/exportar?formato=csv\|json&desde&hasta` escribe fila a fila al responder, por tandas de 10 000 con
paginación por clave `(tiempo, canal_id)` (el plan de esa consulta se mide en el banco antes de afirmar qué índice usa: pendiente):
un rango de años no cabe en memoria y tampoco hace falta.
CSV estándar (coma, punto decimal, UTF-8, CRLF, cabecera fija) para R, Python y QGIS; JSON como lista. Sin sesión hasta M7,
como toda la API (`docs/11 §4`); XLSX y la exportación por sitio con rol llegan con la sesión.

| Comprobación | Resultado |
|---|---|
| 9 pruebas en `exportar.spec.ts` (funciones puras): fila CSV con el instante exacto (microsegundos), celdas con coma, comillas y saltos de línea, protección contra inyección de fórmulas en toda columna de texto (`=`, `+`, `-`, `@`, tabulador, retorno), columna numérica, rango razonable, JSON por fila, nombre del archivo saneado, formato por defecto y rechazo de uno desconocido o repetido | ✅ |
| Humo (pila de desarrollo): cabecera fija del CSV, descarga con nombre `.csv` (`Content-Disposition`), primera fila con instante de seis decimales (microsegundos: con milisegundos la última fila de cada tanda se repetía en la siguiente), JSON como lista con `tiempo_utc` y `valor`, formato desconocido → 400, `desde` posterior a `hasta` → 400, dispositivo inexistente → 404; contrato servido con 8 rutas igual al versionado | ✅ (7 casos nuevos) |
| 404 antes de escribir cabeceras; si el cliente corta la descarga, se deja de consultar (`res.destroyed`); un error a mitad de flujo corta la conexión y queda en el registro; contrapresión por `drain`; como mucho 2 simultáneas (429) y 30 s por consulta | ✅ (lectura del código; sin prueba de corte ni de cliente lento) |

**Correcciones del mismo día (12/10):** la primera versión paginaba con un `Date` de JavaScript (milisegundos) y la base guarda
microsegundos: la última fila de cada tanda se habría repetido en la siguiente; el instante viaja ahora como texto exacto. Se
agregaron el tope de simultáneas, el tope por consulta, la contrapresión, el corte ante error y la protección de fórmulas en
toda columna de texto (antes se eximía lo que empezaba con `-` y un dígito).
**Lo que no cubre:** un rango de años con millones de filas no se midió (el banco tiene minutos de datos); el plan de la consulta
de tandas no está medido; la variante para Excel en español (punto y coma, coma decimal) y el XLSX quedan con la sesión; sin
pantalla todavía (P8 de `docs/19`); no hay prueba automática del corte por el cliente ni del cliente lento.

## 20. Alta por API y migración del broker al plugin (12/10/2026)

HU-11 (`POST /dispositivos`; `docs/10 §3` y `§8.4` puntos 41 y 42; controles en `docs/11 §3`). Qué se probó y cómo:

| Comprobación | Resultado |
|---|---|
| Unitarias, sin broker ni base: 6 pruebas en `dynsec.spec.ts` (orden con correlación, error del plugin, sin respuesta en el plazo, respuestas ajenas e ilegibles ignoradas, cancelación al caer la conexión, el secreto no viaja en el error); 4 en `credenciales.spec.ts` (secreto de 32 caracteres base64url, `scrypt` con sal, hash de otra forma rechazado, comparación en tiempo constante y costo del hash medido: falla si alguien bajara N); 5 en `alta.dto.spec.ts` (forma del identificador igual a la de la base, nombres reservados y el de la sonda, campos que solo pone el sistema, vía y pasarela, canales); 5 en `clave-admin.guard.spec.ts` (incluida la cabecera repetida tal como la une Node); 10 en `alta.service.spec.ts` (BEGIN → … → `createClient` → COMMIT; 502 con ROLLBACK si el broker no responde y orden de borrado por si el cliente llegó a crearse; un rechazo explícito del plugin no borra nada; 409 por huérfano, sin borrar el ajeno, y por clave duplicada sin tocar el broker; borrado en el broker si la base no confirma; 503 sin administración antes de abrir la transacción; 429 con dos altas en curso; lorawan sin credencial y con pasarela del mismo sitio; 400 por zona o magnitud antes de insertar) | ✅ 172 en total (`pnpm test`) |
| `pruebas/lab-dynsec-anonimos.sh` (laboratorio versionado, un contenedor efímero; corrido el 12/10): el archivo del plugin con dueño `root` deja al plugin vacío y rechaza hasta al administrador; con el dueño correcto y el acceso por defecto abierto, un cliente anónimo publica (`RC:16`); un cliente que manda **usuario sin clave** se rechaza aunque los anónimos estén permitidos; el rol `recepcion` recibe lo que publican los anónimos; `setDefaultACLAccess` se escribe `allow|deny`, no `true|false`; `mosquitto_ctrl` no admite un archivo de opciones | ✅ 6 de 6; por eso el emulador conecta sin usuario y el guion fija dueño 1883 |
| `banco.sh alta` (banco con el plugin, 20 emulados): POST con la clave → 201; credencial de 32 caracteres y tópico en la respuesta; `Cache-Control: no-store`; el dispositivo nuevo publica en su tópico (`RC:0`) y la lectura llega a `medicion`; con su credencial, publicar como otro → `RC:135`; con otra clave, no conecta; repetir el alta → 409; sin cabecera → 401; con cabecera incorrecta → 401; cuerpo inválido → 400; lorawan sin pasarela → 400; `credencial.hash` empieza por `scrypt$` y el secreto en claro no está en ninguna fila; evento `alta`; `GET /dispositivos` lo lista con vía `mqtt` y en línea; la credencial no aparece en el registro del backend; un anónimo (emulado) no puede dar órdenes al plugin (`RC:135` en `$CONTROL`); el usuario `backend` (rol `recepcion`) no puede publicar como dispositivo (`RC:135`) | ✅ 19 de 19 |
| Primera corrida de ese banco: «publicar como otro» dio `RC:0`, porque el banco abría el acceso por defecto para los anónimos y el rol `dispositivo` solo tenía su regla de permiso | corregido dos veces: primero negaciones explícitas en el rol; después (revisión del mismo día) el banco dejó de abrir el defecto: los emulados entran por el grupo anónimo del plugin con un rol `emulado`, todos los roles llevan negaciones explícitas (`#` y `$CONTROL/#`) y el acceso por defecto se fija en deny; así el banco prueba la misma ACL que el servidor |
| `banco.sh correr --dispositivos 20 --duracion 15` con el plugin (emulados anónimos): 282 mediciones con la marca del nodo, 0 en cuarentena, latencia p95 3 ms | ✅ sin pérdida |
| `banco.sh proxy` sobre Mosquitto 2.1.2 y el plugin: HTTPS, HSTS, MQTT sobre TLS → medición, SSE, 8883 sin TLS rechazado, nombres ajenos rechazados | ✅ 11 de 11 |
| Humo contra el banco: `POST /dispositivos` sin cabecera, con otra y con la cabecera repetida → 401 (en la pila de desarrollo, 503 mientras no haya clave) | ✅ |
| Escaneo de `eclipse-mosquitto:2.1.2-alpine` por digest | ✅ 0 críticas, 0 altas |

**Qué cambia de 2.0.22 a 2.1.2 y si desmiente algo ya probado** (registro de cambios oficial, leído el 12/10/2026; evidencia DS-08):
(1) `max_packet_size` pasa de «sin límite» a 2 000 000 bytes por defecto; aquí rige el tope explícito de 65 536, así que la prueba
del 07/10 (50 MiB aceptados sin tope) describe un comportamiento que la 2.1 ya no tiene por defecto, y la decisión de fijar el
tope sigue vigente. (2) `allow_duplicate_messages` pasa a `true` por defecto: solo afecta a un cliente con suscripciones que se
solapan; el backend tiene una sola (`sitio/#`) y la administradora otra distinta, sin solape. (3) `acl_file` y `password_file`
quedan declaradas obsoletas en favor de plugins: la migración de §20 va en la dirección de la versión. (4) El plugin de seguridad
sustituye `%c` y `%u`: lo que midió el laboratorio. (5) 2.1.2 prohíbe `persistence true` junto con un plugin de persistencia:
el de seguridad no lo es, y el broker arranca con `persistence true` (comprobado en la pila de desarrollo y en el banco).
(6) Los valores por defecto de la cola (`max_queued_messages` 1000, `max_inflight_messages` 20, `max_queued_bytes` sin tope,
`autosave_interval` 1800 s) siguen iguales en el manual vigente, así que `docs/10 §4.1` sigue valiendo. Novedad útil:
`global_max_connections` (por defecto ilimitado) para el pendiente de `docs/11 §4` sobre el límite de conexiones.

**Correcciones de la revisión del mismo día (12/10; 40 hallazgos de tres lentes, 39 aplicados):** la administración del broker
se declara disponible solo después de suscribirse a las respuestas (antes, una orden en la ventana entre conectar y suscribirse
habría dejado un cliente huérfano); un error ambiguo del broker (sin respuesta, conexión perdida) ordena borrar el cliente por si
llegó a crearse, y un rechazo explícito no borra nada; como mucho dos altas a la vez (429) e `idle_in_transaction_session_timeout`
de 15 s, porque la espera al broker ocurre entre sentencias y retiene una conexión del pool de 5; `scrypt` asíncrono (no detiene la
recepción de tramas) y `verificarScrypt` con bordes (sal o clave cortas, parámetros fuera de rango: `false`, nunca lanza); la
cabecera repetida llega unida por «, » (así la entrega Node) y se prueba así; el error 23514 ya no devuelve el detalle crudo de la
base; `MQTT_ADMIN_CLAVE` con el mismo mínimo de 24 caracteres; el nombre de la sonda (configurable) también reservado; el guion de
inicialización verifica cada clave del sistema entrando al broker (antes imprimía «OK» aunque el plugin respondiera error), recrea
el broker solo si el que corre no acepta al administrador y rota la clave del administrador con `MQTT_ADMIN_CLAVE_ANTERIOR`; la
verificación de una credencial usa un identificador de cliente propio (con el del dispositivo expulsaba su sesión); el banco pasa
los secretos a `curl`, `psql` y `grep` por la entrada estándar.

**Lo que no cubre:** la pila de desarrollo se migra con `broker-inicializar.sh` (lo corre el operador; hasta reconstruir el backend,
el guardián 2i falla y los casos del alta del humo responden 404, a propósito); la baja y la rotación por API llegaron el 13/10 (§21); la vía `http` guarda el hash del token aunque la recepción por HTTP no exista aún (llegó el 16/10, §41); no hay prueba automática de dos
altas simultáneas del mismo identificador (las serializa el bloqueo por identificador del disparador de la migración 11, no
ejercitado en concurrencia); un cliente huérfano en el broker se reporta (409 con el remedio) y no se corrige solo; la credencial
viaja en claro dentro de la respuesta HTTP, por lo que fuera de la red local la ruta exige el proxy TLS; no hay límite de tasa en el
proxy para `POST /dispositivos` (pendiente de `docs/11 §4`: el tope de dos altas y la clave de 24 caracteres acotan el daño).

## 21. Baja y rotación de la credencial por API (13/10/2026)

`DELETE /dispositivos/{id}` y `POST /dispositivos/{id}/credencial` (`docs/10 §3`; sin historia de usuario propia: completan HU-11 y
RF-45; controles en `docs/11 §3`). Qué se probó y cómo:

| Comprobación | Resultado |
|---|---|
| Unitarias, sin broker ni base: 14 pruebas en `baja-rotacion.spec.ts` (13 el 13/10/2026; la 14.ª, del 18/11/2026, comprueba que el aviso en vivo de las condiciones cerradas por la baja sale después del COMMIT, `docs/16 §85`). Baja: `FOR NO KEY UPDATE` → estado → credenciales inactivas → condiciones cerradas → evento → `deleteClient` → COMMIT; 409 si ya estaba de baja y 404 si no existe, sin escribir ni tocar el broker; «not found» del plugin cuenta como borrado y se confirma; sin respuesta → 502 con ROLLBACK y nada que deshacer; vía `http` sin orden al broker; vía `mqtt` sin administración → 503 antes de escribir. Rotación: fila nueva con `scrypt` y la anterior inactiva, `setClientPassword` con el secreto antes del COMMIT, el secreto no está en ningún parámetro SQL, `conexion` con tópico y ejemplo como en el alta; 409 de baja y 400 lorawan sin escribir; «not found» → `createClient` con su rol; sin respuesta → 502 con «repetir la rotación»; la base no confirma → 500 con el mismo remedio; 429 con dos operaciones en curso, también para baja y rotación | ✅ 185 en total al 13/10 (`pnpm test`; 193 al 15/10) |
| `banco.sh alta` ampliado (20 emulados; las 19 comprobaciones del alta, 19 nuevas y, desde la tarde, 2 de mínimo privilegio: el administrador del broker ya no puede suscribirse a `sitio/#` (135) y sí a `$SYS`): rotación → 201 con credencial nueva de 32 caracteres y `Cache-Control: no-store`; con la anterior el broker no deja conectar; con la nueva publica (`RC:0`); 2 filas de `credencial`, 1 activa; evento `rotacion`; sin cabecera → 401. Baja → 200 con estado anterior y credenciales revocadas; con la credencial nueva ya no conecta (cliente borrado); estado `baja` y 0 activas; evento `baja`; el inventario lo lista con estado `baja`; repetir la baja → 409; rotar un dado de baja → 409; UUID inexistente → 404; sin cabecera → 401; ninguna de las dos credenciales aparece en el registro del backend | ✅ 40 de 40 |
| Humo (`api-smoke.sh`): `DELETE` y `POST …/credencial` sin cabecera → 401 (503 sin clave configurada), antes de mirar el UUID; OpenAPI con 9 rutas y 11 operaciones | ✅ |

**Decisiones de implementación (se cambian si no convencen):** la baja cierra las condiciones abiertas, porque nada más iba a
cerrarlas (el supervisor solo mira `activo` y el dispositivo no volverá a mandar un valor normal); un cliente que el broker ya no
tiene cuenta como borrado, así una baja repetida tras un corte termina igual que la primera; la rotación crea el cliente si el
broker no lo tenía (rotar es la reparación del huérfano al revés: la base lo tiene y el broker no); el tope de dos operaciones a
la vez pasa a cubrir alta, baja y rotación; la fila bloqueada con `FOR NO KEY UPDATE` (desde el 15/10/2026, §26; antes `FOR UPDATE`) ordena dos operaciones sobre el mismo dispositivo
(`lock_timeout` de 5 s → 503 con «reintentar»).

**Lo que no cubre:** si rotar expulsa una sesión MQTT ya abierta no se midió (el plugin cambia la clave; el banco prueba conexiones
nuevas), y tampoco si la baja la expulsa al borrar el cliente; no hay «reactivar» un dado de baja (el identificador queda ocupado
por su historial: un equipo que vuelve se da de alta con otro); el estado `mantenimiento` solo se escribe por SQL hasta la pantalla
P6 (Etapa 4); la rotación por `http` guarda el hash del token sin que exista aún la recepción por HTTP (llegó el 16/10, §41).

## 22. Cola del broker vigilada: topes, muestreo de `$SYS` y alarma (13/10/2026)

`docs/10 §8.4` punto 43 (la parte de la Etapa 3); migración 13 (`metrica_broker`, `condicion_sistema`); `broker/metricas*.ts`;
controles en `docs/11 §4` fila 2. Qué se probó y cómo:

| Comprobación | Resultado |
|---|---|
| Unitarias, sin broker ni base: 7 pruebas en `metricas.spec.ts`. Lectura de `$SYS` solo con enteros; muestra incompleta (falta un contador) → nada se guarda; regla: descartes que crecen entre muestras, cola al 80 % de un tope configurable (`METRICA_BROKER_COLA_TOPE`), contador que baja = broker reiniciado, no descarte; sin muestra anterior solo cuenta la cola. Servicio: guarda la muestra; con descartes abre `broker_descarte` con su evento y el aviso `sistema` por el canal en vivo; no abre dos veces; una muestra normal no cierra, la segunda sí; al arrancar retoma la última muestra guardada (descartes durante una caída del backend se notan al volver) y la condición que quedó abierta; un tope inválido impide arrancar | ✅ 192 en total (`pnpm test`) |
| `banco.sh cola` (plantar la violación: backend detenido, 200 emulados a 1 trama/s durante 70 s contra la cola de 10 000 de la sesión persistente): `/salud` trae los contadores; el contador de descartes creció (el tope rige); al volver el backend, condición abierta con motivo «descartes», evento y aviso en `/salud`; muestras en `metrica_broker`; cierre automático al vaciarse la cola. Segunda corrida: 4 773 descartes contados, condición abierta con motivo «descartes», evento de apertura, cierre solo tras dos muestras normales y evento de cierre | ✅ 12 de 12 |
| Guardián 2l ampliado: `max_queued_messages 10000` y `max_queued_bytes 20971520` en la pila y en el banco, `autosave_interval 300` en la pila, y el tope del backend (`COLA_TOPE_POR_DEFECTO`) igual al del broker; probado plantando 9000 en una copia | ✅ |

**Hallazgo de la primera corrida del banco (13/10):** el tope actuó (4 779 descartes contados por `$SYS`) y hubo muestras, pero la
condición no se abrió: el backend se detuvo antes de que existiera una muestra guardada, y la primera muestra de un proceso sin
historia fija la referencia sin alarmar (así se evita una alarma falsa en el primer arranque). Dos correcciones a la prueba, no al
código: espera la muestra de referencia antes de detener el backend, y «se cerró sola» solo cuenta si antes se abrió (la
primera versión daba OK con una condición que nunca existió). Límite documentado: los descartes anteriores a la primera muestra
de la historia no se ven.

**Lo que no cubre:** la alarma llega como mucho un intervalo después (60 s en el servidor; 10 s en el banco); los descartes
ocurridos con el backend caído se ven al volver, no durante (nadie muestrea mientras tanto); el panel todavía no dibuja el evento
`sistema` (P4, Etapa 4); `max_queued_bytes` no se ejercitó por bytes (las tramas del emulador son chicas y el tope de mensajes
gana); la memoria del broker (`heap/current`) puede venir vacía si la imagen no la publica.

## 23. Semilla de demostración completa (13/10/2026)

`db/semillas/demo-completa.sql` + `pruebas/semilla-demo.sh --completa`: once dispositivos que cubren los tres estados, las tres
vías, los cuatro tipos de condición (abiertas y cerradas), los cuatro motivos de cuarentena más uno por HTTP, un dispositivo nunca
visto, identificadores en los límites (3 y 63 caracteres), un nombre de 80 con acentos, un segundo sitio en otra zona horaria, una
pasarela inactiva, 30 días de mediciones con un hueco y un pico, y métricas del broker con una condición del sistema cerrada. La
cabecera del archivo dice qué debe quedar y qué debe mostrar cada pantalla; el guion lo comprueba.

| Comprobación | Resultado |
|---|---|
| Aplicada dos veces seguidas: mismos conteos (reconstruye su escenario y no toca `dev-0001` ni dispositivos reales) | ✅ |
| 15 comprobaciones en la base (estados, vías, en línea 8 / fuera 2 / nunca visto 1, condiciones, cuarentena, 2 019 mediciones de `demo-aire-01`, un solo pico, ninguna medición fuera de rango, límites, zona horaria, credenciales no verificables) y `en_linea` de los once en `GET /dispositivos` | ✅ 16 de 16 |
| Plantado: un dispositivo silencioso marcado como visto ahora → la comprobación de la API falla nombrándolo | ✅ falla como debe |

**Lo que no cubre:** el recorrido del panel con esta semilla (siguiente paso: anotar cada diferencia como hallazgo); los que
reportan cada 300 s pasan a «sin comunicación» a los 10 min porque nadie publica (está escrito en la cabecera); ningún dispositivo
de la semilla tiene cliente en el broker.

**Actualización del 13/11/2026 (§66):** los dos casos límite (identificador de 3 y de 63 caracteres) pasaron a un sitio aparte de pruebas,
`pruebas-limite`, y cada medición de la semilla tiene ahora su trama, para que la entrega por dispositivo del tablero sea creíble. La
tabla de arriba es la de su día.

## 24. Rol de la aplicación con mínimo privilegio (13/10/2026)

Migración 14 (`docs/10 §8.4` punto 44; `docs/11 §4` fila 6 y §9). El backend entra como `plataforma_app`: SELECT en todo, INSERT en 11 tablas y UPDATE en 5 (desde la migración 16, también INSERT en `pasarela` y UPDATE de su columna `activo`, §30);
la retención usa la función `fn_retencion_drop_chunks` del dueño.

| Comprobación | Resultado |
|---|---|
| `pruebas/base-rol-app.sh` (banco desde cero): entra por la red con su clave; con otra clave no entra; no es superusuario; lee; se rechazan DELETE, TRUNCATE, DROP, CREATE, ALTER, `drop_chunks` directo, la función con una tabla fuera de la lista y con 7 días para las mediciones; la función recorta `trama` | ✅ |
| Con el rol nuevo, en el banco: `banco.sh alta` 40 de 40; pipeline con 20 emulados sin pérdida; humo de la API (lecturas, exportación, SSE, cabeceras, guardias); la retención real a los 60 s con 0 fallos; `banco.sh cola`; las sesiones del backend en la base son todas de `plataforma_app` | ✅ (en el humo fallan solo los 2 casos de `/docs`, que el banco no publica) |
| Guardián, paso 2: el rol no es superusuario ni tiene DELETE o TRUNCATE en ninguna tabla, y la función es `SECURITY DEFINER` y no ejecutable por cualquiera | ✅ |
| Primera corrida: el alta dio 500 («password authentication failed»). Dos causas: el banco fijaba la clave antes de un `up` que recrea la base en memoria, y la verificación entraba por `127.0.0.1`, que `pg_hba.conf` de la imagen oficial acepta sin clave (`trust`) | corregido: la clave se fija después de ese arranque y se verifica por la IP de la red, más una clave equivocada que debe fallar |

**Lo que no cubre:** el dueño `plataforma` sigue siendo superusuario (lo crea así la imagen oficial; separarlo es de la Etapa 4); la
pila de desarrollo usa el rol nuevo recién cuando la persona escribe `DB_APP_CLAVE` y corre `base-rol-app.sh`.

## 25. Costo del canal en vivo (SSE) bajo carga (14/10/2026)

Pregunta del estudiante: ¿cuánto consume el tiempo real y es más barato que WebSocket? Banco con 20 emulados (1 trama cada 2 s
cada uno, unos 10 por segundo), 35 s por corrida, muestras de `docker stats` del backend cada 4 s (techo 512 MiB, 0,5 CPU).

| Situación | CPU media del backend (máx.) | Memoria máx. del backend |
|---|---|---|
| Reposo, sin carga ni flujos | 6,8 % (una muestra, al arrancar) | 44,6 MiB |
| 50 flujos SSE abiertos, sin carga | 0,1 % | 53,0 MiB |
| 20 emulados, sin flujos | 3,8 % (8,0 %) | 51,0 MiB |
| 20 emulados y 50 flujos SSE (cada uno recibió los 724 eventos de medición, 216 KB) | 5,2 % (8,0 %) | 56,0 MiB |

**Lo que muestran:** cada flujo abierto cuesta del orden de 0,1 a 0,2 MiB, y repartir cada evento a 50 flujos suma alrededor de un
punto y medio de CPU. El flujo número 51 recibe 503 (`MAX_FLUJOS`), y el emulador no perdió ninguna lectura. WebSocket no se midió
porque no está implementado; por conexión mantiene lo mismo, una conexión TCP abierta, así que no se espera una diferencia de
orden. La elección de SSE se sostiene por simpleza, no por costo (`docs/10 §8.4` punto 1). Limitaciones: emulador y pila en el
mismo equipo; flujos sin filtro (cada uno recibe todo); sin proxy de por medio.

## 26. Bloqueo de la fila en la baja y la rotación: `FOR NO KEY UPDATE` (15/10/2026)

**Hallazgo.** La baja y la rotación toman la fila del dispositivo hasta confirmar, y la transacción espera dentro la respuesta del
broker (hasta 5 s). Cada trama y cada evento del mismo dispositivo insertan una fila hija por clave foránea, lo que toma
`FOR KEY SHARE` sobre esa fila; según la tabla de conflictos de bloqueos de fila de PostgreSQL, `FOR UPDATE` choca con
`FOR KEY SHARE` y `FOR NO KEY UPDATE` no. Como la recepción procesa un mensaje a la vez (`docs/10 §8.4` decisión 4), una trama
que espera retiene a las de todos los dispositivos.

**Medición** (`plataforma/pruebas/medir-bloqueo-fila.sh --desarrollo`, solo contra la base de desarrollo; dos sesiones, todo en transacciones que
terminan en `ROLLBACK` y el guion comprueba al final que no quedó ninguna fila; la sesión A toma la fila y duerme, la B espera a verla
dormida, es decir, con la fila ya tomada, e inserta una trama hija con `lock_timeout = '1s'`; el tiempo de B lo mide la base con
`clock_timestamp()`; tres corridas el 15/10/2026):

| Bloqueo en A | Inserción en B | Tiempo, en la base |
|---|---|---|
| `FOR UPDATE` | espera y la cancela el `lock_timeout` | 1 019 a 1 021 ms |
| `FOR NO KEY UPDATE` | entra sin esperar | 18 a 22 ms |

La primera medición del día, a mano, dio 1 069 y 68 ms: medía con el reloj del equipo, que suma el arranque del contenedor. Al
convertirla en guion apareció otro error de medición: la sesión B podía correr antes de que A tomara la fila, y entonces «entraba sin
esperar» por el motivo equivocado. Por eso B espera a ver a A dormida antes de insertar. El guion también exige que el código diga
`FOR NO KEY UPDATE OF d`; plantado el modo anterior, sale con falla.

**Corrección.** `FOR NO KEY UPDATE OF d` en `AltaService.bloquear`: dos bajas o rotaciones del mismo dispositivo siguen
ordenándose (ese modo choca consigo mismo) y ninguna de las dos cambia la clave de la fila. Las pruebas de
`baja-rotacion.spec.ts` exigen el modo nuevo y fallan con el anterior, pero solo comprueban el texto de la consulta; lo que prueba
el comportamiento es el guion de arriba. Queda para el banco: una rotación durante la carga, midiendo que el p95 de la recepción no
cambia.

## 27. El filtro 2 usa el formato declarado en el alta (15/10/2026)

**Qué cambió** (`docs/10 §8.4` puntos 25 y 47; migración 15). Hasta el 14/10 el filtro 2 probaba los adaptadores en orden y se quedaba
con el primero que reconociera la trama: un dispositivo dado de alta como `senml` podía mandar un número suelto y se guardaba como
`plano`. Desde el 15/10 usa el adaptador del formato que declaró el dispositivo; un dispositivo directo declara `senml` o `plano`, y
uno `lorawan` no lo envía en el alta: copia el de su pasarela (la base exige que sean iguales).

| Prueba | Resultado |
|---|---|
| SenML a un dispositivo que declaró `plano` | cuarentena `malformada` «formato declarado plano: la trama no tiene esa forma», sin lecturas, dispositivo vivo |
| Un número suelto a uno que declaró `senml` (el adaptador `plano` la habría entendido) | cuarentena `malformada` «formato declarado senml: la trama no tiene esa forma» |
| El mismo SenML a uno que declaró `senml` | guardada |
| Un formato de pasarela (`milesight`) por el tópico de un dispositivo directo | cuarentena `malformada` «formato declarado milesight: no se recibe por este tópico» |
| Alta `mqtt` con `formato: milesight` | 400 «formato debe ser una de: senml, plano» |
| Alta `lorawan` con `formato` | 400 «un dispositivo lorawan no lo declara, hereda el de su pasarela» |
| Alta `lorawan` sin `formato` y pasarela `chirpstack` | el INSERT, el evento y la respuesta llevan `chirpstack` |
| La pasarela cambia de formato entre la lectura y el INSERT (clave foránea compuesta) | 409 «el formato de la pasarela cambió durante el alta: repetirla» |

Pruebas unitarias en `recepcion.service.spec.ts`, `alta.dto.spec.ts` y `alta.service.spec.ts`: 200 en total (`pnpm test`). Plantado: con
el despacho anterior (el primer adaptador que reconozca) fallan las tres pruebas de recepción que dependen del formato declarado. La
demostración (`docs/15` §3) suma la fila del número suelto a un dispositivo SenML.

## 28. Adaptadores LoRaWAN contra el JSON oficial (15/10/2026)

**Qué se probó** (`docs/10 §8.4` punto 47; `lorawan.spec.ts`, 14 pruebas). Los adaptadores `chirpstack` y `milesight` con el JSON de las
fuentes oficiales: el ejemplo del evento `up` de la documentación de ChirpStack v4, con un `object` agregado, y la forma con códec y
Metadata de la guía de Milesight. Los identificadores con prefijo de un fabricante real del ejemplo se reemplazaron por valores
sintéticos.

| Caso | Resultado |
|---|---|
| `up` con `object` (`temperature`, `humidity`) | dos lecturas en la unidad canónica, con la marca del servidor de red (`+00:00` con nanosegundos → milisegundos) |
| Una clave fuera del mapa (`battery_voltage`) junto a una conocida | la conocida se guarda; la otra se anota para la línea de registro |
| Solo claves fuera del mapa | `malformada` «ninguna clave conocida (llegaron: battery_voltage)» |
| `up` sin `object` | `malformada` «el perfil del dispositivo en ChirpStack no tiene decodificador» |
| DevEUI del cuerpo distinto del tópico | `IdentidadCruzada` (desde §34, `IdentidadNoVerificada`), una malformada que no marca vivo; en mayúsculas cuenta como igual |
| Clave conocida con un valor que no es número | `malformada` «temperature: no es un número» |
| Hora sin zona | sin marca: rige la hora de recepción (Node la interpretaría en la zona del proceso: `docs/13` regla 17) |
| Milesight con códec y Metadata | tres lecturas, los metadatos no cuentan como claves ignoradas, sin marca de tiempo |
| Milesight sin códec (`data`, `fPort`, `rxInfo`) | `malformada` «activar Payload Codec y Metadata» |
| Milesight con códec y sin Metadata | `malformada` «sin devEUI: activar Metadata» |

**El mapa contra el catálogo.** Una prueba lee las migraciones (`INSERT INTO magnitud`) y exige que cada destino del mapa sea una magnitud
del catálogo con esa unidad canónica, y otra exige que el catálogo se haya leído (siete magnitudes o más), para que la primera no pase sin
revisar nada. Plantado: con `pressure` apuntando a una magnitud inexistente falla una; sin comparar el DevEUI fallan dos. Total: 214
pruebas. Falta la conexión con el filtro 1 (tópico de pasarela) y la prueba de punta a punta en el banco.

## 29. Filtro 1 para el tópico de pasarela (15/10/2026)

**Qué cambió** (`docs/10 §8.4` punto 47, §4.1 y §4.3). La recepción acepta `sitio/<sitio>/pasarela/<id>/<deveui>/<evento>` además del tópico
de dispositivo, con el orden del diseño: primero la pasarela (registrada, activa, del sitio del tópico), después el evento (solo `up`
sigue) y por último el nodo (su DevEUI en minúsculas, asociado a esa pasarela). Los filtros 2 a 6 son los mismos para las dos formas de
tópico; un formato de pasarela solo se acepta por el tópico de pasarela y uno directo solo por el de dispositivo.

| Prueba (`recepcion.service.spec.ts`, con dobles) | Resultado |
|---|---|
| `up` de un nodo asociado | lectura guardada, trama cruda con el adaptador `chirpstack`, nodo vivo |
| Evento `join` | se anota en el registro de depuración; ninguna escritura en la base |
| Pasarela sin alta, inactiva o de otro sitio | `no_registrado` con el motivo, con cualquier evento; nadie vivo |
| DevEUI asociado a otra pasarela | `no_registrado` «DevEUI … no está asociado a la pasarela …» |
| DevEUI en mayúsculas en el tópico | se busca en minúsculas y entra |
| DevEUI del cuerpo distinto del tópico | `malformada`; el nodo no se marca vivo |
| `up` sin ninguna clave del mapa | `malformada`; el nodo sí se marca vivo (dispositivo autenticado) |
| Formato directo por el tópico de pasarela | `malformada` «no se recibe por este tópico» |

Plantado, una falla por vez y restaurando el archivo original: sin pasar el DevEUI a minúsculas, con los eventos distintos de `up`
siguiendo al pipeline, y sin el retorno temprano de la identidad cruzada; cada uno hace fallar su prueba. Total: 222 pruebas. Falta el alta de
pasarelas por API, su rol en el broker y la prueba de punta a punta en el banco.

## 30. Pasarelas por API y su credencial (15/10/2026)

**Qué cambió** (`docs/10 §3` y §8.4 punto 47; migración 16). `POST /pasarelas`, `DELETE /pasarelas/{id}` y `POST /pasarelas/{id}/credencial`,
con la clave de administrador y el mismo todo o nada que los dispositivos; `GET /pasarelas` de lectura. La credencial de una pasarela vive
en `credencial` con un titular y solo uno, y la aplicación puede insertar y actualizar pasarelas. El rol `pasarela` del broker publica bajo
su árbol y se suscribe solo a su subárbol de comandos.

| Prueba | Resultado |
|---|---|
| Alta | pasarela, hash de su credencial, evento con `dispositivo_id` nulo y cliente con rol `pasarela` antes del COMMIT; el secreto en ningún parámetro SQL; plantillas `event_topic` y `command_topic` (ChirpStack) o el uplink con `$deveui` (Milesight) |
| Sitio inexistente o inactivo | 400 sin tocar el broker; sin administración del broker, 503 |
| El broker no responde | ROLLBACK y orden de borrar el cliente por si llegó a crearse |
| Baja | bloqueo `FOR NO KEY UPDATE`, `activo = false`, credenciales revocadas, nodos contados, `deleteClient` antes del COMMIT |
| Baja o rotación de una dada de baja, o de una inexistente | 409 o 404 |
| Rotación | la anterior inactiva, la nueva con su hash, `setClientPassword` antes del COMMIT, mismas plantillas |
| Migración 16 en una base desde cero | credencial sin titular o con dos, rechazada; la de una pasarela, aceptada; sin la regla fallan los dos casos (plantado) |
| Prueba de humo | contrato con 12 rutas y 15 operaciones; las tres rutas de pasarela que escriben, 401 o 503 sin la clave |

Unitarias en `pasarelas.spec.ts` (8). Plantado, restaurando el archivo original: con el rol de dispositivo para una pasarela falla el alta, y
con `FOR UPDATE` falla la baja. Total: 230 pruebas. Falta la prueba de punta a punta en el banco: alta real, publicación con la credencial,
la ACL del rol y la recepción por el filtro 1.

## 31. Rutas B y C de punta a punta en el banco (15/10/2026)

**Cómo** (`bash plataforma/pruebas/banco/banco.sh lorawan`). Contra el banco desechable, con el broker, el plugin de seguridad y la base
reales: se da de alta por API una pasarela ChirpStack, un nodo y una pasarela Milesight, y se publica con la credencial de cada pasarela el
JSON de su fuente oficial (evento `up` de ChirpStack v4; uplink con códec y Metadata de Milesight). Los secretos viajan por la entrada
estándar. Resultado: **25 de 25 comprobaciones, «LORAWAN OK»**; 26 de 26 desde la corrección de §32, 27 de 27 desde la de §33, 35 de 35 desde la de §34, 36 de 36 desde la de §35, 43 de 43 desde la de §36, 44 de 44 desde la de §38 y 46 de 46 desde la de §46.

| Comprobación | Resultado |
|---|---|
| Alta de la pasarela ChirpStack y de su nodo | 201; el nodo con el formato `chirpstack` de su pasarela; la respuesta con el `event_topic` |
| `up` publicado en su árbol | aceptado; la lectura en `medicion` con origen `pasarela` |
| `join` | sin cuarentena; DevEUI no asociado → `no_registrado`; DevEUI cruzado → `malformada` y el nodo no se marca vivo; SenML bajo la pasarela → `malformada` |
| ACL del rol `pasarela` | no publica en el árbol de otra pasarela ni como dispositivo directo (RC:135); se suscribe a su subárbol de comandos (código 0) y no a los de otra ni a todo el sitio (135); un emulado no publica en su árbol (RC:135) |
| Pasarela Milesight | 201 con el tópico del uplink con `$deveui` (minúsculas desde el 20/10, `§45`); con códec y Metadata, 3 lecturas con la hora de recepción; sin códec, `malformada` que dice qué activar |
| Rotación | la credencial anterior ya no entra; la nueva publica |
| Baja | 200 con un nodo sin pasarela; el broker rechaza su credencial; `GET /pasarelas` la lista inactiva |
| Registro del backend | ninguna credencial de pasarela escrita |

**Plantado.** En el broker del banco se quitó al rol `pasarela` el permiso de suscribirse a su subárbol de comandos: la prueba dio una falla;
restaurado, «LORAWAN OK». Al escribir el plantado, dos intentos no llegaron a aplicarse (el guion no cargaba la orden que quita el
permiso) y la prueba seguía en verde: ahora el plantado exige que la orden se cumpla antes de mirar el resultado.

**Lo que no prueba.** La radio, la pasarela física y el ChirpStack institucional: eso es la prueba en terreno (`docs/10 §8.4` punto 47). Lo
que sí deja probado es todo lo que pasa desde que un mensaje llega al broker con la credencial de una pasarela.

## 32. Correcciones al cierre del bloque LoRaWAN (15/10/2026)

Una revisión del bloque completo (de `docs/10 §8.4` punto 47 al banco) encontró 16 puntos; todos se verificaron en el código antes de
corregirlos. Los que cambian el comportamiento, cada uno con su prueba y plantado:

| Corrección | Prueba |
|---|---|
| El alta de un nodo lee su pasarela con `FOR SHARE`: ya no puede cruzarse con la baja de esa pasarela y dejar un nodo asociado a una pasarela dada de baja | `alta.service.spec.ts` exige el bloqueo; el banco da de alta un nodo contra la pasarela ya dada de baja → 400 «la pasarela … está dada de baja» (26 de 26) |
| La aplicación actualiza solo la columna `activo` de `pasarela` (migración 16): un error no puede cambiar su sitio, su identificador ni su formato, que se propaga a los nodos | guardián (paso 2): `UPDATE` en `activo` sí, en `formato` y `sitio_id` no; la baja del banco funciona con ese permiso |
| El filtro 1 de pasarela compara también el sitio del nodo con el del tópico (defensa en profundidad) | `recepcion.service.spec.ts`; plantado sin la comparación, falla |
| Un adaptador LoRaWAN sin DevEUI en el tópico rechaza la trama en vez de omitir la comparación | `lorawan.spec.ts`; plantado con la comparación abierta, falla |
| Los eventos distintos de `up` se anotan en el registro de depuración (antes en el informativo, que con muchos nodos se llenaba); la prosa dice «se anota», no «se cuenta» | lectura del código y de `docs/10` |
| `medir-bloqueo-fila.sh` exige `--desarrollo` y exige también en el código el bloqueo de la pasarela (la medición con dos sesiones sigue siendo la del dispositivo) | sin la bandera no corre; con ella, «BLOQUEO DE FILA OK» |

Además: nuevas pruebas del 409 por identificador repetido y del nodo dado de baja por el tópico de su pasarela; mensajes de alta que
nombran la pasarela; fuentes públicas con URL y cita en el punto 47, en lugar de remitir a evidencia no publicada; estados unificados en `docs/10`,
`docs/11` y `docs/13`; y en el repositorio público, cero horarios en las bitácoras y cero referencias a registros privados, con los
chequeos 2f2 y 2p ampliados y plantados. Total: 234 pruebas.

## 33. Seguridad, concordancia y privacidad del bloque LoRaWAN: lo medido y lo corregido (15/10/2026)

Tres revisiones del bloque completo, una por ángulo. Ningún hallazgo alto: ninguna pasarela puede publicar ni leer fuera de su árbol ni
hacerse pasar por un nodo de otra pasarela o de otro sitio. Lo que se midió en el banco en vez de suponerlo:

| Pregunta | Medido | Consecuencia |
|---|---|---|
| ¿La rotación de la credencial corta una sesión MQTT ya abierta con la clave anterior? | Sí: con una sesión viva (control previo), el broker la cierra al rotar («Not authorized») | Nada que corregir; una clave filtrada deja de servir al rotar |
| ¿Y la baja? | Sí, la cierra igual | Ídem |
| ¿Un mensaje publicado con retención se vuelve a procesar? | Sí: 1 lectura al publicarlo, 2 tras reiniciar el backend (el broker se lo reentrega al suscribirse) | **Corregido:** el backend confirma y descarta todo mensaje que llega con la marca de retenido, que solo aparece en esa reentrega; prueba unitaria y plantado |

Corregido además: un cuerpo sin DevEUI, o que no tiene la forma del formato, ya no marca vivo al nodo por el tópico de pasarela (sin
identidad verificada no hay señal de vida); dos claves que apuntan a la misma magnitud dejan una sola lectura; las claves desconocidas
se recortan y se limpian de caracteres de control antes de ir al detalle o al registro; la pasarela no puede publicar en su propio
subárbol de comandos (el banco lo comprueba: RC:135); reejecutar la migración 14 ya no borra los permisos sobre `pasarela`; y en los
documentos, el estado de HU-02, las filas de entradas de `docs/10`, el conteo de rutas de la API, el motivo `no_registrado` de
`docs/11`, el punto 24, el diagrama del alta y RF-36. Total: 238 pruebas.

**Límites que quedan, con su porqué:**
- **Sin tope por emisor.** Una pasarela comprometida puede llenar la cuarentena con tramas de DevEUI inventados (cada una con su carga
  cruda, 30 días) y el registro con avisos. Los topes de `docs/10 §8.4` punto 29 siguen pendientes; se resuelve con la decisión de
  límites del proxy y del filtro 1.
- **Marcas antiguas aceptadas.** Un servidor de red puede mandar `time` de hace días: la regla 7 de `docs/13` los acepta a propósito,
  porque una pasarela sin red guarda hasta 500 paquetes y los reenvía después. Acotar el pasado para el origen `pasarela` quedó
  decidido el 21/10 y hecho el 22/10 (regla 18 de `docs/13`, §46): más de 10 min atrasada, hora de recepción y condición `reloj_desviado`.
- **Alta repetida con un error ambiguo del broker.** Si el broker no confirma a tiempo el alta A y, entretanto, el alta B del mismo
  identificador crea su cliente, el borrado de A puede llegarle después: B queda con una credencial que el broker no tiene. Falla
  cerrado (no entra nadie) y la rotación lo repara.

## 34. Segunda revisión del bloque LoRaWAN: lo verificado y lo corregido (15/10/2026)

Tres revisiones independientes (seguridad, concordancia y privacidad) sobre las correcciones de §33. Cada hallazgo se verificó en el
código o en la fuente antes de corregirlo; los que admitían una prueba se plantaron primero (la prueba falla con el código anterior).

| Pregunta | Medido o verificado | Consecuencia |
|---|---|---|
| ¿Un JSON roto por el tópico de una pasarela marca vivo al nodo? | Sí: el adaptador lo rechazaba como una malformada común y el filtro 6 corría igual | **Corregido:** un cuerpo ilegible tampoco deja verificar el DevEUI; va a cuarentena y no hay señal de vida (`docs/10 §4.1`) |
| ¿Y un nodo de formato directo asociado a una pasarela? | Hoy no puede existir (clave foránea compuesta de la migración 15), pero ese camino marcaba vivo | **Corregido** como defensa en profundidad, con su prueba unitaria |
| ¿Se pierde un mensaje retenido publicado con el backend caído? | No, con la sesión persistente: la copia de la cola llega con la marca en cero y se guarda una vez, y la copia retenida que el broker reentrega al reconectar se descarta. Sin el descarte (plantado): **2 lecturas** en vez de 1 | Se pierde solo si el backend no tenía sesión (primer arranque, sesión perdida): límite aceptado (`docs/10 §8.4` punto 50) |
| ¿Sirve `retain_available false` para que nadie publique con retención? | El broker desconecta a quien lo haga, pero su código (versión 2.1.2) muestra que también deja de retener sus contadores `$SYS`, que publica solo cuando cambian: al reconectar, el backend no tendría el contador de descartes | **Descartado.** Queda el descarte del backend; su condición (suscripción MQTT 3.1.1 sin *Retain As Published*) tiene una prueba unitaria, plantada con las dos variantes |
| ¿La integración MQTT de ChirpStack publica con retención? | No: `publish(topic, self.qos, false, b)` en su código fuente | Nada que cambiar en la ruta C |
| ¿Las claves desconocidas quedan limpias de todo lo invisible? | No del todo: quedaban los controles C1, los que invierten la dirección del texto y los separadores de línea, y el recorte podía partir un emoji | **Corregido:** fuera las categorías de control y formato de Unicode, y recorte por caracteres |

**Banco:** el corte de la sesión al rotar y al dar de baja y los dos casos de retención eran mediciones a mano; ahora son comprobaciones
de `banco.sh lorawan`, con una sesión de control que prueba que la detección ve una sesión viva: **35 de 35, «LORAWAN OK»**. Con las
dos fallas plantadas (JSON roto que marca vivo y retenido sin descartar), el banco da 4 comprobaciones con falla. Método: el plantado
se hace apagando y encendiendo el banco; reconstruir solo su backend recreó la base, que vive en memoria, y se perdió la siembra.

Corregido además en los documentos: el avance del núcleo en `docs/18` (9 parciales y 53 h, no 8 y 47 h: faltaba HU-02), el permiso
del rol `pasarela` en `docs/11`, la fila de mensajes retenidos de `docs/10 §4.1`, la cabecera de la migración 14 y menciones de la hora
del día. El guardián suma tres pasos: el horario personal en todo archivo versionado, el avance calculado desde las filas y el conteo de
este banco frente a lo que cita este documento. Total entonces: 240 pruebas.

## 35. Tercera revisión: el capítulo de pruebas del informe y lo que trajo (15/10/2026)

El bloque (correcciones de §34 y capítulo 5 del informe) se revisó desde tres ángulos: seguridad, concordancia y privacidad.
Cada hallazgo se verificó en el código o en la fuente; los de código se plantaron antes de corregir.

| Pregunta | Medido o verificado | Consecuencia |
|---|---|---|
| ¿Un DevEUI con un salto de línea en el cuerpo llega al registro? | Sí: el motivo lo copiaba tal cual. El broker rechaza los caracteres de control en el tópico (validación UTF-8 de Mosquitto 2.1.2), no en el cuerpo | **Corregido:** el DevEUI del cuerpo se compara solo si es ASCII (letras, dígitos y guion) (así tampoco calza una letra Unicode que en minúsculas se vuelve ASCII, como el signo Kelvin), y todo texto de afuera pasa por una sola limpieza (`recepcion/texto.ts`): controles, separadores salvo el espacio y rellenos invisibles |
| ¿Los segmentos del tópico van limpios al detalle de la cuarentena? | No: solo se recortaban | **Corregido** con la misma limpieza |
| ¿La prueba de que la baja corta la sesión comprobaba que la sesión había abierto? | No tenía control; y el control de la rotación solo comprobaba que el proceso cliente siguiera vivo, no que el broker lo hubiera aceptado | **Corregido:** la evidencia es el registro del broker: la salida de `mosquitto_sub` queda en un búfer hasta que el programa termina, así que no sirve para saber si ya se suscribió; la sesión cuenta como abierta si el broker registró su conexión, y como cortada si el broker la desconectó «por acción administrativa» antes de su plazo y la sesión se había suscrito |
| ¿Las comprobaciones de retenidos y de «no marca vivo» podían dar verde sin que el backend hubiera procesado nada? | Sí: esperaban un tiempo fijo, y dos «visto» vacíos se daban por iguales | **Corregido:** se espera a ver lo que debía ocurrir (la lectura de la cola, los avisos, la cuarentena con su motivo) y el «visto» no puede estar vacío |
| ¿La conexión MQTT 3.1.1, de la que depende el descarte de retenidos, era explícita? | No: venía del valor por defecto de la librería | **Corregido:** explícita, y la prueba la fija |

En el informe: el plan B de R1 se activó el 7/10 (no el 8/10); el bloqueo de fila podía frenar la recepción hasta 5 s (el
segundo medido era el tope de la prueba, §26); las conclusiones separan lo que se cumple de lo parcial; el verificador se cita
por sus pasos (hoy 40) y las pruebas del panel (52) junto a las del backend; los documentos nombran los anexos en vez de citar una
letra que cambia al insertar uno. El guardián vigila esas cifras (paso 2w4) y sus pasos 2f2, 2w2 y 2w3 ya no pueden pasar sin
revisar nada. **Banco:** 36 de 36, «LORAWAN OK».

**Revisión general de lo anterior (15/10):** el id del tópico directo y las líneas del registro que citan el tópico también pasan por
la limpieza (el tópico crudo queda en su columna de la cuarentena como evidencia); se suman a los rellenos los selectores de variación
que faltaban; el informe dice ahora que el JSON del banco es el de la documentación oficial de ChirpStack v4 y de Milesight, no el
que publica el ChirpStack del campus, todavía no probado; y el guardián busca el nombre del entrevistado también en el código.
Total: 270 del backend y 52 del panel.

## 36. La trama real de la pasarela del campus: sufijo nativo, perfil de decodificación y contador de trama (16/10/2026)

**Qué cambió** (`docs/10 §8.4` punto 47 y §4.1; migración 17). La captura del broker de la red del campus (15/10) mostró que su
pasarela UG65 publica el uplink sin decodificar (`data` de 10 bytes en base64), con `time` en UTC con zona y `fCnt`, en su tópico
nativo. Desde ahora: (i) el filtro 1 acepta también `sitio/<sitio>/pasarela/<id>/device/<deveui>/event/<evento>`, la forma que deja
un puente de Mosquitto al cambiar el prefijo, y el alta de una pasarela `milesight` trae esa línea del puente; (ii) un nodo
LoRaWAN puede declarar un perfil de decodificación (`dispositivo.decodificador`) y el adaptador decodifica `data` con él (primer
perfil: `campus-heltec-v3-v1`; magnitud nueva `tension`, en V); (iii) en esa forma, `time` con zona es la marca del servidor de red;
(iv) el filtro 3 descarta la trama que repite el `fCnt` de la última guardada del nodo (`estado_dispositivo.ultimo_fcnt`); revisado el 17/10 (§42): el 0 y el ausente no se comparan, y una trama sin contador lo borra.

| Pregunta | Medido o verificado | Consecuencia |
|---|---|---|
| ¿El perfil decodifica la trama real? | Sí: los 10 bytes de la captura, con los identificadores reemplazados por sintéticos, dan 18,16 °C, 65,52 % y 3,75 V con la marca `2026-10-15T15:34:56.340Z` (sintética, como los identificadores); una temperatura bajo cero sale con signo (−5,25 °C) y la batería va de 2,00 a 4,55 V | Pruebas unitarias en `lorawan.spec.ts`; en el banco, las tres lecturas con origen `pasarela` |
| ¿Una `data` corrupta pasa como otros bytes? | No: `Buffer.from(…, 'base64')` ignora en silencio lo que no es base64, por eso se exige base64 estricto antes de decodificar; 9 bytes, sin relleno o con un espacio → `malformada` que lo dice, y el nodo se marca vivo (su DevEUI ya se verificó) | Probado en la unidad y en el banco |
| ¿Sin perfil sigue el comportamiento anterior? | Sí: `malformada` «activar Payload Codec y Metadata…, o declarar el perfil de decodificación del nodo»; en ChirpStack sin `object`, lo mismo con su texto | Probado |
| ¿La lista de perfiles del código es la del `CHECK`? | Una prueba lee la última migración que define `ck_dispositivo_decodificador` y compara; otra exige que cada lectura del perfil exista en el catálogo con su unidad canónica | Plantado: un perfil más en el código hace fallar las dos |
| ¿La trama repetida con otra hora se descarta? | En el banco, la captura por el sufijo nativo y otra vez con el mismo `fCnt` y 10 s después: 3 lecturas, ninguna cuarentena, la línea «trama repetida (fCnt 142…)» en el registro y el nodo vivo; con `fCnt` 143, 3 lecturas más y `ultimo_fcnt` = 143 | Plantado en la unidad: sin la comparación, falla la prueba de la repetida |
| ¿Un corte a mitad pierde la reentrega? | El contador se guarda en el filtro 6, después de las lecturas y solo si dejó alguna nueva; si la trama no guardó nada (repetida por canal + instante, o sin `fCnt`), el contador no cambia | Plantado: guardarlo siempre hace fallar dos pruebas |
| ¿Un `fCnt` menor se rechaza? | No: se acepta y pasa a ser el último (el contador vuelve a cero cuando el nodo se une otra vez a la red); fuera de 0..2³²−1, no entero o como texto → `malformada` | Probado |
| ¿Una forma a medias del tópico entra? | No: `…/device/<deveui>/up` y `…/<deveui>/event/up` → `malformada` «tópico fuera de los dos patrones», sin marcar vivo a nadie | Probado |
| ¿La base cierra lo mismo que el código? | Casos 15 a 19 de `reglas-identidad.sql`: perfil en un dispositivo `mqtt` y perfil fuera de la lista, rechazados por su restricción; perfil legítimo aceptado; contador 2³² rechazado y 2³²−1 aceptado. El alta da el mensaje claro antes («decodificador solo aplica a la vía lorawan») | Guardián, pasos 1c y 2 |

La migración se aplicó desde cero en el banco (`banco.sh encender`, repetible) y, a mano, dos veces seguidas en la base de desarrollo,
sin cambios en la segunda (ningún paso del guardián la reaplica). **Pruebas:** 263 unitarias del backend (19 nuevas). **Banco:** 43 de 43, «LORAWAN OK» (7 comprobaciones nuevas: la línea del puente, el perfil
rechazado en `mqtt`, el alta con perfil, la captura decodificada, el `fCnt` repetido, el nuevo y la `data` corta).
**Lo que no prueba todavía:** la pasarela real ni el puente de Mosquitto (prueba en la misma red local prevista para el 20/10/2026);
un `fCnt` igual a 0 en ChirpStack, que el JSON de Protocol Buffers omite, no se deduplica; una repetición no consecutiva (N, N+1, N)
pasa el filtro 3 y solo la absorbe el índice único si trae la misma hora (`docs/10 §4.1`).

**Revisión del bloque (16/10):** el diagrama de secuencia y el comentario del filtro 6 no mostraban el contador (corregidos y
regenerada la figura); una trama que repetía el `fCnt` y el adaptador no entendía se anotaba además como «repetida» (corregido:
va solo a `malformada`; prueba nueva, plantada); la línea del puente reenviaba todo `device/#`, comandos incluidos, y ahora solo
`device/+/event/#`; la descripción de `POST /pasarelas` nombra la línea del puente; el informe dice «la forma de la captura,
saneada», porque el banco no pasó por la pasarela real.

## 37. El puente de la red del campus y la idempotencia de las migraciones, en el banco (16/10/2026)

**Puente** (`banco.sh puente`; `docs/10 §8.4` punto 47). Un segundo Mosquitto hace de broker del operador de la red: anónimo, como
el suyo, y con un bloque `connection` como el del ejemplo que se le entrega, con la línea `topic` tal cual la devuelve el alta de la
pasarela, TLS hacia el 8883 del proxy con verificación del certificado (`bridge_insecure false`) y la credencial de una pasarela de
descarte. La configuración con la credencial vive en la carpeta privada del banco, la escribe una sola invocación y se borra al final.

| Pregunta | Medido | Plantado |
|---|---|---|
| ¿El puente entra como la pasarela, por TLS verificado? | Sí: nuestro broker registra su conexión con el id de cliente y el usuario de la pasarela; la verificación del certificado se prueba plantando | A mano: con otra CA en el broker del operador, «A TLS error occurred» y no se conecta |
| ¿La captura publicada en el tópico nativo llega a `medicion`? | Sí: 18,16 °C, 65,52 % y 3,75 V; la trama cruda muestra `…/pasarela/<id>/device/<deveui>/event/up`, solo con el prefijo cambiado | — |
| ¿Un comando del broker del operador cruza? | No: la línea reenvía solo `device/+/event/#` | A mano: con `device/#`, el comando cruza y deja una cuarentena |
| ¿Lo que publique un anónimo en el broker del operador nos llega? | Sí, como la pasarela: es el riesgo de un broker sin autenticación. El filtro 1 lo frena si el DevEUI no está dado de alta (`no_registrado`) | — |
| ¿La baja de la pasarela corta el puente? | Sí: el broker desconecta al cliente | — |
| ¿La credencial aparece en el registro del backend? | No | — |

Resultado: **10 de 10, «PUENTE OK»**. **Por dirección IP** (`banco.sh puente ip`), como se conectará la pasarela del campus al
portátil en la red local: un certificado de descarte con la IP en el SAN (`CA_IP_EXTRA`), el proxy publicado solo en ella
(`PROXY_IP_DISPOSITIVOS`) y el puente conectándose por IP con verificación. Se usa `127.0.0.2`, otra dirección de *loopback*: la misma
mecánica sin exponer nada a la red. 11 de 11; plantado a mano un certificado **sin** la IP, el puente no se conecta («A TLS error occurred»).
**Limpieza:** una sola función, registrada apenas se toca el proxy, borra el broker del operador y su configuración con la credencial,
revoca la pasarela de descarte si sigue activa y devuelve el proxy a sus certificados y a su dirección, avisando si no puede. Plantado
a mano: un corte antes de crear la pasarela deja el proxy restituido y nada en disco; un corte justo después la deja revocada (inactiva
y sin claves activas). Si el backend no está sano, el proxy no puede volver y la limpieza lo avisa y conserva los certificados de descarte. Lo que no prueba: la pasarela real, el Mosquitto del operador ni la
red de la facultad (la IP del portátil allí se conoce el mismo día).

**Migraciones** (`banco.sh migraciones`, al final de cada `banco.sh encender`; `docs/08 §6`). En `encender`, con la base recién creada (suelto, sobre la que haya), se reaplican
de la 02 a la 17 y se compara un resumen del esquema completo (`pg_dump -s`: tablas, restricciones, índices, permisos y comentarios)
y del catálogo de magnitudes. **La primera corrida encontró un error real:** las 16 se reaplicaban sin error, pero el esquema
cambiaba. La 05 renombraba toda restricción cuyo nombre no fuera el que ella calcula, también las que una migración posterior nombró a
propósito: reaplicada después de la 08, la 13, la 15 y la 16, cambiaba `ck_medicion_recepcion`, `ck_credencial_titular`,
`fk_dispositivo_pasarela_formato` y las de `metrica_broker`, y esas migraciones, al no encontrar su nombre, duplicaban la restricción.
**Corregido:** la 05 renombra solo los nombres con la forma que pone Postgres cuando nadie nombra la restricción (`<tabla>_pkey`, `_fkey`, `_key`, `_check`, sin prefijo); un nombre elegido por una migración se respeta. Una instalación nueva queda idéntica a la de
antes de la corrección, la base de desarrollo no tenía duplicados (consultado) y la 05 vieja, plantada, hace fallar la comprobación.
«Sin error» no basta: lo prueba este caso. Tres detalles del volcado, medidos: lleva una línea `\restrict` con un token aleatorio
(se excluye); los fragmentos de TimescaleDB nacen cuando el backend guarda datos entre las dos fotos (se excluye su esquema interno);
y el primer fragmento de una tabla cambia el orden en que `pg_dump` la escribe (se compara el conjunto de líneas, ordenado).
La foto incluye también los trabajos de TimescaleDB y el catálogo completo, y si sale casi vacía (base caída) la comprobación falla en
vez de comparar dos vacíos (plantado: base detenida → «la foto del esquema salió casi vacía»). Resultado: 16 de 16 reaplicadas sin
cambios en `encender` y en tres corridas más lanzadas a mano, separadas por 30 s con el backend guardando (medido antes de la 18;
desde la §38 son 17). Se hace en el banco y no en el
guardián porque reaplicar en la base de desarrollo la escribiría en cada corrida y bloquearía tablas mientras el backend guarda.

## 38. Suelo del nodo propio: magnitudes y calibración por canal (migración 18, 16/10/2026)

**Qué cambió** (`docs/10 §8.4` punto 51). Dos magnitudes, `temperatura_suelo` (Cel, −55 a 125, el rango del DS18B20 en su hoja de datos)
y `humedad_suelo` (V, 0 a 3,3: la tensión cruda del sensor capacitivo; el porcentaje se calcula), y la calibración por canal
(`canal.escala_cero`, `canal.escala_cien`). La unidad es V y no mV porque SenML desaconseja los prefijos (RFC 8428) y registra «mV» solo
como unidad secundaria (RFC 8798); un emisor que mande `mV` se convierte (1/1000).

| Pregunta | Medido o verificado |
|---|---|
| ¿La calibración exige las dos escalas, distintas? | Casos 20 a 22 de `reglas-identidad.sql`: una sola escala y el 0 % igual al 100 %, rechazadas por `ck_canal_escala`; la del suelo (0 % al aire 2,65 V, 100 % en agua 1,20 V, con el 100 % por debajo), aceptada |
| ¿`mV` se convierte bien? | 2650 mV → 2,65 V (prueba unitaria); plantado a mano el 16/10 un factor de 1/100, la prueba falla. V a mV no se inventa |
| ¿La migración se aplica desde cero y se repite sin cambiar nada? | `banco.sh encender`: la base nueva la trae; las 17 reaplicables, idempotentes |
| ¿En la base de desarrollo cambió solo lo esperado? | Aplicada dos veces; la foto del esquema antes y después difiere solo en las dos columnas, la restricción, sus dos comentarios y las dos magnitudes |

| ¿La calibración admite NaN o infinito? | Ya no: la primera versión los aceptaba (comprobado en el banco: `NaN` e `Infinity` entraban) y el % habría salido basura. La regla exige escalas finitas; casos 23 y 24, plantados. Al reescribirla se perdió el `IS NOT NULL` explícito y el caso 20 lo detectó al instante: con una sola escala, la comparación da «desconocido» y un `CHECK` así se da por cumplido; restituido |
| ¿La API entrega el %? | Una sola función (`consulta/escala.ts`, con pruebas: extremos, recta invertida, recorte, sin calibración, NaN, infinito y división por cero) y la usan la ficha y el histórico. En el banco, con una calibración puesta en la base, la última humedad (65,52) sale 32,8 % en la ficha y en el histórico, y un canal sin calibración trae `null` (`banco.sh lorawan`) |

| ¿El panel lo muestra sin repetir la cuenta? | El evento `medicion` del canal en vivo trae `porcentaje`, calculado en la recepción con la misma función (prueba: calibración 0–50 y lectura 22,4 → 44,8 %); la ficha lo muestra junto al valor crudo solo si es un número, así un evento sin el campo no rompe la tarjeta (prueba del panel; plantado a mano el 16/10: si la ficha no copia el campo, falla) |

**Lo que falta:** la ruta para editar la calibración, con su permiso (se concede cuando exista la ruta: mínimo
privilegio) y la validación de que las escalas caigan en el rango de la magnitud. **Pruebas:** 270 unitarias del backend y 52 del panel.

## 39. La ficha del dispositivo en un navegador real (16/10/2026)

**Qué es** (`docs/19 §6` y §7, fila P3; cierra HU-21). `banco.sh navegador` abre el panel que sirve el banco en Firefox, manejado por
Playwright 1.63.0 (Apache 2.0; dependencia de desarrollo del panel, versión fijada, publicada hace más de un mes; su Firefox se
descarga una vez, 311 MB medidos), y recorre P3 con las
manos de una persona: elige el canal con un clic, compara, publica, detiene el backend. Siembra tres lecturas pasadas para que el
histórico tenga puntos y deja una captura en la carpeta privada del banco. Guion: `plataforma/backend/panel/e2e/p3.mjs`.

| Comprobación | Resultado |
|---|---|
| Los puntos del gráfico (texto y gráfico) son los de `/historico` | ✅ |
| La leyenda del tiempo dice «Hora» y el gráfico no trae am/pm ni «Time» en su texto | ✅ (el eje se dibuja en un lienzo y no se puede leer como texto: su formato de 24 h se revisó en la captura) |
| Una trama publicada por MQTT aparece en su tarjeta sin recargar | ✅ |
| Con el backend detenido, la ficha dice «reconectando»; al volver, muestra la lectura publicada durante la caída, repite el histórico (se ve la petición) y vuelve a «conectado» | ✅ |
| Sin errores de JavaScript en la página | ✅ |

Resultado: **9 de 9, «P3 NAVEGADOR OK»**, tres corridas seguidas (salidas guardadas fuera del repositorio). **Plantado:** sin el repetido al reconectar (reconstruida la imagen
del banco), fallan dos comprobaciones: la lectura de la caída no aparece y el histórico no se pide de nuevo.

**Lo que trajo el navegador real**, que jsdom no muestra porque no dibuja: el eje del gráfico decía «9:30pm» y la leyenda «Time» (los
valores por defecto de uPlot, en inglés de 12 h), y la tabla de condiciones mostraba el código `sin_comunicacion`. **Corregido:** horas
en 24 h y meses en español con la función de formato de uPlot (prueba con esa misma función: 21:30, «16/10/2026 21:30», «oct», y
ninguna plantilla de 12 h), y un rótulo legible por tipo de condición (prueba). **Dos errores de la propia prueba, encontrados al
repetirla:** la ficha abre el primer canal en orden alfabético (humedad) y la prueba comparaba con el histórico de la temperatura; y dos
lecturas publicadas en el mismo segundo eran, por la regla de idempotencia (`docs/10 §4.1`), la misma lectura, así que la segunda se
ignoraba: la prueba publica ahora con milisegundos. **Del guardián:** contaba como prueba del panel el `.test(` de una expresión
regular (50 en vez de 49); corregido. Y no revisaba la sintaxis de los guiones: una línea de comentario sin `#` dejó `banco.sh` sin
interpretarse y solo lo delató la siguiente corrida; desde ahora el paso 2y2 corre `bash -n` sobre cada guion (plantado uno roto: falla).
**De la revisión del tramo:** si la publicación fallaba con el backend detenido, el banco quedaba con el backend apagado (ahora se
arranca siempre); las comprobaciones del estado en vivo y de la leyenda se acotan a su elemento. **Pruebas:** 270 del backend y 52 del panel.

## 40. El inventario con varios sitios (16/10/2026)

**Qué cambió** (`docs/19` P2; cierra HU-20). `GET /dispositivos` y `GET /dispositivos/{id}` entregan también el código del sitio y el
id de la zona; el inventario filtra por ellos, nunca por el nombre, porque dos sedes pueden tener una zona con el mismo nombre. Con más
de un sitio aparecen el filtro por sitio y la columna Sitio, y la zona se elige dentro del sitio elegido (si se cambia de sitio y la
zona no es de él, vuelve a «todas»). Con un solo sitio no aparecen: no informan nada.

| Comprobación | Resultado |
|---|---|
| Un solo sitio: ni filtro ni columna | ✅ (prueba del panel) |
| Dos sedes con una zona «Lab» cada una: sin sitio elegido, las zonas se distinguen por su sitio («Campus · Lab», «Sede Norte · Lab»); elegir la del campus no trae la de la otra sede; al cambiar a la otra sede, la zona vuelve a «todas» y solo quedan sus dispositivos | ✅ (prueba del panel) |
| Combinado con la búsqueda, el conteo «N de M» dice lo que queda (1 de 5; con un texto ajeno, 0 de 5 y el vacío lo explica) | ✅ (prueba del panel) |
| Dos sitios con el mismo nombre (el nombre no es único; el código sí) se distinguen por su código: «Campus (uct)», «Campus (campus-2)» | ✅ (prueba del panel) |
| Si el sitio elegido desaparece del inventario al recargar, el filtro vuelve a «todos» (un filtro sin su control a la vista ocultaría filas) | ✅ (código; revisión del 16/10) |
| Plantado: agrupar las zonas por nombre en vez de por id | la prueba de varios sitios falla |
| Contra la base del banco: una segunda sede con una zona «Emulados» y un dispositivo (a mano, con `psql`; no la repite ningún guion) | la API entrega las dos zonas con el mismo nombre y distinto id, y la ficha trae su sitio y su zona |

**Pruebas:** 270 del backend y 52 del panel. **Un tropiezo de la medición:** el primer intento de crear la sede falló porque `zona` no
tiene `creado_en` (se supuso sin mirar el esquema); el segundo, porque la extracción del id tomó la línea de guiones del encabezado de
`psql`. Ninguno era del sistema.


## 41. La recepción por HTTP (16/10/2026)

**Qué cambió** (`docs/10 §8.4` punto 52; cierra HU-01, RF-01). `POST /recepcion/{idFisico}` recibe una trama de un dispositivo de vía
`http` con el token que entregó el alta en `Authorization: Bearer`. El cuerpo llega crudo, hasta 64 KiB (el mismo tope del broker), y
pasa por los mismos filtros 2 a 6 que una trama MQTT; el filtro 1 compara el token con la huella `scrypt` de la credencial activa. Un
dispositivo que no existe se verifica igual, contra una huella de relleno: el tiempo de respuesta no dice qué identificadores existen.
Los topes salen del costo medido en el portátil: 65 ms por verificación y 57 por segundo con los 4 hilos de Node.

| Comprobación (`banco.sh http`, de punta a punta; dos corridas seguidas) | Resultado |
|---|---|
| Alta de dos dispositivos de vía http por la API, cada uno con su token (no se imprime) | ✅ |
| SenML válida → 202 con el resumen, y la lectura en `medicion` | ✅ |
| La trama cruda guarda la ruta HTTP y el adaptador (RF-09) | ✅ |
| La misma trama antes de un segundo → 429; pasado el segundo → 202 con 1 repetida, sin duplicar la lectura (RF-10) | ✅ |
| Una trama que no se entiende → 422 con el motivo, y a cuarentena con origen `http`; ninguna lectura válida (fuera de rango) → 422 | ✅ |
| Formato plano con `?magnitud=` → 202 y la lectura en `medicion` | ✅ |
| Un cuerpo que no es JSON ni texto → 415; más de 64 KiB → 413 | ✅ |
| Un cuerpo que el lector no puede leer (`Content-Encoding: gzip` sin gzip) → 400 | ✅ |
| La ruta en mayúsculas → 202 con el cuerpo leído (antes de la revisión llegaba vacío) | ✅ |
| Por el proxy, una dirección falsa en `X-Forwarded-For` no se cree (el registro anota la que vio el proxy) | ✅ |
| Token malo, dispositivo desconocido, sin cabecera y token de otro dispositivo → el mismo 401 | ✅ |
| A los 5 fallos de autenticación la dirección queda bloqueada (429), incluso con un token bueno | ✅ |
| Al reiniciar el backend la dirección queda libre; dado de baja por la API, su token ya no entra (401) | ✅ |
| Ningún token aparece en el registro del backend | ✅ |
| La vía MQTT no cambió: en el mismo banco, `lorawan`, `puente`, `puente` con dirección y `alta`, después de las correcciones | ✅ |

| Pruebas unitarias (`backend/src/recepcion/http/`) | Resultado |
|---|---|
| Topes con un reloj de mentira: bloqueo a los 5 fallos y su vencimiento, ventana de 60 s, IPv6 por /64, tope de direcciones sin soltar un bloqueo vigente, cupo de 2, una trama por segundo | ✅ (6) |
| Filtro 1 HTTP: token correcto; equivocado, de otra vía, de baja o sin credencial activa → no; desconocido → no, y verifica igual; la consulta lleva tiempo máximo; un fallo al calcular la huella de relleno no queda guardado | ✅ (5) |
| Controlador: 202, 401 sin tocar la base, 415 antes que el token, 422 y 202 según el resumen, bloqueo por dirección, ritmo, 503 con el cupo lleno, cupo liberado si la verificación lanza, id con salto de línea saneado en el registro, baja | ✅ (10) |
| Plantado: verificar solo si el dispositivo existe (sin huella de relleno) · aceptar un dispositivo de vía mqtt · quitar el ritmo · no contar una trama solo repetida como útil | cada uno hace fallar su prueba |
| Plantado (tras la revisión): IPv6 sin agrupar · no soltar direcciones sobre el tope · registro sin sanear · guardar el fallo de la huella de relleno · consulta sin tiempo máximo · liberar el cupo sin `finally` | cada uno hace fallar su prueba |

**Lo que no cubre:** el tiempo de `scrypt` (65 ms y 57 por segundo) se midió a mano, sin guion en el repositorio; el 503 y el tiempo
máximo de la consulta se prueban solo en unitarias, no en el banco; el banco llega al backend en HTTP sin TLS por 127.0.0.1 (el token
viajaría en claro sin el proxy: en producción el backend no publica puertos y se entra por el proxy con TLS, `docs/10 §2`); y quedan los límites conocidos de
`docs/10 §8.4` punto 52 (vii): bloqueo por dirección detrás de un NAT, cuarentena sin cuota por dispositivo y `X-Forwarded-For` desde
otro contenedor de la red interna.

**Pruebas:** 291 del backend y 52 del panel. **Tres tropiezos de la prueba de punta a punta, ninguno del sistema:** `curl -G` mueve el
cuerpo a la URL, así que el `?magnitud=` del formato plano va escrito en la URL; la prueba del bloqueo suponía que la dirección partía
sin fallos, cuando las comprobaciones anteriores del 401 ya sumaban algunos (ahora envía hasta recibir el 429); y suponía que el backend
ve 127.0.0.1, cuando ve una sola dirección de la red de Docker para las peticiones directas y las del proxy: una corrida dejaba fallos
vivos para la siguiente, así que el caso reinicia el backend al empezar (los contadores viven en su memoria).

## 42. Topes por emisor, dirección del cliente y lo que dejó la revisión del día anterior (17/10/2026)

**Qué cambió** (`docs/10 §8.4` puntos 52 y 53; `docs/11 §3`; migración 19). En la vía HTTP: caché de verificaciones (un token ya
verificado contra la misma huella no vuelve a pagar `scrypt`), bloqueo por par dirección + dispositivo (5 fallos en 60 s → 60 s), tope
grueso por dirección (50 fallos en 60 s → 60 s solo para las verificaciones con `scrypt`), y la dirección del cliente creída de
`X-Forwarded-For` solo con el secreto compartido del proxy (`X-Proxy-Secreto`); `trust proxy` apagado. En todas las vías: tope por
emisor en `filtros2a6` (presupuesto de lecturas por hora, cuota de 60 tramas en cuarentena por dispositivo y hora, condición
`tope_superado`, contadores persistentes en `estado_dispositivo`). En los cuatro contenedores, sin `NET_RAW`. Y la regla del contador de
trama corregida (`docs/10 §4.1`): el 0 y el ausente no se comparan; una trama guardada sin contador lo borra; el contador avanza también
cuando la reentrega encuentra las lecturas ya guardadas.

| Comprobación (`banco.sh tope`, de punta a punta, en las dos vías) | Resultado |
|---|---|
| Dispositivo HTTP de 1 canal cada 86 400 s (presupuesto: el mínimo, 600); una trama SenML de 601 lecturas → 422 con el motivo («tope de 600 lecturas por hora superado: 0 ya aceptadas …») | ✅ |
| La trama queda en cuarentena con motivo `tope`; la condición `tope_superado` aparece en `GET /condiciones?abiertas=true`; `estado_dispositivo`: 0 lecturas, 1 en cuarentena, 1 sobre el tope, 0 omitidas | ✅ |
| Una trama chica sí cabe (202) y, en la misma hora, la condición sigue abierta; otra grande → 422 otra vez, sin segunda condición; contadores 1/2/2/0 | ✅ |
| Hora siguiente (adelantada en la base): la primera trama que cabe cierra la condición (evento `condicion_cerrada`) y los contadores empiezan de cero: 1/0/0/0 | ✅ |
| Por MQTT, 62 tramas malformadas de un dispositivo recién dado de alta → 60 filas en cuarentena y 2 solo contadas (0/60/0/2); el registro lo dice una sola vez | ✅ |
| Ni el token ni la credencial aparecen en el registro del backend | ✅ |

| Comprobación (`banco.sh http`, lo nuevo del 17/10; las 16 del 16/10 siguen en verde) | Resultado |
|---|---|
| Con el secreto del proxy se cree `X-Forwarded-For` (el registro anota la dirección presentada); sin el secreto, no | ✅ |
| A los 5 fallos del par dirección + dispositivo, ese par queda bloqueado (429) incluso con su token bueno; el vecino de la misma dirección sigue entrando (202) | ✅ |
| A los 50 fallos desde la dirección con identificadores distintos, las verificaciones con `scrypt` se bloquean (429); el dispositivo con el token en caché sigue entrando (202) | ✅ |
| Los cuatro contenedores sanos sin `NET_RAW` (`banco.sh encender`); `lorawan` (44 de 44), `alta`, `puente` y `puente` por dirección en verde después de los cambios: la vía MQTT del martes no cambió | ✅ |

| Pruebas unitarias | Resultado |
|---|---|
| Verificación con caché (`verificacion.spec.ts`): una sola `scrypt` para dos tramas; token equivocado de un dispositivo en caché → `scrypt` y no; rotación; otra vía, baja o sin credencial → no; inexistente → no con relleno; cupo lleno → saturado, liberado aunque la verificación lance; tope de entradas; pista por identificador | ✅ (9) |
| Dirección del cliente (`direccion.spec.ts`): sin secreto → la del socket; con el secreto → la primera de `X-Forwarded-For`; distinto, de otro largo o ausente → la del socket, sin lanzar, y la cabecera queda marcada como ignorada | ✅ (4) |
| Controlador: orden de comprobaciones, caché sin cupo ni bloqueo, par, tope grueso (lo ya bloqueado no suma; en caché pasa; una dirección bloqueada no consulta la base salvo con la pista), un 401 sin comprobar no cuenta, ritmo, 503 sin contar como fallo, secreto, `X-Forwarded-For` sin secreto anotada una vez, esquema `bearer`, registro saneado, aviso de arranque sin `PROXY_SECRETO` | ✅ (16) |
| Tope por emisor (`recepcion.service.spec.ts` y `cuota.spec.ts`): presupuesto desde canales e intervalo, trama que no cabe rechazada entera con condición, las lecturas inválidas también consumen presupuesto, ventana nueva que cierra (y una que empieza sin lecturas, que deja el cierre al barrido), cuota de cuarentena, vía HTTP (y de a una por identificador), vía directa sin alta, vía de pasarela, DevEUI desconocido y las tres salidas sin DevEUI verificable con la cuota en memoria de la pasarela | ✅ (15) |
| Supervisión (`supervision.service.spec.ts`): el barrido cierra una `tope_superado` cuando la fila de estado ya muestra una hora nueva dentro del presupuesto, con evento y aviso | ✅ (1) |
| Contador de trama: el 0 tras una re-unión se guarda; sin contador se borra; con las lecturas ya guardadas avanza; rechazada entera no cambia | ✅ (2) |
| Plantadas (catorce): presupuesto con `>=` · condición que no se abre · cuota que no se aplica · condición que no se cierra · caché ignorada · verificación que no recuerda · secreto sin comparar · las tres salidas de pasarela con la cuota del nodo · presupuesto solo por aceptadas · dirección bloqueada sin pista · barrido que no cierra · `X-Forwarded-For` ignorada sin aviso | cada una hace fallar su prueba |

**Lo que dejó la revisión del 16/10** (una revisión independiente, sin el contexto del día; cada hallazgo se verificó en el archivo antes de corregir): el contador
de trama 0 (arriba); `::FFFF:` en mayúsculas caía en otro cubo; el esquema `bearer` en minúsculas daba 401 (RFC 9110 lo admite); un conteo
escrito a mano en la prueba de humo (12 rutas) quedó atrás con la ruta nueva; licencias del firmware incompletas (aviso de Dallas
Semiconductor en OneWire, copyright real de Unified Sensor, seis identificadores en el SDK del núcleo); «compila sin avisos» cuando la
biblioteca OneWire emite dos del preprocesador; marcas de tiempo de la captura real en pruebas y prosa, reemplazadas por sintéticas;
erratas; un README con pendientes ya hechos. Dos hallazgos se descartaron: eran instantáneas fechadas de secciones anteriores.

**Lo que dejó la revisión de cierre del 17/10** (tres miradas independientes sobre el trabajo del día; cada hallazgo verificado en el
archivo y, los de lógica, reproducidos antes de corregir): por el tópico de una pasarela, las tramas sin DevEUI verificable salían antes
de escribir la fila de estado y la cuota de cuarentena no se les aplicaba (ahora cuentan en la cuota en memoria de la pasarela); la
condición `tope_superado` podía quedar abierta para siempre si la hora nueva empezaba con una trama sin lecturas (ahora la cierra el
barrido); las lecturas inválidas no consumían presupuesto aunque cada una cuesta una consulta; dos tramas HTTP solapadas del mismo
dispositivo leían la misma foto del presupuesto (ahora van de a una); una dirección bloqueada seguía gastando una consulta por petición
(ahora, sin la pista del identificador, no consulta); los 401 sin comprobar contaban para los bloqueos; sin `PROXY_SECRETO`, un externo
podía bloquear a cualquier dispositivo HTTP (ahora el proxy no arranca sin él, y una `X-Forwarded-For` sin secreto se anota); `cap_drop`
figuraba como probado y solo estaba configurado (ahora lo inspecciona el banco y lo lee el guardián); las figuras PDF versionadas traían
la hora del render en sus metadatos (guardián 2f4); y textos: el nombre de la aplicación del campus en el banco, el aviso de Derek
Yerger en OneWire, cifras y referencias cruzadas.

**Lo que no cubre:** el 503 del cupo se prueba solo en unitarias; el bloqueo grueso, en el banco con 10 identificadores × 5 fallos
(≈ 3,3 s de `scrypt`), no con una carga real; la cuota de la pasarela para tramas sin DevEUI verificable, en unitarias; el cierre de la condición se prueba adelantando la ventana en la base, no esperando una hora; la cuota en memoria
de lo que el filtro 1 rechaza se prueba en unitarias, no en el banco. **Pruebas:** 324 del backend (33 nuevas) y 52 del panel.

## 43. Fase 1 del nodo propio: diagnóstico de los tres sensores con hardware real (18 y 19/10/2026)

**Qué se probó** (`docs/17 §6`, fase 1; cierra la mitad de TT-32). La placa NodeMCU ESP-32S V1.1 con el módulo de aire GY-BME280 (I2C), la
sonda DS18B20 (1-Wire con resistencia de 4,7 kΩ) y el sensor capacitivo de suelo v1.2 (ADC), cableados en protoboard según
`plataforma/firmware/cableado-fase-1.drawio`, con el firmware `diagnostico` (`pio run -e diagnostico -t upload`). Resultados leídos por el
puerto serie a 115200:

| Comprobación | Resultado |
|---|---|
| Grabación por `esptool` (puerto `ttyUSB0`, `cp210x`): `Chip is ESP32-D0WD-V3`, `Hash of data verified`, `[SUCCESS]` en 37 s | ✅ |
| Barrido I2C: `responde 0x76`, registro `0xD0 = 0x60 → BME280`; lecturas 20,95 °C · 60,5 %HR · 984,3 hPa (presión absoluta coherente con la altura del lugar) | ✅ (tras reasentar el módulo: con los pines flojos, `FALLA nadie responde`) |
| 1-Wire: `1 sonda(s) DS18B20`; mide con pasos de 0,06 °C (12 bits) y sigue la temperatura real: 21,3 → 18,0 °C en agua fría → 23,6 °C en la mano | ✅ |
| Sensor de suelo: al aire **2205 mV** (±3), con la punta en agua **≈ 1170 mV** (1167–1173); ambos dentro del rango preciso del ADC (150–2450 mV): no hace falta divisor; valores de `escala_cero` y `escala_cien` para el alta | ✅ |
| Cristal: `esptool` estimó 26 MHz con advertencia el 18/10 (el 14/10 y el 19/10 dijo 40: estima por la velocidad de la conexión); el mensaje de arranque de la ROM salió legible a 115200, lo que solo ocurre con 40 MHz; y el firmware imprime desde el 19/10 el valor que la placa lee al arrancar: `— Cristal: 40 MHz` | ✅ 40 MHz |
| Al dar corriente, dos veces un bucle de reinicios (`rst:` repetido unos segundos) que se estabilizó solo; el monitor serie con las líneas de reset inactivas (`monitor_dtr`/`monitor_rts = 0`) deja que la placa arranque y se reinicia con `EN` | observado; a vigilar (cable o puerto USB) |

**Lo que no cubre:** la lectura con Wi-Fi encendido (`docs/17 §4.3`), que es de la fase 2; la calibración se tomó en agua de la llave y al aire
de la pieza, no en suelo real (los dos extremos del sensor, no del terreno). **Tropiezos, ninguno del sistema:** la primera prueba en
agua se hizo con la sonda de temperatura en vez del sensor de humedad (sirvió para ver que la sonda mide de verdad), y el módulo de
aire mal asentado dio «nadie responde» hasta presionarlo parejo.

## 44. Contrato del nodo propio (fase 2) probado en el banco sin la placa (19/10/2026)

**Qué se probó** (`docs/17 §6.2`; `banco.sh nodo`, 16 de 16 comprobaciones). El firmware de la fase 2 (`src/nodo.cpp`, entorno `nodo`)
compila con la plataforma y las bibliotecas fijadas (RAM 14,6 %, flash 72,0 %); su contrato con la plataforma se probó de punta a punta
en el banco publicando con `mosquitto_pub` exactamente lo que el firmware arma, con QoS 1 y la credencial del alta:

| Comprobación | Resultado |
|---|---|
| Alta por API con los seis canales del nodo (`temperatura`, `humedad`, `presion`, `temperatura_suelo`, `humedad_suelo`, `rssi`; vía `mqtt`, `senml`, 60 s) → 201; el tópico del alta es el que arma el firmware (`…/<id>/temperatura`) | ✅ |
| Calibración del suelo por SQL (2,205 V = 0 %, 1,170 V = 100 %, los extremos de la fase 1) | ✅ |
| El pack de seis registros mide 263 bytes (la biblioteca del firmware se instancia con 512; su tope por defecto, 128, no alcanzaría) | ✅ |
| Publicado con QoS 1 (`PUBACK … RC:0`) → **una trama**, seis mediciones con la hora del `bt` y origen de tiempo `dispositivo`; `humedad_suelo` guardada en V tal cual (2,199); la ficha trae el porcentaje con la calibración (0,6 %, sensor al aire) y `rssi` como magnitud del catálogo; el inventario lo muestra en línea | ✅ |
| El mismo pack **sin `bt`** (nodo sin hora NTP) → seis mediciones con la hora de recepción (origen `recepcion`) | ✅ |
| Un pack con la sonda **omitida** (sensor que no respondió en el ciclo) → cinco mediciones: las demás no se pierden | ✅ (la primera corrida del caso falló por una publicación sobrante en la prueba misma, que entregaba seis; corregida la prueba, cinco) |
| La credencial no aparece en el registro del backend; al final, baja del dispositivo de prueba (credencial revocada) | ✅ |

**Lo que no cubre:** Wi-Fi, TLS desde la placa, NTP y el ciclo de 60 s con los sensores: es la sesión con hardware, con laboratorio guiado
(la verificación TLS equivalente desde el portátil es `openssl s_client … -verify_hostname proxy` → «Verify return code: 0 (ok)»).

## 45. Prueba de campo con la red LoRaWAN del campus (20/10/2026)

**Qué se probó** (`docs/10 §8.4` punto 47, ruta B, camino 2; bitácora del 20/10). Pasarela Milesight UG65 con servidor de red
embebido, dos nodos Heltec LoRa 32 V3 (AU915), el portátil con la pila completa en la misma red local y la pasarela sin internet.

| Comprobación | Resultado |
|---|---|
| Certificado del servidor con la IP del portátil (`CA_IP_EXTRA`), proxy en 8883, `openssl s_client … -verify_ip` → «0 (ok)» | ✅ |
| La UG65 conecta por TLS verificando nuestra CA («Self signed certificates», solo `ca.crt`), con usuario y credencial del alta por API, QoS 1, sin retención; estado «MQTT Connected» | ✅ |
| Alta por API de la pasarela (`formato milesight`) y de los dos nodos por DevEUI con el perfil `campus-heltec-v3-v1` | ✅ |
| Tópico con `$devEUI` (mayúsculas): la pasarela lo publica literal → cuarentena `no_registrado` con la carga completa (≈ 25 tramas); con `$deveui` (minúsculas, documentación de la UG65) entra todo | ✅ el rechazo es el correcto; la plantilla del alta se corrige |
| Tramas reales: «3/3 lecturas guardadas vía milesight»; 813 mediciones (271 tramas de 3 lecturas) en una ventana de ≈ 3 h: cada nodo publicó cada ≈ 17 s mientras la pasarela reenviaba (uno durante 1 h 45 min, el otro 27 min; contado en la base el 28/10), origen de tiempo `pasarela`; inventario en verde y ficha con las tres series | ✅ |
| Reloj de la pasarela 4 días atrasado: mediciones fechadas el 16/10 (regla 17), ficha «última trama: ahora» / «medición hace 4 d», histórico de la última hora vacío; corregida la hora en la pasarela, `max(tiempo)` = `max(recibido_en)` | ✅ visible por diseño; falta tolerancia de desvío (resuelta en §46) |
| La pasarela dejó de reenviar 27 min (destino cambiado y sesión cerrada): `sin_comunicacion` abierta en los dos nodos a los 6 min y cerrada sola al volver | ✅ |
| Exportación CSV de la ficha (`GET /dispositivos/{id}/exportar`): 280 líneas | ✅ |
| Un segundo destino en la UG65 solo puede ser HTTP/HTTPS (MQTT deshabilitado): la vía 4 (HTTPS de pasarela, `docs/10 §1`; desde el 01/11/2026, variante prevista de la vía 2) pasa a ser necesaria para coexistir con otro broker | observado |

**Lo que no cubre:** la ruta C (ChirpStack) y la coexistencia por puente desde el Mosquitto del compañero (no se logró en su equipo).
Las tramas reales quedan en la base del portátil y no se exportan al repositorio.

## 46. Tolerancia de desvío de la marca de pasarela (22/10/2026)

**Qué se probó** (`docs/10 §8.4` punto 54; `docs/13` regla 18; migración 20). Origen: en §45 la UG65 sin NTP fechó 555 de las 813 mediciones
4 días antes. Desde ahora, una marca con origen `pasarela` a más de 10 minutos de la hora de recepción se reemplaza por la hora de
recepción (`origen_tiempo = recepcion`) y abre la condición `reloj_desviado` del nodo; la primera marca de pasarela plausible la cierra.
Una marca de dispositivo antigua se sigue respetando.

**Método.** Pruebas unitarias del filtro 4, del pipeline con la base simulada y del servicio de supervisión; la migración aplicada dos
veces sobre la base de desarrollo y sus reglas plantadas en `reglas-identidad.sql`; y `banco.sh lorawan` de punta a punta sobre un banco
recién encendido (que aplica `db/init` desde cero y reaplica las migraciones 02 a 20): la pasarela Milesight del banco publica la
captura del campus por el sufijo nativo con `time` 4 días atrás, y después con la hora actual.

| Caso | Dónde | Resultado |
|---|---|---|
| Pasarela 4 días atrás → hora de recepción, desvío negativo | `tiempo.spec.ts` | ✅ |
| Pasarela 9 min atrás → se respeta; justo 10 min se respeta, 10 min y 1 s no | `tiempo.spec.ts` | ✅ |
| Dispositivo 4 días atrás → se respeta (cola sin cobertura) | `tiempo.spec.ts` y `recepcion.service.spec.ts` | ✅ |
| Más de 2 min en el futuro → hora de recepción para los dos orígenes; la pasarela abre la condición desde ahí (hasta 2 min, deriva normal: nada) | `tiempo.spec.ts` | ✅ |
| Pipeline: marca desviada → `tiempo` lo pone la base, origen `recepcion` y se abre `reloj_desviado` con pasarela, `desvio_s` y `marca_pasarela` | `recepcion.service.spec.ts` | ✅ |
| Pipeline: con la condición ya abierta, otra marca desviada no vuelve a escribirla; una plausible la cierra; sin condición abierta, una plausible no consulta nada | `recepcion.service.spec.ts` | ✅ |
| Abrir y cerrar con evento y aviso al panel; una ya abierta (índice único) o nada que cerrar → sin evento ni aviso | `supervision.service.spec.ts` | ✅ |
| `reloj_desviado` es Alerta en el panel, con el rótulo «Reloj de pasarela desviado» | `estado-visual.test.ts` | ✅ |
| Migración 20 aplicada dos veces sobre la base de desarrollo: la segunda termina igual, sin error | `db/init/20-reloj-desviado.sql` | ✅ |
| `condicion` acepta `reloj_desviado` y rechaza un tipo ajeno por `ck_condicion_tipo` | `reglas-identidad.sql`, casos 29 y 30 (31 OK de 31) | ✅ |
| Banco: `time` 4 días atrás → 3 lecturas fechadas por la recepción y `reloj_desviado` abierta; el evento trae la pasarela, la marca y `desvio_s` = −345601 | `banco.sh lorawan` | ✅ |
| Banco: con la hora actual → 3 lecturas con origen `pasarela` y la condición cerrada sola | `banco.sh lorawan` | ✅ |

**Resultado.** Pruebas unitarias: 338 del backend (14 nuevas) y 53 del panel (1 nueva), todas en verde con `pnpm verificar`. Banco
`lorawan`: 46/46. Al plantar la violación (la regla 18 desactivada en `tiempo.ts`) fallan 5 pruebas de `src/recepcion`.

**Lo que no cubre:** una marca de pasarela atrasada menos de 10 minutos se respeta tal cual (adelantada más de 2 min, la reemplaza la
regla 7 y también abre la condición: revisión del 22/10, antes quedaba en silencio); la condición se abre por nodo, no por pasarela (el
modelo no tiene estado propio de pasarela), así que una pasarela desviada con varios nodos abre una condición en cada uno. Si la pasarela
deja de incluir marca (o la manda sin zona), no abre ni cierra nada: una condición abierta queda así hasta la siguiente marca plausible.
Las tramas de un dispositivo se procesan de a una (MQTT en serie; HTTP de a una por identificador), así que la lectura del estado
«abierta» en el filtro 1 no se cruza con otra trama del mismo nodo.

## 47. Límite de tasa por dirección en el proxy (22/10/2026)

**Qué cambió** (`plataforma/proxy/nginx.conf`; `docs/11 §3` y §4). Hasta hoy el proxy no limitaba nada por dirección: lo único que frenaba
el abuso eran los topes propios del backend para la recepción por HTTP (`docs/10 §8.4` puntos 52 y 53). Ahora el proxy tiene cinco controles,
todos por dirección del socket (`$binary_remote_addr`; no hay otro proxy delante, así que `$remote_addr` es la del cliente):
una zona general y una de administración en el 443 (`limit_req`, exceso → **429**), y un tope de sesiones simultáneas en el 8883
(`limit_conn`). Los rechazos quedan en el registro de errores del proxy (`limit_req_log_level warn`, `limit_conn_log_level warn`).
La dirección 127.0.0.1 del propio contenedor (el chequeo de salud, cada 15 s) queda exenta: una clave vacía no se cuenta.

**Números y fundamento** (el porqué también está en los comentarios del archivo):

| Control | Valor | Fundamento |
|---|---|---|
| `limit_req` general (443) | 100 r/s, ráfaga 200 sin espera | RNF-01 exige 50 tramas/s (`docs/02`). Por HTTP un NAT o una pasarela envía desde **una** dirección las tramas de todos sus dispositivos, y cada dispositivo manda a lo más 1 trama aceptada por segundo (`docs/10 §8.4` punto 52 e): 50 dispositivos detrás de una dirección dan 50 r/s. 100 r/s es el doble. La ráfaga de 200 son 4 s del ritmo de RNF-01: cubre la cola que los 50 canales reenvían tras una caída (`docs/02`, fundamento de RNF-01) y la carga de una pantalla del panel |
| `limit_req` de administración (443) | 5 r/s, ráfaga 10, solo `POST/PUT/PATCH/DELETE` sobre `/dispositivos`, `/pasarelas` y `/canales` | El backend ya admite a lo más 2 altas a la vez (`docs/10 §3`, 429); un lote de 10 seguidos cubre dar de alta un sitio a mano o con un guion, y quien intente adivinar `X-Clave-Admin` tiene a lo más 5 intentos por segundo y por dirección. La recepción (`POST /recepcion/{id}`) no entra: cuenta solo en la zona general |
| `limit_conn` (8883) | 100 sesiones simultáneas por dirección | Cada nodo mantiene una sesión MQTT; el caso de validación tiene 50 canales (`docs/02`), a lo más 50 nodos de un canal tras un mismo NAT: el doble de holgura. Techo del proceso: `worker_connections 1024`, dos por sesión (cliente y broker) ≈ 512 por worker, así que una sola dirección no lo satura (hacen falta 6) |
| `limit_conn` HTTP (443) | 100 peticiones en curso por dirección | Revisión del 22/10: `limit_req` cuenta inicios, no duración; sin esto una dirección abre 200 peticiones lentas y agota `worker_connections`. Mismo fundamento que el 8883 |
| `limit_conn` de `/eventos` (443) | 20 flujos SSE por dirección | 10 pantallas abiertas detrás de un NAT con dos pestañas cada una; el backend admite 50 flujos en total (`docs/10 §5`): una dirección ya no puede tomarlos todos |

**Método.** `pruebas/banco/proxy-limites.sh` sobre la capa TLS del banco (`banco.sh proxy`, proyecto `banco`, 8443 y 8884, certificados de
desarrollo). Cada límite se prueba **plantando la violación** y **comprobando lo legítimo**. Las ráfagas usan una sola invocación de `curl`
con rango (`?r=[1-600]`), que reutiliza la conexión; las sesiones MQTT/TLS son 100 `openssl s_client` con la entrada abierta, desde una sola
dirección (la puerta de enlace de Docker, como los nodos de un NAT), más un contenedor desechable en otra dirección.

| Comprobación | Resultado medido (22/10/2026) |
|---|---|
| 600 peticiones seguidas a `/salud` desde una dirección | 233 con 200 y 367 con 429 (esperado 200 a 260 pasan: la ráfaga más lo que el ritmo deja entrar) |
| 4 s después, una petición sola | 200 |
| Lo legítimo: 250 `POST /recepcion/{id}` a 50/s (RNF-01, un NAT con 50 dispositivos), 5 s | 0 con 429; las 250 llegaron al backend (401: el dispositivo no existe) |
| 40 `POST /dispositivos` seguidos | 11 llegaron al backend (401 sin clave) y 29 con 429 |
| 40 `DELETE /pasarelas/{id}` seguidos | 429 en las 40 (el cubo de administración seguía lleno de la prueba anterior; confirma que cubre DELETE y `/pasarelas`) |
| Lo legítimo: 40 `GET /dispositivos` y 40 `POST /recepcion/{id}` seguidos | 0 con 429 en ambos (no son administración y caben en la ráfaga general) |
| 4 s después, un `POST /dispositivos` solo | 401 (llega al backend; sin la clave no es 201) |
| 99 sesiones TLS abiertas al 8884 desde una dirección (contadas por el apretón terminado, «Verify return code: 0», no por el proceso) | las 99 vivas; la sesión 100 entra |
| La sesión 101 desde la misma dirección, con la centésima abierta | rechazada antes del apretón TLS; línea nueva «limiting connections by zone» en el registro desde la marca de tiempo previa; las 100 de abajo siguen vivas |
| 40 `POST` seguidos a `/DISPOSITIVOS` (la ruta en mayúsculas) | 429 (la zona no distingue mayúsculas, como el enrutador de Express) |
| 40 `PATCH /canales/{id}` seguidos | 429 (la calibración por API es administración y cuenta en la zona estricta) |
| 20 flujos SSE a `/eventos` desde una dirección; el 21.º; una petición normal; al cerrar los flujos | las 20 abiertas; el 21.º recibe 429; `/salud` responde 200 (el tope es solo de `/eventos`); la dirección vuelve a abrir un flujo |
| Con los 20 abiertos, `/Eventos` y `/eventos/` (variantes que Express también sirve) | 429 en las dos: la `location` es una expresión regular, no una ruta exacta |
| Con esa dirección al tope, `mosquitto_pub` QoS 1 desde otra dirección | publicó y la lectura está en `medicion` (el límite es por dirección) |
| Al cerrar las 100 sesiones | la misma dirección vuelve a conectar |
| `banco.sh proxy` (la capa completa) y `nginx -t` en el contenedor | 11 «OK» y «PROXY OK»; sintaxis correcta; el chequeo de salud sigue «healthy» |

Resultado del guion: **23/23** tras la revisión del 22/10 (más `PATCH /canales/{id}`, que también cuenta en la zona de administración) (antes 15/15: la comprobación de «100 sesiones vivas» contaba subprocesos, no apretones TLS, y se rehízo; se sumaron las mayúsculas, `/eventos` con sus variantes `/Eventos` y `/eventos/`, que Express también sirve y que una `location =` dejaba fuera del tope, y el tope HTTP). Primera corrida: 13/15, por dos errores del propio guion (la recepción exige `Content-Type` y el 404 de un GET
se contó como éxito; las sesiones no se cerraban al terminar), corregidos y repetidos.

**Limitaciones.** (1) Los límites son por dirección: una pasarela con miles de dispositivos detrás de una sola dirección que supere 100 r/s
sostenidos o 100 sesiones MQTT se verá limitada (no es el caso de validación; el valor se sube en `nginx.conf` con su fundamento). (2) Detrás de un
NAT, un dispositivo abusivo consume el cupo de sus vecinos: es el costo de limitar por dirección, y el tope por emisor del backend (punto 53) sigue
siendo el que distingue dispositivos. (3) El tope de 100 peticiones HTTP en curso por dirección no se planta en el banco: no hay forma legítima de sostener más de 100 (el canal en vivo lo
acota el backend a 50 flujos); se comprueba por configuración (`nginx -t` y `nginx -T`) y por el tope de 20 de `/eventos`, que sí se planta. (4) Una IPv6 cuenta por dirección completa, no por prefijo /64: quien rote direcciones dentro de su /64
evade `limit_req`; el backend sí cuenta por /64 (punto 52). (5) La prueba se hizo desde una sola máquina y sin medir el costo de CPU del proxy
con los límites activos; el límite de memoria del proxy (100 MB) no se tocó y las zonas ocupan 10 MB + 4 × 1 MB (general, administración, 8883, HTTP y `/eventos`) (`limit_req_zone`/`limit_conn_zone`) como máximo. (6) `@nestjs/throttler`
(por usuario y ruta, en el backend) sigue pendiente con M7.


## 48. Cualquier trama y cualquier serie de cualquier sensor es consultable (22/10/2026)

**Qué garantiza y cómo se prueba** (`pruebas/banco/consultable.sh`; RF de consulta y exportación de `docs/02`). Para **cada** dispositivo que
lista la API recorre el camino completo del panel: inventario → ficha → histórico de **cada canal** en los cuatro rangos (1 h, 24 h, 7 d, 30 d con
sus pasos) → exportación CSV y JSON del último mes → condiciones → cuarentena. Falla si alguna ruta responde con error o con una forma que no
es la del contrato (el histórico es un objeto con `puntos`, `tiempos` y `valores` del mismo largo), o si un dispositivo visto en las últimas
24 h devuelve vacío el histórico de 24 h en todos sus canales. Un dispositivo sin mediciones recientes (recién dado de alta) devuelve series
vacías y se cuenta aparte: no es una falla. Sirve contra la pila de desarrollo o contra el banco (`consultable.sh <URL>`).

| Corrida | Resultado |
|---|---|
| Pila de desarrollo, 15 dispositivos de la semilla y de las corridas | **104 OK, 0 FALLA**; 15 sin mediciones en las últimas 24 h (semilla antigua) |
| Banco (`banco.sh consultable`), 100 dispositivos emulados recién encendidos | **757 OK, 0 FALLA**; 100 sin mediciones en las últimas 24 h (no es falla) |

**Qué dice exactamente:** hoy, sin usuarios, quien llega al panel ve todo lo consultable; con la sesión (HU-18, `docs/20`) la garantía pasa a
ser «cualquier dato de su sitio». No cubre la trama cruda directamente (`trama`, 30 días): se ve por la cuarentena y por el histórico, no
por una ruta propia.


## 49. La misma serie por las tres vías: latencia, pérdidas, duplicados y consumo (22/10/2026)

> Nota del 01/11/2026: «tres vías» significa aquí MQTT directo, HTTP y pasarela, las tres entradas al pipeline; la numeración de las
> vías cambió ese día (`docs/10 §1`: vía 1 MQTT sobre TLS, vía 2 HTTPS, vía 3 WebSocket sobre TLS). El registro se conserva como se escribió.

**Qué compara y cómo** (`pruebas/banco/vias.sh`, caso `banco.sh vias`; RNF-02, RF-10, `docs/10 §8.4` puntos 47, 52 e y 53). Una serie
determinista (semilla fija, 60 instantes × 3 canales: temperatura °C, humedad %, tensión V, las magnitudes del caso `lorawan`) entra al banco
por cinco emisores dados de alta por la API, todos con intervalo esperado de 60 s:

- **MQTT** (`vias-mqtt-*`, SenML): 60 mensajes de 3 lecturas, uno por segundo, en **una** sesión (`mosquitto_pub -l`, QoS 1), para que el
  arranque del cliente no entre en la latencia.
- **HTTP** (`vias-http-1-*`, `-10-*`, `-60-*`, SenML): la misma serie en packs de 1, 10 y 60 lecturas por `POST /recepcion/{id}` (180, 18 y 3
  POST), con un POST a lo más por segundo por dispositivo (el ritmo del punto 52 e), contado desde la respuesta anterior.
- **Pasarela** Milesight sin códec (`vias-pasarela-*` con su nodo `vias-nodo-*`, perfil `campus-heltec-v3-v1`): 60 tramas de 10 bytes por el
  sufijo nativo, `fCnt` creciente y `time` = ahora, una por segundo, en una sesión.

Cada trama lleva su marca = hora de envío (`bt` en SenML, `time` en la pasarela); la **latencia** es `recibido_en − marca` (el mismo reloj:
backend y guion corren en el mismo equipo). En los packs HTTP cada lectura lleva además `t` negativo hasta la hora de su instante, en una
línea fija de un instante por segundo. **Duplicados a propósito:** las 10 primeras tramas de cada vía se envían dos veces (MQTT, el mismo
mensaje; HTTP, el mismo POST; pasarela, el mismo `fCnt` y los mismos bytes); en los packs de 60 son las 3. Cada lectura enviada se anota en
el guion y se busca en `medicion` por canal y hora (±5 ms). La memoria y la CPU del contenedor del backend se toman con
`docker stats --no-stream` cada 5 s, antes, durante cada vía y al final.

**Resultado medido** (22/10/2026, banco encendido con 5 emulados sembrados y sin tráfico; tercera corrida del guion):

| Vía | Enviadas | Guardadas | Perdidas | Filas de más por duplicados | Latencia p50 / p95 / máx (ms) | Envío (s) | Backend: MiB máx | CPU máx (%) | Muestras |
|---|---|---|---|---|---|---|---|---|---|
| MQTT (SenML, 3 lecturas por mensaje) | 180 | 180 | 0 | 0 | 4 / 4 / 5 | 59,3 | 59,9 | 0,3 | 12 |
| HTTP, pack de 1 | 180 | 180 | 0 | 0 | 15 / 17 / 141 | 194,2 | 60,5 | 0,5 | 39 |
| HTTP, pack de 10 | 180 | 180 | 0 | 0 | 27 / 153 / 153 | 28,2 | 60,8 | 9,0 | 6 |
| HTTP, pack de 60 | 180 | 180 | 0 | 0 | 84 / 157 / 157 | 5,6 | 60,1 | 1,3 | 1 |
| Pasarela (10 bytes, `fCnt`) | 180 | 180 | 0 | 0 | 3 / 4 / 4 | 59,2 | 60,6 | 0,3 | 12 |

Backend antes: 59,6 MiB y 0,0 % de CPU; al final, 59,4 MiB y 0,0 %. Los cinco emisores dejan la **misma** secuencia de valores por canal
(misma huella en los cinco). Los 10 POST repetidos del pack de 1 y del de 10, y los 3 del de 60, responden 202 con `repetidas` igual al
tamaño del pack; las 10 tramas repetidas de la pasarela se descartan por el `fCnt` y quedan anotadas en el registro (10 avisos). Ningún 429
por el ritmo. Guion: **28/28** («VIAS OK»), sin reinicios ni OOM del backend y sin secretos en su registro; al final da de baja los cinco
emisores y la pasarela.

**Lectura.** (1) Las tres vías cumplen RNF-02 con holgura (p95 máximo 157 ms, en el pack de 60). (2) El tiempo del pack de 1 (194 s) **no**
es latencia: lo fija el ritmo de una trama por segundo por dispositivo (190 POST con los repetidos); para enviar muchas lecturas por HTTP el
emisor debe agruparlas, y el pack de 60 termina en 5,6 s. (3) En un pack, `recibido_en` es una sola hora para toda la trama: la latencia
crece con el tamaño (procesar 60 lecturas en una trama), y el p50 del pack de 60 sale de solo 3 tramas. (4) La memoria del backend no se
mueve con ninguna vía a este ritmo (59–61 MiB de 512 MiB de techo).

**Corridas previas y lo que corrigieron del guion** (no del sistema). Primera: 25/28. Por HTTP, el guion medía la espera del ritmo dentro
de la latencia (armaba el pack antes de esperar: p50 ≈ 1 050 ms) y espaciaba los POST 1,05 s desde el **inicio** del anterior, que no basta:
el backend anota la trama al procesarla, y 30 POST recibieron 429 (10 lecturas se perdieron porque el guion dejaba de reintentar tras 20 rechazos). Ahora espera 1 s
desde la respuesta anterior y arma el pack después. En la pasarela, la marca `time` salía corrida hasta 0,9 s: en este equipo `date` es la
versión de uutils (0.10.0), que lee mal las fracciones con ceros a la izquierda (`date -d @…698.011` da …698,110); el guion toma ahora la hora
de `EPOCHREALTIME` de bash. Segunda: 27/28; con horas relativas a cada pack, un instante partido entre dos packs (10 no es múltiplo de 3)
quedaba antes que el anterior y la secuencia por canal no coincidía; las horas de los instantes van ahora en una línea fija.

**Lo que no cubre.** (1) Red real y TLS: todo corre en el banco, directo a 1884 y 3001, sin el proxy ni la red del campus; la latencia
medida es la del sistema en el equipo, no la de un enlace. (2) Una sola corrida medida por vía y a ritmo bajo (1 trama por segundo por
emisor): no es una prueba de carga (esa es §10). (3) La pasarela se emula con `mosquitto_pub`, sin la UG65 ni el aire LoRa. (4) `docker stats`
muestrea cada 5 s y tarda en responder: el pack de 60 (5,6 s) tiene una sola muestra, y un pico más breve que el intervalo no se ve.
(5) El ritmo de una trama por segundo es solo de HTTP; en MQTT y en la pasarela el mismo emisor podría enviar más rápido.

**Qué mide la latencia y qué no:** `recibido_en − marca de la trama` es el tramo envío → recepción confirmada en la base. RNF-02 habla de
recepción → disponible para consulta; ese tramo (la consulta misma) se mide aparte (§3 y §25) y aquí no se suma. Las tres vías cumplen el
tope de 2 s en el tramo medido.

## 50. Primer incremento del panel: la vista en la URL, rangos vacíos, intervalo observado, reloj y «en vivo» (22/10/2026)

**Qué se prueba** (`docs/19 §4`, «Incremento 1 de P2 y P3»; lo motivó la prueba de campo de §45): los cinco puntos del diseño, con
pruebas por el DOM en los dos sentidos (`docs/19 §6`) y, en el backend, el contrato del campo nuevo de `GET /dispositivos/{id}`.

**Método.** (1) **Backend:** `intervalo_observado_s` es una subconsulta de la consulta de la ficha (`consulta.service.ts`,
`SQL_INTERVALO_OBSERVADO`): las 20 filas más recientes de `trama` del dispositivo (una por mensaje con al menos una lectura guardada),
leídas por su índice `(dispositivo_id, recibido_en DESC)`; sus `recibido_en` truncados al segundo y distintos, las diferencias entre
consecutivos y su mediana redondeada a segundos enteros; nulo con menos de 3 instantes. Una primera versión lo calculaba sobre `medicion`
unida a `canal`, con un atajo por canal porque esa tabla solo tiene índice por `(canal_id, tiempo DESC)`; se cambió a `trama`, que es
exacta (una fila es una trama) y lee 20 filas. La prueba del contrato usa un doble de `pool` (como las demás del backend); la mediana se
contrastó en la base de desarrollo con un cálculo independiente y con un caso sintético.
(2) **Panel:** funciones puras nuevas (`lib/vista.ts` para leer y escribir la vista en el fragmento; `duracion`, `fechaHora` y
`haceSegundos` en `lib/tiempo.ts`; `rangoQueContiene` en `lib/grafico.ts`) con sus unitarias, y pruebas de componente en jsdom que montan
`App`, `Ficha` e `Inventario` con la API y el canal en vivo simulados. (3) **Violaciones plantadas**, para ver que las pruebas fallan:
`LIMIT 21` en la subconsulta (falla 1 prueba del backend), `pushState` en lugar de `replaceState` (fallan 2 de ida y vuelta) y un efecto
que amplía el rango solo cuando está vacío (falla la del rango vacío); restauradas, todas en verde. (4) La pila de desarrollo,
reconstruida (`pila.sh encender`), consultada con `curl`, y el paquete servido revisado con `pruebas/panel-desarrollo.sh`.

| Punto del diseño | Prueba | Dónde |
|---|---|---|
| 1. Vista en la URL | Lectura y escritura del fragmento; rango desconocido, canal que no es UUID, estado desconocido e id que no es UUID → valor por defecto | `lib/vista.test.ts` (4) |
| 1. P3 | La URL fija canal y rango al abrir (se pide ese histórico); elegir rango y canal reescribe la URL sin sumar entradas al historial; un `hashchange` externo se reaplica (otro canal y otro rango, con su histórico); valores inválidos o un canal de otro dispositivo → primer canal y 24 h, y la URL queda corregida | `App.test.ts` (4) |
| 1. P2 | La URL fija vía y búsqueda; cambiarlas las escribe y sin filtros queda `#/`, sin entradas nuevas en el historial; un `hashchange` externo se reaplica; estado, sitio y zona inexistentes → tabla completa y `#/`; abrir la ficha y volver «atrás» restaura los filtros | `App.test.ts` (4) |
| 2. Rango vacío | Con la última medición hace 4 d: «Sin mediciones en este rango; la última es de hace 4 d (8 de octubre de 2026, 12:00)», el rango no cambia sin clic (30 s después sigue en 24 h y sin otra petición) y el botón elige 7 días; con puntos, ni texto ni botón; anterior a 30 días, remite a exportar y no hay botón; sin ninguna medición, solo «Sin mediciones en este rango.» | `Ficha.test.ts` (3), `lib/grafico.test.ts` (1), `lib/tiempo.test.ts` (1, fecha y hora) |
| 3. Intervalo observado | «reporta cada ≈ 17 s (esperado 3 min)» con «más seguido de lo declarado…»; 600 s con «más lento…»; 200 s sin aviso; nulo → «intervalo observado: sin datos suficientes» | `Ficha.test.ts` (1), `lib/tiempo.test.ts` (1, duraciones); backend `consulta.service.spec.ts` (4) |
| 4. Reloj de pasarela | P3: la condición abierta se lee «Reloj de pasarela desviado: las mediciones se fechan al llegar · hace 20 min» y el estado es Alerta; un evento `condicion` cerrada la quita sin recargar y el estado vuelve a Normal. P2: lo mismo en la fila del dispositivo, solo en ella, sin volver a pedir el inventario | `Ficha.test.ts` (1), `Inventario.test.ts` (1) |
| 5. «En vivo» con prueba | «última lectura hace 30 s» del canal visible; con latidos y sin lecturas durante más de 2 intervalos esperados, «conectado, sin lecturas»; una lectura lo devuelve a «conectado» («hace 10 s»); las lecturas de otro canal no cuentan para el visible | `Ficha.test.ts` (1), `lib/tiempo.test.ts` (1, «hace N s») |

**Resultados.** Backend (`pnpm verificar`): **342** pruebas en 30 suites (antes 338 en 29), tipos y lint sin errores. Panel: **76** pruebas en
10 archivos (antes 53 en 8), `svelte-check` con 331 archivos y 0 errores, y el build. Base de desarrollo: para el nodo de la prueba de campo
(§45), la subconsulta sobre `trama` da **17 s** (178 tramas guardadas; la versión sobre `medicion`, también 17) y el cálculo independiente
sobre sus 20 instantes más recientes, 19 diferencias entre 16 y 19 s con mediana 17; el caso sintético (instantes a 0, 10, 27 y 60 s, dos de ellos en el mismo segundo) da 17. `curl` contra la pila
reconstruida: el nodo de §45 → `intervalo_esperado_s` 180 e `intervalo_observado_s` 17; `demo-silencioso` → 300 y `null`, porque la semilla de demostración escribe
mediciones pero no filas de `trama` (con la versión sobre `medicion` daba 3600); `demo-aire-01`, con 3 tramas, → 3600; `dev-0001` (una
trama) → `null`. `pruebas/panel-desarrollo.sh`: «PANEL OK» (12 comprobaciones), y el paquete servido contiene
los textos nuevos.

**Dos tropiezos, corregidos antes de cerrar.** (1) El efecto de la ficha que escribe la vista en la URL leía la prop `id`, que deriva de la
ruta: un cambio externo del fragmento lo hacía reescribir la vista anterior antes de que se aplicara la nueva. Lo encontró la prueba del
`hashchange` externo; ahora ese efecto depende solo del canal, del rango y de que la ficha esté cargada. (2) En las pruebas de `App`,
dos montajes seguidos del gráfico con la importación dinámica de uPlot en vuelo escapaban al doble y cargaban el uPlot real, que sin
navegador falla («matchMedia is not a function»); las pruebas esperan ahora a que exista el gráfico antes de cambiar de canal o salir.

**Decisiones de implementación dentro del diseño.** Las duraciones se escriben para personas con una sola regla (segundos hasta 2 min,
minutos hasta 1 h, horas después): el ejemplo del diseño «(esperado 180 s)» se lee «(esperado 3 min)». El caso anterior a 30 días remite a
la exportación por API con un enlace (la semana que precede a la última medición), porque la pantalla P8 es de la Etapa 4. «Conectado, sin
lecturas» se cuenta con el reloj del navegador desde que el canal pasó a «en vivo» o desde la última lectura llegada del canal visible, lo
más reciente, no con la marca de la medición (que puede venir de un reloj desviado). En P2 la alerta del reloj va bajo el estado, en la fila.

**Con navegador real** (`banco.sh encender 5`, imagen reconstruida con este incremento, y `banco.sh navegador`): **9/9** («P3 NAVEGADOR
OK», sin errores de JavaScript). La captura muestra en la cabecera «en vivo: conectado · última lectura hace 0 s» y «reporta cada ≈ 3 s
(esperado 5 s)», sin aviso (3 s no es menor que la mitad de 5). El recorrido de Playwright no ejercita todavía los textos nuevos: se leen en
la captura; las comprobaciones automáticas son las de jsdom.

**Lo que no cubre.** (1) El recorrido en Firefox no prueba la URL, el rango vacío ni el reloj desviado; solo se ven en jsdom y en la captura.
(2) La mediana se prueba en la base contra datos reales y un caso sintético, no con una prueba automática contra una base (las
unitarias del backend corren sin base). (3) `trama` vence a los 30 días (`RETENCION_TRAMA_DIAS`): un dispositivo callado desde antes da nulo,
y los datos cargados sin pasar por la recepción (semillas) no cuentan.

## 51. Calibración por API con bloqueo optimista (22/10/2026)

**Qué se prueba** (`docs/10 §8.4` punto 51 (i) a (vi)): que la calibración de un canal deje de hacerse por SQL (§43, §44) y pase por la
API con la misma regla de la migración 18, con la clave de administrador (punto 41), sin pisar un cambio ajeno (bloqueo optimista) y con
rastro en `evento`; y que el porcentaje de la ficha, del histórico y del canal en vivo salga con la escala nueva sin reescribir nada guardado.

**Método.** (1) **Base:** la migración 21 (`db/init/21-canal-actualizado-en.sql`) aplicada dos veces sobre la base de desarrollo; dos casos
nuevos en `db/pruebas/reglas-identidad.sql` (31 y 32) y la comprobación 21 del paso 2 del guardián. Al implementarla se vio que
`canal.actualizado_en` y su disparador ya existían desde la migración 05 (`\d canal` en la base de desarrollo): la 21 los asegura con la misma
forma, los documenta como marca del bloqueo y da a `plataforma_app` `UPDATE` solo en `escala_cero` y `escala_cien` (antes no podía actualizar
`canal`: `has_table_privilege` daba falso). Como el `REVOKE ALL` de la migración 14 borraría ese permiso al reejecutarla, la 14 lo repite si
las columnas existen. (2) **Backend:** `validarEscalas` (una sola regla para el alta y el `PATCH`), `validarCalibracion`, `AltaService.calibrar`
y `CanalesAdminController`, con unitarias sobre dobles de `pool` (sin base). El `actualizado_en` viaja como texto ISO 8601 UTC con
microsegundos, armado por la base (`db/iso-us.ts`) y devuelto tal cual: un `Date` de JavaScript solo guarda milisegundos y el bloqueo daría
409 siempre. (3) **Violación plantada:** el disparador deshabilitado dentro de una transacción que se deshace → el caso 31 da «FALLA
actualizado_en conservó el valor que traía el UPDATE: falta el disparador»; restaurado (sigue habilitado), en verde. (4) **Banco:**
`banco.sh encender 5` (imagen reconstruida; reaplica las migraciones 02 a 21) y `banco.sh nodo`, que ahora calibra el canal de suelo por
`PATCH` en vez de por SQL. (5) **Pila de desarrollo:** `pila.sh encender` y un `PATCH` real sobre el canal `humedad` de `demo-suelo-01`, que
se dejó como estaba (sin calibración) al final.

| Comprobación | Dónde | Resultado |
|---|---|---|
| Migración 21 aplicada dos veces sobre la base de desarrollo: las dos terminan en `COMMIT`, salida 0 | `psql -v ON_ERROR_STOP=1` | ✅ |
| Reaplicar las migraciones 02 a 21 sobre la base recién creada no cambia el esquema ni el catálogo (permisos incluidos) | `banco.sh migraciones` (las 20 de la 02 a la 21, reaplicadas) | ✅ |
| El disparador pone `actualizado_en` en `now()` en un `UPDATE` que traía otro valor; un `UPDATE` que deja una sola escala lo rechaza `ck_canal_escala` | `reglas-identidad.sql`, casos 31 y 32 (33 OK de 33) | ✅ |
| `plataforma_app` actualiza `escala_cero` y `escala_cien`, y no `actualizado_en`, `dispositivo_id` ni `magnitud_codigo`; el disparador habilitado y la columna documentada | `verificar-todo.sh` paso 2, comprobación 21 (corrida sola) | ✅ |
| Alta: una sola escala, iguales, `NaN`, infinito (el `1e400` de JSON) o texto → 400 con el motivo; las dos o ninguna → el `INSERT` las guarda y la respuesta las devuelve | `alta.dto.spec.ts` (1), `alta.service.spec.ts` (1) | ✅ |
| `PATCH`: una sola escala, iguales, no finitas, sin `actualizado_en` o con más de 6 decimales, campos ajenos → 400; las dos `null` quitan la calibración | `calibracion.spec.ts` (5) | ✅ |
| `PATCH` con el `actualizado_en` vigente: fila bloqueada (`FOR NO KEY UPDATE`), `UPDATE … AND actualizado_en = $4::timestamptz`, evento `canal_calibrado` con `antes` y `despues` en la misma transacción, 200 con el canal y el `actualizado_en` nuevo; con uno viejo, 409 «alguien lo cambió a las HH:MM UTC (…); recarga» con el vigente, `ROLLBACK` y sin evento; canal inexistente → 404 sin `UPDATE`; `ck_canal_escala` → 400 y `lock_timeout` → 503; la guardia de la clave en el controlador y el UUID validado antes del servicio | `calibracion.spec.ts` (6) | ✅ |
| Banco, de punta a punta: la ficha entrega `actualizado_en` con microsegundos; `PATCH` con una sola escala → 400; sin `X-Clave-Admin` → 401; con el de la ficha → 200 (2,205 V = 0 %, 1,170 V = 100 %); el segundo con el viejo → 409; la base queda con la calibración del 200 y un solo evento `canal_calibrado`; tras publicar el pack del nodo, 0,6 % en la ficha, en el histórico (`escala` y `porcentajes`) y en el evento `medicion` del canal en vivo (SSE) | `banco.sh nodo` | ✅ **23/23** («NODO OK») |
| Pila de desarrollo: `PATCH` con el `actualizado_en` de la ficha → **200**; el segundo con el viejo → **409**; una sola escala → **400**; quitar la calibración → **200**; dos eventos `canal_calibrado` del canal | `curl` contra `127.0.0.1:3000`, clave leída del `.env` sin imprimirla | ✅ |
| Contrato: 14 rutas y 17 operaciones; `PATCH /canales/{id}` con un identificador que no es UUID y sin la clave → 401, antes de mirar el UUID | `api-smoke.sh` («TODO OK») | ✅ |

**Resultados.** Backend (`pnpm verificar`): **355** pruebas en 31 suites (antes 342 en 30), tipos y lint sin errores; panel sin cambios
(76 pruebas; `svelte-check` con 331 archivos y 0 errores). `openapi.json` regenerado con `pnpm openapi`: 14 rutas (antes 13).

**Lo que no cubre.** (1) El proxy sí cuenta `PATCH /canales/{id}` en la zona de tasa de administración desde el mismo día (§47, 23/23);
lo que no se mide aquí es el ritmo de la zona bajo carga mixta. (2) El panel todavía no calibra: la ficha ya entrega
`actualizado_en`, y la pantalla que lo use es de otro bloque. (3) Dos `PATCH` simultáneos con el mismo `actualizado_en` no se probaron en
paralelo contra una base: el segundo espera el bloqueo de la fila y, al reevaluar el `WHERE`, no encuentra la marca (409); se sostiene en el
comportamiento de `READ COMMITTED` de PostgreSQL, no en una medición.

## 52. Segundo incremento del panel: leyenda, cambio de rango sin blanco, hora del sitio, resolución elegible y comparación (22/10/2026)

**Qué se prueba** (`docs/19 §4`, «Incremento 2 de P3 y P2»): los seis puntos del diseño, con pruebas por el DOM y de funciones puras, un
recorrido con navegador real que se corrió primero contra el build anterior del panel (para ver que detecta la falta) y después contra el
nuevo, y la medición del costo de cada resolución antes de ofrecerla (punto 4).

**Método.** (1) **Backend:** `GET /canales/{id}/historico` rechaza con 400, antes de consultar, una ventana de más de 5 000 cubos (ventana ÷
intervalo) o, desde la revisión del mismo día, de más de 366 días (`consulta/validacion.ts`, `exigirTopeCubos`); contrato en el decorador OpenAPI y `openapi.json` regenerado; un caso nuevo en
`pruebas/api-smoke.sh`. (2) **Panel:** funciones puras nuevas (`resolucionesAdmisibles`, `resumenRango`, `alinearSeries` en `lib/grafico.ts`;
`desfase` y `relojSitio` en `lib/tiempo.ts`; la URL de P3b en `lib/vista.ts`) y componentes nuevos (`ZonaSitio`, `SelectorRango`,
`Comparar` = P3b), probados en jsdom con la API y el canal en vivo simulados. (3) **Violaciones plantadas:** sin la llamada al tope en el
controlador, falla 1 prueba del backend; con huecos `undefined` en la alineación y el máximo de puntos en 5 000, fallan 4 pruebas en el panel;
restauradas, todas en verde. (4) **Navegador real** (`banco.sh encender 5` y `banco.sh navegador`): el recorrido de `e2e/p3.mjs` suma las
comprobaciones del diseño; se corrió primero con el paquete del panel anterior a este incremento copiado en el backend del banco (la API ya
con el tope), después con el nuevo, en Firefox y en Chromium (`NAVEGADOR=chromium`). (5) **Medición** en el banco, nunca en la pila de
desarrollo: una serie sembrada de 30 días a una lectura cada 10 s (259 200 filas) en el canal de temperatura de `emu-0004`; para cada rango ×
resolución ofrecida, la mediana de 10 peticiones HTTP (`curl`, `time_total`, tras una de calentamiento), los bytes de la respuesta y, de la
misma consulta que hace el servicio, `EXPLAIN (ANALYZE, BUFFERS)` (filas leídas por los nodos hoja, mediana de 3 ejecuciones, bloques).

| Punto del diseño | Prueba | Dónde |
|---|---|---|
| 1. La leyenda informa | Clic en «promedio» y en «lectura actual»: ningún `u-off` y los mismos puntos; con el cursor, la leyenda sigue dando el valor | navegador (3) |
| 2. Cambio sin blanco | Al cambiar de rango, la serie anterior se conserva con «cargando…» y el grupo ocupado; con la respuesta, se reemplaza y recién entonces se escribe la URL; con error, la serie y la URL siguen, aparece «Reintentar» y recupera; rango vacío con el gráfico sin puntos; cada rango, resolución y tarjeta de canal deja la ficha en su URL con puntos o con el mensaje de vacío; «Ver la última medición» lleva a 24 h | `Ficha.test.ts` (3), navegador (11) |
| 3. Hora del sitio y aviso | Desfase de Santiago en verano (UTC−03:00) e invierno (UTC−04:00), Madrid (UTC+02:00 y UTC+01:00), UTC, India (UTC+05:30) y sin `longOffset`; reloj con segundos; aviso solo con el navegador en otra zona; en P2 una zona o «N zonas horarias» | `lib/tiempo.test.ts` (3), `ZonaSitio.test.ts` (2), `Ficha.test.ts` (1), `Inventario.test.ts` (1), navegador (2) |
| 4. Resolución elegible | Admisibles por rango (30 días desde 1 h, 7 días desde 5 min, 24 h desde 1 min); la elegida va en la URL y vuelve a «auto» si el rango nuevo no la admite; la de la URL se aplica; tope de 5 000 cubos (borde exacto) | `lib/grafico.test.ts` (2), `lib/vista.test.ts` (1), `Ficha.test.ts` (2), backend `validacion.spec.ts` (2), navegador (4) |
| 5. Comparar (P3b) | URL de ida y vuelta con ids inválidos, repetidos y más de 6; alineación con hueco `null`; una serie por dispositivo con la misma ventana e intervalo; «sin canal de X», «unidad distinta (K)», «ya no existe», menos de 2, ninguno que la mida; una sola conexión a `GET /eventos` y la fila al día sin recargar; casillas y «Comparar (N)» en P2 | `lib/vista.test.ts` (2), `lib/grafico.test.ts` (2), `Comparar.test.ts` (4), `Inventario.test.ts` (1), navegador (3) |
| 6. Lo que el rango ya sabe | Mín, máx y promedio de los promedios (sin nulos); enlace a `GET /dispositivos/{id}/exportar` con la ventana visible, que responde 200 con el CSV | `lib/grafico.test.ts` (1), `Ficha.test.ts` (1), navegador (1) |

**El recorrido con navegador, antes y después** (el anterior es el paquete del panel previo a este incremento; un paso que se corta cuenta
como una falla y los demás siguen):

| Comprobación | Antes | Después |
|---|---|---|
| Las 9 del recorrido anterior (puntos contra `/historico`, formatos, vivo, caída y vuelta, sin errores de JavaScript) | OK | OK |
| Clic en «promedio» de la leyenda | FALLA: 1 fila `u-off` | OK |
| Clic en «lectura actual» de la leyenda | FALLA: 2 filas `u-off` | OK |
| La leyenda sigue el cursor | OK | OK |
| Cada uno de los 4 rangos deja la ficha en su URL con puntos o vacío | OK (4) | OK (4) |
| Las resoluciones de cada rango (4 comprobaciones) | FALLA (4): no hay selector | OK (4: 4, 6, 6 y 4 opciones) |
| Las tarjetas de canal | OK | OK |
| Resumen del rango y CSV | FALLA: no existen | OK |
| «Última hora» vacía: mensaje y gráfico sin puntos | OK (el lienzo, en blanco: sin eje) | OK (el eje de la ventana pedida, en la captura) |
| «Ver la última medición» lleva a 24 h en la misma ficha | OK | OK |
| Navegador en Europe/Madrid: hora del sitio y aviso | FALLA: no existe | OK |
| Navegador en la zona del sitio: hora, sin aviso | (no se llegó) | OK |
| P3b: dos series con puntos desde «Comparar (2)»; «7 días» conserva la pantalla; la fila en vivo sin recargar | FALLA: no hay casillas (1) | OK (3) |
| **Total** | **17 de 26 OK, 9 fallan** | **29 de 29 OK** (Firefox v155.0 y Chromium v153.0.8010.12) |

**Medición rango × resolución** (antes = las cuatro combinaciones fijas, marcadas «fija»; después = todas las que se ofrecen):

| Rango | Resolución | | Puntos | HTTP, mediana (ms) | Bytes | Filas leídas | SQL (ms) | Bloques |
|---|---|---|---|---|---|---|---|---|
| 1 hora | 1 min | fija | 60 | 2,8 | 1 490 | 356 | 0,6 | 49 |
| 1 hora | 5 min | | 13 | 2,6 | 572 | 356 | 0,6 | 49 |
| 1 hora | 15 min | | 5 | 2,6 | 405 | 356 | 0,6 | 49 |
| 24 horas | 1 min | | 1 440 | 9,4 | 28 837 | 8 636 | 7,1 | 108 |
| 24 horas | 5 min | | 289 | 7,0 | 6 333 | 8 636 | 5,6 | 108 |
| 24 horas | 15 min | fija | 97 | 6,7 | 2 331 | 8 636 | 5,7 | 108 |
| 24 horas | 1 h | | 25 | 6,5 | 848 | 8 636 | 5,2 | 108 |
| 24 horas | 6 h | | 5 | 6,6 | 412 | 8 636 | 5,3 | 108 |
| 7 días | 5 min | | 2 017 | 51,9 | 42 446 | 60 478 | 19,8 | 809 |
| 7 días | 15 min | | 673 | 44,7 | 14 377 | 60 478 | 18,8 | 809 |
| 7 días | 1 h | fija | 169 | 40,8 | 4 000 | 60 478 | 18,5 | 809 |
| 7 días | 6 h | | 29 | 41,5 | 959 | 60 475 | 19,5 | 809 |
| 7 días | 1 día | | 8 | 41,5 | 477 | 60 475 | 18,8 | 809 |
| 30 días | 1 h | | 721 | 179,4 | 16 078 | 259 195 | 130,4 | 2 965 |
| 30 días | 6 h | fija | 121 | 147,2 | 3 056 | 259 195 | 125,5 | 2 965 |
| 30 días | 1 día | | 31 | 180,9 | 999 | 259 195 | 128,3 | 2 965 |

Una segunda corrida completa dio lo mismo salvo el tiempo HTTP de 30 días, que osciló entre 147 y 181 ms sin relación con la resolución
(esa vez la fija midió 181 ms y la de 1 día 147): en ese rango la diferencia entre resoluciones es ruido. Los puntos son uno más que la
ventana ÷ intervalo cuando la ventana no empieza en el borde de un cubo. **Conclusión:** toda resolución de un rango lee las mismas filas
crudas (salvo dos o tres por el borde del cubo), así que la más fina cuesta, frente a la fija, 1,4 veces el tiempo en 24 h (9,4 frente a 6,7 ms), 1,3 veces en 7 días (52 frente a
41 ms) y lo mismo dentro del ruido en 30 días, y entre 5 y 12 veces los bytes (como mucho 42 KB): el costo lo pone el rango, no la
resolución. El tope del servidor se comprobó también contra la API del banco: 7 días cada minuto (10 080 cubos) → 400 con el motivo; 5 000
cubos exactos → 200; 5 001 → 400.

**Resultados.** Backend (`pnpm verificar`): **357** pruebas en 31 suites (antes 355), tipos y lint sin errores. Panel: **102** pruebas en 12
archivos (antes 76 en 10), `svelte-check` con 337 archivos y 0 errores, y el build. Navegador: **29 de 29** en Firefox y en Chromium.

**Tropiezos, corregidos antes de cerrar.** (1) La primera corrida de P3b falló 2 de 29: con dos emulados que miden temperatura y humedad, la
magnitud por defecto (la más común, a igual cuenta la primera por nombre) fue humedad, que no tenía lecturas; es lo que el diseño pide, así
que el recorrido elige la temperatura en el selector, como lo haría una persona. (2) En jsdom, un `change` sin `bubbles` no llega al
manejador del selector: Svelte 5 delega ese evento en la raíz del documento.

**Lo que no cubre.** (1) La medición es de un portátil con la base en RAM y un solo canal con datos; con muchos canales la caché de la base
se reparte. (2) Los agregados materializados por tarea (los continuos de TimescaleDB no existen en la edición Apache, `docs/10 §8.4` punto 11),
que bajarían las filas leídas en 7 y 30 días, no se midieron: quedan como mejora aparte. (3) El eje de la ventana vacía y los colores de P3b se revisan en las capturas, no con una comprobación automática. (4) La comparación
dibuja como mucho 6 dispositivos de un mismo sitio o de sitios con la misma zona en el eje; con varias zonas, el eje va en la del primero.

## 53. Corrida de 24 h del nodo real (23–24/10/2026)

**Qué se prueba** (TT-32; `docs/17 §6.2`): que el nodo propio publique sin pérdidas durante un día completo por una red Wi-Fi
doméstica, cifrado hasta el proxy, y qué hace la plataforma con lo que llega: lecturas, huecos, reconexiones y datos inválidos.

**Método.** `nodo-0001` (ESP32 con BME280, DS18B20 y sensor capacitivo de suelo; firmware de la fase 2) publica un pack SenML de seis
registros cada 60 s por MQTT con TLS y QoS 1 al proxy del portátil, que corre la pila de desarrollo. Ventana: 24 h exactas entre el
23 y el 24/10/2026 (UTC−03:00); las horas de esta sección son las del reloj del portátil durante la corrida. Durante la corrida, `pruebas/vigilar-corrida.sh` revisó cada 60 s la red del
portátil, el proxy, `/salud`, el inhibidor de suspensión y la corriente, y el monitor serie guardó todo lo que imprimió el nodo. Al cerrar,
`pruebas/corrida-larga.sh nodo-0001 24`, consultas a la base con la ventana exacta y los registros del backend, el broker y el proxy.

| Medida | Resultado |
|---|---|
| Tramas recibidas | **1 440 de 1 440** (una por minuto), todas con la marca de tiempo del nodo (`bt`, hora por NTP) |
| Huecos de más de 2 × 60 s entre lecturas | **0** en `humedad_suelo`, `temperatura_suelo`, `rssi` y `humedad`; en `temperatura`, 1 de 8 040 s y en `presion`, la última lectura guardada es de las 15:23:39 (la de 15:24:39 fue a cuarentena; ambos por la falla del sensor, abajo) |
| Alarmas de silencio (`sin_comunicacion`) | 0 |
| Reinicios del nodo | 0 (un solo arranque en el registro serie) |
| Publicaciones sin acuse (PUBACK) en 5 s | 1 de 1 440 (23:46:39): la trama llegó al broker con 6,85 s de demora y se guardó una vez; el nodo cortó, falló un saludo TLS (15,8 s según el proxy), reconectó al segundo intento y el ciclo siguiente salió normal |
| Diferencia entre la marca del nodo y la recepción | mediana 0,81 s, percentil 99 de 0,97 s (1,09 s en `presion`). Es una cota, no la latencia: `bt` va en segundos enteros truncados y los relojes de nodo y servidor se sincronizan por separado |
| Tramas a cuarentena | 210, todas `invalida` por valor fuera del rango físico de su magnitud (abajo) |
| Vigilante | 143 líneas «OK» (una cada 10 min) y 1 alerta: a las 15:25:24 no vio el inhibidor de suspensión; a las 15:34:24, «OK». La IP, la red, el proxy, `/salud` y la corriente no cambiaron |

**Falla del sensor de aire durante la corrida.** A las 15:24:39 el bus I2C del BME280 empezó a fallar (666 errores de lectura en el
registro serie) y la biblioteca, que no informa errores de bus, entregó números finitos pero falsos. El pipeline los trató así:

| Tramo | Lo que publicó el nodo | Lo que hizo la plataforma |
|---|---|---|
| 15:24:39 (1 ciclo) | presión −149,14 hPa | presión a cuarentena; temperatura y humedad, plausibles, guardadas |
| 15:25:39 → 17:37:39 (133 ciclos) | 183,03 °C, 100,0 %RH, −185,01 hPa | temperatura y presión a cuarentena por rango físico ([−40, 85] °C y [800, 1 100] hPa); **la humedad de 100 % se guardó**: está dentro de [0, 100] |
| 17:38:39 → cierre (76 ciclos) | 22,10 °C, 82,3 %RH y 709,07 hPa, idénticos en cada ciclo | presión a cuarentena; **temperatura y humedad congeladas, guardadas** |

Mientras tanto, el panel mostró el dispositivo en «Normal»: el equipo seguía reportando, y una presión ausente o un valor repetido no son,
para el estado visual (`docs/19 §2`), motivo de alerta. Los canales de suelo y de señal siguieron sin interrupción. Las 133 humedades
falsas y las 76 lecturas congeladas de temperatura y humedad quedan en la base como llegaron (la historia no se reescribe); se
identifican por su tramo y su valor.

**Qué se cambió por esta corrida.** (1) **Firmware** (`docs/17 §6.2`, «Salud del BME280 en cada ciclo»): el nodo comprueba el identificador
y el modo del sensor antes y después de leerlo, compara sus bytes crudos con los del ciclo anterior y, ante cualquier anomalía, omite sus
tres magnitudes; un watchdog de 120 s reinicia el nodo si una vuelta se cuelga. En la placa, después de la corrida y con el contacto todavía
intermitente: al arrancar mostró el sensor con todos sus registros de control en `0x00` (se había reiniciado y quedó sin medir) y, en el
primer ciclo, «el BME280 no responde por I2C, omitido», con un pack de tres registros (suelo y señal) en vez de basura. El watchdog se
probó en la placa el 24/10 con el entorno `nodo-prueba-vigia`, que cuelga el loop a propósito en el ciclo 2: dos veces seguidas el nodo
se reinició 120,0 s después del aviso (`task_wdt: … loopTask`, `rst:0xc (SW_CPU_RESET)`) y volvió a publicar solo; después se regrabó el
entorno `nodo`. La plataforma vio cada cuelgue sin saber nada del firmware: dos condiciones «sin comunicación» abiertas con 3 min
entre sí (como los cuelgues) y cerradas al volver el nodo, a los 58 y 64 s. Queda por ver en la placa el camino «congelado», que no se pudo provocar a voluntad. (2) **Panel**
(`docs/19 §4`, P3): un canal sin lecturas dentro de 2 × el intervalo esperado, con el dispositivo en línea, se marca «callado» en su tarjeta y
en la cabecera. (3) **Guiones:** `corrida-larga.sh` decía «visto por última vez nunca» porque leía la columna anterior a la migración 11 (hoy
lee `estado_dispositivo`) y no contaba el hueco final de un canal que calla (hoy la presión aparece con 1 hueco); `vigilar-corrida.sh`
escribía la IP, la puerta de enlace y el nombre de la red en su registro, y desde esta corrida solo registra si cambiaron.

**Lo que esta corrida no midió.** El porcentaje de humedad del suelo al mojar la tierra (no se regó durante la corrida: entre 2,07 y
2,22 V, a lo más 13 % según la calibración del canal) ni la memoria de la pila a lo largo del día (con carga se midió en §5 y §49). Un valor congelado como condición en la base
(para que el estado pase a «Alerta») queda como decisión de diseño pendiente.

## 54. Panel: canal callado y el inventario en un teléfono (24/10/2026)

**Qué se prueba.** Dos cambios del panel que dejó la corrida de §53: (1) el **canal callado** de `docs/19 §4` (P3), un canal sin
lecturas dentro de 2 × su intervalo esperado con el equipo en línea; y (2) **RF-52** (`docs/19 §1`: una columna en pantallas angostas,
tablas con desplazamiento propio), que se encontró roto al medir el panel en anchos de teléfono.

**Canal callado.** Una función pura (`canalCallado`, `lib/estado-visual.ts`) con 4 pruebas: el caso de la presión de §53 (3 h 30 min
sin lecturas con el equipo reportando), el borde de la tolerancia (120 s no calla, 121 s sí), el canal que nunca leyó y el equipo fuera
de línea (no se marca canal por canal: manda «Sin señal»). Una prueba por el DOM de la ficha: al cargar, la tarjeta del canal sin lecturas
dice «sin lecturas · callado» y la cabecera «1 canal callado»; una lectura en vivo lo quita; 130 s después calla el otro canal; cuando el
equipo deja de reportar, ninguna tarjeta queda marcada. **Plantado** (una violación a la vez, restaurada después): el borde con `>=`,
la regla sin la condición de equipo en línea, la plantilla sin la clase y sin el espacio antes de «callado»: cada una hace fallar 1 prueba.
**En la pila de desarrollo**, con un navegador real (Firefox): los tres canales del BME280, que el nodo omite desde que su contacto falla,
aparecen callados; los del suelo y la señal, no; sin errores de JavaScript.

**El inventario en un teléfono.** Medido con Playwright, el ancho de la página contra el de la ventana en P2 y P3, a 320, 375, 414, 768 y
1 280 px, en Firefox y en Chromium:

| Pila de desarrollo | Antes | Después |
|---|---|---|
| P2, Firefox, 320 px | la página se desplaza 117 px | 0 |
| P2, Chromium, 320 / 375 / 414 px | 117 / 62 / 23 px | 0 / 0 / 0 |
| P3, todos los anchos, y P2 desde 768 px | 0 | 0 |

La causa: el filtro de zona toma el ancho de su opción más larga (en el campus, «Campus Dr. Luis Rivas del Canto · Laboratorio») y su
rótulo no se encogía. Corrección en `app.css`: en pantalla angosta, un filtro por fila y el control al ancho que quede. El recorrido con
navegador (`e2e/p3.mjs`) suma la comprobación **RF-52**: P2 y P3 a 320, 375 y 414 px sin desplazamiento horizontal de la página, el peor
de 8 muestras en 2 s (el filtro toma su ancho final un instante después de dibujar las filas, y una medición temprana daba OK con el
error presente); `banco.sh navegador` deja a `emu-0003` en una zona de nombre largo para que el filtro la tenga. **Plantado:** con el CSS
anterior, Chromium da P2 con 188, 133 y 94 px (3 fallas); Firefox, dentro del recorrido, deja ese filtro en 77 px y no lo reproduce (en
una página suelta lo lleva a 457 px; se observó, la causa no se confirmó), así que RF-52 se juzga con los dos navegadores. Con el CSS
nuevo: **35 de 35 en Chromium y 35 de 35 en Firefox**, y en una medición aparte, 0 px en los 20 casos del banco y en los 20 de la pila.

**Totales.** 107 pruebas del panel en 12 archivos, `svelte-check` con 337 archivos y 0 errores, y el build. En una de las corridas con el
CSS anterior, Chromium no vio «reconectando» dentro de 20 s tras detener el backend del banco; la corrida siguiente pasó: queda anotada
como intermitente, sin causa confirmada.


## 55. Revisión manual de secretos antes de la entrega (25/10/2026)

**Por qué.** El escaneo automático con `gitleaks` en el CI queda para la Etapa 4 (`docs/11 §4`); antes de entregar se hace una pasada
manual sobre el árbol y **todo el historial** (205 commits de todas las ramas, `git log --all -p`). Solo se cuentan coincidencias y se
miran el archivo, el nombre de la variable y el largo del valor: ningún valor se imprime.

| Qué se buscó | Árbol | Historial | Resultado |
|---|---|---|---|
| Claves privadas (`BEGIN … PRIVATE KEY`), llaves de AWS, tokens de GitHub, Slack, Google y de servicios de IA, JWT, URL con usuario y clave | 0 | 0 | limpio |
| Archivos `.env`, `.pem`, `.key`, `.crt`, `.p12` alguna vez versionados | — | solo `plataforma/.env.example` | sus seis claves son marcadores para cambiar; los otros tres valores son nombres (base, usuario y sonda) |
| Asignaciones con forma de secreto (`clave`, `secreto`, `token`, `password` = texto de 8 o más) | 9 | — | nombres de cabeceras HTTP, valores de las pruebas unitarias y una clave equivocada a propósito en `plataforma/pruebas/base-rol-app.sh` (la prueba de que otra clave no entra); en `historico/herramientas/contactid.py`, la constante de protocolo de DC-09 |
| Hashes `scrypt` con parámetros | 4 | 4 | prefijos de las pruebas de `plataforma/backend/src/alta/credenciales.spec.ts`, sin hash real |
| Direcciones IPv4 fuera de 127.x, 0.0.0.0 y los rangos de documentación (RFC 5737) | 0 | — | limpio |

**Lo que no cubre:** formatos de secreto que no estén en la lista (lo cubrirá `gitleaks`, con sus reglas mantenidas) y los datos personales,
que revisa el paso 2f del guardián.

## 56. TypeScript 6 y una excepción de auditoría que sobraba (26/10/2026)

**Por qué.** Dependabot propuso TypeScript 6.0.3 (PR #11) y la verificación automática lo detuvo con diez errores: los `*.spec.ts`
no reconocían `describe`, `it` ni `expect`. TypeScript 6 cambia el valor por defecto de `types` a una lista vacía («In TypeScript 6.0,
the default `types` value will be `[]`», https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/), y `tsconfig.json`
dependía del valor anterior, que cargaba todos los paquetes `@types`.

**Qué cambió.** TypeScript 6.0.3 (publicada el 16/04/2026) en el backend y el panel; `tsconfig.json` declara `"types": ["node", "jest"]`
y `tsconfig.build.json` solo `["node"]`, así la compilación de producción no conoce los tipos de las pruebas. Compatibilidad revisada en
el registro de npm: ts-jest 29.4.15 (`typescript >=4.3 <7`), typescript-eslint 8 (`<6.1.0`) y svelte-check 4 (`^5 || ^6`). TypeScript 7
queda fuera hasta que typescript-eslint la admita (regla en `.github/dependabot.yml`).

**Aviso retirado.** La única excepción de la auditoría (`braces`, https://github.com/advisories/GHSA-vfj7-8cjw-p6xm, §12) la retiró
GitHub el 23/10/2026, pero el paso 2q del guardián solo miraba si había versión corregida y la seguía mostrando como vigente. Se quitó
la excepción; el paso 2q falla ahora también con un aviso retirado, y el CI lo muestra como advertencia «Excepción sobrante (aviso
retirado)» (`plataforma/pruebas/avisos-dependencias.sh`), que avisa sin bloquear.

| Comprobación | Resultado |
|---|---|
| `pnpm verificar` (tipos, lint, pruebas del backend y del panel) | 357 + 107 pruebas en verde; `svelte-check` 340 archivos, 0 errores |
| `tsc --noEmit --listFilesOnly` (backend) | 95 archivos de `src/`; el build de producción no incluye ningún `*.spec.ts` |
| `pnpm audit --audit-level=high`, sin excepciones | sin avisos (y sin avisos en producción a ningún nivel) |
| Paso 2q con el `pnpm-workspace.yaml` anterior (violación plantada) | FALLA: «fue retirado por GitHub» |
| Paso 2q con el archivo actual | OK: la auditoría no ignora ningún aviso |

## 57. Tope de conexiones del broker: plantado en un broker desechable (01/11/2026)

**Qué cambió** (`docs/10 §8.4` punto 57; `docs/11 §3`). `max_connections 1200` en `mosquitto.conf` de la pila y del banco; antes el broker
aceptaba conexiones sin límite (valor por defecto de Mosquitto). El guardián 2l exige el mismo valor en las dos configuraciones.

**Cómo se probó.** Un broker desechable (`eclipse-mosquitto:2.1.2-alpine`, la misma imagen de la pila, con `--entrypoint mosquitto` y la
configuración montada en una ruta neutra) con `allow_anonymous true` y `max_connections 3`; cinco clientes `mosquitto_sub` en contenedores
que comparten su red.

| Comprobación | Resultado |
|---|---|
| Clientes 1 a 3 | «New client connected … as cliente1», «cliente2», «cliente3» |
| Clientes 4 y 5 | «Client connection from 127.0.0.1 denied: max_connections exceeded», repetido en cada reintento |
| Pila de desarrollo tras reiniciar el contenedor del broker (el tope no se aplica con una recarga) | broker `healthy`; `/salud` con el broker conectado |
| Descriptores de archivo del contenedor (revisión del 01/11) | `/proc/1/limits` decía 1 024: con eso el tope de 1 200 no se alcanzaba; `ulimits nofile 4096` en el compose de la pila y del banco; tras recrear el contenedor, 4 096 |

**Lo que no prueba.** Que 1 200 sea el número correcto para un servidor concreto: es el de la flota dimensionada más holgura, y se revisa
con la primera medición de conexiones reales (`$SYS/broker/clients/connected`, que el backend ya muestrea).

## 58. Sesión de personas, usuarios y roles por sitio (08/11/2026)

**Qué cambió** (`docs/20`; `docs/10 §8.4` puntos 36, 41 y 43; `docs/11 §3`). Migración 22 (`sesion`, `acceso` como hypertable, clave
temporal de `usuario`, `usuario_sitio.activo`, `fn_limpiar_sesiones`), el módulo `backend/src/sesion/` (M7) y el guardia central: toda
ruta exige la cookie de sesión (`__Host-sesion` desde la revisión del mismo día) o la clave de administrador, salvo `/salud`, `POST /sesion` y la recepción por HTTP. Las pruebas unitarias
del backend pasan de 357 a 413 (nuevas: permisos, cookie y vencimientos con reloj simulado, privacidad de los registros de acceso, reglas de la clave, bloqueos, turnos del hash,
la sesión contra una base falsa, el guardia y los cuerpos de usuarios; adaptadas: canal en vivo, retención, calibración e histórico). El
guardián suma el paso 4b y un chequeo de la migración 22 en el paso 2.

**Costo de `scrypt` con N = 2¹⁷** (r = 8, p = 1; una verificación, 10 repeticiones; `backend/src/alta/credenciales.ts`):

| Dónde | N = 2¹⁷ (personas) | N = 2¹⁵ (dispositivos) |
|---|---|---|
| Portátil de desarrollo, Node 22.23.2 | mediana 250 ms (237–253) | mediana 64 ms |
| Contenedor del backend, Node 22.23.4, con su techo de 0,5 CPU y 512 MB | mediana 508 ms (498–556) | mediana 117 ms |
| `POST /sesion` de punta a punta contra el contenedor (paso 4b) | mediana ≈ 465 ms (clave mala y usuario inexistente) | — |

El objetivo del diseño (100–300 ms por verificación) se cumple con un núcleo entero; con el medio núcleo que el compose le da hoy al backend,
la verificación dura el doble porque el cálculo es de CPU. Un inicio de sesión de medio segundo es aceptable para una persona; lo que no se
acepta es la memoria: cada cálculo pide 128 MiB, así que el backend admite como mucho dos a la vez (`sesion/turnos.ts`) y el resto espera.
Si el servidor de referencia mantiene 0,5 CPU, revisar en la Etapa 4 si conviene subir el techo de CPU del backend o bajar N a 2¹⁶.

**Cookie `Secure` en desarrollo** (`docs/20 §3`). En `http://127.0.0.1:3000`, con Chromium 156 y Firefox 157 sin interfaz (los que trae
Playwright 1.64.1, ya en el árbol del panel): `POST /sesion` 200, `GET /sesion` 200 y `GET /dispositivos` 200 con la cookie que el
navegador guardó (`secure: true`, `httpOnly: true`, `sameSite: Lax`, `path: /`); `document.cookie` vacío. Los dos tratan el loopback como
contexto seguro: no hizo falta `HTTP_COOKIE_SEGURA`. curl 8.18 también la guarda y la devuelve con `-c`/`-b`.

**La matriz de `docs/20 §6`, por HTTP** (`plataforma/pruebas/sesion-smoke.sh`, paso 4b). Datos propios y desechables: dos sitios, dos
dispositivos HTTP por sitio y un canal en cada uno; el primer administrador lo crea la clave de administrador, y él a un usuario de
consulta. Todo se borra al salir (comprobado: 0 usuarios, sesiones, accesos, sitios y dispositivos de prueba después de cada corrida).

| Comprobación | Resultado |
|---|---|
| Corrida completa | 95 de 95 comprobaciones; con el administrador creado por SQL (cuando la base ya tiene uno), 89 de 89. Tras la revisión de seguridad (abajo): 111 de 111, y 105 de 105 con el administrador por SQL |
| Sin sesión | 401 «sesión requerida» en las 8 lecturas, el canal en vivo y las 7 rutas que escriben; `/salud` 200 |
| Consulta en su sitio | lecturas 200, la lista solo con su sitio; exportar y todo lo que escribe, 403 |
| Administrador en su sitio | lecturas y exportar 200; alta 201, calibración 200 y 409 con la marca vieja, rotación 201, baja 200 y 409 repetida |
| Otro sitio | 404 en ficha, histórico, condiciones, cuarentena, canal en vivo y exportar (consulta) y en alta, baja, rotación, calibración y alta de usuario (administrador); el 404 de otro sitio y el de un dispositivo inexistente tienen el mismo cuerpo |
| CSRF | ruta que escribe con sesión y sin `X-Pedido: panel` → 403; `POST /sesion` sin ella → 403 |
| Primer administrador | con `X-Clave-Admin` sin administradores → 201 con clave temporal; con uno ya creado → 403; con la temporal, solo `GET /sesion` (lo demás 403) hasta cambiarla |
| Canal en vivo con dos sitios | una medición por HTTP en cada sitio: el flujo del usuario de consulta trae la de su sitio y no la del otro; el sexto flujo del mismo usuario → 429, otro usuario abre el suyo |
| Igual respuesta, igual tiempo | inactivo, clave mala e inexistente: 401 «credenciales no válidas»; medianas de 5 intentos 467 y 471 ms (diferencia 4 ms, tolerancia 79 ms) |
| Bloqueo | tras 5 claves malas, la sexta con la clave CORRECTA → 429 «bloqueado»; `acceso` con 5 `clave_incorrecta` y 1 `bloqueado` |
| Desactivar, cerrar, carrera | desactivar corta su sesión (401); dos inicios simultáneos dan dos sesiones válidas distintas; cerrar deja la sesión revocada en la base y el identificador viejo responde 401; «cerrar en todos lados» corta las demás |
| Cookie leída con `curl -D -` | `Set-Cookie: sesion=…; HttpOnly; Secure; SameSite=Lax; Path=/`; desde la revisión, `__Host-sesion=…`, sin `Domain` |

**Plantado.** (1) Sin el chequeo de sitio en la ficha (`GET /dispositivos/{id}`), el paso 4b falla en 3 casos (otro sitio responde 200 con
los datos, para consulta y para administrador, y el cuerpo deja de ser el de un inexistente); restaurado, 95 de 95. (2) Con `consulta` en
la acción `exportar` de la tabla de permisos, fallan tres de las pruebas de `permisos.spec.ts`. (3) El chequeo de la migración 22 del paso 2
da FALLA con un `GRANT UPDATE ON acceso` y con un `GRANT UPDATE (email) ON usuario` a `plataforma_app` dentro de una transacción que se
deshace, y OK sin ellos.

**Revisión de seguridad del bloque (08/11/2026; decisiones en `docs/20 §10`, R1–R21).** Pruebas unitarias del backend: de 413 a 436
(nuevas en `usuarios.service.spec.ts`, la sesión, los bloqueos, los turnos, el usuario del sistema, el canal en vivo, el mapa de sitios y
`rutaSinCache`). El paso 4b pasa de 95 a 111 comprobaciones. Lo medido contra el backend reconstruido:

| Comprobación | Resultado |
|---|---|
| Corrida completa del paso 4b | 111 de 111 (59 s); con `SESION_SMOKE_ADMIN_POR_SQL=1`, 105 de 105 |
| Cierre del canal en vivo al cerrar la sesión (R2) | el flujo abierto con la sesión que se cierra termina solo **24,0 s** después del cierre (el siguiente latido; tope del caso, 30 s), sin latido final; el de una sesión viva recibe su latido y sigue hasta que curl lo corta a los 32 s |
| Escalada entre sitios (R1) | el administrador de A, sobre una persona de A que también está en B: desactivar 403 con el mensaje, clave temporal 403, su rol en A 200; la cuenta queda igual (misma huella de clave, activo y vencimiento); sobre quien solo está en A, 200 |
| Carrera del último administrador (R3) | dos administradores (los únicos de la base) se desactivan el uno al otro a la vez: una 200 y la otra 409; queda 1 administrador activo |
| Bloqueos (R6) | 8 intentos del mismo correo (5 malos y 3 bloqueados): `acceso` con 5 `clave_incorrecta` y **1** `bloqueado` |
| `GET /usuarios` con `X-Clave-Admin` habiendo administrador (R10) | 403 |
| `Cache-Control` (R14) | `no-store` en `GET /usuarios` y en `GET /salud`; `/panel/` sigue con `public, max-age=0` |
| Cookie `__Host-sesion` (R15) | `curl -D -`: `HttpOnly; Secure; SameSite=Lax; Path=/`, sin `Domain`. Con Playwright, contra la pila real en `http://127.0.0.1:3000` y una persona de prueba creada y borrada por SQL: Chromium 156 y Firefox 157 dan `POST /sesion` 200, guardan `__Host-sesion` (`secure`, `httpOnly`, `sameSite: Lax`, `path: /`, dominio `127.0.0.1`) y `GET /sesion` 200; `document.cookie` vacío. En un servidor mínimo, los dos descartan una `__Host-` sin `Secure` o con `Path=/ver` |
| Limpieza (R21) | con un error plantado en el SQL de limpieza: el aviso trae el error, los residuos por patrón (`sitios pa-/pb-: 3; usuarios *@ejemplo.invalid: 1; …`) y la orden `--limpiar SUFIJO`, que después limpia y deja 0 |
| Hash de relleno calculado al arrancar (R16) | inexistente y clave mala siguen tardando lo mismo: 473 y 478 ms (medianas de 5; tolerancia 84 ms) |

**Plantado** (cada corrección, quitada a mano, hace fallar su prueba; se restauró y todo vuelve a pasar): en jest, R1 (2 pruebas),
R3 (1), R4 (1), R6 (2), R8 (2 sin el tope por dirección, 1 si el 503 no cuenta), R10 (1), R11 (1 sin el umbral, 1 con el refresco antes
de los topes), R12 (1), R14 (1), R15 (5 con el nombre viejo), R16 (1), R17 (1), R18 (2), R2 (2 sin revalidar, 1 si revalida renovando la
actividad). Contra el backend reconstruido con R1, R3, R10 y R2 quitados a la vez, el paso 4b dio 8 fallas: la clave lista con 200, el
administrador de A desactiva a la persona de B (200) y la cuenta cambia, las dos desactivaciones cruzadas pasan (200 y 200) y la
plataforma queda con **0** administradores, y el flujo de la sesión cerrada recibe su latido y sigue hasta que curl lo corta a los 40 s.
R7 (nginx) lo cubre el paso 2m (la plantilla renderizada y válida); el límite no se midió con ráfagas en esta tanda.

**Lo que no prueba.** La pantalla de inicio de sesión (P10: hecha después ese mismo día, §59). El bloqueo por
dirección (50 fallos) solo tiene prueba unitaria: por HTTP, cada corrida del paso 4b deja 12 fallos desde su dirección de origen (una distinta del bucle local por corrida, `ORIGEN` en el guion; antes, la misma, y y más de
cuatro corridas en 15 minutos recibían 429: el bloqueo funcionando, corregido el 08/11 sin tocar el backend). El banco (`banco.sh`) lee ahora
con la clave de administrador, pero no se corrió en esta tanda.

**Memoria con dos inicios de sesión simultáneos** (medido después, el mismo día, con el paso 4b ampliado; detalle en §59). Tres rondas de
dos `POST /sesion` a la vez contra el contenedor del backend: de 57–64 MiB en reposo a un pico de **315–321 MiB** (dos corridas) (`memory.current` del cgroup,
muestreado cada 20 ms; `docker stats --no-stream` dio el mismo máximo en sus 3 muestras). El techo es 512 MiB: queda un margen de unos 190 MiB
con los dos cálculos de `scrypt` que admite `turnos.ts`. `docs/20 §10` cita esta cifra en lugar de «bajo el techo de 512 MB».

## 59. El panel con sesión: P10, usuarios, componentes y descargas (08/11/2026)

**Qué cambió** (`docs/19 §4`, P10, y §6; `docs/20 §10`). El panel inicia sesión: pantalla «Entrar» (`Entrar.svelte`), cambio obligatorio de la
clave temporal (`CambiarClave.svelte`), quién soy, «Salir» y «Cerrar en todos lados» en la cabecera, renovación con interacción, vuelta a la
ruta guardada tras un 401 y la pantalla de usuarios (`Usuarios.svelte`) con la guía de perfiles derivada de la matriz de permisos
(`lib/ayudas.ts`). Un solo cliente HTTP (`lib/api.ts`): cookie del mismo origen, `X-Pedido: panel` en lo que escribe, 401, 403 por clave
temporal, 409, 429 y sin red tratados en un lugar, «gana la última» y descargas por `fetch` y Blob. Componentes `Boton.svelte`,
`Tooltip.svelte` y `Aviso.svelte` (regla nueva de `docs/19 §6`). En el backend, `GET /sesion` trae la matriz rol → acciones
(`matrizPorRol()`, de `PERMISOS`) y el 429 de `POST /sesion/clave` trae `reintentar_en_s`; `openapi.json` regenerado. La semilla de desarrollo
crea un administrador y un usuario de consulta de demostración con claves temporales impresas una vez.

**Cifras.** Pruebas del panel: de 107 a 165 del panel (nuevas: el cliente HTTP, la guía de perfiles contra la matriz y contra las acciones
del servidor, las reglas de la clave contra los números del servidor, la sesión y su renovación, los componentes, los flujos de P10 por el
DOM, la pantalla de usuarios, el canal en vivo al ser rechazado, la ruta `#/usuarios`, la exportación según el rol y las descargas que
fallan; adaptadas las de la ficha, que ya no tiene enlaces a la API). Pruebas unitarias del backend: de 436 a 445. Paso 4b
(`sesion-smoke.sh`): 123 de 123 comprobaciones en 64 s (124 desde la vigencia configurable de la temporal, abajo), con el administrador de prueba creado por SQL porque la base de desarrollo ya tiene
uno (el de la semilla); la carrera del último administrador se omite en ese caso y lo dice. Nuevas en 4b: `POST /pasarelas`,
`DELETE /pasarelas/{id}` y `POST /pasarelas/{id}/credencial` sin sesión (401), con consulta (403) y en otro sitio (404), sin que ninguna
pasarela quede creada ni dada de baja; `PATCH /usuarios/{id}` de quien solo está en otro sitio (404, el mismo cuerpo que uno inexistente, y
la persona sin cambios); `GET /condiciones`, `GET /cuarentena` y `GET /pasarelas` sin `?dispositivo=` filtrados por sitio; y la memoria.

**Memoria del backend con dos `POST /sesion` simultáneos** (paso 4b, tres rondas; dos corridas): `docker stats --no-stream` antes 57 y 64 MiB; pico 315 y 321 MiB
(`memory.current` del cgroup cada 20 ms, 220 muestras; `docker stats`, 3 muestras, el mismo máximo); techo 512 MiB. Es la cifra que cita
`docs/20 §10`. **La pila entera en ese instante** (medido después, el mismo día: el paso 4b suma en cada muestra de `docker stats --no-stream`
los cuatro contenedores, backend, base, broker y proxy): máximo **387, 386, 394, 398 y 402 MiB** en cinco corridas (2 o 3 muestras completas cada una; el backend,
312 a 320 MiB por el cgroup); se cita el mayor, 402 MiB, y varía entre corridas porque docker stats muestrea cada 1–2 s. Es la cifra que citan `docs/01`, `docs/14`, la conclusión y las láminas junto a los 324 MiB de la corrida de carga.

**Con navegador real: paso 4c** (`pruebas/panel-sesion-e2e.sh` y `backend/panel/e2e/sesion.mjs`, Playwright 1.64.1), contra la pila de
desarrollo en `http://127.0.0.1:3000` con el panel servido por la imagen del backend. Datos propios y desechables (un sitio, un dispositivo
HTTP con 6 mediciones de la última hora y personas `@ejemplo.invalid`), borrados al salir; las claves viajan por la entrada estándar.

| Comprobación | Resultado |
|---|---|
| Corrida completa | **118 de 118** (desde la revisión de seguridad, abajo; antes 112 en 28 s): 59 en Chromium 156 y 59 en Firefox 157, cada uno a 390 px (teléfono) y a 1280 px (escritorio) |
| Entrar | `autocomplete` username y current-password; una clave mala → «Correo o clave incorrectos. Revisa los dos y vuelve a intentarlo.» |
| Clave temporal | el panel exige elegir una propia, con las reglas a la vista; la cookie `__Host-sesion` es HttpOnly, Secure, SameSite=Lax, Path=/; `document.cookie` vacío; con la temporal, la API responde 403 a lo demás |
| Dentro | el inventario con el dispositivo, quién soy con su sitio y rol, el canal en vivo «conectado» recién después de entrar |
| Exportar | «Descargar CSV de este rango» descarga el archivo con su nombre (cabecera y 6 filas) por `fetch` y Blob; la página no navega a la API |
| Sesión vencida | sin la cookie, el siguiente clic responde 401: «Entrar» con «Tu sesión venció o se cerró…»; al entrar, vuelve a la misma ficha |
| Usuarios (1280 px) | la guía de perfiles sale de la matriz; el alta muestra la temporal de 24 caracteres una vez y, al ocultarla, ya no está en la página; «Asignar clave temporal» muestra una nueva solo en el aviso (ni en la fila ni la del alta) y, al ocultarla, tampoco queda |
| Consulta (1280 px) | la persona creada en la pantalla entra con su temporal, la cambia y ve «Descargar CSV» desactivado con «exportar exige el rol administrador en este sitio»; sin «Usuarios»; «Cerrar en todos lados» vuelve a «Entrar» |
| Salir | vuelve a «Entrar», la cookie se borró y la API responde 401 |
| RF-52 y errores | sin desplazamiento horizontal en ninguna pantalla a 390 ni a 1280 px; sin errores de JavaScript |
| Sin navegadores o sin backend | el guion sale con 3 y el guardián lo cuenta como omitido (probado con `E2E_NAVEGADORES=webkit`, que no está instalado) |

Capturas (Chromium, datos de prueba sin personas reales; la hora del sitio, el gráfico y los vencimientos van tapados, para no fechar la corrida): `docs/capturas/panel-sesion/` (entrar y cambio de clave a 390 px, inventario a 390 y
1280 px, usuarios y la ficha vista por consulta a 1280 px).

**Lo que encontró el navegador y no las pruebas por el DOM** (corregido antes de cerrar): (1) la primera corrida no pudo entrar con ninguna
temporal: el ayudante que crea personas de prueba hasheaba la clave con el salto de línea que agrega `<<<` (`lib-personas.sh` ahora lee una
línea y la pasa con `printf '%s'`); la semilla corrida antes de la corrección quedó con claves inservibles y se volvió a correr; (2) «Salir» dejaba el panel en la
pantalla de la persona anterior (la consulta entraba a `#/usuarios`): ahora vuelve al inventario; (3) en la cabecera oscura, «Cambiar la
clave» y «Cerrar en todos lados» eran invisibles y la hora de vencimiento salía en «p. m.»: contraste y formato de 24 h corregidos.

**Plantado.** Por el DOM (vitest), cada regla quitada a mano hace fallar sus pruebas y, restaurada, pasan las 154: sin `X-Pedido` (7 fallan),
sin el manejo central del 401 (4), sin el aviso del 403 por clave temporal (2), sin los segundos del 429 (2), sin `credentials` (3), la
descarga con un enlace a la API (1), sin cancelar la petición anterior (1), un `Boton` sin etiqueta admitido (1), el tooltip solo con el ratón
(1), el motivo de desactivado sin escribir (5), renovar sin esperar 5 min (3), el canal preguntando por la sesión en cada reintento (1), la
ayuda escrita a mano (2), exportar sin mirar el rol (1), entrar sin pasar por el cambio de la temporal (1), no volver a la ruta guardada (1), el
409 como error común (1), «Salir» sin volver al inventario (1) y el vencimiento en formato de 12 h (1). En jest, sin `permisos` en
`GET /sesion` y sin `reintentar_en_s` en el 429 del cambio de clave fallan 2. El paso 4c falló de verdad dos veces antes de la corrección
(arriba, (1) y (2)).

**Lo que no prueba.** El CI no corre el paso 4c: necesita la pila con la base, el broker y el backend, y GitHub Actions corre solo
`pnpm verificar` sin servicios (sí corre las pruebas del backend y del panel por `pnpm verificar` y `pnpm audit`, que no prueba nada en
ejecución: solo avisos publicados de las dependencias). No se plantó en el backend la falta del filtro por sitio en las listas sin `?dispositivo=` (la
orden se detuvo antes de correr); esas comprobaciones nuevas del paso 4b solo se vieron pasar.

**Revisión de seguridad del panel con sesión** (el mismo día, después; cada corrección con su falla plantada antes de restaurarla):

| Corrección | Prueba y lo que falló al plantar |
|---|---|
| La temporal de «Asignar clave temporal» ya no queda en la lista de usuarios (solo en el aviso hasta «ocultar»; `lib/usuarios.ts`, `aplicarRespuesta`) | vitest: con la fila guardada con `clave`, falla 1; e2e: la clave asignada aparece una sola vez en la página y desaparece al ocultarla |
| Las claves del paso 4c ya no viajan como argumento de `python3` | traza de `bash -x` sobre una copia y 222 510 líneas de `ps -eo args` muestreadas durante la corrida: 0 con una clave (las 4 líneas de la traza con clave son `printf`, interno de bash) |
| Las personas de demostración de la semilla solo con el backend en bucle local (`127.0.0.1`, `localhost`); con otra dirección se omiten con aviso, salvo `SEMILLA_PERSONAS=1` | con `API` remota no cambió el vencimiento guardado; con la comprobación plantada (siempre «local») las reasignó |
| El 401 central olvida también la temporal recién escrita (`lib/sesion.ts`, `trasAvisoDeSesion`) | vitest: sin la línea, falla 1 |
| Un 403 de clave temporal sin sesión o en «Entrar» se ignora, y los avisos de peticiones iniciadas antes del último inicio de sesión o de la salida se descartan (`lib/api.ts`, generación de la sesión) | vitest: sin la generación fallan 2 (un 401 atrasado sacaba de la sesión recién abierta); sin la generación ni la fase, 4 (un 403 atrasado abría «Elige tu clave» sin sesión) |
| `nombreDeArchivo` con un `%` mal formado usa el nombre por defecto | vitest: sin el `try`, falla 1 (URIError) |
| La clave temporal ya no es región viva: `role="status"` solo en el texto del aviso | vitest: con el atributo en el contenedor, falla 1 |
| El muestreo de memoria del paso 4b corre bajo `timeout 90s` y `limpiar` lo mata por PID | cortado con TERM a mitad: 0 procesos `docker stats` a los 3 s; con KILL (sin trap): 2 a los 30 s y 0 a los 100 s; sin `timeout` (plantado), 2 a los 100 s, quitados a mano |
| El usuario del sistema (clave por cabecera) no ve «Usuarios» | vitest: sin la condición, falla 1 |

**Banco con navegador, adaptado a la sesión.** `banco.sh navegador` pasa la clave de administrador del banco a `e2e/p3.mjs` por la entrada
estándar; el navegador la manda como `X-Clave-Admin` en toda petición (también el canal en vivo) y el CSV se baja con el botón (evento de
descarga, nombre y contenido). Resultado: **35 de 35** en Firefox 157. Plantado: sin la cabecera en la página principal, la primera espera
se corta (el panel muestra «Entrar»).

**Vigencia configurable de la clave temporal** (decisión del 08/11/2026; `docs/20 §4`). `CLAVE_TEMPORAL_HORAS`, entero de 1 a 72, 2 por
defecto (`arranque.ts`, `horasClaveTemporal`), en `.env.example` y en el compose (guardianes 2d y 2z, cada uno plantado quitando la
línea). Pruebas unitarias del backend: 2 h por defecto (vale a 1 h 59, vencida a 2 h y 1 s), 24 h configuradas, 5 h en el alta y al asignar otra, y 0, 73 o texto
detienen la construcción del servicio; plantados el valor por defecto en 24 (fallan 3), sin el tope de 72 (2), el servicio sin leer la
variable (1) y la cuenta en minutos (3). Arranque real con 0, 73 y «dos»: el contenedor sale con 1 y el mensaje
«CLAVE_TEMPORAL_HORAS="…" no es válido: se espera un entero de horas entre 1 y 72 (por defecto 2)». Paso 4b: la respuesta del alta vence
a las horas que rigen (7 200 s con 2 h; 18 000 s con el backend levantado con 5 h); plantado esperando 24 h, falla. El panel muestra la hora
que devuelve el servidor (`clave_temporal_vence_en`), no un plazo propio (vitest plantado con «Vence en 24 horas»: falla 1).

**Cifras finales del bloque.** Pruebas del panel: 165; del backend: 445; paso 4b: 124 de 124; paso 4c: 118 de 118; banco con navegador:
35 de 35.

## 60. Backend en ES modules y pruebas con vitest (11/11/2026)

**Por qué** (`docs/10 §8.4` punto 63, TT-47). `@nestjs/config` 12 se publica solo como ES module (`"type": "module"` en su
`package.json`), y su actualización (PR #15 de Dependabot) no compilaba en el CI: 18 errores TS1479 («The current file is a CommonJS
module whose imports will produce 'require' calls; however, the referenced file is an ECMAScript module») y 4 TS1541. Con el backend en
CommonJS esa actualización, y después NestJS 12, quedaban cerradas.

**Qué cambió.**

| Pieza | Antes | Después |
|---|---|---|
| Formato del paquete | CommonJS (`package.json` sin `"type"`) | `"type": "module"` |
| `tsconfig.json` | `module` y `moduleResolution` `node16`; `types` `["node", "jest"]` | `nodenext`; `types` `["node"]`; `experimentalDecorators` y `emitDecoratorMetadata` sin cambios |
| Importaciones relativas | 360 sin extensión | 360 con `.js` (ninguna apunta a una carpeta); `@nestjs/common/constants` → `@nestjs/common/constants.js` (el paquete no declara `exports`) |
| Ruta del panel y de las migraciones | `__dirname` (`main.ts`, `lorawan.spec.ts`) | `import.meta.dirname` (Node ≥ 20.11) |
| Zona UTC | `process.env.TZ = 'UTC'` antes de las importaciones de `main.ts`, `exportar-openapi.ts` y `emulador.ts` | módulo `zona-utc.ts`, importado primero: en ES modules las importaciones se evalúan antes que el cuerpo del archivo, y la asignación habría corrido después de cargar todo. En `main.ts` y `exportar-openapi.ts` lo precede `import 'reflect-metadata'` |
| Pruebas unitarias | jest 30.5.2 + ts-jest 29.4.15, configuración en `package.json` | vitest 5.0.5 (la versión del panel), `vitest.config.ts`, sin globales: cada `*.spec.ts` importa de `vitest` lo que usa; 95 `jest.*` → `vi.*`, 16 `jest.Mock` → `Mock`, 2 `jest.SpyInstance` → `MockInstance` |
| Emulador (`pnpm emulador`, `banco.sh`) | ts-node 10.9.2 `--transpile-only` | tsx 4.23.15 (MIT, publicada el 20/09/2026) |
| Dependencias de desarrollo | jest, ts-jest, ts-node, `@types/jest` | vitest, tsx; `esbuild` (llega con tsx) con su script de instalación bloqueado (`allowBuilds: false`; pnpm instala el binario de la plataforma como dependencia opcional) |
| Guardián, paso 0 | filtraba la línea `Tests:` de jest | filtra `Tests  N passed (N)` de vitest (la del backend y la del panel); lo que comprueba no cambió |

Lo que no cambió: el `Dockerfile` (solo su comentario «sin jest»), el `HEALTHCHECK` (`node -e "require('http')…"`: el código de `-e` es
CommonJS aunque el paquete sea `"type": "module"`), las importaciones desde paquetes CommonJS (`pg`, `mqtt`, `helmet` y los de NestJS
cargan desde ES modules sin «Named export not found»: el grafo completo cargó en `pnpm openapi` y en el contenedor) y `openapi.json`.
Dos guiones de prueba (`lib-personas.sh` y `sesion-smoke.sh`) cargan `dist/alta/credenciales.js` con `require` dentro del contenedor:
con `"type": "module"` eso es `require(esm)`, estable desde Node 22.12 (la imagen usa 22.23); `engines.node` pasa a `>=22.12 <23`
para que el backend no corra en una versión donde fallaría.

**Tres decisiones.** (1) **tsx y no la ejecución nativa de TypeScript de Node 22**: la nativa exige importar con `.ts`, y el código importa
con `.js`, que es lo que pide `nodenext` para que `tsc` emita rutas válidas. (2) **El spec con `Test.createTestingModule`**
(`tiempo-real/eventos.spec.ts`, el canal por HTTP real) **quedó igual**: vitest 5 transforma con oxc, que lee `emitDecoratorMetadata`
de `tsconfig.json` y emite la metadata de los constructores; comprobado con una prueba temporal que leyó `design:paramtypes` de
`EventosController` (`EventosService`, `SitiosDeDispositivos`) y se borró. Así la prueba sigue armando el módulo como en producción.
(3) **El falso de `mqtt`** (`broker.service.spec.ts`): `vi.mock('mqtt', () => ({ default: { connect } }))`; en ES modules la importación
por defecto es la clave `default`, y la marca `__esModule` de jest sobra. Una opción de jest sin equivalente: `doNotFake` (en
`recepcion.service.spec.ts`, que solo finge la fecha) pasó a `toFake: ['Date']`.

**Cómo se verificó** (la pila de desarrollo arriba; base, broker y proxy sin tocar: se reconstruyó y recreó solo el backend, con
`docker compose build backend` y `up -d --no-deps backend`).

| Comprobación | Resultado |
|---|---|
| `pnpm verificar` | tipos (120 archivos de `src/`), ESLint (120 archivos, 0 hallazgos), las pruebas unitarias del backend en 41 archivos (445 ese día; tras §61, 486 en 45 archivos y, con su corrección, 513 en 49) y 241 del panel; en verde |
| `pnpm openapi` | 18 rutas; `openapi.json` sin diferencias |
| Imagen y arranque | `dist/` en ES modules; el contenedor `healthy` a los 6 s; el `HEALTHCHECK` a mano, salida 0; `new Date(0).toString()` en el contenedor, `GMT+0000`; `/panel/` 200 (la ruta con `import.meta.dirname`); en los registros, solo el aviso esperado de `/docs` |
| `api-smoke.sh` | 71 OK, TODO OK |
| `sesion-smoke.sh` (paso 4b) | 124 de 124 |
| Banco: `encender` (la semilla la genera el emulador con tsx) y `correr` (100 nodos, 60 s) | 3 020 tramas, 0 pérdidas, latencia p95 4 ms, 0 en cuarentena |
| Banco, 120 nodos, 90 s (tráfico de §3), con la imagen nueva y con la anterior, cada una en un banco nuevo | nueva: 5 546 tramas, 0 pérdidas, p95 5 ms, `sin_comunicacion` 7 en nodos con caída y 21 falsas, 12 de umbral; anterior (CommonJS): 5 538 tramas, 0 pérdidas, p95 4 ms, 9 con caída y 26 falsas, 12 de umbral. Del mismo orden: el cambio no altera el pipeline. Las 3 falsas de la corrida 4 (07/10) no se repiten con ninguna de las dos imágenes |

**Antes y después.**

| Medida | Antes (jest, CommonJS) | Después (vitest, ES modules) |
|---|---|---|
| `pnpm test`, tres corridas seguidas | 3,4 s la primera; 2,7 s las siguientes | 2,8 s la primera; 2,4–2,5 s las siguientes |
| Pruebas unitarias del backend | 445 en 41 archivos | 445 en 41 archivos |
| `pnpm audit` | 3 avisos de desarrollo: `glob` y `minimatch` (moderados), `deepmerge` (bajo) | los mismos 3; rutas: `glob` de 131 a 1 (`@nestjs/cli`), `minimatch` de 200 a 34 (`eslint`, `@nestjs/cli`), `deepmerge` de 8 a 2 (`@nestjs/cli`, el plugin de Svelte) |
| `pnpm audit --prod` y `--audit-level=high` | 0 | 0 |
| Paquetes en `pnpm-lock.yaml` | 856 (8 235 líneas) | 601 (5 640 líneas): salen 283, entran tsx, esbuild y 26 binarios de esbuild por plataforma |
| Imagen `plataforma-backend` | 403 MB en disco, 90,5 MB de contenido | 403 MB, 90,5 MB (las dependencias de producción no cambiaron) |

Quitar jest no eliminó ningún aviso de la auditoría: la cadena jest → `test-exclude` → `glob` desapareció, pero `glob` y `minimatch`
siguen llegando por `@nestjs/cli` y `eslint`, y `deepmerge` por `@nestjs/cli` y el panel. Ninguno entra a la imagen. Licencias de las
dependencias nuevas, todas de desarrollo y fuera de la imagen (`pnpm licenses list`): tsx, esbuild y sus binarios por plataforma, vitest y
vite, MIT; entre sus transitivas, `terser` BSD-2-Clause, `expect-type` Apache-2.0 y `lightningcss` MPL-2.0 (ya presente por Vite en el
panel); compatibles con la AGPL-3.0 del código propio y sin redistribución.

**Cómo repetirlo:** `cd plataforma/backend && pnpm verificar && pnpm audit && pnpm openapi`; con la pila arriba,
`bash plataforma/pruebas/api-smoke.sh`, `bash plataforma/pruebas/sesion-smoke.sh`, `bash plataforma/pruebas/banco/banco.sh encender 120`,
`banco.sh correr --duracion 90 --dispositivos 120`, `banco.sh apagar` y `bash plataforma/pruebas/verificar-todo.sh`.

## 61. Backend del tablero v2: resumen, históricos, keyset, reglas y lote (11/11/2026)

**Qué cambió** (`docs/19 §4`, bloque «Tablero v2», I; `docs/10 §8.4` puntos 28, 58 y 65). Migración 23 (`23-tablero.sql`):
`regla_umbral.retardo_s` (0–86 400, CHECK) y `fuera_de_banda_desde`; `evento.usuario_id` con su clave foránea e índice; tres índices de
lista por clave en el sentido del orden, `(tiempo DESC, id DESC)` (con `id` ascendente el índice no sirve al desempate); y
`fn_quitar_reglas`, una función del dueño acotada a un canal, porque la aplicación sigue sin `DELETE` en ninguna tabla. Rutas nuevas:
`GET /sitios`, `GET /sitios/{id}/resumen`, `GET /sitios/{id}/historico`, `GET /dispositivos/{id}/historico`,
`GET /dispositivos/{id}/eventos`, `GET /cuarentena/detectados`, `PATCH /dispositivos/{id}`, `PUT /canales/{id}/reglas` y
`POST /dispositivos/lote` (todas «Etapa 4»). Cambios compatibles: `minimos` y `maximos` en el histórico de un canal; filtros, página,
`X-Total`, `orden=nombre|entrega`, `estado_visual` y `entrega` (ventana fija de 24 h; la del resumen es la del rango) en el inventario; `cursor` y `X-Siguiente` en `GET /condiciones` y `GET /cuarentena`, y `desde` y
`hasta` en `GET /condiciones` (la ficha dibuja las condiciones dentro de la ventana); `actualizado_en` del dispositivo y `retardo_s` de
cada regla en la ficha. El filtro alertar respeta el retardo de activación. Un solo ayudante inserta los eventos de las escrituras con
persona (`db/evento.ts`): alta, baja, rotación, calibración, pasarelas, configuración y, desde la corrección de abajo, el lote
(`registrarEventos`, una sentencia para todas sus filas; antes lo insertaba su propio SQL). Los de usuarios y sesión (`sesion/`) todavía
insertan por su cuenta y sin `usuario_id`: quedan para el bloque de usuarios. Permisos: una acción nueva, `configurar`
(fila «Configurar un dispositivo…» de `docs/20 §6`), hoy del administrador de sitio; el lote y los detectados usan `escribir`.

**Cómo se verificó.** (1) Pruebas unitarias nuevas de las funciones puras: estado visual con los mismos casos que el panel y el orden de
las ramas en el SQL, entrega, cursor (ida y vuelta y manipulado), filtros del inventario, alineación de series, resolución del rango,
validación de reglas y del cambio de dispositivo, lote (rechazadas que no bloquean, «existe», zona ambigua, unidad no canónica, tope de 500
en el borde, tasa) y el retardo en los dos sentidos, con una plantada: sin la guarda, la misma lectura abre antes de tiempo. (2)
`api-smoke.sh`: la forma de cada respuesta nueva, que los indicadores del resumen suman el inventario del sitio (`X-Total`), dos páginas de
eventos que siguen sin repetirse, 400 y 409 de las escrituras sin cambiar nada, y un lote que valida sin crear. (3) `sesion-smoke.sh`: una
fila por ruta nueva y perfil (401, 403, 404, 200, 409 y 400), el evento con `usuario_id` de quien configuró y un lote con una fila creada,
una de otro sitio rechazada como inexistente y una que ya existe. (4) La migración 23, dos veces en la pila de desarrollo y en la base nueva
del banco (`banco.sh encender`: las migraciones 02 a 23 reaplicadas sin error y sin cambiar el esquema ni el catálogo).

**Mediciones** en el banco (`banco.sh encender 5`), con la serie de §52 ampliada: 30 días a una lectura cada 10 s en el canal de
temperatura de dos emulados (518 400 filas) y 259 200 tramas de uno; mediana de 10 peticiones tras una de calentamiento (`time_total`).

| Petición | Rango · resolución | Mediana | Bytes |
|---|---|---|---|
| `GET /sitios/{id}/resumen` | 1 h · 1 minuto | 4,8 ms | 4 212 |
| | 24 h · 5 minutos | 10,5 ms | 16 182 |
| | 7 días · 1 hora | 46,0 ms | 10 162 |
| | 30 días · 6 horas | 168,7 ms | 7 741 |
| `GET /sitios/{id}/historico?magnitud=temperatura` | 1 h · 1 minuto | 3,8 ms | 2 578 |
| | 24 h · 5 minutos | 15,9 ms | 10 910 |
| | 7 días · 1 hora | 129,8 ms | 6 530 |
| | 30 días · 6 horas | 485,6 ms | 4 165 |
| | 30 días · 1 hora | 493,1 ms | 26 623 |
| `GET /dispositivos/{id}/historico` | 30 días · 1 hora | 280,5 ms | 33 262 |
| `GET /canales/{id}/historico` (referencia) | 30 días · 1 hora | 192,0 ms | 25 126 |
| `GET /dispositivos` (inventario con estado visual y entrega) | — | 27,6 ms | 2 968 |

Todas bajo los 3 s de RNF-04. **Keyset** (`EXPLAIN (ANALYZE, BUFFERS)`, con 200 000 eventos y 200 000 condiciones sembradas en el banco):
la página de 50 de `GET /condiciones` lee 50 filas por `Index Only Scan using idx_condicion_abierta_en_id` (50 bloques, 0,08 ms); la de
eventos de un dispositivo, 50 filas por `idx_evento_dispositivo_ocurrido_en_id` (5 bloques). Plantada con `OFFSET 20000`: 20 050 filas y
19 404 bloques (3,8 ms) para la misma página. Precisión (corrección del mismo día): esas cifras son de una sentencia reducida
(`SELECT id, abierta_en FROM condicion ORDER BY abierta_en DESC, id DESC LIMIT 50`), no de la que corre el backend, que une
`dispositivo`, `zona`, `regla_umbral` y `canal`; con la sentencia real, abajo. `GET /cuarentena` usa `idx_cuarentena_recibido_en_id` en cada fragmento (pila de
desarrollo). **Lote de 500 filas** (banco, `X-Clave-Admin`, 112 KB de JSON): `modo=validar`, 7–20 ms; `modo=crear`, **70,2 s** (500
dispositivos, 1 000 canales, 500 credenciales, 500 eventos y 250 clientes en el broker; la segunda validación del mismo archivo da 500
«existe»). Lo que cuesta es el resumen scrypt de cada credencial (N = 2^15): 100 filas tardan 14 s por HTTP y 14 s por MQTT, y 500 resúmenes
en el portátil, fuera del contenedor, 8,2 s; el backend tiene 0,5 CPU. **Riesgo abierto:** detrás del proxy, una petición de más de 60 s
puede cortarse mientras el backend confirma, y las credenciales, que se muestran una sola vez, se perderían. Queda para decidir (pendiente):
lotes de creación más chicos, el resumen fuera de la petición o un costo de scrypt distinto para secretos aleatorios de 24 bytes (32 caracteres en base64url; corregido el 13/11/2026: decía 32 bytes). Se resolvió el 13/11/2026 guardándolos con SHA-256 (§65).
**Decidido el mismo día:** las tandas las hace el panel; el backend no cambia el tope de 500, y el OpenAPI de
`POST /dispositivos/lote` dice que una creación de 500 tarda ≈ 70 s y que el cliente debe validar el archivo entero y crear en tandas de 50
filas (≈ 7 s cada una).

**Corrección del bloque (revisión en tres frentes: privacidad y rendimiento, seguridad, concordancia; 11/11/2026).** Cada hallazgo se
verificó abriendo el archivo antes de corregirlo; cada corrección tiene su prueba, unitaria o de humo, en los dos sentidos.

| Hallazgo | Corrección | Prueba |
|---|---|---|
| El lote devolvía el `id` y el estado de un dispositivo, o la existencia de una pasarela, de **otro sitio** (la búsqueda por `id_fisico` no miraba el sitio) | Los catálogos traen el sitio de cada uno; lo ajeno es `rechazada: identificador no disponible`, sin `id` (RF-41) | `lote.spec.ts`; humo 4b: `tb-N` y `gwb-N` del sitio B subidos desde A, sin el UUID de B en la respuesta |
| Cualquier perfil con lectura veía el nombre de quien hizo cada cambio | Decidido: solo el administrador de ese sitio y el del sistema; los demás, `usuario: null` (`docs/21 §2`) | `autor.spec.ts`; humo 4b: consulta ve los 3 eventos sin nombre, el administrador con él |
| La retención de `trama` se medía desde `hasta`: una ventana pasada fuera de ella daba 0 % de entrega | Se mide desde ahora | `tablero.spec.ts`: de hace 60 a hace 45 días → nulo (plantada: con `hasta`, 0 %) |
| El inventario contaba las tramas de 24 h dos veces por dispositivo, siempre | Un `LEFT JOIN LATERAL` que se usa en los dos sitios | `EXPLAIN` antes y después (abajo) |
| División por `intervalo_esperado_s` sin protección | `NULLIF` y, en la migración 23, `ck_dispositivo_intervalo_esperado_s` **1..86 400** (la API exige 5; la semilla del banco siembra emulados de 1 a 6 s y con 5 dejaba de sembrar) | Plantada en el banco: 0 y 86 401 rechazados; la 23 dos veces en la pila y en el banco; paso 23 del guardián |
| Cursor con día inexistente o año 0000 → 500 | Ida y vuelta de la fecha y año ≥ 1900 → 400 | `tablero.spec.ts`; humo: 30 de febrero y año 0000 → 400 |
| `actualizado_en` con día inexistente → 500 en PATCH y PUT de reglas | Ida y vuelta en la validación y 22007/22008/22P02 → 400 en la transacción | `configuracion.dto.spec.ts` |
| El tope de 100 KiB miraba solo `Content-Length`: por trozos regía el de 512 KiB en todas las rutas | `verify` del lector de JSON cuenta lo leído | `arranque.spec.ts`; humo: 200 KiB por trozos a `PUT /canales/{id}/reglas` → 413 y uno chico → 409 |
| 500 scrypt a la vez en el pool de hilos | Tandas de 4 (`hashesEnTandas`) y el resumen de las altas, rotaciones y pasarelas de a uno ANTES de abrir la transacción | `credenciales.spec.ts` (a lo más 4 a la vez; plantada: sin tandas, más de 400); medición abajo |
| Reglas reasignadas por posición: una condición abierta quedaba con otros umbrales | Decidido: `reglas[{id?, …}]`, emparejadas por `id`; sin `id`, nueva; las que no vienen se quitan | `configuracion.service.spec.ts`: cambia la regla del `id`, no la primera; un `id` ajeno → 400 sin tocar nada |
| Marca de retardo obsoleta (tras mantenimiento o un silencio) abría sin retardo; mezclaba `now()` y `new Date()` | Hora de la lectura; marca más vieja que `retardo_s + 2 × intervalo` = nula; el mantenimiento la limpia | `alertas.service.spec.ts` (plantada: sin la vigencia, la misma lectura abría) |
| `detectados` mezclaba sitios para el usuario del sistema y descartaba los tópicos sin sitio | Agrupa por (sitio, emisor), `sitio_codigo`; `LEFT JOIN` | humo: la forma con `sitio_codigo` |
| El resumen devolvía la entrega de todos los activos | Los 50 peores y `total_activos` | `tablero.spec.ts`; humo: `len(entrega) == min(50, total_activos)` |
| El estado visual del SQL y el del panel «se probaban entre sí» sin una prueba que los cruzara; el SQL contaba como alerta cualquier tipo | El SQL enumera los cinco tipos, como el panel; el humo recalcula la regla de `docs/19 §2` fila por fila con `/condiciones` | `api-smoke.sh` (plantada a mano: con alerta antes que sin señal, 2 filas distintas) |
| El 409 del lote decía «id_fisico «lote de 500» ya existe» | «un identificador del lote ya existe: vuelve a validar» | `lote-servicio.spec.ts` |
| El paso 23 del guardián aceptaba cualquier índice (`LIKE '%id%'`) | Compara la definición exacta, en el sentido del orden | Plantado: el índice en orden ascendente → FALLA 23; deshecho → OK |
| docs/10 citaba 17 rutas y 23 operaciones | 25 rutas REST y 32 operaciones (26 y 33 con `/eventos`); paso 2h2 del guardián | Plantada una copia con la cifra vieja → FALLA |

**Hallazgo nuevo al medir (corregido):** con un lote de 500 en curso, un alta individual esperó su scrypt detrás de los 500 (≈ 70 s); su
transacción, abierta y ociosa, pasó su `idle_in_transaction_session_timeout` de 15 s, la base cortó la conexión y el evento `error` de un
cliente prestado sin oyente **tumbó el proceso** (el contenedor se reinició; el lote quedó sin crear). Se corrigió por tres lados: el
resumen fuera de la transacción, las tandas y un oyente de `error` mientras el cliente está prestado (`db/cliente.ts`, `cliente.spec.ts`).

**Mediciones con 120 fuentes** (banco, `banco.sh encender 120` y `tablero-semilla-serie.sql`): 30 días a una lectura cada 300 s en el canal
de temperatura de los 120 emulados (1 036 800 mediciones) y una trama por lectura (1 036 800 tramas); es lo que cabe en los 768 MB de la
base del banco (los datos viven en memoria dentro de ese techo). Mediana de 10 peticiones tras una de calentamiento, imagen anterior →
imagen corregida:

| Petición | Rango · resolución | Antes | Después | Bytes después |
|---|---|---|---|---|
| `GET /sitios/{id}/resumen` | 1 h · 1 minuto | 6,2 ms | 7,4 ms | 6 383 |
| | 24 h · 5 minutos | 25,9 ms | 27,2 ms | 21 014 |
| | 7 días · 1 hora | 151,2 ms | 151,5 ms | 15 031 |
| | 30 días · 6 horas | 664,8 ms | **619,7 ms** (el máximo) | 12 496 |
| | 30 días · 1 hora | 644,8 ms | 626,4 ms | 44 840 |
| `GET /sitios/{id}/historico?magnitud=temperatura` | 24 h · 5 minutos | 37,7 ms | 38,3 ms | 11 658 |
| | 30 días · 6 horas | 1 109,6 ms | 1 102,3 ms | 5 298 |
| | 30 días · 1 hora | 1 126,8 ms | **1 132,4 ms** (el máximo) | 29 665 |
| `GET /dispositivos/{id}/historico` | 30 días · 1 hora | 16,2 ms | 16,8 ms | 37 751 |
| `GET /dispositivos` | — | 11,2 ms | 9,4 ms | 122 201 (221 dispositivos) |

Los bytes del resumen bajan porque `entrega` trae los 50 peores, no los 120. El histórico del sitio lee ≈ 1 µs por lectura
(`EXPLAIN`: 1 036 680 filas por 120 recorridos del índice de `medicion`, 1,27 s); con el tope general de 366 días serían ≈ 13 s, así que
**su ventana se acota a 31 días** (`MAX_DIAS_SITIO`; humo: 31 días → 200, 31 días y 1 hora → 400). **Estimación, no medida:** el caso de
100 canales a 60 s (4,3 M lecturas en 30 días) no cabe en la base del banco; a ese ritmo serían ≈ 4,5 s, por encima de RNF-04: queda
pendiente decidir un tope por lecturas estimadas (canales × ventana ÷ intervalo) o un agregado continuo.

**Inventario, `EXPLAIN (ANALYZE, BUFFERS)` antes y después** (la consulta real, armada por `tablero-explicar-inventario.mjs`, 221
dispositivos): orden por nombre, de 6 recorridos de `idx_trama_dispositivo_id` por dispositivo (dos subconsultas × 3 fragmentos) a 3, de
3 605 a 2 372 bloques y de 13,8–14,7 ms a 9,0–9,5 ms; orden por entrega (página de 50), de 3 084 a 1 518 bloques, 7,4–9,2 ms en las dos.

**Listas por clave con la sentencia real** (`tablero-semilla-listas.sql` y `tablero-explicar.sql`; 400 000 condiciones, porque la primera
pasada de la semilla quedó a mitad cuando la base del banco se cortó por memoria, y 200 000 eventos de un dispositivo): la primera página de
`GET /condiciones` recorre `idx_condicion_abierta_en_id` (50 filas, 132 bloques con los JOIN, 0,56 ms); la misma a la mitad por cursor, 133
bloques y 0,27 ms; por `OFFSET 100000`, 102 137 bloques y 95 ms. Los eventos de un dispositivo, por
`idx_evento_dispositivo_ocurrido_en_id`, 100 bloques y 0,09 ms.

**Lote, antes y después de las tandas** (`tablero-medir.sh lote`, vía http: solo el costo de scrypt; a los 2 s, un alta individual a la
vez): 100 filas, 14,5 s → 14,1 s, y el alta individual 12,5 s → 0,9 s; 500 filas, el proceso caído a los 72 s (arriba) → 71,9 s con las
500 creadas, y el alta individual 1,0 s. El total no cambia (lo pone la CPU: 0,5 en el backend); cambia que nadie más espera detrás.

**Cómo repetirlo.** `bash plataforma/pruebas/banco/banco.sh encender 120`; la semilla, con el `psql` del banco (comando en la cabecera de
`plataforma/pruebas/banco/tablero-semilla-serie.sql`); `bash plataforma/pruebas/banco/tablero-medir.sh tiempos` (el bucle de
`curl -w '%{time_total}'`) y `tablero-medir.sh lote 500 x5`; el plan del inventario, desde `plataforma/backend`, con
`node ../pruebas/banco/tablero-explicar-inventario.mjs src/consulta/consulta.service.ts "$PWD/dist" nombre` por el `psql` del banco; las
listas, en un banco nuevo (no caben junto con la serie), `tablero-semilla-listas.sql` y `tablero-explicar.sql`; al final, `banco.sh apagar`.

**Cifras finales de la corrección:** `pnpm verificar` en verde (pruebas unitarias del backend: 552, en 53 archivos; el panel, las suyas);
`pnpm openapi`, 26 rutas y 33 operaciones (`orden` con `nombre | entrega | atencion` en `GET /dispositivos`, cabeceras `X-Total` y
`X-Siguiente` declaradas, `X-Clave-Admin` en las tres escrituras nuevas); `api-smoke.sh`, 114 OK; `sesion-smoke.sh` (paso 4b), 182 de 182;
la migración 23, dos pasadas en la pila y en el banco. El guardián, en verde en todo lo del backend (pasos 23, 2h2 y 2t incluidos); quedaron
en rojo, de otro bloque, las cifras del panel citadas en docs e informe (165, hoy 241) y el paso 4c del navegador (6 de 90: «usuarios» y
«salir» de la prueba del panel).

## 62. Panel del tablero v2: armazón, tema, tablero, inventario y ficha (11/11/2026)

**Qué cambió** (diseño: `docs/19 §4`, bloque «Tablero v2», puntos A a D; el contrato de la API, su punto I; el backend se construye
aparte contra el mismo contrato, y estas pruebas usan respuestas simuladas con esa forma).

- **Tokens y tema (A2, A3).** `app.css` define superficie, texto, borde, acento, los cuatro estados, las seis series, espaciado de 4 px,
  escala tipográfica y radios; ningún componente escribe un color. Tema oscuro por `prefers-color-scheme` y por `data-theme` en `<html>`
  (`lib/tema.ts`; la preferencia llegará en `GET /sesion → preferencias.tema`, hasta entonces «sistema»). Series de Okabe e Ito en el
  orden validado, en los dos temas; «promedio» en el azul y «lectura actual» en el naranja; ejes, rejilla, umbrales y franjas del lienzo
  también por tema.
- **Armazón (A1, A5).** Cabecera con selector de sitio (de `GET /sitios`, solo con más de uno, en la URL `?sitio=`; si no viene, la
  preferencia `sitio_predeterminado` o el primero), menú según el rol (las pantallas que aún no existen se nombran sin enlace), botón
  «Menú» con texto bajo 700 px, menú de cuenta y el pie «Legal y acerca de» con una página mínima `#/legal` (licencia AGPL y avisos de
  terceros), legible también sin sesión. La llegada es el tablero (`#/`); el inventario pasa a `#/inventario` y un enlace viejo
  `#/?estado=…` se redirige allí.
- **P1 Tablero (B).** Fila de filtros (preajustes y rango a medida con `datetime-local` en la hora del sitio, en la URL como `desde` y
  `hasta`), indicadores de una sola respuesta (`GET /sitios/{id}/resumen`), salud con medidor, condiciones por tipo y entrega en barras
  ordenadas, «Requiere atención», tramas por cubo apiladas y una gráfica por magnitud con su banda mín–máx (`GET /sitios/{id}/historico`),
  todas con el cursor sincronizado; vacíos con camino; en vivo, el resumen se vuelve a pedir con antirrebote (uno cada 2 s como mucho) y
  nunca con una ventana fija.
- **P2 v2 (C).** Filtros y paginación en el servidor (`limite`, `desplazamiento`, total en `X-Total`: «1–50 de 132», la página en la URL),
  fichas de conteo con totales del servidor, `estado_visual` del servidor al cargar y `estadoVisual()` desde el primer dato en vivo,
  columna Entrega ordenable, «Marcar los visibles» con el tope de seis y tarjetas bajo 700 px. Con un backend anterior (sin `X-Total`) el
  panel filtra y pagina lo que recibe. `lib/api.ts`: `pedir` expone `X-Total` y `X-Siguiente` a quien pasa `alPaginar` (y
  `obtenerPagina`); nadie más cambia.
- **P3 v2 (D).** Zoom por arrastre que pide la resolución más fina admisible y escribe `desde`/`hasta` en la URL, «Volver» con historial,
  doble clic y «Volver a ahora» al rango completo; con ventana fija el vivo no agrega puntos. «Todos los canales» (una petición,
  `GET /dispositivos/{id}/historico`), «Mostrar mín–máx», umbrales con su histéresis y las condiciones del canal como franjas
  (`GET /condiciones?dispositivo=&desde&hasta`), historial de eventos por cursor (`GET /dispositivos/{id}/eventos`), rechazadas agrupadas
  con «× N» y «Más antiguas» por cursor, y unidades para personas (`lib/unidades.ts`: «Cel» → «°C», °C/°F y mm/m/km solo al mostrar).
- **Un hallazgo de las pruebas.** Con siete gráficos montados a la vez, siete `import('uplot')` simultáneos hacían que el doble de uPlot de
  las pruebas perdiera contra el real en seis de ellos. Desde hoy hay una sola importación compartida (`lib/cargar-uplot.ts`), que además
  evita seis promesas en el navegador.

**Cómo se probó** (por el DOM con jsdom y respuestas simuladas, en los dos sentidos; `pnpm check && pnpm test && pnpm build` en
`panel/`). Contraste WCAG calculado con la luminancia relativa sobre los tokens del propio `app.css` en los dos temas (texto ≥ 4,5:1,
controles y foco ≥ 3:1), plantado: un `--texto-secundario` de `#999999` falla (2,70:1) y un bloque oscuro desincronizado también.
Tablero: los cuatro estados suman el total y, si no suman, la tarjeta lo dice; cada tarjeta lleva al inventario filtrado; seis gráficas y
la séptima magnitud en la lista; un rango a medida al revés se frena sin pedir nada y el bueno llega a la URL en UTC; diez avisos dan un
resumen. Inventario: «1–50 de 132», «Siguiente» pide `desplazamiento=50` y escribe `pagina=2`; el estado del servidor al cargar y el del
panel tras el reloj; tarjetas con `matchMedia` simulado y vuelta a la tabla al ensanchar; el tope de seis escrito al lado. Ficha: una
selección de una hora pide `intervalo=1 minute` y la ventana, el vivo no la toca, «Volver» y el doble clic deshacen; banda con cinco
series; dos umbrales y dos franjas, ninguno en otro canal; un solo pedido para todos los canales; eventos y rechazadas por cursor; en °F,
«70,7 °F» y la serie convertida sin cambiar la petición. Las pruebas de hoy se adaptaron (el inventario en `#/inventario`, las unidades
con su símbolo, el servidor simulado que pagina) sin quitar ninguna.

| Medida | Antes | Después |
|---|---|---|
| Pruebas del panel (vitest) | 165 en 18 archivos | 220 en 22 archivos (219 casos escritos; el de contraste corre una vez por tema) |
| `pnpm check` | 358 archivos, 0 errores | 375 archivos, 0 errores, 0 avisos |
| JS del panel (`index-*.js`) | 127 351 B (45,27 kB comprimido) | 173 540 B (60,76 kB comprimido) |
| uPlot (`uPlot.esm-*.js`, aparte) | 50 990 B | 50 990 B |
| CSS | 9 347 B (2,69 kB comprimido) | 20 074 B (4,54 kB comprimido) |
| JS total | 178 341 B | 224 530 B (+26 %: el tablero no lo duplica, `docs/19 §4`, J) |
| Archivos `.map` en `dist/` | 0 | 0 |

**Lo que queda para la prueba con navegador real (paso 4c, Chromium y Firefox, 390 y 1 280 px).** jsdom no dibuja ni arrastra: el zoom con
el uPlot real (selección, `posToVal`, doble clic), el cursor sincronizado, las barras apiladas, la banda, las líneas de umbral con su
etiqueta y las franjas en el lienzo; el tema oscuro y el foco visible en capturas; el campo `datetime-local` en los dos navegadores; las
tarjetas, el menú plegado y la ausencia de desplazamiento horizontal desde 320 px; y el contrato real del backend (nombres de campos,
`X-Total`, `X-Siguiente`, `/panel/avisos-de-terceros.txt` servido).

**Correcciones de la revisión (11/11/2026).** Una revisión del bloque en tres frentes (seguridad y robustez, accesibilidad y
publicabilidad, concordancia con el contrato y el diseño) dejó hallazgos que se verificaron uno por uno contra el código antes de
corregir; cada corrección lleva su prueba en los dos sentidos y la violación se plantó donde la prueba es nueva (la carrera del
resumen, el filtro por sitio del vivo y el retroceso del canal fallan con el código anterior).

- **Robustez.** Las barras ordenadas usan el id como clave (dos dispositivos con el mismo nombre rompían el tablero); el resumen que pide
  el vivo se descarta si llega después de un cambio de rango (los indicadores quedaban de un rango y las gráficas de otro) y solo lo
  piden los avisos de dispositivos del sitio; el canal en vivo vuelve a la espera de 1 s con el primer mensaje, no al abrir (un servidor
  que acepta y cierra producía una recarga por segundo: ahora 1, 2, 4, 8, 16 s); el inventario agrupa los avisos de condición cada 3 s
  (tope medido: 100 avisos → 5 peticiones, nunca la página); las casillas «comparar» se olvidan al salir y al vencer la sesión; `sitio`,
  `zona` y `via` de la URL se validan como el resto; el nombre de una descarga solo admite `.csv` y `.json`; una selección del gráfico
  sin extremos válidos no hace zoom.
- **Accesibilidad.** Cada gráfico es una imagen con nombre (título y resumen del rango) y abre «Ver los datos», una tabla con un renglón
  por punto; las barras se leen como lista «etiqueta: valor»; el medidor sin dato dice «sin datos»; las tarjetas usan `<dt>`/`<dd>`; el
  botón «Menú» no cambia de nombre (el estado lo lleva `aria-expanded`); cada magnitud del tablero tiene su encabezado; la casilla
  «comparar» mide 24 × 24 px también en la tabla; radios y letra en la escala de A2. La excepción de contraste de las series quedó
  escrita y probada (`docs/19 §4`, A3: amarillo 2,25:1 y celeste 2,31:1; el rosa, 3,06:1, sí pasa). «Legal y acerca de» informa la
  única cookie (`__Host-sesion`, necesaria, 30 min sin actividad u 8 h, sin cookies de terceros).
- **Concordancia con el contrato.** El inventario manda a la API el id del sitio (la URL del panel sigue con el código) y `orden=entrega`
  (el servidor ordena todas las páginas), y espera la lista de sitios antes de pedir con un sitio en la URL; la columna dice «Entrega
  (24 h)», su ventana fija; el resumen se pide con `intervalo` y el rótulo de las tramas sale del intervalo que declara el servidor;
  «promedio de N dispositivos»; sin preferencia no se convierte ninguna unidad y la de longitud aplica solo a una lista explícita de
  magnitudes (hoy vacía: el catálogo no tiene ninguna); las gráficas se recrean al cambiar el tema (un solo oyente del sistema operativo
  y de `data-theme`, en `lib/tema.ts`); los colores del lienzo se comprueban contra los tokens; la ficha avisa cuando llegan 500
  condiciones en la ventana (las más recientes).

| Medida | Antes de las correcciones | Después |
|---|---|---|
| Pruebas del panel (vitest) | 220 en 22 archivos | 243 en 23 archivos (ninguna quitada; se adaptaron las que fijaban lo anterior: el latido que reinicia la espera, el antirrebote de 3 s, el sitio por id, avisos de un dispositivo del sitio, «dispositivos», unidades sin preferencia, zona como UUID y una selección que puede no dar ventana) |
| `pnpm check` | 375 archivos, 0 errores, 0 avisos | 376 archivos, 0 errores, 0 avisos |
| JS del panel (`index-*.js`) | 173 540 B | 179 541 B (62,73 kB comprimido) |
| CSS | 20 074 B | 20 636 B (4,64 kB comprimido) |
| JS total | 224 530 B | 230 531 B |
| Archivos `.map` en `dist/` | 0 | 0 |

## 63. Cinco perfiles, cuenta propia, términos y actividad (11/11/2026)

**Qué cambió** (`docs/20 §2`, §6, §10 R22–R31, §11 y §12; `docs/21 §2` y §7; `docs/19 §4`, G, H y P11; `docs/10 §8.4` puntos 62 y 64;
HU-26 a HU-29 y HU-31). Migración 24 (`24-perfiles-cuenta-legal.sql`, aplicada dos veces sin error ni cambio): `ck_usuario_sitio_rol` con
cuatro perfiles de sitio; en `usuario`, `administrador_sistema`, la baja con motivo (`desactivado_en`, `desactivado_por`, `motivo_baja` y un
CHECK de coherencia), `anonimizado_en` y los términos aceptados; las tablas `preferencia` y `mensaje_soporte` (22 entidades, antes 20);
`acceso.id`; y `fn_anonimizar_usuario`, del dueño, porque la baja borra filas y la aplicación no tiene `DELETE`. En el backend, la tabla de
`permitir()` con cinco perfiles y nueve acciones (`baja`, `enlaces`, `auditoria` y `sistema` son nuevas); el guardia restringe la sesión
mientras la versión de los términos aceptada sea menor que la vigente (403 `terminos_pendientes`); usuarios con el perfil global, la baja con
motivo y el 409 «reactivable»; y once rutas nuevas, todas «Etapa 4»: `GET`/`PUT /preferencias`, `GET /sesiones`,
`DELETE /sesiones/{id}`, `GET /cuenta/exportar`, `POST /cuenta/baja`, `GET /terminos`, `POST /terminos/aceptar`, `GET /privacidad`,
`GET /acerca`, `POST`/`GET /soporte` y `GET /sitios/{id}/actividad`. La página de privacidad sale del inventario de `docs/21 §2`
(`legal/inventario.ts`, comparado celda por celda con el documento por `legal.spec.ts`). Los avisos de terceros los escribe
`generar-avisos-terceros.sh` desde `pnpm licenses list --prod --json` (179 paquetes de producción, ninguna herramienta de desarrollo).
El OpenAPI pasa de 26 rutas (33 operaciones) a 37 (46); `orden` de `GET /dispositivos` ya estaba declarado.

**Cómo se verificó y cifras.**

| Verificación | Resultado |
|---|---|
| `pnpm typecheck` y `pnpm lint` (backend) | 0 errores |
| Pruebas unitarias del backend (vitest) | 541 de 541 (antes 513): la matriz de siete columnas escrita aparte de `PERMISOS`, el guardia con términos, preferencias, textos de actividad, la regla del último administrador y el orden de la baja, privacidad contra `docs/21`, acerca, soporte |
| Plantado: `exportar` de vuelta en solo administrador | 4 pruebas de `permisos.spec.ts` fallan («investigador exporta») |
| Plantado: `escribir` abierto a consulta | 5 pruebas fallan |
| Plantado: sin el candado de los administradores en `PATCH /usuarios/{id}` | la prueba del orden falla (dos desactivaciones cruzadas pasarían las dos) |
| Plantado: una línea menos en `avisos-de-terceros.txt` (svelte) | `generar-avisos-terceros.sh --comprobar` (paso 2r2) falla con «svelte@5.57.3 sin aviso» |
| `sesion-smoke.sh` (paso 4b), con la imagen nueva | **351 de 351** en una base sin otro administrador del sistema, **349 de 349** dentro del guardián, con la semilla que ya lo trae (antes 182): una sesión por perfil, cada ruta nueva con los siete perfiles, términos pendientes y su 403, baja con motivo, 409 reactivable y reactivación, perfil global, último administrador del sistema (409 al quitarse el perfil y al darse de baja), preferencias con bloqueo optimista, sesiones propias (la de otro, 404), exportar con `attachment`, soporte (el sexto en la hora, 429), actividad (sin correos ni IP, por cursor, otro sitio 404) y la baja por anonimización contra la base |
| Baja por anonimización, en la base | sin el nombre ni el correo de antes, sin clave, sesiones revocadas y sitios inactivos; `acceso` y `evento` siguen enlazados por el id; el correo de antes no entra (401) |
| `semilla-demo.sh` | una persona de demostración por perfil (`@ejemplo.invalid`) |

Las comprobaciones del último administrador del sistema se omiten (con aviso) cuando la base ya tiene otro; con la semilla nueva, la de
desarrollo lo tiene.

**Correcciones de la revisión** (revisión del bloque en tres frentes: seguridad, concordancia, privacidad y accesibilidad; cada hallazgo
se comprobó en el archivo antes de corregirlo, y cada corrección tiene su prueba en los dos sentidos, plantando el error):
- **Cuenta de un administrador del sistema** (`rechazoDeCambio`): un administrador de sitio podía asignarle una clave temporal (y entrar
  como él) si compartían un sitio. Ahora su cuenta y sus sitios solo los cambia otro administrador del sistema (403). Prueba unitaria y
  cuatro casos en el paso 4b (clave temporal, baja, nombre y sitio, con la huella de la cuenta intacta); plantado sin la regla, 3 pruebas fallan.
- **Reactivación:** exige `clave_temporal: true` en la misma petición (400 si no; la clave de antes no vuelve), y la baja que hizo un
  administrador del sistema (o la clave por cabecera) solo la deshace un administrador del sistema (403). En el paso 4b, además, la clave
  de antes de la baja ya no entra (401).
- **Soporte:** el tope de 5 por hora no era atómico (se miraba antes del `INSERT` y se anotaba después): `intentar()` reserva el cupo sin
  un `await` en medio y `devolver()` lo libera si el `INSERT` falla. Ráfaga de 20 envíos simultáneos con un `INSERT` lento: 5 llegan a la
  base y 15 reciben 429 (con la versión anterior, los 20 pasaban). `TasaPorPersona` (alta por lote) ya reservaba en la misma llamada.
- **`fn_anonimizar_usuario`** (migración 24, aplicada dos veces): exige `por`, toma el candado de los administradores y rechaza la baja del
  último administrador del sistema activo dentro de la función; anula el correo tecleado en `acceso` y el `motivo` de los eventos
  `usuario_cambio` de esa cuenta. `db/pruebas/anonimizacion.sql` lo planta en una transacción que se deshace (paso 1c): 6 de 6 con la
  función nueva; con la anterior, 4 fallan.
- **Altas por persona:** 10 por minuto (`ALTAS_POR_MINUTO`): el 409 por correo existente no depende del alcance; el riesgo residual queda
  escrito en `docs/20 §10` (R9).
- **«Acerca de»:** la versión y el commit, solo con sesión; la licencia, su aviso y el enlace al código, siempre. `pila.sh encender` exporta
  `COMMIT` antes de construir y `.env.example` trae el enlace del repositorio público; el paso 2z vigila además `RESPONSABLE_*` y
  `CODIGO_FUENTE_URL` (plantado sin `CODIGO_FUENTE_URL` en el compose, falla).
- **Exportar mis datos:** suma el correo tecleado en sus accesos, la fecha y el motivo de una baja y el detalle de sus cambios; el aviso
  dice qué no incluye.
- **Actividad del sitio:** los eventos sin dispositivo se perdían; ahora entran los de las pasarelas del sitio, las cuentas de sus
  personas y los términos aceptados, con su texto (paso 4b: altas de cuentas de A, términos y la pasarela de A, nada de B).
- **Vistas guardadas:** el servidor exigía `parametros` como objeto y el panel mandaba texto: ninguna vista se guardaba. Ahora es
  `{ruta}` en los dos lados, con una prueba cruzada (lo que arma el panel lo acepta el validador del servidor) y tres casos contra la pila.
- **Privacidad:** la prueba que compara `docs/21 §2` con `legal/inventario.ts` se saltaba la primera fila («Nombre»), y la página de
  privacidad no la mostraba; corregida la prueba y regenerado el arreglo (16 filas, con la nueva del motivo de baja).
- **Avisos de terceros:** el texto completo de cada licencia distinta de MIT (0BSD, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC y
  Python-2.0) y su NOTICE si existe; `--comprobar` (paso 2r2) falla si falta alguno (con el archivo anterior, falla con las seis).
- **Telemetría:** `SCARF_ANALYTICS=false` en las dos etapas de instalación del `Dockerfile` (además de `ignore-scripts`).
- **`docs/20 §11`** citaba el dominio de las personas de prueba para el correo anonimizado: el guardián compara ahora el dominio citado con
  el de la función (paso 2g; plantado `@ejemplo.invalid`, falla).

| Verificación tras la corrección | Resultado |
|---|---|
| Pruebas unitarias del backend | 552 de 552 en 53 archivos (antes 541) |
| `sesion-smoke.sh` (paso 4b) | 371 de 371 (antes 351) |
| `api-smoke.sh` (paso 4) | 114 comprobaciones, todo bien |
| OpenAPI | 37 rutas, 46 operaciones (sin rutas nuevas; descripciones al día) |

## 64. Pantallas P6, P7, P11, P13 y P14 y prueba en navegador del tablero v2 (11/11/2026)

**Qué cambió** (diseño: `docs/19 §4`, tablero v2, E, F, G, H y P11; `docs/20 §11` y §12; `docs/21 §4`, §5 y §7; el contrato, el
`openapi.json` y las rutas de la cuenta, los términos y la actividad de §63).

- **P6 Configurar** (`#/dispositivos/<id>/configurar`, desde la ficha para quien tiene `configurar`). Nombre, estado, intervalo esperado y
  zona del sitio; por canal, etiqueta y hasta cuatro reglas (alto, bajo, histéresis, retardo de activación). La validación es la del
  servidor escrita para el panel (`lib/configurar.ts`, mismos campos y motivos que `configuracion.dto.ts`), se lee junto a cada campo
  mientras se escribe y es la misma que arma el cuerpo; un 400 del servidor se reparte por campo; el `PUT` conserva el id de cada regla;
  el 409 dice «alguien lo cambió a las HH:MM» en la zona del sitio con «Recargar» y no pisa lo escrito; nada se muestra guardado antes
  de la respuesta («Guardando…»).
- **P7 Alta** (`#/alta`). Asistente de cinco pasos con el motivo escrito junto a «Siguiente», la credencial y el tópico una sola vez con
  «Copiar» y la espera de la primera trama por el canal en vivo del dispositivo nuevo; un 409 remite al inventario en vez de duplicar.
  Alta masiva (`?modo=lote`): el CSV se lee en el navegador (RFC 4180, marca BOM, cabecera fija, tope de 500 filas antes de enviar),
  `modo=validar` va completo y `modo=crear` en tandas secuenciales de 50 (`§61`) con «Creadas N de M»; si una tanda falla, se detiene,
  dice desde qué fila y ofrece «Reintentar las restantes (N)». Las credenciales no se dibujan: «Descargar credenciales (CSV)» y, después,
  «Ya las guardé: olvidarlas». «Descargar rechazadas» lleva las columnas del archivo más `motivo`, que el lector ignora al volver a subirlo;
  una celda con forma de fórmula se neutraliza con un apóstrofo (salvo las credenciales). Bandeja de detectados (`?modo=detectados`):
  cada emisor lleva al asistente con su identificador escrito.
- **P13 Preferencias y mi cuenta** (`#/preferencias`). Unidades, zona horaria, tema, sitio al entrar, notificaciones del navegador por
  tipo (el permiso se pide al marcar la primera) y vistas guardadas (la última vista de datos abierta, con nombre); cada cambio se ve al
  instante, viaja completo con el `actualizado_en` leído, en fila (nunca dos `PUT` en vuelo) y, si el servidor lo rechaza, vuelve atrás
  solo lo que ese guardado cambió, con el aviso. Mi cuenta: sesiones abiertas con «Cerrar esta sesión» (la actual, por «Salir»), términos
  aceptados, «Exportar mis datos» (`GET /cuenta/exportar` por el ayudante `descargar`) y «Darme de baja» explicada, con la clave actual y
  la casilla de irreversible.
- **P14 Actividad** (`#/actividad`, en el menú para quien tiene `auditoria`). Lista por cursor con «Más antiguos», filtros por persona, tipo
  y rango en la URL, texto del servidor con quién lo hizo, enlace a la ficha y tarjetas bajo 700 px.
- **P11 Legal y acerca de** (`#/legal`, con `?seccion=`). Privacidad desde `GET /privacidad` (inventario por filas, responsable o el aviso
  de que no está configurado), términos con versión y fecha, acerca de con versión y commit, la cookie y los avisos de terceros; todo
  como texto (los títulos y listas en Markdown simple se parten en bloques; nada del servidor se interpreta como HTML); soporte con su
  límite de tasa (el 429 dice los segundos). **Términos obligatorios:** con `GET /sesion → terminos.pendiente` o con cualquier 403
  `terminos_pendientes`, la pantalla «Términos de uso» con «Acepto los términos (versión N)» y «Salir»; ninguna pantalla de datos ni canal
  en vivo existe hasta aceptar, y después se vuelve a la ruta pedida.
- **Notificaciones en pantalla (E).** Una condición abierta en un sitio de la persona aparece en cualquier pantalla como aviso agrupado
  por dispositivo («Invernadero: Umbral, Batería (× 2)», con «Abrir la ficha»), en una región `aria-live` que no roba el foco; los
  nombres se piden con antirrebote; la notificación del navegador, solo para los tipos elegidos y con permiso (una por dispositivo, por
  `tag`). El canal sin filtro es uno por pestaña: el tablero, el inventario, la comparación y los avisos lo comparten
  (`abrirCanalCompartido`, `lib/vivo.ts`).
- **Lo que pedía la revisión del backend.** El inventario manda `orden=atencion` por defecto y, con un servidor que pagina, ya no
  reordena la página recibida; la ficha dice «registrado por N» o «cambiado por N» solo cuando el servidor manda la persona y, con
  `usuario: null`, no dice nada de quién (antes decía «(sistema)», que no es lo que significa ese null); la guía de perfiles tiene frase
  para las nueve acciones de la matriz de cinco perfiles.

**Hallazgos de la prueba con navegador real (corregidos).** (1) Las 6 comprobaciones rotas del paso 4c: «Nombre» también rotula una
columna de la lista de usuarios (el selector se acota al formulario de alta) y «Salir» vive dentro del menú de cuenta plegado desde el
armazón v2 (se abre antes). (2) A 390 px, la ayuda emergente de «Marcar los visibles» se salía 11 px por la derecha y la página se
desplazaba a lo ancho (401 px de documento): en teléfono la ayuda va fija al pie, a todo el ancho (`app.css`). (3) Una casilla de
notificación quedaba marcada aunque el navegador negara el permiso: vuelve a desmarcarse. (4) La segunda corrida (Firefox, sobre el mismo
dispositivo que dejó la de Chromium) no tenía conflicto que probar: la «otra pestaña» escribía el mismo nombre y un `PATCH` que no cambia
nada no mueve `actualizado_en`; el nombre lleva ahora el navegador y la otra escritura va por la API desde la misma página. Y uno
que queda escrito en el diseño: 500 filas son una validación y 10 tandas, y el servidor admite 10 lotes por minuto por persona, así que la
última tanda recibe 429 y queda en «Reintentar las restantes» (`docs/19 §4`, F2).

**Cómo se probó.** Por el DOM (vitest con jsdom y respuestas con la forma del contrato), en los dos sentidos: los casos de
`configuracion.dto.spec.ts` contra la función del panel (bajo ≥ alto, histéresis, rango físico, retardo 86 401 y 1,5, al menos un umbral,
cinco reglas, etiqueta larga); el error enlazado al campo con `aria-describedby` y `aria-invalid`; «Guardando…» con `aria-busy` mientras el
`PUT` no responde; el 409 con «10:42» en America/Santiago para un `13:42Z`; 121 válidas en tandas de 50, 50 y 21 con la segunda fallando
(50 creadas, 71 pendientes, el reintento las completa y nunca hay dos tandas en vuelo); 501 filas frenadas sin enviar nada; el preferido
°F antes de la respuesta y el 409 que lo devuelve; el permiso pedido solo al marcar; la baja con clave mala (400) sin llamar a la salida;
la actividad por cursor y en tarjetas; un `<script>` en los términos queda como texto; la pantalla de términos sin ninguna petición de
datos ni canal; y una sola conexión `/eventos` con el inventario y los avisos montados. Con navegador real: el paso 4c
(`pruebas/panel-sesion-e2e.sh` y `e2e/sesion.mjs`), Chromium 156 y Firefox 157, a 390 y 1 280 px, contra la pila con la imagen del
backend recién construida: legal antes de entrar; la aceptación de los términos tras cambiar la clave (con el 403 `terminos_pendientes`
antes); los indicadores del tablero suman el total y el total es el `X-Total` del inventario del sitio; P6 con el error junto al campo,
la regla guardada en el servidor y el 409 tras otra escritura; P13 con °F en la tarjeta de la ficha y la base en °C; P14 con el cambio de umbrales y su
autor, sin correos; P7 con el asistente por HTTP (sin tocar el broker) y un lote de 2 válidas y 1 rechazada que crea solo 2; todas las
pantallas sin desplazamiento horizontal; datos propios y desechables, borrados al final (la limpieza suma eventos, preferencias y
mensajes de soporte de las personas de prueba).

**Capturas reproducibles a 390 px** (Chromium, con la hora, los gráficos y los secretos tapados; se regeneran con
`E2E_CAPTURAS=docs/capturas/panel-sesion bash plataforma/pruebas/panel-sesion-e2e.sh`): `docs/capturas/panel-sesion/6-tablero-chromium-390.png`,
`3-inventario-chromium-390.png` y `7-ficha-chromium-390.png`, para la lámina de la presentación.

| Medida | Antes | Después |
|---|---|---|
| Pruebas del panel (vitest) | 243 en 23 archivos | 284 en 31 archivos (282 casos escritos, la cifra que compara el guardián; se adaptaron, sin quitar ninguna, las que fijaban el orden sin `orden=atencion`, «(sistema)», el menú sin Actividad y la matriz de dos perfiles) |
| `pnpm check` | 376 archivos, 0 errores | 396 archivos, 0 errores, 0 avisos |
| Paso 4c (Chromium y Firefox, 390 y 1 280 px) | 84 de 90 (6 rotas) | 218 de 218 (109 por navegador) |
| JS del panel (`index-*.js`) | 179 541 B (62,73 kB comprimido) | 257 489 B (86,67 kB comprimido) |
| CSS | 20 636 B | 22 747 B (5,04 kB comprimido) |
| JS total (con uPlot, 50 990 B, aparte) | 230 531 B | 308 479 B (+34 %; frente a antes del tablero, 178 341 B, 1,73 veces: no lo duplica) |
| Archivos `.map` en `dist/` | 0 | 0 |

**Lo que queda.** La zona horaria propia de P13 se guarda pero las pantallas siguen en la del sitio; el asistente no ofrece el perfil de
decodificación (sigue por API) y la magnitud se escribe como código (no hay una ruta del catálogo de magnitudes); con navegador real
faltan la bandeja de detectados (exige sembrar una trama `no_registrado`), la primera trama del asistente (exige publicar con la
credencial), la notificación del navegador (permisos de Playwright) y el tema oscuro en captura (los cuatro perfiles de sitio en P10,
pendientes aquí, se corrigieron abajo); y las pantallas nuevas podrían cargarse aparte, a pedido, para no sumar su peso a la primera
carga.

**Correcciones de la revisión** (revisión del bloque en tres frentes; cada hallazgo comprobado en el archivo, cada corrección con su
prueba en los dos sentidos):
- **Usuarios (P10):** «Desactivar» mandaba la baja sin `motivo` y el servidor respondía 400 siempre: ahora pide el motivo (1–300) junto al
  aviso «sin nombres ni datos personales» y no envía nada sin él; el servidor simulado de la prueba exige lo mismo que el real. El selector
  ofrece los cuatro perfiles de sitio; el administrador del sistema ve la casilla del perfil global y los sitios de `GET /sitios`; el 409
  `reactivable` del alta ofrece «Reactivar» (con una temporal nueva); «Activar» reactiva con clave temporal; la cuenta de un administrador
  del sistema no se ofrece a quien administra solo un sitio. Paso 4c: los cuatro perfiles, la baja con motivo y la reactivación desde el alta.
- **Asistente de alta (P7):** encabezado «Paso N de 5» con el foco al cambiar de paso (también en la credencial), errores del paso 1
  ligados a cada campo, el tamaño del CSV comprobado antes de leerlo, y las credenciales se olvidan al salir de la pantalla y al perder
  la sesión; cerrar la pestaña con credenciales del lote sin descargar pide confirmar. Plantada cada regresión, su prueba falla.
- **Avisos fijos al pie (WCAG 2.4.11):** en teléfono se ven 2 y el resto queda plegado en «y N más». La prueba con navegador real
  (tres avisos a 390 px y Tab hasta «Enviar a soporte») mostró que un margen fijo de 8rem no alcanzaba: el botón quedaba entero bajo los
  avisos (de 651 a 695 px, con los avisos desde 547). Ahora el margen sigue lo que miden los avisos (`--alto-avisos`) y el paso 4c lo
  comprueba en Chromium y Firefox.
- **Notificación del navegador:** cuerpo genérico («N condiciones nuevas en» el sitio; `GET /condiciones` suma `sitio`), dicho en la ayuda.
- **«Acerca de» (P11):** el aviso AGPL del servidor siempre y, sin enlace configurado, «pídelo al responsable (Soporte)»; sin sesión,
  sin versión.
- **Otras:** la baja propia con una clave mala (400) dice «La clave no es la actual»; «Darme de baja» separa altas y cambios (sin datos
  tuyos) de los accesos con IP (90 días) y suma los mensajes de soporte; `POST /cuenta/baja` cambia la generación de la sesión (un 401
  atrasado no dice «venció»); los rótulos de P14 son los códigos reales del servidor; la guía de perfiles ya no dice que `escribir` da
  de baja ni ofrece enlaces públicos sin ruta; el motivo de exportar nombra a administrador e investigador; las capturas tapan además la
  cabecera del servicio y se regeneraron (`3-inventario`, `6-tablero` y `7-ficha` a 390 px).

| Verificación tras la corrección | Resultado |
|---|---|
| Pruebas del panel | 297 del panel (299 ejecuciones en vitest, en 31 archivos); `pnpm check`: 396 archivos, 0 errores |
| Paso 4c (Chromium y Firefox, 390 y 1 280 px) | 230 de 230 (antes 218) |

## 65. Credencial de dispositivos con SHA-256 y semilla que respeta las claves (13/11/2026)

**Qué cambió** (decisión y porqué en `docs/11 §4`; diseño en `docs/10 §3` y §8.4 puntos 52 y 65 (iv)). La credencial aleatoria de
dispositivos y pasarelas (24 bytes, 192 bits) deja de guardarse con scrypt y pasa a `sha256$<base64>`, sin sal y comparada en tiempo
constante (`alta/credenciales.ts`: `resumirSecreto`, `verificarResumen`, `caminoDeCredencial` y `verificarCredencialDispositivo`, que
despacha por la forma de la huella y dice por qué camino fue). Scrypt queda para las claves de personas (N = 2¹⁷, ahora el valor por
defecto de `hashScrypt`) y para verificar las credenciales anteriores. Ningún camino de producción crea ya una huella scrypt para un
dispositivo o una pasarela (alta, lote, rotación, pasarela nueva y su rotación); `hashesEnTandas` y `TANDA_SCRYPT` se quitaron con sus dos
pruebas (nada más los usaba). La recepción por HTTP tiene un camino rápido (huella nueva: sin cupo ni *pool* de hilos; inexistente, sin
credencial, de otra vía o dado de baja: el mismo trabajo contra una huella de relleno) y el anterior (scrypt, caché y cupo como antes) que
convierte la fila en su primer acierto con un `UPDATE` condicionado a la huella verificada (`RecepcionService.convertirCredencial`; la
consulta de la credencial trae ahora el id de su fila). Con la dirección bloqueada y la pista del identificador, el camino rápido sigue
abierto y el anterior espera, como antes. Cuántas credenciales anteriores quedan: la consulta de `docs/14 §7.5`.

**Pruebas nuevas y la falla plantada de cada una** (cada plantada se aplicó sobre el código, se vio en rojo y se deshizo):

| Prueba | Plantada | Resultado |
|---|---|---|
| `credenciales.spec.ts`: formato `sha256$` + 32 bytes, sin sal, verificación, formas inválidas (11 casos), camino y despacho | sin la expresión de forma (solo el prefijo) | 1 en rojo (formas inválidas) |
| `credenciales.spec.ts`, I2: una huella `sha256$…` no verifica como clave de persona | `verificarScrypt` acepta `sha256$` | 1 en rojo |
| `verificacion.spec.ts`, I3: inexistente, sin credencial, otra vía, baja y huella anterior de otra vía cuestan un resumen contra el relleno, sin scrypt | el relleno vuelve a ser scrypt | 1 en rojo |
| `verificacion.spec.ts`, I4: un acierto del camino rápido actualiza la pista | sin actualizar la pista | 1 en rojo |
| `verificacion.spec.ts`: cuántas veces corre scrypt, con `node:crypto` simulado en parte (scrypt real envuelto en un contador, lo demás real): cero en el camino rápido y con el relleno, una en el camino anterior. Reemplaza a dos espías sobre `credenciales.js` que no podían fallar: `verificarCredencialDispositivo` llama a scrypt por el enlace local del módulo | el camino rápido calcula además un scrypt dentro de `credenciales.ts` | 2 en rojo |
| `verificacion.spec.ts`: el primer acierto anterior convierte con el id, la huella verificada y el resumen del token | sin la conversión | 2 en rojo |
| `verificacion.spec.ts`, I5: la conversión que falla (también con un rechazo sin objeto) no pierde la trama y el aviso no lleva token ni huellas | la falla se propaga; el aviso lleva el mensaje del error; leer `code` de un rechazo sin objeto | 1 en rojo cada una |
| `recepcion-http.controller.spec.ts`: con la dirección bloqueada y la pista, la huella nueva entra y la anterior espera (429) | el bloqueo corta también el camino rápido | 1 en rojo |
| `credencial-http.spec.ts`: la consulta trae `credencial_id`; la conversión es `UPDATE … WHERE id = $1 AND activa AND hash = $2` | sin el id; sin la condición sobre la huella; sin `AND activa` | 1 en rojo cada una |
| I1 en `alta.service.spec.ts`, `baja-rotacion.spec.ts`, `pasarelas.spec.ts` (alta y rotación) y `lote-servicio.spec.ts` (500 filas): huella `sha256$`, que verifica, y `hashScrypt` nunca llamado | `hashScrypt` en cada uno de los cinco usos | 1 en rojo en cada archivo |

Las huellas de las pruebas se calculan en la propia prueba; ningún archivo trae una huella literal. En el banco, `banco.sh alta` comprueba
que la credencial nueva es `sha256$` (40 comprobaciones) y `banco.sh http` suma una credencial anterior: con un token equivocado, 401 y la
fila intacta; con el suyo, 202 y la fila convertida en esa misma trama; la siguiente entra por el camino rápido (24 comprobaciones).

**Medición, antes → después** (banco desechable: `banco.sh encender 10`, el backend con 0,5 CPU como en el compose; `tablero-medir.sh lote N P
http|mqtt`, que ahora admite la vía, y `tablero-medir.sh verificacion 20`, nuevo). Antes: la imagen del commit anterior, una corrida por
caso. Después: la imagen con el cambio, cuatro corridas por caso (mediana; el tope de 10 lotes por minuto obliga a espaciarlas).

| Medida | Antes (scrypt) | Después (SHA-256) |
|---|---|---|
| Lote de 100, vía http | 14,6 s | 0,03 s |
| Lote de 500, vía http | 72,3 s | 0,10 s |
| Lote de 100, vía mqtt (con las órdenes al broker) | 14,5 s | 0,07 s |
| Lote de 500, vía mqtt | 71,7 s | 0,40 s |
| Tanda de 50 filas, la que usa el panel (una corrida) | ≈ 7 s (`docs/16 §61`) | 0,014 s (http) · 0,033 s (mqtt) |
| `POST /recepcion/{id_fisico}`, primera trama (verifica la huella) | 109,5 ms | 5,3 y 4,9 ms |
| `POST /recepcion/{id_fisico}`, segunda trama (antes, por la caché) | 4,7 ms | 4,6 y 4,4 ms |
| 401 con token equivocado | 109,7 ms | 1,7 ms |
| 401 con identificador inexistente | 113,9 ms | 1,7 y 1,6 ms |

Mediana de 20 dispositivos por fila en la recepción (`curl -w '%{time_total}'` en bucle local, cuerpo de una lectura; la primera y la
segunda trama incluyen los filtros 2 a 6). Después, la primera trama cuesta lo mismo que la segunda, y «no existe» lo mismo que «token
equivocado» (I3). Lo que se tardaba en verificar una credencial anterior no cambia (es el mismo scrypt): ≈ 110 ms en el banco, la cifra del
riesgo aceptado de `docs/11 §4`. **Lo que no cubre:** es el portátil, no el servidor de referencia; 500 filas es el tope del lote, no se
midió más; el «alta individual a la vez» que lanza el guion a los 2 s ya no se solapa con el lote (termina antes), así que deja de medir la
espera detrás de él; la verificación se midió desde una sola dirección y por debajo de los topes (b) y (c), y sin proxy; la carrera entre una rotación y la
conversión de una credencial anterior la cubre la condición de la sentencia (`AND activa AND hash = $2`), no una prueba que ejecute la carrera. El tamaño de la
tanda del panel no se cambió: queda para decidir aparte con estas cifras.

### Semilla de demostración que respeta las claves

**Qué pasaba:** cada corrida de `semilla-demo.sh` le ponía una clave temporal nueva a las cinco personas de demostración y cortaba sus
sesiones: sacaba del panel a quien estaba dentro y anulaba la clave que había elegido. **Qué cambió:** `persona_temporal` (`lib-personas.sh`)
tiene un quinto argumento, `rotar` (por defecto, lo de antes; lo sigue usando `panel-sesion-e2e.sh` con sus personas propias) o `conservar`:
la cuenta nueva se crea con la temporal; la que ya eligió su clave no se toca, ni la huella ni las sesiones; una temporal vigente se deja;
solo una temporal vencida se reemplaza, y entonces se cortan las sesiones; una cuenta desactivada se reactiva siempre con una clave temporal
nueva y las sesiones cortadas, aunque hubiera elegido la suya (quien la desactivó porque su clave se filtró no la ve volver con esa clave).
En todos los casos la cuenta queda activa, sin baja y con el rol pedido. La decisión se toma dentro del `ON CONFLICT … DO UPDATE`, con `CASE` sobre la fila existente, y la función escribe el id y qué pasó
(`nueva`, `rotada`, `propia` o `vigente`). La semilla usa `conservar` (con `SEMILLA_ROTAR_CLAVES=1`, `rotar`) e imprime por persona su
temporal nueva solo si quedó en uso, o «conserva la clave que eligió» o «conserva su clave temporal, aún vigente»; su comprobación pasa a
«activas, con su rol, y con clave propia o temporal vigente», y con `SEMILLA_ROTAR_CLAVES=1` además las cinco con temporal recién asignada.

**Prueba:** `plataforma/pruebas/personas-semilla-prueba.sh`, paso 4d del guardián, con una persona y un sitio de descarte que borra al
salir: crear → `nueva`; otra corrida → `vigente` con la huella igual y la sesión abierta; marcada como clave propia, activa y con otro
rol → `propia`, la huella igual, la sesión sin revocar y el rol pedido; con clave propia y dada de baja → `rotada`, huella nueva, temporal
vigente, la sesión revocada y la cuenta activa; temporal vencida → `rotada` y la sesión revocada; `rotar` → `rotada` y la sesión revocada;
un modo desconocido se rechaza: 7 de 7 comprobaciones. **Plantadas:** con `PERSONAS_PLANTAR=1` («conservar» corrido como «rotar», lo de
antes), 2 de 7 en rojo, «vigente» y «propia», con la huella cambiada y la sesión revocada; con la condición de `conservar` sin
`NOT usuario.activo` (la primera versión de este cambio), 1 de 7 en rojo: la cuenta desactivada volvía como `propia`, con la misma huella y
la sesión abierta. Además, una copia de la semilla con las cinco cuentas cambiadas por cuentas de descarte, contra la pila de desarrollo:
la primera corrida las crea (cinco temporales impresas), la segunda dice «aún vigente» en las cinco, con una de ellas marcada como clave
propia y con una sesión dice «conserva la clave que eligió» sin cambiar su huella ni cortar la sesión, y con `SEMILLA_ROTAR_CLAVES=1`
pasan las dos comprobaciones y la sesión queda revocada; las cuentas de descarte se borraron al terminar.

**Cifras del bloque:** `pnpm verificar` en verde (pruebas unitarias del backend: 564, en 53 archivos) y 297 pruebas del panel (299 ejecuciones en 31
archivos); `svelte-check`, 396 archivos sin errores. `pnpm openapi`: 37 rutas, con dos descripciones cambiadas (el 503 de la recepción y el
tiempo del lote). Humos contra la pila reconstruida y el verificador de 52 pasos (el 4d es nuevo):
`api-smoke.sh` (paso 4), 114 OK; `sesion-smoke.sh` (4b), 371 de 371; el panel en navegadores reales (4c), 230 de 230;
`personas-semilla-prueba.sh` (4d), 7 de 7; en el banco, `banco.sh alta` (40) y `banco.sh http` (24) en verde. Las cifras que repiten el
informe y `docs/18` (las pruebas unitarias del backend, 564 ese día, y 52 pasos del verificador) se pusieron al día en el mismo cambio.

## 66. «Ahora» del tablero v3 en el backend y semilla del campus creíble (13/11/2026)

**Qué cambió** (diseño en `docs/19 §4`, bloque L, puntos 3 y 6; contrato en `docs/10 §8.4` punto 65 viii). Ruta nueva
`GET /sitios/{id}/ahora?limite&tendencia` (Etapa 4; consulta o más, otro sitio 404, `limite` de 1 a 60 y 24 por defecto): `reportan` y
`sin_senal` (la regla del estado visual del inventario y del resumen), `por_magnitud` sobre la última lectura de cada canal de los que
reportan, solo si tiene menos de dos intervalos esperados del dispositivo, y hasta `limite` tarjetas, alerta primero y después por zona y
nombre, cada una con hasta tres canales: lo medido primero y la salud del equipo al final (`bateria`, `tension` y `rssi`,
`MAGNITUDES_SALUD` de `consulta/tablero.ts`, declarado en `docs/19` L3b). Con `tendencia=si`, 24 promedios por hora alineados a la hora UTC
por canal mostrado (null = sin lecturas). La última lectura es la misma subconsulta de la ficha (`SQL_ULTIMA_MEDICION`, ahora compartida).
Consultas por petición: dos, y tres con la tendencia, sin una por dispositivo (como mucho tres tras la corrección del mismo día, al final
de esta sección). Al implementar se sumaron `salud` y el orden a `por_magnitud`
(`docs/19` L6). El canal en vivo agrega `sitio_id` a `medicion`, `visto` y `condicion`, desde el mapa con que ya filtra por sitio; para eso
el mapa se refresca también al abrir el flujo de quien alcanza a todos los sitios (antes solo el de una persona con sitios). Quién recibe qué
no cambia.

**Pruebas nuevas y la falla plantada de cada una** (cada plantada se aplicó, se vio en rojo y se deshizo):

| Prueba | Plantada | Resultado |
|---|---|---|
| `ahora.spec.ts` (20): dos sentencias sin tendencia y tres con ella, con 1 y con 60 dispositivos | una consulta de canales por dispositivo | 3 en rojo |
| `ahora.spec.ts`: hasta tres canales, la salud al final | el orden solo por código de magnitud | 4 en rojo |
| `ahora.spec.ts`: una lectura de más de 2 × intervalo no entra al promedio | sin el filtro de vigencia | 3 en rojo |
| `ahora.spec.ts`: `limite` fuera de 1–60, no entero o repetido → 400 antes del alcance y de la base | tope de 500 | 1 en rojo |
| `ahora.spec.ts`: solo `tendencia=si` la pide | cualquier valor la pide | 1 en rojo |
| `ahora.spec.ts`: sin tendencia, ningún campo `chispa` | `chispa: null` siempre | 1 en rojo |
| `eventos.spec.ts`: los tres avisos con `sitio_id`, `sistema` sin él, null solo para quien alcanza a todos y el dispositivo es desconocido | sin `sitio_id`; sin refrescar el mapa para quien alcanza a todos | 2 y 1 en rojo |
| `api-smoke.sh`: forma, conteos iguales a los del resumen, orden, tendencia de 24 cubos, 400 de `limite`, 404 y 401 | una copia del guion con cuatro expectativas cambiadas | 4 en rojo |
| `sesion-smoke.sh` (4b): una fila por perfil, «otro sitio → 404», la tendencia sin dispositivos de otro sitio y `limite=61` → 400 | una copia con dos expectativas cambiadas | 3 en rojo |

**Medición** (banco desechable, `banco.sh encender 120`: backend con 0,5 CPU y la base en RAM con techo de 768 MB, como en §61; cada cifra,
mediana de 10 peticiones tras una de calentamiento, con `tablero-medir.sh ahora`, que mide el resumen y las tres variantes de «Ahora» en la
misma corrida, del sitio de los 120 emulados). La primera fila es la serie de §61 (`tablero-semilla-serie.sql`: 30 días cada 300 s, con el
intervalo de los emulados en 300 s y su última trama como visto); las otras, solo las últimas 24 h a cada ritmo (`tablero-semilla-ahora.sql`
con `vaciar=1`: la serie de 30 días no deja lugar para 24 h más densas). La base del banco se cortó por memoria dos veces: al cargar la
serie de §61 después de probar ahí la semilla de demostración (los datos quedaron, a 752 de 768 MiB) y al sembrar 24 h cada 5 s en una sola
sentencia, que se reinició vacía; desde entonces la semilla de «Ahora» siembra hora por hora con un `CHECKPOINT` entre cada una.

| Lecturas · tramas (120 fuentes) | `…/resumen` (24 h) | `…/ahora` | `…/ahora?tendencia=si` | `…&limite=60` |
|---|---|---|---|---|
| Serie de §61: 30 días cada 300 s (base a 752 de 768 MiB) | 163,5 ms | 7,4 ms | 10,7 ms | 16,1 ms |
| 24 h cada 300 s · cada 300 s | 28,1 ms | 5,9 ms | 11,5 ms | 15,0 ms |
| 24 h cada 60 s · cada 60 s (repetida) | 194,6 ms (199,5) | 5,9 ms (6,2) | 24,7 ms (25,0) | 37,3 ms (36,0) |
| 24 h cada 5 s · cada 60 s | 118,9 ms | 6,3 ms | 392,2 ms | 391,7 ms |

Bytes: `…/ahora`, 14,4 kB (24 tarjetas); con tendencia, 21,9 kB; con `limite=60`, 54,2 kB; el resumen, 21,8 kB. **Criterio de
`docs/19` L7:** sin tendencia, «Ahora» no tarda más que el resumen en ninguna corrida (5,9 a 7,4 ms frente a 28 a 200 ms): ✅. Con
tendencia y 60 s, 24,7 ms frente a 194,6 ms del resumen (0,13 veces; el umbral es 2): ✅, la tendencia se queda. **Observación con 5 s:**
la tendencia tarda 392 ms, 3,3 veces el resumen de esa corrida, y lo mismo con 24 que con 60 tarjetas; `EXPLAIN (ANALYZE, BUFFERS)` de su
sentencia con 24 canales: `Bitmap Index Scan` por el índice único `(canal_id, tiempo)` del fragmento, 401 856 filas y 19 789 bloques de la
tabla de un fragmento de 2,07 millones: las lecturas de los 120 canales están intercaladas por tiempo, así que pedir 24 canales toca casi
todas las páginas. El criterio está escrito para 60 s y se cumple; con 5 s queda anotado, sin cambiar el diseño, y la salida natural sería un
agregado por hora (pendiente de decidir con esta cifra). **Lo que no cubre:** los emulados tienen un canal con lecturas (temperatura) y uno
sin ellas (humedad: última `null` y tendencia toda `null`); el intervalo esperado se fijó en 3 600 s para que el supervisor no los pasara a
«sin señal» durante la medición (nadie publica en el banco; con 60 s, los 120 aparecían sin señal); con 5 s, las tramas son cada 60 s
porque cada 5 s no caben en la base del banco; una petición a la vez, sin proxy, en el portátil y no en el servidor de referencia; la
diferencia del resumen entre la primera fila y la segunda (163,5 y 28,1 ms, con las mismas tramas de 24 h) coincide con la base al borde de su
techo de memoria y no se investigó más.

### Semilla de demostración: el campus creíble y los casos límite aparte

**Qué cambió** (decidido el 13/11/2026). `db/semillas/demo-completa.sql`: (1) los dos casos límite (`d03`, identificador de 3 caracteres y
nombre «Ñ», y el de 63 caracteres con nombre de 80) pasan a un sitio aparte, `pruebas-limite` («Sitio de pruebas: casos límite», zona
«Casos límite»); el sitio `uct` queda como vitrina, con 8 dispositivos de la semilla, y las personas de demostración siguen solo en él. (2)
**Tramas coherentes con las mediciones:** cada recepción sembrada deja su trama (SenML, plano o el JSON de la pasarela, según el formato,
con los mismos valores) y sus mediciones, al intervalo esperado de cada dispositivo, y la última es `visto_por_ultima_vez`. En las últimas
24 h la entrega queda distinta y creíble: `demo-aire-01` 100 %, `demo-lora-01` 97,5 % (12 de 480 perdidas), `demo-suelo-01` 91,7 % (22 de
24), `demo-lora-02` 37,5 % (pierde 5 de cada 8; es el de la batería baja) y `demo-silencioso` 0 %; «Tramas (24 h)» del sitio suma 718 de la
semilla. `demo-suelo-01` se seca y cruza el umbral bajo de 20 hace 5 h, cuando se abre su condición. Sigue en una transacción y es
idempotente (se aplica dos veces y da lo mismo).

**Comprobaciones nuevas** en `semilla-demo.sh --completa` (de 16 a 25 tras la semilla): los dos casos límite en el sitio de pruebas; el sitio
`uct` sin ninguno, ni de la semilla ni con su forma (identificador de 3 o 63 caracteres, nombre de 1 u 80); los dispositivos por sitio (8, 1
y 2); toda medición con su trama; la última trama igual a `visto_por_ultima_vez`; la entrega de 24 h de cada uno, la de la cabecera; al
menos tres valores de entrega distintos; las 718 tramas de 24 h en `uct`; y ninguna persona de demostración con membresía fuera de `uct`.
**Plantadas** (en el banco, con copias de la semilla): `d03` de vuelta en `uct`, 4 en rojo; sin el `INSERT` de las tramas, 5 en rojo; una
persona `*-demo` con membresía en otro sitio, la consulta da 1 en vez de 0. **Dónde se aplicó:** en la base del banco, dos veces seguidas,
con las 31 comprobaciones en verde (las del guion, con `SEMILLA_SIN_PERSONAS=1`). En la pila de desarrollo no se aplicó dentro de este
cambio porque estaba en uso: aplicarla recrea los 11 dispositivos de la semilla con identificadores nuevos. Se aplica con
`bash plataforma/pruebas/semilla-demo.sh --completa`.

**Cifras del bloque:** `pnpm verificar` en verde (pruebas unitarias del backend: 585, en 54 archivos) y 297 pruebas del panel (299 ejecuciones
en 31 archivos); `svelte-check`, 396 archivos sin errores. `pnpm openapi`: 38 rutas y 47 operaciones (`/sitios/{id}/ahora` nueva y el
ejemplo de `/eventos` con `sitio_id`). Humos contra la pila reconstruida: `api-smoke.sh`, 122 OK; `sesion-smoke.sh` (4b), 386 de 386. El verificador de 52 pasos, completo y
en verde; su primera corrida marcó el paso 2t por dos citas fechadas de §65 con la forma «N pruebas unitarias», que se reescribieron con la
misma cifra de ese día; la segunda, lanzada enseguida, dio 429 en el inicio de sesión (4b y 4c) por el bloqueo de intentos fallidos que
dejaron varias corridas seguidas de los humos, y la tercera, pasada la ventana del bloqueo, terminó en «TODO EN CONCORDANCIA». El informe, recompilado: 30 páginas de cuerpo y ningún desborde.

### Correcciones del mismo día: «Ahora» sin los canales de todo el sitio, topes de la tendencia, el mapa con el latido y dos guiones

**Qué cambió** (13/11/2026; diseño en `docs/19 §4` L6, contrato en `docs/10 §8.4` punto 65 viii, control en `docs/11 §4`).
(1) **«Ahora» ya no trae al proceso los canales de todo el sitio.** La segunda consulta pedía los canales de **todos** los que reportan,
no los de la página, y el agregado por magnitud se armaba en memoria: el número de consultas era fijo, pero el trabajo crecía con el sitio
aunque se pidiera `limite=1`. Ahora el agregado se calcula en la base, en la primera consulta (una fila por magnitud: canales que aportan,
promedio, mínimo y máximo de la última lectura vigente; la regla de vigencia, `SQL_LECTURA_VIGENTE` de `consulta/tablero.ts`), y los
canales se piden solo para los dispositivos de la página (ninguna consulta si la página está vacía). La respuesta es la misma: en el banco,
con los mismos datos, las respuestas del código anterior y del nuevo son idénticas campo a campo en los dos sitios y con y sin tendencia
(salvo el campo `tendencia`, nuevo). (2) **Topes de la tendencia:** conexión propia con `SET statement_timeout` de 2 s y `RESET` al
soltarla, como la exportación; como mucho dos cálculos a la vez en el proceso; si vence el tiempo o no hay cupo, la ruta responde igual,
con `tendencia: false` y sin `chispa`, y un aviso acotado en el registro. 2 s son cinco veces lo más lento medido arriba (392 ms, lecturas
cada 5 s). En el banco, 30 peticiones simultáneas con tendencia al sitio de 2 000: 4 con ella y 26 sin ella, todas respondidas, y un solo
aviso en el registro. (3) **El mapa dispositivo → sitio del canal en vivo** se pone al día también en cada latido (como mucho una recarga
cada 5 s): un dispositivo que cambia de sitio sale con el nuevo a más tardar un latido después, sin que nadie abra otro flujo. (4)
**`tablero-semilla-ahora.sql` tiene guarda:** con `vaciar=1` trunca `medicion` y `trama`, y solo un comentario impedía correrlo contra otra
base; ahora aborta (y fija `ON_ERROR_STOP` él mismo) si los datos de la base no están en tmpfs o no existe el sitio «banco», las dos
marcas del banco. (5) **El humo de sesión se puede correr dos veces seguidas** (detalle abajo). (6) Concordancia: «como mucho tres
consultas» en vez de «dos, y tres con la tendencia» (con tendencia y ningún canal que mostrar son dos), y la cifra de archivos de pruebas
del backend en `docs/18` (54, no 53).

**Por qué el humo de sesión heredaba el bloqueo.** El guion hacía salir cada corrida desde una dirección distinta del bucle local (`curl
--interface`), pero el backend corre en Docker y, por el puerto publicado, ve toda conexión venir de la puerta de enlace de la red de
Docker, la misma en cada corrida: en la tabla `acceso` de la pila de desarrollo, todas las filas tenían una sola dirección, de esa red.
Los fallos de varias corridas se sumaban en esa dirección hasta los 50 del bloqueo por dirección (`docs/20 §4`). Reproducido: con el guion
anterior, tres corridas seguidas en verde y la cuarta con 12 fallas («429 bloqueado» en la sección del bloqueo y en las siguientes).
**Corrección, solo en el guion:** cada petición lleva su `ORIGEN` en `X-Forwarded-For` junto con `X-Proxy-Secreto`, el único camino por el
que el backend cree esa cabecera (`recepcion/http/direccion.ts`, el mismo que usa el proxy); el bloqueo no cambia, solo de quién se cuentan
los fallos. El secreto se lee del `.env` de la pila y va a curl desde un archivo de la carpeta temporal, nunca por argumento; sin él, el
guion avisa que la corrida comparte dirección. También los diez intentos fallidos de la sección 5, que salían sin la dirección propia.
Prueba: con la dirección de la puerta de enlace todavía bloqueada por la cuarta corrida, dos corridas seguidas del guion corregido, las dos
386 de 386.

**Medición de (1) y (2)** (banco desechable con 2 120 emulados: 120 en el sitio «banco», como arriba, y 2 000 movidos a un sitio aparte,
«grande»; las últimas 24 h cada 300 s en sus canales de temperatura con `tablero-semilla-ahora.sql`; `tablero-medir.sh ahora [CÓDIGO]`,
que ahora acepta el sitio; mediana de 10 tras una de calentamiento). Antes y después, **sobre los mismos datos**: medido el código nuevo,
el backend se recreó con la imagen anterior, guardada, sin tocar la base:

| Sitio | `…/ahora` antes → después | `…?limite=1` | `…?tendencia=si` | `…?tendencia=si&limite=60` |
|---|---|---|---|---|
| 120 que reportan | 7,1 → 7,4 ms | 6,3 → 6,2 ms | 10,9 → 11,4 ms | 14,5 → 15,9 ms |
| 2 000 que reportan | 35,7 → 25,3 ms | 34,1 → 23,8 ms | 40,3 → 29,2 ms | 42,9 → 33,0 ms |

Con 120 la diferencia queda dentro del ruido (otra corrida del código anterior, sobre datos sembrados igual, dio 6,6, 6,5, 10,5 y 14,6
ms). Con 2 000, un 30 % menos en las cuatro variantes; lo que queda es leer la última lectura de cada uno de los 2 000 canales con datos
para el agregado, ahora en la base. El resumen del mismo sitio de 2 000 tardó 392,8 a 648,0 ms en estas corridas. **Lo que no cubre:**
emulados con un canal con lecturas y uno sin ellas; una petición a la vez (salvo la prueba del cupo); el portátil, no el servidor de
referencia.

**Pruebas nuevas o cambiadas y la falla plantada de cada una** (cada plantada se aplicó, se vio en rojo y se deshizo):

| Prueba | Plantada | Resultado |
|---|---|---|
| `ahora.spec.ts`: con 2 000 que reportan y `limite=2`, la consulta de canales lleva solo los dos de la página | la consulta de canales con el sitio en vez de la página | 9 en rojo |
| `ahora.spec.ts`: el agregado por magnitud en SQL con la regla de vigencia; la regla, estricta | sin la regla en la consulta; `>=` en vez de `>` | 1 y 1 en rojo |
| `ahora.spec.ts`: tiempo vencido → `tendencia: false`, sin `chispa`, con tarjetas y agregado | sin atrapar el error 57014 | 1 en rojo |
| `ahora.spec.ts`: como mucho dos a la vez; la tercera, sin tendencia y sin pedir conexión | cupo de tres | 1 en rojo |
| `ahora.spec.ts`: `SET statement_timeout` y `RESET` en la conexión propia, soltada también tras un error | sin el `RESET` | 2 en rojo |
| `ahora.spec.ts`: `tendencia` siempre presente; `false` si no se pidió o se omitió | ausente cuando es `false`; igual a lo pedido | 4 y 2 en rojo |
| `ahora.spec.ts`: con tendencia y cero canales, dos consultas y ninguna conexión propia | la tendencia aunque no haya canales | 1 en rojo |
| `eventos.spec.ts`: el latido pone al día el mapa (un dispositivo mudado sale con el sitio nuevo), una sola recarga con dos latidos a la vez | el latido sin recargar el mapa; sin el tope de 5 s | 1 y 2 en rojo |
| `tablero-semilla-ahora.sql`: la guarda aborta contra la pila de desarrollo (datos en ext4, sin sitio «banco») | una copia sin la guarda: llega a la parte que borra | salida 3 con la guarda; la copia, salida 0 |
| `sesion-smoke.sh`: dos corridas seguidas | el guion anterior | la cuarta corrida seguida, 12 fallas |
| `api-smoke.sh` y `sesion-smoke.sh`: la forma de «Ahora» con `tendencia` | — (las expectativas cambian con el contrato) | — |

**Cifras del bloque:** `pnpm verificar` en verde: 592 pruebas unitarias del backend en 54 archivos y 297 pruebas del panel (299 ejecuciones
en 31 archivos); `svelte-check`, 396 archivos sin errores. `pnpm openapi`: 38 rutas (la descripción de «Ahora» y de `tendencia`).
Contra la pila recreada con las imágenes nuevas: `api-smoke.sh`, 122 OK; `sesion-smoke.sh` (4b), dos corridas seguidas, 386 de 386 cada
una. El verificador completo, en verde. El informe, recompilado: 30 páginas de cuerpo y ningún desborde.

## 67. Panel del tablero v3: armazón lateral, pestañas, «Ahora» y gráficas vivas (13/11/2026)

**Qué cambió** (diseño en `docs/19 §4`, bloque L, puntos 1 a 5 y 7, con lo decidido al implementar escrito allí; el contrato de «Ahora» y
de `sitio_id` es el de §66). **Armazón:** barra lateral con icono y texto por entrada (iconos propios en `Icono.svelte`, sobre una cuadrícula de 24 px y dibujados a 20 y 22 px), que
«Menú» contrae a 56 px (abre expandida desde 1 280 px y contraída entre 1 000 y 1 279 px; el estado vive en memoria); bajo 1 000 px, el
mismo menú es un cajón que atrapa el foco y lo devuelve a «Menú»; barra superior con «Menú», el sitio, el tema y la cuenta; «Saltar al
contenido»; sin entradas «(próximamente)»; la línea «servicio: …» pasó a «Legal y acerca de» y un fallo del servicio se dice con un aviso.
`Tooltip.svelte` se corrigió para WCAG 2.2, 1.4.13. El botón de tema guarda por el único escritor de preferencias
(`lib/escritor-preferencias.ts`), el mismo de P13. **Tablero en tres pestañas** (`ver` en la URL): el Resumen, sin selector de rango, pide
dos cosas al entrar —el resumen de las últimas 24 horas y «Ahora» con tendencia— y se mantiene con los avisos (`medicion` y `visto` en
memoria, dibujados como mucho una vez por segundo; `condicion` repide «Ahora» sin tendencia y el resumen; con tramas llegando, el resumen
una vez por minuto); Tendencias y Red piden lo suyo al abrirlas, con la fila del rango, y se refrescan solas solo con 1 h y 24 h (sexta
parte del cubo entre 5 y 60 s, nunca dos en vuelo, con la pestaña visible y la ventana alineada al cubo); «Pausar» y «Reanudar» en el
tablero y la misma corrección en la ficha. **Gráficas:** sin título en el lienzo ni tabla de leyenda de uPlot; etiqueta flotante propia
(Escape, salir, desplazar; en táctil, un toque la muestra y un toque fuera la quita), leyenda fija de nombres, puntos solo con 30 o menos
y nunca en los bordes de la banda, eje de enteros en las tramas, las magnitudes sin datos en una línea y sin lienzo, alto según la
pantalla. Las barras ordenadas pasaron de SVG a HTML (texto del cuerpo). **Carga a pedido:** toda pantalla que no es la de entrada (el
tablero o «Entrar») se descarga con `import()` al abrirla. Paso 4c: `panel/e2e/sesion.mjs` y `pruebas/panel-sesion-e2e.sh` suman lo de L7.

**Pruebas nuevas y la falla plantada de cada una** (cada plantada se aplicó, se vio en rojo y se deshizo; 43 pruebas nuevas del panel por
el DOM y de funciones puras, de 297 a 340, y 60 plantadas):

| Prueba | Plantada | Resultado |
|---|---|---|
| `App.test.ts`: menú con las pantallas que existen, icono y texto, sin «próximamente», orden del foco | — (reescrita sobre la anterior) | — |
| `App.test.ts`: «Saltar al contenido» no cambia la ruta | sin `preventDefault` | 1 en rojo |
| `App.test.ts`: contraída a iconos con su nombre accesible y su ayuda (foco, Escape) | sin `aria-label` | 1 en rojo |
| `App.test.ts`: cajón: el foco entra, Tab da la vuelta, Escape, tocar fuera y elegir un destino lo cierran y devuelven el foco | sin la vuelta de Tab; el tema también en la barra superior | 1 y 1 en rojo |
| `App.test.ts`: el tema se aplica al instante, se guarda en fila (nunca dos `PUT` en vuelo) y vuelve si el servidor lo rechaza | el escritor sin fila | 1 en rojo |
| `App.test.ts`: el servicio caído se dice con un aviso; «Legal y acerca de» dice su estado | sin el aviso | 1 en rojo |
| `Componentes.test.ts`: la ayuda cumple 1.4.13 (Escape con el foco fuera, el puntero pasa a la ayuda, dura con foco) | `Tooltip.svelte` anterior | 1 en rojo |
| `Tablero.test.ts`: al entrar, dos pedidos y ningún histórico | «Ahora» sin tendencia | 3 en rojo |
| `Tablero.test.ts`: la franja: «Sin señal: 1» y su destino | sin el «:» del nombre | 1 en rojo |
| `Tablero.test.ts`: «Ahora» por magnitud y por dispositivo (cifra, lectura vieja, «+N», «esperando la primera trama») | tres decimales; vieja a tres intervalos | 1 y 1 en rojo |
| `Tablero.test.ts`: ráfaga de `medicion` y `visto` sin ningún pedido, una vez por segundo; con tramas continuas, el resumen una vez por minuto | `medicion` repide; minuto de un segundo | 1 y 1 en rojo |
| `Tablero.test.ts`: `condicion` repide sin tendencia y la conserva; `sitio_id`; «Pausar»/«Reanudar»; la tendencia omitida no se insiste | sin conservar; todo aviso es del sitio; sin pausa; reintento a los 30 s | 1, 1, 1 y 1 en rojo |
| `Tablero.test.ts`: Tendencias sin título ni leyenda de uPlot y las magnitudes sin datos sin lienzo; puntos ≤ 30 y no en la banda; Red con eje de enteros | con lienzo; con título; 31 puntos; puntos en la banda; sin enteros | 1, 1, 1, 1 y 1 en rojo |
| `Tablero.test.ts`: la etiqueta flotante solo bajo el puntero y se va con Escape, al salir y al desplazar; en táctil, con un toque | en todos los sincronizados; sin Escape; el toque no mueve el cursor; el `mouseleave` emulado la quita; un ratón de verdad no la vuelve a quitar al salir; uPlot esconde el cursor y se va | 1 en rojo cada una |
| `Tablero.test.ts`: vivo con 1 h (10 s, ventana alineada), nada en 7 días salvo «Actualizar»; «Pausar» en las gráficas | período de 1 s; sin alinear; 7 días vivo; sin pausa | 1 en rojo cada una |
| `lib/refresco.test.ts` (6) y `lib/ahora.test.ts` (6) | dos en vuelo; con la pestaña oculta; la tendencia une los huecos; una medición desordenada pisa | 1 en rojo cada una |
| `Ficha.test.ts`: «Reanudar» repide la ficha y el histórico una vez | sin repedir | 1 en rojo |
| `lib/vivo.test.ts`: `sitio_id` de texto, null o ausente; otro tipo, no | cualquier tipo | 1 en rojo |
| `lib/vista.test.ts`: `ver` de ida y vuelta; el resumen no escribe el rango | cualquier `ver`; el resumen con rango | 1 y 1 en rojo |
| `lib/grafico.test.ts` (3): los decimales de lo dibujado, el recorrido sin la serie de tiempos y la etiqueta con todas sus filas iguales | un decimal menos; el recorrido cuenta los tiempos; la banda ignora los decimales | 3, 2 y 1 en rojo |
| `lib/refresco.test.ts` (2 más): `marcar()` olvida lo ya programado; `soltar()`, al pausar, también | sin olvidar; `soltar()` vacío | 1 y 1 en rojo |
| `Tablero.test.ts`: un refresco ya programado no sobrevive a un cambio de rango (ni lo pisa ni corre en 7 días) | sin olvidar y sin mirar si el rango es vivo | 1 en rojo |
| `Tablero.test.ts`: «Pausar» detiene también lo ya programado (Resumen y gráficas) y el reloj de los «hace N s», y dice desde cuándo | lo programado corre en pausa (gráficas; Resumen); el reloj sigue; sin «desde las…» | 1 en rojo cada una (4) |
| `Tablero.test.ts`: una lectura que llega mientras «Ahora» se repide no se pierde | las lecturas en espera se descartan | 1 en rojo |
| `Tablero.test.ts`: en táctil, tras desplazar, el cursor sincronizado de otro gráfico no revive la etiqueta del primero | el gráfico sigue «bajo el puntero» | 1 en rojo |
| `Tablero.test.ts`: cada ficha de indicador lleva un solo enlace y ningún botón (reemplaza una afirmación que no podía fallar) | un segundo enlace «Ver en el inventario» | 1 en rojo |
| `App.test.ts`: tras un 409 se releen las preferencias y el intento siguiente lleva la marca vigente | sin releer | 1 en rojo |
| `App.test.ts`: con el menú contraído, todo enlace de solo icono, también «Legal y acerca de», muestra su ayuda | el del pie sin ayuda | 1 en rojo |
| `App.test.ts`: el cajón: Tab devuelve el foco si quedó fuera, «Saltar al contenido» inerte, «Cerrar menú» y Escape desde cualquier foco | sin devolver el foco; sin `inert`; sin el botón; Escape solo dentro | 1 en rojo cada una (4) |
| `App.test.ts`: una navegación que el panel aún no procesó manda sobre la vista que una carga en vuelo quiere escribir en la URL | la vista se escribe igual | 1 en rojo |

Se reescribieron sobre el diseño nuevo, sin cambiar lo que comprueban, las del armazón de `App.test.ts`, las de `Tablero.test.ts` que siguen
(indicadores que suman el total, a medida, vacíos, error con «Reintentar», tema que recrea las gráficas, texto alternativo) y el doble de
uPlot de `Ficha.test.ts` y `Comparar.test.ts` (el título se lee del contenedor: el lienzo ya no lo lleva). **Paso 4c** (Chromium y Firefox,
390 y 1 280 px): las pestañas (dos pedidos al entrar, «atrás» vuelve de Red a Tendencias, sin desplazamiento horizontal), el menú contraído
con sus nombres, 44 px por destino y la ayuda de cada enlace (también el del pie), el cajón con el teclado y su botón «Cerrar menú», el
tema que alterna y se guarda; y, con una persona de consulta de descarte en
el sitio de la semilla completa, el alto de la pestaña Resumen a 390 × 844, las tres pestañas sin desplazamiento horizontal a 390 y
1 280 px en los dos temas y las pistas de la entrega, todas del mismo largo: **TODO OK (330 de 330 comprobaciones del panel con sesión, en: chromium firefox)**. La primera corrida dio una
falla en Firefox («error loading dynamically imported module» al recargar con una pantalla a medio descargar): desde entonces una pantalla
que no se puede descargar lo dice con un aviso y no deja un error sin atender.

**Tres correcciones al mirar las capturas** (13/11/2026, con el sitio `uct` y la semilla completa recién cargada). (1) *La entrega por
dispositivo no se podía comparar de fila en fila:* cada fila era su propia rejilla y el valor escrito al lado («0 % (0 de 17.399)») le
quitaba largo a su pista, así que un 88 % se dibujaba más largo que un 90 %. Las columnas pasaron a ser de la lista (cada fila las
hereda) y el paso 4c lo comprueba: todas las pistas (nueve o diez, según cuántos dispositivos esperan tramas en el rango) miden lo mismo
a 390 px y a 1 280 px en los dos temas y los dos navegadores (188 y 324 px en Chromium); con la rejilla anterior puesta a mano en el navegador, la diferencia es de 37 px (la comprobación admite 1). (2) *El nombre
de la magnitud se cortaba en las tarjetas de «Ahora»* («Humedad r…») cuando la tarjeta mide 282 px (menú contraído a 1 280 px): ahora
ocupa dos líneas (9 rótulos, ninguno recortado, 5 en dos líneas; a 390 px, ninguno en dos). (3) *La etiqueta flotante mezclaba decimales*
(«19,396 °C» junto a «19,29 a 19,5 °C»): ahora todas sus cifras llevan los que distinguen dos valores de lo dibujado («18,9 °C» y «18,8 a
19 °C» en la temperatura del sitio), y el resumen del rango de la ficha, igual («promedio de los 165 promedios dibujados 60,1 %RH», antes
«60,023 %RH»); el valor exacto sigue en «Ver los datos» y en el CSV. Las alturas de las pestañas Tendencias y Red no cambiaron (1 492 y
1 199 px a 1 280 px; 2 358 y 1 410 px a 390 px).

**Correcciones tras la revisión del bloque** (13/11/2026; revisión independiente de tres frentes —comportamiento, concordancia, y
privacidad y licencias—: 20 hallazgos, 19 corregidos aquí y uno a medias). *De comportamiento (7):* (1) un refresco de las gráficas ya
programado corría después de un cambio de rango, podía cortar la carga que la persona pidió y dejaba la URL con el rango anterior;
(2) «Pausar» no alcanzaba a lo ya programado ni al reloj de los «hace N s»: ahora sí, y la fila dice desde cuándo está en pausa; (3) tras
un 409 al guardar una preferencia, cada guardado siguiente repetía el 409 hasta recargar la página: ahora se releen las vigentes;
(4) al vencer la sesión no se olvidaban las preferencias de la persona; (5) al repedirse «Ahora» se descartaban lecturas en vivo
posteriores a la respuesta; (6) con el cajón abierto, el foco podía salir hacia «Saltar al contenido» y no había un control con nombre
para cerrarlo: Tab devuelve el foco, el enlace queda inerte y hay «Cerrar menú»; (7) en una pantalla táctil, tras desplazar, tocar otro
gráfico revivía la etiqueta del primero. *De concordancia (13):* la prueba de navegador del banco (`e2e/p3.mjs`, que el verificador no
corre) seguía buscando la tabla de leyenda de uPlot, que este bloque dejó de dibujar: se reescribió sobre la etiqueta flotante y la
leyenda fija (`banco.sh navegador`: 36 de 36 comprobaciones en Firefox y en Chromium), y el verificador ganó el **paso 2y4** (53 pasos): falla si un guion de navegador busca
un atributo `data-*` que ningún componente pone, o la leyenda que ya no se dibuja (probado sobre una copia, plantando una y otra: las dos
en rojo); «Legal y acerca de» no mostraba su ayuda con el menú contraído (RF-58); una afirmación de `Tablero.test.ts` no podía fallar
(buscaba un atributo que el tablero ya no pone); tres reglas de estilo de la leyenda quedaron sin uso; y nueve precisiones de `docs/19`
y de las cifras medidas (la fila P1 de §3, la leyenda del incremento 2, los trece criterios de WCAG 2.2, el texto de «sin señal», el
tamaño de los iconos, dos reglas de §6, el alto del Resumen y el paquete). El hallazgo a medias: `Tarjeta.svelte`, del tablero anterior,
quedó sin uso; su afirmación vacía se corrigió, el componente sigue en el repositorio. De paso, la prueba del tema dependía del orden
(fallaba al correr sola, por un segundo aviso en pantalla): ahora busca su aviso entre todos.

**Una falla intermitente que resultó un defecto.** En una de tres corridas seguidas del paso 4c, Firefox a 390 px se quedó en Tendencias
después de pedir el Resumen («pestañas del tablero: se cortó»). No era la prueba: al cambiar de pantalla, la URL cambia enseguida y su
`hashchange` llega en la tarea siguiente; si justo ahí terminaba la carga de la pantalla anterior, esta escribía su vista con
`replaceState` **sobre la URL nueva** y la persona se quedaba donde estaba, como si su clic no hubiera valido. Desde ahora una pantalla
no escribe su vista si la URL del navegador ya no es la que el panel procesó (`App.svelte`, `alCambiarVista`; `docs/19 §4`, incremento
1, punto 1). La prueba lo reproduce sin azar (retiene el resumen de Tendencias, cambia la URL sin despachar el evento y suelta la
carga) y su falla plantada da 1 en rojo.

**Mediciones** (pila de desarrollo, sitio `uct` con la semilla completa, una persona de descarte; Chromium 156):

| | Tablero v2 (una página) | v3 Resumen | v3 Tendencias | v3 Red |
|---|---|---|---|---|
| Alto a 1 280 px (claro · oscuro) | 3 957 px | 1 031 · 961 px | 1 492 · 1 422 px | 1 199 · 1 130 px |
| Alto a 390 × 844 (claro · oscuro) | 6 254 px | 1 473 · 1 473 px | 2 358 · 2 358 px | 1 410 · 1 410 px |
| Pedidos al entrar | 7 | 2 (`…/resumen`, `…/ahora?tendencia=si`) | — | — |

**El alto del Resumen depende de cuántos dispositivos reportan:** los de la tabla se midieron con 2 de 10; con la semilla recién cargada
(5 de 10) mide 1 175 px a 1 280 px y 1 998 px a 390 px. A 1 280 px en claro, el aviso «Clave cambiada» de la primera entrada suma 70 px;
en el paso 4c, la persona de consulta (con ese aviso a 390 px) midió **2 119 px con la semilla recién cargada** (5 tarjetas de «Ahora»;
2 120 en Firefox) y 1 377 px con la semilla envejecida, casi sin nadie reportando: por eso la comprobación dice ahora con cuántas tarjetas
midió y avisa si son menos de tres (una semilla envejecida aprobaba sin exigir). El umbral de L7 es 2 532 (tres pantallas). **Paquete inicial** (`vite build`): 257 489 B
(86,67 kB comprimido) en §64 y 266 282 B (89,08 kB) al empezar este bloque; ahora 154 463 B (56,34 kB): `index-*.js` 96 332 B y la parte
común `api-*.js` 58 131 B (precargada), con las once pantallas restantes en archivos de 0,8 a 27,9 kB que se descargan al abrirlas y uPlot
(51 kB) como antes. El CSS pasó de 23,1 a 34,3 kB (7,1 kB comprimido). **Cifras del bloque:** `pnpm verificar` en verde: 592 pruebas
unitarias del backend en 54 archivos y 340 pruebas del panel (342 ejecuciones en vitest, en 33 archivos); `pnpm check`: 405 archivos, 0 errores.
**Lo que no cubre:** la zona horaria propia de las preferencias sigue sin aplicarse (P13; pendiente); la etiqueta flotante en táctil se
probó en Chromium con pantalla táctil emulada, no en un teléfono; las fichas por magnitud de «Ahora» no cambian en vivo (`docs/19` L3);
el alto del Resumen en teléfono con ocho tarjetas de «Ahora» (el máximo que se muestra) no se midió: la semilla llega a cinco; la prueba
de navegador del banco sigue fuera del verificador (se corre a mano con `banco.sh navegador`; el paso 2y4 solo mira sus selectores); y
el promedio del sitio de Tendencias se calcula sobre todas las lecturas de cada cubo, sin igualar el peso de cada dispositivo (resuelto el 14/11/2026, §68).

## 68. El promedio del sitio es el de sus dispositivos (14/11/2026)

**Qué cambió** (diseño en `docs/19 §4`, bloque M, con lo decidido al implementar escrito allí; `docs/10 §8.4` punto 66). Resuelve lo
que §67 dejó pendiente: `GET /sitios/{id}/historico` (Etapa 4) promediaba todas las lecturas de cada tramo, y en Tendencias la gráfica
salía con dientes de sierra y la banda con púas cada hora. Ahora, en cada tramo, cada dispositivo aporta un valor —el promedio de sus
lecturas del tramo o, si no reportó en él, su última lectura mientras tenga menos de dos intervalos esperados al empezar el tramo— y el
punto es el promedio de esos aportes; la banda, el mínimo y el máximo entre ellos; `n`, cuántos aportan; `muestras`, las lecturas
reales. La forma de la respuesta no cambia. **Backend:** la regla de vigencia pasó a una función, `sqlLecturaVigente` de
`consulta/tablero.ts`, su única casa: «Ahora» la evalúa con el reloj de la base (el mismo texto de antes) y el histórico al empezar cada
tramo. La consulta, `SQL_HISTORICO_SITIO` en el mismo archivo, agrega cada canal por su cuenta (`LATERAL`), lleva la lectura anterior a
la ventana en un tramo aparte y arrastra la última lectura por una rejilla de tramos hecha con `generate_series` en la zona del sitio. Va
en una conexión propia con 5 s de tiempo máximo y responde 503 si lo excede; la conexión vuelve al grupo con `RESET` y, si ni eso se
puede, se suelta con el error para que el grupo la destruya. La tendencia de «Ahora» comparte ese mecanismo (`conTiempoMaximo`): antes
devolvía la conexión al grupo aunque el `RESET` fallara. **Panel:** el rótulo de cada gráfica de Tendencias dice «Promedio de los
dispositivos que reportan, cada 15 minutos (hasta 3)», con el número de la respuesta; la etiqueta flotante suma «aportan: 3
dispositivos» y «Ver los datos», la columna «Dispositivos que aportan» (la ficha y la comparación, que usan el mismo gráfico, no la
tienen). Sin «cubo» en pantalla: «Tramas cada 15 minutos», «Historia: promedios por intervalo de tiempo» en P3b y «de cada intervalo»
en la ayuda de «Mostrar mín–máx». El OpenAPI describe el promedio nuevo y el 503 (38 rutas). **Banco:** `banco.sh historico`
(`historico-sitio.sh`, los cinco casos de M7), `tablero-semilla-historico.sql` (30 días de lecturas al ritmo que se le pida, con el
intervalo esperado igual al ritmo y la guarda del banco) y `tablero-medir.sh historico` (los cuatro rangos del panel con un `hasta` fijo).

**Pruebas nuevas y la falla plantada de cada una** (cada plantada se aplicó, se vio en rojo y se deshizo, y la huella del archivo quedó
igual a la de antes de plantarla). Backend, sin base: 18 pruebas en `historico-sitio.spec.ts`.

| Prueba | Plantada | Resultado |
|---|---|---|
| `historico-sitio.spec.ts`: el arrastre exige vigencia al empezar cada tramo | evaluarla al terminar el tramo | 1 en rojo |
| `historico-sitio.spec.ts`: la lectura anterior a la ventana se busca desde el inicio del primer tramo | desde `desde` | 1 en rojo |
| `historico-sitio.spec.ts`: ninguna regla de vigencia escrita a mano en la consulta | la del arrastre escrita a mano, con 3 intervalos | 2 en rojo |
| `historico-sitio.spec.ts`: cada canal por su cuenta y la cota `$7` | sin la cota (dos días antes de `desde`) | 1 en rojo |
| `historico-sitio.spec.ts`: la consulta, en una conexión propia con el tope de 5 s | por el grupo; con el tope de la tendencia (2 s) | 6 y 1 en rojo |
| `historico-sitio.spec.ts`: tiempo vencido → 503 y la conexión vuelve con `RESET` | sin el 503 | 2 en rojo |
| `historico-sitio.spec.ts`: con el `RESET` fallido, la conexión se suelta con el error (histórico y tendencia) | soltarla sin el error | 2 en rojo |
| `historico-sitio.spec.ts`: los parámetros llevan la cota calculada; `dispositivos` sale de la consulta; magnitud desconocida → 400 sin conexión | `desde` en vez de la cota; `dispositivos` = puntos; sin el 400 | 1, 1 y 1 en rojo |
| `historico-sitio.spec.ts`: la cota de lo que se lee sale de la misma regla que la vigencia (`sqlLimiteVigencia`) | la regla a 3 intervalos y la cota escrita a mano con 2 | 1 en rojo (y las 2 que fijan el factor) |
| `historico-sitio.spec.ts` (3): cupo de 2 consultas a la vez con fila en orden; fila llena → 503 sin pedir conexión; una consulta que falla o vence suelta su cupo | sin cupo; sin pasar al siguiente; fila sin tope; sin soltar al fallar | 2, 2, 1 y 1 en rojo |

Contra la base y el backend del banco (`banco.sh historico`: un sitio propio con ocho dispositivos de prueba en cuatro magnitudes, una
ventana de 75 minutos en cinco tramos; 7 comprobaciones). Con el código anterior, 6 de las 7 en rojo: la temperatura del caso 1 daba
11,917, 11,5, 11,5, 11,5 y 12,786 con `n` = 2, 1, 1, 1, 3 (los dientes de sierra), y la humedad del caso 3, 40,221 en vez de 60. Cada
plantada se aplicó en el código, se reconstruyó la imagen del banco y se corrió el guion:

| Caso (M7) | Plantada | Resultado |
|---|---|---|
| 1. Uno cada 3 minutos y dos cada hora: aportan 3 en los cinco tramos (14,167 ×4 y 14,5) | sin arrastre | 5 de 7 en rojo |
| 2. Uno cada 10 minutos que calla: aporta hasta dos intervalos (exactamente dos, ya no) y `n` baja | la vigencia con `>=` | 1 de 7 en rojo |
| 3. Uno cada 5 s junto a uno cada hora: 60, no 40,22 | cada lectura pesa (`sum(v * k) / sum(k)`) | 5 de 7 en rojo |
| 4. El primer tramo usa la lectura anterior a la ventana | leer solo desde `desde` | 3 de 7 en rojo |
| 5. Un tramo sin aportes no tiene punto | todos los tramos de la rejilla, con el promedio nulo | 1 de 7 en rojo |

La primera versión de la plantada 4 dejaba el parámetro `$7` sin usar y la base respondía 500 en las siete: se rehízo leyendo desde el
mayor entre la cota y `desde`, para que fallara por lo que prueba. Panel (5 pruebas nuevas, 345 pruebas del panel):

| Prueba | Plantada | Resultado |
|---|---|---|
| `Tablero.test.ts`: el rótulo con el número de la respuesta y sin «cubo»; «Tramas cada 15 minutos» y «cada hora» | el rótulo anterior; «Tramas por cubo de»; «cada 1 hora» | 1, 2 y 2 en rojo |
| `Tablero.test.ts`: la etiqueta flotante termina en «aportan: 8 dispositivos» | sin la fila; `GraficoSitio` sin `aportes` | 3 y 2 en rojo |
| `Tablero.test.ts` (nueva): «Ver los datos» con la columna de cuántos aportan, y la fila «aportan» sin muestra de color | sin la columna; con muestra | 1 y 1 en rojo |
| `lib/grafico.test.ts` (2 nuevas): `rotuloCada` y la fila «aportan» de `filasEtiqueta` (singular, sin dato, sin `aportes`) | «cada 1 hora»; sin la fila | 2 y 3 en rojo |
| `Comparar.test.ts` (nueva): «Historia: promedios por intervalo de tiempo» y sin la columna de cuántos aportan | el título anterior; la columna siempre | 1 y 2 en rojo |
| `Tablero.test.ts` (nueva): un 503 del histórico con su motivo muestra el consejo del servidor y «Reintentar» | el aviso de 503 siempre dice «saturado» | 1 en rojo |

**Medición (M6)**, en el banco (backend con 0,5 CPU y la base en RAM con techo de 768 MB, como en §61 y §66): 30 días sembrados con
`tablero-semilla-historico.sql`, los cuatro rangos del panel con `tablero-medir.sh historico` y un `hasta` fijo, mediana de 10
peticiones tras una de calentamiento, dos corridas (se da su promedio). Antes y después **sobre los mismos datos**: medido el código
nuevo, el backend se recreó con la imagen anterior, guardada, sin tocar la base.

| Dispositivos · ritmo (lecturas en 30 días) | Rango · resolución | Antes | Después | Veces |
|---|---|---|---|---|
| 120 cada 300 s (1 036 800) | 1 hora · 1 minuto | 6,1 ms | 12,2 ms | 2,0 |
| | 24 horas · 15 minutos | 30,5 ms | 34,1 ms | 1,1 |
| | 7 días · 1 hora | 181 ms | 143 ms | 0,8 |
| | 30 días · 6 horas | 817 ms | 553 ms | 0,7 |
| 2 000 cada 3 600 s (1 440 000) | 1 hora · 1 minuto | 14,4 ms | 65,2 ms | 4,5 |
| | 24 horas · 15 minutos | 52,5 ms | 162,5 ms | 3,1 |
| | 7 días · 1 hora | 313 ms | 521 ms | 1,7 |
| | 30 días · 6 horas | 1 251 ms | 1 088 ms | 0,9 |

**El umbral de 1,5 veces se cumple en 4 de las 8 mediciones.** Donde no: los equipos reportan una vez por tramo o menos, y la consulta
nueva trabaja por dispositivo y tramo (2 000 cada hora en tramos de un minuto: 2 000 lecturas en la hora y 120 000 aportes); en 7 días con
2 000, un tramo por lectura: 336 000 grupos de canal y tramo frente a 336 000 lecturas. Las respuestas cambian como pide M: con 2 000, `n`
pasa de variar (38, 42 o 60 en la última hora; 42, 158 o 900 en 24 horas) a 2 000 en todos los puntos, la última hora de 34 a 60 puntos
y las `muestras` suman lo mismo que antes. Antes de dejarla se compararon seis formas de la misma consulta con una de referencia (la
rejilla completa de canales por tramos, con funciones de ventana), con resultados idénticos fila por fila en los cuatro rangos; con 2 000,
la de referencia tardaba en la base 227–235 ms en la última hora y 960–971 ms en 7 días, y la que quedó, antes de un último ajuste (las
posiciones de la rejilla por una unión en vez de buscarlas en el arreglo, con las mismas respuestas), 45–49 ms y 492–497 ms. **La variante que arrastra en el
proceso** (la base devuelve lo propio por tramo y los tramos de arrastre en JSON, y el proceso los expande) se midió en la base, con los
mismos datos y sin contar el viaje ni el trabajo del proceso: 27–36 ms en 1 hora, 157–159 ms en 24 horas, 523–531 ms en 7 días y
1,07–1,08 s en 30 días, frente a 45–49, 168–169, 492–497 ms y 1,08 s de la de SQL (dos corridas de cada una). Ahorra la expansión del
arrastre en las ventanas cortas pero tampoco cumple el umbral, porque lo caro es agregar cada dispositivo por tramo y eso lo hacen las
dos en la base: quedó la de SQL (`docs/19` M6). **El criterio se corrigió el mismo día** (`docs/19` M6): el umbral relativo castigaba
diferencias de milisegundos que nadie percibe (12 ms frente a 6); el que queda es absoluto: ninguna petición sobre los 3 s que RNF-04 fija para
el historial de 30 días de un dispositivo (la más lenta, 1 088 ms), y en los rangos vivos el refresco de las seis magnitudes de la pestaña
bajo la décima parte de su período (con 2 000 dispositivos, 0,39 s de 10 s en «última hora» y 0,98 s de 60 s en «24 horas»). Las ocho
mediciones lo cumplen. El agregado por hora en la base queda como salida si un sitio real supera esas cifras. Con la serie de §61 (30 días de 120 cada
300 s, sembrada como allí), la consulta anterior tardó 1 138 ms en 30 días, como entonces (≈ 1,1 s); su primera corrida devolvió 500: el
proceso de la base que la atendía terminó y la base entró en recuperación, con el contenedor a 753 de 768 MiB (no se comprobó si fue el
límite de memoria); se vaciaron las tramas (el histórico no las lee) y se repitió.

**En navegador real** (pila de desarrollo, sitio `uct`, semilla completa recién cargada, una persona de descarte, Chromium 156, 1 280 y
390 px, tema claro; las capturas quedan fuera del repositorio). Antes (las capturas de §67): la temperatura en dientes de sierra entre
≈ 11 y 21 °C con la banda en púas cada hora, la humedad y la batería igual, y el rótulo «Promedio de 9 dispositivos por 15 minutos» en la
temperatura (el conteo de canales del resumen). Después: la temperatura es una curva continua con la banda lisa entre dispositivos (97 puntos en 24 horas, 2 o 3 aportando;
un solo salto de más de 1 °C entre puntos vecinos, cuando un tercer equipo vuelve a aportar tras sus pérdidas de la semilla), la humedad
y la batería sin púas, y la señal y la presión, de un solo equipo que reporta cada hora, en escalones (su última lectura, tramo a tramo).
Los rótulos dicen «(hasta 3)», «(hasta 4)», «(hasta 1)», «(hasta 2)» y «(hasta 1)»: antes la señal y la presión decían 2, el conteo de
canales del resumen, aunque solo uno reportaba en el rango. La etiqueta flotante: «promedio: 16,1 °C», «mínimo–máximo: 10,2 a 19,8 °C» y
«aportan: 3 dispositivos». A 390 px el rótulo ocupa dos líneas y la pestaña mide 2 453 px (2 358 en §67); a 1 280 px, 1 492 px, como
antes; ninguna se desplaza a lo ancho. La página registró un 401 en la consola, el de la sesión antes de entrar.

**Correcciones tras la revisión del bloque** (14/11/2026; revisión independiente de dos frentes, lógica y concordancia: 8 hallazgos, 7
distintos, todos corregidos). (1) *Cada consulta del histórico tomaba una conexión propia hasta 5 s sin tope de concurrencia:* la pestaña
pide hasta seis magnitudes juntas y el grupo tiene cinco conexiones, que comparte con la recepción; ahora corren como mucho dos a la vez,
las demás esperan en fila y, con doce en espera, la ruta responde 503. (2) *La cota de lo que se lee repetía a mano el «dos intervalos»*
de la regla de vigencia: ahora las dos salen de `sqlLimiteVigencia`. (3) *El panel decía «el servicio está saturado» ante todo 503:*
si la respuesta trae su motivo («prueba con un rango más corto o más tarde»), muestra el motivo. (4) *El paso 2t del verificador
comparaba con la cifra de hoy también las citas fechadas de las secciones anteriores de este documento,* y obligaba a redactarlas de
otra forma para pasar: de este documento rigen la cabecera y la última sección, como en el paso 2w4 (probado: la cita fechada pasa; una
cifra vigente equivocada en el informe o en la cabecera, no). (5) Un comentario del guion del banco quedó en la línea de otra orden; el
título de una prueba de la ficha aún decía «cubo»; y el pendiente de §67 no estaba marcado como resuelto.

**Cifras del bloque:** `pnpm verificar` en verde: 610 pruebas unitarias del backend en 55 archivos y 345 pruebas del panel (347
ejecuciones en vitest, en 33 archivos); `svelte-check`, 405 archivos sin errores. `pnpm openapi`: 38 rutas. `banco.sh historico`: 7 de 7.
`banco.sh navegador` (fuera del verificador; usa el gráfico y la comparación): 36 de 36 comprobaciones en Firefox y en Chromium.
El verificador completo, con la pila reconstruida y la semilla recién cargada: su primera corrida marcó el paso 2t por una cita fechada
de §66 con la forma «N pruebas unitarias» (la cifra de ese día), que se reescribió con la misma cifra; la segunda terminó en «TODO EN
CONCORDANCIA» (sesión y permisos, 386 de 386; panel con sesión, 330 de 330 en Chromium y Firefox). El informe, recompilado: 30 páginas
de cuerpo y ningún desborde.
**Lo que no cubre:** varias personas mirando a la vez (el criterio de la décima parte del período se calculó con una petición a la vez; no se midió con concurrencia); la variante del proceso se midió solo en
la base, no por HTTP, y solo con 2 000; el intervalo esperado que se usa es el de hoy de cada dispositivo, no el que tenía cuando
reportó; con 2 000 dispositivos el ritmo es cada hora porque cada 300 s no caben 30 días en la base del banco; una petición a la vez, sin
proxy, en el portátil y no en el servidor de referencia; la etiqueta flotante con la fila nueva no se probó en una pantalla táctil.

## 69. Limpieza: código del panel sin uso (14/11/2026)

**Qué se quitó, y con qué evidencia** (cada pieza se buscó en todos los componentes, módulos, pruebas y guiones de navegador antes de
borrarla). `Tarjeta.svelte`, el componente de valor del tablero anterior: desde el tablero v3 ninguna pantalla lo monta (§67 lo había
dejado declarado); se fue con su prueba de `Componentes.test.ts` y con sus reglas de estilo (`.tarjeta` y derivadas, `.indicadores`).
`.comparar-lista`, que ningún componente nombra. Dos funciones exportadas que nadie llamaba: `generacionDeSesion` (`lib/api.ts`) y
`preferenciasActuales` (`lib/escritor-preferencias.ts`). Y `PALETA` (`lib/grafico.ts`), un alias de la paleta del tema claro que solo
usaba una prueba: esa prueba lee ahora `SERIES` de `lib/tema.ts`, la única fuente, y comprueba los dos temas.

**Lo que se revisó y se queda.** Las clases `.muestra.serie-1` a `.serie-6`: la comparación las usa con un nombre armado
(`serie-{n}`), y una búsqueda del texto literal las daba por sueltas. En el backend, ningún archivo sin importar salvo los tres puntos
de entrada (el servicio, la exportación del OpenAPI y el emulador), ninguna exportación sin uso y ninguna dependencia declarada sin
uso (la CLI se usa en `nest build`; los tipos de `express` y `pg`, al compilar; `jsdom`, en las pruebas del panel). Ningún guion de
`plataforma/pruebas` quedó sin quien lo llame. `historico/` es la constancia de la etapa anterior y lo citan el README y las bitácoras.

**Cifras del bloque:** 344 pruebas del panel (346 ejecuciones en vitest, en 33 archivos; una menos, la del componente quitado) y 610
del backend; `svelte-check`, 404 archivos sin errores; la hoja de estilos queda en 33,4 kB (34,3 en §67). El verificador completo, en
«TODO EN CONCORDANCIA».

## 70. Migración a NestJS 12 (15/11/2026)

**Qué se subió.** Todos los paquetes `@nestjs/*` a la vez, con la regla del proyecto (la versión más reciente con al menos 7 días de
publicada al 15/11/2026; las posteriores al 08/11 quedaron fuera), con versiones exactas y sin tocar `pnpm-workspace.yaml` (sin cambios
en `git diff`; no hizo falta `minimumReleaseAgeExclude`). El núcleo debe ser 12.1 o posterior por lo que dice la guía de `@Optional()`
(más abajo). La guía no declara qué `@nestjs/swagger` acompaña a la 12: se leyó del registro, donde la 12.1.1 declara
`@nestjs/common` y `@nestjs/core` `^12.0.0` en `peerDependencies` (la 11.4.7 pedía `^11.0.1`); `@nestjs/config` 12.1.1 declara
`@nestjs/common` `^11.0.0||^12.0.0`.

| Paquete | Antes | Después | Publicada |
|---|---|---|---|
| `@nestjs/common` | 11.2.5 | 12.4.0 | 06/11/2026 |
| `@nestjs/core` | 11.2.5 | 12.4.0 | 06/11/2026 |
| `@nestjs/platform-express` | 11.2.8 | 12.4.0 | 06/11/2026 |
| `@nestjs/testing` | 11.2.5 | 12.4.0 | 06/11/2026 |
| `@nestjs/swagger` | 11.4.7 | 12.1.1 | 06/11/2026 |
| `@nestjs/config` | 4.0.4 | 12.1.1 | 06/11/2026 |
| `@nestjs/cli` | 11.0.24 | 12.0.12 | 06/11/2026 |
| `@nestjs/schematics` | 11.1.0 | 12.0.13 | 06/11/2026 |

Quedaron fuera la 12.4.1 y la 12.4.2 (09/11), la 12.5.0 (12/11) y las de `@nestjs/swagger` 12.1.2 y `@nestjs/cli` 12.0.13 (13/11; la 12.0.13 de `@nestjs/schematics` es otra, del 06/11). `typescript` sigue en
6.0.3 (la guía exige TypeScript 6 para `@nestjs/schematics`). Efecto en el árbol: `express` pasa de 5.2.1 a 5.3.0 (lo fija
`@nestjs/platform-express`), `multer` sigue en 2.5.0 y el lockfile cambia 681 líneas añadidas y 619 quitadas. Se hizo a mano con pnpm: `nest upgrade --dry-run`,
usado solo para leer, propone lo mismo (los ocho paquetes a `^12.0.0`) y avisa de lo único que la guía deja a revisión, el orden de los ganchos.

**Qué pedía la guía y qué aplicaba** (<https://docs.nestjs.com/migration-guide>, copia en bruto descargada el 15/11/2026). Node.js: ejecutar la 12 pide 22.12 o posterior en la rama 22; el proyecto declara `>=22.12 <23` y la imagen es
`node:22.23.4` (cumple); generar código con la CLI pide 22.22.3 o posterior (`@nestjs/schematics` 12.0.13 lo declara en `engines`; el
equipo usa 22.23.2). Paquetes en ESM: el proyecto ya es `"type": "module"` desde §60, sin cambios. Pruebas con Jest, GraphQL, NATS, Terminus,
Joi, pipes o filtros propios y multer: no se usan. Lo demás (esquemas estándar en decoradores, `StandardSchemaSerializerInterceptor`,
`routeConflictPolicy`, `errorCode`, `@nestjs/observe`, `deploy`, Rspack): es opcional y no se adoptó. Lo que sí se revisó, punto por punto:

- **Orden de los ganchos** (sección «Lifecycle hook ordering»). Se midió el orden real con la aplicación completa (`AppModule`, un pool
  falso y el broker en un puerto sin servicio, de modo que nada sale del proceso) en una copia con 11.2.5 y en el árbol con 12.4.0, tres
  corridas de cada una (idénticas entre sí). Resultado: las fases no cambian (inicio de módulos, luego `onModuleDestroy`, luego
  `beforeApplicationShutdown`, luego `onApplicationShutdown`); cambia solo el orden dentro de una fase. `MetricasBrokerService` pasó a un nivel
  posterior al de `BrokerService` y `DynsecService` (de quien depende): en 11 los tres iniciaban a la vez y ahora inicia después de ellos; al
  cerrar, en 11 su `onModuleDestroy` corría junto al de `DynsecService` y ahora termina antes de que este empiece. Es el orden que su
  dependencia pide, así que no hay regresión. Lo que importa, y no cambió: `RetencionService`, `SupervisionService` y las métricas
  detienen sus temporizadores antes de cerrar la base; `EventosController.beforeApplicationShutdown` (`tiempo-real/eventos.controller.ts:200`) corta los flujos antes; `DbModule`
  (`db/db.module.ts:38`) cierra el pool al final de todo. `RecepcionService.onModuleInit` (`recepcion/recepcion.service.ts:110`) solo agrega un
  manejador a la lista de `BrokerService` (`alRecibir`, `broker/broker.service.ts:65`), sin depender de que la conexión exista; `SesionService.onModuleInit`
  (`sesion/sesion.service.ts:93`) solo calcula el hash de relleno. Prueba nueva: `ciclo-de-vida.spec.ts` (1), que arma la aplicación completa y
  exige que cada gancho de cierre corra una vez, que todo lo que usa el pool o el broker termine antes de `DbModule.onApplicationShutdown` y que
  este sea lo último (plantada la violación, moviendo el cierre del pool a otra fase, falla; pasa con 11.2.5 y con 12.4.0).
- **Apagado con Express** («the Express adapter now drains in-flight requests on shutdown»). Las dos pruebas de `tiempo-real/eventos.spec.ts` siguen
  en verde con 12.4.0: «apagado con un flujo abierto» (línea 374: `app.close()` termina en menos de 1 s y el flujo se cierra) y «apagado con una
  petición normal en curso» (línea 387: responde 200 antes del cierre). Se midió además, en la copia 11 y en la 12, el cierre con una petición
  lenta en curso: con `Connection: close` 253 ms en ambas, y con una conexión persistente, 6 263 ms en ambas (la espera de la conexión ociosa
  del servidor de Node, que el §14 midió en ≈ 4 s y que no depende de Nest). Lo que dicen `docs/10 §6` y el §14 de este informe sobre el apagado
  sigue siendo cierto; no se cambió ni una palabra.
- **Mapeo de errores HTTP** («HTTP adapter error mapping has been reworked»). Con un servidor real, el código, el tipo de contenido y el cuerpo
  de 400 (texto y lista), 401, 403, 404, 409 (texto y objeto), 413, 429, 503 y 500 (sin el detalle del error), una ruta inexistente, un JSON
  ilegible y un cuerpo sobre el tope del lector salen byte a byte iguales en 11.2.5 y 12.4.0 (comparados con `diff`). Quedó como
  `errores-http.spec.ts` (14 pruebas). El OpenAPI exportado (`pnpm openapi`, 38 rutas) queda idéntico: `git diff` de `backend/openapi.json` vacío.
- **`verify` del lector de JSON (no estaba en la guía).** `tsc` falló en `main.ts` con 12.4.0: el tipo de las opciones de `useBodyParser` excluye
  `verify`, que Nest reserva para capturar el cuerpo crudo con `rawBody: true` (`NestExpressBodyParserOptionsFor`, en `@nestjs/platform-express`), y el
  tipo de `type` pide `IncomingMessage` en vez de `Request`. La aplicación no usa `rawBody`, y en ejecución el adaptador pasa las opciones sin tocarlas
  cuando no se lo pide (`adapters/utils/get-body-parser-options.util.js` de `@nestjs/platform-express` 12.4.0), así que `verify` sigue rigiendo: el tope de 100 KiB para un cuerpo sin
  largo declarado (`arranque.ts`: `opcionesLectorJson` y `cuerpoExcedido`). Cambio: las opciones del lector de JSON y su manejador de errores salen de `arranque.ts`, no de un literal (el compilador
  rechaza `verify` solo en un literal) y `type` recibe `IncomingMessage`. Como el tipo ahora dice que no debería funcionar, `arranque-cuerpo.spec.ts` (4 pruebas, con las mismas opciones y el mismo manejador que `main.ts`) lo
  comprueba con un servidor real: 1 KiB por trozos responde 201 y 150 KiB por trozos, sin `Content-Length`, responde 413 en JSON con su motivo; en el alta por lote 150 KiB entran y 600 KiB responden 413 con el motivo del lote. Con la falla plantada: sin `verify`, la segunda da 201; con el manejador anulado, la última no trae el motivo.
- **`@Optional()`.** Están en `recepcion/recepcion.service.ts:100`, `sesion/usuarios.service.ts:66` y `tiempo-real/eventos.controller.ts:49-50`. Ninguna de las tres
  clases extiende a otra (la única herencia del código son `TramaMalformada`, `IdentidadNoVerificada` y `ErrorDynsec`, que descienden de `Error`). La regla nueva no se aplica; la
  exigencia de 12.1 para el núcleo es por los casos de subclase sin constructor propio, que aquí no existen. La aplicación completa arranca (`ciclo-de-vida.spec.ts`).
- **Registro** («Structured logging params»). Con un análisis del código fuente (TypeScript, no una búsqueda de texto) de los 100 archivos de
  `src/` sin pruebas: 87 llamadas a `log`, `logger` o `new Logger(…)` y ninguna con más de un argumento, así que no hay objeto después del mensaje y la
  novedad no se activa. El formato JSON y el de texto de `ConsoleLogger` (el único registrador propio, `main.ts:21`) salen idénticos en 11.2.5 y 12.4.0 con
  mensajes con acentos, porcentaje y saltos de línea. Sin cambios en `structuredParams`.
- **`@nestjs/config`.** El uso es `ConfigModule.forRoot({ isGlobal: true, envFilePath: [...] })` (`app.module.ts:38`), sin `validationSchema` ni `validationOptions`, que es lo que
  la guía cambia. Se comparó la lectura de un archivo de variables de prueba (comillas, comentarios, `export`, `${A}` sin expansión, vacío, dos archivos con
  precedencia del primero, valor por defecto, `getOrThrow`) en 4.0.4 y 12.1.1: salida idéntica. La biblioteca de lectura sube de `dotenv` 17 a 18 y
  de `dotenv-expand` 12 a 13; sin efecto observable en esa prueba.
- **`tsconfig.json`.** No se cambió. La guía muestra `target` ES2023 y `resolvePackageJsonExports` para los proyectos de v10 o v11 temprano que pasan a ESM; el
  proyecto ya usa `module` y `moduleResolution` `nodenext`, el caso que la guía describe como «nada que cambiar» (con `resolvePackageJsonExports` en verdadero o en falso
  `tsc` da lo mismo: el proyecto no depende de ese valor). Con `target` ES2023 también compila: no hay
  razón para moverlo.
- **CLI.** `pnpm build` (`nest build`) compila con 12.0.12; `nest start --watch` arranca, escucha y sirve `/panel/` (200) con el broker y la base apuntados a un puerto sin
  servicio (variables de descarte, nada tocó la pila); `/salud` responde 500 porque esa ruta consulta la base, como se esperaba. Se detuvo con SIGINT y el puerto quedó libre.

**Pruebas y auditoría.**

| | Antes (11.2.5) | Después (12.4.0) |
|---|---|---|
| Backend | 610 pruebas, 55 archivos | 629 pruebas, 58 archivos (las 19 nuevas, arriba) |
| Panel | 346 pruebas, 33 archivos; `svelte-check` 404 archivos, 0 errores | igual |
| `pnpm build` | en verde | en verde |
| `pnpm audit` | 3 avisos de desarrollo: `glob` (moderado, `@nestjs/cli`), `minimatch` (moderado, `eslint`), `deepmerge` (bajo, `@nestjs/cli` y el panel) | 2: `minimatch` (moderado, `eslint`; 33 rutas) y `deepmerge` (bajo, `@nestjs/cli` y el panel) |

El aviso de `glob` desapareció porque la CLI 12 ya no depende de `glob` sino de `minimatch` 11.0.5, que está en la versión corregida. El de `minimatch` que
queda entra por `eslint` y `typescript-eslint` (versión 10.2.6, sin cambio por esta migración). `fork-ts-checker-webpack-plugin` 9.1.0 sigue en el lockfile
(dependencia opcional de la CLI que pnpm instala sola; ahora con TypeScript 6.0.3, antes con 5.9.3) y con él `minimatch` 3.1.5 y `deepmerge` 4.3.1; `minimatch` 3.1.5 queda fuera del rango
afectado del aviso que `pnpm audit` informa (de 7.0.0 a 11.0.0), y `deepmerge` sigue sin parche. Ninguno entra a la imagen.
No se comprobó qué versión de `minimatch` señala la alerta abierta en GitHub: `pnpm audit` no la nombra.

**Avisos de terceros.** `generar-avisos-terceros.sh` regenerado (no necesita la pila) y `--comprobar` en verde: 180 paquetes de producción (eran 179) y 7 licencias. Cambio de
licencia declarada: `argparse` 3.0.4, que llega con `js-yaml` 5.5.0 de `@nestjs/swagger`, declara `PSF-2.0`, no `Python-2.0`; el paso 2r del verificador
(`PERMITIDAS` en `plataforma/pruebas/verificar-todo.sh`) no incluía `PSF-2.0`. Se agregó el 15/11/2026: su texto (47 líneas, en el paquete) es el acuerdo de la Python Software
Foundation, versión 2 —uso, modificación y distribución sin pago, conservando el aviso—, la misma sección que ya trae `Python-2.0`, sin la parte histórica (37 de sus 38 líneas son literales); cumple RNF-15. Se actualizó el conteo del `README.md` del backend (179 → 180) y las citas de pruebas que
vigila el paso 2t (610 → 629) en `docs/11`, `docs/15`, la cabecera de este documento y tres archivos del informe y las láminas.

**Cifras del bloque:** `pnpm verificar` en verde: 629 pruebas unitarias del backend en 58 archivos y 344 pruebas del panel (346 ejecuciones en vitest, en 33 archivos); `svelte-check`, 404
archivos sin errores; `pnpm build` y `pnpm openapi` (38 rutas) sin diferencias en el contrato.

**Con la pila levantada (15/11/2026).** La imagen del backend se reconstruyó con las versiones nuevas (`pila.sh encender`: sana en 21 s, construcción incluida;
dentro del contenedor, `@nestjs/core` 12.4.0) y el verificador completo (`verificar-todo.sh`) corrió contra ella. El apagado dentro de Docker (`docker stop`, sin flujos
abiertos): 0,2 s, código de salida 0 y una sola señal, sin llegar al corte forzado.

**Lo que dejó la revisión del bloque.** La prueba del lector de JSON llevaba una copia de las opciones de `main.ts` y habría seguido en verde si alguien las cambiaba
allí: las opciones y el manejador de errores pasaron a `arranque.ts`, y `main.ts` y la prueba usan lo mismo. La prueba del ciclo de vida no fijaba el orden que promete
`docs/10 §6` ni el que cambió con la 12: ahora comprueba que el supervisor y las métricas terminan antes de que el broker se desconecte, y que las métricas arrancan
después de él (medido: retención, supervisión, métricas, broker, administración del broker, flujos en vivo y, al final, la base). Estas dos comprobaciones de orden
no tienen falla plantada: invertir el orden exigiría cambiar las dependencias entre módulos.

**Lo que queda.** La recepción bajo carga con 12.4.0 (el banco, que no corre dentro del verificador) y el CI con la CLI 12, que para generar código pide Node 22.22.3 o
posterior (el flujo usa la línea 22 sin fijar la versión menor). Las comparaciones entre 11.2.5 y 12.4.0 de esta sección se hicieron en una copia de trabajo con la
versión anterior instalada y no quedan como guion: lo repetible son las tres pruebas nuevas.
## 71. Alta masiva: plan por fila, todo o nada y reintento (15/11/2026)

**Qué se construyó** (diseño en `docs/19 §4`, bloque N, primera parte del punto 12, con lo decidido al implementar escrito allí;
`docs/10 §8.4` punto 67). **Backend:** `POST /dispositivos/lote` responde el plan por fila: `n` (lo manda el cliente; entero positivo,
único y creciente, devuelto tal cual), `interpretada` (lo que se creará, o `null`), `por_defecto`, `avisos` y `motivos` por campo, y
`motivo` como su unión; arriba, `leidas, validas, existentes, rechazadas, con_aviso` y la `huella` (SHA-256 de `[n, interpretada]` de las
filas que entran, en JSON con las claves ordenadas). `modo=crear` exige la huella y la cabecera `Idempotency-Key`, recalcula dentro del
candado de una creación a la vez y crea todo o nada: si el plan cambió, 409 `plan_cambio` con el plan nuevo; otra creación en curso, 409
`lote_en_curso`; el choque que solo ve la base (23505, o `fk_dispositivo_pasarela_formato`) deshace, recalcula y responde también
`plan_cambio`. La respuesta de una creación terminada se guarda 2 minutos por persona y llave (hasta 200), y repetir con la misma llave y
el mismo cuerpo la devuelve sin crear nada; con otro cuerpo, 422. Rutas nuevas: `GET /dispositivos/lote/plantilla` (columnas con su
tope, obligatorias, ayuda y ejemplo; `max_filas`, `max_bytes` y separadores; la acción «escribir») y `GET /magnitudes` (con sesión). La
columna `decodificador` entra al lote y `canales` admite `|` y `;`. **Topes:** cada columna el suyo (identificador 63, nombre 80, `canales`
1 197 caracteres —20 canales «magnitud:unidad» con 40 y 16 caracteres y « | » entre ellos—, 80 las demás) y 400 con la fila si una celda
lo pasa o no es texto ni número. El tope del cuerpo sale del peor caso medido de lo que se acepta: al cerrar el bloque, 1 467 392 bytes;
tras la revisión, que endureció la guarda de las celdas, 1 147 904 (`MAX_BYTES_LOTE`, más abajo), el mismo en el lector de JSON
(`arranque.ts`), en la plantilla y en el proxy (que antes no fijaba ninguno y regía el de fábrica, 1 MiB). Los 512 KiB de antes no
alcanzaban. **Panel** (adaptación mínima, sin rediseñar): `n` es la
fila del CSV contando las vacías; columnas, obligatorias (ahora cinco, con `intervalo_esperado_s`), `max_filas` y `max_bytes` salen de la
plantilla; una sola petición de creación con la huella y una llave nueva, que se repite con la misma llave si no hay respuesta o llega un
502, 503 o 504; los 409 se tratan por su `codigo` (con `plan_cambio`, el informe pasa al plan nuevo). Fuera las tandas, «creadas N de M» y
«Reintentar las restantes». Los guiones `api-smoke.sh`, `sesion-smoke.sh` y `banco/tablero-medir.sh` mandan `n`, la huella y la llave.

**Pruebas nuevas y la falla plantada de cada una** (cada plantada se aplicó con un guion que reemplaza un texto exacto, se vio en rojo y
se deshizo). Backend: 28 pruebas nuevas, en `lote.spec.ts` (10 más), `lote-limites.spec.ts` (6), `lote-controlador.spec.ts` (11) y
`lote-servicio.spec.ts` (1 más); `arranque-cuerpo.spec.ts` cambia una.

| Prueba | Plantada | Resultado |
|---|---|---|
| `lote.spec.ts`: invariante `validas + existentes + rechazadas = leidas`, con `con_aviso` transversal | contar como existentes solo las que traen aviso | 1 en rojo |
| `lote.spec.ts`: el `n` del cliente se devuelve tal cual | numerar por posición | 1 en rojo |
| `lote.spec.ts`: RF-41, un identificador de otro sitio sigue «no disponible», sin id ni `interpretada` | sin la comprobación de ajenos | 1 en rojo |
| `lote-controlador.spec.ts`: «vista previa = creación», lo insertado es, fila por fila, lo anunciado | insertar el formato del alta en vez del resuelto (un nodo lorawan quedaría `senml`) | 1 en rojo |
| `lote-controlador.spec.ts`: 409 `plan_cambio` si la pasarela se desactiva o cambia de formato entre validar y crear (cambios que la base no impide), con el plan nuevo y nada creado | sin comparar la huella; la huella sobre el identificador y no sobre `interpretada` | 1 y 1 en rojo |
| `lote-controlador.spec.ts`: 409 `lote_en_curso` con otra creación en vuelo | sin el candado | 1 en rojo |
| `lote-controlador.spec.ts` y `lote-servicio.spec.ts`: el 23505 deshace y responde `plan_cambio` con el plan recalculado | el servicio con el 409 de antes; el controlador sin recalcular | 2 y 1 en rojo |
| `lote-servicio.spec.ts`: el 23503 de `fk_dispositivo_pasarela_formato` es `ChoqueDeLote`; otro 23503 sigue siendo 400 | todo 23503 como choque | 1 en rojo |
| `lote-controlador.spec.ts`: misma llave y mismo cuerpo, la misma respuesta y ningún dispositivo de más; otro cuerpo, 422 | sin buscar la respuesta guardada | 1 en rojo |
| `lote-controlador.spec.ts`: la vista previa de 500 filas hace 5 consultas (los catálogos, una vez cada uno) | una consulta por fila | 1 en rojo |
| `lote-controlador.spec.ts`: la plantilla, solo con «escribir» (consulta e investigador, 403) | sin la comprobación | 1 en rojo |
| `lote-limites.spec.ts`: 500 filas llenas caben en `MAX_BYTES_LOTE` y el tope no las pasa en más de 16 KiB | el tope de antes, 512 KiB | 1 en rojo |
| `lote-limites.spec.ts`: el proxy fija el mismo número | `client_max_body_size 1m` | 1 en rojo |
| `lote-limites.spec.ts`: una celda un carácter sobre su tope, 400 con su fila (las nueve columnas) | admitir un carácter más | 1 en rojo |
| `arranque-cuerpo.spec.ts`: el tope justo entra y un byte más es 413 en JSON | el lector con 512 KiB | 1 en rojo |

Panel: 3 pruebas nuevas (`lib/lote.test.ts`, 2 más; `Alta.test.ts`, la de tandas reemplazada por dos). Plantadas: numerar después de
descartar las filas vacías (3 en rojo), una llave nueva en cada repetición (1), no reconocer `plan_cambio` (1) y las obligatorias
escritas en el panel en vez de las de la plantilla (1). Con la pila: `api-smoke.sh` suma 6 casos (la forma del plan, la celda sobre su
tope, el `n` repetido, la creación sin llave, la plantilla y las magnitudes) y `sesion-smoke.sh` pasa de una creación directa a vista
previa y creación con huella y llave, y suma «vista previa = creación» contra la base real (la ficha del creado comparada campo por campo
con su `interpretada`), el reintento (misma respuesta, ningún dispositivo de más), la llave con otro cuerpo (422), el 409 `plan_cambio`
con una huella vieja y las dos rutas nuevas por perfil: 404 de 404 comprobaciones.

**Mediciones** (equipo de desarrollo; banco de `banco.sh encender 10`, imagen construida con este código; tres corridas por caso, cuatro en
validar por mqtt; 500 filas de unos 91 kB; en `crear`, una petición; el tiempo es el total de curl, `time_total`).

| Caso | Sin proxy (backend del banco, 3001) | Con el proxy TLS delante (`banco.sh proxy`, 8443) |
|---|---|---|
| validar 500, vía http | 0,012 · 0,024 · 0,031 s | 0,021 · 0,022 · 0,023 s |
| crear 500, vía http | 0,100 · 0,112 · 0,117 s | 0,087 · 0,114 · 0,131 s |
| validar 500, vía mqtt | 0,011 · 0,016 · 0,019 · 0,025 s | 0,021 · 0,028 · 0,053 s |
| crear 500, vía mqtt (con las órdenes al broker) | 0,361 · 0,417 · 0,420 s | 0,463 · 0,515 · 0,609 s |

Por el proxy, el peor caso de entonces, 1 467 087 bytes, entraba (200, 500 filas que no entran, en 0,08 s) y un cuerpo de un byte más
que el tope lo cortaba nginx con 413 después de leer 65 323 bytes, con la página HTML de nginx. Desde la revisión, ese 413 sale en JSON
(abajo).

**Lo que queda.** La pantalla de tres pasos (N7), los lectores de CSV con `;`, `,` y tabulador, el pegado y JSON (N6), las descargas con
`;`, BOM y la neutralización de fórmulas de ancho completo (N9) y el lector de XLSX, con sus pruebas en navegador real y sus umbrales
(N11). Dos límites, anotados en `docs/11 §4`: el candado de «una creación a la vez» es de todo el proceso, así que la carga de un sitio
estorba a otro (el remedio es un bloqueo por sitio en la base), y tomar una conexión del grupo para el alta no tiene tiempo máximo de
espera (si la base se cuelga, el candado queda tomado hasta que responda).

**Lo que dejó la revisión del 15/11/2026.** Cada corrección de comportamiento lleva su prueba y su falla plantada
(aplicada con un guion que reemplaza un texto exacto, vista en rojo y deshecha); lo que cambia el contrato se escribió antes en `docs/19 §4`
(N2, N5 y N8) y en `docs/10 §8.4` punto 67.

| Corrección | Prueba | Plantada → resultado |
|---|---|---|
| El tope grande del cuerpo, solo para `POST /dispositivos/lote` (antes, cualquier método en esa ruta) | `arranque.spec.ts` (otro método, 100 KiB) y `arranque-cuerpo.spec.ts` (PUT por trozos, 413) | sin mirar el método → 2 en rojo |
| En esa ruta, sin la cookie de sesión ni `X-Clave-Admin`, 401 antes de leer el cuerpo (no valida la sesión: quita el caso trivial; una cookie inventada con la forma correcta sigue costando una lectura acotada) | `arranque-cuerpo.spec.ts` | sin el filtro → 1 en rojo |
| Proxy: tope general de 128 KiB, `location` propio del lote con su tope y las mismas zonas de `location /`, y los 413 en JSON con el cuerpo del backend | `lote-limites.spec.ts` (lee `nginx.conf`) | sin la zona de administración en el lote → 1; sin `error_page` → 1 |
| Celdas: sin caracteres de control ni sustitutos sueltos; fuera de nombre y zona, solo ASCII imprimible sin `"` ni `\`; solo columnas de la plantilla (400) | `lote-limites.spec.ts`: el peor caso **intenta superarse** con cada carácter admisible por columna y no puede | admitir controles → 1; admitir cualquier carácter en los códigos → 1 |
| El tope del cuerpo, recalculado bajo esas reglas: 1 147 087 bytes medidos, `MAX_BYTES_LOTE` = 1 147 904 (1 121 KiB); antes, 1 467 392, que se superaba con caracteres que la guarda aceptaba (por ejemplo, con «"» en las columnas de códigos, que el JSON escribe con dos bytes: 1 977 087, medido) | ídem | — |
| Claves de más de 80 caracteres, recortadas en el motivo; `Object.hasOwn` en vez de buscar en la tabla (con `__proto__`, `constructor` o `toString` el valor heredado no era `undefined`) | `lote-limites.spec.ts` | sin recortar → 1; con `in` → 1 |
| Almacén de respuestas por llave: solo lo que creó algo, con topes de 200 entradas, 3 por persona y 16 MiB | `lote.spec.ts` (los tres topes) y `lote-controlador.spec.ts` (un 409 no se guarda) | sin tope de bytes → 1; sin tope por persona → 1 |
| La tasa antes de firmar el cuerpo; el reintento, con su propio cupo de 10 por minuto | `lote-controlador.spec.ts` (un cuerpo que no se puede firmar recibe 429) | firmar antes → 1; el reintento con el cupo de los lotes → 1 |
| El reintento exige conservar «escribir» en los sitios de lo creado | `lote-controlador.spec.ts` | sin mirar los sitios → 1 |
| COMMIT que responde con error: se comprueba si los dispositivos quedaron; si quedaron, el lote está creado; si no, se borra del broker; si no se sabe, 503 sin tocar el broker | `lote-servicio.spec.ts` (los tres casos) | sin comprobar → 2; deshacer aunque no se sepa → 1 |
| Las pasarelas del lote, bloqueadas `FOR SHARE` y comprobadas activas dentro de la transacción | `lote-servicio.spec.ts` | sin la comprobación → 1 |
| Todo o nada al pie de la letra: en `crear`, una fila que no entra o que ya existe es 409 `plan_cambio` | `lote-controlador.spec.ts` y `sesion-smoke.sh` | sin la condición → 1 |
| Zonas y pasarelas en mapas, una vez por petición | `lote.spec.ts` (los recorridos no crecen con las filas) | un recorrido por fila → 1 |
| Panel: si `crear` se queda sin respuesta tras los tres intentos, el aviso con el remedio (inventario; las que salen «ya existe» necesitan rotar su credencial), y «no cierres ni recargues» mientras crea | `Alta.test.ts` | sin el aviso → 1 |
| Panel: la regla de una ventana, una sola función para la URL y el formulario (`errorDeVentana`) | `lib/vista.test.ts` | con `>=` → 1 |
| Recepción: un error imprevisto de un adaptador va a cuarentena `malformada` con un motivo genérico y se confirma; el registro lleva su clase, no su texto (`docs/10 §4.1`) | `recepcion.service.spec.ts` (prueba de servicio nueva) | relanzarlo → 1 |
| Plano: un número a secas que no es finito es malformada (regla C-95 de la matriz, §73) | `contrato.spec.ts` · C-95 | sin la comprobación → 1 |

Además: la descripción de la huella en el OpenAPI (era «de las `interpretada` en orden»), el 401 de la plantilla en el OpenAPI, el valor
exacto de `max_bytes` en `api-smoke.sh` (leído de `alta/lote.ts`), el comentario de `entrega` en `consulta/tablero.ts`, el identificador de
prueba con prefijo de fabricante real cambiado por uno sintético, y `docs/19` (bloque F y fila de P7, ya reemplazados por N; N2, N5 y N8),
`docs/11 §4` (lo diseñado el 28/10 separado de lo que rige) y `docs/10` punto 67 al día. **Con la pila:** `api-smoke.sh` TODO OK;
`sesion-smoke.sh` 408 de 408 (crear mandando también las que no entran → 409 y ninguna creada; las válidas → creadas; 401 sin sesión
antes de leer el cuerpo). **`banco.sh proxy`:** PROXY OK y `proxy-limites.sh` 27 de 27. Las cuatro comprobaciones de `/eventos` que daban
401 abrían flujos sin sesión (el canal la exige desde el 08/11): ahora sostienen 20 peticiones a `/eventos` que suben su cuerpo despacio
(nginx las cuenta mientras lo lee) y la 21.ª recibe 429; después, sin sesión 401 y con la clave del banco un flujo (200). Se sumaron los
topes del cuerpo por el proxy: un byte más que el del lote y 200 KiB fuera de él → 413 en JSON; 200 KiB con PUT al lote → 413 del
backend. Por el proxy, el peor caso nuevo, 1 147 087 bytes, entra (200, en 0,04 s). Pruebas: 709 → 726 en el backend (62 archivos) y
353 → 355 en el panel (357 ejecuciones).

**Lo que dejó la segunda revisión del 15/11/2026, y los errores que ve quien usa la pantalla.** Cada corrección con su prueba y su
falla plantada (aplicada, vista en rojo y deshecha); el contrato y la tabla de errores se escribieron en `docs/19 §4` (N8 y N8b) y en
`docs/10 §8.4` punto 67.

| Corrección | Prueba | Plantada → resultado |
|---|---|---|
| COMMIT con error: se buscan los `id` que devolvió el INSERT de este lote (no los `id_fisico`, que otra petición pudo crear entre tanto) y deben estar todos; «algunos» es incierto | `lote-servicio.spec.ts` (todos; 1 de 2) | buscar por `id_fisico` → 1; «alguno basta» → 1 |
| COMMIT con error: la conexión se destruye antes de preguntar (no vuelve al grupo con una transacción quizá abierta) y se espera a que termine su proceso en la base (`pg_terminate_backend` y `pg_stat_activity`), para que un COMMIT en vuelo ya se haya aplicado o ya no pueda | `lote-servicio.spec.ts` (las tres ramas comprueban `release(true)`) | sin destruirla → 3 |
| El 503 incierto lleva `codigo: lote_incierto` y dice qué puede quedar (usuarios del broker sin dispositivo, listados en el registro) | `lote-servicio.spec.ts` | sin el `codigo` → 2 |
| Los fallos definitivos del lote llevan `codigo: nada_creado`; el 429, `codigo` y `reintentar_en_s`; el 400 del cuerpo, `cuerpo_invalido`; el 413 de filas, `demasiadas_filas`; la plantilla, `texto_libre` por columna | `lote-servicio.spec.ts`, `lote-controlador.spec.ts` y `lote-limites.spec.ts` | el 429 sin la espera → 1 |
| `Permissions-Policy` y `Cache-Control: no-store` también en el 401 y el 413 que se dan antes de leer (`cabecerasDeLaApi`, montada primero) | `arranque-cuerpo.spec.ts` | montarla después → 1 |
| El 413 del lector elige su mensaje por la ruta (`esLote`): fuera del lote, el de 100 KiB aunque el cuerpo pase también el tope grande | `arranque-cuerpo.spec.ts` | el mensaje del lote para todos → 1 |
| El almacén por llave mide bytes (`Buffer.byteLength`); medido en memoria, ≈ 2 veces el JSON (20 respuestas de 500 filas: 9,9 MB de JSON, 20 MB del montículo), así que lleno ronda 32 MiB | — (documentado en `lote.ts`, `docs/10` y `docs/11`) | — |
| El error imprevisto de un adaptador se registra acotado (un ERROR por adaptador y clase por minuto); la rama del tópico de pasarela tiene su prueba | `recepcion.service.spec.ts` | sin acotar → 1; sin la condición de la pasarela → 1 |
| Lo que el backend trata como lote también lo trata así el proxy (tabla de URL con `/` final, consulta, mayúsculas, `;x`, `//` y `%2f`) | `lote-limites.spec.ts` | un `esLote` más ancho que el `location` → 1 |
| «El peor caso de lo que se acepta» es el del JSON tal como lo escribe `JSON.stringify`: un cuerpo con sangría, números con relleno o escapes pesa más y recibe 413 (se eligió decirlo; restringir los números no evitaba la sangría) | — (documentado) | — |
| Panel: un 409 que llega en un reintento no dice «no se creó ninguno» sino que no se sabe; un fallo con `codigo` (`nada_creado`, `lote_incierto`) no se repite y dice lo cierto | `lib/lote.test.ts` y `Alta.test.ts` | sin la regla del intento → 2; repetir lo definitivo → 1 |
| Panel: la tabla de N8b. Una sola traducción (`explicarError`, `TEXTO_DE`, `ACCION_DE`), una prueba por caso en `lib/lote.test.ts` (22 casos), lo que se ve y el botón en `Alta.test.ts`, y una prueba que falla si un caso queda sin mensaje o sin acción; lo que se puede ver al leer (columna desconocida, obligatoria que falta, celdas de más, celda fuera de forma, filas o bytes de más) se ve antes de enviar | `lib/lote.test.ts`, `Alta.test.ts` | plan cambió sin las filas → 2; columna desconocida sin aviso → 3; sesión vencida como «otro» → 2; un caso sin acción → 1 |

Con la pila reconstruida y el proxy reiniciado: `api-smoke.sh` TODO OK, `sesion-smoke.sh` 408 de 408 y `banco.sh proxy` PROXY OK, con `proxy-limites.sh` 27 de 27. Pruebas: 726 → 731 en el backend (62 archivos) y
355 → 365 en el panel (404 ejecuciones en vitest).

## 72. Rango a medida en la ficha y el valor de la salud del sitio (15/11/2026)

**Por qué.** A dos historias del núcleo les faltaba una sola cosa para poder cerrarse (`docs/18 §5`). HU-07 (historial por rango de fechas): la ficha
ofrecía cuatro rangos fijos, el zoom y `desde`/`hasta` por URL, pero el formulario para **elegir** las fechas existía solo en el tablero del sitio, y
ninguna prueba comprobaba que el rango dejara fuera lo que cae fuera. HU-16 (salud del sitio): el indicador estaba en el tablero, pero solo se probaba
su forma, no el valor que calcula el servidor.

**Qué se hizo.** Diseño primero: `docs/19 §4`, punto D1b. El formulario «A medida» pasó a un componente (`FormularioAMedida.svelte`) y su validación a una
función (`validarAMedida`, `lib/vista.ts`); el tablero y la ficha usan los dos, con los mismos textos y el mismo tope de 366 días. En la ficha, la ventana
elegida es una ventana fija más: va a la URL, y la gráfica, las condiciones y el historial de eventos piden esa ventana, con la resolución que el tablero
da a ese ancho (`resolucionParaVentana`, `lib/grafico.ts`). El porcentaje de salud pasó a una función pura, `porcentajeSalud()` (`consulta/tablero.ts`): sin
supervisados devuelve nulo, redondea al décimo y se acota entre 0 y 100 si los conteos llegaran incoherentes.

**Pruebas nuevas, cada una con su falla plantada** (se puso el defecto, la prueba quedó en rojo, se quitó):

| Prueba | Defecto plantado | Resultado |
|---|---|---|
| `Ficha.test.ts`: a medida, el histórico, las condiciones y los eventos llevan el mismo `desde` y `hasta`, y la URL lo refleja | los eventos piden las últimas 24 h; la ventana no se fija | rojo las dos |
| `Ficha.test.ts`: a medida inválido (fin anterior al inicio, más de 366 días, vacío) no pide nada y dice el motivo junto a los campos | sin el tope de 366 días; sin comprobar el orden | rojo las dos |
| `vista.test.ts`: `validarAMedida`, con el borde de 366 días justos | `>=` en vez de `>` | rojo |
| `grafico.test.ts`: `resolucionParaVentana` | devolver siempre un minuto | rojo |
| `tablero.spec.ts`: `porcentajeSalud` (13 de 14 → 92,9; 14 de 14 → 100; 0 de 14 → 0; sin supervisados → nulo; 15 de 14 → 100) | redondeo hacia abajo; sin acotar; cero en vez de nulo | rojo las tres |
| `rango-y-salud.spec.ts`: el servicio usa `porcentajeSalud` y el SQL cuenta supervisados = no inactivos | no usarla; contar a todos | rojo las dos |
| `rango-y-salud.spec.ts`: eventos con `ocurrido_en >= desde AND < hasta`; histórico con `tiempo >= desde AND < hasta` | `<=` en el fin; sin la cota inferior | rojo las dos |

Las pruebas del rango en el servidor comprueban el texto y los parámetros de la consulta, no filas: la comprobación contra la base real son los casos
nuevos del humo de la API (`api-smoke.sh`: un rango anterior a todo el historial no trae eventos; `hasta` es exclusivo y `desde` inclusivo; en el resumen,
supervisados = total − inactivos, reportan ≤ supervisados y el porcentaje es su cociente con un decimal).

**Cifras del bloque:** `pnpm verificar` en verde: 665 pruebas unitarias del backend en 61 archivos (eran 657 en 60) y 353 pruebas del panel (eran 347;
355 ejecuciones en vitest, en 33 archivos).

**Lo que queda.** La ficha con el formulario en un navegador real, a 1 280 y a 390 px (hasta aquí solo hay pruebas sin navegador): es condición para
cerrar HU-07 (hecho el 16/11/2026: §75). Un rango de menos de dos minutos dibuja un solo punto, igual que en el tablero.

## 73. Matriz del contrato de trama (15/11/2026)

**Qué es y por qué.** TT-27 pedía pruebas del contrato de trama «regla por regla». Hasta hoy había muchas pruebas unitarias de la recepción, pero
nada decía qué regla cubría cada una ni fallaba si una regla quedaba sin prueba. Esta sección fija la **matriz**: 104 reglas del contrato (93 al principio del 15/11/2026; las revisiones del mismo día sumaron C-95, C-96 a C-99 y C-100 a C-105), cada una
con su fuente, su resultado esperado y la prueba que la cubre. La matriz vive como datos en `plataforma/backend/src/recepcion/contrato.spec.ts`
(constante `MATRIZ`, una sola fuente: la tabla de abajo se generó de ella) y un **guardián de cobertura** dentro de las mismas pruebas la compara con el código.

**De dónde salen las reglas.** (1) Lo que dice el proyecto: `docs/10` (filtros 2 a 4, tabla de casos del §4.1, §8.4 puntos 47, 51, 52, 53 y 54),
`docs/08` (cuarentena, catálogo de magnitudes y dominios cerrados), `docs/13` (reglas de tiempo 2, 7, 16, 17 y 18) y el README del backend. (2) Lo que
hace el código: `src/recepcion/` completo (servicio, `lectura.ts`, `tiempo.ts`, `unidades.ts`, `texto.ts`, `cuota.ts`, los cuatro adaptadores, los
perfiles y la vía HTTP) y la lista de motivos (`type Motivo` y `ck_cuarentena_motivo`, migraciones 07, 09 y 19). (3) La especificación: RFC 8428, copia
local descargada el 16/10/2026. Los ejemplos de trama de las pruebas que dicen seguir la RFC son **los ejemplos textuales de la propia RFC**, con su
sección en el comentario (§5.1.1 a §5.1.7); no se inventó ningún identificador.

**Cómo leer la columna «Prueba que la cubre».** `contrato.spec.ts · C-NN` es una prueba escrita para esta matriz (el identificador va al principio de su
nombre). Las demás citan una prueba que ya existía, con el comienzo de su título; el guardián abre el archivo y comprueba que ese texto sigue ahí.
«Esperado por la RFC; hoy …» marcaba una diferencia entre la fuente y el código que no se corregía y quedaba como `it.todo`; desde la decisión del 15/11/2026 (el contrato nativo es un perfil de SenML, `docs/10 §4`) no queda ninguna: cada diferencia se corrigió o se declara en los hallazgos.

### La matriz

**(a) Esquema SenML** (21 reglas)

| Id | Regla | Fuente | Resultado esperado | Prueba que la cubre |
|---|---|---|---|---|
| C-01 | Un registro con n, u y v produce una lectura; el nombre se pasa a minúsculas | RFC 8428 §4.2; senml.adaptador.ts | aceptada: {magnitud en minúsculas, valor, unidad} | `contrato.spec.ts` · C-01 |
| C-02 | bn no se antepone al nombre: n es el código de magnitud del catálogo y la magnitud es n tal cual (diferencia declarada, hallazgo H-3) | RFC 8428 §4.1 y §4.5.1 (ejemplo §5.1.2); senml.adaptador.ts, «(n ?? ctx.magnitudTopico).toLowerCase()» | aceptada: magnitud «voltage», no «urn:…:voltage» (la concatenación queda para el catálogo de alias) | `contrato.spec.ts` · C-02 |
| C-03 | bt se hereda a los registros siguientes y t es relativo a bt | RFC 8428 §4.5.3 (ejemplo §5.1.2) | aceptada: tiempo = bt + t | `contrato.spec.ts` · C-03<br>`adaptadores/adaptadores.spec.ts` · «hereda bn/bt/bu…» |
| C-04 | bu se hereda y la u del registro gana | RFC 8428 §4.1 y §4.5.2 (ejemplo §5.1.3) | aceptada: unidad del registro, si no la base | `contrato.spec.ts` · C-04 |
| C-05 | bt persiste aunque cambie bn; un bt posterior reemplaza al anterior | RFC 8428 §4 (ejemplo §5.1.6) | aceptada: cada registro con la base vigente | `contrato.spec.ts` · C-05 |
| C-06 | bver igual o menor que 10 (o ausente) se acepta | RFC 8428 §4.1 y §4.4 (ejemplo §5.1.2, bver 5) | aceptada | `contrato.spec.ts` · C-06 |
| C-07 | bver mayor que la versión que se entiende (10), o que no sea un entero positivo, se rechaza en cualquier registro del pack (hallazgo H-4) | RFC 8428 §4.1 (entero positivo) y §4.4: «MUST NOT use this object» | rechazada: malformada «bver 11 no se entiende…» o «bver no es un entero positivo» (corregido el 15/11/2026: antes se aceptaba) | `contrato.spec.ts` · C-07 |
| C-08 | Un campo que no se conoce se ignora | RFC 8428 §4.4: «MUST ignore fields they don't recognize» | aceptada: el campo no cambia la lectura | `contrato.spec.ts` · C-08 |
| C-09 | Un campo desconocido cuya etiqueta termina en «_» es un error, también en un registro sin valor (hallazgo H-5) | RFC 8428 §4.4: «in which case an error MUST be generated» | rechazada: malformada «campo … desconocido y de los que no se pueden ignorar» (corregido el 15/11/2026: antes se ignoraba) | `contrato.spec.ts` · C-09 |
| C-10 | v debe ser un número finito; cadena, nulo, booleano o desborde se rechazan | RFC 8428 §4.3 (tipo de v); senml.adaptador.ts, «typeof r.v !== 'number' || !Number.isFinite(r.v)» | rechazada: malformada «v no numérico» | `contrato.spec.ts` · C-10<br>`adaptadores/adaptadores.spec.ts` · «rechaza JSON inválido, pack vacío y valores no numéricos…» |
| C-11 | Los registros solo con vs, vb o vd se omiten: el sistema guarda solo valores numéricos | RFC 8428 §4.2 y §5.1.5; senml.adaptador.ts, «if (r.v === undefined) continue» | aceptada: solo la lectura numérica | `contrato.spec.ts` · C-11 |
| C-12 | Un registro con solo campos base (sin valor) no genera lectura | RFC 8428 §4 (ejemplo §5.1.7); senml.adaptador.ts, «if (r.v === undefined) continue» | aceptada: sin lectura para ese registro | `contrato.spec.ts` · C-12 |
| C-13 | Un pack sin ninguna lectura numérica se rechaza | RFC 8428 §4.2 (el valor es obligatorio salvo con s); senml.adaptador.ts, «throw new TramaMalformada('pack sin valores')» | rechazada: malformada «pack sin valores» | `contrato.spec.ts` · C-13 |
| C-14 | bv se suma al v de su registro y de los siguientes hasta el próximo bv; sin v no hay lectura; los valores no numéricos no lo reciben; un bv no numérico o una suma que desborda se rechazan (hallazgo H-6) | RFC 8428 §4.1 y §4.5.4: «added together to get the value» | aceptada: valor = bv + v (bv 10, v 5 → 15); rechazada: malformada «bv no numérico» o «bv + v fuera del rango numérico» (corregido el 15/11/2026: antes se ignoraba bv) | `contrato.spec.ts` · C-14 |
| C-15 | Un registro con más de un campo de valor (v, vs, vb, vd) se rechaza (hallazgo H-7) | RFC 8428 §4.2: «Exactly one Value field MUST appear» | rechazada: malformada «más de un campo de valor en un registro» (corregido el 15/11/2026: antes se aceptaba y valía v) | `contrato.spec.ts` · C-15 |
| C-16 | Un n que no es cadena se rechaza como trama malformada (hallazgo H-1) | RFC 8428 §4.3 (n es cadena); adaptadores/adaptador.ts:13 («Lanza Error si el contenido es inválido»); recepcion.service.ts:232 | rechazada, malformada «n no es texto» (corregido el 15/11/2026: antes lanzaba TypeError) | `contrato.spec.ts` · C-16 |
| C-17 | Un elemento del pack que no es objeto se rechaza | RFC 8428 §5; senml.adaptador.ts, «throw new TramaMalformada('registro no es objeto')» | rechazada: malformada «registro no es objeto» | `contrato.spec.ts` · C-17 |
| C-18 | El adaptador SenML reconoce solo arreglos JSON | RFC 8428 §5: «The root JSON value consists of an array» | reconoce: arreglo sí; objeto o número no | `adaptadores/adaptadores.spec.ts` · «reconoce un pack (arreglo JSON)…» |
| C-97 | De punta a punta, bv + v es el valor que se guarda (y el rango físico se evalúa sobre esa suma) | RFC 8428 §4.5.4; docs/10 §4 (filtros 2 y 3) | bv 10, v 5 en Cel: se guarda 15; bv 80, v 10: 90 Cel fuera del rango, a cuarentena invalida | `contrato.spec.ts` · C-97 |
| C-104 | bt, t, bu, n y u con un tipo equivocado (bt o t que no es un número finito; bu, n o u que no es texto) se rechazan, también en un registro sin valor | RFC 8428 §4.3, Tabla 1 (bt y t: número; bu: cadena); senml.adaptador.ts, revisarPerfil | rechazada: malformada «bt no numérico», «t no numérico» o «bu no es texto» (antes se ignoraban en silencio) | `contrato.spec.ts` · C-104 |
| C-105 | Todos los registros de un pack tienen la misma versión: un bver distinto del vigente se rechaza (un registro sin bver cuenta como 10 hasta que un bver explícito fije la versión) | RFC 8428 §4.4: «All SenML Records in a Pack MUST have the same version number» | rechazada: malformada «bver 5 distinto del 10 del resto del pack…»; un solo bver en el primer registro, o el mismo repetido, se acepta | `contrato.spec.ts` · C-105 |

**(b) Tiempo** (15 reglas)

| Id | Regla | Fuente | Resultado esperado | Prueba que la cubre |
|---|---|---|---|---|
| C-20 | Sin marca de tiempo rige la hora de recepción | docs/13 regla 7; RFC 8428 §4.5.3 (cero = «ahora») | aceptada: tiempo de recepción, origen_tiempo recepcion | `tiempo.spec.ts` · «sin marca → hora de recepción…»<br>`recepcion.service.spec.ts` · «sin marca del emisor → origen_tiempo "recepcion"…» |
| C-21 | Un tiempo relativo (bt + t menor que 2^28) se resuelve como dice la RFC: negativo es «ahora» menos esos segundos; cero o positivo (futuro relativo) rige la hora de recepción; desde 2^28 es absoluto (hallazgo H-8) | RFC 8428 §4.5.3; docs/13 reglas 7 y 19 | t = −5: la hora de recepción menos 5 s (origen dispositivo); t = 0, 10 o 268435455: recepción; un pasado relativo anterior al año 2000: recepción (corregido el 15/11/2026: antes se perdía el desfase) | `contrato.spec.ts` · C-21 |
| C-22 | Una marca absoluta plausible se respeta, también la antigua posterior al año 2000 (cola sin cobertura) | docs/13 regla 7 | aceptada: la marca del emisor, origen dispositivo | `tiempo.spec.ts` · «marca antigua pero posterior a 2000…»<br>`recepcion.service.spec.ts` · «marca del emisor plausible…» |
| C-23 | El umbral es el 1 de enero de 2000 UTC: anterior (incluido 1970) rige la recepción; esa fecha exacta se respeta | docs/13 regla 7; tiempo.ts:15 | 1999-12-31T23:59:59Z y 1970: recepción; 2000-01-01T00:00:00Z: la marca | `contrato.spec.ts` · C-23<br>`tiempo.spec.ts` · «marca anterior al año 2000…» |
| C-24 | Hasta 2 min de adelanto se respeta la marca; más, rige la recepción | docs/13 regla 7 | +120 s: la marca; +121 s o 2030: recepción | `tiempo.spec.ts` · «adelanto de hasta 2 minutos…»<br>`tiempo.spec.ts` · «más de 2 minutos en el futuro…» |
| C-25 | En milisegundos: SenML usa segundos, así que una marca en ms cae en un futuro lejano y rige la recepción; el formato plano acepta ms (más de 1e12) | RFC 8428 §4.5.3 (segundos); docs/13 fila «Filtro 4: … en milisegundos»; plano.adaptador.ts:38 | SenML en ms: recepción; plano en ms: la marca | `contrato.spec.ts` · C-25<br>`adaptadores/adaptadores.spec.ts` · «tiempo en segundos o milisegundos…» |
| C-26 | Una marca imposible (desborde) no lanza: rige la recepción | docs/13 regla 16 | aceptada: recepción | `contrato.spec.ts` · C-26<br>`tiempo.spec.ts` · «fecha inválida…» |
| C-27 | Marca de pasarela a más de 10 min atrás (o 2 adelante): rige la recepción y se abre reloj_desviado | docs/13 regla 18 | aceptada con tiempo de recepción; condición reloj_desviado | `tiempo.spec.ts` · «pasarela justo 10 min atrás…»<br>`tiempo.spec.ts` · «más de 2 min en el futuro…»<br>`recepcion.service.spec.ts` · «marca de pasarela 4 días atrasada…» |
| C-28 | Marca de pasarela dentro de 10 min se respeta; la de un dispositivo, aunque tenga días, también | docs/13 reglas 7 y 18 | aceptada con la marca; no abre reloj_desviado | `recepcion.service.spec.ts` · «marca de pasarela 9 min atrás…»<br>`recepcion.service.spec.ts` · «una marca de DISPOSITIVO 4 días atrás…» |
| C-29 | La hora de una trama LoRaWAN es RFC 3339 con zona; sin zona no se adivina | docs/13 regla 17; lorawan.ts:46-49 | con zona: marca de pasarela; sin zona: sin marca | `adaptadores/lorawan.spec.ts` · «una hora sin zona → sin marca…»<br>`adaptadores/lorawan.spec.ts` · «time sin zona → sin marca…» |
| C-30 | origen_tiempo dice quién puso la marca: dispositivo, pasarela o recepcion | docs/10 §8.4 punto 12; docs/13 regla 7 | columna origen_tiempo según el adaptador y la plausibilidad | `recepcion.service.spec.ts` · «marca del emisor plausible…»<br>`recepcion.service.spec.ts` · «sin marca del emisor → origen_tiempo "recepcion"…» |
| C-31 | La misma lectura (canal más instante del emisor) dos veces cuenta una sola | docs/10 §4.1 (RF-10); recepcion.service.ts:324 | duplicada: sin evento nuevo ni umbral | `recepcion.service.spec.ts` · «TT-39: lectura repetida…» |
| C-98 | De punta a punta, un tiempo relativo negativo se guarda como la hora de recepción menos esos segundos (origen dispositivo); uno cero o positivo, con la hora de recepción | RFC 8428 §4.5.3; docs/13 reglas 7 y 19 | t = −30: marca del emisor ≈ ahora − 30 s; t = 0: origen_tiempo recepcion (sin marca guardada) | `contrato.spec.ts` · C-98 |
| C-102 | El «ahora» de los tiempos relativos es uno solo por trama: todos los registros de un pack comparten el mismo instante cuando falta recibidoEn | RFC 8428 §4.5.3 («relative to the current time»); senml.adaptador.ts, «const ahora» | tres registros con t = −10: tres marcas iguales y una sola lectura del reloj | `contrato.spec.ts` · C-102 |
| C-103 | La hora de recepción que llega a la lectura es la que la vía tomó al entrar la trama, por MQTT y por HTTP, aunque la base tarde en responder | docs/10 §4 (filtro 2); recepcion.service.ts, procesar y procesarHttp | recibidoEn del adaptador y recibido_en de la medición son el instante de entrada; t = −5 se guarda como ese instante menos 5 s | `contrato.spec.ts` · C-103 |

**(c) Unidades y magnitudes** (10 reglas)

| Id | Regla | Fuente | Resultado esperado | Prueba que la cubre |
|---|---|---|---|---|
| C-32 | La unidad canónica o la ausencia de unidad deja el valor tal cual | lectura.ts: «si falta, se asume la canónica»; unidades.ts | aceptada: mismo valor | `unidades.spec.ts` · «misma unidad o sin unidad…» |
| C-33 | Alias convertibles: K, °F y F a Cel; Pa, kPa y bar a hPa; % a %RH o %EL; mV a V | unidades.ts; docs/10 §8.4 punto 51; RFC 8798 §3 | aceptada: valor en la unidad canónica | `unidades.spec.ts` · «Kelvin y Fahrenheit…»<br>`unidades.spec.ts` · «presión: Pa, kPa y bar…»<br>`unidades.spec.ts` · «porcentaje genérico…»<br>`unidades.spec.ts` · «mV (unidad secundaria…»<br>`contrato.spec.ts` · C-33 |
| C-34 | Una unidad que no se sabe convertir se rechaza | unidades.ts: «mejor rechazar que adivinar»; docs/10 filtro 3 | rechazada: invalida «unidad X no convertible a Y» | `recepcion.service.spec.ts` · «filtro 3: unidad no convertible…» |
| C-35 | No existe la conversión inversa ni entre magnitudes distintas | unidades.ts | sin conversión: la lectura se rechaza como en C-34 | `unidades.spec.ts` · «pareja desconocida…»<br>`unidades.spec.ts` · «V a mV no se inventa…» |
| C-36 | Una magnitud sin canal declarado se rechaza | docs/10 filtro 3; recepcion.service.ts:301 | rechazada: invalida «canal no declarado» | `recepcion.service.spec.ts` · «filtro 3: canal no declarado…» |
| C-37 | El rango físico se evalúa sobre el valor ya convertido y sus límites son inclusivos | docs/08 (magnitud.rango_min y rango_max); recepcion.service.ts:309 | 85 °C se guarda; 85,01 °C y 360 K se rechazan: invalida «fuera del rango físico» | `contrato.spec.ts` · C-37<br>`recepcion.service.spec.ts` · «filtro 3: valor fuera del rango físico…» |
| C-38 | Cada clave del mapa de claves apunta a una magnitud del catálogo con su unidad canónica | docs/10 §8.4 punto 47; mapa-claves.ts | ninguna clave apunta a una magnitud inexistente | `adaptadores/lorawan.spec.ts` · «cada clave del mapa → una magnitud del catálogo…» |
| C-39 | Todo destino de una conversión es una unidad canónica del catálogo | unidades.ts; docs/08 (magnitud.unidad_canonica) | ninguna conversión desemboca en una unidad que ninguna magnitud usa | `contrato.spec.ts` · C-39 |
| C-100 | Un valor finito que deja de serlo al convertirse a la unidad canónica (1e306 bar son 1e309 hPa) se rechaza aunque el canal no tenga rango máximo | docs/10 §4.1 (la lectura imposible no se guarda); recepcion.service.ts, «Number.isFinite(convertido)» | rechazada: invalida «no cabe en un número finito al convertirlo a hPa»; lo que cabe (1e305 bar) se guarda | `contrato.spec.ts` · C-100 |
| C-101 | Un -0 (en v, en bv o como resultado de una conversión) se guarda como 0 | RFC 8428 §4.3 (v es un número JSON; la copia local de la RFC no dice nada del cero negativo); docs/10 §4.1; recepcion.service.ts, «convertido === 0 ? 0 : convertido» | aceptada: se guarda 0, nunca -0 | `contrato.spec.ts` · C-101 |

**(d) Tamaño y forma del sobre** (11 reglas)

| Id | Regla | Fuente | Resultado esperado | Prueba que la cubre |
|---|---|---|---|---|
| C-40 | Un cuerpo vacío no lo reconoce ningún formato | docs/10 §4.1 (tabla de casos); recepcion.service.ts:223 | rechazada: malformada «la trama no tiene esa forma»; el dispositivo se marca vivo | `recepcion.service.spec.ts` · «cuerpo vacío → ningún adaptador lo reconoce…» |
| C-41 | Un JSON ilegible se rechaza | RFC 8428 §5; senml.adaptador.ts, «throw new TramaMalformada('JSON inválido')» | rechazada: malformada «JSON inválido» | `contrato.spec.ts` · C-41<br>`adaptadores/adaptadores.spec.ts` · «rechaza JSON inválido, pack vacío y valores no numéricos…» |
| C-42 | Si el formato declarado es SenML y el cuerpo no es una lista, se rechaza | RFC 8428 §5; docs/10 §8.4 punto 47 | rechazada: malformada «formato declarado senml: la trama no tiene esa forma» | `contrato.spec.ts` · C-42<br>`recepcion.service.spec.ts` · «plano a un dispositivo que declaró senml…» |
| C-43 | Una lista vacía se rechaza | RFC 8428 §5; senml.adaptador.ts, «throw new TramaMalformada('pack SenML vacío')» | rechazada: malformada «pack SenML vacío» | `contrato.spec.ts` · C-43<br>`adaptadores/adaptadores.spec.ts` · «rechaza JSON inválido, pack vacío y valores no numéricos…» |
| C-44 | No hay un máximo de registros por pack: lo acota el presupuesto de lecturas por hora, y lo que no cabe se rechaza entero | docs/10 §8.4 punto 53 | rechazada entera: cuarentena «tope» | `recepcion.service.spec.ts` · «la trama que no cabe en el presupuesto…»<br>`recepcion.service.spec.ts` · «el presupuesto sale del dispositivo…» |
| C-45 | Una trama de más de 64 KiB no entra: el broker la corta (max_packet_size) y la vía HTTP responde 413 | docs/10 §8.4 puntos 19 (b) y 52; mosquitto.conf; main.ts:41 | MQTT: el broker no entrega; HTTP: 413 | `contrato.spec.ts` · C-45 |
| C-46 | El texto de afuera (claves, DevEUI, segmentos del tópico) va recortado y sin caracteres invisibles al detalle y al registro | texto.ts; lorawan.ts:15 | detalle de cuarentena con «?» en lugar de los controles y recorte por caracteres | `adaptadores/lorawan.spec.ts` · «una clave larga o con saltos de línea…»<br>`adaptadores/lorawan.spec.ts` · «los espacios invisibles y los rellenos…»<br>`recepcion.service.spec.ts` · «los segmentos del tópico se limpian…» |
| C-47 | Por HTTP, un tipo de contenido que no es JSON ni texto se rechaza antes del token | docs/10 §8.4 punto 52; recepcion-http.controller.ts:19 | HTTP 415 | `http/recepcion-http.controller.spec.ts` · «el tipo de contenido se revisa antes que el token…» |
| C-48 | Por HTTP, una trama malformada o sin lectura útil responde 422; si solo trae lecturas repetidas, 202 | docs/10 §8.4 punto 52; recepcion-http.controller.ts:112 | HTTP 422 con el detalle, o 202 | `http/recepcion-http.controller.spec.ts` · «malformada o sin ninguna lectura útil…» |
| C-49 | El formato plano reconoce un número solo con la forma estricta -?dígitos[.dígitos] | plano.adaptador.ts:18 y :24 | «21.5» y «-3» sí; «1e3», «+5», «.5» y «0x10» no | `contrato.spec.ts` · C-49<br>`adaptadores/adaptadores.spec.ts` · «reconoce un número o un objeto…» |
| C-94 | El nombre y la unidad de un registro SenML (texto del emisor) van recortados y sin caracteres de control al detalle de la cuarentena y al registro (hallazgo H-9) | texto.ts:1-4 («va al detalle de una cuarentena o al registro: recortado … sin nada invisible»); recepcion.service.ts:301 y :306 | nombre de hasta 40 caracteres y unidad de hasta 32, sin caracteres de control (corregido el 15/11/2026: antes llegaban crudos) | `contrato.spec.ts` · C-94 |

**(e) Identidad y tópico** (15 reglas)

| Id | Regla | Fuente | Resultado esperado | Prueba que la cubre |
|---|---|---|---|---|
| C-50 | Un tópico fuera de los dos patrones se rechaza antes del filtro 1 | docs/10 §4.1; recepcion.service.ts:120 | rechazada: malformada; nadie se marca vivo | `recepcion.service.spec.ts` · «tópico fuera del patrón…»<br>`recepcion.service.spec.ts` · «una forma a medias…» |
| C-51 | Un identificador sin alta se rechaza | docs/10 §4 filtro 1; docs/06 §3.2 | rechazada: no_registrado; no se marca vivo | `recepcion.service.spec.ts` · «dispositivo no registrado…»<br>`contrato.spec.ts` · C-65 |
| C-52 | Un dispositivo dado de baja se rechaza, atribuido a él | docs/10 §4.1; docs/06 §3.2 | rechazada: dado_de_baja; no se marca vivo | `recepcion.service.spec.ts` · «dispositivo dado de baja…»<br>`recepcion.service.spec.ts` · «no registrado → sin dispositivo_id; dado de baja…» |
| C-53 | El sitio del tópico debe ser el del alta | docs/10 §8.4 punto 24 | rechazada: no_registrado «registrado en el sitio X, no en Y» | `recepcion.service.spec.ts` · «filtro 1: tópico con el sitio de otra sede…» |
| C-54 | La identidad sale del tópico y la credencial, no del cuerpo: un bn de otro dispositivo no cambia a quién se atribuye (hallazgo H-2) | docs/10 §4 (perfil de SenML: «No identifica `bn`») y filtro 1 (el tópico y la credencial); docs/06 §3 («La identidad no viene dentro de la trama»); recepcion.service.ts, la consulta del filtro 1 recibe el identificador del tópico | aceptada y atribuida al dispositivo del tópico; ninguna consulta recibe el bn | `contrato.spec.ts` · C-54 |
| C-55 | El nombre del registro gana; si falta, rige la magnitud del tópico | senml.adaptador.ts, «(n ?? ctx.magnitudTopico).toLowerCase()»; README del backend | magnitud del registro; sin n, la del tópico | `contrato.spec.ts` · C-55<br>`adaptadores/adaptadores.spec.ts` · «sin nombre en el registro, la magnitud sale del tópico…» |
| C-56 | La magnitud del tópico se pasa a minúsculas | recepcion.service.ts:127 | una trama en «…/Temperatura» usa el canal «temperatura» | `contrato.spec.ts` · C-56 |
| C-57 | Una pasarela sin alta, inactiva o de otro sitio se rechaza, con cualquier evento | docs/10 §8.4 punto 47 | rechazada: no_registrado; nadie se marca vivo | `recepcion.service.spec.ts` · «pasarela sin alta, inactiva o de otro sitio…» |
| C-58 | El DevEUI del tópico, en minúsculas, debe ser un nodo asociado a esa pasarela | docs/10 §8.4 punto 47 | sin asociación: no_registrado | `recepcion.service.spec.ts` · «DevEUI no asociado a esa pasarela…»<br>`recepcion.service.spec.ts` · «el DevEUI del tópico se busca en minúsculas…» |
| C-59 | El DevEUI del cuerpo debe ser el del tópico | docs/10 §4.1 y §8.4 punto 47 | rechazada: malformada; el nodo no se marca vivo | `recepcion.service.spec.ts` · «DevEUI del cuerpo distinto del tópico…»<br>`adaptadores/lorawan.spec.ts` · «DevEUI del cuerpo distinto del tópico…» |
| C-60 | Un evento de pasarela que no es «up» se anota y termina | docs/10 §8.4 punto 47 y la tabla de casos del §4.1 | sin cuarentena ni escritura en la base | `recepcion.service.spec.ts` · «un evento distinto de «up» (join)…» |
| C-61 | El formato lo fija el alta y no se adivina; uno de pasarela solo entra por el tópico de pasarela y uno directo, por el suyo | docs/10 §8.4 punto 47 | rechazada: malformada «no se recibe por este tópico» o «la trama no tiene esa forma» | `recepcion.service.spec.ts` · «SenML a un dispositivo que declaró plano…»<br>`recepcion.service.spec.ts` · «un formato de pasarela por el tópico de un dispositivo directo…»<br>`recepcion.service.spec.ts` · «un formato directo por el tópico de pasarela…» |
| C-62 | La forma nativa device/<deveui>/event/up es equivalente a <deveui>/up | docs/10 §4.1 (tabla de casos); recepcion.service.ts:28 | mismo filtro 1 y misma lectura | `recepcion.service.spec.ts` · «sufijo nativo device/<deveui>/event/up…» |
| C-63 | Un DevEUI con caracteres que no son letras ASCII, dígitos ni guion no identifica al nodo | docs/10 §4.1 (tabla de casos); lorawan.ts:33 | rechazada: malformada (IdentidadNoVerificada); el nodo no se marca vivo | `adaptadores/lorawan.spec.ts` · «un DevEUI del cuerpo con controles…» |
| C-64 | Por HTTP, el identificador y el token deben tener su forma antes de consultar la base | docs/10 §8.4 punto 52 | HTTP 401 sin consultar la base y sin contar para los bloqueos | `http/recepcion-http.controller.spec.ts` · «token ausente, con otra forma o un id imposible…»<br>`http/recepcion-http.controller.spec.ts` · «un token sin forma o un id imposible dan 401…» |

**(f) Cuarentena** (13 reglas)

| Id | Regla | Fuente | Resultado esperado | Prueba que la cubre |
|---|---|---|---|---|
| C-65 | no_registrado: identificador, pasarela, nodo o sitio sin alta | docs/08 §2 (cuarentena); migración 19 (ck_cuarentena_motivo) | fila de cuarentena con motivo no_registrado y detalle | `contrato.spec.ts` · C-65 |
| C-66 | dado_de_baja: dispositivo dado de baja que sigue publicando (credencial viva) | docs/08 §2 (cuarentena); docs/10 §4.1 | fila de cuarentena con motivo dado_de_baja y la pista de revocar la credencial | `contrato.spec.ts` · C-66 |
| C-67 | malformada: el adaptador del formato declarado no entiende la trama (o el tópico no calza) | docs/08 §2 (cuarentena); docs/10 filtro 2 | fila de cuarentena con motivo malformada; el dispositivo autenticado se marca vivo | `contrato.spec.ts` · C-67 |
| C-68 | invalida: la lectura no pasa el filtro 3 (canal, unidad o rango) | docs/08 §2 (cuarentena); docs/10 filtro 3 | fila de cuarentena con motivo invalida; las lecturas buenas de la misma trama se guardan | `contrato.spec.ts` · C-68 |
| C-69 | tope: la trama no cabe en el presupuesto de lecturas de la hora | docs/10 §8.4 punto 53; migración 19 | fila de cuarentena con motivo tope; la trama se rechaza entera | `contrato.spec.ts` · C-69 |
| C-70 | La lista de motivos del código es el dominio cerrado del CHECK de la base | docs/08 §6 (dominios cerrados); migración 19 | el tipo Motivo y ck_cuarentena_motivo (última migración) tienen los mismos valores | `contrato.spec.ts` · C-70 |
| C-71 | Una trama con varias lecturas malas deja una sola fila, con todos los porqués | recepcion.service.ts:293 | una fila invalida con los motivos separados por «; » | `recepcion.service.spec.ts` · «dos lecturas inválidas en una trama…» |
| C-72 | Una lectura buena y una mala de la misma trama: la buena se guarda y la mala va a cuarentena | recepcion.service.ts:293 | una medición, una fila invalida y la trama cruda | `recepcion.service.spec.ts` · «una lectura buena y una mala…» |
| C-73 | Con la cuota de cuarentena de la hora llena, la trama rechazada solo se cuenta | docs/10 §8.4 punto 53 (iii) | ninguna fila nueva; se suma a omitidas | `recepcion.service.spec.ts` · «cuota de cuarentena: con la cuota de la hora llena…»<br>`recepcion.service.spec.ts` · «lo que el filtro 1 rechaza tiene cuota en memoria…» |
| C-74 | Una trama LoRaWAN que repite el fCnt de la última guardada se descarta sin cuarentena | docs/10 §4.1 | sin lecturas ni fila de cuarentena; el nodo se marca vivo | `recepcion.service.spec.ts` · «el mismo fCnt que la última trama guardada…» |
| C-75 | Un rechazo del filtro 2 o 3 marca vivo al dispositivo autenticado; uno del filtro 1 o sin identidad verificada, no | docs/10 §4 y §4.1 | visto_por_ultima_vez solo para quien pasó el filtro 1 | `recepcion.service.spec.ts` · «trama malformada de un dispositivo conocido…»<br>`recepcion.service.spec.ts` · «cuerpo sin DevEUI, JSON roto o sin la forma…» |
| C-76 | La cuarentena guarda la trama cruda y atribuye el dispositivo cuando se sabe cuál es | docs/08 §4 (decisión de cuarentena) | payload_crudo y dispositivo_id (nulo si no hay alta) | `recepcion.service.spec.ts` · «no registrado → sin dispositivo_id…» |
| C-96 | Cada regla estricta del perfil SenML termina en cuarentena malformada con su motivo, sin lecturas, y el mensaje se confirma | docs/10 §4.1 (la trama que no calza con el formato declarado); recepcion.service.ts, el catch del filtro 2 | una fila malformada «formato declarado senml: <motivo>» por trama; el dispositivo se marca vivo; el procesamiento termina sin lanzar (el broker confirma) | `contrato.spec.ts` · C-96 |

**(g) Adaptadores** (19 reglas)

| Id | Regla | Fuente | Resultado esperado | Prueba que la cubre |
|---|---|---|---|---|
| C-77 | SenML: un pack válido con varios registros produce varias lecturas | RFC 8428 §5; senml.adaptador.ts | una lectura por registro con valor | `adaptadores/adaptadores.spec.ts` · «hereda bn/bt/bu y produce varias lecturas…»<br>`contrato.spec.ts` · C-02 |
| C-78 | SenML: un pack malformado se rechaza | RFC 8428 §5; senml.adaptador.ts | rechazada: malformada | `adaptadores/adaptadores.spec.ts` · «rechaza JSON inválido, pack vacío y valores no numéricos…»<br>`contrato.spec.ts` · C-17 |
| C-79 | Plano: un número solo (magnitud del tópico) o un objeto con v, u, t | plano.adaptador.ts | una lectura | `adaptadores/adaptadores.spec.ts` · «número a secas → una lectura…»<br>`adaptadores/adaptadores.spec.ts` · «objeto con nombres tolerantes…» |
| C-80 | Plano: cada sinónimo (valor, v, value; unidad, u, unit; tiempo, t, ts, time) se reconoce, y el primero de la lista gana | plano.adaptador.ts:34-38 | la misma lectura con cualquiera de los nombres | `contrato.spec.ts` · C-80 |
| C-81 | Plano: sin valor numérico o con JSON ilegible se rechaza | plano.adaptador.ts:32-35 | rechazada: malformada | `adaptadores/adaptadores.spec.ts` · «sin valor numérico → malformada…»<br>`contrato.spec.ts` · C-81 |
| C-95 | Plano: un número a secas que no cabe en un número finito (más de 308 cifras) se rechaza | docs/10 §4.1 (la trama que no calza va a cuarentena malformada); plano.adaptador.ts, «function finito» | rechazada: malformada «valor fuera del rango numérico» (corregido el 15/11/2026: antes se guardaba Infinity) | `contrato.spec.ts` · C-95 |
| C-82 | ChirpStack: un evento up con object produce lecturas con la unidad canónica del mapa y la marca del servidor de red | docs/10 §8.4 punto 47; chirpstack.adaptador.ts | lecturas con tiempo RFC 3339 | `adaptadores/lorawan.spec.ts` · «lecturas desde object, con la marca del servidor de red…» |
| C-83 | ChirpStack: sin deviceInfo no hay identidad; sin object ni perfil se rechaza diciendo qué falta | chirpstack.adaptador.ts:33-39 | rechazada: IdentidadNoVerificada, o malformada con la instrucción | `contrato.spec.ts` · C-83<br>`adaptadores/lorawan.spec.ts` · «sin object (el perfil no tiene decodificador)…» |
| C-84 | ChirpStack: hereda devEui (verificado contra el tópico), time (origen pasarela) y fCnt (deduplicación) | docs/10 §4.1 y §8.4 punto 47 | ctx.fcnt anotado; origen_tiempo pasarela | `adaptadores/lorawan.spec.ts` · «ChirpStack sin object y con perfil…»<br>`contrato.spec.ts` · C-84 |
| C-85 | Milesight: con códec y Metadata, las claves decodificadas pasan por el mapa; los metadatos no son claves ignoradas | docs/10 §8.4 punto 47; milesight.adaptador.ts | lecturas sin marca de tiempo (rige la recepción) | `adaptadores/lorawan.spec.ts` · «lecturas de los valores decodificados…» |
| C-86 | Milesight: sin códec ni perfil, o sin Metadata, se rechaza diciendo qué activar | milesight.adaptador.ts:34-38 | rechazada: malformada con la instrucción | `adaptadores/lorawan.spec.ts` · «sin códec (data en base64…»<br>`adaptadores/lorawan.spec.ts` · «con códec pero sin Metadata…» |
| C-87 | Milesight: hereda fCnt cuando el decodificador lo deja | milesight.adaptador.ts:16-18 | ctx.fcnt anotado; no cuenta como clave ignorada | `adaptadores/lorawan.spec.ts` · «con códec: si la trama trae fCnt…» |
| C-88 | Perfil campus-heltec-v3-v1: 10 bytes de la trama sin códec → temperatura, humedad y tensión | docs/10 §8.4 punto 47; perfiles.ts | 18,16 °C, 65,52 %RH y 3,75 V con la marca del servidor de red | `adaptadores/lorawan.spec.ts` · «la captura con perfil…» |
| C-89 | Perfil: data que no es base64 estricto, que no mide 10 bytes o de un perfil desconocido se rechaza | perfiles.ts:21 y :39 | rechazada: malformada | `adaptadores/lorawan.spec.ts` · «data que no es base64 estricto o no mide 10 bytes…»<br>`adaptadores/lorawan.spec.ts` · «un perfil que el código no conoce…» |
| C-90 | La lista de perfiles del código es la del CHECK de la base y sus lecturas existen en el catálogo | docs/10 §8.4 punto 47; migración 17 | PERFILES igual al dominio de ck_dispositivo_decodificador | `adaptadores/lorawan.spec.ts` · «PERFILES == el dominio de ck_dispositivo_decodificador…» |
| C-91 | Mapa de claves: una clave desconocida se ignora y se anota; si no queda ninguna conocida, se rechaza | docs/10 §8.4 punto 47; lorawan.ts:60-85 | ctx.ignoradas con las claves; sin ninguna conocida: malformada | `adaptadores/lorawan.spec.ts` · «una clave que no está en el mapa se ignora…»<br>`adaptadores/lorawan.spec.ts` · «resuelve sin distinguir mayúsculas…» |
| C-92 | Mapa de claves: dos claves de la misma magnitud valen la primera; la otra se anota como repetida | lorawan.ts:77 | una lectura; la segunda en ignoradas con «(repetida)» | `adaptadores/lorawan.spec.ts` · «dos claves que apuntan a la misma magnitud…» |
| C-93 | Los adaptadores registrados son los de los formatos que admite la base (ck_dispositivo_formato) y el módulo | docs/10 §8.4 punto 47; migración 15; recepcion.module.ts | senml, plano, chirpstack y milesight en el servicio, el módulo, los archivos y el CHECK | `contrato.spec.ts` · C-93 |
| C-99 | Las reglas del perfil (bver, «_», un solo valor, bv, tiempo relativo) son de SenML: plano y los de pasarela no las aplican | docs/10 §4 (filtro 2); plano.adaptador.ts y chirpstack.adaptador.ts | aceptadas: un objeto plano o un evento de ChirpStack con esos nombres de campo se leen como antes | `contrato.spec.ts` · C-99 |

### Qué pruebas son nuevas y cómo están hechas

En `plataforma/backend/src/recepcion/contrato.spec.ts`: **39 pruebas nuevas** (una por regla que no tenía prueba o la tenía incompleta, con su C-NN en el
nombre) y **4 pruebas pendientes** (`it.todo`, una por diferencia con la RFC que es decisión de diseño). Llaman a las mismas funciones que la recepción
real: los adaptadores, `tiempoPlausible`, `aCanonica` y, para todo lo que pasa por la tubería (cuarentena, rango, atribución), a `RecepcionService.procesar`
con la base simulada. Cada prueba es un `it(` propio, no `it.each`: el paso 2t del guardián cuenta los `it(` y compara con la cifra citada en los documentos.
Las reglas que ya tenían prueba (50 de las 93) no se duplicaron: la matriz las cita.

| Grupo | Reglas | Con prueba nueva propia | Pendientes (`it.todo`) | Solo con pruebas anteriores |
|---|---|---|---|---|
| (a) Esquema SenML | 18 | 13 | 4 | 1 |
| (b) Tiempo | 12 | 4 | 0 | 8 |
| (c) Unidades y magnitudes | 8 | 3 | 0 | 5 |
| (d) Tamaño y forma del sobre | 11 | 5 | 0 | 6 |
| (e) Identidad y tópico | 15 | 3 | 0 | 12 |
| (f) Cuarentena | 12 | 6 | 0 | 6 |
| (g) Adaptadores | 17 | 5 | 0 | 12 |
| **Total** | **93** | **39** | **4** | **50** |

**El guardián de cobertura** (cinco pruebas al final del archivo) falla si: un identificador se repite, falta un grupo o una fila no trae fuente, resultado o
prueba; una prueba citada ya no existe (se abre el archivo y se busca el texto citado); una prueba `C-NN` del archivo no tiene fila; **algún motivo de
cuarentena** (leído del `type Motivo` del servicio y del CHECK de la última migración) no tiene un caso del grupo (f), o una fila nombra un motivo que el
código no tiene; **algún adaptador registrado** (las claves del registro del servicio) no tiene en el grupo (g) un caso válido y uno malformado. Además, `C-70`
compara el tipo `Motivo` con el CHECK y `C-93` compara los adaptadores registrados con el CHECK `ck_dispositivo_formato`, el módulo y los archivos de `adaptadores/`.

### Fallas plantadas

Para cada grupo se introdujo un defecto en el código de la recepción, se corrió `contrato.spec.ts` y se quitó el defecto (después de cada una, el código
de `src/recepcion/` volvió a como estaba). Para el guardián se alteró la propia matriz.

| Grupo | Defecto plantado | Prueba que se puso en roja |
|---|---|---|
| (a) | `senml.adaptador.ts`: se quita la herencia de `bu` | C-04 |
| (a) | `senml.adaptador.ts`: la lista vacía deja de rechazarse | C-67 (por el servicio) y, desde la revisión del 15/11/2026, C-43; la prueba de `adaptadores.spec.ts` citada antes para C-43 no lo detecta (con la lista vacía el adaptador cae en «pack sin valores», que también es malformada) |
| (a) | `senml.adaptador.ts`: `v` deja de exigirse numérico | C-10 |
| (b) | `tiempo.ts`: el umbral pasa del año 2000 al 2001 | C-23 |
| (b) | `tiempo.ts`: la tolerancia de adelanto pasa de 2 a 20 min | ninguna de `contrato.spec.ts`; sí dos de `tiempo.spec.ts` (el límite de 2 min lo cubre esa) |
| (c) | `unidades.ts`: K a Cel resta 273 en vez de 273,15 | C-33 y C-37 |
| (c) | `recepcion.service.ts`: el límite máximo del rango pasa a exclusivo | C-37 |
| (d) | `plano.adaptador.ts`: acepta «+5» como número | C-49 |
| (e) | `recepcion.service.ts`: la magnitud del tópico deja de pasarse a minúsculas | C-56 |
| (e) | `recepcion.service.ts`: se anula la comprobación del sitio del tópico | C-65 |
| (f) | `recepcion.service.ts`: la baja se registra como `malformada` | C-66 |
| (f) | `recepcion.service.ts`: se agrega un motivo (`sitio_ajeno`) al tipo, sin migración ni caso | C-70 y el guardián de motivos |
| (g) | `plano.adaptador.ts`: se quita el sinónimo `ts` | C-80 y C-25 |
| guardián | se quita el caso del motivo `tope` de la matriz | «cada motivo … tiene al menos un caso» |
| guardián | se renombra la prueba C-66 | «cada regla cita pruebas que existen» |
| guardián | el adaptador `milesight` pierde su caso malformado | «cada adaptador registrado …» |
| guardián | `plano` pierde su caso válido | «cada adaptador registrado …» |
| guardián | se agrega un archivo `*.adaptador.ts` sin registrar | C-93 |
| guardián | se cambia el título citado de una prueba de `unidades.spec.ts` | «cada regla cita pruebas que existen» |

### Hallazgos (dos defectos se corrigieron el mismo día; los demás son una decisión de diseño)

| Id | Severidad | Qué | Evidencia de cada lado |
|---|---|---|---|
| H-1 | Alta; **corregido el 15/11/2026** (`n` y `u` deben ser cadenas: `TramaMalformada`; prueba C-16) | Un registro SenML con `n` que no es cadena (`[{"n":5,"v":1}]`) **lanza `TypeError`**, no `TramaMalformada`: no va a cuarentena; el servicio lo relanza y el broker reintenta cuatro veces, no confirma y se reconecta, y, según el comentario de `broker.service.ts:69-71`, el broker lo reenvía al volver (no se probó con un broker real) | Código (antes de la corrección): `senml.adaptador.ts`, «(r.n ?? ctx.magnitudTopico).toLowerCase()»; `recepcion.service.ts:232` (`if (!(e instanceof TramaMalformada)) throw e`), `broker.service.ts:91-94`. Documentos: `adaptadores/adaptador.ts:13` («Lanza Error si el contenido es inválido»), `docs/10 §4.1`: la trama que no calza con el formato va a cuarentena `malformada`. Verificado con el adaptador (`n` número y `n` objeto) |
| H-2 | Media; **declarado el 15/11/2026** (`bn` no identifica y se ignora: la identidad es el tópico y la credencial; `docs/06 §3` corregido, `docs/10 §4` lo declara; prueba C-54) | La identidad **no** viene en la trama: el código nunca lee `bn`; el nodo es el del tópico y la credencial. Un `bn` de otro dispositivo se acepta y se atribuye al del tópico | Código: `senml.adaptador.ts`, «bn?: string» (`bn` solo está en el tipo) y «los campos base (bn, bt, bu) se heredan» (el comentario dice que `bn` se hereda; el código solo hereda `bt` y `bu`). Documentos: `docs/06 §3.1` («La identificación viene dentro de la trama y se cruza con el registro») y §3.2 («el mensaje trae la identidad (`bn`)… La plataforma valida contra el registro»); `docs/02`, RF-15, habla de `bn` / `id_fisico`. `docs/10` filtro 1 y la ACL dicen lo contrario: la identidad es el tópico. Prueba: C-54 |
| H-3 | Media; **declarado el 15/11/2026** (`n` es el código de magnitud del catálogo; `docs/10 §4`); la concatenación `bn` + `n` **sigue pendiente**, para el catálogo de alias | `bn` no se antepone al nombre y `n` debe ser el código del catálogo: el pack textual de la RFC §5.1.1 (`n` = URN) acaba en cuarentena `invalida` «canal no declarado». El proyecto es un perfil de SenML y ningún documento lo declara | RFC 8428 §4.1 («prepended to the names») y §4.5.1. Código: `senml.adaptador.ts`, «(n ?? ctx.magnitudTopico).toLowerCase()». Documentos: no declarado (revisado: `docs/06`, `docs/10`, `docs/17`, README del backend, `RESUMEN.md`). Prueba: C-02 |
| H-4 | Media; **corregido el 15/11/2026** (prueba C-07, que dejó de ser `it.todo`) | `bver` mayor que 10 no se rechazaba | RFC 8428 §4.4: «the system MUST NOT use this object». Código: `senml.adaptador.ts` no lee `bver`. Prueba: C-07 (era `it.todo`) |
| H-5 | Baja; **corregido el 15/11/2026** (prueba C-09) | Un campo desconocido con etiqueta terminada en `_` se ignoraba | RFC 8428 §4.4: «in which case an error MUST be generated». Prueba: C-09 (era `it.todo`) |
| H-6 | Media; **corregido el 15/11/2026** (se suma a `v`; pruebas C-14 y C-97) | `bv` (valor base) se ignoraba: `[{"bv":10,"n":"temperatura","v":5}]` guarda 5, no 15. Es un dato distinto del que dice la RFC, sin aviso | RFC 8428 §4.5.4: «added together to get the value of the measurement». Código: `senml.adaptador.ts`, el bucle «for (const r of pack as RegistroSenML[])» no lee `bv`. Documentos: no declarado (revisado: `docs/02`, `docs/06`, `docs/10`, README del backend). Prueba: C-14 (era `it.todo`) |
| H-7 | Baja; **corregido el 15/11/2026** (más de un campo de valor es malformada; prueba C-15) | Un registro con `v` y `vs` se aceptaba y valía `v` | RFC 8428 §4.2: «Exactly one Value field MUST appear». Prueba: C-15 (era `it.todo`) |
| H-8 | Baja; **corregido el 15/11/2026** (`docs/13` regla 19; pruebas C-21 y C-98) | Un tiempo relativo (`t` negativo sin `bt`, o menor que 2^28) se trata como «ahora» y se pierde el desfase: una serie `t:-5 … t:-1` queda con la misma hora de recepción | RFC 8428 §4.5.3 («A negative value indicates seconds in the past from roughly "now"»). Código: `senml.adaptador.ts`, «tiempo = seg > 0 ? new Date(seg * 1000) : undefined». Documentos: `docs/13` regla 7 no menciona tiempos relativos. Prueba: C-21 |
| H-9 | Media; **corregido el 15/11/2026** (el adaptador recorta el nombre a 40 y la unidad a 32 y quita los caracteres de control; prueba C-94) | El nombre y la unidad de un registro SenML llegan **crudos** al detalle de la cuarentena y al registro: un salto de línea en `n` o `u` parte la línea WARN y no hay tope de largo | Código: `recepcion.service.ts:301` y `:306` (`${l.magnitud}`, `${l.unidad}`) hacia `:486-502`. Documentos: `texto.ts:1-4` dice que el texto de afuera que va al detalle o al registro se recorta y se limpia. Los adaptadores LoRaWAN sí lo hacen (`lorawan.ts`); el de SenML no. Verificado con la recepción real. Prueba: C-94 |
| H-10 | Baja | `docs/13` (§7) decía que los casos de marca de tiempo estaban en «casos manuales del README del backend»; el README no los trae (solo menciona una regla como ejemplo de prueba) | `docs/13` línea 153 antes del cambio; README del backend, sin casos de tiempo en «Probar los filtros 2–4». Corregido en este bloque (la fila apunta ahora a las pruebas) |
| H-11 | Baja; **corregido el 15/11/2026** (`docs/02` dice ahora «el perfil de SenML que implementa el sistema, contrastado con RFC 8428») | `docs/02 §6.5.4` decía que las pruebas del contrato SenML «verifican la especificación real»; la matriz muestra que cubren la parte de la RFC que el adaptador implementa y que las diferencias H-3 a H-8 son un perfil, no la RFC completa | `docs/02` línea 577; matriz, grupo (a) |

**Defectos corregidos el mismo día, cada uno con su prueba y su falla plantada:** C-16 (H-1) y C-94 (H-9). **Pruebas dejadas pendientes** por una diferencia con la RFC: C-07 (H-4), C-09 (H-5), C-14 (H-6) y C-15 (H-7); pasaron a activas el mismo día, con la decisión del perfil de SenML.

### Cifras

| | Antes | Después |
|---|---|---|
| Pruebas del backend | 665 en 61 archivos | 709 en 62 archivos (más 4 pendientes) |
| Pruebas del panel | 353 en 33 archivos (355 ejecuciones) | sin cambio en este bloque (las vigentes, en «Cifras del bloque») |
| `it(` contados por el paso 2t del verificador | 665 | 709 |

**Cifras del bloque:** `pnpm verificar` en verde al cerrarlo: 709 pruebas en el backend, en 62 archivos (más 4 pendientes), y 353 en el panel (355 ejecuciones en vitest, en 33 archivos); `pnpm build` pasa. De `src/recepcion/` cambió solo `adaptadores/senml.adaptador.ts`, por las dos correcciones. Tras las revisiones del mismo día (§71, «Lo que dejó la revisión»), las cifras vigentes: 731 pruebas unitarias del backend y 365 pruebas del panel (404 ejecuciones en vitest); en la matriz, C-43 con prueba propia y C-95 nueva (`plano.adaptador.ts`), y en `recepcion.service.ts`, el error imprevisto de un adaptador va a cuarentena.
El verificador completo (`plataforma/pruebas/verificar-todo.sh`) corrió con el bloque integrado.

### Lo que queda

- **Decididos los hallazgos de diseño (15/11/2026):** el contrato nativo es un perfil de SenML (`docs/10 §4`): identidad por tópico y credencial, `n` como código de magnitud, y las demás diferencias corregidas en el sentido estricto. Queda pendiente la concatenación `bn` + `n` (catálogo de alias).
- **Lo que esta matriz no cubre:** CBOR, XML y EXI de SenML (no se reciben: solo JSON); las reglas del alta masiva y de la consulta; el comportamiento con la
  base real (las pruebas de la recepción usan la base simulada: la inserción idempotente y los topes contra la base real los cubre el banco, `docs/16`).
- Añadir una regla nueva al contrato exige una fila en `MATRIZ`: sin ella, la prueba del guardián falla.

## 74. El contrato nativo es un perfil de SenML, declarado y estricto (15/11/2026)

**Por qué.** La matriz del contrato (§73) mostró que el adaptador SenML hacía menos que RFC 8428 y que los documentos prometían más que el código: la identidad
«venía en la trama» (`docs/06 §3`) cuando el código nunca leía `bn` (H-2), `bv` se ignoraba y guardaba un valor distinto del que dice la RFC (H-6), un `bver`
mayor que 10 se aceptaba (H-4), y otras cuatro diferencias menores (H-5, H-7, H-8 y la frase de `docs/02` de H-11). Se decidió el 15/11/2026 que el contrato
nativo es **un perfil de SenML, escrito y estricto**, no «SenML completo»: lo que se acepta mal se rechaza con su motivo, y lo que no se implementa se declara.

**Qué se decidió** (texto completo en `docs/10 §4`, después del diagrama del pipeline):

- **Identidad.** Sale del tópico y de la credencial del broker (filtro 1), no de `bn`. `bn` **se ignora**. Se eligió ignorarlo y no rechazar la trama cuando
  nombra a otro dispositivo por dos razones: ninguna lectura lleva `bn`, así que la trama no puede declararse otro dispositivo (la atribución no lo lee); y
  rechazar exigiría decidir qué nombra un `bn`, que en la RFC es un prefijo de nombres (§4.1) y no una identidad, y rechazaría packs válidos de la propia RFC
  (`bn` con URN, §5.1.1 a §5.1.7) y los que emiten hoy el emulador y el firmware (`bn` = el identificador del dispositivo, que sí coincide). La concatenación
  `bn` + `n` (§4.1, §4.5.1) **no se implementa**: queda para el catálogo de alias.
- **`n`** es el código de magnitud del catálogo (lo que ya hacía el código); sin `n`, la magnitud del tópico.
- **`bv`** se suma a `v` (§4.5.4) y vale para los registros siguientes hasta el próximo `bv`, como cualquier campo base (§4). Un registro con solo `bv` no
  genera lectura (la RFC lo leería como `bv` + 0; el perfil exige `v`, y es la misma regla de C-12), y `bv` no se suma a los registros de texto, booleano o datos.
  Un `bv` que no es un número finito, o una suma que desborda, es malformada.
- **`bver`** mayor que 10 (§4.4) o que no sea un entero positivo (§4.1): la trama entera se rechaza, aunque el registro no traiga valor.
- **Más de un campo de valor** en un registro (`v`, `vs`, `vb`, `vd`; §4.2): se rechaza. Se aplica también a `vs` con `vb` sin `v`, porque es la misma frase de la RFC.
- **Etiqueta desconocida terminada en «_»** (§4.4): se rechaza; el detalle trae la etiqueta recortada y sin caracteres de control (`texto.ts`). Las demás se ignoran.
- **Tiempo relativo** (§4.5.3; `docs/13`, regla 19, nueva). Con `bt` + `t` menor que 2^28: **negativo** es «ahora» menos esos segundos y desde ahí rige la
  regla 7 (un pasado anterior al 2000 es la hora de recepción); **cero o positivo** rige la hora de recepción. El positivo no se toma como futuro: la RFC lo
  reserva para actuar, una medición ya hecha no está en el futuro, y así el reloj sin inicializar que manda segundos desde el arranque (el perfil `epoch` del
  emulador manda 0 a 86 399) no queda fechado adelante. Desde 2^28 es absoluto. «Ahora» es la hora de recepción: se agregó `recibidoEn` (opcional) a
  `ContextoTrama`; si el servicio no lo pasa, el adaptador toma la hora de su llamada (milisegundos de diferencia), **una sola vez por trama**: todos los registros de
  un pack comparten el mismo «ahora» (C-102); y la vía (MQTT o HTTP) lo toma al entrar la trama, no cuando responde la base (C-103). Una marca relativa depende de cuándo llega
  la trama: **una reentrega no se detecta como duplicado** (igual que una trama sin marca).
- **Tipos y versión (cierre de la revisión del 16/11/2026).** `bt` y `t` que no son un número finito y `bu` que no es texto (§4.3, Tabla 1) se **rechazan** (C-104); hasta
  entonces un `"t":"-5"` se ignoraba en silencio y la lectura quedaba con la hora de recepción. Y un `bver` **distinto entre registros del mismo pack** también
  (§4.4: «All SenML Records in a Pack MUST have the same version number»; C-105): un registro sin `bver` cuenta como 10 hasta que un `bver` explícito fije la
  versión, así que `bver` 5 en el segundo registro de un pack que empezó sin `bver` es un cambio de versión, y `bver` 5 en el primero y nada después no lo es.
- **Números.** Un valor finito que deja de serlo al convertirse a la unidad canónica (1e306 bar son 1e309 hPa) se rechaza como `invalida` aunque el canal no tenga
  rango máximo (C-100: sin esa guardia `Infinity` pasaba la comparación del rango). Un `-0` (en `v`, en `bv` o tras convertir) se guarda como `0` (C-101): la copia
  local de la RFC no dice nada del cero negativo, para la base y para quien compare `-0` y `0` son datos distintos, y una magnitud física no tiene signo en el cero.
- **Alcance.** Son reglas del adaptador SenML. El plano interpreta `t` como instante absoluto y no tiene `bver`, `bv` ni etiquetas de la RFC; ChirpStack y
  Milesight leen JSON ajeno a SenML. La prueba C-99 comprueba que no las aplican.

**Qué cambió.** `src/recepcion/adaptadores/senml.adaptador.ts` (reglas y comentario de contrato), `src/recepcion/tiempo.ts` (`tiempoSenml`),
`src/recepcion/lectura.ts` (`recibidoEn`), `docs/06 §3`, `docs/10 §4` (párrafo del perfil y cuatro filas en la tabla del §4.1), `docs/13` (regla 19 y una fila
de la tabla del §4), `docs/02` (la frase de «verifican la especificación real» y RF-15, que decía `bn` como identificador) y, en §73, las filas C-02, C-07, C-09,
C-14, C-15 y C-21 y los hallazgos H-2 a H-8 y H-11.

**Pruebas** (en `contrato.spec.ts` salvo la última fila; cada una con su falla plantada: se puso el defecto, la prueba quedó en rojo, se quitó y se comprobó con
`diff` que el archivo volvió a como estaba):

| Prueba | Defecto plantado | Pruebas en rojo |
|---|---|---|
| C-07 `bver` mayor que 10 o no entero positivo (era `it.todo`) | `bver` mayor que 10 no se rechaza | C-07 y C-96 |
| C-07 | `bver` 0, negativo o decimal no se rechaza | C-07 |
| C-09 etiqueta con «_» (era `it.todo`) | solo «__» cuenta como etiqueta obligatoria | C-09 y C-96 |
| C-15 más de un campo de valor (era `it.todo`) | el tope pasa de 1 a 2 campos | C-15 y C-96 |
| C-14 `bv` + `v` (era `it.todo`) | `bv` no se suma | C-14, C-96 y C-97 |
| C-14 | `bv` no se hereda al registro siguiente | C-14 y C-97 |
| C-14 | un `bv` que no es número se ignora | C-14 y C-96 |
| C-14 | una suma que desborda se acepta | C-14 y C-96 |
| C-21 tiempo relativo (cambió su «esperado») | el negativo vale la hora de recepción (el comportamiento anterior) | C-21 y C-98 |
| C-21 | el positivo vale «ahora» + esos segundos | C-21 y C-98 |
| C-99 las reglas son de SenML | el adaptador plano aplica la regla de `bver` | C-99 |
| `tiempo.spec.ts`: `tiempoSenml`, el borde 2^28 | el umbral pasa de `>=` a `>` | la del borde |

Pruebas nuevas **de servicio** (`RecepcionService.procesar` con la base simulada): **C-96** envía una trama por cada regla (`bver` 11, `bver` no entero, dos
campos de valor, etiqueta con «_», `bv` no numérico, suma que desborda) y comprueba una sola fila de cuarentena `malformada` con «formato declarado senml:
<motivo>», el dispositivo atribuido, ninguna medición, el dispositivo marcado vivo y que `procesar` termina sin lanzar (el broker confirma el mensaje);
**C-97** comprueba que `bv` 10 + `v` 5 guarda 15 y que el rango físico se evalúa sobre la suma (80 + 10 = 90 Cel va a cuarentena `invalida`); **C-98** comprueba
que `t` = −30 se guarda con la marca de la hora de recepción menos 30 s y origen `dispositivo`, y que `t` = 0 queda sin marca y origen `recepcion`.

**Matriz.** De 94 a 98 reglas (se agregan C-96 en el grupo f, C-97 en el a, C-98 en el b y C-99 en el g; la tabla de grupos de §73 citaba 93 y no contaba C-95).
Por grupo: a 19, b 13, c 8, d 11, e 15, f 13 y g 19. Con C-99 los identificadores de dos cifras llegaban a C-99: el cierre del 16/11/2026 ensanchó la expresión
del guardián y la de las pruebas a `^C-\d{2,3}$` y sumó seis reglas (C-100 a C-105), con lo que la matriz tiene **104 reglas**: a 21, b 15, c 10, d 11, e 15, f 13 y g 19.

**Cierre de lo pendiente (16/11/2026).** La lectura del bloque dejó estos puntos chicos; ninguno cambió el diseño, y cada cambio de comportamiento tiene su regla y su prueba:

| Punto | Qué se hizo | Regla |
|---|---|---|
| La prueba de la identidad no fallaba si se tomaba del `bn` | La prueba exige que la consulta del filtro 1 reciba exactamente `dev-0001` y que `dev-9999` no aparezca en ningún parámetro (salvo el cuerpo crudo, que son bytes); la «Fuente» de la fila se actualizó a lo que hoy dicen `docs/10 §4` y `docs/06 §3` | C-54 |
| Un valor finito pasa a infinito al convertir (`bar` a `hPa`, 1e306) | Se rechaza como `invalida` con «no cabe en un número finito al convertirlo a hPa»; se comprueba sobre el valor ya convertido, con un canal sin rango máximo (con rango, `Infinity` ya lo rechazaba) | C-100 |
| `-0` (también con `bv`) | Se guarda `0`: la copia local de RFC 8428 no dice nada del cero negativo y para la base `-0` y `0` son datos distintos; vale también para el plano y tras una conversión | C-101 |
| «Ahora» se calculaba por registro cuando faltaba `recibidoEn` | Se calcula una vez por trama, fuera del bucle | C-102 |
| El instante que llega a la lectura | Una prueba por cada vía (MQTT y HTTP) con el reloj movido siete minutos mientras responde la base: el adaptador y la columna `recibido_en` reciben el instante de entrada | C-103 |
| `bt`, `t` o `bu` de tipo equivocado se ignoraban | Se rechazan (`bt no numérico`, `t no numérico`, `bu no es texto`), también en un registro sin valor; `n` y `u`, que solo se revisaban en el registro con valor, igual | C-104 |
| `bver` distinto entre registros del pack | Se rechaza (§4.4: «All SenML Records in a Pack MUST have the same version number»). La cita «§4.1» del comentario del valor base pasó a «§4», porque «apply … up to, but not including, the next Record that has that same base field» está en el encabezado de la §4 | C-105 |
| Cifras de la matriz sin guardián | Paso 2g2 del verificador: los identificadores de `contrato.spec.ts` contra los de la tabla de §73, las filas de cada grupo contra el «(N reglas)» de su encabezado y el total contra cada «matriz … N reglas» de los documentos y el informe (las bitácoras, fechadas, no se comparan). La tabla no listaba C-96 a C-99 y decía 94 reglas con 98 en la prueba | (verificador) |
| Identificadores de 16 hexadecimales con forma real | Paso 2f5: ninguna cadena de exactamente 16 hexadecimales (con límites de palabra) en un archivo de texto versionado o nuevo, salvo una lista corta de sintéticos escrita en el propio guion; lo hallado se muestra enmascarado | (verificador) |

La prueba C-96 (cuarentena de cada regla estricta) recibió cuatro casos más: `bt`, `t`, `bu` y `bver` distinto. `docs/10 §4` y su tabla de casos del §4.1 dicen lo mismo que el código
(las reglas nuevas, el desborde y el `-0`), y aclaran que `bn` no llega a la medición ni al detalle pero el cuerpo crudo sí se conserva: en `trama.payload` si alguna lectura se guardó y en
`cuarentena.payload_crudo` si se rechazó.

Cada prueba nueva se comprobó plantando su falla y quitándola (el archivo volvió idéntico):

| Defecto plantado | Mensaje con que cayó |
|---|---|
| La identidad del filtro 1 se toma del `bn` | C-54: `expected [ [ 'dev-9999' ] ] to deeply equal [ [ 'dev-0001' ] ]` |
| Sin comprobar que el valor convertido sea finito | C-100: `expected [ [ 'hPa', Infinity ], …(3) ] to deeply equal [ [ 'hPa', 1e+308 ], [ 'hPa', 1013 ] ]` |
| Sin normalizar `-0` | C-101: `expected [ -0, -0, +0 ] to deeply equal [ +0, +0, +0 ]` |
| «Ahora» por registro | C-102: marcas de segundos distintos en vez de tres iguales |
| `recibidoEn` de HTTP leído dentro del trabajo, después de la espera | C-103: `http: expected '2026-11-16T10:07:00.000Z' to be '2026-11-16T10:00:00.000Z'` |
| `bt` y `t` sin revisar | C-104 y C-96: `bt "1757300000": expected [Function] to throw an error` |
| `bu` sin revisar | C-104 y C-96: `bu 5: expected [Function] to throw an error` |
| `bver` distinto aceptado | C-105 y C-96: `…{"bver":5…}]: expected [Function] to throw an error` |

Y los dos pasos del verificador, aislados (la pila no corrió): 2g2 cae con una fila quitada de la tabla, con la cifra del total cambiada, con el encabezado de un grupo cambiado y con una regla
agregada a la matriz sin su fila; 2f5 cae con una cadena de 16 hexadecimales plantada en un archivo versionable (y pasa al quitarla). No se corrió el verificador completo.

**Compatibilidad: quién emite SenML hacia la plataforma.** Revisado en el repositorio: el emulador (`emulador/modelo.ts`: `bn` = identificador, `bt` absoluto;
con el reloj roto `epoch`, `bt` entre 0 y 86 399, que es relativo positivo y sigue valiendo hora de recepción; con `futuro`, una hora adelante, igual que antes), el
firmware (`nodo.cpp`: `bn` = identificador y `bt` absoluto cuando hay hora; sin hora, ni `bt` ni `t`), el banco (`banco.sh`, `capacidad.sh`, `proxy-limites.sh`,
`tablero-medir.sh`: `bt` absoluto) y `vias.sh` (`bt` absoluto con `t` negativo por lectura: la suma es absoluta, no se ve afectado), el e2e del panel (`bt` = ahora)
y los ejemplos de `docs/06`, `docs/15`, `docs/17`, el README del backend y el guion `publicar.sh`. Nadie emite `bv`, `bver`, etiquetas con «_» ni más de un campo de valor
por registro. No se ejecutaron los guiones del banco (otro trabajo usa la pila): la revisión es de lectura.

**Cifras del bloque:** `pnpm verificar` en verde: 747 pruebas unitarias del backend en 62 archivos y ninguna pendiente (741 al cerrar el perfil: eran 731 más 4 `it.todo`, +4 que dejaron de
ser pendientes, +4 de las reglas C-96 a C-99 y +2 de `tiempoSenml`; y +6 del cierre del 16/11/2026, una por regla C-100 a C-105), y 365 pruebas del panel (404 ejecuciones en vitest, en 33 archivos); `pnpm build` pasa.

**Hallazgos de §73 tras este bloque.**

| Id | Estado |
|---|---|
| H-2 | Declarado: `bn` no identifica y se ignora; `docs/06 §3` y RF-15 corregidos; prueba C-54 |
| H-3 | Declarado: `n` es el código de magnitud; la concatenación `bn` + `n` sigue pendiente (catálogo de alias) |
| H-4 | Corregido (C-07, C-96) |
| H-5 | Corregido (C-09, C-96) |
| H-6 | Corregido (C-14, C-96, C-97) |
| H-7 | Corregido (C-15, C-96) |
| H-8 | Corregido (C-21, C-98; `docs/13`, regla 19) |
| H-11 | Corregido: `docs/02` dice «el perfil de SenML que implementa el sistema, contrastado con RFC 8428» |

**Lo que queda.** La concatenación `bn` + `n` y los alias de magnitud (catálogo). En el diseño, `s`, `bs` y `ut` se ignoran y los valores de texto, booleanos y datos se
omiten: si algún día se guardan, se cambia primero `docs/10 §4`. En `docs/10 §4.1` queda anotada la limitación de la reentrega con marca relativa; si importa, el
emisor debe mandar `bt` absoluto. Los textos del informe que decían que la identidad viaja en `bn` (el capítulo 2 y los anexos de requerimientos y de evaluación de la comunicación) se corrigieron con este bloque.

## 75. El rango a medida de la ficha en un navegador real (16/11/2026)

**Por qué.** A HU-07 (historial por rango de fechas) le faltaba una sola cosa (§72): ver el formulario «A medida» de la ficha en un navegador real, en
escritorio y en teléfono. Las pruebas de §72 no usan navegador: no dicen si los campos de fecha y hora se pueden teclear, si la hora del sitio se
convierte bien al instante que se pide, ni si el formulario cabe a 390 px.

**Qué se hizo.** Un paso nuevo, «a medida (HU-07)», en el recorrido de la ficha con Playwright (`plataforma/backend/panel/e2e/p3.mjs`, que lanza
`banco.sh navegador` contra el banco). El banco siembra lecturas de temperatura de un emulado 50, 35 y 20 minutos antes de la prueba, y la propia
prueba publica otras dos al empezar; el paso elige la ventana que va de 40 a 10 minutos antes del inicio, tecleando las fechas **en la hora del
sitio**, como lo haría una persona. Por cada ancho (1 280 y 390 px) comprueba siete cosas:

| Comprobación | Qué exige |
|---|---|
| Rango imposible (el fin antes del inicio) | El motivo junto a los dos campos, marcados como inválidos; la URL no cambia y no sale ninguna petición con ese rango |
| La ventana va a la URL | `desde` y `hasta` del fragmento son el instante que corresponde a la hora del sitio tecleada |
| Un solo rango para todo | El histórico del canal, las condiciones y los eventos se piden con el mismo `desde` y `hasta` |
| Lo dibujado es lo que hay | El gráfico y el texto tienen los puntos que la API devuelve para esa ventana, y el texto dice el rango en la hora del sitio |
| Lo de fuera queda fuera | Con la misma resolución, una ventana más ancha tiene puntos antes y después; la elegida trae solo los de dentro |
| Cabe | Con el formulario abierto, la página no se desplaza a lo ancho y el formulario queda dentro de la ventana (RF-52) |
| La URL basta | Al recargar: la misma ventana, los mismos puntos y «A medida» marcado |

**Resultado.** `banco.sh navegador`: **50 de 50 comprobaciones** en Firefox 157 y en Chromium 156 (eran 36; las 14 nuevas son las siete de la tabla a
los dos anchos). A 390 px el formulario mide 358 px; a 1 280 px, 992 px. La ventana tecleada como 16:01 a 16:31 en la hora del sitio quedó en la URL
como 19:01 a 19:31 UTC, y la gráfica mostró 2 puntos a un minuto, dejando fuera uno anterior y uno posterior (en Firefox, con el banco recién
encendido; en la corrida siguiente sobre el mismo banco, la de Chromium, fueron 4 puntos y 2 a cada lado, porque quedaban las lecturas sembradas
por la primera: la comprobación compara con la API, no con un número fijo). Capturas de los dos anchos en la carpeta privada del banco (no se versionan).

**Falla plantada.** Con dos defectos puestos a propósito en el panel —los eventos piden las últimas 24 horas en vez de la ventana; el formulario con
un ancho mínimo de 520 px— la corrida quedó con **3 de 50 comprobaciones con falla**, justo las esperadas: «peticiones con la ventana: histórico 1,
condiciones 1, eventos 0» a los dos anchos y «la página se desplaza 146 px a lo ancho» a 390 px. Quitados los defectos, 50 de 50.

**Límites.** En el navegador se comprueba que los eventos se **piden** con la ventana; en el banco ese rango no tenía eventos y la lista mostró su
mensaje de vacío. Que el servidor deje fuera las filas de fuera del rango se prueba contra la base en el humo de la API (§72). El recorrido corre
contra el banco y no es un paso del verificador (detiene y arranca el backend del banco): se corre a mano al tocar la ficha.

## 76. Alta masiva: la vista previa en el panel (16/11/2026)

**Por qué.** El backend del bloque N ya devolvía el plan por fila (§71), pero el panel seguía con la pantalla de F2: una tabla de cuatro columnas
con una palabra por fila, un solo origen (un CSV con coma) y las rechazadas descargadas con coma. Esta sección cubre lo que se hizo del lado del
panel: los lectores (punto 6, sin el XLSX), la pantalla en tres pasos (punto 7) y las descargas (punto 9) de `docs/19 §4`, bloque N.

**Qué se hizo.**
- **Lectores, un solo camino** (`lib/lote.ts`). Archivo CSV, pegado desde la planilla y JSON terminan en la misma lista `filas`. El CSV y lo pegado
  van por el mismo lector, que detecta el separador (`;`, `,` o tabulador, entre los que publica la plantilla del servidor) en la cabecera fuera de
  comillas; el JSON arma las mismas celdas y pasa por la misma comprobación de columnas, topes y caracteres. `n` es la fila de la planilla (las vacías
  cuentan) y, en JSON, la posición más 1. Una fila con más o menos celdas que la cabecera no se envía; una sola columna se avisa antes de enviar; el
  lector ignora las columnas `fila` y `motivo` y quita el apóstrofo que agrega la descarga.
- **Descargas.** La plantilla y «las que no entran» van con `;`, BOM y CRLF; la segunda lleva las columnas de la plantilla en su orden más `fila` y
  `motivo`. Toda celda que empieza con `=`, `+`, `-`, `@`, tabulador, retorno o salto de línea, o con sus variantes de ancho completo, lleva un
  apóstrofo delante, salvo la que entera es un número. El archivo de credenciales no cambió.
- **Pantalla en tres pasos** (`AltaLote.svelte`, con `lib/revision.ts` para lo que no es dibujo). Origen: archivo o pegado, plantilla para descargar y
  los límites leídos de la API. Revisión: cinco tarjetas que son botones de filtro con `aria-pressed`, la tabla «Fila · Identificador · Qué pasa ·
  Detalle» (en teléfono, una tarjeta por fila), el detalle campo por campo con «por omisión», avisos y motivos junto a su campo, de a 100 filas.
  Resultado: cuántos se crearon y las credenciales, que se descargan una vez. De los 22 mensajes de error de `docs/19 §4` 8b, 21 se heredaron de
  `explicarError` sin cambios y el de «una sola columna» se ajustó (el separador ahora se detecta). Desaparecieron de `Alta.svelte` el lote viejo, `ROTULO_RESULTADO`, «Descargar un ejemplo» y la tabla de cuatro
  columnas.

**Pruebas nuevas y su defecto plantado.** Cada una se probó poniendo el defecto a propósito y viendo que la prueba cae; luego se deshizo.

| Qué se comprueba | Prueba | Defecto plantado | Qué cayó |
|---|---|---|---|
| El lector quita el apóstrofo de la descarga; lo descargado y vuelto a subir da las mismas filas | `lib/lote.test.ts` | el lector no quita el apóstrofo | 2 |
| `-5` y `+3,2` quedan intactos | `lib/lote.test.ts` | sin la excepción del número entero | 1 |
| `＝1+2` sale neutralizada | `lib/lote.test.ts` | sin las variantes de ancho completo | 1 |
| El separador se detecta en la cabecera (`;`, tabulador, coma) y lo pegado se lee igual que el archivo | `lib/lote.test.ts`, `Alta.test.ts` | separador siempre coma | 7 |
| En JSON, `n` es la posición más 1 | `lib/lote.test.ts` | `n` = posición | 2 |
| Una fila con más o menos celdas que la cabecera no se envía | `lib/lote.test.ts`, `Alta.test.ts` | sin comprobar el número de celdas | 3 |
| La fila vacía en medio cuenta en los números | `lib/lote.test.ts`, `Alta.test.ts` | los números ignoran las vacías | 5 |
| «Las que no entran» trae `fila` y `motivo` | `lib/lote.test.ts`, `Alta.test.ts` | sin la columna `fila` | 3 |
| Las descargas llevan BOM | `lib/lote.test.ts`, `Alta.test.ts` | descarga sin BOM | 4 |
| Las cinco tarjetas cuentan lo que muestran; «Con aviso» es transversal | `lib/revision.test.ts`, `Alta.test.ts` | «Con aviso» cuenta todas | 2 |
| La revisión abre en «No entran» si hay alguna | `lib/revision.test.ts`, `Alta.test.ts` | abre siempre en «Leídas» | 4 |
| «Por omisión» donde corresponde | `lib/revision.test.ts`, `Alta.test.ts` | sin la marca | 2 |
| «Crear N» se desactiva en vuelo y no manda dos peticiones | `Alta.test.ts` | sin `cargando`; sin la guarda | 1 y 1 |
| «Volver» conserva el origen | `Alta.test.ts` | «Volver» borra el origen | 1 |
| 250 filas dibujan 100 y «Mostrar 100 más» | `Alta.test.ts` | dibuja todas | 1 |
| `plan_cambio` lleva a la revisión nueva y dice cuáles cambiaron | `Alta.test.ts` | sin pasar al plan nuevo | 2 |
| El foco va al encabezado de cada paso | `Alta.test.ts` | sin mover el foco | 1 |

Mensajes con que cayeron, a modo de muestra: sin la excepción del número, `expected [ '\'-5', '"\'+3,2"', '\'+3.2' ] to deeply equal [ '-5', '"+3,2"', '+3.2' ]`;
con los números ignorando las vacías, `expected [ 60, 61, 62, 63 ] to deeply equal [ 60, 61, 63, 64 ]`; sin la guarda de la creación,
`expected [ … ] to have a length of 1 but got 3`; dibujando todas las filas, `expected [ Array(250) ] to have a length of 100 but got 250`.

**Cifras.** `pnpm verificar` en verde: backend, 747 pruebas en 62 archivos (sin cambios); panel, `svelte-check` con 408 archivos y 0 errores,
**404 pruebas** declaradas (eran 365: +39, 25 de la primera entrega y 14 de las correcciones de abajo) y **443 ejecuciones** en vitest (eran 404), en 34 archivos (uno más: `lib/revision.test.ts`); `pnpm build` pasa.

**Correcciones posteriores (16/11/2026).** Una revisión del cambio encontró huecos de lógica y seguridad, y cada uno se corrigió con su prueba, plantando el
defecto y viendo que cae:

| Qué se corrigió | Prueba | Defecto plantado | Qué cayó |
|---|---|---|---|
| Con credenciales sin descargar, «Ir al inventario» está desactivado con su motivo y un enlace del menú pide confirmar; descargadas, ya no se pregunta | `Alta.test.ts` | el botón sin motivo; sin interceptar el enlace | 1 y 1 |
| Cerrar la pestaña con la creación en vuelo pide confirmar; «Volver» se desactiva mientras se crea | `Alta.test.ts` | `beforeunload` sin la creación en vuelo; «Volver» siempre activo | 1 y 1 |
| La respuesta de una revisión vieja no abre la revisión con las filas de otro origen | `Alta.test.ts` | sin descartar la respuesta; el origen nuevo sin cancelar la petición | 1 y 2 |
| Volver a elegir el mismo archivo lo lee otra vez; una lectura vieja no pisa una más nueva | `Alta.test.ts` | el campo sin limpiar; lectura vieja que pisa | 1 y 1 |
| Un 500 sin `codigo` al crear se trata como «no se sabe si se creó»: misma llave, y al agotarse, «Ir al inventario» | `lib/lote.test.ts`, `Alta.test.ts` | el 500 no se repite | 2 |
| El CSV de credenciales deja el identificador tal cual | `lib/lote.test.ts` | `id_fisico` sin `literal` | 1 |
| Comilla sin cerrar o texto pegado a una comilla de cierre se dicen con su fila | `lib/lote.test.ts`, `Alta.test.ts` | sin el aviso de la comilla; sin el del texto pegado | 2 y 1 |
| «Las que no entran» de «lote (1).csv» se descarga con un nombre propio | `lib/lote.test.ts`, `Alta.test.ts` | nombre sin sanear | 2 |
| JSON: claves que solo difieren en mayúsculas y números que pierden su escritura | `lib/lote.test.ts` | sin detectar las claves; `isFinite` en vez de entero seguro | 1 y 1 |
| Una fila interpretada sin `canales` no rompe la tabla | `lib/revision.test.ts` | sin `?? []` | 1 |
| El error de lectura del origen recibe el foco | `Alta.test.ts` | sin el foco | 1 |
| La ida y vuelta con espacios en los bordes y con un valor escrito a mano que empieza con `=` | `lib/lote.test.ts` | el lector sin recortar; sin comillas para valores con espacios; el apóstrofo escrito a mano se conserva | 1, 1 y 3 |
| Una línea junto a las credenciales avisa que una planilla puede alterar las que empiezan con «-» | `Alta.test.ts` | sin la línea | 1 |

Mensajes con que cayeron, a modo de muestra: sin interceptar el enlace, `expected true to be false`; con el 500 sin repetir, `expected [ 'llave-1234567890ab' ]
to deeply equal [ 'llave-1234567890ab', …(2) ]`; con el nombre sin sanear, `expected 'descarga.csv' to be 'no-entran-lote 1.csv'`; sin cancelar el origen viejo,
`expected 'lenta.csv: 2 filas leídas.' to be 'rapida.csv: 1 filas leídas.'`; con el número sin escritura segura, `expected [] to deeply equal [ { caso: 'celda_invalida', …(1) } ]`.
En las pruebas por el DOM, las dos que solo comprobaban que un botón existía ahora lo pulsan y comprueban su efecto, y en el recorrido de navegador
«subido sin tocar da el mismo plan» compara todas las frases de la revisión, no la primera. El botón «atrás» y la barra de direcciones cambian el fragmento sin
pasar por un clic y no se pueden detener desde la pantalla: con credenciales sin descargar, ahí solo vale el aviso de la pestaña.

**En navegador real.** El recorrido `e2e/lote.mjs` (lo lanza `banco.sh lote-navegador` contra el banco) dio **24 de 24 comprobaciones** en
Firefox 157 y en Chromium 156, a 1 280 y a 390 px: se pega un lote con una fila vacía en medio y una fila que no entra; la revisión abre en
«No entran» y los números de fila son los de la planilla (2, 4 y 5); el detalle marca «por omisión» la vía y el formato; «las que no entran»
se descarga con BOM, `;`, `fila` y `motivo`, y vuelta a subir sin tocar da el mismo plan; «Volver» conserva lo pegado; sin la fila mala, «Crear
2 dispositivos» lleva al resultado, las credenciales se descargan una vez, nunca se dibujan en la página y los dos dispositivos quedan en el
inventario; a 390 px cada fila es una tarjeta y la página no se desplaza a lo ancho con el detalle abierto; el foco pasa al encabezado de cada
paso. Corrido varias veces seguidas contra el mismo banco, el recorrido alcanzó el límite de validaciones por minuto: la pantalla mostró su
aviso con los segundos de espera y el botón «Reintentar», y el recorrido hace lo que haría una persona (espera y lo pulsa). Capturas de la
revisión a los dos anchos y del resultado, en la carpeta privada del banco (no se versionan).

**Lo que falta.** Medir el primer dibujo de 500 filas y cada «Mostrar 100 más» (umbral de `docs/19 §4` punto 11: bajo 1 s a 390 px). El lector
de XLSX queda para el bloque siguiente.

## 77. Respaldo con huella y simulacro de restauración (16/11/2026)

**Por qué.** El servidor de prueba ya guarda mediciones reales y cada despliegue empieza por un respaldo, pero el guion que lo toma vivía
solo en ese servidor y lo único que se comprobaba al restaurar era el número de filas de una tabla. Ese día `pg_dump` avisó que el
volcado «podría no restaurarse» por unas claves foráneas circulares del catálogo de TimescaleDB. La regla del diseño es que un respaldo
que no se restauró no es respaldo (`docs/10 §9.5`): había que poder demostrarlo con cada respaldo, no suponerlo.

**Qué se hizo** (primera parte de TT-46).
- `plataforma/pruebas/respaldar.sh`: el respaldo, versionado. Deja el volcado (`pg_dump -Fc`), el archivo de credenciales del broker y la
  **huella** de la base: por cada tabla, cuántas filas y una suma de comprobación calculada fila por fila, más las extensiones, las
  hipertablas con su intervalo, sus trozos, los objetos del esquema y los permisos de cada rol
  (`plataforma/db/pruebas/huella-respaldo.sql`; fija la zona horaria y el formato de fechas, números y bytes de la sesión, para que dos
  bases iguales se escriban igual). El volcado y la huella salen de **una sola transacción de solo lectura**: `pg_dump` vuelca la
  instantánea que esa transacción exporta, así que lo que entre mientras se respalda queda fuera de los dos. La carpeta queda con
  permisos 700 y los archivos con 600; corre un respaldo a la vez por carpeta; el volcado es el último en recibir su nombre
  definitivo, y lo antiguo se borra solo después de terminar bien el de hoy.
- `plataforma/pruebas/simulacro-restauracion.sh`: levanta una base desechable con la misma imagen, sin red y con los datos en memoria;
  restaura en el orden que pide TimescaleDB (crear la base, la extensión, `timescaledb_pre_restore()`, `pg_restore`,
  `timescaledb_post_restore()`); calcula la huella de lo restaurado y exige que sea **idéntica, línea por línea**, a la del respaldo.
  No toca la base de la plataforma ni ningún volumen, y borra el contenedor al terminar.
- El verificador corre las dos cosas en cada pasada (paso 4e; con él son 56 pasos): un cambio del esquema que rompa la restauración se ve
  ese día y no cuando haga falta restaurar.

**Resultado, con la base de desarrollo.** Respaldo de 712 247 bytes; restaurado sin ningún error de `pg_restore`; huella idéntica: 48
líneas, 22 tablas, 29 326 filas, 5 hipertablas reconocidas por TimescaleDB con sus intervalos, las tres extensiones, los mismos índices,
restricciones, funciones, disparadores y valores por omisión, y los mismos permisos del rol de la aplicación. El simulacro completo
tardó 4 s. El aviso de `pg_dump` sobre las claves circulares
aparece también aquí y no impide restaurar: es del catálogo de TimescaleDB, que se restaura entre `pre_restore` y `post_restore`.

**Falla plantada** (cada una con un respaldo estropeado a propósito; el simulacro, o el propio respaldo, debe decir que no sirve):

| Qué se estropeó | Qué dijo el simulacro | Salida |
|---|---|---|
| La huella esperada dice una fila menos en una tabla | «la huella restaurada difiere de la del respaldo en 2 línea(s)», con la tabla y los dos conteos | 1 |
| El volcado cortado a la mitad | «pg_restore salió con 1 y 1 línea(s) de error: could not read from input file: end of file», y las 22 tablas ausentes | 1 |
| La huella tomada en otro instante (la base siguió recibiendo y difería en **una fila**) | difiere en la tabla que recibió esa fila, con su conteo y su suma | 1 |
| El respaldo sin su huella | «no encuentro la huella del respaldo: sin ella solo se sabría que restaura, no que restaura lo mismo» | 2 |
| La huella con solo una parte de sus líneas | «la huella del respaldo está incompleta …: no sirve para comparar» | 2 |
| `pg_dump` falla al respaldar (una opción que no existe) | El respaldo dice «pg_dump no dejó el volcado: no hay respaldo» y no queda ningún archivo con nombre definitivo | 1 |
| Dos respaldos a la vez sobre la misma carpeta | El segundo dice «ya hay un respaldo corriendo» y queda un solo volcado | 1 |

**Límites.** Los tiempos son los de una base chica (decenas de miles de filas): crecerán con el histórico y se vuelven a medir con él. El volcado de una base no
trae los roles del servidor: el simulacro crea los que la huella nombra, y una recuperación real aplica después
`db/init/14-rol-aplicacion.sql` (`docs/10 §9.5`). El respaldo todavía no va cifrado, no hay alarma si el último tiene más de 26 horas y
no existe la papelera de dispositivos: es lo que queda de TT-46 (el cifrado y la guardia, hechos el 17/11/2026: §78).

**En el servidor de prueba (16/11/2026).** El guion versionado tomó el respaldo de la base que recibe los nodos del campus (247 669
bytes) y el simulacro lo restauró **allá mismo**, en un contenedor aparte: `pg_restore` sin errores y huella idéntica, 47 líneas, 22
tablas, 18 647 filas, en 9 s; no quedó ningún contenedor. Copiado por la red privada a otro equipo, el mismo respaldo dio allí el
mismo resultado (18 647 filas en 22 tablas, idénticas, en 4 s): con la copia de fuera y el repositorio se reconstruye la base del
servidor. El respaldo diario del servidor llama desde ese día al guion versionado.

## 78. Respaldo cifrado con la clave fuera del servidor y guardia de 26 h (17/11/2026)

**Por qué.** El respaldo trae lo mismo que la base: resúmenes de contraseñas y de credenciales, correos y mediciones que no se publican
antes de su publicación científica (`docs/10 §9.5`). Quien se lleve una copia, del servidor o de la copia de fuera, se lleva todo eso. Y
un respaldo diario que deja de correr no avisa: se descubre el día en que hace falta.

**Qué se hizo** (segunda parte de TT-46).
- `plataforma/pruebas/respaldar.sh`, con `RESPALDO_DESTINATARIOS=<archivo>`, cifra con `age` para las claves **públicas** de ese archivo
  el volcado (`.dump.age`) y el archivo del broker (`.json.age`). El volcado sale por la salida de la sesión que fija la instantánea y
  pasa por `age` sin escribirse en claro en ningún disco, ni dentro del contenedor; un `pg_dump` que muere a la mitad no deja su marca de
  «terminado» y no hay respaldo. Si se pidió cifrar y no se puede, no escribe nada. Sin la variable respalda en claro, como el 16/11, y lo
  dice en su línea de salida. Cada respaldo trae ahora un cuarto archivo, `plataforma-<marca>.sha256`, con la suma de los otros tres.
  Acepta solo destinatarios `age1…` (decidido: dos, el del operador y uno de emergencia cuya clave privada se guarda sin conexión);
  `RESPALDO_EXIGIR_CIFRADO` vale 0 o 1; la carpeta, si la crea, queda con 700, y si ya existe abierta a otros, se rechaza.
- `plataforma/pruebas/simulacro-restauracion.sh` acepta un `.dump.age` y lo descifra con la clave privada de `RESPALDO_IDENTIDAD` hacia un
  disco en memoria del contenedor desechable; antes comprueba las sumas.
- `plataforma/pruebas/guardia-respaldo.sh`: `OK` y 0, o `ATRASADO` con el motivo y 1. Exige el archivo de sumas (decidido el
  17/11/2026) y un volcado de al menos `RESPALDO_MIN_BYTES` (16 384; el volcado de solo el esquema, sin filas, mide 109 269); un último
  respaldo en claro con respaldos cifrados en la carpeta es `ATRASADO` salvo `RESPALDO_ACEPTAR_CLARO=1`.
- Paso 4e del verificador (siguen siendo 56 pasos): además del respaldo en claro, la guardia sobre él y la vuelta completa cifrada con
  una clave de descarte que se genera en la carpeta de trabajo de la corrida y se borra con ella; sin `age` instalado, esa mitad se
  omite con aviso. La mitad en claro corre sin las variables de cifrado de quien verifica, y la prueba «sin la clave» sin
  `RESPALDO_IDENTIDAD` (`env -u`).

**Resultado.** Con una pila desechable aparte (proyecto propio, sin puertos publicados, borrada al terminar), su base recién creada y
20 000 filas sintéticas, y `age` 1.2.1 (paquete de Alpine 3.22, desde un contenedor): respaldo cifrado de 338 343 bytes, que empieza con
`age-encryption.org/v1` y no contiene la cadena `PGDMP`; restaurado con la clave privada, huella idéntica (44 líneas, 22 tablas, 20 010
filas, 5 hipertablas) en 4 s; el archivo del broker se descifra a un JSON con sus 2 clientes. Dentro del contenedor de la base solo quedan,
mientras dura el respaldo, la huella y la marca de «terminado»; ningún volcado. Con 1 520 010 filas: respaldo cifrado de 16 071 466 bytes
en 5 s y simulacro idéntico en 6 s. La guardia da `OK` sobre los dos. El paso 4e, extraído del verificador y corrido contra esa pila: los
dos simulacros `OK`, la guardia `OK` dos veces y «sin la clave privada, el simulacro se niega»; con `age` fuera del camino, la mitad
cifrada sale «omitido» y la corrida lo cuenta entre los omitidos. Con `age` 1.2.1 instalado en el equipo de desarrollo, el mismo bloque
corre entero, sin omitidos, y también con un entorno hostil (`RESPALDO_DESTINATARIOS` a un archivo que no existe, `RESPALDO_EXIGIR_CIFRADO=1`
y `RESPALDO_IDENTIDAD` de otra clave); sin los `env -u`, ese entorno da 2 fallas («no puedo leer el archivo de destinatarios» y «sin la
clave privada el simulacro salió con 1»). Con dos destinatarios, el volcado se descifra con cualquiera de las dos claves y el simulacro
con la de emergencia da huella idéntica.

Las fallas plantadas fuera del paso 4e se hicieron sobre copias temporales de los guiones o con envoltorios temporales (un `age` que
falla a la mitad, uno lento para cortar la corrida), que no se versionan.

**Falla plantada, en el respaldo** (en ningún caso queda un archivo con nombre definitivo):

| Qué se plantó | Qué dijo | Salida |
|---|---|---|
| `RESPALDO_DESTINATARIOS` definida y vacía | «se pidió cifrar y RESPALDO_DESTINATARIOS está vacía o no definida: no se escribe un respaldo en claro»; ni siquiera crea la carpeta | 2 |
| `RESPALDO_EXIGIR_CIFRADO=1` sin destinatarios | el mismo mensaje | 2 |
| El archivo de destinatarios no existe | «no puedo leer el archivo de destinatarios …: no se escribe un respaldo en claro» | 2 |
| El archivo de destinatarios trae la clave **privada** | «contiene una clave PRIVADA de age: sácala del servidor» | 2 |
| Una clave pública con un carácter de menos | «age no acepta el archivo de destinatarios (¿una clave mal copiada?)» | 2 |
| `age` no está instalado | «se pidió cifrar y age no está instalado: no se escribe un respaldo en claro» | 2 |
| Una línea `ssh-ed25519 …` junto a las claves `age1…` | «trae 1 línea(s) que no son una clave pública age1… (las claves SSH no se aceptan)» | 2 |
| `RESPALDO_EXIGIR_CIFRADO=si` | «debe valer 0 o 1 (vale «si»)»; no crea la carpeta | 2 |
| La carpeta de destino ya existe con permisos 755 | «deja entrar o leer a otros (permisos 755): ciérrala con chmod 700»; no escribe nada en ella (con 700, o creada por el guion, termina bien; el candado queda con 600) | 2 |
| `pg_dump` con una opción que no existe | «el flujo de pg_dump no empieza con la cabecera PGDMP» y «no hay respaldo» | 1 |
| `pg_dump` entrega 2 000 bytes con cabecera válida y sale con 1 | «pg_dump no terminó bien: no hay respaldo» | 1 |
| El cifrado falla a la mitad (un `age` que dice «no space left on device» tras 4 KiB) | «el volcado no se pudo escribir (pg_dump, psql, el cifrado o el disco): no hay respaldo» | 1 |
| `kill -9` a la mitad de un respaldo cifrado | queda solo un `.dump.age.tmp`; la guardia dice «no hay ningún respaldo»; el respaldo siguiente borra ese resto y termina bien | — |
| Dos respaldos a la vez sobre la misma carpeta | «ya hay un respaldo corriendo» | 1 |

**Falla plantada, en el simulacro:**

| Qué se plantó | Qué dijo | Salida |
|---|---|---|
| Respaldo cifrado sin `RESPALDO_IDENTIDAD` | «el volcado está cifrado: indica la clave privada de age con RESPALDO_IDENTIDAD» | 2 |
| Otra clave privada | «no se pudo descifrar el volcado (¿clave equivocada o archivo truncado?): age: error: no identity matched any of the recipients» | 1 |
| El `.dump.age` truncado a la mitad, con su archivo de sumas | la guardia lo detecta sin la clave (abajo) | — |
| El mismo truncado, sin archivo de sumas | «no se pudo descifrar el volcado …: age: error: failed to decrypt and authenticate payload chunk» | 1 |
| Una clave privada con frase de paso (binaria o en armadura de texto) y sin terminal | «está protegida con frase de paso y no hay terminal para pedirla» | 2 |

**Falla plantada, en la guardia** (cada caso sobre una copia del respaldo con otra marca, otra hora y sus sumas coherentes):

| Qué se plantó | Qué dijo | Salida |
|---|---|---|
| Respaldo legítimo de 1 h (en claro; y cifrado con `RESPALDO_EXIGIR_CIFRADO=1`) | `OK el último respaldo tiene 1 h 0 min (…, huella y sumas coinciden)` | 0 |
| La carpeta no existe / está vacía | «no existe la carpeta de respaldos» / «no hay ningún respaldo» | 1 |
| Respaldo de 27 h | «el último respaldo tiene 27 h 0 min (más de 26 h)»; con `RESPALDO_MAX_HORAS=30`, `OK` | 1 |
| El de 27 h con `touch` (hora del archivo de hoy, marca de ayer) | «tiene 27 h 0 min» | 1 |
| Un volcado de hace 27 h renombrado con la marca de hoy | «tiene 27 h 0 min» | 1 |
| El más reciente de 0 bytes | «el último respaldo está vacío (0 bytes)» | 1 |
| Sin huella / la huella cortada | «no tiene huella …: no se puede demostrar qué contiene» / «la huella … está incompleta» | 1 |
| Sin archivo de sumas / sin archivo del broker | «no tiene su archivo de sumas» / «le falta el archivo del broker» | 1 |
| Volcado truncado (en claro, y el cifrado de arriba) | «no coincide con su suma SHA-256: se truncó o se alteró después del respaldo» | 1 |
| En claro con `RESPALDO_EXIGIR_CIFRADO=1` | «el último respaldo está EN CLARO y se exige cifrado» | 1 |
| Se pierde la variable de los destinatarios: un respaldo en claro después de uno cifrado, guardia sin `RESPALDO_EXIGIR_CIFRADO` | «está EN CLARO y en la carpeta hay respaldos cifrados anteriores: el cifrado se perdió»; con `RESPALDO_ACEPTAR_CLARO=1`, `OK`; con `=si`, salida 2; una carpeta solo en claro sigue dando `OK` | 1 |
| Un `.dump.age` de 21 bytes (solo la cabecera de age) con huella y sumas coherentes | «mide 21 bytes, menos que el mínimo de un volcado (16384)» | 1 |
| `RESPALDO_EXIGIR_CIFRADO=si` | «debe valer 0 o 1 (vale «si»)» | 2 |
| La hora del archivo, o la marca y la hora, 2 h en el futuro | «está fechado en el futuro (…): un reloj está mal y no se puede saber su antigüedad» | 1 |
| `RESPALDO_MAX_HORAS=abc` | «RESPALDO_MAX_HORAS debe ser un número entero de horas»; dentro del paso 4e, contada como falla | 2 |

**Límites.** `OK` de la guardia dice que el respaldo existe, está entero y es reciente, **no que restaura**: eso lo prueba el simulacro.
La guardia no valida el contenido del archivo del broker, solo su suma (el respaldo sí exige un JSON completo antes de escribirlo). Las
sumas no van firmadas: detectan la corrupción accidental, no a quien escribe en el servidor y las regenera (`docs/10 §9.5`). **En el servidor de prueba, activado el 17/11/2026** en el orden de `docs/14 §7.1` (paso 7), con las dos claves generadas fuera de él: respaldo cifrado a mano para 2 destinatarios, la guardia `OK` sobre él, el respaldo diario ya cifrando y la guardia diaria a las 04:30 UTC; el respaldo traído al equipo de desarrollo y restaurado con la clave del operador, **SIMULACRO OK (20 104 filas en 22 tablas restauradas e idénticas, en 4 s)**, y sin la clave el simulacro se niega (salida 2). La
guardia es un guion con código de salida; la condición `respaldo_atrasado` del panel llega con la monitorización propia (TT-45). El
simulacro descifra en memoria: con un volcado del tamaño de la memoria libre habrá que descifrar a un disco cifrado; con los tamaños de
hoy (16 MB con millón y medio de filas) sobra. Un `kill -9` deja en el contenedor de la base la huella y la marca de esa corrida (conteos,
sin filas) hasta que el contenedor se recrea. Perder la clave privada es perder los respaldos: por eso se recomiendan dos destinatarios.

## 79. Vista pública por enlace: base, backend y proxy (17/11/2026)

**Por qué.** La vista pública (RF-62, HU-32; diseño en `docs/19 §4`, O) es lo único que ve alguien sin cuenta y lo único que responde a
cualquier persona de internet que tenga un enlace. Lo que había que demostrar antes de construir las pantallas: que solo viajan
promedios, que la regla de k se aplica cada vez que se sirve (también cuando un equipo se da de baja después de publicar), que lo oculto
no se despeja por resta, que revocar corta de inmediato aunque la respuesta esté guardada, que mil visitas no son mil consultas y que el
token no queda en ningún registro.

**Qué se construyó.** La migración 25 (`enlace_publico`, con el SHA-256 del token y un índice único, la retención de su texto y un
disparador que no deja deshacer una revocación ni fechar en el futuro; `enlace_publico_acceso`, el contador sin direcciones;
`sitio.enlaces_publicos_max` y `sitio.publico_minimo_dispositivos`, el tope y el k que fija el administrador; `dispositivo_zona`, la
historia de zonas de cada equipo, por disparador; `fn_limpiar_accesos_publicos` y `fn_anonimizar_enlaces_publicos`, desde
la retención; permisos de la aplicación sin DELETE); el módulo `backend/src/publico/` (`GET /publico`, la lista, crear, renovar, revocar,
el tope, el k del sitio y la vista previa, que arma la respuesta con la misma función y trae los avisos para quien publica; la respuesta guardada con
espera compartida, que guarda también un cálculo que pasó el tiempo máximo; los cupos de lo público y de la vista previa; el contador; los
eventos y su rama en la actividad); la zona `publico` del proxy con su 429 en JSON, y las escrituras de los enlaces en la zona de
administración. Lo decidido al implementar y lo que decidió la persona el mismo día, en `docs/19 §4`, O, al final del bloque.

**Revisión del mismo día.** Tres revisiones independientes (seguridad, concordancia y privacidad) encontraron, entre otras cosas, que la
regla de la resta escrita al principio («se oculta el total si exactamente una zona publicada quedó oculta») dejaba despejar una zona no
publicada, dos zonas ocultas o la combinación de dos enlaces; que «ahora» y la serie promediaban poblaciones distintas; que lo oculto y lo
vacío se distinguían tramo a tramo; y que un cálculo que vencía el tiempo no se guardaba. Se corrigió primero el diseño (punto 2 y «Decidido
al implementar») y después el código; cada corrección tiene su prueba con la falla plantada (abajo).

**Segunda revisión del mismo día** (seguridad, intentando romper las correcciones). (1) Dos enlaces del mismo sitio con k distinto
despejaban un equipo: la regla de la resta usaba el k de cada enlace, y una zona oculta en el de k mayor podía salir publicada en el otro
(zonas de 3, 1 y 10 equipos; k = 3 con la de 3 y la de 10; k = 4 sin zonas: 14·T − 3·A − 10·E = B). Ahora «oculta en todas partes» es la
zona con menos que el menor k de los enlaces vivos del sitio, y ese k entra a la clave de lo guardado. (2) Mover un equipo de zona
reescribía la historia de la zona nueva: cuentan solo sus lecturas desde el cambio (`dispositivo.zona_desde`, por disparador); la zona de
origen todavía pierde su historia, y eso queda propuesto para decidir (abajo). (3) `protegido` dependía de lo oculto en la ventana: ahora
solo de k > 1; `ultimo_dato` va redondeado al inicio de su tramo. (4) El tiempo máximo valía por sentencia (3 × 5 s): ahora es del cálculo
entero, en una transacción de solo lectura, y la espera en la fila del cupo también tiene tope. (5) Título y descripción rechazan las
categorías Unicode Cc y Cf y U+2028–U+2029. (6) La aplicación inserta solo en las columnas que escribe; el disparador exige que `creado_en`
sea la hora de la creación y que una revocación se feche al hacerla. (7) Los avisos cuentan los mismos equipos que la vista. (8) El OpenAPI
declara el máximo real de k (20). (9) El 429 del proxy suma `X-Content-Type-Options: nosniff`.

**Tercera revisión del mismo día** (seguridad, sobre las correcciones de la segunda). (1) El menor k de los enlaces vivos no alcanzaba:
dos enlaces de magnitudes o ventanas distintas (temperatura con A y E, k = 3; humedad sin zonas, k bajo) vuelven a armar 14·T − 3·A −
10·E = B. Decidido: **k es del sitio** (`sitio.publico_minimo_dispositivos`, 1 a 20, 3 por omisión, nunca menos que el piso al servir),
lo fija su administrador (`GET`/`PUT /sitios/{id}/enlaces/minimo`, evento `enlace_minimo`) y bajarlo responde con el aviso «afecta a
todos los enlaces públicos de este sitio» y lo deducible; los enlaces ya no llevan k. (2) La marca `zona_desde` dejaba sin historia a la
zona de origen y cambiaba el total: comparar la vista de antes y la de después de mover un equipo lo despejaba (10·T_antes − 9·T_después).
Decidido: **cada lectura cuenta en la zona donde estaba el equipo cuando se tomó** (`dispositivo_zona`, que llena un disparador; la
aplicación solo la lee), en la serie, en «ahora» y en los avisos. Al construirlo apareció otro caso: en el tramo del cambio el equipo
aportaba a las dos zonas y el total lo contaba dos veces (dos equipos pasaban por tres); ahora cada canal aporta una vez por tramo, con su
estadía más reciente (en la revisión final, la más antigua: ver abajo). (3) El disparador de `enlace_publico` comparaba «no futuro» con `now()`, la hora del inicio de la transacción:
ahora con el reloj (`clock_timestamp()`, con 5 s de margen); y un enlace revocado o anonimizado ya no cambia su vencimiento ni su
renovación; un enlace anonimizado no se sirve. (4) El plazo del cálculo lo vigila también el reloj del proceso: una conexión que no
responde se suelta con error (sin `ROLLBACK`, que también colgaría) y no deja tomado el cupo; el plazo cuenta desde antes de la fila del
cupo. (5) Título y descripción usan la regla de `recepcion/texto.ts` (`\p{C}`, `\p{Z}` y los caracteres de relleno, salvo el espacio y el
salto de línea en la descripción), el título exige al menos una letra o un número y no se aceptan cuatro marcas combinantes seguidas.

**Revisión final del mismo día** (seguridad; confirmó la regla de k por sitio y la historia de zonas y, fuera de los riesgos declarados, no
encontró combinaciones que despejen). Lo que dejó, verificado y corregido: (1) la migración copiaba en el k del sitio el menor de los
enlaces no revocados, incluidos los vencidos, muertos y anonimizados (un enlace k = 1 vencido habría bajado el k de todo el sitio, hacia
atrás y sin rastro): ahora **empieza sin fijar** (rige el de omisión) y, en una base con la versión anterior, un k que nadie fijó (sin
evento `enlace_minimo`) y menor que 3 vuelve a sin fijar; (2) en el tramo del cambio ganaba la estadía más reciente, así que mover un
equipo cambiaba el tramo en curso, ya servido, de la zona de origen (4·Z₁ − 3·Z₂): ahora gana la **más antigua** y el equipo entra a la de
destino desde el tramo siguiente; (3) los avisos contaban la unión de las magnitudes: ahora cuentan **por magnitud**, como la regla, y con
más de una magnitud con datos cada aviso dice de cuál es; (4) la historia de zonas se borraba en cascada con el dispositivo o la zona:
ahora `ON DELETE RESTRICT` (la aplicación no borra ni uno ni otro; los guiones de prueba y la semilla de demostración borran antes la
historia); (5) nada impedía estadías solapadas: ahora un `EXCLUDE` con `btree_gist` (está en la imagen de la base), y la población de
«ahora» parte de las estadías en zonas del sitio, sin el filtro redundante que tenía; (6) el disparador de la historia fechaba con
`now()` y reconocía «el mismo cambio en la misma transacción» por esa hora: ahora fecha con el reloj y lo reconoce por el `xmin` de la
estadía abierta, y el cierre nunca queda antes del inicio (dos transacciones a la vez ya no violan el CHECK); (7) un fallo al pedir la
conexión que no era el vencimiento se guardaba como consulta lenta y se perdía: ahora queda en el registro y sigue como error, y el
`ROLLBACK` tras un error también tiene tope; (8) bajar `PUBLICO_MINIMO_DISPOSITIVOS` baja el k de los sitios sin fijar sin rastro: es
responsabilidad del operador (`docs/19 §4`, O, punto 2) y, si es menor que 3, el backend lo dice en el registro al arrancar; (9) textos
viejos del código y del OpenAPI («el menor k de los enlaces», «el k elegido» por enlace).

**Pruebas sin base** (`pnpm verificar`, en `backend/src/publico/`): 71 pruebas en cinco archivos, más 6 en archivos que ya existían (la
rama de la actividad, con `enlace_tope` y `enlace_minimo`, la retención, el `X-Robots-Tag` y la versión de la privacidad).

| Qué se prueba | Dónde | Falla plantada (debe fallar) |
|---|---|---|
| La regla de k: un valor de menos de k dispositivos sale sin valor, igual que uno sin datos; un tramo con solo valores ocultos no entra al eje | `publico.spec.ts` | publicar con n ≥ 1; dejar en el eje los tramos con solo ocultos |
| La resta: una zona no publicada, dos zonas ocultas y dos enlaces del mismo sitio dejan oculto el total; con los ocultos sumando k, se publica | `publico.spec.ts` | la regla anterior («exactamente una zona publicada») |
| El k que rige nunca baja del piso vigente; k sube hasta 20 | `publico.spec.ts`, `vista-publica.spec.ts` | usar el k del enlace sin el piso |
| Ninguna columna de más llega a la respuesta (n, mínimo, máximo, identificadores, nombres) | `publico.spec.ts`, `vista-publica.spec.ts` | (filas de la base con esas columnas: no deben aparecer) |
| Ausente, repetido, mal formado e inexistente: la misma 404; una ventana inválida con un token que no vale es 404 | `vista-publica.spec.ts` | — |
| Revocar corta en la petición siguiente aunque la respuesta siga guardada | `vista-publica.spec.ts` | mirar lo guardado antes de validar |
| Cien pedidos simultáneos de una clave: un cálculo; un cálculo que venció el tiempo se guarda y las peticiones siguientes reciben 503 sin consultar | `memoria.spec.ts`, `vista-publica.spec.ts` | sin la espera compartida; sin guardar el fallo |
| Con el cupo público lleno, 503 sin tocar la base, y el histórico del sitio (Tendencias) sigue respondiendo | `vista-publica.spec.ts` | — |
| El contador cuenta cargas, no refrescos; si el volcado falla, lo contado vuelve | `vista-publica.spec.ts` | contar también los refrescos |
| Solo `GET /publico` lee `X-Enlace-Publico`: en el código, en el OpenAPI y en la guardia central | `aislamiento.spec.ts` | una guardia que lea la cabecera |
| Quién puede (la fila de enlaces de `docs/20 §6`), el 403 antes del cuerpo, la lista de vivos y el tope | `enlaces.spec.ts` | — |
| Crear (el token una vez, a la base su resumen; el k y los avisos en el evento), el tope del sitio con su número, renovar y revocar | `enlaces.spec.ts`, `publico.spec.ts` | — |
| k es del sitio: enlaces de temperatura con A y E y de humedad sin zonas, en ventanas distintas, ocultan lo mismo (con un k por enlace de 4, el total saldría); el k del sitio entra a la clave de lo guardado y rige en la petición siguiente; un enlace no trae k (400) | `publico.spec.ts`, `vista-publica.spec.ts`, `enlaces.spec.ts` | servir sin el k del sitio; aceptar `minimo_dispositivos` en el enlace |
| `protegido` depende solo de k > 1 | `publico.spec.ts`, `vista-publica.spec.ts` | calcularlo con lo oculto de la ventana |
| El plazo es del cálculo entero: cada consulta recibe lo que queda y, si ya no queda, 503 sin consultar; la espera en el cupo tiene tope | `vista-publica.spec.ts`, `memoria.spec.ts` | el plazo por sentencia; la espera sin tope |
| Título y descripción con la regla de `recepcion/texto.ts`: sin `\p{C}`, `\p{Z}` (salvo el espacio y, en la descripción, el salto de línea) ni rellenos; el título con al menos una letra o un número; sin cuatro marcas combinantes seguidas | `publico.spec.ts` | aceptar U+202E; el filtro anterior (sin Cf); un título sin letra ni número |
| Una conexión que no responde: el reloj del proceso la da por vencida (503), la suelta con error y sin `ROLLBACK`, y el cupo queda libre | `vista-publica.spec.ts` | sin el tope del lado del proceso |
| Fijar el k del sitio: quién puede, del piso a 20, el evento `enlace_minimo` y los avisos («afecta a todos los enlaces públicos de este sitio») | `enlaces.spec.ts`, `publico.spec.ts`, `actividad.spec.ts` | — |
| Los avisos cuentan por magnitud: una zona con 3 equipos de temperatura y 1 de humedad avisa por la humedad, con su nombre | `publico.spec.ts` | contar la unión de las magnitudes |
| Sin conexión por otra causa que el plazo: no es consulta lenta, no se guarda y queda en el registro; un `ROLLBACK` que no vuelve tiene tope | `vista-publica.spec.ts` | tratar todo fallo de conexión como lento; el `ROLLBACK` sin tope |
| Un k de omisión menor que 3 queda dicho en el registro al arrancar | `vista-publica.spec.ts` | sin el aviso |
| Los avisos para quien publica; vivo y muerto; la retención del texto entre 31 y 365 días | `publico.spec.ts` | — |

Fallas plantadas sin base, en tres tandas el mismo día: la guardia que lee la cabecera, contar los refrescos, quitar la resta en «ahora» y
olvidar el piso dieron 6 de 50 en rojo; publicar con n ≥ 1, mirar lo guardado antes de validar y quitar la espera compartida, 4 de 50; ya
con la regla nueva, aceptar U+202E, dejar en el eje los tramos con solo ocultos y no guardar el fallo por tiempo, 3 de 55; y la regla de la
resta anterior más la guardia que lee la cabecera, 5 de 55; y, tras la segunda revisión, el k del enlace en vez del menor del sitio,
`protegido` calculado con lo oculto, el filtro sin Cf, el plazo por sentencia y la espera sin tope, 7 de 63; y, tras la tercera, servir
sin el k del sitio (2 de 66), aceptar `minimo_dispositivos` en el enlace (1), un título sin letra ni número (1) y sin el tope del lado del
proceso (2: la conexión colgada y el cupo lleno); y, tras la revisión final, tratar como lento todo fallo de conexión (1 de 70), el
`ROLLBACK` sin tope (1), sin el aviso del k de omisión (1) y los avisos con la unión de las magnitudes (1). Cada vez, las que debían;
quitadas, todas en verde.

**Contra una base real** (`bash plataforma/pruebas/publico-integracion.sh`): levanta una base desechable con la imagen de la plataforma y
todas las migraciones, solo en 127.0.0.1 y con claves generadas al vuelo; compila el backend; los servicios entran con el rol de la
aplicación, como en la pila. Siembra un sitio con tres zonas (tres, tres y un equipo; después una cuarta, Este, con uno y luego dos), 26
horas de temperatura cada 300 s y dos lecturas extremas que nunca deben verse; y un segundo sitio con zonas A, B y E de 3, 1 y 10 equipos
para los enlaces combinados y el equipo movido. Resultado: **57 de 57 comprobaciones** (tres corridas seguidas). Entre ellas: con
un equipo oculto en el sitio, el total no se publica, tampoco en un enlace que no publica esa zona ni en dos enlaces de una zona cada uno;
con dos zonas ocultas que suman 2, tampoco; con los ocultos sumando k (1 + 2), el total se publica y es, tramo a tramo, el de
`GET /sitios/{id}/historico` (289 tramos); un equipo en mantenimiento que reporta cuenta igual en «ahora» y en la serie; una zona de tres a
la que se le da de baja un equipo deja de publicarse sin tocar el enlace; una zona creada después no aparece y una renombrada conserva su
nombre; la vista previa y la del visitante dan los mismos números; inexistente, mal formado, ausente, vencido y revocado, la misma 404;
renovar a los 29 días sirve, a los 31, revocado o con más de un año, 409; cien visitas simultáneas hacen **1** cálculo y **100** lecturas por
el índice; el contador suma 101 cargas desde dos procesos; el tope que fija el administrador rige, con su número en el 409, y ni un
revocado ni un vencido hace 31 días ocupan lugar; un enlace muerto hace más de su plazo queda con su texto anonimizado y la actividad lo
sigue nombrando; bajar el k del sitio a 1 avisa que afecta a todos sus enlaces y rige en la petición siguiente de un enlace ya creado, y
queda en la actividad con quién; la vista previa avisa lo que un visitante podría deducir; una revocación no se deshace ni se fecha nada en
el futuro, tampoco por el dueño, un enlace nace ahora, una revocación se fecha al hacerla y un revocado no cambia su vencimiento; renovar y
revocar a la vez no chocan con el disparador; un enlace anonimizado no se sirve; la aplicación no puede borrar, cambiar el resumen ni
insertar `creado_en`; con k = 3 en el sitio, ni el enlace de A y E (24 h) ni el del total (24 h y 7 días) publican el total; con k = 4, A
se oculta en todos y el total sale; con k = 4, mover un equipo de E a A deja el total del enlace sin desglose **idéntico tramo a tramo**
antes y después (24 h y 7 días), y la serie de E y la de A (oculta) también; el disparador cierra la estadía en E y abre otra en A, y la
aplicación no puede escribir ni borrar `dispositivo_zona`; en el tramo del cambio, con una lectura del equipo justo antes y otra justo
después, ningún total cuenta más que los 14 equipos del sitio, y el tramo en curso, ya servido, de la zona de origen y del total es
idéntico antes y después del cambio (el equipo entra a la de destino en el tramo siguiente); dos transacciones que mueven el mismo equipo
(la segunda empezada antes de que la primera confirme) dejan dos estadías contiguas, y dos cambios en una transacción, una sola; la base
no acepta estadías solapadas ni borra en cascada la historia de un dispositivo o de una zona, tampoco para el dueño; los avisos de una
vista de temperatura y humedad cuentan cada magnitud (Sur: 1 equipo con humedad, aviso; 3 con temperatura, sin aviso); y, con la
aplicación compilada entera en un puerto efímero,
**114 pares de peticiones** a las rutas del OpenAPI responden igual con y sin un `X-Enlace-Publico` válido. **Fallas plantadas:** publicar
con n ≥ 1 (5 en rojo), mirar lo guardado antes de validar (2), sin la espera compartida (1: 21 cálculos en vez de 1), la regla de la resta
anterior, «ahora» con otra población y una guardia que lee la cabecera (6 en rojo, entre ellas el aislamiento) y contar los enlaces no
revocados en vez de los vivos (2 en rojo); y, tras la segunda revisión, el k del enlace en vez del menor del sitio, sin el filtro de
`zona_desde` y sin la regla de `creado_en` al insertar (3 de 46 en rojo: k 3 y 4, el equipo movido y la fecha de creación; k 3 y 2 sigue en
verde también con la regla anterior, porque ahí los dos k ocultan lo mismo); y, tras la tercera, atribuir cada lectura a la zona actual
del equipo (2 de 53 en rojo: el total y las zonas antes y después de mover el equipo), contar el equipo movido en las dos zonas del tramo
del cambio (1: un total de 15 equipos en un sitio de 14), servir sin el k del sitio (4: el k que rige en la petición siguiente, k = 4 y el
equipo movido) y el disparador sin la regla de los revocados con `vigente()` sin mirar `anonimizado_en` (2); y, tras la revisión final,
la estadía más reciente en el tramo del cambio con los avisos por la unión de las magnitudes (2 de 57 en rojo: el tramo en curso, donde el
total pasó a sin valor, y los avisos de humedad), y el disparador con `now()` con la historia en cascada y sin `EXCLUDE` (2: la segunda
transacción violó `ck_dispositivo_zona_intervalo`, y el dueño insertó una estadía solapada y borró una zona con historia). Una corrida
intermedia dio en rojo el tramo en curso sin falla plantada: la lectura del equipo quedaba fechada en el mismo milisegundo que el `hasta`
de la vista de antes y no entraba; se corrigió la prueba (la lectura, un segundo antes), no el código.

**Costo de la historia de zonas** (`EXPLAIN ANALYZE` dentro de la prueba de integración, mediana de cinco corridas, con su siembra: 14
equipos con una lectura cada 300 s durante 26 h): la serie pública del sitio de los enlaces combinados tarda 12,9 ms en 24 h (tramos de 5
min) y 3,2 ms en 7 días (tramos de una hora), frente a 6,8 ms y 2,8 ms del histórico del sitio (`SQL_HISTORICO_SITIO`) sobre los mismos
datos: cerca del doble en 24 h, por la unión por intervalo y el paso que deja un aporte por canal y tramo (tras la revisión final, igual:
12,9 a 13,1 ms y 3,3 a 3,4 ms en tres corridas). Es una siembra chica: el costo con
120 y 2 000 dispositivos es parte de la medición del punto 13, pendiente.

**La migración.** Antes de la tercera revisión: aplicada dos veces seguidas sobre una base con datos (la de la semilla de demostración) y con la 14 reejecutada después:
sin errores, los permisos se conservan y las convenciones del esquema siguen en 7 de 7. En una base nueva con las migraciones de la 01 a la 25, el paso 2
del verificador da 25 líneas OK y la base tiene 24 tablas. **Reaplicable sobre la versión anterior de la 25** (la que ya tiene la base de
la pila): en una base desechable con las migraciones 01 a 24, la 25 anterior, la semilla y un enlace, la 25 nueva se aplicó dos veces y la
14 después, sin errores; el esquema (`pg_dump -s`) y los permisos de la aplicación quedan iguales a los de una base nueva (salvo los
comentarios de una función que la 14 reescribe, como antes), el enlace existente conserva sus valores y todo dispositivo queda con
`zona_desde = -infinity` (ninguna lectura deja de contar); el paso 2 del verificador, 25 de 25. **Tras la tercera revisión, reaplicable
sobre las dos versiones anteriores** (la primera, sin retención ni marca de zona, y la segunda, con `zona_desde`, la que tiene la base de la
pila): en bases desechables con las migraciones 01 a 24, la 25 vieja y datos (dos sitios; en uno, tres equipos, dos enlaces vivos con k 5
y 4 y uno revocado con k 2, y un equipo movido), la 25 nueva se aplicó dos veces sin errores; el esquema (`pg_dump -s`) y los 477 permisos
de la aplicación quedan iguales a los de una base nueva, y siguen iguales tras reejecutar la 14 y la 25; el sitio con enlaces queda con k =
4 (el menor de los no revocados) y el otro sin fijar (el del despliegue); `zona_desde` desaparece; cada equipo tiene su estadía abierta,
desde `-infinity`, salvo el que la versión segunda había marcado como movido, que entra desde esa hora (sus lecturas de antes siguen sin
contar, como hasta entonces); un cambio de zona posterior deja dos filas; la columna `enlace_publico.minimo_dispositivos` queda en desuso,
con sus valores (la migración es aditiva: no se borra); el paso 2 del verificador, 25 de 25 en las dos. **Tras la revisión final,
reaplicable sobre las tres versiones anteriores** (la tercera es la que tiene hoy la base de la pila), con los mismos datos más un enlace
k = 1 vencido hace 45 días en el primer sitio, un sitio con un enlace k = 4, y, en la tercera, un sitio cuyo k fijó su administrador en 2
(con su evento) y la 25 de esa versión reaplicada con los enlaces puestos (como en la pila, copia el menor k: 1 en el primer sitio, 4 en
el otro): la 25 nueva se aplicó dos veces sin errores en las tres; el esquema y los 477 permisos, iguales a los de una base nueva (también
tras reejecutar la 14 y la 25); el k de todos los sitios queda sin fijar en la primera y la segunda, y en la tercera el 1 copiado vuelve a
sin fijar, el 4 copiado se conserva y el 2 del administrador también; el paso 2, 25 de 25. Con la copia de antes plantada, el primer
sitio queda con k = 1, el del enlace vencido. En la base nueva, la semilla de demostración (la básica y la completa dos veces) se aplica
sin errores con la historia en `RESTRICT`: 12 dispositivos, 12 estadías.

**El proxy** (`bash plataforma/pruebas/publico-proxy.sh`, un nginx desechable con la imagen y la plantilla del proxy y un backend de
prueba): **6 de 6 comprobaciones**. Tras una primera petición, 80 simultáneas a `/publico` desde una dirección dan 60 con 200 y 20 con 429;
el 429 va en JSON, sin caché, sin indexar, con `nosniff` y con HSTS; 30 `POST` seguidos a la vista previa de un sitio, 11 pasan y 19 reciben 429 (zona de
administración); 30 lecturas de la lista de enlaces, ninguna limitada; el registro guarda la ruta `/publico` y nunca el token.

**Cifras.** `pnpm verificar` del backend: tipos (175 archivos de `src/` y la prueba de integración) y lint (176) sin errores; 824 pruebas
unitarias del backend en 67 archivos, todas en verde (747 antes del bloque); el panel no cambió (404 del panel). El
contrato OpenAPI pasa a 47 rutas y 59 operaciones (`GET`/`PUT /sitios/{id}/enlaces/minimo`). La página de privacidad, a la versión 2. La
figura del modelo de datos, regenerada desde una base desechable con las migraciones de la 01 a la 25: 25 entidades, con `dispositivo_zona`.

**Lo que falta y lo que no se midió.** Las dos pantallas y la revisión por capturas (hechas el mismo día: §80) y la medición del punto 13 (120 y 2 000 dispositivos, 6
magnitudes y 5 zonas, el peso de la pantalla): hasta entonces los cupos y la zona del proxy son provisorios. El banco no se corrió.
**Riesgo aceptado y dicho** (`docs/19 §4`, O, punto 2): la diferenciación en el tiempo y entre ventanas sigue abierta; la historia de
zonas empieza con la migración (un cambio de zona anterior no quedó guardado).

**Contra la pila, con la versión final** (respaldo de la base antes; la migración 25 y la 14 reaplicadas sobre la base con datos, que ya
tenía la segunda versión de la 25; pila y proxy reconstruidos): `/salud` con 25 tablas; `generar-figuras.sh` regeneró la figura del modelo
de datos; `sesion-smoke.sh` **437 de 437** (con los casos de los enlaces y del k del sitio); `api-smoke.sh` TODO OK (47 rutas y 59
operaciones servidas, iguales a las versionadas); y el verificador completo en «TODO EN CONCORDANCIA». Lo mismo se había corrido, también
en verde, sobre la primera y la segunda versión del bloque. **Después de la revisión final** la migración 25 cambió otra vez (k sin
fijar, `RESTRICT`, `EXCLUDE` con `btree_gist`, el disparador de la historia) y los guiones `sesion-smoke.sh`, `panel-sesion-e2e.sh`,
`banco/historico-sitio.sh` y la semilla completa borran la historia antes que los dispositivos y zonas: falta reaplicar la 25 y la 14 a
la base de la pila (probado arriba sobre la versión que tiene) y volver a correr esos guiones y el verificador contra ella.

## 80. Vista pública por enlace: las dos pantallas (17/11/2026)

**Por qué.** Con la base, el backend y el proxy probados (§79), faltaba lo que ve una persona: quien visita sin cuenta y quien publica
(`docs/19 §4`, O, puntos 3, 5, 9, 10 y 11). Lo que había que demostrar: que el token se lee antes de montar la aplicación y viaja solo en la
cabecera, que no queda en el navegador ni en una dirección pedida, que lo dibujado es lo que responde `GET /publico`, que la vista previa
muestra lo mismo que verá el visitante con sus avisos antes de publicar, y que renovar, revocar y el k del sitio hacen lo que dice el diseño.

**Qué se construyó.**
- **Quien visita** (`panel/src/Publico.svelte`, `VistaPublicaCuerpo.svelte`, `lib/publico.ts`). `main.ts` mira el fragmento antes de montar
  nada: con `#/v/<token>` carga solo esta pantalla, sin pedir la sesión, la salud ni los sitios y sin leer preferencias. La petición va sin
  cookies (`credentials: 'omit'`), sin caché y sin procedencia, con el token en `X-Enlace-Publico`; la primera lleva `carga=si`, los
  refrescos (cada 60 s) no. Una tarjeta por magnitud con el promedio de ahora y «Promedio de k o más dispositivos», una fila por zona, el
  aviso de lo oculto con su explicación cuando `protegido`; la tendencia con las ventanas que permite el enlace y una gráfica por magnitud
  con el total y cada zona (y «Ver los datos»); toda hora en la zona del sitio; «Pausar actualización»; los textos de 404, 429 y 503; al
  pie, la línea fija del punto 9.
- **Quien publica** (`panel/src/Publicar.svelte`, `lib/enlaces.ts`), en `#/publicar?sitio=<código>` con la entrada «Vista pública» del menú
  para quien tiene la acción `enlaces`: el formulario con los avisos de texto público junto al título, la descripción y las zonas; la
  vista previa con el mismo componente que el visitante y sus avisos (más «Sin datos de…») antes de «Publicar»; la dirección una sola vez
  con «Copiar»; la lista de vivos (y «Ver todos») con «Renovar» (el 409 `acorta` con las dos fechas y «Renovar igual») y «Revocar» con
  confirmación; el k del sitio (bajarlo se confirma con «afecta a todos los enlaces públicos de este sitio» y lo deducible; después, los
  avisos de la respuesta) y el tope de enlaces vivos. Lo que el bloque no fijaba (dónde vive la pantalla, cuándo se pide la vista previa y
  los demás), en `docs/19 §4`, O, «Decidido al implementar las pantallas».
- `lib/vista.ts` reconoce `#/v/…` como pantalla pública (nunca como tablero ni «última vista») y `#/publicar`; el menú suma la entrada y
  un icono propio; Vite reenvía en desarrollo `/magnitudes` y `/publico`.

**Pruebas sin base y su falla plantada** (vitest; cada una se probó plantando el defecto y viendo que cae, y deshaciéndolo).

| Qué se comprueba | Prueba | Falla plantada | Qué cayó |
|---|---|---|---|
| El token se lee del fragmento (43 caracteres base64url); otra forma no se pide; `sinToken` escribe `#/v/…` | `lib/publico.test.ts` | — | — |
| La consulta lleva la ventana y `carga=si` solo la primera vez; el token, solo en la cabecera, sin cookies, sin caché, sin procedencia | `lib/publico.test.ts`, `Publico.test.ts` | el token en la consulta; `carga=si` en toda petición | 3 de 18 |
| 404, 429, 503, otro error y sin red, cada uno con su texto; 404 deja un solo mensaje y no vuelve a pedir; 429 y 503 conservan lo mostrado | `lib/publico.test.ts`, `Publico.test.ts` | — | — |
| Lo oculto y lo vacío se ven igual («Sin dato»); el aviso de lo oculto solo con `protegido`; la unidad con su símbolo | `lib/publico.test.ts`, `Publico.test.ts` | — | — |
| «Pausar actualización» detiene los refrescos; la ventana pide la suya sin `carga`; nada se guarda en el almacenamiento del navegador | `Publico.test.ts` | — | — |
| Sin título ni magnitudes no se publica, con su motivo; los avisos de texto público junto a sus campos | `Publicar.test.ts`, `lib/enlaces.test.ts` | — | — |
| La vista previa se pide una vez por cambio y sus avisos van antes de «Publicar»; la dirección, una vez | `Publicar.test.ts` | — | — |
| Al abrir, cargan el catálogo, la lista, el k y el tope del sitio | `Publicar.test.ts` | el catálogo con la misma cancelación que los ajustes (el error que mostró la captura, abajo) | 3 de 9 |
| El 409 `tope_enlaces` con su número; `no_renovable`; el 409 `acorta` y «Renovar igual» con `acortar: true`; revocar se confirma | `Publicar.test.ts`, `lib/enlaces.test.ts` | — | — |
| Bajar k se confirma con su aviso y muestra los de la respuesta; subirlo no | `Publicar.test.ts` | — | — |
| `#/v/…` es la pantalla pública y `#/publicar` lleva el sitio, de ida y vuelta | `lib/vista.test.ts` | — | — |

**En navegador real** (`bash plataforma/pruebas/panel-publico-e2e.sh`, que corre `backend/panel/e2e/publico.mjs`; sumado al paso 4c del
verificador). Contra la pila, con un sitio de descarte de tres zonas (Norte, 3 equipos; Sur, 2; Este, 1) y una persona administradora por
caso: **166 de 166 comprobaciones** en Chromium 158 y Firefox 159, a 390 y a 1 280 px (42 a 390 px y 41 a 1 280 px, en cada navegador; tras la revisión de abajo, **178 de 178**: 45 y 44). Por caso: la entrada del menú;
al abrir, el k (3) y el tope; los avisos de texto público; la vista previa avisa que Sur (2 equipos) saldrá sin valor y que con el total
se deduce Este, y esos avisos están antes del botón; publicar muestra la dirección una vez y «ocultar» la borra; el visitante, en un
contexto sin la sesión, dibuja exactamente lo que responde `GET /publico` (título, sitio, «ahora» por magnitud y zona, aviso, ventanas) y
lo mismo que mostró la vista previa; el token no aparece en la dirección de ninguna petición, ni en `localStorage`, `sessionStorage`,
cookies o la consola, y viaja en `X-Enlace-Publico`; la primera petición lleva `carga=si` y la de otra ventana no; no pide la sesión, la salud,
las preferencias ni los sitios; sin desplazamiento horizontal; renovar a 7 días da el 409 `acorta`, se confirma y el enlace queda «vence
pronto» con el mismo token; bajar k a 1 se confirma con su aviso, la respuesta avisa que Este tiene 1 equipo, y en la visita siguiente Sur
sale con valor y sin el aviso de lo oculto; subirlo a 3 no pide confirmar; revocar se confirma y el visitante ve «Este enlace ya no está
disponible. Pídele uno nuevo a quien te lo compartió.» y nada más. Al salir borra sitio, equipos, lecturas, enlaces, eventos y personas, y
antes espera a que el backend vuelque los accesos contados (abajo); revisado después: ninguna fila de la corrida en la base.

**Fallas plantadas en el recorrido** (con el panel de `pnpm dev`, `E2E_PANEL=http://localhost:5173`, sin reconstruir la imagen; Chromium,
los dos anchos): el token en la consulta y `carga=si` en toda petición dieron **8 comprobaciones en rojo**, las esperadas (esa corrida registró 81 comprobaciones y no las 83 de una corrida completa en Chromium; no se volvió a medir cuáles faltaron) (por ancho: el token en la
dirección de las peticiones, la primera petición, la ventana sin `carga` y el token en toda la visita); quitadas, en verde.

**Lo que encontraron las pruebas al construir.** (1) A los dos anchos la página del visitante se desplazaba a lo ancho (224 px a 390 y 88 a
1 280): el lienzo de uPlot dentro de una rejilla CSS ensanchaba la columna; las columnas pasaron a ser flexibles. (2) La captura de la
pantalla de publicar mostró «Cargando…» para siempre en los ajustes del sitio: el catálogo usaba la misma cancelación que el k y el tope y
los cancelaba; ahora tiene la suya, y el doble de `fetch` de las pruebas respeta la cancelación (con el defecto, 3 de 9 en rojo). (3) Las
unidades salían con el código de SenML («Cel»): ahora con su símbolo. (4) Con `pnpm dev`, un módulo del panel se llama `…/publico.ts`: el
recorrido distingue la ruta `/publico` de la API por su camino. (5) Del backend, sin cambiarlo: si se borra un enlace con accesos contados en
memoria y aún sin volcar, el volcado de cada minuto falla (clave foránea) y devuelve todo lo contado, también lo de otros enlaces. La
aplicación no borra enlaces (no tiene `DELETE`); solo un guion de prueba lo hace, y este espera el volcado antes de borrar.

**Revisión del mismo día** (tres revisiones independientes; privacidad y concordancia, sin hallazgos altos ni medios; seguridad, uno medio y
ocho menores). Cada uno se verificó antes de corregir, con el diseño primero (`docs/19 §4`, O, «Decidido al implementar las pantallas»):

| Qué se corrigió | Prueba | Falla plantada | Qué cayó |
|---|---|---|---|
| (Media) Se podía publicar sin haber visto los avisos de la selección actual: «Publicar» ahora espera la vista previa de esa selección (firma de magnitudes, zonas y ventana máxima), con su motivo, mientras corre la pausa, está en vuelo, falló o es de otra | `Publicar.test.ts`, `lib/enlaces.test.ts`, `e2e/publico.mjs` | el botón sin esperar la vista previa | 1 de 12 por el DOM; en el recorrido (Chromium, `pnpm dev`), la comprobación a los dos anchos, y el clic de prueba publicó de verdad, lo que cortó el resto del caso (13 de 30 en rojo) |
| Respuestas viejas: cambiar de sitio y empezar a crear cancelan la vista previa en vuelo y su pausa; un enlace creado mientras se cambió de sitio no muestra su dirección en el otro | `Publicar.test.ts` | — | — |
| Bajar k con un k leído viejo: `PUT …/minimo` acepta `anterior` y responde 409 `minimo_cambio` con el que rige, sin cambiar nada; la pantalla relee y vuelve a pedir confirmar | `publico.spec.ts`, `enlaces.spec.ts`, `Publicar.test.ts` | — | — |
| La dirección se olvida en `pagehide` (la caché de ida y vuelta) y va con `translate="no"`; si se entró por un nombre local, un aviso al lado | `Publicar.test.ts`, `lib/enlaces.test.ts`, `e2e/publico.mjs` | — | — |
| Una zona llamada «Promedio del sitio» rompía la página (clave repetida en la leyenda de `Grafico.svelte`): ahora por posición | `Publico.test.ts` | (la prueba se escribió antes de corregir: cayó) | 1 de 8 |
| El recorrido no imprime tokens (ni en los mensajes de Playwright), tapa la dirección en su captura y solo acepta `chromium` y `firefox` en `E2E_NAVEGADORES` | `e2e/publico.mjs`, `panel-publico-e2e.sh` | `E2E_NAVEGADORES='chromium;id'` | sale con 2 antes de llegar a `node` |
| `main.ts` y el ruteo usan la misma regla para `#/v` (`#/v?x` no quedaba en «Abriendo la vista pública…»); `GET /publico` no sigue redirecciones | `lib/vista.test.ts`, `lib/publico.test.ts` | — | — |

La corrida con la falla plantada dejó un enlace sin revocar en su sitio de descarte: la limpieza lo borró igual (comprobado en la base).

Una última revisión de la pantalla de publicar dejó, verificados y corregidos: guardar el k o el tope con la petición en vuelo y cambiar de
sitio escribía la respuesta del anterior en el nuevo (ahora se compara el sitio tras la respuesta; con el defecto plantado, 1 de 15 en
rojo); el selector de sitio se desactiva con su motivo mientras se publica (con el defecto, 1 de 15); «Publicar» exige una vista previa y
espera mientras se guarda el k; el cambio de sitio olvida avisos, «Copiada» y la ventana de la vista previa; la dirección se olvida solo
cuando la página entra a la caché de ida y vuelta (`pagehide` con `persisted`), no al pasar a otra aplicación; el aviso de nombre local
reconoce también nombres de una etiqueta, `.lan`, `.internal`, `.home.arpa` y una IPv4 mapeada en IPv6; y el recorrido exige tener el token
antes de comprobar que no aparece (si no, la comprobación pasaba en falso). El recorrido, de nuevo **178 de 178**.

**Cifras.** Panel: `svelte-check` con 417 archivos y 0 errores; **451 del panel** declaradas (eran 404: +47) y **490 ejecuciones** en vitest
(eran 443), en 38 archivos (cuatro nuevos); `pnpm build` pasa: la pantalla del visitante suma 2,9 kB y su cuerpo, compartido con la vista
previa, 5,0 kB, más el paquete inicial y uPlot, que ya existían. Backend: **826 pruebas** en 67 archivos (eran 824: las dos del bloqueo
optimista del k); el OpenAPI se regeneró (47 rutas y 59 operaciones, sin cambios en la cuenta; `PUT …/minimo` suma `anterior` y su 409). Pasos estáticos del verificador sobre el
cambio: 2y3 (33 componentes, ningún `<button` fuera de `Boton.svelte`) y 2y4 (173 selectores de 4 guiones) en verde.

**Lo que falta y lo que no se midió.** La medición del punto 13 (120 y 2 000 dispositivos, 6 magnitudes y 5 zonas, y el peso de la pantalla
pública, que hoy descarga también el paquete inicial del panel sin ejecutarlo): hasta entonces, los cupos y la zona del proxy siguen
provisorios. El recorrido no pasa por el proxy (va al backend en 127.0.0.1:3000; la zona `publico` y su 429 se probaron en §79). El texto
de 429 se probó por el DOM, no en navegador real. Las capturas a 390 y 1 280 px son de revisión y no se versionan.

**En el servidor de prueba (17/11/2026).** Al desplegar `f486e73`: la migración 25 y `14-rol-aplicacion.sql` corrieron sin ninguna línea `ERROR`;
la base pasó de 22 a 25 tablas; el escáner de imágenes no dejó nada «con parche» y mostró los avisos ya conocidos; los cuatro contenedores
quedaron «healthy». Compose avisó que un volumen del broker existía de antes y no lo había creado Compose: no afecta, y queda anotado
para revisarlo. El respaldo cifrado tomado antes del despliegue se llevó a otro equipo y se restauró: «SIMULACRO OK», 20 186 filas en 22
tablas (es lo correcto: es anterior a la migración). **Queda pendiente:** la comprobación en el navegador contra el servidor (crear, abrir y
revocar un enlace de prueba) y un respaldo nuevo, ya con 25 tablas, restaurado fuera.

## 81. La auditoría de dependencias también en el verificador local (18/11/2026)

**Por qué.** Las corridas 117 y 118 del CI, las de los dos empujes de la vista pública (`b30aa8c` y `f486e73`), quedaron en rojo en el
paso `pnpm audit --audit-level=high`, mientras que `pnpm verificar` pasó en las dos. El `pnpm-lock.yaml` no cambió entre la última
corrida en verde (`b700637`) y las rojas (`git diff --stat` vacío). La causa fue un aviso de `picomatch` (GHSA-fc5q-39xc-vjpf, alto, sin
versión corregida, versiones hasta la 4.0.7) que GitHub dio por revisado el 17/11/2026 y **retiró el 18/11/2026** (campos
`github_reviewed_at` y `withdrawn_at` de su API de avisos). Llegaba solo por herramientas de desarrollo (`typescript-eslint` → … →
`tinyglobby` → `picomatch`): `pnpm audit --prod` daba 0. Con el aviso ya retirado, la auditoría completa sale hoy con 0 altos y queda un
aviso moderado de desarrollo (`minimatch`, GHSA-g3hv-75wg-m249). No hizo falta ninguna excepción. Pero el verificador local no corría la
auditoría (el paso 2q solo vigila las excepciones declaradas), y su corrida de cierre del 17/11 dijo «TODO EN CONCORDANCIA» con el CI en
rojo: un verde que no había consultado lo que el CI sí consulta (los casos anteriores del CI, en §12 y §56).

**Qué se hizo.** Un paso nuevo del verificador, el 2q2, justo después del 2q, en dos mitades.
- **La auditoría, como el CI.** Corre en `plataforma/backend` las dos órdenes de `.github/workflows/verificar.yml`: el árbol entero
  (`pnpm audit`, que falla con avisos altos o críticos; un alto exceptuado en `audit.ignore` no falla, sale como `AVISO`, igual que en el CI) y producción (`pnpm audit --prod`, que no admite ningún aviso, contado en el
  `metadata` del JSON). `pnpm audit` sale distinto de 0 tanto con avisos como sin poder consultar, así que el paso decide por el contenido: sin un
  JSON con `metadata` no hay veredicto. Tres resultados: `OK` (con cuántos avisos menores quedan), `FALLA` (por cada aviso alto o crítico:
  paquete, severidad, GHSA y si tiene versión corregida; y aparte si producción trae alguno) u `omitida` (sin `pnpm`, sin `jq`, sin red o
  con error del registro), que suma `2q2` a los omitidos y deja la corrida en «incompleta».
- **Lo publicado.** Con `gh`, la última corrida del flujo `verificar` en `main`. Terminada en rojo: `FALLA` si `HEAD` ya está publicado (igual o anterior a
  `origin/main`) y no hay cambios, tampoco archivos nuevos que git no ignore (nada local puede arreglarla), y `AVISO` si hay commits o cambios por delante; el
  mensaje trae el número de corrida, el commit y las órdenes para verla (`gh run view <id> --log-failed`) y relanzarla (`gh run rerun <id> --failed`).
  En curso, `AVISO`; en verde, `OK`; sin `gh`, sin red o sin corridas, `omitida`.
- Para plantar fallas, la carpeta auditada (`VERIFICAR_AUDITORIA_DIR`) y la respuesta de `gh` (`VERIFICAR_CI_JSON`) se pueden sustituir.

**Falla plantada** (el bloque extraído a un guion aparte con el preámbulo mínimo, sin correr el verificador entero; las carpetas de prueba se
borraron al terminar; `pnpm` 12.3.4):

| Qué se comprueba | Falla plantada | Qué salió |
|---|---|---|
| El repo de hoy, con el CI sustituido por «success» | — | `OK` en la auditoría (0 altos, 0 de producción, 1 menor de desarrollo) y `OK` en el CI |
| Aviso alto solo en desarrollo | carpeta temporal con `lodash` 4.17.20 como dependencia de desarrollo (`pnpm audit` crudo: 4 avisos, altos incluidos) | `FALLA 2 aviso(s) alto(s)`: `lodash · high · GHSA-35jh-r3h4-6jhm · corregido en >=4.17.21` y `GHSA-r5fr-rjxr-66jc · corregido en >=4.18.1`; 1 falla |
| Producción con avisos, también críticos | `minimist` 1.2.0 como dependencia de producción | `FALLA` por el crítico (`GHSA-xvch-5gv4-984h`) y `FALLA producción trae 2 aviso(s)`; 2 fallas |
| Producción con un aviso que la primera orden del CI deja pasar | `word-wrap` 1.2.3 (moderado; `pnpm audit --audit-level=high` crudo sale con 0) | `FALLA producción trae 1 aviso(s)`: `GHSA-j8xg-fqg3-53r7`; la orden con `--audit-level=high` sola habría dado verde |
| Registro inalcanzable | `pnpm_config_registry` a un puerto sin servicio | `omitida: la auditoría no devolvió un resultado (¿sin red o registro caído?)` con el motivo de `pnpm` (`ERR_PNPM_AUDIT_BAD_RESPONSE`); `2q2` entre los omitidos; ningún `OK` |
| Sin `pnpm` | `PATH` sin `pnpm` | `omitida: pnpm no está en el PATH`; `2q2` entre los omitidos |
| CI en rojo, árbol idéntico a lo publicado | respuesta sustituida con `failure` y un clon limpio con `HEAD` igual a `origin/main` | `FALLA … terminó en ROJO · verla: gh run view 777 --log-failed · relanzarla: gh run rerun 777 --failed (… nada local puede arreglarlo)`; 1 falla |
| CI en rojo con algo por delante | la misma respuesta, con cambios locales en un archivo rastreado, y con `HEAD` por delante de `origin/main` | `AVISO … (hay commits o cambios locales por delante …)`; 0 fallas, en los dos casos |
| Aviso alto exceptuado en desarrollo (`audit.ignore`) | `semver` 5.7.1 en desarrollo con su GHSA en el `pnpm-workspace.yaml` de la carpeta. Medido con pnpm 12.3.4: `pnpm audit --audit-level=high` sale con 0, `.metadata` sigue contando 1 alto y `.advisories` queda vacío | `AVISO 1 aviso(s) alto(s) o crítico(s) exceptuado(s) en audit.ignore (GHSA-c2qf-rxjj-qqgw)`; 0 fallas, como el CI. Sin la excepción, `FALLA` con paquete, GHSA y «corregido en >=5.7.2» |
| El mismo aviso exceptuado, pero en producción | `semver` 5.7.1 en producción con la misma excepción (código de salida 0; `.metadata` de `--prod` cuenta 1) | `FALLA producción trae 1 aviso(s)` y la lista de los exceptuados leída de `audit.ignore`; 1 falla (el CI no admite ninguno en producción, ni exceptuado) |
| Un archivo nuevo sin rastrear con el CI en rojo | árbol igual a lo publicado más un archivo nuevo que git no ignora; y, aparte, solo archivos que git ignora | con el archivo nuevo, `AVISO` (podría arreglar el CI); con solo lo ignorado, `FALLA` |
| Sin respuesta del CI | `VERIFICAR_CI_JSON` a un archivo que no existe, y a uno vacío | en los dos, `omitida: … no existe o está vacío; no se sabe el estado del CI` y `2q2` entre los omitidos |
| Una de las dos consultas de la auditoría sin resultado | un `pnpm` doble en el `PATH` que devuelve vacío o `{"error":"x"}` para el árbol entero con producción válida, o al revés, o ambos vacíos | en todos, `omitida: la auditoría no devolvió un resultado …` y `2q2` entre los omitidos; antes de la corrección, el archivo válido tapaba al inválido y no salía veredicto de la auditoría. Con los dos válidos, `OK` |
| Sin poder comparar con lo publicado | CI en `failure`, clon sin `origin/main`; y fuera de un repositorio | `AVISO … no se pudo comparar con lo publicado` (no `FALLA`). Ojo: `git rev-parse origin/main` sin `--verify` imprime el nombre si no existe y parece un hash; se usa `--verify -q` |
| `HEAD` ya publicado pero no igual | CI en `failure`, `HEAD` un commit detrás de `origin/main`, árbol limpio | `FALLA … el árbol local ya está publicado y sin cambios` |
| CI en verde, en curso, o sin corridas | `success`; `in_progress`; lista vacía | `OK`; `AVISO … sigue en curso`; `omitida: sin corridas del flujo verificar en main` |
| El estado real de hoy | `gh` sin sustituir: la corrida 118 (`44213796881`, commit `f486e73`) sigue en rojo mientras nadie la relance | en un clon limpio, `FALLA` con esa corrida y las dos órdenes; en la copia con los cambios de este bloque, `AVISO`; la auditoría, `OK` |

**Lo que no cubre.** Necesita red: sin ella el paso queda `omitida` y la corrida entera sale «incompleta» (sale con 2), nunca en verde. Mira
el estado de la última corrida publicada, no el del commit que se está por publicar: ese lo dirá el CI. Solo audita `plataforma/backend`
(el panel va dentro de él, con las mismas dos órdenes); una carpeta nueva con su propio lockfile necesitaría su llamada. Y un aviso que
GitHub retira o publica después de la corrida local sigue siendo posible: por eso el CI corre además cada semana.

## 82. Página de privacidad para personas, icono de la pestaña y cifrado exacto (18/11/2026)

**Por qué.** Las capturas del servidor de prueba del 17/11/2026 mostraron tres cosas. La página de privacidad enseñaba a quien la lee
rutas de documentos («docs/21 §8»), nombres de funciones y variables, fichas («P14») y etapas («por construir en la iteración 0»): la
trazabilidad interna viajaba a la pantalla. El navegador pedía `/favicon.ico` a la raíz y recibía 404 (el panel solo se sirve bajo
`/panel/`). Y la fila «Todo lo anterior» decía «cifrados en reposo desde la iteración 1», cuando el 17/11/2026 se había construido el
cifrado del respaldo (§78) pero no el de la base en uso. Un cuarto punto, el estado «Normal» de dos equipos que nunca enviaron una trama,
se comprobó contra el diseño y **no se cambió**: `docs/19 §2` dice que sin ninguna trama todavía el dispositivo se muestra «Normal» hasta la
primera.

**Qué se hizo.**
- `docs/21` suma §2.1, «Lo que lee la persona»: la misma tabla de §2, fila por fila y en el mismo orden, en lenguaje llano y en presente
  (qué dato, dónde, para qué, cuánto tiempo, quién lo ve). §2 queda como trazabilidad y no viaja a la pantalla. Lo que no existe se dice
  «todavía no disponible» (el registro de auditoría de la aplicación, `auditoria`, que sigue sin tabla ni middleware); lo construido pasa a presente (la
  pantalla del visitante sin cookies, el aviso de texto público al publicar, las sesiones propias, «Exportar mis datos»).
- `legal/inventario.ts` se copia ahora de §2.1; `legal/privacidad.ts` quita los «(docs/21 §N)» de los títulos y del aviso sin responsable.
- Cifrado en reposo, comprobado en la fuente (`docs/10 §9.5`, `docs/16 §78`, `docs/14 §7.1`, `respaldar.sh`): están cifrados el volcado y el
  archivo de credenciales del broker, con `age`, para claves públicas; la privada está fuera del servidor. **No** está cifrada la base en
  uso («Sin cifrado de disco…», `docs/14 §7.1`) y la huella y las sumas del respaldo quedan en claro. Sin `RESPALDO_DESTINATARIOS` el guion
  respalda en claro; el despliegue documentado exige cifrar (`RESPALDO_EXIGIR_CIFRADO=1`). La fila dice ahora exactamente eso, en llano.
- `panel/public/favicon.svg` (creación propia: el color de acento del tema y un punto con dos arcos de señal) y su enlace en
  `panel/index.html`. Vite lo publica con la base (`/panel/favicon.svg`), la misma ruta y el mismo origen que el panel, así que entra en
  `img-src 'self'` de la política de contenido sin cambiarla. Con un icono declarado, el navegador no pide `/favicon.ico`.
- No se cambió la versión del texto de privacidad (sigue en 2, con fecha del 17/11/2026); si una corrección como esta debe subirla queda
  por decidir.

| Qué se comprueba | Prueba | Falla plantada | Qué cayó |
|---|---|---|---|
| El arreglo del código es la tabla §2.1, celda por celda | `legal.spec.ts` (mismas filas, mismo orden, mismas celdas) | una frase de más en una fila del arreglo | 2 de 15 |
| §2 y §2.1 tienen las mismas filas en el mismo orden | `legal.spec.ts` | una fila de más en §2 | 1 de 15 |
| Nada que viaje a la pantalla trae jerga interna (rutas de documentos, `fn_…`, variables, rutas de la API, fichas, etapas, comillas de código) | `legal.spec.ts` | «por construir en la iteración 0 (fn_limpiar_sesiones)» en una celda; «(docs/21 §3)» en un título | 2 de 15; 1 de 15 |
| `index.html` enlaza un icono y el archivo existe en `public/` y es un SVG | `panel/src/lib/icono-pagina.test.ts` | el archivo renombrado; el enlace quitado | 1 de 1, las dos veces |

**Resultado.** `pnpm verificar` en el backend: 67 archivos y 828 pruebas del backend, 39 archivos y 452 del panel declaradas (491 ejecuciones en vitest), `svelte-check` con 418
archivos y 0 errores. Se agregaron 2 pruebas al backend (la de §2 contra §2.1 y la de jerga; la de celda por celda ya existía y ahora
compara §2.1) y 1 al panel. El enlace del icono se comprobó también en la compilación: `dist/index.html` trae `/panel/favicon.svg` y
`dist/favicon.svg` existe.

**Revisión del mismo día.** Una revisión independiente del cambio dejó tres correcciones en el texto que lee la persona, aplicadas en
§2.1 y en el arreglo del código: (1) quién puede abrir los respaldos: decía que quien opera el servidor no puede leerlos, y sí puede quien
opera la plataforma, con la clave que guarda fuera; ahora distingue a quien solo tiene acceso al servidor; (2) el cifrado de los respaldos
se afirma con su condición (lo exige la instalación documentada; sin configurarlo, el guion respalda en claro), porque la página la muestra
cualquier instalación; (3) «registro de actividad» nombraba a la vez lo que existe (la actividad que muestra el panel) y lo que aún no
(la auditoría de peticiones): la fila de lo que falta dice ahora «registro de auditoría». Además, `docs/14 §7.4` seguía diciendo que el
cifrado en reposo del respaldo estaba por activarse en el servidor de prueba: puesto al día con `docs/16 §78`.

## 83. Aviso propio del catálogo de magnitudes y prueba del cambio de sitio en el 409 `minimo_cambio` (18/11/2026)

**Por qué.** Una revisión de la pantalla de publicar (17/11/2026) dejó dos puntos. (1) Si fallaba `GET /magnitudes`, el error se escribía en
`avisoPrevia`, el aviso de la vista previa, cuyo «Reintentar» vuelve a pedir la vista previa y no el catálogo: la persona reintentaba y
nada cambiaba; además, sin catálogo el motivo de «Publicar» decía «Elige al menos una magnitud», que no se puede cumplir. (2) La corrección
del 17/11/2026 para el caso en que se cambia de sitio mientras se relee el k tras un 409 `minimo_cambio` (la guarda posterior a
`await cargarAjustes()` en `guardarK`) no tenía prueba propia.

**Qué se hizo.**
- `Publicar.svelte`: el catálogo tiene su propio aviso (`avisoCatalogo`) junto a las magnitudes («No se pudo cargar el catálogo de
  magnitudes. …») con «Reintentar», que vuelve a pedir `/magnitudes` con la cancelación propia del catálogo (`ultimaGana`, separada de la
  de los ajustes del sitio). Mientras falte, «Publicar» se desactiva con el motivo «El catálogo de magnitudes no se pudo cargar: reintenta
  antes de publicar.» (`FALLO_CATALOGO`, en `lib/enlaces.ts`) y no se dibuja el «Elige al menos una magnitud» de debajo. El aviso de la
  vista previa queda solo para la vista previa.
- El texto del aviso y del motivo quedó fijado en `docs/19 §4`, bloque O, «Decidido al implementar las pantallas».
- `Publicar.test.ts`: el `fetch` simulado rechaza con `AbortError` también si la petición se cancela mientras espera, como el `fetch` real.
- Sobre el punto (2), la guarda existente sí cubre el caso: sin ella, la relectura del sitio anterior dejaba en el sitio nuevo el k pedido
  en el anterior, el aviso de conflicto y la confirmación abierta.

| Qué se comprueba | Prueba | Falla plantada | Qué cayó |
|---|---|---|---|
| Un fallo del catálogo muestra su propio aviso junto a las magnitudes, desactiva «Publicar» con su motivo, y su «Reintentar» pide solo `/magnitudes`; al responder bien el aviso desaparece y se elige una magnitud; un fallo de la vista previa tiene su propio aviso y su propio reintento | `Publicar.test.ts` | el error del catálogo escrito otra vez en el aviso de la vista previa | 1 de 17 (no hay aviso junto a las magnitudes) |
| El «Reintentar» del catálogo no pide la vista previa | `Publicar.test.ts` | el «Reintentar» del catálogo apuntando a la vista previa | 1 de 17 |
| Cambiar de sitio mientras se relee el k tras el 409 `minimo_cambio`: la relectura del sitio anterior no pisa el k, el aviso ni la confirmación del nuevo | `Publicar.test.ts` | quitar la guarda que sigue a la relectura | 1 de 17 (el campo mostraba 2 en vez de 7) |

**Resultado.** Se agregaron 0 pruebas al backend y 2 al panel. Sin los cambios plantados, las 17 pruebas de `Publicar.test.ts` pasan.

## 84. Versión y fecha de los textos legales que no dependen de acordarse (18/11/2026)

**Por qué.** El 18/11/2026 el texto de la página de privacidad cambió (la tabla de `docs/21 §2.1`, `legal/inventario.ts` y `legal/privacidad.ts`:
texto para personas, la fila de los respaldos con su condición, el registro que falta llamado de auditoría) y la versión seguía en 2, con
fecha del 17/11/2026; los comentarios y `docs/21 §2.1` decían que subirla «no está decidido». Quedó decidido: toda actualización del texto que
viaja a la pantalla sube la versión en 1 y pone la fecha del cambio, también una errata, y **no puede depender de acordarse**. Vale para la
privacidad y, con el mismo mecanismo, para los términos. Hoy la versión de la privacidad solo se muestra («Versión N, del …»); la de los
términos, además, obliga a todas las personas a aceptar de nuevo (`docs/20 §12`).

**Qué se hizo.**
- `legal/huella.ts`: la huella es el SHA-256 de una forma canónica del texto servido que no depende de la instancia (JSON con las claves en orden
  alfabético, los arreglos en su orden, cadenas en Unicode NFC). `huellaPrivacidad()` cubre el inventario, los apartados y el aviso sin
  responsable (deja fuera el responsable, su contacto, la versión y la fecha); `huellaTerminos()`, todo el texto.
- El texto de las cookies, con los plazos de la sesión, deja de vivir en el panel: lo sirve la API dentro de lo que cubre la huella, y los plazos
  se arman con `INACTIVIDAD_MS` y `VIDA_ABSOLUTA_MS` (`sesion/cookie.ts`, constantes del código). `docs/21 §4` los dice primero y `docs/21 §7`
  escribe la frontera entre texto legal (en la huella) y rótulo de la interfaz (en el panel); «Acerca de» no se versiona. La versión y la
  fecha se muestran como `DD/MM/AAAA` (`fechaCivil`, `panel/src/lib/tiempo.ts`).
- `docs/21 §7` guarda el historial, una tabla por texto («versión · fecha · huella · qué cambió»), fuente única. La privacidad pasa a la
  versión 3 con fecha 18/11/2026; las versiones 1 y 2 son anteriores al mecanismo y llevan «—» en la huella. Los términos conservan la versión 1
  (su texto no cambió) y su fila registra por primera vez la huella.
- Primera guardia, `legal.spec.ts`: la huella de hoy, la versión y la fecha del código son los de la última fila; las versiones suben de uno
  en uno desde 1, las fechas no retroceden y ninguna huella se repite. La falla dice qué hacer.
- Segunda guardia, paso 2w7 del verificador: toda fila del historial ya publicada (`origin/main`; sin esa referencia, `HEAD`) debe estar
  idéntica en el árbol de trabajo y las nuevas solo se agregan al final. Cierra el atajo de «arreglar» la primera guardia cambiando la huella
  de la versión vigente sin subirla. Si la versión publicada aún no trae la tabla, el historial es nuevo y pasa diciéndolo; sin git o sin
  referencia, se omite. La referencia se resuelve con `rev-parse --verify -q «ref^{commit}»`, porque `rev-parse` a secas devuelve el nombre
  tal cual aunque no exista.

| Qué se comprueba | Prueba | Falla plantada | Qué cayó |
|---|---|---|---|
| El texto de privacidad que se sirve es el de la última fila del historial | `legal.spec.ts` (historial de versiones) | una palabra cambiada a la vez en una celda de `inventario.ts` y en `docs/21 §2.1`, sin tocar la versión | 1 de 23, con el mensaje «el texto cambió: sube la versión y la fecha en el código y agrega la fila al historial de docs/21 §7» y las dos huellas |
| La versión del código es la de la última fila | `legal.spec.ts` | `PRIVACIDAD_VERSION` en 4 sin agregar la fila | 1 de 23 («la versión del código no es la de la última fila») |
| Subir la versión con su fila y su huella nueva pasa | `legal.spec.ts` | (caso legítimo) palabra cambiada, fila 4 con la huella nueva, versión 4 y fecha 19/11/2026 | 0 de 23 |
| Los términos: el texto servido es el de la última fila | `legal.spec.ts` | una errata en el texto de los términos sin tocar la versión | 1 de 23 (la misma instrucción y las dos huellas) |
| Versiones de una en una, fechas sin retroceso, huellas sin repetir | `legal.spec.ts` | la fila 2 con versión 3; la fecha de la fila 3 en 10/11/2026; la huella de la fila 3 copiada a la 2 | 1, 2 y 1 de 23 |
| La forma canónica no depende del orden de las claves, sí del de los arreglos, y un carácter cambia la huella | `legal.spec.ts` | (comprobada contra valores fijos, sin plantar) | 0 de 23 |
| Lo publicado no se reescribe (privacidad) | paso 2w7 del verificador | la huella de la fila vigente cambiada en un dígito, con esa fila ya publicada | FALLA, fila 3 (versión 3), con la fila publicada y la actual |
| Lo publicado no se reescribe (términos) | paso 2w7 | la fecha de la fila 1 de los términos cambiada | FALLA, fila 1 (versión 1) |
| Las filas borradas se notan | paso 2w7 | la fila 1 de la privacidad borrada | FALLA, filas 1 y 2 desplazadas |
| Una fila nueva al final pasa | paso 2w7 | (caso legítimo) fila 4 agregada al final | OK, 3 filas publicadas idénticas y 1 nueva |
| Historial nuevo, solo `HEAD` y sin referencia | paso 2w7 | versión publicada sin tablas; sin `origin/main`; sin ninguna referencia | OK («historial nuevo»); OK con `HEAD`; omitida (sale con 3) |
| El texto de cookies y sus plazos entra en la huella (antes lo dibujaba el panel con los plazos escritos a mano) | `legal.spec.ts` | «lo que ocurra primero» cambiado a «antes» en el apartado de cookies; `INACTIVIDAD_MS` de 30 a 20 minutos en `sesion/cookie.ts` | 1 de 23 (huella distinta); 2 de 23 (la huella y el plazo del texto) |
| El plazo en palabras sale de las constantes de la sesión | `legal.spec.ts` | (el plazo de 20 minutos de arriba) | ver la fila anterior |
| El panel no dibuja un párrafo de cookies propio | `Legal.test.ts`, `App.test.ts` | un `<p data-legal-cookie>` agregado a `Legal.svelte` | 2 de 38 (los tres archivos corridos) |
| Una celda del historial con « | » (o celdas de más o de menos) es una fila mal formada | `legal.spec.ts`; paso 2w7 | « | » dentro de la primera celda de la versión 1, en el árbol de trabajo y, aparte, en la versión publicada | 2 de 23 («fila mal formada … 5 celdas en vez de 4»); paso 2w7: FALLA con el mismo mensaje en las dos |
| La huella rechaza `NaN` e `Infinity` | `legal.spec.ts` | (prueba directa con ambos valores) | 0 de 23: lanzan «no finito» |
| Un fallo de git no se toma por «historial nuevo» | paso 2w7 | `git ls-tree` que falla; `git show` que falla; archivo ausente en la referencia | omitida (sale con 3), omitida, OK «historial nuevo» |
| La fecha de la versión se muestra como `DD/MM/AAAA`, sin pasar por zonas | `tiempo.test.ts`, `Legal.test.ts` | (`2026-01-01` no retrocede a diciembre) | 0 de 38 |

**Límite.** Hasta que la tabla del historial esté publicada por primera vez (en `origin/main`), el paso 2w7 no tiene con qué comparar: lo dice («historial nuevo») y pasa; la protección contra reescribir filas rige desde la primera publicación.

El paso 2w7 se probó extrayéndolo del guion y corriéndolo con un `git` simulado (que contesta `rev-parse` y `show` para las referencias que se
le den), más una corrida con el `git` real contra `origin/main`, cuya versión publicada aún no trae la tabla.

**Resultado.** `pnpm verificar` en el backend pasa (tipos, lint, pruebas del backend y del panel, `svelte-check` con 418 archivos y 0 errores,
compilación del panel). Se agregaron 8 pruebas al backend (`legal.spec.ts`: la huella y la versión de cada texto contra su última fila, el
orden del historial de cada texto, la forma canónica, las filas mal formadas, los plazos de las cookies y los números no finitos) y 1 al panel
(`fechaCivil`); las de `Legal.test.ts` y `App.test.ts` se ajustaron. Se agregó 1 paso al verificador (2w7).

## 85. Esperando primera trama: «en servicio desde», plazo del sitio y la alarma de quien nunca reportó (18/11/2026)

**Por qué.** En el servidor de prueba había dos equipos dados de alta que nunca enviaron una trama y el inventario los mostraba «Normal», con
entrega 0 %. Era lo que decía el diseño («sin ninguna trama todavía… se muestra Normal hasta la primera», `docs/19 §2` hasta esa fecha), pero
un equipo así contaba como sano y **no alarmaba nunca**: el supervisor compara contra la última trama y la consulta de caídos exige
`visto_por_ultima_vez`, que no existe. Decidido el 18/11/2026: un estado propio, «Esperando primera trama», y, pasado un plazo del sitio desde
que el equipo entró en servicio, «Sin señal» con la condición de falta de comunicación como cualquier otro (RF-24 enmendado). Un alta masiva
hecha días antes de instalar no debe llenar el tablero de alarmas: por eso el plazo, de 168 horas por omisión. Lo que había que demostrar: que
la regla es una sola en sus tres implementaciones, que el supervisor abre a quien venció (una vez) y a nadie más, que volver de mantenimiento
no abre una alarma falsa, que la primera trama la cierra, que la entrega de quien espera es nula y que solo quien administra el sitio cambia
el plazo.

**Qué se construyó.**
- **Base (migración 26, `db/init/26-espera-primera-trama.sql`).** `dispositivo.en_servicio_desde` (`NOT NULL`, `now()` por omisión; las filas
  que ya existían toman su `creado_en`, en la misma transacción, antes del `NOT NULL`) y `sitio.espera_primera_trama_h` (1 a 2 160 horas, 168
  por omisión, `ck_sitio_espera_primera_trama_h`), con sus comentarios. La aplicación recibe `UPDATE` solo de esa columna de `sitio`
  (repetido en la 14). El paso 2 del verificador suma su línea («26 dispositivo.en_servicio_desde … y sitio.espera_primera_trama_h …»), que
  pide además que las columnas de `sitio` que cambia la aplicación sean exactamente tres.
- **Una regla, tres implementaciones** (`docs/19 §2`): `estadoVisual()` del servidor y `SQL_ESTADO_VISUAL` (`consulta/tablero.ts`) y
  `estadoVisual()` del panel (`lib/estado-visual.ts`), con **una sola tabla de casos** (`panel/src/lib/estado-visual-casos.json`, 24 casos con
  sus bordes) que leen las tres pruebas. `en_linea` cuenta desde el más reciente entre la última trama y `en_servicio_desde` y es nulo sin
  tramas (en SQL, con una guarda: `greatest` ignora los nulos). El orden de atención suma `esperando` entre Normal e Inactivo.
- **Supervisor** (`supervision/supervision.service.ts`): caídos con `greatest(visto, en_servicio_desde)`; un paso nuevo para quien nunca
  reportó y venció su plazo (el `INSERT` vuelve a mirar en la misma sentencia que siga activo, sin fila de estado y vencido), con
  `nunca_reporto` en el evento; la red de seguridad cierra por la misma regla (también a quien volvió de mantenimiento o cuyo plazo se
  alargó) y ahora deja su evento `condicion_cerrada` (`por: barrido`).
- **`PATCH /dispositivos/{id}`** pone `en_servicio_desde` en `now()` al pasar de `mantenimiento` a `activo`, en el mismo `UPDATE`.
- **Entrega, inventario, ficha y resumen:** las tramas esperadas se cuentan desde `en_servicio_desde`; quien espera tiene entrega nula; cada
  fila y la ficha traen `en_servicio_desde` y `espera_hasta`; el resumen cuenta `esperando` y lo deja fuera de los supervisados.
- **API del plazo:** `GET`/`PUT /sitios/{id}/espera-primera-trama` (leerlo, cualquier perfil del sitio; fijarlo, la acción nueva `ajustes`,
  administrador de sitio y del sistema, `docs/20 §6`), con `anterior` (409 `espera_cambio`) y el evento `espera_primera_trama`, que la
  actividad del sitio muestra en palabras. OpenAPI regenerado.
- **Panel:** el estado nuevo en las fichas de conteo y el filtro del inventario, en la franja del tablero y en P3b, con su palabra, un reloj
  delante y el tono de la píldora (`--pildora`), sin colores nuevos; la ficha dice desde cuándo espera y cuándo pasaría a «Sin señal», o que
  el plazo venció sin ninguna trama; la guía de perfiles nombra la acción `ajustes`.
- **Lo que cambió de significado:** la semilla de demostración fija `en_servicio_desde` = alta (sin eso, un nodo callado hace dos días saldría
  en línea) y `semilla-demo.sh` comprueba que `demo-http-01` espera su primera trama; las semillas del banco mueven `en_servicio_desde` junto
  con `creado_en`; `api-smoke.sh`, `sesion-smoke.sh` (las filas del plazo en la matriz) y el recorrido `e2e/sesion.mjs` cuentan cinco estados.

**Pruebas sin base y su falla plantada** (vitest; cada defecto se plantó, se vio caer y se deshizo).

| Qué se comprueba | Prueba | Falla plantada | Qué cayó |
|---|---|---|---|
| La regla del servidor con la tabla de casos, bordes incluidos (el plazo vence en `espera_hasta` exacto; 2 × intervalo exacto sigue en línea) | `consulta/tablero.spec.ts` | `<=` en vez de `<` en el plazo | 1 caso (el del borde) |
| Vuelto de mantenimiento con la última trama vieja: en línea por `en_servicio_desde` | `consulta/tablero.spec.ts`; `lib/estado-visual.test.ts` | sin `en_servicio_desde` en `en_linea` (servidor; panel) | 2 casos en cada uno |
| Quien nunca envió ya no es Normal | `consulta/tablero.spec.ts`; `lib/estado-visual.test.ts`, `Inventario.test.ts`, `Ficha.test.ts` | la regla de antes (sin trama → normal) | 7 en el servidor; 8 en el panel |
| El SQL tiene las ramas en el orden de la regla y la guarda del nulo en `en_linea` | `consulta/tablero.spec.ts` | `greatest` sin la guarda | 1 |
| El orden de atención (esperando entre Normal e Inactivo), en el servidor y el panel | `consulta/tablero.spec.ts`; `lib/estado-visual.test.ts`, `Inventario.test.ts` | esperando al final | 1; 2 |
| Entrega nula para quien espera; las esperadas desde `en_servicio_desde` | `consulta/tablero.spec.ts` | la entrega calculada para quien espera | 1 |
| Salud: quien espera no es supervisado | `consulta/rango-y-salud.spec.ts` | supervisados = no inactivos (lo de antes) | 1 |
| Supervisor: caídos desde `greatest`; quien nunca reportó, con su evento y el `INSERT` que vuelve a mirar; el cierre del barrido con evento | `supervision/supervision.service.spec.ts` | sin `greatest`; sin volver a mirar; sin el paso nuevo; cierre sin `por` | 1 en cada caso |
| `PATCH` de mantenimiento a activo mueve `en_servicio_desde`; otros cambios no | `alta/configuracion.service.spec.ts` | nunca lo mueve | 1 |
| El plazo: 1 a 2 160, entero, sin campos de más; 403 antes de mirar el cuerpo; 404 desde otro sitio; 409 con `anterior` viejo; evento con quién; sin evento si no cambia | `consulta/espera.spec.ts`, `sesion/permisos.spec.ts` | sin bloqueo optimista; el cuerpo antes que el permiso; sin evento; mínimo 0; `ajustes` también para el operador | 1; 1; 1; 4; 4 |
| El estado nuevo en el inventario: su palabra, su clase, cuenta aparte, filtra, entrega «—», va antes de Inactivo y pasa solo a «Sin señal» al vencer | `Inventario.test.ts` | rótulo vacío (solo color) | 2 |
| La ficha: desde cuándo espera y cuándo pasaría a «Sin señal», en la zona del sitio con el UTC en la ayuda; vencido, lo dice | `Ficha.test.ts` | sin el texto de la espera | 1 |
| La franja del tablero: ocho fichas y los cinco estados suman el total | `Tablero.test.ts` | la franja sin esperando | 1 |
| Contraste del tono de la píldora en los dos temas | `lib/tema.test.ts` | `--sobre-pildora` claro | 1 |
| La guía de perfiles nombra `ajustes` | `lib/ayudas.test.ts` | — | — |

**Contra una base real** (`bash plataforma/pruebas/espera-integracion.sh`): base desechable sin red y en memoria, conexión por socket, con
las migraciones hasta la 25; siembra cinco dispositivos, aplica la 26 **dos veces** moviendo entre una y otra un `en_servicio_desde` y el plazo,
reaplica la 14, corre la línea 26 del paso 2 y las convenciones del esquema (7 de 7), y después `integracion/espera.ts` con el rol de la
aplicación: **37 de 37 comprobaciones** — la migración sobre datos y repetida, el `CHECK` (0 y 2 161 rechazados), el permiso por columna,
los 24 casos de la tabla contra `SQL_ESTADO_VISUAL` en una transacción (bordes exactos), el supervisor (abre a quien venció, una vez con dos
barridos a la vez, no a quien está en plazo, usa el plazo de su sitio, no abre al volver de mantenimiento ni abre y cierra, cierra la que
quedó de antes, la primera trama la cierra por `marcarVivo` con la fila de estado recién creada y el barrido no la reabre, alargar el plazo la
cierra), el inventario, la ficha y el resumen, y la API del plazo con la aplicación compilada (lectura con consulta, 403 al operador, 400
fuera de rango, 404 desde otro sitio, 409 con `anterior` viejo, 200 con el evento y quién, 403 sin `X-Pedido`, la actividad del sitio y la
del otro).

**Fallas plantadas contra la base:** `greatest` sin la guarda del nulo, la red de seguridad sin la rama de quien nunca envió y `ajustes`
también para el operador dieron **6 de 37 en rojo** (la guarda, alargar el plazo, el inventario de quien espera, el 403 al operador y los dos
que siguen a su escritura); los caídos sin `greatest`, **1 de 37** (vuelto de mantenimiento: la primera versión de esa comprobación solo
miraba que no quedara abierta y pasaba, porque el mismo barrido la abría y la cerraba; ahora exige que no haya evento de apertura); la 26
llenando con `now()` en vez de `creado_en`, las dos líneas del guion y **1 de 37**.

**Lo que no se decidió aquí:** dónde se cambia el plazo en el panel (no hay pantalla de ajustes del sitio; mientras tanto, por la API,
`docs/19 §4`, P, punto 4).

**Resultado.** Se agregaron 15 pruebas al backend y 3 al panel (contadas por `it(`; las de la tabla de casos corren una vez por caso), y la
prueba de integración `espera-integracion.sh`. `pnpm verificar` en verde.

**Revisión del mismo día.** Tres revisiones independientes del bloque dejaron correcciones aceptadas, aplicadas así:

- **Pasar a mantenimiento no cerraba las condiciones abiertas** (la baja sí). `PATCH /dispositivos/{id}` ahora cierra, en la misma transacción y
  bajo el mismo bloqueo de fila, todas las condiciones abiertas del equipo, con un evento `condicion_cerrada` por cada una (`por: mantenimiento`,
  con la persona); el barrido del supervisor cierra, con su evento, las de los equipos que ya estaban en mantenimiento (datos existentes o
  un cambio hecho sin la API). Antes, el resumen podía contar una falta de comunicación con cero equipos en «Sin señal». Verificado en el
  filtro de alertas: con el equipo en mantenimiento no abre condiciones de umbral; lo que queda como ventana es una trama que ya había
  leído el estado `activo` y se confirma después del cambio (el estado se lee al empezar la trama), y esa la cierra el barrido siguiente.
- **La condición y su evento no eran atómicos** (pasos (1), (2) y (3) del barrido, con la numeración de `docs/10` punto 68; y `abrirTope` y `abrirRelojDesviado`): una sola sentencia con CTE por cada apertura y cada cierre; el
  evento toma sus valores (silencio, plazo, fecha de entrada en servicio) de la propia sentencia y no de la búsqueda anterior.
- **Un equipo en mantenimiento no abre ninguna condición** (decidido tras la segunda revisión; RF-22). La red de seguridad del paso (4) cerraba
  cada minuto lo que `abrirTope` y `abrirRelojDesviado` (y el paso (1)) volvían a abrir con la trama siguiente, porque la recepción solo
  rechaza la baja: un bucle de abrir y cerrar con eventos y avisos cada vez. Ahora esas aperturas solo abren a un equipo `activo`, dentro de
  la misma sentencia, sin evento ni aviso si no abrieron; y el paso (3) cierra solo a los activos, para que a los de mantenimiento los cierre
  siempre el paso (4), con su motivo. Se revisaron todas las aperturas de condiciones de dispositivo (`INSERT INTO condicion`): la de
  umbral (alertas) ya miraba el estado; no hay otra.
- **Aviso en vivo de los cierres por la API:** el `PATCH` a mantenimiento y la baja publican en el canal en vivo cada condición cerrada,
  después del `COMMIT` (si la transacción se deshace, no sale ningún aviso). El comentario sobre el bloqueo de fila se corrigió: serializa
  un `PATCH` contra otro, no contra quien abre condiciones.
- **El evento de cierre del barrido no decía por qué cerró:** lleva `motivo` (comunicación restablecida, de vuelta en servicio, de vuelta
  dentro del plazo de la primera trama).
- El comentario del barrido prometía que una primera trama confirmada entre la búsqueda y la apertura no abre la condición: con instantáneas
  de lectura confirmada puede abrirse y la cierra el paso 2 del barrido siguiente; el comentario y `docs/10` lo dicen ahora tal cual.
- Concordancia: el orden `atencion` y la entrega nula de quien espera en `docs/19` y `docs/10`; «cinco valores» donde decía cuatro (con la
  nota de que fueron cuatro hasta el 18/11/2026); los permisos de `plataforma_app` sobre `sitio` (tres columnas, con la migración 26);
  RNF-03 y los criterios de HU-14 distinguen a quien ya reportó de quien nunca envió una trama (RF-24); la fila de trazabilidad de
  `docs/19 §7`; que cambiar un equipo de zona no reinicia su plazo; y el cambio de contrato de la API del inventario y la ficha. La
  migración 26 dice que su relleno cambia una vez la marca de bloqueo optimista de todos los equipos.

Que las sentencias únicas no dejen un evento sin condición, ni dos aperturas, lo prueba la integración contra una base real
(`espera-integracion.sh`); las pruebas unitarias solo comprueban su forma (que sea una sola sentencia y lleve la guarda del estado).

| Qué se corrigió | Prueba | Falla plantada | Qué cayó |
|---|---|---|---|
| Pasar a mantenimiento cierra todas las abiertas, con un evento por cada una, antes del `COMMIT` | `alta/configuracion.service.spec.ts` | sin el cierre en el `PATCH` | 1 |
| Un cambio de nombre, o volver a `activo`, no toca condiciones | `alta/configuracion.service.spec.ts` | — (acota la anterior) | — |
| Pasar a mantenimiento por la API cierra las dos condiciones de un equipo (de dos tipos) con la persona; el barrido siguiente no las reabre | `integracion/espera.ts` (base real) | sin el cierre en el `PATCH` | 1 |
| La red de seguridad cierra la condición de un equipo puesto en mantenimiento por SQL directo, con su evento | `supervision/supervision.service.spec.ts`; `integracion/espera.ts` | el estado `mantenimiento` cambiado por otro en la sentencia | 1; 1 |
| La condición y su evento son una sola sentencia (apertura de caídos y de quien nunca reportó) | `supervision/supervision.service.spec.ts` | la condición insertada aparte, en una sentencia previa | 3 |
| El evento de cierre del barrido lleva `motivo` | `supervision/supervision.service.spec.ts`; `integracion/espera.ts` | la sentencia sin el `motivo` | 1; 1 |
| Un equipo en mantenimiento no abre tope ni reloj desviado; uno activo sí, una vez cada uno; dos barridos no producen ningún par abrir/cerrar | `integracion/espera.ts` (base real); `supervision/supervision.service.spec.ts` | las aperturas de tope y reloj sin la guarda `d.estado = 'activo'` | 1 de la integración; 5 unitarias (plantada junto con la guarda de los pasos (1) y (3)) |
| El paso (3) no cierra a los de mantenimiento (los cierra el (4), con su motivo) | `supervision/supervision.service.spec.ts` | sin `AND d.estado = 'activo'` en el paso (3) | 1 (plantada junto con la anterior) |
| El aviso en vivo de cada cierre sale después del `COMMIT`, en el `PATCH` a mantenimiento y en la baja; si no se confirma, no sale | `alta/configuracion.service.spec.ts`, `alta/baja-rotacion.spec.ts` | sin publicar; publicando antes del `COMMIT` | 1 de cada prueba, en las dos variantes |

Tras las correcciones, contra una base real: `bash plataforma/pruebas/espera-integracion.sh`, **43 de 43 comprobaciones** (eran 37: el caso de la condición abierta en mantenimiento se reescribió y se agregaron el cierre por la API, la vuelta a servicio y que un equipo en mantenimiento no abre tope ni reloj desviado).

## 86. Ajustes del sitio: el plazo de la primera trama, el k y el tope en una pantalla propia, y el aviso de a cuántos equipos afecta acortar el plazo (18/11/2026)

**Por qué.** Tres ajustes rigen a todo un sitio y no tenían lugar propio: el plazo de la primera trama (hasta hoy solo por la API, `docs/19 §4`,
bloque P, punto 4, «por decidir») y el mínimo de dispositivos (k) y el tope de enlaces vivos de la vista pública, que vivían al pie de
«Publicar una vista». Decidido el 18/11/2026: una pantalla, P15 «Ajustes del sitio» (`docs/19 §4`, bloque Q), adonde se mudan también el k y el
tope. La revisión del bloque del plazo dejó un punto medio: **acortar el plazo puede abrir decenas de alarmas de golpe** en el barrido
siguiente y nada lo avisaba antes. Lo que había que demostrar: que el k y el tope se mudaron sin perder ninguna prueba ni ninguna guarda;
que el plazo se guarda con bloqueo optimista y no manda nada si no cambia; que acortar pregunta a cuántos equipos afecta y no guarda hasta
confirmar, que alargar nunca pregunta y que sin afectados no hay confirmación; que cada sección se ve solo con su acción; y que «Publicar»
queda con una línea de lectura y el enlace.

**Qué se construyó.**
- **Panel.** `#/sitio/ajustes?sitio=<código>` (`lib/vista.ts`, con ida y vuelta y el código inválido ignorado), la entrada «Ajustes del sitio» del
  menú con su icono propio (visible con `ajustes` o `enlaces`), `AjustesSitio.svelte` (selector de sitio y las dos secciones, cada una por su
  acción) y un componente por ajuste, cada uno con su carga y su cancelación propias: `AjusteEspera.svelte` (el plazo, su equivalencia en
  días, qué pasa al vencer y por qué existe; «Guardar el plazo» con `anterior`; el 409 `espera_cambio` relee y dice el valor nuevo; el mismo
  valor no manda nada; **acortar pide `?propuesto=H` y, con afectados, confirma antes del `PUT`**), `AjusteMinimo.svelte` y `AjusteTope.svelte`
  (el k y el tope, mudados sin cambiar su comportamiento). Lo puro, en `lib/ajustes.ts`. «Publicar» deja una línea de lectura con los valores
  reales y, con la acción `enlaces`, «Cambiar en Ajustes del sitio»; desaparece de «Publicar» la espera «Espera a que se guarde el mínimo del
  sitio…» (ya no hay un guardado del k en vuelo en esa pantalla).
- **Backend.** `GET /sitios/{id}/espera-primera-trama?propuesto=<h>` (mismos permisos y aislamiento; `propuesto` validado como el `PUT`: entero
  de 1 a 2 160, si no 400) suma `afectados`: los equipos **activos** del sitio que nunca enviaron una trama, hoy dentro de su plazo y
  vencidos con el propuesto. Una sola consulta (`SQL_AFECTADOS_POR_PLAZO`, `consulta/espera.service.ts`) que reutiliza la expresión del
  estado visual (`SQL_ESPERA_HASTA`) y no repite la regla. Sin `propuesto`, la respuesta no cambia. El conteo de rutas y de operaciones del
  OpenAPI no cambia: es un parámetro.
- **Documentos.** `docs/19` (§3 fila P15, §4 bloque O: dónde se cambian el k y el tope; bloque P, puntos 2 y 4; bloque nuevo Q; §7 fila P15),
  `docs/20 §6` (la fila del `GET`) y `docs/10 §8.4` punto 68.

| Qué se comprueba | Prueba | Falla plantada | Qué cayó |
|---|---|---|---|
| El plazo se muestra con su equivalencia en días, qué pasa al vencer y por qué existe; el campo tiene su etiqueta | `AjustesSitio.test.ts` | (sin plantar: texto fijo del diseño) | |
| Alargar guarda directo con `anterior` y sin preguntar nada a la API | `AjustesSitio.test.ts` | el `PUT` sin `anterior` | 4 pruebas del plazo (el cuerpo no trae `anterior`) |
| Acortar con afectados pregunta con `?propuesto=`, pide confirmar, sin confirmar no hay `PUT`, y al confirmar se guarda con `anterior` | `AjustesSitio.test.ts` | acortar guarda sin preguntar | 4 (no hay confirmación, hay `PUT`) |
| Acortar con afectados pide confirmar | `AjustesSitio.test.ts` | el conteo ignorado (nunca confirma) | 2 |
| Acortar sin afectados no pide confirmar y guarda directo | `AjustesSitio.test.ts` | confirmar siempre | 1 |
| Alargar no pregunta | `AjustesSitio.test.ts` | preguntar también al alargar | 5 |
| Cancelar la confirmación no guarda y el campo vuelve al plazo que rige; si la pregunta falla, se dice y no se guarda | `AjustesSitio.test.ts` | acortar guarda sin preguntar | incluidas en las 4 de arriba |
| Fuera de 1 a 2 160, vacío, decimal o el mismo valor: sin petición y con el motivo escrito | `AjustesSitio.test.ts`, `lib/ajustes.test.ts` | (el rango y el mismo valor son lo que prueban las dos) | |
| El 409 `espera_cambio` relee, dice el valor nuevo, deja lo pedido en el campo y vuelve a decidir con el plazo de ahora | `AjustesSitio.test.ts` | el `PUT` sin `anterior` (nunca hay 409) | la misma que arriba |
| Guardar el plazo con la petición en vuelo y cambiar de sitio no escribe la respuesta del anterior | `AjustesSitio.test.ts` | quitar la guarda del cambio de sitio | 1 |
| Cada sección se ve con su acción; sin ninguna, el mensaje | `AjustesSitio.test.ts`, `lib/ajustes.test.ts` | `puedeEnSitio` siempre verdadero; la sección del plazo sin mirar la acción | 3 (puro y DOM) y 1 |
| El menú: «Ajustes del sitio» con `ajustes` o con `enlaces`, y ausente sin ninguna; la ruta lleva al mensaje | `App.test.ts` | menú sin mirar `enlaces`; menú siempre visible | 2 y 1 |
| `#/sitio/ajustes` de ida y vuelta, con el código inválido ignorado | `lib/vista.test.ts` | (la ruta reconocida a mano) | |
| «Publicar»: línea de lectura con los valores reales, el enlace con su dirección y ningún campo para cambiarlos | `Publicar.test.ts` | quitar el enlace | 1 |
| La consulta de `afectados`: solo activos, que nunca enviaron, dentro del plazo de hoy y vencidos con el propuesto (`<=`, el borde); una sola consulta con la expresión del estado visual | `consulta/espera.spec.ts` | sin el filtro de activos; sin «dentro del plazo de hoy»; el borde estricto | 1 cada una (el texto de la consulta) |
| `propuesto` inválido → 400 antes del sitio; válido se pasa al servicio; sin él la respuesta no cambia y no hay segunda consulta | `consulta/espera.spec.ts` | `propuesto` sin rango; el controlador sin pasarlo; consultar siempre | 2, 1 y 1 |
| Contra una base real: dentro, el borde exacto, ya vencido, otro sitio, mantenimiento y quien ya envió no cuentan; preguntar no abre ni cierra ninguna condición | `integracion/espera.ts` (`espera-integracion.sh`) | la consulta sin filtrar los activos ni la condición abierta | 3 de 50 (dentro del plazo, propuesto de 10 h y el borde) |
| Las cinco pruebas del k y del tope que estaban en «Publicar» se mudaron sin perder ninguna: cuatro con su nombre y su cuerpo, y la quinta («guardar el k con el `PUT` en vuelo y cambiar de sitio…») sin la mención final «; «Publicar» espera mientras se guarda» ni su aserción, porque «Publicar» ya no guarda el k | `AjustesSitio.test.ts` | el k sin la guarda del cambio de sitio, en el `PUT` y en la relectura | 1 y 1 |
| Mientras se consulta a cuántos afecta, el campo del plazo se bloquea; si cambia igual, la respuesta de la consulta se descarta (ni confirmación ni `PUT`, con o sin afectados): lo que se guarda es lo que se consultó | `AjustesSitio.test.ts` | quitar el descarte de la respuesta con el campo distinto; quitar el bloqueo del campo | 1 y 1 |
| Con una confirmación abierta, volver a pulsar «Guardar» la cierra antes de preguntar otra vez (no queda una vieja activa) | `AjustesSitio.test.ts` | no cerrar la confirmación al empezar a preguntar | 1 |
| La consulta de `afectados` no cuenta a quien ya figura «Sin señal» por una condición de falta de comunicación abierta (dentro del plazo tras alargarlo, hasta el barrido siguiente) | `consulta/espera.spec.ts`; `integracion/espera.ts` | quitar el `NOT EXISTS` de la condición abierta | 1 (el texto de la consulta) |

**Resultado.** Se agregaron 6 pruebas al backend y 23 al panel (más 5 del k y del tope que se mudaron de `Publicar.test.ts` a
`AjustesSitio.test.ts`, sin quitar ninguna). Una comprobación de «Publicar» desapareció con su causa: la espera mientras se guarda el k.
Contra una base real (`espera-integracion.sh`): **50 de 50 comprobaciones** (eran 43; las 7 nuevas son de la vista previa de los afectados).
Con navegador real (`panel-publico-e2e.sh`, Chromium y Firefox, a 390 y 1 280 px): **210 de 210 comprobaciones** (eran 178). La primera
corrida encontró lo que las pruebas sin navegador no ven: a 390 px el clic en «Cambiar en Ajustes del sitio» no llegaba. Una sonda del
elemento bajo el enlace mostró que lo tapaba la ayuda de «Renovar», que en pantalla angosta se fija abajo y dura mientras el foco siga
en el botón (WCAG 1.4.13, `docs/19 §4`, bloque L); y la vuelta a «Publicar» por el menú necesitaba abrir antes el cajón. El recorrido
descarta la ayuda con Escape y abre el cajón con «Menú», como lo haría una persona.

## 87. Diagrama del modelo de datos por dominios, con las columnas en un anexo (18/11/2026)

**Por qué.** El diagrama entidad-relación del informe metía las 25 tablas con todas sus columnas en 13,5 cm de ancho: la letra salía en ≈ 1 pt y no se podía leer. El estudiante decidió (18/11/2026) un diagrama por dominios en el cuerpo, solo con entidades y relaciones, y el modelo completo, con columnas y partido por dominio, en un anexo; con una sola fuente para el dominio de cada tabla y una verificación que lo compruebe.

**Qué se hizo.**
- `docs/08` §2, «Dominios del modelo»: una tabla «Dominio · tablas · de qué se ocupa» con cinco dominios (sitios y dispositivos; recepción y mediciones; alertas y actividad; cuentas y sesión; vista pública). Es la única fuente del dominio de cada tabla. Los grupos de tablas separados por «;» son las partes en que el anexo dibuja un dominio con muchas columnas (sitios y dispositivos en tres, cuentas y sesión en dos): medido con la imagen de `mermaid-cli` del proyecto, un dominio entero de 40 a 70 columnas no pasaba de 3 a 5 pt.
- `informe-oficial/figuras/dominios.py` (lo llama `generar-figuras.sh`): lee el ER completo que sale de la base y esa tabla, y escribe el diagrama del cuerpo (`dominios.mmd`: un `flowchart` con un recuadro por dominio, una flecha por cada par de tablas relacionadas por clave foránea dentro de cada recuadro (el ER de la base hace un `SELECT DISTINCT` del par: `dispositivo` → `pasarela` y `enlace_publico` → `usuario` tienen dos claves y se dibujan como una; la cardinalidad se dibuja siempre «uno a muchos» aunque `estado_dispositivo` → `dispositivo` y `preferencia` → `usuario` sean uno a uno: comprobado en la base) y **una sola flecha por par de dominios**, de recuadro a recuadro y rotulada con las tablas referidas —«sitio», «usuario», «canal, dispositivo»—; diseño ELK porque el de dagre solapa los grupos. Con una flecha por clave foránea entre dominios, las líneas rodeaban el dibujo por los bordes y no se veía qué apuntaba a qué. Los recuadros siguen el orden de las filas de la tabla de `docs/08`, con «Cuentas y sesión» arriba, que es el que menos rodea), un `erDiagram` por dominio o parte (`modelo-*.mmd`: las tablas de otros dominios o partes a las que apunta una clave foránea van sin columnas y con borde punteado) y `modelo-anexo.tex` (las figuras del anexo, con el pie sacado de la columna «De qué se ocupa»).
- `figuras/render/modelo-datos.pdf` (el ER completo, ya sin uso en el informe) se retiró tras comprobar con `grep` que nada lo referencia.
- `generar-figuras.sh`: llama a `dominios.py`; ya no dibuja el ER completo (sigue en `docs/08` §3 y se sigue contrastando con la base); compara las fuentes nuevas y `modelo-anexo.tex`; comprueba que existe el PDF de cada figura y que el cuerpo y el anexo las incluyen; y estima la letra de cada figura con su tamaño real y el alto que le deja la página.
- Informe: `figuras/modelo-datos.tex` pasa a ser el diagrama por dominios; anexo nuevo «Modelo de datos por dominio» (`anexos/i-modelo-datos.tex`); `cap-diseno.tex` presenta los cinco dominios y remite al anexo; `anexos/e-seguimiento.tex` (TT-07) dice dónde está cada vista.

| Qué se comprueba | Falla plantada | Qué cayó |
|---|---|---|
| Toda tabla de la base tiene dominio | quitar `evento` del reparto en `docs/08` | `FALLA reparto en dominios … la tabla evento de la base no tiene dominio` |
| Ninguna tabla tiene dos dominios | agregar `sesion` a «Vista pública» | `FALLA … la tabla sesion está en dos dominios` |
| Todo dominio nombra tablas que existen | agregar `fantasma` a «Sitios y dispositivos» | `FALLA … nombra fantasma, que no existe en la base` |
| Las figuras son las que salen de la base y de `docs/08` | mover `evento` de dominio sin regenerar | `DIFIERE` en `dominios.mmd`, en las dos figuras afectadas y en `modelo-anexo.tex` |
| Toda clave foránea que cruza dos dominios figura en la flecha resumen de su par | quitar «canal» del rótulo de la flecha de sitios y dispositivos a recepción y mediciones | `DIFIERE dominios.mmd` |
| Ninguna flecha entre dominios falta | borrar la flecha «sitio» de sitios y dispositivos a vista pública | `DIFIERE dominios.mmd` |
| La figura del cuerpo no se edita a mano | agregar una flecha a `dominios.mmd` | `DIFIERE dominios.mmd` |
| El anexo no se edita a mano | agregar una línea a `modelo-anexo.tex` | `DIFIERE modelo-anexo.tex` |
| Nada sobra en el informe | una `modelo-*.mmd` o un `render/modelo-*.pdf` que ya no salen del reparto (y `modelo-datos.pdf`, retirado) | `SOBRA …` en cada caso |
| La tabla de dominios se lee entera | un `;` final; una tabla sin comillas invertidas; una fila con la forma rota | `FALLA docs/08: … una parte sin tablas`; `… texto que no es una tabla`; `… filas «\| **…» y solo N legibles` |
| Cada figura tiene su PDF | mover `modelo-vista-publica.pdf` | `FALTA … modelo-vista-publica.pdf` |
| El anexo incluye las figuras | quitar el `\input` de `modelo-anexo` del anexo | `DIFIERE el anexo del modelo de datos no incluye figuras/modelo-anexo` |

**Resultado.** Letra estimada en el informe: cuerpo, 7,2 pt, en un PDF de 1012 × 1291 pt (antes, ≈ 1 pt); anexo, de 6,5 a 7,4 pt según la figura. Compilado: cuerpo en 30 páginas (igual que antes), cero desbordes, cero referencias sin resolver; el anexo nuevo suma 9 páginas fuera del cuerpo.

## 88. Parche de seguridad de nginx 1.30.7 en el proxy (18/11/2026)

**Por qué.** Al desplegar en el servidor de prueba el 18/11/2026, el escáner de imágenes (`plataforma/pruebas/escanear-imagenes.sh`) dijo
«HAY QUE ACTUAR»: la imagen del proxy traía cinco vulnerabilidades altas con versión corregida publicada, todas en el paquete de nginx
mismo (1.30.6-r1 → 1.30.7-r0: CVE-2026-113425, -121810, -123007, -123633 y -123634). No las trajo el código del día: la construcción reusó
las capas anteriores, así que el proxy que ya corría las tenía. El paquete de nginx viene del repositorio de nginx y no del de Alpine: no
se corrige con `apk upgrade`, sino subiendo la imagen base (como el 22/10/2026).

**Qué se hizo.** El `FROM` de `plataforma/proxy/Dockerfile` pasa a `nginx:1.30.7-alpine`, publicada ese mismo día, fijada por su digest de
índice (`docs/11 §3`, fila 7); la lista de parches de Alpine del mismo archivo no cambia.

| Imagen | Antes (críticas / altas / con parche) | Después |
|---|---|---|
| proxy | 0 / 5 / 5 | 0 / 0 / 0 |
| backend, base y broker | sin cambio: ninguna con versión corregida fuera de los residuos documentados | sin cambio |

**Resultado.** El escáner, con todo construido en limpio (`--pull --no-cache`) en el portátil: «OK 4 imágenes: ninguna vulnerabilidad
alta o crítica con versión corregida publicada fuera de los residuos documentados». En el servidor de prueba, el proxy se actualiza con el
despliegue siguiente.

**En el servidor de prueba (18/11/2026).** Desplegado el commit de este parche: respaldo previo correcto (25 tablas, cifrado para los
dos destinatarios) y la guardia del respaldo en 0 h 0 min; el escáner con el proxy en 0 / 0 / 0 y «OK 4 imágenes» (lo que queda en el backend
y en la base no tiene versión corregida publicada, con el aviso conocido de PostgreSQL 16.16); los cuatro contenedores sanos. Los dos avisos de
esa corrida ya estaban documentados: el de `pg_dump` sobre la dependencia circular de los agregados continuos y el del volumen del broker
creado fuera de Compose.

## 89. Exportación por sitio: mediciones, tramas y eventos en CSV, XLSX y JSON, con código propio (19/11/2026)

**Por qué.** HU-08 pedía exportar «un sitio» y hasta hoy solo se exportaban las mediciones de un dispositivo (`GET /dispositivos/{id}/exportar`,
`§19`). El diseño (`docs/19 §4`, bloque R, del mismo día) fija tres conjuntos en un archivo —mediciones, tramas aceptadas con su carga exacta y
su huella, y eventos del ciclo de vida—, tres formatos, el XLSX escrito con código propio y la exigencia de HU-08: que el archivo traiga
todo, exacto. Lo que había que demostrar: ida y vuelta con **0 diferencias** contra la base en los tres formatos, leyendo con lectores escritos
en la prueba; nada del otro sitio (RF-41) ni de personas; la matriz de permisos de las dos rutas; el cupo compartido; que la consulta deja de
pedir tandas cuando el cliente se va; los planes, el tiempo y la memoria con 1 000 000 de mediciones.

**Fuentes primarias, antes del código** (descargadas el 19/11/2026 y guardadas con su huella SHA-256 fuera del repositorio):
- PKWARE, APPNOTE.TXT 6.3.10: cabecera local (§4.3.7, firma 0x04034b50), directorio central (§4.3.12, 0x02014b50), fin de directorio (§4.3.16,
  0x06054b50); bit 3 (§4.4.4): «the fields crc-32, compressed size and uncompressed size are set to zero in the local header. The correct values
  are put in the data descriptor»; descriptor con su firma opcional 0x08074b50, que §4.3.9.4 recomienda escribir; método 8, deflate (§4.4.5);
  ZIP64 cuando un campo no alcanza (§4.4.1.4): tamaños y desplazamientos de 32 bits, 65 535 entradas.
- ECMA-376, 5.ª edición: Parte 1 §12.2 (paquete mínimo: tipos de contenido, relaciones, libro, hojas) y §12.3.20 (un único Styles Part);
  §18.3.1.4 y §18.18.11 (`t="inlineStr"` con `<is><t>`); §18.4.12 (`xml:space`); §22.9.2.19, ST_Xstring (un carácter que XML 1.0 no admite
  se escribe `_xHHHH_`); §22.4.2.4 (el literal se protege: «stored as _x005F_»); §18.8.30 (formato propio con id ≥ 164; «Time 4:36:03.75
  h:mm:ss.00»); §18.17.4.1 (sistema 1900, día 0 = 30/12/1899); §18.3.1.66 (panel congelado). Parte 2: `[Content_Types].xml` y sus espacios de
  nombres. Parte 4 §10.2: los espacios de nombres Transitional, los que se escriben.
- Node.js 22, `zlib.crc32`: «Added in: v22.2.0» (la imagen usa 22.23.4).
- Ningún conflicto con el diseño. Una precisión: la protección del literal está escrita para `bstr` (§22.4.2.4), no en ST_Xstring; se aplica la
  misma regla (bloque R, «Decidido al implementar», f).

**Qué se construyó.**
- `consulta/zip.ts`: zip en flujo (deflate nivel 6 con `node:zlib`, CRC incremental con `zlib.crc32`, descriptor de datos con firma tras cada
  entrada, directorio central al final), con contrapresión (lo que sale de deflate espera a la salida) y topes sin ZIP64: 1 GiB sin comprimir por
  entrada (`cabe()` lo anticipa), 4 GiB − 64 MiB en total (se corta con error antes de entregar el trozo que lo pasaría) y 1 000 entradas.
- `consulta/xlsx.ts`: libro mínimo (tipos de contenido, relaciones, estilos con la fecha `yyyy-mm-dd hh:mm:ss.000` y la cabecera en negrita),
  hojas en flujo con `inlineStr`, números como número, primera fila fija, escape `_xHHHH_` con la protección del literal y el retorno como
  `&#13;`; una hoja sigue en «Mediciones (2)» al llegar a 1 048 575 filas o antes de que su parte pase el tope de bytes; «Acerca de» se escribe
  al final y es la primera pestaña.
- `consulta/exportar-sitio.ts`: los tres formatos sobre tres fuentes que se recorren una vez; el CSV en un zip con `LEEME.txt` (y
  `mediciones-2.csv` si una entrada se llena), la carga de una trama partida en hasta tres columnas de 32 000 caracteres en el XLSX, el JSON con
  `conteos` al final; la estimación y sus bytes por fila.
- `consulta/exportar.ts`: `celdaCsv` con el apóstrofo reversible (cero o más apóstrofos y un carácter de fórmula del conjunto del panel, con
  el salto de línea y las formas de ancho completo); la exportación por dispositivo la usa igual.
- `consulta/consulta.service.ts`: `conConexionExportacion` (una conexión por descarga, 30 s por consulta), `medicionesSitio` por canal,
  `tramasSitio` y `eventosSitio` por dispositivo, con paginación por clave dentro de cada uno; la huella (`sha256`), el tamaño y el base64 salen
  de la base; `estimarSitio` cuenta con tope.
- Rutas en `sitios.controller.ts`: `GET /sitios/{id}/exportar` y `GET /sitios/{id}/exportar/estimacion` (OpenAPI regenerado: 50 rutas y 63
  operaciones); `cupo-exportaciones.ts`, un proveedor con el cupo de 2 para las dos exportaciones y la estimación (429 con `codigo:
  exportaciones_en_curso`; la estimación, además, con 10 s por consulta: cancelarla en el panel no cancela su consulta en la base, y el pool
  de 5 conexiones lo comparte la recepción); `descarga.ts`, la escritura que espera `drain` o el cierre del cliente, ahora también en
  `GET /dispositivos/{id}/exportar`, que retiene los primeros 64 KiB para que una falla de la primera consulta responda 503 en JSON en vez
  de cortar; y `prestarCliente` en `consulta.service.ts`: el cliente que la base corta vuelve al pool con su error (`release(err)`) y se
  descarta (revisión del mismo día).
- Proxy: una `location` para las dos exportaciones con `proxy_buffering off` y las mismas líneas de tasa que «location /».
- `evento.detalle`: revisado en cada escritor de eventos de un equipo (alta, baja, rotación, calibración, configuración, reglas, condiciones
  del supervisor y de las alertas): ninguno lleva nombre, correo ni id de persona. La persona vive en `evento.usuario_id`, que no se exporta.

**Pruebas sin base** (vitest; de 887 a 929 casos en 72 archivos).

| Qué se comprueba | Prueba | Casos |
|---|---|---|
| El apóstrofo reversible: 25 textos difíciles vuelven exactos con la regla inversa; ancho completo, salto, `'=`, `''+`, apóstrofo solo | `exportar.spec.ts` | 9 (antes 8) |
| Lo escrito se lee con `inflateRaw` por el directorio central, el CRC y los tamaños del descriptor coinciden; la misma salida con una salida lenta; topes por entrada, total y de entradas; la salida que falla corta | `zip.spec.ts` | 8 |
| El escape sin pérdida (21 textos, incluidos controles, sustitutos sueltos, `_x0041_` y `_xABCD` seguido de un control); números (−12,5, 1e-7, el mayor double); la fecha de serie y sus milisegundos; el paquete mínimo y el orden de las pestañas; el paso a la hoja siguiente por filas (tope reducido a 3) y por bytes | `xlsx.spec.ts` | 9 |
| Formato y nombre; el corte de la carga en 0, 31 999, 32 000, 32 001 y 87 384 caracteres; los tres formatos con fuentes de prueba; `mediciones-2.csv` sin perder filas; que la fuente deja de entregar filas si la salida falla; la estimación con tope | `exportar-sitio.spec.ts` | 11 |
| El orden de los códigos (404 y 403 antes que 400); el cupo único entre exportaciones y estimaciones (429 `exportaciones_en_curso` al tercero, de un sitio, de un dispositivo o una estimación); la estimación con 10 s y su 503; la falla de la primera consulta da 503 en JSON sin `Content-Disposition` (sitio y dispositivo) y con cabeceras ya enviadas se corta; la retención inicial, `drain` o cierre; la `location` del proxy contra la de «location /» y contra las rutas de Express | `exportar-rutas.spec.ts` | 9 |
| El cliente que la base corta vuelve al pool con su error (`release(err)`), sin RESET; el sano, con RESET y su tope; también si falla el RESET; lo mismo en la exportación por dispositivo | `consulta.service.spec.ts` (con un doble del pool) | 4 nuevos |

Fallas plantadas (cada una se vio caer y se deshizo): `celdaCsv` con la expresión de antes → 2 casos de `exportar.spec.ts`; el descriptor sin
su firma → 2 de `zip.spec.ts`; sin la protección del `_x` → 2 de `xlsx.spec.ts`; `release()` sin el error → 4 de `consulta.service.spec.ts`.

**Prueba de integración** (`plataforma/pruebas/exportar-integracion.sh`, nueva: base desechable sin red con las 26 migraciones, la aplicación
compilada en un puerto efímero de 127.0.0.1). **43 de 43** comprobaciones, más tres externas: `unzip -t` del zip y del libro («No errors
detected») y el analizador XML de Python (cada parte del libro, XML bien formado). Siembra un sitio con los casos límite del punto 7 del bloque
(instantes con microsegundos, `desde` incluido y `hasta` excluido; −12,5, 1e-7 y el mayor double; una unidad con coma y comillas; textos que
empiezan con `=`, `'=` y un apóstrofo solo; saltos, tabulador, controles y un `_x0041_` literal; una trama que no es UTF-8, cuyo base64 empieza
con «+», otra de 64 KiB y otra vacía; dos tramas y dos eventos con el mismo instante; un `detalle` con tildes y emoji; equipos activo, en
mantenimiento y de baja) y otro sitio con siete marcas propias. Comprueba: la matriz de las dos rutas (401, 403 a consulta y operador técnico,
404 a otro sitio e inexistente con el mismo cuerpo, 200 a investigador y administrador); la ida y vuelta de los tres formatos con 0
diferencias en 53 filas, cada `sha256` igual al de su carga y la fecha de planilla igual al milisegundo de cada instante; los conteos de
`LEEME.txt`, de «Acerca de» y de `conteos`; ninguna marca del otro sitio y ningún dato de personas; que con tandas de 2 filas las tres fuentes
dan lo mismo que con una; la estimación; que si la primera consulta falla (plantada en la prueba) la exportación del sitio, en csv y en xlsx,
y la del dispositivo responden 503 en JSON sin `Content-Disposition` y sueltan el cupo; el cupo (dos descargas abiertas y sin leer, y la
tercera 429 `exportaciones_en_curso` sea exportación de sitio, de dispositivo o estimación); y el corte: al cerrar el cliente, el cupo vuelve a 0, no se pide ninguna tanda más en 1,5 s y las conexiones vuelven
al pool. Fallas plantadas: sin la protección del `_x` cayeron 2 comprobaciones (la unidad «_x0041_ y _xABCD␁» volvía como «A y ꯍx0001_»);
con las tramas y los eventos dejando pasar un equipo del otro sitio, 7 (entre ellas RF-41, con las siete marcas).

`sesion-smoke.sh`: las dos rutas en cada columna de la matriz (18 filas nuevas, incluida la que comprueba que la descarga es un zip): **469 de
469** con la pila local (tres capas de Compose). A través del proxy, las dos rutas de exportar llegan al backend, también con mayúsculas y
barra final.

**Medición** (1 000 000 de mediciones de 20 canales en 25 días, 100 000 tramas SenML de ≈ 120 bytes y 10 000 eventos; en la misma base, otro
sitio de 380 canales con 950 000 mediciones en la misma ventana). La aplicación compilada en un proceso aparte (`node dist/main.js`, como en la
imagen); su memoria residente, de `/proc` cada 20 ms; el cliente lee y descarta.

| Formato | Tiempo | Descargado (bytes; MB de 10^6) | Memoria residente del proceso, al empezar → pico (MB de 10^6) |
|---|---|---|---|
| csv (.zip) | 5,2 s | 14 350 925 (14,4 MB) | 145,2 → 275,6 MB |
| xlsx | 7,4 s | 25 436 001 (25,4 MB) | 275,7 → 287,1 MB |
| json | 3,7 s | 214 507 221 (214,5 MB) | 287,1 → 288,4 MB |
| csv y json a la vez (el cupo lleno) | 5,9 s | 228 858 147 (228,9 MB) | 286,2 → 289,8 MB |

MB de 10^6 bytes, los que muestra el panel (`lib/exportar.ts`); hasta la revisión del mismo día esta tabla daba MiB rotulados MB. La primera
exportación lleva el proceso de ≈ 145 a ≈ 276 MB y ahí queda (el montón de V8 crece y no se devuelve); empezando por el JSON pasa lo mismo
(148 → 264 MB), y con tandas de 2 000 filas en vez de 10 000 el pico no bajó (281 MB): es el ritmo de asignación, no el zip ni el tamaño de
la tanda. Con el cupo lleno, 290 MB, bajo el límite de 512 MiB (537 MB) del contenedor del backend (la prueba exige menos de 450 MB).

**Planes** (`EXPLAIN (ANALYZE, BUFFERS)` sobre esos datos; ninguno recorre `medicion`, `trama` ni `evento` de forma secuencial).

| Consulta | Índice | Tiempo | Búferes |
|---|---|---|---|
| Mediciones, primera tanda de 10 000 de un canal | `uq_medicion_canal_tiempo` (por fragmento, hacia atrás) | 7,0 ms | 2 456 |
| Mediciones, tanda del medio | `uq_medicion_canal_tiempo` (bitmap) | 22,9 ms | 5 909 |
| Tramas, tanda del medio de un dispositivo (250) | `idx_trama_dispositivo_id` | 1,2 ms | 17 |
| Eventos de un dispositivo, primera tanda (≈ 500 filas) | `idx_evento_dispositivo_id` (bitmap y orden aparte) | 0,5 ms | 16 |
| Eventos de un dispositivo, tanda siguiente (con clave) | `idx_evento_dispositivo_ocurrido_en_id` (bitmap) | 0,3 ms | 14 |
| Estimación: contar 1 000 000 de mediciones (tope 1 000 001) | `uq_medicion_canal_tiempo` por canal | 479 ms | 236 448 |
| Estimación: contar 100 000 tramas | `idx_trama_dispositivo_id` por dispositivo | 46 ms | 4 794 |
| Estimación: la trama más antigua del rango | `idx_trama_dispositivo_id`, solo índice | 0,3 ms | 247 |

`idx_evento_dispositivo_id` (sobre `dispositivo_id`) no aparece por su nombre en `db/init`: lo crea la convención de claves foráneas de la
migración 05 (`'idx_' || tabla || '_' || columna`), y la 23 lo nombra en su comentario; la prueba lista los índices de `evento` de la base y
fija ese nombre completo en su comprobación. Con un dispositivo de ≈ 500 eventos el planificador prefiere leerlos todos por él y ordenarlos;
con la clave de una tanda siguiente usa el de la paginación, `idx_evento_dispositivo_ocurrido_en_id` (migración 23).

Con solo los 20 canales del sitio en la base, el planificador elige el índice de tiempo de la hypertable y filtra por canal (≈ 15 ms por
tanda; forzado el de canal, ≈ 9 ms): con tan pocos canales los dos son baratos. Con los 380 canales del otro sitio pasa a
`uq_medicion_canal_tiempo` y el costo de la tanda deja de depender del resto de la instalación (medido en una base aparte y en la prueba, que
lo comprueba). Una cuenta de un millón tarda ≈ 0,5 s porque visita el montón (base recién cargada, sin el mapa de visibilidad).

**Bytes por fila** del archivo descargado (bytes de cada entrada o lista ÷ filas), los de la estimación: csv 8,9 (mediciones), 51,9 (tramas)
y 29,9 (eventos), más 1 776 fijos; xlsx 19, 60,6 y 37,8, más 4 337; json 172,9, 395,5 y 208,2, más 284. La prueba compara la estimación del
banco con lo descargado (exige menos de 25 % de diferencia; en la última corrida, 0,0 % en csv y 0,1 % en xlsx y json). Las tramas del banco pesan ≈ 120 bytes: una de 64 KiB pesa mucho más
y la estimación la subestima.

**Revisión con LibreOffice** (conversión sin interfaz de un libro de muestra a CSV por hoja, 19/11/2026; no es parte de la prueba): abre las
cuatro hojas sin error; `_x005F_x0041_` vuelve como `_x0041_` y `_x0001_` como el control; `=SUMA(A1)` queda como texto; la fecha sale con
sus milisegundos; la carga partida, en 32 000, 32 000 y 23 384 caracteres. En el CSV que escribe LibreOffice, el retorno de carro dentro de
una celda sale como salto de línea (no se averiguó si lo cambia al leer o al escribir); el lector de la prueba lo recupera exacto.

**Apertura con LibreOffice Calc, mirada como la vería una persona** (19/11/2026; el libro que deja `exportar-integracion.sh`, datos sintéticos,
abierto y llevado a PDF por LibreOffice y revisado página por página): abre sin aviso de error, con las cuatro hojas; «Acerca de» dice formato,
sitio, rango, retención, cada columna y los conteos (43 mediciones, 5 tramas y 5 eventos, los mismos de la base); la cabecera en negrita;
`fecha_utc` se muestra como fecha y hora con sus milisegundos («2026-11-14 10:00:00,123») junto al texto exacto con microsegundos; las dos
tramas recibidas en el mismo microsegundo salen las dos. El mismo libro, abierto con la interfaz de LibreOffice Calc y en Excel para la web
(19/11/2026, con captura): los dos lo abren sin aviso de reparación, con las cuatro pestañas y «Acerca de» completo. Con eso se cumple el
punto 7 del bloque R (la apertura en una planilla real).

**Panel: la pantalla P8** (bloque R, puntos 6 y 8; mismo día). `Exportar.svelte` en `#/exportar?sitio=<código>`, con lo puro en
`lib/exportar.ts`; la entrada «Exportar datos» del menú; el enlace «Exportar todo el sitio» de la ficha; `nombreDeArchivo` con `.zip` y `.xlsx`
y el `Accept` de `descargar()` con los dos tipos nuevos. Lo decidido fuera del diseño, en `docs/19 §4`, R, «Decidido al implementar la
pantalla».

Por el DOM y funciones puras (vitest): de 480 a 518 pruebas del panel (it/test) en 43 archivos (antes 41), 582 ejecuciones (antes 544);
la corrección del mismo día tras la revisión independiente y el cupo compartido con la estimación (abajo) sumó 5 de esas pruebas.

| Qué se comprueba | Prueba | Casos |
|---|---|---|
| Al abrir, los últimos 30 días con el texto, el tamaño del formato elegido y la retención; cada rango con su ventana; una estimación a la vez (la anterior, cancelada); la respuesta vieja de otro rango y de otro sitio, descartada aunque llegue; «Entre fechas» en la hora del sitio (Isla de Pascua) con sus errores junto a los campos y sin petición; sin filas; la estimación que falla, con «Reintentar»; los tres formatos con su nombre y el aviso; la confirmación sobre 250 MB (sin petición hasta «Descargar igual»); «Cancelar»; el 429 del cupo, sin red y el corte a mitad sin archivo guardado; salir de la pantalla corta lo que está en vuelo; sin la acción, quién exporta; desde la corrección: escribir una fecha no pide una estimación por tecla (una sola, tras la pausa), el 429 del cupo al estimar con un solo reintento (si responde, sin aviso; si se repite, el aviso en llano con «Reintentar», sin un tercer intento solo, y «Descargar» que espera y se activa al llegar la estimación), un cambio de rango que anula el reintento pendiente, el 503 de la estimación sin reintento, y en la descarga el 429 reconocido por su código (el texto de siempre sin el código es otro caso) y el 503 | `Exportar.test.ts` | 17 |
| Los cinco rangos, «Entre fechas» en dos zonas, el día del cambio de hora (23 horas), los días que no sirven, el piso del año 2000, las rutas y la clave; textos de la estimación (singular, tope, sin filas), tamaños, retención (con el margen), umbral de confirmación en el borde, avisos (429 del cupo por su código y del proxy, 503, sin red, corte, cancelación; los de la estimación) y quién exporta según la matriz | `lib/exportar.test.ts` | 15 |
| El menú con y sin la acción y la ruta (`App.test.ts`, 2 nuevos y el orden del menú); el enlace de la ficha solo con la acción (`Ficha.test.ts`, 1); la ruta de ida y vuelta (`vista.test.ts`, 1); `.zip` y `.xlsx` aceptados y siete extensiones rechazadas, y el `Accept` (`api.test.ts`, 1 nuevo y 1 ampliado); la hora que no existe por el cambio de hora al oeste y al este de UTC (`tiempo.test.ts`, 1) | varios | 6 |

Fallas plantadas (cada una se vio caer y se deshizo, comparando el archivo con su copia): la estimación sin cancelar (una señal nueva en vez
de la de `ultimaGana`) → 1 caso de `Exportar.test.ts`; sin descartar la respuesta de otra clave → 2; `instanteDesdeLocal` de antes y la
retención sin margen → 3 casos entre `tiempo.test.ts` y `lib/exportar.test.ts`. En la corrección: reconocer el 429 por el texto del mensaje
(el de hoy) en vez de por su código → 5 casos (3 de `Exportar.test.ts` y 2 de `lib/exportar.test.ts`); pedir la estimación sin la pausa → 2;
sin el reintento único → 2.

**Corrección del mismo día** (revisión independiente y cambio del backend: el 429 de las tres rutas trae `codigo: 'exportaciones_en_curso'`,
la estimación comparte el cupo y tiene 10 s por consulta, y las exportaciones responden 503 en JSON si fallan antes de enviar el archivo). El
panel reconoce el cupo por el código (el cuerpo ya llegaba entero en `ErrorApi.cuerpo`, sin cambiar `lib/api.ts`); pide la estimación 300 ms
después del último cambio; ante el 429 la reintenta una sola vez a los 1,5 s; dice el 429 que se repite y el 503 en llano con «Reintentar»; y
el 503 de la descarga, también. La ficha usa los mismos avisos en sus dos descargas de CSV. Reglas en `docs/19 §4`, R, «Decidido al
implementar la pantalla», (c), (e) y (f).

Con navegador real: `bash plataforma/pruebas/panel-exportar-e2e.sh` (nuevo; recorre `panel/e2e/exportar.mjs`), contra la pila local de tres
capas con el backend reconstruido. Siembra un sitio desechable en Isla de Pascua (`Pacific/Easter`, UTC−05:00 en noviembre) con 2 equipos, 72
mediciones, 10 tramas y 2 eventos, y una persona de descarte con perfil de investigación por caso (`@ejemplo.invalid`); el navegador corre en
la zona de Tokio. Por caso: de la ficha a la pantalla con «Exportar todo el sitio»; la entrada del menú; la estimación dice lo sembrado y la
retención; los tres formatos bajan con el nombre `sitio_<código>_<desde>_<hasta>`, el zip y el xlsx empiezan con `PK\x03\x04` y el JSON se
interpreta con el sitio y los conteos sembrados; «Entre fechas» abre con la última semana y la pide de 00:00 a 00:00 en la hora del sitio; un
último día después de hoy se dice junto a los campos sin pedir nada; sin desplazamiento horizontal ni errores de JavaScript. Todo se borra al
salir. **76 de 76** comprobaciones en Chromium 158 y Firefox 159, a 390 y a 1 280 px (corrida también tras la corrección, con el backend
reconstruido: 76 de 76; el paso de «Entre fechas» espera la respuesta de la estimación, que ahora llega tras la pausa). Las dos primeras corridas encontraron dos fallas reales,
corregidas antes de esta: la retención decía «solo desde hoy» en «Últimos 30 días» (el corte se comparaba sin margen, con milisegundos de
diferencia) y, en Firefox a 390 px, la ayuda emergente de «Descargar», que bajo 700 px se fija al pie de la pantalla, tapaba el propio botón
(el `Tooltip` común tiene ese caso con cualquier botón que quede al pie; aquí se quitó la ayuda de los dos botones).

`pnpm verificar` en `plataforma/backend`, tras la corrección: tipos, lint, 929 de 929 del backend en 72 archivos, `svelte-check` sin errores
en 430 archivos, las 518 pruebas del panel (582 ejecuciones) en 43 archivos y el paquete construido.

**Lo que queda.** El lector XLSX del alta masiva (bloque N, punto 6), decidido y sin construir; y el caso del `Tooltip` al pie de la pantalla bajo 700 px, que no es solo de esta pantalla.
`panel-exportar-e2e.sh` ya corre en el paso 4c del guardián, junto a los otros dos e2e del panel.

**En el servidor de prueba (desplegado el 19/11/2026, comprobado en el navegador el 20/11).** «Acerca de» muestra el commit del despliegue;
«Exportar datos» del sitio del campus descargó el XLSX; en el teléfono, los botones de la exportación se pulsan sin que una ayuda los tape.
Sin novedades. El escáner de ese despliegue dio «HAY QUE ACTUAR» por el servidor PostgreSQL de la base, no por estos cambios (§92).

## 90. Alta masiva sin fricción: la fila mal formada, las unidades, los avisos, las palabras y el teléfono (19/11/2026)

**Por qué.** Un recorrido en navegador real del mismo día (Chromium y Firefox, a 390 y 1 280 px) mostró que la velocidad sobraba y la
fricción no: con 60 filas, dos mal formadas rechazaban el archivo entero sin revisión; «°C» y «%» no entraban; «zona resuelta por su nombre»
salía como aviso en 500 de 500 filas y la línea de avisos no contaba lo mismo que su tarjeta; los motivos traían nombres de columna
(«id_fisico repetido», «intervalo_esperado_s debe ser…»); a 390 px Playwright no pudo pulsar «Volver» ni «Crear» porque la ayuda emergente,
fija al pie, recibía el clic; «atrás» con credenciales sin descargar las perdía; un `.xlsx` decía «la cabecera tiene una sola columna
(«PK…»)»; y el e2e del lote dejaba dos equipos en el banco. El diseño es el bloque S de `docs/19 §4`; lo que no fijaba quedó al final
del bloque.

**Qué se construyó.** Backend: `alta/unidades.ts` (la única tabla de escrituras de unidad y cómo se lee cada una); en `alta/lote.ts`, los
motivos y avisos en palabras de la persona (los de `validarAlta` se traducen; sus textos de la API no cambian), los avisos solo en las filas
que entran, `zonas_por_nombre`, `legible`, `rotulo` y `simbolos` en la plantilla, la magnitud más cercana y los 400 de una celda con las
palabras del panel; el nombre del sitio en la consulta de los catálogos. Panel: `lib/lote.ts` deja fuera solo la fila mal formada
(`noEntran`, `motivoDeCelda`, `filaQueNoEntra`, `mezclarPlan`) y reconoce un libro de Excel; `lib/lote-memoria.ts` guarda el borrador y
las credenciales sin descargar; `lib/revision.ts` usa lo que escribe el servidor y suma el resumen; `AltaLote.svelte`, los botones y las
ayudas a la vista, «Abrir su ficha», el foco y la lectura que descarta la anterior; `app.css`, la ayuda emergente que no recibe toques en
una pantalla táctil. Pruebas: el catálogo fijo `panel/e2e/datos/lote-escenarios.csv` (60 filas sintéticas, con lo esperado en `.json`) y
`pruebas/panel-lote-e2e.sh`, que reemplaza a `banco.sh lote-navegador` y corre en el paso 4c del guardián.

**Correcciones del mismo día, tras una revisión independiente** (cada una con su prueba): (a) el borrador sobrevivía a una sesión vencida y
lo veía quien entrara después en la pestaña: ahora guarda quién lo leyó y, si entra otra persona, se descarta entero (la misma lo
retoma); (b) la ayuda emergente dejaba de admitir el puntero en una ventana angosta con ratón: la regla pasó a `(max-width: 700px) and
(hover: none)`; (c) el texto viejo «identificador no disponible» seguía en la descripción del OpenAPI, en `docs/11`, `docs/19`, el README del
backend y la prueba `sesion-smoke.sh`; (d) un `canales` con solo separadores caía en «la fila no entra»; (e) cancelar la ventana de elegir
archivo cortaba una revisión en vuelo; (f) el texto del largo decía «caracteres» donde se cuentan bytes, y el de un símbolo no nombraba que
«°» y «º» sí se admiten en `canales`, y la familia Celsius se lee ahora sin distinguir mayúsculas; (g) el archivo de credenciales dice, por
equipo, a dónde envía (`destino`); (h) el e2e borra el directorio temporal de las credenciales de descarte. Al repetir los e2e del panel
apareció un daño propio del bloque: `e2e/sesion.mjs` pulsaba `[data-crear-lote]` con un localizador estricto, que con los botones repetidos
encuentra dos; ahora pulsa el de arriba, y su comprobación del archivo de credenciales espera `destino`.

**Por unidad.** Backend: 942 de 942 en 73 archivos (antes 929 en 72): 13 pruebas nuevas, entre ellas el catálogo contra `validarLote`
(58 filas enviadas, 44 se crean, 1 ya existe, 13 no entran y 3 con aviso; con las 2 que deja fuera el panel, 60 y 15), «°C» y «%» con su
aviso y el mismo plan que con la unidad del catálogo, otra unidad que no entra, la zona por su nombre dicha una vez, cada regla del alta
de a uno en palabras sin jerga, «°C» en `canales` en el límite del tope en bytes (cabe en `MAX_BYTES_LOTE`, un byte más es 400, con el
texto que dice cómo se contó), la familia Celsius sin distinguir mayúsculas, el `canales` con solo separadores y el `destino` de cada vía.
Panel: 539 pruebas (599 ejecuciones) en 43 archivos (antes 518 y 582): la fila mal formada que no frena a las demás, el bloque de textos de
una celda igual al del servidor, letra por letra, el catálogo leído (58 enviadas y 2 que no entran, con su motivo), el archivo de
credenciales con su `destino` en las tres vías y, por el DOM, cada punto de S1 a S10, con la otra persona que entra tras un vencimiento y
la ventana de elegir archivo cancelada.

**Fallas plantadas** (cada una deshecha después y la prueba en verde otra vez):

| Falla plantada | Dónde | Qué cayó |
|---|---|---|
| Volver a rechazar el archivo entero si una fila está mal formada | `panel/src/lib/lote.ts` (`comprobar`) | caen 8 casos del panel: los de S1 en `lote.test.ts` (también el catálogo) y en `Alta.test.ts` |
| La ayuda emergente fija al pie vuelve a recibir clics (sin `pointer-events: none`; en la primera versión de la regla) | `panel/src/app.css` | la prueba de S6 en `Alta.test.ts` y, con el panel de `pnpm dev`, el e2e en Chromium a 390 px («la ayuda … deja pasar toques»: `pointerEvents` «auto» y el centro de la ayuda es la ayuda) |
| Lo anterior más la ayuda emergente de vuelta en «Volver» y «Crear» (el estado del recorrido) | `AltaLote.svelte` y `app.css` | el e2e en Chromium a 390 px: «<span role="tooltip"> intercepts pointer events» al pulsar el «Volver» de abajo, el mismo defecto que vio el recorrido |
| El aviso de la zona por su nombre en todas las filas | `src/alta/lote.ts` | 4 pruebas del backend (avisos, S3 y dos del catálogo) |
| «°C» y las demás escrituras de unidad rechazadas | `src/alta/unidades.ts` | 2 pruebas del backend (S2 y lo legible) |
| Un motivo de `validarAlta` sin traducir («intervalo_esperado_s debe ser…») | `src/alta/lote.ts` (`enPalabras`) | 3 pruebas del backend (los motivos por campo, la prueba de la jerga y la del catálogo) |
| Sin descartar el borrador de otra persona al abrir el alta masiva | `AltaLote.svelte` (`retomarLoteDe`) | la prueba por el DOM de la otra persona que entra tras un vencimiento |
| `nuevoOrigen()` antes de mirar si se eligió archivo | `AltaLote.svelte` (`leerArchivo`) | la prueba por el DOM de la ventana cancelada durante una revisión en vuelo |

**En navegador real.** `bash plataforma/pruebas/panel-lote-e2e.sh`, contra la pila de desarrollo con el backend reconstruido con sus tres capas
(`docker-compose.yml`, el override y `proxy/compose.proxy.yml`) y `--no-deps`: **150 de 150 comprobaciones**, 75 en Chromium 158 y 75 en
Firefox 159, a 390 px (un teléfono táctil emulado, `hasTouch` e `isMobile`: los dos navegadores dan `hover: none`) y a 1 280 px. Al salir, lo sembrado y lo creado se borró y el conteo de lo que quedó fue 0 en sitios, zonas, dispositivos,
credenciales, personas, eventos, sesiones y permisos. Comprueba: el libro de Excel reconocido; el catálogo de 60 que abre la revisión con
las tarjetas 60, 44, 1, 15 y 3, la línea de avisos igual a su tarjeta, las dos zonas dichas una vez con el nombre del sitio, los 20
escenarios con su resultado y su texto, y ningún texto a la vista con jerga entre más de 100; «Ya existe» en ámbar con «Abrir su ficha»,
que abre la ficha; lo descargado, que vuelve a subirse y dice lo mismo en 13 de 15 filas (la repetida y la de la celda de más ya no fallan
por eso); el «Volver» de abajo y «Crear» pulsados como persona; dos equipos creados por HTTP, con su destino `POST /recepcion/{id_fisico}` en el
archivo de credenciales, «atrás» y «adelante» con sus credenciales sin descargar (vuelven, nunca dibujadas ni en la dirección ni en el
almacenamiento del navegador) y el foco tras «Ya las guardé»; la ayuda emergente del inventario en el teléfono, que deja pasar el toque,
se lee entera (12,8 px de letra, 366 px de ancho) y no desplaza la página, y con ratón, a 390 px y en escritorio, admite el puntero encima.
Los otros e2e que tocan el alta masiva, repetidos tras las correcciones: `panel-sesion-e2e.sh`, **330 de 330**; `sesion-smoke.sh`, **469 de
469**.

**Mediciones** (la revisión de 500 filas, del clic a la tabla pintada, y cada «Mostrar 100 más», en la página con `performance.now()`, en el
equipo de desarrollo, sin la CPU frenada):

| Navegador | Ancho | Revisión de 500 (umbral 1 s) | Cada «Mostrar 100 más» (umbral 0,3 s) |
|---|---|---|---|
| Chromium 158 | 390 px | 65 ms | 44, 44, 44 y 44 ms |
| Chromium 158 | 1 280 px | 66 ms | 41, 43, 44 y 45 ms |
| Firefox 159 | 390 px | 72 ms | 42, 43, 41 y 57 ms |
| Firefox 159 | 1 280 px | 79 ms | 34, 59, 38 y 40 ms |

`pnpm verificar` en `plataforma/backend`: tipos, lint, 942 de 942 del backend en 73 archivos, `svelte-check` sin errores en 432 archivos,
las 599 ejecuciones del panel en 43 archivos y el paquete construido.

Con la regla de `app.css`, que vale para todo el panel, se cierra también el caso de la ayuda emergente al pie bajo 700 px que el `§89` dejaba
pendiente.

**Lo que queda.** El lector XLSX propio (bloque N, punto 6): hecho en el §91.

## 91. Lector propio de libros .xlsx en el alta masiva: el mismo camino que un CSV, con sus topes (19/11/2026)

**Por qué.** Hasta el bloque S, un `.xlsx` elegido en el alta masiva se reconocía por la firma del zip y se pedía guardarlo como CSV (S9). El
bloque N (punto 6 de `docs/19 §4`) decidió el 15/11/2026 leerlo en el navegador con código propio, sin dependencia nueva, con sus límites
escritos, y que desde ahí siga el mismo camino que un CSV: la comprobación de la cabecera y de cada celda (S1 y S2) y la revisión del servidor.

**Fuente primaria, antes del código.** browser-compat-data de MDN (`api/DecompressionStream.json`, último commit que lo tocó
`0eaec968cd2352d49daf25fb7b67e5a7fc2a0532`), la especificación Compression de WHATWG y la página de MDN del constructor, descargadas el
19/11/2026 con su huella. La entrada `DecompressionStream.deflate-raw` dice `"version_added": "103"` para Chrome (Edge, espejo), `"113"` para
Firefox y `"16.4"` para Safari; la especificación: «If format is unsupported in DecompressionStream, then throw a TypeError» y «It is an error
if there is additional input data after the final block indicated by the BFINAL flag». El objetivo de compilación del panel (Vite 8.3.6:
`chrome111`, `edge111`, `firefox114`, `safari16.4`) ya los incluye: el remedio de pegar queda para un navegador más viejo y para cuando el
lector no se pudo descargar. No contradice el diseño. La regla de los números usa la precisión de Excel de la página de Microsoft «Excel
specifications and limits» (descargada el mismo día): «Number precision 15 digits».

**Qué se construyó.** `panel/src/lib/xlsx-lector.ts` (nuevo, sin importaciones): el zip (fin de directorio, ZIP64, directorio central,
cabecera local, métodos 0 y 8, CRC-32), un lector de XML por trozos y las partes del libro, con los topes de `TOPES_XLSX`. En `lib/lote.ts`,
`leerArchivoLote` (el único punto de entrada de un archivo elegido: por la firma, el libro va al lector, cargado con `import()`; el contenedor
del Office antiguo se dice; lo demás se lee como texto UTF-8, como antes), `deLibro` (la primera hoja → cabecera y filas con su `n` de la
planilla, y de ahí a `comprobar`), `textoDeNumero`, `columnaEnLetras` y `TEXTOS_LIBRO`; los casos `libro_ilegible`, `libro_grande` y
`libro_sin_lector` reemplazan a `libro_excel`, y la acción `pegar` («Pegar las celdas»). `comprobar` dice cada columna desconocida una vez. En
`AltaLote.svelte`, la lectura por bytes, el campo que acepta `.xlsx` y el remedio que lleva al campo de pegar. Lo decidido al construir quedó
en el punto 6 del bloque N.

**Los libros de prueba.** Reales, en `panel/e2e/datos/`: `lote-escenarios.xlsx`, el catálogo de 60 escenarios importado por LibreOffice
v26.8.2.2 desde `lote-escenarios.csv` (`libreoffice --headless --infilter="CSV:59,34,76,1,,0,false,false,false,false,false,0,false"
--convert-to xlsx`, con un perfil propio en una carpeta temporal: `-env:UserInstallation=file:///…`); el decimotercer valor en `false` es
«evaluar fórmulas»: con él, LibreOffice convierte la celda `=HYPERLINK(…)` en una fórmula que en su idioma da `#NAME?`, y el libro ya no
sería el mismo archivo que el CSV. `libro-libreoffice.xlsx`, hecho con `--convert-to xlsx` desde `libro-libreoffice.fods` (su fuente, en
la misma carpeta): dos hojas, un identificador como número, una fecha, fórmulas de texto y de número con su resultado, «0.00» sobre 12,375,
un error `#DIV/0!`, un valor lógico (LibreOffice lo guarda como el número 1), un salto de línea y un «_x0041_» literal. `libro-exportado.xlsx`,
escrito por el escritor propio del backend (`escribirExportacionSitio`, HU-08) con datos sintéticos: celdas sin referencia `r`, texto en
línea y «Acerca de» como primera hoja. Ninguno lleva datos de personas (el autor de LibreOffice va vacío). Armados a mano
(`panel/src/lib/xlsx-prueba.ts`, solo para las pruebas): cada límite y cada ataque.

**Por unidad.** Panel: **583 pruebas (647 ejecuciones) en 44 archivos** (antes 539 y 599 en 43). `xlsx-lector.test.ts`, 33 nuevas (25 de
la construcción y 8 de las correcciones del mismo día, más abajo): los
tres libros reales; la celda sin `r` y con `<c/>`; corridas, lecturas fonéticas, «_x000D_», «_x005F_x0041_», CDATA y referencias
numéricas; fórmulas con y sin resultado guardado; 13 formatos de número contra la regla de fecha; la primera hoja visible según `<sheets>`;
prefijos de espacio de nombres, partes sin comprimir y ZIP64; 501 y 502 filas; una hoja de un millón de filas (49 000 246 bytes al abrirla, 49 MB de 10^6 bytes; 144 kB el
libro) cortada en la fila 502; la zip bomba, también con el tamaño declarado en 100 bytes; el tope total con tres partes; 500 filas llenas
con cada carácter escrito «&amp;» (menos de 5 MB, bajo el tope de 8 MiB, que la pantalla dice «8,4 MB»); 1 000 y 1 001 partes; 50 000 y 50 001 cadenas; el `<!DOCTYPE>`
(con la «bomba de mil millones de risas») en cada una de las seis partes que se leen; entidades no definidas; tres rutas que salen de
`xl/` y una externa; la hoja que falta, un gráfico y un libro sin hojas visibles; contraseña, CRC, tamaño, nombre local distinto, nombres
repetidos (también con otras mayúsculas), otra compresión y un deflate cortado; un `.ods`, un `.xlsb`, un `.docx` y un zip vacío; XML mal
formado o incompleto, UTF-16, filas y celdas fuera de orden, una cadena compartida que no existe, y el navegador sin `DecompressionStream`.
`lote.test.ts`, 9 más (14 ejecuciones, y una menos: el caso `libro_excel`): el catálogo como libro da **las mismas filas** que su CSV y
las mismas 2 que no entran (solo cambia el motivo de la celda de más); cada tipo de celda del libro de LibreOffice con su regla; la
exportación por sitio se rechaza por sus columnas («se lee la primera hoja»); los números de planilla (`0.30000000000000004` → «0,3»,
`60.5` → «60,5»); identificador y pasarela como número, fecha por estilo, valor lógico y fórmula sin resultado; «_x000D_» dentro de un
texto; datos en columnas sin cabecera; 500 y 501 filas, hoja vacía y solo la cabecera; un archivo que no es un libro no descarga el lector;
y los seis casos del libro en la tabla de errores (cada caso con su prueba). `Alta.test.ts`, 2 más, por el DOM: el catálogo como `.xlsx`
manda al servidor las mismas filas que su CSV, y sin el descompresor el aviso ofrece «Pegar las celdas», que lleva al campo. Tres pruebas
viejas leían el archivo con `text()` y ahora lo leen con `arrayBuffer()`; el doble de `URL` de esas pruebas pasó a ser un constructor
(el `import()` del lector lo usa). Backend: sin cambios, **942 de 942 en 73 archivos**.

**Fallas plantadas** (cada una deshecha después y las pruebas en verde otra vez):

| Falla plantada | Dónde | Qué cayó |
|---|---|---|
| El tope por parte con el tamaño que declara el zip, sin contar mientras se descomprime | `xlsx-lector.ts` (`Zip.trozos`) | 2 pruebas: la zip bomba que declara 100 bytes, y la hoja de un millón de filas, que el tamaño declarado (49 MB) rechazaba antes de leer las primeras 502 |
| Leer la última hoja de `<sheets>` en vez de la primera visible | `xlsx-lector.ts` (`leerXlsx`) | 5 pruebas: los libros de LibreOffice y de la exportación, en el lector y en `lote.test.ts`, y la del orden de `<sheets>` |
| Saltar el `<!DOCTYPE>` en vez de rechazarlo | `xlsx-lector.ts` (`LectorXml`) | 2 pruebas: la de las seis partes y el caso del libro en la tabla de errores |
| No detenerse en `max_filas` + 1 filas | `xlsx-lector.ts` (`leerXlsx`) | 1 prueba: la hoja de un millón de filas cae por el tope por parte |
| Escribir como texto el identificador guardado como número | `lote.ts` (`COLUMNAS_IDENTIFICADOR` vacía) | 2 pruebas: el libro de LibreOffice y la del identificador y la pasarela |
| La expresión de atributos de antes (`([^\s=/]+)\s*=\s*…`), con el tope de 16 KiB puesto | `xlsx-lector.ts` (`LectorXml.etiqueta`) | 2 pruebas: las 40 etiquetas de 16 000 caracteres (sin error y fuera de tiempo) y la de los atributos mal formados |
| La forma del número de antes (`\d+\.?\d*`) | `xlsx-lector.ts` (`NUMERO_XSD`) | 1 prueba: los 100 000 dígitos con una letra al final (15,1 s medidos con el lector anterior) |
| Sin el tope de 16 KiB por etiqueta | `xlsx-lector.ts` (`LectorXml.alimentar`) | 2 pruebas: la etiqueta de 300 000 caracteres y el atributo sin cerrar de 8 MiB |
| El lector anterior a las correcciones, entero, contra las pruebas nuevas | `xlsx-lector.ts` | caen el formato de número hostil (29,7 s), las 40 etiquetas (8,0 s, sin error), el número que desborda, la etiqueta de 300 000 caracteres (70,1 s, sin error) y el atributo sin cerrar de 8 MiB (5,2 s); la prueba del texto de 7 MB pasa igual (1,8 s; 1,25 s con las correcciones): no distingue, solo comprueba que se lee entero |

**Correcciones del mismo día, tras una revisión independiente** (cada una con su prueba): (a) la expresión que leía los atributos
retrocedía sobre un tramo largo sin espacios, «=» ni «/»: una etiqueta de 300 000 caracteres, en un libro de menos de 5 kB, tardaba 70,1 s
(medido aquí; la revisión midió 7,8 s con 100 000). Ahora una etiqueta de más de 16 KiB hace ilegible el libro y los atributos se leen en una
sola pasada, con su forma `nombre="valor"`: la misma etiqueta se rechaza en 22 ms. Con la misma forma de riesgo se rehicieron la forma de un
número (`\d+\.?\d*` retrocedía sobre 100 000 dígitos: 15,1 s; ahora 5 ms) y la regla de un formato de fecha (recorría el resto del formato
por cada «[» sin cerrar: la prueba con 200 000 «[» y otros dos formatos hostiles tardaba 29,7 s; ahora se recorre una vez). (b) Una marca sin cerrar se volvía a recorrer entera con cada trozo (8 MiB
en un atributo sin cerrar: 5,2 s); ahora recuerda hasta dónde se buscó y el texto se entrega a medida que llega: 22 ms. (c) Los
formatos implícitos de fecha 27 a 36, 50 a 58 y 71 a 81 tienen su fuente: las tablas «zh-tw and zh-cn», «ja-jp and ko-kr» y «th-th» de la
misma §18.8.30 de ECMA-376 Parte 1 (pp. 1778 a 1781), con una prueba por cada borde de rango y por los id que no están en ninguna tabla.
(d) El nombre de la hoja que viene del archivo va recortado a 60 caracteres en los mensajes. (e) Los topes se dicen en la unidad de la
pantalla (10^6 bytes): «8,4 MB» y «16,8 MB», y una prueba compara el texto del lector con `megas`. (f) Un número que desborda («1e400»)
hace ilegible el libro y, si llegara igual, su fila no entra; ya no se escribe «Infinity». (g) Lo comprimido entra al descompresor en
tajadas de 8 KiB, a pedido.

**En navegador real.** `bash plataforma/pruebas/panel-lote-e2e.sh`, contra la pila de desarrollo con el backend reconstruido con sus tres
capas y `--no-deps`: **178 de 178 comprobaciones** (antes 150; repetido tras las correcciones, también 178 de 178), 89 en Chromium 158 y 89 en Firefox 159, a 390 px (teléfono táctil
emulado) y a 1 280 px. El paso del libro de Excel reconocido (S9) se reemplazó por dos: (a) el lector no se pidió en la primera carga ni al
abrir el alta masiva; un libro dañado se dice, con «Elegir otro archivo»; al elegirlo se pidió el lector, una vez, y pesa menos de 10 kB con
gzip; (b) el catálogo como `.xlsx` (el de LibreOffice con el prefijo de la corrida: el e2e abre cada parte, cambia el texto y vuelve a armar
el zip) se lee en el navegador, 60 filas y las mismas 2 mal escritas, y la revisión trae las mismas tarjetas (60, 44, 1, 15 y 3) y las 60
filas con el mismo número y resultado que las del CSV, y la misma frase salvo la de la celda de más («No entra: la fila trae «sobra» en la
columna H, que no tiene cabecera»). Al salir, el conteo de lo que quedó fue 0 en sitios, zonas, dispositivos, credenciales, personas,
eventos, sesiones y permisos. En la corrida tras las correcciones, la revisión de 500 filas: 64 y 66 ms en Chromium y 79 y 60 ms en Firefox
(390 y 1 280 px).

**Peso** (en el paquete construido): el lector es su propio trozo, `assets/xlsx-lector-*.js`, de **12 605 bytes y 5 413 con gzip** (nivel 9;
el umbral del bloque N es 10 kB; antes de las correcciones, 11 423 y 5 014), sin importaciones; solo lo nombra el trozo del alta (`Alta-*.js`) en su `import()`; `index.html` y el trozo
de entrada no lo nombran, y el e2e confirma que no se pide hasta elegir un libro. El backend lo sirve sin comprimir (en 127.0.0.1:3000).

`pnpm verificar` en `plataforma/backend`: tipos, lint, 942 de 942 del backend en 73 archivos, `svelte-check` sin errores en 435 archivos,
las 647 ejecuciones del panel en 44 archivos y el paquete construido.

**Lo que no cubre.** No hay un libro guardado por Microsoft Excel ni por Google Sheets entre los de prueba (solo LibreOffice y el escritor
propio): las formas que escribe Excel (cadenas compartidas, formatos implícitos de fecha, `t="b"`, `t="e"`, resultados de fórmula con 17
cifras) están en los libros armados a mano. Un número se escribe con coma decimal, como en una planilla en español, aunque la planilla de
la persona use punto; y el formato de porcentaje no se aplica (se toma el valor guardado: 0,5 y no 50 %). La regla del número se aplica solo
a `id_fisico` y `pasarela`: un nombre escrito como número que la planilla convirtió («007» → 7) llega como «7», y un entero de 16 cifras o
más en una columna que no es un identificador se redondea a 15 cifras significativas (`123456789012345678` llega como «123456789012346000»).

**Un libro guardado por Excel (20/11/2026).** Un libro nuevo de Excel para la web con las siete cabeceras y tres filas, descargado como
`.xlsx` y leído en el portátil: «3 filas leídas. 1 está mal escrita y no entra», sin aviso de libro ilegible; la revisión, 3 leídas, 2 se
crean (con aviso) y 1 no entra: el `123456` que Excel guardó como número, con el motivo «la planilla lo guarda como número, y pudo quitarle
ceros a la izquierda o redondearlo; escríbelo como texto». Confirmado el lote, se crearon los 2 y el resultado ofreció sus 2 credenciales
una sola vez, con «Ir al inventario» y «Dar de alta otro lote» esperando a que se descarguen. Las formas que escribe Excel ya no son solo las
de los libros armados a mano.

**En el servidor de prueba (comprobado el 20/11/2026).** Un libro `.xlsx` en «Alta masiva por archivo» → «Revisar las filas» muestra la
revisión con sus tarjetas, sin «no se puede leer el libro», y se volvió sin confirmar (son datos reales); en el teléfono, los botones de la
revisión se pulsan sin que una ayuda los tape. Sin novedades.

## 92. Parches de seguridad de la base (TimescaleDB 2.32.1, PostgreSQL 16.16) y de Node 22.23.5 (20/11/2026)

**Por qué.** Al desplegar en el servidor de prueba el 19/11/2026, el escáner dijo «HAY QUE ACTUAR»: el servidor PostgreSQL de la imagen de
la base era 16.15 y `timescale/timescaledb:latest-pg16-oss` ya traía 16.16 (el riesgo aceptado transitorio de `docs/11 §4`, abierto el
13/11). Consultado el 20/11 con `docker buildx imagetools inspect`: la `2.31.0-pg16-oss` y la `2.32.0-pg16-oss` (la que proponía
Dependabot) dicen `PG_VERSION=16.15`; la primera con 16.16 es la `2.32.1-pg16-oss`, publicada el 19/11/2026, la misma imagen que
`latest-pg16-oss`. Sus notas de versión dicen además: «Previous TimescaleDB patch versions are affected by a background worker issue on
these newer PostgreSQL minor releases: every job run by the scheduler fails»; y las de la 2.32.0, que es «compatible only with PostgreSQL
versions up to 18.6, 17.11, and 16.15» (https://github.com/timescale/timescaledb/releases/tag/2.32.1 y `…/tag/2.32.0`, consultadas el
20/11/2026): la 2.32.1 era la única opción correcta. El mismo día se revisó la actualización de Node que Dependabot
proponía (22.23.4 → 22.23.5): es un parche de seguridad publicado el 11/11/2026 («This is a security release.»: ocho cambios de severidad alta, seis CVE distintas,
en http2, TLS y HTTP; https://github.com/nodejs/node/releases/tag/v22.23.5, consultada el 20/11/2026), que la
espera de siete días de Dependabot había retenido. Se aplicó junto con la base.

**Qué cambió de TimescaleDB entre 2.30.2 y 2.32.1, y qué toca al sistema.** Leídas las notas de 2.31.0, 2.32.0 y 2.32.1: el cambio de
nombre de `enable_columnarscan`, la compresión adaptativa de enteros y la columnstore no aplican (la edición Apache no comprime, y ningún
archivo del sistema usa esas opciones; `git grep`). Lo que sí podía tocarlo: desde 2.32.x TimescaleDB ya no cambia al dueño del catálogo
para crear índices y restricciones de un fragmento nuevo, y los fragmentos nuevos los crea `plataforma_app`, que no es dueño de las
hipertablas (migración 14). Se probó en la base actualizada, dentro de una transacción deshecha al final: como `plataforma_app`, una
medición en 2031 creó su fragmento (dueño `plataforma`, 2 índices) y `fn_retencion_drop_chunks('trama', 3650)` respondió; después del
`ROLLBACK`, los mismos 11 fragmentos. Los dos trabajos de fondo siguen programados, sin errores en el registro.

**Qué se hizo.** El `FROM` de `plataforma/db/imagen/Dockerfile` pasa a `timescale/timescaledb:2.32.1-pg16-oss` y el de las dos etapas de
`plataforma/backend/Dockerfile` a `node:22.23.5-trixie-slim`, ambos fijados por su digest de índice, comprobado contra el registro. La base
de desarrollo se actualizó con el procedimiento de `docs/11 §8`: respaldo (`respaldar.sh`, 25 tablas) y simulacro de restauración en una
base desechable con la imagen anterior (30 287 filas en 25 tablas, idénticas, 6 s); recrear solo la base con la imagen nueva (servidor
16.16, extensión todavía 2.30.2); `ALTER EXTENSION timescaledb UPDATE` con `psql -X` (2.32.1); y la huella de las 25 tablas, idéntica a
la del respaldo salvo la línea de la versión de la extensión.

| Imagen | Antes (críticas / altas / con parche) | Después |
|---|---|---|
| base | servidor PostgreSQL 16.15 («HAY QUE ACTUAR» en el servidor de prueba, 19/11) | 1 / 25 / 0, todas en `gosu` (residuo documentado); servidor 16.16, «OK» |
| backend | Node 22.23.4 | 0 / 46 / 0; `node --version` en la imagen construida: v22.23.5 |
| proxy y broker | sin cambio | 0 / 0 / 0 |

**Resultado.** El escáner, con todo construido en limpio (`--pull --no-cache`) en el portátil: «OK el servidor PostgreSQL de la imagen de
la base es 16.16, la última publicada de su serie» y «OK 4 imágenes: ninguna vulnerabilidad alta o crítica con versión corregida
publicada fuera de los residuos documentados». El riesgo aceptado transitorio de `docs/11 §4` queda cerrado. En el servidor de prueba, la
base se actualiza en el despliegue siguiente con el mismo procedimiento (respaldo, recrear, `ALTER EXTENSION`, huella).

**El hueco que dejó ver, cerrado el mismo día.** El parche de Node pasó nueve días sin aviso: Trivy no ve el binario de Node de la imagen
del backend (como no veía el servidor PostgreSQL compilado de la base) y Dependabot espera siete días antes de proponer. El escáner suma
una comprobación igual a la de PostgreSQL: el `NODE_VERSION` de la imagen construida frente al de `node:<mayor>-<variante>` (la variante,
del `FROM`): al día, OK; hay uno más nuevo de la misma serie, «HAY QUE ACTUAR» y sale 1; no se pudo consultar, FALLA. Su prueba sin red
(`--probar-node`: seis casos plantados, con el orden 22.9.0 < 22.10.0 y dos versiones ilegibles) da 6 de 6; plantada sin `sort -V`, 5 de 6
y en rojo. Con la imagen del backend anterior (Node 22.23.4) la consulta real dice «HAY QUE ACTUAR … ya se publicó 22.23.5»; con la nueva,
OK. El paso 2u del verificador corre ahora las dos pruebas sin red (8 de PostgreSQL y 6 de Node) y falla si una no da todos sus casos.
