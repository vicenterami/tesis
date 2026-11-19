#!/usr/bin/env bash
# P7, el alta masiva sin fricción (docs/19 §4, bloques N y S; docs/16), de extremo a extremo en navegadores reales contra la pila de
# desarrollo. Por cada navegador (Chromium y Firefox, los de Playwright) y cada ancho (390 px, teléfono; 1 280 px, escritorio), una persona de
# descarte que administra un sitio de descarte recorre el catálogo fijo de escenarios (backend/panel/e2e/datos/lote-escenarios.*, también como
# libro .xlsx de LibreOffice, que llega a la misma revisión: docs/19 §4, bloque N, punto 6), un lote de
# 500 filas con sus umbrales de tiempo, crea dos equipos por HTTP (sin clientes del broker) y prueba «atrás» con credenciales sin descargar. El
# recorrido lo hace backend/panel/e2e/lote.mjs. Reemplaza a `banco.sh lote-navegador` (hasta el 19/11/2026), que corría contra el banco y
# dejaba allí los dos equipos que creaba.
#   bash plataforma/pruebas/panel-lote-e2e.sh
#   E2E_CAPTURAS=<carpeta> bash plataforma/pruebas/panel-lote-e2e.sh           (guarda capturas; por defecto, ninguna)
#   E2E_NAVEGADORES=chromium bash …                                            (uno solo)
#   E2E_PANEL=http://localhost:5173 bash …   (el panel de `pnpm dev`, que reenvía la API a 127.0.0.1:3000: para probar una falla plantada en
#                                             el panel sin reconstruir la imagen; por defecto, el panel que sirve el backend)
# Salida: 0 todo bien; 1 alguna falla (también si algo quedó en la base al salir); 3 OMITIDO (sin backend en 127.0.0.1:3000, con un backend
# anterior al bloque S o sin los navegadores de Playwright): nunca se cuenta como aprobado. Datos propios y desechables: dos sitios lt-NNNNNN
# (el de las personas, con las zonas «Norte» y «Galpón Sur» y un equipo que ya existe; otro con un equipo ajeno) y personas @ejemplo.invalid
# (RFC 2606). Todo se borra al salir, también lo que la prueba crea y también si algo falla (trap), y se cuenta lo que quedó: debe ser 0.
# Las claves se generan aquí y viajan por la entrada estándar, nunca como argumento. No corre la semilla ni toca otras cuentas.
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
[ -x "$PANEL/node_modules/.bin/vitest" ] || omitir "sin las dependencias del panel (pnpm install en plataforma/backend)"
NAVS="${E2E_NAVEGADORES:-chromium firefox}"
for n in $NAVS; do case "$n" in chromium|firefox) ;; *) echo "FALLA E2E_NAVEGADORES admite chromium y firefox (recibí «$n»)"; exit 2 ;; esac; done
for n in $NAVS; do
  (cd "$PANEL" && node -e "const fs=require('node:fs');const p=require('playwright')['$n'];if(!p||!fs.existsSync(p.executablePath()))process.exit(1)") 2>/dev/null \
    || omitir "no está el navegador $n de Playwright (cd plataforma/backend/panel && pnpm exec playwright install $n)"
done

N=$(date +%s%N | tail -c 7)
P="lt$N"; SA="$P"; SB="$P-b"; DOM="-$N@ejemplo.invalid"; NOMBRE_SITIO="Prueba e2e del alta masiva"
CAPT="${E2E_CAPTURAS:-}"
[ -n "$CAPT" ] && { mkdir -p "$CAPT" && CAPT="$(cd "$CAPT" && pwd)"; }
T=$(mktemp -d "${TMPDIR:-/tmp}/panel-lote-e2e.XXXXXX") || exit 1

restos() {
  sql -F ' ' -c "SELECT (SELECT count(*) FROM sitio WHERE codigo IN ('$SA','$SB')), (SELECT count(*) FROM zona z JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo IN ('$SA','$SB')),
    (SELECT count(*) FROM dispositivo WHERE id_fisico LIKE '$P%'), (SELECT count(*) FROM credencial c JOIN dispositivo d ON d.id = c.dispositivo_id WHERE d.id_fisico LIKE '$P%'),
    (SELECT count(*) FROM usuario WHERE email LIKE '%$DOM'), (SELECT count(*) FROM evento e WHERE e.detalle::text LIKE '%$P%'),
    (SELECT count(*) FROM sesion se JOIN usuario u ON u.id = se.usuario_id WHERE u.email LIKE '%$DOM'), (SELECT count(*) FROM usuario_sitio us JOIN usuario u ON u.id = us.usuario_id WHERE u.email LIKE '%$DOM');"
}
limpiar() {
  sql <<SQL >/dev/null 2>"$T/limpieza.txt" || echo "AVISO no se pudo limpiar todo lo de la corrida $N: $(head -c 300 "$T/limpieza.txt" | tr '\n' ' ')"
BEGIN;
CREATE TEMP TABLE u_e2e AS SELECT id FROM usuario WHERE email LIKE '%$DOM';
CREATE TEMP TABLE d_e2e AS SELECT d.id FROM dispositivo d JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo IN ('$SA', '$SB');
DELETE FROM medicion WHERE canal_id IN (SELECT id FROM canal WHERE dispositivo_id IN (SELECT id FROM d_e2e));
DELETE FROM trama WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM cuarentena WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM evento WHERE dispositivo_id IN (SELECT id FROM d_e2e) OR usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM estado_dispositivo WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM canal WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM dispositivo_zona WHERE dispositivo_id IN (SELECT id FROM d_e2e) OR zona_id IN (SELECT z.id FROM zona z JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo IN ('$SA', '$SB'));
DELETE FROM dispositivo WHERE id IN (SELECT id FROM d_e2e);
DELETE FROM zona WHERE sitio_id IN (SELECT id FROM sitio WHERE codigo IN ('$SA', '$SB'));
DELETE FROM acceso WHERE email_intentado LIKE '%$DOM' OR usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM preferencia WHERE usuario_id IN (SELECT id FROM u_e2e);
UPDATE usuario SET desactivado_por = NULL WHERE desactivado_por IN (SELECT id FROM u_e2e);
DELETE FROM usuario WHERE id IN (SELECT id FROM u_e2e);
DELETE FROM sitio WHERE codigo IN ('$SA', '$SB');
COMMIT;
SQL
  local r
  r=$(restos)
  echo "lo que quedó de la corrida $N (sitios zonas dispositivos credenciales personas eventos sesiones usuario_sitio): $r"
  rm -rf "$T"
  [ "$r" = "0 0 0 0 0 0 0 0" ] || { echo "FALLA quedaron filas de la corrida $N en la base"; exit 1; }
}
trap limpiar EXIT

# ── Datos: el sitio de las personas con «Norte», «Galpón Sur» y un equipo que ya existe; otro sitio con un equipo ajeno ─────────────
CREADOS=$(sql <<SQL
WITH a AS (INSERT INTO sitio (nombre, codigo, zona_horaria) VALUES ('$NOMBRE_SITIO', '$SA', 'America/Santiago') RETURNING id),
     b AS (INSERT INTO sitio (nombre, codigo, zona_horaria) VALUES ('Prueba e2e, otro sitio', '$SB', 'America/Santiago') RETURNING id),
     za AS (INSERT INTO zona (sitio_id, nombre) SELECT a.id, x FROM a, unnest(ARRAY['Norte', 'Galpón Sur']) x RETURNING id, nombre),
     zb AS (INSERT INTO zona (sitio_id, nombre) SELECT b.id, 'Otra' FROM b RETURNING id),
     d AS (INSERT INTO dispositivo (zona_id, id_fisico, nombre, via, formato, intervalo_esperado_s)
           SELECT za.id, '$P-existe', 'Ya existía', 'http', 'senml', 300 FROM za WHERE za.nombre = 'Norte'
           UNION ALL SELECT zb.id, '$P-ajeno', 'De otro sitio', 'http', 'senml', 300 FROM zb RETURNING id)
SELECT (SELECT count(*) FROM za) || ' ' || (SELECT count(*) FROM zb) || ' ' || (SELECT count(*) FROM d);
SQL
)
[ "$CREADOS" = "2 1 2" ] || { echo "FALLA no se pudieron crear los datos de prueba ($CREADOS)"; exit 1; }
echo "datos de prueba: sitios $SA y $SB (2 zonas, 1 zona, 2 equipos previos); personas *$DOM; panel en $BASE"

fallos=0; total_ok=0; total=0
for n in $NAVS; do
  lineas=""
  for ancho in 390 1280; do
    email="lote-$n-$ancho$DOM"; tmp=$(clave_temporal); nueva=$(clave_temporal)$(clave_temporal)
    persona_temporal "Alta masiva e2e" "$email" "$SA" administrador <<<"$tmp" >/dev/null || { echo "FALLA no se pudo crear $email"; exit 1; }
    lineas+="$ancho"$'\t'"$email"$'\t'"$tmp"$'\t'"$nueva"$'\n'
  done
  entrada=$(python3 -I -c '
import json, sys
base, nav, pref, sitio, capt = sys.argv[1:6]
casos = []
for l in sys.stdin.read().splitlines():
    if not l: continue
    ancho, email, tmp, nueva = l.split("\t")
    casos.append({"ancho": int(ancho), "email": email, "temporal": tmp, "nueva": nueva})
print(json.dumps({"base": base, "navegador": nav, "prefijo": pref, "sitio_nombre": sitio, "capturas": capt or None, "casos": casos}))
' "$BASE" "$n" "$P" "$NOMBRE_SITIO" "$CAPT" <<<"$lineas")
  unset lineas tmp nueva
  inicio=$(date +%s)
  (cd "$PANEL" && node e2e/lote.mjs <<<"$entrada") > "$T/$n.txt" 2>&1; r=$?
  unset entrada
  cat "$T/$n.txt"
  echo "($n: $(( $(date +%s) - inicio )) s)"
  [ "$r" = 0 ] || fallos=$((fallos+1))
  total_ok=$((total_ok + $(grep -c '^OK ' "$T/$n.txt"))); total=$((total + $(grep -cE '^(OK|FALLA) ' "$T/$n.txt")))
done
[ -n "$CAPT" ] && echo "capturas: $CAPT"
echo
if [ "$fallos" = 0 ] && [ "$total" -gt 0 ]; then echo "TODO OK ($total_ok de $total comprobaciones del alta masiva, en: $NAVS)"; else echo "FALLA $((total - total_ok)) de $total comprobaciones (navegadores con falla: $fallos)"; exit 1; fi
