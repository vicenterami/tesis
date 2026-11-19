#!/usr/bin/env bash
# Prueba de integración de «Esperando primera trama» y «en servicio desde» (docs/19 §2 y §4, P; docs/10 §8.4 punto 68; migración 26), contra
# una base REAL:
#   bash plataforma/pruebas/espera-integracion.sh
# Qué hace:
#   1. levanta una base DESECHABLE con la imagen de la base de la plataforma, SIN RED (--network none) y con los datos en memoria, con las
#      migraciones de db/init HASTA LA 25 (copiadas a una carpeta temporal, montada solo lectura); la conexión es por el socket Unix de
#      una carpeta temporal propia en /tmp, así que no se publica ningún puerto;
#   2. siembra un sitio con cinco dispositivos de fechas distintas (uno en mantenimiento, dos que ya enviaron tramas) y aplica la migración
#      26 DOS veces, moviendo entre una y otra un `en_servicio_desde` y el plazo del sitio: la segunda pasada no debe pisar nada; reaplica la
#      14 y corre la línea 26 del paso 2 de verificar-todo.sh y las convenciones del esquema (db/pruebas/convenciones.sql);
#   3. compila el backend (pnpm build) y corre backend/integracion/espera.ts con tsx: la regla del estado visual en SQL con la tabla de casos
#      del panel, el supervisor, el inventario y el resumen con el rol de la aplicación (plataforma_app), y la API del plazo con la aplicación
#      compilada en un puerto efímero de 127.0.0.1;
#   4. borra el contenedor y las carpetas temporales. No toca la pila ni ningún volumen: se puede correr con la pila en uso.
# Sale 0 solo si todas las comprobaciones dan OK. Variables: ESPERA_IMAGEN (por omisión, la imagen del servicio «timescaledb» de la pila;
# si no hay pila, la construye de db/imagen) y ESPERA_INTEGRACION_PREFIJO (nombre del contenedor; por omisión espera-integracion).
set -uo pipefail
cd "$(dirname "$0")/.."                       # plataforma/

IMAGEN="${ESPERA_IMAGEN:-}"
if [ -z "$IMAGEN" ]; then
  cid=$(docker compose ps -q timescaledb 2>/dev/null | head -1)
  [ -n "$cid" ] && IMAGEN=$(docker inspect --format '{{.Image}}' "$cid")
  # La imagen de un contenedor que sigue corriendo puede haber quedado sin etiqueta y borrada tras reconstruir: entonces, la construida aquí.
  if [ -z "$IMAGEN" ] || ! docker image inspect "$IMAGEN" >/dev/null 2>&1; then
    IMAGEN=$(docker build -q db/imagen) || { echo "FALLA no pude construir la imagen de la base (db/imagen)"; exit 1; }
  fi
fi
NOMBRE="${ESPERA_INTEGRACION_PREFIJO:-espera-integracion}-$$"
TRABAJO=$(mktemp -d "${TMPDIR:-/tmp}/espera-integracion.XXXXXX") || { echo "FALLA no pude crear la carpeta de trabajo"; exit 1; }
# El socket va en una carpeta propia de nombre corto: la ruta de un socket Unix admite 107 bytes y, con una TMPDIR larga, Node no lo
# encuentra (ENOENT) aunque exista. Se monta en /sock y NO en /var/run/postgresql: el entrypoint de la imagen hace chown de esa carpeta y,
# montada ahí, la del anfitrión quedaba del usuario de postgres (70), con el bit pegajoso, y no se podía borrar al salir (visto el 18/11/2026).
# Al salir, primero se detiene (postgres borra su socket al apagarse) y después se borra.
SOCK=$(mktemp -d /tmp/esp-sock.XXXXXX) || { echo "FALLA no pude crear la carpeta del socket"; rm -rf "$TRABAJO"; exit 1; }
limpiar() { docker stop -t 15 "$NOMBRE" >/dev/null 2>&1; docker rm -f -v "$NOMBRE" >/dev/null 2>&1; rm -rf "$TRABAJO" "$SOCK" 2>/dev/null; }
trap limpiar EXIT
mkdir -p "$TRABAJO/init" && chmod 777 "$SOCK"
for f in db/init/*.sql; do n=$(basename "$f"); [ "$((10#${n:0:2}))" -le 25 ] && cp "$f" "$TRABAJO/init/"; done
[ "$(ls "$TRABAJO/init" | wc -l)" -eq 25 ] || { echo "FALLA se esperaban las migraciones 01 a 25 en db/init"; exit 1; }
CLAVE_DUENO=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
CLAVE_APP=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')

# --rm y la etiqueta: si el guion muere sin limpiar, el contenedor se borra al detenerse y se reconoce por su etiqueta.
docker run -d --rm --label proposito=espera-integracion --name "$NOMBRE" --network none --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=plataforma -e POSTGRES_DB=plataforma -e POSTGRES_PASSWORD="$CLAVE_DUENO" \
  -v "$TRABAJO/init:/docker-entrypoint-initdb.d:ro" -v "$SOCK:/sock" \
  "$IMAGEN" postgres -c timescaledb.max_background_workers=0 -c timescaledb.telemetry_level=off -c unix_socket_directories=/var/run/postgresql,/sock >/dev/null \
  || { echo "FALLA no pude levantar la base desechable"; exit 1; }
psql_() { docker exec -i "$NOMBRE" psql -X -q -v ON_ERROR_STOP=1 -U plataforma -d plataforma "$@"; }
# La imagen arranca, aplica las migraciones y reinicia una vez: se espera a que responda tres veces seguidas y a que exista la última tabla.
seguidas=0
for _ in $(seq 1 120); do
  if psql_ -tAc "SELECT 1 FROM pg_tables WHERE tablename = 'enlace_publico_acceso'" 2>/dev/null | grep -q 1; then
    seguidas=$((seguidas + 1)); else seguidas=0; fi
  [ "$seguidas" -ge 3 ] && break
  sleep 1
done
[ "$seguidas" -ge 3 ] || { echo "FALLA la base desechable no respondió en 120 s"; docker logs --tail 20 "$NOMBRE" 2>&1 | sed 's/^/      /'; exit 1; }
printf "ALTER ROLE plataforma_app PASSWORD '%s';\n" "$CLAVE_APP" | psql_ || { echo "FALLA no pude fijar la clave del rol de la aplicación"; exit 1; }

fallos=0
ok() { echo "OK    $1"; }
falla() { echo "FALLA $1"; fallos=$((fallos+1)); }

# ── 2. La migración 26 sobre datos, dos veces ─────────────────────────────────────────────────────────────────────────────────────
psql_ <<'SQL' || { echo "FALLA no pude sembrar la base con la migración 25"; exit 1; }
INSERT INTO sitio (nombre, codigo, zona_horaria) VALUES ('Sitio de la migración', 'mig-d127', 'America/Santiago');
INSERT INTO zona (sitio_id, nombre) SELECT id, 'Zona' FROM sitio WHERE codigo = 'mig-d127';
INSERT INTO dispositivo (zona_id, id_fisico, nombre, intervalo_esperado_s, creado_en)
SELECT z.id, 'mig-' || g, 'Equipo ' || g, 300, now() - g * INTERVAL '1 day' FROM generate_series(1, 5) g, zona z WHERE z.nombre = 'Zona';
UPDATE dispositivo SET estado = 'mantenimiento' WHERE id_fisico = 'mig-5';
INSERT INTO estado_dispositivo (dispositivo_id, visto_por_ultima_vez) SELECT id, now() - INTERVAL '1 hour' FROM dispositivo WHERE id_fisico IN ('mig-1', 'mig-2');
SQL
[ "$(psql_ -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name IN ('dispositivo','sitio') AND column_name IN ('en_servicio_desde','espera_primera_trama_h')")" = 0 ] \
  && ok "antes de la 26: ni en_servicio_desde ni espera_primera_trama_h" || falla "la base ya traía las columnas de la 26 antes de aplicarla"
psql_ < db/init/26-espera-primera-trama.sql 2>"$TRABAJO/m1.err" && ok "migración 26 aplicada sobre 5 dispositivos y 1 sitio" || { falla "la migración 26 no se aplicó: $(head -c 300 "$TRABAJO/m1.err")"; exit 1; }
r=$(psql_ -tAc "SELECT count(*) FILTER (WHERE en_servicio_desde = creado_en) || '/' || count(*) FROM dispositivo; SELECT espera_primera_trama_h FROM sitio WHERE codigo = 'mig-d127'" | tr '\n' ' ')
[ "$r" = "5/5 168 " ] && ok "las filas existentes: en_servicio_desde = creado_en (5 de 5) y el plazo del sitio, 168 h por omisión" || falla "después de la 26: «$r» (se esperaba «5/5 168 »)"
# Entre una pasada y otra, el backend mueve un en_servicio_desde y el administrador fija el plazo: la segunda pasada no debe pisarlos.
psql_ -c "UPDATE dispositivo SET en_servicio_desde = now() WHERE id_fisico = 'mig-3'; UPDATE sitio SET espera_primera_trama_h = 24 WHERE codigo = 'mig-d127'" >/dev/null
psql_ < db/init/26-espera-primera-trama.sql 2>"$TRABAJO/m2.err" || falla "la segunda pasada de la 26 falló: $(head -c 300 "$TRABAJO/m2.err")"
r=$(psql_ -tAc "SELECT count(*) FILTER (WHERE en_servicio_desde = creado_en) || '/' || count(*) FROM dispositivo; SELECT espera_primera_trama_h FROM sitio WHERE codigo = 'mig-d127'; SELECT count(*) FROM pg_constraint WHERE conname = 'ck_sitio_espera_primera_trama_h'" | tr '\n' ' ')
[ "$r" = "4/5 24 1 " ] && ok "la 26 repetida no pisa lo que ya cambió (4 de 5 iguales a creado_en, el plazo sigue en 24 h) ni duplica su CHECK" || falla "después de repetir la 26: «$r» (se esperaba «4/5 24 1 »)"
psql_ < db/init/14-rol-aplicacion.sql >/dev/null 2>&1 && ok "la 14 reaplicada después de la 26" || falla "la 14 no se pudo reaplicar"
# La línea 26 del paso 2 del verificador, tal cual (y las convenciones del esquema, como el paso 1b).
linea=$(grep -E "^SELECT .*'OK    26 " pruebas/verificar-todo.sh)
[ -n "$linea" ] || falla "no encontré la línea 26 en el paso 2 de verificar-todo.sh"
r=$(psql_ -tA <<<"$linea")
[[ "$r" == "OK    26 "* ]] && ok "paso 2 del verificador, línea 26: ${r:6:90}…" || falla "paso 2 del verificador, línea 26: $r"
conv=$(psql_ -tA < db/pruebas/convenciones.sql)
[ "$(grep -c '^OK' <<<"$conv")" -ge 7 ] && ! grep -q FALLA <<<"$conv" && ok "convenciones del esquema (docs/08 §6): $(grep -c '^OK' <<<"$conv") de $(grep -c . <<<"$conv")" \
  || { falla "convenciones del esquema:"; grep -v '^OK' <<<"$conv" | sed 's/^/      /'; }

# ── 3. El backend contra esta base ────────────────────────────────────────────────────────────────────────────────────────────────
cd backend
pnpm build >/dev/null || { echo "FALLA no pude compilar el backend (pnpm build)"; exit 1; }
[ -S "$SOCK/.s.PGSQL.5432" ] || { echo "FALLA no está el socket de la base desechable en $SOCK"; docker logs --tail 20 "$NOMBRE" 2>&1 | sed 's/^/      /'; exit 1; }
PRUEBA_DB_SOCKET="$SOCK" PRUEBA_CLAVE_APP="$CLAVE_APP" pnpm exec tsx integracion/espera.ts || fallos=$((fallos+1))
[ "$fallos" -eq 0 ] || { echo "$fallos bloque(s) con fallas"; exit 1; }
