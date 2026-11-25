#!/usr/bin/env bash
# Inicializa (una vez) o repara el plugin Dynamic Security del broker (docs/10 §8.4 puntos 26, 41 y 42; docs/11 §7):
#   1. crea el archivo del plugin en el volumen de datos, SIN broker, con el administrador `backend-admin`
#      (clave: MQTT_ADMIN_CLAVE del .env); dueño 1883 y modo 600;
#   2. levanta solo el broker (lo recrea únicamente si el que corre no acepta al administrador: la configuración entra por un
#      bind mount y el proceso la lee una sola vez, al arrancar), y crea los roles `recepcion` (backend: lee sitio/#),
#      `sonda` (chequeo de salud: $SYS/#) y `dispositivo` (cada uno publica solo en sitio/+/dispositivo/<su usuario>/+), y los
#      clientes `backend` y `sonda` con las claves del .env (si ya existen, les fija esa clave y comprueba que el plugin la acepta,
#      sin conectarse: docs/11 §7), y `admin-guiones`, con el rol admin y la misma clave del administrador, con el que administran
#      los guiones desde el 25/11/2026 (con backend-admin expulsarían la conexión de administración del backend);
#   3. levanta el resto de la pila y verifica el resultado: clientes (backend-admin, admin-guiones, backend, sonda) y roles presentes,
#      los dos administradores con la clave vigente, chequeo de salud en verde.
# Repetible: no duplica ni pisa nada que no sea una clave del .env. Nunca imprime secretos. Desde cualquier carpeta:
#   bash plataforma/pruebas/broker-inicializar.sh
# Rotar la clave del administrador: poner la nueva en MQTT_ADMIN_CLAVE y la vigente en MQTT_ADMIN_CLAVE_ANTERIOR, correr esto
#   (entra con la anterior, fija la nueva a los DOS usuarios de administración, backend-admin y admin-guiones, y dice «rotada» solo
#   si el plugin acepta la nueva y rechaza la anterior para ambos) y después borrar MQTT_ADMIN_CLAVE_ANTERIOR del .env.
#   bash plataforma/pruebas/broker-inicializar.sh --roles     SOLO aplica los roles del sistema y el administrador de los guiones
#        a un broker que ya corre (p. ej. tras cambiar pruebas/lib-dynsec.sh): no crea el archivo, no levanta ni recrea nada, no
#        toca las claves de backend ni de sonda. Repetible (25/11/2026; docs/16 §102). Al final avisa, y sale con 2, si el broker que
#        corre no cargó su mosquitto.conf (config_cargada de lib-dynsec.sh: por fecha y en el registro; use_username_as_clientid no se
#        relee con la señal de recarga) y da el remedio. La inicialización completa lo cuenta como falla.
#   bash plataforma/pruebas/broker-inicializar.sh --rehacer   borra el archivo del plugin y lo crea de nuevo: TODOS los
#        clientes (dispositivos incluidos) pierden su credencial; pide confirmación. Solo si se perdió la clave del administrador.
# Las credenciales de DISPOSITIVOS no van aquí: las crea el backend en el alta (POST /dispositivos) o, a mano,
# pruebas/broker-cliente.sh (demo y emergencias).
set -u
AQUI=$(cd "$(dirname "$0")" && pwd) || exit 1      # ruta absoluta del guion: funciona desde cualquier carpeta (14/10)
cd "$AQUI/.." || exit 1                           # plataforma/
. "$AQUI/lib-dynsec.sh"
[ -f .env ] || { echo "FALLA falta plataforma/.env (copiar .env.example y completar)"; exit 1; }
DYN_ADMIN=$(leer_env .env MQTT_ADMIN_CLAVE); BACKEND=$(leer_env .env MQTT_BACKEND_CLAVE); SONDA=$(leer_env .env MQTT_SONDA_CLAVE)
ANTERIOR=$(leer_env .env MQTT_ADMIN_CLAVE_ANTERIOR)
SONDA_U=$(leer_env .env MQTT_SONDA_USUARIO); SONDA_U=${SONDA_U:-sonda}
# Mínimo 24 caracteres (lo que da `openssl rand -base64 24` son 32): la misma política que el backend aplica a HTTP_CLAVE_ADMIN.
for v in MQTT_ADMIN_CLAVE MQTT_BACKEND_CLAVE MQTT_SONDA_CLAVE; do
  c=$(leer_env .env "$v")
  [ -n "$c" ] && [ "$c" != CAMBIAR_ESTA_CLAVE ] || { echo "FALLA $v vacía o sin cambiar en .env (openssl rand -base64 24)"; exit 1; }
  [ ${#c} -ge 24 ] || { echo "FALLA $v tiene ${#c} caracteres; se exigen 24 o más (openssl rand -base64 24 da 32)"; exit 1; }
done
IMG=$(grep -oE 'eclipse-mosquitto:[^ ]+@sha256:[0-9a-f]{64}' docker-compose.yml | head -1)
[ -n "$IMG" ] || { echo "FALLA no encontré la imagen fijada del broker en docker-compose.yml"; exit 1; }
VOL=$(docker compose config --format json 2>/dev/null | jq -r '.volumes["datos-mosquitto"].name')
[ -n "$VOL" ] && [ "$VOL" != null ] || { echo "FALLA no encontré el volumen datos-mosquitto en el compose"; exit 1; }
# El volumen se monta en /c, nunca en /mosquitto (el arranque de la imagen haría chown -R; docs/11 §7), y sin entrypoint.
en_volumen() { docker run --rm -i -v "$VOL:/c" --entrypoint sh "$IMG" -c "$1"; }

# --roles: el cambio de roles en un broker ya inicializado. Solo órdenes al plugin, que las aplica en el acto.
if [ "${1:-}" = --roles ]; then
  esperar_plugin 5 || { echo "FALLA el broker no responde al administrador (¿no está arriba, o MQTT_ADMIN_CLAVE no es la vigente?)"; exit 1; }
  roles_del_sistema || exit 1
  admin_de_guiones || exit 1
  fallos=0
  for r in dispositivo pasarela; do
    if ctrl getRole "$r" | grep -qE "publishClientReceive\s*:\s*deny\s*:\s*#\s"; then echo "OK    el rol $r niega recibir lo ajeno (publishClientReceive # deny)"
    else echo "FALLA el rol $r no trae publishClientReceive # deny"; fallos=$((fallos+1)); fi
  done
  ctrl getRole pasarela | grep -qE "publishClientReceive\s*:\s*allow\s*:\s*sitio/\+/pasarela/%u/\+/command/#" \
    && echo "OK    la pasarela conserva su subárbol de comandos (allow, prioridad mayor que la negación)" || { echo "FALLA la pasarela perdió su permiso de recibir comandos"; fallos=$((fallos+1)); }
  admins_al_dia "$ANTERIOR" || fallos=$((fallos+1))
  [ $fallos -eq 0 ] || { echo "$fallos falla(s)"; exit 1; }
  if ! config_cargada mosquitto/config/mosquitto.conf --registro; then
    echo "AVISO el broker que corre no cargó mosquitto/config/mosquitto.conf (use_username_as_clientid y lo demás)."
    echo "      Remedio: docker compose restart mosquitto (corta las conexiones un instante; el backend y los equipos reconectan solos) y repetir --roles."
    echo "ROLES APLICADOS, PERO EL BROKER NO CARGÓ SU CONFIGURACIÓN"; exit 2
  fi
  echo "OK    el broker arrancó después de la última modificación de mosquitto.conf (por fecha) y el registro anota a admin-guiones por su usuario (en vivo)"
  echo "ROLES APLICADOS"
  exit 0
fi

if [ "${1:-}" = --rehacer ]; then
  echo "Esto borra el archivo del plugin: todos los clientes del broker (backend, sonda y CADA dispositivo) pierden su credencial."
  read -r -p "Escribe «si» para continuar: " ok; [ "$ok" = si ] || { echo "cancelado"; exit 1; }
  docker compose stop mosquitto >/dev/null 2>&1
  en_volumen 'rm -f /c/dynamic-security.json' </dev/null
fi

# 1. El archivo del plugin, creado sin broker. La clave entra por la entrada estándar: no pasa por argumentos del equipo.
if en_volumen 'test -f /c/dynamic-security.json' </dev/null; then
  echo "OK    el archivo del plugin ya existe en el volumen $VOL (no se toca)"
else
  printf '%s\n' "$DYN_ADMIN" | en_volumen 'IFS= read -r A && mosquitto_ctrl dynsec init /c/dynamic-security.json backend-admin "$A" >/dev/null && chown 1883:1883 /c/dynamic-security.json && chmod 600 /c/dynamic-security.json' \
    || { echo "FALLA no se pudo crear el archivo del plugin"; exit 1; }
  echo "OK    archivo del plugin creado con el administrador backend-admin (dueño 1883, modo 600)"
fi

# 2. Solo el broker (el backend espera a que esté sano, y no lo estará hasta que exista la sonda).
docker compose up -d mosquitto >/dev/null || exit 1
# ¿Rotación de la clave del administrador? Si hay una anterior en el .env y la nueva no entra, o algún administrador todavía acepta
# la anterior, se rotan los dos usuarios de administración en un solo bloque (rotar_admin, lib-dynsec.sh).
listo=0; esperar_plugin 5 || listo=1   # el broker recién levantado tarda un segundo o dos
if [ -n "$ANTERIOR" ] && [ "$ANTERIOR" != "$DYN_ADMIN" ] && { [ $listo = 1 ] || ! admins_al_dia "$ANTERIOR" >/dev/null; }; then
  NUEVA="$DYN_ADMIN"; DYN_ADMIN="$ANTERIOR"; rc=0
  rotar_admin "$NUEVA" || rc=$?
  DYN_ADMIN="$NUEVA"; unset DYN_USUARIO; unset NUEVA
  if [ $rc = 0 ]; then echo "      borra MQTT_ADMIN_CLAVE_ANTERIOR del .env"
  elif [ $rc = 1 ]; then echo "FALLA la rotación no se pudo comprobar en los dos administradores: repite este guion (es seguro) antes de borrar la anterior"; exit 1
  else echo "AVISO MQTT_ADMIN_CLAVE_ANTERIOR no entra con ningún administrador: no se rotó nada (¿está bien escrita?); sigue con la clave vigente"; fi
fi
if ! esperar_plugin 2; then
  # El broker que corre no conoce al administrador: lo más probable es que arrancó con la configuración vieja (passwd/acl, antes
  # del 12/10) y no ha leído la nueva. Recrearlo corta las conexiones un instante (el backend y los dispositivos reconectan solos).
  echo "──    el broker que corre no acepta a backend-admin: se recrea para que lea la configuración actual"
  docker compose up -d --force-recreate mosquitto >/dev/null || exit 1
  if ! esperar_plugin 20; then
    echo "FALLA el broker no acepta a backend-admin con MQTT_ADMIN_CLAVE del .env."
    echo "      Si el archivo del plugin se creó con OTRA clave: pon la vigente en MQTT_ADMIN_CLAVE_ANTERIOR y la nueva en MQTT_ADMIN_CLAVE"
    echo "      y repite; si se perdió, --rehacer (crea el archivo de nuevo: todos los clientes del broker pierden su credencial)."
    docker compose logs --no-color --since 2m mosquitto | tail -5; exit 1
  fi
fi
roles_del_sistema || exit 1
admin_de_guiones || exit 1
cliente_del_sistema backend recepcion "$BACKEND" || exit 1
cliente_del_sistema "$SONDA_U" sonda "$SONDA" || exit 1

# 3. Verificación del resultado, no del comando: nombres (nunca hashes), chequeo de salud en verde, pila completa arriba.
clientes=$(ctrl listClients | tr '\n' ' '); roles=$(ctrl listRoles | tr '\n' ' ')
echo "── clientes del plugin: $clientes"; echo "── roles: $roles"
fallos=0
for e in backend-admin admin-guiones backend "$SONDA_U"; do grep -qw "$e" <<<"$clientes" || { echo "FALLA falta el cliente $e"; fallos=$((fallos+1)); }; done
for e in admin recepcion sonda dispositivo; do grep -qw "$e" <<<"$roles" || { echo "FALLA falta el rol $e"; fallos=$((fallos+1)); }; done
admins_al_dia "$ANTERIOR" && echo "OK    backend-admin y admin-guiones aceptan la clave vigente del administrador${ANTERIOR:+ y ninguno la anterior}" || fallos=$((fallos+1))
docker compose up -d >/dev/null 2>&1   # el backend toma MQTT_ADMIN_CLAVE y HTTP_CLAVE_ADMIN del .env (si cambió el código: up -d --build)
for _ in $(seq 1 20); do [[ "$(docker compose ps mosquitto --format '{{.Status}}')" == *"(healthy)"* ]] && break; sleep 3; done
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
[[ "$(docker compose ps mosquitto --format '{{.Status}}')" == *"(healthy)"* ]] && echo "OK    broker sano: la sonda del chequeo de salud entra con el plugin" || { echo "FALLA el broker no llegó a healthy"; fallos=$((fallos+1)); }
sleep 3; docker compose logs --no-color --since 1m backend 2>/dev/null | grep -oE "administración del broker lista \([a-z-]+\)|suscrito a sitio/#|MQTT_ADMIN_CLAVE ausente[^\"]*" | sort -u | sed 's/^/── backend: /'
[ -e mosquitto/config/passwd ] && echo "AVISO mosquitto/config/passwd ya no se usa (el broker no lo lee): bórralo cuando quieras; el archivo acl salió del repositorio"
r_cc=0; config_cargada mosquitto/config/mosquitto.conf --registro || r_cc=$?
if [ $r_cc = 0 ]; then echo "OK    el broker cargó mosquitto.conf (por fecha y en vivo: el registro anota a admin-guiones por su usuario)"
elif [ $r_cc = 3 ]; then echo "FALLA no hay broker corriendo: no se pudo comprobar que cargó mosquitto.conf"; fallos=$((fallos+1))
else echo "FALLA el broker que corre no cargó la versión actual de mosquitto/config/mosquitto.conf (motivo en la línea «──» de arriba) → docker compose restart mosquitto y repetir"; fallos=$((fallos+1)); fi
[ $fallos -eq 0 ] && echo "BROKER INICIALIZADO" || { echo "$fallos falla(s)"; exit 1; }
