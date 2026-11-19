#!/usr/bin/env bash
# P8, «Exportar datos» de un sitio (HU-08, RF-34; docs/19 §4, R, puntos 6 y 8; docs/16 §89), de extremo a extremo en navegadores reales contra
# la pila de desarrollo. Por cada navegador (Chromium y Firefox, los de Playwright) y cada ancho (390 px, teléfono; 1 280 px, escritorio), una
# persona de descarte con perfil de investigación llega desde la ficha de un equipo («Exportar todo el sitio»), lee la estimación de lo
# sembrado, descarga los tres formatos (el zip y el xlsx con su firma, el JSON con sus conteos) y pide «Entre fechas» en la hora del sitio,
# sin desplazamiento horizontal. El recorrido lo hace backend/panel/e2e/exportar.mjs.
#   bash plataforma/pruebas/panel-exportar-e2e.sh
#   E2E_CAPTURAS=<carpeta> bash plataforma/pruebas/panel-exportar-e2e.sh        (guarda capturas; por defecto, ninguna)
#   E2E_NAVEGADORES=chromium bash …                                            (uno solo)
#   E2E_PANEL=http://localhost:5173 bash …   (el panel de `pnpm dev`, que reenvía la API a 127.0.0.1:3000: para probar una falla plantada en
#                                             el panel sin reconstruir la imagen; por defecto, el panel que sirve el backend)
# Salida: 0 todo bien; 1 alguna falla; 3 OMITIDO (sin backend en 127.0.0.1:3000, sin la ruta de exportar un sitio o sin los navegadores de
# Playwright): nunca se cuenta como aprobado. Datos propios y desechables: un sitio ex-NNNNNN en Isla de Pascua (Pacific/Easter, otra zona
# que la de omisión y que la del navegador de la prueba) con dos equipos, 72 mediciones de las últimas 3 h, 10 tramas y 2 eventos, y personas
# @ejemplo.invalid (RFC 2606). Todo se borra al salir, también si algo falla (trap). Las claves se generan aquí y viajan por la entrada
# estándar, nunca como argumento. No corre la semilla ni toca otras cuentas.
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
# Sin sesión, la ruta existe y pide sesión (401); una imagen anterior al bloque R responde 404.
curl -s -m 3 -o /dev/null -w '%{http_code}' "$API/sitios/00000000-0000-4000-8000-000000000000/exportar/estimacion" | grep -q 401 \
  || omitir "el backend no tiene GET /sitios/{id}/exportar/estimacion (¿imagen anterior al 19/11/2026?)"
[ -x "$PANEL/node_modules/.bin/vitest" ] || omitir "sin las dependencias del panel (pnpm install en plataforma/backend)"
NAVS="${E2E_NAVEGADORES:-chromium firefox}"
for n in $NAVS; do case "$n" in chromium|firefox) ;; *) echo "FALLA E2E_NAVEGADORES admite chromium y firefox (recibí «$n»)"; exit 2 ;; esac; done
for n in $NAVS; do
  (cd "$PANEL" && node -e "const fs=require('node:fs');const p=require('playwright')['$n'];if(!p||!fs.existsSync(p.executablePath()))process.exit(1)") 2>/dev/null \
    || omitir "no está el navegador $n de Playwright (cd plataforma/backend/panel && pnpm exec playwright install $n)"
done

N=$(date +%s%N | tail -c 7)
SITIO="ex-$N"; DOM="-$N@ejemplo.invalid"; ZONA="Pacific/Easter"
CAPT="${E2E_CAPTURAS:-}"
[ -n "$CAPT" ] && { mkdir -p "$CAPT" && CAPT="$(cd "$CAPT" && pwd)"; }
T=$(mktemp -d "${TMPDIR:-/tmp}/panel-exportar-e2e.XXXXXX") || exit 1

limpiar() {
  sql <<SQL >/dev/null 2>"$T/limpieza.txt" || { echo "AVISO no se pudo limpiar todo lo de la corrida $N: $(head -c 300 "$T/limpieza.txt" | tr '\n' ' ')"; }
BEGIN;
CREATE TEMP TABLE u_e2e AS SELECT id FROM usuario WHERE email LIKE '%$DOM';
CREATE TEMP TABLE d_e2e AS SELECT d.id FROM dispositivo d JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo = '$SITIO';
DELETE FROM medicion WHERE canal_id IN (SELECT id FROM canal WHERE dispositivo_id IN (SELECT id FROM d_e2e));
DELETE FROM trama WHERE dispositivo_id IN (SELECT id FROM d_e2e);
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

# ── Datos: dos equipos con temperatura cada 5 min de las últimas 3 h (72 mediciones), 5 tramas cada uno (10) y su alta (2 eventos) ──────────
CREADOS=$(sql <<SQL
WITH s AS (INSERT INTO sitio (nombre, codigo, zona_horaria) VALUES ('Prueba e2e de la exportación', '$SITIO', '$ZONA') RETURNING id),
     z AS (INSERT INTO zona (sitio_id, nombre) SELECT s.id, 'Norte' FROM s RETURNING id),
     d AS (INSERT INTO dispositivo (zona_id, id_fisico, nombre, via, formato, intervalo_esperado_s)
           SELECT z.id, 'ex-$N-' || k, 'nodo ' || k, 'http', 'senml', 300 FROM z, generate_series(1, 2) k RETURNING id, id_fisico),
     c AS (INSERT INTO canal (dispositivo_id, magnitud_codigo) SELECT id, 'temperatura' FROM d RETURNING id),
     m AS (INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo)
           SELECT c.id, now() - interval '1 minute' - k * interval '5 minutes', 20 + (k % 7) * 0.5, 'Cel', now() - interval '1 minute' - k * interval '5 minutes', 'dispositivo'
             FROM c, generate_series(0, 35) k RETURNING 1),
     t AS (INSERT INTO trama (dispositivo_id, recibido_en, topico, payload, adaptador)
           SELECT d.id, now() - interval '2 minutes' - k * interval '10 minutes', 'sitio/$SITIO/dispositivo/' || d.id_fisico || '/temperatura',
                  convert_to('[{"n":"temperatura","u":"Cel","v":' || (20 + k) || '}]', 'UTF8'), 'senml' FROM d, generate_series(0, 4) k RETURNING 1),
     e AS (INSERT INTO evento (dispositivo_id, ocurrido_en, tipo, detalle) SELECT d.id, now() - interval '2 hours', 'alta', '{"via": "http"}'::jsonb FROM d RETURNING 1)
SELECT (SELECT count(*) FROM d) || ' ' || (SELECT count(*) FROM m) || ' ' || (SELECT count(*) FROM t) || ' ' || (SELECT count(*) FROM e) || ' ' || (SELECT min(id::text) FROM d);
SQL
)
read -r n_d n_m n_t n_e DISP <<<"$CREADOS"
[ "$n_d $n_m $n_t $n_e" = "2 72 10 2" ] && [[ "$DISP" =~ ^[0-9a-f-]{36}$ ]] || { echo "FALLA no se pudieron crear los datos de prueba ($CREADOS)"; exit 1; }
echo "datos de prueba: sitio $SITIO ($ZONA; 2 equipos, 72 mediciones, 10 tramas, 2 eventos); personas *$DOM; panel en $BASE"

fallos=0; total_ok=0; total=0
for n in $NAVS; do
  lineas=""
  for ancho in 390 1280; do
    email="exp-$n-$ancho$DOM"; tmp=$(clave_temporal); nueva=$(clave_temporal)$(clave_temporal)
    persona_temporal "Exportación e2e" "$email" "$SITIO" investigador <<<"$tmp" >/dev/null || { echo "FALLA no se pudo crear $email"; exit 1; }
    lineas+="$ancho"$'\t'"$email"$'\t'"$tmp"$'\t'"$nueva"$'\n'
  done
  entrada=$(python3 -I -c '
import json, sys
base, nav, sitio, zona, disp, capt = sys.argv[1:7]
casos = []
for l in sys.stdin.read().splitlines():
    if not l: continue
    ancho, email, tmp, nueva = l.split("\t")
    casos.append({"ancho": int(ancho), "email": email, "temporal": tmp, "nueva": nueva})
print(json.dumps({"base": base, "navegador": nav, "sitio": sitio, "zona": zona, "dispositivo": disp, "capturas": capt or None,
                  "esperado": {"mediciones": 72, "tramas": 10, "eventos": 2}, "casos": casos}))
' "$BASE" "$n" "$SITIO" "$ZONA" "$DISP" "$CAPT" <<<"$lineas")
  unset lineas tmp nueva
  (cd "$PANEL" && node e2e/exportar.mjs <<<"$entrada") > "$T/$n.txt" 2>&1; r=$?
  cat "$T/$n.txt"
  [ "$r" = 0 ] || fallos=$((fallos+1))
  total_ok=$((total_ok + $(grep -c '^OK ' "$T/$n.txt"))); total=$((total + $(grep -cE '^(OK|FALLA) ' "$T/$n.txt")))
done
[ -n "$CAPT" ] && echo "capturas: $CAPT"
echo
if [ "$fallos" = 0 ] && [ "$total" -gt 0 ]; then echo "TODO OK ($total_ok de $total comprobaciones de la exportación por sitio, en: $NAVS)"; else echo "FALLA $((total - total_ok)) de $total comprobaciones (navegadores con falla: $fallos)"; exit 1; fi
