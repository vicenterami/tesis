#!/usr/bin/env bash
# Banco de pruebas DESECHABLE para TT-28 (emulador), TT-29 (carga) y las pruebas de carrera (docs/04 §rúbrica).
# Levanta una segunda pila aparte (proyecto Compose «banco») sin tocar la de desarrollo: otros puertos, datos en RAM,
# broker sin credenciales (ver pruebas/banco/compose.banco.yml). Desde cualquier carpeta:
#   bash plataforma/pruebas/banco/banco.sh encender [N] [F]    levanta y siembra N emulados (100) con intervalo = periodo × F (2; con 1 se reproducen las alarmas falsas)
#   bash plataforma/pruebas/banco/banco.sh correr [opciones]   corre el emulador contra el banco y evalúa (ver emulador.ts)
#   bash plataforma/pruebas/banco/banco.sh carrera [disp]      las dos pruebas de carrera: mismo instante ×20 y umbral ×5 (docs/16 §4)
#   bash plataforma/pruebas/banco/banco.sh evaluar [csv]       vuelve a cruzar un CSV de envíos con la base
#   bash plataforma/pruebas/banco/banco.sh proxy               levanta la capa TLS (proxy/compose.proxy.yml) sobre el banco y la prueba
#   bash plataforma/pruebas/banco/banco.sh estado | logs [servicio] | sql ["CONSULTA"]
#   bash plataforma/pruebas/banco/banco.sh apagar              baja todo; los datos estaban en RAM, no queda nada
# Credenciales: de descarte, generadas en cada «encender» y escritas fuera del repo (${TMPDIR:-/tmp}/plataforma-banco.env),
# nunca impresas. El broker del banco no las verifica. Requiere pnpm en plataforma/backend (el emulador corre en el host).
set -u
YO="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"   # ruta absoluta: sigue valiendo tras el cd (lección de pila.sh)
cd "$(dirname "$0")/../.."                 # plataforma/
ENV="${TMPDIR:-/tmp}/plataforma-banco.env"
CSV="${TMPDIR:-/tmp}/plataforma-banco-envios.csv"
CERTS="$(pwd)/../privado/certs-desarrollo"
dc() { docker compose -p banco -f docker-compose.yml -f pruebas/banco/compose.banco.yml --env-file "$ENV" "$@"; }
dcp() { docker compose -p banco -f docker-compose.yml -f pruebas/banco/compose.banco.yml -f proxy/compose.proxy.yml --env-file "$ENV" "$@"; }
psql_() { dc exec -T timescaledb psql -U plataforma -d plataforma -v ON_ERROR_STOP=1 "$@"; }
emu() { (cd backend && pnpm -s exec ts-node --transpile-only src/emulador/emulador.ts "$@"); }
case "${1:-}" in
  encender)
    umask 077
    { echo "DB_NOMBRE=plataforma"; echo "DB_USUARIO=plataforma"; echo "DB_CLAVE=$(openssl rand -base64 24)"
      echo "MQTT_BACKEND_CLAVE=$(openssl rand -base64 24)"; echo "MQTT_SONDA_USUARIO=sonda"; echo "MQTT_SONDA_CLAVE=$(openssl rand -base64 24)"
      # capa TLS opcional (banco.sh proxy): puertos +1 y certificados de desarrollo
      echo "PROXY_IP=127.0.0.1"; echo "PROXY_HTTPS=8443"; echo "PROXY_MQTTS=8884"; echo "PROXY_HTTP=8081"; echo "PROXY_CERTS=$CERTS"; } > "$ENV"
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
    red=$(docker network ls --format '{{.Name}}' | grep '^banco_default$')
    bt=$(($(date +%s) - 60)); carga="[{\"bn\":\"emu-0003\",\"bt\":$bt,\"n\":\"temperatura\",\"u\":\"Cel\",\"v\":21.5}]"
    if docker run --rm --network "$red" -v "$CERTS:/c:ro" eclipse-mosquitto:2.0.22 mosquitto_pub --cafile /c/ca.crt -h proxy -p 8883 -q 1 -i emu-0003 -u emu-0003 -t sitio/banco/dispositivo/emu-0003/temperatura -m "$carga"; then
      sleep 2; n=$(psql_ -tA -c "SELECT count(*) FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='emu-0003' AND m.tiempo = to_timestamp($bt)" | tr -d '[:space:]')
      [ "$n" = 1 ] && echo "OK    MQTT sobre TLS 8884 → broker → pipeline: la lectura está en medicion" || { echo "FALLA la lectura publicada por TLS no llegó a medicion ($n)"; fallos=$((fallos+1)); }
    else echo "FALLA mosquitto_pub por TLS"; fallos=$((fallos+1)); fi
    if docker run --rm --network "$red" eclipse-mosquitto:2.0.22 mosquitto_pub -h proxy -p 8883 -t x -m 1 2>/dev/null; then echo "FALLA el 8883 aceptó una conexión sin TLS"; fallos=$((fallos+1)); else echo "OK    el 8883 rechaza conexiones sin TLS"; fi
    echo "── registro del proxy (JSON, una línea por petición/conexión):"; dcp logs --no-color --since 2m proxy 2>/dev/null | grep -oE '\{.*\}' | head -3
    echo; [ $fallos -eq 0 ] && echo "PROXY OK" || { echo "$fallos comprobación(es) con falla"; exit 1; } ;;
  apagar) dcp down 2>/dev/null || dc down; rm -f "$ENV" ;;
  *) sed -n 2,12p "$YO"; exit 2 ;;
esac
