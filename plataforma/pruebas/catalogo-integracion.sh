#!/usr/bin/env bash
# Prueba de integración del catálogo editable de magnitudes (TT-12, bloque 4; docs/10 §8.4 punto 69; docs/19 §4, T; docs/16 §98), contra
# una base REAL y desechable:
#   bash plataforma/pruebas/catalogo-integracion.sh
# Qué hace: levanta una base DESECHABLE con la imagen de la base de la plataforma, SIN RED (--network none), con los datos en memoria y TODAS
# las migraciones de db/init (copiadas a una carpeta temporal, montada solo lectura; conexión por el socket Unix de una carpeta temporal
# propia, sin publicar puertos); compila el backend y corre backend/integracion/catalogo.ts con tsx: permisos, crear, duplicados, alias de
# otra magnitud, bloqueo optimista, el rango que deja fuera una regla o una calibración (409), el impacto, ampliar con sugerido y alias, el
# evento con su autor y la espera por el FOR SHARE de guardar reglas. Va contra una base desechable porque crea magnitudes, y una magnitud no
# se borra (docs/10 §8.4 punto 69 ii). Al salir (bien, mal o con Ctrl+C) borra el contenedor y las carpetas temporales. Sale 1 si algo falla.
set -uo pipefail
cd "$(dirname "$0")/.."                       # plataforma/

IMAGEN="${CATALOGO_IMAGEN:-}"
if [ -z "$IMAGEN" ]; then
  cid=$(docker compose ps -q timescaledb 2>/dev/null | head -1)
  [ -n "$cid" ] && IMAGEN=$(docker inspect --format '{{.Image}}' "$cid")
  # La imagen de un contenedor que sigue corriendo puede haber quedado sin etiqueta y borrada tras reconstruir: entonces, la construida aquí.
  if [ -z "$IMAGEN" ] || ! docker image inspect "$IMAGEN" >/dev/null 2>&1; then
    IMAGEN=$(docker build -q db/imagen) || { echo "FALLA no pude construir la imagen de la base (db/imagen)"; exit 1; }
  fi
fi
NOMBRE="${CATALOGO_INTEGRACION_PREFIJO:-catalogo-integracion}-$$"
TRABAJO=$(mktemp -d "${TMPDIR:-/tmp}/catalogo-integracion.XXXXXX") || { echo "FALLA no pude crear la carpeta de trabajo"; exit 1; }
# El socket va en una carpeta propia de nombre corto (la ruta de un socket Unix admite 107 bytes) montada en /sock, no en
# /var/run/postgresql (el entrypoint de la imagen hace chown de esa carpeta; espera-integracion.sh, 18/11/2026).
SOCK=$(mktemp -d /tmp/cat-sock.XXXXXX) || { echo "FALLA no pude crear la carpeta del socket"; rm -rf "$TRABAJO"; exit 1; }
limpiar() { docker stop -t 15 "$NOMBRE" >/dev/null 2>&1; docker rm -f -v "$NOMBRE" >/dev/null 2>&1; rm -rf "$TRABAJO" "$SOCK" 2>/dev/null; }
trap limpiar EXIT
# postgres corre en el contenedor como otro usuario (uid 70 en la imagen, no el del anfitrión) y debe crear en /sock su socket y su archivo de
# bloqueo: le basta escribir y entrar en la carpeta (o+wx), no listarla, así que 703 y no 777. Dura lo que la prueba: la carpeta es nueva
# (mktemp, 700 al crearse) y la trampa la borra al salir.
mkdir -p "$TRABAJO/init" && chmod 703 "$SOCK"
cp db/init/*.sql "$TRABAJO/init/"
n_mig=$(ls db/init/*.sql | wc -l)
[ "$n_mig" -ge 27 ] || { echo "FALLA se esperaban al menos 27 migraciones (la 27 crea el catálogo editable) en db/init (hay $n_mig)"; exit 1; }
CLAVE_DUENO=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
CLAVE_APP=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')

# --rm y la etiqueta: si el guion muere sin limpiar, el contenedor se borra al detenerse y se reconoce por su etiqueta. Memoria compartida y
# tmpfs holgados: el millón de mediciones de la medición ocupa ≈ 200 MB con sus índices.
docker run -d --rm --label proposito=catalogo-integracion --name "$NOMBRE" --network none --tmpfs /var/lib/postgresql/data:size=2g --shm-size=256m \
  -e POSTGRES_USER=plataforma -e POSTGRES_DB=plataforma -e POSTGRES_PASSWORD="$CLAVE_DUENO" \
  -v "$TRABAJO/init:/docker-entrypoint-initdb.d:ro" -v "$SOCK:/sock" \
  "$IMAGEN" postgres -c timescaledb.max_background_workers=0 -c timescaledb.telemetry_level=off -c unix_socket_directories=/var/run/postgresql,/sock >/dev/null \
  || { echo "FALLA no pude levantar la base desechable"; exit 1; }
psql_() { docker exec -i "$NOMBRE" psql -X -q -v ON_ERROR_STOP=1 -U plataforma -d plataforma "$@"; }
# La imagen arranca, aplica las migraciones y reinicia una vez: se espera a que responda tres veces seguidas y a que exista lo de la última.
seguidas=0
for _ in $(seq 1 120); do
  if psql_ -tAc "SELECT 1 FROM pg_proc WHERE proname = 'fn_quitar_alias'" 2>/dev/null | grep -q 1; then
    seguidas=$((seguidas + 1)); else seguidas=0; fi
  [ "$seguidas" -ge 3 ] && break
  sleep 1
done
[ "$seguidas" -ge 3 ] || { echo "FALLA la base desechable no respondió en 120 s"; docker logs --tail 20 "$NOMBRE" 2>&1 | sed 's/^/      /'; exit 1; }
printf "ALTER ROLE plataforma_app PASSWORD '%s';\n" "$CLAVE_APP" | psql_ || { echo "FALLA no pude fijar la clave del rol de la aplicación"; exit 1; }
echo "OK    base desechable con las $n_mig migraciones de db/init"

fallos=0
cd backend
pnpm build >/dev/null || { echo "FALLA no pude compilar el backend (pnpm build)"; exit 1; }
[ -S "$SOCK/.s.PGSQL.5432" ] || { echo "FALLA no está el socket de la base desechable en $SOCK"; exit 1; }
PRUEBA_DB_SOCKET="$SOCK" PRUEBA_CLAVE_APP="$CLAVE_APP" pnpm exec tsx integracion/catalogo.ts || fallos=$((fallos+1))
[ "$fallos" -eq 0 ] || { echo "$fallos bloque(s) con fallas"; exit 1; }
echo "CATÁLOGO OK"
