#!/usr/bin/env bash
# Laboratorio DESECHABLE, segunda parte, del plugin Dynamic Security (docs/16 §20): seis comportamientos que no están en la
# documentación y que condicionan el banco de pruebas y los guiones del operador. Un solo contenedor efímero de la imagen fijada en
# docker-compose.yml, sin red ni volúmenes; identidades y claves de descarte generadas dentro; nada se imprime. Desde cualquier carpeta:
#   bash plataforma/pruebas/lab-dynsec-anonimos.sh
# Qué mide (y lo esperado):
#   1. archivo del plugin con dueño root → el plugin arranca vacío y rechaza hasta al administrador («Not authorized»);
#   2. con el dueño correcto, y el acceso por defecto de publicación abierto, un cliente ANÓNIMO publica (PUBACK RC:16);
#   3. un cliente que manda usuario SIN clave se rechaza aunque los anónimos estén permitidos (por eso el emulador no manda usuario);
#   4. el rol recepcion (suscribe + recibe sitio/#) recibe lo que publican los anónimos;
#   5. setDefaultACLAccess se escribe allow|deny: con true|false el cliente responde «access must be "allow" or "deny"»;
#   6. mosquitto_ctrl no admite un archivo de opciones (la clave va por -P dentro del contenedor; los guiones la pasan por stdin).
set -u
cd "$(dirname "$0")/.." || exit 1                       # plataforma/
IMG="${IMG:-$(grep -oE 'eclipse-mosquitto:[^ ]+@sha256:[0-9a-f]{64}' docker-compose.yml | head -1)}"
[ -n "$IMG" ] || { echo "FALLA no encontré la imagen fijada del broker en docker-compose.yml"; exit 1; }
echo "imagen: ${IMG%%@*} · versión del broker: $(docker run --rm --entrypoint mosquitto "$IMG" -h 2>&1 | head -1)"
T=$(mktemp -d); chmod 755 "$T"; trap 'rm -rf "$T"' EXIT
cat > "$T/lab.sh" <<'LAB'
A=$(head -c 18 /dev/urandom | base64)
mosquitto_ctrl dynsec init /tmp/d.json descarte "$A" >/dev/null 2>&1
printf 'listener 1883\nallow_anonymous true\nplugin /usr/lib/mosquitto_dynamic_security.so\nplugin_opt_config_file /tmp/d.json\nlog_dest stdout\nlog_type all\n' > /tmp/m.conf
ctrl() { mosquitto_ctrl -u descarte -P "$A" dynsec "$@" 2>&1 | grep -v "^Warning\|^This means\|^$"; }
pub() { mosquitto_pub -V mqttv5 -d -q 1 -t sitio/lab/dispositivo/emu-0001/temperatura -m 1 "$@" 2>&1 | grep -oE "PUBACK \(Mid: [0-9]+, RC:[0-9]+\)|Connection error: .*|not authori.ed" | head -1; }
# 1. dueño root (como lo deja `dynsec init` corriendo como root): el broker suelta privilegios y no puede leerlo
mosquitto -c /tmp/m.conf > /tmp/log1 2>&1 & P=$!; sleep 1
echo "1. archivo del plugin con dueño root, el administrador conecta (esperado: Connection error: Not authorized): $(ctrl listClients | tail -1)"
kill $P; wait $P 2>/dev/null
chown mosquitto /tmp/d.json
mosquitto -c /tmp/m.conf > /tmp/log 2>&1 & sleep 1
echo "   con dueño mosquitto, el administrador conecta (esperado: lista con «descarte»): $(ctrl listClients | tr '\n' ' ')"
# 5. sintaxis del acceso por defecto
echo "5. setDefaultACLAccess publishClientSend true (esperado: error de sintaxis): $(ctrl setDefaultACLAccess publishClientSend true | head -1)"
echo "   setDefaultACLAccess publishClientSend allow (esperado: sin salida = aceptado): [$(ctrl setDefaultACLAccess publishClientSend allow)]"
# 2 y 3. anónimo frente a usuario sin clave
echo "2. anónimo (solo -i) publica con el acceso por defecto abierto (esperado RC:16): $(pub -i emu-0001)"
echo "3. usuario sin clave (-u sin -P), anónimos permitidos (esperado: Connection error: Not authorized): $(pub -i emu-0001 -u emu-0001)"
echo "   usuario con clave inventada (esperado: Connection error: Not authorized): $(pub -i emu-0001 -u emu-0001 -P x)"
# 4. el rol recepcion recibe lo anónimo
ctrl createRole recepcion >/dev/null; ctrl addRoleACL recepcion subscribePattern 'sitio/#' allow 1 >/dev/null; ctrl addRoleACL recepcion publishClientReceive 'sitio/#' allow 1 >/dev/null
B=$(head -c 18 /dev/urandom | base64); ctrl createClient backend -p "$B" >/dev/null; ctrl addClientRole backend recepcion >/dev/null
mosquitto_sub -u backend -P "$B" -t 'sitio/#' -C 1 -W 4 > /tmp/sub 2>&1 &
sleep 0.5; mosquitto_pub -i emu-0002 -q 1 -t sitio/lab/dispositivo/emu-0002/temperatura -m hola; sleep 1
echo "4. el rol recepcion recibe lo que publica un anónimo (esperado: hola): $(cat /tmp/sub)"
# 6. mosquitto_ctrl y archivo de opciones
echo "6. mosquitto_ctrl menciona un archivo de opciones en su ayuda (esperado 0): $(mosquitto_ctrl --help 2>&1 | grep -ci 'options-file\|options file')"
echo "   errores en el registro del broker con el dueño correcto (esperado 0): $(grep -ci error /tmp/log)"
LAB
docker run --rm -v "$T:/s:ro" --entrypoint sh "$IMG" /s/lab.sh
echo; echo "Pega esta salida (no contiene secretos) en docs/16 §20 si cambia algo respecto de lo registrado el 12/10/2026."
