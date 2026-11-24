#!/usr/bin/env bash
# P16, «Catálogo» (TT-12; docs/19 §4, T, punto 11; docs/16 §100), de extremo a extremo en navegadores reales contra la pila de desarrollo. Por
# cada navegador (Chromium y Firefox, los de Playwright) y cada ancho (390 px, teléfono; 1 280 px, escritorio), un administrador del sistema de
# descarte crea una magnitud, achica su rango, crea y prueba una receta y, en P6, usa el umbral sugerido de una magnitud; sin desplazamiento
# horizontal ni errores de JavaScript. El recorrido lo hace backend/panel/e2e/catalogo.mjs.
#   bash plataforma/pruebas/panel-catalogo-e2e.sh
#   E2E_CAPTURAS=<carpeta> bash plataforma/pruebas/panel-catalogo-e2e.sh        (guarda capturas; por defecto, ninguna)
#   E2E_NAVEGADORES=chromium bash …                                             (uno solo)
# Salida: 0 todo bien; 1 alguna falla; 3 OMITIDO (sin backend, sin la ruta del catálogo o sin los navegadores de Playwright): nunca se cuenta como
# aprobado. Datos propios y desechables: un sitio ct-NNNNNN con un equipo cuyo canal es de una magnitud de descarte con sugerido, personas
# @ejemplo.invalid (RFC 2606), y lo que la prueba crea (magnitudes e2e_NNNNNN_*, recetas e2e-NNNNNN-*). La aplicación no puede borrar
# magnitudes ni recetas (docs/10 §8.4 punto 69 ii); esta limpieza lo hace como dueño de la base, al salir, también si algo falla (trap). Las
# claves se generan aquí y viajan por la entrada estándar. No corre la semilla ni toca otras cuentas ni otras magnitudes.
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
curl -s -m 3 -o /dev/null -w '%{http_code}' "$API/recetas-decodificacion" | grep -q 401 || omitir "el backend no tiene GET /recetas-decodificacion (¿imagen anterior al 23/11/2026?)"
NAVS="${E2E_NAVEGADORES:-chromium firefox}"
for n in $NAVS; do case "$n" in chromium|firefox) ;; *) echo "FALLA E2E_NAVEGADORES admite chromium y firefox (recibí «$n»)"; exit 2 ;; esac; done
for n in $NAVS; do
  (cd "$PANEL" && node -e "const fs=require('node:fs');const p=require('playwright')['$n'];if(!p||!fs.existsSync(p.executablePath()))process.exit(1)") 2>/dev/null \
    || omitir "no está el navegador $n de Playwright (cd plataforma/backend/panel && pnpm exec playwright install $n)"
done

N=$(date +%s%N | tail -c 7)
SITIO="ct-$N"; DOM="-$N@ejemplo.invalid"; MP6="e2e_p6_$N"
CAPT="${E2E_CAPTURAS:-}"
[ -n "$CAPT" ] && { mkdir -p "$CAPT" && CAPT="$(cd "$CAPT" && pwd)"; }
T=$(mktemp -d "${TMPDIR:-/tmp}/panel-catalogo-e2e.XXXXXX") || exit 1

limpiar() {
  sql <<SQL >/dev/null 2>"$T/limpieza.txt" || { echo "AVISO no se pudo limpiar todo lo de la corrida $N: $(head -c 300 "$T/limpieza.txt" | tr '\n' ' ')"; }
BEGIN;
CREATE TEMP TABLE u_e2e AS SELECT id FROM usuario WHERE email LIKE '%$DOM';
CREATE TEMP TABLE d_e2e AS SELECT d.id FROM dispositivo d JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo = '$SITIO';
DELETE FROM evento WHERE dispositivo_id IN (SELECT id FROM d_e2e) OR usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM regla_umbral WHERE canal_id IN (SELECT id FROM canal WHERE dispositivo_id IN (SELECT id FROM d_e2e));
DELETE FROM canal WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM dispositivo_zona WHERE dispositivo_id IN (SELECT id FROM d_e2e) OR zona_id IN (SELECT z.id FROM zona z JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo = '$SITIO');
DELETE FROM dispositivo WHERE id IN (SELECT id FROM d_e2e);
DELETE FROM zona WHERE sitio_id IN (SELECT id FROM sitio WHERE codigo = '$SITIO');
DELETE FROM receta_campo WHERE receta_codigo LIKE 'e2e-$N-%';
DELETE FROM receta_decodificacion WHERE codigo LIKE 'e2e-$N-%';
DELETE FROM magnitud_alias WHERE magnitud_codigo LIKE 'e2e\_$N\_%' OR magnitud_codigo = '$MP6';
DELETE FROM magnitud WHERE codigo LIKE 'e2e\_$N\_%' OR codigo = '$MP6';
DELETE FROM acceso WHERE email_intentado LIKE '%$DOM' OR usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM sesion WHERE usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM preferencia WHERE usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM usuario_sitio WHERE usuario_id IN (SELECT id FROM u_e2e);
UPDATE usuario SET desactivado_por = NULL WHERE desactivado_por IN (SELECT id FROM u_e2e);
DELETE FROM usuario WHERE id IN (SELECT id FROM u_e2e);
DELETE FROM sitio WHERE codigo = '$SITIO';
COMMIT;
SQL
  rm -rf "$T"
}
trap limpiar EXIT

# ── Datos: una magnitud de descarte con umbral sugerido (alto 40, histéresis 1) y un equipo con un canal de ella, para «Usar el sugerido» ──
DISP=$(sql <<SQL
INSERT INTO magnitud (codigo, nombre, unidad_canonica, rango_min, rango_max, umbral_alto_sugerido, histeresis_sugerida)
  VALUES ('$MP6', 'Prueba e2e del sugerido', 'Cel', -40, 85, 40, 1);
WITH s AS (INSERT INTO sitio (nombre, codigo, zona_horaria) VALUES ('Prueba e2e del catálogo', '$SITIO', 'America/Santiago') RETURNING id),
     z AS (INSERT INTO zona (sitio_id, nombre) SELECT s.id, 'Norte' FROM s RETURNING id),
     d AS (INSERT INTO dispositivo (zona_id, id_fisico, nombre, via, formato, intervalo_esperado_s) SELECT z.id, 'ct-$N', 'nodo del catálogo', 'http', 'senml', 300 FROM z RETURNING id),
     c AS (INSERT INTO canal (dispositivo_id, magnitud_codigo) SELECT id, '$MP6' FROM d RETURNING id)
SELECT (SELECT id::text FROM d) FROM c;
SQL
)
[[ "$DISP" =~ ^[0-9a-f-]{36}$ ]] || { echo "FALLA no se pudieron crear los datos de prueba ($DISP)"; exit 1; }
echo "datos de prueba: sitio $SITIO con un equipo de la magnitud $MP6 (sugerido alto 40); personas *$DOM; panel en $BASE"

fallos=0; total_ok=0; total=0
for n in $NAVS; do
  lineas=""
  for ancho in 390 1280; do
    email="cat-$n-$ancho$DOM"; tmp=$(clave_temporal); nueva=$(clave_temporal)$(clave_temporal)
    persona_temporal "Catálogo e2e" "$email" "$SITIO" administrador <<<"$tmp" >/dev/null || { echo "FALLA no se pudo crear $email"; exit 1; }
    sql -c "UPDATE usuario SET administrador_sistema = true WHERE email = '$email'" >/dev/null || { echo "FALLA no se pudo dar el perfil de administrador del sistema a $email"; exit 1; }
    lineas+="$ancho"$'\t'"$email"$'\t'"$tmp"$'\t'"$nueva"$'\n'
  done
  entrada=$(python3 -I -c '
import json, sys
base, nav, corrida, disp, mp6, capt = sys.argv[1:7]
casos = []
for l in sys.stdin.read().splitlines():
    if not l: continue
    ancho, email, tmp, nueva = l.split("\t")
    casos.append({"ancho": int(ancho), "email": email, "temporal": tmp, "nueva": nueva})
print(json.dumps({"base": base, "navegador": nav, "corrida": corrida + "_" + nav[:2], "dispositivo": disp, "magnitudP6": mp6, "capturas": capt or None, "casos": casos}))
' "$BASE" "$n" "$N" "$DISP" "$MP6" "$CAPT" <<<"$lineas")
  unset lineas tmp nueva
  (cd "$PANEL" && node e2e/catalogo.mjs <<<"$entrada") > "$T/$n.txt" 2>&1; r=$?
  cat "$T/$n.txt"
  [ "$r" = 0 ] || fallos=$((fallos+1))
  total_ok=$((total_ok + $(grep -c '^OK ' "$T/$n.txt"))); total=$((total + $(grep -cE '^(OK|FALLA) ' "$T/$n.txt")))
done
[ -n "$CAPT" ] && echo "capturas: $CAPT"
echo
if [ "$fallos" = 0 ] && [ "$total" -gt 0 ]; then echo "TODO OK ($total_ok de $total comprobaciones del catálogo, en: $NAVS)"; else echo "FALLA $((total - total_ok)) de $total comprobaciones del catálogo"; exit 1; fi
