#!/usr/bin/env bash
# La medición completa de una noche (docs/23 §4.3, §7.1 y §13): todas las corridas válidas en un orden aleatorio fijado por semilla, repartidas en
# BANCO_PARALELO ranuras (máquinas a la vez, 2 por omisión; cada una con sus dos hilos fijados). Se impide la suspensión del equipo con
# systemd-inhibit (sin privilegios) mientras dure. Antes de empezar: la prueba del contador y las comprobaciones del anfitrión.
#   bash noche.sh [--con-44] [--semilla N] [--ensayo]
#     --con-44   suma la sensibilidad con ThingsBoard v4.4.0.2 (fila A, 2 y 4 GB; exige instalar-thingsboard.sh 44 antes)
#     --ensayo   escribe el plan y sale, sin correr nada
# Plan (fila B de ThingsBoard solo en 4 GB: en 2 GB queda fuera del mínimo que su guía declara, docs/23 §4.3):
#   propia A 2 GB × 3, 4 GB × 1 · tb43 A 2 GB × 3, 4 GB × 1 · tb43 B 4 GB × 1   [+ tb44 A 2 GB × 1, 4 GB × 1]
# Registro: $BANCO_DATOS/noche-<fecha>.log; datos de cada corrida en $BANCO_DATOS/<id>/; al final, tabla.md y figura.csv en
# $BANCO_DATOS/tabla-<fecha>/. Cada corrida del plan deja una línea en noche-<fecha>.log.corridas (plataforma fila RAM repetición id
# salida): la tabla se arma SOLO con las corridas de esta noche, y la que no dejó resultado cuenta como «no completó», no desaparece.
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
RANURA=0; . "$AQUI/lib.sh"
CON44=0; SEMILLA=20261127; ENSAYO=0
while [ $# -gt 0 ]; do case $1 in --con-44) CON44=1;; --semilla) SEMILLA=$2; shift;; --ensayo) ENSAYO=1;; *) echo "opción $1"; exit 2;; esac; shift; done
PAR=${BANCO_PARALELO:-2}
if [ -z "${BANCO_INHIBIDO:-}" ] && [ "$ENSAYO" = 0 ]; then
  exec env BANCO_INHIBIDO=1 systemd-inhibit --what=sleep:idle:handle-lid-switch --who=banco-comparacion --why="medición de la comparación" \
    bash "$0" "$@" $([ "$CON44" = 1 ] && echo --con-44) --semilla "$SEMILLA"
fi
FECHA=$(date -u +%Y%m%dT%H%M%SZ); LOG="$DATOS/noche-$FECHA.log"
plan=$(python3 -I - "$SEMILLA" "$CON44" <<'PY'
import random, sys
s, con44 = int(sys.argv[1]), sys.argv[2] == "1"
c = [("propia", "a", 2, r) for r in (1, 2, 3)] + [("propia", "a", 4, 1)]
c += [("tb43", "a", 2, r) for r in (1, 2, 3)] + [("tb43", "a", 4, 1), ("tb43", "b", 4, 1)]
if con44: c += [("tb44", "a", 2, 1), ("tb44", "a", 4, 1)]
random.Random(s).shuffle(c)
for p, f, ram, r in c: print(p, f, ram, r)
PY
)
echo "plan (semilla $SEMILLA, $PAR ranuras):"; echo "$plan" | nl
[ "$ENSAYO" = 1 ] && exit 0

# ── Comprobaciones del anfitrión (docs/23 §12, puntos 6–8) ──
bash "$AQUI/contador-prueba.sh" > "$DATOS/contador-prueba-$FECHA.txt" || { echo "FALLA la prueba del contador: ver $DATOS/contador-prueba-$FECHA.txt"; exit 1; }
ac=$(cat /sys/class/power_supply/A*/online 2>/dev/null | head -1)
[ "$ac" = 1 ] || { echo "FALLA el equipo no está enchufado"; exit 1; }
pgrep -f "corrida-larga|ventana/emisor|corrida.sh" >/dev/null && { echo "FALLA hay otra corrida en marcha (pgrep)"; exit 1; }
for d in propia-instalada tb43-instalada $([ "$CON44" = 1 ] && echo tb44-instalada); do
  [ -f "$CACHE/maquinas/$d/disco.qcow2" ] || { echo "FALLA falta la instantánea $d (instalar-*.sh)"; exit 1; }
done
libre=$(df --output=avail -BG "$CACHE" | tail -1 | tr -dc 0-9); [ "$libre" -ge 30 ] || { echo "FALLA solo $libre GB libres en la caché (se piden 30)"; exit 1; }

echo "noche $FECHA: $(echo "$plan" | wc -l) corridas en $PAR ranuras; registro $LOG"
{ echo "inicio $(date -u +%FT%TZ) semilla $SEMILLA ranuras $PAR"; echo "$plan"; } > "$LOG"
for r in $(seq 0 $((PAR - 1))); do
  (
    echo "$plan" | awk -v r="$r" -v p="$PAR" '(NR - 1) % p == r' | while read -r pl fi ram rep; do
      echo "$(date -u +%FT%TZ) ranura $r empieza $pl $fi ${ram}g r$rep" >> "$LOG"
      antes=$(grep -c '^corrida ' "$LOG.r$r" 2>/dev/null); antes=${antes:-0}
      bash "$AQUI/corrida.sh" "$pl" "$fi" "$ram" "$rep" "$r" < /dev/null >> "$LOG.r$r" 2>&1; rc=$?
      id=-; [ "$(grep -c '^corrida ' "$LOG.r$r")" -gt "$antes" ] && id=$(grep '^corrida ' "$LOG.r$r" | tail -n 1 | cut -d' ' -f2)
      echo "$pl $fi $ram $rep $id $rc" >> "$LOG.corridas"
      echo "$(date -u +%FT%TZ) ranura $r termina $pl $fi ${ram}g r$rep (corrida.sh salió con $rc): $(tail -n 2 "$LOG.r$r" | head -1)" >> "$LOG"
    done
  ) &
  sleep 20   # las máquinas no arrancan en el mismo segundo
done
wait
echo "fin $(date -u +%FT%TZ)" >> "$LOG"
python3 -I "$AQUI/tabla.py" "$DATOS" "$DATOS/tabla-$FECHA" --corridas "$LOG.corridas" | tee -a "$LOG"
bash "$AQUI/vm.sh" lista | tee -a "$LOG"
