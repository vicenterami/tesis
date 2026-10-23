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
# 17/10: la capa del proxy exige PROXY_SECRETO (compose.proxy.yml, `:?`). Los pasos que resuelven la configuración con
# `docker compose config` no levantan nada: les basta un valor de lectura, que no es una credencial ni se escribe en ningún lado.
export PROXY_SECRETO="${PROXY_SECRETO:-solo-para-leer-la-configuracion-resuelta}"
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

paso "1c. Reglas de identidad de las migraciones 11, 15, 16, 17, 18, 19, 20 y 21, plantadas en una transacción que se deshace (docs/10 §8.4 puntos 24 y 47)"
# Pasarela y dispositivo no comparten identificador; lista blanca; LoRaWAN exige pasarela; código de sitio válido. Nada
# queda en la base: el archivo termina en ROLLBACK. La carrera de dos altas simultáneas se probó a mano (docs/16 §13).
docker compose -f plataforma/docker-compose.yml exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA \
  < plataforma/db/pruebas/reglas-identidad.sql | tee "$VT"/identidad.txt
exige "$VT"/identidad.txt "${PIPESTATUS[0]}" 33 || fallos=$((fallos+1))

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
SELECT CASE WHEN (SELECT count(*) FROM timescaledb_information.hypertables WHERE hypertable_name='metrica_broker')=1 AND (SELECT count(*) FROM pg_indexes WHERE tablename='condicion_sistema' AND indexname='uq_condicion_sistema_abierta')=1 AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='ck_condicion_sistema_tipo') LIKE '%broker_descarte%' THEN 'OK    13 metrica_broker es hypertable; condicion_sistema con una abierta por tipo y dominio cerrado' ELSE 'FALLA 13 falta metrica_broker (hypertable) o condicion_sistema (índice único parcial o CHECK)' END;
SELECT CASE WHEN (SELECT count(*) FROM pg_roles WHERE rolname='plataforma_app' AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb)=1 AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE grantee='plataforma_app' AND privilege_type IN ('DELETE','TRUNCATE','REFERENCES','TRIGGER')) AND NOT has_table_privilege('plataforma_app', 'evento', 'UPDATE') AND NOT has_table_privilege('plataforma_app', 'medicion', 'UPDATE') AND NOT has_table_privilege('plataforma_app', 'magnitud', 'INSERT') AND has_table_privilege('plataforma_app', 'estado_dispositivo', 'UPDATE') AND (SELECT prosecdef FROM pg_proc WHERE proname='fn_retencion_drop_chunks') AND NOT has_function_privilege('public', 'fn_retencion_drop_chunks(text,integer)', 'EXECUTE') THEN 'OK    14 plataforma_app sin superusuario, sin DELETE/TRUNCATE, sin reescribir evento ni medicion; fn_retencion_drop_chunks SECURITY DEFINER y no ejecutable por PUBLIC' ELSE 'FALLA 14 rol de la aplicación con más permisos de los debidos, o falta la función de retención' END;
SELECT CASE WHEN (SELECT is_nullable='NO' AND column_default IS NULL FROM information_schema.columns WHERE table_name='pasarela' AND column_name='formato') AND (SELECT pg_get_constraintdef(oid) LIKE '%chirpstack%' FROM pg_constraint WHERE conname='ck_dispositivo_formato' AND conrelid='dispositivo'::regclass) AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_dispositivo_via_formato' AND conrelid='dispositivo'::regclass) AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_dispositivo_pasarela_formato' AND conrelid='dispositivo'::regclass AND contype='f' AND confupdtype='c') THEN 'OK    15 pasarela.formato declarado (sin valor por defecto) y heredado por sus nodos (clave foránea compuesta en cascada)' ELSE 'FALLA 15 falta pasarela.formato o la herencia del formato (migración 15)' END;
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_credencial_titular' AND conrelid='credencial'::regclass) AND (SELECT is_nullable='YES' FROM information_schema.columns WHERE table_name='credencial' AND column_name='dispositivo_id') AND has_table_privilege('plataforma_app', 'pasarela', 'INSERT') AND has_column_privilege('plataforma_app', 'pasarela', 'activo', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'pasarela', 'formato', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'pasarela', 'sitio_id', 'UPDATE') THEN 'OK    16 credencial con un titular (dispositivo o pasarela); la aplicación inserta pasarelas y solo cambia su columna activo' ELSE 'FALLA 16 falta la credencial de pasarela o el permiso de la aplicación (migración 16)' END;
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_dispositivo_decodificador' AND conrelid='dispositivo'::regclass) AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_dispositivo_decodificador_via' AND conrelid='dispositivo'::regclass) AND (SELECT data_type='bigint' FROM information_schema.columns WHERE table_name='estado_dispositivo' AND column_name='ultimo_fcnt') AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_estado_dispositivo_ultimo_fcnt') AND EXISTS (SELECT 1 FROM magnitud WHERE codigo='tension' AND unidad_canonica='V') THEN 'OK    17 dispositivo.decodificador (lista y solo lorawan), estado_dispositivo.ultimo_fcnt (32 bits) y la magnitud tension (V)' ELSE 'FALLA 17 falta el perfil de decodificación, el contador de trama o la magnitud tension (migración 17)' END;
SELECT CASE WHEN (SELECT count(*) FROM magnitud WHERE (codigo, unidad_canonica) IN (('temperatura_suelo','Cel'),('humedad_suelo','V')))=2 AND (SELECT count(*) FROM information_schema.columns WHERE table_name='canal' AND column_name IN ('escala_cero','escala_cien') AND data_type='double precision')=2 AND (SELECT pg_get_constraintdef(oid) LIKE '%Infinity%' FROM pg_constraint WHERE conname='ck_canal_escala' AND conrelid='canal'::regclass) THEN 'OK    18 magnitudes del suelo (temperatura_suelo en Cel, humedad_suelo en V) y la calibración por canal con su CHECK (finitas y distintas)' ELSE 'FALLA 18 faltan las magnitudes del suelo o la calibración del canal (migración 18)' END;
SELECT CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_name='estado_dispositivo' AND column_name IN ('ventana_inicio','ventana_lecturas','ventana_cuarentena','ventana_sobre_tope','ventana_omitidas'))=5 AND (SELECT pg_get_constraintdef(oid) LIKE '%''tope''%' FROM pg_constraint WHERE conname='ck_cuarentena_motivo' AND conrelid='cuarentena'::regclass) AND (SELECT pg_get_constraintdef(oid) LIKE '%tope_superado%' FROM pg_constraint WHERE conname='ck_condicion_tipo' AND conrelid='condicion'::regclass) AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_estado_dispositivo_ventana' AND conrelid='estado_dispositivo'::regclass) THEN 'OK    19 contadores ventana_* en estado_dispositivo con su CHECK, motivo tope y condición tope_superado' ELSE 'FALLA 19 falta el tope por emisor (contadores ventana_*, motivo tope o condición tope_superado)' END;
SELECT CASE WHEN (SELECT pg_get_constraintdef(oid) LIKE '%reloj_desviado%' FROM pg_constraint WHERE conname='ck_condicion_tipo' AND conrelid='condicion'::regclass) THEN 'OK    20 condición reloj_desviado (desvío del reloj de la pasarela)' ELSE 'FALLA 20 falta la condición reloj_desviado (migración 20)' END;
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_canal_actualizado_en' AND tgrelid='canal'::regclass AND tgenabled <> 'D') AND col_description('canal'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid='canal'::regclass AND attname='actualizado_en')) LIKE '%bloqueo optimista%' AND has_column_privilege('plataforma_app', 'canal', 'escala_cero', 'UPDATE') AND has_column_privilege('plataforma_app', 'canal', 'escala_cien', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'canal', 'actualizado_en', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'canal', 'dispositivo_id', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'canal', 'magnitud_codigo', 'UPDATE') THEN 'OK    21 canal.actualizado_en con su disparador y documentado como bloqueo optimista; la aplicación solo actualiza escala_cero y escala_cien' ELSE 'FALLA 21 falta el disparador o el comentario de canal.actualizado_en, o el permiso de la calibración no es el justo (migración 21)' END;
SQL
exige "$VT"/mig.txt "${PIPESTATUS[0]}" 21 || fallos=$((fallos+1))
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

paso "2f2. Sin horario personal: ni las bitácoras ni ningún archivo versionado dicen a qué hora del día se trabajó (revisiones del 15/10)"
# La regla de privacidad prohíbe horarios personales en el repositorio; las bitácoras los dejaban en el título de la sesión.
# 15/10, segunda revisión: también «por la noche», «de madrugada» y una hora del reloj («a las 23:20»), que el primer patrón no veía.
# 15/10, tercera revisión: lo mismo fuera de las bitácoras («12/10, noche», «la noche del 06/10», «la misma noche», en docs/10, 11 y 16).
# Fuera de las bitácoras no se busca la hora del reloj: los ejemplos de zonas horarias la usan a propósito («a las 23:30 del 4-sep»).
DIA='\((madrugada|tarde|noche)[^)]*\)|, (madrugada|tarde|noche)\)|por la (noche|tarde|mañana)|de madrugada|\b(la|esa|misma) (noche|madrugada)\b|\b(esa|misma) tarde\b|[0-9]{1,2}/[0-9]{1,2}(/[0-9]{4})?,? (noche|madrugada|tarde)\b'
horarios=$(grep -niE "$DIA|a las [0-9]{1,2}:[0-9]{2}" bitacora/*.md)
git grep --untracked -n -i -E "$DIA" -- ':!privado' ':!bitacora' ':!plataforma/pruebas/verificar-todo.sh' ':!*.pdf' > "$VT"/horarios.txt 2>&1; rc=$?
nb=$(ls bitacora/*.md | wc -l); na=$(git ls-files | wc -l)
if [ "$nb" -lt 1 ]; then echo "FALLA no encontré bitácoras (¿cambió la carpeta?): no se revisó nada"; fallos=$((fallos+1))
elif [ "$rc" -gt 1 ]; then echo "FALLA git grep falló ($rc): no se pudo revisar"; fallos=$((fallos+1))
elif [ -n "$horarios" ] || [ "$rc" -eq 0 ]; then echo "FALLA horario personal en archivos versionados:"; { echo "$horarios"; cat "$VT"/horarios.txt; } | grep . | cut -c1-120 | sed 's/^/  /'; fallos=$((fallos+1))
else echo "OK    $nb bitácoras y $na archivos versionados revisados: ninguno dice a qué hora del día se trabajó"; fi

paso "2f3. Sin direcciones IPv4 reales: solo loopback, 0.0.0.0 y las de documentación (RFC 5737) en archivos versionados o nuevos"
# 16/10: una prueba del banco usaba la dirección de un resolvedor público real como dirección falsa, y unitarias, una de red privada;
# ningún paso lo veía. Una dirección con forma real es un dato real a efectos de la regla: los ejemplos van en 192.0.2.0/24,
# 198.51.100.0/24 o 203.0.113.0/24. Se cuentan las encontradas: si el patrón no encuentra ninguna (ni 127.0.0.1), no revisó nada.
git grep --untracked -I -n -o -E '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' -- ':!privado' ':!historico' ':!*.pdf' > "$VT"/ipv4.txt 2>&1; rc=$?
total=$(wc -l < "$VT"/ipv4.txt); ajenas=$(grep -vE ':(127\.[0-9]+\.[0-9]+\.[0-9]+|0\.0\.0\.0|192\.0\.2\.[0-9]+|198\.51\.100\.[0-9]+|203\.0\.113\.[0-9]+)$' "$VT"/ipv4.txt)
if [ "$rc" -gt 1 ] || [ "$total" -lt 1 ]; then echo "FALLA git grep falló ($rc) o no encontró ninguna dirección: no se revisó nada"; fallos=$((fallos+1))
elif [ -n "$ajenas" ]; then echo "FALLA direcciones IPv4 que no son de loopback ni de documentación:"; echo "$ajenas" | cut -c1-120 | sed 's/^/  /'; fallos=$((fallos+1))
else echo "OK    $total direcciones IPv4 en archivos versionados o nuevos: todas de loopback, 0.0.0.0 o de documentación"; fi

paso "2f4. Sin hora de trabajo en los metadatos: ningún PDF versionado trae CreationDate ni ModDate (17/10)"
# Chromium (mermaid-cli) escribe la fecha y la hora del render en el Info del PDF: un horario personal dentro de un binario versionado,
# que 2f2 no ve porque mira prosa. El guion de figuras las quita con Ghostscript; aquí se revisan todos los PDF versionados, contándolos.
n=0; con_fecha=""; while read -r f; do n=$((n+1)); pdfinfo "$f" 2>/dev/null | grep -qE '^(Creation|Mod)Date' && con_fecha="$con_fecha $f"; done < <(git ls-files '*.pdf')
if [ "$n" -lt 1 ]; then echo "FALLA no hay PDF versionados: no se revisó nada"; fallos=$((fallos+1))
elif [ -n "$con_fecha" ]; then echo "FALLA PDF versionados con fecha y hora en sus metadatos:$con_fecha"; fallos=$((fallos+1))
else echo "OK    $n PDF versionados sin fecha ni hora en sus metadatos"; fi

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
# 15/10 (revisión del diseño): el conteo no ve «migración 15» escrita antes de que exista el archivo. Ninguna prosa cita una
# migración posterior a la última en disco, salvo en una línea que diga «prevista» (diseño escrito antes del código).
# 16/10: con `grep -o` la línea quedaba recortada al propio «migración NN» y la excepción «prevista» no se veía nunca; se lee la línea
# entera, se descartan las que dicen «prevista» y recién entonces se extraen los números. Probado plantando «migración 18» sin la marca.
ultima=$(ls plataforma/db/init/ | grep -oE '^[0-9]{2}' | sort -n | tail -1)
futuras=$(grep -rnE 'migraci[oó]n [0-9]{2}\b' docs informe-oficial --include=*.md --include=*.tex | grep -v prevista \
  | while IFS= read -r l; do d=${l%%:*}; r=${l#*:}; n=${r%%:*}; for nn in $(grep -oE 'migraci[oó]n [0-9]{2}\b' <<<"${r#*:}" | grep -oE '[0-9]{2}$'); do
      [ "$((10#$nn))" -gt "$((10#${ultima:-0}))" ] && echo "$d:$n:migración $nn"; done; done)
if [ -n "$futuras" ]; then
  echo "FALLA prosa que cita una migración posterior a la última en disco ($ultima):"; echo "$futuras" | sed 's/^/  /'; fallos=$((fallos+1))
else
  echo "OK    ninguna prosa cita una migración posterior a la $ultima"
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
  | grep -vE '\(Etapa [34]\)|Propuesta|\(ruta prevista\)' | grep -oE '(GET|POST|PUT|PATCH|DELETE) /[a-zA-Z0-9_{}/.\\-]*' \
  | sed -E 's/^(GET|POST|PUT|PATCH|DELETE) //; s/\\\{/{/g; s/\\\}/}/g; s/\{[^}]*\}/@P@/g; s/[.,}]+$//; s/@P@/{p}/g' \
  | sort -u)
faltan=$(comm -23 <(echo "$rutas_citadas") <(echo "$rutas_reales"))
if [ -n "$faltan" ]; then
  echo "FALLA rutas citadas que no existen en el OpenAPI:"; echo "$faltan" | sed 's/^/  /'
  fallos=$((fallos+1))
else
  echo "OK    $(echo "$rutas_citadas" | grep -c .) rutas citadas en docs e informe, todas existen en el OpenAPI"
fi
# 15/10: una ruta diseñada y aún no servida se cita con la marca «(ruta prevista)» en la misma línea (p. ej. `POST /pasarelas`
# (ruta prevista)); se acepta sin existir, pero la excepción se vacía sola: si ese VERBO y esa ruta ya existen en el OpenAPI, la
# marca venció y el guardián exige quitarla (regla de los guardianes: una excepción se vacía sola). Revisión del
# 15/10: (a) la marca exime la línea entera, así que una línea marcada lleva UNA sola ruta (con dos, la no prevista se saltaba el
# chequeo de arriba); (b) se compara verbo y ruta, no solo la ruta: que exista GET /x no vence la marca de POST /x. Las marcas
# «(Etapa 3/4)» y «Propuesta» son de pantallas y propuestas (docs/19, docs/20): citan rutas que pueden existir, sin exigencia.
lineas_marcadas=$(grep -rnE '\(ruta prevista\)' informe-oficial docs --include=*.tex --include=*.md --include=*.mmd)
dobles=$(printf '%s\n' "$lineas_marcadas" | grep . | while IFS= read -r l; do
  k=$(grep -oE '(GET|POST|PUT|PATCH|DELETE) /' <<<"$l" | wc -l); [ "$k" -eq 1 ] || echo "$(cut -d: -f1,2 <<<"$l") ($k rutas)"; done)
metodos_reales=$(jq -r '.paths|to_entries[]|.key as $p|.value|keys[]|select(test("^(get|post|put|patch|delete)$"))|ascii_upcase+" "+$p' \
  plataforma/backend/openapi.json | sed -E 's/\{[^}]*\}/{p}/g' | sort -u)
rutas_marcadas=$(printf '%s\n' "$lineas_marcadas" | grep -oE '(GET|POST|PUT|PATCH|DELETE) /[a-zA-Z0-9_{}/.\\-]*' \
  | sed -E 's/\\\{/{/g; s/\\\}/}/g; s/\{[^}]*\}/@P@/g; s/[.,}]+$//; s/@P@/{p}/g' | sort -u)
vencidas=$(comm -12 <(echo "$rutas_marcadas") <(echo "$metodos_reales"))
if [ -n "$dobles" ]; then
  echo "FALLA línea marcada «(ruta prevista)» con más de una ruta (la marca exime la línea entera):"; echo "$dobles" | sed 's/^/  /'
  fallos=$((fallos+1))
fi
if [ -n "$vencidas" ]; then
  echo "FALLA rutas marcadas «(ruta prevista)» que ya existen en el OpenAPI con ese verbo: quitar la marca"; echo "$vencidas" | sed 's/^/  /'
  fallos=$((fallos+1))
elif [ -z "$dobles" ]; then
  echo "OK    $(echo "$rutas_marcadas" | grep -c .) ruta(s) marcadas «(ruta prevista)», una por línea, ninguna servida todavía: $(echo "$rutas_marcadas" | tr '\n' ' ')"
fi

paso "2i. Credenciales del broker en el plugin Dynamic Security: configuración, archivo del plugin (1883/600) y roles y clientes del sistema (docs/10 §8.4 punto 42; docs/11 §7)"
# Hasta el 12/10 vivían en passwd y acl (hallazgo del 27/09: un chown -R les cambiaba el dueño). Ahora el broker no debe leer
# archivos de claves, el JSON del plugin vive en el volumen de datos con dueño 1883 y modo 600, y deben existir los roles
# admin/recepcion/sonda/dispositivo/pasarela (la última desde el 15/10) y los clientes backend-admin/backend/sonda. Solo nombres (grep -o), nunca hashes.
MC="${MOSQ_CONF:-plataforma/mosquitto/config}"; mal=""
[ "$(stat -c %u "$MC/mosquitto.conf")" = "$(id -u)" ] || mal="$mal mosquitto.conf(dueño $(stat -c %u "$MC/mosquitto.conf"))"
grep -qE '^\s*(password_file|acl_file)' "$MC/mosquitto.conf" && mal="$mal mosquitto.conf-lee-archivos-de-claves"
grep -qE '^\s*plugin_opt_config_file\s+/mosquitto/data/dynamic-security.json' "$MC/mosquitto.conf" || mal="$mal mosquitto.conf-sin-plugin"
[ -e "$MC/acl" ] && mal="$mal acl-todavia-en-config"
j=$(cd plataforma && docker compose exec -T mosquitto stat -c '%u %a' /mosquitto/data/dynamic-security.json 2>/dev/null); [ "$j" = "1883 600" ] || mal="$mal archivo-del-plugin(${j:-ausente})"
n=$(cd plataforma && docker compose exec -T mosquitto sh -c 'tr -d " \t" < /mosquitto/data/dynamic-security.json | grep -oE "\"(rolename|username)\":\"[a-z-]+\""' 2>/dev/null)
for e in rolename:admin rolename:recepcion rolename:sonda rolename:dispositivo rolename:pasarela username:backend-admin username:backend username:sonda; do
  grep -qF "\"${e%%:*}\":\"${e#*:}\"" <<<"$n" || mal="$mal falta-${e#*:}"
done
if [ -z "$mal" ]; then echo "OK    mosquitto.conf sin passwd/acl y con el plugin; archivo del plugin de 1883 con modo 600; roles y clientes del sistema presentes"
else echo "FALLA broker:$mal (inicializar o reparar con bash plataforma/pruebas/broker-inicializar.sh)"; fallos=$((fallos+1)); fi
[ -e "$MC/passwd" ] && echo "AVISO $MC/passwd ya no lo lee el broker: bórralo cuando quieras"

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

paso "2y. Guiones: ninguno carga una biblioteca con una ruta relativa a \$0 después de cambiar de carpeta (14/10)"
# 14/10: base-rol-app.sh, broker-cliente.sh y broker-inicializar.sh hacían `cd "$(dirname "$0")/.."` y después
# `. "$(dirname "$0")/lib-dynsec.sh"`: solo funcionaban llamados desde plataforma/. Ahora se usa una ruta absoluta ($AQUI).
malos=$(grep -lE '^\. "\$\(dirname "\$0"\)' plataforma/pruebas/*.sh plataforma/pruebas/banco/*.sh 2>/dev/null)
if [ -n "$malos" ]; then echo "FALLA cargan con ruta relativa a \$0 (fallan según desde dónde se llamen):"; echo "$malos" | sed 's/^/  /'; fallos=$((fallos+1))
else echo "OK    ningún guion carga lib-dynsec.sh con una ruta relativa a \$0"; fi

paso "2z. Toda variable RETENCION_*, METRICA_BROKER_*, TOPE_* y PROXY_SECRETO del .env.example llega al backend por el compose (14/10; topes y secreto del proxy, 17/10)"
# Hasta el 14/10 el compose no las reenviaba: cambiarlas en el .env no tenía efecto y nadie lo notaba.
faltan=$(grep -oE '^#?((RETENCION|METRICA_BROKER|TOPE)_[A-Z_]+|PROXY_SECRETO)' plataforma/.env.example | tr -d '#' | sort -u | while read -r v; do grep -qE "^\s+$v:" plataforma/docker-compose.yml || echo "$v"; done)
n=$(grep -cE '^#?((RETENCION|METRICA_BROKER|TOPE)_[A-Z_]+|PROXY_SECRETO)=' plataforma/.env.example)
if [ "$n" -lt 9 ]; then echo "FALLA solo $n variables RETENCION_/METRICA_BROKER_/TOPE_/PROXY_SECRETO en .env.example: revisó de menos"; fallos=$((fallos+1))
elif [ -n "$faltan" ]; then echo "FALLA declaradas en .env.example pero el compose no las pasa al backend: $(echo $faltan)"; fallos=$((fallos+1))
else echo "OK    las $n variables de limpieza, cola, topes y secreto del proxy llegan al backend por el compose"; fi

paso "2z2. Tope por emisor: las vías que docs/11 §3 declara con tope son exactamente las que entran por filtros2a6 (docs/10 §8.4 punto 53)"
# 17/10: el tope vive en filtros2a6; una vía nueva que no pase por ahí no tendría tope. La fila de docs/11 nombra las vías; el código
# llama a filtros2a6 una vez por vía. Si alguien agrega una vía (o una llamada) sin tocar la otra casa, aquí falla.
vias=$(grep -oE 'Vías con tope: [^;|]+' docs/11-seguridad.md | head -1 | sed -E 's/^Vías con tope: //; s/ y /, /g' | tr ',' '\n' | grep -c .)
llamadas=$(grep -cE 'this\.filtros2a6\(' plataforma/backend/src/recepcion/recepcion.service.ts) # con await (MQTT) o con return (HTTP); la definición no cuenta
if [ "$vias" -lt 3 ] || [ "$llamadas" -lt 1 ]; then echo "FALLA no pude contar (vías=$vias, llamadas=$llamadas): revisó de menos"; fallos=$((fallos+1))
elif [ "$vias" != "$llamadas" ]; then echo "FALLA docs/11 §3 declara $vias vías con tope y recepcion.service.ts entra a filtros2a6 desde $llamadas lugares"; fallos=$((fallos+1))
else echo "OK    $vias vías con tope (docs/11 §3) = $llamadas entradas a filtros2a6"; fi

paso "2m2. Sin NET_RAW en los cuatro servicios: cap_drop en el compose base y en la capa del proxy (docs/10 §8.4 punto 52, 17/10)"
# Suplantar una dirección dentro de la red de Docker exige NET_RAW y ningún servicio la necesita. Se lee la configuración resuelta por
# Compose (con el .env.example: aquí no se lee el .env real) y se exige NET_RAW o ALL en cap_drop de cada uno de los cuatro.
faltan=$(docker compose -f plataforma/docker-compose.yml -f plataforma/proxy/compose.proxy.yml --env-file plataforma/.env.example config --format json 2>/dev/null \
  | python3 -c "import sys,json; s=json.load(sys.stdin).get('services',{}); print(' '.join(n for n in ['timescaledb','mosquitto','backend','proxy'] if not ({'NET_RAW','ALL'} & set(s.get(n,{}).get('cap_drop') or []))))")
if [ $? -ne 0 ]; then echo "FALLA no pude leer la configuración resuelta de Compose"; fallos=$((fallos+1))
elif [ -n "$faltan" ]; then echo "FALLA servicios que conservan NET_RAW: $faltan"; fallos=$((fallos+1))
else echo "OK    los cuatro servicios sueltan NET_RAW (el backend, todas las capacidades)"; fi

paso "2l. Topes del broker (docs/11 §4; docs/10 §8.4 punto 43): max_packet_size <= 64 KiB; cola 10000 mensajes / 20 MB en la pila y el banco; autosave 300 s; el backend lee el mismo tope"
# Sin tope, Mosquitto 2.0.22 aceptó 50 MiB (observado el 07/10): un dispositivo con credencial podría llenar el disco.
tope=$(grep -E '^\s*max_packet_size\s+[0-9]+' "$MC/mosquitto.conf" | awk '{print $2}' | tail -1)
if [[ -n "$tope" && "$tope" -le 65536 ]]; then echo "OK    max_packet_size = $tope bytes"
else echo "FALLA max_packet_size ausente o mayor que 65536 (${tope:-ausente}): el broker acepta mensajes de cualquier tamaño"; fallos=$((fallos+1)); fi
# 13/10: la cola por cliente con topes explícitos (antes regían 1000 mensajes y sin tope de bytes) en la pila Y en el banco,
# que la prueba plantando la violación (banco.sh cola); y el número que el backend usa para avisar al 80 % debe ser el mismo.
opcion_conf() { grep -E "^\s*$2\s+[0-9]+" "$1" | awk '{print $2}' | tail -1; }
q_pila=""
for conf in "$MC/mosquitto.conf" plataforma/pruebas/banco/mosquitto/mosquitto.conf; do
  q=$(opcion_conf "$conf" max_queued_messages); b=$(opcion_conf "$conf" max_queued_bytes); [ "$conf" = "$MC/mosquitto.conf" ] && q_pila=$q
  if [ "$q" = 10000 ] && [ "$b" = 20971520 ]; then echo "OK    $conf: max_queued_messages 10000, max_queued_bytes 20971520"
  else echo "FALLA $conf: max_queued_messages=${q:-ausente}, max_queued_bytes=${b:-ausente} (esperado 10000 y 20971520; docs/10 §8.4 punto 43)"; fallos=$((fallos+1)); fi
done
a=$(opcion_conf "$MC/mosquitto.conf" autosave_interval)
if [ "$a" = 300 ]; then echo "OK    autosave_interval 300 s en la pila (antes 1800: ventana de pérdida si el contenedor muere de golpe)"
else echo "FALLA autosave_interval=${a:-ausente} en la pila (esperado 300)"; fallos=$((fallos+1)); fi
tope_backend=$(grep -oE 'COLA_TOPE_POR_DEFECTO = [0-9]+' plataforma/backend/src/broker/metricas.ts | grep -oE '[0-9]+$')
if [ -n "$tope_backend" ] && [ "$tope_backend" = "$q_pila" ]; then echo "OK    el backend (COLA_TOPE_POR_DEFECTO = $tope_backend) y mosquitto.conf dicen el mismo tope de cola"
else echo "FALLA el backend avisa sobre un tope de ${tope_backend:-ausente} y mosquitto.conf fija ${q_pila:-ausente}: dos fuentes de verdad"; fallos=$((fallos+1)); fi

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
       -e PROXY_NOMBRE=prueba.example -e PROXY_SECRETO=secreto-de-prueba-solo-para-renderizar "$IMG_PROXY" nginx -T >"$VT"/nginx.txt 2>&1; then
  if [ "$(grep -c 'server_name prueba.example;' "$VT"/nginx.txt)" = 2 ] && grep -q 'ssl_reject_handshake on;' "$VT"/nginx.txt \
     && grep -q 'proxy_set_header   Host \$http_host;' "$VT"/nginx.txt && ! grep -q '\${PROXY_NOMBRE}' "$VT"/nginx.txt \
     && grep -q 'X-Proxy-Secreto "secreto-de-prueba-solo-para-renderizar"' "$VT"/nginx.txt; then
    echo "OK    nginx -T: plantilla renderizada y válida ($BASE_PROXY + parches): server_name en 443 y 80, saludo TLS rechazado para otros nombres, secreto del proxy en la cabecera"
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

paso "2o. Informe: todo párrafo que nombra ChirpStack dice de qué ruta habla: opcional (ruta A) o externo del campus (ruta C), salvo el de OpenRemote (docs/10 §8.4 puntos 2 y 45)"
# 07/10: la decisión del 06/10 dejó ChirpStack como opcional, pero el informe seguía diciendo «un contenedor más en la
# plataforma», «cinco contenedores» y «tres puertos». Unidad: el párrafo en capítulos y anexos; el archivo en figuras/.
python3 - <<'PY' || fallos=$((fallos+1))
import pathlib, re, sys
malos, n = [], 0
for f in sorted(pathlib.Path("informe-oficial").glob("**/*.tex")):
    if "build" in f.parts: continue
    n += 1; texto = f.read_text()
    for b in ([texto] if f.parent.name == "figuras" else re.split(r"\n\s*\n", texto)):
        if "ChirpStack" in b and not re.search(r"ruta A|opcional|\(A\)|OpenRemote|ruta C", b):
            malos.append(f"{f}: «{' '.join(b.split())[:110]}…»")
for m in malos: print("FALLA", m)
if not malos: print(f"OK    {n} archivos .tex: cada mención de ChirpStack lo marca como opcional (ruta A)")
sys.exit(1 if malos else 0)
PY

paso "2p. Repositorio público: ningún archivo versionado cita fichas privadas (viven en privado/, un lector no las abre)"
# 08/10: 19 referencias en 12 archivos apuntaban a fichas de decisión privadas (formato D, guion y dos dígitos). Lo público
# cita lo público: la sección de docs/10 §8.4 o de docs/11 donde quedó la decisión.
# 15/10: lo mismo con los pendientes privados (la palabra y su número): siete referencias en seis archivos, quitadas y vigiladas; y
# con el «registro» de evidencia privado: lo público cita la URL de la fuente, no el registro donde se anotó.
git grep --untracked -n -E 'ficha D-[0-9]{2}|decisi[oó]n D-[0-9]{2}|\bD-[0-9]{2}\b|\bpendientes? [0-9]{1,3}\b|registro privad[o]|privad[o]/[A-Z]' -- ':!privado' ':!historico' > "$VT"/fichas.txt 2>&1; rc=$?
if [ "$rc" -eq 0 ]; then echo "FALLA archivos públicos que citan fichas o pendientes privados:"; cut -c1-160 "$VT"/fichas.txt; fallos=$((fallos+1))
elif [ "$rc" -ne 1 ]; then echo "FALLA git grep falló ($rc): no se pudo revisar"; fallos=$((fallos+1))
else echo "OK    ningún archivo versionado cita fichas ni pendientes privados"; fi

paso "2x. Repositorio público: ningún archivo versionado trae las menciones vetadas de la lista privada (12/10)"
# La lista (expresiones regulares, una por línea, sin distinguir mayúsculas) vive fuera del repo, como la de nombres del paso
# 2f: así el guardián no cita lo que busca. Si el archivo no existe o está vacío, el paso se omite y lo dice.
MV="${MENCIONES_VETADAS:-privado/menciones-vetadas.txt}"
if [ ! -s "$MV" ]; then echo "AVISO sin lista $MV: paso omitido"
else
  patron=$(grep -v '^\s*#' "$MV" | grep -v '^\s*$' | paste -sd '|')
  git grep --untracked -n -i -E "$patron" -- ':!privado' > "$VT"/menciones.txt 2>&1; rc=$?
  if [ "$rc" -eq 0 ]; then echo "FALLA archivos públicos con menciones vetadas:"; cut -c1-160 "$VT"/menciones.txt; fallos=$((fallos+1))
  elif [ "$rc" -ne 1 ]; then echo "FALLA git grep falló ($rc): no se pudo revisar"; fallos=$((fallos+1))
  else echo "OK    ningún archivo versionado trae menciones vetadas ($(grep -cv '^\s*#\|^\s*$' "$MV") patrones)"; fi
fi

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
# 15/10: la forma corta («…, 5 en `alta.dto.spec.ts`») no se vigila a propósito: también cuenta subconjuntos («4 en `arranque.spec.ts`»
# son las de la clave, de 37) y aparece en secciones fechadas con la cifra de ese día. Quien la escribe la recuenta a mano.
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
import json, re, subprocess, sys, os
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
    if not os.path.isfile(f): continue  # borrado del árbol pero aún en el índice (git rm pendiente): no hay qué leer
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

paso "2w2. Avance de la implementación (docs/18 §1): hechos y parciales del núcleo y del backlog salen de las filas"
# 15/10: la fila decía 8 parciales (47 h) cuando HU-02 ya era parcial: eran 9 (53 h). Estado de cada ítem: docs/12 §3 (Etapa 2) y,
# encima, docs/18 §2 (notas y tabla, lo más reciente); horas y núcleo (🎯) de docs/04. Un ítem sin estado en ninguna parte es pendiente.
python3 -I - <<'PY' || fallos=$((fallos+1))
import re, sys
md = {}
for l in open('docs/04-backlog.md', encoding='utf-8'):
    m = re.match(r'\|\s*\*\*((?:HU|TT)-\d+)\*\*\s*\|(.*)\|\s*$', l)
    if m:
        c = [x.replace('**', '').strip() for x in m.group(2).split('|')]
        md[m.group(1)] = ('🎯' in c[0], int(c[-1]))
t12 = open('docs/12-estado-etapa2.md', encoding='utf-8').read()
t18 = open('docs/18-estado-etapa3.md', encoding='utf-8').read()
try:
    s3 = t12.split('\n## 3.')[1].split('\n## 4.')[0]
    tabla, notas = t18.split('\n## 2.')[1].split('\n## 3.')[0].split('**Pasadas', 1)
except (IndexError, ValueError):
    print('FALLA no encontré docs/12 §3 o la tabla y las notas de docs/18 §2 (¿cambiaron sus títulos?)'); sys.exit(1)
est = dict(re.findall(r'^\| ((?:HU|TT)-\d+) \|.*?\| (✅|🟡|⬜) \|', s3, re.M))
est.update(re.findall(r'\b((?:HU|TT)-\d+)\b[^;✅🟡⬜]{0,80}?(✅|🟡|⬜)', notas))
est.update(re.findall(r'^\| ((?:HU|TT)-\d+)[^|]*\|[^|]*\| \d+ \| (✅|🟡|⬜) \|', tabla, re.M))
if len(md) < 60 or len(est) < 30: print(f'FALLA leí {len(md)} ítems de docs/04 y {len(est)} estados (¿cambió el formato?)'); sys.exit(1)
def cuenta(solo_nucleo):
    filas = [(k, h) for k, (n, h) in md.items() if n or not solo_nucleo]
    hechos = [h for k, h in filas if est.get(k) == '✅']; parc = [h for k, h in filas if est.get(k) == '🟡']
    tot = sum(h for _, h in filas)
    return (len(hechos), len(filas), sum(hechos), tot, round(100 * sum(hechos) / tot), len(parc), sum(parc))
malos = []
for nombre, rx, solo in (('Núcleo', r'Núcleo: (\d+) de (\d+) elementos hechos \((\d+) de (\d+) h, (\d+) %\) y (\d+) parciales \((\d+) h', True),
                         ('Todo el backlog', r'Todo el backlog: (\d+) de (\d+) \((\d+) de (\d+) h, (\d+) %\) y (\d+) parciales \((\d+) h', False)):
    m = re.search(rx, t18)
    if not m: malos.append(f'docs/18 §1: no encontré la cifra «{nombre}: …» (¿cambió la redacción?)'); continue
    dicho, real = tuple(int(x) for x in m.groups()), cuenta(solo)
    if dicho != real: malos.append(f'docs/18 §1 {nombre}: dice {dicho}; las filas dan {real} (hechos, total, h hechas, h totales, %, parciales, h parciales)')
# 15/10: el informe (cap. de metodología y anexo de seguimiento) repite esas cifras y el estado de la Etapa 3: deben salir de las mismas filas.
f18 = dict((k, (int(h), e)) for k, h, e in re.findall(r'^\| ((?:HU|TT)-\d+)[^|]*\|[^|]*\| (\d+) \| (✅|🟡|⬜) \|', tabla, re.M))
if len(f18) < 10: malos.append(f'docs/18 §2: leí solo {len(f18)} filas de la tabla (¿cambió su forma?)')
e3 = {s: (sum(1 for h, e in f18.values() if e == s), sum(h for h, e in f18.values() if e == s)) for s in '✅🟡⬜'}
tex = re.sub(r'\s+', ' ', open('informe-oficial/cap4.tex', encoding='utf-8').read())
m = re.search(r'De los (\d+) elementos de la Etapa~3 \((\d+)~h\), (\d+) están hechos \((\d+)~h\), (\d+) parciales \((\d+)~h\) y (?:(\d+) pendientes? \((\d+)~h\)|ninguno pendiente); en todo el proyecto, (\d+) de (\d+) elementos del núcleo hechos \((\d+) de (\d+)~h, (\d+)\\,\\%\) y (\d+) parciales \((\d+)~h\)', tex)
if not m: malos.append('informe (cap4.tex): no encontré la frase del seguimiento de la Etapa 3 (¿cambió la redacción?)')
else:
    n = cuenta(True)
    real = (len(f18), sum(h for h, _ in f18.values()), *e3['✅'], *e3['🟡'], *e3['⬜'], n[0], n[1], n[2], n[3], n[4], n[5], n[6])
    dicho = tuple(int(x) if x is not None else 0 for x in m.groups())  # «ninguno pendiente» = 0 elementos y 0 h
    if dicho != real: malos.append(f'informe (cap4.tex): dice {dicho}; las filas dan {real}')
es = open('informe-oficial/anexos/e-seguimiento.tex', encoding='utf-8').read()
if '\\label{tab:seguimiento3}' not in es: malos.append('informe: no encontré el cuadro tab:seguimiento3 en el anexo de seguimiento')
else:
    bloque = es.split('\\label{tab:seguimiento3}', 1)[1].split('\\end{longtable}', 1)[0]
    pal = {'Hecho': '✅', 'Parcial': '🟡', 'Pendiente': '⬜'}
    ftex = dict((k, (int(h), pal[e])) for k, h, e in re.findall(r'^((?:HU|TT)-\d+) & [^&]* & (\d+) & (Hecho|Parcial|Pendiente)', bloque, re.M))
    if ftex != f18:
        dif = sorted(set(ftex.items()) ^ set(f18.items()))
        malos.append(f'informe: el cuadro de la Etapa 3 del anexo difiere de docs/18 §2 en {dif}')
for m in malos: print('FALLA', m)
if not malos: print(f'OK    docs/18 §1 e informe: núcleo {cuenta(True)[0]} hechos y {cuenta(True)[5]} parciales; backlog {cuenta(False)[0]} y {cuenta(False)[5]}; Etapa 3 y su cuadro del anexo, desde las filas')
sys.exit(1 if malos else 0)
PY

paso "2w3. Banco LoRaWAN: el conteo que cita docs/16 es el de comprobaciones del caso lorawan de banco.sh"
# 15/10: docs/10 citaba «medido en el banco» para dos mediciones que el banco no repetía; desde entonces son comprobaciones del caso,
# y el número que dice docs/16 debe ser el del guion (cada «ok "» del caso es una comprobación).
# 15/10, tercera revisión: el rango termina en la línea que imprime «LORAWAN OK» (si falta, falla en vez de contar hasta el final),
# se cuentan apariciones y no líneas, y los dos archivos del informe deben existir.
rango=$(awk '/^  lorawan\)/{f=1} f{print} f && /echo "LORAWAN OK"/{exit}' plataforma/pruebas/banco/banco.sh)
nl=$(grep -o ' ok "' <<<"$rango" | wc -l)
if ! grep -q 'echo "LORAWAN OK"' <<<"$rango"; then echo "FALLA no encontré el final del caso lorawan en banco.sh"; fallos=$((fallos+1))
elif ! [ -f informe-oficial/cap-pruebas.tex ] || ! [ -f informe-oficial/anexos/g-pruebas.tex ]; then echo "FALLA falta el capítulo o el anexo de pruebas del informe"; fallos=$((fallos+1))
elif [ "$nl" -lt 10 ]; then echo "FALLA leí solo $nl comprobaciones en el caso lorawan de banco.sh (¿cambió su forma?)"; fallos=$((fallos+1))
elif ! grep -q "$nl de $nl desde" docs/16-informe-de-pruebas.md; then echo "FALLA banco.sh lorawan tiene $nl comprobaciones y docs/16 no cita «$nl de $nl desde …»"; fallos=$((fallos+1))
elif viejas=$(grep -noE '[0-9]+ de [0-9]+ comprobaciones' informe-oficial/cap-pruebas.tex informe-oficial/anexos/g-pruebas.tex | grep -v ":$nl de $nl comprobaciones"); [ -n "$viejas" ]; then echo "FALLA el informe cita otro conteo del banco LoRaWAN (son $nl): $viejas"; fallos=$((fallos+1))
elif ! grep -q "$nl de $nl comprobaciones" informe-oficial/cap-pruebas.tex; then echo "FALLA el capítulo de pruebas no cita «$nl de $nl comprobaciones» (¿cambió la redacción?)"; fallos=$((fallos+1))
else echo "OK    banco.sh lorawan tiene $nl comprobaciones; docs/16 y el informe citan «$nl de $nl»"; fi

paso "2w4. Cifras del método en el informe y los documentos: pasos del verificador, pruebas del panel y anexos citados por nombre"
# 15/10, tercera revisión: el informe decía «más de 150 comprobaciones» sin fuente y contaba las pruebas del backend sin las del
# panel; y cuatro documentos citaban anexos por una letra que cambió al insertar uno. Se cuentan los pasos de este guion y las
# pruebas del panel, y en los documentos los anexos se nombran (la letra la pone LaTeX y cambia).
python3 -I - <<'PY' || fallos=$((fallos+1))
import re, sys, pathlib
pasos = len(re.findall(r'^paso "', pathlib.Path('plataforma/pruebas/verificar-todo.sh').read_text(encoding='utf-8'), re.M))
# 16/10: sin el (?<![.\w]) contaba también «/…/.test(texto)» (el método de las expresiones regulares) como una prueba: 50 en vez de 49.
# No cuenta it.each(, it.skip( ni test.only(: hoy no hay ninguno en el panel; si aparecen, ampliar la expresión.
panel = sum(len(re.findall(r'(?<![.\w])(?:it|test)\(', p.read_text(encoding='utf-8'))) for p in pathlib.Path('plataforma/backend/panel/src').rglob('*.test.ts'))
if pasos < 20 or panel < 10: print(f'FALLA conté {pasos} pasos y {panel} pruebas del panel (¿cambió la forma?)'); sys.exit(1)
fuentes = [*pathlib.Path('informe-oficial').glob('*.tex'), *pathlib.Path('informe-oficial/anexos').glob('*.tex'), *pathlib.Path('docs').glob('*.md')]
malos, n_pasos, n_panel = [], 0, 0
for f in fuentes:
    if f.name.startswith('12-'): continue
    crudo = f.read_text(encoding='utf-8')
    if f.name.startswith('16-'):
        # 22/10: docs/16 es un registro fechado; cada sección conserva el conteo de su día. Rige el actual solo en la cabecera
        # (antes de la primera «## N.») y en la última sección (la del cambio vigente).
        partes = re.split(r'(?m)^(?=## \d+\. )', crudo); crudo = partes[0] + (partes[-1] if len(partes) > 1 else '')
    t = re.sub(r'\s+', ' ', crudo)
    for m in re.finditer(r'(\d+) pasos que comparan|verificador de (\d+) pasos|por sus pasos \((\d+)\)', t):
        n_pasos += 1; dice = int(m.group(1) or m.group(2) or m.group(3))
        if dice != pasos: malos.append(f'{f}: dice {dice} pasos del verificador; hay {pasos}')
    for m in re.finditer(r'(\d+) del panel', t):
        n_panel += 1
        if int(m.group(1)) != panel: malos.append(f'{f}: dice {m.group(1)} pruebas del panel; hay {panel}')
import subprocess
rastreados = [pathlib.Path(p) for p in subprocess.run(['git', 'ls-files', '*.ts', '*.sh', '*.sql', '*.yml'], capture_output=True, text=True).stdout.split()]
for f in [*pathlib.Path('docs').glob('*.md'), *pathlib.Path('bitacora').glob('*.md'), *pathlib.Path('informe-oficial').glob('*.tex'), *pathlib.Path('informe-oficial/anexos').glob('*.tex'), *rastreados]:
    if f.name == 'verificar-todo.sh' or not f.is_file(): continue
    for n, linea in enumerate(f.read_text(encoding='utf-8').splitlines(), 1):
        # 15/10: el entrevistado se nombra como se autodefinió («Académico/Investigador en Ingeniería Civil Geológica»), decisión del estudiante.
        if re.search(r'\b(el|al|un|del) académico\b', linea): malos.append(f'{f}:{n}: nombrar al entrevistado como se autodefinió')
if n_pasos == 0 or n_panel == 0: malos.append(f'no encontré citas de los pasos ({n_pasos}) o de las pruebas del panel ({n_panel}): ¿cambió la redacción?')
for f in [*pathlib.Path('docs').glob('*.md'), pathlib.Path('README.md'), pathlib.Path('RESUMEN.md'), pathlib.Path('PLAN-MAESTRO.md')]:
    for n, linea in enumerate(f.read_text(encoding='utf-8').splitlines(), 1):
        if re.search(r'\banexos? [A-H]\b', linea): malos.append(f'{f}:{n}: cita un anexo por letra (usar su nombre)')
for m in malos: print('FALLA', m)
if not malos: print(f'OK    {pasos} pasos y {panel} pruebas del panel, como dicen el informe y los documentos; ningún anexo citado por letra')
sys.exit(1 if malos else 0)
PY

paso "2w5. Lo que falta del núcleo (docs/18 §5): la lista tiene todo el núcleo sin terminar, con sus horas de docs/04 y su estado"
# 16/10: la tabla del plan se escribió a mano; sin esto, un elemento que se cierra (o cambia de horas) sigue en la lista sin que nadie lo
# note. El estado sale del mismo cálculo que 2w2 (docs/12 §3 y, encima, docs/18 §2).
python3 -I - <<'PY' || fallos=$((fallos+1))
import re, sys
md = {}
for l in open('docs/04-backlog.md', encoding='utf-8'):
    m = re.match(r'\|\s*\*\*((?:HU|TT)-\d+)\*\*\s*\|(.*)\|\s*$', l)
    if m:
        c = [x.replace('**', '').strip() for x in m.group(2).split('|')]
        md[m.group(1)] = ('🎯' in c[0], int(c[-1]))
t12 = open('docs/12-estado-etapa2.md', encoding='utf-8').read(); t18 = open('docs/18-estado-etapa3.md', encoding='utf-8').read()
try:
    s3 = t12.split('\n## 3.')[1].split('\n## 4.')[0]
    tabla, notas = t18.split('\n## 2.')[1].split('\n## 3.')[0].split('**Pasadas', 1)
    falta = t18.split('\n## 5.')[1].split('\n## 6.')[0].split('**Fuera del núcleo')[0]
except (IndexError, ValueError):
    print('FALLA no encontré docs/12 §3, docs/18 §2 o docs/18 §5 (¿cambiaron sus títulos?)'); sys.exit(1)
est = dict(re.findall(r'^\| ((?:HU|TT)-\d+) \|.*?\| (✅|🟡|⬜) \|', s3, re.M))
est.update(re.findall(r'\b((?:HU|TT)-\d+)\b[^;✅🟡⬜]{0,80}?(✅|🟡|⬜)', notas))
est.update(re.findall(r'^\| ((?:HU|TT)-\d+)[^|]*\|[^|]*\| \d+ \| (✅|🟡|⬜) \|', tabla, re.M))
filas = re.findall(r'^\| \d+ \| ((?:HU|TT)-\d+)[^|]*\| (\d+) \| (✅|🟡|⬜) \|', falta, re.M)
if len(filas) < 1: print('FALLA leí 0 filas en docs/18 §5 (¿cambió su forma?)'); sys.exit(1)
malos = []
listados = {k for k, _, _ in filas}
for k, h, e in filas:
    if k not in md or not md[k][0]: malos.append(f'{k}: no es del núcleo en docs/04')
    elif int(h) != md[k][1]: malos.append(f'{k}: {h} h en docs/18 §5 y {md[k][1]} h en docs/04')
    if est.get(k, '⬜') != e: malos.append(f'{k}: docs/18 §5 dice {e} y el estado es {est.get(k, "⬜")}')
for k, (n, _) in md.items():
    if n and est.get(k, '⬜') != '✅' and k not in listados: malos.append(f'{k}: del núcleo y sin terminar, pero no está en docs/18 §5')
m = re.search(r'Núcleo \(🎯\)\*\*?: (\d+) elementos, (\d+) h', falta) or re.search(r'Núcleo \(🎯\): (\d+) elementos, (\d+) h', falta)
if not m: malos.append('docs/18 §5: no encontré «Núcleo (🎯): N elementos, H h»')
elif (int(m.group(1)), int(m.group(2))) != (len(filas), sum(int(h) for _, h, _ in filas)): malos.append(f'docs/18 §5 dice {m.group(1)} elementos y {m.group(2)} h; la tabla suma {len(filas)} y {sum(int(h) for _, h, _ in filas)}')
if malos: print('FALLA lo que falta del núcleo no cuadra:'); [print('  ' + x) for x in malos]; sys.exit(1)
print(f'OK    docs/18 §5: {len(filas)} elementos del núcleo sin terminar, con sus horas y su estado; ninguno terminado sigue en la lista')
PY

paso "2y2. Sintaxis de los guiones: bash -n de cada *.sh versionado o nuevo (no ignorado)"
# 16/10: una línea de comentario sin «#» dejó banco.sh entero sin interpretarse y el guardián no lo veía (solo lo vio la siguiente
# corrida del banco). bash -n no ejecuta nada: solo lee el guion.
malos=""; n=0
while IFS= read -r g; do n=$((n+1)); bash -n "$g" 2>/dev/null || malos="$malos $g"; done < <(git ls-files -co --exclude-standard '*.sh')
if [ "$n" -lt 15 ]; then echo "FALLA revisé solo $n guiones (¿cambió el listado?)"; fallos=$((fallos+1))
elif [ -n "$malos" ]; then echo "FALLA guiones con error de sintaxis:$malos"; fallos=$((fallos+1))
else echo "OK    $n guiones con la sintaxis de bash correcta (bash -n)"; fi

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
