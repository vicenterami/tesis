# Informe de pruebas (Etapa 3 — preliminar, 07/10/2026)

Cubre las **pruebas iniciales** de la Etapa 3 (`docs/04`, rúbrica 30 %): el emulador de nodos (TT-28), la prueba de
carga (TT-29) y las pruebas de carrera, contrastadas con RNF-01, RNF-02, RNF-03 y RNF-17 (`docs/02`). Es preliminar:
corre en un portátil, sin TLS ni proxy y con un broker sin credenciales (§1); los valores son sintéticos. Lo que no
cubre todavía: TT-27 (contrato de trama: hoy 610 pruebas unitarias del backend y 345 del panel, sin matriz formal); TT-32 (sensor físico) se cubrió después, en §43, §44 y §53;
TT-30 (recuperación ante reinicio) se agregó después, en §11. Todo lo de aquí se repite con dos comandos (§8).

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
| 8 pruebas en `exportar.spec.ts` (funciones puras): fila CSV con el instante exacto (microsegundos), celdas con coma, comillas y saltos de línea, protección contra inyección de fórmulas en toda columna de texto (`=`, `+`, `-`, `@`, tabulador, retorno), columna numérica, rango razonable, JSON por fila, nombre del archivo saneado, formato por defecto y rechazo de uno desconocido o repetido | ✅ |
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
| Unitarias, sin broker ni base: 13 pruebas en `baja-rotacion.spec.ts`. Baja: `FOR NO KEY UPDATE` → estado → credenciales inactivas → condiciones cerradas → evento → `deleteClient` → COMMIT; 409 si ya estaba de baja y 404 si no existe, sin escribir ni tocar el broker; «not found» del plugin cuenta como borrado y se confirma; sin respuesta → 502 con ROLLBACK y nada que deshacer; vía `http` sin orden al broker; vía `mqtt` sin administración → 503 antes de escribir. Rotación: fila nueva con `scrypt` y la anterior inactiva, `setClientPassword` con el secreto antes del COMMIT, el secreto no está en ningún parámetro SQL, `conexion` con tópico y ejemplo como en el alta; 409 de baja y 400 lorawan sin escribir; «not found» → `createClient` con su rol; sin respuesta → 502 con «repetir la rotación»; la base no confirma → 500 con el mismo remedio; 429 con dos operaciones en curso, también para baja y rotación | ✅ 185 en total al 13/10 (`pnpm test`; 193 al 15/10) |
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
