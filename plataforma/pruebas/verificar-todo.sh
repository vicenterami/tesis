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
# 11/11/2026: la línea de resumen de vitest es «Tests  N passed (N)» (la de jest era «Tests:»); sale la del backend y la del panel.
# Revisión del 11/11/2026: «exit 0 no prueba nada si no revisó nada»: además del código de salida se exige ver las dos suites
# (backend y panel), cada una con al menos 100 pruebas pasadas; si vitest no encontrara archivos, saldría con 0 líneas y el paso falla.
if command -v pnpm >/dev/null; then (cd plataforma/backend && salida=$(pnpm verificar 2>&1); rc=$?; grep -E "^\$ |^ *Tests +[0-9]|error|✖|FAIL" <<<"$salida"; suites=$(grep -oE "^ *Tests +[0-9]+ passed" <<<"$salida" | grep -oE "[0-9]+"); n=$(grep -c . <<<"$suites"); pocas=$(awk '$1 < 100' <<<"$suites" | grep -c .); if [ "$rc" -ne 0 ]; then exit "$rc"; elif [ "${n:-0}" -ne 2 ] || [ "$pocas" -ne 0 ]; then echo "FALLA pnpm verificar salió con 0 pero no se vieron dos suites con al menos 100 pruebas (backend y panel): $(tr '\n' ' ' <<<"$suites")"; exit 1; else echo "suites con pruebas pasadas: $(tr '\n' ' ' <<<"$suites")(backend y panel)"; fi) || fallos=$((fallos+1)); else echo "omitida: pnpm no está en el PATH"; omitidos="$omitidos 0"; fi

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

paso "1c. Reglas de identidad de las migraciones 11, 15, 16, 17, 18, 19, 20 y 21, la anonimización de la 24 y el catálogo editable de la 27, plantadas en una transacción que se deshace (docs/10 §8.4 puntos 24, 47, 62 y 69)"
# Pasarela y dispositivo no comparten identificador; lista blanca; LoRaWAN exige pasarela; código de sitio válido. Nada
# queda en la base: el archivo termina en ROLLBACK. La carrera de dos altas simultáneas se probó a mano (docs/16 §13).
docker compose -f plataforma/docker-compose.yml exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA \
  < plataforma/db/pruebas/reglas-identidad.sql | tee "$VT"/identidad.txt
exige "$VT"/identidad.txt "${PIPESTATUS[0]}" 33 || fallos=$((fallos+1))
# Catálogo editable (migración 27, TT-12): rango cierto, sugeridos, alias, recetas de escritura única y lo que plataforma_app no puede hacer
# sin las dos funciones del dueño; al final, lo legítimo pasa como plataforma_app. Probado plantando: sin ck_magnitud_rango fallan sus 5 casos;
# con la fn_crear_receta anterior a la revisión del 23/11, los 7 de la forma de los campos.
docker compose -f plataforma/docker-compose.yml exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA \
  < plataforma/db/pruebas/catalogo-editable.sql | tee "$VT"/catalogo.txt
exige "$VT"/catalogo.txt "${PIPESTATUS[0]}" 40 || fallos=$((fallos+1))
# Y la API del catálogo de punta a punta (TT-12, bloque 4; docs/16 §98) en una base DESECHABLE: crea magnitudes, y una magnitud no se borra.
# Probada plantando: sin el bloqueo del rango más chico fallan 5 casos; sin el candado o sin traducir el 23505, el suyo (docs/16 §98).
if command -v docker >/dev/null && command -v pnpm >/dev/null; then
  bash plataforma/pruebas/catalogo-integracion.sh > "$VT"/catalogo-integracion.txt 2>&1; s=$?; tail -3 "$VT"/catalogo-integracion.txt
  { [ $s -eq 0 ] && grep -q '^CATÁLOGO OK$' "$VT"/catalogo-integracion.txt; } || { grep '^FALLA' "$VT"/catalogo-integracion.txt | head -5; fallos=$((fallos+1)); }
else echo "omitida: la integración del catálogo necesita docker y pnpm"; fi
# Sitios y zonas desde el panel (docs/19 §4 U y U2; migración 28; docs/16 §101) en una base DESECHABLE: crea sitios y zonas, que no se
# borran. Probada plantando: sin el rechazo de la zona retirada al mover un equipo, fallan 2 casos (la primera versión pasaba igual porque el
# cuerpo era inválido por otra razón: desde entonces el caso exige el motivo «retirada»).
if command -v docker >/dev/null && command -v pnpm >/dev/null; then
  bash plataforma/pruebas/sitios-zonas-integracion.sh > "$VT"/sitios-zonas-integracion.txt 2>&1; s=$?; tail -3 "$VT"/sitios-zonas-integracion.txt
  { [ $s -eq 0 ] && grep -q '^SITIOS Y ZONAS OK$' "$VT"/sitios-zonas-integracion.txt; } || { grep '^FALLA' "$VT"/sitios-zonas-integracion.txt | head -5; fallos=$((fallos+1)); }
else echo "omitida: la integración de sitios y zonas necesita docker y pnpm"; fi
# fn_anonimizar_usuario (SECURITY DEFINER; corrección del 11/11/2026): el último administrador del sistema y `por` nulo, rechazados dentro de
# la función; el correo de sus intentos de acceso y el motivo de sus eventos, anulados; con otro administrador activo, la baja pasa.
docker compose -f plataforma/docker-compose.yml exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA \
  < plataforma/db/pruebas/anonimizacion.sql | tee "$VT"/anonimizacion.txt
exige "$VT"/anonimizacion.txt "${PIPESTATUS[0]}" 6 || fallos=$((fallos+1))

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
SELECT CASE WHEN (SELECT count(*) FROM pg_roles WHERE rolname='plataforma_app' AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb)=1 AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE grantee='plataforma_app' AND privilege_type IN ('DELETE','TRUNCATE','REFERENCES','TRIGGER')) AND NOT has_table_privilege('plataforma_app', 'evento', 'UPDATE') AND NOT has_table_privilege('plataforma_app', 'medicion', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'magnitud', 'unidad_canonica', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'magnitud', 'codigo', 'UPDATE') AND has_table_privilege('plataforma_app', 'estado_dispositivo', 'UPDATE') AND (SELECT prosecdef FROM pg_proc WHERE proname='fn_retencion_drop_chunks') AND NOT has_function_privilege('public', 'fn_retencion_drop_chunks(text,integer)', 'EXECUTE') THEN 'OK    14 plataforma_app sin superusuario, sin DELETE/TRUNCATE, sin reescribir evento ni medicion ni la unidad o el código de una magnitud; fn_retencion_drop_chunks SECURITY DEFINER y no ejecutable por PUBLIC' ELSE 'FALLA 14 rol de la aplicación con más permisos de los debidos, o falta la función de retención' END;
SELECT CASE WHEN (SELECT is_nullable='NO' AND column_default IS NULL FROM information_schema.columns WHERE table_name='pasarela' AND column_name='formato') AND (SELECT pg_get_constraintdef(oid) LIKE '%chirpstack%' FROM pg_constraint WHERE conname='ck_dispositivo_formato' AND conrelid='dispositivo'::regclass) AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_dispositivo_via_formato' AND conrelid='dispositivo'::regclass) AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_dispositivo_pasarela_formato' AND conrelid='dispositivo'::regclass AND contype='f' AND confupdtype='c') THEN 'OK    15 pasarela.formato declarado (sin valor por defecto) y heredado por sus nodos (clave foránea compuesta en cascada)' ELSE 'FALLA 15 falta pasarela.formato o la herencia del formato (migración 15)' END;
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_credencial_titular' AND conrelid='credencial'::regclass) AND (SELECT is_nullable='YES' FROM information_schema.columns WHERE table_name='credencial' AND column_name='dispositivo_id') AND has_table_privilege('plataforma_app', 'pasarela', 'INSERT') AND has_column_privilege('plataforma_app', 'pasarela', 'activo', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'pasarela', 'formato', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'pasarela', 'sitio_id', 'UPDATE') THEN 'OK    16 credencial con un titular (dispositivo o pasarela); la aplicación inserta pasarelas y solo cambia su columna activo' ELSE 'FALLA 16 falta la credencial de pasarela o el permiso de la aplicación (migración 16)' END;
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN ('ck_dispositivo_decodificador', 'fk_dispositivo_decodificador') AND conrelid='dispositivo'::regclass) AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_dispositivo_decodificador_via' AND conrelid='dispositivo'::regclass) AND (SELECT data_type='bigint' FROM information_schema.columns WHERE table_name='estado_dispositivo' AND column_name='ultimo_fcnt') AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_estado_dispositivo_ultimo_fcnt') AND EXISTS (SELECT 1 FROM magnitud WHERE codigo='tension' AND unidad_canonica='V') THEN 'OK    17 dispositivo.decodificador (lista, desde la 27 clave foránea a la receta, y solo lorawan), estado_dispositivo.ultimo_fcnt (32 bits) y la magnitud tension (V)' ELSE 'FALLA 17 falta el perfil de decodificación, el contador de trama o la magnitud tension (migración 17)' END;
SELECT CASE WHEN (SELECT count(*) FROM magnitud WHERE (codigo, unidad_canonica) IN (('temperatura_suelo','Cel'),('humedad_suelo','V')))=2 AND (SELECT count(*) FROM information_schema.columns WHERE table_name='canal' AND column_name IN ('escala_cero','escala_cien') AND data_type='double precision')=2 AND (SELECT pg_get_constraintdef(oid) LIKE '%Infinity%' FROM pg_constraint WHERE conname='ck_canal_escala' AND conrelid='canal'::regclass) THEN 'OK    18 magnitudes del suelo (temperatura_suelo en Cel, humedad_suelo en V) y la calibración por canal con su CHECK (finitas y distintas)' ELSE 'FALLA 18 faltan las magnitudes del suelo o la calibración del canal (migración 18)' END;
SELECT CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_name='estado_dispositivo' AND column_name IN ('ventana_inicio','ventana_lecturas','ventana_cuarentena','ventana_sobre_tope','ventana_omitidas'))=5 AND (SELECT pg_get_constraintdef(oid) LIKE '%''tope''%' FROM pg_constraint WHERE conname='ck_cuarentena_motivo' AND conrelid='cuarentena'::regclass) AND (SELECT pg_get_constraintdef(oid) LIKE '%tope_superado%' FROM pg_constraint WHERE conname='ck_condicion_tipo' AND conrelid='condicion'::regclass) AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_estado_dispositivo_ventana' AND conrelid='estado_dispositivo'::regclass) THEN 'OK    19 contadores ventana_* en estado_dispositivo con su CHECK, motivo tope y condición tope_superado' ELSE 'FALLA 19 falta el tope por emisor (contadores ventana_*, motivo tope o condición tope_superado)' END;
SELECT CASE WHEN (SELECT pg_get_constraintdef(oid) LIKE '%reloj_desviado%' FROM pg_constraint WHERE conname='ck_condicion_tipo' AND conrelid='condicion'::regclass) THEN 'OK    20 condición reloj_desviado (desvío del reloj de la pasarela)' ELSE 'FALLA 20 falta la condición reloj_desviado (migración 20)' END;
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_canal_actualizado_en' AND tgrelid='canal'::regclass AND tgenabled <> 'D') AND col_description('canal'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid='canal'::regclass AND attname='actualizado_en')) LIKE '%bloqueo optimista%' AND has_column_privilege('plataforma_app', 'canal', 'escala_cero', 'UPDATE') AND has_column_privilege('plataforma_app', 'canal', 'escala_cien', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'canal', 'actualizado_en', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'canal', 'dispositivo_id', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'canal', 'magnitud_codigo', 'UPDATE') THEN 'OK    21 canal.actualizado_en con su disparador y documentado como bloqueo optimista; la aplicación solo actualiza escala_cero y escala_cien' ELSE 'FALLA 21 falta el disparador o el comentario de canal.actualizado_en, o el permiso de la calibración no es el justo (migración 21)' END;
SELECT CASE WHEN (SELECT count(*) FROM timescaledb_information.hypertables WHERE hypertable_name='acceso')=1 AND (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='sesion')=1 AND (SELECT pg_get_constraintdef(oid) LIKE '%cierre%' FROM pg_constraint WHERE conname='ck_acceso_resultado' AND conrelid='acceso'::regclass) AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_usuario_clave_temporal' AND conrelid='usuario'::regclass) AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_sesion_id' AND conrelid='sesion'::regclass) AND (SELECT count(*) FROM information_schema.columns WHERE table_name='usuario_sitio' AND column_name='activo')=1 AND has_table_privilege('plataforma_app', 'acceso', 'INSERT') AND NOT has_table_privilege('plataforma_app', 'acceso', 'UPDATE') AND has_column_privilege('plataforma_app', 'sesion', 'revocada_en', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'sesion', 'usuario_id', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'usuario', 'email', 'UPDATE') AND (SELECT prosecdef FROM pg_proc WHERE proname='fn_limpiar_sesiones') AND NOT has_function_privilege('public', 'fn_limpiar_sesiones(integer)', 'EXECUTE') THEN 'OK    22 sesion (identificador solo como hash) y acceso (hypertable, resultado de dominio cerrado); clave temporal con su vencimiento; usuario_sitio.activo; la aplicación agrega accesos sin reescribirlos, solo renueva o revoca sesiones y no cambia el email' ELSE 'FALLA 22 falta la sesión de personas (sesion, acceso como hypertable, clave temporal, usuario_sitio.activo) o el permiso de la aplicación no es el justo (migración 22)' END;
SELECT CASE WHEN (SELECT count(*) FROM pg_constraint WHERE conname='ck_regla_umbral_retardo_s' AND conrelid='regla_umbral'::regclass)=1 AND (SELECT count(*) FROM information_schema.columns WHERE table_name='regla_umbral' AND column_name='fuera_de_banda_desde')=1 AND (SELECT count(*) FROM pg_constraint WHERE conname='fk_evento_usuario' AND conrelid='evento'::regclass)=1 AND (SELECT count(*) FROM pg_indexes WHERE (indexname='idx_condicion_abierta_en_id' AND indexdef LIKE '%(abierta_en DESC, id DESC)') OR (indexname='idx_cuarentena_recibido_en_id' AND indexdef LIKE '%(recibido_en DESC, id DESC)') OR (indexname='idx_evento_dispositivo_ocurrido_en_id' AND indexdef LIKE '%(dispositivo_id, ocurrido_en DESC, id DESC)') OR (indexname='idx_evento_usuario_id' AND indexdef LIKE '%(usuario_id)'))=4 AND (SELECT pg_get_constraintdef(oid) LIKE '%>= 1)%<= 86400)%' FROM pg_constraint WHERE conname='ck_dispositivo_intervalo_esperado_s' AND conrelid='dispositivo'::regclass) AND has_function_privilege('plataforma_app', 'fn_quitar_reglas(uuid, uuid[])', 'EXECUTE') AND NOT has_table_privilege('plataforma_app', 'regla_umbral', 'DELETE') AND has_column_privilege('plataforma_app', 'regla_umbral', 'retardo_s', 'UPDATE') THEN 'OK    23 regla_umbral.retardo_s (0..86400) y fuera_de_banda_desde, evento.usuario_id con su FK, índices de keyset en el sentido del orden (tiempo DESC, id DESC), intervalo_esperado_s 1..86400 y fn_quitar_reglas; la aplicación sigue sin DELETE' ELSE 'FALLA 23 falta algo de la migración 23 (retardo, usuario_id, índices de keyset en el sentido del orden, CHECK del intervalo esperado o permisos)' END;
SELECT CASE WHEN (SELECT pg_get_constraintdef(oid) LIKE '%investigador%operador%' FROM pg_constraint WHERE conname='ck_usuario_sitio_rol' AND conrelid='usuario_sitio'::regclass) AND (SELECT count(*) FROM information_schema.columns WHERE table_name='usuario' AND column_name IN ('administrador_sistema','desactivado_en','desactivado_por','motivo_baja','anonimizado_en','terminos_version_aceptada','terminos_aceptados_en'))=7 AND (SELECT count(*) FROM pg_constraint WHERE conrelid='usuario'::regclass AND conname IN ('ck_usuario_baja','ck_usuario_motivo_baja','ck_usuario_anonimizado','ck_usuario_terminos'))=4 AND (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('preferencia','mensaje_soporte'))=2 AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_preferencia_actualizado_en') AND (SELECT count(*) FROM information_schema.columns WHERE table_name='acceso' AND column_name='id' AND is_nullable='NO')=1 AND (SELECT prosecdef FROM pg_proc WHERE proname='fn_anonimizar_usuario') AND has_function_privilege('plataforma_app', 'fn_anonimizar_usuario(uuid, uuid)', 'EXECUTE') AND NOT has_function_privilege('public', 'fn_anonimizar_usuario(uuid, uuid)', 'EXECUTE') AND NOT has_table_privilege('plataforma_app', 'preferencia', 'DELETE') AND NOT has_table_privilege('plataforma_app', 'mensaje_soporte', 'DELETE') AND NOT has_column_privilege('plataforma_app', 'mensaje_soporte', 'texto', 'UPDATE') AND has_column_privilege('plataforma_app', 'usuario', 'motivo_baja', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'usuario', 'anonimizado_en', 'UPDATE') THEN 'OK    24 cuatro perfiles de sitio y administrador_sistema; baja con motivo (CHECK de coherencia); anonimización solo por fn_anonimizar_usuario (SECURITY DEFINER, no ejecutable por PUBLIC); términos; preferencia y mensaje_soporte sin DELETE; acceso.id' ELSE 'FALLA 24 falta algo de la migración 24 (perfiles, baja con motivo, anonimización, términos, preferencia, mensaje_soporte, acceso.id o permisos)' END;
SELECT CASE WHEN (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('enlace_publico','enlace_publico_acceso'))=2 AND (SELECT indexdef LIKE 'CREATE UNIQUE INDEX%(token_hash)' FROM pg_indexes WHERE indexname='uq_enlace_publico_token_hash') AND (SELECT count(*) FROM pg_constraint WHERE conrelid='enlace_publico'::regclass AND conname IN ('ck_enlace_publico_token_hash','ck_enlace_publico_vencimiento','ck_enlace_publico_minimo_dispositivos','ck_enlace_publico_ventana_maxima'))=4 AND (SELECT is_nullable='NO' FROM information_schema.columns WHERE table_name='enlace_publico' AND column_name='expira_en') AND (SELECT prosecdef FROM pg_proc WHERE proname='fn_limpiar_accesos_publicos') AND has_function_privilege('plataforma_app', 'fn_limpiar_accesos_publicos(integer)', 'EXECUTE') AND NOT has_function_privilege('public', 'fn_limpiar_accesos_publicos(integer)', 'EXECUTE') AND has_column_privilege('plataforma_app', 'enlace_publico', 'revocado_en', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'enlace_publico', 'token_hash', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'enlace_publico', 'sitio_id', 'UPDATE') AND has_column_privilege('plataforma_app', 'enlace_publico_acceso', 'cuenta', 'UPDATE') AND NOT has_table_privilege('plataforma_app', 'enlace_publico_acceso', 'DELETE') AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_enlace_publico_tiempos' AND tgrelid='enlace_publico'::regclass AND tgenabled <> 'D') AND (SELECT prosecdef FROM pg_proc WHERE proname='fn_anonimizar_enlaces_publicos') AND has_function_privilege('plataforma_app', 'fn_anonimizar_enlaces_publicos()', 'EXECUTE') AND NOT has_function_privilege('public', 'fn_anonimizar_enlaces_publicos()', 'EXECUTE') AND NOT has_column_privilege('plataforma_app', 'enlace_publico', 'titulo', 'UPDATE') AND has_column_privilege('plataforma_app', 'sitio', 'enlaces_publicos_max', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'sitio', 'codigo', 'UPDATE') AND NOT has_column_privilege('plataforma_app', 'enlace_publico', 'creado_en', 'INSERT') AND has_column_privilege('plataforma_app', 'enlace_publico', 'token_hash', 'INSERT') AND has_column_privilege('plataforma_app', 'sitio', 'publico_minimo_dispositivos', 'UPDATE') AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_sitio_publico_minimo_dispositivos' AND conrelid='sitio'::regclass) AND NOT has_column_privilege('plataforma_app', 'enlace_publico', 'minimo_dispositivos', 'INSERT') AND (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='dispositivo_zona')=1 AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_dispositivo_zona_historia' AND tgrelid='dispositivo'::regclass AND tgenabled <> 'D') AND (SELECT prosecdef FROM pg_proc WHERE proname='fn_dispositivo_zona_historia') AND has_table_privilege('plataforma_app', 'dispositivo_zona', 'SELECT') AND NOT has_table_privilege('plataforma_app', 'dispositivo_zona', 'INSERT') AND NOT has_table_privilege('plataforma_app', 'dispositivo_zona', 'UPDATE') AND NOT has_table_privilege('plataforma_app', 'dispositivo_zona', 'DELETE') AND (SELECT count(*) FROM information_schema.columns WHERE table_name='dispositivo' AND column_name='zona_desde')=0 AND (SELECT count(*) FROM pg_constraint WHERE conrelid='dispositivo_zona'::regclass AND conname IN ('fk_dispositivo_zona_dispositivo','fk_dispositivo_zona_zona') AND confdeltype='r')=2 AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='dispositivo_zona'::regclass AND conname='uq_dispositivo_zona_sin_solape' AND contype='x') THEN 'OK    25 enlace_publico (solo el resumen del token, con índice único; todo enlace vence, como mucho 180 días; una revocación no se deshace y nada queda fechado en el futuro, por disparador; su texto se anonimiza solo por fn_anonimizar_enlaces_publicos) y enlace_publico_acceso; sitio.enlaces_publicos_max y sitio.publico_minimo_dispositivos (el k de la vista pública, 1 a 20), columnas de sitio que cambia la aplicación; la aplicación inserta enlaces solo en sus columnas (sin el k por enlace, ya en desuso); dispositivo_zona, la historia de zonas de cada equipo, solo por disparador, sin estadías solapadas (EXCLUDE) y sin borrarse en cascada (RESTRICT); la limpieza solo por fn_limpiar_accesos_publicos (SECURITY DEFINER, no ejecutable por PUBLIC); la aplicación no cambia el resumen ni el sitio y no borra' ELSE 'FALLA 25 falta algo de la migración 25 (tablas, índice único del resumen, CHECK, disparadores, historia de zonas, k del sitio, función de limpieza o permisos)' END;
SELECT CASE WHEN (SELECT is_nullable='NO' AND column_default='now()' AND data_type='timestamp with time zone' FROM information_schema.columns WHERE table_schema='public' AND table_name='dispositivo' AND column_name='en_servicio_desde') AND col_description('dispositivo'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid='dispositivo'::regclass AND attname='en_servicio_desde')) LIKE 'Desde cuándo se espera%' AND (SELECT is_nullable='NO' AND column_default='168' AND data_type='integer' FROM information_schema.columns WHERE table_schema='public' AND table_name='sitio' AND column_name='espera_primera_trama_h') AND (SELECT pg_get_constraintdef(oid) LIKE '%>= 1)%<= 2160)%' FROM pg_constraint WHERE conname='ck_sitio_espera_primera_trama_h' AND conrelid='sitio'::regclass) AND (SELECT array_agg(column_name::text ORDER BY column_name::text) FROM information_schema.column_privileges WHERE grantee='plataforma_app' AND table_schema='public' AND table_name='sitio' AND privilege_type='UPDATE') = ARRAY['descripcion','enlaces_publicos_max','espera_primera_trama_h','nombre','publico_minimo_dispositivos'] THEN 'OK    26 dispositivo.en_servicio_desde (NOT NULL, now() por omisión y documentada: desde cuándo se espera que reporte) y sitio.espera_primera_trama_h (1 a 2 160 horas, 168 por omisión, con su CHECK); de sitio, la aplicación solo cambia esa columna, enlaces_publicos_max y publico_minimo_dispositivos' ELSE 'FALLA 26 falta algo de la migración 26 (en_servicio_desde con su valor por omisión y su comentario, espera_primera_trama_h con su CHECK, o el permiso de la aplicación sobre sitio no es el justo)' END;
SELECT CASE WHEN (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('magnitud_alias','receta_decodificacion','receta_campo'))=3 AND (SELECT count(*) FROM information_schema.columns WHERE table_name='magnitud' AND column_name IN ('umbral_alto_sugerido','umbral_bajo_sugerido','histeresis_sugerida'))=3 AND (SELECT count(*) FROM pg_constraint WHERE conrelid='magnitud'::regclass AND conname IN ('ck_magnitud_rango','ck_magnitud_codigo','ck_magnitud_sugeridos','ck_magnitud_histeresis_sugerida'))=4 AND (SELECT count(*) FROM magnitud_alias)>=8 AND (SELECT count(*) FROM receta_campo WHERE receta_codigo='campus-heltec-v3-v1')=3 AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_dispositivo_decodificador' AND conrelid='dispositivo'::regclass AND contype='f' AND confdeltype='r') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_dispositivo_decodificador') AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_receta_campo_receta' AND conrelid='receta_campo'::regclass AND array_length(conkey,1)=2) AND (SELECT bool_and(coalesce(prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'], false)) FROM pg_proc WHERE proname IN ('fn_crear_receta','fn_quitar_alias')) AND (SELECT count(*) FROM pg_proc WHERE proname IN ('fn_crear_receta','fn_quitar_alias'))=2 AND has_function_privilege('plataforma_app', 'fn_crear_receta(text, text, integer, jsonb)', 'EXECUTE') AND NOT has_function_privilege('public', 'fn_crear_receta(text, text, integer, jsonb)', 'EXECUTE') AND has_function_privilege('plataforma_app', 'fn_quitar_alias(text)', 'EXECUTE') AND NOT has_function_privilege('public', 'fn_quitar_alias(text)', 'EXECUTE') AND NOT has_table_privilege('plataforma_app', 'receta_decodificacion', 'INSERT') AND NOT has_any_column_privilege('plataforma_app', 'receta_decodificacion', 'INSERT') AND NOT has_any_column_privilege('plataforma_app', 'receta_campo', 'INSERT') AND NOT has_any_column_privilege('plataforma_app', 'receta_campo', 'UPDATE') AND has_column_privilege('plataforma_app', 'magnitud', 'rango_max', 'UPDATE') AND (SELECT array_agg(column_name::text ORDER BY column_name::text) FROM information_schema.column_privileges WHERE grantee='plataforma_app' AND table_schema='public' AND table_name='magnitud' AND privilege_type='UPDATE') = ARRAY['histeresis_sugerida','nombre','rango_max','rango_min','umbral_alto_sugerido','umbral_bajo_sugerido'] AND has_column_privilege('plataforma_app', 'magnitud_alias', 'clave', 'INSERT') THEN 'OK    27 catálogo editable: magnitud con rango cierto (CHECK de finitud y orden), forma del código y sugeridos dentro del rango; magnitud_alias (una clave, una magnitud; 8 sembradas); receta_decodificacion y receta_campo (largo copiado por clave foránea compuesta; la receta del campus con sus 3 campos); dispositivo.decodificador como clave foránea (RESTRICT) en vez del CHECK de la 17; la aplicación crea recetas y quita alias solo por fn_crear_receta y fn_quitar_alias (SECURITY DEFINER con search_path fijo, no ejecutables por PUBLIC), no escribe las recetas directo y de magnitud solo actualiza nombre, rango y sugeridos' ELSE 'FALLA 27 falta algo de la migración 27 (columnas o CHECK de magnitud, alias, recetas, clave foránea del decodificador, funciones o permisos)' END;
SELECT CASE WHEN (SELECT is_nullable='NO' AND column_default='true' FROM information_schema.columns WHERE table_schema='public' AND table_name='zona' AND column_name='activo') AND (SELECT count(*) FROM pg_indexes WHERE indexname='uq_zona_sitio_nombre_normalizado')=1 AND has_column_privilege('plataforma_app','zona','nombre','INSERT') AND NOT has_table_privilege('plataforma_app','zona','DELETE') AND NOT has_column_privilege('plataforma_app','sitio','codigo','UPDATE') THEN 'OK    28 zona.activo, nombre único normalizado por sitio y permisos por columna sin DELETE' ELSE 'FALLA 28 zona.activo, índice normalizado o permisos de sitio y zona' END;
SQL
exige "$VT"/mig.txt "${PIPESTATUS[0]}" 28 || fallos=$((fallos+1))
# Toda migración en disco debe tener su comprobación arriba: una 08 nueva sin comprobación falla aquí,
# no solo por el conteo en prosa del paso 2g.
sin_chequeo=$(ls plataforma/db/init/ | grep -oE '^[0-9]{2}' | while read -r nn; do grep -q "^OK    $nn \|^FALLA $nn " "$VT"/mig.txt || echo "$nn"; done)
[ -z "$sin_chequeo" ] || { echo "FALLA migraciones sin comprobación en este paso: $sin_chequeo"; fallos=$((fallos+1)); }

paso "2b. Número de entidades: la base manda; informe y estado deben decir el mismo número"
n=$(docker compose -f plataforma/docker-compose.yml exec -T timescaledb psql -U plataforma -d plataforma -tA -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
# Sin número no hay comparación: antes, con n vacío, «\b entidades» calzaba con cualquier número.
[[ "$n" =~ ^[0-9]+$ ]] || { echo "FALLA no se pudo contar las tablas en la base (¿base inalcanzable?)"; fallos=$((fallos+1)); n=NINGUNO; }
for f in informe-oficial/cap-diseno.tex informe-oficial/figuras/modelo-datos.tex informe-oficial/anexos/e-seguimiento.tex docs/12-estado-etapa2.md docs/08-modelo-datos.md; do
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
# 19/11/2026: las pruebas se excluyen por nombre de archivo. Antes un `grep -v spec` filtraba la SALIDA de `grep -h -o`, que no lleva el nombre
# del archivo, así que no excluía nada: `zip.get('LEEME.txt')` de una prueba salió como si el código leyera la variable LEEME.
leidas=$(grep -rhoE "(\.get(OrThrow)?(<[^>]+>)?\(\s*['\"\`]|process\.env\.)[A-Z_]+" plataforma/backend/src --include=*.ts --exclude='*.spec.ts' | grep -oE "[A-Z_]{3,}$" | grep -vx TZ | sort -u)
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
# 28/10 (revisión de privacidad): tampoco se puede distinguir a máquina la hora de un evento automático (la falla del sensor a las
# 15:24 en la corrida de 24 h, que no dice nada) de la de una acción manual (el inicio de la corrida, los cuelgues provocados):
# esas tres se quitaron a mano de docs/14 y docs/16; al escribir una hora fuera de una bitácora, preguntarse si la acción fue de la persona.
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
# 19/11/2026: un número de sección de una norma con cuatro niveles (§4.3.9.4 de la especificación ZIP, §22.9.2.19 de ECMA-376) tiene la
# forma de una dirección; con «§» delante es una sección y no cuenta. Se captura el «§» para distinguirlo; sin él, la regla es la de siempre.
git grep --untracked -I -n -o -E '(§)?\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' -- ':!privado' ':!historico' ':!*.pdf' > "$VT"/ipv4.txt 2>&1; rc=$?
total=$(wc -l < "$VT"/ipv4.txt); ajenas=$(grep -vE ':(§[0-9.]+|127\.[0-9]+\.[0-9]+\.[0-9]+|0\.0\.0\.0|192\.0\.2\.[0-9]+|198\.51\.100\.[0-9]+|203\.0\.113\.[0-9]+)$' "$VT"/ipv4.txt)
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

paso "2f5. Sin identificadores de 16 hexadecimales con forma de dato real (DevEUI, EUI-64) en archivos versionados o nuevos: solo los sintéticos de la lista (16/11/2026)"
# Un DevEUI o un EUI-64 son 16 hexadecimales, y uno de ejemplo con forma de dato real se trata como real (regla de las MAC de ejemplo del 22/09).
# Se buscan cadenas de EXACTAMENTE 16 hexadecimales seguidos (sin otro hexadecimal al lado: una huella más larga, un UUID o un color no las contienen;
# sí cuentan las pegadas a «0x», a «_» o a una letra) y las de ocho pares separados por «:» o «-», que es como suele escribirse un EUI-64, en
# todo archivo de texto que entraría al repositorio (archivos_repo; `grep -I` salta los binarios, como los PDF). Los lockfiles se revisan igual: hoy
# no dan falsos positivos. Lo permitido es esta lista corta, con su origen; ampliarla es decidir que ese valor no identifica a nadie:
#   0000000000000001 0102030405060708 0101010101010101 0202020202020202 ffffffffffffffff aaaaaaaaaaaaaaaa a1b2c3d4e5f60708 abcdef1234567890
#       sintéticos con patrón evidente (el 0101… es el del ejemplo oficial de ChirpStack; 0000…01, 0102…08, 0202…, ffff…, aaaa… y a1b2… los de las pruebas)
#   10e2073a01080063   el identificador del ejemplo textual de RFC 8428 §5.1 (se cita como lo trae la RFC, no se inventa otro)
#   123418138100007b 1234181158010037   mensajes Contact ID de ejemplo de los documentos históricos (16 dígitos de DC-05 con su suma de verificación, no un EUI)
# Lo hallado se muestra enmascarado (archivo:línea y 4 caracteres): si fuera real, no se repite entero en pantalla.
PERMITIDOS_16HEX=" 0000000000000001 0102030405060708 0101010101010101 0202020202020202 ffffffffffffffff aaaaaaaaaaaaaaaa a1b2c3d4e5f60708 abcdef1234567890 10e2073a01080063 123418138100007b 1234181158010037 "
archivos16=$(archivos_repo | while IFS= read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done)
n16=$(grep -c . <<<"$archivos16")
crudas16=$(tr '\n' '\0' <<<"$archivos16" | xargs -0 grep -IHnoP '(?<![0-9a-fA-F])[0-9a-fA-F]{16}(?![0-9a-fA-F])|(?<![0-9a-fA-F:-])(?:[0-9a-fA-F]{2}[:-]){7}[0-9a-fA-F]{2}(?![0-9a-fA-F:-])' 2>/dev/null)
total16=$(grep -c . <<<"$crudas16")
ajenos16=$(while IFS= read -r l; do [ -z "$l" ] && continue; f16=${l%%:*}; r16=${l#*:}; v=${r16#*:}; v=${v//[:-]/}; v=${v,,}; case "$PERMITIDOS_16HEX" in *" $v "*) ;; *) echo "$f16:${r16%%:*}: ${v:0:4}…(16)";; esac; done <<<"$crudas16")
if [ "$n16" -lt 100 ] || [ "$total16" -lt 1 ]; then echo "FALLA revisó $n16 archivos y encontró $total16 cadenas de 16 hexadecimales: algo no se leyó (no revisó nada)"; fallos=$((fallos+1))
elif [ -n "$ajenos16" ]; then echo "FALLA cadenas de 16 hexadecimales con forma de dato real (no están en la lista de sintéticos del paso):"; echo "$ajenos16" | cut -c1-140 | sed 's/^/  /'; fallos=$((fallos+1))
else echo "OK    $n16 archivos revisados; $total16 cadenas de 16 hexadecimales, todas de la lista de sintéticos"; fi

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
# 11/11/2026 (corrección del bloque de cuenta): docs/20 §11 decía «…@ejemplo.invalid» y la función escribe otro dominio. El dominio que
# cita la §11 para el correo anonimizado debe ser el de fn_anonimizar_usuario (migración 24). Probado plantando «@ejemplo.invalid».
dom_fn=$(grep -oE "@[a-z0-9.-]+\.invalid'" plataforma/db/init/24-perfiles-cuenta-legal.sql | head -1 | tr -d "'")
dom_doc=$(awk '/^## 11\. /,/^## 12\. /' docs/20-sesion-usuarios-y-permisos.md | grep -oE 'baja-[^`]*@[a-z0-9.-]+\.invalid' | grep -oE '@[a-z0-9.-]+\.invalid' | sort -u)
if [ -z "$dom_fn" ] || [ -z "$dom_doc" ]; then echo "FALLA no encontré el dominio del correo anonimizado (función: «$dom_fn», docs/20 §11: «$dom_doc»)"; fallos=$((fallos+1))
elif [ "$dom_doc" != "$dom_fn" ]; then echo "FALLA docs/20 §11 cita $(echo $dom_doc) y fn_anonimizar_usuario escribe $dom_fn"; fallos=$((fallos+1))
else echo "OK    el correo anonimizado que cita docs/20 §11 usa el dominio de fn_anonimizar_usuario ($dom_fn)"; fi

paso "2g2. Matriz del contrato de trama: los C-NN de contrato.spec.ts == los de la tabla de docs/16, y las cifras citadas (total y por grupo) son las de la tabla (16/11/2026)"
# 16/11: docs/16 decía 94 reglas y su tabla no listaba C-96 ni C-99 con 98 en la prueba; los encabezados por grupo decían 18, 12 y 12 con 19, 13 y 13.
# La MATRIZ de contrato.spec.ts manda; este paso compara su conjunto de identificadores con el de la tabla de docs/16 (la sección titulada «Matriz del
# contrato de trama», entre «### La matriz» y el siguiente «###»), el número de filas de cada grupo con el «(N reglas)» de su encabezado, y el total con
# cada «matriz … N reglas» de los documentos y el informe. Las bitácoras son instantáneas fechadas y no se comparan.
python3 -I - <<'PY' || fallos=$((fallos+1))
import re, sys, pathlib
spec = pathlib.Path('plataforma/backend/src/recepcion/contrato.spec.ts').read_text(encoding='utf-8')
filas_spec = re.findall(r"^  \{ id: '(C-\d+)', grupo: '([a-g])'", spec, re.M)
ids_spec = [i for i, _ in filas_spec]
doc = pathlib.Path('docs/16-informe-de-pruebas.md').read_text(encoding='utf-8')
sec = re.search(r'(?ms)^## \d+\. Matriz del contrato de trama.*?(?=^## )', doc + '\n## fin\n')
mat = re.search(r'(?ms)^### La matriz\n(.*?)(?=^### |\Z)', sec.group(0)) if sec else None
if len(ids_spec) < 50 or mat is None:
    print(f'FALLA no leí la matriz: {len(ids_spec)} identificadores en contrato.spec.ts, tabla de docs/16 {"encontrada" if mat else "no encontrada"} (no revisó nada)'); sys.exit(1)
malos, grupo, filas_doc, cuenta, citado = [], None, [], {}, {}
for linea in mat.group(1).splitlines():
    g = re.match(r'\*\*\(([a-g])\) .*\*\* \((\d+) reglas\)', linea)
    if g: grupo = g.group(1); citado[grupo] = int(g.group(2)); continue
    f = re.match(r'\| (C-\d+) \|', linea)
    if f: filas_doc.append((f.group(1), grupo)); cuenta[grupo] = cuenta.get(grupo, 0) + 1
ids_doc = [i for i, _ in filas_doc]
for i in sorted(set(ids_spec) - set(ids_doc)): malos.append(f'{i} está en la MATRIZ de contrato.spec.ts y no en la tabla de docs/16')
for i in sorted(set(ids_doc) - set(ids_spec)): malos.append(f'{i} está en la tabla de docs/16 y no en la MATRIZ de contrato.spec.ts')
for i in sorted({i for i in ids_doc if ids_doc.count(i) > 1}): malos.append(f'{i} aparece más de una vez en la tabla de docs/16')
grupos_spec = {}
for i, g in filas_spec: grupos_spec[g] = grupos_spec.get(g, 0) + 1
for g in sorted(set(grupos_spec) | set(cuenta) | set(citado)):
    if not (grupos_spec.get(g) == cuenta.get(g) == citado.get(g)):
        malos.append(f'grupo ({g}): {grupos_spec.get(g)} reglas en la MATRIZ, {cuenta.get(g)} filas en la tabla y el encabezado dice {citado.get(g)}')
total = len(ids_spec); n_citas = 0
fuentes = [*sorted(pathlib.Path('docs').glob('*.md')), *sorted(pathlib.Path('informe-oficial').rglob('*.tex')), *map(pathlib.Path, ('README.md', 'RESUMEN.md', 'PLAN-MAESTRO.md'))]
for f in fuentes:
    if f.name.startswith('12-') or not f.is_file(): continue
    t = re.sub(r'\s+', ' ', f.read_text(encoding='utf-8'))
    for m in re.finditer(r'matriz(?: del contrato de trama)?\**:? (?:de |con |tiene )?\**(\d+)\** reglas', t, re.I):
        n_citas += 1
        if int(m.group(1)) != total: malos.append(f'{f}: «{m.group(0)}»; la MATRIZ tiene {total}')
if n_citas < 3: malos.append(f'solo {n_citas} cita(s) «matriz … N reglas» en docs y en el informe (se esperan al menos 3): ¿cambió la redacción? (no revisó esa parte)')
for m in malos: print('FALLA', m)
if not malos: print(f'OK    {total} reglas: la MATRIZ y la tabla de docs/16 tienen los mismos identificadores, {len(grupos_spec)} grupos con su cifra, y {n_citas} cita(s) dicen {total}')
sys.exit(1 if malos else 0)
PY

paso "2h. Rutas HTTP citadas en prosa (glosario, docs/10, docs/12, docs/15) == rutas reales del OpenAPI"
# Hallazgo del 26/09: el glosario citaba GET /mediciones, ruta que nunca existió en el backend.
rutas_reales=$(jq -r '.paths|keys[]' plataforma/backend/openapi.json | sed -E 's/\{[^}]*\}/{p}/g' | sort -u)
# Las figuras (.mmd, fuente en docs/10) también citan rutas y antes no se revisaban (27/09). Se compara la RUTA,
# no los parámetros de consulta (`?bucket=15m` en vez de `intervalo` pasó y se vio leyendo la figura). Una ruta
# marcada «(Etapa 3)», «(Etapa 4)» o «Propuesta» en la misma línea está diseñada, no implementada: se acepta (docs/19 cita
# así las rutas que el panel necesitará). 12/10: una ruta que termina en parámetro (`/x/{id}`) perdía la llave final al
# quitar la `}` de un \texttt{…} y fallaba siempre; ahora el parámetro se protege antes de limpiar el final.
rutas_citadas=$(grep -rhE '(GET|POST|PUT|PATCH|DELETE) /[a-zA-Z0-9_{}/.\\-]*' informe-oficial docs --include=*.tex --include=*.md --include=*.mmd --include=*.drawio \
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

paso "2h2. Conteo de rutas y operaciones citado en docs/10 (la API) == openapi.json"
# 11/11/2026: docs/10 decía «17 rutas REST (23 operaciones) … 18 rutas y 24 operaciones» con 26 rutas servidas; nadie lo recalculaba.
# Se compara la frase vigente de docs/10 (las cifras fechadas de docs/16 son fotos de su día y no se tocan). DOC10 solo existe para
# plantar una cifra vieja en una copia y ver que esto falla.
doc10="${DOC10:-docs/10-arquitectura.md}"
r_total=$(jq '.paths|length' plataforma/backend/openapi.json)
o_total=$(jq '[.paths[]|keys[]|select(test("^(get|post|put|patch|delete)$"))]|length' plataforma/backend/openapi.json)
cita=$(grep -oE '[0-9]+ rutas REST \([0-9]+ operaciones|contrato OpenAPI \([0-9]+ rutas y [0-9]+ operaciones contando' "$doc10" | grep -oE '[0-9]+' | tr '\n' ' ')
esperado="$((r_total-1)) $((o_total-1)) $r_total $o_total "
if [ "$cita" = "$esperado" ]; then echo "OK    docs/10 cita $((r_total-1)) rutas REST ($((o_total-1)) operaciones) y $r_total rutas y $o_total operaciones con /eventos, como openapi.json"
else echo "FALLA docs/10 cita «${cita:-nada}» y openapi.json da «$esperado» (rutas REST, operaciones REST, rutas y operaciones con /eventos)"; fallos=$((fallos+1)); fi

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
# 25/11/2026 (docs/11 §7; docs/16 §102): con la credencial de un equipo se podía tomar la sesión persistente del backend eligiendo su
# identificador de cliente. Control: `use_username_as_clientid true` en CADA listener de la pila (vale por listener); el banco la omite
# a propósito, porque rechazaría a los emulados anónimos, y lo declara en su archivo. Defensa en profundidad: los roles dispositivo y
# pasarela niegan recibir lo ajeno. La prueba en ejecución es el paso 2i2; esto es la guardia barata del texto.
# Por bloque, no por conteo: cada `listener` hasta el siguiente debe traer la opción («per-listener basis», mosquitto.conf(5)); dos
# líneas bajo un mismo listener, o una antes del primero, no cubren a otro listener. Manda el ÚLTIMO valor del bloque (un `false`
# posterior anula el `true`), y un `include_dir` o `include` hace fallar: podría sumar un listener que esta guardia no ve.
bl=$(awk '/^[[:space:]]*listener[[:space:]]/ { if (n) print (ok ? "si" : "no"); n++; ok = 0; next }
  n && /^[[:space:]]*use_username_as_clientid[[:space:]]+true[[:space:]]*$/ { ok = 1 }
  n && /^[[:space:]]*use_username_as_clientid[[:space:]]+false[[:space:]]*$/ { ok = 0 }
  END { if (n) print (ok ? "si" : "no") }' "$MC/mosquitto.conf")
nl=$(grep -c . <<<"$bl"); nsin=$(grep -cx no <<<"$bl")
if grep -qE '^[[:space:]]*include(_dir)?[[:space:]]' "$MC/mosquitto.conf"; then
  echo "FALLA mosquitto.conf incluye otros archivos (include/include_dir): podrían sumar un listener sin use_username_as_clientid que esta guardia no ve"; fallos=$((fallos+1))
elif [ -n "$bl" ] && [ "$nsin" = 0 ]; then echo "OK    mosquitto.conf: los $nl listener(s) traen use_username_as_clientid true en su bloque, como último valor (nadie toma la sesión de otro usuario)"
else echo "FALLA mosquitto.conf: $nsin de $nl listener(s) sin use_username_as_clientid true en su bloque: con la credencial de un equipo se toma la sesión del backend (docs/11 §7)"; fallos=$((fallos+1)); fi
# El texto no basta: use_username_as_clientid «not reloaded on reload signal» (mosquitto.conf(5)), hay que reiniciar el broker. La
# comparación vive en config_cargada (lib-dynsec.sh, la misma del inicializador): aquí solo POR FECHA (arranque del contenedor contra
# la última modificación del archivo), porque el verificador no da órdenes al plugin; el inicializador suma la prueba en vivo.
r_cc=0; m_cc=$(cd plataforma && . pruebas/lib-dynsec.sh && config_cargada mosquitto/config/mosquitto.conf) || r_cc=$?
if [ "$r_cc" = 0 ]; then echo "OK    el broker de la pila arrancó después de la última modificación de mosquitto.conf (por fecha)"
elif [ "$r_cc" = 1 ]; then echo "FALLA el broker de la pila no cargó mosquitto.conf → cd plataforma && docker compose restart mosquitto && bash pruebas/broker-inicializar.sh --roles"; echo "$m_cc" | sed 's/^/  /'; fallos=$((fallos+1))
else echo "──    no hay broker de la pila corriendo: no se comprueba si cargó mosquitto.conf (el bloque de arriba ya exige la pila)"; fi
# Nadie se conecta como el usuario de recepción ni como el de administración del backend: con el usuario como identificador, un
# cliente `backend` con sesión limpia expulsa al backend y le borra la sesión y la cola (docs/16 §102), y uno `backend-admin` expulsa
# su conexión de administración. Ve -u, --username, con espacio, «=» o pegado, con o sin comillas, en archivos rastreados Y en los
# nuevos sin rastrear (--untracked). No ve un usuario que llega por variable (-u "$U"). Fuera del laboratorio con broker propio
# (lab-dynsec-anonimos.sh), ninguna guía ni guion lo hace. Plantado el 25/11/2026 con cada forma y en un archivo sin rastrear.
comoback=$(git grep --untracked -nE -- '(^|[^-[:alnum:]_])(-u|--username)[[:space:]=]*["'"'"']?backend(-admin)?([^-[:alnum:]_]|$)' -- '*.md' '*.sh' ':!plataforma/pruebas/lab-dynsec-anonimos.sh')
if [ -z "$comoback" ]; then echo "OK    ninguna guía ni guion (rastreado o nuevo) se conecta al broker como backend ni como backend-admin (fuera del laboratorio con broker propio)"
else echo "FALLA se conecta como backend o backend-admin (expulsa esa conexión del backend; con backend, le borra la cola): usar un cliente de descarte"; echo "$comoback" | sed 's/^/  /'; fallos=$((fallos+1)); fi
BC=plataforma/pruebas/banco/mosquitto/mosquitto.conf
if ! grep -qE '^\s*use_username_as_clientid\s+true' "$BC" && grep -qE '^\s*allow_anonymous\s+true' "$BC" && grep -q 'SEGUNDA diferencia deliberada' "$BC"; then
  echo "OK    el banco omite use_username_as_clientid y lo declara (sus emulados son anónimos; la configuración del servidor la prueba el paso 2i2)"
else echo "FALLA $BC: o trae use_username_as_clientid (rechazaría a los emulados anónimos) o dejó de declarar la diferencia"; fallos=$((fallos+1)); fi
python3 -I - plataforma/pruebas/lib-dynsec.sh <<'PY' || fallos=$((fallos+1))
import re, sys
t = re.sub(r'\\\n\s*', ' ', open(sys.argv[1], encoding='utf-8').read())
malos = []
for rol in ('dispositivo', 'pasarela'):
    m = re.search(rf'^\s*rol {rol}\s(.*?)\|\| return 1', t, re.M)
    if not m: malos.append(f'no encontré «rol {rol} …» en roles_del_sistema')
    elif not re.search(r"publishClientReceive '#' deny", m.group(1)): malos.append(f'el rol {rol} no niega recibir lo ajeno (publishClientReceive \'#\' deny)')
m = re.search(r'^\s*rol pasarela\s(.*?)\|\| return 1', t, re.M)
if m and not re.search(r"publishClientReceive 'sitio/\+/pasarela/%u/\+/command/#' allow", m.group(1)): malos.append('la pasarela perdió su permiso de recibir sus comandos')
for x in malos: print('FALLA', x)
if not malos: print("OK    lib-dynsec.sh: dispositivo y pasarela niegan recibir lo ajeno; la pasarela conserva sus comandos (prioridad mayor)")
sys.exit(1 if malos else 0)
PY
# El broker de la pila local se reinicializa a mano (no lo hace el verificador): si todavía no tiene los roles nuevos o el administrador
# de los guiones, se avisa sin fallar; el remedio es idempotente y no rota claves.
if [ -n "$n" ] && ! grep -qF '"username":"admin-guiones"' <<<"$n"; then
  echo "AVISO el broker de la pila no tiene admin-guiones: los guiones administran como backend-admin y expulsan una vez su conexión del backend → bash plataforma/pruebas/broker-inicializar.sh --roles"
fi

paso "2i2. Sesión del broker: con la credencial de un dispositivo nadie toma la sesión persistente del backend (broker desechable con la configuración del servidor y los roles reales; docs/11 §7)"
# 25/11/2026 (docs/16 §102): tres ataques (heredar la cola, expulsar y borrar con sesión limpia, pelear por el identificador) contra un
# cliente con el rol del backend; la víctima debe conservar su sesión y recibirlo todo, y el registro del broker anotar al atacante con
# su propio usuario; además verificar_clave y la rotación de los dos administradores. Plantado sin use_username_as_clientid: fallan 7
# comprobaciones del cliente y 3 del registro. No toca la pila: el
# broker es un contenedor propio (tmp-sesion-prueba-<pid>) que se borra al salir. Sin docker o sin node, sale con 3 y se OMITE.
bash plataforma/pruebas/broker-sesion.sh > "$VT/sesion.txt" 2>&1; r=$?
grep -E '^(OK|FALLA|SESIÓN|ATAQUES|omitida|──)|bloque\(s\)|comprobación' "$VT/sesion.txt"
if [ "$r" = 3 ]; then omitidos="$omitidos 2i2"; elif [ "$r" != 0 ]; then fallos=$((fallos+1)); fi

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

paso "2z. Toda variable RETENCION_*, METRICA_BROKER_*, TOPE_*, PROXY_SECRETO, CLAVE_TEMPORAL_HORAS, RESPONSABLE_*, CODIGO_FUENTE_URL, PUBLICO_* y SUPERVISION_INTERVALO_S del .env.example llega al backend por el compose (14/10; topes y secreto del proxy, 17/10; vigencia de la clave temporal, 08/11; responsable y código fuente, 11/11; vista pública, 17/11; período del barrido, 20/11)"
# Hasta el 14/10 el compose no las reenviaba: cambiarlas en el .env no tenía efecto y nadie lo notaba. El 20/11, lo mismo con
# SUPERVISION_INTERVALO_S: solo la fijaba el override de desarrollo y en el servidor no llegaba.
faltan=$(grep -oE '^#?((RETENCION|METRICA_BROKER|TOPE|RESPONSABLE|PUBLICO)_[A-Z_]+|PROXY_SECRETO|CLAVE_TEMPORAL_HORAS|CODIGO_FUENTE_URL|SUPERVISION_INTERVALO_S)' plataforma/.env.example | tr -d '#' | sort -u | while read -r v; do grep -qE "^\s+$v:" plataforma/docker-compose.yml || echo "$v"; done)
n=$(grep -cE '^#?((RETENCION|METRICA_BROKER|TOPE|RESPONSABLE|PUBLICO)_[A-Z_]+|PROXY_SECRETO|CLAVE_TEMPORAL_HORAS|CODIGO_FUENTE_URL|SUPERVISION_INTERVALO_S)=' plataforma/.env.example)
if [ "$n" -lt 18 ]; then echo "FALLA solo $n variables RETENCION_/METRICA_BROKER_/TOPE_/RESPONSABLE_/PUBLICO_/PROXY_SECRETO/CLAVE_TEMPORAL_HORAS/CODIGO_FUENTE_URL/SUPERVISION_INTERVALO_S en .env.example: revisó de menos"; fallos=$((fallos+1))
elif [ -n "$faltan" ]; then echo "FALLA declaradas en .env.example pero el compose no las pasa al backend: $(echo $faltan)"; fallos=$((fallos+1))
else echo "OK    las $n variables de limpieza, cola, topes, secreto del proxy, vigencia de la clave temporal, responsable, código fuente, vista pública y período del barrido llegan al backend por el compose"; fi

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

paso "2l. Topes del broker (docs/11 §4; docs/10 §8.4 puntos 43 y 57): max_packet_size <= 64 KiB; cola 10000 mensajes / 20 MB y max_connections 1200 en la pila y el banco; autosave 300 s; el backend lee el mismo tope"
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
  # 01/11: sin tope, una avalancha de conexiones agota la memoria del broker (plantado con max_connections 3: docs/16 §57).
  mc=$(opcion_conf "$conf" max_connections)
  if [ "$mc" = 1200 ]; then echo "OK    $conf: max_connections 1200 (docs/10 §8.4 punto 57)"
  else echo "FALLA $conf: max_connections=${mc:-ausente} (esperado 1200; docs/10 §8.4 punto 57)"; fallos=$((fallos+1)); fi
  # El tope es por listener: cada `listener` lleva su max_connections (revisión del 01/11).
  nl=$(grep -cE '^\s*listener\s' "$conf"); nm=$(grep -cE '^\s*max_connections\s' "$conf")
  if [ "$nm" -ge "$nl" ]; then echo "OK    $conf: $nl listener(s), $nm max_connections (el tope es por listener)"
  else echo "FALLA $conf: $nl listener(s) y $nm max_connections: un listener sin tope"; fallos=$((fallos+1)); fi
done
# 01/11: con los 1024 descriptores por defecto del contenedor, el tope de 1200 no se alcanza (EMFILE antes del «denied»; /proc/1/limits
# del broker en marcha lo mostró en la revisión). El compose fija ulimits nofile; se exige al menos 2 × max_connections.
nofile=$(docker compose -f plataforma/docker-compose.yml -f plataforma/proxy/compose.proxy.yml --env-file plataforma/.env.example config --format json 2>/dev/null \
  | python3 -I -c "import sys,json; u=json.load(sys.stdin)['services']['mosquitto'].get('ulimits',{}).get('nofile'); print(u if isinstance(u,int) else (u or {}).get('soft',0))" 2>/dev/null)
if [ "${nofile:-0}" -ge 2400 ] 2>/dev/null; then echo "OK    broker con ulimits nofile $nofile (>= 2 × max_connections)"
else echo "FALLA broker sin ulimits nofile suficiente (${nofile:-ausente}): con 1024 descriptores el tope de 1200 no se alcanza (docs/10 §8.4 punto 57)"; fallos=$((fallos+1)); fi
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

paso "2o. Informe: todo párrafo que nombra ChirpStack dice de qué ruta habla: opcional (ruta A) o externo (ruta C), salvo el de OpenRemote (docs/10 §8.4 puntos 2 y 45)"
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
# (13/11: el patrón pedía exactamente dos dígitos y una ficha de tres pasó doce veces en ocho archivos; ahora, dos o tres.)
# cita lo público: la sección de docs/10 §8.4 o de docs/11 donde quedó la decisión.
# 15/10: lo mismo con los pendientes privados (la palabra y su número): siete referencias en seis archivos, quitadas y vigiladas; y
# con el «registro» de evidencia privado: lo público cita la URL de la fuente, no el registro donde se anotó.
git grep --untracked -n -E 'ficha D-[0-9]{2,3}|decisi[oó]n D-[0-9]{2,3}|\bD-[0-9]{2,3}\b|\bpendientes? [0-9]{1,3}\b|registro privad[o]|privad[o]/[A-Z]' -- ':!privado' ':!historico' > "$VT"/fichas.txt 2>&1; rc=$?
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

paso "2q. Auditoría de dependencias: cada aviso ignorado (audit.ignore de pnpm-workspace.yaml) sigue vigente y sin versión corregida (docs/11 §4)"
# 08/10: braces no tenía parche y la auditoría lo ignora (la leen igual el CI y el portátil). Una excepción que nadie revisa
# queda para siempre: este paso consulta la base de avisos de GitHub y falla el día que el aviso tenga versión corregida.
# 26/10: también falla si GitHub retiró el aviso (`withdrawn_at`): el de braces se retiró el 23/10 y el paso siguió en AVISO.
# Se leen los GHSA fuera de comentarios, así vale con la clave vigente y con el nombre antiguo (`auditConfig.ignoreGhsas`).
WS="${VERIFICAR_WORKSPACE:-plataforma/backend/pnpm-workspace.yaml}"
ign=$(grep -v '^[[:space:]]*#' "$WS" 2>/dev/null | grep -oE 'GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}' | sort -u)
if [ ! -f "$WS" ]; then echo "FALLA no existe $WS: no se pudo revisar la auditoría"; fallos=$((fallos+1))
elif [ -z "$ign" ]; then echo "OK    la auditoría no ignora ningún aviso"
elif ! command -v gh >/dev/null; then echo "omitida: gh no está en el PATH"; omitidos="$omitidos 2q"
else
  for g in $ign; do
    if ! r=$(gh api "/advisories/$g" --jq '(.withdrawn_at // "") + "|" + ([.vulnerabilities[].first_patched_version // empty] | join(", "))' 2>/dev/null); then
      echo "omitida: no se pudo consultar $g (¿sin red?)"; omitidos="$omitidos 2q"
    elif [ -n "${r%%|*}" ]; then echo "FALLA $g fue retirado por GitHub (${r%%|*}): ya no es un aviso; quitar la excepción de pnpm-workspace.yaml y de docs/11 §4"; fallos=$((fallos+1))
    elif p=${r#*|}; [ -n "$p" ]; then echo "FALLA $g ya tiene versión corregida ($p): actualizar y quitar la excepción de pnpm-workspace.yaml y de docs/11 §4"; fallos=$((fallos+1))
    else echo "AVISO $g sigue sin versión corregida publicada: excepción vigente, pendiente de resolver (no falla)"; fi
  done
fi

paso "2q2. Auditoría de dependencias como el CI: avisos altos o críticos y estado de la última corrida publicada (docs/11 §4, docs/16 §81)"
# 18/11/2026: el CI quedó rojo dos corridas (117 y 118) en `pnpm audit --audit-level=high` sin que cambiara el lockfile: GitHub dio por
# revisado el 17/11 un aviso de picomatch sin versión corregida y lo retiró el 18/11. Este verificador no corría la auditoría (el 2q solo
# vigila las excepciones declaradas) y dijo «TODO EN CONCORDANCIA» con el CI en rojo. Aquí corren las mismas dos órdenes del CI
# (.github/workflows/verificar.yml) y se mira la última corrida del flujo `verificar` en main. Tres veredictos y nunca verde sin consultar:
# OK, FALLA u omitida (sin pnpm, jq o red, o error del registro). `pnpm audit` sale distinto de 0 tanto con avisos como sin poder consultar,
# así que se decide por el contenido (JSON con `.metadata`), no por el código de salida. Sustituibles para plantar fallas:
# VERIFICAR_AUDITORIA_DIR (carpeta con package.json y lockfile) y VERIFICAR_CI_JSON (lo que devolvería `gh run list --json ...`).
AD="${VERIFICAR_AUDITORIA_DIR:-plataforma/backend}"
if ! command -v pnpm >/dev/null; then echo "omitida: pnpm no está en el PATH; la auditoría no se consultó"; omitidos="$omitidos 2q2"
elif ! command -v jq >/dev/null; then echo "omitida: jq no está en el PATH; la auditoría no se consultó"; omitidos="$omitidos 2q2"
elif [ ! -f "$AD/pnpm-lock.yaml" ]; then echo "FALLA no existe $AD/pnpm-lock.yaml: no se pudo auditar"; fallos=$((fallos+1))
else
  (cd "$AD" && timeout 120 pnpm audit --json) > "$VT/audit-todo.json" 2> "$VT/audit-todo.err"
  (cd "$AD" && timeout 120 pnpm audit --prod --json) > "$VT/audit-prod.json" 2> "$VT/audit-prod.err"
  # Cada archivo se valida por separado y cada conteo debe ser un entero: un archivo vacío o con {"error":…} (por ejemplo, el timeout mató la
  # primera llamada) no puede quedar tapado por el otro, y con un conteo vacío no se sigue (nunca verde ni veredicto a medias).
  n_meta=$(jq -e '.metadata.vulnerabilities | .high + .critical' "$VT/audit-todo.json" 2>/dev/null); n_prod=$(jq -e '.metadata.vulnerabilities | add' "$VT/audit-prod.json" 2>/dev/null)
  n_alto=$(jq -e '[.advisories[]? | select(.severity == "high" or .severity == "critical")] | length' "$VT/audit-todo.json" 2>/dev/null)
  n_otros=$(jq -e '.metadata.vulnerabilities | add - .high - .critical' "$VT/audit-todo.json" 2>/dev/null)
  if ! [[ "$n_meta" =~ ^[0-9]+$ && "$n_prod" =~ ^[0-9]+$ && "$n_alto" =~ ^[0-9]+$ && "$n_otros" =~ ^[0-9]+$ ]]; then
    echo "omitida: la auditoría no devolvió un resultado (¿sin red o registro caído?); no se sabe si hay avisos: $(cat "$VT/audit-todo.err" "$VT/audit-prod.err" 2>/dev/null | tr -s '\n ' ' ' | cut -c1-160)"; omitidos="$omitidos 2q2"
  else
    # El veredicto de todo el árbol es el del CI: `pnpm audit` respeta audit.ignore, así que los avisos exceptuados desaparecen de
    # `.advisories` y de su código de salida, pero `.metadata` los sigue contando (probado con pnpm 12.3.4). Alto o crítico que sigue
    # en `.advisories` = FALLA; el que está en `.metadata` y no en `.advisories` está exceptuado = AVISO. Producción no admite ninguno.
    exc=$(grep -v '^[[:space:]]*#' "$AD/pnpm-workspace.yaml" 2>/dev/null | grep -oE 'GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}' | sort -u | tr '\n' ' ')
    if [ "$n_alto" -gt 0 ]; then
      echo "FALLA $n_alto aviso(s) alto(s) o crítico(s): el CI (pnpm audit --audit-level=high) se pondría en rojo"; fallos=$((fallos+1))
      jq -r '.advisories | to_entries[].value | select(.severity == "high" or .severity == "critical") | "      \(.module_name) · \(.severity) · \(.github_advisory_id // .url) · \(if ((.patched_versions // "") == "" or .patched_versions == "<0.0.0") then "sin versión corregida" else "corregido en " + .patched_versions end)"' "$VT/audit-todo.json"
    elif [ "$n_meta" -gt 0 ]; then
      echo "AVISO $n_meta aviso(s) alto(s) o crítico(s) exceptuado(s) en audit.ignore (${exc:-no se leyó ninguno en $AD/pnpm-workspace.yaml}): el CI no los cuenta; el paso 2q vigila que sigan vigentes"
    fi
    if [ "$n_prod" -gt 0 ]; then
      echo "FALLA producción trae $n_prod aviso(s) (el CI no admite ninguno, ni exceptuado):"; fallos=$((fallos+1))
      jq -r '.advisories[]? | "      \(.module_name) · \(.severity) · \(.github_advisory_id // .url) · \(if ((.patched_versions // "") == "" or .patched_versions == "<0.0.0") then "sin versión corregida" else "corregido en " + .patched_versions end)"' "$VT/audit-prod.json"
      echo "      (los que no aparecen arriba están exceptuados en audit.ignore: ${exc:-ninguno leído})"
    fi
    if [ "$n_meta" -eq 0 ] && [ "$n_prod" -eq 0 ]; then echo "OK    la auditoría no trae avisos altos ni críticos ni de producción ($n_otros aviso(s) menores, solo de desarrollo, no bloquean)"; fi
  fi
fi
# Lo publicado: la última corrida del flujo `verificar` en main. Si el CI está en rojo, el verificador local no puede decir «todo bien».
CJ="${VERIFICAR_CI_JSON:-}"; ci_dicho=
if [ -z "$CJ" ]; then
  CJ="$VT/ci.json"
  if ! command -v gh >/dev/null; then : > "$CJ"; echo "omitida: gh no está en el PATH; no se miró el estado del CI"; omitidos="$omitidos 2q2"; ci_dicho=1
  elif ! gh run list --workflow verificar --branch main --limit 1 --json databaseId,status,conclusion,headSha > "$CJ" 2>"$VT/ci.err"; then
    : > "$CJ"; echo "omitida: no se pudo consultar el CI con gh (¿sin red o sin sesión?)"; omitidos="$omitidos 2q2"; ci_dicho=1
  fi
fi
if [ ! -s "$CJ" ]; then
  # Nunca en silencio: sin respuesta (archivo ausente o vacío) no hay veredicto; si gh ya dijo «omitida» arriba, no se repite.
  if [ -z "${ci_dicho:-}" ]; then echo "omitida: $CJ no existe o está vacío; no se sabe el estado del CI"; omitidos="$omitidos 2q2"; fi
else
  if ! jq -e 'type == "array" and length > 0' "$CJ" >/dev/null 2>&1; then echo "omitida: sin corridas del flujo verificar en main (o respuesta ilegible); no se sabe el estado del CI"; omitidos="$omitidos 2q2"
  else
    ci_id=$(jq -r '.[0].databaseId' "$CJ"); ci_sha=$(jq -r '.[0].headSha[0:7]' "$CJ"); ci_est=$(jq -r '.[0].status' "$CJ"); ci_res=$(jq -r '.[0].conclusion // ""' "$CJ")
    if [ "$ci_est" != "completed" ]; then echo "AVISO la corrida $ci_id del CI (commit $ci_sha) sigue en curso ($ci_est): el estado publicado aún no se conoce"
    elif [ "$ci_res" = "success" ]; then echo "OK    la última corrida del CI en main (corrida $ci_id, commit $ci_sha) terminó en verde"
    elif [ "$ci_res" = "failure" ]; then
      ci_msg="la última corrida del CI en main (corrida $ci_id, commit $ci_sha) terminó en ROJO · verla: gh run view $ci_id --log-failed · relanzarla: gh run rerun $ci_id --failed"
      # --verify: sin él, rev-parse imprime el nombre tal cual cuando no existe y parecería un hash
      loc=$(git rev-parse --verify -q "HEAD^{commit}" 2>/dev/null); pub=$(git rev-parse --verify -q "origin/main^{commit}" 2>/dev/null)
      if [ -z "$loc" ] || [ -z "$pub" ]; then
        echo "AVISO $ci_msg (no se pudo comparar con lo publicado: falta origin/main o esto no es un repositorio)"
      elif git merge-base --is-ancestor HEAD origin/main 2>/dev/null && [ -z "$(git status --porcelain 2>/dev/null)" ]; then
        echo "FALLA $ci_msg (el árbol local ya está publicado y sin cambios: nada local puede arreglarlo)"; fallos=$((fallos+1))
      else echo "AVISO $ci_msg (hay commits o cambios locales por delante: confirmar que lo arreglan antes de publicar)"; fi
    else echo "AVISO la última corrida del CI en main (corrida $ci_id, commit $ci_sha) terminó en «$ci_res»: revisarla (gh run view $ci_id)"; fi
  fi
fi

paso "2r. RNF-15: dependencias de producción del backend con licencia abierta y permisiva (docs/02, RNF-15)"
# 08/10: una dependencia copyleft (GPL, AGPL) dentro del backend obligaría a distribuir el conjunto bajo una licencia
# compatible con la suya y cerraría la opción de una licencia comercial adicional; las de fuente disponible (SSPL, BUSL) no
# son de código abierto (RNF-15) y una desconocida no se puede evaluar. Esta es la lista exacta: lo demás falla y lo decide
# el estudiante. «A OR B» pasa si una de las dos está en la lista; «A AND B», solo si están las dos (08/10: pako, que trae la
# exportación a XLSX, es «MIT AND Zlib»; Zlib, permisiva, entra a la lista el 08/10); los paréntesis se respetan y una
# excepción (WITH) no se evalúa: la decide él. 15/11: PSF-2.0 (argparse 3, que llega con @nestjs/swagger 12) es el acuerdo de la Python
# Software Foundation que ya forma parte de Python-2.0, sin la parte histórica; permisiva y sin pago: entra a la lista el 15/11.
PERMITIDAS='["MIT","ISC","Apache-2.0","BSD-2-Clause","BSD-3-Clause","0BSD","Python-2.0","PSF-2.0","CC0-1.0","Unlicense","BlueOak-1.0.0","Zlib"]'
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

paso "2r2. Avisos de terceros: toda dependencia de producción del lockfile tiene su aviso en panel/public/avisos-de-terceros.txt (docs/21 §7; 11/11/2026)"
# El archivo lo escribe plataforma/backend/generar-avisos-terceros.sh desde `pnpm licenses list --prod --json`; si alguien agrega una dependencia y
# no lo regenera, «Acerca de» mentiría. Plantado el 11/11/2026: sin la línea de svelte, este paso falla con «svelte@… sin aviso».
if ! command -v pnpm >/dev/null || ! command -v node >/dev/null; then echo "omitida: falta pnpm o node"; omitidos="$omitidos 2r2"
else bash plataforma/backend/generar-avisos-terceros.sh --comprobar || fallos=$((fallos+1)); fi

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
# 14/11: docs/16 es un registro fechado: sus secciones anteriores citan la cifra de su día («592 pruebas unitarias» en la del 13/11) y
# aquí fallaban al subir el número, lo que obligaba a redactar la cita de otra forma para pasar. De docs/16 rigen solo la cabecera y la
# última sección, y esas las compara el bloque de abajo (como en 2w4); aquí queda fuera.
citas=$(grep -rnoE '[0-9]+ pruebas unitarias' docs/*.md informe-oficial/*.tex informe-oficial/anexos/*.tex 2>/dev/null | grep -v '^docs/1[26]-')
malas=$(awk -F: -v r="$real" 'NF { split($3, a, " "); if (a[1] != r) print }' <<<"$citas")
if [ "$real" -lt 10 ]; then echo "FALLA contó solo $real pruebas (it( en los *.spec.ts)"; fallos=$((fallos+1))
elif [ -z "$citas" ]; then echo "FALLA ninguna cita «N pruebas unitarias» en docs ni en el informe: ¿cambió la redacción? (no revisó nada)"; fallos=$((fallos+1))
elif [ -n "$malas" ]; then echo "FALLA cifras de pruebas unitarias distintas de $real:"; sed 's/^/  /' <<<"$malas"; fallos=$((fallos+1))
else echo "OK    $real pruebas unitarias; $(grep -c . <<<"$citas") cita(s) en docs e informe coinciden"; fi
# 08/11: las láminas decían «357 pruebas automáticas del backend» y «107 pruebas del panel» con 439 y 154 en el repositorio: se vigilan
# también «N pruebas automáticas» (con o sin «del backend») contra el backend y «N pruebas del panel» contra los it(/test( del panel, en
# docs, informe, anexos y láminas (`\cifra{N}{pruebas …}` se lee como «N pruebas …»). docs/16 es un registro fechado: rige solo su cabecera
# y su última sección (como en 2w4); una cifra fechada «al cierre del tramo N» se respeta.
python3 -I - "$real" <<'PY' || fallos=$((fallos+1))
import re, sys, pathlib
backend = int(sys.argv[1])
panel = sum(len(re.findall(r'(?<![.\w])(?:it|test)\(', p.read_text(encoding='utf-8'))) for p in pathlib.Path('plataforma/backend/panel/src').rglob('*.test.ts'))
fuentes = [*sorted(pathlib.Path('docs').glob('*.md')), *sorted(pathlib.Path('informe-oficial').glob('*.tex')), *sorted(pathlib.Path('informe-oficial/anexos').glob('*.tex')),
           pathlib.Path('informe-oficial/presentacion/presentacion.tex')]
malos, n = [], 0
for f in fuentes:
    if f.name.startswith('12-'): continue
    crudo = f.read_text(encoding='utf-8')
    if f.name.startswith('16-'):
        partes = re.split(r'(?m)^(?=## \d+\. )', crudo); crudo = partes[0] + (partes[-1] if len(partes) > 1 else '')
    t = re.sub(r'\\cifra\{(\d+)\}\{', r'\1 ', re.sub(r'\s+', ' ', crudo))
    for m in re.finditer(r'(\d+) pruebas (automáticas|unitarias)(?: del backend)?|(\d+) pruebas del panel(?! al cierre del tramo)', t):
        n += 1
        if m.group(1) and int(m.group(1)) != backend: malos.append(f'{f}: «{m.group(0)}»; el backend tiene {backend}')
        if m.group(3) and int(m.group(3)) != panel: malos.append(f'{f}: «{m.group(0)}»; el panel tiene {panel}')
for x in malos: print('FALLA', x)
if n == 0: print('FALLA ninguna cita «N pruebas automáticas/del panel»: ¿cambió la redacción? (no revisó nada)'); sys.exit(1)
if not malos: print(f'OK    {n} cita(s) de pruebas automáticas o del panel (láminas incluidas): {backend} del backend y {panel} del panel')
sys.exit(1 if malos else 0)
PY
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
# 20/11: las versiones que Trivy no ve (el servidor PostgreSQL compilado de la base y el binario de Node del backend) las compara
# escanear-imagenes.sh contra lo publicado; aquí, sin red, se prueba su lógica con casos plantados (8 de PostgreSQL, 6 de Node).
for q in pg:8 node:6; do
  o=$(bash plataforma/pruebas/escanear-imagenes.sh --probar-${q%%:*}); r=$?; n=$(grep -c '^OK' <<<"$o")
  if [ "$r" -eq 0 ] && [ "$n" -eq "${q##*:}" ]; then echo "OK    escanear-imagenes.sh --probar-${q%%:*}: $n de ${q##*:} casos"
  else echo "FALLA escanear-imagenes.sh --probar-${q%%:*}: salida $r, $n de ${q##*:} casos"; grep -v '^OK' <<<"$o" | head -3; fallos=$((fallos+1)); fi
done

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
# 05/11: la frase se reescribió para un lector sin contexto («En la Etapa~3, 13 de 17 elementos están hechos (69 de 88~h) y 4 parciales
# (19~h). En el núcleo, 25 de 34 (126 de 168~h, 75 %) y 4 parciales (20~h); en el backlog entero, 37 de 66 elementos (56 %)»): los
# pendientes de la etapa se escriben solo si los hay («, y N pendientes (H~h)»), y el backlog entero también se compara con las filas.
m = re.search(r'En la Etapa~3, (\d+) de (\d+) elementos están hechos \((\d+) de (\d+)~h\) y (\d+) parciales \((\d+)~h\)(?:, y (\d+) pendientes? \((\d+)~h\))?\. En el núcleo, (\d+) de (\d+) \((\d+) de (\d+)~h, (\d+)\\,\\%\) y (\d+) parciales \((\d+)~h\); en el backlog entero, (\d+) de (\d+) elementos \((\d+)\\,\\%\)', tex)
if not m: malos.append('informe (cap4.tex): no encontré la frase del seguimiento de la Etapa 3 (¿cambió la redacción?)')
else:
    n, b = cuenta(True), cuenta(False)
    real = (e3['✅'][0], len(f18), e3['✅'][1], sum(h for h, _ in f18.values()), *e3['🟡'], *e3['⬜'], n[0], n[1], n[2], n[3], n[4], n[5], n[6], b[0], b[1], b[4])
    dicho = tuple(int(x) if x is not None else 0 for x in m.groups())  # sin «pendientes» en la frase = 0 elementos y 0 h
    if dicho != real: malos.append(f'informe (cap4.tex): dice {dicho}; las filas dan {real} (Etapa 3: hechos, total, h hechas, h totales, parciales, h, pendientes, h; núcleo: hechos, total, h, h, %, parciales, h; backlog: hechos, total, %)')
# 24/10: cap-pruebas.tex repetía el porcentaje del núcleo (65 %) y nadie lo comparaba; quedó viejo al cerrar HU-19.
cp = re.sub(r'\s+', ' ', open('informe-oficial/cap-pruebas.tex', encoding='utf-8').read())
mp = re.findall(r'núcleo (?:demostrable|mínimo)(?: \(OE4\))? está hecho en un (\d+)\\,\\%', cp)  # 05/11: un solo nombre para el núcleo («núcleo mínimo»)
if len(mp) != 1: malos.append(f'informe (cap-pruebas.tex): esperaba una frase «el núcleo mínimo está hecho en un N %», hay {len(mp)}')
elif int(mp[0]) != cuenta(True)[4]: malos.append(f'informe (cap-pruebas.tex): dice {mp[0]} % del núcleo; las filas dan {cuenta(True)[4]} %')
# 09/11: la conclusión y el resumen repetían otro porcentaje (75 frente a 78): se comparan también.
for f in ('informe-oficial/conclusion.tex', 'informe-oficial/resumen.tex'):
    tx = re.sub(r'\s+', ' ', open(f, encoding='utf-8').read())
    for v in re.findall(r'(\d+)\\,\\% del núcleo', tx):
        if int(v) != cuenta(True)[4]: malos.append(f'informe ({f.split("/")[-1]}): dice {v} % del núcleo; las filas dan {cuenta(True)[4]} %')
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
# 05/11: el capítulo cita el conteo en una celda acortada del cuadro de pruebas («46 de 46 del banco LoRaWAN»): se acepta esa forma además de «comprobaciones».
rango=$(awk '/^  lorawan\)/{f=1} f{print} f && /echo "LORAWAN OK"/{exit}' plataforma/pruebas/banco/banco.sh)
nl=$(grep -o ' ok "' <<<"$rango" | wc -l)
if ! grep -q 'echo "LORAWAN OK"' <<<"$rango"; then echo "FALLA no encontré el final del caso lorawan en banco.sh"; fallos=$((fallos+1))
elif ! [ -f informe-oficial/cap-pruebas.tex ] || ! [ -f informe-oficial/anexos/g-pruebas.tex ]; then echo "FALLA falta el capítulo o el anexo de pruebas del informe"; fallos=$((fallos+1))
elif [ "$nl" -lt 10 ]; then echo "FALLA leí solo $nl comprobaciones en el caso lorawan de banco.sh (¿cambió su forma?)"; fallos=$((fallos+1))
elif ! grep -q "$nl de $nl desde" docs/16-informe-de-pruebas.md; then echo "FALLA banco.sh lorawan tiene $nl comprobaciones y docs/16 no cita «$nl de $nl desde …»"; fallos=$((fallos+1))
elif viejas=$(grep -noE '[0-9]+ de [0-9]+ (comprobaciones|del banco LoRaWAN)' informe-oficial/cap-pruebas.tex informe-oficial/anexos/g-pruebas.tex | grep -vE ":$nl de $nl (comprobaciones|del banco LoRaWAN)"); [ -n "$viejas" ]; then echo "FALLA el informe cita otro conteo del banco LoRaWAN (son $nl): $viejas"; fallos=$((fallos+1))
elif ! grep -qE "$nl de $nl (comprobaciones|del banco LoRaWAN)" informe-oficial/cap-pruebas.tex; then echo "FALLA el capítulo de pruebas no cita «$nl de $nl comprobaciones» ni «$nl de $nl del banco LoRaWAN» (¿cambió la redacción?)"; fallos=$((fallos+1))
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
fuentes = [*pathlib.Path('informe-oficial').glob('*.tex'), *pathlib.Path('informe-oficial/anexos').glob('*.tex'), *pathlib.Path('docs').glob('*.md'),
           pathlib.Path('informe-oficial/presentacion/presentacion.tex')]  # 04/11: la lámina «N pasos del guardián» también se compara
malos, n_pasos, n_panel = [], 0, 0
for f in fuentes:
    if f.name.startswith('12-'): continue
    crudo = f.read_text(encoding='utf-8')
    if f.name.startswith('16-'):
        # 22/10: docs/16 es un registro fechado; cada sección conserva el conteo de su día. Rige el actual solo en la cabecera
        # (antes de la primera «## N.») y en la última sección (la del cambio vigente).
        partes = re.split(r'(?m)^(?=## \d+\. )', crudo); crudo = partes[0] + (partes[-1] if len(partes) > 1 else '')
    t = re.sub(r'\s+', ' ', crudo)
    for m in re.finditer(r'(\d+) pasos que comparan|verificador de (\d+) pasos|por sus pasos \((\d+)\)|\\cifra\{(\d+)\}\{pasos del guardián\}', t):
        n_pasos += 1; dice = int(m.group(1) or m.group(2) or m.group(3) or m.group(4))
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

paso "2w6. Citas a secciones: cada «docs/NN §M» de un archivo versionado apunta a una sección M que existe en docs/NN"
# 24/10, revisión del día: docs/17 citaba «docs/16 §53» antes de que existiera. Se exige la sección principal (el título
# «# M.» o «## M.»); «§M.K» puede ser un título o el punto K de una lista de §M, así que de ella solo se comprueba M.
# 24/10: también cada § de una lista que sigue a la cita («`docs/16 §39` y §40», «§39, §40 y §41»); antes solo se veía el primero.
python3 -I - <<'PY' || fallos=$((fallos+1))
import re, sys, pathlib, subprocess
secciones = {}
for p in pathlib.Path('docs').glob('*.md'):
    if (m := re.match(r'(\d{2})-', p.name)):
        secciones[m.group(1)] = {h.group(1) for l in p.read_text(encoding='utf-8').splitlines() if (h := re.match(r'^#{1,4}\s+(\d+)[.\s]', l))}
archivos = subprocess.run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '*.md', '*.tex', '*.ts', '*.sh', '*.sql', '*.yml', '*.cpp', '*.ini', '*.svelte'],
                          capture_output=True, text=True).stdout.split()
malos, citas = [], 0
for f in archivos:
    p = pathlib.Path(f)
    if not p.is_file(): continue
    for n, linea in enumerate(p.read_text(encoding='utf-8', errors='replace').splitlines(), 1):
        for m in re.finditer(r'docs/(\d{2})(?:-[\w-]+(?:\.md)?)?`?\s*§\s*(\d+)(?:\.\d+)?((?:`?\s*(?:,|y|e)\s*§\s*\d+(?:\.\d+)?)*)', linea):
            if m.group(1) not in secciones: citas += 1; malos.append(f'{f}:{n}: cita docs/{m.group(1)}, que no existe'); continue
            for sec in [m.group(2)] + re.findall(r'§\s*(\d+)', m.group(3)):
                citas += 1
                if sec not in secciones[m.group(1)]: malos.append(f'{f}:{n}: cita docs/{m.group(1)} §{sec}, sección que no existe')
if citas < 100: print(f'FALLA leí solo {citas} citas a secciones (¿cambió su forma?)'); sys.exit(1)
for m in malos: print('FALLA', m)
if not malos: print(f'OK    {citas} citas a secciones de docs/, todas a una sección que existe')
sys.exit(1 if malos else 0)
PY

paso "2w7. Historial de versiones de privacidad y términos (docs/21 §7): lo ya publicado no se reescribe, las filas nuevas se agregan al final"
# 18/11/2026: toda actualización del texto legal sube su versión y su fecha (decidido ese día). La prueba legal.spec.ts compara la huella del
# texto servido con la ÚLTIMA fila del historial; deja abierto un atajo: cambiar la huella de la versión vigente en vez de subir la versión.
# Este paso lo cierra: toda fila del historial que ya exista en la versión publicada del documento (origin/main; sin esa referencia, HEAD)
# debe estar idéntica en el árbol de trabajo, y las filas nuevas solo se agregan al final. Si la versión publicada aún no trae la tabla, el
# historial es nuevo y pasa diciéndolo. Sin git o sin ninguna de las dos referencias, se OMITE (nunca verde sin haber revisado). Se usa
# `rev-parse --verify -q «ref^{commit}»` porque `rev-parse` a secas devuelve el nombre tal cual aunque la referencia no exista.
python3 -I - <<'PY'; rc=$?
import re, sys, pathlib, subprocess
DOC = 'docs/21-datos-personales-y-terceros.md'
TITULOS = ['Historial de la privacidad', 'Historial de los términos']
def filas(texto, titulo):
    ini = texto.find(f'#### {titulo}\n')
    if ini < 0: return None
    resto = texto[ini + len(titulo) + 6:]
    m = re.search(r'\n(#|\*\*)', resto)
    bloque = resto if m is None else resto[:m.start()]
    cuerpo = [[c.strip() for c in re.sub(r'^\|\s*|\s*\|$', '', l.strip()).split(' | ')] for l in bloque.split('\n') if l.startswith('| ')][1:]
    for f in cuerpo:
        if len(f) != 4: raise ValueError(f'fila mal formada en «{titulo}» ({len(f)} celdas en vez de 4; ¿una celda trae « | »?): {" | ".join(f)[:100]}')
    return cuerpo
def git(*a):
    try: return subprocess.run(['git', *a], capture_output=True, text=True)
    except FileNotFoundError: return None
ref = None
for r in ('origin/main', 'HEAD'):
    c = git('rev-parse', '--verify', '-q', f'{r}^{{commit}}')
    if c is not None and c.returncode == 0 and re.fullmatch(r'[0-9a-f]{40}', c.stdout.strip()): ref = r; break
if ref is None: print('omitida: sin git o sin referencia origin/main ni HEAD; no se sabe qué está publicado'); sys.exit(3)
trabajo = pathlib.Path(DOC).read_text(encoding='utf-8')
# «El archivo no existe en esa referencia» (historial nuevo) se distingue de cualquier otro fallo de git (omitida): `ls-tree` sale con 0 y
# sin salida si la ruta no está en la referencia; si sale con otro código, no se sabe qué está publicado.
c = git('ls-tree', '--name-only', ref, '--', DOC)
if c is None or c.returncode != 0: print(f'omitida: git ls-tree falló en {ref} ({(c.stderr if c is not None else "sin git").strip()[:120]}); no se sabe qué está publicado'); sys.exit(3)
if c.stdout.strip() == '': publicado = ''
else:
    c = git('show', f'{ref}:{DOC}')
    if c is None or c.returncode != 0: print(f'omitida: git show falló en {ref} ({(c.stderr if c is not None else "sin git").strip()[:120]}); no se sabe qué está publicado'); sys.exit(3)
    publicado = c.stdout
malos, resumen = [], []
for titulo in TITULOS:
    try: hoy = filas(trabajo, titulo)
    except ValueError as e: print('FALLA', e); sys.exit(1)
    if not hoy: print(f'FALLA «{titulo}» no existe o no tiene filas en {DOC}'); sys.exit(1)
    try: antes = filas(publicado, titulo) or []
    except ValueError as e: print('FALLA la versión publicada: ' + str(e)); sys.exit(1)
    if not antes: resumen.append(f'«{titulo}»: historial nuevo (con {len(hoy)} fila(s)), nada publicado que comparar'); continue
    if len(hoy) < len(antes): malos.append(f'«{titulo}»: la versión publicada en {ref} tiene {len(antes)} filas y aquí hay {len(hoy)}: se borraron filas')
    for i, fila in enumerate(antes[:len(hoy)]):
        if hoy[i] != fila: malos.append(f'«{titulo}», fila {i + 1} (versión {fila[0]}): ya está publicada en {ref} y aquí cambió; el historial publicado no se reescribe: agrega una versión nueva al final\n      publicada: {" | ".join(fila)[:150]}\n      ahora:     {" | ".join(hoy[i])[:150]}')
    resumen.append(f'«{titulo}»: {len(antes)} filas publicadas en {ref} idénticas, {len(hoy) - len(antes)} nuevas al final')
for m in malos: print('FALLA', m)
if not malos: print('OK    ' + '; '.join(resumen))
sys.exit(1 if malos else 0)
PY
if [ "$rc" = 3 ]; then omitidos="$omitidos 2w7"; elif [ "$rc" != 0 ]; then fallos=$((fallos+1)); fi

paso "2y2. Sintaxis de los guiones: bash -n de cada *.sh versionado o nuevo (no ignorado)"
# 16/10: una línea de comentario sin «#» dejó banco.sh entero sin interpretarse y el guardián no lo veía (solo lo vio la siguiente
# corrida del banco). bash -n no ejecuta nada: solo lee el guion.
malos=""; n=0
while IFS= read -r g; do n=$((n+1)); bash -n "$g" 2>/dev/null || malos="$malos $g"; done < <(git ls-files -co --exclude-standard '*.sh')
if [ "$n" -lt 15 ]; then echo "FALLA revisé solo $n guiones (¿cambió el listado?)"; fallos=$((fallos+1))
elif [ -n "$malos" ]; then echo "FALLA guiones con error de sintaxis:$malos"; fallos=$((fallos+1))
else echo "OK    $n guiones con la sintaxis de bash correcta (bash -n)"; fi

paso "2y2b. Sitios y zonas: las constantes repetidas entre el backend y el panel dicen lo mismo (topes de nombres y descripción, forma del código)"
# 24/11/2026: sitios-zonas.ts (backend) y lib/estructura.ts (panel) repiten MAX_NOMBRE_ZONA, MAX_NOMBRE_SITIO, MAX_DESCRIPCION_SITIO y la
# expresión de FORMA_CODIGO_SITIO (el panel valida antes de enviar; docs/19 §4 U). Si una cambia sola, el panel acepta lo que la API rechaza
# o al revés. Falla si difieren o si no encuentra alguna. La lógica va en una función para poder probarla sola (con copias plantadas).
# --- inicio comparar_constantes_estructura ---
comparar_constantes_estructura() {
  local back="$1" panel="$2" mal=0 k vb vp
  for k in MAX_NOMBRE_ZONA MAX_NOMBRE_SITIO MAX_DESCRIPCION_SITIO FORMA_CODIGO_SITIO; do
    if [ "$k" = FORMA_CODIGO_SITIO ]; then
      vb=$(grep -oP "^export const $k = \K/.*/(?=;)" "$back" 2>/dev/null | head -1); vp=$(grep -oP "^export const $k = \K/.*/(?=;)" "$panel" 2>/dev/null | head -1)
    else
      vb=$(grep -oP "^export const $k = \K[0-9_]+(?=;)" "$back" 2>/dev/null | head -1); vp=$(grep -oP "^export const $k = \K[0-9_]+(?=;)" "$panel" 2>/dev/null | head -1)
    fi
    if [ -z "$vb" ] || [ -z "$vp" ]; then echo "FALLA $k: no la encontré (backend «${vb:-ausente}», panel «${vp:-ausente}»)"; mal=1
    elif [ "$vb" != "$vp" ]; then echo "FALLA $k difiere: backend $vb, panel $vp"; mal=1; fi
  done
  [ "$mal" -eq 0 ] && echo "OK    MAX_NOMBRE_ZONA, MAX_NOMBRE_SITIO, MAX_DESCRIPCION_SITIO y FORMA_CODIGO_SITIO iguales en el backend y el panel"
  return "$mal"
}
# --- fin comparar_constantes_estructura ---
comparar_constantes_estructura plataforma/backend/src/consulta/sitios-zonas.ts plataforma/backend/panel/src/lib/estructura.ts || fallos=$((fallos+1))

paso "2y3. Panel: todo botón es Boton.svelte (docs/19 §6): ningún <button fuera de él y de los tres archivos justificados"
# 08/11: la regla «todo botón nuevo es Boton.svelte» no tenía guardia. Ficha, Inventario y SelectorRango conservan botones propios
# justificados en docs/19 §6 (fichas de conteo por estado y tarjetas de canal, con contenido rico; botones de rango); otro .svelte con «<button» falla.
justificados="Boton.svelte Ficha.svelte Inventario.svelte SelectorRango.svelte"
n=$(git ls-files -co --exclude-standard 'plataforma/backend/panel/src/*.svelte' | wc -l)
malos=$(git ls-files -co --exclude-standard 'plataforma/backend/panel/src/*.svelte' | while IFS= read -r f; do
  case " $justificados " in *" $(basename "$f") "*) continue ;; esac
  grep -nH '<button' "$f"; done)
if [ "$n" -lt 10 ]; then echo "FALLA revisé solo $n componentes del panel (¿cambió la carpeta?)"; fallos=$((fallos+1))
elif [ -n "$malos" ]; then echo "FALLA <button fuera de Boton.svelte (usar el componente; docs/19 §6):"; sed 's/^/  /' <<<"$malos"; fallos=$((fallos+1))
else echo "OK    $n componentes del panel: ningún <button fuera de Boton.svelte y de los tres justificados ($justificados)"; fi

paso "2y4. Pruebas de navegador: ningún guion busca lo que el panel ya no dibuja (atributos data-* y la leyenda de uPlot)"
# 13/11: el tablero v3 dejó de dibujar la tabla de leyenda de uPlot y e2e/p3.mjs (la prueba del banco, que este verificador no corre)
# la seguía buscando: «todo en concordancia» con una prueba que ya no podía pasar. Estático y barato: cada atributo data-* que un guion
# de e2e busca debe ponerlo algún componente, y ninguno busca la leyenda ni el título de uPlot mientras Grafico.svelte los tenga apagados.
python3 -I - <<'PY' || fallos=$((fallos+1))
import re, sys, pathlib
panel = pathlib.Path('plataforma/backend/panel')
fuentes = [*panel.glob('src/*.svelte'), *panel.glob('src/**/*.svelte')]
guiones = sorted(panel.glob('e2e/*.mjs'))
if len(fuentes) < 10 or len(guiones) < 1: print(f'FALLA revisé {len(fuentes)} componentes y {len(guiones)} guiones (¿cambió la carpeta?)'); sys.exit(1)
src = '\n'.join(p.read_text(encoding='utf-8') for p in set(fuentes))
puestos = set(re.findall(r'\bdata-[a-z0-9-]+', src))
# Un atributo armado con plantilla (`data-ir-${…}`) vale por su prefijo; el prefijo desnudo «data-» no cuenta (valdría para todo).
prefijos = [p for p in re.findall(r'`(data-[a-z0-9-]*)\$\{', src) if p != 'data-']
malos, n = [], 0
for g in guiones:
    t = g.read_text(encoding='utf-8')
    for a in sorted(set(re.findall(r'\[(data-[a-z0-9-]+)', t))):
        n += 1
        if a not in puestos and not any(a.startswith(p) for p in prefijos): malos.append(f'{g.name}: busca [{a}], que ningún componente pone')
    # Lo que uPlot dibujaba y el panel apagó: sin tabla de leyenda (legend.show false) no hay .u-legend ni sus filas; sin `title`, no hay .u-title.
    grafico = (panel / 'src/Grafico.svelte').read_text(encoding='utf-8')
    apagado = (['.u-legend', '.u-series', '.u-label', '.u-value', '.u-off'] if re.search(r'legend:\s*\{\s*show:\s*false', grafico) else []) + ([] if re.search(r'^\s*title:', grafico, re.M) else ['.u-title'])
    for c in apagado:
        if re.search(re.escape(c) + r'(?![a-z-])', t): malos.append(f'{g.name}: busca {c}, que Grafico.svelte ya no dibuja')
if n < 20: print(f'FALLA revisé solo {n} selectores data-* (¿cambió la forma de las pruebas?)'); sys.exit(1)
if malos:
    print('FALLA las pruebas de navegador buscan algo que el panel no dibuja:')
    for m in malos[:12]: print('  ' + m)
    sys.exit(1)
print(f'OK    {n} selectores data-* de {len(guiones)} guiones existen en los {len(set(fuentes))} componentes; ninguno busca la leyenda ni el título que uPlot ya no dibuja')
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
  # 26/10: las láminas (informe-oficial/presentacion/) no entran a main.pdf; con ellas este paso no pasaba nunca.
  nuevas=$( { find informe-oficial -name '*.tex' -newer "$LOGTEX" -not -path '*/build/*' -not -path 'informe-oficial/presentacion/*'; for r in $(find informe-oficial/figuras/render informe-oficial/figuras/drawio -name '*.pdf' -newer "$LOGTEX" 2>/dev/null); do
      # solo las que el informe incluye: la vista resumida (26/10) es de las láminas
      grep -rqs --include='*.tex' --exclude-dir=presentacion --exclude-dir=build "figuras/render/$(basename "$r")" informe-oficial && echo "$r"; done; } 2>/dev/null | head -5 | tr '\n' ' ')
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

paso "3d. Figuras en draw.io (4.1 y 2.2): cada .drawio con su PDF, con los términos que docs/10 §1 declara, sin rótulos viejos, y el PDF diciendo lo mismo"
# 01/11: desde el 01/11/2026 (docs/10 §1) el autor dibuja estas figuras; el guardián cuida que el dibujo no se desincronice del texto (puertos, vías, rutas,
# filtros, ruta HTTP) ni del PDF exportado (un .drawio editado sin reexportar deja el informe viejo). Se prueba plantando un término.
python3 -I - <<'PYD' || fallos=$((fallos+1))
import html, pathlib, re, subprocess, sys
base = pathlib.Path('informe-oficial/figuras/drawio')
exige = {
  'figura-4.1': ['443', '8883', '1883', '3000', 'vía 1', 'vía 2 · POST /recepcion/{id}', 'vía 2 · prevista', 'vía 3, diseñada · WebSocket/TLS',
                 'Ruta A', 'Ruta B', 'Ruta C', 'Basics Station', 'WebSocket',
                 'filtros 1 y 2', 'filtros 3 y 4', 'filtro 5', 'filtro 6', 'POST /recepcion/{id}', 'suscripción sitio/#', 'Dispositivos',
                 'Equipo que solo habla HTTP', 'Mosquitto', 'TimescaleDB', 'Proxy inverso', 'Backend NestJS', 'ChirpStack propio',
                 'red del campus hoy', 'servidor de red externo'],
  'figura-2.2': ['sitio/#', 'Mosquitto', 'TimescaleDB', 'PUBLICA', 'entrega', 'suscrito a'],
}
prohibe = {'figura-4.1': ['Sensores', 'PREVISTO', 'packet forwarder', 'sin TLS'], 'figura-2.2': ['SE SUSCRIBE']}
malas = []; n = 0
for nombre, terminos in exige.items():
    dr = base / f'{nombre}.drawio'; pdf = base / f'{nombre}.pdf'
    if not dr.exists(): malas.append(f'{dr} no existe'); continue
    if not pdf.exists(): malas.append(f'{pdf} no existe (exportar desde el .drawio)'); continue
    xml = dr.read_text(errors='ignore')
    texto = html.unescape(' '.join(re.findall(r'value="([^"]*)"', xml)))
    texto = re.sub(r'<br\s*/?>', ' ', texto); texto = re.sub(r'<[^>]+>', '', texto)
    for t in terminos:
        n += 1
        if t not in texto: malas.append(f'{dr.name}: falta «{t}»')
    for t in prohibe[nombre]:
        n += 1
        if t in texto: malas.append(f'{dr.name}: rótulo viejo «{t.strip()}»')
    if nombre == 'figura-4.1':
        n += 1
        if re.search(r'\bM[1-8]\b', texto): malas.append(f'{dr.name}: códigos de módulo (M1…M8) en las cajas; van los números de filtro de la figura 3.1')
    # El PDF exportado debe decir lo mismo que el .drawio: todos los términos exigidos, con los espacios normalizados (pdftotext parte líneas).
    try: tp = re.sub(r'\s+', ' ', subprocess.run(['pdftotext', str(pdf), '-'], capture_output=True, text=True, timeout=30).stdout)
    except Exception as e: malas.append(f'{pdf.name}: pdftotext falló ({e})'); continue
    for t in terminos:
        n += 1
        if t not in tp: malas.append(f'{pdf.name}: el PDF no dice «{t}» (reexportar desde el .drawio)')
if n < 20: print(f'FALLA revisó solo {n} términos (se esperan >= 20)'); sys.exit(1)
if malas:
    print('FALLA figuras draw.io fuera de concordancia:'); [print('  ' + m) for m in malas]; sys.exit(1)
print(f'OK    {n} comprobaciones sobre {len(exige)} figuras draw.io: términos de docs/10 §1 presentes, rótulos viejos ausentes, PDF coherente')
PYD

paso "4. API (si el backend está corriendo en 127.0.0.1:3000)"
if curl -s -m 2 http://127.0.0.1:3000/salud >/dev/null; then bash plataforma/pruebas/api-smoke.sh || fallos=$((fallos+1)); else echo "omitida: backend no está corriendo"; omitidos="$omitidos 4"; fi

paso "4b. Sesión y permisos (docs/20 §6 y §8): la matriz ruta × rol con una sesión por rol, otro sitio → 404, bloqueo, cierre y canal en vivo por sitio"
# 08/11/2026: el primer administrador con X-Clave-Admin, un usuario de consulta, dos sitios propios de la prueba; todo se borra al salir.
if curl -s -m 2 http://127.0.0.1:3000/salud >/dev/null; then bash plataforma/pruebas/sesion-smoke.sh || fallos=$((fallos+1)); else echo "omitida: backend no está corriendo"; omitidos="$omitidos 4b"; fi

paso "4c. Panel con sesión en navegadores reales (P10; docs/19 §4 y §6): entrar, clave temporal, inventario, exportar, usuarios, vencer y salir, a 390 y 1280 px, en Chromium y Firefox; la vista pública por enlace (P9), la exportación del sitio (P8), el alta masiva (P7) y los sitios y zonas (P15 y P17)"
# 08/11/2026: el e2e de la pantalla de inicio de sesión contra la pila de desarrollo (el panel servido por la imagen del backend). Sin el backend
# o sin los navegadores de Playwright, el guion sale con 3 y el paso se OMITE con aviso: nunca «OK» sin haber probado.
bash plataforma/pruebas/panel-sesion-e2e.sh; r=$?
if [ "$r" = 3 ]; then omitidos="$omitidos 4c"; elif [ "$r" != 0 ]; then fallos=$((fallos+1)); fi
# 17/11/2026: P9 (docs/19 §4, O; docs/16 §80): publicar con vista previa y avisos, visitar sin sesión (lo dibujado = GET /publico; el token
# solo en la cabecera, ni en direcciones, almacenamiento, cookies o consola), renovar, el k del sitio y revocar. Mismas reglas de omisión.
bash plataforma/pruebas/panel-publico-e2e.sh; r=$?
if [ "$r" = 3 ]; then omitidos="$omitidos 4c-publico"; elif [ "$r" != 0 ]; then fallos=$((fallos+1)); fi
# 19/11/2026: P8 (docs/19 §4, R; docs/16 §89): exportar el sitio desde la ficha, la estimación contra lo sembrado, los tres formatos con su
# nombre y su firma, «Entre fechas» en la hora del sitio y sin desplazamiento horizontal; borra lo sembrado al final. Mismas reglas de omisión.
bash plataforma/pruebas/panel-exportar-e2e.sh; r=$?
if [ "$r" = 3 ]; then omitidos="$omitidos 4c-exportar"; elif [ "$r" != 0 ]; then fallos=$((fallos+1)); fi
# 19/11/2026: P7, el alta masiva sin fricción (docs/19 §4, S): el catálogo fijo de escenarios, 500 filas con sus umbrales de tiempo, crear por
# HTTP, «atrás» con credenciales sin descargar y la ayuda emergente que no recibe toques bajo 700 px; borra lo sembrado y lo creado y cuenta
# que no quede nada. Reemplaza a `banco.sh lote-navegador`. Mismas reglas de omisión.
bash plataforma/pruebas/panel-lote-e2e.sh; r=$?
if [ "$r" = 3 ]; then omitidos="$omitidos 4c-lote"; elif [ "$r" != 0 ]; then fallos=$((fallos+1)); fi
# 25/11/2026: P15 «Zonas» y P17 «Sitios» (docs/19 §4, U y U2; docs/16 §101): crear y editar un sitio, agregar, renombrar, retirar y volver a
# ofrecer zonas, la zona nueva del alta de a uno y la del lote (sin la casilla no entran; con ella, sí) y lo que cuenta «Actividad»; antes de
# limpiar se niega a borrar si ve eventos fuera de los sitios de la corrida, y cuenta que no quede nada. Mismas reglas de omisión.
bash plataforma/pruebas/panel-estructura-e2e.sh; r=$?
if [ "$r" = 3 ]; then omitidos="$omitidos 4c-estructura"; elif [ "$r" != 0 ]; then fallos=$((fallos+1)); fi

paso "4d. Semilla de demostración: respeta la clave de quien ya eligió la suya (persona_temporal en conservar y rotar, con una persona de descarte)"
# 13/11/2026: cada corrida de la semilla anulaba la clave propia de las personas de demostración y cortaba sus sesiones. La prueba usa una
# persona y un sitio propios que borra al salir (nunca las cuentas *-demo); sin backend sale con 3 y el paso se OMITE.
bash plataforma/pruebas/personas-semilla-prueba.sh; r=$?
if [ "$r" = 3 ]; then omitidos="$omitidos 4d"; elif [ "$r" != 0 ]; then fallos=$((fallos+1)); fi

paso "4e. Respaldo y restauración: el respaldo de la base viva, en claro y cifrado, se restaura en una base desechable y da la misma huella (docs/10 §9.5; TT-46)"
# 16/11/2026: «un respaldo que no se restauró no es respaldo». Cada corrida toma un respaldo de la base de desarrollo (solo lee) con el
# guion versionado, lo restaura en un contenedor aparte, sin red y con los datos en memoria, y compara la huella de lo restaurado con
# la del respaldo (filas y suma de comprobación por tabla, hipertablas, objetos y permisos): un cambio del esquema que rompa la
# restauración se ve aquí y no el día en que haga falta. El respaldo vive en la carpeta de trabajo de la corrida y se borra al salir.
# 17/11/2026: además, la guardia de 26 h debe dar OK sobre ese respaldo, y se repite todo CIFRADO con age para una clave de descarte
# que se genera en la carpeta de trabajo y se borra con ella: el respaldo cifrado se restaura con la clave e idéntico, y sin la clave
# el simulacro se niega. Sin `age` instalado, esa mitad se OMITE con aviso (nunca «OK» sin haber probado).
# Sin la base o sin el broker de la pila, el paso se OMITE con aviso. El sondeo se hace desde plataforma/, como el guion de respaldo,
# para mirar la misma pila que él.
if (cd plataforma && docker compose exec -T timescaledb true && docker compose exec -T mosquitto true) >/dev/null 2>&1; then
  # La mitad en claro no hereda las variables de cifrado de quien corre el verificador (si las tiene, el respaldo saldría cifrado o fallaría).
  if env -u RESPALDO_DESTINATARIOS -u RESPALDO_EXIGIR_CIFRADO -u RESPALDO_ACEPTAR_CLARO bash plataforma/pruebas/respaldar.sh "$VT/respaldo" > "$VT/respaldo.txt" 2>&1; then
    echo "OK    $(tail -1 "$VT/respaldo.txt" | sed -E 's|: /.*$||')"
    bash plataforma/pruebas/simulacro-restauracion.sh "$VT"/respaldo/plataforma-*.dump > "$VT/simulacro.txt" 2>&1; r=$?
    grep -E '^(OK|FALLA|SIMULACRO|      )' "$VT/simulacro.txt"
    [ "$r" = 0 ] || fallos=$((fallos+1))
    env -u RESPALDO_EXIGIR_CIFRADO -u RESPALDO_ACEPTAR_CLARO bash plataforma/pruebas/guardia-respaldo.sh "$VT/respaldo" || fallos=$((fallos+1))
  else echo "FALLA no se pudo tomar el respaldo:"; tail -5 "$VT/respaldo.txt" | cut -c1-200 | sed 's/^/      /'; fallos=$((fallos+1)); fi
  if command -v age >/dev/null && command -v age-keygen >/dev/null; then
    (umask 077; age-keygen -o "$VT/descarte.clave" 2>/dev/null) && age-keygen -y "$VT/descarte.clave" > "$VT/descarte.destinatario"
    if RESPALDO_DESTINATARIOS="$VT/descarte.destinatario" bash plataforma/pruebas/respaldar.sh "$VT/cifrado" > "$VT/cifrado.txt" 2>&1; then
      echo "OK    $(tail -1 "$VT/cifrado.txt" | sed -E 's|: /.*$||')"
      RESPALDO_IDENTIDAD="$VT/descarte.clave" bash plataforma/pruebas/simulacro-restauracion.sh "$VT"/cifrado/plataforma-*.dump.age > "$VT/simulacro-cifrado.txt" 2>&1; r=$?
      grep -E '^(FALLA|SIMULACRO|      )|^OK +volcado descifrado' "$VT/simulacro-cifrado.txt"
      [ "$r" = 0 ] || fallos=$((fallos+1))
      env -u RESPALDO_IDENTIDAD bash plataforma/pruebas/simulacro-restauracion.sh "$VT"/cifrado/plataforma-*.dump.age > "$VT/sin-clave.txt" 2>&1; r=$?
      if [ "$r" = 2 ] && grep -q RESPALDO_IDENTIDAD "$VT/sin-clave.txt"; then echo "OK    sin la clave privada, el simulacro se niega a restaurar el respaldo cifrado (sale con 2)"
      else echo "FALLA sin la clave privada el simulacro salió con $r (se esperaba 2 y un mensaje que pida RESPALDO_IDENTIDAD): $(head -c 200 "$VT/sin-clave.txt")"; fallos=$((fallos+1)); fi
      RESPALDO_EXIGIR_CIFRADO=1 bash plataforma/pruebas/guardia-respaldo.sh "$VT/cifrado" || fallos=$((fallos+1))
    else echo "FALLA no se pudo tomar el respaldo cifrado:"; tail -5 "$VT/cifrado.txt" | cut -c1-200 | sed 's/^/      /'; fallos=$((fallos+1)); fi
  else echo "omitido: age no está instalado; el respaldo cifrado no se probó (apt install age)"; omitidos="$omitidos 4e-cifrado"; fi
else echo "omitido: la base o el broker de la pila no responden (docker compose up -d en plataforma/)"; omitidos="$omitidos 4e"; fi

# «TODO» solo si todo corrió: un paso omitido no se cuenta como aprobado (27/09: con el backend
# apagado, el guardián decía TODO EN CONCORDANCIA sin haber probado la API). Sale 2 si hubo omisiones.
echo
if [[ $fallos -ne 0 ]]; then echo "$fallos bloque(s) con fallas${omitidos:+ · además omitidos:$omitidos}"; exit 1
elif [[ -n "$omitidos" ]]; then echo "SIN FALLAS, PERO INCOMPLETO: pasos omitidos:$omitidos (no es TODO EN CONCORDANCIA)"; exit 2
else echo "TODO EN CONCORDANCIA"; fi
