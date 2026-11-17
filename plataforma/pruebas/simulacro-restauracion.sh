#!/usr/bin/env bash
# Simulacro de restauración (docs/10 §9.5; docs/11 §8; TT-46): «un respaldo que no se restauró no es respaldo».
#   bash plataforma/pruebas/simulacro-restauracion.sh <carpeta>/plataforma-<marca>.dump[.age] [<carpeta>/plataforma-<marca>.huella]
# Sin la huella, toma la que está junto al volcado con el mismo nombre. Un volcado cifrado (.dump.age) se descifra con la clave
# privada de age que indica RESPALDO_IDENTIDAD=<archivo>; sin ella, o con una que no corresponde, sale con un mensaje y no restaura.
# La clave privada no vive en el servidor: el simulacro de un respaldo cifrado se corre donde está la clave (docs/10 §9.5). Una clave
# privada protegida con frase de paso hace que age la pida por la terminal: sin terminal, el simulacro sale con 2 en vez de esperar. Qué hace:
#   1. si junto al volcado está su archivo de sumas (.sha256), comprueba que ni el volcado ni la huella cambiaron desde el respaldo;
#   2. levanta una base DESECHABLE con la misma imagen de la base de la plataforma, sin red y con los datos en memoria;
#   3. le pasa el volcado por un flujo (descifrándolo en el camino si va cifrado) a un disco en memoria del contenedor: el volcado en
#      claro no toca ningún disco;
#   4. restaura el volcado en el orden que pide TimescaleDB: crear la base, la extensión, timescaledb_pre_restore(), pg_restore,
#      timescaledb_post_restore();
#   5. calcula la huella de lo restaurado (db/pruebas/huella-respaldo.sql) y la compara línea por línea con la del respaldo;
#   6. borra el contenedor. No toca la base de la plataforma ni ningún volumen: se puede correr con la pila en uso.
# Sale 0 solo si las sumas coinciden (cuando las hay), el volcado se descifró entero (cuando va cifrado), pg_restore no dio ningún
# error y las dos huellas son idénticas (las mismas filas, con el mismo contenido, en las mismas tablas; las mismas hipertablas,
# objetos y permisos). Con el resultado dice cuánto tardó: es el piso del tiempo de recuperación.
# Variables: SIMULACRO_IMAGEN (por omisión, la imagen del servicio «timescaledb» de la pila; si no hay pila, la construye de db/imagen).
set -uo pipefail
VOLCADO="${1:-}"; HUELLA="${2:-}"
[ -n "$VOLCADO" ] || { echo "uso: bash plataforma/pruebas/simulacro-restauracion.sh <volcado.dump[.age]> [<huella>]"; exit 2; }
CIFRADO=0; case "$VOLCADO" in *.dump.age) CIFRADO=1 ;; esac
BASE_NOMBRE="${VOLCADO%.age}"; BASE_NOMBRE="${BASE_NOMBRE%.dump}"
[ -n "$HUELLA" ] || HUELLA="$BASE_NOMBRE.huella"
[ -s "$VOLCADO" ] || { echo "FALLA no existe o está vacío el volcado: $VOLCADO"; exit 2; }
if [ "$CIFRADO" = 1 ]; then
  IDENTIDAD="${RESPALDO_IDENTIDAD:-}"
  [ -n "$IDENTIDAD" ] || { echo "FALLA el volcado está cifrado: indica la clave privada de age con RESPALDO_IDENTIDAD=<archivo> (vive fuera del servidor)"; exit 2; }
  [ -r "$IDENTIDAD" ] || { echo "FALLA no puedo leer la clave privada $IDENTIDAD"; exit 2; }
  command -v age >/dev/null || { echo "FALLA el volcado está cifrado y age no está instalado aquí"; exit 2; }
  # Una clave con frase de paso es a su vez un archivo cifrado por age (binario o en armadura de texto).
  if head -c 64 "$IDENTIDAD" | grep -a -q -E '^(age-encryption\.org/v1|-----BEGIN AGE ENCRYPTED FILE-----)'; then
    if { : < /dev/tty; } 2>/dev/null; then echo "aviso: la clave privada está protegida con frase de paso: age la pedirá por la terminal"
    else echo "FALLA la clave privada está protegida con frase de paso y no hay terminal para pedirla: corre el simulacro en una terminal"; exit 2; fi
  fi
  IDENTIDAD=$(readlink -f "$IDENTIDAD")
fi
[ -s "$HUELLA" ] || { echo "FALLA no encuentro la huella del respaldo ($HUELLA): sin ella solo se sabría que restaura, no que restaura lo mismo"; exit 2; }
# Una huella cortada o de otra cosa no sirve de vara: debe traer tablas, la línea de objetos y la extensión de TimescaleDB.
{ [ "$(grep -c '^tabla ' "$HUELLA")" -ge 1 ] && grep -q '^objetos ' "$HUELLA" && grep -q '^extension timescaledb ' "$HUELLA"; } \
  || { echo "FALLA la huella del respaldo está incompleta (sin tablas, sin la línea de objetos o sin la extensión): no sirve para comparar"; exit 2; }
VOLCADO=$(readlink -f "$VOLCADO"); HUELLA=$(readlink -f "$HUELLA")
SUMAS="$(readlink -f "$BASE_NOMBRE").sha256"
cd "$(dirname "$0")/.."                       # plataforma/
fallos=0
ok() { echo "OK    $1"; }
falla() { echo "FALLA $1"; fallos=$((fallos + 1)); }
# Las sumas se escribieron al respaldar: si el volcado o la huella cambiaron después (un archivo truncado en la copia, una huella
# editada), aquí se ve antes de restaurar. Los respaldos anteriores al 17/11/2026 no traen sumas: se avisa y se sigue.
if [ -f "$SUMAS" ]; then
  for f in "$VOLCADO" "$HUELLA"; do
    esperada=$(awk -v n="$(basename "$f")" '$2 == n {print $1}' "$SUMAS")
    if [ -z "$esperada" ]; then falla "el archivo de sumas no nombra $(basename "$f")"
    elif [ "$(sha256sum < "$f" | cut -d' ' -f1)" = "$esperada" ]; then ok "$(basename "$f") coincide con la suma SHA-256 tomada al respaldar"
    else falla "$(basename "$f") NO coincide con la suma SHA-256 tomada al respaldar: se alteró o se truncó después"; fi
  done
else echo "aviso: no hay archivo de sumas ($(basename "$SUMAS")); respaldo anterior al 17/11/2026"; fi

IMAGEN="${SIMULACRO_IMAGEN:-}"
if [ -z "$IMAGEN" ]; then
  cid=$(docker compose ps -q timescaledb 2>/dev/null | head -1)
  [ -n "$cid" ] && IMAGEN=$(docker inspect --format '{{.Image}}' "$cid")
  # Un contenedor puede seguir corriendo aunque su imagen ya se haya borrado (etiqueta movida y limpieza): entonces se construye.
  if [ -z "$IMAGEN" ] || ! docker image inspect "$IMAGEN" >/dev/null 2>&1; then
    [ -n "$IMAGEN" ] && echo "      la imagen de la base en ejecución (${IMAGEN:0:19}) ya no existe: se construye db/imagen"
    IMAGEN=$(docker build -q db/imagen) || { echo "FALLA no pude construir la imagen de la base (db/imagen)"; exit 1; }
  fi
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
docker run -d --rm --label proposito=simulacro-restauracion --name "$NOMBRE" --network none --tmpfs /var/lib/postgresql/data --tmpfs /restaurar \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER="$DUENO" -e POSTGRES_DB=postgres \
  "$IMAGEN" postgres -c timescaledb.max_background_workers=0 -c timescaledb.telemetry_level=off >/dev/null 2> "$TRABAJO/docker-run.txt" \
  || { echo "FALLA no pude levantar la base desechable: $(head -c 300 "$TRABAJO/docker-run.txt")"; exit 1; }
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
# El volcado entra al contenedor por un flujo y queda en /restaurar, un disco en memoria: descifrado, nunca se escribe en un disco.
# age sale con 0 solo si descifró y autenticó el archivo entero (clave equivocada o archivo truncado: distinto de 0).
if [ "$CIFRADO" = 1 ]; then
  age -d -i "$IDENTIDAD" "$VOLCADO" 2> "$TRABAJO/age.txt" | docker exec -i "$NOMBRE" sh -c 'cat > /restaurar/volcado.dump'
  estados=("${PIPESTATUS[@]}")
  if [ "${estados[0]}" -ne 0 ]; then
    echo "FALLA no se pudo descifrar el volcado (¿clave equivocada o archivo truncado?): $(head -1 "$TRABAJO/age.txt" | cut -c1-160)"
    echo; echo "SIMULACRO CON FALLAS: este respaldo NO se puede dar por bueno"; exit 1
  fi
  [ "${estados[1]}" -eq 0 ] && ok "volcado descifrado con la clave privada y autenticado entero por age" || falla "no pude copiar el volcado descifrado al contenedor"
else
  docker exec -i "$NOMBRE" sh -c 'cat > /restaurar/volcado.dump' < "$VOLCADO" || falla "no pude copiar el volcado al contenedor"
fi
docker exec "$NOMBRE" pg_restore -U "$DUENO" -d restaurada /restaurar/volcado.dump > "$TRABAJO/pg_restore.txt" 2>&1; rc=$?
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
