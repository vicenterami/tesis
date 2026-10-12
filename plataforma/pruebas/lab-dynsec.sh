#!/usr/bin/env bash
# Laboratorio DESECHABLE del plugin Dynamic Security de Mosquitto (docs/10 §8.4 punto 26; condición de la decisión del 08/10):
# ¿puede el backend crear, limitar, deshabilitar, rotar y borrar credenciales de dispositivos SIN reiniciar el broker, y
# conviven con password_file + acl_file (lo que la documentación oficial no declara)?
# Identidades de descarte; los secretos se generan aquí, se usan en esta misma invocación y nunca se imprimen; el contenedor
# y la carpeta temporal se borran al salir. Lo ejecuta la persona (regla del 27/09: ninguna clave del broker la escribe el
# asistente, ni de descarte). Uso, desde cualquier carpeta:
#   bash plataforma/pruebas/lab-dynsec.sh
# Salida esperada (12/10/2026, por verificar con la primera corrida): cada línea «──» con lo que dice su comentario.
set -u
cd "$(dirname "$0")/.." || exit 1                       # plataforma/
IMG=$(grep -oE 'eclipse-mosquitto:[^ ]+@sha256:[0-9a-f]{64}' docker-compose.yml | head -1)   # la misma imagen fijada del compose
[ -n "$IMG" ] || { echo "FALLA no encontré la imagen fijada del broker en docker-compose.yml"; exit 1; }
T=$(mktemp -d); chmod 755 "$T"
trap 'docker rm -f lab-dynsec >/dev/null 2>&1; rm -rf "$T"' EXIT
A=$(openssl rand -base64 18); D=$(openssl rand -base64 18); V=$(openssl rand -base64 18)
cat > "$T/mosquitto.conf" <<CONF
listener 1883
allow_anonymous false
plugin /usr/lib/mosquitto_dynamic_security.so
plugin_opt_config_file /c/dynamic-security.json
password_file /c/passwd
acl_file /c/acl
log_dest stdout
log_type all
CONF
printf 'user viejo\ntopic readwrite sitio/lab/dispositivo/viejo/+\n' > "$T/acl"
# passwd y el JSON inicial se crean DENTRO de la imagen (trae mosquitto_passwd y mosquitto_ctrl); el broker corre como uid 1883
# y debe poder reescribir el JSON en cada cambio. Montaje en /c, ruta neutra, con --entrypoint (lección del 27/09).
docker run --rm -v "$T:/c" --entrypoint sh "$IMG" -c "mosquitto_passwd -b -c /c/passwd viejo '$V' && mosquitto_ctrl dynsec init /c/dynamic-security.json admin '$A' && chown 1883:1883 /c/dynamic-security.json && chmod 644 /c/passwd /c/acl" >/dev/null 2>&1 \
  || { echo "FALLA no se pudo preparar passwd + dynamic-security.json"; exit 1; }
docker run -d --name lab-dynsec -v "$T:/c" --entrypoint mosquitto "$IMG" -c /c/mosquitto.conf >/dev/null || exit 1
sleep 2
echo "── avisos del broker al arrancar (vacío = ninguno):"; docker logs lab-dynsec 2>&1 | grep -iE "error|warning" | head -3
ctrl() { docker exec lab-dynsec mosquitto_ctrl -u admin -P "$A" dynsec "$@" 2>&1; }
pub() { docker exec lab-dynsec mosquitto_pub -V mqttv5 -u "$1" -P "$2" -t "$3" -m 1 -q 1 -d 2>&1 | grep -oE "PUBACK \(Mid: [0-9]+, RC:[0-9]+\)|Connection error: .*|Not authorized|Error: .*" | head -1; }
echo "── admin crea rol + ACL de publicación al tópico propio (%u = usuario) + cliente de descarte"
ctrl createRole rol-dispositivo; ctrl addRoleACL rol-dispositivo publishClientSend 'sitio/lab/dispositivo/%u/+' allow 1
ctrl createClient dev-prueba -p "$D"; ctrl addClientRole dev-prueba rol-dispositivo
echo "── dev-prueba publica en SU tópico (esperado RC:0):                 $(pub dev-prueba "$D" sitio/lab/dispositivo/dev-prueba/temperatura)"
echo "── dev-prueba publica en tópico AJENO (esperado RC:135, no autorizado): $(pub dev-prueba "$D" sitio/lab/dispositivo/otro/temperatura)"
echo "── usuario desconocido (esperado: conexión rechazada):             $(pub nadie x sitio/lab/dispositivo/nadie/temperatura)"
echo "── «viejo» por password_file + acl_file (¿convive? esperado RC:0): $(pub viejo "$V" sitio/lab/dispositivo/viejo/temperatura)"
echo "── «viejo» en tópico ajeno (acl_file; esperado RC:135):            $(pub viejo "$V" sitio/lab/dispositivo/otro/temperatura)"
echo "── admin deshabilita a dev-prueba"; ctrl disableClient dev-prueba
echo "── dev-prueba deshabilitado conecta (esperado: rechazada):         $(pub dev-prueba "$D" sitio/lab/dispositivo/dev-prueba/temperatura)"
ctrl enableClient dev-prueba >/dev/null
echo "── rehabilitado (esperado RC:0):                                    $(pub dev-prueba "$D" sitio/lab/dispositivo/dev-prueba/temperatura)"
N=$(openssl rand -base64 18); echo "── admin rota la clave"; ctrl setClientPassword dev-prueba "$N"
echo "── con la clave vieja (esperado: rechazada):                       $(pub dev-prueba "$D" sitio/lab/dispositivo/dev-prueba/temperatura)"
echo "── con la nueva (esperado RC:0):                                    $(pub dev-prueba "$N" sitio/lab/dispositivo/dev-prueba/temperatura)"
echo "── admin borra al cliente"; ctrl deleteClient dev-prueba
echo "── borrado conecta (esperado: rechazada):                          $(pub dev-prueba "$N" sitio/lab/dispositivo/dev-prueba/temperatura)"
echo "── persistencia en el JSON: clientes $(docker exec lab-dynsec sh -c 'grep -o "\"username\"" /c/dynamic-security.json | wc -l') (esperado 1: admin), roles $(docker exec lab-dynsec sh -c 'grep -o "\"rolename\"" /c/dynamic-security.json | wc -l')"
echo "── el broker nunca se reinició: $(docker inspect -f '{{.RestartCount}} reinicios, arrancó {{.State.StartedAt}}' lab-dynsec)"
echo "── intentos fallidos que quedan en el log del broker: $(docker logs lab-dynsec 2>&1 | grep -ciE 'not authori|bad user|denied')"
echo; echo "Pega esta salida completa (no contiene secretos) en el chat para registrarla en docs/16."
