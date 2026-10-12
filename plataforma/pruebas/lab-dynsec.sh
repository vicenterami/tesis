#!/usr/bin/env bash
# Laboratorio DESECHABLE del plugin Dynamic Security de Mosquitto (docs/10 §8.4 punto 26; condición de la decisión del 08/10):
# ¿puede el backend crear, limitar, deshabilitar, rotar y borrar credenciales de dispositivos SIN reiniciar el broker, y qué
# pasa cuando convive con password_file y acl_file? (La documentación oficial solo dice que «los chequeos del plugin corren
# antes que los incorporados»; no dice qué pasa si uno permite y el otro niega: se mide.)
# Tres fases con el mismo guion: A) solo el plugin · B) plugin + password_file (sin acl_file) · C) plugin + password_file + acl_file.
# Identidades de descarte; los secretos se generan aquí, se usan en esta misma invocación y nunca se imprimen; el contenedor
# y la carpeta temporal se borran al salir. Lo ejecuta la persona (regla del 27/09: ninguna clave del broker la escribe el
# asistente, ni de descarte). Uso, desde cualquier carpeta:
#   bash plataforma/pruebas/lab-dynsec.sh
# Primera corrida (12/10/2026, fase C sola): el cliente del plugin autenticaba pero no podía publicar ni en su propio tópico;
# el usuario del password_file sí. Hipótesis: el chequeo del acl_file niega a quien no figura en él, aunque el plugin permita.
set -u
cd "$(dirname "$0")/.." || exit 1                       # plataforma/
IMG=$(grep -oE 'eclipse-mosquitto:[^ ]+@sha256:[0-9a-f]{64}' docker-compose.yml | head -1)   # la misma imagen fijada del compose
[ -n "$IMG" ] || { echo "FALLA no encontré la imagen fijada del broker en docker-compose.yml"; exit 1; }
T=$(mktemp -d); chmod 755 "$T"
trap 'docker rm -f lab-dynsec >/dev/null 2>&1; rm -rf "$T"' EXIT
A=$(openssl rand -base64 18); D=$(openssl rand -base64 18); V=$(openssl rand -base64 18)
printf 'user viejo\ntopic readwrite sitio/lab/dispositivo/viejo/+\n' > "$T/acl"
# passwd y el JSON inicial se crean DENTRO de la imagen (trae mosquitto_passwd y mosquitto_ctrl). El broker corre como uid 1883:
# dueño y modo 640 en passwd y acl (la primera corrida avisó «world readable» y «owner is not mosquitto»; versiones futuras lo
# rechazan) y el JSON escribible por él. Montaje en /c, ruta neutra, con --entrypoint (lección del 27/09).
docker run --rm -v "$T:/c" --entrypoint sh "$IMG" -c "mosquitto_passwd -b -c /c/passwd viejo '$V' && mosquitto_ctrl dynsec init /c/dynamic-security.json admin '$A' && chown 1883:1883 /c/passwd /c/acl /c/dynamic-security.json && chmod 640 /c/passwd /c/acl && chmod 600 /c/dynamic-security.json" >/dev/null 2>&1 \
  || { echo "FALLA no se pudo preparar passwd + dynamic-security.json"; exit 1; }
cp "$T/dynamic-security.json" "$T/dynamic-security.inicial.json" 2>/dev/null || sudo -n true 2>/dev/null
ctrl() { docker exec lab-dynsec mosquitto_ctrl -u admin -P "$A" dynsec "$@" 2>&1 | grep -v "^Warning: You are running mosquitto_ctrl without encryption\|^This means all of the configuration\|^$"; }
# Resultado de un intento de publicar, en una palabra: la línea PUBACK si la hubo (RC:0 = aceptada, RC:16 = aceptada sin
# suscriptores, RC:135 = no autorizada), «CONEXIÓN RECHAZADA» si no pudo conectar, o el último error del cliente.
pub() {
  local salida; salida=$(docker exec lab-dynsec mosquitto_pub -V mqttv5 -u "$1" -P "$2" -t "$3" -m 1 -q 1 -d 2>&1)
  if grep -q "PUBACK" <<<"$salida"; then grep -oE "PUBACK \(Mid: [0-9]+, RC:[0-9]+\)" <<<"$salida" | head -1
  elif grep -q "Connection error" <<<"$salida"; then echo "CONEXIÓN RECHAZADA ($(grep -oE 'Connection error: .*' <<<"$salida" | head -1))"
  else grep -iE "not authori|error|warning" <<<"$salida" | tail -1; fi
}
arrancar() { # $1 = nombre de la fase · $2 = líneas extra de configuración
  docker rm -f lab-dynsec >/dev/null 2>&1
  cat > "$T/mosquitto.conf" <<CONF
listener 1883
allow_anonymous false
plugin /usr/lib/mosquitto_dynamic_security.so
plugin_opt_config_file /c/dynamic-security.json
$2
log_dest stdout
log_type all
CONF
  docker run -d --name lab-dynsec -v "$T:/c" --entrypoint mosquitto "$IMG" -c /c/mosquitto.conf >/dev/null || exit 1
  sleep 2
  echo; echo "════ FASE $1 ════"
  echo "── avisos del broker al arrancar (esperado: ninguno):"; docker logs lab-dynsec 2>&1 | grep -iE "error|warning" | head -3
}
fase_plugin() { # lo que el backend hará: rol + ACL + cliente, y el ciclo de vida
  ctrl createRole rol-dispositivo; ctrl addRoleACL rol-dispositivo publishClientSend 'sitio/lab/dispositivo/%u/+' allow 1
  ctrl createClient dev-prueba -p "$D"; ctrl addClientRole dev-prueba rol-dispositivo
  echo "── dev-prueba publica en SU tópico (esperado RC:0 o RC:16):          $(pub dev-prueba "$D" sitio/lab/dispositivo/dev-prueba/temperatura)"
  echo "── dev-prueba publica en tópico AJENO (esperado RC:135):             $(pub dev-prueba "$D" sitio/lab/dispositivo/otro/temperatura)"
  echo "── usuario desconocido (esperado: CONEXIÓN RECHAZADA):               $(pub nadie x sitio/lab/dispositivo/nadie/temperatura)"
}
limpiar_plugin() { ctrl deleteClient dev-prueba >/dev/null 2>&1; ctrl deleteRole rol-dispositivo >/dev/null 2>&1; }

arrancar "A · solo el plugin" ""
fase_plugin
echo "── admin deshabilita a dev-prueba"; ctrl disableClient dev-prueba
echo "── deshabilitado conecta (esperado: CONEXIÓN RECHAZADA):             $(pub dev-prueba "$D" sitio/lab/dispositivo/dev-prueba/temperatura)"
ctrl enableClient dev-prueba >/dev/null
echo "── rehabilitado (esperado RC:0 o RC:16):                              $(pub dev-prueba "$D" sitio/lab/dispositivo/dev-prueba/temperatura)"
N=$(openssl rand -base64 18); echo "── admin rota la clave"; ctrl setClientPassword dev-prueba "$N"
echo "── con la clave vieja (esperado: CONEXIÓN RECHAZADA):                $(pub dev-prueba "$D" sitio/lab/dispositivo/dev-prueba/temperatura)"
echo "── con la nueva (esperado RC:0 o RC:16):                              $(pub dev-prueba "$N" sitio/lab/dispositivo/dev-prueba/temperatura)"
echo "── admin borra al cliente"; ctrl deleteClient dev-prueba
echo "── borrado conecta (esperado: CONEXIÓN RECHAZADA):                   $(pub dev-prueba "$N" sitio/lab/dispositivo/dev-prueba/temperatura)"
echo "── persistencia en el JSON: clientes $(docker exec lab-dynsec sh -c 'grep -o "\"username\"" /c/dynamic-security.json | wc -l') (esperado 1: admin), roles $(docker exec lab-dynsec sh -c 'grep -o "\"rolename\"" /c/dynamic-security.json | wc -l') (esperado 2: admin y rol-dispositivo)"
echo "── el broker nunca se reinició: $(docker inspect -f '{{.RestartCount}} reinicios' lab-dynsec)"
echo "── intentos fallidos que quedan en el log del broker: $(docker logs lab-dynsec 2>&1 | grep -ciE 'not authori|bad user|denied')"
limpiar_plugin

arrancar "B · plugin + password_file (sin acl_file)" "password_file /c/passwd"
fase_plugin
echo "── «viejo» (password_file) en su tópico (¿lo deja el plugin?):      $(pub viejo "$V" sitio/lab/dispositivo/viejo/temperatura)"
echo "── «viejo» en tópico ajeno (sin acl_file: ¿quién lo frena?):        $(pub viejo "$V" sitio/lab/dispositivo/otro/temperatura)"
limpiar_plugin

arrancar "C · plugin + password_file + acl_file" "password_file /c/passwd
acl_file /c/acl"
fase_plugin
echo "── «viejo» en su tópico (esperado RC:0 o RC:16):                      $(pub viejo "$V" sitio/lab/dispositivo/viejo/temperatura)"
echo "── «viejo» en tópico ajeno (esperado RC:135):                         $(pub viejo "$V" sitio/lab/dispositivo/otro/temperatura)"
limpiar_plugin
echo; echo "Pega esta salida completa (no contiene secretos) en el chat para registrarla en docs/16 §18."
