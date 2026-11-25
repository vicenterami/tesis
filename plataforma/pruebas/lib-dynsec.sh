# Funciones compartidas para hablar con el plugin Dynamic Security del broker por mosquitto_ctrl DENTRO del contenedor
# (docs/10 §8.4 punto 42; docs/11 §7). Las cargan pruebas/broker-inicializar.sh, pruebas/broker-cliente.sh y
# pruebas/banco/banco.sh con `. "$(dirname "$0")/lib-dynsec.sh"`. Quien la carga define antes:
#   DYN_DC     cómo correr `docker compose` sobre la pila correcta (por defecto, `docker compose`; el banco usa su función dc)
#   DYN_ADMIN  clave del administrador `backend-admin` (sale del .env; nunca se imprime)
# y, solo si hace falta, DYN_USUARIOS_ADMIN (con quién intentar administrar, en orden; por defecto «admin-guiones backend-admin»)
# y DYN_JSON (ruta del archivo del plugin dentro del contenedor). Los fija la prueba pruebas/broker-sesion.sh, con identidades de descarte.
#
# Desde el 25/11/2026 el broker reemplaza el identificador de cliente por el usuario (`use_username_as_clientid`, docs/11 §7 y
# docs/10 §8.4 punto 70): conectarse con la credencial de alguien es tomar SU sesión. De ahí dos reglas para los guiones:
#   · administran como `admin-guiones` (mismo rol `admin`, misma clave MQTT_ADMIN_CLAVE): con `backend-admin`, cada orden
#     expulsaría una vez la conexión de administración del backend. Si todavía no existe (broker sin reinicializar), se usa
#     `backend-admin` y el backend se reconecta a los 2 s; `admin_de_guiones` lo crea.
#   · nunca se conectan como un cliente del sistema ni como un dispositivo para probar su clave: `verificar_clave` la compara
#     con el resumen del archivo del plugin, sin conectarse (conectarse como `backend` con sesión limpia BORRA su cola).
# Las claves entran al contenedor por la entrada estándar: no pasan por argumentos del equipo (ps) ni por su historial.
# Dentro del contenedor, mosquitto_ctrl las recibe por -P, como ya hace el chequeo de salud con la sonda: quien tiene acceso al
# socket de Docker las ve con `docker top`, y ese acceso ya equivale a root del servidor (riesgo aceptado, docs/11 §7).

# stdin: la clave del administrador y, en la segunda línea, otra clave opcional; «@C@» en los argumentos se reemplaza por
# esa otra clave dentro del contenedor. El aviso «sin cifrado» de mosquitto_ctrl se filtra: el 1883 es interno (docs/10 §2).
# Candado (25/11/2026): todos los guiones administran como `admin-guiones` y, con el usuario como identificador de cliente, dos órdenes a la
# vez se expulsan entre sí (respuestas truncadas). flock serializa las órdenes de los guiones del mismo usuario del equipo, también entre
# guiones distintos que corren en paralelo (verificador, banco, inicializador). DYN_CANDADO cambia el archivo; espera hasta 120 s
# (DYN_CANDADO_ESPERA) y, si no lo obtiene, devuelve 1 con un «Error:» (exigir lo ve).
dyn_ejecutar() {
  {
    flock -w "${DYN_CANDADO_ESPERA:-120}" 8 || { echo "Error: otra orden de administración del broker no soltó el candado en ${DYN_CANDADO_ESPERA:-120} s ($DYN_CANDADO_ARCHIVO)"; return 1; }
    dyn_ejecutar_sin_candado "$@"
  } 8>"$DYN_CANDADO_ARCHIVO"
}
DYN_CANDADO_ARCHIVO="${DYN_CANDADO:-${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/tesis-dynsec-admin.lock}"
dyn_ejecutar_sin_candado() {
  ${DYN_DC:-docker compose} exec -T mosquitto sh -c '
    IFS= read -r A; IFS= read -r C
    M="$1"; shift
    for a in "$@"; do [ "$a" = @C@ ] && a="$C"; set -- "$@" "$a"; shift; done
    U="$1"; shift
    mosquitto_ctrl -u "$U" -P "$A" dynsec "$@" 2>&1 \
      | grep -v "^Warning: You are running mosquitto_ctrl without encryption\|^This means all of the configuration\|^$"
    [ -n "$M" ] && echo "$M"; exit 0' sh "${DYN_MARCA:-}" "${DYN_USUARIO:-backend-admin}" "$@"
}
# Sin administrador elegido todavía (un guion que no llamó a esperar_plugin), se elige aquí una vez: admin-guiones si entra.
dyn_elegir() { [ -n "${DYN_USUARIO:-}" ] || esperar_plugin 3 || DYN_USUARIO=backend-admin; }
ctrl()  { dyn_elegir; printf '%s\n\n' "$DYN_ADMIN" | dyn_ejecutar "$@"; }
ctrlc() { dyn_elegir; local clave="$1"; shift; printf '%s\n%s\n' "$DYN_ADMIN" "$clave" | dyn_ejecutar "$@"; }

# Verificar el resultado, no el comando: mosquitto_ctrl devuelve 0 aunque el plugin responda «Error: …», y el grep de arriba tapa
# el código de salida. `exigir <qué> <orden…>` falla (1, con el mensaje) ante cualquier error que no sea «ya existe», y también si la
# orden no llegó a correr dentro del contenedor (broker caído: `docker compose exec` falla sin nada en la salida estándar). Para
# eso pide a dyn_ejecutar una marca final (DYN_MARCA), que solo aparece si el contenedor ejecutó la orden (25/11/2026). La marca prueba
# que la orden corrió, no que el plugin la aplicó: por eso cuentan como error, además de «Error: …», los fallos de conexión y de
# autorización de mosquitto_ctrl («Connection error: Not authorized», comprobado contra el broker, sale con 0) y «Connection lost».
exigir() {
  local que="$1"; shift
  local salida
  salida=$(DYN_MARCA=@@orden-ejecutada@@ "$@" 2>/dev/null | grep -v "already exists\|already in\|^$" || true)
  if ! grep -qx "@@orden-ejecutada@@" <<<"$salida"; then echo "FALLA $que: la orden no llegó a correr en el contenedor del broker (¿está arriba?)"; return 1; fi
  salida=$(grep -vx "@@orden-ejecutada@@" <<<"$salida" || true)
  if grep -qiE "^(Error|Connection error|Connection lost)" <<<"$salida"; then echo "FALLA $que: $salida"; return 1; fi
  return 0
}

# Espera a que el plugin responda al administrador (el broker recién arrancado tarda un segundo o dos) y deja en DYN_USUARIO
# el primero de DYN_USUARIOS_ADMIN que entra con DYN_ADMIN: `admin-guiones` si ya existe; si no, `backend-admin`.
esperar_plugin() {
  local i u
  for i in $(seq 1 "${1:-20}"); do
    for u in ${DYN_USUARIOS_ADMIN:-admin-guiones backend-admin}; do
      DYN_USUARIO=$u; ctrl listClients 2>/dev/null | grep -qx "$u" && return 0
    done
    sleep 1
  done
  return 1
}

# Rol idempotente: createRole + tríos (tipo de ACL, tópico, allow|deny). El plugin evalúa las ACL de mayor a menor prioridad y
# manda la primera que coincide: las allow van con prioridad 1 y las deny con 0. «already exists» no es error.
rol() {
  local r="$1"; shift
  exigir "createRole $r" ctrl createRole "$r" || return 1
  while [ $# -ge 3 ]; do
    local prio=1; [ "$3" = deny ] && prio=0
    exigir "addRoleACL $r $1 $2" ctrl addRoleACL "$r" "$1" "$2" "$3" $prio || return 1
    shift 3
  done
  return 0
}

# Los roles del sistema (docs/10 §8.4 punto 42): backend lee sitio/#; la sonda del healthcheck lee $SYS/#; cada dispositivo
# publica SOLO bajo su propio usuario (%u, sostenido por Mosquitto 2.1.2: docs/16 §18) y no se suscribe a nada. Cada rol lleva
# sus negaciones EXPLÍCITAS (publicar en cualquier otro tópico y en $CONTROL, suscribirse a cualquiera) y el acceso por defecto
# del plugin se fija en deny: así el banco prueba la misma ACL que corre en el servidor (docs/16 §20). «$CONTROL/#» va aparte
# porque «#» no cubre los tópicos que empiezan con «$».
# Mínimo privilegio también para el administrador (13/10/2026; docs/11 §7). `dynsec init` crea el rol `admin` con
# permiso de suscribirse y recibir TODO (`#`), y backend-admin solo necesita dos cosas: dar órdenes al plugin
# ($CONTROL/dynamic-security/#) y leer los contadores del broker ($SYS/#). Se quitan las tres ACL amplias; como el acceso por
# defecto de suscripción es deny (abajo), backend-admin ya no puede suscribirse a sitio/# ni a nada fuera de esos dos árboles.
# Idempotente: solo quita lo que el rol todavía tiene (getRole), así repetir el inicializador no da error.
acotar_admin() {
  local actual tipo
  actual=$(ctrl getRole admin) || return 1
  # Señal POSITIVA de que se leyó el rol (ctrl sale con 0 aunque la orden falle: «Error…», «Connection error…» no traen ACL y el grep
  # negativo de abajo los daría por buenos).
  grep -qE '^Rolename:[[:space:]]*admin[[:space:]]*$' <<<"$actual" || { echo "FALLA no se pudo leer el rol admin: $(head -1 <<<"$actual")"; return 1; }
  for tipo in subscribePattern publishClientReceive unsubscribePattern; do
    if grep -qE "^\s*(ACLs:)?\s*$tipo\s*:\s*allow\s*:\s*#\s" <<<"$actual"; then
      exigir "removeRoleACL admin $tipo #" ctrl removeRoleACL admin "$tipo" '#' || return 1
    fi
  done
  if grep -qE ":\s*#\s" <<<"$(ctrl getRole admin)"; then echo "FALLA el rol admin sigue con una ACL sobre #"; return 1; fi
  return 0
}

roles_del_sistema() {
  acotar_admin || return 1
  exigir "setDefaultACLAccess publishClientSend" ctrl setDefaultACLAccess publishClientSend deny || return 1
  exigir "setDefaultACLAccess subscribe" ctrl setDefaultACLAccess subscribe deny || return 1
  rol recepcion   subscribePattern 'sitio/#' allow  publishClientReceive 'sitio/#' allow \
                  publishClientSend '#' deny  publishClientSend '$CONTROL/#' deny  subscribePattern '#' deny  subscribeLiteral '#' deny || return 1
  rol sonda       subscribePattern '$SYS/#' allow  publishClientReceive '$SYS/#' allow \
                  publishClientSend '#' deny  publishClientSend '$CONTROL/#' deny  subscribePattern '#' deny  subscribeLiteral '#' deny || return 1
  # Pasarela o servidor de red externo (docs/10 §8.4 punto 47): publica bajo su árbol y se suscribe SOLO a su subárbol de comandos,
  # porque la integración MQTT de ChirpStack se suscribe a su tópico de comandos aunque nunca se le mande nada.
  # Defensa en profundidad (25/11/2026; docs/11 §7): ni la pasarela ni el dispositivo reciben nada fuera de lo suyo
  # (`publishClientReceive '#' deny`, prioridad 0). El plugin trae «recibir» permitido por defecto; si una credencial de equipo
  # llegara a quedarse con la sesión de otro cliente, se la negaría la entrega. Lo que la pasarela sí recibe (su subárbol de
  # comandos) va con prioridad 1 y manda. El control principal es `use_username_as_clientid` (mosquitto.conf).
  rol pasarela    publishClientSend 'sitio/+/pasarela/%u/#' allow  subscribePattern 'sitio/+/pasarela/%u/+/command/#' allow \
                  publishClientReceive 'sitio/+/pasarela/%u/+/command/#' allow \
                  publishClientSend '#' deny  publishClientSend '$CONTROL/#' deny  subscribePattern '#' deny  subscribeLiteral '#' deny \
                  publishClientReceive '#' deny || return 1
  # Sin bucle: no publica en su propio subárbol de comandos (lo recibe); prioridad 2, por encima de su permiso de publicar (1).
  exigir "addRoleACL pasarela deny command" ctrl addRoleACL pasarela publishClientSend 'sitio/+/pasarela/%u/+/command/#' deny 2 || return 1
  rol dispositivo publishClientSend 'sitio/+/dispositivo/%u/+' allow \
                  publishClientSend '#' deny  publishClientSend '$CONTROL/#' deny  subscribePattern '#' deny  subscribeLiteral '#' deny \
                  publishClientReceive '#' deny || return 1
}

# ¿El plugin acepta esa clave para ese usuario? Se compara con el resumen que el plugin guarda en su archivo ($7$: PBKDF2-SHA512
# con sal, el mismo cálculo que hace al autenticar), SIN conectarse: con `use_username_as_clientid`, conectarse como el usuario
# toma su sesión (hasta el 25/11/2026 se publicaba con un identificador propio, que el broker ahora reemplaza por el usuario).
# Un cliente deshabilitado ("disabled": true) no entra aunque la clave coincida: da 1. Prueba el archivo, no la memoria del plugin,
# que lo reescribe tras cada orden que aplica.
# La clave entra por la entrada estándar; el archivo pasa del contenedor a python3 por una tubería y nunca se imprime. El plugin
# reescribe el archivo tras cada orden: se reintenta un par de veces por si la escritura no terminó.
verificar_clave() { # usuario · clave
  local i
  for i in 1 2 3; do
    { printf '%s\n' "$2"; ${DYN_DC:-docker compose} exec -T mosquitto cat "${DYN_JSON:-/mosquitto/data/dynamic-security.json}" </dev/null 2>/dev/null; } | python3 -I -c '
import sys, json, base64, hashlib, hmac
clave = sys.stdin.readline().rstrip("\n")
try:
    c = next(c for c in json.load(sys.stdin)["clients"] if c.get("username") == sys.argv[1])
    if c.get("disabled") is True: sys.exit(1)
    _, tipo, vueltas, sal, resumen = c["encoded_password"].split("$")
    esperado = base64.b64decode(resumen)
    calculado = hashlib.pbkdf2_hmac("sha512", clave.encode(), base64.b64decode(sal), int(vueltas), len(esperado))
    sys.exit(0 if tipo == "7" and hmac.compare_digest(calculado, esperado) else 1)
except Exception:
    sys.exit(1)' "$1" && return 0
    sleep 0.5
  done
  return 1
}

# Cliente del sistema con su rol: lo crea o, si ya existe, le fija la clave dada (rotación = editar el .env y repetir), y
# comprueba que el plugin la acepta (verificar_clave, sin conectarse).
cliente_del_sistema() { # usuario · rol · clave
  local u="$1" r="$2" clave="$3"
  if ctrl getClient "$u" | grep -q "^Username"; then
    exigir "setClientPassword $u" ctrlc "$clave" setClientPassword "$u" @C@ || return 1
    echo "OK    $u ya existía: clave fijada a la del .env"
  else
    exigir "createClient $u" ctrlc "$clave" createClient "$u" -p @C@ || return 1
    echo "OK    $u creado"
  fi
  exigir "addClientRole $u $r" ctrl addClientRole "$u" "$r" || return 1
  if verificar_clave "$u" "$clave"; then echo "OK    el plugin acepta para $u la clave del .env (comparada con su resumen, sin conectarse)"; else echo "FALLA el plugin no acepta para $u la clave del .env"; return 1; fi
}

# Administrador de los guiones (25/11/2026): `admin-guiones`, rol `admin`, la misma clave del administrador (MQTT_ADMIN_CLAVE; no es
# un secreto nuevo que guardar ni rotar aparte: el inicializador le fija la vigente cada vez). Desde aquí los guiones ya no usan
# `backend-admin`, cuya conexión es la del backend.
admin_de_guiones() {
  cliente_del_sistema admin-guiones admin "$DYN_ADMIN" || return 1
  DYN_USUARIO=admin-guiones
}

# Los dos usuarios con el rol admin (DYN_USUARIOS_ADMIN: admin-guiones y backend-admin) tienen la clave vigente (DYN_ADMIN) y, si se
# pasa una clave anterior, ninguno la acepta ya. Sin conectarse (verificar_clave). Imprime una línea FALLA por cada discrepancia.
admins_al_dia() { # [clave anterior]
  local u r=0
  for u in ${DYN_USUARIOS_ADMIN:-admin-guiones backend-admin}; do
    verificar_clave "$u" "$DYN_ADMIN" || { echo "FALLA $u no tiene la clave vigente del administrador"; r=1; }
    # La negativa también se repite: el plugin reescribe su archivo tras cada orden, y una lectura de antes de esa escritura daría un falso
    # «todavía acepta»; se declara solo si la acepta en tres lecturas espaciadas.
    if [ -n "${1:-}" ] && [ "$1" != "$DYN_ADMIN" ] && verificar_clave "$u" "$1" && { sleep 0.5; verificar_clave "$u" "$1"; } \
       && { sleep 1; verificar_clave "$u" "$1"; }; then echo "FALLA $u todavía acepta la clave anterior"; r=1; fi
  done
  return $r
}

# Rotación de la clave de administración (25/11/2026; docs/11 §7). Los dos usuarios con el rol admin comparten la clave: si uno
# quedara con la anterior (el guion se corta entre los dos, o alguien rota uno a mano), esa clave seguiría administrando el plugin.
# Por eso se cambian en el mismo bloque, cada uno desde el otro (ninguna orden cambia la clave de la conexión que la da), y la
# rotación se declara hecha solo si el archivo del plugin acepta la nueva y rechaza la anterior para los dos. Entrada: DYN_ADMIN =
# la anterior y $1 = la nueva; al volver, DYN_ADMIN = la nueva. Sale 2 si nadie entra con la anterior (no se tocó nada) y 1 si la
# rotación no se pudo comprobar (repetirla es seguro: entra con la anterior el que todavía la tenga).
rotar_admin() { # clave nueva
  local nueva="$1" anterior="$DYN_ADMIN" g s quien otro
  read -r g s <<<"${DYN_USUARIOS_ADMIN:-admin-guiones backend-admin}"
  [ -n "$g" ] && [ -n "$s" ] && [ "$g" != "$s" ] || { echo "FALLA rotar_admin necesita dos administradores distintos en DYN_USUARIOS_ADMIN"; return 1; }
  esperar_plugin 5 || return 2
  quien=$DYN_USUARIO; if [ "$quien" = "$g" ]; then otro=$s; else otro=$g; fi
  # 1. Desde quien entra con la anterior, el otro pasa a la nueva (admin-guiones se crea si todavía no existe).
  cliente_del_sistema "$otro" admin "$nueva" >/dev/null || { echo "FALLA no se pudo fijar la clave nueva a $otro"; return 1; }
  # 2. Desde el otro, que ya entra con la nueva, quien pasa a la nueva.
  DYN_USUARIO=$otro; DYN_ADMIN="$nueva"
  cliente_del_sistema "$quien" admin "$nueva" >/dev/null || { echo "FALLA no se pudo fijar la clave nueva a $quien"; return 1; }
  admins_al_dia "$anterior" || return 1
  echo "OK    clave de administración rotada en $g y $s: los dos aceptan la nueva y ninguno la anterior"
}

# ¿El broker que corre cargó su mosquitto.conf? (una sola casa: la usan broker-inicializar.sh y el paso 2i del verificador; 25/11/2026)
# use_username_as_clientid «not reloaded on reload signal» (mosquitto.conf(5)): tras cambiar el archivo hay que reiniciar el broker.
# Comparación POR FECHA: el arranque del contenedor (StartedAt) contra la última modificación del archivo. Es una inferencia, no una
# lectura de la memoria del broker: un despliegue que conserve las fechas del archivo (cp -p, rsync -a) la engaña; una edición sin
# cambios (git checkout) la hace fallar del lado seguro. Con --registro suma una prueba EN VIVO, sin tocar ninguna sesión: si desde el
# arranque `admin-guiones` dio órdenes al plugin (mosquitto_ctrl entra con un identificador al azar), el registro debe anotarlo
# «as admin-guiones (» (el broker reemplazó el identificador por el usuario); sin la opción lo anotaría con el identificador al azar.
# Uso: config_cargada <ruta de mosquitto.conf> [--registro]. Sale 0 si la cargó, 1 si no (con el motivo en una línea «──») y 3 si no
# hay broker corriendo. Usa DYN_DC (por defecto `docker compose`) en la carpeta de la pila. Límite de --registro: lee el registro del
# contenedor desde su arranque; con la rotación (10 MB × 5) un broker de vida muy larga y mucho registro podría haber perdido la línea y
# daría un falso «no la cargó» (falla del lado seguro; se usa justo después de que admin-guiones dio órdenes, así que la línea es reciente).
config_cargada() {
  local conf="$1" id arranque ini mod
  id=$(${DYN_DC:-docker compose} ps -q mosquitto 2>/dev/null); [ -n "$id" ] || return 3
  arranque=$(docker inspect -f '{{.State.StartedAt}}' "$id" 2>/dev/null) && ini=$(date -d "$arranque" +%s 2>/dev/null) || return 3
  mod=$(stat -c %Y "$conf") || return 1
  if [ "$ini" -lt "$mod" ]; then echo "──    por fecha: el broker arrancó $(( (mod-ini)/60 )) min antes de la última modificación de $conf"; return 1; fi
  if [ "${2:-}" = --registro ] && ! ${DYN_DC:-docker compose} logs --no-color --since "$arranque" mosquitto 2>/dev/null | grep -qE "New client connected from .* as admin-guiones \("; then
    echo "──    en vivo: desde que arrancó, el registro del broker no anota a admin-guiones por su usuario (sin use_username_as_clientid activa)"; return 1
  fi
  return 0
}

# Lee UNA variable de un archivo de entorno sin exportar el archivo entero (sin comillas alrededor del valor).
leer_env() { grep -E "^$2=" "$1" | tail -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'; }
