#!/usr/bin/env bash
# Simulacro de restauración (docs/10 §9.5; docs/11 §8; TT-46): «un respaldo que no se restauró no es respaldo».
#   bash plataforma/pruebas/simulacro-restauracion.sh <carpeta>/plataforma-<marca>.dump [<carpeta>/plataforma-<marca>.huella]
# Sin la huella, toma la que está junto al volcado con el mismo nombre. Qué hace:
#   1. levanta una base DESECHABLE con la misma imagen de la base de la plataforma, sin red y con los datos en memoria;
#   2. restaura el volcado en el orden que pide TimescaleDB: crear la base, la extensión, timescaledb_pre_restore(), pg_restore,
#      timescaledb_post_restore();
#   3. calcula la huella de lo restaurado (db/pruebas/huella-respaldo.sql) y la compara línea por línea con la del respaldo;
#   4. borra el contenedor. No toca la base de la plataforma ni ningún volumen: se puede correr con la pila en uso.
# Sale 0 solo si pg_restore no dio ningún error y las dos huellas son idénticas (las mismas filas, con el mismo contenido, en las
# mismas tablas; las mismas hipertablas, objetos y permisos). Con el resultado dice cuánto tardó: es el piso del tiempo de recuperación.
# Variables: SIMULACRO_IMAGEN (por omisión, la imagen del servicio «timescaledb» de la pila; si no hay pila, la construye de db/imagen).
set -uo pipefail
VOLCADO="${1:-}"; HUELLA="${2:-}"
[ -n "$VOLCADO" ] || { echo "uso: bash plataforma/pruebas/simulacro-restauracion.sh <volcado.dump> [<huella>]"; exit 2; }
[ -n "$HUELLA" ] || HUELLA="${VOLCADO%.dump}.huella"
[ -s "$VOLCADO" ] || { echo "FALLA no existe o está vacío el volcado: $VOLCADO"; exit 2; }
[ -s "$HUELLA" ] || { echo "FALLA no encuentro la huella del respaldo ($HUELLA): sin ella solo se sabría que restaura, no que restaura lo mismo"; exit 2; }
# Una huella cortada o de otra cosa no sirve de vara: debe traer tablas, la línea de objetos y la extensión de TimescaleDB.
{ [ "$(grep -c '^tabla ' "$HUELLA")" -ge 1 ] && grep -q '^objetos ' "$HUELLA" && grep -q '^extension timescaledb ' "$HUELLA"; } \
  || { echo "FALLA la huella del respaldo está incompleta (sin tablas, sin la línea de objetos o sin la extensión): no sirve para comparar"; exit 2; }
VOLCADO=$(readlink -f "$VOLCADO"); HUELLA=$(readlink -f "$HUELLA")
cd "$(dirname "$0")/.."                       # plataforma/
fallos=0
ok() { echo "OK    $1"; }
falla() { echo "FALLA $1"; fallos=$((fallos + 1)); }

IMAGEN="${SIMULACRO_IMAGEN:-}"
if [ -z "$IMAGEN" ]; then
  cid=$(docker compose ps -q timescaledb 2>/dev/null | head -1)
  if [ -n "$cid" ]; then IMAGEN=$(docker inspect --format '{{.Image}}' "$cid"); else IMAGEN=$(docker build -q db/imagen) || { echo "FALLA no pude construir la imagen de la base (db/imagen)"; exit 1; }; fi
fi
NOMBRE="simulacro-restauracion-$$"
TRABAJO=$(mktemp -d "${TMPDIR:-/tmp}/simulacro.XXXXXX") || { echo "FALLA no pude crear la carpeta de trabajo"; exit 1; }
limpiar() { docker rm -f -v "$NOMBRE" >/dev/null 2>&1; rm -rf "$TRABAJO"; }
trap limpiar EXIT
# Los roles que el respaldo nombra en sus permisos deben existir antes de restaurar: el volcado de una base no trae los roles
# (son del servidor entero). El dueño es el usuario con que se crea la base desechable; los demás se crean sin acceso.
DUENO=$(awk '/^permisos / && $2 != "PUBLIC" && $3 == "TRUNCATE" {print $2; exit}' "$HUELLA")
[ -n "$DUENO" ] || DUENO=plataforma
OTROS=$(awk '/^permisos / && $2 != "PUBLIC" {print $2}' "$HUELLA" | sort -u | grep -v -x "$DUENO" || true)
for r in $DUENO $OTROS; do [[ "$r" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || { echo "FALLA un rol de la huella no tiene forma de nombre: «$r»"; exit 2; }; done

inicio=$(date +%s)
echo "simulacro · volcado de $(stat -c%s "$VOLCADO") bytes · imagen ${IMAGEN:0:19} · base desechable sin red, datos en memoria"
# --rm y la etiqueta: si el guion muere sin limpiar (un corte, kill -9), el contenedor se borra al detenerse y se reconoce por su etiqueta.
docker run -d --rm --label proposito=simulacro-restauracion --name "$NOMBRE" --network none --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER="$DUENO" -e POSTGRES_DB=postgres \
  "$IMAGEN" postgres -c timescaledb.max_background_workers=0 -c timescaledb.telemetry_level=off >/dev/null \
  || { echo "FALLA no pude levantar la base desechable"; exit 1; }
sql() { docker exec -i "$NOMBRE" psql -X -q -v ON_ERROR_STOP=1 -U "$DUENO" "$@"; }
# La imagen arranca, inicializa y reinicia una vez: se espera a que responda tres veces seguidas.
seguidas=0
for _ in $(seq 1 90); do
  if docker exec "$NOMBRE" psql -X -q -U "$DUENO" -d postgres -tAc 'SELECT 1' >/dev/null 2>&1; then seguidas=$((seguidas + 1)); else seguidas=0; fi
  [ "$seguidas" -ge 3 ] && break
  sleep 1
done
[ "$seguidas" -ge 3 ] || { echo "FALLA la base desechable no respondió en 90 s"; docker logs --tail 20 "$NOMBRE" 2>&1 | sed 's/^/      /'; exit 1; }

for r in $OTROS; do sql -d postgres -c "CREATE ROLE \"$r\"" || falla "no pude crear el rol $r"; done
sql -d postgres -c 'CREATE DATABASE restaurada' || falla "no pude crear la base"
sql -d restaurada -c 'CREATE EXTENSION IF NOT EXISTS timescaledb' -c 'SELECT timescaledb_pre_restore()' >/dev/null || falla "no pude preparar la base (extensión o timescaledb_pre_restore)"
docker cp "$VOLCADO" "$NOMBRE:/tmp/volcado.dump" >/dev/null || falla "no pude copiar el volcado al contenedor"
docker exec "$NOMBRE" pg_restore -U "$DUENO" -d restaurada /tmp/volcado.dump > "$TRABAJO/pg_restore.txt" 2>&1; rc=$?
errores=$(grep -c -i 'error' "$TRABAJO/pg_restore.txt" || true)
if [ "$rc" -eq 0 ] && [ "$errores" -eq 0 ]; then ok "pg_restore terminó sin errores"
else falla "pg_restore salió con $rc y $errores línea(s) de error:"; grep -i -m 8 'error' "$TRABAJO/pg_restore.txt" | cut -c1-200 | sed 's/^/      /'; fi
sql -d restaurada -c 'SELECT timescaledb_post_restore()' >/dev/null || falla "timescaledb_post_restore falló"

sql -d restaurada -f - < db/pruebas/huella-respaldo.sql > "$TRABAJO/restaurada.huella" 2> "$TRABAJO/huella.err" || falla "no pude calcular la huella de lo restaurado: $(head -1 "$TRABAJO/huella.err")"
esperadas=$(grep -c . "$HUELLA"); tablas=$(grep -c '^tabla ' "$HUELLA"); filas=$(awk -F'|' '/^tabla /{s += $2} END{print s + 0}' "$HUELLA")
if diff -u "$HUELLA" "$TRABAJO/restaurada.huella" > "$TRABAJO/diferencias.txt"; then
  ok "la huella restaurada es idéntica a la del respaldo: $esperadas líneas, $tablas tablas, $filas filas"
else
  falla "la huella restaurada difiere de la del respaldo en $(grep -c '^[-+][^-+]' "$TRABAJO/diferencias.txt") línea(s) (− respaldo, + restaurada):"
  grep '^[-+][^-+]' "$TRABAJO/diferencias.txt" | head -20 | cut -c1-160 | sed 's/^/      /'
fi
# Lo restaurado se puede usar: una hipertabla acepta una lectura por tiempo y el rol de la aplicación conserva sus permisos.
sql -d restaurada -tAc "SELECT count(*) FROM timescaledb_information.hypertables WHERE hypertable_schema = 'public'" > "$TRABAJO/hipertablas.txt" 2>/dev/null
[ "$(cat "$TRABAJO/hipertablas.txt")" = "$(grep -c '^hipertabla ' "$HUELLA")" ] && ok "TimescaleDB reconoce las $(cat "$TRABAJO/hipertablas.txt") hipertablas tras timescaledb_post_restore" || falla "TimescaleDB ve $(cat "$TRABAJO/hipertablas.txt") hipertablas y el respaldo traía $(grep -c '^hipertabla ' "$HUELLA")"

segundos=$(( $(date +%s) - inicio ))
echo
if [ "$fallos" -eq 0 ]; then echo "SIMULACRO OK ($filas filas en $tablas tablas restauradas e idénticas, en $segundos s)"; exit 0
else echo "SIMULACRO CON FALLAS ($fallos): este respaldo NO se puede dar por bueno"; exit 1; fi
