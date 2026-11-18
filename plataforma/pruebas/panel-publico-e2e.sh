#!/usr/bin/env bash
# Paso 4c del guardián (desde el 17/11/2026, junto a panel-sesion-e2e.sh): P9, la vista pública por enlace (HU-32, RF-62; docs/19 §4, O;
# docs/16 §80), de extremo a extremo en navegadores reales contra la pila de desarrollo. Por cada navegador (Chromium y Firefox, los de
# Playwright) y cada ancho (390 px, teléfono; 1 280 px, escritorio), una persona administradora de descarte publica una vista con vista
# previa y avisos, la abre como visitante sin sesión en un contexto aparte (sin cookies), comprueba que lo dibujado coincide con
# GET /publico y que el token no aparece en la dirección de ninguna petición, en el almacenamiento del navegador ni en cookies; renueva
# (con el 409 `acorta` confirmado), baja el k del sitio con su aviso (el visitante ve lo que antes salía oculto) y lo devuelve, y revoca:
# el visitante ve «enlace no disponible». El recorrido lo hace backend/panel/e2e/publico.mjs.
#   bash plataforma/pruebas/panel-publico-e2e.sh
#   E2E_CAPTURAS=<carpeta> bash plataforma/pruebas/panel-publico-e2e.sh          (guarda capturas; por defecto, ninguna)
#   E2E_NAVEGADORES=chromium bash …                                              (uno solo)
#   E2E_PANEL=http://localhost:5173 bash …   (el panel de `pnpm dev`, que reenvía la API a 127.0.0.1:3000: para probar una falla plantada
#                                             en el panel sin reconstruir la imagen; por defecto, el panel que sirve el backend)
# Salida: 0 todo bien; 1 alguna falla; 3 OMITIDO (sin backend en 127.0.0.1:3000 o sin los navegadores de Playwright): el guardián lo cuenta
# como omitido, nunca como aprobado. Datos propios y desechables: un sitio pp-NNNNNN con tres zonas (Norte, 3 equipos; Sur, 2; Este, 1),
# temperatura cada 5 min de las últimas 3 h, y personas @ejemplo.invalid (RFC 2606). Todo se borra al salir, también si algo falla (trap);
# antes, se espera a que el backend vuelque el contador de accesos de los enlaces de la corrida (una vez por minuto): borrar un enlace con
# accesos sin volcar haría fallar el volcado siguiente. Las claves se generan aquí y viajan por la entrada estándar, nunca como argumento.
set -u
set +x
AQUI="$(cd "$(dirname "$0")" && pwd)"
PLAT="$AQUI/.."
PANEL="$PLAT/backend/panel"
API="http://127.0.0.1:3000"
BASE="${E2E_PANEL:-$API}"
. "$AQUI/lib-personas.sh"
sql() { docker compose -f "$PLAT/docker-compose.yml" exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA -q "$@"; }

omitir() { echo "OMITIDO $1"; exit 3; }
curl -fs -m 3 "$API/salud" >/dev/null || omitir "el backend no responde en $API (docker compose up -d en plataforma/)"
curl -fs -m 3 "$BASE/panel/" | grep -q '<div id="app">' || omitir "no hay panel en $BASE/panel/ (¿imagen sin construir o pnpm dev sin arrancar?)"
curl -s -m 3 -o /dev/null -w '%{http_code}' "$API/publico" | grep -q 404 || omitir "el backend no tiene GET /publico (¿imagen anterior a la migración 25?)"
[ -x "$PANEL/node_modules/.bin/vitest" ] || omitir "sin las dependencias del panel (pnpm install en plataforma/backend)"
NAVS="${E2E_NAVEGADORES:-chromium firefox}"
# Lista cerrada antes de usar el nombre en `node -e` (revisión del 17/11/2026): nada que no sea uno de los dos navegadores llega a un intérprete.
for n in $NAVS; do case "$n" in chromium|firefox) ;; *) echo "FALLA E2E_NAVEGADORES admite chromium y firefox (recibí «$n»)"; exit 2 ;; esac; done
for n in $NAVS; do
  (cd "$PANEL" && node -e "const fs=require('node:fs');const p=require('playwright')['$n'];if(!p||!fs.existsSync(p.executablePath()))process.exit(1)") 2>/dev/null \
    || omitir "no está el navegador $n de Playwright (cd plataforma/backend/panel && pnpm exec playwright install $n)"
done

N=$(date +%s%N | tail -c 7)
SITIO="pp-$N"; DOM="-$N@ejemplo.invalid"
CAPT="${E2E_CAPTURAS:-}"
[ -n "$CAPT" ] && { mkdir -p "$CAPT" && CAPT="$(cd "$CAPT" && pwd)"; }
T=$(mktemp -d "${TMPDIR:-/tmp}/panel-publico-e2e.XXXXXX") || exit 1

limpiar() {
  # Los accesos que contó el backend se vuelcan una vez por minuto: se espera a que estén en la base (hasta 90 s) antes de borrar los enlaces.
  local esperados vistos i
  esperados=$(cat "$T"/*.cargas 2>/dev/null | awk '{s+=$1} END {print s+0}')
  if [ "${esperados:-0}" -gt 0 ]; then
    for i in $(seq 1 45); do
      vistos=$(sql -c "SELECT coalesce(sum(a.cuenta), 0) FROM enlace_publico_acceso a JOIN enlace_publico e ON e.id = a.enlace_id JOIN sitio s ON s.id = e.sitio_id WHERE s.codigo = '$SITIO'" 2>/dev/null || echo 0)
      [ "${vistos:-0}" -ge "$esperados" ] && break
      sleep 2
    done
    [ "${vistos:-0}" -ge "$esperados" ] || echo "AVISO el backend volcó ${vistos:-0} de $esperados accesos de la corrida; se borra igual"
  fi
  sql <<SQL >/dev/null 2>"$T/limpieza.txt" || { echo "AVISO no se pudo limpiar todo lo de la corrida $N: $(head -c 300 "$T/limpieza.txt" | tr '\n' ' ')"; }
BEGIN;
CREATE TEMP TABLE u_e2e AS SELECT id FROM usuario WHERE email LIKE '%$DOM';
CREATE TEMP TABLE d_e2e AS SELECT d.id FROM dispositivo d JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo = '$SITIO';
CREATE TEMP TABLE e_e2e AS SELECT id FROM enlace_publico WHERE sitio_id IN (SELECT id FROM sitio WHERE codigo = '$SITIO') OR creado_por IN (SELECT id FROM u_e2e);
DELETE FROM evento WHERE tipo LIKE 'enlace_%' AND (detalle->>'enlace_id' IN (SELECT id::text FROM e_e2e) OR detalle->>'sitio_id' IN (SELECT id::text FROM sitio WHERE codigo = '$SITIO'));
DELETE FROM enlace_publico_acceso WHERE enlace_id IN (SELECT id FROM e_e2e);
DELETE FROM enlace_publico WHERE id IN (SELECT id FROM e_e2e);
DELETE FROM medicion WHERE canal_id IN (SELECT id FROM canal WHERE dispositivo_id IN (SELECT id FROM d_e2e));
DELETE FROM evento WHERE dispositivo_id IN (SELECT id FROM d_e2e) OR usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM estado_dispositivo WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM canal WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM dispositivo_zona WHERE dispositivo_id IN (SELECT id FROM d_e2e) OR zona_id IN (SELECT z.id FROM zona z JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo = '$SITIO');
DELETE FROM dispositivo WHERE id IN (SELECT id FROM d_e2e);
DELETE FROM zona WHERE sitio_id IN (SELECT id FROM sitio WHERE codigo = '$SITIO');
DELETE FROM acceso WHERE email_intentado LIKE '%$DOM' OR usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM preferencia WHERE usuario_id IN (SELECT id FROM u_e2e);
UPDATE usuario SET desactivado_por = NULL WHERE desactivado_por IN (SELECT id FROM u_e2e);
DELETE FROM usuario WHERE id IN (SELECT id FROM u_e2e);
DELETE FROM sitio WHERE codigo = '$SITIO';
COMMIT;
SQL
  rm -rf "$T"
}
trap limpiar EXIT

# ── Datos: un sitio con tres zonas (3, 2 y 1 equipos), un canal de temperatura por equipo y una lectura cada 5 min de las últimas 3 h ──
# Con k = 3 (el de omisión): Norte se publica; Sur y Este salen sin valor; el total sí (los ocultos suman 3 = k). Con k = 1, todo sale.
CREADOS=$(sql <<SQL
WITH s AS (INSERT INTO sitio (nombre, codigo) VALUES ('Prueba e2e de la vista pública', '$SITIO') RETURNING id),
     z AS (INSERT INTO zona (sitio_id, nombre) SELECT s.id, x.nombre FROM s, (VALUES ('Norte'), ('Sur'), ('Este')) x(nombre) RETURNING id, nombre),
     e AS (SELECT * FROM (VALUES ('Norte', 'n1', 20.0), ('Norte', 'n2', 21.0), ('Norte', 'n3', 22.0), ('Sur', 's1', 24.0), ('Sur', 's2', 25.0), ('Este', 'e1', 30.0)) v(zona, sufijo, base)),
     d AS (INSERT INTO dispositivo (zona_id, id_fisico, nombre, via, formato, intervalo_esperado_s)
           SELECT z.id, 'pp-$N-' || e.sufijo, 'nodo ' || e.sufijo, 'http', 'senml', 300 FROM e JOIN z ON z.nombre = e.zona RETURNING id, id_fisico),
     c AS (INSERT INTO canal (dispositivo_id, magnitud_codigo) SELECT id, 'temperatura' FROM d RETURNING id, dispositivo_id),
     m AS (INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo)
           SELECT c.id, now() - interval '1 minute' - (k * interval '5 minutes'), e.base + (k % 3) * 0.1, 'Cel', now() - interval '1 minute' - (k * interval '5 minutes'), 'dispositivo'
             FROM c JOIN d ON d.id = c.dispositivo_id JOIN e ON d.id_fisico = 'pp-$N-' || e.sufijo, generate_series(0, 35) k RETURNING 1)
SELECT (SELECT count(*) FROM d) || ' ' || (SELECT count(*) FROM m);
SQL
)
[ "$CREADOS" = "6 216" ] || { echo "FALLA no se pudieron crear los datos de prueba ($CREADOS)"; exit 1; }
echo "datos de prueba: sitio $SITIO (Norte 3, Sur 2, Este 1 equipos; 216 lecturas); personas *$DOM; panel en $BASE"

fallos=0; total_ok=0; total=0
for n in $NAVS; do
  lineas=""
  for ancho in 390 1280; do
    email="pub-$n-$ancho$DOM"; tmp=$(clave_temporal); nueva=$(clave_temporal)$(clave_temporal)
    persona_temporal "Publicación e2e" "$email" "$SITIO" administrador <<<"$tmp" >/dev/null || { echo "FALLA no se pudo crear $email"; exit 1; }
    lineas+="$ancho"$'\t'"$email"$'\t'"$tmp"$'\t'"$nueva"$'\n'
  done
  entrada=$(python3 -I -c '
import json, sys
base, api, nav, sitio, capt = sys.argv[1:6]
casos = []
for l in sys.stdin.read().splitlines():
    if not l: continue
    ancho, email, tmp, nueva = l.split("\t")
    casos.append({"ancho": int(ancho), "email": email, "temporal": tmp, "nueva": nueva})
print(json.dumps({"base": base, "api": api, "navegador": nav, "sitio": sitio, "capturas": capt or None, "casos": casos}))
' "$BASE" "$API" "$n" "$SITIO" "$CAPT" <<<"$lineas")
  unset lineas tmp nueva
  (cd "$PANEL" && node e2e/publico.mjs <<<"$entrada") > "$T/$n.txt" 2>&1; r=$?
  cat "$T/$n.txt"
  grep -E '^CARGAS [0-9]+$' "$T/$n.txt" | awk '{print $2}' > "$T/$n.cargas"
  [ "$r" = 0 ] || fallos=$((fallos+1))
  total_ok=$((total_ok + $(grep -c '^OK ' "$T/$n.txt"))); total=$((total + $(grep -cE '^(OK|FALLA) ' "$T/$n.txt")))
done
[ -n "$CAPT" ] && echo "capturas: $CAPT"
echo
if [ "$fallos" = 0 ] && [ "$total" -gt 0 ]; then echo "TODO OK ($total_ok de $total comprobaciones de la vista pública, en: $NAVS)"; else echo "FALLA $((total - total_ok)) de $total comprobaciones (navegadores con falla: $fallos)"; exit 1; fi
