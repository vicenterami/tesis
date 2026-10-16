# Informe de pruebas (Etapa 3 — preliminar, 07/10/2026)

Cubre las **pruebas iniciales** de la Etapa 3 (`docs/04`, rúbrica 30 %): el emulador de nodos (TT-28), la prueba de
carga (TT-29) y las pruebas de carrera, contrastadas con RNF-01, RNF-02, RNF-03 y RNF-17 (`docs/02`). Es preliminar:
corre en un portátil, sin TLS ni proxy y con un broker sin credenciales (§1); los valores son sintéticos. Lo que no
cubre todavía: TT-27 (contrato de trama: hoy 234 pruebas unitarias, sin matriz formal) y TT-32 (sensor físico);
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
Versiones elegidas con al menos siete días de publicadas (Svelte 5.57.1, Vite 8.3.2, Vitest 5.0.3; `docs/11 §3`, fila de imágenes fijadas por digest y robot de dependencias: siete días de espera); ninguna
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
**Lo que no cubre todavía:** ninguna prueba abre el panel en un navegador real (las del DOM corren en jsdom); la demostración
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

**Resultado (12/10, noche):** A funciona y los archivos no conviven de forma útil → migración hecha en la misma tanda (`docs/10
§8.4` punto 42): `password_file` y `acl_file` fuera de `mosquitto.conf`, `acl` fuera del repo, todos los usuarios en el plugin
(`pruebas/broker-inicializar.sh`, `broker-cliente.sh`, `lib-dynsec.sh`), guardián 2i reescrito. Escaneo de
`eclipse-mosquitto:2.1.2-alpine` por digest: **0 críticas, 0 altas** (`escanear-imagenes.sh`); banco con TLS repetido sobre 2.1.2
y el plugin: 11 de 11 (`banco.sh proxy`); emulador y alta por API: §20.

## 19. Exportación de mediciones crudas en CSV y JSON (12/10/2026)

RF-34 y HU-08, adelantada a la Etapa 3 (`docs/18 §3`): lo que el académico entrevistado llamó «crítico y no negociable».
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

**Correcciones de la revisión del mismo día (12/10, noche; 40 hallazgos de tres lentes, 39 aplicados):** la administración del broker
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
el guardián 2i falla y los casos del alta del humo responden 404, a propósito); la baja y la rotación por API llegaron el 13/10 (§21); la vía `http` guarda el hash del token aunque la recepción por HTTP no exista aún; no hay prueba automática de dos
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
P6 (Etapa 4); la rotación por `http` guarda el hash del token sin que exista aún la recepción por HTTP.

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

## 24. Rol de la aplicación con mínimo privilegio (13/10/2026)

Migración 14 (`docs/10 §8.4` punto 44; `docs/11 §4` fila 6 y §9). El backend entra como `plataforma_app`: SELECT en todo, INSERT en 11 tablas y UPDATE en 5;
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
| DevEUI del cuerpo distinto del tópico | `IdentidadCruzada`, una malformada que no marca vivo; en mayúsculas cuenta como igual |
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
| Alta | pasarela, hash de su credencial, evento con `dispositivo_id` nulo y cliente con rol `pasarela` antes del COMMIT; el secreto en ningún parámetro SQL; plantillas `event_topic` y `command_topic` (ChirpStack) o el uplink con `$devEUI` (Milesight) |
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
estándar. Resultado: **25 de 25 comprobaciones, «LORAWAN OK»**; 26 de 26 desde la corrección de §32.

| Comprobación | Resultado |
|---|---|
| Alta de la pasarela ChirpStack y de su nodo | 201; el nodo con el formato `chirpstack` de su pasarela; la respuesta con el `event_topic` |
| `up` publicado en su árbol | aceptado; la lectura en `medicion` con origen `pasarela` |
| `join` | sin cuarentena; DevEUI no asociado → `no_registrado`; DevEUI cruzado → `malformada` y el nodo no se marca vivo; SenML bajo la pasarela → `malformada` |
| ACL del rol `pasarela` | no publica en el árbol de otra pasarela ni como dispositivo directo (RC:135); se suscribe a su subárbol de comandos (código 0) y no a los de otra ni a todo el sitio (135); un emulado no publica en su árbol (RC:135) |
| Pasarela Milesight | 201 con el tópico del uplink con `$devEUI`; con códec y Metadata, 3 lecturas con la hora de recepción; sin códec, `malformada` que dice qué activar |
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
| `medir-bloqueo-fila.sh` exige `--desarrollo` y verifica también el bloqueo de la pasarela | sin la bandera no corre; con ella, «BLOQUEO DE FILA OK» |

Además: nuevas pruebas del 409 por identificador repetido y del nodo dado de baja por el tópico de su pasarela; mensajes de alta que
nombran la pasarela; fuentes públicas con URL y cita en el punto 47, en lugar de remitir a evidencia no publicada; estados unificados en `docs/10`,
`docs/11` y `docs/13`; y en el repositorio público, cero horarios en las bitácoras y cero referencias a registros privados, con los
chequeos 2f2 y 2p ampliados y plantados. Total: 234 pruebas.
