#!/usr/bin/env bash
# Capacidad y picos sobre el banco desechable (docs/16 §10; 08/10/2026). No toca la pila de desarrollo. Desde cualquier carpeta:
#   bash plataforma/pruebas/banco/capacidad.sh carga        reposo 20 s → 100 disp. cada 2 s, 60 s → 400 cada 1 s, 30 s;
#                                                            memoria y CPU máximas por contenedor y fase, OOM y descartes
#   bash plataforma/pruebas/banco/capacidad.sh combinada    400 disp. cada 1 s + 15 bucles HTTPS a /salud + 3 tormentas de
#                                                            reconexión TLS: lo que un ataque le hace a la recepción
#   bash plataforma/pruebas/banco/capacidad.sh techo [N]    solo MQTT, N disp. cada 1 s durante 30 s (800): dónde se pierde
# Cada modo enciende el banco, mide y lo apaga. El dato que manda es el contador del broker
# $SYS/broker/publish/messages/dropped: lo que la cola (max_queued_messages) no pudo guardar se descarta sin aviso.
set -u
cd "$(dirname "$0")/../.." || exit 1                    # plataforma/
IMG_BROKER=$(grep -oE 'eclipse-mosquitto:[^ ]+@sha256:[0-9a-f]{64}' docker-compose.yml | head -1)   # la del compose, fijada por digest
[ -n "$IMG_BROKER" ] || { echo "FALLA no encontré la imagen fijada del broker en docker-compose.yml"; exit 1; }
B=pruebas/banco/banco.sh; CERTS="$(pwd)/../privado/certs-desarrollo"
O="${TMPDIR:-/tmp}/plataforma-capacidad"; rm -rf "$O"; mkdir -p "$O"
sys() { docker run --rm --network banco_default "$IMG_BROKER" mosquitto_sub -h mosquitto -t "\$SYS/broker/publish/messages/$1" -C 1 -W 20 2>/dev/null; }
resumen() { grep -E "NO guardadas|p95 \(ms\) \||tramas crudas" "$1" | cut -c1-110; }
tls() { # tormenta de reconexión: 3 clientes × 150 publicaciones, una conexión TLS nueva por publicación
  for k in 0010 0011 0012; do
    docker run --rm --network banco_default -v "$CERTS:/c:ro" --entrypoint sh "$IMG_BROKER" -c '
      i=0; while [ "$i" -lt 150 ]; do bt=$(date +%s)
        mosquitto_pub --cafile /c/ca.crt -h proxy -p 8883 -q 1 -i "$0" -u "$0" -t "sitio/banco/dispositivo/$0/temperatura" \
          -m "[{\"bn\":\"$0\",\"bt\":$bt,\"n\":\"temperatura\",\"u\":\"Cel\",\"v\":21.5}]" || echo FALLA
        i=$((i+1)); done' "emu-$k" > "$O/tls-$k.log" 2>&1 &
  done; wait; }
https() { for i in $(seq 1 15); do ( fin=$((SECONDS+30)); n=0
  while [ $SECONDS -lt $fin ]; do curl -s -o /dev/null --cacert "$CERTS/ca.crt" https://localhost:8443/salud && n=$((n+1)); done
  echo "$n" >> "$O/https.cnt" ) & done; wait; }
muestrear() { while [ -f "$O/muestreando" ]; do f=$(cat "$O/fase")
  docker stats --no-stream --format '{{.Name}};{{.MemUsage}};{{.CPUPerc}}' | grep '^banco-' | sed "s/^/$f;/" >> "$O/stats.csv"; done; }
tabla() { python3 -I - "$O/stats.csv" <<'PY'
import csv, sys, re, collections
u = {"B": 1 / 1048576, "KiB": 1 / 1024, "MiB": 1, "GiB": 1024}; mx = collections.defaultdict(lambda: [0.0, 0.0, 0.0])
for fase, nombre, mem, cpu in csv.reader(open(sys.argv[1]), delimiter=";"):
    m = re.match(r"([\d.]+)(\w+)\s*/\s*([\d.]+)(\w+)", mem); v = mx[(fase, nombre.removeprefix("banco-").removesuffix("-1"))]
    v[0] = max(v[0], float(m.group(1)) * u[m.group(2)]); v[1] = max(v[1], float(cpu.rstrip("%") or 0)); v[2] = float(m.group(3)) * u[m.group(4)]
fases = [f for f in ("reposo", "sostenida", "pico") if any(k[0] == f for k in mx)]
print(f"{'contenedor':12} {'techo':>6} | " + " | ".join(f"{f:>16}" for f in fases))
for n in sorted({k[1] for k in mx}):
    techo = next(v[2] for k, v in mx.items() if k[1] == n)
    print(f"{n:12} {techo:4.0f}Mi | " + " | ".join(f"{mx[(f, n)][0]:6.1f} MiB {mx[(f, n)][1]:4.0f}%" for f in fases))
print("suma de máximos: " + " · ".join(f"{f} {sum(v[0] for k, v in mx.items() if k[0] == f):.0f} MiB" for f in fases))
PY
}
case "${1:-}" in
  carga)
    bash $B encender 400 2 > "$O/encender.log" 2>&1 || { echo "FALLA encender"; exit 1; }
    bash $B proxy > "$O/proxy.log" 2>&1; tail -1 "$O/proxy.log"
    echo reposo > "$O/fase"; touch "$O/muestreando"; muestrear & M=$!; sleep 20
    echo sostenida > "$O/fase"; bash $B correr --dispositivos 100 --periodo 2 --duracion 60 > "$O/sostenida.log" 2>&1
    echo pico > "$O/fase"; bash $B correr --dispositivos 400 --periodo 1 --jitter 0.1 --duracion 30 > "$O/pico.log" 2>&1
    rm -f "$O/muestreando"; wait $M
    echo "── sostenida (100 disp. cada 2 s)"; resumen "$O/sostenida.log"; echo "── pico (400 disp. cada 1 s)"; resumen "$O/pico.log"
    echo "── memoria y CPU máximas por fase"; tabla
    for c in $(docker ps --format '{{.Names}}' | grep '^banco-'); do printf '%-22s OOMKilled=%s reinicios=%s\n' "$c" \
      "$(docker inspect -f '{{.State.OOMKilled}}' "$c")" "$(docker inspect -f '{{.RestartCount}}' "$c")"; done
    echo "descartados por el broker: $(sys dropped)" ;;
  combinada)
    bash $B encender 400 2 > "$O/encender.log" 2>&1 || { echo "FALLA encender"; exit 1; }
    bash $B proxy > "$O/proxy.log" 2>&1; tail -1 "$O/proxy.log"
    https & H=$!; tls & T=$!
    bash $B correr --dispositivos 400 --periodo 1 --jitter 0.1 --duracion 30 > "$O/pico.log" 2>&1; wait $H $T
    echo "peticiones HTTPS a /salud en 30 s: $(paste -sd+ "$O/https.cnt" | bc) · fallas TLS: $(cat "$O"/tls-*.log | grep -c FALLA) de 450"
    resumen "$O/pico.log"; echo "descartados por el broker: $(sys dropped)" ;;
  techo)
    n="${2:-800}"
    bash $B encender "$n" 2 > "$O/encender.log" 2>&1 || { echo "FALLA encender"; exit 1; }
    bash $B correr --dispositivos "$n" --periodo 1 --jitter 0.1 --duracion 30 > "$O/pico.log" 2>&1
    head -c 300 "$O/pico.log" | grep -oE '"(tramas_publicadas|tasa_media_por_s|pico_por_s|sin_puback)":[0-9.]+' | tr '\n' ' '; echo
    resumen "$O/pico.log"; echo "descartados por el broker: $(sys dropped)" ;;
  *) sed -n '2,8p' "$0"; exit 1 ;;
esac
bash $B apagar > /dev/null 2>&1; echo "banco apagado · registros en $O"
