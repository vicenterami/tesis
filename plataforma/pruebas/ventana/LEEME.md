# Ventana de 72 horas: el instrumento

Instrumento para medir, en el servidor de prueba y sin depender de ningún equipo externo, la disponibilidad de la recepción (RNF-18: ≥ 99 % en 72
horas continuas), la memoria de cada servicio en el tiempo (RNF-17: la plataforma completa ≤ 2 GB, en reposo y con la carga del caso
real) y que lo que el broker confirmó quedó guardado. El método y los resultados están en `docs/16 §104`.

| Archivo | Qué hace |
|---|---|
| `emisor.mjs` | Hace de 10 equipos reales: un cliente MQTT por credencial (el identificador es su usuario), por TLS a través del proxy y verificando el certificado; cada 60 s publica en SenML dos magnitudes con su marca de tiempo, con QoS 1, y reconecta con espera creciente. Escribe en `emisor.csv` una línea por minuto: enviados, confirmados (PUBACK), reconexiones, conectados, en vuelo, equipos y período; y en `confirmados.csv` una línea por mensaje confirmado (equipo y marca de tiempo), en el instante del PUBACK. Nunca imprime una clave. |
| `compose.ventana.yml` | Corre el emisor como contenedor con reinicio automático, con la imagen del backend que ya está en el equipo, en un proyecto aparte (`ventana`) unido a la red de la pila. Sin puertos. Chequeo de salud propio: `emisor.csv` con una línea de hace menos de 120 s y equipos conectados en ella. |
| `sonda.sh` | Una ejecución, una línea de `sonda.csv` (para `cron` cada minuto): salud por HTTPS a través del proxy (código y milisegundos), frescura del último dato del sitio de la prueba por su vista pública, y por servicio estado, salud, reinicios, tiempo arriba y memoria; disco libre. Si algo no responde, escribe la línea igual con el campo vacío. |
| `resumen.sh` | De los tres CSV y para la ventana que se le PIDE (`--desde` y `--hasta`, o `--horas`): minutos disponibles con la regla de abajo, el veredicto de RNF-18 (solo con 72 h o más; con menos, «ensayo del instrumento: sin veredicto del requisito»), la cifra de solo el emisor y la de solo `/salud`, cada incidente con su causa, p95 de la salud (rango más cercano), memoria mediana y máxima por servicio y total, reinicios, disco, confirmados frente a guardados (consulta de solo lectura por equipo y marca de tiempo; `--guardados N` es un número a mano, para la prueba y un ensayo sin base, y no da veredicto) y cada caída provocada con su tiempo de detección. Pide `--equipos N`. Escribe `resumen.md` y `memoria.csv`. Salidas: 0 resumen completo; 1 la sonda no cubre la ventana (sin veredicto); 2 error de uso (falta `--equipos`, o `--criticos` sin el broker o la base); 3 sin veredicto: falta `emisor.csv` o `confirmados.csv`, sin las columnas o el formato esperados o con valores no numéricos; el emisor sin equipos, con otro número que `--equipos` o con un período de más de 60 s; `confirmados.csv` vacío o que no cuadra con `emisor.csv`; lo guardado a mano o sin consultar; o la sonda con líneas a más de 2 minutos de la ventana sin `--fuera-motivo`. Con varias causas a la vez, manda la 3. |
| `resumen-prueba.sh` | Prueba del resumen con CSV sintéticos, sin tocar la base (el camino de la consulta se prueba con un `docker` falso que devuelve una salida de psql conocida): exige la salida, el texto y el número de minutos no disponibles de 35 casos (un caso limpio que aprueba, el artefacto de borde, los bordes 43 y 44 de 4 320, la base vacía, con uno de menos o con ajenos, un equipo mudo, 9 enviados y 8 confirmados, 100 horas con 60 minutos caídos, el emisor antes que la sonda, `confirmados.csv` vacío o corto, guardados a mano, horas previas con y sin motivo…). Correrla antes de arrancar; también la corre el guardián. |

## Cómo se arranca

1. En el panel: crear el sitio de la prueba, dar de alta los 10 equipos por el alta masiva (vía MQTT, formato SenML, canales
   `temperatura:Cel | humedad:%RH`, intervalo esperado 120 s) y descargar sus credenciales; publicar una vista del sitio con las dos
   magnitudes y guardar su token (lo que va después de `#/v/` en el enlace).
2. En una carpeta propia (por ejemplo `~/ventana-72h`, con permisos 700): `credenciales.csv` (600), `token` (600), `ca.crt` (la CA del
   certificado del proxy), `datos/` y `ventana.conf` con `VENTANA_NOMBRE`, `VENTANA_IP`, `VENTANA_CA` y `VENTANA_TOKEN` (ver la cabecera
   de `sonda.sh`; `VENTANA_SERVICIOS` solo debe nombrar servicios de la plataforma, más el emisor, que el resumen separa del total: sus
   nombres pasan a las columnas y al resumen).
3. Emisor, desde esta carpeta del repositorio:
   `VENTANA_DIR=~/ventana-72h VENTANA_UID=$(id -u) VENTANA_GID=$(id -g) docker compose -f compose.ventana.yml up -d`.
   El certificado del proxy debe nombrar al servicio `proxy` (lo hace el de `proxy/ca-desarrollo.sh`); si no, `VENTANA_MQTT_NOMBRE`.
4. Sonda: una línea de `crontab` del usuario, `* * * * * timeout 55 bash <repo>/plataforma/pruebas/ventana/sonda.sh` (el tope global: una
   corrida que no termina deja su minuto sin línea, y eso cuenta como no disponible, igual que un minuto en que «otra sonda sigue
   corriendo»). Si el usuario no puede usar `cron`, el mismo guion en un bucle dentro de `tmux` (pierde el arranque automático tras un
   reinicio del equipo: se declara). Anotar el instante UTC del arranque: es el `--desde` del resumen.
5. Al cerrar: quitar la línea de `crontab` justo al cumplirse las 72 h (la sonda no debe escribir más de 2 minutos después del fin) y
   detener el emisor DESPUÉS del fin de la ventana más 1 minuto (`docker compose -f compose.ventana.yml stop`; antes, el último minuto
   quedaría sin su línea del emisor). Luego `bash resumen.sh --datos ~/ventana-72h/datos --sitio <código> --equipos 10 --desde <instante
   UTC del arranque> --horas 72 --planeada <instante UTC de cada caída provocada>` (una `--planeada` por caída: la del backend y la del
   broker). La ventana es la pedida, no la que la sonda alcanzó a escribir. Que el emisor arranque antes que la sonda y se detenga después
   es lo correcto y no produce aviso; si la sonda escribió más de 2 minutos fuera de la ventana, no hay veredicto salvo que
   `--fuera-motivo «…»` diga por qué (queda escrito en el resumen).

## Cómo se interpreta

- **Disponible** es un minuto que cumple TODO esto: (1) tiene al menos una línea de la sonda y todas sus líneas cumplen 2, 3 y 5 (si hay
  más de una, manda la peor y el resumen avisa cuántos minutos la tuvieron); (2) `/salud` respondió 200 a través del proxy; (3) el broker
  y la base están arriba y sanos (`--criticos` puede agregar servicios, nunca quitar esos dos); (4) hay línea del emisor para ese minuto,
  con todos sus equipos conectados y a lo más 1 mensaje en vuelo al cerrarlo, y CADA equipo tiene en `confirmados.csv` un mensaje
  confirmado con marca de tiempo en ese minuto, salvo el artefacto de borde (le falta en este minuto y tiene dos en el minuto vecino: su
  temporizador cruzó el borde); (5) el dato llega: la frescura existe y no pasa de 480 s. Un minuto **sin línea** de la sonda o del emisor
  cuenta como no disponible, también al principio y al final.
- **Las tolerancias, con su fundamento.** En vuelo al cerrar el minuto, 1 mensaje: los equipos publican desfasados (60 s / 10 equipos =
  6 s) y un PUBACK tarda milisegundos, así que en el instante del borde cabe a lo más uno. **Presupuesto total de marcas faltantes: 2 por
  equipo** (uno en cada extremo de la ventana, donde el desfase de un temporizador puede dejar su mensaje justo fuera): confirmados con
  marca en la ventana ≥ equipos × minutos − 2 × equipos. **Consistencia:** las marcas de `confirmados.csv` en la ventana y la suma de
  confirmados de `emisor.csv` difieren a lo más en 2 × equipos (los mismos bordes) y no pueden ser 0; si no, no hay veredicto. 480 s de
  frescura: abajo.
- **Las otras dos cifras**, para ver la diferencia: la de solo el emisor (minutos con su línea, todos los equipos conectados, a lo más 1 en
  vuelo y la marca confirmada de cada equipo: lo más cercano al texto original de RNF-18, que contaba ventanas sin confirmación; un minuto
  sin línea del emisor tampoco cuenta) y la de solo `/salud`. Con el backend caído el broker sigue confirmando (guarda en la cola de la sesión persistente), y con el
  broker caído `/salud` sigue en 200: por eso la regla las exige todas.
- **Veredicto**: juzga 72 horas exactas (4 320 minutos). Con una ventana más larga, juzga la PEOR ventana deslizante de 72 h y dice desde
  cuándo (una caída no se diluye en más horas); con menos, el resultado dice «ensayo del instrumento: sin veredicto del requisito».
  Aprueba si los minutos no disponibles de esa ventana son a lo más el 1 % redondeado hacia abajo (43 de 4 320), no se pasa el presupuesto
  de marcas y no falta en la base ningún mensaje confirmado (comparación uno por uno con `--sitio`; con `--guardados` no hay veredicto); el
  porcentaje se muestra truncado. Las caídas provocadas no se descuentan.
- **Frescura**: `ultimo_dato` de la vista pública es el inicio del tramo de 5 minutos de la lectura más reciente y la respuesta se guarda
  60 s; con datos al día queda entre 0 y unos 420 s. Sobre 480 s (umbral por omisión) el dato dejó de llegar o se atrasó.
- **Confirmados frente a guardados** (entra al veredicto): un mensaje confirmado por el broker (PUBACK, QoS 1) debe aparecer en la base
  aunque el backend haya estado caído (el broker lo guarda en la sesión persistente del backend). El emisor anota cada confirmado con su
  equipo y la marca de tiempo del mensaje en el instante del PUBACK (`confirmados.csv`), y el resumen busca cada uno en la base por equipo
  y marca de tiempo (con `--guardados N`, compara cantidades). Los dos lados se atribuyen por la marca de tiempo del mensaje, así que no
  cuadran por compensación: un mensaje encolado al final y confirmado después del cierre cuenta igual de los dos lados, y un emisor que
  muere sin aviso no pierde lo que ya anotó. Si falta uno, no aprueba y dice cuántos.
- **Memoria**: `docker stats` por minuto; el total suma los servicios de la plataforma (no el emisor).
- Cada caída provocada (`--planeada`) se atribuye solo a un incidente que empieza entre su minuto y dos minutos después, con su tiempo de
  detección (la primera línea de la sonda que vio el problema); si no hubo ninguno, el resumen lo dice.

## Límites declarados

- La disponibilidad se mide **dentro del servidor**: la sonda y el emisor corren en el mismo equipo y no ven la red externa al servidor ni
  el camino desde Internet. Una caída de la red externa no aparece; una caída del equipo, sí (como minutos sin línea).
- El emisor comparte la red de la pila: a nivel de red alcanza también la base y el broker. Sus permisos los acota la ACL del broker (solo
  publica en el tópico de cada equipo) y la base exige su propia clave, que el emisor no tiene; se acepta para no tocar el proxy.
- La sonda tiene resolución de un minuto: un corte de segundos entre dos ejecuciones puede no verse.
- La memoria es la de `docker stats`, la herramienta que nombra RNF-17: descuenta la caché de archivos inactiva del contenedor, así que
  no es exactamente la cifra que vigila el techo de `deploy.resources.limits.memory` (que la incluye).
- El emisor publica a la escala del caso real (10 equipos cada 60 s); no es una prueba de carga: RNF-17 queda cubierto aquí en reposo y con
  la carga real, y «bajo carga» lo cubren las corridas del banco (`docs/16 §2–§3` y §10).

## Qué se versiona después de la medición

- **Sí:** el `resumen.md` (revisado) y la tabla que se copia a `docs/16 §104`; si hace falta una figura, `memoria.csv` sin columnas ajenas a
  la plataforma.
- **Nunca:** los CSV crudos de la sonda y del emisor (dan la hora exacta de cada medición y el disco del servidor), `sonda.err` (errores de
  curl y de docker), `ventana.conf` (dirección, ruta del token y nombre del certificado), el token, las credenciales ni la CA.
