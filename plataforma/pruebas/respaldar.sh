#!/usr/bin/env bash
# Respaldo de la plataforma (docs/10 §9.5; docs/14 §7; TT-46): el volcado de la base, su huella y las credenciales del broker.
#   bash plataforma/pruebas/respaldar.sh [carpeta]      carpeta por omisión: ~/respaldos (700; ver abajo)
# Deja cuatro archivos con la misma marca de tiempo (UTC, al segundo), con permisos 600:
#   plataforma-<marca>.huella          filas y suma de comprobación de cada tabla, tomadas EN LA MISMA INSTANTÁNEA que el volcado
#   dynamic-security-<marca>.json      usuarios, roles y permisos del broker (sin él, ningún dispositivo vuelve a autenticarse)
#   plataforma-<marca>.sha256          suma SHA-256 de los otros tres, en el formato de `sha256sum -c`: delata un archivo truncado o
#                                      alterado sin necesidad de la clave (la usa pruebas/guardia-respaldo.sh)
#   plataforma-<marca>.dump            volcado completo en formato propio de pg_dump (-Fc): esquema, datos y catálogo de TimescaleDB
# El volcado es el último en recibir su nombre definitivo: si existe, el respaldo está completo.
# Cifrado en reposo (docs/10 §9.5): con RESPALDO_DESTINATARIOS=<archivo de destinatarios de age> (solo claves PÚBLICAS, `age1…`, una
# por línea), el volcado y el archivo del broker se cifran EN FLUJO y quedan como .dump.age y .json.age: el volcado en claro no toca
# ningún disco, ni el del servidor ni el del contenedor. La clave privada vive fuera del servidor: quien entre al servidor no puede
# descifrar los respaldos. La huella y las sumas quedan en claro (conteos y sumas, no filas): sin ellas no se podría comprobar un
# respaldo sin la clave. Falla cerrado: si se pidió cifrar (la variable está definida, aunque vacía, o RESPALDO_EXIGIR_CIFRADO=1) y
# falta `age`, el archivo o una clave válida, no se escribe nada. Un archivo de destinatarios con una clave PRIVADA se rechaza, y
# también cualquier línea que no sea un destinatario nativo `age1…` (age acepta claves SSH; aquí no, para custodiar una sola forma).
# RESPALDO_EXIGIR_CIFRADO vale 0 o 1 (otra cosa: salida 2); el servicio del servidor la lleva en 1 (docs/14 §7).
# La carpeta: si el guion la crea, queda con 700; si ya existe y otros pueden entrar o leer (permisos de grupo u otros), se rechaza en
# vez de cambiarla: puede ser una carpeta que alguien comparte a propósito, y lo que ya contiene ya estuvo expuesto.
# El volcado y la huella salen de una sola transacción de solo lectura: lo que entre mientras se respalda queda fuera de los dos, y
# por eso restaurar el volcado debe dar exactamente esa huella (lo comprueba pruebas/simulacro-restauracion.sh).
# Solo lee la base. Un respaldo a la vez por carpeta. Borra los de más de RESPALDO_RETENCION_DIAS (30), y solo después de haber
# terminado bien el de hoy. Contiene resúmenes de claves y datos sin publicar: la carpeta no va a ningún repositorio y la copia fuera
# del servidor viaja por la red privada (docs/10 §9.5).
# Salida: 0 y una línea «respaldo OK …» (dice si va cifrado); distinto de 0 si algo falló (no deja archivos a medias con nombre
# definitivo).
set -euo pipefail
cd "$(dirname "$0")/.."                       # plataforma/: aquí están el compose y su configuración
DESTINO="${1:-$HOME/respaldos}"
RETENCION="${RESPALDO_RETENCION_DIAS:-30}"
[[ "$RETENCION" =~ ^[0-9]+$ ]] || { echo "FALLA RESPALDO_RETENCION_DIAS debe ser un número de días"; exit 2; }
[ -n "$DESTINO" ] && [ "$DESTINO" != "/" ] || { echo "FALLA la carpeta de destino no puede ser vacía ni la raíz"; exit 2; }

# ¿Se cifra? Se decide y se comprueba ANTES de tocar la base: si se pidió y no se puede, no hay respaldo en claro de reemplazo.
EXIGIR="${RESPALDO_EXIGIR_CIFRADO:-0}"
[ "$EXIGIR" = 0 ] || [ "$EXIGIR" = 1 ] || { echo "FALLA RESPALDO_EXIGIR_CIFRADO debe valer 0 o 1 (vale «$EXIGIR»)"; exit 2; }
CIFRAR=0
if [ -n "${RESPALDO_DESTINATARIOS+definida}" ] || [ "$EXIGIR" = 1 ]; then
  CIFRAR=1
  DESTINATARIOS="${RESPALDO_DESTINATARIOS:-}"
  [ -n "$DESTINATARIOS" ] || { echo "FALLA se pidió cifrar y RESPALDO_DESTINATARIOS está vacía o no definida: no se escribe un respaldo en claro"; exit 2; }
  command -v age >/dev/null || { echo "FALLA se pidió cifrar y age no está instalado: no se escribe un respaldo en claro"; exit 2; }
  [ -r "$DESTINATARIOS" ] || { echo "FALLA no puedo leer el archivo de destinatarios $DESTINATARIOS: no se escribe un respaldo en claro"; exit 2; }
  # La clave privada no debe estar en el servidor: si aparece en el archivo de destinatarios, se rechaza sin usarla.
  if grep -q 'AGE-SECRET-KEY-' "$DESTINATARIOS"; then
    echo "FALLA el archivo de destinatarios contiene una clave PRIVADA de age: sácala del servidor (aquí va solo la pública, age1…)"; exit 2
  fi
  otras=$(grep -v -E '^[[:space:]]*(#|$)' "$DESTINATARIOS" | grep -v -c -E '^age1[a-z0-9]+$' || true)
  [ "$otras" -eq 0 ] || { echo "FALLA el archivo de destinatarios trae $otras línea(s) que no son una clave pública age1… (las claves SSH no se aceptan): no se escribe un respaldo en claro"; exit 2; }
  claves=$(grep -c '^age1' "$DESTINATARIOS" || true)
  [ "$claves" -ge 1 ] || { echo "FALLA el archivo de destinatarios no trae ninguna clave pública age1…: no se escribe un respaldo en claro"; exit 2; }
  printf 'prueba' | age -R "$DESTINATARIOS" > /dev/null 2>&1 \
    || { echo "FALLA age no acepta el archivo de destinatarios (¿una clave mal copiada?): no se escribe un respaldo en claro"; exit 2; }
fi
cifrar() { if [ "$CIFRAR" = 1 ]; then age -R "$DESTINATARIOS"; else cat; fi; }
SUFIJO=""; [ "$CIFRAR" = 1 ] && SUFIJO=".age"

umask 077                                     # todo lo que se cree desde aquí, incluido el candado, solo para el dueño
if [ -d "$DESTINO" ]; then
  [ $(( 8#$(stat -L -c %a "$DESTINO") & 8#077 )) -eq 0 ] \
    || { echo "FALLA $DESTINO deja entrar o leer a otros (permisos $(stat -L -c %a "$DESTINO")): ciérrala con chmod 700 o usa otra carpeta"; exit 2; }
else
  mkdir -p "$DESTINO" && chmod 700 "$DESTINO" || { echo "FALLA no pude crear $DESTINO con permisos 700"; exit 1; }
fi
exec 9> "$DESTINO/.respaldo-en-curso"
flock -n 9 || { echo "FALLA ya hay un respaldo corriendo sobre $DESTINO"; exit 1; }
# Con el candado tomado, cualquier .tmp de un respaldo es el resto de una corrida cortada (kill -9, corte de energía): se borra.
find "$DESTINO" -maxdepth 1 -type f \( -name 'plataforma-*.tmp' -o -name 'dynamic-security-*.tmp' \) -delete
dc() { docker compose "$@"; }

USUARIO=$(dc exec -T timescaledb printenv POSTGRES_USER) || { echo "FALLA la base no responde (¿la pila está arriba?)"; exit 1; }
BASE=$(dc exec -T timescaledb printenv POSTGRES_DB)
MARCA=$(date -u +%FT%H%M%SZ)
VOLCADO="$DESTINO/plataforma-$MARCA.dump$SUFIJO"; HUELLA="$DESTINO/plataforma-$MARCA.huella"
BROKER="$DESTINO/dynamic-security-$MARCA.json$SUFIJO"; SUMAS="$DESTINO/plataforma-$MARCA.sha256"
EN_CONTENEDOR="/tmp/respaldo-$MARCA-$$"      # solo la huella y una marca de «pg_dump terminó»; el volcado no pasa por aquí
limpiar() { rm -f "$VOLCADO.tmp" "$HUELLA.tmp" "$BROKER.tmp" "$SUMAS.tmp"; dc exec -T timescaledb rm -f "$EN_CONTENEDOR.huella" "$EN_CONTENEDOR.hecho" 2>/dev/null || true; }
trap limpiar EXIT

# Deja pasar el flujo solo si empieza con la cabecera del formato propio de pg_dump («PGDMP»): lo que no sea un volcado no se cifra.
cabecera_pgdmp() {
  local LC_ALL=C c=""
  IFS= read -r -N 5 c || true
  [ "$c" = "PGDMP" ] || { echo "FALLA el flujo de pg_dump no empieza con la cabecera PGDMP" >&2; return 1; }
  printf '%s' "$c"; cat
}

# Una sola sesión: abre la transacción, exporta su instantánea, pg_dump vuelca ESA instantánea y la huella se calcula en ella.
# El volcado sale por la salida estándar de psql (\o manda la huella a un archivo aparte dentro del contenedor) y se cifra al vuelo.
# Un pg_dump que muere a la mitad deja un flujo con cabecera válida que no se distinguiría: por eso solo un pg_dump que salió con 0
# deja la marca «.hecho», y sin ella no hay respaldo.
if ! {
  printf '\\o %s.huella\n' "$EN_CONTENEDOR"
  printf 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n'
  printf 'SELECT pg_export_snapshot() AS instantanea \\gset\n'
  printf '\\setenv INSTANTANEA :instantanea\n'
  printf '\\! pg_dump --snapshot="$INSTANTANEA" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc && touch %s.hecho\n' "$EN_CONTENEDOR"
  cat db/pruebas/huella-respaldo.sql
  printf 'COMMIT;\n'
} | dc exec -T timescaledb psql -X -q -v ON_ERROR_STOP=1 -U "$USUARIO" -d "$BASE" -f - | cabecera_pgdmp | cifrar > "$VOLCADO.tmp"; then
  echo "FALLA el volcado no se pudo escribir (pg_dump, psql, el cifrado o el disco): no hay respaldo"; exit 1
fi
dc exec -T timescaledb test -f "$EN_CONTENEDOR.hecho" || { echo "FALLA pg_dump no terminó bien: no hay respaldo"; exit 1; }
[ -s "$VOLCADO.tmp" ] || { echo "FALLA el volcado quedó vacío"; exit 1; }
if [ "$CIFRAR" = 1 ]; then
  [ "$(head -c 21 "$VOLCADO.tmp")" = "age-encryption.org/v1" ] || { echo "FALLA el volcado cifrado no tiene la cabecera de age"; exit 1; }
fi
dc exec -T timescaledb cat "$EN_CONTENEDOR.huella" > "$HUELLA.tmp"
tablas=$(grep -c '^tabla ' "$HUELLA.tmp" || true)
[ "$tablas" -ge 1 ] && grep -q '^objetos ' "$HUELLA.tmp" || { echo "FALLA la huella quedó incompleta (sin tablas o sin la línea de objetos)"; exit 1; }
# El broker reescribe ese archivo cuando cambia un cliente: se exige un JSON completo, comprobado en memoria antes de cifrarlo.
if ! dc exec -T mosquitto cat /mosquitto/data/dynamic-security.json \
     | python3 -I -c 'import json, sys; d = sys.stdin.buffer.read(); json.loads(d); sys.stdout.buffer.write(d)' 2>/dev/null \
     | cifrar > "$BROKER.tmp"; then
  echo "FALLA el archivo de credenciales del broker no es un JSON completo (¿se copió mientras se escribía?) o no se pudo escribir: repite el respaldo"; exit 1
fi
[ -s "$BROKER.tmp" ] || { echo "FALLA el archivo de credenciales del broker quedó vacío"; exit 1; }
for f in "$HUELLA" "$BROKER" "$VOLCADO"; do printf '%s  %s\n' "$(sha256sum < "$f.tmp" | cut -d' ' -f1)" "$(basename "$f")"; done > "$SUMAS.tmp"

mv "$HUELLA.tmp" "$HUELLA" && mv "$BROKER.tmp" "$BROKER" && mv "$SUMAS.tmp" "$SUMAS" && mv "$VOLCADO.tmp" "$VOLCADO"
find "$DESTINO" -maxdepth 1 -type f \( -name 'plataforma-*.dump' -o -name 'plataforma-*.dump.age' -o -name 'plataforma-*.huella' \
  -o -name 'plataforma-*.sha256' -o -name 'dynamic-security-*.json' -o -name 'dynamic-security-*.json.age' \) -mtime +"$RETENCION" -delete
if [ "$CIFRAR" = 1 ]; then estado="cifrado con age para $claves destinatario(s)"; else estado="SIN CIFRAR (docs/10 §9.5: define RESPALDO_DESTINATARIOS)"; fi
printf '%s respaldo OK %s bytes, %s tablas en la huella, %s: %s\n' "$(date -u +%FT%TZ)" "$(stat -c%s "$VOLCADO")" "$tablas" "$estado" "$VOLCADO"
