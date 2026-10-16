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
#   bash plataforma/pruebas/banco/banco.sh lorawan             rutas B y C de punta a punta: alta de pasarela → publica como ella → medicion; ACL del rol pasarela; rotación y baja
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
