#!/usr/bin/env bash
# La misma serie por las tres entradas, MQTT directo, HTTP y pasarela (docs/16 §49): 60 instantes × 3 canales (temperatura °C, humedad %, tensión V), generados con una
# semilla fija, entran por MQTT (SenML, un mensaje por instante), por HTTP (SenML en packs de 1, 10 y 60 lecturas por POST) y por la
# pasarela Milesight sin códec (10 bytes del perfil campus-heltec-v3-v1 por el sufijo nativo, fCnt creciente). Las primeras 10 tramas
# de cada vía se envían dos veces a propósito. Por emisor: enviadas, guardadas, perdidas, filas de más por los duplicados y latencia
# recibido_en − marca de la trama (p50/p95/máx); por vía, el tiempo de envío y la memoria y CPU máximas del backend (docker stats).
# Requiere el banco encendido (banco.sh encender). Desde cualquier carpeta:
#   bash plataforma/pruebas/banco/banco.sh vias          (o directamente: bash plataforma/pruebas/banco/vias.sh)
# Los secretos (clave de administrador, credenciales MQTT y tokens HTTP) entran a curl por la entrada estándar y al contenedor de
# mosquitto_pub también por la entrada estándar; dentro del contenedor van a mosquitto_pub por -P, como en banco.sh (visibles solo con
# acceso al socket de Docker: riesgo aceptado en docs/11 §7). No se imprimen y se comprueba que no aparezcan en el registro del backend.
set -euo pipefail
cd "$(dirname "$0")/../.."                 # plataforma/
PRIV="${XDG_RUNTIME_DIR:-$HOME/.cache}/plataforma-banco"; ENV="$PRIV/banco.env"
[ -f "$ENV" ] || { echo "FALLA no existe el .env del banco: primero «banco.sh encender»"; exit 1; }
IMG_BROKER=$(grep -oE 'eclipse-mosquitto:[^ ]+@sha256:[0-9a-f]{64}' docker-compose.yml | head -1 || true)
[ -n "$IMG_BROKER" ] || { echo "FALLA no encontré la imagen fijada del broker en docker-compose.yml"; exit 1; }
dc() { docker compose -p banco -f docker-compose.yml -f pruebas/banco/compose.banco.yml --env-file "$ENV" "$@"; }
psql_() { dc exec -T timescaledb psql -U plataforma -d plataforma -v ON_ERROR_STOP=1 "$@"; }
. pruebas/lib-dynsec.sh                    # leer_env, la misma que usa banco.sh
leer() { leer_env "$ENV" "$1"; }
ok_n=0; fallos=0
ok() { echo "OK    $1"; ok_n=$((ok_n+1)); }
falla() { echo "FALLA $1"; fallos=$((fallos+1)); }
api() { local m=$1 r=$2; shift 2; printf 'X-Clave-Admin: %s\n' "$CLAVE" | curl -s -m 10 -w '\n%{http_code}' -X "$m" -H @- -H 'Content-Type: application/json' "$@" "http://127.0.0.1:3001$r"; }
json() { python3 -c "import sys,json; v=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
codigo() { printf '%s' "${1##*$'\n'}"; }; cuerpo() { printf '%s' "${1%$'\n'*}"; }
# Reloj con el de bash y no con «date»: en este equipo date es la versión de uutils, que lee mal las fracciones con ceros a la
# izquierda («@…698.011» → …698.110; medido el 22/10), y la marca de la pasarela salía corrida hasta 0,9 s. EPOCHREALTIME lleva
# coma decimal con la configuración regional en español: se quitan ambos separadores.
ahora_ms() { local t=${EPOCHREALTIME/[.,]/}; echo $(( 10#$t / 1000 )); }
iso_ms() { local h; TZ=UTC printf -v h '%(%Y-%m-%dT%H:%M:%S)T' $(( $1 / 1000 )); printf '%s.%03dZ' "$h" $(( $1 % 1000 )); }
esperar_hasta() { local d=$(( $1 - $(ahora_ms) )); if [ "$d" -gt 0 ]; then sleep "$(printf '%d.%03d' $((d/1000)) $((d%1000)))"; fi; }
seg() { printf '%d.%03d' $(( $1 / 1000 )) $(( $1 % 1000 )); }   # ms → «s.mmm»
contar() { psql_ -tA -c "SELECT count(*) FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='$1'"; }
drenar() { local n="" ant="" quietos=0; for _ in $(seq 1 40); do n=$(contar "$1"); [ "$n" -ge 180 ] && return 0
  if [ "$n" = "$ant" ]; then quietos=$((quietos+1)); [ $quietos -ge 6 ] && return 0; else quietos=0; fi; ant=$n; sleep 0.5; done; }

T=$(mktemp -d "$PRIV/vias.XXXXXX")
M_PID=""
BAJAS_HECHAS=0; UIDS=(); PAS_UID=""
limpiar() { rm -f "$T/muestreando"; [ -n "$M_PID" ] && wait "$M_PID" 2>/dev/null; rm -rf "$T"
  # si el guion se cortó antes de las bajas, los emisores de esta corrida no quedan activos con credenciales vivas (revisión del 22/10)
  if [ "$BAJAS_HECHAS" = 0 ] && [ -n "${CLAVE:-}" ]; then for u in "${UIDS[@]}"; do api DELETE "/dispositivos/$u" >/dev/null 2>&1 || true; done
    [ -n "$PAS_UID" ] && { api DELETE "/pasarelas/$PAS_UID" >/dev/null 2>&1 || true; }; fi
  unset CLAVE CRED PCRED TK1 TK10 TK60; }
trap limpiar EXIT
CLAVE=$(leer HTTP_CLAVE_ADMIN)
curl -sf -m 3 -o /dev/null http://127.0.0.1:3001/salud || { echo "FALLA el backend del banco no responde en 127.0.0.1:3001"; exit 1; }
reinicios0=$(docker inspect -f '{{.RestartCount}}' banco-backend-1)
red=$(docker network ls --format '{{.Name}}' | grep '^banco_default$' || true); [ -n "$red" ] || { echo "FALLA no existe la red banco_default"; exit 1; }

# ── 1. La serie: semilla fija, 60 instantes; los valores con dos decimales, los mismos que caben en los 10 bytes del perfil ──
python3 -I - "$T/serie.tsv" <<'PY'
import random, struct, base64, sys
r = random.Random(20261022); t, h, v = 18.0, 65.0, 3.90
with open(sys.argv[1], "w") as f:
    for i in range(60):
        t = round(min(25, max(12, t + r.uniform(-0.3, 0.3))), 2)
        h = round(min(90, max(40, h + r.uniform(-1.0, 1.0))), 2)
        v = round(min(4.20, max(3.50, v + r.uniform(-0.02, 0.02))), 2)
        # byte 0 nodo, 1-4 secuencia, 5-6 °C ×100 (con signo), 7-8 % ×100, 9 = V×100 − 200 (perfil campus-heltec-v3-v1)
        b = struct.pack(">BIhHB", 2, i + 1, round(t * 100), round(h * 100), round(v * 100) - 200)
        f.write(f"{i}\t{t:.2f}\t{h:.2f}\t{v:.2f}\t{base64.b64encode(b).decode()}\n")
PY
mapfile -t SERIE < "$T/serie.tsv"
[ "${#SERIE[@]}" = 60 ] && ok "serie determinista de 60 instantes × 3 canales (semilla 20261022)" || { falla "la serie tiene ${#SERIE[@]} instantes"; exit 1; }
MAG=(temperatura humedad tension); UNI=(Cel %RH V)
valor() { local IFS=$'\t'; local c=($1); printf '%s' "${c[$(( $2 + 1 ))]}"; }   # fila de la serie, canal 0..2 → valor
datos() { local IFS=$'\t'; local c=($1); printf '%s' "${c[4]}"; }
echo "emisor,magnitud,tiempo_ms,marca_ms" > "$T/envios.csv"

# ── 2. Altas por API: tres canales, intervalo 60 s ──
n=$(date +%s | tail -c 6); zona=$(psql_ -tA -c "SELECT id FROM zona ORDER BY id LIMIT 1")
read -r sitio_id sitio < <(psql_ -tA -F ' ' -c "SELECT s.id, s.codigo FROM sitio s JOIN zona z ON z.sitio_id = s.id WHERE z.id = '$zona'")
CANALES='[{"magnitud":"temperatura"},{"magnitud":"humedad"},{"magnitud":"tension"}]'
alta() { api POST /dispositivos -d "{\"id_fisico\":\"$1\",\"nombre\":\"$2\",\"zona_id\":\"$zona\",\"via\":\"$3\",$4\"intervalo_esperado_s\":60,\"canales\":$CANALES}"; }
EM_MQTT="vias-mqtt-$n"; EM_H1="vias-http-1-$n"; EM_H10="vias-http-10-$n"; EM_H60="vias-http-60-$n"; EM_PAS="vias-pasarela-$n"; EM_NODO="vias-nodo-$n"
altas=0; UIDS=()
r=$(alta "$EM_MQTT" "Vías: MQTT" mqtt '"formato":"senml",'); [ "$(codigo "$r")" = 201 ] && altas=$((altas+1))
CRED=$(json "v['conexion']['credencial']" <<<"$(cuerpo "$r")"); topico=$(json "v['conexion']['ejemplo']['topico']" <<<"$(cuerpo "$r")"); UIDS+=("$(json "v['id']" <<<"$(cuerpo "$r")")")
for p in 1 10 60; do
  em="vias-http-$p-$n"; r=$(alta "$em" "Vías: HTTP pack de $p" http '"formato":"senml",'); [ "$(codigo "$r")" = 201 ] && altas=$((altas+1))
  printf -v "TK$p" '%s' "$(json "v['conexion']['token']" <<<"$(cuerpo "$r")")"; UIDS+=("$(json "v['id']" <<<"$(cuerpo "$r")")")
done
r=$(api POST /pasarelas -d "{\"id_fisico\":\"$EM_PAS\",\"nombre\":\"Vías: pasarela Milesight\",\"sitio_id\":\"$sitio_id\",\"formato\":\"milesight\"}"); [ "$(codigo "$r")" = 201 ] && altas=$((altas+1))
PCRED=$(json "v['conexion']['credencial']" <<<"$(cuerpo "$r")"); PAS_UID=$(json "v['id']" <<<"$(cuerpo "$r")")
r=$(alta "$EM_NODO" "Vías: nodo de la pasarela" lorawan "\"pasarela_id\":\"$PAS_UID\",\"decodificador\":\"campus-heltec-v3-v1\","); [ "$(codigo "$r")" = 201 ] && altas=$((altas+1))
UIDS+=("$(json "v['id']" <<<"$(cuerpo "$r")")")
if [ "$altas" = 6 ] && [ ${#CRED} = 32 ] && [ ${#TK1} = 32 ] && [ ${#TK10} = 32 ] && [ ${#TK60} = 32 ] && [ ${#PCRED} = 32 ]; then
  ok "altas por API: $EM_MQTT, $EM_H1, $EM_H10, $EM_H60, la pasarela $EM_PAS y su nodo $EM_NODO (credenciales y tokens de 32 caracteres; no se imprimen)"
else falla "altas: $altas de 6 con 201"; exit 1; fi

# ── Memoria y CPU del backend: una muestra cada 5 s mientras dura cada vía ──
muestrear() { while [ -f "$T/muestreando" ]; do local t0; t0=$(ahora_ms)
  docker stats --no-stream --format '{{.MemUsage}};{{.CPUPerc}}' banco-backend-1 2>/dev/null | sed "s/^/$(cat "$T/fase");/" >> "$T/stats.csv" || true
  esperar_hasta $((t0 + 5000)); done; }
echo antes > "$T/fase"; touch "$T/muestreando"; muestrear & M_PID=$!; sleep 6
declare -A ENVIO_MS

# ── 3a. MQTT: una sesión (mosquitto_pub -l), un mensaje SenML de 3 lecturas por segundo; las 10 primeras, dos veces ──
echo mqtt > "$T/fase"
{ printf '%s\n' "$CRED"; sleep 3            # la sesión se abre antes del primer mensaje: su arranque no entra en la latencia
  t0=$(ahora_ms); echo "$t0" > "$T/t0"
  for i in $(seq 0 59); do esperar_hasta $((t0 + 1000*i)); m=$(ahora_ms); f=${SERIE[$i]}
    msg="[{\"bn\":\"$EM_MQTT\",\"bt\":$(seg "$m"),\"n\":\"temperatura\",\"u\":\"Cel\",\"v\":$(valor "$f" 0)},{\"n\":\"humedad\",\"u\":\"%RH\",\"v\":$(valor "$f" 1)},{\"n\":\"tension\",\"u\":\"V\",\"v\":$(valor "$f" 2)}]"
    printf '%s\n' "$msg"; [ "$i" -lt 10 ] && printf '%s\n' "$msg"
    for k in 0 1 2; do echo "$EM_MQTT,${MAG[$k]},$m,$m" >> "$T/envios.csv"; done
  done; } | docker run --rm -i --network "$red" "$IMG_BROKER" sh -c 'IFS= read -r C; mosquitto_pub -V mqttv5 -h mosquitto -q 1 -i "$1" -u "$1" -P "$C" -t "$2" -l' sh "$EM_MQTT" "$topico" \
  && ok "MQTT: 70 publicaciones QoS 1 (60 + 10 repetidas) en una sesión, sin error de mosquitto_pub" || falla "MQTT: mosquitto_pub terminó con error"
ENVIO_MS[$EM_MQTT]=$(( $(ahora_ms) - $(cat "$T/t0") )); drenar "$EM_MQTT"

# ── 3b. HTTP: la serie en packs de 1, 10 y 60 lecturas; una trama aceptada por segundo por dispositivo (punto 52 e) ──
# Cada pack lleva bt = ahora (la marca de la trama: hora de envío) y, por lectura, t = hora de su instante − bt (negativo). Las horas
# de los instantes van en una línea fija, uno por segundo, que termina 1 s antes de empezar: un pack de 10 o de 1 parte un instante
# entre dos tramas, y con horas relativas a cada pack el orden de una misma serie se cruzaba entre packs (corrida del 22/10).
http_via() { local p=$1 em=$2 tk=$3 total=$((180 / $1)) cod rep=0 r429=0 malas=0 ultimo=0 cuerpo_ m j a inst
  echo "http-$p" > "$T/fase"; local t0 base d; t0=$(ahora_ms); base=$((t0 - 61000))
  for j in $(seq 0 $((total - 1))); do
    esperar_hasta $((ultimo + 1000))   # 1 s desde la RESPUESTA anterior: el backend anotó esa trama antes de responder
    a=$((j * p)); m=$(ahora_ms); cuerpo_="["
    for r in $(seq "$a" $((a + p - 1))); do inst=$((r / 3)); k=$((r % 3))
      [ "$r" = "$a" ] && cuerpo_+="{\"bn\":\"$em\",\"bt\":$(seg "$m")," || cuerpo_+=",{"
      d=$((m - base - 1000*inst)); cuerpo_+="$(printf '"t":-%d.%03d,' $((d / 1000)) $((d % 1000)))"
      cuerpo_+="\"n\":\"${MAG[$k]}\",\"u\":\"${UNI[$k]}\",\"v\":$(valor "${SERIE[$inst]}" "$k")}"
      echo "$em,${MAG[$k]},$((base + 1000*inst)),$m" >> "$T/envios.csv"
    done; cuerpo_+="]"
    for vez in 1 2; do [ "$vez" = 2 ] && [ "$j" -ge 10 ] && break
      for intento in 1 2 3 4 5; do [ "$vez$intento" != 11 ] && esperar_hasta $((ultimo + 1000))
        resp=$(printf 'Authorization: Bearer %s\n' "$tk" | curl -s -m 20 -w '\n%{http_code}' -H @- -H 'Content-Type: application/senml+json' --data-binary "$cuerpo_" "http://127.0.0.1:3001/recepcion/$em")
        ultimo=$(ahora_ms); cod=$(codigo "$resp"); [ "$cod" = 429 ] || break; r429=$((r429+1)); done
      if [ "$cod" != 202 ]; then malas=$((malas+1)); echo "      $em pack $j vez $vez → $cod $(cuerpo "$resp" | head -c 120)"
      elif [ "$vez" = 2 ] && [ "$(json "v['repetidas']" <<<"$(cuerpo "$resp")")" = "$p" ]; then rep=$((rep+1)); fi
    done
  done
  ENVIO_MS[$em]=$(( $(ahora_ms) - t0 )); local dup=$(( total < 10 ? total : 10 ))
  [ "$malas" = 0 ] && [ "$rep" = "$dup" ] && ok "HTTP pack de $p: $total POST + $dup repetidos → todos 202; los $dup repetidos responden repetidas = $p (429 por el ritmo: $r429)" \
    || falla "HTTP pack de $p: $malas respuestas distintas de 202; repetidos reconocidos $rep de $dup; 429 $r429"
  drenar "$em"; }
http_via 1 "$EM_H1" "$TK1"; http_via 10 "$EM_H10" "$TK10"; http_via 60 "$EM_H60" "$TK60"

# ── 3c. Pasarela Milesight sin códec: 10 bytes por el sufijo nativo, fCnt creciente, time = ahora; las 10 primeras, dos veces ──
echo pasarela > "$T/fase"; nativo="sitio/$sitio/pasarela/$EM_PAS/device/$EM_NODO/event/up"
desde_logs=$(date -u +%Y-%m-%dT%H:%M:%SZ)
{ printf '%s\n' "$PCRED"; sleep 3
  t0=$(ahora_ms); echo "$t0" > "$T/t0"
  for i in $(seq 0 59); do esperar_hasta $((t0 + 1000*i)); m=$(ahora_ms); hora=$(iso_ms "$m")
    msg=$(printf '{"applicationID":"3","applicationName":"app-de-prueba","data":"%s","devEUI":"%s","deviceName":"nodo-vias","fCnt":%s,"fPort":1,"rxInfo":[{"loRaSNR":10.2,"mac":"aaaaaaaaaaaaaaaa","name":"Local Gateway","rssi":-46,"time":"%s"}],"time":"%s","txInfo":{"frequency":917000000}}' \
      "$(datos "${SERIE[$i]}")" "$EM_NODO" $((i + 1)) "$hora" "$hora")
    printf '%s\n' "$msg"; [ "$i" -lt 10 ] && printf '%s\n' "$msg"
    for k in 0 1 2; do echo "$EM_NODO,${MAG[$k]},$m,$m" >> "$T/envios.csv"; done
  done; } | docker run --rm -i --network "$red" "$IMG_BROKER" sh -c 'IFS= read -r C; mosquitto_pub -V mqttv5 -h mosquitto -q 1 -i "$1" -u "$1" -P "$C" -t "$2" -l' sh "$EM_PAS" "$nativo" \
  && ok "pasarela: 70 publicaciones QoS 1 (60 + 10 con el mismo fCnt y los mismos bytes), sin error de mosquitto_pub" || falla "pasarela: mosquitto_pub terminó con error"
ENVIO_MS[$EM_NODO]=$(( $(ahora_ms) - $(cat "$T/t0") )); drenar "$EM_NODO"
echo final > "$T/fase"; sleep 6; rm -f "$T/muestreando"; wait "$M_PID" 2>/dev/null || true; M_PID=""
k=$(dc logs --no-color --since "$desde_logs" backend 2>/dev/null | grep -c "$EM_NODO: trama repetida (fCnt" || true)
[ "$k" = 10 ] && ok "pasarela: las 10 tramas repetidas se descartan por el fCnt y quedan anotadas en el registro (10 avisos)" || falla "pasarela: $k avisos de trama repetida (esperado 10)"

# ── 4. Medición en la base: cada lectura enviada se busca por canal y marca (±5 ms: la marca viaja con 3 decimales) ──
psql_ -q -c "CREATE SCHEMA IF NOT EXISTS banco; DROP TABLE IF EXISTS banco.vias_envio; CREATE TABLE banco.vias_envio (emisor text, magnitud text, tiempo_ms bigint, marca_ms bigint);"
psql_ -q -c "\copy banco.vias_envio FROM STDIN WITH (FORMAT csv, HEADER true)" < "$T/envios.csv"
psql_ -tA -F ';' -c "
WITH m AS (SELECT d.id_fisico AS emisor, c.magnitud_codigo AS magnitud, m.tiempo, m.recibido_en
           FROM medicion m JOIN canal c ON c.id = m.canal_id JOIN dispositivo d ON d.id = c.dispositivo_id
           WHERE d.id_fisico IN (SELECT DISTINCT emisor FROM banco.vias_envio)),
par AS (SELECT e.emisor, e.marca_ms, x.recibido_en FROM banco.vias_envio e LEFT JOIN LATERAL (
          SELECT m.recibido_en FROM m WHERE m.emisor = e.emisor AND m.magnitud = e.magnitud
            AND abs(extract(epoch FROM m.tiempo) * 1000 - e.tiempo_ms) <= 5 LIMIT 1) x ON true),
lat AS (SELECT emisor, extract(epoch FROM recibido_en) * 1000 - marca_ms AS ms FROM par WHERE recibido_en IS NOT NULL)
SELECT p.emisor, count(*), count(p.recibido_en), count(*) - count(p.recibido_en),
       (SELECT count(*) FROM m WHERE m.emisor = p.emisor) - count(p.recibido_en),
       (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ms)::numeric) FROM lat WHERE lat.emisor = p.emisor),
       (SELECT round(percentile_cont(0.95) WITHIN GROUP (ORDER BY ms)::numeric) FROM lat WHERE lat.emisor = p.emisor),
       (SELECT round(max(ms)::numeric) FROM lat WHERE lat.emisor = p.emisor)
FROM par p GROUP BY p.emisor" > "$T/resultado.csv"
# Valores de cada canal ordenados por instante: deben ser la misma secuencia en los cinco emisores (la misma serie, cualquiera sea la vía).
for em in "$EM_MQTT" "$EM_H1" "$EM_H10" "$EM_H60" "$EM_NODO"; do
  psql_ -tA -c "SELECT string_agg(c.magnitud_codigo || '=' || m.valor, ',' ORDER BY c.magnitud_codigo, m.tiempo) FROM medicion m JOIN canal c ON c.id = m.canal_id JOIN dispositivo d ON d.id = c.dispositivo_id WHERE d.id_fisico = '$em'" | md5sum | cut -c1-12 > "$T/huella-$em"
done

# ── 5 y 6. Comprobaciones y tabla ──
via_de() { case "$1" in "$EM_MQTT") echo "MQTT (SenML, 3 por mensaje)";; "$EM_H1") echo "HTTP pack de 1";; "$EM_H10") echo "HTTP pack de 10";; "$EM_H60") echo "HTTP pack de 60";; "$EM_NODO") echo "Pasarela (10 bytes, fCnt)";; esac; }
fase_de() { case "$1" in "$EM_MQTT") echo mqtt;; "$EM_H1") echo http-1;; "$EM_H10") echo http-10;; "$EM_H60") echo http-60;; "$EM_NODO") echo pasarela;; esac; }
stats() { python3 -I - "$T/stats.csv" "$1" <<'PY'
import sys, re
u = {"B": 1 / 1048576, "KiB": 1 / 1024, "MiB": 1, "GiB": 1024}; mem = cpu = 0.0; k = 0
for linea in open(sys.argv[1]):
    fase, m, c = linea.strip().split(";")
    if fase != sys.argv[2]: continue
    x = re.match(r"([\d.]+)(\w+)", m); mem = max(mem, float(x.group(1)) * u[x.group(2)]); cpu = max(cpu, float(c.rstrip("%") or 0)); k += 1
print(f"{mem:.1f} {cpu:.1f} {k}")
PY
}
printf '\n%-28s %8s %9s %8s %8s %6s %6s %6s %8s %8s %7s %8s\n' "vía" enviadas guardadas perdidas "de más" p50ms p95ms máxms "s envío" "MiB máx" "CPU %" muestras
huella0=$(cat "$T/huella-$EM_MQTT")
for em in "$EM_MQTT" "$EM_H1" "$EM_H10" "$EM_H60" "$EM_NODO"; do
  IFS=';' read -r _ env gua per mas p50 p95 mx < <(grep "^$em;" "$T/resultado.csv")
  read -r mib cpu mu < <(stats "$(fase_de "$em")")
  printf '%-28s %8s %9s %8s %8s %6s %6s %6s %8s %8s %7s %8s\n' "$(via_de "$em")" "$env" "$gua" "$per" "$mas" "$p50" "$p95" "$mx" "$(seg "${ENVIO_MS[$em]}")" "$mib" "$cpu" "$mu"
  echo "$(via_de "$em")|$env|$gua|$per|$mas|$p50|$p95|$mx|${ENVIO_MS[$em]}|$mib|$cpu|$mu|$(cat "$T/huella-$em")" >> "$T/filas.txt"
done
read -r mib0 cpu0 _ < <(stats antes); read -r mib1 cpu1 _ < <(stats final)
echo "backend antes: $mib0 MiB, $cpu0 % CPU · al final: $mib1 MiB, $cpu1 % CPU"; echo
while IFS='|' read -r via env gua per mas p50 p95 mx ms _ _ _ hu; do
  [ "$env" = 180 ] && [ "$per" = 0 ] && ok "$via: 0 perdidas (180 enviadas, $gua guardadas)" || falla "$via: $per perdidas ($env enviadas, $gua guardadas)"
  [ "$mas" = 0 ] && ok "$via: 0 filas de más por los duplicados" || falla "$via: $mas filas de más"
  [ -n "$p95" ] && [ "$p95" -lt 2000 ] && ok "$via: p95 de latencia $p95 ms < 2 000 ms (RNF-02)" || falla "$via: p95 ${p95:-sin datos} ms (≥ 2 000)"
done < "$T/filas.txt"
iguales=$(cut -d'|' -f3,13 "$T/filas.txt" | sort -u | wc -l)
[ "$iguales" = 1 ] && [ "$(cut -d'|' -f3 "$T/filas.txt" | sort -u)" = 180 ] && ok "las cinco entradas dejan las mismas 180 lecturas: misma secuencia de valores por instante (huella $huella0)" || falla "las vías no dejan la misma serie: $(cut -d'|' -f1,3,13 "$T/filas.txt" | tr '\n' ' ')"
[ "${ENVIO_MS[$EM_H60]}" -lt "${ENVIO_MS[$EM_H1]}" ] && ok "el pack de 60 terminó en $(seg "${ENVIO_MS[$EM_H60]}") s, menos que el de 1 ($(seg "${ENVIO_MS[$EM_H1]}") s)" || falla "el pack de 60 ($(seg "${ENVIO_MS[$EM_H60]}") s) no terminó antes que el de 1 ($(seg "${ENVIO_MS[$EM_H1]}") s)"
reinicios1=$(docker inspect -f '{{.RestartCount}}' banco-backend-1); oom=$(docker inspect -f '{{.State.OOMKilled}}' banco-backend-1)
[ "$reinicios1" = "$reinicios0" ] && [ "$oom" = false ] && ok "el backend no se reinició ni lo mató la memoria durante la prueba" || falla "backend: reinicios $reinicios0 → $reinicios1, OOMKilled=$oom"
k=$(dc logs --no-color --since 15m backend 2>/dev/null | grep -cF -f <(printf '%s\n' "$CRED" "$PCRED" "$TK1" "$TK10" "$TK60") || true)
[ "$k" = 0 ] && ok "ningún token ni credencial aparece en el registro del backend" || falla "un secreto aparece en el registro del backend"

# Bajas: el banco queda sin emisores activos de esta prueba (los datos se conservan).
b=0; for u in "${UIDS[@]}"; do [ "$(codigo "$(api DELETE "/dispositivos/$u")")" = 200 ] && b=$((b+1)); done
[ "$(codigo "$(api DELETE "/pasarelas/$PAS_UID")")" = 200 ] && b=$((b+1))
BAJAS_HECHAS=1; [ "$b" = 6 ] && ok "bajas por API de los cinco emisores y la pasarela" || falla "bajas: $b de 6"
echo; [ $fallos -eq 0 ] && echo "VIAS OK ($ok_n/$ok_n)" || { echo "$fallos comprobación(es) con falla ($ok_n/$((ok_n+fallos)) OK)"; exit 1; }
