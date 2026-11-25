#!/usr/bin/env bash
# Publica una trama como un dispositivo (guion de docs/15 y pruebas a mano), con QoS 1 como exige el diseño.
#   bash plataforma/pruebas/publicar.sh temperatura 35
#   bash plataforma/pruebas/publicar.sh temperatura '[{"bn":"dev-0001","n":"temperatura","u":"Cel","v":22.4}]'
# Dispositivo: DISPOSITIVO (por defecto dev-0001) · sitio: SITIO (por defecto uct).
# Clave: CLAVE_DEV si está exportada en esta terminal; si no, se pide sin mostrarla. Entra al contenedor por la entrada estándar (no
# queda en los argumentos de los procesos del equipo, `ps`; dentro del contenedor mosquitto_pub la recibe por -P, como en los demás guiones).
# OJO (25/11/2026; docs/11 §7): el broker usa el usuario como identificador de cliente, así que este guion se conecta COMO el equipo.
# Si ese equipo está conectado (el nodo real), el broker lo expulsa y la supervisión lo anota como caída; con sesión limpia, además le
# borra su sesión. Úsalo con un equipo que no esté en línea, o asume esa caída (en la demo, docs/15 §2).
set -u
cd "$(dirname "$0")/.."
DISP="${DISPOSITIVO:-dev-0001}"; SITIO="${SITIO:-uct}"
MAG="${1:?falta la magnitud (p. ej. temperatura)}"; CARGA="${2:?falta la carga (p. ej. 35)}"
CLAVE="${CLAVE_DEV:-}"
[ -n "$CLAVE" ] || { read -rs -p "Clave de $DISP (no se verá): " CLAVE; echo; }
T="sitio/$SITIO/dispositivo/$DISP/$MAG"
if out=$(printf '%s\n' "$CLAVE" | docker compose exec -T mosquitto sh -c 'IFS= read -r C; mosquitto_pub -q 1 -u "$1" -P "$C" -t "$2" -m "$3"' sh "$DISP" "$T" "$CARGA" 2>&1); then
  echo "publicado en $T: $CARGA"
else
  echo "FALLA al publicar en $T: ${out:-sin detalle}"; exit 1
fi
