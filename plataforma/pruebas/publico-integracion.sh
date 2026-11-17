#!/usr/bin/env bash
# Prueba de integración de la vista pública por enlace (docs/19 §4, O, punto 13; docs/16 §79): la regla de k al servir, la respuesta
# guardada con espera compartida, el contador, renovar y revocar, el tope de enlaces, la actividad y los permisos de la aplicación, contra
# una base REAL con todas las migraciones de db/init.
#   bash plataforma/pruebas/publico-integracion.sh
# Qué hace:
#   1. levanta una base DESECHABLE con la imagen de la base de la plataforma, datos en memoria, publicada solo en 127.0.0.1 en un puerto
#      libre que elige Docker; las migraciones se aplican solas al iniciar (db/init montada solo lectura);
#   2. genera al vuelo una clave para el dueño y otra para el rol de la aplicación (nunca se escriben en un archivo ni se imprimen);
#   3. compila el backend (pnpm build) y corre backend/integracion/publico.ts con tsx: los servicios entran como plataforma_app, como en la
#      pila, y al final la aplicación compilada entera responde en un puerto efímero de 127.0.0.1 (la prueba de aislamiento);
#   4. borra el contenedor. No toca la pila ni ningún volumen: se puede correr con la pila en uso.
# Sale 0 solo si todas las comprobaciones dan OK. Variable: PUBLICO_IMAGEN (por omisión, la imagen del servicio «timescaledb» de la pila;
# si no hay pila, la construye de db/imagen) y PUBLICO_INTEGRACION_PREFIJO (nombre del contenedor; por omisión publico-integracion).
set -uo pipefail
cd "$(dirname "$0")/.."                       # plataforma/

IMAGEN="${PUBLICO_IMAGEN:-}"
if [ -z "$IMAGEN" ]; then
  cid=$(docker compose ps -q timescaledb 2>/dev/null | head -1)
  [ -n "$cid" ] && IMAGEN=$(docker inspect --format '{{.Image}}' "$cid")
  # La imagen de un contenedor que sigue corriendo puede haber quedado sin etiqueta y borrada tras reconstruir: entonces, la construida aquí.
  if [ -z "$IMAGEN" ] || ! docker image inspect "$IMAGEN" >/dev/null 2>&1; then
    IMAGEN=$(docker build -q db/imagen) || { echo "FALLA no pude construir la imagen de la base (db/imagen)"; exit 1; }
  fi
fi
NOMBRE="${PUBLICO_INTEGRACION_PREFIJO:-publico-integracion}-$$"
limpiar() { docker rm -f -v "$NOMBRE" >/dev/null 2>&1; }
trap limpiar EXIT
CLAVE_DUENO=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
CLAVE_APP=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')

# --rm y la etiqueta: si el guion muere sin limpiar, el contenedor se borra al detenerse y se reconoce por su etiqueta.
docker run -d --rm --label proposito=publico-integracion --name "$NOMBRE" --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=plataforma -e POSTGRES_DB=plataforma -e POSTGRES_PASSWORD="$CLAVE_DUENO" \
  -v "$PWD/db/init:/docker-entrypoint-initdb.d:ro" -p 127.0.0.1::5432 \
  "$IMAGEN" postgres -c timescaledb.max_background_workers=0 -c timescaledb.telemetry_level=off >/dev/null \
  || { echo "FALLA no pude levantar la base desechable"; exit 1; }
# La imagen arranca, aplica las migraciones y reinicia una vez: se espera a que responda tres veces seguidas y a que exista la última tabla.
seguidas=0
for _ in $(seq 1 120); do
  if docker exec "$NOMBRE" psql -X -q -U plataforma -d plataforma -tAc "SELECT 1 FROM pg_tables WHERE tablename = 'enlace_publico_acceso'" 2>/dev/null | grep -q 1; then
    seguidas=$((seguidas + 1)); else seguidas=0; fi
  [ "$seguidas" -ge 3 ] && break
  sleep 1
done
[ "$seguidas" -ge 3 ] || { echo "FALLA la base desechable no respondió en 120 s"; docker logs --tail 20 "$NOMBRE" 2>&1 | sed 's/^/      /'; exit 1; }
# La clave del rol de la aplicación, por la entrada estándar (no queda en la lista de procesos). Es hexadecimal: no hay comillas que escapar.
printf "ALTER ROLE plataforma_app PASSWORD '%s';\n" "$CLAVE_APP" | docker exec -i "$NOMBRE" psql -X -q -v ON_ERROR_STOP=1 -U plataforma -d plataforma \
  || { echo "FALLA no pude fijar la clave del rol de la aplicación"; exit 1; }
PUERTO=$(docker port "$NOMBRE" 5432/tcp | head -1 | sed 's/.*://')
[[ "$PUERTO" =~ ^[0-9]+$ ]] || { echo "FALLA no pude leer el puerto de la base desechable"; exit 1; }

cd backend
# La prueba de aislamiento levanta la aplicación compilada (dist/), con los metadatos de decoradores que Nest necesita.
pnpm build >/dev/null || { echo "FALLA no pude compilar el backend (pnpm build)"; exit 1; }
PRUEBA_DB_PUERTO="$PUERTO" PRUEBA_CLAVE_DUENO="$CLAVE_DUENO" PRUEBA_CLAVE_APP="$CLAVE_APP" pnpm exec tsx integracion/publico.ts
