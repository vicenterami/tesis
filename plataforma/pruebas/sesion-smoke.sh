#!/usr/bin/env bash
# Paso 4b del guardián: la matriz de acceso de docs/20 §6 contra el backend corriendo, con una sesión por rol (docs/20 §8).
#   bash plataforma/pruebas/sesion-smoke.sh
# Requiere la pila arriba (backend en 127.0.0.1:3000 con la migración 22) y HTTP_CLAVE_ADMIN en plataforma/.env: con ella se crea el
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
CREATE TEMP TABLE u_prueba AS SELECT id FROM usuario WHERE email LIKE '%$dom';
DELETE FROM medicion WHERE canal_id IN (SELECT id FROM canal WHERE dispositivo_id IN (SELECT id FROM d_prueba));
DELETE FROM condicion WHERE dispositivo_id IN (SELECT id FROM d_prueba);
DELETE FROM regla_umbral WHERE canal_id IN (SELECT id FROM canal WHERE dispositivo_id IN (SELECT id FROM d_prueba));
DELETE FROM trama WHERE dispositivo_id IN (SELECT id FROM d_prueba);
DELETE FROM cuarentena WHERE dispositivo_id IN (SELECT id FROM d_prueba);
DELETE FROM credencial WHERE dispositivo_id IN (SELECT id FROM d_prueba);
DELETE FROM evento WHERE dispositivo_id IN (SELECT id FROM d_prueba) OR (tipo LIKE 'usuario_%' AND detalle->>'usuario_id' IN (SELECT id::text FROM u_prueba));
DELETE FROM estado_dispositivo WHERE dispositivo_id IN (SELECT id FROM d_prueba);
DELETE FROM canal WHERE dispositivo_id IN (SELECT id FROM d_prueba);
DELETE FROM dispositivo WHERE id IN (SELECT id FROM d_prueba);
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
limpiar() {
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
CON_CLAVE=$(nueva_clave)
c=$(entrar con "$CON_EMAIL" <<<"$CON_TEMP"); [ "$c" = 200 ] || falla "consulta entra con la temporal → $c"
c=$(cambiar_clave con "$CON_TEMP" "$CON_CLAVE"); [ "$c" = 200 ] && ok "consulta cambia su clave temporal → 200" || falla "consulta cambia la clave → $c $(head -c 160 "$T/r")"

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
caso "administrador de A: desactivar a quien también está en B → 403" 403 adm PATCH "/usuarios/$MULTI_ID" "{\"actualizado_en\":\"$M\",\"activo\":false}"
[ "$(campo "v['message']")" = "la cuenta pertenece también a otros sitios: pídelo a un administrador del sistema" ] \
  && ok "el 403 lo explica: «la cuenta pertenece también a otros sitios…»" || falla "mensaje del 403: $(head -c 160 "$T/r")"
caso "administrador de A: clave temporal a quien también está en B → 403 (no puede entrar como ella)" 403 adm PATCH "/usuarios/$MULTI_ID" "{\"actualizado_en\":\"$M\",\"clave_temporal\":true}"
caso "administrador de A: su rol en A sí lo cambia → 200" 200 adm PATCH "/usuarios/$MULTI_ID" "{\"actualizado_en\":\"$M\",\"sitios\":[{\"sitio_id\":\"$SITIO_A\",\"rol\":\"consulta\"}]}"
[ "$(huella "$MULTI_ID")" = "$antes" ] && ok "la cuenta de quien también está en B no cambió (activa, misma clave y mismo vencimiento)" || falla "la cuenta de multi cambió pese al 403"
M=$(marca "$CON_ID")
caso "administrador de A: un campo de la cuenta de quien SOLO está en A → 200" 200 adm PATCH "/usuarios/$CON_ID" "{\"actualizado_en\":\"$M\",\"activo\":true}"

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
caso "administrador: PATCH /usuarios/{id} activo=false" 200 adm PATCH "/usuarios/$INA_ID" "{\"actualizado_en\":\"$MARCA_U\",\"activo\":false}"
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
fuera=$(sql -c "SELECT count(*) FROM usuario_sitio us JOIN usuario u ON u.id = us.usuario_id WHERE us.rol = 'administrador' AND us.activo AND u.activo AND u.email NOT LIKE '%$DOM'")
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
  M1=$(marca "$ADM_ID"); M2=$(marca "$ADM2_ID")
  cruzar() { curl -s -m 15 -o "$T/cruce-$1.txt" -w '%{http_code}' -X PATCH -H 'X-Pedido: panel' -H 'Content-Type: application/json' -b "$T/$1.jar" --data-binary "$3" "$API/usuarios/$2"; }
  cruzar adm "$ADM2_ID" "{\"actualizado_en\":\"$M2\",\"activo\":false}" > "$T/cruce-adm.cod" & q1=$!
  cruzar adm2 "$ADM_ID" "{\"actualizado_en\":\"$M1\",\"activo\":false}" > "$T/cruce-adm2.cod" & q2=$!
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
