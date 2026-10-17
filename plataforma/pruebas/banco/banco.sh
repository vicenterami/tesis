#!/usr/bin/env bash
# Banco de pruebas DESECHABLE para TT-28 (emulador), TT-29 (carga) y las pruebas de carrera (docs/04 §rúbrica).
# Levanta una segunda pila aparte (proyecto Compose «banco») sin tocar la de desarrollo: otros puertos, datos en RAM,
# broker sin credenciales (ver pruebas/banco/compose.banco.yml). Desde cualquier carpeta:
#   bash plataforma/pruebas/banco/banco.sh encender [N] [F]    levanta y siembra N emulados (100) con intervalo = periodo × F (2; con 1 se reproducen las alarmas falsas); termina con «migraciones»
#   bash plataforma/pruebas/banco/banco.sh correr [opciones]   corre el emulador contra el banco y evalúa (ver emulador.ts)
#   bash plataforma/pruebas/banco/banco.sh carrera [disp]      las dos pruebas de carrera: mismo instante ×20 y umbral ×5 (docs/16 §4)
#   bash plataforma/pruebas/banco/banco.sh evaluar [csv]       vuelve a cruzar un CSV de envíos con la base
#   bash plataforma/pruebas/banco/banco.sh proxy               levanta la capa TLS (proxy/compose.proxy.yml) sobre el banco y la prueba
#   bash plataforma/pruebas/banco/banco.sh alta                alta por API de punta a punta: POST → credencial → publica → medicion (HU-11)
#   bash plataforma/pruebas/banco/banco.sh lorawan             rutas B y C de punta a punta: alta de pasarela → publica como ella → medicion; ACL del rol pasarela; perfil, sufijo nativo y fCnt; rotación y baja
#   bash plataforma/pruebas/banco/banco.sh migraciones         reaplica las migraciones 02 a la última y exige el mismo esquema y catálogo (idempotencia; corre al final de «encender»)
#   bash plataforma/pruebas/banco/banco.sh puente [ip]         puente de Mosquitto como el de la red del campus: su broker reenvía el tópico nativo por TLS al proxy → medicion
#                                                              (con «ip», por dirección IP, como en la red del campus: certificado con CA_IP_EXTRA y proxy publicado solo en esa IP)
#   bash plataforma/pruebas/banco/banco.sh http                recepción por HTTP (HU-01): 202, 401, 413, 415, 422 con cuarentena, la baja, los dos topes por petición y la dirección tras el proxy
#   bash plataforma/pruebas/banco/banco.sh navegador           pantalla P3 en Firefox real con Playwright: puntos contra /historico, vivo sin recargar, caída y vuelta (docs/16 §39)
#   bash plataforma/pruebas/banco/banco.sh cola                cola del broker vigilada: backend detenido + 200 emulados → descartes → condición broker_descarte (docs/16 §22)
#   bash plataforma/pruebas/banco/banco.sh estado | logs [servicio] | sql ["CONSULTA"]
#   bash plataforma/pruebas/banco/banco.sh apagar              baja todo; los datos estaban en RAM, no queda nada
# Credenciales: de descarte, generadas en cada «encender» y escritas fuera del repo, en una carpeta propia con permisos 700,
# nunca impresas. El broker del banco corre el mismo plugin de seguridad que el real (docs/10 §8.4 punto 42) y deja publicar
# a los anónimos (los emulados). Requiere pnpm en plataforma/backend (el emulador corre en el host).
set -u
YO="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"   # ruta absoluta: sigue valiendo tras el cd (lección de pila.sh)
cd "$(dirname "$0")/../.."                 # plataforma/
# Carpeta propia y privada (08/10): con nombres fijos en /tmp, otro usuario del equipo podía adelantarse con un enlace y
# desviar las claves generadas. Las rutas son fijas dentro de ella porque encender, correr y apagar las comparten.
PRIV="${XDG_RUNTIME_DIR:-$HOME/.cache}/plataforma-banco"; mkdir -p "$PRIV" && chmod 700 "$PRIV" || { echo "FALLA no se pudo preparar $PRIV"; exit 1; }
ENV="$PRIV/banco.env"
CSV="$PRIV/envios.csv"
CERTS="$(pwd)/../privado/certs-desarrollo"
IMG_BROKER=$(grep -oE 'eclipse-mosquitto:[^ ]+@sha256:[0-9a-f]{64}' docker-compose.yml | head -1)   # la del compose, fijada por digest
[ -n "$IMG_BROKER" ] || { echo "FALLA no encontré la imagen fijada del broker en docker-compose.yml"; exit 1; }
dc() { docker compose -p banco -f docker-compose.yml -f pruebas/banco/compose.banco.yml --env-file "$ENV" "$@"; }
dcp() { docker compose -p banco -f docker-compose.yml -f pruebas/banco/compose.banco.yml -f proxy/compose.proxy.yml --env-file "$ENV" "$@"; }
psql_() { dc exec -T timescaledb psql -U plataforma -d plataforma -v ON_ERROR_STOP=1 "$@"; }
# Plugin de seguridad del broker del banco: las mismas funciones que usa el operador con la pila real (pruebas/lib-dynsec.sh).
. "$(dirname "$YO")/../lib-dynsec.sh"; DYN_DC=dc
leer() { leer_env "$ENV" "$1"; }
DYN_ADMIN=""; [ -f "$ENV" ] && DYN_ADMIN=$(leer MQTT_ADMIN_CLAVE)
emu() { (cd backend && pnpm -s exec ts-node --transpile-only src/emulador/emulador.ts "$@"); }
case "${1:-}" in
  encender)
    umask 077
    { echo "DB_NOMBRE=plataforma"; echo "DB_USUARIO=plataforma"; echo "DB_CLAVE=$(openssl rand -base64 24)"; echo "DB_APP_CLAVE=$(openssl rand -base64 24)"
      echo "MQTT_BACKEND_CLAVE=$(openssl rand -base64 24)"; echo "MQTT_SONDA_USUARIO=sonda"; echo "MQTT_SONDA_CLAVE=$(openssl rand -base64 24)"
      echo "MQTT_ADMIN_CLAVE=$(openssl rand -base64 24)"; echo "HTTP_CLAVE_ADMIN=$(openssl rand -base64 24)"   # administrador del plugin y clave del alta (docs/10 §8.4 punto 41)
      # capa TLS opcional (banco.sh proxy): puertos +1 y certificados de desarrollo
      echo "PROXY_IP_PERSONAS=127.0.0.1"; echo "PROXY_IP_DISPOSITIVOS=127.0.0.1"; echo "PROXY_HTTPS=8443"; echo "PROXY_MQTTS=8884"; echo "PROXY_HTTP=8081"; echo "PROXY_CERTS=$CERTS"; } > "$ENV"
    DYN_ADMIN=$(leer MQTT_ADMIN_CLAVE)
    # Primero la base y el broker solos: el backend espera a que el broker esté sano, y no lo estará hasta que exista la sonda.
    dc up -d timescaledb mosquitto || exit 1
    # Plugin de seguridad (docs/10 §8.4 punto 42): el archivo lo creó el arranque del contenedor (compose.banco.yml); aquí los
    # roles y clientes del sistema (los mismos que en el servidor, defecto deny) y, SOLO en el banco, el grupo anónimo con el rol
    # «emulado»: los emulados (sin usuario) publican bajo sitio/+/dispositivo/+/+ y nada más (ni $CONTROL ni suscribirse).
    esperar_plugin 30 || { echo "FALLA el plugin del broker del banco no responde"; dc logs --no-color mosquitto | tail -5; exit 1; }
    roles_del_sistema || exit 1
    cliente_del_sistema backend recepcion "$(leer MQTT_BACKEND_CLAVE)" >/dev/null || exit 1
    cliente_del_sistema sonda sonda "$(leer MQTT_SONDA_CLAVE)" >/dev/null || exit 1
    rol emulado publishClientSend 'sitio/+/dispositivo/+/+' allow  publishClientSend '#' deny  publishClientSend '$CONTROL/#' deny  subscribePattern '#' deny  subscribeLiteral '#' deny || exit 1
    exigir "createGroup anonimos" ctrl createGroup anonimos && exigir "addGroupRole anonimos emulado" ctrl addGroupRole anonimos emulado && exigir "setAnonymousGroup anonimos" ctrl setAnonymousGroup anonimos || exit 1
    echo "plugin del broker listo: roles $(ctrl listRoles | tr '\n' ' ')· clientes $(ctrl listClients | tr '\n' ' ')· anónimos = grupo con rol emulado (solo en el banco)"
    dc up -d --build || exit 1
    # Rol de la aplicación (migración 14): el backend entra con él. Va DESPUÉS de este `up`, que recrea la base (en RAM) y la
    # vuelve a inicializar: fijada antes, la clave se perdía (13/10). Sin clave el backend no queda «healthy». Se espera a que las migraciones terminen (existe el rol) y se
    # fija su clave de descarte con el mismo guion que usa la persona, que además prueba lo permitido y lo prohibido.
    for _ in $(seq 1 30); do psql_ -tAq -c "SELECT 1 FROM pg_roles WHERE rolname='plataforma_app'" 2>/dev/null | grep -q 1 && break; sleep 2; done
    BASE_ENV="$ENV" BASE_DC="docker compose -p banco -f docker-compose.yml -f pruebas/banco/compose.banco.yml --env-file $ENV" bash pruebas/base-rol-app.sh > "$PRIV/rol-app.txt" 2>&1 \
      || { echo "FALLA el rol de la aplicación:"; grep FALLA "$PRIV/rol-app.txt"; exit 1; }   # antes «| tail -1 || exit 1» nunca fallaba
    tail -1 "$PRIV/rol-app.txt"; rm -f "${PRIV:?}/rol-app.txt"
    echo "esperando «healthy» (máx. 90 s)…"
    for _ in $(seq 1 30); do [ -z "$(dc ps --format '{{.Status}}' | grep -v '(healthy)')" ] && break; sleep 3; done
    bash "$YO" estado
    n="${2:-100}"
    emu semilla --dispositivos "$n" --intervalo-factor "${3:-2}" | psql_ -q && echo "sembrados $n dispositivos emulados (emu-0001…emu-$(printf '%04d' "$n")), intervalo = periodo × ${3:-2}"
    bash "$YO" migraciones ;;
  migraciones)
    # Idempotencia de las migraciones (convención de docs/08 §6), comprobada en cada «encender» y no a mano (revisión del 16/10): con la
    # base recién creada, se reaplican de la 02 a la última y el esquema (tablas, restricciones, índices, permisos, comentarios) y el
    # catálogo de magnitudes deben quedar idénticos. «Sin error» no basta: una migración puede correr dos veces y cambiar algo. La 01
    # es el esquema base, no se escribió para repetirse. Se hace aquí, en la base desechable del banco, y no en el guardián: reaplicar
    # en la base de desarrollo la escribiría en cada corrida y bloquearía tablas mientras el backend guarda.
    # MIG_DIR (por defecto db/init) solo existe para plantar una migración no idempotente y ver que esto falla.
    dir="${MIG_DIR:-db/init}"; fallos=0
    # Fuera del volcado: el token aleatorio de \restrict y los fragmentos de TimescaleDB (_timescaledb_internal), que nacen cuando el
    # backend guarda datos entre las dos fotos (medido el 16/10: una muestra del broker creó uno) y no dependen de las migraciones.
    # Se compara ordenado por líneas: el primer fragmento de una tabla cambia la posición en que pg_dump la escribe (medido el mismo
    # día), y un orden distinto no es un esquema distinto; una restricción agregada o renombrada sí cambia el conjunto de líneas.
    foto() { { dc exec -T timescaledb pg_dump -s -N _timescaledb_internal -U plataforma plataforma 2>/dev/null | grep -vE '^\\(un)?restrict '
               psql_ -tA -c "SELECT * FROM magnitud ORDER BY codigo"
               psql_ -tA -c "SELECT hypertable_name, proc_name, schedule_interval, config FROM timescaledb_information.jobs ORDER BY 1, 2"; } > "$PRIV/foto.txt"
      # Una foto vacía (base caída, usuario equivocado) daría dos resúmenes iguales y un «OK» sin haber revisado nada (revisión del 16/10).
      [ "$(grep -c '^CREATE TABLE' "$PRIV/foto.txt")" -ge 15 ] || { echo "FALLA la foto del esquema salió casi vacía: no se puede comparar" >&2; rm -f "$PRIV/foto.txt"; exit 1; }
      LC_ALL=C sort "$PRIV/foto.txt" | sha256sum | cut -c1-16; rm -f "$PRIV/foto.txt"; }
    antes=$(foto) || exit 1; n=0
    for f in "$dir"/[0-9][0-9]-*.sql; do
      [ "$(basename "$f")" = 01-esquema.sql ] && continue
      if psql_ -X -q < "$f" >/dev/null 2>"$PRIV/mig.err"; then n=$((n+1)); else echo "FALLA $(basename "$f") no se puede reaplicar: $(grep -m1 ERROR "$PRIV/mig.err")"; fallos=$((fallos+1)); fi
    done; rm -f "$PRIV/mig.err"
    despues=$(foto) || exit 1
    [ "$n" -ge 16 ] || { echo "FALLA solo se reaplicaron $n migraciones (¿cambió la carpeta?)"; fallos=$((fallos+1)); }
    [ "$antes" = "$despues" ] && echo "OK    $n migraciones reaplicadas sin error y sin cambiar el esquema ni el catálogo (idempotentes)" || { echo "FALLA reaplicar cambió el esquema o el catálogo ($antes → $despues)"; fallos=$((fallos+1)); }
    [ $fallos -eq 0 ] || exit 1 ;;
  estado)
    dc ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'
    printf 'GET /salud (banco, 3001) → '; curl -s -m 3 http://127.0.0.1:3001/salud || echo "sin respuesta"; echo ;;
  logs) dc logs -f --no-color --since 1m "${@:2}" ;;
  sql)
    if [ -n "${2:-}" ]; then psql_ -c "$2"; else dc exec timescaledb psql -U plataforma -d plataforma; fi ;;
  correr)
    # El emulador escribe el resumen (JSON) por stdout y el CSV en $CSV; después se evalúa contra la base.
    emu correr --url mqtt://127.0.0.1:1884 --salida "$CSV" "${@:2}" || exit 1
    echo "esperando 5 s a que el pipeline termine de guardar…"; sleep 5
    bash "$YO" evaluar "$CSV" ;;
  evaluar)
    csv="${2:-$CSV}"; [ -f "$csv" ] || { echo "no existe $csv"; exit 1; }
    # Esquema propio «banco»: /salud cuenta las tablas de public y no debe ver la tabla auxiliar.
    psql_ -q -c "CREATE SCHEMA IF NOT EXISTS banco; DROP TABLE IF EXISTS banco.envio; CREATE TABLE banco.envio (id text, magnitud text, tiempo timestamptz, enviado_en timestamptz, confirmado_en timestamptz, estado text);" \
      && psql_ -q -c "\copy banco.envio FROM STDIN WITH (FORMAT csv, HEADER true)" < "$csv" \
      && psql_ -F ' | ' -A -c "$(cat pruebas/banco/evaluar.sql)" ;;
  carrera)
    # Dos pruebas (docs/04): la misma lectura 20 veces a la vez → una fila y una trama; umbral 5 veces a la vez → una condición.
    disp="${2:-emu-0003}"
    antes=$(dc logs --no-color backend 2>/dev/null | grep -c "manejador falló")
    salida=$(emu carrera --url mqtt://127.0.0.1:1884 --dispositivo "$disp") || exit 1
    sleep 3
    bt_a=$(jq -r .bt_a <<<"$salida"); desde=$(jq -r .bt_b_desde <<<"$salida"); hasta=$(jq -r .bt_b_hasta <<<"$salida")
    fallos=0
    comprobar() { # nombre · consulta → número · esperado
      local real; real=$(psql_ -tA -c "$2" | tr -d '[:space:]')
      if [ "$real" = "$3" ]; then echo "OK    $1 ($real)"; else echo "FALLA $1: esperado $3, hay ${real:-nada}"; fallos=$((fallos+1)); fi; }
    comprobar "(a) misma lectura ×20 → una fila por canal" \
      "SELECT count(*) FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='$disp' AND m.tiempo = to_timestamp($bt_a)" 2
    comprobar "(b) umbral ×5 a la vez → las 5 lecturas de temperatura guardadas" \
      "SELECT count(*) FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='$disp' AND c.magnitud_codigo='temperatura' AND m.tiempo BETWEEN to_timestamp($desde) AND to_timestamp($hasta)" 5
    comprobar "(b) una sola condición de umbral abierta" \
      "SELECT count(*) FROM condicion k JOIN dispositivo d ON d.id=k.dispositivo_id WHERE d.id_fisico='$disp' AND k.tipo='umbral' AND k.cerrada_en IS NULL" 1
    # Las tramas se cuentan por la marca bt que llevan dentro, no por ventana de tiempo: (a) también deja tramas.
    comprobar "(a) misma lectura ×20 → UNA trama cruda (decisión 4: un mensaje a la vez)" \
      "SELECT count(*) FROM trama t JOIN dispositivo d ON d.id=t.dispositivo_id WHERE d.id_fisico='$disp' AND substring(convert_from(t.payload,'UTF8') from '\"bt\":(\\d+)')::bigint = $bt_a" 1
    comprobar "(b) las 5 tramas crudas guardadas (el filtro 6 corrió para todas)" \
      "SELECT count(*) FROM trama t JOIN dispositivo d ON d.id=t.dispositivo_id WHERE d.id_fisico='$disp' AND substring(convert_from(t.payload,'UTF8') from '\"bt\":(\\d+)')::bigint BETWEEN $desde AND $hasta" 5
    despues=$(dc logs --no-color backend 2>/dev/null | grep -c "manejador falló")
    if [ "$despues" = "$antes" ]; then echo "OK    ningún «manejador falló» nuevo en el backend"; else echo "FALLA $((despues-antes)) «manejador falló» durante la carrera (ver banco.sh logs backend)"; fallos=$((fallos+1)); fi
    echo; [ $fallos -eq 0 ] && echo "CARRERA OK" || { echo "$fallos comprobación(es) con falla"; exit 1; } ;;
  proxy)
    # TLS de punta a punta sobre el banco (decisión 10, variante A): 8443 → backend, 8884 → broker. Certificados de
    # desarrollo de proxy/ca-desarrollo.sh; el cliente MQTT confía con --cafile y corre en un contenedor desechable de la
    # misma imagen del broker, montado en /c (nunca en /mosquitto, docs/11 §7).
    [ -f "$CERTS/ca.crt" ] || bash proxy/ca-desarrollo.sh "$CERTS"
    dcp up -d proxy || exit 1
    for _ in $(seq 1 20); do [ "$(dcp ps --format '{{.Status}}' proxy | grep -c healthy)" = 1 ] && break; sleep 2; done
    fallos=0
    salud=$(curl -s -m 5 --cacert "$CERTS/ca.crt" https://localhost:8443/salud)
    if grep -q '"estado":"ok"' <<<"$salud"; then echo "OK    HTTPS 8443 → backend: $salud"; else echo "FALLA HTTPS 8443: ${salud:-sin respuesta}"; fallos=$((fallos+1)); fi
    hsts=$(curl -s -m 5 -D - -o /dev/null --cacert "$CERTS/ca.crt" https://localhost:8443/salud | grep -ci strict-transport-security)
    [ "$hsts" = 1 ] && echo "OK    HSTS presente (lo pone el proxy)" || { echo "FALLA sin HSTS"; fallos=$((fallos+1)); }
    if curl -s -m 5 -o /dev/null https://localhost:8443/salud 2>/dev/null; then echo "FALLA el certificado se aceptó sin la CA (no debería)"; fallos=$((fallos+1)); else echo "OK    sin la CA el cliente rechaza el certificado"; fi
    # Canal de tiempo real por el proxy (TT-39): se abre ANTES de publicar, con el Origin del propio panel y filtrado por el
    # dispositivo que publica (prueba también el filtro), y se espera su medición. Prueba el camino entero hasta el
    # navegador: si el proxy reenviara el Host sin el puerto ($host) el canal respondería 403, y si retuviera la respuesta
    # en búfer el evento no llegaría a tiempo.
    disp_id=$(psql_ -tA -c "SELECT id FROM dispositivo WHERE id_fisico = 'emu-0003'" | tr -d '[:space:]')
    sse="$PRIV/sse-proxy.txt"; : > "$sse"
    curl -s -N -m 30 --cacert "$CERTS/ca.crt" -H 'Origin: https://localhost:8443' "https://localhost:8443/eventos?dispositivo=$disp_id" > "$sse" & sse_pid=$!
    trap 'kill "$sse_pid" 2>/dev/null' EXIT
    # Listo cuando llega el primer byte: Nest lo escribe (un salto de línea) recién suscrito, no antes. Un sleep fijo
    # podía publicar antes de la suscripción en un equipo cargado.
    for _ in $(seq 1 50); do [ -s "$sse" ] && break; sleep 0.2; done
    red=$(docker network ls --format '{{.Name}}' | grep '^banco_default$')
    bt=$(($(date +%s) - 60)); carga="[{\"bn\":\"emu-0003\",\"bt\":$bt,\"n\":\"temperatura\",\"u\":\"Cel\",\"v\":21.5}]"
    # Sin -u: con el plugin, un usuario sin clave se rechaza; el emulado es anónimo y lo identifica el tópico (docs/16 §20).
    if docker run --rm --network "$red" -v "$CERTS:/c:ro" "$IMG_BROKER" mosquitto_pub --cafile /c/ca.crt -h proxy -p 8883 -q 1 -i emu-0003 -t sitio/banco/dispositivo/emu-0003/temperatura -m "$carga"; then
      sleep 2; n=$(psql_ -tA -c "SELECT count(*) FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='emu-0003' AND m.tiempo = to_timestamp($bt)" | tr -d '[:space:]')
      [ "$n" = 1 ] && echo "OK    MQTT sobre TLS 8884 → broker → pipeline: la lectura está en medicion" || { echo "FALLA la lectura publicada por TLS no llegó a medicion ($n)"; fallos=$((fallos+1)); }
    else echo "FALLA mosquitto_pub por TLS"; fallos=$((fallos+1)); fi
    for _ in $(seq 1 20); do grep -q '^event: medicion' "$sse" && break; sleep 0.5; done
    kill "$sse_pid" 2>/dev/null; wait "$sse_pid" 2>/dev/null
    if grep -q '^event: medicion' "$sse" && grep -q "\"dispositivo_id\":\"$disp_id\"" "$sse" && grep -q '"valor":21.5' "$sse"; then
      echo "OK    SSE 8443 → navegador: la medición de emu-0003 llegó por el canal en vivo, filtrada, con el Origin propio y sin búfer"
    else echo "FALLA SSE 8443: no llegó la medición → $(head -c 160 "$sse")"; fallos=$((fallos+1)); fi
    rm -f "$sse"
    if docker run --rm --network "$red" "$IMG_BROKER" mosquitto_pub -h proxy -p 8883 -t x -m 1 2>/dev/null; then echo "FALLA el 8883 aceptó una conexión sin TLS"; fallos=$((fallos+1)); else echo "OK    el 8883 rechaza conexiones sin TLS"; fi
    # Lista de nombres de host (docs/10 §8.4 punto 40, 12/10): el proxy atiende solo PROXY_NOMBRE (aquí, localhost). Un nombre ajeno en
    # el SNI, o una conexión por IP sin SNI, no recibe ni el certificado; con el SNI propio y un Host ajeno, 421 de nginx (el servidor
    # que elige el Host es el que rechaza saludos, sin llegar al backend); en el 80, la conexión se corta sin respuesta (444).
    if curl -s -m 5 -o /dev/null --cacert "$CERTS/ca.crt" --resolve ataque.example:8443:127.0.0.1 https://ataque.example:8443/salud 2>/dev/null; then echo "FALLA el 8443 atendió un nombre ajeno (DNS rebinding)"; fallos=$((fallos+1)); else echo "OK    el 8443 rechaza el saludo TLS de un nombre ajeno (sin entregar el certificado)"; fi
    code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' --cacert "$CERTS/ca.crt" -H 'Host: ataque.example' https://localhost:8443/salud)
    [ "$code" = 421 ] && echo "OK    Host ajeno con el SNI propio → 421" || { echo "FALLA Host ajeno con el SNI propio → HTTP $code (esperado 421)"; fallos=$((fallos+1)); }
    if curl -sk -m 5 -o /dev/null https://127.0.0.1:8443/salud 2>/dev/null; then echo "FALLA el 8443 atendió por IP sin SNI"; fallos=$((fallos+1)); else echo "OK    por IP sin SNI el saludo se rechaza (el chequeo de salud pide por el nombre con --resolve)"; fi
    code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' -H 'Host: ataque.example' http://localhost:8081/)
    [ "$code" = 000 ] && echo "OK    el 80 corta sin respuesta un Host ajeno (444)" || { echo "FALLA el 80 respondió $code a un Host ajeno"; fallos=$((fallos+1)); }
    code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://localhost:8081/)
    [ "$code" = 301 ] && echo "OK    el 80 redirige a HTTPS el nombre propio" || { echo "FALLA el 80 respondió $code al nombre propio (esperado 301)"; fallos=$((fallos+1)); }
    echo "── registro del proxy (JSON, una línea por petición/conexión):"; dcp logs --no-color --since 2m proxy 2>/dev/null | grep -oE '\{.*\}' | head -3
    echo; [ $fallos -eq 0 ] && echo "PROXY OK" || { echo "$fallos comprobación(es) con falla"; exit 1; } ;;
  alta)
    # Alta por API de punta a punta (HU-11; docs/10 §3 y §8.4 puntos 41 y 42; docs/16 §20): POST con la clave de administrador
    # del banco → 201 con la credencial (que nunca se imprime) → el «dispositivo» publica con ella por 1884 → la lectura llega a
    # medicion; con la misma credencial no puede publicar como otro (RC:135); con otra clave no conecta; repetir el alta da 409;
    # sin clave, 401; con clave incorrecta, 401; un cuerpo inválido, 400. En la base: credencial con hash scrypt (nunca el
    # secreto) y un evento «alta»; en la API, el inventario lo lista con su vía. Además: un anónimo no puede dar órdenes al plugin
    # y el usuario backend (rol recepcion) no puede publicar. Los secretos del banco entran a curl, psql y grep por la entrada
    # estándar, no por argumentos (ps).
    CLAVE=$(leer HTTP_CLAVE_ADMIN); fallos=0; id="alta-$(date +%s | tail -c 5)"
    zona=$(psql_ -tA -c "SELECT id FROM zona LIMIT 1" | tr -d '[:space:]')
    cuerpo="{\"id_fisico\":\"$id\",\"nombre\":\"Alta de prueba\",\"zona_id\":\"$zona\",\"via\":\"mqtt\",\"intervalo_esperado_s\":60,\"canales\":[{\"magnitud\":\"temperatura\"},{\"magnitud\":\"humedad\",\"etiqueta\":\"suelo\"}]}"
    post() { curl -s -m 10 -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' "$@" http://127.0.0.1:3001/dispositivos; }
    post_admin() { printf 'X-Clave-Admin: %s\n' "$CLAVE" | post -H @- "$@"; }   # la clave viaja por stdin (-H @-), no por argv
    ok() { echo "OK    $1"; }; falla() { echo "FALLA $1"; fallos=$((fallos+1)); }
    r=$(post_admin -D "$PRIV/alta-cabeceras.txt" -d "$cuerpo"); code=${r##*$'\n'}; body=${r%$'\n'*}
    [ "$code" = 201 ] && ok "POST /dispositivos con la clave → 201" || { echo "FALLA POST → HTTP $code: ${body:0:200}"; exit 1; }
    CRED=$(python3 -c "import sys,json; print(json.load(sys.stdin)['conexion']['credencial'])" <<<"$body")
    topico=$(python3 -c "import sys,json; print(json.load(sys.stdin)['conexion']['ejemplo']['topico'])" <<<"$body")
    [ ${#CRED} = 32 ] && ok "la respuesta trae la credencial (32 caracteres; no se imprime), usuario $id y tópico $topico" || falla "credencial de ${#CRED} caracteres"
    grep -qi '^cache-control: no-store' "$PRIV/alta-cabeceras.txt" && ok "la respuesta con la credencial lleva Cache-Control: no-store" || falla "sin no-store"; rm -f "$PRIV/alta-cabeceras.txt"
    red=$(docker network ls --format '{{.Name}}' | grep '^banco_default$')
    pub_como() { printf '%s\n' "$2" | docker run --rm -i --network "$red" "$IMG_BROKER" sh -c 'IFS= read -r C; mosquitto_pub -V mqttv5 -d -h mosquitto -q 1 -i "verif-$$" -u "$1" -P "$C" -t "$2" -m "$3" 2>&1' sh "$1" "$3" "$4" | grep -oE "PUBACK \(Mid: [0-9]+, RC:[0-9]+\)|Connection error: .*" | head -1; }
    pub() { pub_como "$id" "$1" "$2" "$3"; }
    pub_anon() { docker run --rm --network "$red" "$IMG_BROKER" mosquitto_pub -V mqttv5 -d -h mosquitto -q 1 -i "anon-$$" -t "$1" -m "$2" 2>&1 | grep -oE "PUBACK \(Mid: [0-9]+, RC:[0-9]+\)|Connection error: .*" | head -1; }
    bt=$(($(date +%s) - 30)); carga="[{\"bt\":$bt,\"n\":\"temperatura\",\"u\":\"Cel\",\"v\":22.5}]"
    r=$(pub "$CRED" "$topico" "$carga"); [[ "$r" == *"RC:0"* || "$r" == *"RC:16"* ]] && ok "publica en su tópico con la credencial recién creada ($r)" || falla "publicar en su tópico: $r"
    sleep 2; n=$(psql_ -tA -c "SELECT count(*) FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='$id' AND m.tiempo = to_timestamp($bt)" | tr -d '[:space:]')
    [ "$n" = 1 ] && ok "la lectura está en medicion: pipeline completo con el dispositivo recién dado de alta" || falla "la lectura no llegó a medicion ($n)"
    r=$(pub "$CRED" "sitio/banco/dispositivo/emu-0001/temperatura" "$carga"); [[ "$r" == *"RC:135"* ]] && ok "con su credencial NO puede publicar como otro dispositivo (RC:135)" || falla "publicar como otro: $r"
    r=$(pub "clave-equivocada-de-prueba-123456" "$topico" "$carga"); [[ "$r" == *"Connection error"* ]] && ok "con otra clave el broker no lo deja conectar" || falla "con otra clave: $r"
    r=$(pub_anon '$CONTROL/dynamic-security/v1' '{"commands":[{"command":"listClients"}]}'); [[ "$r" == *"RC:135"* ]] && ok "un anónimo (emulado) NO puede dar órdenes al plugin (RC:135)" || falla "anónimo contra \$CONTROL: $r"
    r=$(pub_como backend "$(leer MQTT_BACKEND_CLAVE)" "$topico" "$carga"); [[ "$r" == *"RC:135"* ]] && ok "el usuario backend (rol recepcion) NO puede publicar como dispositivo (RC:135)" || falla "backend publicando: $r"
    # Mínimo privilegio del administrador (13/10, docs/11 §9): backend-admin lee $SYS pero ya no puede suscribirse a las tramas.
    sub_admin() { printf '%s\n' "$(leer MQTT_ADMIN_CLAVE)" | docker run --rm -i --network "$red" "$IMG_BROKER" sh -c 'IFS= read -r C; mosquitto_sub -V mqttv5 -d -h mosquitto -i "verif-admin-$$" -u backend-admin -P "$C" -t "$1" -W 2 -C 1 2>&1' sh "$1" | grep -oE "Subscribed \(mid: [0-9]+\): [0-9]+" | head -1; }
    r=$(sub_admin 'sitio/#'); [[ "$r" == *": 135" ]] && ok "backend-admin NO puede suscribirse a sitio/# (135; mínimo privilegio)" || falla "backend-admin suscrito a sitio/#: «$r»"
    r=$(sub_admin '$SYS/broker/clients/connected'); [[ "$r" == *": 0" ]] && ok "backend-admin SÍ lee \$SYS (lo necesita el muestreo de la cola)" || falla "backend-admin y \$SYS: «$r»"
    code=$(post_admin -d "$cuerpo" | tail -1); [ "$code" = 409 ] && ok "repetir el mismo alta → 409" || falla "repetir el alta → $code"
    code=$(post -d "$cuerpo" | tail -1); [ "$code" = 401 ] && ok "sin X-Clave-Admin → 401" || falla "sin clave → $code"
    code=$(post -H "X-Clave-Admin: no-es-la-clave-de-nadie-123456" -d "$cuerpo" | tail -1); [ "$code" = 401 ] && ok "con clave incorrecta → 401" || falla "clave incorrecta → $code"
    code=$(post_admin -d '{"id_fisico":"backend"}' | tail -1); [ "$code" = 400 ] && ok "cuerpo inválido (id reservado, campos faltantes) → 400" || falla "cuerpo inválido → $code"
    code=$(post_admin -d "${cuerpo/\"via\":\"mqtt\"/\"via\":\"lorawan\"}" | tail -1); [ "$code" = 400 ] && ok "lorawan sin pasarela → 400" || falla "lorawan sin pasarela → $code"
    h=$(psql_ -tA -c "SELECT left(hash, 7) FROM credencial cr JOIN dispositivo d ON d.id=cr.dispositivo_id WHERE d.id_fisico='$id'" | tr -d '[:space:]')
    [ "$h" = 'scrypt$' ] && ok "en la base, la credencial es un hash scrypt" || falla "hash en la base: «$h»"
    n=$(printf '\\set c %s\nSELECT count(*) FROM credencial WHERE position(:%sc%s in hash) > 0;\n' "'$CRED'" "'" "'" | psql_ -tA | tr -d '[:space:]'); [ "$n" = 0 ] && ok "el secreto en claro no está en ninguna fila de credencial" || falla "el secreto aparece en la base"
    n=$(psql_ -tA -c "SELECT count(*) FROM evento e JOIN dispositivo d ON d.id=e.dispositivo_id WHERE d.id_fisico='$id' AND e.tipo='alta'" | tr -d '[:space:]'); [ "$n" = 1 ] && ok "evento «alta» registrado" || falla "evento alta: $n"
    curl -s http://127.0.0.1:3001/dispositivos | python3 -c "import sys,json; sys.exit(0 if any(d['id_fisico']=='$id' and d['via']=='mqtt' and d['en_linea'] for d in json.load(sys.stdin)) else 1)" && ok "GET /dispositivos lo lista con vía mqtt y en línea" || falla "no aparece en el inventario, o no en línea"
    n=$(dc logs --no-color --since 3m backend 2>/dev/null | grep -cF -f <(printf '%s\n' "$CRED")); [ "$n" = 0 ] && ok "la credencial no aparece en el registro del backend" || falla "la credencial se escribió en el registro"
    # ── Rotación (POST /dispositivos/{id}/credencial, 13/10; docs/10 §3): la clave anterior deja de valer, la nueva publica,
    # en la base queda una fila activa y otra inactiva, y el evento «rotacion».
    uid=$(python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" <<<"$body")
    rot() { local u=$1; shift; printf 'X-Clave-Admin: %s\n' "$CLAVE" | curl -s -m 10 -w '\n%{http_code}' -X POST -H @- "$@" "http://127.0.0.1:3001/dispositivos/$u/credencial"; }
    r=$(rot "$uid" -D "$PRIV/rot-cabeceras.txt"); code=${r##*$'\n'}; body2=${r%$'\n'*}
    [ "$code" = 201 ] && ok "POST /dispositivos/{id}/credencial con la clave → 201" || { echo "FALLA rotación → HTTP $code: ${body2:0:200}"; exit 1; }
    CRED2=$(python3 -c "import sys,json; print(json.load(sys.stdin)['conexion']['credencial'])" <<<"$body2")
    [ ${#CRED2} = 32 ] && [ "$CRED2" != "$CRED" ] && ok "la rotación devuelve una credencial nueva (32 caracteres, distinta; no se imprime)" || falla "credencial rotada: ${#CRED2} caracteres"
    grep -qi '^cache-control: no-store' "$PRIV/rot-cabeceras.txt" && ok "la respuesta de la rotación lleva Cache-Control: no-store" || falla "rotación sin no-store"; rm -f "$PRIV/rot-cabeceras.txt"
    r=$(pub "$CRED" "$topico" "$carga"); [[ "$r" == *"Connection error"* ]] && ok "con la credencial ANTERIOR el broker ya no lo deja conectar" || falla "la credencial anterior sigue valiendo: $r"
    r=$(pub "$CRED2" "$topico" "$carga"); [[ "$r" == *"RC:0"* || "$r" == *"RC:16"* ]] && ok "con la credencial NUEVA publica en su tópico ($r)" || falla "publicar con la nueva: $r"
    n=$(psql_ -tA -c "SELECT count(*) FILTER (WHERE activa) || '/' || count(*) FROM credencial cr JOIN dispositivo d ON d.id=cr.dispositivo_id WHERE d.id_fisico='$id'" | tr -d '[:space:]')
    [ "$n" = "1/2" ] && ok "en la base: 2 filas de credencial, 1 activa (la anterior quedó inactiva)" || falla "filas de credencial activas/total: $n (esperado 1/2)"
    n=$(psql_ -tA -c "SELECT count(*) FROM evento e JOIN dispositivo d ON d.id=e.dispositivo_id WHERE d.id_fisico='$id' AND e.tipo='rotacion'" | tr -d '[:space:]'); [ "$n" = 1 ] && ok "evento «rotacion» registrado" || falla "evento rotacion: $n"
    code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:3001/dispositivos/$uid/credencial"); [ "$code" = 401 ] && ok "rotación sin X-Clave-Admin → 401" || falla "rotación sin clave → $code"
    # ── Baja (DELETE /dispositivos/{id}): estado baja, cliente borrado del broker (la clave nueva ya no entra), credenciales
    # inactivas, evento «baja», inventario con estado baja; repetir → 409; un UUID que no existe → 404; rotar un dado de baja → 409.
    del() { local u=$1; shift; printf 'X-Clave-Admin: %s\n' "$CLAVE" | curl -s -m 10 -w '\n%{http_code}' -X DELETE -H @- "$@" "http://127.0.0.1:3001/dispositivos/$u"; }
    r=$(del "$uid"); code=${r##*$'\n'}; body3=${r%$'\n'*}
    [ "$code" = 200 ] && ok "DELETE /dispositivos/{id} con la clave → 200" || { echo "FALLA baja → HTTP $code: ${body3:0:200}"; exit 1; }
    python3 -c "import sys,json; r=json.load(sys.stdin); sys.exit(0 if r['estado']=='baja' and r['estado_anterior']=='activo' and r['credenciales_revocadas']==1 else 1)" <<<"$body3" && ok "la respuesta dice estado baja, antes activo, 1 credencial revocada" || falla "respuesta de la baja: ${body3:0:160}"
    r=$(pub "$CRED2" "$topico" "$carga"); [[ "$r" == *"Connection error"* ]] && ok "dado de baja, el broker ya no acepta su credencial (cliente borrado)" || falla "el dado de baja sigue entrando: $r"
    n=$(psql_ -tA -c "SELECT d.estado || ' ' || (SELECT count(*) FROM credencial cr WHERE cr.dispositivo_id=d.id AND cr.activa) FROM dispositivo d WHERE d.id_fisico='$id'" | tr -d '[:space:]')
    [ "$n" = "baja0" ] && ok "en la base: estado baja y 0 credenciales activas" || falla "estado/credenciales activas: $n (esperado baja 0)"
    n=$(psql_ -tA -c "SELECT count(*) FROM evento e JOIN dispositivo d ON d.id=e.dispositivo_id WHERE d.id_fisico='$id' AND e.tipo='baja'" | tr -d '[:space:]'); [ "$n" = 1 ] && ok "evento «baja» registrado" || falla "evento baja: $n"
    curl -s http://127.0.0.1:3001/dispositivos | python3 -c "import sys,json; sys.exit(0 if any(d['id_fisico']=='$id' and d['estado']=='baja' for d in json.load(sys.stdin)) else 1)" && ok "GET /dispositivos lo sigue listando, con estado baja (historial conservado)" || falla "no aparece con estado baja"
    code=$(del "$uid" | tail -1); [ "$code" = 409 ] && ok "repetir la baja → 409" || falla "repetir la baja → $code"
    code=$(rot "$uid" | tail -1); [ "$code" = 409 ] && ok "rotar un dado de baja → 409" || falla "rotar dado de baja → $code"
    code=$(del "00000000-0000-4000-8000-000000000000" | tail -1); [ "$code" = 404 ] && ok "dar de baja un UUID inexistente → 404" || falla "baja inexistente → $code"
    code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X DELETE "http://127.0.0.1:3001/dispositivos/$uid"); [ "$code" = 401 ] && ok "baja sin X-Clave-Admin → 401" || falla "baja sin clave → $code"
    n=$(dc logs --no-color --since 3m backend 2>/dev/null | grep -cF -f <(printf '%s\n' "${CRED2:-sin-credencial-rotada}")); [ "$n" = 0 ] && ok "la credencial rotada no aparece en el registro del backend" || falla "la credencial rotada se escribió en el registro"
    unset CRED CRED2
    echo; [ $fallos -eq 0 ] && echo "ALTA OK" || { echo "$fallos comprobación(es) con falla"; exit 1; } ;;
  lorawan)
    # Rutas B y C de punta a punta (docs/10 §8.4 punto 47; docs/16 §31): alta de una pasarela ChirpStack y de su nodo por API, publicación con
    # la credencial de la pasarela y el JSON del evento «up» de ChirpStack v4, la ACL real del rol pasarela, los rechazos del filtro 1,
    # una pasarela Milesight con códec, rotación y baja. Los secretos viajan por la entrada estándar, nunca por argumentos.
    CLAVE=$(leer HTTP_CLAVE_ADMIN); fallos=0; n=$(date +%s | tail -c 5)
    ok() { echo "OK    $1"; }; falla() { echo "FALLA $1"; fallos=$((fallos+1)); }
    api() { local m=$1 r=$2; shift 2; printf 'X-Clave-Admin: %s\n' "$CLAVE" | curl -s -m 10 -w '\n%{http_code}' -X "$m" -H @- -H 'Content-Type: application/json' "$@" "http://127.0.0.1:3001$r"; }
    json() { python3 -c "import sys,json; v=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
    red=$(docker network ls --format '{{.Name}}' | grep '^banco_default$')
    pub() { printf '%s\n' "$2" | docker run --rm -i --network "$red" "$IMG_BROKER" sh -c 'IFS= read -r C; mosquitto_pub -V mqttv5 -d -h mosquitto -q 1 -i "lw-$$" -u "$1" -P "$C" -t "$2" -m "$3" 2>&1' sh "$1" "$3" "$4" | grep -oE "PUBACK \(Mid: [0-9]+, RC:[0-9]+\)|Connection error: .*" | head -1; }
    sub() { printf '%s\n' "$2" | docker run --rm -i --network "$red" "$IMG_BROKER" sh -c 'IFS= read -r C; mosquitto_sub -V mqttv5 -d -h mosquitto -i "lws-$$" -u "$1" -P "$C" -t "$2" -W 2 -C 1 2>&1' sh "$1" "$3" | grep -oE "Subscribed \(mid: [0-9]+\): [0-9]+" | head -1; }
    pub_anon() { docker run --rm --network "$red" "$IMG_BROKER" mosquitto_pub -V mqttv5 -d -h mosquitto -q 1 -i "lwa-$$" -t "$1" -m "$2" 2>&1 | grep -oE "PUBACK \(Mid: [0-9]+, RC:[0-9]+\)|Connection error: .*" | head -1; }
    cuarentena() { psql_ -tA -c "SELECT motivo || ' · ' || left(detalle, 90) FROM cuarentena WHERE topico = '$1' ORDER BY recibido_en DESC LIMIT 1"; }
    visto() { psql_ -tA -c "SELECT e.visto_por_ultima_vez FROM estado_dispositivo e JOIN dispositivo d ON d.id=e.dispositivo_id WHERE d.id_fisico='$1'"; }
    lecturas() { psql_ -tA -c "SELECT count(*) FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='$1'"; }
    pub_r() { printf '%s\n' "$2" | docker run --rm -i --network "$red" "$IMG_BROKER" sh -c 'IFS= read -r C; mosquitto_pub -V mqttv5 -d -h mosquitto -q 1 -r -i "lwr-$$" -u "$1" -P "$C" -t "$2" -m "$3" 2>&1' sh "$1" "$3" "$4" | grep -oE "PUBACK \(Mid: [0-9]+, RC:[0-9]+\)|Connection error: .*" | head -1; }
    # Una sesión larga (20 s) con la credencial de la pasarela, en esta misma shell para poder esperarla: ¿la corta la rotación o la baja?
    # Evidencia positiva (revisión del 15/10), del registro del broker y no de la salida del cliente (mosquitto_sub la retiene en su búfer
    # hasta terminar): la sesión cuenta como abierta si el broker registró su conexión con su identificador único, y como cortada si el
    # broker la desconectó «por acción administrativa» antes de su plazo de 30 s y su salida muestra que se había suscrito. --init hace
    # que matarla termine el contenedor.
    bitacora_broker() { dc logs --no-color --since 2m mosquitto 2>/dev/null; }
    abrir_sesion() { S_ID="lwl-$RANDOM$RANDOM"; : > "$PRIV/sesion.log"
      printf '%s\n' "$2" | docker run --rm -i --init --network "$red" "$IMG_BROKER" sh -c 'IFS= read -r C; mosquitto_sub -V mqttv5 -d -h mosquitto -i "$3" -u "$1" -P "$C" -t "$2" -W 30' sh "$1" "$3" "$S_ID" > "$PRIV/sesion.log" 2>&1 & S_PID=$!; S_T0=$SECONDS
      for _ in $(seq 1 20); do bitacora_broker | grep -q "as $S_ID (" && break; sleep 0.5; done; sleep 1; }
    sesion_suscrita() { kill -0 "$S_PID" 2>/dev/null && bitacora_broker | grep -q "as $S_ID ("; }
    sesion_cortada() { ! kill -0 "$S_PID" 2>/dev/null && [ $((SECONDS - S_T0)) -lt 28 ] && bitacora_broker | grep -q "Client $S_ID \[.*\] disconnected: administrative action" && grep -qE 'Subscribed \(mid: [0-9]+\): [0-2]$' "$PRIV/sesion.log"; }
    cerrar_sesion() { kill "$S_PID" 2>/dev/null; wait "$S_PID" 2>/dev/null; }
    # Espera a que la cuarentena del tópico muestre el motivo esperado (en vez de un sleep fijo) y deja medio segundo al filtro 6.
    esperar_cuarentena() { local c=""; for _ in $(seq 1 20); do c=$(cuarentena "$1"); [[ "$c" == $2 ]] && break; sleep 0.25; done; sleep 0.5; printf '%s' "$c"; }
    read -r sitio_id sitio zona < <(psql_ -tA -F ' ' -c "SELECT s.id, s.codigo, z.id FROM sitio s JOIN zona z ON z.sitio_id = s.id ORDER BY s.codigo LIMIT 1")
    # ── ChirpStack (ruta C) ──
    pid="cs-banco-$n"; r=$(api POST /pasarelas -d "{\"id_fisico\":\"$pid\",\"nombre\":\"ChirpStack del banco\",\"sitio_id\":\"$sitio_id\",\"formato\":\"chirpstack\"}")
    code=${r##*$'\n'}; body=${r%$'\n'*}; [ "$code" = 201 ] && ok "POST /pasarelas (chirpstack) → 201" || { echo "FALLA POST /pasarelas → $code: ${body:0:200}"; exit 1; }
    PCRED=$(json "v['conexion']['credencial']" <<<"$body"); pasarela=$(json "v['id']" <<<"$body")
    [ "$(json "v['conexion']['plantillas']['event_topic']" <<<"$body")" = "sitio/$sitio/pasarela/$pid/{{dev_eui}}/{{event}}" ] && ok "la respuesta trae la credencial (no se imprime) y el event_topic para ChirpStack" || falla "plantilla event_topic"
    deveui=$(openssl rand -hex 8); r=$(api POST /dispositivos -d "{\"id_fisico\":\"$deveui\",\"nombre\":\"Nodo LoRaWAN del banco\",\"zona_id\":\"$zona\",\"via\":\"lorawan\",\"pasarela_id\":\"$pasarela\",\"intervalo_esperado_s\":180,\"canales\":[{\"magnitud\":\"temperatura\"}]}")
    code=${r##*$'\n'}; [ "$code" = 201 ] && [ "$(json "v['formato']" <<<"${r%$'\n'*}")" = chirpstack ] && ok "alta del nodo lorawan → 201, con el formato de su pasarela (chirpstack)" || falla "alta del nodo → $code"
    base="sitio/$sitio/pasarela/$pid"; t_up=$(date -u -d '-30 seconds' +%Y-%m-%dT%H:%M:%S.000000000+00:00)
    up() { printf '{"deduplicationId":"3ac7e3c4-4401-4b8d-9386-a5c902f9202d","time":"%s","deviceInfo":{"deviceName":"banco","devEui":"%s"},"fPort":1,"data":"qg==","rxInfo":[{"gatewayId":"aaaaaaaaaaaaaaaa","rssi":-36,"snr":10.5}],"object":%s}' "$t_up" "$1" "$2"; }
    r=$(pub "$pid" "$PCRED" "$base/$deveui/up" "$(up "$deveui" '{"temperature":21.5,"battery_voltage":3.6}')"); [[ "$r" == *"RC:0"* || "$r" == *"RC:16"* ]] && ok "la pasarela publica el «up» en su árbol ($r)" || falla "publicar el up: $r"
    sleep 2; r=$(psql_ -tA -c "SELECT count(*) || ' ' || coalesce(max(m.origen_tiempo),'-') FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='$deveui'")
    [ "$r" = "1 pasarela" ] && ok "la lectura está en medicion con la marca del servidor de red (origen pasarela)" || falla "medicion del nodo: «$r» (esperado «1 pasarela»)"
    r=$(pub "$pid" "$PCRED" "$base/$deveui/join" '{}'); sleep 1; [ -z "$(cuarentena "$base/$deveui/join")" ] && ok "un evento join se anota y no deja cuarentena" || falla "el join dejó cuarentena"
    otro=$(openssl rand -hex 8); r=$(pub "$pid" "$PCRED" "$base/$otro/up" "$(up "$otro" '{"temperature":20}')"); sleep 1
    [[ "$(cuarentena "$base/$otro/up")" == no_registrado* ]] && ok "un DevEUI no asociado a la pasarela → cuarentena no_registrado" || falla "DevEUI ajeno: $(cuarentena "$base/$otro/up")"
    visto0=$(visto "$deveui")
    r=$(pub "$pid" "$PCRED" "$base/$deveui/up" "$(up "ffffffffffffffff" '{"temperature":20}')"); c=$(esperar_cuarentena "$base/$deveui/up" 'malformada*DevEUI*')
    visto1=$(visto "$deveui")
    [[ "$c" == malformada*DevEUI* ]] && [ -n "$visto0" ] && [ "$visto0" = "$visto1" ] && ok "DevEUI del cuerpo distinto del tópico → malformada, y el nodo no se marca vivo" || falla "DevEUI cruzado: $(cuarentena "$base/$deveui/up") · visto $visto0 → $visto1"
    r=$(pub "$pid" "$PCRED" "$base/$deveui/up" '[{"n":"temperatura","v":1}]'); sleep 1
    [[ "$(cuarentena "$base/$deveui/up")" == *"formato declarado chirpstack: la trama no tiene esa forma"* ]] && ok "SenML bajo una pasarela chirpstack → malformada con el formato esperado" || falla "SenML bajo pasarela: $(cuarentena "$base/$deveui/up")"
    r=$(pub "$pid" "$PCRED" "sitio/$sitio/pasarela/otra-pasarela/$deveui/up" '{}'); [[ "$r" == *"RC:135"* ]] && ok "con su credencial NO publica en el árbol de otra pasarela (RC:135)" || falla "árbol ajeno: $r"
    r=$(pub "$pid" "$PCRED" "sitio/$sitio/dispositivo/$deveui/temperatura" '1'); [[ "$r" == *"RC:135"* ]] && ok "con su credencial NO publica como un dispositivo directo (RC:135)" || falla "tópico de dispositivo: $r"
    r=$(sub "$pid" "$PCRED" "$base/+/command/+"); [[ "$r" =~ :\ [0-2]$ ]] && ok "se suscribe a su subárbol de comandos, como pide ChirpStack ($r)" || falla "suscripción a sus comandos: «$r»"
    r=$(sub "$pid" "$PCRED" "sitio/$sitio/pasarela/otra-pasarela/+/command/+"); [[ "$r" == *": 135" ]] && ok "NO se suscribe a los comandos de otra pasarela (135)" || falla "comandos ajenos: «$r»"
    r=$(pub "$pid" "$PCRED" "$base/$deveui/command/down" '{}'); [[ "$r" == *"RC:135"* ]] && ok "NO publica en su propio subárbol de comandos (sin bucle; RC:135)" || falla "publica en sus comandos: $r"
    r=$(sub "$pid" "$PCRED" 'sitio/#'); [[ "$r" == *": 135" ]] && ok "NO se suscribe a todo el sitio (135)" || falla "suscripción a sitio/#: «$r»"
    r=$(pub_anon "$base/$deveui/up" '{}'); [[ "$r" == *"RC:135"* ]] && ok "un emulado (anónimo del banco) NO publica en el árbol de una pasarela (RC:135)" || falla "anónimo en árbol de pasarela: $r"
    # ── Milesight con códec (ruta B) ──
    mid="ug63-banco-$n"; r=$(api POST /pasarelas -d "{\"id_fisico\":\"$mid\",\"nombre\":\"UG63 del banco\",\"sitio_id\":\"$sitio_id\",\"formato\":\"milesight\"}")
    code=${r##*$'\n'}; body=${r%$'\n'*}; MCRED=$(json "v['conexion']['credencial']" <<<"$body"); mpas=$(json "v['id']" <<<"$body")
    [ "$code" = 201 ] && [ "$(json "v['conexion']['plantillas']['uplink']" <<<"$body")" = "sitio/$sitio/pasarela/$mid/\$devEUI/up" ] && ok "POST /pasarelas (milesight) → 201 con el tópico del uplink con \$devEUI" || falla "pasarela milesight → $code"
    mdev=$(openssl rand -hex 8); r=$(api POST /dispositivos -d "{\"id_fisico\":\"$mdev\",\"nombre\":\"EM300 del banco\",\"zona_id\":\"$zona\",\"via\":\"lorawan\",\"pasarela_id\":\"$mpas\",\"intervalo_esperado_s\":180,\"canales\":[{\"magnitud\":\"temperatura\"},{\"magnitud\":\"humedad\"},{\"magnitud\":\"bateria\"}]}")
    r=$(pub "$mid" "$MCRED" "sitio/$sitio/pasarela/$mid/$mdev/up" "{\"devEUI\":\"$mdev\",\"deviceName\":\"EM300\",\"applicationID\":\"1\",\"battery\":92,\"temperature\":30.8,\"humidity\":50.5}"); sleep 2
    r=$(psql_ -tA -c "SELECT count(*) || ' ' || string_agg(DISTINCT m.origen_tiempo, ',') FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='$mdev'")
    [ "$r" = "3 recepcion" ] && ok "Milesight con códec y Metadata → 3 lecturas con la hora de recepción (sin hora civil)" || falla "lecturas Milesight: «$r» (esperado «3 recepcion»)"
    r=$(pub "$mid" "$MCRED" "sitio/$sitio/pasarela/$mid/$mdev/up" "{\"applicationID\":\"3\",\"devEUI\":\"$mdev\",\"fCnt\":1,\"fPort\":85,\"data\":\"/wv//wEB\",\"rxInfo\":[]}"); sleep 1
    [[ "$(cuarentena "sitio/$sitio/pasarela/$mid/$mdev/up")" == *"activar Payload Codec"* ]] && ok "Milesight sin códec → malformada que dice qué activar" || falla "sin códec: $(cuarentena "sitio/$sitio/pasarela/$mid/$mdev/up")"
    visto0=$(visto "$mdev"); r=$(pub "$mid" "$MCRED" "sitio/$sitio/pasarela/$mid/$mdev/up" '{"devEUI": roto'); c=$(esperar_cuarentena "sitio/$sitio/pasarela/$mid/$mdev/up" '*JSON inválido*'); visto1=$(visto "$mdev")
    [[ "$c" == *"JSON inválido"* ]] && [ -n "$visto0" ] && [ "$visto0" = "$visto1" ] && ok "JSON roto por el tópico de la pasarela → malformada, y el nodo NO se marca vivo (sin DevEUI legible)" || falla "JSON roto: $(cuarentena "sitio/$sitio/pasarela/$mid/$mdev/up") · visto $visto0 → $visto1"
    # ── Milesight sin códec con perfil de decodificación, por el sufijo nativo y con fCnt (migración 17; docs/10 §8.4 punto 47 y §4.1) ──
    # La forma de la captura saneada de la UG65 del campus (`data` de 10 bytes: 18,16 °C, 65,52 %, 3,75 V), publicada como la deja un
    # puente de Mosquitto: …/pasarela/<id>/device/<deveui>/event/up. Después, el mismo fCnt con otra hora, uno nuevo y una data corta.
    [ "$(json "v['conexion']['plantillas']['puente_mosquitto']" <<<"$body")" = "topic device/+/event/# out 1 application/<app>/ sitio/$sitio/pasarela/$mid/" ] && ok "la respuesta del alta milesight trae la línea del puente de Mosquitto para el tópico nativo" || falla "plantilla puente_mosquitto"
    r=$(api POST /dispositivos -d "{\"id_fisico\":\"$(openssl rand -hex 8)\",\"nombre\":\"Directo con perfil\",\"zona_id\":\"$zona\",\"via\":\"mqtt\",\"decodificador\":\"campus-heltec-v3-v1\",\"intervalo_esperado_s\":60,\"canales\":[{\"magnitud\":\"temperatura\"}]}")
    [ "${r##*$'\n'}" = 400 ] && [[ "${r%$'\n'*}" == *"decodificador solo aplica a la vía lorawan"* ]] && ok "un perfil de decodificación en un dispositivo mqtt → 400 que lo explica" || falla "perfil en mqtt: ${r:0:160}"
    udev=$(openssl rand -hex 8); r=$(api POST /dispositivos -d "{\"id_fisico\":\"$udev\",\"nombre\":\"Nodo del campus (captura)\",\"zona_id\":\"$zona\",\"via\":\"lorawan\",\"pasarela_id\":\"$mpas\",\"decodificador\":\"campus-heltec-v3-v1\",\"intervalo_esperado_s\":180,\"canales\":[{\"magnitud\":\"temperatura\"},{\"magnitud\":\"humedad\"},{\"magnitud\":\"tension\"}]}")
    code=${r##*$'\n'}; [ "$code" = 201 ] && [ "$(json "v['decodificador']" <<<"${r%$'\n'*}")" = campus-heltec-v3-v1 ] && ok "alta del nodo con el perfil campus-heltec-v3-v1 y el canal tension → 201" || falla "alta con perfil → $code: ${r:0:160}"
    nativo="sitio/$sitio/pasarela/$mid/device/$udev/event/up"
    sincodec() { printf '{"applicationID":"3","applicationName":"app-de-prueba","data":"%s","devEUI":"%s","deviceName":"nodo-2","fCnt":%s,"fPort":1,"rxInfo":[{"loRaSNR":10.2,"mac":"aaaaaaaaaaaaaaaa","name":"Local Gateway","rssi":-46,"time":"%s"}],"time":"%s","txInfo":{"frequency":917000000}}' "$1" "$udev" "$2" "$3" "$3"; }
    t1=$(date -u -d '-30 seconds' +%Y-%m-%dT%H:%M:%S.340333Z); t2=$(date -u -d '-20 seconds' +%Y-%m-%dT%H:%M:%S.340333Z); t3=$(date -u -d '-10 seconds' +%Y-%m-%dT%H:%M:%S.340333Z)
    valores() { psql_ -tA -c "SELECT count(*) || ' ' || string_agg(DISTINCT m.origen_tiempo, ',') || ' ' || string_agg(c.magnitud_codigo || '=' || m.valor, ',' ORDER BY m.tiempo, c.magnitud_codigo) FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='$udev'"; }
    r=$(pub "$mid" "$MCRED" "$nativo" "$(sincodec AgAAAI8HGBmYrw== 142 "$t1")"); sleep 2
    [ "$(valores)" = "3 pasarela humedad=65.52,temperatura=18.16,tension=3.75" ] && ok "la captura por el sufijo nativo → 18,16 °C, 65,52 % y 3,75 V con la marca del servidor de red (origen pasarela)" || falla "captura decodificada: «$(valores)»"
    visto0=$(visto "$udev"); sleep 1.1
    r=$(pub "$mid" "$MCRED" "$nativo" "$(sincodec AgAAAI8HGBmYrw== 142 "$t2")"); sleep 2; visto1=$(visto "$udev")
    k=$(dc logs --no-color --since 1m backend 2>/dev/null | grep -c "$udev: trama repetida (fCnt 142")
    [ "$(valores | cut -d' ' -f1)" = 3 ] && [ -z "$(cuarentena "$nativo")" ] && [ "$k" -ge 1 ] && [ "$visto0" != "$visto1" ] && ok "el mismo fCnt con OTRA hora → descartada: sin lecturas nuevas ni cuarentena, anotada en el registro y el nodo vivo" || falla "fCnt repetido: $(valores) · cuarentena «$(cuarentena "$nativo")» · avisos $k · visto $visto0 → $visto1"
    r=$(pub "$mid" "$MCRED" "$nativo" "$(sincodec AgAAAJAHMBmYsA== 143 "$t3")"); sleep 2
    f=$(psql_ -tA -c "SELECT e.ultimo_fcnt FROM estado_dispositivo e JOIN dispositivo d ON d.id=e.dispositivo_id WHERE d.id_fisico='$udev'")
    [ "$(valores | cut -d' ' -f1)" = 6 ] && [ "$f" = 143 ] && ok "un fCnt nuevo → 3 lecturas más, y estado_dispositivo.ultimo_fcnt = 143" || falla "fCnt nuevo: $(valores) · ultimo_fcnt «$f»"
    # Porcentaje con la calibración del canal (docs/10 §8.4 punto 51): se calibra la humedad del nodo con 0 % = 0 y 100 % = 200 (una
    # escala cualquiera, para ver la cuenta); la última lectura (65,52) debe salir 32,8 % en la ficha y en el histórico. La ruta que
    # edita la calibración aún no existe: se pone en la base, como lo haría una migración de datos.
    psql_ -q -c "UPDATE canal SET escala_cero = 0, escala_cien = 200 FROM dispositivo d WHERE canal.dispositivo_id = d.id AND d.id_fisico = '$udev' AND canal.magnitud_codigo = 'humedad'"
    did=$(psql_ -tA -c "SELECT id FROM dispositivo WHERE id_fisico = '$udev'"); cid=$(psql_ -tA -c "SELECT c.id FROM canal c JOIN dispositivo d ON d.id = c.dispositivo_id WHERE d.id_fisico = '$udev' AND c.magnitud_codigo = 'humedad'")
    p=$(curl -s -m 5 "http://127.0.0.1:3001/dispositivos/$did" | python3 -c "import sys,json; c=[k for k in json.load(sys.stdin)['canales'] if k['magnitud']=='humedad'][0]; print(c['ultima_medicion']['porcentaje'])")
    q=$(curl -s -m 5 "http://127.0.0.1:3001/canales/$cid/historico?intervalo=1%20minute&desde=$(date -u -d '-10 minutes' +%Y-%m-%dT%H:%M:%SZ)" | python3 -c "import sys,json; v=json.load(sys.stdin); print(v['escala'], v['porcentajes'])")
    t=$(curl -s -m 5 "http://127.0.0.1:3001/dispositivos/$did" | python3 -c "import sys,json; c=[k for k in json.load(sys.stdin)['canales'] if k['magnitud']=='temperatura'][0]; print(c['ultima_medicion']['porcentaje'])")
    [ "$p" = 32.8 ] && [[ "$q" == "{'cero': 0, 'cien': 200}"* ]] && [[ "$q" == *32.8* ]] && [ "$t" = None ] && ok "con calibración, la ficha y el histórico traen el % (65,52 → 32,8 %); sin calibración, null" || falla "porcentaje: ficha «$p» · histórico «$q» · sin calibración «$t»"
    visto0=$(visto "$udev"); sleep 1.1
    r=$(pub "$mid" "$MCRED" "$nativo" "$(sincodec AgAAAI8HGBmY 144 "$t3")"); c=$(esperar_cuarentena "$nativo" 'malformada*10 bytes*'); visto1=$(visto "$udev")
    # El ayudante recorta el detalle a 90 caracteres: «…llegaron 9» queda fuera; el texto entero lo prueba lorawan.spec.ts.
    [[ "$c" == malformada*"se esperaban 10 bytes"* ]] && [ "$visto0" != "$visto1" ] && ok "una data de 9 bytes → malformada que lo dice, y el nodo vivo (su DevEUI se verificó)" || falla "data corta: «$c» · visto $visto0 → $visto1"
    # ── Mensajes retenidos (docs/10 §8.4 punto 50): en vivo se procesan una vez; la copia que el broker reentrega al suscribirse, no ──
    mdev2=$(openssl rand -hex 8); r=$(api POST /dispositivos -d "{\"id_fisico\":\"$mdev2\",\"nombre\":\"EM300 retenido\",\"zona_id\":\"$zona\",\"via\":\"lorawan\",\"pasarela_id\":\"$mpas\",\"intervalo_esperado_s\":180,\"canales\":[{\"magnitud\":\"temperatura\"}]}")
    n0=$(lecturas "$mdev"); r=$(pub_r "$mid" "$MCRED" "sitio/$sitio/pasarela/$mid/$mdev/up" "{\"devEUI\":\"$mdev\",\"temperature\":25.5}"); sleep 2; n1=$(lecturas "$mdev")
    [ "$n1" = $((n0 + 1)) ] && ok "un «up» retenido con el backend conectado se guarda una vez ($n0 → $n1 lecturas; llega con retain = 0)" || falla "retenido en vivo: $n0 → $n1 ($r)"
    trap 'dc start backend >/dev/null 2>&1' EXIT   # si el guion se corta con el backend detenido, lo vuelve a levantar
    dc stop backend >/dev/null 2>&1
    r=$(pub_r "$mid" "$MCRED" "sitio/$sitio/pasarela/$mid/$mdev2/up" "{\"devEUI\":\"$mdev2\",\"temperature\":26.5}")
    dc start backend >/dev/null 2>&1; trap - EXIT
    sano=0; for _ in $(seq 1 30); do curl -sf -m 2 -o /dev/null http://127.0.0.1:3001/salud && { sano=1; break; }; sleep 1; done
    [ "$sano" = 1 ] || falla "el backend no volvió a responder /salud en 30 s"
    # Se espera hasta ver lo que el backend debía procesar al reconectar (la lectura de la cola y los avisos), no un tiempo fijo.
    for _ in $(seq 1 30); do m=$(lecturas "$mdev2"); k=$(dc logs --no-color --since 1m backend 2>/dev/null | grep -c "mensaje retenido reentregado"); [ "$m" = 1 ] && [ "$k" -ge 2 ] && break; sleep 1; done
    n2=$(lecturas "$mdev")
    [ "$n2" = "$n1" ] && ok "al reconectar el backend, la copia retenida NO se reprocesa ($n1 → $n2 lecturas)" || falla "la copia retenida se reprocesó: $n1 → $n2"
    [ "$m" = 1 ] && ok "lo publicado con retención con el backend caído llega por la cola de su sesión y se guarda una vez ($m)" || falla "retenido con el backend caído: $m lecturas (esperado 1)"
    k=$(dc logs --no-color --since 1m backend 2>/dev/null | grep -c "mensaje retenido reentregado"); [ "$k" -ge 2 ] && ok "el backend anota cada copia retenida que descarta ($k avisos)" || falla "avisos de retenido: $k (esperado ≥ 2)"
    # ── Rotación y baja de la pasarela ChirpStack ──
    abrir_sesion "$pid" "$PCRED" "$base/+/command/+"; sesion_suscrita && ok "control: una sesión con la credencial vigente se conecta (registro del broker) y sigue abierta" || falla "la sesión de control no se conectó"
    r=$(api POST "/pasarelas/$pasarela/credencial"); code=${r##*$'\n'}; PCRED2=$(json "v['conexion']['credencial']" <<<"${r%$'\n'*}")
    sleep 4; if sesion_cortada; then ok "la rotación corta la sesión suscrita con la credencial anterior (el broker la desconecta por acción administrativa)"; wait "$S_PID" 2>/dev/null; else falla "la sesión con la credencial anterior no se cortó tras rotar: $(tail -2 "$PRIV/sesion.log" | tr '\n' ' ')"; cerrar_sesion; fi
    [ "$code" = 201 ] && [ "${#PCRED2}" = 32 ] && [ "$PCRED2" != "$PCRED" ] && ok "rotación → 201 con una credencial nueva (no se imprime)" || falla "rotación → $code"
    r=$(pub "$pid" "$PCRED" "$base/$deveui/up" "$(up "$deveui" '{"temperature":22}')"); [[ "$r" == *"Connection error"* ]] && ok "con la credencial ANTERIOR la pasarela ya no entra" || falla "la anterior sigue valiendo: $r"
    r=$(pub "$pid" "$PCRED2" "$base/$deveui/up" "$(up "$deveui" '{"temperature":22}')"); [[ "$r" == *"RC:0"* || "$r" == *"RC:16"* ]] && ok "con la credencial NUEVA publica ($r)" || falla "con la nueva: $r"
    abrir_sesion "$pid" "$PCRED2" "$base/+/command/+"; control=0
    sesion_suscrita && { control=1; ok "control: antes de la baja, una sesión con la credencial nueva se conecta"; } || falla "la sesión de control antes de la baja no se conectó"
    r=$(api DELETE "/pasarelas/$pasarela"); code=${r##*$'\n'}
    sleep 4; if [ "$control" = 1 ]; then if sesion_cortada; then ok "la baja corta la sesión suscrita (el broker la desconecta por acción administrativa)"; wait "$S_PID" 2>/dev/null; else falla "la sesión no se cortó tras la baja: $(tail -2 "$PRIV/sesion.log" | tr '\n' ' ')"; cerrar_sesion; fi; else cerrar_sesion; fi
    # La salida de la sesión no debe traer ninguna credencial (se cuenta sin imprimirla).
    k=$(grep -cF -f <(printf '%s\n' "${PCRED:-sin}" "${PCRED2:-sin}") "$PRIV/sesion.log"); [ "$k" = 0 ] || falla "una credencial aparece en la salida de la sesión larga"
    rm -f "$PRIV/sesion.log"
    [ "$code" = 200 ] && [ "$(json "v['nodos_sin_pasarela']" <<<"${r%$'\n'*}")" = 1 ] && ok "baja → 200, con 1 nodo que queda sin pasarela" || falla "baja → $code: ${r:0:160}"
    r=$(pub "$pid" "$PCRED2" "$base/$deveui/up" "$(up "$deveui" '{"temperature":22}')"); [[ "$r" == *"Connection error"* ]] && ok "dada de baja, el broker ya no acepta su credencial" || falla "la dada de baja sigue entrando: $r"
    curl -s http://127.0.0.1:3001/pasarelas | python3 -c "import sys,json; sys.exit(0 if any(p['id_fisico']=='$pid' and not p['activo'] for p in json.load(sys.stdin)) else 1)" && ok "GET /pasarelas la lista inactiva (historial conservado)" || falla "no aparece inactiva"
    r=$(api POST /dispositivos -d "{\"id_fisico\":\"$(openssl rand -hex 8)\",\"nombre\":\"Nodo tardío\",\"zona_id\":\"$zona\",\"via\":\"lorawan\",\"pasarela_id\":\"$pasarela\",\"intervalo_esperado_s\":180,\"canales\":[{\"magnitud\":\"temperatura\"}]}")
    [ "${r##*$'\n'}" = 400 ] && [[ "${r%$'\n'*}" == *"$pid está dada de baja"* ]] && ok "alta de un nodo con la pasarela dada de baja → 400 que la nombra" || falla "nodo con pasarela de baja: ${r:0:160}"
    k=$(dc logs --no-color --since 5m backend 2>/dev/null | grep -cF -f <(printf '%s\n' "${PCRED:-sin}" "${PCRED2:-sin}" "${MCRED:-sin}")); [ "$k" = 0 ] && ok "ninguna credencial de pasarela aparece en el registro del backend" || falla "una credencial se escribió en el registro"
    unset PCRED PCRED2 MCRED
    echo; [ $fallos -eq 0 ] && echo "LORAWAN OK" || { echo "$fallos comprobación(es) con falla"; exit 1; } ;;
  puente)
    # Ensayo del puente de la red del campus (docs/10 §8.4 punto 47; docs/16 §37): un segundo Mosquitto hace de broker del operador
    # (anónimo, como el suyo) y reenvía con un bloque «connection» como el del archivo de ejemplo, por TLS al 8883 del proxy, con
    # verificación del certificado y autenticado como la pasarela. Se publica la captura saneada en su tópico NATIVO y se espera la
    # lectura en medicion. La configuración lleva la credencial de la pasarela: vive en la carpeta privada del banco, sale de una
    # sola invocación y se borra al final con la pasarela (de descarte). El broker del operador corre con el usuario del equipo y su
    # carpeta montada en /c (nunca en /mosquitto: su entrypoint cambia dueños, docs/11 §7).
    # Variante «ip» (docs/10 §8.4 punto 47): la pasarela del campus se conectará al portátil por su dirección IP en la red local, así que
    # el certificado debe incluirla (CA_IP_EXTRA) y el proxy publicarse solo en ella (PROXY_IP_DISPOSITIVOS). Se ensaya con 127.0.0.2,
    # otra dirección de loopback que Linux atiende sin configurar nada: la misma mecánica, sin exponer nada a la red. Usa una CA de
    # descarte en la carpeta privada del banco (no toca la CA de desarrollo) y al final devuelve el proxy a sus certificados.
    CLAVE=$(leer HTTP_CLAVE_ADMIN); fallos=0; n=$(date +%s | tail -c 5); modo="${2:-nombre}"
    ok() { echo "OK    $1"; }; falla() { echo "FALLA $1"; fallos=$((fallos+1)); }
    api() { local m=$1 r=$2; shift 2; printf 'X-Clave-Admin: %s\n' "$CLAVE" | curl -s -m 10 -w '\n%{http_code}' -X "$m" -H @- -H 'Content-Type: application/json' "$@" "http://127.0.0.1:3001$r"; }
    json() { python3 -c "import sys,json; v=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
    [ -f "$CERTS/ca.crt" ] || bash proxy/ca-desarrollo.sh "$CERTS"
    if [ "$modo" = ip ]; then
      IP_PUENTE=127.0.0.2; certs_ip="$PRIV/certs-ip"; rm -rf "$certs_ip"
      CA_IP_EXTRA=$IP_PUENTE bash proxy/ca-desarrollo.sh "$certs_ip" >/dev/null || { echo "FALLA no se generó el certificado con CA_IP_EXTRA"; exit 1; }
      openssl x509 -in "$certs_ip/servidor.crt" -noout -ext subjectAltName | grep -q "IP Address:$IP_PUENTE" && ok "certificado de descarte con la IP del puente en el SAN (CA_IP_EXTRA=$IP_PUENTE)" || falla "el certificado no trae la IP extra"
      PROXY_CERTS="$certs_ip" PROXY_IP_DISPOSITIVOS=$IP_PUENTE dcp up -d --force-recreate proxy >/dev/null 2>&1 || { echo "FALLA no se levantó el proxy en $IP_PUENTE"; exit 1; }
      destino="$IP_PUENTE:$(leer PROXY_MQTTS)"; ca_puente="$certs_ip/ca.crt"
    else
      dcp up -d proxy >/dev/null 2>&1 || { echo "FALLA no se levantó el proxy"; exit 1; }
      destino="proxy:8883"; ca_puente="$CERTS/ca.crt"
    fi
    # Una sola limpieza, registrada apenas se tocó el proxy (revisión del 16/10: antes se registraba tarde y un corte temprano dejaba el
    # proxy en la IP de prueba y la pasarela de descarte activa): borra el broker del operador y su configuración con la credencial,
    # revoca la pasarela si sigue activa y devuelve el proxy a sus certificados, avisando si no puede.
    pas=""; revocada=0
    restaurar_proxy() { [ "$modo" = ip ] || return 0
      if dcp up -d --force-recreate proxy >/dev/null 2>&1; then rm -rf "${PRIV:?}/certs-ip"
      else echo "FALLA no se pudo devolver el proxy a sus certificados: repetir «banco.sh proxy» o «banco.sh apagar»"; fi; }
    limpiar() { docker rm -f banco-puente >/dev/null 2>&1; rm -rf "${PRIV:?}/puente"
      [ -n "$pas" ] && [ "$revocada" = 0 ] && api DELETE "/pasarelas/$pas" >/dev/null 2>&1; restaurar_proxy; }
    trap limpiar EXIT
    for _ in $(seq 1 20); do [ "$(dcp ps --format '{{.Status}}' proxy | grep -c healthy)" = 1 ] && break; sleep 2; done
    red=$(docker network ls --format '{{.Name}}' | grep '^banco_default$')
    read -r sitio_id sitio zona < <(psql_ -tA -F ' ' -c "SELECT s.id, s.codigo, z.id FROM sitio s JOIN zona z ON z.sitio_id = s.id ORDER BY s.codigo LIMIT 1")
    pid="ug65-puente-$n"; r=$(api POST /pasarelas -d "{\"id_fisico\":\"$pid\",\"nombre\":\"UG65 del ensayo del puente\",\"sitio_id\":\"$sitio_id\",\"formato\":\"milesight\"}")
    code=${r##*$'\n'}; body=${r%$'\n'*}; [ "$code" = 201 ] || { echo "FALLA POST /pasarelas → $code"; exit 1; }
    pas=$(json "v['id']" <<<"$body"); linea=$(json "v['conexion']['plantillas']['puente_mosquitto']" <<<"$body")
    udev=$(openssl rand -hex 8); r=$(api POST /dispositivos -d "{\"id_fisico\":\"$udev\",\"nombre\":\"Nodo del ensayo del puente\",\"zona_id\":\"$zona\",\"via\":\"lorawan\",\"pasarela_id\":\"$pas\",\"decodificador\":\"campus-heltec-v3-v1\",\"intervalo_esperado_s\":180,\"canales\":[{\"magnitud\":\"temperatura\"},{\"magnitud\":\"humedad\"},{\"magnitud\":\"tension\"}]}")
    [ "${r##*$'\n'}" = 201 ] && ok "pasarela milesight y nodo con perfil dados de alta" || falla "alta del nodo → ${r##*$'\n'}"
    # La configuración del broker del operador: el bloque del archivo de ejemplo, con la línea «topic» tal como la entrega el alta
    # (cambiando <app> por la aplicación de la captura) y la credencial, escrita sin pasar por la línea de comandos.
    cfg="$PRIV/puente"; rm -rf "$cfg"; mkdir -p "$cfg"; cp "$ca_puente" "$cfg/ca.crt"   # la credencial se escribe ya con la limpieza registrada
    # Por IP, el broker del operador corre en la red del equipo (como su portátil en la red de la facultad): escucha en un puerto propio
    # de loopback para no chocar con el broker de la pila de desarrollo. Es anónimo como el del operador: cualquier usuario de este equipo
    # podría publicar en él durante la prueba y cruzaría como la pasarela; riesgo aceptado (dura segundos y el filtro 1 exige DevEUI dado de alta).
    if [ "$modo" = ip ]; then escucha="listener 18830 127.0.0.1"; red_op=host; h_op=127.0.0.1; p_op=18830; else escucha="listener 1883"; red_op="$red"; h_op=banco-puente; p_op=1883; fi
    ( umask 077; { echo "$escucha"; echo "allow_anonymous true"; echo "persistence false"
        echo "connection hacia-plataforma"; echo "address $destino"; echo "bridge_cafile /c/ca.crt"; echo "bridge_insecure false"
        echo "remote_clientid $pid"; echo "remote_username $pid"; printf 'remote_password %s\n' "$(json "v['conexion']['credencial']" <<<"$body")"
        echo "cleansession false"; echo "notifications false"; echo "start_type automatic"; echo "restart_timeout 2 10"
        echo "${linea/<app>/app-de-prueba}"; } > "$cfg/mosquitto.conf" )
    unset body r
    [[ "$linea" == "topic device/+/event/# out 1 application/<app>/ sitio/$sitio/pasarela/$pid/" ]] && ok "la línea del puente que entrega el alta es la que se usa ($linea)" || falla "línea del puente: $linea"
    docker rm -f banco-puente >/dev/null 2>&1
    docker run -d --name banco-puente --network "$red_op" --user "$(id -u):$(id -g)" -v "$cfg:/c:ro" --entrypoint mosquitto "$IMG_BROKER" -c /c/mosquitto.conf >/dev/null || falla "no arrancó el broker del operador"
    # El registro del broker trae el id de cliente y el usuario («as <id> (… u'<usuario>')»): se exigen los dos.
    conectado=0; for _ in $(seq 1 30); do dc logs --no-color --since 2m mosquitto 2>/dev/null | grep -q "as $pid (.*u'$pid')" && { conectado=1; break; }; sleep 1; done
    [ "$conectado" = 1 ] && ok "el puente entró a nuestro broker como la pasarela, por $destino (proxy) con TLS y el certificado verificado" || falla "el puente no se conectó: $(docker logs banco-puente 2>&1 | tail -2 | tr '\n' ' ')"
    lec() { psql_ -tA -c "SELECT count(*) || ' ' || coalesce(string_agg(c.magnitud_codigo || '=' || m.valor, ',' ORDER BY c.magnitud_codigo), '') FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='$udev'"; }
    pub_local() { docker run --rm --network "$red_op" "$IMG_BROKER" mosquitto_pub -h "$h_op" -p "$p_op" -q 1 -t "$1" -m "$2"; }
    t=$(date -u -d '-20 seconds' +%Y-%m-%dT%H:%M:%S.340333Z)
    pub_local "application/app-de-prueba/device/$udev/event/up" "{\"applicationID\":\"3\",\"data\":\"AgAAAI8HGBmYrw==\",\"devEUI\":\"$udev\",\"deviceName\":\"nodo-2\",\"fCnt\":142,\"fPort\":1,\"rxInfo\":[{\"rssi\":-46,\"loRaSNR\":10.2}],\"time\":\"$t\"}"
    for _ in $(seq 1 20); do [ "$(lec | cut -d' ' -f1)" = 3 ] && break; sleep 0.5; done
    [ "$(lec)" = "3 humedad=65.52,temperatura=18.16,tension=3.75" ] && ok "la captura publicada en el tópico nativo del operador llegó por el puente: 18,16 °C, 65,52 % y 3,75 V" || falla "lecturas por el puente: «$(lec)»"
    r=$(psql_ -tA -c "SELECT topico FROM trama t JOIN dispositivo d ON d.id=t.dispositivo_id WHERE d.id_fisico='$udev' LIMIT 1")
    [ "$r" = "sitio/$sitio/pasarela/$pid/device/$udev/event/up" ] && ok "llegó con solo el prefijo cambiado (sufijo nativo): $r" || falla "tópico recibido: «$r»"
    pub_local "application/app-de-prueba/device/$udev/command/down" '{"x":1}'; sleep 2
    k=$(psql_ -tA -c "SELECT count(*) FROM cuarentena WHERE topico LIKE 'sitio/$sitio/pasarela/$pid/device/%/command/%'")
    [ "$k" = 0 ] && ok "un comando en el broker del operador NO cruza el puente (solo device/+/event/#)" || falla "cruzaron $k comando(s)"
    otro=$(openssl rand -hex 8); pub_local "application/app-de-prueba/device/$otro/event/up" "{\"devEUI\":\"$otro\",\"data\":\"AgAAAI8HGBmYrw==\",\"fPort\":1}"
    c=""; for _ in $(seq 1 20); do c=$(psql_ -tA -c "SELECT motivo FROM cuarentena WHERE topico = 'sitio/$sitio/pasarela/$pid/device/$otro/event/up'"); [ -n "$c" ] && break; sleep 0.5; done
    [ "$c" = no_registrado ] && ok "lo que un anónimo publique en su broker cruza como la pasarela, y el filtro 1 lo frena si el DevEUI no está dado de alta (riesgo anotado)" || falla "DevEUI ajeno por el puente: «$c»"
    # La baja de la pasarela es también la limpieza: revoca la credencial y el broker corta el puente.
    r=$(api DELETE "/pasarelas/$pas"); [ "${r##*$'\n'}" = 200 ] && { revocada=1; ok "baja de la pasarela de descarte (credencial revocada)"; } || falla "baja → ${r##*$'\n'}"
    cortado=0; for _ in $(seq 1 15); do dc logs --no-color --since 1m mosquitto 2>/dev/null | grep -q "Client $pid .*disconnected" && { cortado=1; break; }; sleep 1; done
    [ "$cortado" = 1 ] && ok "al dar de baja la pasarela, nuestro broker corta el puente" || falla "el puente siguió conectado tras la baja"
    k=$(dc logs --no-color --since 5m backend 2>/dev/null | grep -cF -f <(sed -n 's/^remote_password //p' "$cfg/mosquitto.conf")); [ "$k" = 0 ] && ok "la credencial del puente no aparece en el registro del backend" || falla "la credencial aparece en el registro"
    trap - EXIT; limpiar
    echo; [ $fallos -eq 0 ] && echo "PUENTE OK" || { echo "$fallos comprobación(es) con falla"; exit 1; } ;;
  http)
    # Recepción por HTTP (RF-01, HU-01; docs/10 §8.4 punto 52; docs/16 §41). Alta de un dispositivo de vía http por la API (entrega un
    # token), y cada respuesta: 202 con la lectura en medicion, 401 sin revelar el motivo, 413, 415, 422 con su cuarentena de origen http,
    # el formato plano con ?magnitud=, la ruta en mayúsculas, la baja, dos topes (una trama por segundo y 5 fallos por dirección; el cupo
    # de 2 verificaciones a la vez lo prueba recepcion-http.controller.spec.ts) y que, a través del proxy, una dirección falsa en
    # X-Forwarded-For no se cree. Los tokens viajan por la entrada estándar de curl, nunca por argumentos.
    CLAVE=$(leer HTTP_CLAVE_ADMIN); fallos=0; n=$(date +%s | tail -c 5)
    ok() { echo "OK    $1"; }; falla() { echo "FALLA $1"; fallos=$((fallos+1)); }
    api() { local m=$1 r=$2; shift 2; printf 'X-Clave-Admin: %s\n' "$CLAVE" | curl -s -m 10 -w '\n%{http_code}' -X "$m" -H @- -H 'Content-Type: application/json' "$@" "http://127.0.0.1:3001$r"; }
    json() { python3 -c "import sys,json; v=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
    # enviar <token> <id> <tipo> <cuerpo> [extra curl]: código y cuerpo de la respuesta (el token entra por la entrada estándar)
    enviar() { local tk=$1 id=$2 tipo=$3 cuerpo=$4; shift 4; printf 'Authorization: Bearer %s\n' "$tk" | curl -s -m 10 -w '\n%{http_code}' -H @- -H "Content-Type: $tipo" --data-binary "$cuerpo" "$@" "http://127.0.0.1:3001/recepcion/$id"; }
    codigo() { printf '%s' "${1##*$'\n'}"; }; cuerpo() { printf '%s' "${1%$'\n'*}"; }
    # Los contadores de fallos viven en la memoria del backend y una corrida anterior pudo dejar fallos dentro de la ventana de 60 s
    # (o la dirección bloqueada): se parte de cero reiniciándolo, en vez de suponer cuántos quedaron.
    dc restart backend >/dev/null 2>&1; for _ in $(seq 1 30); do [ "$(dc ps --format '{{.Status}}' backend | grep -c healthy)" = 1 ] && break; sleep 2; done
    zona=$(psql_ -tA -c "SELECT id FROM zona ORDER BY id LIMIT 1")
    hid="http-$n"; r=$(api POST /dispositivos -d "{\"id_fisico\":\"$hid\",\"nombre\":\"Nodo HTTP del banco\",\"zona_id\":\"$zona\",\"via\":\"http\",\"intervalo_esperado_s\":60,\"canales\":[{\"magnitud\":\"temperatura\"}]}")
    [ "$(codigo "$r")" = 201 ] || { echo "FALLA alta del dispositivo http → $(codigo "$r")"; exit 1; }
    TK=$(json "v['conexion']['token']" <<<"$(cuerpo "$r")"); HUID=$(json "v['id']" <<<"$(cuerpo "$r")"); unset r
    pid="plano-$n"; r=$(api POST /dispositivos -d "{\"id_fisico\":\"$pid\",\"nombre\":\"Nodo HTTP plano\",\"zona_id\":\"$zona\",\"via\":\"http\",\"formato\":\"plano\",\"intervalo_esperado_s\":60,\"canales\":[{\"magnitud\":\"humedad\"}]}")
    TKP=$(json "v['conexion']['token']" <<<"$(cuerpo "$r")"); unset r
    [ "${#TK}" = 32 ] && [ "${#TKP}" = 32 ] && ok "alta de dos dispositivos de vía http por la API: cada uno con su token (no se imprime)" || falla "tokens del alta"
    lec() { psql_ -tA -c "SELECT count(*) FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='$1'"; }
    t=$(date +%s); senml="[{\"bn\":\"$hid\",\"bt\":$t,\"n\":\"temperatura\",\"u\":\"Cel\",\"v\":21.5}]"
    r=$(enviar "$TK" "$hid" application/senml+json "$senml")
    [ "$(codigo "$r")" = 202 ] && [ "$(json "v['guardadas']" <<<"$(cuerpo "$r")")" = 1 ] && [ "$(lec "$hid")" = 1 ] && ok "SenML válida → 202 con el resumen, y la lectura en medicion" || falla "válida: $(codigo "$r") $(cuerpo "$r") · lecturas $(lec "$hid")"
    q=$(psql_ -tA -c "SELECT t.topico || ' ' || t.adaptador FROM trama t JOIN dispositivo d ON d.id=t.dispositivo_id WHERE d.id_fisico='$hid'")
    [ "$q" = "/recepcion/$hid senml" ] && ok "la trama cruda guarda la ruta HTTP y el adaptador (RF-09)" || falla "trama cruda: «$q»"
    r=$(enviar "$TK" "$hid" application/senml+json "$senml"); [ "$(codigo "$r")" = 429 ] && ok "la misma trama antes de un segundo → 429 (una trama por segundo por dispositivo)" || falla "ritmo: $(codigo "$r")"
    sleep 1.1; r=$(enviar "$TK" "$hid" application/json "$senml")
    [ "$(codigo "$r")" = 202 ] && [ "$(json "v['repetidas']" <<<"$(cuerpo "$r")")" = 1 ] && [ "$(lec "$hid")" = 1 ] && ok "la misma trama otra vez (pasado el segundo) → 202 con 1 repetida, sin duplicar la lectura (idempotente, RF-10)" || falla "repetida: $(codigo "$r") $(cuerpo "$r")"
    sleep 1.1; r=$(enviar "$TK" "$hid" application/json 'hola')
    q=$(psql_ -tA -c "SELECT origen || ' ' || motivo FROM cuarentena WHERE topico = '/recepcion/$hid' ORDER BY recibido_en DESC LIMIT 1")
    [ "$(codigo "$r")" = 422 ] && [ "$q" = "http malformada" ] && ok "una trama que no se entiende → 422 con el motivo, y a cuarentena con origen http" || falla "malformada: $(codigo "$r") · cuarentena «$q»"
    sleep 1.1; r=$(enviar "$TK" "$hid" application/json "[{\"bn\":\"$hid\",\"bt\":$((t+5)),\"n\":\"temperatura\",\"u\":\"Cel\",\"v\":999}]")
    [ "$(codigo "$r")" = 422 ] && [[ "$(cuerpo "$r")" == *"fuera del rango"* ]] && ok "ninguna lectura válida (fuera de rango) → 422 con el porqué" || falla "fuera de rango: $(codigo "$r") $(cuerpo "$r")"
    r=$(enviar "$TKP" "$pid?magnitud=humedad" text/plain '55.5')
    [ "$(codigo "$r")" = 202 ] && [ "$(lec "$pid")" = 1 ] && ok "formato plano con ?magnitud= → 202 y la lectura en medicion" || falla "plano: $(codigo "$r") $(cuerpo "$r")"
    r=$(enviar "$TK" "$hid" application/xml '<a/>'); [ "$(codigo "$r")" = 415 ] && ok "un cuerpo que no es JSON ni texto → 415" || falla "xml: $(codigo "$r")"
    head -c 70000 /dev/zero | tr '\0' 'a' > "$PRIV/grande.txt"
    r=$(printf 'Authorization: Bearer %s\n' "$TK" | curl -s -m 10 -w '\n%{http_code}' -H @- -H 'Content-Type: text/plain' --data-binary @"$PRIV/grande.txt" "http://127.0.0.1:3001/recepcion/$hid"); rm -f "$PRIV/grande.txt"
    [ "$(codigo "$r")" = 413 ] && ok "más de 64 KiB → 413 (el tope del broker)" || falla "grande: $(codigo "$r")"
    # La ruta en mayúsculas llega al mismo controlador (Express no distingue): el cuerpo debe llegar crudo igual, no vacío.
    sleep 1.1; r=$(printf 'Authorization: Bearer %s\n' "$TK" | curl -s -m 10 -w '\n%{http_code}' -H @- -H 'Content-Type: application/json' --data-binary "[{\"bn\":\"$hid\",\"bt\":$((t+10)),\"n\":\"temperatura\",\"u\":\"Cel\",\"v\":22}]" "http://127.0.0.1:3001/RECEPCION/$hid")
    [ "$(codigo "$r")" = 202 ] && [ "$(lec "$hid")" = 2 ] && ok "la ruta en mayúsculas → 202 con el cuerpo leído (el lector crudo no distingue mayúsculas)" || falla "mayúsculas: $(codigo "$r") $(cuerpo "$r")"
    # A través del proxy, la dirección que cuenta es la que ve el proxy: una dirección falsa en X-Forwarded-For no se cree.
    [ -f "$CERTS/ca.crt" ] || bash proxy/ca-desarrollo.sh "$CERTS"
    dcp up -d proxy >/dev/null 2>&1; for _ in $(seq 1 20); do [ "$(dcp ps --format '{{.Status}}' proxy | grep -c healthy)" = 1 ] && break; sleep 2; done
    curl -s -m 10 -o /dev/null --cacert "$CERTS/ca.crt" -H 'Authorization: Bearer xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' -H 'X-Forwarded-For: 203.0.113.7' -H 'Content-Type: application/json' -d '[]' "https://localhost:8443/recepcion/$hid"
    sleep 1; linea=$(dc logs --no-color --since 1m backend 2>/dev/null | grep 'recepción HTTP rechazada (401)' | tail -1)
    [ -n "$linea" ] && [[ "$linea" != *"203.0.113.7"* ]] && ok "por el proxy, una dirección falsa en X-Forwarded-For no se cree (el registro anota la que vio el proxy)" || falla "dirección tras el proxy: «${linea:0:160}»"
    # Mismo 401 para todo motivo: token malo, dispositivo desconocido, sin cabecera, y el token de otro dispositivo.
    c1=$(codigo "$(enviar xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx "$hid" application/json '[]')"); c2=$(codigo "$(enviar xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx nadie-0001 application/json '[]')")
    c3=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '[]' "http://127.0.0.1:3001/recepcion/$hid"); c4=$(codigo "$(enviar "$TKP" "$hid" application/json '[]')")
    [ "$c1$c2$c3$c4" = 401401401401 ] && ok "token malo, dispositivo desconocido, sin cabecera y token de otro dispositivo → el mismo 401" || falla "401: $c1 $c2 $c3 $c4"
    # Fallos desde la misma dirección hasta que llegue el bloqueo: debe llegar a más tardar en el quinto de la ventana (ya hay al menos
    # cuatro arriba: no se supone cuántos había antes, el mismo backend pudo recibir otros). Bloqueada, ni el token bueno entra.
    intentos=0; c=401; while [ "$c" = 401 ] && [ $intentos -lt 6 ]; do c=$(codigo "$(enviar xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx "$hid" application/json '[]')"); intentos=$((intentos+1)); done
    sleep 1.1; c6=$(codigo "$(enviar "$TKP" "$pid?magnitud=humedad" text/plain '56.5')") # el plano sigue activo: su token es bueno
    [ "$c" = 429 ] && [ $intentos -le 2 ] && [ "$c6" = 429 ] && ok "a los 5 fallos de autenticación la dirección queda bloqueada (429), incluso con el token bueno" || falla "bloqueo por fallos: $c tras $intentos intento(s) más; con el token bueno $c6"
    # Los contadores viven en la memoria del proceso (docs/10 §8.4 punto 52): al reiniciar el backend, la dirección queda libre. Dado de
    # baja por la API, su token ya no entra (401, como cualquier otro motivo). Va al final: el backend ve una sola dirección para las
    # peticiones directas y las del proxy (la de la red de Docker, no 127.0.0.1), así que cada 401 de arriba cuenta para el bloqueo.
    dc restart backend >/dev/null 2>&1; for _ in $(seq 1 30); do [ "$(dc ps --format '{{.Status}}' backend | grep -c healthy)" = 1 ] && break; sleep 2; done
    code=$(printf 'X-Clave-Admin: %s\n' "$CLAVE" | curl -s -m 10 -o /dev/null -w '%{http_code}' -X DELETE -H @- "http://127.0.0.1:3001/dispositivos/$HUID")
    r=$(enviar "$TK" "$hid" application/json "$senml")
    [ "$code" = 200 ] && [ "$(codigo "$r")" = 401 ] && ok "tras reiniciar, la dirección queda libre; y dado de baja por la API, su token ya no entra (401)" || falla "baja: DELETE $code, envío $(codigo "$r")"
    k=$(dc logs --no-color --since 10m backend 2>/dev/null | grep -cF -f <(printf '%s\n' "${TK:-sin}" "${TKP:-sin}")); [ "$k" = 0 ] && ok "ningún token aparece en el registro del backend" || falla "un token aparece en el registro"
    unset TK TKP CLAVE
    echo; [ $fallos -eq 0 ] && echo "HTTP OK" || { echo "$fallos comprobación(es) con falla"; exit 1; } ;;
  navegador)
    # P3 en un navegador real (docs/19 §6 y §7; docs/16 §39). Playwright (dependencia de desarrollo del panel, versión fijada) maneja
    # Firefox; su navegador se descarga una vez a ~/.cache/ms-playwright (311 MB medidos el 16/10) con «playwright install», desde el servidor de Playwright, sin una
    # huella que el guion compare (la versión del navegador la fija la de Playwright). Se siembran tres lecturas
    # pasadas de emu-0001 para que el histórico tenga puntos, y la prueba detiene y arranca el backend del banco. La captura queda en la
    # carpeta privada del banco, nunca en el repositorio.
    [ "$(dc ps --format '{{.Status}}' backend | grep -c healthy)" = 1 ] || { echo "FALLA el banco no está arriba: «banco.sh encender» primero"; exit 1; }
    (cd backend/panel && pnpm -s exec playwright install firefox >/dev/null) || { echo "FALLA no se pudo preparar Firefox para Playwright"; exit 1; }
    red=$(docker network ls --format '{{.Name}}' | grep '^banco_default$')
    read -r did sitio < <(psql_ -tA -F ' ' -c "SELECT d.id, s.codigo FROM dispositivo d JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id WHERE d.id_fisico = 'emu-0001'")
    cid=$(psql_ -tA -c "SELECT c.id FROM canal c JOIN dispositivo d ON d.id = c.dispositivo_id WHERE d.id_fisico = 'emu-0001' AND c.magnitud_codigo = 'temperatura'")
    [ -n "$did" ] && [ -n "$cid" ] || { echo "FALLA no está emu-0001 con su canal de temperatura (¿«encender» sin emulados?)"; exit 1; }
    for m in 50 35 20; do t=$(($(date +%s) - m * 60))
      docker run --rm --network "$red" "$IMG_BROKER" mosquitto_pub -h mosquitto -q 1 -t "sitio/$sitio/dispositivo/emu-0001/temperatura" \
        -m "[{\"bn\":\"emu-0001\",\"bt\":$t,\"n\":\"temperatura\",\"u\":\"Cel\",\"v\":2$((m / 10)).5}]"; done
    sleep 2
    (cd backend/panel && node e2e/p3.mjs http://127.0.0.1:3001 "$did" "$cid" emu-0001 "$sitio" "$red" "$IMG_BROKER" banco-backend-1 "$PRIV/p3.png")
    r=$?; echo "captura: $PRIV/p3.png"; exit $r ;;
  cola)
    # Cola del broker vigilada (docs/10 §8.4 punto 43; docs/16 §22): PLANTAR la violación. Con el backend detenido, 200 emulados a
    # 1 trama/s durante 70 s (≈ 14 000 mensajes) desbordan la cola de la sesión persistente del backend (tope 10 000): el broker
    # descarta en silencio para el emisor. Al volver, la primera muestra compara con la última guardada y abre broker_descarte;
    # cuando la cola se vacía y no hay descartes nuevos en dos muestras seguidas, la cierra sola. En el banco la muestra corre
    # cada 10 s (compose.banco.yml). Comprobaciones: /salud trae los contadores; el contador de descartes creció (el tope rige);
    # la condición abierta con motivo «descartes», su evento y el aviso en /salud; muestras en metrica_broker; cierre automático.
    fallos=0; ok() { echo "OK    $1"; }; falla() { echo "FALLA $1"; fallos=$((fallos+1)); }
    salud() { curl -s -m 3 http://127.0.0.1:3001/salud; }
    campo() { python3 -c "import sys,json; v=json.load(sys.stdin)['broker']['$1']; print('' if v is None else v)"; }
    d0=$(salud | campo mensajes_descartados)
    [ -n "$d0" ] && ok "GET /salud trae los contadores \$SYS del broker (descartados hasta ahora: $d0)" || { echo "FALLA /salud sin contadores del broker (¿la administradora no lee \$SYS?)"; exit 1; }
    # Sin una muestra guardada ANTES de la caída no hay con qué comparar al volver (la primera muestra de un proceso sin historia
    # fija la referencia y no alarma): se espera a que exista (primera corrida del 13/10: faltaba y la alarma nunca se abrió).
    ultima=""; for _ in $(seq 1 8); do ultima=$(salud | campo ultima_muestra); [ -n "$ultima" ] && break; sleep 5; done
    [ -n "$ultima" ] && ok "muestra de referencia guardada antes de la caída ($ultima)" || { echo "FALLA sin muestra de referencia a los 40 s: no se puede plantar la violación"; exit 1; }
    dc stop backend >/dev/null 2>&1 && ok "backend detenido: el broker encola para su sesión persistente"
    emu correr --url mqtt://127.0.0.1:1884 --dispositivos 200 --periodo 1 --duracion 70 --perdida 0 --caidas 0 --sin-sys --salida "$CSV" >/dev/null 2>&1 && ok "200 emulados a 1 trama/s durante 70 s con el backend caído (≈ 14 000 mensajes contra un tope de 10 000)" || falla "el emulador no terminó bien"
    dc start backend >/dev/null 2>&1
    for _ in $(seq 1 30); do [ -n "$(dc ps --format '{{.Status}}' backend | grep healthy)" ] && break; sleep 3; done
    [ -n "$(dc ps --format '{{.Status}}' backend | grep healthy)" ] && ok "backend de vuelta (healthy)" || { echo "FALLA el backend no volvió a healthy"; exit 1; }
    abierta=""; for _ in $(seq 1 9); do sleep 5; abierta=$(salud | campo condicion_abierta); [ -n "$abierta" ] && break; done
    abrio=$abierta
    [ "$abierta" = broker_descarte ] && ok "condición del sistema broker_descarte ABIERTA al volver (la ve GET /salud)" || falla "sin condición abierta a los 45 s (condicion_abierta=«$abierta»)"
    d1=$(salud | campo mensajes_descartados)
    [ -n "$d1" ] && [ "$d1" -gt "$d0" ] && ok "el broker descartó $((d1 - d0)) mensajes: el tope de 10 000 rige y el contador \$SYS lo delata" || falla "descartes $d0 → ${d1:-?}: el tope no actuó o el contador no llegó"
    m=$(psql_ -tA -c "SELECT detalle->'motivos' FROM condicion_sistema WHERE tipo='broker_descarte' ORDER BY abierta_en DESC LIMIT 1" | tr -d '[:space:]')
    [[ "$m" == *descartes* ]] && ok "condicion_sistema: fila broker_descarte con motivo «descartes» ($m)" || falla "fila de condicion_sistema: «$m»"
    n=$(psql_ -tA -c "SELECT count(*) FROM evento WHERE tipo='condicion_abierta' AND detalle->>'tipo'='broker_descarte'" | tr -d '[:space:]'); [ "$n" -ge 1 ] && ok "evento condicion_abierta (broker_descarte) registrado" || falla "evento de apertura: $n"
    n=$(psql_ -tA -c "SELECT count(*) FROM metrica_broker" | tr -d '[:space:]'); [ "$n" -ge 2 ] && ok "metrica_broker tiene $n muestras" || falla "muestras en metrica_broker: $n"
    for _ in $(seq 1 14); do sleep 5; abierta=$(salud | campo condicion_abierta); [ -z "$abierta" ] && break; done
    # Solo cuenta como cierre si antes se abrió: un «vacío» desde el principio no prueba nada.
    [ "$abrio" = broker_descarte ] && [ -z "$abierta" ] && ok "se cerró sola al vaciarse la cola sin descartes nuevos (dos muestras normales)" || falla "no se cerró sola (abrió: «${abrio:-no}», ahora: «$abierta»)"
    n=$(psql_ -tA -c "SELECT count(*) FROM condicion_sistema WHERE tipo='broker_descarte' AND cerrada_en IS NOT NULL" | tr -d '[:space:]'); [ "$n" -ge 1 ] && ok "condicion_sistema: cerrada_en escrito y evento de cierre" || falla "cierre en la base: $n"
    echo; [ $fallos -eq 0 ] && echo "COLA OK" || { echo "$fallos comprobación(es) con falla"; exit 1; } ;;
  apagar) dcp down 2>/dev/null || dc down; rm -f "$ENV" ;;
  *) sed -n 2,12p "$YO"; exit 2 ;;
esac
