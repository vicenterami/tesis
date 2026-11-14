#!/usr/bin/env bash
# Paso 4b del guardián: la matriz de acceso de docs/20 §6 contra el backend corriendo, con una sesión por perfil (docs/20 §8): desde el
# 11/11/2026, las siete columnas (sin sesión, consulta, investigador, operador técnico, administrador de sitio, administrador del sistema y
# otro sitio), los términos de uso (§12), la baja por anonimización (§11), la cuenta propia (preferencias, sesiones, exportar), el soporte y
# la actividad del sitio (docs/19 §4, G, H y P11).
#   bash plataforma/pruebas/sesion-smoke.sh
# Requiere la pila arriba (backend en 127.0.0.1:3000 con las migraciones 22 a 24) y HTTP_CLAVE_ADMIN en plataforma/.env: con ella se crea el
# primer administrador (docs/20 §4), que crea a su vez un usuario de consulta. Datos de prueba propios y desechables: dos sitios
# (A, el de las dos personas, y B, «otro sitio»), una zona, dos dispositivos HTTP y un canal en cada uno; correos @ejemplo.invalid
# (dominio reservado, RFC 2606). Todo lo creado se borra al salir, también si algo falla (trap), con el dueño de la base.
# Las claves de prueba se generan aquí, viajan a curl por la entrada estándar o dentro del cuerpo y no se imprimen.
# Cuántos intentos fallidos deja: 5 con clave mala, 6 con un email inexistente y 1 de usuario inactivo (el bloqueo por IP corta a los 50
# en 15 minutos; por eso cada corrida sale desde una dirección distinta del bucle local, ver ORIGEN).
# Residuos de una corrida que no pudo limpiar (lo avisa con los conteos y el sufijo):
#   bash plataforma/pruebas/sesion-smoke.sh --limpiar SUFIJO
set -u
set +x # nunca con traza: las claves de prueba y la clave de administrador viven en variables de este guion
AQUI="$(cd "$(dirname "$0")" && pwd)"
. "$AQUI/lib-dynsec.sh"
API="${API:-http://127.0.0.1:3000}"
# Cada corrida sale desde una dirección distinta del bucle local (127.0.0.0/8 entero es loopback en Linux): así el bloqueo por
# dirección (50 fallos en 15 min, docs/20 §4) no encadena corridas seguidas y no hay que reiniciar el backend. Solo contra 127.0.0.1;
# contra otro servidor, curl sale por la ruta normal.
if [[ "$API" == *127.0.0.1* ]]; then ORIGEN="127.$((RANDOM % 200 + 2)).$((RANDOM % 250 + 1)).$((RANDOM % 250 + 1))"; IFZ=(--interface "$ORIGEN"); else ORIGEN=; IFZ=(); fi
PLAT="$AQUI/.."
sql() { docker compose -f "$PLAT/docker-compose.yml" exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA -q "$@"; }
ok_n=0; fallos=0
ok() { echo "OK    $1"; ok_n=$((ok_n+1)); }
falla() { echo "FALLA $1"; fallos=$((fallos+1)); }

# Lo que queda en la base de CUALQUIER corrida (por patrón, no por sufijo): lo imprime la limpieza que falla y el modo --limpiar.
residuos() {
  sql <<'SQL'
SELECT format('sitios pa-/pb-: %s; usuarios *@ejemplo.invalid: %s; filas de acceso *@ejemplo.invalid: %s',
  (SELECT count(*) FROM sitio WHERE codigo ~ '^p[ab]-[0-9]+$'),
  (SELECT count(*) FROM usuario WHERE email LIKE '%@ejemplo.invalid'),
  (SELECT count(*) FROM acceso WHERE email_intentado LIKE '%@ejemplo.invalid' OR usuario_id IN (SELECT id FROM usuario WHERE email LIKE '%@ejemplo.invalid')));
SQL
}

# Borra todo lo de una corrida (sufijo de 6 dígitos), con el dueño de la base y en una transacción: todo o nada.
limpiar_sufijo() {
  local sa="pa-$1" sb="pb-$1" dom="-$1@ejemplo.invalid"
  sql <<SQL >/dev/null 2>"$LOG_LIMPIEZA"
BEGIN;
CREATE TEMP TABLE d_prueba AS SELECT d.id FROM dispositivo d JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo IN ('$sa', '$sb');
-- Las personas de la corrida: por su correo y, las anonimizadas (su correo ya no es el de la prueba), por su membresía en los sitios de prueba.
CREATE TEMP TABLE u_prueba AS SELECT id FROM usuario WHERE email LIKE '%$dom'
  OR (anonimizado_en IS NOT NULL AND id IN (SELECT us.usuario_id FROM usuario_sitio us JOIN sitio s ON s.id = us.sitio_id WHERE s.codigo IN ('$sa', '$sb')));
DELETE FROM preferencia WHERE usuario_id IN (SELECT id FROM u_prueba) OR sitio_predeterminado IN (SELECT id FROM sitio WHERE codigo IN ('$sa', '$sb'));
DELETE FROM mensaje_soporte WHERE usuario_id IN (SELECT id FROM u_prueba);
UPDATE usuario SET desactivado_por = NULL WHERE desactivado_por IN (SELECT id FROM u_prueba);
DELETE FROM medicion WHERE canal_id IN (SELECT id FROM canal WHERE dispositivo_id IN (SELECT id FROM d_prueba));
DELETE FROM condicion WHERE dispositivo_id IN (SELECT id FROM d_prueba);
DELETE FROM regla_umbral WHERE canal_id IN (SELECT id FROM canal WHERE dispositivo_id IN (SELECT id FROM d_prueba));
DELETE FROM trama WHERE dispositivo_id IN (SELECT id FROM d_prueba);
DELETE FROM cuarentena WHERE dispositivo_id IN (SELECT id FROM d_prueba);
DELETE FROM credencial WHERE dispositivo_id IN (SELECT id FROM d_prueba);
DELETE FROM evento WHERE dispositivo_id IN (SELECT id FROM d_prueba) OR (tipo LIKE 'usuario_%' AND detalle->>'usuario_id' IN (SELECT id::text FROM u_prueba))
                      OR usuario_id IN (SELECT id FROM u_prueba);
DELETE FROM estado_dispositivo WHERE dispositivo_id IN (SELECT id FROM d_prueba);
DELETE FROM canal WHERE dispositivo_id IN (SELECT id FROM d_prueba);
DELETE FROM dispositivo WHERE id IN (SELECT id FROM d_prueba);
DELETE FROM credencial WHERE pasarela_id IN (SELECT id FROM pasarela WHERE sitio_id IN (SELECT id FROM sitio WHERE codigo IN ('$sa', '$sb')));
DELETE FROM pasarela WHERE sitio_id IN (SELECT id FROM sitio WHERE codigo IN ('$sa', '$sb'));
DELETE FROM zona WHERE sitio_id IN (SELECT id FROM sitio WHERE codigo IN ('$sa', '$sb'));
DELETE FROM sitio WHERE codigo IN ('$sa', '$sb');
DELETE FROM acceso WHERE email_intentado LIKE '%$dom' OR usuario_id IN (SELECT id FROM u_prueba);
DELETE FROM usuario WHERE id IN (SELECT id FROM u_prueba);
COMMIT;
SQL
}

if [ "${1:-}" = --limpiar ]; then
  [[ "${2:-}" =~ ^[0-9]{6}$ ]] || { echo "uso: bash plataforma/pruebas/sesion-smoke.sh --limpiar SUFIJO (los 6 dígitos que dio el aviso)"; exit 2; }
  LOG_LIMPIEZA=/dev/stderr
  if limpiar_sufijo "$2"; then echo "OK    corrida $2 limpia"; else echo "FALLA no se pudo limpiar la corrida $2"; fi
  echo "      quedan en la base: $(residuos)"
  exit 0
fi

CLAVE=$(leer_env "${ENV_PILA:-$PLAT/.env}" HTTP_CLAVE_ADMIN 2>/dev/null)
[ -n "$CLAVE" ] || { echo "FALLA sin HTTP_CLAVE_ADMIN en el .env de la pila: no hay con qué crear el primer administrador (docs/20 §4)"; exit 1; }
T=$(mktemp -d "${TMPDIR:-/tmp}/sesion-smoke.XXXXXX") || exit 1
LOG_LIMPIEZA="$T/limpieza.txt"
N=$(date +%s%N | tail -c 7)
SA="pa-$N"; SB="pb-$N"; DOM="-$N@ejemplo.invalid"

# Antes, una limpieza fallida solo decía «revisar a mano» (revisión del 08/11/2026): ahora dice qué quedó y cómo reintentar.
MUESTREO=() # los muestreadores de memoria de 6b (cada uno bajo `timeout`: aunque el guion muera sin trap, no quedan girando)
limpiar() {
  [ ${#MUESTREO[@]} -gt 0 ] && kill "${MUESTREO[@]}" 2>/dev/null
  jobs -p | xargs -r kill 2>/dev/null # flujos SSE de fondo que sigan abiertos
  if ! limpiar_sufijo "$N"; then
    echo "AVISO no se pudo limpiar todo lo creado (sufijo $N): $(head -c 300 "$LOG_LIMPIEZA" | tr '\n' ' ')"
    echo "      quedan en la base: $(residuos 2>&1 | head -c 300)"
    echo "      para reintentar: bash plataforma/pruebas/sesion-smoke.sh --limpiar $N"
  fi
  rm -rf "$T"
}
trap limpiar EXIT

# ── Datos de prueba (con el dueño de la base): sitio A y sitio B, cada uno con una zona, dispositivos HTTP y un canal ──────────────
IDS=$(sql <<SQL
WITH a AS (INSERT INTO sitio (nombre, codigo) VALUES ('Prueba de sesión A', '$SA') RETURNING id),
     b AS (INSERT INTO sitio (nombre, codigo) VALUES ('Prueba de sesión B', '$SB') RETURNING id),
     za AS (INSERT INTO zona (sitio_id, nombre) SELECT id, 'zona A' FROM a RETURNING id),
     zb AS (INSERT INTO zona (sitio_id, nombre) SELECT id, 'zona B' FROM b RETURNING id),
     da AS (INSERT INTO dispositivo (zona_id, id_fisico, nombre, via, formato, intervalo_esperado_s) SELECT id, 'ta-$N', 'nodo A', 'http', 'senml', 60 FROM za RETURNING id),
     da2 AS (INSERT INTO dispositivo (zona_id, id_fisico, nombre, via, formato, intervalo_esperado_s) SELECT id, 'tc-$N', 'nodo A2', 'http', 'senml', 60 FROM za RETURNING id),
     db AS (INSERT INTO dispositivo (zona_id, id_fisico, nombre, via, formato, intervalo_esperado_s) SELECT id, 'tb-$N', 'nodo B', 'http', 'senml', 60 FROM zb RETURNING id),
     ca AS (INSERT INTO canal (dispositivo_id, magnitud_codigo) SELECT id, 'temperatura' FROM da RETURNING id),
     cb AS (INSERT INTO canal (dispositivo_id, magnitud_codigo) SELECT id, 'temperatura' FROM db RETURNING id)
SELECT concat_ws(' ', (SELECT id FROM a), (SELECT id FROM b), (SELECT id FROM za), (SELECT id FROM zb), (SELECT id FROM da), (SELECT id FROM da2),
                      (SELECT id FROM db), (SELECT id FROM ca), (SELECT id FROM cb));
SQL
)
read -r SITIO_A SITIO_B ZA ZB DA DA2 DB CA CB <<<"$IDS"
[ -n "${CB:-}" ] || { falla "no se pudieron crear los datos de prueba"; exit 1; }
# Lo que faltaba en la matriz (revisión del 08/11/2026): una pasarela por sitio, una condición abierta y una trama en cuarentena por sitio
# (para las listas SIN ?dispositivo=) y una persona que solo está en B. Las pasarelas se crean por SQL: ninguna llamada de esta prueba
# llega a aprovisionar el broker (todas se rechazan antes, 401/403/404).
IDS2=$(sql <<SQL
WITH pa AS (INSERT INTO pasarela (sitio_id, id_fisico, nombre, formato) VALUES ('$SITIO_A', 'gwa-$N', 'pasarela A', 'chirpstack') RETURNING id),
     pb AS (INSERT INTO pasarela (sitio_id, id_fisico, nombre, formato) VALUES ('$SITIO_B', 'gwb-$N', 'pasarela B', 'chirpstack') RETURNING id),
     ka AS (INSERT INTO condicion (dispositivo_id, tipo) VALUES ('$DA', 'bateria') RETURNING id),
     kb AS (INSERT INTO condicion (dispositivo_id, tipo) VALUES ('$DB', 'bateria') RETURNING id),
     qa AS (INSERT INTO cuarentena (origen, motivo, payload_crudo, detalle, dispositivo_id) VALUES ('http', 'invalida', '\x7b7d', 'prueba de sesión A', '$DA') RETURNING id),
     qb AS (INSERT INTO cuarentena (origen, motivo, payload_crudo, detalle, dispositivo_id) VALUES ('http', 'invalida', '\x7b7d', 'prueba de sesión B', '$DB') RETURNING id),
     ub AS (INSERT INTO usuario (nombre, email, hash_password) VALUES ('Solo B de prueba', 'solob$DOM', 'sin-clave-nunca-entra') RETURNING id),
     sb AS (INSERT INTO usuario_sitio (usuario_id, sitio_id, rol) SELECT id, '$SITIO_B', 'consulta' FROM ub RETURNING usuario_id)
SELECT concat_ws(' ', (SELECT id FROM pa), (SELECT id FROM pb), (SELECT id FROM ka), (SELECT id FROM kb), (SELECT id FROM qa), (SELECT id FROM qb), (SELECT usuario_id FROM sb));
SQL
)
read -r PA PB KA KB QA QB SOLO_B <<<"$IDS2"
[ -n "${SOLO_B:-}" ] || { falla "no se pudieron crear las pasarelas, condiciones, cuarentena o la persona de B ($IDS2)"; exit 1; }
FALSO="00000000-0000-4000-8000-000000000000"

# pedir QUIEN MÉTODO RUTA [CUERPO]: QUIEN = anon | clave (X-Clave-Admin) | nombre del tarro de cookies (curl -c/-b). Las rutas que
# escriben llevan X-Pedido: panel salvo con SIN_PEDIDO=1. Escribe el cuerpo de la respuesta en $T/r y devuelve el código.
pedir() {
  local quien=$1 m=$2 r=$3 c=${4:-}
  local args=(-s -m 15 -o "$T/r" -w '%{http_code}' -X "$m")
  [ -n "$c" ] && args+=(-H 'Content-Type: application/json' --data-binary "$c")
  [ "$m" != GET ] && [ "${SIN_PEDIDO:-0}" != 1 ] && args+=(-H 'X-Pedido: panel')
  case "$quien" in
    anon) curl "${IFZ[@]}" "${args[@]}" "$API$r" ;;
    clave) printf 'X-Clave-Admin: %s\n' "$CLAVE" | curl "${IFZ[@]}" "${args[@]}" -H @- "$API$r" ;;
    *) curl "${IFZ[@]}" "${args[@]}" -b "$T/$quien.jar" -c "$T/$quien.jar" "$API$r" ;;
  esac
}
# pedir_cabecera QUIEN RUTA CABECERA: un GET con el tarro de QUIEN; el cuerpo queda en $T/r y se imprime el valor de la cabecera.
pedir_cabecera() {
  curl "${IFZ[@]}" -s -m 15 -o "$T/r" -D "$T/h" -b "$T/$1.jar" -c "$T/$1.jar" "$API$2" >/dev/null
  tr -d '\r' < "$T/h" | awk -v k="$(tr '[:upper:]' '[:lower:]' <<<"$3"):" 'tolower($1)==k{print $2}'
}
caso() { # descripción · código esperado · QUIEN · MÉTODO · RUTA [CUERPO]
  local d=$1 e=$2; shift 2; local c; c=$(pedir "$@")
  if [ "$c" = "$e" ]; then if [[ "$d" == *→* ]]; then ok "$d"; else ok "$d → $c"; fi; else falla "$d → $c (esperado $e): $(head -c 160 "$T/r")"; fi
}
campo() { python3 -I -c "import sys,json; v=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))" "$T/r" "$1" 2>/dev/null; }
cuerpo_entrar() { python3 -I -c "import sys,json; print(json.dumps({'email': sys.argv[1], 'clave': sys.stdin.read().rstrip('\n')}))" "$1"; }
entrar() { # QUIEN EMAIL (la clave por la entrada estándar): código de POST /sesion, con la cookie en el tarro de QUIEN
  local c; c=$(cuerpo_entrar "$2")
  curl "${IFZ[@]}" -s -m 15 -o "$T/r" -w '%{http_code}' -X POST -H 'X-Pedido: panel' -H 'Content-Type: application/json' --data-binary @- \
       -c "$T/$1.jar" "$API/sesion" <<<"$c"
}
cambiar_clave() { # QUIEN ACTUAL NUEVA
  local c; c=$(python3 -I -c "import sys,json; print(json.dumps({'actual': sys.argv[1], 'nueva': sys.argv[2]}))" "$2" "$3")
  pedir "$1" POST /sesion/clave "$c"
}
nueva_clave() { openssl rand -base64 18 | tr -d '\n'; }

echo "datos de prueba: sitios $SA (A) y $SB (B); usuarios *$DOM"

# ── 1. Primer administrador con la clave de administrador (docs/20 §4) ──────────────────────────────────────────────────────
ADM_EMAIL="admin$DOM"; CON_EMAIL="consulta$DOM"
hay=$(sql -c "SELECT EXISTS (SELECT 1 FROM usuario_sitio us JOIN usuario u ON u.id = us.usuario_id WHERE us.rol = 'administrador' AND us.activo AND u.activo)")
ADM_CLAVE=$(nueva_clave)
if [ "$hay" = f ] && [ "${SESION_SMOKE_ADMIN_POR_SQL:-0}" != 1 ]; then
  caso "POST /usuarios con X-Clave-Admin sin administradores: crea el primero" 201 clave POST /usuarios \
       "{\"nombre\":\"Administración de prueba\",\"email\":\"$ADM_EMAIL\",\"sitios\":[{\"sitio_id\":\"$SITIO_A\",\"rol\":\"administrador\"}]}"
  TEMP=$(campo "v['clave']"); ADM_ID=$(campo "v['id']")
  [ "$(campo "v['clave_temporal']")" = True ] && ok "la clave inicial es temporal y se muestra una vez (24 caracteres)" || falla "la clave inicial no viene marcada como temporal"
  caso "POST /usuarios con X-Clave-Admin cuando ya hay administrador → 403 (solo crea el primero)" 403 clave POST /usuarios \
       "{\"nombre\":\"Otro\",\"email\":\"otro$DOM\",\"sitios\":[{\"sitio_id\":\"$SITIO_A\",\"rol\":\"administrador\"}]}"
  c=$(entrar adm "$ADM_EMAIL" <<<"$TEMP"); [ "$c" = 200 ] && ok "el administrador entra con la clave temporal → 200" || falla "entrar con la temporal → $c"
  caso "con clave temporal, GET /dispositivos → 403 (primero debe cambiarla)" 403 adm GET /dispositivos
  caso "con clave temporal, GET /sesion → 200" 200 adm GET /sesion
  c=$(cambiar_clave adm "$TEMP" "$ADM_CLAVE"); [ "$c" = 200 ] && ok "POST /sesion/clave cambia la temporal → 200, con cookie nueva" || falla "cambio de clave → $c $(head -c 160 "$T/r")"
else
  # Ya hay un administrador en esta base (el de la persona): el de prueba se crea con el dueño de la base y su hash lo calcula el
  # propio backend (la misma función y el mismo costo); la clave entra por la entrada estándar del contenedor.
  echo "      (ya hay un administrador en la base, o SESION_SMOKE_ADMIN_POR_SQL=1: el de prueba se crea por SQL, sin pasar por la clave de administrador)"
  HASH=$(printf '%s' "$ADM_CLAVE" | docker compose -f "$PLAT/docker-compose.yml" exec -T backend node -e \
    "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>require('/app/dist/alta/credenciales.js').hashScrypt(s,undefined,2**17).then(h=>process.stdout.write(h)))")
  # El hash viaja dentro del SQL por la entrada estándar de psql, nunca como argumento (con -v quedaba en la línea de órdenes de docker
  # y de psql, visible en ps; revisión del 08/11/2026). Antes, su forma: solo base64 y «$», nada que cierre la comilla.
  [[ "$HASH" =~ ^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$ ]] || { falla "el backend no devolvió un hash con la forma scrypt\$N\$r\$p\$sal\$clave"; exit 1; }
  ADM_ID=$(sql <<SQL
INSERT INTO usuario (nombre, email, hash_password) VALUES ('Administración de prueba', '$ADM_EMAIL', '$HASH') RETURNING id;
SQL
)
  sql -c "INSERT INTO usuario_sitio (usuario_id, sitio_id, rol) VALUES ('$ADM_ID', '$SITIO_A', 'administrador')" >/dev/null
  caso "POST /usuarios con X-Clave-Admin cuando ya hay administrador → 403 (solo crea el primero)" 403 clave POST /usuarios \
       "{\"nombre\":\"Otro\",\"email\":\"otro$DOM\",\"sitios\":[{\"sitio_id\":\"$SITIO_A\",\"rol\":\"administrador\"}]}"
fi
c=$(entrar adm "$ADM_EMAIL" <<<"$ADM_CLAVE"); [ "$c" = 200 ] && ok "el administrador entra con su clave → 200" || falla "entrar el administrador → $c $(head -c 120 "$T/r")"

# ── 1b. Términos de uso (docs/20 §12; 11/11/2026): sin aceptar la versión vigente, la sesión solo sirve para leer lo legal, aceptar y salir ─
TV=$(curl -s -m 5 "$API/terminos" | python3 -I -c "import sys,json; print(json.load(sys.stdin)['version'])" 2>/dev/null)
[[ "$TV" =~ ^[0-9]+$ ]] && ok "GET /terminos (pública) trae la versión vigente ($TV)" || falla "GET /terminos sin versión: ${TV:-nada}"
aceptar() { # QUIEN: acepta la versión vigente y comprueba el 200
  local c; c=$(pedir "$1" POST /terminos/aceptar "{\"version\":$TV}")
  [ "$c" = 200 ] && ok "$1 acepta los términos (versión $TV) → 200" || falla "$1 acepta los términos → $c $(head -c 120 "$T/r")"
}
caso "términos pendientes: GET /dispositivos → 403" 403 adm GET /dispositivos
[ "$(campo "v['codigo']")" = terminos_pendientes ] && ok "el 403 trae el código terminos_pendientes (el panel muestra la pantalla de términos)" || falla "403 sin el código: $(head -c 160 "$T/r")"
caso "términos pendientes: GET /sesion → 200" 200 adm GET /sesion
[ "$(campo "(v['terminos']['pendiente'], v['terminos']['version_vigente'], v['administrador_sistema'], v['preferencias']['actualizado_en'])")" = "(True, $TV, False, None)" ] \
  && ok "GET /sesion dice términos pendientes, la versión vigente, el perfil global y las preferencias por defecto" || falla "GET /sesion: $(head -c 300 "$T/r")"
for r in /terminos /privacidad /acerca; do caso "términos pendientes: GET $r (pública)" 200 adm GET "$r"; done
caso "términos pendientes: POST /soporte → 403" 403 adm POST /soporte '{"texto":"hola"}'
caso "POST /terminos/aceptar con otra versión → 409 (se mostró un texto viejo)" 409 adm POST /terminos/aceptar '{"version":999}'
aceptar adm
caso "aceptados: GET /dispositivos → 200" 200 adm GET /dispositivos
n=$(sql -c "SELECT count(*) FROM evento WHERE tipo = 'terminos_aceptados' AND usuario_id = (SELECT id FROM usuario WHERE email = '$ADM_EMAIL')")
[ "$n" = 1 ] && ok "aceptar deja su evento terminos_aceptados con quién" || falla "eventos terminos_aceptados: $n"
# «Subir la versión» se simula dejando la aceptada por debajo de la vigente (la vigente es una constante del código): vuelve a restringir.
sql -c "UPDATE usuario SET terminos_version_aceptada = NULL, terminos_aceptados_en = NULL WHERE email = '$ADM_EMAIL'" >/dev/null
caso "con una versión aceptada menor que la vigente, otra vez 403" 403 adm GET /dispositivos
aceptar adm

# La cookie, leída con curl -D - (docs/20 §8): HttpOnly, Secure, SameSite=Lax y Path=/, también en desarrollo; con el prefijo __Host-
# (revisión del 08/11/2026), que el navegador solo acepta con Secure, Path=/ y sin Domain.
cab=$(curl "${IFZ[@]}" -s -m 15 -D - -o /dev/null -X POST -H 'X-Pedido: panel' -H 'Content-Type: application/json' --data-binary @- "$API/sesion" <<<"$(cuerpo_entrar "$ADM_EMAIL" <<<"$ADM_CLAVE")" | tr -d '\r' | grep -i '^set-cookie: __Host-sesion=')
if grep -q 'HttpOnly' <<<"$cab" && grep -q 'Secure' <<<"$cab" && grep -q 'SameSite=Lax' <<<"$cab" && grep -q 'Path=/;\|Path=/$' <<<"$cab" && ! grep -qi 'Domain=' <<<"$cab"; then
  ok "Set-Cookie: __Host-sesion=…; HttpOnly; Secure; SameSite=Lax; Path=/, sin Domain (leída con curl -D -)"
else falla "la cookie no trae su nombre o sus flags: ${cab:0:40}…"; fi
caso "GET /usuarios con X-Clave-Admin cuando ya hay administrador → 403 (como crear y cambiar)" 403 clave GET /usuarios
nost=$(curl -s -m 15 -D - -o /dev/null -b "$T/adm.jar" "$API/usuarios" | tr -d '\r' | grep -i '^cache-control:')
[ "$nost" = "Cache-Control: no-store" ] && ok "GET /usuarios responde Cache-Control: no-store (toda la API, main.ts)" || falla "GET /usuarios: «${nost:-sin Cache-Control}»"
nost=$(curl -s -m 15 -D - -o /dev/null "$API/salud" | tr -d '\r' | grep -i '^cache-control:')
[ "$nost" = "Cache-Control: no-store" ] && ok "GET /salud (pública) también lleva Cache-Control: no-store" || falla "GET /salud: «${nost:-sin Cache-Control}»"
panel=$(curl -s -m 15 -D - -o /dev/null "$API/panel/" | tr -d '\r')
if grep -q '^HTTP/[0-9.]* 200' <<<"$panel"; then
  ! grep -qi '^cache-control:.*no-store' <<<"$panel" && ok "los archivos del panel (/panel/) quedan fuera del no-store" || falla "/panel/ con no-store: el navegador no podría guardar sus archivos"
fi
SIN_PEDIDO=1 caso "POST /sesion sin X-Pedido: panel → 403 (un formulario de otro sitio no inicia sesión)" 403 anon POST /sesion "$(cuerpo_entrar "$ADM_EMAIL" <<<"$ADM_CLAVE")"

# ── 2. El administrador crea un usuario de consulta en su sitio ───────────────────────────────────────────────────────────────
caso "POST /usuarios (administrador, sesión) → 201" 201 adm POST /usuarios \
     "{\"nombre\":\"Consulta de prueba\",\"email\":\"$CON_EMAIL\",\"sitios\":[{\"sitio_id\":\"$SITIO_A\",\"rol\":\"consulta\"}]}"
CON_TEMP=$(campo "v['clave']"); CON_ID=$(campo "v['id']")
# Vigencia de la temporal (docs/20 §4; desde el 08/11/2026, CLAVE_TEMPORAL_HORAS, 1–72 h, 2 por defecto): la respuesta trae su vencimiento
# y queda a las horas que rigen en el contenedor (± 2 min), no a 24 h fijas.
HORAS_T=$(docker compose -f "$PLAT/docker-compose.yml" exec -T backend printenv CLAVE_TEMPORAL_HORAS 2>/dev/null | tr -d '[:space:]'); HORAS_T=${HORAS_T:-2}
d=$(python3 -I -c "import sys,json,datetime as t; v=json.load(open(sys.argv[1]))['clave_temporal_vence_en']; print(round((t.datetime.fromisoformat(v.replace('Z','+00:00')) - t.datetime.now(t.timezone.utc)).total_seconds()))" "$T/r" 2>/dev/null)
[ -n "$d" ] && [ $((d - HORAS_T * 3600)) -le 120 ] && [ $((HORAS_T * 3600 - d)) -le 120 ] \
  && ok "la temporal vence a las $HORAS_T h (CLAVE_TEMPORAL_HORAS; clave_temporal_vence_en en la respuesta, ${d} s)" || falla "vencimiento de la temporal: ${d:-sin dato} s; se esperaban $((HORAS_T * 3600)) ± 120"
CON_CLAVE=$(nueva_clave)
c=$(entrar con "$CON_EMAIL" <<<"$CON_TEMP"); [ "$c" = 200 ] || falla "consulta entra con la temporal → $c"
c=$(cambiar_clave con "$CON_TEMP" "$CON_CLAVE"); [ "$c" = 200 ] && ok "consulta cambia su clave temporal → 200" || falla "consulta cambia la clave → $c $(head -c 160 "$T/r")"
aceptar con

# ── 2b. Escalada entre sitios (revisión del 08/11/2026): la cuenta de quien también está en otro sitio no la toca un administrador de A ──
# «multi» está en A (lo crea el administrador de A) y en B (se lo da el dueño de la base, como lo haría un administrador de B).
caso "POST /usuarios (una persona de A que también estará en B)" 201 adm POST /usuarios \
     "{\"nombre\":\"Multi de prueba\",\"email\":\"multi$DOM\",\"sitios\":[{\"sitio_id\":\"$SITIO_A\",\"rol\":\"consulta\"}]}"
MULTI_ID=$(campo "v['id']")
sql -c "INSERT INTO usuario_sitio (usuario_id, sitio_id, rol) VALUES ('$MULTI_ID', '$SITIO_B', 'consulta')" >/dev/null
marca() { pedir adm GET /usuarios >/dev/null; campo "[u['actualizado_en'] for u in v if u['id']=='$1'][0]"; }
huella() { sql -c "SELECT md5(hash_password || activo::text || coalesce(clave_temporal_vence_en::text, '')) FROM usuario WHERE id = '$1'"; }
antes=$(huella "$MULTI_ID")
M=$(marca "$MULTI_ID")
caso "administrador de A: desactivar a quien también está en B → 403" 403 adm PATCH "/usuarios/$MULTI_ID" "{\"actualizado_en\":\"$M\",\"activo\":false,\"motivo\":\"prueba\"}"
[ "$(campo "v['message']")" = "la cuenta pertenece también a otros sitios: pídelo a un administrador del sistema" ] \
  && ok "el 403 lo explica: «la cuenta pertenece también a otros sitios…»" || falla "mensaje del 403: $(head -c 160 "$T/r")"
caso "administrador de A: clave temporal a quien también está en B → 403 (no puede entrar como ella)" 403 adm PATCH "/usuarios/$MULTI_ID" "{\"actualizado_en\":\"$M\",\"clave_temporal\":true}"
caso "administrador de A: su rol en A sí lo cambia → 200" 200 adm PATCH "/usuarios/$MULTI_ID" "{\"actualizado_en\":\"$M\",\"sitios\":[{\"sitio_id\":\"$SITIO_A\",\"rol\":\"consulta\"}]}"
[ "$(huella "$MULTI_ID")" = "$antes" ] && ok "la cuenta de quien también está en B no cambió (activa, misma clave y mismo vencimiento)" || falla "la cuenta de multi cambió pese al 403"
M=$(marca "$CON_ID")
caso "administrador de A: un campo de la cuenta de quien SOLO está en A → 200" 200 adm PATCH "/usuarios/$CON_ID" "{\"actualizado_en\":\"$M\",\"nombre\":\"Consulta de prueba\"}"

# ── 3. La matriz (docs/20 §6): sin sesión, consulta y administrador en su sitio, y otro sitio ───────────────────────────────────
ALTA="{\"id_fisico\":\"tn-$N\",\"nombre\":\"nodo nuevo\",\"zona_id\":\"$ZA\",\"via\":\"http\",\"intervalo_esperado_s\":60,\"canales\":[{\"magnitud\":\"temperatura\"}]}"
ALTA_B="{\"id_fisico\":\"tm-$N\",\"nombre\":\"nodo ajeno\",\"zona_id\":\"$ZB\",\"via\":\"http\",\"intervalo_esperado_s\":60,\"canales\":[{\"magnitud\":\"temperatura\"}]}"
CAL='{"escala_cero":0,"escala_cien":100,"actualizado_en":"2026-01-01T00:00:00.000000Z"}'
for r in /dispositivos "/dispositivos/$DA" "/canales/$CA/historico" /condiciones /cuarentena "/dispositivos/$DA/exportar" /usuarios /sesion; do
  caso "sin sesión: GET $r" 401 anon GET "$r"
done
code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 "$API/eventos"); [ "$code" = 401 ] && ok "sin sesión: GET /eventos → 401" || falla "sin sesión: GET /eventos → $code"
caso "sin sesión: POST /dispositivos" 401 anon POST /dispositivos "$ALTA"
caso "sin sesión: DELETE /dispositivos/{id}" 401 anon DELETE "/dispositivos/$DA2"
caso "sin sesión: POST /dispositivos/{id}/credencial" 401 anon POST "/dispositivos/$DA/credencial"
caso "sin sesión: PATCH /canales/{id}" 401 anon PATCH "/canales/$CA" "$CAL"
caso "sin sesión: POST /usuarios" 401 anon POST /usuarios '{}'
GW="{\"id_fisico\":\"gwn-$N\",\"nombre\":\"pasarela nueva\",\"sitio_id\":\"$SITIO_A\",\"formato\":\"chirpstack\"}"
GW_B="{\"id_fisico\":\"gwm-$N\",\"nombre\":\"pasarela ajena\",\"sitio_id\":\"$SITIO_B\",\"formato\":\"chirpstack\"}"
caso "sin sesión: POST /pasarelas" 401 anon POST /pasarelas "$GW"
caso "sin sesión: DELETE /pasarelas/{id}" 401 anon DELETE "/pasarelas/$PA"
caso "sin sesión: POST /pasarelas/{id}/credencial" 401 anon POST "/pasarelas/$PA/credencial"
caso "sin sesión: PATCH /usuarios/{id}" 401 anon PATCH "/usuarios/$CON_ID" '{}'
caso "sin sesión: DELETE /sesion" 401 anon DELETE /sesion
c=$(entrar nadie "nadie$DOM" <<<"no-es-la-clave-de-nadie"); [ "$c" = 401 ] && ok "sin sesión: POST /sesion con credenciales malas → 401" || falla "POST /sesion malas → $c"

caso "consulta: GET /dispositivos" 200 con GET /dispositivos
lista=$(campo "' '.join(d['id'] for d in v)")
grep -q "$DA" <<<"$lista" && ! grep -q "$DB" <<<"$lista" && ok "consulta: la lista trae su sitio y no el otro (filtro en el WHERE)" || falla "consulta: la lista no está filtrada por sitio"
caso "consulta: GET /dispositivos/{id} (su sitio)" 200 con GET "/dispositivos/$DA"
caso "consulta: GET /canales/{id}/historico (su sitio)" 200 con GET "/canales/$CA/historico"
caso "consulta: GET /condiciones?dispositivo= (su sitio)" 200 con GET "/condiciones?dispositivo=$DA"
caso "consulta: GET /cuarentena?dispositivo= (su sitio)" 200 con GET "/cuarentena?dispositivo=$DA"
caso "consulta: GET /dispositivos/{id}/exportar → 403 (exportar exige administrador)" 403 con GET "/dispositivos/$DA/exportar"
caso "consulta: POST /dispositivos" 403 con POST /dispositivos "$ALTA"
caso "consulta: DELETE /dispositivos/{id}" 403 con DELETE "/dispositivos/$DA2"
caso "consulta: POST /dispositivos/{id}/credencial" 403 con POST "/dispositivos/$DA/credencial"
caso "consulta: PATCH /canales/{id}" 403 con PATCH "/canales/$CA" "$CAL"
caso "consulta: POST /usuarios" 403 con POST /usuarios '{}'
caso "consulta: PATCH /usuarios/{id}" 403 con PATCH "/usuarios/$CON_ID" '{}'
caso "consulta: GET /usuarios" 403 con GET /usuarios
caso "consulta, otro sitio: GET /dispositivos/{id}" 404 con GET "/dispositivos/$DB"
cp "$T/r" "$T/otro.json"; pedir con GET "/dispositivos/$FALSO" >/dev/null
cmp -s "$T/r" "$T/otro.json" && ok "otro sitio responde lo mismo que un dispositivo inexistente (mismo 404 y mismo cuerpo)" || falla "otro sitio e inexistente difieren: $(cat "$T/otro.json") ≠ $(cat "$T/r")"
caso "consulta, otro sitio: GET /canales/{id}/historico" 404 con GET "/canales/$CB/historico"
caso "consulta, otro sitio: GET /condiciones?dispositivo=" 404 con GET "/condiciones?dispositivo=$DB"
caso "consulta, otro sitio: GET /cuarentena?dispositivo=" 404 con GET "/cuarentena?dispositivo=$DB"
caso "consulta, otro sitio: GET /eventos?dispositivo=" 404 con GET "/eventos?dispositivo=$DB"
caso "consulta, otro sitio: GET /dispositivos/{id}/exportar" 404 con GET "/dispositivos/$DB/exportar"
caso "consulta: POST /pasarelas" 403 con POST /pasarelas "$GW"
caso "consulta: DELETE /pasarelas/{id} (su sitio)" 403 con DELETE "/pasarelas/$PA"
caso "consulta: POST /pasarelas/{id}/credencial (su sitio)" 403 con POST "/pasarelas/$PA/credencial"
# Las listas SIN ?dispositivo= (revisión del 08/11/2026): el filtro por sitio va en el WHERE, no solo en la ruta con dispositivo.
caso "consulta: GET /condiciones (sin ?dispositivo=)" 200 con GET "/condiciones?abiertas=true&limite=500"
lista=$(campo "' '.join(c['id'] for c in v)")
grep -q "$KA" <<<"$lista" && ! grep -q "$KB" <<<"$lista" && ok "consulta: GET /condiciones trae la condición de su sitio y no la del otro" || falla "GET /condiciones sin filtro de sitio: A $(grep -c "$KA" <<<"$lista"), B $(grep -c "$KB" <<<"$lista")"
caso "consulta: GET /cuarentena (sin ?dispositivo=)" 200 con GET /cuarentena
lista=$(campo "' '.join(c['id'] for c in v)")
grep -q "$QA" <<<"$lista" && ! grep -q "$QB" <<<"$lista" && ok "consulta: GET /cuarentena trae la trama de su sitio y no la del otro" || falla "GET /cuarentena sin filtro de sitio: A $(grep -c "$QA" <<<"$lista"), B $(grep -c "$QB" <<<"$lista")"
caso "consulta: GET /pasarelas" 200 con GET /pasarelas
lista=$(campo "' '.join(g['id'] for g in v)")
grep -q "$PA" <<<"$lista" && ! grep -q "$PB" <<<"$lista" && ok "consulta: GET /pasarelas trae la de su sitio y no la del otro" || falla "GET /pasarelas sin filtro de sitio"

for r in /dispositivos "/dispositivos/$DA" "/canales/$CA/historico" /condiciones /cuarentena "/dispositivos/$DA/exportar" /usuarios /pasarelas; do
  caso "administrador: GET $r" 200 adm GET "$r"
done
pedir adm GET /dispositivos >/dev/null; lista=$(campo "' '.join(d['id'] for d in v)")
! grep -q "$DB" <<<"$lista" && ok "administrador: la lista no trae el otro sitio" || falla "administrador ve el otro sitio en la lista"
caso "administrador: POST /dispositivos (zona de su sitio)" 201 adm POST /dispositivos "$ALTA"
pedir adm GET "/dispositivos/$DA" >/dev/null; MARCA=$(campo "v['canales'][0]['actualizado_en']")
caso "administrador: PATCH /canales/{id} con la marca vigente" 200 adm PATCH "/canales/$CA" "{\"escala_cero\":0,\"escala_cien\":100,\"actualizado_en\":\"$MARCA\"}"
caso "administrador: PATCH /canales/{id} con la marca vieja → 409 (bloqueo optimista)" 409 adm PATCH "/canales/$CA" "{\"escala_cero\":1,\"escala_cien\":99,\"actualizado_en\":\"$MARCA\"}"
SIN_PEDIDO=1 caso "administrador sin X-Pedido: panel en una ruta que escribe → 403 (CSRF)" 403 adm POST "/dispositivos/$DA/credencial"
caso "administrador: POST /dispositivos/{id}/credencial" 201 adm POST "/dispositivos/$DA/credencial"
TOKEN_A=$(campo "v['conexion']['token']")
caso "administrador: DELETE /dispositivos/{id}" 200 adm DELETE "/dispositivos/$DA2"
caso "administrador: DELETE /dispositivos/{id} otra vez → 409" 409 adm DELETE "/dispositivos/$DA2"
pedir adm GET /usuarios >/dev/null; MARCA_U=$(campo "[u['actualizado_en'] for u in v if u['id']=='$CON_ID'][0]")
caso "administrador: PATCH /usuarios/{id} (nombre)" 200 adm PATCH "/usuarios/$CON_ID" "{\"actualizado_en\":\"$MARCA_U\",\"nombre\":\"Consulta renombrada\"}"
caso "administrador, otro sitio: GET /dispositivos/{id}" 404 adm GET "/dispositivos/$DB"
caso "administrador, otro sitio: GET /dispositivos/{id}/exportar" 404 adm GET "/dispositivos/$DB/exportar"
caso "administrador, otro sitio: POST /dispositivos (zona ajena)" 404 adm POST /dispositivos "$ALTA_B"
caso "administrador, otro sitio: DELETE /dispositivos/{id}" 404 adm DELETE "/dispositivos/$DB"
caso "administrador, otro sitio: POST /dispositivos/{id}/credencial" 404 adm POST "/dispositivos/$DB/credencial"
caso "administrador, otro sitio: PATCH /canales/{id}" 404 adm PATCH "/canales/$CB" "$CAL"
caso "administrador, otro sitio: POST /usuarios (sitio ajeno)" 404 adm POST /usuarios "{\"nombre\":\"X\",\"email\":\"x$DOM\",\"sitios\":[{\"sitio_id\":\"$SITIO_B\",\"rol\":\"consulta\"}]}"
caso "administrador, otro sitio: GET /eventos?dispositivo=" 404 adm GET "/eventos?dispositivo=$DB"
caso "administrador, otro sitio: POST /pasarelas (sitio ajeno)" 404 adm POST /pasarelas "$GW_B"
caso "administrador, otro sitio: DELETE /pasarelas/{id}" 404 adm DELETE "/pasarelas/$PB"
caso "administrador, otro sitio: POST /pasarelas/{id}/credencial" 404 adm POST "/pasarelas/$PB/credencial"
n=$(sql -c "SELECT count(*) FROM pasarela WHERE id_fisico IN ('gwn-$N', 'gwm-$N') OR (id = '$PB' AND NOT activo)")
[ "$n" = 0 ] && ok "ninguna pasarela creada ni dada de baja por los rechazos (todo se cortó antes del broker)" || falla "los rechazos dejaron $n pasarela(s) creada(s) o dada(s) de baja"
M_B=$(sql -c "SELECT to_char(actualizado_en AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') FROM usuario WHERE id = '$SOLO_B'")
caso "administrador, otro sitio: PATCH /usuarios/{id} de quien solo está en B → 404 (como uno inexistente)" 404 adm PATCH "/usuarios/$SOLO_B" "{\"actualizado_en\":\"$M_B\",\"activo\":false,\"motivo\":\"prueba\"}"
cp "$T/r" "$T/otro-u.json"; pedir adm PATCH "/usuarios/$FALSO" "{\"actualizado_en\":\"$M_B\",\"activo\":false,\"motivo\":\"prueba\"}" >/dev/null
cmp -s "$T/r" "$T/otro-u.json" && ok "PATCH /usuarios/{id} de otro sitio responde lo mismo que un usuario inexistente" || falla "PATCH /usuarios de otro sitio e inexistente difieren: $(cat "$T/otro-u.json") ≠ $(cat "$T/r")"
[ "$(sql -c "SELECT activo FROM usuario WHERE id = '$SOLO_B'")" = t ] && ok "la persona de B sigue activa" || falla "la persona de B cambió pese al 404"

# ── 3b. Tablero v2 (docs/19 §4, I; docs/10 §8.4 punto 65; docs/16 §61): una fila por ruta nueva y perfil ─────────────────────────
for r in /sitios "/sitios/$SITIO_A/resumen" "/sitios/$SITIO_A/ahora" "/sitios/$SITIO_A/historico?magnitud=temperatura" "/dispositivos/$DA/historico" "/dispositivos/$DA/eventos" /cuarentena/detectados; do
  caso "sin sesión: GET ${r%%\?*}" 401 anon GET "$r"
done
caso "sin sesión: PATCH /dispositivos/{id}" 401 anon PATCH "/dispositivos/$DA" '{}'
caso "sin sesión: PUT /canales/{id}/reglas" 401 anon PUT "/canales/$CA/reglas" '{}'
caso "sin sesión: POST /dispositivos/lote" 401 anon POST "/dispositivos/lote?modo=validar" '{}'
caso "consulta: GET /sitios" 200 con GET /sitios
[ "$(campo "' '.join(x['id']+':'+x['rol'] for x in v)")" = "$SITIO_A:consulta" ] && ok "consulta: GET /sitios trae solo su sitio, con su rol" || falla "consulta: GET /sitios → $(head -c 160 "$T/r")"
for r in "/sitios/$SITIO_A/resumen" "/sitios/$SITIO_A/ahora" "/sitios/$SITIO_A/historico?magnitud=temperatura" "/dispositivos/$DA/historico" "/dispositivos/$DA/eventos"; do
  caso "consulta: GET ${r%%\?*} (su sitio)" 200 con GET "$r"
  caso "administrador: GET ${r%%\?*} (su sitio)" 200 adm GET "$r"
done
for r in "/sitios/$SITIO_B/resumen" "/sitios/$SITIO_B/ahora" "/sitios/$SITIO_B/historico?magnitud=temperatura" "/dispositivos/$DB/historico" "/dispositivos/$DB/eventos"; do
  caso "consulta, otro sitio: GET ${r%%\?*}" 404 con GET "$r"
  caso "administrador, otro sitio: GET ${r%%\?*}" 404 adm GET "$r"
done
# «Ahora» (docs/19 §4, L6): con tendencia, la forma; el dispositivo de A está, el de B no; limite fuera de 1–60 → 400 antes del alcance.
caso "consulta: GET /sitios/{id}/ahora?tendencia=si (su sitio)" 200 con GET "/sitios/$SITIO_A/ahora?tendencia=si&limite=60"
[ "$(campo "(sorted(v) == ['chispa', 'dispositivos', 'por_magnitud', 'reportan', 'sin_senal'], v['chispa']['puntos'], all(len(c['chispa']) == 24 for d in v['dispositivos'] for c in d['canales']), '$DB' in [d['id'] for d in v['dispositivos']])")" = "(True, 24, True, False)" ] \
  && ok "consulta: «Ahora» con tendencia trae la chispa de 24 cubos y ningún dispositivo de otro sitio" || falla "consulta: GET /sitios/{id}/ahora?tendencia=si → $(head -c 300 "$T/r")"
caso "consulta: GET /sitios/{id}/ahora?limite=61 → 400" 400 con GET "/sitios/$SITIO_A/ahora?limite=61"
caso "consulta, otro sitio: GET /sitios/{id}/ahora?limite=61 → 400 (la entrada se valida antes que el alcance)" 400 con GET "/sitios/$SITIO_B/ahora?limite=61"
caso "consulta: GET /cuarentena/detectados → 403 (es la entrada del alta)" 403 con GET /cuarentena/detectados
caso "administrador: GET /cuarentena/detectados?sitio= (su sitio)" 200 adm GET "/cuarentena/detectados?sitio=$SITIO_A"
caso "administrador, otro sitio: GET /cuarentena/detectados?sitio=" 404 adm GET "/cuarentena/detectados?sitio=$SITIO_B"
pedir adm GET "/dispositivos/$DA" >/dev/null; MD=$(campo "v['actualizado_en']"); MC=$(campo "[c for c in v['canales'] if c['id']=='$CA'][0]['actualizado_en']")
caso "consulta: PATCH /dispositivos/{id}" 403 con PATCH "/dispositivos/$DA" "{\"actualizado_en\":\"$MD\",\"nombre\":\"x\"}"
caso "consulta: PUT /canales/{id}/reglas" 403 con PUT "/canales/$CA/reglas" "{\"actualizado_en\":\"$MC\",\"reglas\":[]}"
caso "consulta: POST /dispositivos/lote" 403 con POST "/dispositivos/lote?modo=validar" '{"filas":[{}]}'
caso "administrador: PATCH /dispositivos/{id} con la marca vigente (mantenimiento)" 200 adm PATCH "/dispositivos/$DA" "{\"actualizado_en\":\"$MD\",\"estado\":\"mantenimiento\"}"
[ "$(campo "v['estado']")" = mantenimiento ] && ok "PATCH responde la ficha con el estado nuevo" || falla "PATCH no devolvió la ficha: $(head -c 120 "$T/r")"
caso "administrador: PATCH /dispositivos/{id} con la marca vieja → 409 (bloqueo optimista)" 409 adm PATCH "/dispositivos/$DA" "{\"actualizado_en\":\"$MD\",\"estado\":\"activo\"}"
caso "administrador: PATCH /dispositivos/{id} a una zona de otro sitio → 400" 400 adm PATCH "/dispositivos/$DA" "{\"actualizado_en\":\"$(campo "v['actualizado_en']")\",\"zona_id\":\"$ZB\"}"
pedir adm GET "/dispositivos/$DA" >/dev/null
caso "administrador: PATCH /dispositivos/{id} de vuelta a activo (lo que sigue espera sus tramas)" 200 adm PATCH "/dispositivos/$DA" "{\"actualizado_en\":\"$(campo "v['actualizado_en']")\",\"estado\":\"activo\"}"
pedir adm GET "/dispositivos/$DA" >/dev/null; MC=$(campo "[c for c in v['canales'] if c['id']=='$CA'][0]['actualizado_en']")
caso "administrador: PUT /canales/{id}/reglas con la marca vigente" 200 adm PUT "/canales/$CA/reglas" "{\"actualizado_en\":\"$MC\",\"reglas\":[{\"umbral_alto\":30,\"histeresis\":1,\"retardo_s\":60}]}"
caso "administrador: PUT /canales/{id}/reglas con la marca vieja → 409" 409 adm PUT "/canales/$CA/reglas" "{\"actualizado_en\":\"$MC\",\"reglas\":[]}"
caso "administrador: PUT /canales/{id}/reglas con bajo ≥ alto → 400" 400 adm PUT "/canales/$CA/reglas" "{\"actualizado_en\":\"$MC\",\"reglas\":[{\"umbral_alto\":5,\"umbral_bajo\":9}]}"
caso "administrador, otro sitio: PATCH /dispositivos/{id}" 404 adm PATCH "/dispositivos/$DB" "{\"actualizado_en\":\"$MD\",\"nombre\":\"x\"}"
caso "administrador, otro sitio: PUT /canales/{id}/reglas" 404 adm PUT "/canales/$CB/reglas" "{\"actualizado_en\":\"$MC\",\"reglas\":[]}"
ADM_UID=$(sql -c "SELECT id FROM usuario WHERE email = '$ADM_EMAIL'")
n=$(sql -c "SELECT count(*) FROM evento WHERE dispositivo_id = '$DA' AND tipo IN ('dispositivo_configurado', 'reglas_cambiadas') AND usuario_id = '$ADM_UID'")
[ "$n" = 3 ] && ok "cada guardado deja su evento con quién lo hizo (evento.usuario_id = el administrador): 3 de 3" || falla "eventos con usuario_id del administrador: $n (esperado 3)"
# «Quién hizo el cambio» es un dato personal (docs/21 §2; decidido el 11/11/2026): el nombre, solo para quien administra el sitio.
caso "administrador: GET /dispositivos/{id}/eventos muestra quién (usuario{id, nombre})" 200 adm GET "/dispositivos/$DA/eventos"
[ "$(campo "sum(1 for e in v if e['usuario'] and e['usuario']['id']=='$ADM_UID' and e['tipo'] in ('dispositivo_configurado','reglas_cambiadas'))")" = 3 ] && ok "administrador: los eventos del dispositivo traen la persona que configuró" || falla "administrador: eventos sin la persona: $(head -c 200 "$T/r")"
caso "consulta: GET /dispositivos/{id}/eventos (su sitio)" 200 con GET "/dispositivos/$DA/eventos"
[ "$(campo "(len([e for e in v if e['tipo'] in ('dispositivo_configurado','reglas_cambiadas')]), sum(1 for e in v if e['usuario'] is not None))")" = "(3, 0)" ] && ok "consulta: ve los 3 eventos, pero sin el nombre de quien los hizo (usuario: null)" || falla "consulta ve quién: $(head -c 200 "$T/r")"
LOTE="{\"filas\":[{\"id_fisico\":\"tl-$N\",\"nombre\":\"por lote\",\"zona\":\"$ZA\",\"via\":\"http\",\"intervalo_esperado_s\":\"60\",\"canales\":\"temperatura:Cel\"},{\"id_fisico\":\"tk-$N\",\"nombre\":\"ajeno\",\"zona\":\"$ZB\",\"via\":\"http\",\"intervalo_esperado_s\":\"60\",\"canales\":\"temperatura\"},{\"id_fisico\":\"tb-$N\",\"nombre\":\"de otro sitio\",\"zona\":\"$ZA\",\"via\":\"http\",\"intervalo_esperado_s\":\"60\",\"canales\":\"temperatura\"},{\"id_fisico\":\"gwb-$N\",\"nombre\":\"pasarela de otro sitio\",\"zona\":\"$ZA\",\"via\":\"http\",\"intervalo_esperado_s\":\"60\",\"canales\":\"temperatura\"},{\"id_fisico\":\"ta-$N\",\"nombre\":\"ya existe\",\"zona\":\"$ZA\",\"via\":\"http\",\"intervalo_esperado_s\":\"60\",\"canales\":\"temperatura\"}]}"
caso "administrador: POST /dispositivos/lote?modo=crear" 200 adm POST "/dispositivos/lote?modo=crear" "$LOTE"
[ "$(campo "' '.join(f['resultado'] for f in v['filas'])")" = "creada rechazada rechazada rechazada existe" ] && ok "lote: crea la válida, rechaza la de una zona de otro sitio (como inexistente) y marca la que ya existe" || falla "lote: $(head -c 300 "$T/r")"
# RF-41 (revisión del 11/11/2026): el id_fisico de un dispositivo o de una pasarela del sitio B, subido desde A, no revela su UUID ni su estado.
[ "$(campo "[(f['motivo'], f['id']) for f in v['filas'][2:4]]")" = "[('identificador no disponible', None), ('identificador no disponible', None)]" ] && ok "lote: un id_fisico de un dispositivo o pasarela de otro sitio → «identificador no disponible», sin id" || falla "lote ajeno: $(campo "v['filas'][2:4]")"
grep -q "$DB" "$T/r" && falla "lote: la respuesta trae el UUID del dispositivo del sitio B" || ok "lote: la respuesta no trae el UUID del dispositivo del sitio B"
[ -n "$(campo "v['filas'][0]['credencial'] or ''")" ] && ok "lote: la credencial de la creada viene una vez en la respuesta" || falla "lote sin credencial"
n=$(sql -c "SELECT count(*) FROM dispositivo d JOIN evento e ON e.dispositivo_id = d.id AND e.tipo = 'alta' AND e.usuario_id = '$ADM_UID' WHERE d.id_fisico = 'tl-$N'")
[ "$n" = 1 ] && ok "lote: el dispositivo quedó con su evento de alta y quién lo creó" || falla "lote: evento de alta con usuario → $n"

# ── 3c. Listas por clave (docs/10 §8.4 punto 58 iv): una fila insertada entre dos páginas no se repite ni se pierde; un cursor de otro sitio
# no trae nada de ese sitio. Cuatro eventos con instantes fijos en el dispositivo A2; la página 1 trae los dos más nuevos; se inserta un
# quinto, más nuevo que todos (con desplazamiento, la página 2 repetiría el último de la 1); la página 2 sigue exactamente después.
sql -c "INSERT INTO evento (dispositivo_id, tipo, detalle, ocurrido_en) SELECT '$DA2', 'prueba_keyset', jsonb_build_object('n', n), '2026-01-01T00:00:00Z'::timestamptz + n * INTERVAL '1 second' FROM generate_series(1, 4) n" >/dev/null
EVQ="/dispositivos/$DA2/eventos?desde=2025-12-31T00:00:00Z&hasta=2026-01-02T00:00:00Z&limite=2"
sig=$(pedir_cabecera adm "$EVQ" X-Siguiente); P1=$(campo "[e['detalle']['n'] for e in v]")
sql -c "INSERT INTO evento (dispositivo_id, tipo, detalle, ocurrido_en) VALUES ('$DA2', 'prueba_keyset', '{\"n\": 5}', '2026-01-01T00:00:05Z')" >/dev/null
caso "keyset: página 2 de los eventos con el cursor de la 1" 200 adm GET "$EVQ&cursor=$sig"
[ "$P1 | $(campo "[e['detalle']['n'] for e in v]")" = "[4, 3] | [2, 1]" ] && ok "keyset: la fila insertada entre dos páginas no se repite ni se pierde (4 3 | 2 1)" || falla "keyset: páginas $P1 | $(campo "[e['detalle']['n'] for e in v]")"
# Un cursor armado con la condición del sitio B (instante e id reales), usado por la persona de consulta de A: solo filas de A.
CUR_B=$(sql -c "SELECT to_char(abierta_en AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') || ' ' || id FROM condicion WHERE id = '$KB'" | python3 -I -c "import sys,json,base64; t,i=sys.stdin.read().split(); print(base64.urlsafe_b64encode(json.dumps([t,i]).encode()).decode().rstrip('='))")
caso "keyset: consulta pide /condiciones con un cursor de otro sitio" 200 con GET "/condiciones?limite=500&cursor=$CUR_B"
[ "$(campo "sum(1 for c in v if c['dispositivo_id']=='$DB')")" = 0 ] && ok "keyset: un cursor de otro sitio no trae nada de ese sitio (el alcance sigue en el WHERE)" || falla "keyset: el cursor de B trajo filas de B"

# ── 3d. Cinco perfiles (docs/20 §6, las siete columnas; 11/11/2026): investigador, operador técnico y administrador del sistema ────────
# El investigador y el operador los da de alta el administrador de A; el administrador del sistema se crea con el dueño de la base (solo
# otro administrador del sistema puede dar ese perfil) con el hash que calcula el backend. Cada uno entra, cambia su temporal y acepta.
alta_persona() { # QUIEN EMAIL ROL NOMBRE → deja la clave nueva en NUEVA_ULTIMA
  local quien=$1 email=$2 rol=$3 nombre=$4 tmp c c2
  caso "POST /usuarios ($rol de A, por el administrador de A)" 201 adm POST /usuarios "{\"nombre\":\"$nombre\",\"email\":\"$email\",\"sitios\":[{\"sitio_id\":\"$SITIO_A\",\"rol\":\"$rol\"}]}"
  tmp=$(campo "v['clave']"); NUEVA_ULTIMA=$(nueva_clave)
  c=$(entrar "$quien" "$email" <<<"$tmp"); c2=$(cambiar_clave "$quien" "$tmp" "$NUEVA_ULTIMA")
  [ "$c$c2" = 200200 ] || falla "$rol entra y cambia su temporal → $c y $c2"
  aceptar "$quien"
}
alta_persona inv "inv$DOM" investigador "Investigación de prueba"
INV_CLAVE=$NUEVA_ULTIMA; INV_ID=$(sql -c "SELECT id FROM usuario WHERE email = 'inv$DOM'")
alta_persona ope "ope$DOM" operador "Operación de prueba"
SIS_CLAVE=$(nueva_clave)
HASH_SIS=$(printf '%s' "$SIS_CLAVE" | docker compose -f "$PLAT/docker-compose.yml" exec -T backend node -e \
  "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>import('/app/dist/alta/credenciales.js').then(m=>m.hashScrypt(s,undefined,2**17)).then(h=>process.stdout.write(h)))")
[[ "$HASH_SIS" =~ ^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$ ]] || falla "el backend no devolvió el hash del administrador del sistema"
SIS_ID=$(sql <<SQL
INSERT INTO usuario (nombre, email, hash_password, administrador_sistema) VALUES ('Sistema de prueba', 'sis$DOM', '$HASH_SIS', true) RETURNING id;
SQL
)
c=$(entrar sis "sis$DOM" <<<"$SIS_CLAVE"); [ "$c" = 200 ] && ok "el administrador del sistema (sin sitios propios) entra → 200" || falla "entrar sis → $c"
aceptar sis
caso "administrador del sistema: GET /sesion" 200 sis GET /sesion
[ "$(campo "v['administrador_sistema']")" = True ] && ok "GET /sesion: administrador_sistema: true" || falla "GET /sesion del sistema: $(head -c 200 "$T/r")"
caso "investigador: GET /sesion" 200 inv GET /sesion
[ "$(campo "(v['administrador_sistema'], [s['rol'] for s in v['sitios']], sorted(v['permisos']['investigador']))")" = "(False, ['investigador'], ['exportar', 'leer'])" ] \
  && ok "GET /sesion del investigador: su perfil por sitio y la matriz de cinco perfiles" || falla "GET /sesion del investigador: $(head -c 300 "$T/r")"

# Lecturas: los tres perfiles nuevos en su sitio; el del sistema, también en B (todos los sitios).
for q in inv ope sis; do
  for r in /dispositivos "/dispositivos/$DA" "/canales/$CA/historico" /condiciones /cuarentena /pasarelas /sitios "/sitios/$SITIO_A/resumen" "/sitios/$SITIO_A/ahora" "/dispositivos/$DA/historico" "/dispositivos/$DA/eventos"; do
    caso "$q: GET ${r%%\?*}" 200 "$q" GET "$r"
  done
done
for q in inv ope; do
  caso "$q, otro sitio: GET /dispositivos/{id}" 404 "$q" GET "/dispositivos/$DB"
  caso "$q, otro sitio: GET /sitios/{id}/resumen" 404 "$q" GET "/sitios/$SITIO_B/resumen"
  caso "$q, otro sitio: GET /sitios/{id}/ahora" 404 "$q" GET "/sitios/$SITIO_B/ahora"
done
caso "administrador del sistema: GET /sitios/{id}/ahora del sitio B (todos los sitios)" 200 sis GET "/sitios/$SITIO_B/ahora"
caso "administrador del sistema: GET /dispositivos/{id} del sitio B (todos los sitios)" 200 sis GET "/dispositivos/$DB"
pedir sis GET /dispositivos >/dev/null; lista=$(campo "' '.join(d['id'] for d in v)")
grep -q "$DA" <<<"$lista" && grep -q "$DB" <<<"$lista" && ok "administrador del sistema: la lista trae A y B" || falla "administrador del sistema: la lista no trae los dos sitios"
# Exportar: administrador de sitio e investigador (y el del sistema); consulta y operador técnico, 403.
caso "investigador: GET /dispositivos/{id}/exportar → 200" 200 inv GET "/dispositivos/$DA/exportar"
caso "operador técnico: GET /dispositivos/{id}/exportar → 403" 403 ope GET "/dispositivos/$DA/exportar"
caso "administrador del sistema: GET /dispositivos/{id}/exportar (sitio B)" 200 sis GET "/dispositivos/$DB/exportar"
# Escribir y configurar: operador técnico y administradores; el investigador, 403. La baja: solo administradores.
ALTA_O="{\"id_fisico\":\"to-$N\",\"nombre\":\"nodo del operador\",\"zona_id\":\"$ZA\",\"via\":\"http\",\"intervalo_esperado_s\":60,\"canales\":[{\"magnitud\":\"temperatura\"}]}"
caso "investigador: POST /dispositivos → 403" 403 inv POST /dispositivos "$ALTA_O"
caso "operador técnico: POST /dispositivos (zona de su sitio) → 201" 201 ope POST /dispositivos "$ALTA_O"
DO=$(campo "v['id']")
caso "administrador del sistema: POST /dispositivos en el sitio B → 201" 201 sis POST /dispositivos "$ALTA_B"
caso "investigador: POST /dispositivos/{id}/credencial → 403" 403 inv POST "/dispositivos/$DA/credencial"
caso "operador técnico: POST /dispositivos/{id}/credencial → 201" 201 ope POST "/dispositivos/$DA/credencial"
TOKEN_A=$(campo "v['conexion']['token']") # la credencial vigente de A (la sección 4 la usa para enviar)
caso "investigador: DELETE /dispositivos/{id} → 403" 403 inv DELETE "/dispositivos/$DO"
caso "operador técnico: DELETE /dispositivos/{id} → 403 (la baja es del administrador)" 403 ope DELETE "/dispositivos/$DO"
caso "administrador del sistema: DELETE /dispositivos/{id} → 200" 200 sis DELETE "/dispositivos/$DO"
caso "investigador: POST /pasarelas → 403" 403 inv POST /pasarelas "$GW"
caso "operador técnico: POST /pasarelas en un sitio ajeno → 404 (pasa el permiso; el sitio no es suyo)" 404 ope POST /pasarelas "$GW_B"
caso "operador técnico: DELETE /pasarelas/{id} → 403 (la baja es del administrador)" 403 ope DELETE "/pasarelas/$PA"
pedir adm GET "/dispositivos/$DA" >/dev/null; MD=$(campo "v['actualizado_en']"); MC=$(campo "[c for c in v['canales'] if c['id']=='$CA'][0]['actualizado_en']")
caso "investigador: PATCH /canales/{id} (calibración) → 403" 403 inv PATCH "/canales/$CA" "{\"escala_cero\":0,\"escala_cien\":100,\"actualizado_en\":\"$MC\"}"
caso "operador técnico: PATCH /canales/{id} (calibración) → 200" 200 ope PATCH "/canales/$CA" "{\"escala_cero\":0,\"escala_cien\":100,\"actualizado_en\":\"$MC\"}"
pedir adm GET "/dispositivos/$DA" >/dev/null; MC=$(campo "[c for c in v['canales'] if c['id']=='$CA'][0]['actualizado_en']")
caso "investigador: PATCH /dispositivos/{id} → 403" 403 inv PATCH "/dispositivos/$DA" "{\"actualizado_en\":\"$MD\",\"nombre\":\"nodo A\"}"
caso "operador técnico: PATCH /dispositivos/{id} → 200" 200 ope PATCH "/dispositivos/$DA" "{\"actualizado_en\":\"$MD\",\"nombre\":\"nodo A\"}"
caso "investigador: PUT /canales/{id}/reglas → 403" 403 inv PUT "/canales/$CA/reglas" "{\"actualizado_en\":\"$MC\",\"reglas\":[]}"
caso "operador técnico: PUT /canales/{id}/reglas → 200" 200 ope PUT "/canales/$CA/reglas" "{\"actualizado_en\":\"$MC\",\"reglas\":[{\"umbral_alto\":31,\"histeresis\":1}]}"
caso "investigador: POST /dispositivos/lote → 403" 403 inv POST "/dispositivos/lote?modo=validar" '{"filas":[{}]}'
caso "operador técnico: POST /dispositivos/lote?modo=validar → 200" 200 ope POST "/dispositivos/lote?modo=validar" '{"filas":[{}]}'
caso "investigador: GET /cuarentena/detectados → 403" 403 inv GET /cuarentena/detectados
caso "operador técnico: GET /cuarentena/detectados?sitio= → 200" 200 ope GET "/cuarentena/detectados?sitio=$SITIO_A"
caso "administrador del sistema: GET /cuarentena/detectados?sitio= (B) → 200" 200 sis GET "/cuarentena/detectados?sitio=$SITIO_B"
# Usuarios: administradores (de sitio en sus sitios; del sistema, todas las cuentas) y nadie más.
for q in inv ope; do caso "$q: GET /usuarios → 403" 403 "$q" GET /usuarios; caso "$q: POST /usuarios → 403" 403 "$q" POST /usuarios '{}'; done
caso "administrador del sistema: GET /usuarios (todas las cuentas)" 200 sis GET /usuarios
grep -q "$SOLO_B" "$T/r" && grep -q "$CON_ID" "$T/r" && ok "administrador del sistema: ve a la persona de A y a la que solo está en B" || falla "administrador del sistema no ve todas las cuentas"
M_B=$(sql -c "SELECT to_char(actualizado_en AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') FROM usuario WHERE id = '$SOLO_B'")
caso "administrador del sistema: desactiva (con motivo) a quien solo está en B → 200" 200 sis PATCH "/usuarios/$SOLO_B" "{\"actualizado_en\":\"$M_B\",\"activo\":false,\"motivo\":\"prueba del sistema\"}"
caso "administrador del sistema: la reactiva (con clave temporal nueva) → 200" 200 sis PATCH "/usuarios/$SOLO_B" "{\"actualizado_en\":\"$(campo "v['actualizado_en']")\",\"activo\":true,\"clave_temporal\":true}"
M=$(marca "$CON_ID")
caso "administrador de sitio: dar administrador_sistema → 403 (solo el del sistema)" 403 adm PATCH "/usuarios/$CON_ID" "{\"actualizado_en\":\"$M\",\"administrador_sistema\":true}"
caso "administrador del sistema: dar administrador_sistema a consulta → 200" 200 sis PATCH "/usuarios/$CON_ID" "{\"actualizado_en\":\"$M\",\"administrador_sistema\":true}"
caso "administrador del sistema: quitárselo → 200" 200 sis PATCH "/usuarios/$CON_ID" "{\"actualizado_en\":\"$(campo "v['actualizado_en']")\",\"administrador_sistema\":false}"
otros=$(sql -c "SELECT count(*) FROM usuario WHERE administrador_sistema AND activo AND id <> '$SIS_ID'")
if [ "$otros" = 0 ]; then
  M=$(sql -c "SELECT to_char(actualizado_en AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') FROM usuario WHERE id = '$SIS_ID'")
  caso "el último administrador del sistema no se quita el perfil → 409" 409 sis PATCH "/usuarios/$SIS_ID" "{\"actualizado_en\":\"$M\",\"administrador_sistema\":false}"
else echo "      (último administrador del sistema omitido: la base tiene $otros fuera de la prueba)"; fi
# Revisión del 11/11/2026: un administrador del sistema que además está en A no queda a merced del administrador de A (antes, con una
# clave temporal, este entraba como él). Se le da A por SQL, se prueba y se le quita.
sql -c "INSERT INTO usuario_sitio (usuario_id, sitio_id, rol) VALUES ('$SIS_ID', '$SITIO_A', 'consulta')" >/dev/null
antes=$(huella "$SIS_ID"); M=$(marca "$SIS_ID")
caso "administrador de A: clave temporal al administrador del sistema (que está en A) → 403" 403 adm PATCH "/usuarios/$SIS_ID" "{\"actualizado_en\":\"$M\",\"clave_temporal\":true}"
[ "$(campo "v['message']")" = "la cuenta es de un administrador del sistema: solo otro administrador del sistema la cambia" ] \
  && ok "el 403 lo explica: «la cuenta es de un administrador del sistema…»" || falla "mensaje del 403: $(head -c 160 "$T/r")"
caso "administrador de A: desactivar al administrador del sistema → 403" 403 adm PATCH "/usuarios/$SIS_ID" "{\"actualizado_en\":\"$M\",\"activo\":false,\"motivo\":\"prueba\"}"
caso "administrador de A: renombrarlo → 403" 403 adm PATCH "/usuarios/$SIS_ID" "{\"actualizado_en\":\"$M\",\"nombre\":\"otro\"}"
caso "administrador de A: quitarle el sitio A → 403" 403 adm PATCH "/usuarios/$SIS_ID" "{\"actualizado_en\":\"$M\",\"sitios\":[{\"sitio_id\":\"$SITIO_A\",\"rol\":null}]}"
[ "$(huella "$SIS_ID")" = "$antes" ] && ok "la cuenta del administrador del sistema no cambió (activa, misma clave)" || falla "la cuenta del administrador del sistema cambió pese al 403"
sql -c "UPDATE usuario_sitio SET activo = false WHERE usuario_id = '$SIS_ID' AND sitio_id = '$SITIO_A'" >/dev/null

# ── 3e. Lo propio de cada persona (docs/20 §6, última fila; docs/19 §4, H; docs/21 §8) y la actividad del sitio (P14) ─────────────
for par in "GET /preferencias" "PUT /preferencias" "GET /sesiones" "DELETE /sesiones/$(printf 'a%.0s' {1..64})" "GET /cuenta/exportar" "POST /cuenta/baja" "POST /soporte" "GET /soporte" "GET /sitios/$SITIO_A/actividad" "POST /terminos/aceptar"; do
  caso "sin sesión: ${par%% *} $(sed 's|/[0-9a-f-]\{36\}|/{id}|; s|/a\{64\}|/{id}|' <<<"${par#* }")" 401 anon ${par%% *} "${par#* }" '{}'
done
for r in /terminos /privacidad /acerca; do caso "sin sesión: GET $r (pública)" 200 anon GET "$r"; done
# «Acerca de» (revisión del 11/11/2026): sin sesión, la licencia y el código fuente, pero no la versión ni el commit; con sesión, la versión.
pedir anon GET /acerca >/dev/null
[ "$(campo "(v['version'], v['commit'], v['licencia'], len(v['aviso_licencia']) > 0)")" = "(None, None, 'AGPL-3.0-only', True)" ] && ok "GET /acerca sin sesión: licencia y aviso AGPL; sin versión ni commit" || falla "GET /acerca sin sesión: $(head -c 200 "$T/r")"
pedir con GET /acerca >/dev/null
[[ "$(campo "v['version']")" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]] && ok "GET /acerca con sesión: trae la versión" || falla "GET /acerca con sesión: $(head -c 200 "$T/r")"
for q in con inv ope adm sis; do caso "$q: GET /preferencias" 200 "$q" GET /preferencias; done
PREF="{\"actualizado_en\":null,\"unidad_temperatura\":\"F\",\"unidad_longitud\":\"km\",\"zona_horaria\":\"America/Punta_Arenas\",\"tema\":\"oscuro\",\"notificar\":[\"umbral\"],\"vistas\":[{\"nombre\":\"Alertas\",\"pantalla\":\"inventario\",\"parametros\":{\"estado\":\"alerta\"}}],\"sitio_predeterminado\":\"$SITIO_A\"}"
caso "consulta: PUT /preferencias (la primera vez, actualizado_en null) → 200" 200 con PUT /preferencias "$PREF"
MP=$(campo "v['actualizado_en']")
caso "consulta: PUT /preferencias otra vez con null → 409 (ya existían)" 409 con PUT /preferencias "$PREF"
caso "consulta: PUT /preferencias con la marca vigente → 200" 200 con PUT /preferencias "${PREF/\"actualizado_en\":null/\"actualizado_en\":\"$MP\"}"
caso "consulta: PUT /preferencias con la marca vieja → 409 (bloqueo optimista)" 409 con PUT /preferencias "${PREF/\"actualizado_en\":null/\"actualizado_en\":\"$MP\"}"
caso "consulta: PUT /preferencias con una zona inventada → 400" 400 con PUT /preferencias "${PREF/America\/Punta_Arenas/Marte\/Olympus}"
caso "consulta: PUT /preferencias con un sitio por defecto ajeno → 400" 400 con PUT /preferencias "${PREF/$SITIO_A/$SITIO_B}"
# Vistas guardadas como las arma el panel (corrección del 11/11/2026): `parametros` es un objeto con la ruta; el texto suelto de antes, 400.
pedir con GET /preferencias >/dev/null; MP=$(campo "v['actualizado_en']")
P2=${PREF/\"actualizado_en\":null/\"actualizado_en\":\"$MP\"}
VISTA_RUTA='{"ruta":"/inventario?estado=alerta"}'; VISTA_TEXTO='"/inventario?estado=alerta"'; VISTA_OTRO='{"ruta":"//otro.example/x"}'; VISTA_VIEJA='{"estado":"alerta"}'
caso "consulta: PUT /preferencias con una vista como la guarda el panel (parametros.ruta) → 200" 200 con PUT /preferencias "${P2/"$VISTA_VIEJA"/$VISTA_RUTA}"
[ "$(campo "v['vistas'][0]['parametros']")" = "{'ruta': '/inventario?estado=alerta'}" ] && ok "la vista vuelve con su ruta, tal cual" || falla "vista guardada: $(head -c 200 "$T/r")"
MP=$(campo "v['actualizado_en']"); P2=${PREF/\"actualizado_en\":null/\"actualizado_en\":\"$MP\"}
caso "consulta: PUT /preferencias con parametros como texto (la forma vieja del panel) → 400" 400 con PUT /preferencias "${P2/"$VISTA_VIEJA"/$VISTA_TEXTO}"
caso "consulta: PUT /preferencias con una ruta de otro origen → 400" 400 con PUT /preferencias "${P2/"$VISTA_VIEJA"/$VISTA_OTRO}"
caso "consulta: GET /sesion trae las preferencias guardadas" 200 con GET /sesion
[ "$(campo "(v['preferencias']['unidad_temperatura'], v['preferencias']['zona_horaria'])")" = "('F', 'America/Punta_Arenas')" ] && ok "GET /sesion: las preferencias de la persona (°F, su zona)" || falla "GET /sesion sin preferencias: $(head -c 200 "$T/r")"
c=$(entrar con2 "$CON_EMAIL" <<<"$CON_CLAVE"); [ "$c" = 200 ] || falla "consulta abre una segunda sesión → $c"
caso "consulta: GET /sesiones" 200 con GET /sesiones
[ "$(campo "(len(v) >= 2, sum(1 for s in v if s['actual']), all(s['origen'].endswith(('/24', '/48')) or s['origen'] == 'desconocido' for s in v), any('ip' in s for s in v))")" = "(True, 1, True, False)" ] \
  && ok "GET /sesiones: las dos sesiones, una «actual», origen truncado y sin la dirección completa" || falla "GET /sesiones: $(head -c 300 "$T/r")"
OTRA=$(sql -c "SELECT s.id FROM sesion s JOIN usuario u ON u.id = s.usuario_id WHERE u.email = '$ADM_EMAIL' AND s.revocada_en IS NULL LIMIT 1")
caso "consulta: DELETE /sesiones/{id} de otra persona → 404" 404 con DELETE "/sesiones/$OTRA"
SEG=$(sql -c "SELECT s.id FROM sesion s JOIN usuario u ON u.id = s.usuario_id WHERE u.email = '$CON_EMAIL' AND s.revocada_en IS NULL ORDER BY s.creada_en DESC LIMIT 1")
caso "consulta: DELETE /sesiones/{id} de su otra sesión → 200" 200 con DELETE "/sesiones/$SEG"
caso "la sesión cerrada desde «Mi cuenta» ya no vale" 401 con2 GET /sesion
caso "la sesión desde la que se cerró sigue viva" 200 con GET /sesion
cod=$(curl "${IFZ[@]}" -s -m 15 -o "$T/r" -D "$T/h" -w '%{http_code}' -b "$T/con.jar" "$API/cuenta/exportar")
[ "$cod" = 200 ] && grep -qi '^content-disposition: attachment' "$T/h" && [ "$(campo "(v['cuenta']['email'], v['preferencias']['unidad_temperatura'], len(v['sesiones']) >= 2)")" = "('$CON_EMAIL', 'F', True)" ] \
  && ok "consulta: GET /cuenta/exportar → 200, descarga (attachment) con su cuenta, preferencias y sesiones" || falla "exportar mis datos → $cod: $(head -c 200 "$T/r")"
[ "$(campo "('motivo_baja' in v['cuenta'], 'desactivado_en' in v['cuenta'], any(a.get('email_intentado') == '$CON_EMAIL' for a in v['accesos']), all('detalle' in e for e in v['cambios_hechos']), 'No se incluyen' in v['aviso'])")" = "(True, True, True, True, True)" ] \
  && ok "exportar: con el correo tecleado en sus accesos, la fecha y el motivo de baja, el detalle de sus cambios y lo que no incluye" || falla "exportar: faltan campos: $(head -c 300 "$T/r")"
# Soporte: cualquier persona envía (5 por hora); solo el administrador del sistema lee.
caso "consulta: POST /soporte → 201" 201 con POST /soporte '{"texto":"no veo el sitio B (prueba de soporte)"}'
caso "consulta: POST /soporte vacío → 400" 400 con POST /soporte '{"texto":"  "}'
for i in 2 3 4 5; do pedir con POST /soporte "{\"texto\":\"mensaje $i\"}" >/dev/null; done
caso "consulta: el sexto mensaje de la hora → 429" 429 con POST /soporte '{"texto":"uno más"}'
for q in con inv ope adm; do caso "$q: GET /soporte → 403 (solo el administrador del sistema)" 403 "$q" GET /soporte; done
caso "administrador del sistema: GET /soporte" 200 sis GET "/soporte?limite=500"
[ "$(campo "sum(1 for m in v if m['usuario']['id']=='$CON_ID')")" = 5 ] && ok "administrador del sistema: lee los 5 mensajes de la persona, con su nombre" || falla "GET /soporte: $(head -c 200 "$T/r")"
# Actividad del sitio (P14): administrador de sitio en sus sitios, el del sistema en todos; los demás, 403; otro sitio, 404.
for q in con inv ope; do caso "$q: GET /sitios/{id}/actividad → 403" 403 "$q" GET "/sitios/$SITIO_A/actividad"; done
caso "administrador, otro sitio: GET /sitios/{id}/actividad → 404" 404 adm GET "/sitios/$SITIO_B/actividad"
caso "administrador del sistema: GET /sitios/{id}/actividad del sitio B → 200" 200 sis GET "/sitios/$SITIO_B/actividad"
# Eventos sin dispositivo (corrección del 11/11/2026): una pasarela de A y otra de B con su evento (las pasarelas de la prueba se crean por
# SQL, sin evento; aquí se le pone uno a cada una, a nombre del administrador de A, como lo dejaría POST /pasarelas).
sql -c "INSERT INTO evento (tipo, detalle, usuario_id) VALUES ('pasarela_rotacion', jsonb_build_object('pasarela_id', '$PA'), '$ADM_UID'), ('pasarela_rotacion', jsonb_build_object('pasarela_id', '$PB'), '$ADM_UID')" >/dev/null
caso "administrador: GET /sitios/{id}/actividad" 200 adm GET "/sitios/$SITIO_A/actividad?limite=500"
[ "$(campo "(any(a['tipo']=='usuario_alta' and a['texto']=='dio de alta la cuenta de «Multi de prueba»' for a in v), any(a['tipo']=='terminos_aceptados' for a in v), sum(1 for a in v if a['tipo']=='pasarela_rotacion'), any('Solo B de prueba' in a['texto'] or 'pasarela B' in a['texto'] for a in v))")" = "(True, True, 1, False)" ] \
  && ok "actividad: también lo que no tiene dispositivo (altas de cuentas de A, términos aceptados, la pasarela de A), nada de B" || falla "actividad sin dispositivo: $(head -c 300 "$T/r")"
[ "$(campo "(any(a['tipo']=='reglas_cambiadas' and a['usuario'] and a['usuario']['id']=='$ADM_UID' and a['texto'].startswith('cambió los umbrales de') for a in v), any(a['clase']=='acceso' and a['tipo']=='ok' for a in v))")" = "(True, True)" ] \
  && ok "actividad: «cambió los umbrales de …» con la persona, y las entradas (acceso) de las personas del sitio" || falla "actividad: $(head -c 300 "$T/r")"
grep -qE '@|\b[0-9]{1,3}(\.[0-9]{1,3}){3}\b' "$T/r" && falla "actividad: la respuesta trae un correo o una dirección IP" || ok "actividad: sin correos ni direcciones IP en la respuesta"
grep -q "$DB" "$T/r" && falla "actividad del sitio A trae el dispositivo de B" || ok "actividad del sitio A: nada del sitio B"
sig=$(pedir_cabecera adm "/sitios/$SITIO_A/actividad?limite=2" X-Siguiente); P1=$(campo "[a['id'] for a in v]")
caso "actividad: página 2 con el cursor" 200 adm GET "/sitios/$SITIO_A/actividad?limite=2&cursor=$sig"
python3 -I -c "import sys,json,ast; a=ast.literal_eval(sys.argv[1]); b=[x['id'] for x in json.load(open(sys.argv[2]))]; sys.exit(0 if len(a)==2 and b and not set(a)&set(b) else 1)" "$P1" "$T/r" \
  && ok "actividad por cursor: la página 2 sigue a la 1 sin repetir" || falla "actividad por cursor: $P1 | $(head -c 200 "$T/r")"
# Reactivar (revisión del 11/11/2026): una baja hecha por el administrador del sistema solo la deshace el alcance global, y toda
# reactivación trae una clave temporal nueva (la de antes no vuelve).
M=$(marca "$INV_ID")
caso "administrador del sistema: desactiva al investigador de A (con motivo) → 200" 200 sis PATCH "/usuarios/$INV_ID" "{\"actualizado_en\":\"$M\",\"activo\":false,\"motivo\":\"prueba de reactivación\"}"
M=$(campo "v['actualizado_en']")
caso "administrador de A: reactivar sin clave temporal → 400 (la clave anterior no vuelve)" 400 adm PATCH "/usuarios/$INV_ID" "{\"actualizado_en\":\"$M\",\"activo\":true}"
caso "administrador de A: reactivar una baja hecha por el administrador del sistema → 403" 403 adm PATCH "/usuarios/$INV_ID" "{\"actualizado_en\":\"$M\",\"activo\":true,\"clave_temporal\":true}"
antes=$(huella "$INV_ID")
caso "administrador del sistema: la reactiva con clave temporal nueva → 200" 200 sis PATCH "/usuarios/$INV_ID" "{\"actualizado_en\":\"$M\",\"activo\":true,\"clave_temporal\":true}"
[ "$(campo "(v['activo'], len(v.get('clave', '')) > 0)")" = "(True, True)" ] && [ "$(huella "$INV_ID")" != "$antes" ] \
  && ok "reactivada con una clave temporal nueva (otro hash: la de antes no vuelve)" || falla "reactivación: $(head -c 200 "$T/r")"
c=$(entrar inv2 "inv$DOM" <<<"$INV_CLAVE"); [ "$c" = 401 ] && ok "la clave de antes de la baja ya no entra → 401" || falla "la clave de antes entra → $c"
# Baja por anonimización (docs/20 §11): una persona de consulta se da de baja con su clave; la fila queda sin nombre ni correo.
alta_persona baj "baja$DOM" consulta "Persona que se va"
BAJ_ID=$(sql -c "SELECT id FROM usuario WHERE email = 'baja$DOM'")
caso "baja: POST /cuenta/baja con una clave mala → 400" 400 baj POST /cuenta/baja '{"clave":"no-es-la-mia-123"}'
caso "baja: POST /cuenta/baja con su clave → 200" 200 baj POST /cuenta/baja "$(python3 -I -c "import sys,json; print(json.dumps({'clave': sys.argv[1]}))" "$NUEVA_ULTIMA")"
n=$(sql -c "SELECT (nombre NOT LIKE '%Persona que se va%' AND email NOT LIKE 'baja$DOM' AND NOT activo AND anonimizado_en IS NOT NULL AND hash_password NOT LIKE 'scrypt%')::text FROM usuario WHERE id = '$BAJ_ID'")
[ "$n" = true ] && ok "baja: ninguna columna de usuario guarda el nombre ni el correo de antes; sin clave; anonimizado_en" || falla "baja: la fila conserva datos: $n"
n=$(sql -c "SELECT (SELECT count(*) FROM sesion WHERE usuario_id = '$BAJ_ID' AND revocada_en IS NULL) || '/' || (SELECT count(*) FROM usuario_sitio WHERE usuario_id = '$BAJ_ID' AND activo) || '/' || (SELECT count(*) FROM acceso WHERE usuario_id = '$BAJ_ID') || '/' || (SELECT count(*) FROM evento WHERE usuario_id = '$BAJ_ID' AND tipo = 'usuario_baja')")
[[ "$n" =~ ^0/0/[1-9][0-9]*/1$ ]] && ok "baja: sesiones revocadas, sitios inactivos; acceso y evento siguen enlazados por el id ($n)" || falla "baja: sesiones/sitios/acceso/evento = $n"
n=$(sql -c "SELECT count(*) FROM acceso WHERE (usuario_id = '$BAJ_ID' OR email_intentado = 'baja$DOM') AND email_intentado IS NOT NULL")
[ "$n" = 0 ] && ok "baja: sus intentos de acceso ya no guardan el correo tecleado (corrección del 11/11/2026)" || falla "baja: $n filas de acceso conservan el correo"
caso "baja: la sesión ya no vale" 401 baj GET /sesion
c=$(entrar baj2 "baja$DOM" <<<"$NUEVA_ULTIMA"); [ "$c" = 401 ] && ok "baja: el correo de antes ya no entra → 401" || falla "baja: el correo de antes entra → $c"
M=$(sql -c "SELECT to_char(actualizado_en AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') FROM usuario WHERE id = '$BAJ_ID'")
caso "baja: una cuenta anonimizada no se reactiva → 409" 409 sis PATCH "/usuarios/$BAJ_ID" "{\"actualizado_en\":\"$M\",\"activo\":true,\"clave_temporal\":true}"
if [ "$otros" = 0 ]; then
  caso "el último administrador del sistema no se da de baja → 409" 409 sis POST /cuenta/baja "$(python3 -I -c "import sys,json; print(json.dumps({'clave': sys.argv[1]}))" "$SIS_CLAVE")"
fi
# El administrador del sistema de la prueba se desactiva aquí (con motivo, como exige ck_usuario_baja): la carrera del último administrador
# (sección 8) necesita que los únicos administradores sean los dos de sitio que se cruzan.
sql -c "UPDATE usuario SET activo = false, desactivado_en = now(), motivo_baja = 'fin de la prueba del sistema' WHERE id = '$SIS_ID'" >/dev/null

# ── 4. Canal en vivo con dos sitios (docs/20 §8): consulta recibe solo lo de su sitio; tope de 5 flujos por usuario ─────────────
caso "X-Clave-Admin: POST /dispositivos/{id}/credencial del sitio B (usuario del sistema, todos los sitios)" 201 clave POST "/dispositivos/$DB/credencial"
TOKEN_B=$(campo "v['conexion']['token']")
curl -s -N -m 6 -b "$T/con.jar" "$API/eventos" > "$T/sse.txt" & sse=$!
sleep 1
enviar() { printf 'Authorization: Bearer %s\n' "$2" | curl -s -m 10 -o /dev/null -w '%{http_code}' -H @- -H 'Content-Type: application/senml+json' \
  --data-binary "[{\"bn\":\"$1\",\"n\":\"temperatura\",\"u\":\"Cel\",\"v\":21.5}]" "$API/recepcion/$1"; }
ca=$(enviar "ta-$N" "$TOKEN_A"); cb=$(enviar "tb-$N" "$TOKEN_B")
wait "$sse" 2>/dev/null
if [ "$ca" = 202 ] && [ "$cb" = 202 ] && grep -q "\"dispositivo_id\":\"$DA\"" "$T/sse.txt" && ! grep -q "$DB" "$T/sse.txt"; then
  ok "canal en vivo de consulta: llega la medición de su sitio y no la del otro (recepción $ca y $cb)"
else falla "canal en vivo: recepción $ca/$cb; su sitio $(grep -c "$DA" "$T/sse.txt") veces, otro sitio $(grep -c "$DB" "$T/sse.txt") veces"; fi
pids=(); for _ in 1 2 3 4 5; do curl -s -N -m 8 -o /dev/null -b "$T/con.jar" "$API/eventos" & pids+=($!); done
sleep 2
caso "consulta: el sexto flujo del mismo usuario → 429 (tope de 5 por usuario)" 429 con GET /eventos
code=$(curl -s -N -m 2 -o /dev/null -w '%{http_code}' -b "$T/adm.jar" "$API/eventos"); [ "$code" = 200 ] && ok "otro usuario sí abre su flujo → 200" || falla "otro usuario no abre su flujo → $code"
kill "${pids[@]}" 2>/dev/null; wait 2>/dev/null

# ── 5. Desactivar corta las sesiones; inexistente, inactivo y clave mala responden igual y tardan lo mismo ─────────────────────
# El inactivo es un tercer usuario: sus intentos no deben sumar al bloqueo del de consulta, que se prueba después.
INA_EMAIL="inactivo$DOM"
caso "administrador: POST /usuarios (un tercer usuario, de consulta)" 201 adm POST /usuarios \
     "{\"nombre\":\"Inactivo de prueba\",\"email\":\"$INA_EMAIL\",\"sitios\":[{\"sitio_id\":\"$SITIO_A\",\"rol\":\"consulta\"}]}"
INA_TEMP=$(campo "v['clave']"); INA_ID=$(campo "v['id']"); MARCA_U=$(campo "v['actualizado_en']")
c=$(entrar ina "$INA_EMAIL" <<<"$INA_TEMP"); [ "$c" = 200 ] || falla "el tercer usuario entra con su temporal → $c"
caso "administrador: PATCH /usuarios/{id} activo=false sin motivo → 400 (la baja exige motivo)" 400 adm PATCH "/usuarios/$INA_ID" "{\"actualizado_en\":\"$MARCA_U\",\"activo\":false}"
caso "administrador: PATCH /usuarios/{id} activo=false con motivo" 200 adm PATCH "/usuarios/$INA_ID" "{\"actualizado_en\":\"$MARCA_U\",\"activo\":false,\"motivo\":\"dejó el proyecto (prueba)\"}"
n=$(sql -c "SELECT (motivo_baja = 'dejó el proyecto (prueba)' AND desactivado_en IS NOT NULL AND desactivado_por = (SELECT id FROM usuario WHERE email = '$ADM_EMAIL'))::text FROM usuario WHERE id = '$INA_ID'")
[ "$n" = true ] && ok "la baja guarda motivo, cuándo y quién (ck_usuario_baja)" || falla "baja sin motivo, fecha o quién: $n"
n=$(sql -c "SELECT count(*) FROM evento WHERE tipo = 'usuario_cambio' AND usuario_id = (SELECT id FROM usuario WHERE email = '$ADM_EMAIL') AND detalle->>'usuario_id' = '$INA_ID' AND detalle->>'motivo' = 'dejó el proyecto (prueba)'")
[ "$n" = 1 ] && ok "la baja deja el evento usuario_cambio con quién (usuario_id) y el motivo" || falla "evento de la baja: $n"
caso "POST /usuarios con el correo de una cuenta inactiva → 409 (no un duplicado)" 409 adm POST /usuarios "{\"nombre\":\"Otra vez\",\"email\":\"$INA_EMAIL\",\"sitios\":[{\"sitio_id\":\"$SITIO_A\",\"rol\":\"consulta\"}]}"
[ "$(campo "(v['reactivable'], v['usuario']['id'], v['usuario']['motivo_baja'])")" = "(True, '$INA_ID', 'dejó el proyecto (prueba)')" ] \
  && ok "el 409 trae la ficha con reactivable: true (la reactivación es PATCH con activo: true y clave_temporal: true)" || falla "409 sin la ficha reactivable: $(head -c 200 "$T/r")"
caso "la sesión del usuario desactivado ya no vale" 401 ina GET /sesion
c=$(entrar ina2 "$INA_EMAIL" <<<"$INA_TEMP"); m_inactivo=$(campo "v['message']")
inicio=$(sql -c "SELECT now()")
for i in 1 2 3 4 5; do
  t=$(curl -s -m 15 -o "$T/r" -w '%{http_code} %{time_total}' -X POST -H 'X-Pedido: panel' -H 'Content-Type: application/json' --data-binary @- "$API/sesion" <<<"$(cuerpo_entrar "$CON_EMAIL" <<<"mala-$i-$(nueva_clave)")")
  echo "$t" >> "$T/malas.txt"; m_mala=$(campo "v['message']")
  t=$(curl -s -m 15 -o "$T/r" -w '%{http_code} %{time_total}' -X POST -H 'X-Pedido: panel' -H 'Content-Type: application/json' --data-binary @- "$API/sesion" <<<"$(cuerpo_entrar "inexistente$DOM" <<<"$(nueva_clave)")")
  echo "$t" >> "$T/inexistentes.txt"; m_nadie=$(campo "v['message']")
done
if [ "$c" = 401 ] && [ "$m_inactivo" = "$m_mala" ] && [ "$m_mala" = "$m_nadie" ] && ! grep -qv '^401 ' "$T/malas.txt" "$T/inexistentes.txt"; then
  ok "inactivo, clave mala e inexistente: 401 con el mismo mensaje («$m_mala»)"
else falla "respuestas distintas: inactivo $c «$m_inactivo», clave mala «$m_mala», inexistente «$m_nadie»"; fi
python3 -I - "$T/malas.txt" "$T/inexistentes.txt" <<'PY' && ok_n=$((ok_n+1)) || fallos=$((fallos+1))
import statistics, sys
a = [float(l.split()[1]) * 1000 for l in open(sys.argv[1])]; b = [float(l.split()[1]) * 1000 for l in open(sys.argv[2])]
ma, mb = statistics.median(a), statistics.median(b); dif = abs(ma - mb); tol = max(3 * max(statistics.stdev(a), statistics.stdev(b)), 0.15 * min(ma, mb))
linea = f'tiempo de respuesta: clave mala {ma:.0f} ms, usuario inexistente {mb:.0f} ms (mediana de 5); diferencia {dif:.0f} ms, tolerancia {tol:.0f} ms (3 desviaciones o 15 %)'
print(('OK    ' if dif < tol else 'FALLA ') + linea)
sys.exit(0 if dif < tol else 1)
PY

# ── 6. Bloqueo: la sexta, aunque sea la correcta, responde «bloqueado»; acceso tiene las 6 filas ────────────────────────────────
c=$(entrar con3 "$CON_EMAIL" <<<"$CON_CLAVE"); m=$(campo "v['message']")
[ "$c" = 429 ] && [[ "$m" == bloqueado* ]] && ok "6.º intento con la clave CORRECTA tras 5 malas → 429 «${m:0:40}…»" || falla "sexto intento → $c «$m»"
# Dos intentos más, también bloqueados: no suman filas (una «bloqueado» por email, dirección y ventana de 15 min; revisión del 08/11/2026).
c7=$(entrar con3 "$CON_EMAIL" <<<"$CON_CLAVE"); c8=$(entrar con3 "$CON_EMAIL" <<<"$CON_CLAVE")
[ "$c7$c8" = 429429 ] && ok "7.º y 8.º intento → 429 también" || falla "7.º y 8.º intento → $c7 y $c8"
n=$(sql -c "SELECT string_agg(resultado, ',' ORDER BY instante) FROM acceso WHERE email_intentado = '$CON_EMAIL' AND instante >= '$inicio'")
[ "$n" = "clave_incorrecta,clave_incorrecta,clave_incorrecta,clave_incorrecta,clave_incorrecta,bloqueado" ] \
  && ok "acceso tiene 6 filas del usuario tras 8 intentos: 5 clave_incorrecta y 1 solo bloqueado" || falla "acceso del usuario: $n"
n=$(sql -c "SELECT count(*) FROM acceso WHERE email_intentado = '$INA_EMAIL' AND resultado = 'inactivo'")
[ "$n" = 1 ] && ok "acceso registra el intento del usuario inactivo como «inactivo»" || falla "intentos inactivos registrados: $n"
M=$(marca "$INA_ID")
caso "reactivar sin clave temporal → 400 (la clave anterior no vuelve)" 400 adm PATCH "/usuarios/$INA_ID" "{\"actualizado_en\":\"$M\",\"activo\":true}"
caso "reactivar (PATCH activo: true y clave_temporal: true) la cuenta que dio de baja el mismo administrador de sitio → 200" 200 adm PATCH "/usuarios/$INA_ID" "{\"actualizado_en\":\"$M\",\"activo\":true,\"clave_temporal\":true}"
[ "$(campo "(v['activo'], v['motivo_baja'], v['desactivado_en'], len(v.get('clave', '')) > 0)")" = "(True, None, None, True)" ] && ok "reactivar limpia fecha y motivo (el motivo queda en el evento) y entrega una clave temporal nueva" || falla "reactivar: $(head -c 200 "$T/r")"

# ── 6b. Memoria del backend durante dos POST /sesion simultáneos (revisión del 08/11/2026; docs/16 §58 y §59) ───────────────────────
# Cada scrypt de personas pide 128 MiB y el backend admite dos a la vez (sesion/turnos.ts): se mide el pico real contra el techo de 512 MB
# del compose. Tres rondas de dos inicios a la vez; mientras, se muestrea la memoria del contenedor de dos formas: `docker stats --no-stream`
# (lo que pide el método; una muestra por segundo, aprox.) y, si el host deja leerlo, el `memory.current` del cgroup cada 20 ms (no se pierde
# el pico entre dos muestras de docker stats). Es una medición y un tope: falla si el pico alcanza el techo. Además se suma la memoria de
# TODOS los contenedores de la pila en cada muestra de docker stats (la pila entera en ese instante, para RNF-17; docs/16 §59).
# Cada muestreador corre bajo `timeout 90s` y su PID queda en MUESTREO (lo mata `limpiar`): si el guion se corta, nada queda girando.
CONT=$(docker compose -f "$PLAT/docker-compose.yml" ps -q backend 2>/dev/null)
PILA=$(docker compose -f "$PLAT/docker-compose.yml" ps -q 2>/dev/null | tr '\n' ' ')
CG="/sys/fs/cgroup/system.slice/docker-$CONT.scope"
: > "$T/mem-stats.txt"; : > "$T/mem-cg.txt"; : > "$T/mem-pila.txt"
timeout 90s bash -c 'while :; do docker stats --no-stream --format "{{.MemUsage}}" "$1" 2>/dev/null | cut -d/ -f1 >> "$2"; done' _ "$CONT" "$T/mem-stats.txt" & m1=$!
# shellcheck disable=SC2086 # PILA: los ids de los contenedores, uno por palabra
timeout 90s bash -c 'f=$1; shift; while :; do l=$(docker stats --no-stream --format "{{.MemUsage}}" "$@" 2>/dev/null | cut -d/ -f1 | tr "\n" ";"); echo "$#:$l" >> "$f"; done' _ "$T/mem-pila.txt" $PILA & m3=$!
MUESTREO=("$m1" "$m3")
if [ -r "$CG/memory.current" ]; then timeout 90s bash -c 'while :; do cat "$1" >> "$2"; sleep 0.02; done' _ "$CG/memory.current" "$T/mem-cg.txt" & m2=$!; MUESTREO+=("$m2"); else m2=; fi
sleep 2.5 # con dos muestreadores de docker stats a la vez, la primera muestra tarda más de 1 s (la línea «antes» salía «?»)
base_stats=$(head -1 "$T/mem-stats.txt")
for ronda in 1 2 3; do
  entrar mem1 "$ADM_EMAIL" <<<"$ADM_CLAVE" > "$T/mem1.cod" & q1=$!
  entrar mem2 "$ADM_EMAIL" <<<"$ADM_CLAVE" > "$T/mem2.cod" & q2=$!
  wait "$q1" "$q2"
  [ "$(cat "$T/mem1.cod")$(cat "$T/mem2.cod")" = 200200 ] || falla "ronda $ronda de dos inicios simultáneos: $(cat "$T/mem1.cod") y $(cat "$T/mem2.cod")"
done
sleep 1.2
kill "${MUESTREO[@]}" 2>/dev/null; wait "${MUESTREO[@]}" 2>/dev/null; MUESTREO=()
python3 -I - "$T/mem-stats.txt" "$T/mem-cg.txt" "${base_stats:-?}" "$T/mem-pila.txt" <<'PY' && ok_n=$((ok_n+1)) || fallos=$((fallos+1))
import re, sys
def mib(s):
    m = re.match(r'\s*([\d.]+)\s*([KMG]i?B|B)', s)
    if not m: return None
    f = {'B': 1 / 2**20, 'KiB': 1 / 1024, 'KB': 1 / 1024, 'MiB': 1, 'MB': 1, 'GiB': 1024, 'GB': 1024}[m.group(2)]
    return float(m.group(1)) * f
stats = [x for x in (mib(l) for l in open(sys.argv[1])) if x is not None]
cg = [int(l) / 2**20 for l in open(sys.argv[2]) if l.strip().isdigit()]
if not stats: print('FALLA docker stats no dio ninguna muestra de la memoria del backend'); sys.exit(1)
pico = max(stats + cg)
linea = (f'memoria del backend con dos POST /sesion simultáneos (3 rondas): docker stats --no-stream, antes {sys.argv[3].strip()}, '
         f'máximo {max(stats):.0f} MiB en {len(stats)} muestras' + (f'; memory.current del cgroup cada 20 ms, máximo {max(cg):.0f} MiB en {len(cg)} muestras' if cg else '; sin acceso al cgroup')
         + '; techo 512 MiB')
# La pila entera: por muestra completa (los N contenedores respondieron), la suma; se informa la máxima.
sumas = []
for l in open(sys.argv[4]):
    n, _, resto = l.strip().partition(':')
    vals = [mib(x) for x in resto.split(';') if x.strip()]
    if n.isdigit() and len(vals) == int(n) and None not in vals: sumas.append(sum(vals))
linea += (f'; pila entera ({n} contenedores, suma por muestra de docker stats) máximo {max(sumas):.0f} MiB en {len(sumas)} muestras' if sumas else '; pila entera: sin muestras completas')
print(('OK    ' if pico < 512 else 'FALLA ') + linea)
sys.exit(0 if pico < 512 else 1)
PY

# ── 7. Carrera: dos inicios simultáneos crean dos sesiones válidas e independientes; cerrar sesión revoca de verdad ──────────────
entrar c1 "$ADM_EMAIL" <<<"$ADM_CLAVE" > "$T/c1" & p1=$!
entrar c2 "$ADM_EMAIL" <<<"$ADM_CLAVE" > "$T/c2" & p2=$!
wait "$p1" "$p2"
k1=$(grep -o '__Host-sesion\s[^[:space:]]*$' "$T/c1.jar" 2>/dev/null); k2=$(grep -o '__Host-sesion\s[^[:space:]]*$' "$T/c2.jar" 2>/dev/null)
c1=$(pedir c1 GET /sesion); c2=$(pedir c2 GET /sesion)
[ "$(cat "$T/c1")$(cat "$T/c2")" = 200200 ] && [ "$c1$c2" = 200200 ] && [ -n "$k1" ] && [ "$k1" != "$k2" ] \
  && ok "dos inicios simultáneos: dos sesiones válidas con identificadores distintos" || falla "carrera: inicios $(cat "$T/c1")/$(cat "$T/c2"), GET /sesion $c1/$c2"
cp "$T/c1.jar" "$T/vieja.jar"   # el identificador de c1, guardado antes de cerrar (al cerrar, curl lo borra del tarro de c1)
# El canal en vivo revalida la sesión en cada latido (25 s; revisión del 08/11/2026): el flujo de la sesión que se cierra debe terminar
# solo, sin latido, a lo más un latido después; el de una sesión viva (consulta) recibe su latido y sigue hasta que curl lo corta.
( curl -s -N -m 40 -o "$T/sse-cerrada.txt" -b "$T/vieja.jar" "$API/eventos"; echo "$? $(date +%s%N)" > "$T/sse-cerrada.fin" ) & sse_c=$!
( curl -s -N -m 32 -o "$T/sse-viva.txt" -b "$T/con.jar" "$API/eventos"; echo "$?" > "$T/sse-viva.fin" ) & sse_v=$!
sleep 1
t_cierre=$(date +%s%N)
caso "DELETE /sesion (cerrar) → 200" 200 c1 DELETE /sesion
caso "el identificador cerrado responde 401 en la siguiente petición" 401 vieja GET /sesion
caso "la otra sesión sigue viva" 200 c2 GET /sesion
n=$(sql -c "SELECT count(*) FROM sesion s JOIN usuario u ON u.id = s.usuario_id WHERE u.email = '$ADM_EMAIL' AND s.revocada_en IS NOT NULL")
[ "${n:-0}" -ge 1 ] && ok "la sesión cerrada queda revocada en la base ($n revocada/s del administrador de prueba)" || falla "ninguna sesión revocada en la base"
n=$(sql -c "SELECT count(*) FROM acceso WHERE email_intentado = '$ADM_EMAIL' AND resultado = 'cierre'")
[ "$n" = 1 ] && ok "acceso registra el cierre" || falla "cierres registrados: $n"
caso "cerrar en todos lados (DELETE /sesion?todas=true) → 200" 200 c2 DELETE "/sesion?todas=true"
caso "después de cerrar en todos lados, la sesión del administrador ya no vale" 401 adm GET /sesion

# ── 8. Carrera del último administrador (revisión del 08/11/2026): dos administradores se desactivan el uno al otro a la vez ─────────
# Sin el candado de los administradores (usuarios.service.ts), cada uno veía al otro todavía activo y la plataforma quedaba sin
# ninguno. Solo tiene sentido si los de la prueba son los únicos administradores de la base (con otro, nunca queda sin ninguno).
fuera=$(sql -c "SELECT (SELECT count(*) FROM usuario_sitio us JOIN usuario u ON u.id = us.usuario_id WHERE us.rol = 'administrador' AND us.activo AND u.activo AND u.email NOT LIKE '%$DOM') + (SELECT count(*) FROM usuario WHERE administrador_sistema AND activo)")
if [ "$fuera" != 0 ]; then
  echo "      (carrera del último administrador omitida: la base tiene $fuera administrador/es fuera de la prueba; la cubre la prueba unitaria del orden)"
else
  c=$(entrar adm "$ADM_EMAIL" <<<"$ADM_CLAVE"); [ "$c" = 200 ] || falla "el administrador vuelve a entrar → $c"
  ADM2_EMAIL="admin2$DOM"; ADM2_CLAVE=$(nueva_clave)
  caso "POST /usuarios (un segundo administrador de A)" 201 adm POST /usuarios \
       "{\"nombre\":\"Segunda administración\",\"email\":\"$ADM2_EMAIL\",\"sitios\":[{\"sitio_id\":\"$SITIO_A\",\"rol\":\"administrador\"}]}"
  ADM2_TEMP=$(campo "v['clave']"); ADM2_ID=$(campo "v['id']")
  c=$(entrar adm2 "$ADM2_EMAIL" <<<"$ADM2_TEMP"); c2=$(cambiar_clave adm2 "$ADM2_TEMP" "$ADM2_CLAVE")
  [ "$c$c2" = 200200 ] || falla "el segundo administrador entra y cambia su temporal → $c y $c2"
  aceptar adm2
  M1=$(marca "$ADM_ID"); M2=$(marca "$ADM2_ID")
  cruzar() { curl -s -m 15 -o "$T/cruce-$1.txt" -w '%{http_code}' -X PATCH -H 'X-Pedido: panel' -H 'Content-Type: application/json' -b "$T/$1.jar" --data-binary "$3" "$API/usuarios/$2"; }
  cruzar adm "$ADM2_ID" "{\"actualizado_en\":\"$M2\",\"activo\":false,\"motivo\":\"carrera\"}" > "$T/cruce-adm.cod" & q1=$!
  cruzar adm2 "$ADM_ID" "{\"actualizado_en\":\"$M1\",\"activo\":false,\"motivo\":\"carrera\"}" > "$T/cruce-adm2.cod" & q2=$!
  wait "$q1" "$q2"
  codigos=$(printf '%s\n%s\n' "$(cat "$T/cruce-adm.cod")" "$(cat "$T/cruce-adm2.cod")" | sort | tr '\n' ' ')
  activos=$(sql -c "SELECT count(*) FROM usuario_sitio us JOIN usuario u ON u.id = us.usuario_id WHERE us.rol = 'administrador' AND us.activo AND u.activo")
  if [ "$activos" -ge 1 ] && [ "$codigos" = "200 409 " ]; then
    ok "dos desactivaciones cruzadas a la vez: una 200 y la otra 409; queda $activos administrador activo"
  elif [ "$activos" -ge 1 ] && [ "$codigos" = "200 401 " ]; then
    ok "dos desactivaciones cruzadas: una 200 y la otra 401 (llegó con su sesión ya revocada); queda $activos administrador activo"
  else falla "dos desactivaciones cruzadas → códigos $codigos; administradores activos: $activos (la plataforma no puede quedar sin ninguno)"; fi
fi

# ── 7b. El flujo de la sesión cerrada terminó solo (abierto antes del cierre, en la sección 7) ───────────────────────────────────
wait "$sse_c" "$sse_v" 2>/dev/null
read -r fin_c t_fin < "$T/sse-cerrada.fin"
dur=$(( (t_fin - t_cierre) / 1000000 ))
if [ "$fin_c" = 0 ] && [ "$dur" -le 30000 ] && ! grep -q '^event: latido' "$T/sse-cerrada.txt"; then
  ok "el flujo en vivo de la sesión cerrada termina solo $(( dur / 1000 )),$(( dur % 1000 / 100 )) s después del cierre (≤ 30), sin latido"
else falla "flujo de la sesión cerrada: curl salió con $fin_c a los $dur ms del cierre; latidos recibidos: $(grep -c '^event: latido' "$T/sse-cerrada.txt")"; fi
fin_v=$(cat "$T/sse-viva.fin")
[ "$fin_v" = 28 ] && grep -q '^event: latido' "$T/sse-viva.txt" && ok "el flujo de una sesión viva recibe su latido y sigue abierto (lo corta curl a los 32 s)" \
  || falla "flujo de la sesión viva: curl salió con $fin_v; latidos: $(grep -c '^event: latido' "$T/sse-viva.txt")"

echo
if [ "$fallos" -eq 0 ]; then echo "TODO OK ($ok_n de $ok_n comprobaciones de sesión y permisos)"; else echo "$fallos de $((ok_n + fallos)) comprobaciones con falla"; exit 1; fi
