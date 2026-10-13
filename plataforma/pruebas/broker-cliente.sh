#!/usr/bin/env bash
# Crea, rota o elimina A MANO la credencial de un DISPOSITIVO en el plugin Dynamic Security del broker (docs/11 §7), con el rol
# `dispositivo` (publica solo en sitio/+/dispositivo/<su usuario>/+). El camino normal es el alta por API (POST /dispositivos,
# docs/10 §3), que crea el cliente y muestra la credencial una sola vez. Esto es para los dispositivos de la demo (dev-0001,
# que la semilla crea en la base sin credencial), para rotar una clave perdida y para borrar un cliente huérfano. Sin reiniciar
# nada: el plugin aplica el cambio en el acto.
#   bash plataforma/pruebas/broker-cliente.sh dev-0001            crear o rotar (pide la clave oculta; 24 caracteres o más)
#   bash plataforma/pruebas/broker-cliente.sh --borrar dev-prueba eliminar (antes de conectar equipos reales)
# La clave la genera el gestor de contraseñas u `openssl rand -base64 24`; entra por la entrada estándar: no queda en el
# historial ni en el ps del equipo. Nunca se imprime.
set -u
cd "$(dirname "$0")/.." || exit 1                 # plataforma/
. "$(dirname "$0")/lib-dynsec.sh"
[ -f .env ] || { echo "FALLA falta plataforma/.env"; exit 1; }
DYN_ADMIN=$(leer_env .env MQTT_ADMIN_CLAVE)
SONDA_U=$(leer_env .env MQTT_SONDA_USUARIO); SONDA_U=${SONDA_U:-sonda}   # el usuario de la sonda es configurable: también reservado
[ -n "$DYN_ADMIN" ] && [ "$DYN_ADMIN" != CAMBIAR_ESTA_CLAVE ] || { echo "FALLA MQTT_ADMIN_CLAVE vacía o sin cambiar en .env"; exit 1; }

borrar=0; [ "${1:-}" = "--borrar" ] && { borrar=1; shift; }
ID="${1:-}"
[[ "$ID" =~ ^[a-z0-9][a-z0-9-]{2,62}$ ]] || { sed -n '7,8p' "$0" | sed 's/^# *//'; exit 1; }
case "$ID" in sonda|backend|backend-admin|admin|"$SONDA_U") echo "«$ID» no es un dispositivo: su clave vive en .env y la fija broker-inicializar.sh"; exit 1 ;; esac
esperar_plugin 5 || { echo "FALLA el broker no responde al administrador (¿pila apagada o MQTT_ADMIN_CLAVE distinta?)"; exit 1; }

if [ $borrar = 1 ]; then
  ctrl deleteClient "$ID" | grep -v "^$"
else
  read -rs -p "Clave para $ID (pégala desde el gestor; no se verá): " CLAVE; echo
  [ ${#CLAVE} -ge 24 ] || { echo "FALLA: la clave tiene ${#CLAVE} caracteres; se exigen 24 o más (openssl rand -base64 24 da 32)"; exit 1; }
  if ctrl getClient "$ID" | grep -q "^Username"; then
    ctrlc "$CLAVE" setClientPassword "$ID" @C@ | grep -v "^$"; echo "── $ID existía: clave rotada"
  else
    ctrlc "$CLAVE" createClient "$ID" -p @C@ | grep -v "^$"
    ctrl addClientRole "$ID" dispositivo | grep -v "^$"
  fi
fi

# Verificación del resultado, no del comando. Para crear/rotar: el dispositivo conecta con la clave nueva y la ACL lo frena en
# un tópico ajeno (RC:135 = «no autorizado» con la conexión aceptada: prueba la clave sin que llegue nada al pipeline). Con un
# identificador de cliente propio: con el del dispositivo, el broker expulsaría la sesión del titular si está conectado.
clientes=$(ctrl listClients)
if [ $borrar = 1 ]; then
  grep -qx "$ID" <<<"$clientes" && { echo "FALLA: $ID sigue en el plugin"; exit 1; }
  echo "OK    $ID eliminado; el broker ya no lo acepta"
else
  r=$(printf '%s\n' "$CLAVE" | docker compose exec -T mosquitto sh -c 'IFS= read -r C; mosquitto_pub -V mqttv5 -d -q 1 -i "verif-$$" -u "$1" -P "$C" -t sitio/verificacion/dispositivo/otro/x -m 1 2>&1' sh "$ID")
  if grep -q "RC:135" <<<"$r"; then echo "OK    el broker acepta la clave nueva de $ID y su ACL lo limita a su tópico (guárdala en el gestor si aún no lo hiciste)"
  elif grep -q "Connection error" <<<"$r"; then echo "FALLA: el broker rechaza la clave nueva de $ID ($(grep -oE 'Connection error: .*' <<<"$r" | head -1))"; exit 1
  else echo "FALLA: resultado inesperado al publicar en un tópico ajeno: $(tail -1 <<<"$r")"; exit 1; fi
  grep -q "dispositivo" <<<"$(ctrl getClient "$ID")" || { echo "FALLA: $ID no tiene el rol dispositivo"; exit 1; }
fi
