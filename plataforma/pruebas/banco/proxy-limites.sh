#!/usr/bin/env bash
# Límites por dirección del proxy (docs/11 §3; docs/16 §47). Requiere la capa TLS ya arriba: «banco.sh proxy» la levanta
# (proyecto Compose «banco», puertos 8443 HTTPS y 8884 MQTT/TLS, certificados de desarrollo). Desde cualquier carpeta:
#   bash plataforma/pruebas/banco/proxy-limites.sh
# Cada límite se prueba plantando la violación (debe aparecer el 429 o el corte) Y comprobando que lo legítimo pasa (el ritmo de RNF-01,
# lote de altas, 100 sesiones MQTT de un mismo NAT, otra dirección, la petición sola después). Los números viven en proxy/nginx.conf.
set -euo pipefail
cd "$(dirname "$0")/../.."                          # plataforma/
CERTS="$(pwd)/../privado/certs-desarrollo"
PRIV="${XDG_RUNTIME_DIR:-$HOME/.cache}/plataforma-banco"
ENV="$PRIV/banco.env"
[ -f "$ENV" ] && [ -f "$CERTS/ca.crt" ] || { echo "FALLA el banco no está encendido (falta $ENV o la CA): «banco.sh encender» y «banco.sh proxy»"; exit 1; }
IMG_BROKER=$(grep -oE 'eclipse-mosquitto:[^ ]+@sha256:[0-9a-f]{64}' docker-compose.yml | head -1)
dcp() { docker compose -p banco -f docker-compose.yml -f pruebas/banco/compose.banco.yml -f proxy/compose.proxy.yml --env-file "$ENV" "$@"; }
[ "$(dcp ps --format '{{.Status}}' proxy | grep -c healthy)" = 1 ] || { echo "FALLA el proxy del banco no está sano: «banco.sh proxy»"; exit 1; }
URL=https://localhost:8443
CURL=(curl -s -m 20 --cacert "$CERTS/ca.crt")
total=0; fallos=0
ok()    { total=$((total+1)); echo "OK    $*"; }
falla() { total=$((total+1)); fallos=$((fallos+1)); echo "FALLA $*"; }
# cuenta de códigos de una ráfaga: una sola invocación de curl con globbing, que reutiliza la conexión (miles de peticiones por segundo)
rafaga() { "${CURL[@]}" -o /dev/null -w '%{http_code}\n' "${@}" || true; }   # los códigos se cuentan; un corte a mitad de ráfaga no mata el guion
cuenta() { grep -c "^$1\$" <<<"$2" || true; }

# ── (i) Zona general: 100 r/s, ráfaga 200 (nginx.conf, zona «general») ────────────────────────────────────────────
sleep 4                                              # que el cubo esté vacío aunque «banco.sh proxy» acabe de correr
t_ini=$(date +%s.%N); cod=$(rafaga "$URL/salud?r=[1-600]"); dur=$(awk -v a="$t_ini" -v b="$(date +%s.%N)" 'BEGIN{printf "%.2f", b-a}')
n429=$(cuenta 429 "$cod"); n200=$(cuenta 200 "$cod")
[ "$n429" -gt 0 ] && ok "ráfaga de 600 peticiones a /salud desde una dirección: $n200 con 200 y $n429 con 429 (límite 100 r/s, ráfaga 200)" || falla "la ráfaga de 600 no recibió ningún 429 ($n200 con 200)"
tope=$(awk -v d="$dur" 'BEGIN{printf "%d", 200 + 100*d + 20}')   # la ráfaga más lo que el ritmo (100/s) dejó entrar durante la corrida, con holgura
[ "$n200" -ge 200 ] && [ "$n200" -le "$tope" ] && ok "pasaron $n200 antes del corte en $dur s: la ráfaga de 200 más lo que el ritmo dejó entrar (esperado 200 a $tope)" || falla "pasaron $n200 con 200 en $dur s (esperado 200 a $tope)"
sleep 4
c=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$URL/salud")
[ "$c" = 200 ] && ok "4 s después, una petición sola pasa: HTTP $c" || falla "tras la pausa, una petición sola dio HTTP $c (esperado 200)"
# lo legítimo: el ritmo de RNF-01 (50 eventos/s, docs/02) enviado por la vía HTTP desde UNA dirección, durante 5 s, sin un solo 429
cod=$(rafaga --rate 50/s -X POST -H 'Content-Type: application/json' -d '[]' "$URL/recepcion/no-existe?r=[1-250]")
n429=$(cuenta 429 "$cod"); n401=$(cuenta 401 "$cod")
[ "$n429" = 0 ] && [ "$n401" = 250 ] && ok "250 tramas a 50/s desde una dirección (RNF-01, un NAT con 50 dispositivos): 0 con 429, 250 llegaron al backend (401 por no existir el dispositivo)" || falla "ritmo de RNF-01: $n429 con 429 y $n401 con 401 de 250"
sleep 4

# ── (ii) Zona de administración: 5 r/s, ráfaga 10, solo métodos que escriben sobre /dispositivos y /pasarelas ─────────
cod=$(rafaga -X POST "$URL/dispositivos?r=[1-40]")
n429=$(cuenta 429 "$cod"); nok=$((40-n429))
[ "$n429" -gt 0 ] && [ "$nok" -ge 10 ] && [ "$nok" -le 16 ] && ok "40 POST /dispositivos seguidos: $nok llegaron al backend y $n429 dieron 429 (esperado 10 a 16 pasan: ráfaga de 10 más lo que el ritmo deja entrar)" || falla "40 POST /dispositivos: $nok pasaron, $n429 con 429 (esperado 10 a 16 y algún 429)"
cod=$(rafaga -X DELETE "$URL/pasarelas/x?r=[1-40]")
n429=$(cuenta 429 "$cod")
[ "$n429" -gt 0 ] && ok "40 DELETE /pasarelas/x seguidos: $n429 con 429 (la zona cubre DELETE y /pasarelas)" || falla "DELETE /pasarelas sin ningún 429"
# mayúsculas: Express enruta sin distinguirlas (docs/10 §8.4 punto 52), así que la zona tampoco debe distinguirlas (revisión del 22/10)
cod=$(rafaga -X POST "$URL/DISPOSITIVOS?r=[1-40]"); n429=$(cuenta 429 "$cod")
[ "$n429" -gt 0 ] && ok "40 POST /DISPOSITIVOS (mayúsculas) seguidos: $n429 con 429 (la zona no distingue mayúsculas, como Express)" || falla "POST /DISPOSITIVOS esquivó la zona de administración (0 con 429)"
# lo legítimo: lecturas y recepción NO sufren el límite estricto, aunque se pidan igual de rápido
cod=$(rafaga "$URL/dispositivos?r=[1-40]"); n429=$(cuenta 429 "$cod")
[ "$n429" = 0 ] && ok "40 GET /dispositivos seguidos: 0 con 429 (lectura, solo cuenta la zona general)" || falla "GET /dispositivos recibió $n429 con 429"
cod=$(rafaga -X POST -H "Content-Type: application/json" -d "[]" "$URL/recepcion/no-existe?r=[1-40]"); n429=$(cuenta 429 "$cod")
[ "$n429" = 0 ] && ok "40 POST /recepcion/{id} seguidos: 0 con 429 (la recepción no es administración)" || falla "POST /recepcion recibió $n429 con 429"
sleep 4
c=$("${CURL[@]}" -o /dev/null -w '%{http_code}' -X POST "$URL/dispositivos")
[ "$c" != 429 ] && ok "4 s después, un POST /dispositivos solo llega al backend: HTTP $c (sin la clave de administrador no es 201)" || falla "tras la pausa, el POST dio 429"

# ── (iii) 8883/8884: 100 conexiones simultáneas por dirección ────────────────────────────────────────────────────────
# Sesiones TLS abiertas con openssl s_client (apretón completo; stdin abierto la mantiene viva) desde esta máquina: para el proxy
# todas son una dirección (la puerta de enlace de Docker), como los nodos de un NAT. Una sesión cuenta como VIVA solo si su salida
# trae «Verify return code: 0» (apretón terminado), no por existir el proceso (revisión del 22/10: antes se contaban subprocesos).
tmp=$(mktemp -d "$PRIV/limites.XXXXXX"); pids=()
limpiar() { for p in "${pids[@]:-}"; do [ -n "$p" ] && { pkill -P "$p" 2>/dev/null; kill "$p" 2>/dev/null; } || true; done; rm -rf "$tmp"; }
trap limpiar EXIT
conecta() { # $1 = número; deja viva la sesión ~40 s y guarda el apretón en un archivo
  ( sleep 40 | timeout 40 openssl s_client -connect localhost:8884 -servername localhost -CAfile "$CERTS/ca.crt" >"$tmp/s$1.txt" 2>&1 ) & pids+=($!); }
vivas() { grep -l 'Verify return code: 0' "$tmp"/s*.txt 2>/dev/null | wc -l; }
sonda() { # una sesión que solo comprueba el apretón y sale (stdin cerrado): 0 si el proxy la aceptó
  timeout 8 openssl s_client -connect localhost:8884 -servername localhost -CAfile "$CERTS/ca.crt" </dev/null 2>&1 | grep -q 'Verify return code: 0'; }
rechazos() { dcp logs --no-color --since "$1" proxy 2>&1 | grep -c 'limiting connections by zone "mqtt_por_ip"' || true; }
for i in $(seq 1 99); do conecta "$i"; done
sleep 6
v=$(vivas); [ "$v" = 99 ] && ok "99 sesiones TLS abiertas a la vez desde una dirección: las 99 con el apretón terminado" || falla "solo $v de 99 sesiones terminaron el apretón"
if sonda; then ok "la sesión 100 desde la misma dirección entra (el tope es 100, no 99)"; else falla "la sesión 100 fue rechazada: el tope quedó por debajo de 100"; fi
conecta 100; sleep 3
v=$(vivas); [ "$v" = 100 ] && ok "100 sesiones vivas a la vez (la centésima también terminó el apretón)" || falla "con la centésima abierta hay $v vivas (esperado 100)"
marca=$(date -u +%Y-%m-%dT%H:%M:%SZ); sleep 1
if sonda; then falla "la sesión 101 desde la misma dirección fue aceptada (no se aplicó limit_conn)"; else
  r=$(rechazos "$marca"); [ "$r" -ge 1 ] && ok "la sesión 101 desde la misma dirección se rechaza y el proxy lo anota ($r línea/s «limiting connections by zone» desde $marca)" || falla "la sesión 101 falló, pero el registro del proxy no anotó ningún rechazo desde $marca (¿otra causa?)"; fi
v=$(vivas); [ "$v" = 100 ] && ok "tras el rechazo, las 100 sesiones de abajo del límite siguen con su apretón hecho" || falla "tras el rechazo quedan $v de 100"
# (iv) un cliente legítimo desde OTRA dirección (contenedor en la red del banco) publica y la lectura llega, mientras la primera está al tope
red=$(docker network ls --format '{{.Name}}' | grep '^banco_default$' || true); [ -n "$red" ] || { falla "no existe la red banco_default"; exit 1; }
bt=$(($(date +%s) - 30)); carga="[{\"bn\":\"emu-0004\",\"bt\":$bt,\"n\":\"temperatura\",\"u\":\"Cel\",\"v\":22.5}]"
if docker run --rm --network "$red" -v "$CERTS:/c:ro" "$IMG_BROKER" mosquitto_pub --cafile /c/ca.crt -h proxy -p 8883 -q 1 -i emu-0004 -t sitio/banco/dispositivo/emu-0004/temperatura -m "$carga" >/dev/null 2>&1; then
  sleep 2
  n=$(dcp exec -T timescaledb psql -U plataforma -d plataforma -tA -c "SELECT count(*) FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='emu-0004' AND m.tiempo = to_timestamp($bt)" | tr -d '[:space:]')
  [ "$n" = 1 ] && ok "con la primera dirección al tope, otra dirección publica por TLS (QoS 1) y la lectura está en medicion (el límite es por dirección)" || falla "la lectura de la otra dirección no llegó a medicion ($n)"
else falla "mosquitto_pub desde otra dirección no pudo publicar por TLS con la primera al tope"; fi
# al soltar, la dirección vuelve a poder conectar
for p in "${pids[@]}"; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done; pids=(); sleep 3
if sonda; then ok "al cerrar las 100 sesiones, la misma dirección vuelve a conectar"; else falla "tras cerrar las sesiones, la dirección sigue rechazada"; fi

# ── (v) /eventos: 20 flujos SSE simultáneos por dirección (revisión del 22/10) ───────────────────────────────────────
sse=(); abre_sse() { ( "${CURL[@]}" -N -m 60 -o /dev/null "$URL/eventos" ) & sse+=($!); }
for i in $(seq 1 20); do abre_sse; done; sleep 3
c=$("${CURL[@]}" -N -m 4 -o /dev/null -w '%{http_code}' "$URL/eventos" || true)
[ "$c" = 429 ] && ok "con 20 flujos SSE abiertos desde una dirección, el 21.º recibe 429 (limit_conn de /eventos)" || falla "el 21.º flujo SSE dio HTTP $c (esperado 429)"
# el mismo tope cubre las variantes que Express también sirve (revisión del 22/10): mayúsculas y barra final
for ruta in /Eventos /eventos/; do
  c=$("${CURL[@]}" -N -m 4 -o /dev/null -w '%{http_code}' "$URL$ruta" || true)
  [ "$c" = 429 ] && ok "con los 20 abiertos, $ruta también recibe 429 (la location es una expresión regular)" || falla "$ruta esquivó el tope de /eventos: HTTP $c"
done
c=$("${CURL[@]}" -m 4 -o /dev/null -w '%{http_code}' "$URL/salud" || true)
[ "$c" = 200 ] && ok "con los 20 flujos abiertos, una petición normal de la misma dirección sigue pasando (HTTP $c): el tope es solo de /eventos" || falla "con los flujos abiertos, /salud dio HTTP $c"
for p in "${sse[@]}"; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done; sleep 2
c=$("${CURL[@]}" -N -m 3 -o /dev/null -w '%{http_code}' "$URL/eventos" || true)
[ "$c" = 200 ] && ok "al cerrar los flujos, la misma dirección vuelve a abrir uno (HTTP $c)" || falla "tras cerrar los flujos, /eventos dio HTTP $c"

echo; if [ "$fallos" = 0 ]; then echo "LÍMITES DEL PROXY OK ($total/$total)"; else echo "$fallos comprobación(es) con falla ($((total-fallos))/$total)"; exit 1; fi
