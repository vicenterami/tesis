#!/usr/bin/env bash
# Prueba de integración de la exportación por sitio (HU-08; docs/19 §4, bloque R, puntos 7 y 8; docs/16 §89), contra una base REAL:
#   bash plataforma/pruebas/exportar-integracion.sh
# Qué hace:
#   1. levanta una base DESECHABLE con la imagen de la base de la plataforma, SIN RED (--network none) y con los datos en memoria, con TODAS
#      las migraciones de db/init (copiadas a una carpeta temporal, montada solo lectura); la conexión es por el socket Unix de una carpeta
#      temporal propia en /tmp, así que no se publica ningún puerto;
#   2. compila el backend (pnpm build) y corre backend/integracion/exportar.ts con tsx: siembra un sitio con los casos límite del bloque R
#      (punto 7) y otro sitio con marcas propias, levanta la aplicación compilada en un puerto efímero de 127.0.0.1 y comprueba permisos,
#      la ida y vuelta en los tres formatos con lectores escritos en la prueba (0 diferencias contra la base), el cupo compartido (429), el
#      corte cuando el cliente cierra la conexión, la estimación y la paginación por clave; con EXPORTAR_MEDIR=1 (por omisión) el sitio
#      grande del cupo y del corte trae 1 000 000 de mediciones (más 950 000 de otro sitio de 380 canales) y se mide el tiempo y la memoria
#      de exportarlo en cada formato, en un proceso aparte, los bytes por fila de la estimación y los planes de cada consulta
#      (EXPLAIN (ANALYZE, BUFFERS)); con EXPORTAR_MEDIR=0 el sitio grande es de 200 000 y los planes no se miden;
#   3. revisa los archivos con herramientas de afuera: `unzip -t` (los dos zip) y el analizador XML de Python (cada parte del XLSX);
#   4. borra el contenedor y las carpetas temporales. No toca la pila ni ningún volumen: se puede correr con la pila en uso.
# Sale 0 solo si todas las comprobaciones dan OK. Variables: EXPORTAR_IMAGEN (por omisión, la imagen del servicio «timescaledb» de la pila;
# si no hay pila, la construye de db/imagen), EXPORTAR_INTEGRACION_PREFIJO (nombre del contenedor) y EXPORTAR_MEDIR.
set -uo pipefail
cd "$(dirname "$0")/.."                       # plataforma/

IMAGEN="${EXPORTAR_IMAGEN:-}"
if [ -z "$IMAGEN" ]; then
  cid=$(docker compose ps -q timescaledb 2>/dev/null | head -1)
  [ -n "$cid" ] && IMAGEN=$(docker inspect --format '{{.Image}}' "$cid")
  # La imagen de un contenedor que sigue corriendo puede haber quedado sin etiqueta y borrada tras reconstruir: entonces, la construida aquí.
  if [ -z "$IMAGEN" ] || ! docker image inspect "$IMAGEN" >/dev/null 2>&1; then
    IMAGEN=$(docker build -q db/imagen) || { echo "FALLA no pude construir la imagen de la base (db/imagen)"; exit 1; }
  fi
fi
NOMBRE="${EXPORTAR_INTEGRACION_PREFIJO:-exportar-integracion}-$$"
TRABAJO=$(mktemp -d "${TMPDIR:-/tmp}/exportar-integracion.XXXXXX") || { echo "FALLA no pude crear la carpeta de trabajo"; exit 1; }
# El socket va en una carpeta propia de nombre corto (la ruta de un socket Unix admite 107 bytes) montada en /sock, no en
# /var/run/postgresql (el entrypoint de la imagen hace chown de esa carpeta; espera-integracion.sh, 18/11/2026).
SOCK=$(mktemp -d /tmp/exp-sock.XXXXXX) || { echo "FALLA no pude crear la carpeta del socket"; rm -rf "$TRABAJO"; exit 1; }
limpiar() { docker stop -t 15 "$NOMBRE" >/dev/null 2>&1; docker rm -f -v "$NOMBRE" >/dev/null 2>&1; rm -rf "$TRABAJO" "$SOCK" 2>/dev/null; }
trap limpiar EXIT
# postgres corre en el contenedor como otro usuario (uid 70 en la imagen, no el del anfitrión) y debe crear en /sock su socket y su archivo de
# bloqueo: le basta escribir y entrar en la carpeta (o+wx), no listarla, así que 703 y no 777. Dura lo que la prueba: la carpeta es nueva
# (mktemp, 700 al crearse) y la trampa la borra al salir.
mkdir -p "$TRABAJO/init" "$TRABAJO/archivos" && chmod 703 "$SOCK"
cp db/init/*.sql "$TRABAJO/init/"
n_mig=$(ls db/init/*.sql | wc -l)
[ "$n_mig" -ge 26 ] || { echo "FALLA se esperaban al menos 26 migraciones en db/init (hay $n_mig)"; exit 1; }
CLAVE_DUENO=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
CLAVE_APP=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')

# --rm y la etiqueta: si el guion muere sin limpiar, el contenedor se borra al detenerse y se reconoce por su etiqueta. Memoria compartida y
# tmpfs holgados: el millón de mediciones de la medición ocupa ≈ 200 MB con sus índices.
docker run -d --rm --label proposito=exportar-integracion --name "$NOMBRE" --network none --tmpfs /var/lib/postgresql/data:size=2g --shm-size=256m \
  -e POSTGRES_USER=plataforma -e POSTGRES_DB=plataforma -e POSTGRES_PASSWORD="$CLAVE_DUENO" \
  -v "$TRABAJO/init:/docker-entrypoint-initdb.d:ro" -v "$SOCK:/sock" \
  "$IMAGEN" postgres -c timescaledb.max_background_workers=0 -c timescaledb.telemetry_level=off -c unix_socket_directories=/var/run/postgresql,/sock >/dev/null \
  || { echo "FALLA no pude levantar la base desechable"; exit 1; }
psql_() { docker exec -i "$NOMBRE" psql -X -q -v ON_ERROR_STOP=1 -U plataforma -d plataforma "$@"; }
# La imagen arranca, aplica las migraciones y reinicia una vez: se espera a que responda tres veces seguidas y a que exista lo de la última.
seguidas=0
for _ in $(seq 1 120); do
  if psql_ -tAc "SELECT 1 FROM information_schema.columns WHERE table_name = 'sitio' AND column_name = 'espera_primera_trama_h'" 2>/dev/null | grep -q 1; then
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
PRUEBA_DB_SOCKET="$SOCK" PRUEBA_CLAVE_APP="$CLAVE_APP" PRUEBA_ARCHIVOS="$TRABAJO/archivos" EXPORTAR_MEDIR="${EXPORTAR_MEDIR:-1}" \
  pnpm exec tsx integracion/exportar.ts || fallos=$((fallos+1))

# ── 3. Herramientas de afuera sobre los archivos que dejó la prueba ───────────────────────────────────────────────────────────────
cd "$TRABAJO/archivos" || exit 1
for f in sitio.zip sitio.xlsx; do
  if [ ! -f "$f" ]; then echo "FALLA la prueba no dejó $f"; fallos=$((fallos+1)); continue; fi
  if command -v unzip >/dev/null; then
    unzip -tq "$f" >"$TRABAJO/unzip.txt" 2>&1 && ok_u=1 || ok_u=0
    [ "$ok_u" = 1 ] && echo "OK    unzip -t $f: $(head -1 "$TRABAJO/unzip.txt")" || { echo "FALLA unzip -t $f: $(head -3 "$TRABAJO/unzip.txt")"; fallos=$((fallos+1)); }
  else echo "omitido: unzip no está instalado (revisión externa de $f)"; fi
done
if command -v python3 >/dev/null && [ -f sitio.xlsx ]; then
  # El analizador de la biblioteca estándar de Python (expat): cada parte XML del libro debe ser XML 1.0 bien formado.
  python3 -I - sitio.xlsx <<'PY' && echo "OK    cada parte XML del libro es XML 1.0 bien formado (expat de Python)" || fallos=$((fallos+1))
import sys, zipfile, xml.parsers.expat
z = zipfile.ZipFile(sys.argv[1])
malas = []
for n in z.namelist():
    p = xml.parsers.expat.ParserCreate()
    try: p.Parse(z.read(n), True)
    except xml.parsers.expat.ExpatError as e: malas.append(f"{n}: {e}")
if malas: print("FALLA partes XML mal formadas: " + "; ".join(malas)); sys.exit(1)
PY
else echo "omitido: python3 no está (revisión XML externa)"; fi
[ "$fallos" -eq 0 ] || { echo "$fallos bloque(s) con fallas"; exit 1; }
