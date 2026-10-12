#!/usr/bin/env bash
# Corre TODOS los guardianes de concordancia y las pruebas de solo lectura. Sale 1 si algo falla.
#   bash plataforma/pruebas/verificar-todo.sh
# Requiere la pila arriba (docker compose up -d en plataforma/) y, para la API, el backend corriendo.
set -u
cd "$(dirname "$0")/../.."
# Cada corrida queda registrada (fecha y hora en el nombre) en una carpeta que git ignora.
LOG_DIR="${VERIFICAR_LOG_DIR:-privado/logs}"; mkdir -p "$LOG_DIR"
exec > >(tee "$LOG_DIR/verificar-$(date +%F-%H%M%S).log") 2>&1
echo "verificar-todo · $(date -Is) · commit $(git rev-parse --short HEAD 2>/dev/null || echo ?)"
fallos=0; omitidos=""
paso() { echo; echo "══ $1 ══"; }
# Archivos de trabajo en una carpeta propia de cada corrida, que se borra al salir (08/10: con nombres fijos en /tmp, dos
# corridas a la vez se pisaban y otro usuario del equipo podía leerlos o reemplazarlos antes de que se usaran).
VT=$(mktemp -d "${TMPDIR:-/tmp}/verificar.XXXXXX") || { echo "FALLA no se pudo crear la carpeta de trabajo"; exit 1; }
trap 'rm -rf "$VT"' EXIT
# Archivos que entrarían al repositorio: los versionados y los nuevos que git no ignora (08/10: los pasos que solo miraban
# los versionados no revisaron cinco archivos nuevos antes de su primer commit).
archivos_repo() { git ls-files --cached --others --exclude-standard; }
# Un paso que no revisó nada no pasa (27/09): con la base inalcanzable, los pasos 1, 2 y 2b salían en
# verde porque buscaban «FALLA» en una salida vacía. Cada consulta exige su salida de código 0 y un
# mínimo de líneas OK.
exige() { # exige ARCHIVO SALIDA_PSQL MINIMO_OK
  local ok; ok=$(grep -c "^OK" "$1")
  if [ "$2" -ne 0 ] || [ "$ok" -lt "$3" ]; then echo "FALLA la consulta no corrió o revisó de menos (salida $2, $ok de $3 OK): ¿base inalcanzable?"; return 1; fi
  ! grep -q FALLA "$1"; }

paso "0. Backend: tipos, lint y pruebas unitarias (pnpm verificar) — no necesita base ni broker"
# `tsc` con salida 0 no prueba nada si no revisó archivos (tsconfig mal apuntado): se exige un mínimo.
if command -v pnpm >/dev/null; then (cd plataforma/backend && n=$(pnpm -s exec tsc --listFiles --noEmit 2>/dev/null | grep -c "/src/"); [[ ${n:-0} -ge 10 ]] && echo "tsc revisó $n archivos de src" || { echo "FALLA tsc revisó solo ${n:-0} archivos de src"; exit 1; }) || fallos=$((fallos+1)); fi
if command -v pnpm >/dev/null; then (cd plataforma/backend && pnpm verificar 2>&1 | grep -E "^\$ |Tests:|error|✖|FAIL"; exit "${PIPESTATUS[0]}") || fallos=$((fallos+1)); else echo "omitida: pnpm no está en el PATH"; omitidos="$omitidos 0"; fi

paso "1. Esquema: guardias de tipo y zonas horarias (db/pruebas/zonas-horarias.sql)"
docker compose -f plataforma/docker-compose.yml exec -T timescaledb psql -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA -F ' · ' \
  < plataforma/db/pruebas/zonas-horarias.sql | tee "$VT"/sql.txt
exige "$VT"/sql.txt "${PIPESTATUS[0]}" 10 || fallos=$((fallos+1))

paso "1b. Convenciones del esquema en la base real (docs/08 §6): nombres de restricciones, índices, disparadores y funciones; índice por clave foránea; tipos"
# 09/10: docs/08 §6 decía «✅ 32/32» y nadie lo recalculaba; una restricción de las migraciones 07 y 09 no seguía la
# convención. Ahora lo mide la base, sin cifras escritas a mano.
docker compose -f plataforma/docker-compose.yml exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA \
  < plataforma/db/pruebas/convenciones.sql | tee "$VT"/convenciones.txt
exige "$VT"/convenciones.txt "${PIPESTATUS[0]}" 7 || fallos=$((fallos+1))

paso "1c. Reglas de identidad de la migración 11, plantadas en una transacción que se deshace (docs/10 §8.4 punto 24)"
# Pasarela y dispositivo no comparten identificador; lista blanca; LoRaWAN exige pasarela; código de sitio válido. Nada
# queda en la base: el archivo termina en ROLLBACK. La carrera de dos altas simultáneas se probó a mano (docs/16 §13).
docker compose -f plataforma/docker-compose.yml exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA \
  < plataforma/db/pruebas/reglas-identidad.sql | tee "$VT"/identidad.txt
exige "$VT"/identidad.txt "${PIPESTATUS[0]}" 7 || fallos=$((fallos+1))

paso "2. Migraciones aplicadas = archivos en db/init (cada NN-*.sql debe estar reflejado en la base)"
# 02: índice por regla · 03: zona_horaria · 04: iso_utc · 05: convenciones (disparadores actualizado_en, pm2_5) · 06: índice único de medicion · 07: CHECK de cuarentena.motivo · 08: medicion.recibido_en y origen_tiempo · 09: trama y cuarentena como hypertables · 10: semántica de intervalo_esperado_s · 11: vía, pasarela, estado_dispositivo y sitio.codigo · 12: nombre ck_cuarentena_motivo
docker compose -f plataforma/docker-compose.yml exec -T timescaledb psql -U plataforma -d plataforma -tA <<'SQL' | tee "$VT"/mig.txt
SELECT CASE WHEN count(*)=1 THEN 'OK    01 medicion es hypertable (chunks por tiempo)' ELSE 'FALLA 01 medicion no es hypertable' END FROM timescaledb_information.hypertables WHERE hypertable_name='medicion';
SELECT CASE WHEN indexdef LIKE '%COALESCE(regla_id%' THEN 'OK    02 condicion_abierta_unica por regla' ELSE 'FALLA 02 indice viejo' END FROM pg_indexes WHERE indexname='condicion_abierta_unica';
SELECT CASE WHEN count(*)=1 THEN 'OK    03 sitio.zona_horaria' ELSE 'FALLA 03 falta sitio.zona_horaria' END FROM information_schema.columns WHERE table_name='sitio' AND column_name='zona_horaria';
SELECT CASE WHEN count(*)=1 THEN 'OK    04 función iso_utc' ELSE 'FALLA 04 falta iso_utc' END FROM pg_proc WHERE proname='iso_utc'; -- cspell:disable-line
SELECT CASE WHEN count(*)=1 THEN 'OK    06 uq_medicion_canal_tiempo (idempotencia)' ELSE 'FALLA 06 falta el índice único de medición' END FROM pg_indexes WHERE tablename='medicion' AND indexname='uq_medicion_canal_tiempo' AND indexdef LIKE 'CREATE UNIQUE%'; -- cspell:disable-line
SELECT CASE WHEN count(*)>=9 AND (SELECT count(*) FROM magnitud WHERE codigo IN ('pm2_5','pm10'))=2 THEN 'OK    05 convenciones: '||count(*)||' disparadores actualizado_en y pm2_5/pm10' ELSE 'FALLA 05 convenciones incompletas' END FROM pg_trigger WHERE tgname LIKE 'trg_%_actualizado_en';
SELECT CASE WHEN count(*)=1 THEN 'OK    07 cuarentena.motivo con CHECK (dominio cerrado)' ELSE 'FALLA 07 falta el CHECK de cuarentena.motivo' END FROM pg_constraint WHERE conname IN ('cuarentena_motivo_chk','ck_cuarentena_motivo') AND contype='c' AND conrelid='cuarentena'::regclass; -- desde la 09 es hypertable: cada fragmento lleva su copia
SELECT CASE WHEN count(*)=2 AND (SELECT count(*) FROM pg_constraint WHERE conname='ck_medicion_recepcion' AND conrelid='medicion'::regclass)=1 THEN 'OK    08 medicion.recibido_en y origen_tiempo con su CHECK' ELSE 'FALLA 08 falta la hora de recepción en medicion' END FROM information_schema.columns WHERE table_name='medicion' AND column_name IN ('recibido_en','origen_tiempo');
SELECT CASE WHEN count(*)=2 AND (SELECT count(*) FROM information_schema.columns WHERE table_name='cuarentena' AND column_name IN ('detalle','dispositivo_id'))=2 AND (SELECT pg_get_constraintdef(oid) LIKE '%no_registrado%dado_de_baja%' FROM pg_constraint WHERE conname IN ('cuarentena_motivo_chk','ck_cuarentena_motivo') AND conrelid='cuarentena'::regclass) THEN 'OK    09 trama y cuarentena son hypertables; cuarentena con detalle, dispositivo_id y motivos no_registrado/dado_de_baja' ELSE 'FALLA 09 trama/cuarentena incompletas' END FROM timescaledb_information.hypertables WHERE hypertable_name IN ('trama','cuarentena');
SELECT CASE WHEN col_description('dispositivo'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid='dispositivo'::regclass AND attname='intervalo_esperado_s')) LIKE 'Silencio máximo normal%' THEN 'OK    10 intervalo_esperado_s documentado como silencio máximo normal (docs/10 §8.4 punto 23)' ELSE 'FALLA 10 falta el COMMENT de intervalo_esperado_s (aplicar db/init/10-intervalo-esperado.sql)' END;
SELECT CASE WHEN (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('pasarela','estado_dispositivo'))=2 AND (SELECT count(*) FROM information_schema.columns WHERE table_name='dispositivo' AND column_name IN ('via','formato','pasarela_id'))=3 AND (NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispositivo' AND column_name='visto_por_ultima_vez') OR col_description('dispositivo'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid='dispositivo'::regclass AND attname='visto_por_ultima_vez')) LIKE 'DEPRECADA%') AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_sitio_codigo') AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_pasarela_id_fisico_unico') THEN 'OK    11 vía, formato y pasarela; estado_dispositivo; sitio.codigo; identificador único entre dispositivo y pasarela' ELSE 'FALLA 11 falta la migración de vía, pasarela y estado (db/init/11-via-pasarela-estado.sql)' END;
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_cuarentena_motivo' AND conrelid='cuarentena'::regclass) AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cuarentena_motivo_chk') THEN 'OK    12 ck_cuarentena_motivo: el CHECK de motivos con el nombre de la convención' ELSE 'FALLA 12 falta renombrar cuarentena_motivo_chk (db/init/12-convenciones-cuarentena.sql)' END;
SQL
exige "$VT"/mig.txt "${PIPESTATUS[0]}" 12 || fallos=$((fallos+1))
# Toda migración en disco debe tener su comprobación arriba: una 08 nueva sin comprobación falla aquí,
# no solo por el conteo en prosa del paso 2g.
sin_chequeo=$(ls plataforma/db/init/ | grep -oE '^[0-9]{2}' | while read -r nn; do grep -q "^OK    $nn \|^FALLA $nn " "$VT"/mig.txt || echo "$nn"; done)
[ -z "$sin_chequeo" ] || { echo "FALLA migraciones sin comprobación en este paso: $sin_chequeo"; fallos=$((fallos+1)); }

paso "2b. Número de entidades: la base manda; informe y estado deben decir el mismo número"
n=$(docker compose -f plataforma/docker-compose.yml exec -T timescaledb psql -U plataforma -d plataforma -tA -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
# Sin número no hay comparación: antes, con n vacío, «\b entidades» calzaba con cualquier número.
[[ "$n" =~ ^[0-9]+$ ]] || { echo "FALLA no se pudo contar las tablas en la base (¿base inalcanzable?)"; fallos=$((fallos+1)); n=NINGUNO; }
for f in informe-oficial/cap-diseno.tex informe-oficial/anexos/e-seguimiento.tex docs/12-estado-etapa2.md docs/08-modelo-datos.md; do
  if grep -qE "[0-9]+ entidades" "$f"; then
    if grep -qE "\b$n entidades" "$f" && ! grep -E "[0-9]+ entidades" "$f" | grep -vqE "\b$n entidades"; then echo "OK    $f dice $n entidades"; else echo "FALLA $f no dice $n entidades: $(grep -oE '[0-9]+ entidades' "$f" | sort -u | tr '\n' ' ')"; fallos=$((fallos+1)); fi
  fi
done

paso "2c. Términos vetados por el profesor guía: cero apariciones en docs e informe"
if grep -rniE "ingesta|heterog[eé]ne" docs/ informe-oficial/*.tex informe-oficial/anexos/*.tex PLAN-MAESTRO.md 2>/dev/null | grep -v "sin «heterogéneo» ni «ingesta»" | grep -q .; then # cspell:disable-line
  echo "FALLA aparecen términos vetados:"; grep -rniE "ingesta|heterog[eé]ne" docs/ informe-oficial/*.tex informe-oficial/anexos/*.tex PLAN-MAESTRO.md 2>/dev/null | grep -v "sin «heterogéneo» ni «ingesta»" | cut -c1-120 # cspell:disable-line
  fallos=$((fallos+1))
else echo "OK    sin «ingesta» ni «heterogéneo»"; fi

paso "2d. Variables de entorno: toda variable que lee el backend está declarada en plataforma/.env.example (docs/11 §7)"
# Cualquier objeto (config, cfg, this.config) y cualquier comilla: el 27/09 `cfg.get("X")` pasaba sin verse.
leidas=$(grep -rhoE "(\.get(OrThrow)?(<[^>]+>)?\(\s*['\"\`]|process\.env\.)[A-Z_]+" plataforma/backend/src --include=*.ts | grep -v spec | grep -oE "[A-Z_]{3,}$" | grep -vx TZ | sort -u)
declaradas=$(grep -oE "^#?[A-Z_]+=" plataforma/.env.example | tr -d '#=' | sort -u)
faltan=$(comm -23 <(echo "$leidas") <(echo "$declaradas"))
if [ "$(echo "$leidas" | grep -c .)" -lt 10 ]; then
  echo "FALLA el patrón encontró solo $(echo "$leidas" | grep -c .) variables en el código (se esperan ≥ 10): revisó de menos"; fallos=$((fallos+1))
elif [ -n "$faltan" ]; then
  echo "FALLA variables leídas por el código sin declarar en .env.example:"; echo "$faltan" | sed 's/^/  /'
  fallos=$((fallos+1))
else echo "OK    $(echo "$leidas" | wc -l) variables leídas, todas declaradas en .env.example"; fi

paso "2e. Orden de los filtros: la figura TikZ del cap. 3 y docs/06 dicen 5 alertar / 6 supervisar (docs/10 §8.2)"
if grep -q "5/{alertar}" informe-oficial/figuras/pipeline.tex && grep -q "6/{supervisar}" informe-oficial/figuras/pipeline.tex \
   && grep -qE "^\s*5 alertar" docs/06-evaluacion-comunicacion.md && grep -qE "^\s*6 supervisar" docs/06-evaluacion-comunicacion.md \
   && grep -q "participant F5 as 5 Alertar" docs/10-arquitectura.md && grep -q "participant F6 as 6 Supervisar" docs/10-arquitectura.md; then
  echo "OK    5 alertar / 6 supervisar en pipeline.tex, docs/06 y docs/10"
else
  echo "FALLA el orden de los filtros 5/6 difiere entre pipeline.tex, docs/06 y docs/10"; fallos=$((fallos+1))
fi

paso "2f. Repositorio público: ningún archivo versionado o nuevo contiene términos de la lista privada"
# Los términos viven fuera del repositorio (PATRONES_VETADOS), como los nombres del paso 2j: escritos aquí serían ellos
# mismos la fuga (08/10). git grep --untracked revisa versionados y nuevos sin romperse con espacios o comillas en los
# nombres; salida 1 = sin coincidencias; cualquier otra distinta de 0 es un error y falla: un paso que no revisó no pasa.
# La lista se normaliza antes de usarla (08/10): con finales de línea de Windows o espacios al final ningún patrón calzaba y
# el paso daba OK sin revisar; fuera las líneas vacías y los comentarios, y se exige un mínimo. Si git falla, su mensaje no
# se muestra: podría citar un término de la lista.
PV="${PATRONES_VETADOS:-privado/patrones-vetados.txt}"
lista() { tr -d '\r' < "$1" | sed 's/[[:space:]]*$//' | grep -v -e '^$' -e '^#' > "$2"; wc -l < "$2"; }
n=$(archivos_repo 2>/dev/null | grep -vc '^historico/')
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1 || [ "${n:-0}" -lt 50 ]; then echo "FALLA no se pudieron listar los archivos del repositorio (${n:-0}): ¿git falló?"; fallos=$((fallos+1))
elif [ ! -s "$PV" ]; then echo "omitido: no existe la lista privada de términos"; omitidos="$omitidos 2f"
elif [ "$(lista "$PV" "$VT"/2f-lista.txt)" -lt 3 ]; then echo "FALLA la lista privada de términos tiene menos de 3 patrones útiles: no revisaría nada"; fallos=$((fallos+1))
else
  git grep --untracked -lniE -f "$VT"/2f-lista.txt -- ':!historico' > "$VT"/2f.txt 2>/dev/null; rc=$?
  if [ "$rc" -eq 0 ]; then echo "FALLA archivos con términos de la lista privada:"; sed 's/^/  /' "$VT"/2f.txt; fallos=$((fallos+1))
  elif [ "$rc" -ne 1 ]; then echo "FALLA git grep falló (salida $rc; su mensaje no se muestra porque podría citar la lista)"; fallos=$((fallos+1))
  else echo "OK    ningún término de la lista privada ($(wc -l < "$VT"/2f-lista.txt) patrones) en $n archivos versionados o nuevos"; fi
fi

paso "2g. Migraciones citadas en prosa (docs e informe) == archivos NN-*.sql en disco"
# Hallazgo del 26/09: informe y docs/12 decían «6 migraciones» cuando ya había 7 en disco (la 07 del 23/09).
n_disco=$(ls plataforma/db/init/*.sql | wc -l)
citadas=$(grep -rhoE '[0-9]+ migraciones' docs informe-oficial --include=*.md --include=*.tex | grep -oE '^[0-9]+' | sort -u)
if [ "$citadas" = "$n_disco" ]; then
  echo "OK    $n_disco migraciones en disco, todas las menciones en prosa dicen $n_disco"
else
  echo "FALLA disco tiene $n_disco migraciones; prosa dice: $(echo "$citadas" | tr '\n' ' ')"
  fallos=$((fallos+1))
fi

paso "2h. Rutas HTTP citadas en prosa (glosario, docs/10, docs/12, docs/15) == rutas reales del OpenAPI"
# Hallazgo del 26/09: el glosario citaba GET /mediciones, ruta que nunca existió en el backend.
rutas_reales=$(jq -r '.paths|keys[]' plataforma/backend/openapi.json | sed -E 's/\{[^}]*\}/{p}/g' | sort -u)
# Las figuras (.mmd, fuente en docs/10) también citan rutas y antes no se revisaban (27/09). Se compara la RUTA,
# no los parámetros de consulta (`?bucket=15m` en vez de `intervalo` pasó y se vio leyendo la figura). Una ruta
# marcada «(Etapa 3)», «(Etapa 4)» o «Propuesta» en la misma línea está diseñada, no implementada: se acepta (docs/19 cita
# así las rutas que el panel necesitará). 12/10: una ruta que termina en parámetro (`/x/{id}`) perdía la llave final al
# quitar la `}` de un \texttt{…} y fallaba siempre; ahora el parámetro se protege antes de limpiar el final.
rutas_citadas=$(grep -rhE '(GET|POST|PUT|PATCH|DELETE) /[a-zA-Z0-9_{}/.\\-]*' informe-oficial docs --include=*.tex --include=*.md --include=*.mmd \
  | grep -vE '\(Etapa [34]\)|Propuesta' | grep -oE '(GET|POST|PUT|PATCH|DELETE) /[a-zA-Z0-9_{}/.\\-]*' \
  | sed -E 's/^(GET|POST|PUT|PATCH|DELETE) //; s/\\\{/{/g; s/\\\}/}/g; s/\{[^}]*\}/@P@/g; s/[.,}]+$//; s/@P@/{p}/g' \
  | sort -u)
faltan=$(comm -23 <(echo "$rutas_citadas") <(echo "$rutas_reales"))
if [ -n "$faltan" ]; then
  echo "FALLA rutas citadas que no existen en el OpenAPI:"; echo "$faltan" | sed 's/^/  /'
  fallos=$((fallos+1))
else
  echo "OK    $(echo "$rutas_citadas" | grep -c .) rutas citadas en docs e informe, todas existen en el OpenAPI"
fi

paso "2i. Dueños de la configuración del broker: acl y mosquitto.conf del operador; passwd de uid 1883 y modo 640 (docs/11 §7)"
# Hallazgo del 27/09: un contenedor auxiliar montado en /mosquitto disparó el chown -R de la imagen y
# cambió el dueño de acl y mosquitto.conf. Solo se leen metadatos (stat), nunca el contenido de passwd.
MC="${MOSQ_CONF:-plataforma/mosquitto/config}"; yo=$(id -u); mal=""
for f in "$MC" "$MC/acl" "$MC/mosquitto.conf"; do [ "$(stat -c %u "$f")" = "$yo" ] || mal="$mal $f(dueño $(stat -c %u "$f"))"; done
[ "$(stat -c '%u %a' "$MC/passwd" 2>/dev/null)" = "1883 640" ] || mal="$mal passwd($(stat -c '%u %a' "$MC/passwd" 2>/dev/null || echo 'no existe'))"
if [ -z "$mal" ]; then echo "OK    carpeta, acl y mosquitto.conf del operador; passwd de 1883 con modo 640"
else echo "FALLA dueños o modos alterados:$mal (restituir: sudo chown \$USER:\$USER; passwd con clave-dispositivo.sh)"; fallos=$((fallos+1)); fi

paso "2j. Repositorio público: ningún archivo versionado nombra a personas de la lista privada"
# La lista vive fuera del repo (NOMBRES_VETADOS; un nombre en este script sería la fuga). Una línea por nombre; palabra
# completa, sin distinguir mayúsculas. Si el archivo no existe, el paso se omite y lo dice. Se normaliza como la de 2f.
NV="${NOMBRES_VETADOS:-privado/nombres-vetados.txt}"
if [ ! -s "$NV" ]; then echo "omitido: no existe la lista privada de nombres"; omitidos="$omitidos 2j"
elif [ "$(lista "$NV" "$VT"/2j-lista.txt)" -lt 1 ]; then echo "FALLA la lista privada de nombres no tiene ningún nombre útil: no revisaría nada"; fallos=$((fallos+1))
else
  git grep --untracked -lniwF -f "$VT"/2j-lista.txt -- ':!historico' > "$VT"/2j.txt 2>/dev/null; rc=$?
  n=$(archivos_repo 2>/dev/null | grep -vc '^historico/')
  if [ "$rc" -eq 0 ]; then echo "FALLA archivos con nombres de la lista privada:"; sed 's/^/  /' "$VT"/2j.txt; fallos=$((fallos+1))
  elif [ "$rc" -ne 1 ] || [ "${n:-0}" -lt 50 ]; then echo "FALLA no se pudo revisar (git grep salió $rc; ${n:-0} archivos)"; fallos=$((fallos+1))
  else echo "OK    ningún nombre de la lista privada ($(wc -l < "$VT"/2j-lista.txt)) en $n archivos versionados o nuevos"; fi
fi

paso "2k. Edición Apache de TimescaleDB (RNF-15; docs/10 §8.4 punto 11): licencia, imagen, sin compresión, sin jobs ni telemetría"
# La licencia se lee en la base que corre, no se supone por el compose; y el compose se revisa aparte, porque
# la imagen completa también puede arrancar con la licencia apache configurada y seguiría sin ser la -oss.
docker compose -f plataforma/docker-compose.yml exec -T timescaledb psql -U plataforma -d plataforma -tA <<'SQL' | tee "$VT"/lic.txt
SELECT CASE WHEN current_setting('timescaledb.license')='apache' THEN 'OK    timescaledb.license = apache' ELSE 'FALLA timescaledb.license = '||current_setting('timescaledb.license')||' (Timescale License): usar la imagen -oss' END;
SELECT CASE WHEN count(*)=0 THEN 'OK    ninguna hypertable con compresión' ELSE 'FALLA '||count(*)||' hypertable(s) con compresión (Timescale License)' END FROM timescaledb_information.hypertables WHERE compression_enabled;
SELECT CASE WHEN current_setting('timescaledb.max_background_workers')='0' THEN 'OK    sin trabajos de fondo (el job 3 fallaría con ERROR de licencia cada 6 h)' ELSE 'FALLA timescaledb.max_background_workers = '||current_setting('timescaledb.max_background_workers')||': falta el command del compose' END;
SELECT CASE WHEN current_setting('timescaledb.telemetry_level')='off' THEN 'OK    telemetría apagada: nada sale del servidor hacia Timescale' ELSE 'FALLA timescaledb.telemetry_level = '||current_setting('timescaledb.telemetry_level') END;
SQL
exige "$VT"/lic.txt "${PIPESTATUS[0]}" 4 || fallos=$((fallos+1))
# 08/10: la imagen se construye desde db/imagen/Dockerfile (oficial fijada + parches, docs/11 §4): se revisa su FROM y que
# el compose la use.
img=$(grep -oE '^FROM timescale/timescaledb:[^ ]+' plataforma/db/imagen/Dockerfile | cut -d' ' -f2); img=${img%%@*}   # sin el digest
if [[ $img != *-oss ]]; then echo "FALLA db/imagen/Dockerfile parte de ${img:-ninguna imagen de TimescaleDB}: debe terminar en -oss"; fallos=$((fallos+1))
elif ! grep -qE '^[[:space:]]+build: \./db/imagen([[:space:]]|$)' plataforma/docker-compose.yml; then echo "FALLA el compose no construye la base desde db/imagen"; fallos=$((fallos+1))
else echo "OK    la base parte de $img (db/imagen/Dockerfile) y el compose la construye desde ahí"; fi
# 08/10: al cambiar la versión de la imagen, la extensión de una base existente no se actualiza sola (ALTER EXTENSION).
v_img=$(sed -nE 's/^FROM timescale\/timescaledb:([0-9.]+)-.*/\1/p' plataforma/db/imagen/Dockerfile)
v_base=$(docker compose -f plataforma/docker-compose.yml exec -T timescaledb psql -X -U plataforma -d plataforma -tAc "SELECT extversion FROM pg_extension WHERE extname='timescaledb'" 2>/dev/null | tr -d '[:space:]')
if [ -z "$v_base" ]; then echo "FALLA no se pudo leer la versión de la extensión en la base"; fallos=$((fallos+1))
elif [ "$v_base" != "$v_img" ]; then echo "FALLA la base tiene la extensión $v_base y la imagen trae $v_img: falta ALTER EXTENSION timescaledb UPDATE (docs/11 §8)"; fallos=$((fallos+1))
else echo "OK    la extensión de la base ($v_base) es la de la imagen"; fi

paso "2l. Tope de tamaño por mensaje en el broker (docs/11 §4): max_packet_size presente y <= 64 KiB"
# Sin tope, Mosquitto 2.0.22 aceptó 50 MiB (observado el 07/10): un dispositivo con credencial podría llenar el disco.
tope=$(grep -E '^\s*max_packet_size\s+[0-9]+' "$MC/mosquitto.conf" | awk '{print $2}' | tail -1)
if [[ -n "$tope" && "$tope" -le 65536 ]]; then echo "OK    max_packet_size = $tope bytes"
else echo "FALLA max_packet_size ausente o mayor que 65536 (${tope:-ausente}): el broker acepta mensajes de cualquier tamaño"; fallos=$((fallos+1)); fi

paso "2m. Proxy: la plantilla nginx.conf renderizada y válida (nginx -T con la imagen del proxy, base fijada + parches, y los certificados de desarrollo)"
# 07/10: la configuración del proxy se valida sin levantar nada. Si faltan los certificados de desarrollo
# (bash plataforma/proxy/ca-desarrollo.sh) o la imagen no se puede construir, el paso se omite y lo dice: nunca se da por
# bueno sin haberlo revisado. 08/10: la imagen es la oficial fijada más parches de Alpine (proxy/Dockerfile; docs/11 §4).
BASE_PROXY=$(grep -oE '^FROM nginx:[^ ]+' plataforma/proxy/Dockerfile | cut -d' ' -f2)
IMG_PROXY=plataforma-proxy:verificar
CERTS_DEV="$PWD/privado/certs-desarrollo"
SIN_RED='dial tcp|no such host|name resolution|DNS lookup error|i/o timeout|TLS handshake timeout|network is unreachable|temporary error|transient error|try again later|connection (refused|reset)'
if [ -z "$BASE_PROXY" ]; then echo "FALLA proxy/Dockerfile sin imagen base nginx fijada"; fallos=$((fallos+1))
elif [ ! -f "$CERTS_DEV/servidor.crt" ]; then echo "omitido: faltan los certificados de desarrollo (bash plataforma/proxy/ca-desarrollo.sh)"; omitidos="$omitidos 2m"
elif ! docker build -q -t "$IMG_PROXY" plataforma/proxy >"$VT"/build-proxy.txt 2>&1; then
  # 08/10: sin red se omite y lo dice; un Dockerfile roto falla (antes también salía como «¿sin red?» y se omitía).
  red=$(grep -m1 -iE "$SIN_RED" "$VT"/build-proxy.txt)
  if [ -n "$red" ]; then echo "omitido: sin red para construir la imagen del proxy sobre $BASE_PROXY: ${red:0:160}"; omitidos="$omitidos 2m"
  else echo "FALLA no se pudo construir la imagen del proxy sobre $BASE_PROXY:"; tail -3 "$VT"/build-proxy.txt | sed 's/^/  /'; fallos=$((fallos+1)); fi
# 12/10: nginx.conf es una plantilla (PROXY_NOMBRE, docs/11 §3): se monta como la monta el compose y la imagen la renderiza al
# arrancar. Se usa -T (imprime lo que rige) y se comprueba que lo renderizado sea NUESTRA configuración con el nombre puesto:
# si la plantilla no se procesara, nginx -t validaría la configuración de fábrica de la imagen y pasaría igual.
elif docker run --rm -v "$PWD/plataforma/proxy/nginx.conf:/plantilla/nginx.conf.template:ro" -v "$CERTS_DEV:/certs:ro" \
       -e NGINX_ENVSUBST_TEMPLATE_DIR=/plantilla -e NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx -e NGINX_ENVSUBST_FILTER=^PROXY_ \
       -e PROXY_NOMBRE=prueba.example "$IMG_PROXY" nginx -T >"$VT"/nginx.txt 2>&1; then
  if [ "$(grep -c 'server_name prueba.example;' "$VT"/nginx.txt)" = 2 ] && grep -q 'ssl_reject_handshake on;' "$VT"/nginx.txt \
     && grep -q 'proxy_set_header   Host \$http_host;' "$VT"/nginx.txt && ! grep -q '\${PROXY_NOMBRE}' "$VT"/nginx.txt; then
    echo "OK    nginx -T: plantilla renderizada y válida ($BASE_PROXY + parches): server_name en 443 y 80, saludo TLS rechazado para otros nombres"
  else echo "FALLA nginx -T pasó pero lo renderizado no es la plantilla con el nombre puesto (¿se montó en /etc/nginx/nginx.conf?)"; fallos=$((fallos+1)); fi
else echo "FALLA nginx -T:"; grep -E "emerg|nginx:" "$VT"/nginx.txt | sed 's/^/  /'; fallos=$((fallos+1)); fi

paso "2n. Registros acotados y sin escalada de privilegios: cada servicio de cada combinación de compose (docs/11 §3–4)"
# 07/10: sin límite, el chequeo de salud del broker sumaba ≈ 395 MB/año. Se valida el VALOR, no solo la presencia (07/10:
# unas comillas escapadas, `\"10m\"`, dejaron la pila sin arrancar y el conteo decía OK): el daemon exige un tamaño como 10m
# y un entero para max-file. 08/10: también no-new-privileges, que docs/11 §3 daba por puesto en «ambos servicios» cuando
# ya eran cuatro. Se lee la configuración efectiva con `docker compose config`, que entiende sobrescrituras, perfiles y
# nombres con dígitos (un awk no los contaba), y de su salida, que trae el entorno con claves, solo se miran estos campos.
python3 -I - <<'PY' || fallos=$((fallos+1))
import json, re, subprocess, sys
malos, n = [], 0
for juego in (['plataforma/docker-compose.yml', 'plataforma/docker-compose.override.yml', 'plataforma/proxy/compose.proxy.yml'],
              ['plataforma/docker-compose.yml', 'plataforma/pruebas/banco/compose.banco.yml']):
    p = subprocess.run(['docker', 'compose'] + [x for f in juego for x in ('-f', f)] + ['--profile', '*', 'config', '--format', 'json'],
                       capture_output=True, text=True)
    if p.returncode != 0: malos.append(f'docker compose config falló con {" + ".join(juego)} (salida {p.returncode})'); continue
    for s, d in json.loads(p.stdout).get('services', {}).items():
        n += 1
        op = (d.get('logging') or {}).get('options') or {}
        if not (re.fullmatch(r'[0-9]+[kmg]', str(op.get('max-size', ''))) and re.fullmatch(r'[0-9]+', str(op.get('max-file', '')))):
            malos.append(f'{juego[-1]}: servicio {s} sin logging acotado y bien formado (max-size {op.get("max-size")!r}, max-file {op.get("max-file")!r})')
        if 'no-new-privileges:true' not in (d.get('security_opt') or []):
            malos.append(f'{juego[-1]}: servicio {s} sin no-new-privileges:true')
if n < 7: malos.append(f'revisó solo {n} servicios (se esperan >= 7: 4 en la pila con el proxy y 3 en el banco)')
for m in malos: print('FALLA', m)
if not malos: print(f'OK    {n} servicios en las dos combinaciones de compose: todos con logging acotado y no-new-privileges')
sys.exit(1 if malos else 0)
PY

paso "2o. Informe: todo párrafo que nombra ChirpStack lo marca como opcional (ruta A), salvo el de OpenRemote (docs/10 §8.4 punto 2)"
# 07/10: la decisión del 06/10 dejó ChirpStack como opcional, pero el informe seguía diciendo «un contenedor más en la
# plataforma», «cinco contenedores» y «tres puertos». Unidad: el párrafo en capítulos y anexos; el archivo en figuras/.
python3 - <<'PY' || fallos=$((fallos+1))
import pathlib, re, sys
malos, n = [], 0
for f in sorted(pathlib.Path("informe-oficial").glob("**/*.tex")):
    if "build" in f.parts: continue
    n += 1; texto = f.read_text()
    for b in ([texto] if f.parent.name == "figuras" else re.split(r"\n\s*\n", texto)):
        if "ChirpStack" in b and not re.search(r"ruta A|opcional|\(A\)|OpenRemote", b):
            malos.append(f"{f}: «{' '.join(b.split())[:110]}…»")
for m in malos: print("FALLA", m)
if not malos: print(f"OK    {n} archivos .tex: cada mención de ChirpStack lo marca como opcional (ruta A)")
sys.exit(1 if malos else 0)
PY

paso "2p. Repositorio público: ningún archivo versionado cita fichas privadas (viven en privado/, un lector no las abre)"
# 08/10: 19 referencias en 12 archivos apuntaban a fichas de decisión privadas (formato D, guion y dos dígitos). Lo público
# cita lo público: la sección de docs/10 §8.4 o de docs/11 donde quedó la decisión.
git grep --untracked -n -E 'ficha D-[0-9]{2}|decisi[oó]n D-[0-9]{2}|\bD-[0-9]{2}\b' -- ':!privado' > "$VT"/fichas.txt 2>&1; rc=$?
if [ "$rc" -eq 0 ]; then echo "FALLA archivos públicos que citan fichas privadas:"; cut -c1-160 "$VT"/fichas.txt; fallos=$((fallos+1))
elif [ "$rc" -ne 1 ]; then echo "FALLA git grep falló ($rc): no se pudo revisar"; fallos=$((fallos+1))
else echo "OK    ningún archivo versionado cita fichas privadas"; fi

paso "2q. Auditoría de dependencias: cada aviso ignorado (audit.ignore de pnpm-workspace.yaml) sigue sin versión corregida (docs/11 §4)"
# 08/10: braces no tenía parche y la auditoría lo ignora (la leen igual el CI y el portátil). Una excepción que nadie revisa
# queda para siempre: este paso consulta la base de avisos de GitHub y falla el día que el aviso tenga versión corregida.
# Se leen los GHSA fuera de comentarios, así vale con la clave vigente y con el nombre antiguo (`auditConfig.ignoreGhsas`).
WS="${VERIFICAR_WORKSPACE:-plataforma/backend/pnpm-workspace.yaml}"
ign=$(grep -v '^[[:space:]]*#' "$WS" 2>/dev/null | grep -oE 'GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}' | sort -u)
if [ ! -f "$WS" ]; then echo "FALLA no existe $WS: no se pudo revisar la auditoría"; fallos=$((fallos+1))
elif [ -z "$ign" ]; then echo "OK    la auditoría no ignora ningún aviso"
elif ! command -v gh >/dev/null; then echo "omitida: gh no está en el PATH"; omitidos="$omitidos 2q"
else
  for g in $ign; do
    if ! p=$(gh api "/advisories/$g" --jq '[.vulnerabilities[].first_patched_version // empty] | join(", ")' 2>/dev/null); then
      echo "omitida: no se pudo consultar $g (¿sin red?)"; omitidos="$omitidos 2q"
    elif [ -n "$p" ]; then echo "FALLA $g ya tiene versión corregida ($p): actualizar y quitar la excepción de pnpm-workspace.yaml y de docs/11 §4"; fallos=$((fallos+1))
    else echo "AVISO $g sigue sin versión corregida publicada: excepción vigente, pendiente de resolver (no falla)"; fi
  done
fi

paso "2r. RNF-15: dependencias de producción del backend con licencia abierta y permisiva (docs/02, RNF-15)"
# 08/10: una dependencia copyleft (GPL, AGPL) dentro del backend obligaría a distribuir el conjunto bajo una licencia
# compatible con la suya y cerraría la opción de una licencia comercial adicional; las de fuente disponible (SSPL, BUSL) no
# son de código abierto (RNF-15) y una desconocida no se puede evaluar. Esta es la lista exacta: lo demás falla y lo decide
# el estudiante. «A OR B» pasa si una de las dos está en la lista; «A AND B», solo si están las dos (08/10: pako, que trae la
# exportación a XLSX, es «MIT AND Zlib»; Zlib, permisiva, entra a la lista el 08/10); los paréntesis se respetan y una
# excepción (WITH) no se evalúa: la decide él.
PERMITIDAS='["MIT","ISC","Apache-2.0","BSD-2-Clause","BSD-3-Clause","0BSD","Python-2.0","CC0-1.0","Unlicense","BlueOak-1.0.0","Zlib"]'
if ! command -v pnpm >/dev/null || ! command -v jq >/dev/null; then echo "omitida: falta pnpm o jq"; omitidos="$omitidos 2r"
elif ! (cd plataforma/backend && pnpm licenses ls --prod --json 2>/dev/null) > "$VT"/licencias.json \
     || ! jq -e 'type == "object"' "$VT"/licencias.json >/dev/null 2>&1; then
  echo "FALLA pnpm licenses no devolvió un resultado legible (¿node_modules sin instalar?)"; fallos=$((fallos+1))
else
  n=$(jq '[.[] | length] | add // 0' "$VT"/licencias.json)
  # 12/10: el panel es un paquete del mismo workspace y `pnpm licenses` en la raíz ya lista sus dependencias de producción
  # (svelte y las suyas). Se exige verlas: si el panel saliera del workspace, este paso dejaría de cubrirlo en silencio.
  if ! jq -e '[.[][] | .name] | index("svelte")' "$VT"/licencias.json >/dev/null; then
    echo "FALLA el listado de licencias no incluye al panel (svelte): ¿salió del workspace de pnpm?"; fallos=$((fallos+1)); fi
  malas=$(PERMITIDAS="$PERMITIDAS" python3 -I - "$VT"/licencias.json <<'PY'
import json, os, re, sys
def evalua(expr, ok):
    toks, pos = re.findall(r'\(|\)|[^\s()]+', expr), 0
    def prim():
        nonlocal pos
        t = toks[pos]; pos += 1
        if t == '(':
            v = o()
            if toks[pos] != ')': raise ValueError(expr)
            pos += 1; return v
        if pos < len(toks) and toks[pos] == 'WITH': pos += 2; return False
        return t in ok
    def y():
        nonlocal pos
        v = prim()
        while pos < len(toks) and toks[pos] == 'AND': pos += 1; r = prim(); v = v and r
        return v
    def o():
        nonlocal pos
        v = y()
        while pos < len(toks) and toks[pos] == 'OR': pos += 1; r = y(); v = v or r
        return v
    try:
        v = o(); return v and pos == len(toks)
    except (IndexError, ValueError): return False
# El evaluador se prueba en cada corrida: si se rompe, el paso falla en vez de aprobarlo todo.
casos = {'MIT': True, '(MIT OR GPL-3.0-or-later)': True, '(MIT AND Zlib)': False, '(MIT OR Apache-2.0) AND Zlib': False,
         'MIT AND (Apache-2.0 OR GPL-3.0-only)': True, 'GPL-2.0-only WITH Classpath-exception-2.0': False, '(MIT': False}
mal = [c for c, e in casos.items() if evalua(c, {'MIT', 'Apache-2.0'}) != e]
if mal: print('autoprueba:', ' · '.join(mal)); sys.exit(2)
ok = set(json.loads(os.environ['PERMITIDAS']))
for lic, paquetes in json.load(open(sys.argv[1], encoding='utf-8')).items():
    if not evalua(lic, ok):
        for p in paquetes: print(f"{p['name']}@{','.join(p['versions'])} → {lic}")
PY
); rc=$?
  if [ "$rc" -ne 0 ]; then echo "FALLA el evaluador de licencias no corrió o no pasó su autoprueba (salida $rc): $malas"; fallos=$((fallos+1))
  elif [ "$n" -lt 50 ]; then echo "FALLA revisó solo $n paquetes de producción (se esperan >= 50)"; fallos=$((fallos+1))
  elif [ -n "$malas" ]; then echo "FALLA dependencias de producción con licencia fuera de la lista:"; sed 's/^/  /' <<<"$malas"; fallos=$((fallos+1))
  else echo "OK    $n paquetes de producción con licencia permitida ($(jq -r 'to_entries | map("\(.key) \(.value | length)") | join(", ")' "$VT"/licencias.json))"; fi
fi

paso "2s. Requerimientos: el anexo A del informe dice lo mismo que docs/02 (cada RF y RNF, todas sus columnas, sin repetidos)"
# 08/10: RF-02, RNF-16 y RNF-17 habían cambiado en docs/02 y no en el anexo. Manda
# docs/02; se compara cada columna de cada requisito sin el formato (Markdown o LaTeX). 08/10: también las columnas que no
# son la descripción, y un identificador repetido falla (antes el segundo pisaba al primero en silencio).
python3 -I - <<'PY' || fallos=$((fallos+1))
import re, sys, unicodedata
def norm(s):
    s = s.replace('$\\geq$', '≥').replace('$\\leq$', '≤').replace('---', '—').replace('--', '–')
    s = re.sub(r'\\(textbf|emph|texttt|textit|mbox)\{([^{}]*)\}', r'\2', s)
    s = s.replace('\\,', ' ').replace('~', ' ').replace('\\%', '%').replace('\\&', '&').replace('\\_', '_')
    s = re.sub(r'\\[a-zA-Z]+\{?|[{}$]', '', s)
    s = s.replace('**', '').replace('`', '').replace('*', '')
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', s)).strip().rstrip('.').lower()
def leer(ruta, patron, sep):
    d, rep = {}, []
    for l in open(ruta, encoding='utf-8'):
        m = re.match(patron, l)
        if m:
            if m.group(1) in d: rep.append(m.group(1))
            d[m.group(1)] = [c.strip() for c in re.split(sep, m.group(2))]
    return d, rep
md, rmd = leer('docs/02-requerimientos.md', r'\|\s*\*\*((?:RF|RNF)-\d+)\*\*\s*\|(.*)\|\s*$', r'\|')
tx, rtx = leer('informe-oficial/anexos/a-requerimientos.tex', r'\s*\\textbf\{((?:RF|RNF)-\d+)\}\s*&(.*?)\\\\\s*$', r'(?<!\\)&')
if len(md) < 60: print(f'FALLA revisó solo {len(md)} requisitos de docs/02 (se esperan >= 60)'); sys.exit(1)
malos = [f'{k}: aparece repetido en docs/02' for k in rmd] + [f'{k}: aparece repetido en el anexo A' for k in rtx]
malos += [f'{k}: está solo en {"docs/02" if k in md else "el anexo A"}' for k in sorted(set(md) ^ set(tx))]
for k in sorted(set(md) & set(tx)):
    if len(md[k]) != len(tx[k]): malos.append(f'{k}: {len(md[k])} columnas en docs/02 y {len(tx[k])} en el anexo A'); continue
    malos += [f'{k}: la columna {i} difiere · docs/02: «{a[:70]}» · anexo A: «{b[:70]}»'
              for i, (a, b) in enumerate(zip(md[k], tx[k]), 2) if norm(a) != norm(b)]
for m in malos: print('FALLA', m)
if not malos: print(f'OK    {len(md)} requisitos: el anexo A dice lo mismo que docs/02')
sys.exit(1 if malos else 0)
PY

paso "2t. Pruebas unitarias: la cifra citada en docs e informe es la que existe (it( en los *.spec.ts)"
# 08/10: la misma cifra decía 49, 70 y 78 en distintos documentos. Se cuentan los it( y se compara con cada «N pruebas
# unitarias» de docs/ (salvo docs/12, el estado fechado de la Etapa 2) y del informe.
real=$(grep -rhoE '^[[:space:]]*it\(' plataforma/backend/src --include='*.spec.ts' | wc -l)
citas=$(grep -rnoE '[0-9]+ pruebas unitarias' docs/*.md informe-oficial/*.tex informe-oficial/anexos/*.tex 2>/dev/null | grep -v '^docs/12-')
malas=$(awk -F: -v r="$real" 'NF { split($3, a, " "); if (a[1] != r) print }' <<<"$citas")
if [ "$real" -lt 10 ]; then echo "FALLA contó solo $real pruebas (it( en los *.spec.ts)"; fallos=$((fallos+1))
elif [ -z "$citas" ]; then echo "FALLA ninguna cita «N pruebas unitarias» en docs ni en el informe: ¿cambió la redacción? (no revisó nada)"; fallos=$((fallos+1))
elif [ -n "$malas" ]; then echo "FALLA cifras de pruebas unitarias distintas de $real:"; sed 's/^/  /' <<<"$malas"; fallos=$((fallos+1))
else echo "OK    $real pruebas unitarias; $(grep -c . <<<"$citas") cita(s) en docs e informe coinciden"; fi
# 09/10: también la cifra por archivo («N pruebas en `eventos.spec.ts`»), que citan docs/11 y docs/16 y nadie recontaba.
python3 -I - <<'PY' || fallos=$((fallos+1))
import re, sys, pathlib
citas = []
for f in sorted(pathlib.Path('docs').glob('*.md')) + sorted(pathlib.Path('informe-oficial').glob('*.tex')):
    if f.name.startswith('12-'): continue
    for n, linea in enumerate(f.read_text(encoding='utf-8').splitlines(), 1):
        citas += [(f'{f}:{n}', int(m.group(1)), m.group(2)) for m in re.finditer(r'(\d+) pruebas en `([\w.-]+\.spec\.ts)`', linea)]
malos = []
for donde, dice, archivo in citas:
    rutas = list(pathlib.Path('plataforma/backend/src').rglob(archivo))
    hay = sum(len(re.findall(r'^\s*it\(', r.read_text(encoding='utf-8'), re.M)) for r in rutas)
    if len(rutas) != 1 or hay != dice: malos.append(f'{donde}: dice {dice} en {archivo}; hay {hay} ({len(rutas)} archivo(s))')
for m in malos: print('FALLA', m)
if not malos: print(f'OK    {len(citas)} cita(s) «N pruebas en archivo.spec.ts» coinciden con sus it(')
sys.exit(1 if malos else 0)
PY

paso "2u. Imágenes fijadas por digest: cada FROM, cada imagen de registro de los compose y las que usan guiones y ejemplos (docs/11 §4)"
# 08/10: una etiqueta puede cambiar de contenido con el mismo nombre (pasó con mosquitto). El digest fija la base; la capa
# de parches (apk upgrade) se resuelve al construir, por eso se escanea lo construido y se despliega eso mismo (docs/11 §8).
# Las imágenes del compose salen de `docker compose config`, que resuelve comillas, variables y la unión de archivos (antes
# un grep daba OK con una imagen entre comillas, sin etiqueta o con variable, y miraba un solo archivo); de esa salida solo
# se leen los nombres de imagen. Guiones (.sh, .yml) y bloques de código de los .md: patrón nombre:versión sin digest.
# Dependabot (.github/dependabot.yml) propone las versiones nuevas como pull request.
python3 -I - <<'PY' || fallos=$((fallos+1))
import json, re, subprocess, sys
dig = re.compile(r'@sha256:[0-9a-f]{64}$')
arch = [a for a in subprocess.run(['git', 'ls-files', '--cached', '--others', '--exclude-standard'], capture_output=True,
        text=True).stdout.split('\n') if a and not a.startswith('historico/')]
if len(arch) < 50: print(f'FALLA no se pudieron listar los archivos del repositorio ({len(arch)}): ¿git falló?'); sys.exit(1)
malos, n_from, n_reg, n_arch = [], 0, 0, 0
# 1. FROM de cada Dockerfile; una etapa anterior del mismo archivo (FROM build) o scratch no es una imagen que bajar.
for f in [a for a in arch if re.search(r'(^|/)Dockerfile[^/]*$', a)]:
    etapas = set()
    for n, l in enumerate(open(f, encoding='utf-8'), 1):
        c = re.match(r'\s*COPY\s+(?:--\S+\s+)*?--from=(\S+)', l, re.I)   # COPY --from=imagen:versión también baja una imagen
        if c and c.group(1).lower() not in etapas and not c.group(1).isdigit() and not dig.search(c.group(1)):
            malos.append(f'{f}:{n}: COPY --from={c.group(1)}')
        m = re.match(r'\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?', l, re.I)
        if not m: continue
        n_from += 1
        if m.group(1).lower() not in etapas and m.group(1) != 'scratch' and not dig.search(m.group(1)):
            malos.append(f'{f}:{n}: FROM {m.group(1)}')
        if m.group(2): etapas.add(m.group(2).lower())
# 2. Imágenes de registro de cada combinación de compose que se usa; las que tienen build se revisan por su FROM.
for juego in (['plataforma/docker-compose.yml', 'plataforma/docker-compose.override.yml', 'plataforma/proxy/compose.proxy.yml'],
              ['plataforma/docker-compose.yml', 'plataforma/pruebas/banco/compose.banco.yml']):
    p = subprocess.run(['docker', 'compose'] + [x for f in juego for x in ('-f', f)] + ['--profile', '*', 'config', '--format', 'json'],
                       capture_output=True, text=True)
    if p.returncode != 0:
        malos.append(f'docker compose config falló con {" + ".join(juego)} (salida {p.returncode})')
        continue
    for s, d in json.loads(p.stdout).get('services', {}).items():
        if d.get('build'): continue
        n_reg += 1
        if not dig.search(d.get('image') or ''): malos.append(f'{" + ".join(juego)}: servicio {s}, imagen {d.get("image") or "(ninguna)"}')
# 3. nombre:versión sin digest en guiones y en bloques de código (sin comentarios; las construidas aquí, plataforma-*, no).
# Versión con punto (2.0.22), con sufijo (16-alpine) o una etiqueta con nombre conocida (latest, stable, alpine…);
# «4.0f» de un printf o «127.0.0.1:3000» no son imágenes. Una imagen sin etiqueta en un `docker run` no se detecta: se lee.
pat = re.compile(r'(?<![\w./@:$-])([a-z0-9][a-z0-9._-]*(?:/[a-z0-9._-]+)*):([0-9]+(?:(?:\.[0-9]+)+(?:-[A-Za-z0-9._-]+)?'
                 r'|-[A-Za-z][A-Za-z0-9._-]*)|latest|edge|stable|mainline|alpine|slim|lts)(?![A-Za-z0-9._-])(?!@sha256:[0-9a-f]{64})')
for f in arch:
    es_md = f.endswith('.md')
    if not (es_md or re.search(r'\.(sh|ya?ml)$', f)): continue
    n_arch += 1; codigo = False
    for n, l in enumerate(open(f, encoding='utf-8', errors='replace'), 1):
        if es_md and l.lstrip().startswith('```'): codigo = not codigo; continue
        if (es_md and not codigo) or l.lstrip().startswith('#'): continue
        for m in pat.finditer(re.sub(r'\s#.*$', '', l)):
            if not m.group(1).startswith('plataforma-'): malos.append(f'{f}:{n}: {m.group(0)}')
if n_from < 4 or n_reg < 1 or n_arch < 20:
    malos.append(f'revisó de menos: {n_from} FROM (>= 4), {n_reg} imágenes de registro (>= 1), {n_arch} archivos (>= 20)')
for m in malos: print('FALLA', m)
if not malos: print(f'OK    {n_from} FROM, {n_reg} imágenes de registro de los compose y {n_arch} guiones y documentos: todo fijado por digest')
sys.exit(1 if malos else 0)
PY

paso "2v. Backlog: el anexo B del informe tiene las mismas historias y tareas que docs/04, con la misma prioridad, etapa y horas"
# 08/10: TT-39 decía «WebSocket o SSE» en docs/04 y SSE en el anexo. La descripción del anexo es un resumen a propósito y se
# revisa leyendo; lo que no puede diferir son las tareas y sus números. Manda docs/04.
python3 -I - <<'PY' || fallos=$((fallos+1))
import re, sys
def leer(ruta, patron, sep):
    d, rep = {}, []
    for l in open(ruta, encoding='utf-8'):
        m = re.match(patron, l)
        if m:
            if m.group(1) in d: rep.append(m.group(1))
            d[m.group(1)] = [re.sub(r'\*\*|\\textbf\{|\}', '', c).replace('--', '–').strip() for c in re.split(sep, m.group(2))]
    return d, rep
md, rmd = leer('docs/04-backlog.md', r'\|\s*\*\*((?:HU|TT)-\d+)\*\*\s*\|(.*)\|\s*$', r'\|')
tx, rtx = leer('informe-oficial/anexos/b-backlog.tex', r'\s*\\textbf\{((?:HU|TT)-\d+)\}\s*&(.*?)\\\\\s*$', r'(?<!\\)&')
if len(md) < 60: print(f'FALLA revisó solo {len(md)} elementos de docs/04 (se esperan >= 60)'); sys.exit(1)
malos = [f'{k}: aparece repetida en docs/04' for k in rmd] + [f'{k}: aparece repetida en el anexo B' for k in rtx]
malos += [f'{k}: está solo en {"docs/04" if k in md else "el anexo B"}' for k in sorted(set(md) ^ set(tx))]
malos += [f'{k}: prioridad · etapa · horas difieren: docs/04 {" · ".join(md[k][-3:])}; anexo B {" · ".join(tx[k][-3:])}'
          for k in sorted(set(md) & set(tx), key=lambda x: int(x[3:])) if md[k][-3:] != tx[k][-3:]]
for m in malos: print('FALLA', m)
if not malos: print(f'OK    {len(md)} historias y tareas: el anexo B tiene las mismas, con la misma prioridad, etapa y horas que docs/04')
sys.exit(1 if malos else 0)
PY

paso "2w. Estado de la Etapa 3 (docs/18 §2): sus tareas son las de etapa 3 en docs/04, con sus horas, y los totales salen de las filas"
# 09/10: las sumas de hechos, parciales y pendientes se escribían a mano (docs/18 §5 pedía no hacerlo) y nadie las recalculaba.
python3 -I - <<'PY' || fallos=$((fallos+1))
import re, sys
md = {}
for l in open('docs/04-backlog.md', encoding='utf-8'):
    m = re.match(r'\|\s*\*\*((?:HU|TT)-\d+)\*\*\s*\|(.*)\|\s*$', l)
    if m:
        c = [x.replace('**', '').strip() for x in m.group(2).split('|')]
        md[m.group(1)] = (c[-2], c[-1])  # etapa, horas
t = open('docs/18-estado-etapa3.md', encoding='utf-8').read()
sec = re.search(r'^## 2\. Tareas de la Etapa 3: (\d+) elementos, (\d+) h.*?$(.*?)^\*\*Pasadas', t, re.M | re.S)
if not sec: print('FALLA no encontré la tabla de docs/18 §2 (¿cambió su título?)'); sys.exit(1)
n_decl, h_decl, cuerpo = int(sec.group(1)), int(sec.group(2)), sec.group(3)
filas = re.findall(r'^\| ((?:HU|TT)-\d+)[^|]*\|[^|]*\| (\d+) \| (✅|🟡|⬜) \|', cuerpo, re.M)
if len(filas) < 5 or len(md) < 60: print(f'FALLA leí solo {len(filas)} filas de docs/18 §2 y {len(md)} de docs/04'); sys.exit(1)
malos = []
resumen = re.search(r'\*\*Hechos: (\d+) \((\d+) h\) · parciales: (\d+) \((\d+) h\) · pendientes: (\d+) \((\d+) h\)\.\*\*', cuerpo)
if not resumen: malos.append('docs/18 §2: no encontré la línea «Hechos … parciales … pendientes»')
else:
    for i, est, nombre in ((1, '✅', 'hechos'), (3, '🟡', 'parciales'), (5, '⬜', 'pendientes')):
        n = sum(1 for f in filas if f[2] == est); h = sum(int(f[1]) for f in filas if f[2] == est)
        if (n, h) != (int(resumen.group(i)), int(resumen.group(i + 1))):
            malos.append(f'docs/18 §2 dice {nombre}: {resumen.group(i)} ({resumen.group(i + 1)} h); las filas suman {n} ({h} h)')
total_h = sum(int(f[1]) for f in filas)
if (len(filas), total_h) != (n_decl, h_decl): malos.append(f'docs/18 §2 dice {n_decl} elementos y {h_decl} h; las filas suman {len(filas)} y {total_h} h')
ids18, etapa3 = {f[0] for f in filas}, {k for k, (e, _) in md.items() if e == '3'}
malos += [f'{k}: está en docs/18 §2, pero en docs/04 su etapa es {md[k][0] if k in md else "(no existe)"}' for k in sorted(ids18 - etapa3)]
malos += [f'{k}: docs/04 lo pone en la Etapa 3 y docs/18 §2 no lo lista' for k in sorted(etapa3 - ids18)]
malos += [f'{f[0]}: docs/18 dice {f[1]} h y docs/04 {md[f[0]][1]} h' for f in filas if f[0] in md and md[f[0]][1] != f[1]]
for m in malos: print('FALLA', m)
if not malos: print(f'OK    docs/18 §2: las {len(filas)} tareas de la Etapa 3 son las de docs/04, con sus horas; los totales salen de las filas')
sys.exit(1 if malos else 0)
PY

paso "3. Diagramas: informe = docs = base (generar-figuras.sh --verificar)"
bash informe-oficial/figuras/generar-figuras.sh --verificar || fallos=$((fallos+1))

paso "3b. Informe: compilado después del último cambio y sano (cero desbordes graves, cero referencias rotas)"
# 07/10: actualizar.sh marcó un desborde de 53,9 pt y, minutos después, este guardián dijo «TODO EN CONCORDANCIA» porque
# no miraba el informe. La concordancia incluye el PDF. Si hay fuentes más nuevas que la última compilación, el paso se
# omite (hay que recompilar) y el total no puede ser verde; nunca se da por bueno un log viejo.
LOGTEX=informe-oficial/build/main.log
if [ ! -f "$LOGTEX" ]; then echo "omitido: sin compilación previa → bash informe-oficial/actualizar.sh"; omitidos="$omitidos 3b"
else
  nuevas=$( { find informe-oficial -name '*.tex' -newer "$LOGTEX" -not -path '*/build/*'; find informe-oficial/figuras/render -name '*.pdf' -newer "$LOGTEX"; } 2>/dev/null | head -5 | tr '\n' ' ')
  if [ -n "$nuevas" ]; then echo "omitido: fuentes más nuevas que la última compilación ($nuevas) → bash informe-oficial/actualizar.sh"; omitidos="$omitidos 3b"
  else python3 informe-oficial/comprobar-compilacion.py || fallos=$((fallos+1)); fi
fi

paso "3c. Figuras del informe acotadas al ancho de texto (regla del proyecto: ninguna figura excede 13,5 cm)"
# 07/10: el ER regenerado cambió de proporción y, acotado solo en altura, se salió del margen. Toda inclusión acota
# el ancho: includegraphics con width en \linewidth/\textwidth (o \textheight si la figura va apaisada) y tikzpicture
# dentro de \resizebox{…\linewidth}. Se revisa la fuente, no el PDF: así falla antes de compilar.
python3 - <<'PYG' || fallos=$((fallos+1))
import re, pathlib, sys
malas = []; n = 0
for f in sorted(pathlib.Path('informe-oficial').rglob('*.tex')):
    if 'build' in f.parts: continue
    t = f.read_text(errors='ignore'); lineas = t.split('\n'); apaisada = 'sidewaysfigure' in t
    for i, l in enumerate(lineas, 1):
        for m in re.finditer(r'\\includegraphics(\[([^\]]*)\])?', l):
            n += 1; op = m.group(2) or ''
            ok = re.search(r'width\s*=\s*[\d.]*\\(linewidth|textwidth|columnwidth)', op) or (apaisada and re.search(r'width\s*=\s*[\d.]*\\textheight', op))
            if not ok: malas.append(f'{f}:{i} includegraphics sin width acotado [{op}]')
        if '\\begin{tikzpicture}' in l:
            n += 1; previas = '\n'.join(lineas[max(0, i - 4):i])
            if not re.search(r'\\resizebox\{[\d.]*\\(linewidth|textwidth)\}', previas): malas.append(f'{f}:{i} tikzpicture fuera de resizebox{{…linewidth}}')
if n < 5: print(f'FALLA revisó solo {n} inclusiones de figura (se esperan >= 5)'); sys.exit(1)
if malas:
    print('FALLA figuras sin acotar al ancho:'); [print('  ' + m) for m in malas]; sys.exit(1)
print(f'OK    {n} inclusiones de figura acotadas al ancho (includegraphics con width; tikz dentro de resizebox)')
PYG

paso "4. API (si el backend está corriendo en 127.0.0.1:3000)"
if curl -s -m 2 http://127.0.0.1:3000/salud >/dev/null; then bash plataforma/pruebas/api-smoke.sh || fallos=$((fallos+1)); else echo "omitida: backend no está corriendo"; omitidos="$omitidos 4"; fi

# «TODO» solo si todo corrió: un paso omitido no se cuenta como aprobado (27/09: con el backend
# apagado, el guardián decía TODO EN CONCORDANCIA sin haber probado la API). Sale 2 si hubo omisiones.
echo
if [[ $fallos -ne 0 ]]; then echo "$fallos bloque(s) con fallas${omitidos:+ · además omitidos:$omitidos}"; exit 1
elif [[ -n "$omitidos" ]]; then echo "SIN FALLAS, PERO INCOMPLETO: pasos omitidos:$omitidos (no es TODO EN CONCORDANCIA)"; exit 2
else echo "TODO EN CONCORDANCIA"; fi
