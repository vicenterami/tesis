#!/usr/bin/env bash
# Banco de pruebas DESECHABLE para TT-28 (emulador), TT-29 (carga) y las pruebas de carrera (docs/04 §rúbrica).
# Levanta una segunda pila aparte (proyecto Compose «banco») sin tocar la de desarrollo: otros puertos, datos en RAM,
# broker sin credenciales (ver pruebas/banco/compose.banco.yml). Desde cualquier carpeta:
#   bash plataforma/pruebas/banco/banco.sh encender [N] [F]    levanta y siembra N emulados (100) con intervalo = periodo × F (2; con 1 se reproducen las alarmas falsas)
#   bash plataforma/pruebas/banco/banco.sh correr [opciones]   corre el emulador contra el banco y evalúa (ver emulador.ts)
#   bash plataforma/pruebas/banco/banco.sh carrera [disp]      las dos pruebas de carrera: mismo instante ×20 y umbral ×5 (docs/16 §4)
#   bash plataforma/pruebas/banco/banco.sh evaluar [csv]       vuelve a cruzar un CSV de envíos con la base
#   bash plataforma/pruebas/banco/banco.sh proxy               levanta la capa TLS (proxy/compose.proxy.yml) sobre el banco y la prueba
#   bash plataforma/pruebas/banco/banco.sh alta                alta por API de punta a punta: POST → credencial → publica → medicion (HU-11)
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
    { echo "DB_NOMBRE=plataforma"; echo "DB_USUARIO=plataforma"; echo "DB_CLAVE=$(openssl rand -base64 24)"
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
    echo "esperando «healthy» (máx. 90 s)…"
    for _ in $(seq 1 30); do [ -z "$(dc ps --format '{{.Status}}' | grep -v '(healthy)')" ] && break; sleep 3; done
    bash "$YO" estado
    n="${2:-100}"
    emu semilla --dispositivos "$n" --intervalo-factor "${3:-2}" | psql_ -q && echo "sembrados $n dispositivos emulados (emu-0001…emu-$(printf '%04d' "$n")), intervalo = periodo × ${3:-2}" ;;
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
    unset CRED
    echo; [ $fallos -eq 0 ] && echo "ALTA OK" || { echo "$fallos comprobación(es) con falla"; exit 1; } ;;
  apagar) dcp down 2>/dev/null || dc down; rm -f "$ENV" ;;
  *) sed -n 2,12p "$YO"; exit 2 ;;
esac
