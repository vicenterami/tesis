# Informe de pruebas (Etapa 3 — preliminar, 07/10/2026)

Cubre las **pruebas iniciales** de la Etapa 3 (`docs/04`, rúbrica 30 %): el emulador de nodos (TT-28), la prueba de
carga (TT-29) y las pruebas de carrera, contrastadas con RNF-01, RNF-02, RNF-03 y RNF-17 (`docs/02`). Es preliminar:
corre en un portátil, sin TLS ni proxy y con un broker sin credenciales (§1); los valores son sintéticos. Lo que no
cubre todavía: TT-27 (contrato de trama: hoy 70 pruebas unitarias, sin matriz formal), TT-30 (recuperación ante
reinicio), TT-32 (sensor físico). Todo lo de aquí se repite con dos comandos (§8).

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
`docs/10 §9.6`. El modelo (`modelo.ts`, funciones puras con 8 pruebas unitarias) es determinista a partir de una
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
| RNF-01: ≥ 50 eventos/s sin pérdida | ✅ 59,7 tramas/s sostenidas 90 s (119 lecturas/s), pico 74/s, 0 perdidas | En el portátil; la cola del broker nunca pasó de 52 mensajes |
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

Lo que esta prueba no cubre: el certificado real del servidor (ficha D-06), el límite de tasa (`docs/11 §4`) y la
exposición a la red (por defecto el proxy escucha solo en 127.0.0.1).

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
contador de descartes; inserción por lotes si hiciera falta más capacidad. Limitaciones: portátil de 16 hilos con el emulador en
el mismo equipo; el broker del banco va sin credenciales ni persistencia; el servidor real tendrá otra CPU.
