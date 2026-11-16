#!/usr/bin/env bash
# Respaldo de la plataforma (docs/10 §9.5; docs/14 §7; TT-46): el volcado de la base, su huella y las credenciales del broker.
#   bash plataforma/pruebas/respaldar.sh [carpeta]      carpeta por omisión: ~/respaldos (queda con permisos 700)
# Deja tres archivos con la misma marca de tiempo (UTC, al segundo), con permisos 600:
#   plataforma-<marca>.huella          filas y suma de comprobación de cada tabla, tomadas EN LA MISMA INSTANTÁNEA que el volcado
#   dynamic-security-<marca>.json      usuarios, roles y permisos del broker (sin él, ningún dispositivo vuelve a autenticarse)
#   plataforma-<marca>.dump            volcado completo en formato propio de pg_dump (-Fc): esquema, datos y catálogo de TimescaleDB
# El volcado es el último en recibir su nombre definitivo: si existe, el respaldo está completo.
# El volcado y la huella salen de una sola transacción de solo lectura: lo que entre mientras se respalda queda fuera de los dos, y
# por eso restaurar el volcado debe dar exactamente esa huella (lo comprueba pruebas/simulacro-restauracion.sh).
# Solo lee la base. Un respaldo a la vez por carpeta. Borra los de más de RESPALDO_RETENCION_DIAS (30), y solo después de haber
# terminado bien el de hoy. Contiene resúmenes de claves y datos sin publicar: la carpeta no va a ningún repositorio y la copia fuera
# del servidor viaja por la red privada (docs/10 §9.5).
# Salida: 0 y una línea «respaldo OK …»; distinto de 0 si algo falló (no deja archivos a medias con nombre definitivo).
set -euo pipefail
cd "$(dirname "$0")/.."                       # plataforma/: aquí están el compose y su configuración
DESTINO="${1:-$HOME/respaldos}"
RETENCION="${RESPALDO_RETENCION_DIAS:-30}"
[[ "$RETENCION" =~ ^[0-9]+$ ]] || { echo "FALLA RESPALDO_RETENCION_DIAS debe ser un número de días"; exit 2; }
[ -n "$DESTINO" ] && [ "$DESTINO" != "/" ] || { echo "FALLA la carpeta de destino no puede ser vacía ni la raíz"; exit 2; }
mkdir -p "$DESTINO" && chmod 700 "$DESTINO" || { echo "FALLA no pude preparar $DESTINO con permisos 700"; exit 1; }
exec 9> "$DESTINO/.respaldo-en-curso"
flock -n 9 || { echo "FALLA ya hay un respaldo corriendo sobre $DESTINO"; exit 1; }
dc() { docker compose "$@"; }

USUARIO=$(dc exec -T timescaledb printenv POSTGRES_USER) || { echo "FALLA la base no responde (¿la pila está arriba?)"; exit 1; }
BASE=$(dc exec -T timescaledb printenv POSTGRES_DB)
MARCA=$(date -u +%FT%H%M%SZ)
VOLCADO="$DESTINO/plataforma-$MARCA.dump"; HUELLA="$DESTINO/plataforma-$MARCA.huella"; BROKER="$DESTINO/dynamic-security-$MARCA.json"
EN_CONTENEDOR="/tmp/respaldo-$MARCA-$$.dump"
limpiar() { rm -f "$VOLCADO.tmp" "$HUELLA.tmp" "$BROKER.tmp"; dc exec -T timescaledb rm -f "$EN_CONTENEDOR" 2>/dev/null || true; }
trap limpiar EXIT
umask 077

# Una sola sesión: abre la transacción, exporta su instantánea, pg_dump vuelca ESA instantánea y la huella se calcula en ella.
# Si pg_dump falla, borra lo que alcanzó a escribir: un volcado a medias empieza con una cabecera válida y no se distinguiría.
{
  printf 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n'
  printf 'SELECT pg_export_snapshot() AS instantanea \\gset\n'
  printf '\\setenv INSTANTANEA :instantanea\n'
  printf '\\! pg_dump --snapshot="$INSTANTANEA" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f %s || { rm -f %s; echo "FALLA pg_dump no terminó" >&2; }\n' "$EN_CONTENEDOR" "$EN_CONTENEDOR"
  cat db/pruebas/huella-respaldo.sql
  printf 'COMMIT;\n'
} | dc exec -T timescaledb psql -X -q -v ON_ERROR_STOP=1 -U "$USUARIO" -d "$BASE" -f - > "$HUELLA.tmp"

dc exec -T timescaledb test -s "$EN_CONTENEDOR" || { echo "FALLA pg_dump no dejó el volcado: no hay respaldo"; exit 1; }
dc cp "timescaledb:$EN_CONTENEDOR" "$VOLCADO.tmp" >/dev/null && chmod 600 "$VOLCADO.tmp"
[ -s "$VOLCADO.tmp" ] || { echo "FALLA el volcado quedó vacío"; exit 1; }
[ "$(head -c 5 "$VOLCADO.tmp")" = "PGDMP" ] || { echo "FALLA el volcado no tiene la cabecera de pg_dump"; exit 1; }
tablas=$(grep -c '^tabla ' "$HUELLA.tmp" || true)
[ "$tablas" -ge 1 ] && grep -q '^objetos ' "$HUELLA.tmp" || { echo "FALLA la huella quedó incompleta (sin tablas o sin la línea de objetos)"; exit 1; }
dc cp "mosquitto:/mosquitto/data/dynamic-security.json" "$BROKER.tmp" >/dev/null && chmod 600 "$BROKER.tmp"
# El broker reescribe ese archivo cuando cambia un cliente: se exige que lo copiado sea un JSON completo.
python3 -I -c 'import json, sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$BROKER.tmp" 2>/dev/null \
  || { echo "FALLA el archivo de credenciales del broker no es un JSON completo (¿se copió mientras se escribía?): repite el respaldo"; exit 1; }

mv "$HUELLA.tmp" "$HUELLA" && mv "$BROKER.tmp" "$BROKER" && mv "$VOLCADO.tmp" "$VOLCADO"
find "$DESTINO" -maxdepth 1 -type f \( -name 'plataforma-*.dump' -o -name 'plataforma-*.huella' -o -name 'dynamic-security-*.json' \) -mtime +"$RETENCION" -delete
printf '%s respaldo OK %s bytes, %s tablas en la huella: %s\n' "$(date -u +%FT%TZ)" "$(stat -c%s "$VOLCADO")" "$tablas" "$VOLCADO"
