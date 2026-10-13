#!/usr/bin/env bash
# Laboratorio DESECHABLE del plugin Dynamic Security de Mosquitto (docs/10 §8.4 punto 26; condición de la decisión del 08/10):
# ¿puede el backend crear, limitar, deshabilitar, rotar y borrar credenciales de dispositivos SIN reiniciar el broker, cómo
# se escribe la ACL que limita a cada dispositivo a su tópico, y qué pasa cuando el plugin convive con password_file y acl_file?
# Fases: A) solo el plugin, con TRES formas de ACL en roles distintos (tópico literal · patrón %u · patrón %c) y el ciclo de vida ·
# B) plugin + password_file (sin acl_file) · C) plugin + password_file + acl_file.
# Identidades de descarte; los secretos se generan aquí, se usan en esta misma invocación y nunca se imprimen; el contenedor y la
# carpeta temporal se borran al salir. Lo ejecuta la persona a cargo del broker (regla del 27/09: los secretos no salen de aquí).
# Límite conocido: aquí las claves de descarte pasan como argumentos de `docker exec` (visibles en `ps` mientras corre); los
# guiones de operación las pasan por la entrada estándar (lib-dynsec.sh). La segunda parte del laboratorio: lab-dynsec-anonimos.sh.
# Uso, desde cualquier carpeta:   bash plataforma/pruebas/lab-dynsec.sh
#   contra otra versión del broker: IMG=eclipse-mosquitto:2.1.2-alpine@sha256:<digest> bash plataforma/pruebas/lab-dynsec.sh
# Corridas anteriores (12/10/2026): con un rol cuya ACL usaba el patrón %u, el cliente del plugin autenticaba pero no podía
# publicar ni en su propio tópico, con o sin acl_file; el usuario de password_file solo publicaba cuando había acl_file (fase C) y
# con el plugin solo (fase B) le negaba todo. Esta versión separa el patrón del tópico literal para saber qué sostiene el broker.
set -u
cd "$(dirname "$0")/.." || exit 1                       # plataforma/
# Por defecto, la misma imagen fijada del compose; con IMG=… se prueba otra (por ejemplo, la 2.1.2-alpine por digest).
IMG="${IMG:-$(grep -oE 'eclipse-mosquitto:[^ ]+@sha256:[0-9a-f]{64}' docker-compose.yml | head -1)}"
[ -n "$IMG" ] || { echo "FALLA no encontré la imagen fijada del broker en docker-compose.yml"; exit 1; }
echo "imagen: ${IMG%%@*} · versión del broker: $(docker run --rm --entrypoint mosquitto "$IMG" -h 2>&1 | head -1)"
T=$(mktemp -d); chmod 755 "$T"
trap 'docker rm -f lab-dynsec >/dev/null 2>&1; rm -rf "$T"' EXIT
A=$(openssl rand -base64 18); D=$(openssl rand -base64 18); V=$(openssl rand -base64 18)
printf 'user viejo\ntopic readwrite sitio/lab/dispositivo/viejo/+\n' > "$T/acl"
# passwd y el JSON inicial se crean DENTRO de la imagen (trae mosquitto_passwd y mosquitto_ctrl). El broker corre como uid 1883:
# dueño y modo 640 en passwd y acl, y el JSON escribible por él. Montaje en /c, ruta neutra, con --entrypoint (lección del 27/09).
docker run --rm -v "$T:/c" --entrypoint sh "$IMG" -c "mosquitto_passwd -b -c /c/passwd viejo '$V' && mosquitto_ctrl dynsec init /c/dynamic-security.json admin '$A' && chown 1883:1883 /c/passwd /c/acl /c/dynamic-security.json && chmod 640 /c/passwd /c/acl && chmod 600 /c/dynamic-security.json" >/dev/null 2>&1 \
  || { echo "FALLA no se pudo preparar passwd + dynamic-security.json"; exit 1; }
ctrl() { docker exec lab-dynsec mosquitto_ctrl -u admin -P "$A" dynsec "$@" 2>&1 | grep -v "^Warning: You are running mosquitto_ctrl without encryption\|^This means all of the configuration\|^$"; }
# Resultado de un intento de publicar, en una palabra: la línea PUBACK si la hubo (RC:0 = aceptada, RC:16 = aceptada sin
# suscriptores, RC:135 = no autorizada), «CONEXIÓN RECHAZADA» si no pudo conectar, o el último error del cliente.
# $4 (opcional) = identificador de cliente (-i), para la ACL con %c.
pub() {
  local salida; salida=$(docker exec lab-dynsec mosquitto_pub -V mqttv5 -u "$1" -P "$2" -t "$3" ${4:+-i "$4"} -m 1 -q 1 -d 2>&1)
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
# Un cliente de descarte con un rol cuya ACL tiene la forma $1 ($2 = nombre del rol); publica en su tópico y en uno ajeno.
probar_acl() {
  ctrl createRole "$2"; ctrl addRoleACL "$2" publishClientSend "$1" allow 1
  ctrl createClient dev-prueba -p "$D"; ctrl addClientRole dev-prueba "$2"
  echo "── ACL [$1] · propio (esperado RC:0 o RC:16):   $(pub dev-prueba "$D" sitio/lab/dispositivo/dev-prueba/temperatura dev-prueba)"
  echo "── ACL [$1] · ajeno  (esperado RC:135):         $(pub dev-prueba "$D" sitio/lab/dispositivo/otro/temperatura dev-prueba)"
  ctrl deleteClient dev-prueba >/dev/null; ctrl deleteRole "$2" >/dev/null
}

arrancar "A · solo el plugin" ""
probar_acl 'sitio/lab/dispositivo/dev-prueba/+' rol-literal
probar_acl 'sitio/lab/dispositivo/%u/+' rol-patron-u
probar_acl 'sitio/lab/dispositivo/%c/+' rol-patron-c
echo "── ciclo de vida con la ACL literal:"
ctrl createRole rol-dispositivo; ctrl addRoleACL rol-dispositivo publishClientSend 'sitio/lab/dispositivo/dev-prueba/+' allow 1
ctrl createClient dev-prueba -p "$D"; ctrl addClientRole dev-prueba rol-dispositivo
echo "── usuario desconocido (esperado: CONEXIÓN RECHAZADA):               $(pub nadie x sitio/lab/dispositivo/nadie/temperatura)"
echo "── admin deshabilita a dev-prueba"; ctrl disableClient dev-prueba
echo "── deshabilitado conecta (esperado: CONEXIÓN RECHAZADA):             $(pub dev-prueba "$D" sitio/lab/dispositivo/dev-prueba/temperatura)"
ctrl enableClient dev-prueba >/dev/null
echo "── rehabilitado (esperado RC:0 o RC:16):                              $(pub dev-prueba "$D" sitio/lab/dispositivo/dev-prueba/temperatura)"
N=$(openssl rand -base64 18); echo "── admin rota la clave"; ctrl setClientPassword dev-prueba "$N"
echo "── con la clave vieja (esperado: CONEXIÓN RECHAZADA):                $(pub dev-prueba "$D" sitio/lab/dispositivo/dev-prueba/temperatura)"
echo "── con la nueva (esperado RC:0 o RC:16):                              $(pub dev-prueba "$N" sitio/lab/dispositivo/dev-prueba/temperatura)"
echo "── admin borra al cliente"; ctrl deleteClient dev-prueba
echo "── borrado conecta (esperado: CONEXIÓN RECHAZADA):                   $(pub dev-prueba "$N" sitio/lab/dispositivo/dev-prueba/temperatura)"
ctrl deleteRole rol-dispositivo >/dev/null
echo "── persistencia en el JSON: clientes $(docker exec lab-dynsec sh -c 'grep -o "\"username\"" /c/dynamic-security.json | wc -l') (esperado 1: admin), roles $(docker exec lab-dynsec sh -c 'grep -o "\"rolename\"" /c/dynamic-security.json | wc -l') (esperado 1: admin)"
echo "── el broker nunca se reinició: $(docker inspect -f '{{.RestartCount}} reinicios' lab-dynsec)"
echo "── intentos fallidos que quedan en el log del broker: $(docker logs lab-dynsec 2>&1 | grep -ciE 'not authori|bad user|denied')"

arrancar "B · plugin + password_file (sin acl_file)" "password_file /c/passwd"
probar_acl 'sitio/lab/dispositivo/dev-prueba/+' rol-literal
echo "── «viejo» (password_file) en su tópico (¿lo deja el plugin?):      $(pub viejo "$V" sitio/lab/dispositivo/viejo/temperatura)"
echo "── «viejo» en tópico ajeno (sin acl_file: ¿quién lo frena?):        $(pub viejo "$V" sitio/lab/dispositivo/otro/temperatura)"

arrancar "C · plugin + password_file + acl_file" "password_file /c/passwd
acl_file /c/acl"
probar_acl 'sitio/lab/dispositivo/dev-prueba/+' rol-literal
echo "── «viejo» en su tópico (esperado RC:0 o RC:16):                      $(pub viejo "$V" sitio/lab/dispositivo/viejo/temperatura)"
echo "── «viejo» en tópico ajeno (esperado RC:135):                         $(pub viejo "$V" sitio/lab/dispositivo/otro/temperatura)"
echo; echo "Pega esta salida completa (no contiene secretos) en el chat para registrarla en docs/16 §18."
