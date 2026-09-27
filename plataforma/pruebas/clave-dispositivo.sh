#!/usr/bin/env bash
# Crea, rota o elimina la clave MQTT de un DISPOSITIVO en mosquitto/config/passwd (docs/11 §7), sin
# que la clave pase por argumentos, historial ni pantalla. La clave la genera el gestor de contraseñas
# u `openssl rand -base64 24`, y se pega en un aviso oculto.
#   bash plataforma/pruebas/clave-dispositivo.sh dev-0001            crear o rotar (pide la clave)
#   bash plataforma/pruebas/clave-dispositivo.sh --borrar dev-prueba eliminar (antes de conectar equipos reales)
# Reinicia el broker para que relea el archivo (unos segundos; el backend se reconecta solo).
#
# Por qué un contenedor auxiliar: el broker monta su configuración en solo lectura (docs/11 §3).
# Por qué --entrypoint: el arranque de la imagen, cuando corre como root, hace `chown -R` sobre
# /mosquitto; montada ahí, cambia el dueño de acl y mosquitto.conf en el portátil (ocurrió el 27/09).
# Aquí la carpeta se monta en /c y se entra directo a la herramienta: nada más cambia de dueño.
set -u
cd "$(dirname "$0")/.."
IMG=eclipse-mosquitto:2.0.22
CONF="$PWD/mosquitto/config"
herr() { local e="$1"; shift; docker run --rm -i -v "$CONF:/c" --entrypoint "$e" "$IMG" "$@"; }

borrar=0; [ "${1:-}" = "--borrar" ] && { borrar=1; shift; }
ID="${1:-}"
[[ "$ID" =~ ^[a-z0-9][a-z0-9-]{2,62}$ ]] || { sed -n '5,6p' "$0" | sed 's/^# *//'; exit 1; }
case "$ID" in sonda|backend) echo "«$ID» no es un dispositivo: su clave vive también en .env (docs/11 §7, paso 2)"; exit 1 ;; esac

if [ $borrar = 1 ]; then
  herr mosquitto_passwd -D /c/passwd "$ID" 2>&1 | grep -v '^Warning' || true
else
  read -rs -p "Clave para $ID (pégala desde el gestor; no se verá): " CLAVE; echo
  [ ${#CLAVE} -ge 24 ] || { echo "FALLA: la clave tiene ${#CLAVE} caracteres; se exigen 24 o más (openssl rand -base64 24 da 32)"; exit 1; }
  printf '%s\n%s\n' "$CLAVE" "$CLAVE" | herr mosquitto_passwd /c/passwd "$ID" >/dev/null 2>&1 \
    || { echo "FALLA: mosquitto_passwd no pudo escribir el archivo"; exit 1; }
fi
# Dueño y modo que el broker exige: uid 1883 (con root no arranca) y 0640 (docs/11 §7).
herr sh -c 'chown 1883:1883 /c/passwd && chmod 0640 /c/passwd' </dev/null

docker compose restart mosquitto >/dev/null 2>&1
for _ in $(seq 1 20); do
  [[ "$(docker compose ps mosquitto --format '{{.Status}}')" == *"(healthy)"* ]] && break; sleep 2
done

# Verificación del resultado, no del comando.
usuarios=$(herr cut -d: -f1 /c/passwd </dev/null)          # solo nombres, nunca hashes
if [ $borrar = 1 ]; then
  grep -qx "$ID" <<<"$usuarios" && { echo "FALLA: $ID sigue en el archivo"; exit 1; }
  echo "OK    $ID eliminado; el broker ya no lo acepta"
else
  r=$(docker compose exec -T mosquitto mosquitto_sub -u "$ID" -P "$CLAVE" -t "sitio/verificacion/dispositivo/$ID/x" -C 1 -W 2 2>&1)
  grep -q "not authorised" <<<"$r" && { echo "FALLA: el broker rechaza la clave nueva de $ID"; exit 1; }
  echo "OK    el broker acepta la clave nueva de $ID (guárdala en el gestor si aún no lo hiciste)"
fi
