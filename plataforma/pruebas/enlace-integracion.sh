#!/usr/bin/env bash
# Prueba de integración de la señal del enlace LoRaWAN (HU-15; docs/10 §8.4 punto 71; docs/19 §4 AA; migración 29), contra una base REAL y
# desechable:
#   bash plataforma/pruebas/enlace-integracion.sh
# Qué hace: levanta una base DESECHABLE con la imagen de la base de la plataforma, SIN RED (--network none), con los datos en memoria y TODAS
# las migraciones de db/init (copiadas a una carpeta temporal, montada solo lectura; conexión por el socket Unix de una carpeta temporal
# propia, sin publicar puertos); compila el backend y corre backend/integracion/enlace.ts con tsx: «Agregar una magnitud» (permisos, otro
# sitio, catálogo, idempotencia, evento y Actividad), «lo que la trama trae y no se guarda» y «elegir qué ver» (docs/10 §8.4 punto 72), el pipeline con y sin los canales del enlace (por RecepcionService, sin broker), el
# 0 dB de ChirpStack, lo fuera de rango sin cuarentena, el `enlace[]` del resumen y el histórico del sitio. Después, como dueño: la migración
# 29 y la 30 dos veces (no duplican ni pisan) y la semilla de demostración dos veces, con las comprobaciones de la señal de sus nodos LoRaWAN. Al salir
# (bien, mal o con Ctrl+C) borra el contenedor y las carpetas temporales. Sale 1 si algo falla.
set -uo pipefail
cd "$(dirname "$0")/.."                       # plataforma/

IMAGEN="${ENLACE_IMAGEN:-}"
if [ -z "$IMAGEN" ]; then
  cid=$(docker compose ps -q timescaledb 2>/dev/null | head -1)
  [ -n "$cid" ] && IMAGEN=$(docker inspect --format '{{.Image}}' "$cid")
  if [ -z "$IMAGEN" ] || ! docker image inspect "$IMAGEN" >/dev/null 2>&1; then
    IMAGEN=$(docker build -q db/imagen) || { echo "FALLA no pude construir la imagen de la base (db/imagen)"; exit 1; }
  fi
fi
NOMBRE="${ENLACE_INTEGRACION_PREFIJO:-enlace-integracion}-$$"
TRABAJO=$(mktemp -d "${TMPDIR:-/tmp}/enlace-integracion.XXXXXX") || { echo "FALLA no pude crear la carpeta de trabajo"; exit 1; }
SOCK=$(mktemp -d /tmp/en-sock.XXXXXX) || { echo "FALLA no pude crear la carpeta del socket"; rm -rf "$TRABAJO"; exit 1; }
limpiar() { docker stop -t 15 "$NOMBRE" >/dev/null 2>&1; docker rm -f -v "$NOMBRE" >/dev/null 2>&1; rm -rf "$TRABAJO" "$SOCK" 2>/dev/null; }
trap limpiar EXIT
mkdir -p "$TRABAJO/init" && chmod 703 "$SOCK"
cp db/init/*.sql "$TRABAJO/init/"
n_mig=$(ls db/init/*.sql | wc -l)
[ "$n_mig" -ge 30 ] || { echo "FALLA se esperaban al menos 30 migraciones (la 29 trae snr; la 30, magnitudes_ocultas) en db/init (hay $n_mig)"; exit 1; }
CLAVE_DUENO=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
CLAVE_APP=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')

docker run -d --rm --label proposito=enlace-integracion --name "$NOMBRE" --network none --tmpfs /var/lib/postgresql/data:size=512m --shm-size=256m \
  -e POSTGRES_USER=plataforma -e POSTGRES_DB=plataforma -e POSTGRES_PASSWORD="$CLAVE_DUENO" \
  -v "$TRABAJO/init:/docker-entrypoint-initdb.d:ro" -v "$SOCK:/sock" \
  "$IMAGEN" postgres -c timescaledb.max_background_workers=0 -c timescaledb.telemetry_level=off -c unix_socket_directories=/var/run/postgresql,/sock >/dev/null \
  || { echo "FALLA no pude levantar la base desechable"; exit 1; }
psql_() { docker exec -i "$NOMBRE" psql -X -q -v ON_ERROR_STOP=1 -U plataforma -d plataforma "$@"; }
# La imagen arranca, aplica las migraciones y reinicia una vez: se espera a que responda tres veces seguidas y a que exista lo de la última.
seguidas=0
for _ in $(seq 1 120); do
  if psql_ -tAc "SELECT 1 FROM magnitud WHERE codigo = 'snr' AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'preferencia' AND column_name = 'magnitudes_ocultas')" 2>/dev/null | grep -q 1; then seguidas=$((seguidas + 1)); else seguidas=0; fi
  [ "$seguidas" -ge 3 ] && break
  sleep 1
done
[ "$seguidas" -ge 3 ] || { echo "FALLA la base desechable no respondió en 120 s"; docker logs --tail 20 "$NOMBRE" 2>&1 | sed 's/^/      /'; exit 1; }
printf "ALTER ROLE plataforma_app PASSWORD '%s';\n" "$CLAVE_APP" | psql_ || { echo "FALLA no pude fijar la clave del rol de la aplicación"; exit 1; }
echo "OK    base desechable con las $n_mig migraciones de db/init"

fallos=0
(
  cd backend
  pnpm build >/dev/null || { echo "FALLA no pude compilar el backend (pnpm build)"; exit 1; }
  [ -S "$SOCK/.s.PGSQL.5432" ] || { echo "FALLA no está el socket de la base desechable en $SOCK"; exit 1; }
  PRUEBA_DB_SOCKET="$SOCK" PRUEBA_CLAVE_APP="$CLAVE_APP" pnpm exec tsx integracion/enlace.ts
) || fallos=$((fallos+1))

# La migración 29, otra vez y otra más, como dueño: aditiva e idempotente (no duplica ni pisa un snr existente).
psql_ -c "UPDATE magnitud SET nombre = 'SNR editado desde el catálogo' WHERE codigo = 'snr'" >/dev/null
for _ in 1 2; do psql_ -f /docker-entrypoint-initdb.d/29-relacion-senal-ruido.sql >/dev/null || { echo "FALLA la migración 29 no se reaplicó"; fallos=$((fallos+1)); }; done
for _ in 1 2; do psql_ -f /docker-entrypoint-initdb.d/30-magnitudes-ocultas.sql >/dev/null || { echo "FALLA la migración 30 no se reaplicó"; fallos=$((fallos+1)); }; done
r30=$(psql_ -tAc "SELECT count(*) FROM pg_constraint WHERE conname = 'ck_preferencia_magnitudes_ocultas'")
[ "$r30" = 1 ] && echo "OK    migración 30 reaplicada dos veces: un solo CHECK y la columna intacta" || { echo "FALLA migración 30 reaplicada: $r30 restricciones"; fallos=$((fallos+1)); }
# La 14 reaplicada (REVOKE ALL y vuelve a dar) no le quita a la aplicación el UPDATE de la columna nueva.
psql_ -f /docker-entrypoint-initdb.d/14-rol-aplicacion.sql >/dev/null 2>&1 || { echo "FALLA la migración 14 no se reaplicó"; fallos=$((fallos+1)); }
r14=$(psql_ -tAc "SELECT has_column_privilege('plataforma_app', 'preferencia', 'magnitudes_ocultas', 'UPDATE')")
[ "$r14" = t ] && echo "OK    migración 14 reaplicada: plataforma_app conserva el UPDATE de preferencia.magnitudes_ocultas" || { echo "FALLA tras reaplicar la 14, plataforma_app sin UPDATE de magnitudes_ocultas ($r14)"; fallos=$((fallos+1)); }
r=$(psql_ -tAc "SELECT count(*) || ' ' || max(nombre) FROM magnitud WHERE codigo = 'snr'")
[ "$r" = "1 SNR editado desde el catálogo" ] && echo "OK    migración 29 reaplicada dos veces: una sola fila y no pisa lo editado en el catálogo" || { echo "FALLA migración 29 reaplicada: «$r»"; fallos=$((fallos+1)); }

# La semilla de demostración (la base, demo.sql, y la completa dos veces, como semilla-demo.sh --completa), con las comprobaciones de la señal de sus nodos LoRaWAN (las de pruebas/semilla-demo.sh, en SQL).
psql_ < db/semillas/demo.sql >/dev/null || { echo "FALLA la semilla base (demo.sql) no se aplicó"; fallos=$((fallos+1)); }
for vuelta in 1 2; do psql_ < db/semillas/demo-completa.sql >/dev/null || { echo "FALLA la semilla completa no se aplicó (vuelta $vuelta)"; fallos=$((fallos+1)); }; done
L="'demo-aire-01','demo-suelo-01','demo-silencioso','demo-mantenimiento','demo-baja','demo-http-01','demo-lora-01','demo-lora-02','d03','demo-identificador-en-el-limite-de-sesenta-y-tres-caracteres-ok','demo-mag-01'"
comprobar() { local real; real=$(psql_ -tAc "$2" 2>&1); if [ "$real" = "$3" ]; then echo "OK    semilla: $1 ($real)"; else echo "FALLA semilla: $1: esperado $3, hay ${real:-nada}"; fallos=$((fallos+1)); fi; }
comprobar "rssi y snr en los dos nodos LoRaWAN" "SELECT count(*) FROM canal c JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico IN ('demo-lora-01','demo-lora-02') AND c.magnitud_codigo IN ('rssi','snr')" 4
comprobar "sin mediciones fuera del rango de su magnitud" "SELECT count(*) FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN magnitud g ON g.codigo=c.magnitud_codigo JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico IN ($L) AND (m.valor < g.rango_min OR m.valor > g.rango_max)" 0
comprobar "toda medición tiene su trama" "SELECT count(*) FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico IN ($L) AND NOT EXISTS (SELECT 1 FROM trama t WHERE t.dispositivo_id=d.id AND t.recibido_en=m.recibido_en)" 0
comprobar "cada trama LoRaWAN lleva su señal en rxInfo (la del nodo lejano, bajo −100 dBm)" "SELECT count(*) FILTER (WHERE (convert_from(payload,'UTF8')::jsonb->'rxInfo'->0->>'rssi') IS NULL OR (d.id_fisico='demo-lora-02' AND (convert_from(payload,'UTF8')::jsonb->'rxInfo'->0->>'rssi')::float8 >= -100)) FROM trama t JOIN dispositivo d ON d.id=t.dispositivo_id WHERE d.id_fisico IN ('demo-lora-01','demo-lora-02')" 0
comprobar "los valores decodificados de las tramas LoRaWAN no llevan rssi ni snr" "SELECT count(*) FROM trama t JOIN dispositivo d ON d.id=t.dispositivo_id WHERE d.id_fisico IN ('demo-lora-01','demo-lora-02') AND (convert_from(payload,'UTF8')::jsonb ? 'rssi' OR convert_from(payload,'UTF8')::jsonb ? 'snr')" 0
comprobar "tramas de las últimas 24 h en uct: las de la cabecera (la señal no las mueve)" "SELECT count(*) FROM trama t JOIN dispositivo d ON d.id=t.dispositivo_id JOIN zona z ON z.id=d.zona_id JOIN sitio s ON s.id=z.sitio_id WHERE s.codigo='uct' AND d.id_fisico IN ($L) AND t.recibido_en >= now() - INTERVAL '24 hours'" 718

[ "$fallos" -eq 0 ] || { echo "$fallos bloque(s) con fallas"; exit 1; }
echo "ENLACE OK"
