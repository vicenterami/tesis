# Informe de pruebas (Etapa 3 — preliminar, 07/10/2026)

Cubre las **pruebas iniciales** de la Etapa 3 (`docs/04`, rúbrica 30 %): el emulador de nodos (TT-28), la prueba de
carga (TT-29) y las pruebas de carrera, contrastadas con RNF-01, RNF-02, RNF-03 y RNF-17 (`docs/02`). Es preliminar:
corre en un portátil, sin TLS ni proxy y con un broker sin credenciales (§1); los valores son sintéticos. Lo que no
cubre todavía: TT-27 (contrato de trama: hoy 130 pruebas unitarias, sin matriz formal) y TT-32 (sensor físico);
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

**Lo que falta probar:** el broker de producción (con persistencia y guardado cada 1800 s): un reinicio ordenado guarda la cola
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
| broker | 0 / 2 | 0 / 0 | La misma `eclipse-mosquitto:2.0.22`, reconstruida por su autor con OpenSSL corregido |
| proxy | 0 / 3 | 0 / 0 | `nginx:1.30.5-alpine` más parches de Alpine (`plataforma/proxy/Dockerfile`) |
| base | 7 / 100 | 1 / 21 | `timescale/timescaledb:2.24.0-pg16-oss` → `2.30.2-pg16-oss` más parches de Alpine, y sin `timescaledb-parallel-copy` ni `timescaledb-tune`, que el sistema no ejecuta (`plataforma/db/imagen/Dockerfile`). Queda `gosu`, que el arranque usa para bajar privilegios y no recibe datos de afuera |

**Que siga funcionando.** Antes de tocar la base de desarrollo, el banco se levantó desde cero con las imágenes nuevas: todas
las migraciones, las seis pruebas de carrera, TLS de punta a punta (`banco.sh proxy`) y una carga de 60 s con 100 nodos (48
tramas/s, pico 65) sin pérdidas y con p95 de 3 ms. Hubo 6 alarmas de silencio falsas; la corrida 4 (§6) dio 3, pero no son
comparables (otra duración y otra semilla). La base de desarrollo se actualizó con respaldo del volumen y
`ALTER EXTENSION timescaledb UPDATE`, y el conteo de cada tabla quedó idéntico. Guardián completo en verde.

**Cómo repetirlo:** `bash plataforma/pruebas/escanear-imagenes.sh` (construye con `--pull --no-cache` y sale 1 si queda algo
con versión corregida publicada fuera de los residuos documentados).

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

`GET /eventos` (`docs/10 §5`). 22 pruebas en `eventos.spec.ts` (`backend/src/tiempo-real/`); las del bloque «GET /eventos
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
exactamente las 3 que lo cubren. Pila de desarrollo reconstruida y `api-smoke.sh` con 6 casos nuevos (130 pruebas unitarias en total). Proxy sobre el
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
Versiones elegidas con al menos siete días de publicadas (Svelte 5.57.1, Vite 8.3.2, Vitest 5.0.3; `docs/11 §3`, fila de imágenes fijadas por digest y robot de dependencias: siete días de espera); ninguna
dependencia ejecutó scripts de instalación (`ignore-scripts`). Auditoría del workspace: cero avisos en producción; en desarrollo,
el alto conocido de `braces` y un moderado de `sprintf-js`, los dos solo por Jest y sin parche publicado.

| Comprobación | Resultado |
|---|---|
| 20 pruebas del panel (vitest): estado visual (cuatro reglas y su orden), «en línea» con la regla de la API, orden de atención, «hace cuánto», hora local con UTC, cliente HTTP con acciones por código, canal en vivo (reconexión 1-2-4 s, plazo sin latido, cierre limpio) | ✅ todas |
| 3 de ellas por el DOM (jsdom): un dispositivo en mantenimiento con condición abierta aparece «Inactivo» y **no** «Alerta»; orden Sin señal → Alerta → Normal → Inactivo; conteos; una ficha filtra y vuelve a mostrar; vacío y error con su acción | ✅ |
| `svelte-check` sobre 320 archivos | 0 errores, 0 avisos |
| Build real: `index.html` 0,45 KB, un paquete JS de 47 KB (18,7 KB comprimido), CSS 1,8 KB; sin `.map` | ✅ |
| Imagen del backend reconstruida: el panel compilado en la etapa de build; en la imagen final solo `panel/dist`, y `node_modules` sin `svelte` (6 entradas, solo producción del backend) | ✅ (`--filter` en la instalación de producción) |
| `pruebas/panel-desarrollo.sh`, con el servidor de Vite real: `/panel/` servido; `Origin` propio por el 5173 → 200 y otro → 403 (el reenvío conserva el `Host`); primer byte del canal en menos de 5 s y latido a los 25 s (no retiene el flujo) | ✅ (11 comprobaciones; 12 desde el tramo 3, con «el 5173 queda libre») |
| El mismo guion contra el build servido por el backend: `/panel/` con la CSP estricta, paquete con hash 200, `.map` 404, sin scripts en línea | ✅ |

**Hallazgos:** (1) Vitest cargaba la versión de servidor de Svelte y `onMount` no existía: lo resuelve el plugin de pruebas de
Testing Library (`svelteTesting`), que fuerza la resolución de navegador; (2) Vite trae su propia lista de nombres de host
(`server.allowedHosts`, desde la 6.0.9, por el mismo *DNS rebinding* del punto 40) y corta un `Host` ajeno con 403 antes de
reenviar: el caso del guion acepta ese 403 o el 421 del backend, nunca un 200; (3) `.dockerignore` solo excluía `node_modules`
y `dist` de la raíz: sin las entradas del panel, `COPY panel` habría metido al contexto de build sus dependencias enlazadas.
**Lo que no cubre todavía:** ninguna prueba abre el panel en un navegador real (las del DOM corren en jsdom); la demostración
(`docs/15`) lo hace a mano; una prueba con navegador llega con la ficha (tramo 3), que es donde hay gráfico.

## 17. Panel, tramo 3: ficha del dispositivo con gráfico (12/10/2026)

`docs/19` (pantalla P3, HU-21 adelantada a la Etapa 3 por decisión del 12/10). Para alimentarla, la API ganó el filtro
`?dispositivo=<uuid>` en `GET /condiciones` y `GET /cuarentena` (UUID validado; otro valor → 400; contrato regenerado y comparado
con el versionado en el humo). uPlot 1.6.32 (MIT, 576 días publicado) entra como dependencia de producción del panel; el paquete
JS pasa de 47 a 109 KB (44 KB comprimido).

| Comprobación | Resultado |
|---|---|
| 43 pruebas del panel (23 nuevas): ventana y URL del histórico por rango, series del gráfico (histórico agregado y lecturas en vivo aparte; inserción en orden; tope de 500 puntos en vivo que nunca borra el histórico), formato con coma decimal, forma de cada evento del canal (el latido trae solo `tiempo`), filtros del inventario por vía, zona y búsqueda | ✅ todas |
| 11 por el DOM (jsdom; uPlot sustituido por un doble que registra los datos): la ficha muestra identidad, estado visual (condición abierta y en línea → «Alerta»), una tarjeta por canal con última lectura y umbrales; pide las condiciones abiertas completas y las recientes, y el histórico del primer canal con el rango por defecto (24 h, 15 minutos) que entrega al gráfico; condiciones abiertas primero; trama rechazada plegada; una medición en vivo actualiza la tarjeta y entra al gráfico en un lote de 250 ms, una de otro dispositivo se descarta y en pausa nada cambia; diez avisos de condición → una sola tanda de consultas (antirrebote); al reconectar tras una caída se repide la ficha y el histórico; un id inexistente → mensaje con la acción y sin gráfico | ✅ |
| Humo de la API: condiciones filtradas por dispositivo (todas suyas), cuarentena filtrada, valores que no son UUID → 400; contrato servido igual al versionado | ✅ (4 casos nuevos) |
| Imagen reconstruida; `panel-desarrollo.sh` completo (12 comprobaciones, incluida la terminación de Vite) | ✅ `PANEL OK` |
| Ficha con datos reales de la pila de desarrollo (`curl`): canal de temperatura con su última lectura; 2 condiciones del dispositivo, todas suyas | ✅ |

**Correcciones del tramo 2 (mismo día):** el lector del canal exigía `tipo` dentro de los datos y descartaba el
latido; el inventario pedía las condiciones con el límite por defecto (50), insuficiente para el semáforo con muchas abiertas
(ahora 500); al reconectar no se repedía nada (ahora inventario y ficha repiden todo); el guion mataba a `pnpm` y dejaba a Vite
vivo en el 5173 (se vio con `ss`; ahora lanza el binario y comprueba el puerto); `.dockerignore` sin `**/` dejaba entrar
`panel/.env` o una llave al contexto de build.
**Correcciones de la revisión del tramo 3 (mismo día):** (1) el repedido al reconectar nunca se disparaba: el canal pasa por
«conectando» antes de «en vivo», así que comparar con el estado anterior no servía; ahora el canal avisa «reconectado» al abrir
tras una caída y la prueba cubre la secuencia real; (2) la ficha pedía solo las 50 condiciones más recientes para decidir el
estado: una `sin_comunicacion` vieja quedaba fuera tras 50 aperturas y cierres de umbral; ahora pide las abiertas completas
(hasta 500) aparte de las recientes, y el inventario avisa si llega al tope; (3) cada aviso de condición repedía la lista y
cada lectura redibujaba el gráfico: antirrebote de 1 s con un solo vuelo y lotes de 250 ms; (4) un parámetro repetido
(`?dispositivo=a&dispositivo=b`) llega como arreglo y daba 500: toda validación exige texto y responde 400 (4 pruebas, 2 casos
de humo); (5) la ficha descarta eventos de otro dispositivo aunque el canal venga filtrado, y un `valor` infinito se rechaza;
(6) los avisos de copyright de `svelte` y `uPlot`, que Vite quita del código, viajan en `/panel/avisos-de-terceros.txt`; (7) el
diagrama de tiempo real de `docs/10 §5` decía `?canal=` y «añade el punto»: ahora `?dispositivo=` y la lectura en vivo aparte.
**Lo que no cubre:** ningún navegador real (jsdom; el gráfico se mira a mano en la demostración, `docs/15`); la reconexión del
canal, la lectura en vivo, la pausa y el antirrebote se prueban con un `EventSource` falso y temporizadores simulados, no
cortando el backend ni publicando por MQTT; los puntos del gráfico se comprueban contra un doble de uPlot, no en un canvas; el
rango a medida por fechas (HU-07) queda para la Etapa 4.

## 18. Credenciales del broker con el plugin Dynamic Security: laboratorio desechable (preparado el 12/10/2026)

Condición de la decisión del 08/10 (`docs/10 §8.4` punto 26): antes de que el backend administre credenciales del broker, una
prueba en un contenedor desechable con identidades de descarte. `plataforma/pruebas/lab-dynsec.sh` levanta la misma imagen
fijada del compose con el plugin activado y, en un solo guion que no imprime ningún secreto, crea un rol con ACL de publicación
al tópico propio (`%u`), un cliente de descarte, y prueba: publicar en el tópico propio y en uno ajeno, un usuario desconocido,
la convivencia con `password_file` + `acl_file` (lo que la documentación oficial no declara), deshabilitar, rehabilitar, rotar
la clave y borrar, la persistencia en el JSON del plugin y que el broker nunca se reinició.

| Comprobación | Esperado | Medido |
|---|---|---|
| Publicar en el tópico propio | `PUBACK RC:0` | pendiente |
| Publicar en tópico ajeno | `PUBACK RC:135` (no autorizado, MQTT 5) | pendiente |
| Usuario desconocido | conexión rechazada | pendiente |
| Usuario de `password_file` con `acl_file`, mismo listener | `RC:0` en su tópico, `RC:135` en ajeno (convivencia) | pendiente |
| Cliente deshabilitado | conexión rechazada; rehabilitado → `RC:0` | pendiente |
| Clave rotada | vieja rechazada, nueva `RC:0` | pendiente |
| Cliente borrado | conexión rechazada; el JSON vuelve a un solo cliente | pendiente |
| Reinicios del broker durante todo lo anterior | 0 | pendiente |
| Intentos fallidos | solo en el log del broker (sin parche en la base) | pendiente |

El guion lo ejecuta la persona (ninguna clave del broker, ni de descarte, la escribe el asistente de desarrollo; es una regla
del proyecto desde el 27/09) y la salida se pega aquí. De su resultado depende si los usuarios actuales de `password_file`
(`backend`, `sonda`, los `dev-*`) se quedan hasta la Etapa 4 o migran al plugin con HU-11 (`docs/10 §8.4` punto 41).

