#!/usr/bin/env bash
# Pruebas de caída con carga en curso (TT-30; docs/16 §11; 08/10/2026). Banco desechable; no toca la pila de desarrollo.
#   bash plataforma/pruebas/banco/caidas.sh
# Tres escenarios, uno tras otro, con 20 dispositivos que reportan cada 1 s (20 tramas/s, menos que la cola de 1000 del broker,
# para probar la red de seguridad y no el límite ya medido en docs/16 §10):
#   backend  se detiene 20 s y vuelve   → el broker debe guardar en cola y entregar al volver (sesión persistente, QoS 1)
#   base     se congela 15 s (pause)    → reintentos del pipeline y reenvío del broker (con tmpfs, detenerla borraría los datos)
#   broker   se reinicia                → en el banco va sin persistencia: mide lo que se pierde en el peor caso
# Cada escenario: pérdida evaluada 30 s después de terminar (no a los 5 s: lo atrasado no es pérdida), descartes del broker
# (contador $SYS, delta) y segundos hasta que /salud vuelve a responder.
set -u
cd "$(dirname "$0")/../.." || exit 1                    # plataforma/
B=pruebas/banco/banco.sh; O="${TMPDIR:-/tmp}/plataforma-caidas"; rm -rf "$O"; mkdir -p "$O"
sys() { docker run --rm --network banco_default eclipse-mosquitto:2.0.22 mosquitto_sub -h mosquitto -t "\$SYS/broker/publish/messages/$1" -C 1 -W 20 2>/dev/null; }
hasta_salud() { local t0=$SECONDS; for _ in $(seq 1 60); do curl -s -m 2 http://127.0.0.1:3001/salud | grep -q '"estado":"ok"' && { echo $((SECONDS - t0)); return; }; sleep 1; done; echo "más de 60"; }
escenario() { # nombre falla_inicio falla_fin segundos_de_caída
  local d0; d0=$(sys dropped); d0=${d0:-0}
  bash $B correr --dispositivos 20 --periodo 1 --jitter 0.1 --duracion 60 > "$O/$1.log" 2>&1 & local E=$!
  sleep 15; eval "$2"; sleep "$4"; eval "$3"; local rec; rec=$(hasta_salud)
  wait $E; sleep 30; bash $B evaluar > "$O/$1-35.log" 2>&1
  local d1; d1=$(sys dropped); d1=${d1:-0}
  printf '%-8s perdidas=%s · descartes del broker=%s · /salud de vuelta en %s s · sin PUBACK en el emulador=%s\n' "$1" \
    "$(grep -E 'NO guardadas' "$O/$1-35.log" | awk -F'|' '{gsub(/ /,"",$2); print $2}')" "$((d1 - d0))" "$rec" \
    "$(head -c 400 "$O/$1.log" | grep -oE '"sin_puback":[0-9]+' | cut -d: -f2)"
}
bash $B encender 20 2 > "$O/encender.log" 2>&1 || { echo "FALLA encender"; exit 1; }
escenario backend "docker stop banco-backend-1 > /dev/null" "docker start banco-backend-1 > /dev/null" 20
escenario base    "docker pause banco-timescaledb-1 > /dev/null" "docker unpause banco-timescaledb-1 > /dev/null" 15
escenario broker  "docker restart banco-mosquitto-1 > /dev/null" "true" 0
for c in backend timescaledb mosquitto; do printf '%-12s reinicios=%s\n' "$c" "$(docker inspect -f '{{.RestartCount}}' "banco-$c-1")"; done
bash $B apagar > /dev/null 2>&1; echo "banco apagado · registros en $O"
