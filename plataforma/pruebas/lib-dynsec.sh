# Funciones compartidas para hablar con el plugin Dynamic Security del broker por mosquitto_ctrl DENTRO del contenedor
# (docs/10 §8.4 punto 42; docs/11 §7). Las cargan pruebas/broker-inicializar.sh, pruebas/broker-cliente.sh y
# pruebas/banco/banco.sh con `. "$(dirname "$0")/lib-dynsec.sh"`. Quien la carga define antes:
#   DYN_DC     cómo correr `docker compose` sobre la pila correcta (por defecto, `docker compose`; el banco usa su función dc)
#   DYN_ADMIN  clave del administrador `backend-admin` (sale del .env; nunca se imprime)
# Las claves entran al contenedor por la entrada estándar: no pasan por argumentos del equipo (ps) ni por su historial.
# Dentro del contenedor, mosquitto_ctrl las recibe por -P, como ya hace el chequeo de salud con la sonda: quien tiene acceso al
# socket de Docker las ve con `docker top`, y ese acceso ya equivale a root del servidor (riesgo aceptado, docs/11 §7).

# stdin: la clave del administrador y, en la segunda línea, otra clave opcional; «@C@» en los argumentos se reemplaza por
# esa otra clave dentro del contenedor. El aviso «sin cifrado» de mosquitto_ctrl se filtra: el 1883 es interno (docs/10 §2).
dyn_ejecutar() {
  ${DYN_DC:-docker compose} exec -T mosquitto sh -c '
    IFS= read -r A; IFS= read -r C
    for a in "$@"; do [ "$a" = @C@ ] && a="$C"; set -- "$@" "$a"; shift; done
    mosquitto_ctrl -u backend-admin -P "$A" dynsec "$@" 2>&1 \
      | grep -v "^Warning: You are running mosquitto_ctrl without encryption\|^This means all of the configuration\|^$"' sh "$@"
}
ctrl()  { printf '%s\n\n' "$DYN_ADMIN" | dyn_ejecutar "$@"; }
ctrlc() { local clave="$1"; shift; printf '%s\n%s\n' "$DYN_ADMIN" "$clave" | dyn_ejecutar "$@"; }

# Verificar el resultado, no el comando: mosquitto_ctrl devuelve 0 aunque el plugin responda «Error: …», y el grep de arriba tapa
# el código de salida. `exigir <qué> <orden…>` falla (1, con el mensaje) ante cualquier error que no sea «ya existe».
exigir() {
  local que="$1"; shift
  local salida
  salida=$("$@" | grep -v "already exists\|already in\|^$" || true)
  if grep -qi "^Error" <<<"$salida"; then echo "FALLA $que: $salida"; return 1; fi
  return 0
}

# Espera a que el plugin responda al administrador (el broker recién arrancado tarda un segundo o dos).
esperar_plugin() {
  local i
  for i in $(seq 1 "${1:-20}"); do ctrl listClients 2>/dev/null | grep -qx backend-admin && return 0; sleep 1; done
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
  rol pasarela    publishClientSend 'sitio/+/pasarela/%u/#' allow  subscribePattern 'sitio/+/pasarela/%u/+/command/#' allow \
                  publishClientReceive 'sitio/+/pasarela/%u/+/command/#' allow \
                  publishClientSend '#' deny  publishClientSend '$CONTROL/#' deny  subscribePattern '#' deny  subscribeLiteral '#' deny || return 1
  # Sin bucle: no publica en su propio subárbol de comandos (lo recibe); prioridad 2, por encima de su permiso de publicar (1).
  exigir "addRoleACL pasarela deny command" ctrl addRoleACL pasarela publishClientSend 'sitio/+/pasarela/%u/+/command/#' deny 2 || return 1
  rol dispositivo publishClientSend 'sitio/+/dispositivo/%u/+' allow \
                  publishClientSend '#' deny  publishClientSend '$CONTROL/#' deny  subscribePattern '#' deny  subscribeLiteral '#' deny || return 1
}

# ¿Entra el usuario con esa clave? Publica en un tópico que ningún rol permite, con un identificador de cliente propio (no pisa
# la sesión del titular). PUBACK = conectó (RC:135: la ACL lo frenó, lo esperado); «Connection error» = la clave no vale.
verificar_clave() { # usuario · clave
  local r
  r=$(printf '%s\n' "$2" | ${DYN_DC:-docker compose} exec -T mosquitto sh -c 'IFS= read -r C; mosquitto_pub -V mqttv5 -d -q 1 -i "verif-$$" -u "$1" -P "$C" -t sitio/verificacion/x/y -m 1 2>&1' sh "$1")
  grep -q "PUBACK" <<<"$r"
}

# Cliente del sistema con su rol: lo crea o, si ya existe, le fija la clave dada (rotación = editar el .env y repetir), y
# comprueba que de verdad entra con ella.
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
  if verificar_clave "$u" "$clave"; then echo "OK    $u entra al broker con la clave del .env"; else echo "FALLA $u no entra al broker con la clave del .env"; return 1; fi
}

# Lee UNA variable de un archivo de entorno sin exportar el archivo entero (sin comillas alrededor del valor).
leer_env() { grep -E "^$2=" "$1" | tail -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'; }
