#!/usr/bin/env bash
# Prueba de regresión: nadie toma la sesión persistente de otro usuario del broker (docs/11 §7; docs/10 §8.4 punto 70; docs/16 §102).
# Levanta un broker DESECHABLE con la imagen fijada en docker-compose.yml y la configuración del SERVIDOR copiada tal cual
# (mosquitto/config/mosquitto.conf; solo cambian las rutas de datos, a /c), le aplica los roles reales (roles_del_sistema de
# lib-dynsec.sh) y ataca con la credencial de un dispositivo la sesión de un cliente con el rol del backend (broker-sesion.mjs):
#   A. con la víctima caída, el atacante entra con SU identificador y sesión persistente: ¿hereda la suscripción y la cola?
#   B. con la víctima conectada, entra con su identificador y sesión limpia: ¿la expulsa?, ¿le borra la cola y la suscripción?
#   C. pelea por el identificador, los dos reconectando, con el atacante en sesión persistente y después limpia: ¿cuánto pierde la víctima?
# Exige: la víctima conserva su sesión y recibe toda su cola y lo publicado en vivo; el atacante no recibe nada; el registro del
# broker anota al atacante con SU usuario y nunca una sesión de la víctima tomada. Además, que verificar_clave (lib-dynsec.sh)
# acepta la clave correcta y rechaza otra y la de un cliente deshabilitado, sin conectarse, y que rotar_admin deja a los DOS
# administradores con la clave nueva y a ninguno con la anterior.
# Identidades de descarte (dev-prueba-*), claves aleatorias generadas y usadas en esta misma invocación, nunca impresas; el
# contenedor (tmp-sesion-prueba-<pid>) y su carpeta se borran al salir. Desde cualquier carpeta:
#   bash plataforma/pruebas/broker-sesion.sh
# Plantar la falla (la prueba debe fallar): BROKER_SESION_CONF=<copia de mosquitto.conf sin use_username_as_clientid>.
# Sale 0 si todo pasa, 1 si algo falla y 3 si falta docker, node, el paquete mqtt del backend, la imagen fijada del broker en el equipo
# (no la descarga: sin red sería una falla falsa) u openssl, python3 o timeout (el verificador lo cuenta como omitido).
set -u
AQUI=$(cd "$(dirname "$0")" && pwd) || exit 1
PLAT="$AQUI/.."
CONF="${BROKER_SESION_CONF:-$PLAT/mosquitto/config/mosquitto.conf}"
command -v docker >/dev/null && docker info >/dev/null 2>&1 || { echo "omitida: docker no responde"; exit 3; }
command -v node >/dev/null && [ -f "$PLAT/backend/node_modules/mqtt/package.json" ] || { echo "omitida: falta node o el paquete mqtt del backend (pnpm install en plataforma/backend)"; exit 3; }
IMG=$(grep -oE 'eclipse-mosquitto:[^ ]+@sha256:[0-9a-f]{64}' "$PLAT/docker-compose.yml" | head -1)
[ -n "$IMG" ] || { echo "FALLA no encontré la imagen fijada del broker en docker-compose.yml"; exit 1; }
docker image inspect "$IMG" >/dev/null 2>&1 || { echo "omitida: la imagen fijada del broker no está en este equipo (docker pull de la del docker-compose.yml)"; exit 3; }
for h in openssl python3 timeout; do command -v "$h" >/dev/null || { echo "omitida: falta $h"; exit 3; }; done
[ -f "$CONF" ] || { echo "FALLA no existe $CONF"; exit 1; }
. "$AQUI/lib-dynsec.sh"

NOMBRE="tmp-sesion-prueba-$$"
T=$(mktemp -d "${TMPDIR:-/tmp}/broker-sesion.XXXXXX") || { echo "FALLA no se pudo crear la carpeta de trabajo"; exit 1; }
trap 'docker rm -f "$NOMBRE" >/dev/null 2>&1; rm -rf "$T"' EXIT
mkdir -p "$T/data"
# La configuración del servidor con las rutas de datos en /c (la imagen haría chown -R de /mosquitto: docs/11 §7).
sed -e 's#/mosquitto/data/#/c/data/#g' "$CONF" > "$T/mosquitto.conf"
grep -q '/mosquitto/' "$T/mosquitto.conf" && { echo "FALLA quedó una ruta /mosquitto en la copia de la configuración"; exit 1; }
echo "── configuración probada: $CONF ($(grep -cE '^\s*use_username_as_clientid\s+true' "$T/mosquitto.conf") línea(s) use_username_as_clientid true)"

K_ADMIN=$(openssl rand -hex 16); K_VICTIMA=$(openssl rand -hex 16); K_EMISOR=$(openssl rand -hex 16); K_ATACANTE=$(openssl rand -hex 16)
K_PASARELA=$(openssl rand -hex 16); K_ORDENADOR=$(openssl rand -hex 16)
# Archivo del plugin creado sin broker, con el administrador de descarte; la clave entra por la entrada estándar.
printf '%s\n' "$K_ADMIN" | docker run --rm -i --user "$(id -u):$(id -g)" --network none -v "$T:/c" --entrypoint sh "$IMG" \
  -c 'IFS= read -r A; mosquitto_ctrl dynsec init /c/data/dynamic-security.json dev-prueba-admin "$A" >/dev/null 2>&1; test -s /c/data/dynamic-security.json' \
  || { echo "FALLA no se pudo crear el archivo del plugin"; exit 1; }
docker run -d --name "$NOMBRE" --user "$(id -u):$(id -g)" -p 127.0.0.1::1883 -v "$T:/c" --entrypoint mosquitto "$IMG" -c /c/mosquitto.conf >/dev/null \
  || { echo "FALLA no arrancó el broker desechable"; exit 1; }
PUERTO=$(docker port "$NOMBRE" 1883/tcp | head -1 | sed 's/.*://')

# Las funciones de lib-dynsec.sh, apuntadas a este contenedor y a su administrador de descarte.
dyn_desechable() { shift 3; docker exec -i "$NOMBRE" "$@"; }   # «exec -T mosquitto <orden…>» → docker exec en el desechable
DYN_DC=dyn_desechable; DYN_ADMIN="$K_ADMIN"; DYN_USUARIOS_ADMIN=dev-prueba-admin; DYN_JSON=/c/data/dynamic-security.json
esperar_plugin 20 || { echo "FALLA el plugin del broker desechable no responde"; docker logs "$NOMBRE" 2>&1 | tail -5; exit 1; }
fallos=0
roles_del_sistema >"$T/roles.txt" 2>&1 || { echo "FALLA roles_del_sistema:"; cat "$T/roles.txt"; exit 1; }
for r in dispositivo pasarela; do
  ctrl getRole "$r" | grep -qE "publishClientReceive\s*:\s*deny\s*:\s*#\s" && echo "OK    los roles reales: $r niega recibir lo ajeno" || { echo "FALLA el rol $r no trae publishClientReceive # deny"; fallos=$((fallos+1)); }
done
exigir "createClient víctima" ctrlc "$K_VICTIMA" createClient dev-prueba-backend -p @C@ && exigir "rol víctima" ctrl addClientRole dev-prueba-backend recepcion \
  && exigir "createClient emisor" ctrlc "$K_EMISOR" createClient dev-prueba-emisor -p @C@ && exigir "rol emisor" ctrl addClientRole dev-prueba-emisor dispositivo \
  && exigir "createClient atacante" ctrlc "$K_ATACANTE" createClient dev-prueba-atacante -p @C@ && exigir "rol atacante" ctrl addClientRole dev-prueba-atacante dispositivo \
  && exigir "createClient pasarela" ctrlc "$K_PASARELA" createClient dev-prueba-pasarela -p @C@ && exigir "rol pasarela" ctrl addClientRole dev-prueba-pasarela pasarela \
  || exit 1
# Solo en esta prueba: alguien que pueda escribir en el subárbol de comandos de una pasarela (en el servidor nadie lo hace todavía:
# el envío de órdenes está fuera de alcance, docs/02 §4.3), para ver que la pasarela sigue recibiendo ahí con la negación nueva.
rol dev-prueba-ordenes publishClientSend 'sitio/+/pasarela/+/+/command/#' allow \
  && exigir "createClient ordenador" ctrlc "$K_ORDENADOR" createClient dev-prueba-ordenador -p @C@ && exigir "rol ordenador" ctrl addClientRole dev-prueba-ordenador dev-prueba-ordenes \
  || exit 1
if verificar_clave dev-prueba-backend "$K_VICTIMA"; then echo "OK    verificar_clave acepta la clave correcta, sin conectarse"; else echo "FALLA verificar_clave rechaza la clave correcta"; fallos=$((fallos+1)); fi
if verificar_clave dev-prueba-backend "$K_ATACANTE"; then echo "FALLA verificar_clave acepta una clave ajena"; fallos=$((fallos+1)); else echo "OK    verificar_clave rechaza una clave ajena"; fi

printf '{"url":"mqtt://127.0.0.1:%s","claves":{"victima":"%s","emisor":"%s","atacante":"%s","pasarela":"%s","ordenador":"%s"}}' \
  "$PUERTO" "$K_VICTIMA" "$K_EMISOR" "$K_ATACANTE" "$K_PASARELA" "$K_ORDENADOR" | timeout 120 node "$AQUI/broker-sesion.mjs"
r=$?; [ $r = 124 ] && echo "FALLA los ataques no terminaron en 120 s (¿el broker dejó de confirmar?)"; [ $r = 0 ] || fallos=$((fallos+1))

# verificar_clave no da por buena la clave de un cliente deshabilitado (el broker no lo dejaría entrar).
exigir "disableClient emisor" ctrl disableClient dev-prueba-emisor || exit 1
if verificar_clave dev-prueba-emisor "$K_EMISOR"; then echo "FALLA verificar_clave acepta la clave de un cliente deshabilitado"; fallos=$((fallos+1)); else echo "OK    verificar_clave rechaza la clave de un cliente deshabilitado"; fi
# Rotación de la clave de administración en los dos usuarios con el rol admin (rotar_admin; aquí, dos administradores de descarte).
exigir "createClient guiones" ctrlc "$K_ADMIN" createClient dev-prueba-guiones -p @C@ && exigir "rol guiones" ctrl addClientRole dev-prueba-guiones admin || exit 1
K_NUEVA=$(openssl rand -hex 16); DYN_USUARIOS_ADMIN="dev-prueba-guiones dev-prueba-admin"; unset DYN_USUARIO
if rotar_admin "$K_NUEVA" >"$T/rotar.txt" 2>&1 && [ "$DYN_ADMIN" = "$K_NUEVA" ] && admins_al_dia "$K_ADMIN" >>"$T/rotar.txt" 2>&1; then
  echo "OK    rotar_admin: los dos administradores aceptan la clave nueva y ninguno la anterior"
else echo "FALLA rotar_admin dejó un administrador con la clave anterior o sin la nueva:"; grep -E '^(FALLA|OK)' "$T/rotar.txt" | sed 's/^/      /'; fallos=$((fallos+1)); fi
unset K_ADMIN K_NUEVA K_VICTIMA K_EMISOR K_ATACANTE K_PASARELA K_ORDENADOR DYN_ADMIN

# Evidencia del broker, no del cliente: con quién quedó registrado el atacante y si alguna sesión de la víctima fue tomada.
docker logs "$NOMBRE" > "$T/broker.log" 2>&1
n_propio=$(grep -cE "New client connected from .* as dev-prueba-atacante \(p4, c0, .*u'dev-prueba-atacante'\)" "$T/broker.log")
n_robo=$(grep -cE "as dev-prueba-backend \(.*u'dev-prueba-atacante'\)" "$T/broker.log")
# «session taken over» también aparece cuando la víctima se reconecta antes de que el broker cierre su conexión anterior: cuenta solo
# las tomas cuya conexión nueva (la línea «New client connected» que sigue) trae otro usuario.
n_tomada=$(awk '/Client dev-prueba-backend \[.*\] disconnected: session taken over/ { t = 1; next }
  t && /New client connected/ { if ($0 !~ /u.dev-prueba-backend.\)/) n++; t = 0 } END { print n + 0 }' "$T/broker.log")
[ "$n_propio" -ge 1 ] && echo "OK    el registro anota al atacante con SU usuario ($n_propio conexiones «as dev-prueba-atacante», sesión persistente)" || { echo "FALLA el registro nunca anota al atacante con su propio identificador"; fallos=$((fallos+1)); }
[ "$n_robo" = 0 ] && echo "OK    ninguna conexión del atacante quedó con el identificador de la víctima" || { echo "FALLA $n_robo conexión(es) del atacante con el identificador de la víctima"; fallos=$((fallos+1)); }
echo "──    «session taken over» de la víctima en total: $(grep -cE 'Client dev-prueba-backend \[.*\] disconnected: session taken over' "$T/broker.log") (las de sus propias reconexiones no cuentan)"
[ "$n_tomada" = 0 ] && echo "OK    ninguna sesión de la víctima «taken over» por otro usuario" || { echo "FALLA la sesión de la víctima fue tomada por otro usuario $n_tomada vez/veces"; fallos=$((fallos+1)); }
echo; [ $fallos -eq 0 ] && echo "SESIÓN DEL BROKER PROTEGIDA" || { echo "$fallos bloque(s) con falla"; exit 1; }
