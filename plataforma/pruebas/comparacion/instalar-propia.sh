#!/usr/bin/env bash
# Instala la plataforma propia en su máquina, TAL COMO SE DESPLIEGA (docs/23 §4.1): su docker-compose.yml de producción más la capa del
# proxy TLS (proxy/compose.proxy.yml), con sus techos por contenedor, sin el override de desarrollo, construida dentro de la máquina desde
# el commit indicado, con los guiones de puesta en marcha del repositorio (base-rol-app.sh, broker-inicializar.sh). Después: el sitio, los
# 100 dispositivos y la sonda por la API (POST /sitios, POST /dispositivos con X-Clave-Admin), la persona administradora (POST /usuarios,
# POST /sesion y POST /sesion/clave) y un apagado limpio con Docker deshabilitado al arranque.
#   bash instalar-propia.sh [RANURA] [COMMIT]          (COMMIT por omisión: HEAD del repositorio)
# Deja en $BANCO_CACHE/instalaciones/propia/: credenciales.csv (600), persona.json (600), ca.crt, fases.csv, alta.txt, imagenes.txt, commit.
# Las claves del .env de la máquina son aleatorias de esta instalación; quedan solo dentro de la máquina (y en su disco), nunca se imprimen.
set -euo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
RANURA=${1:-0}; COMMIT=${2:-HEAD}
. "$AQUI/lib.sh"
REPO=$(git -C "$AQUI" rev-parse --show-toplevel)
SHA=$(git -C "$REPO" rev-parse --short "$COMMIT")
N=propia-instalada; D="$INST/propia"; mkdir -p "$D"; F="$D/fases.csv"
NDISP=${BANCO_DISPOSITIVOS:-100}
PH=$(puerto 43); API="https://localhost:$PH"
CURL=(curl -fsS -m 60 --resolve "localhost:$PH:127.0.0.1" --cacert "$D/ca.crt")

# fases.csv y commit se escriben DESPUÉS de crear la máquina: si ya existía, `vm crear` falla y lo anotado sigue diciendo la verdad.
t=$(ms); vm crear "$N" base; : > "$F"; echo "$SHA" > "$D/commit"; vm arrancar "$N" 4 "$RANURA"; fase "$F" maquina_arriba "$t"
# El código: solo lo versionado de plataforma/ en ese commit (git archive: sin .env, sin node_modules, sin nada ignorado).
git -C "$REPO" archive --format=tar "$SHA" plataforma | en 'rm -rf ~/plataforma && tar -x -C ~ && rm -f ~/plataforma/docker-compose.override.yml'
# El .env del despliegue, con claves aleatorias de esta instalación (generadas DENTRO de la máquina: no pasan por el anfitrión).
en 'bash -s' <<'DENTRO'
set -euo pipefail
cd ~/plataforma
k() { openssl rand -base64 24 | tr '+/' '-_'; }
{
  echo "COMPOSE_FILE=docker-compose.yml:proxy/compose.proxy.yml"
  echo "DB_NOMBRE=plataforma"; echo "DB_USUARIO=plataforma"
  echo "DB_CLAVE=$(k)"; echo "DB_APP_CLAVE=$(k)"; echo "MQTT_BACKEND_CLAVE=$(k)"; echo "MQTT_ADMIN_CLAVE=$(k)"
  echo "HTTP_CLAVE_ADMIN=$(k)"; echo "MQTT_SONDA_USUARIO=sonda"; echo "MQTT_SONDA_CLAVE=$(k)"; echo "PROXY_SECRETO=$(k)"
  echo "PROXY_CERTS=/home/banco/certs"; echo "PROXY_IP_DISPOSITIVOS=0.0.0.0"; echo "PROXY_IP_PERSONAS=0.0.0.0"
  echo "CODIGO_FUENTE_URL=https://example.invalid/codigo"
} > .env
chmod 600 .env
CA_NOMBRE="CA del banco de comparación" bash proxy/ca-desarrollo.sh /home/banco/certs >/dev/null
DENTRO
bash "$AQUI/vm.sh" ssh "$RANURA" 'cat /home/banco/certs/ca.crt' > "$D/ca.crt"

t=$(ms); en "set -o pipefail; cd ~/plataforma && COMMIT=$SHA docker compose build -q 2>&1 | tail -n 5"; fase "$F" construccion_imagenes "$t"
t=$(ms)
en 'cd ~/plataforma && docker compose up -d --wait timescaledb >/dev/null 2>&1 && bash pruebas/base-rol-app.sh | grep -c "^OK" | sed "s/^/base-rol-app: OK /"'
en 'set -o pipefail; cd ~/plataforma && bash pruebas/broker-inicializar.sh 2>&1 | tail -n 4'
en 'cd ~/plataforma && docker compose up -d --wait >/dev/null 2>&1; docker compose ps --format "{{.Service}} {{.Status}}"'
esperar_http "$API/salud" 300 --resolve "localhost:$PH:127.0.0.1" --cacert "$D/ca.crt" || falla "la plataforma no respondió /salud en 5 min"
fase "$F" primer_arranque_http "$t"

# ── Sitio, dispositivos y persona por la API ──
CLAVE_ADMIN() { bash "$AQUI/vm.sh" ssh "$RANURA" 'grep ^HTTP_CLAVE_ADMIN= ~/plataforma/.env | cut -d= -f2-'; }
CA_HDR="$D/.cabecera"; printf 'X-Clave-Admin: %s\n' "$(CLAVE_ADMIN)" > "$CA_HDR"
pedir() { # MÉTODO RUTA CUERPO → cuerpo de la respuesta; reintenta ante 429 (tope de 5/s por dirección del proxy en las rutas de alta)
  local i c
  for i in $(seq 1 20); do
    c=$("${CURL[@]/-fsS/-sS}" -o "$D/.r" -w '%{http_code}' -X "$1" -H @"$CA_HDR" -H 'Content-Type: application/json' --data-binary "$3" "$API$2") || true
    [ "$c" = 429 ] && { sleep 1; continue; }
    [[ "$c" =~ ^2 ]] || { echo "FALLA $1 $2 → $c: $(head -c 200 "$D/.r")" >&2; return 1; }
    cat "$D/.r"; rm -f "$D/.r"; return 0
  done; return 1
}
SITIO=$(pedir POST /sitios '{"nombre":"Banco de comparación","codigo":"tt40","zona_horaria":"UTC"}')
SITIO_ID=$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["id"])' "$SITIO")
ZONA=$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["zonas"][0]["id"])' "$SITIO")
t=$(ms); llamadas=0
echo "id,usuario,clave,topico" > "$D/credenciales.csv"
for i in $(seq 0 "$NDISP"); do
  if [ "$i" = 0 ]; then nom=tt40-sonda; else nom=$(printf 'tt40-d%03d' "$i"); fi
  r=$(pedir POST /dispositivos "{\"id_fisico\":\"$nom\",\"nombre\":\"$nom\",\"zona_id\":\"$ZONA\",\"via\":\"mqtt\",\"intervalo_esperado_s\":60,\"canales\":[{\"magnitud\":\"temperatura\"},{\"magnitud\":\"humedad\"}]}")
  llamadas=$((llamadas + 1))
  python3 -I -c 'import json,sys; c=json.loads(sys.argv[1])["conexion"]; print(",".join([sys.argv[2], c["usuario"], c["credencial"], c["topico"]]))' "$r" "$nom" >> "$D/credenciales.csv"
done
fase "$F" alta_dispositivos "$t"
echo "dispositivos=$((NDISP + 1)) llamadas=$llamadas (más 1 de crear el sitio)" > "$D/alta.txt"
# Persona administradora del sitio: la primera la crea la clave de administrador con una clave temporal, que se cambia al entrar.
P=$(pedir POST /usuarios "{\"nombre\":\"Banco\",\"email\":\"tt40@banco.invalid\",\"sitios\":[{\"sitio_id\":\"$SITIO_ID\",\"rol\":\"administrador\"}]}")
TEMP=$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["clave"])' "$P")
NUEVA=$(clave_nueva)
python3 -I -c 'import json,sys; print(json.dumps({"email":"tt40@banco.invalid","clave":sys.argv[1]}))' "$TEMP" \
  | "${CURL[@]}" -o /dev/null -c "$D/.tarro" -H 'X-Pedido: panel' -H 'Content-Type: application/json' --data-binary @- "$API/sesion"
python3 -I -c 'import json,sys; print(json.dumps({"actual":sys.argv[1],"nueva":sys.argv[2]}))' "$TEMP" "$NUEVA" \
  | "${CURL[@]}" -o /dev/null -b "$D/.tarro" -c "$D/.tarro" -H 'X-Pedido: panel' -H 'Content-Type: application/json' --data-binary @- "$API/sesion/clave"
# Términos de uso vigentes (docs/20 §12): sin aceptarlos, la sesión solo sirve para lo legal; una persona real los acepta al entrar.
TV=$("${CURL[@]}" "$API/terminos" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["version"])')
"${CURL[@]}" -o /dev/null -b "$D/.tarro" -c "$D/.tarro" -H 'X-Pedido: panel' -H 'Content-Type: application/json' --data-binary "{\"version\":$TV}" "$API/terminos/aceptar"
python3 -I -c 'import json,sys; print(json.dumps({"email":"tt40@banco.invalid","clave":sys.argv[1]}))' "$NUEVA" > "$D/persona.json"
rm -f "$D/.tarro" "$CA_HDR"
"${CURL[@]}" -X DELETE -o /dev/null -H 'X-Pedido: panel' "$API/sesion" 2>/dev/null || true

en 'docker builder prune -af >/dev/null; docker image ls --digests --format "{{.Repository}}:{{.Tag}} {{.Digest}} {{.Size}}"; docker system df' > "$D/imagenes.txt"
t=$(ms); en 'cd ~/plataforma && docker compose stop -t 60 >/dev/null 2>&1; sudo systemctl disable --now docker.service docker.socket >/dev/null 2>&1; sync'
vm apagar "$N"; fase "$F" apagado_limpio "$t"
echo "instalada: $N, commit $SHA (credenciales en $D, modo 600)"
