#!/usr/bin/env bash
# Publica una trama como un dispositivo (guion de docs/15 y pruebas a mano), con QoS 1 como exige el diseño.
#   bash plataforma/pruebas/publicar.sh temperatura 35
#   bash plataforma/pruebas/publicar.sh temperatura '[{"bn":"dev-0001","n":"temperatura","u":"Cel","v":22.4}]'
# Dispositivo: DISPOSITIVO (por defecto dev-0001) · sitio: SITIO (por defecto uct).
# Clave: CLAVE_DEV si está exportada en esta terminal; si no, se pide sin mostrarla.
set -u
cd "$(dirname "$0")/.."
DISP="${DISPOSITIVO:-dev-0001}"; SITIO="${SITIO:-uct}"
MAG="${1:?falta la magnitud (p. ej. temperatura)}"; CARGA="${2:?falta la carga (p. ej. 35)}"
CLAVE="${CLAVE_DEV:-}"
[ -n "$CLAVE" ] || { read -rs -p "Clave de $DISP (no se verá): " CLAVE; echo; }
T="sitio/$SITIO/dispositivo/$DISP/$MAG"
if out=$(docker compose exec -T mosquitto mosquitto_pub -q 1 -u "$DISP" -P "$CLAVE" -t "$T" -m "$CARGA" 2>&1); then
  echo "publicado en $T: $CARGA"
else
  echo "FALLA al publicar en $T: ${out:-sin detalle}"; exit 1
fi
