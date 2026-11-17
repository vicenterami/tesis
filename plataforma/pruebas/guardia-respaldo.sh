#!/usr/bin/env bash
# Guardia «último respaldo de menos de 26 h» (docs/10 §9.5 y §8.4 punto 61; TT-46).
#   bash plataforma/pruebas/guardia-respaldo.sh [carpeta]      carpeta por omisión: ~/respaldos (la misma de pruebas/respaldar.sh)
# Mira el respaldo MÁS RECIENTE de la carpeta (por la marca UTC de su nombre) y responde una sola línea:
#   OK        … y sale con 0: hay un respaldo completo y sano de menos de RESPALDO_MAX_HORAS (26: el diario más un margen);
#   ATRASADO  … y sale con 1: no lo hay, y dice por qué (ninguno, demasiado viejo, vacío o más chico que RESPALDO_MIN_BYTES, sin
#             huella o sin sumas, una suma que no coincide —archivo truncado o corrompido—, un reloj en el futuro, o en claro cuando se
#             exige cifrado o cuando la carpeta ya tiene respaldos cifrados: una vuelta al claro sin aviso);
#   sale con 2 si se la llamó mal (una variable sin forma de número, o una de 0/1 con otro valor).
# «OK» dice que el respaldo existe, está entero y es reciente; NO que restaura: eso lo prueba pruebas/simulacro-restauracion.sh.
# Las sumas no van firmadas: detectan la corrupción accidental, no a quien escribe en el servidor y las regenera (docs/10 §9.5).
# La antigüedad es la MAYOR de dos: la de la marca del nombre (la pone el respaldo al empezar y no cambia al copiar) y la de la hora
# del archivo (no cambia al renombrar). Así ni un `touch` ni un archivo viejo renombrado la engañan. Una de las dos en el futuro
# (más de 5 min) es un reloj equivocado: no se puede saber la antigüedad, y eso no es «OK».
# Comprueba el contenido sin la clave privada: las sumas SHA-256 que el respaldo dejó al terminar (plataforma-<marca>.sha256) deben
# coincidir con el volcado, la huella y el archivo del broker; la huella debe estar completa; y la cabecera del volcado debe ser la
# de age (cifrado) o la de pg_dump (en claro). Probar que restaura es tarea del simulacro (pruebas/simulacro-restauracion.sh).
# Variables: RESPALDO_MAX_HORAS (26); RESPALDO_MIN_BYTES (16384: el volcado vacío del esquema ya los supera con holgura; uno más
# chico es un archivo que no es un volcado); RESPALDO_EXIGIR_CIFRADO=1 hace que un último respaldo en claro sea ATRASADO (el servicio
# del servidor la lleva en 1); RESPALDO_ACEPTAR_CLARO=1 acepta a sabiendas un último respaldo en claro aunque haya cifrados anteriores
# (por ejemplo, tras retirar el cifrado por decisión). Las dos últimas valen 0 o 1.
# Solo lee. Apto para un temporizador: el código de salida es la señal y la línea es el mensaje. Cuando exista la monitorización
# propia (TT-45), su colector la corre y abre o cierra la condición del sistema `respaldo_atrasado` (docs/10 §8.4 punto 61).
set -uo pipefail
CARPETA="${1:-$HOME/respaldos}"
MAX_HORAS="${RESPALDO_MAX_HORAS:-26}"
EXIGIR_CIFRADO="${RESPALDO_EXIGIR_CIFRADO:-0}"
ACEPTAR_CLARO="${RESPALDO_ACEPTAR_CLARO:-0}"
MIN_BYTES="${RESPALDO_MIN_BYTES:-16384}"
[[ "$MAX_HORAS" =~ ^[0-9]+$ ]] && [ "$MAX_HORAS" -ge 1 ] || { echo "FALLA RESPALDO_MAX_HORAS debe ser un número entero de horas (≥ 1)"; exit 2; }
[[ "$MIN_BYTES" =~ ^[0-9]+$ ]] || { echo "FALLA RESPALDO_MIN_BYTES debe ser un número de bytes"; exit 2; }
for v in EXIGIR_CIFRADO ACEPTAR_CLARO; do
  [ "${!v}" = 0 ] || [ "${!v}" = 1 ] || { echo "FALLA RESPALDO_$v debe valer 0 o 1 (vale «${!v}»)"; exit 2; }
done
atrasado() { echo "ATRASADO $1"; exit 1; }

[ -d "$CARPETA" ] || atrasado "no existe la carpeta de respaldos $CARPETA: no hay ningún respaldo"
# Las marcas son AAAA-MM-DDTHHMMSSZ: el orden alfabético es el cronológico. Se toma el último volcado, cifrado o no.
ULTIMO=$(find "$CARPETA" -maxdepth 1 -type f \( -name 'plataforma-*.dump' -o -name 'plataforma-*.dump.age' \) -printf '%f\n' \
         | grep -E '^plataforma-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.dump(\.age)?$' | sort | tail -1)
[ -n "$ULTIMO" ] || atrasado "no hay ningún respaldo en $CARPETA"
MARCA=$(sed -E 's/^plataforma-(.*)\.dump(\.age)?$/\1/' <<<"$ULTIMO")
CIFRADO=0; [[ "$ULTIMO" == *.age ]] && CIFRADO=1
VOLCADO="$CARPETA/$ULTIMO"; HUELLA="$CARPETA/plataforma-$MARCA.huella"; SUMAS="$CARPETA/plataforma-$MARCA.sha256"
BROKER="$CARPETA/dynamic-security-$MARCA.json"; [ "$CIFRADO" = 1 ] && BROKER="$BROKER.age"

ahora=$(date -u +%s)
en_nombre=$(date -u -d "$(sed -E 's/^(.{10})T(..)(..)(..)Z$/\1 \2:\3:\4/' <<<"$MARCA")" +%s 2>/dev/null) \
  || atrasado "$ULTIMO: la marca del nombre no es una fecha válida"
en_archivo=$(stat -c %Y "$VOLCADO")
for t in "$en_nombre" "$en_archivo"; do
  [ "$t" -le $((ahora + 300)) ] || atrasado "$ULTIMO está fechado en el futuro ($(date -u -d "@$t" +%FT%TZ), ahora $(date -u -d "@$ahora" +%FT%TZ)): un reloj está mal y no se puede saber su antigüedad"
done
edad=$(( ahora - (en_nombre < en_archivo ? en_nombre : en_archivo) )); [ "$edad" -ge 0 ] || edad=0
legible="$((edad / 3600)) h $(((edad % 3600) / 60)) min"
[ "$edad" -le $((MAX_HORAS * 3600)) ] || atrasado "el último respaldo tiene $legible (más de $MAX_HORAS h): $ULTIMO"

# Completo y sano: los cuatro archivos, no vacíos, con la cabecera esperada, la huella completa y las sumas que coinciden.
[ -s "$VOLCADO" ] || atrasado "el último respaldo está vacío (0 bytes): $ULTIMO"
[ "$(stat -c %s "$VOLCADO")" -ge "$MIN_BYTES" ] \
  || atrasado "el último respaldo mide $(stat -c %s "$VOLCADO") bytes, menos que el mínimo de un volcado ($MIN_BYTES): $ULTIMO"
[ -s "$HUELLA" ] || atrasado "el último respaldo no tiene huella ($(basename "$HUELLA")): no se puede demostrar qué contiene"
{ [ "$(grep -c '^tabla ' "$HUELLA")" -ge 1 ] && grep -q '^objetos ' "$HUELLA" && grep -q '^extension timescaledb ' "$HUELLA"; } \
  || atrasado "la huella del último respaldo está incompleta: $(basename "$HUELLA")"
[ -s "$BROKER" ] || atrasado "al último respaldo le falta el archivo del broker ($(basename "$BROKER"))"
[ -s "$SUMAS" ] || atrasado "el último respaldo no tiene su archivo de sumas ($(basename "$SUMAS")): no se puede saber si está entero"
for f in "$VOLCADO" "$HUELLA" "$BROKER"; do
  esperada=$(awk -v n="$(basename "$f")" '$2 == n {print $1}' "$SUMAS")
  [ -n "$esperada" ] || atrasado "el archivo de sumas no nombra $(basename "$f")"
  [ "$(sha256sum < "$f" | cut -d' ' -f1)" = "$esperada" ] || atrasado "$(basename "$f") no coincide con su suma SHA-256: se truncó o se alteró después del respaldo"
done
if [ "$CIFRADO" = 1 ]; then
  [ "$(head -c 21 "$VOLCADO")" = "age-encryption.org/v1" ] || atrasado "$ULTIMO dice estar cifrado y no tiene la cabecera de age"
  estado="cifrado"
else
  [ "$(head -c 5 "$VOLCADO")" = "PGDMP" ] || atrasado "$ULTIMO no tiene la cabecera de pg_dump"
  [ "$EXIGIR_CIFRADO" = 1 ] && atrasado "el último respaldo está EN CLARO y se exige cifrado (RESPALDO_EXIGIR_CIFRADO=1): $ULTIMO"
  if [ "$ACEPTAR_CLARO" != 1 ] && [ -n "$(find "$CARPETA" -maxdepth 1 -type f -name 'plataforma-*.dump.age' -print -quit)" ]; then
    atrasado "el último respaldo está EN CLARO y en la carpeta hay respaldos cifrados anteriores: el cifrado se perdió (¿falta RESPALDO_DESTINATARIOS en el servicio?); si es a propósito, RESPALDO_ACEPTAR_CLARO=1: $ULTIMO"
  fi
  estado="en claro"
fi
echo "OK el último respaldo tiene $legible ($estado, $(stat -c %s "$VOLCADO") bytes, huella y sumas coinciden): $ULTIMO"
