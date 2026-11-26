#!/usr/bin/env bash
# «Cargar en el equipo» (docs/19 §4, bloque Z), de extremo a extremo en navegadores reales contra la pila de desarrollo, SIN placa. Por cada
# navegador (Chromium y Firefox, los de Playwright) y cada ancho (390 px, teléfono; 1 280 px, escritorio), una persona de descarte que administra
# un sitio de descarte da de alta un equipo por MQTT (de a uno) y tres por lote (dos por MQTT y uno por HTTP). En Chromium, el puerto serie es
# simulado dentro de la página (habla el protocolo 2 del firmware: saludo con su arranque, configurar, estado y sus errores, y la ventana en que
# sigue contestando con lo anterior); en Firefox, la prueba QUITA `navigator.serial` de la página para ver lo que se ofrece sin él (su Firefox
# 159 sí lo tiene). El recorrido lo hace backend/panel/e2e/cargar.mjs.
#   bash plataforma/pruebas/panel-cargar-e2e.sh
#   E2E_CAPTURAS=<carpeta> bash plataforma/pruebas/panel-cargar-e2e.sh         (guarda capturas; por defecto, ninguna)
#   E2E_NAVEGADORES=chromium bash …                                            (uno solo)
# Salida: 0 todo bien; 1 alguna falla (también si algo quedó en la base o en el broker al salir); 3 OMITIDO (sin backend en 127.0.0.1:3000, con un
# panel anterior al bloque Z o sin los navegadores de Playwright): nunca se cuenta como aprobado. Datos propios y desechables: un sitio cu<NNNNNN>
# con la zona «Norte», sus equipos cu<NNNNNN>-… y personas @ejemplo.invalid (RFC 2606). Los equipos MQTT crean su cliente en el broker: la prueba
# los da de baja desde la página (DELETE, que borra el cliente) y aquí se cuenta en el archivo del plugin que no quede ninguno con el prefijo de
# la corrida (sin clave: solo se leen los nombres). Todo lo demás se borra al salir, también si algo falla (trap), y se cuenta lo que quedó: debe
# ser 0. Las claves se generan aquí y viajan por la entrada estándar, nunca como argumento. No corre la semilla ni toca otras cuentas.
set -u
set +x
AQUI="$(cd "$(dirname "$0")" && pwd)"
PLAT="$AQUI/.."
PANEL="$PLAT/backend/panel"
API="http://127.0.0.1:3000"
BASE="${E2E_PANEL:-$API}"
. "$AQUI/lib-personas.sh"
sql() { docker compose -f "$PLAT/docker-compose.yml" exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA -q "$@"; }
# Cuántos clientes del broker empiezan con el prefijo: lee los nombres del archivo del plugin (docs/11 §7) y nunca imprime otra cosa.
clientes_broker() {
  docker compose -f "$PLAT/docker-compose.yml" exec -T mosquitto cat /mosquitto/data/dynamic-security.json </dev/null 2>/dev/null \
    | python3 -I -c 'import json, sys
try: d = json.load(sys.stdin)
except ValueError: print("?"); sys.exit()
print(sum(1 for c in d.get("clients", []) if str(c.get("username", "")).startswith(sys.argv[1])))' "$1"
}

omitir() { echo "OMITIDO $1"; exit 3; }
curl -fs -m 3 "$API/salud" >/dev/null || omitir "el backend no responde en $API (docker compose up -d en plataforma/)"
curl -fs -m 3 "$BASE/panel/" | grep -q '<div id="app">' || omitir "no hay panel en $BASE/panel/ (¿imagen sin construir o pnpm dev sin arrancar?)"
[ "$(clientes_broker zzz-nadie)" = 0 ] || omitir "no se pudo leer el archivo del plugin del broker (¿mosquitto apagado?)"
NAVS="${E2E_NAVEGADORES:-chromium firefox}"
for n in $NAVS; do case "$n" in chromium|firefox) ;; *) echo "FALLA E2E_NAVEGADORES admite chromium y firefox (recibí «$n»)"; exit 2 ;; esac; done
for n in $NAVS; do
  (cd "$PANEL" && node -e "const fs=require('node:fs');const p=require('playwright')['$n'];if(!p||!fs.existsSync(p.executablePath()))process.exit(1)") 2>/dev/null \
    || omitir "no está el navegador $n de Playwright (cd plataforma/backend/panel && pnpm exec playwright install $n)"
done

N=$(date +%s%N | tail -c 7)
P="cu$N"; SA="$P"; DOM="-$N@ejemplo.invalid"
[ "$(sql -c "SELECT count(*) FROM sitio WHERE codigo = '$SA'") $(sql -c "SELECT count(*) FROM dispositivo WHERE id_fisico LIKE '$P-%'")" = "0 0" ] \
  || { echo "FALLA el prefijo $P ya está en uso: vuelve a correr la prueba"; exit 1; }
CAPT="${E2E_CAPTURAS:-}"
[ -n "$CAPT" ] && { mkdir -p "$CAPT" && CAPT="$(cd "$CAPT" && pwd)"; }
T=$(mktemp -d "${TMPDIR:-/tmp}/panel-cargar-e2e.XXXXXX") || exit 1

restos() {
  sql -F ' ' -c "SELECT (SELECT count(*) FROM sitio WHERE codigo = '$SA'), (SELECT count(*) FROM zona z JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo = '$SA'),
    (SELECT count(*) FROM dispositivo WHERE id_fisico LIKE '$P-%'), (SELECT count(*) FROM credencial c JOIN dispositivo d ON d.id = c.dispositivo_id WHERE d.id_fisico LIKE '$P-%'),
    (SELECT count(*) FROM usuario WHERE email LIKE '%$DOM'), (SELECT count(*) FROM evento e WHERE e.detalle::text LIKE '%$P-%'),
    (SELECT count(*) FROM sesion se JOIN usuario u ON u.id = se.usuario_id WHERE u.email LIKE '%$DOM'), (SELECT count(*) FROM usuario_sitio us JOIN usuario u ON u.id = us.usuario_id WHERE u.email LIKE '%$DOM');"
}
limpiar() {
  local vivos broker r
  # Un equipo MQTT que no se dio de baja deja su cliente en el broker: se dice, con el remedio (la limpieza de la base no lo borra).
  vivos=$(sql -c "SELECT count(*) FROM dispositivo WHERE id_fisico LIKE '$P-%' AND via = 'mqtt' AND estado <> 'baja'")
  broker=$(clientes_broker "$P-")
  sql <<SQL >/dev/null 2>"$T/limpieza.txt" || echo "AVISO no se pudo limpiar todo lo de la corrida $N: $(head -c 300 "$T/limpieza.txt" | tr '\n' ' ')"
BEGIN;
CREATE TEMP TABLE u_e2e AS SELECT id FROM usuario WHERE email LIKE '%$DOM';
CREATE TEMP TABLE d_e2e AS SELECT d.id FROM dispositivo d JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo = '$SA';
DELETE FROM medicion WHERE canal_id IN (SELECT id FROM canal WHERE dispositivo_id IN (SELECT id FROM d_e2e));
DELETE FROM trama WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM cuarentena WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM evento WHERE dispositivo_id IN (SELECT id FROM d_e2e) OR usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM estado_dispositivo WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM canal WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM dispositivo_zona WHERE dispositivo_id IN (SELECT id FROM d_e2e) OR zona_id IN (SELECT z.id FROM zona z JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo = '$SA');
DELETE FROM dispositivo WHERE id IN (SELECT id FROM d_e2e);
DELETE FROM zona WHERE sitio_id IN (SELECT id FROM sitio WHERE codigo = '$SA');
DELETE FROM acceso WHERE email_intentado LIKE '%$DOM' OR usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM preferencia WHERE usuario_id IN (SELECT id FROM u_e2e);
UPDATE usuario SET desactivado_por = NULL WHERE desactivado_por IN (SELECT id FROM u_e2e);
DELETE FROM usuario WHERE id IN (SELECT id FROM u_e2e);
DELETE FROM sitio WHERE codigo = '$SA';
COMMIT;
SQL
  r=$(restos)
  echo "lo que quedó de la corrida $N (sitios zonas dispositivos credenciales personas eventos sesiones usuario_sitio): $r; clientes del broker: $broker"
  rm -rf "$T"
  [ "$broker" = 0 ] || echo "FALLA quedaron $broker cliente(s) $P-… en el broker ($vivos equipo(s) MQTT sin baja): bórralos con «bash plataforma/pruebas/broker-cliente.sh --borrar <id>»"
  [ "$r" = "0 0 0 0 0 0 0 0" ] && [ "$broker" = 0 ] || { echo "FALLA quedaron restos de la corrida $N"; exit 1; }
}
trap limpiar EXIT

CREADOS=$(sql <<SQL
WITH a AS (INSERT INTO sitio (nombre, codigo, zona_horaria) VALUES ('Prueba e2e de la carga por USB', '$SA', 'America/Santiago') RETURNING id),
     z AS (INSERT INTO zona (sitio_id, nombre) SELECT a.id, 'Norte' FROM a RETURNING id)
SELECT (SELECT count(*) FROM a) || ' ' || (SELECT count(*) FROM z);
SQL
)
[ "$CREADOS" = "1 1" ] || { echo "FALLA no se pudieron crear los datos de prueba ($CREADOS)"; exit 1; }
echo "datos de prueba: sitio $SA (zona «Norte»); personas *$DOM; panel en $BASE"

fallos=0; total_ok=0; total=0
for n in $NAVS; do
  lineas=""
  for ancho in 390 1280; do
    email="cargar-$n-$ancho$DOM"; tmp=$(clave_temporal); nueva=$(clave_temporal)$(clave_temporal)
    persona_temporal "Carga USB e2e" "$email" "$SA" administrador <<<"$tmp" >/dev/null || { echo "FALLA no se pudo crear $email"; exit 1; }
    lineas+="$ancho"$'\t'"$email"$'\t'"$tmp"$'\t'"$nueva"$'\n'
  done
  entrada=$(python3 -I -c '
import json, sys
base, nav, pref, sitio, capt = sys.argv[1:6]
casos = []
for l in sys.stdin.read().splitlines():
    if not l: continue
    ancho, email, tmp, nueva = l.split("\t")
    casos.append({"ancho": int(ancho), "email": email, "temporal": tmp, "nueva": nueva, "sitio": sitio})
print(json.dumps({"base": base, "navegador": nav, "prefijo": pref, "capturas": capt or None, "casos": casos}))
' "$BASE" "$n" "$P" "$SA" "$CAPT" <<<"$lineas")
  unset lineas tmp nueva
  inicio=$(date +%s)
  (cd "$PANEL" && node e2e/cargar.mjs <<<"$entrada") > "$T/$n.txt" 2>&1; r=$?
  unset entrada
  cat "$T/$n.txt"
  echo "($n: $(( $(date +%s) - inicio )) s)"
  [ "$r" = 0 ] || fallos=$((fallos+1))
  total_ok=$((total_ok + $(grep -c '^OK ' "$T/$n.txt"))); total=$((total + $(grep -cE '^(OK|FALLA) ' "$T/$n.txt")))
done
[ -n "$CAPT" ] && echo "capturas: $CAPT"
echo
if [ "$fallos" = 0 ] && [ "$total" -gt 0 ]; then echo "TODO OK ($total_ok de $total comprobaciones de la carga por USB, en: $NAVS)"; else echo "FALLA $((total - total_ok)) de $total comprobaciones (navegadores con falla: $fallos)"; exit 1; fi
