#!/usr/bin/env bash
# Instala ThingsBoard CE en su propia máquina y deja la instantánea «instalada» (docs/23 §3.4 y §4.2):
#   imágenes descargadas, esquema creado SIN datos de demostración (INSTALL_TB=true, como su guía), un primer arranque completo, el
#   inquilino y su administrador creados por la API, los 100 dispositivos y la sonda dados de alta por la API, y un apagado limpio.
#   bash instalar-thingsboard.sh [43|44] [RANURA]      (43 = v4.3.1.8, principal; 44 = v4.4.0.2, sensibilidad)
# Deja en $BANCO_CACHE/instalaciones/tb<v>/: credenciales.csv (id,usuario,clave,topico; el token de acceso como usuario), ids.csv,
# inquilino.clave (600), fases.csv (cuánto tardó cada fase), perfil-inquilino.json (los límites de tasa, comprobación previa 1),
# imagenes.txt y alta.txt (cuántas llamadas y cuánto tardó el alta). La máquina queda APAGADA con Docker deshabilitado al arranque, así
# cada corrida mide desde que arranca Docker (docs/23 §6.1).
set -euo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
V=${1:-43}; RANURA=${2:-1}
. "$AQUI/lib.sh"
case "$V" in 43) IMG=$TB_NODO ;; 44) IMG=$TB_NODO_44 ;; *) falla "versión 43 o 44" ;; esac
N=tb$V-instalada; D="$INST/tb$V"; mkdir -p "$D"; F="$D/fases.csv"
API="http://127.0.0.1:$(puerto 80)"
NDISP=${BANCO_DISPOSITIVOS:-100}

# fases.csv se vacía DESPUÉS de crear la máquina: si ya existía, `vm crear` falla y lo anotado de la instalación real se conserva.
t=$(ms); vm crear "$N" base; : > "$F"; vm arrancar "$N" 4 "$RANURA"; fase "$F" maquina_arriba "$t"
en 'mkdir -p ~/tb'
vm copiar "$RANURA" "$AQUI/thingsboard/docker-compose.yml" "$AQUI/thingsboard/fila-b.yml" tb/
printf 'TB_NODO=%s\nTB_POSTGRES=%s\n' "$IMG" "$TB_POSTGRES" | en 'cat > ~/tb/.env'
# Con la 4.4 (BSL 1.1) el uso sin clave de licencia es «non-production use»: su thingsboard.conf pide NON_PRODUCTION_USE=true para
# arrancar sin clave (docs/23 §4.2). Se agrega SOLO en la 4.4 y se anota como cambio respecto del Compose.
[ "$V" = 44 ] && en 'printf "services:\n  thingsboard-ce:\n    environment:\n      NON_PRODUCTION_USE: \"true\"\n" > ~/tb/licencia-44.yml'

t=$(ms); en 'cd ~/tb && docker compose pull -q'; fase "$F" descarga_imagenes "$t"
t=$(ms); en 'cd ~/tb && docker compose run --rm -e INSTALL_TB=true thingsboard-ce > instalacion.log 2>&1; tail -n 3 instalacion.log'; fase "$F" esquema_install_tb "$t"
en 'grep -q "Installation finished successfully" ~/tb/instalacion.log' || falla "INSTALL_TB no terminó: ver ~/tb/instalacion.log en la máquina"
t=$(ms)
if [ "$V" = 44 ]; then en 'cd ~/tb && docker compose -f docker-compose.yml -f licencia-44.yml up -d'; else en 'cd ~/tb && docker compose up -d'; fi
esperar_http "$API/api/auth/login" 600 -H 'Content-Type: application/json' -d '{"username":"sysadmin@thingsboard.org","password":"sysadmin"}' || falla "ThingsBoard no respondió en 10 min"
fase "$F" primer_arranque_http "$t"

# ── El inquilino por la API (el sistema recién instalado solo trae al administrador del sistema, con la clave de ejemplo de su guía) ──
jwt() { python3 -I -c 'import json,sys; print(json.load(sys.stdin)["token"])'; }
SYS=$(curl -fsS -m 30 -H 'Content-Type: application/json' -d '{"username":"sysadmin@thingsboard.org","password":"sysadmin"}' "$API/api/auth/login" | jwt)
H=(-H "X-Authorization: Bearer $SYS" -H 'Content-Type: application/json')
curl -fsS -m 30 "${H[@]}" "$API/api/tenantProfiles?pageSize=10&page=0" > "$D/perfil-inquilino.json"
TEN=$(curl -fsS -m 30 "${H[@]}" -d '{"title":"tt40"}' "$API/api/tenant" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["id"]["id"])')
USR=$(curl -fsS -m 30 "${H[@]}" -d "{\"email\":\"tt40@banco.invalid\",\"authority\":\"TENANT_ADMIN\",\"tenantId\":{\"id\":\"$TEN\",\"entityType\":\"TENANT\"}}" \
      "$API/api/user?sendActivationMail=false" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["id"]["id"])')
ENLACE=$(curl -fsS -m 30 "${H[@]}" "$API/api/user/$USR/activationLink")
TOKEN_ACT=${ENLACE##*activateToken=}; TOKEN_ACT=${TOKEN_ACT%%&*}
clave_nueva > "$D/inquilino.clave"
python3 -I -c 'import json,sys; print(json.dumps({"activateToken": sys.argv[1], "password": open(sys.argv[2]).read().strip()}))' "$TOKEN_ACT" "$D/inquilino.clave" \
  | curl -fsS -m 30 -H 'Content-Type: application/json' -d @- "$API/api/noauth/activate?sendActivationMail=false" -o /dev/null
python3 -I -c 'import json,sys; print(json.dumps({"username":"tt40@banco.invalid","password":open(sys.argv[1]).read().strip()}))' "$D/inquilino.clave" > "$D/login.json"
TJ=$(curl -fsS -m 30 -H 'Content-Type: application/json' -d @"$D/login.json" "$API/api/auth/login" | jwt)
T=(-H "X-Authorization: Bearer $TJ" -H 'Content-Type: application/json')

# ── Alta de los dispositivos: dos llamadas por dispositivo (crear y leer su credencial), como su API REST (docs/23 §5.4) ──
t=$(ms); llamadas=0
echo "id,usuario,clave,topico" > "$D/credenciales.csv"; echo "id,uuid" > "$D/ids.csv"
for i in $(seq 0 "$NDISP"); do
  if [ "$i" = 0 ]; then nom=tt40-sonda; else nom=$(printf 'tt40-d%03d' "$i"); fi
  id=$(curl -fsS -m 30 "${T[@]}" -d "{\"name\":\"$nom\",\"type\":\"default\"}" "$API/api/device" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["id"]["id"])')
  tok=$(curl -fsS -m 30 "${T[@]}" "$API/api/device/$id/credentials" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["credentialsId"])')
  llamadas=$((llamadas + 2))
  echo "$nom,$tok,,v1/devices/me/telemetry" >> "$D/credenciales.csv"; echo "$nom,$id" >> "$D/ids.csv"
done
fase "$F" alta_dispositivos "$t"
echo "dispositivos=$((NDISP + 1)) llamadas=$llamadas (más 1 de inicio de sesión)" > "$D/alta.txt"

# ── Lo instalado, anotado; apagado limpio con Docker deshabilitado al arranque ──
en 'docker image ls --digests --format "{{.Repository}}:{{.Tag}} {{.Digest}} {{.Size}}"; docker system df' > "$D/imagenes.txt"
t=$(ms); en 'cd ~/tb && docker compose stop -t 60 >/dev/null 2>&1; sudo systemctl disable --now docker.service docker.socket >/dev/null 2>&1; sync'
vm apagar "$N"; fase "$F" apagado_limpio "$t"
echo "instalada: $N (credenciales en $D, modo 600)"
