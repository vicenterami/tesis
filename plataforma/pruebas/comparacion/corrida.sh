#!/usr/bin/env bash
# UNA corrida de la comparación medida (docs/23 §6): máquina nueva sobre la instantánea «instalada» de la plataforma, arranque de Docker y de
# la plataforma, sonda hasta «lista», S1 y S2, conteo estable en la base, muestras y estado de los contenedores; la máquina se apaga y su
# disco de corrida se borra (la instantánea instalada no se toca). Los datos crudos quedan en $BANCO_DATOS/<id>/ y el veredicto en
# <id>/resultado.json (evaluar.py).
#   bash corrida.sh PLATAFORMA FILA RAM_GB REPETICION RANURA [--piloto] [--s1-s N] [--s2-s N] [--sin-s2] [--plantar] [--semilla N]
#     PLATAFORMA propia | tb43 | tb44     FILA a | b (b: solo ThingsBoard, el heap de su guía; la propia no tiene fila b)
#     --piloto   la corrida se marca como piloto en meta.json y en su id: valida el banco, no es un resultado (docs/23 §9)
#     --s1-s / --s2-s   duración de S1 y S2 en segundos (por omisión 1200 y 900, los del protocolo; distinto solo en un piloto)
#     --plantar  al final borra UN punto guardado de S1 en la base de la corrida y vuelve a evaluar: debe NO aprobar (docs/23 §5.6)
set -euo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
PLAT=${1:?PLATAFORMA}; FILA=${2:?FILA}; RAM=${3:?RAM_GB}; REP=${4:?REPETICION}; RANURA=${5:?RANURA}; shift 5
PILOTO=0; S1=1200; S2=900; CON_S2=1; PLANTAR=0; SEMILLA=1
while [ $# -gt 0 ]; do case $1 in
  --piloto) PILOTO=1;; --s1-s) S1=$2; shift;; --s2-s) S2=$2; shift;; --sin-s2) CON_S2=0;; --plantar) PLANTAR=1;; --semilla) SEMILLA=$2; shift;;
  *) echo "opción desconocida $1"; exit 2;; esac; shift; done
. "$AQUI/lib.sh"
case $PLAT in
  propia) [ "$FILA" = a ] || falla "la plataforma propia solo tiene fila a"; . "$AQUI/plataformas/propia.sh" ;;
  tb43|tb44) TB_VERSION=${PLAT#tb}; . "$AQUI/plataformas/thingsboard.sh" ;;
  *) falla "PLATAFORMA: propia, tb43 o tb44" ;;
esac
for v in "$RAM" "$REP" "$RANURA" "$S1" "$S2" "$SEMILLA"; do [[ "$v" =~ ^(0|[1-9][0-9]*)$ ]] || falla "RAM_GB, REPETICION, RANURA, las duraciones y la semilla son enteros sin ceros a la izquierda: «$v» no lo es"; done
case $RAM in 2|4|8) ;; *) falla "RAM_GB: 2, 4 u 8" ;; esac
case $FILA in a) ;; b) [ "$RAM" = 4 ] || falla "la fila b solo se mide en 4 GB (docs/23 §4.3)" ;; *) falla "FILA: a o b" ;; esac
# Una corrida válida es la del protocolo, completa: lo demás (otra duración, sin S2, otra semilla) solo cabe en un piloto.
[ "$PILOTO" = 0 ] && { [ "$S1" = 1200 ] && [ "$S2" = 900 ] && [ "$CON_S2" = 1 ] && [ "$SEMILLA" = 1 ] || falla "una corrida válida usa S1 = 1200 s, S2 = 900 s, los dos escenarios y la semilla 1 (docs/23 §5.3); lo demás va con --piloto"; }
ID="$PLAT-$FILA-${RAM}g-r$REP$([ "$PILOTO" = 1 ] && echo -piloto)-$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$DATOS/$ID"; mkdir -p "$OUT"/{sonda,s1,s2,muestras}
F="$OUT/fases.csv"; : > "$F"
MAQ="corrida-r$RANURA"
GEN=(node "$AQUI/generador.mjs" --plataforma "$P_ADAPTADOR" --credenciales "$P_INST/credenciales.csv" --puerto-a "$(puerto "$P_RED_A")" --puerto-b "$(puerto "$P_RED_B")" --semilla "$SEMILLA")
[ "$P_ADAPTADOR" = propia ] && GEN+=(--ca "$P_INST/ca.crt" --servidor localhost)
SONDA_PID=
limpiar() {
  [ -n "$SONDA_PID" ] && kill "$SONDA_PID" 2>/dev/null || true
  vm apagar "$MAQ" >/dev/null 2>&1 || true
  vm borrar "$MAQ" >/dev/null 2>&1 || true
}
trap limpiar EXIT
echo "corrida $ID"

# ── 1. Máquina sobre la instantánea instalada ──
vm lista | grep -q "^$MAQ " && { vm apagar "$MAQ" || true; vm borrar "$MAQ"; }
vm crear "$MAQ" "$P_DISCO"
t=$(ms); vm arrancar "$MAQ" "$RAM" "$RANURA"; fase "$F" maquina_arriba "$t"
bash "$AQUI/vm.sh" copiar "$RANURA" "$AQUI/dentro/muestreo.sh" /home/banco/
en 'nohup setsid bash ~/muestreo.sh ~/muestras > ~/muestreo.log 2>&1 < /dev/null & echo $! > ~/muestreo.pid'
# Comprobaciones previas de cada corrida (docs/23 §12): hora, memoria, disco, temporizadores.
desfase=$(python3 -I - "$AQUI/vm.sh" "$RANURA" <<'PY'
import subprocess, sys, time
m = []
for _ in range(5):
    a = time.time(); v = subprocess.run(["bash", sys.argv[1], "ssh", sys.argv[2], "date +%s.%N"], capture_output=True, text=True).stdout.strip(); b = time.time()
    m.append((b - a, float(v) - (a + b) / 2))
print(round(min(m)[1] * 1000))
PY
)
en 'grep MemTotal /proc/meminfo; df --output=avail -BG / | tail -1; cat /proc/swaps | wc -l; systemctl is-active apt-daily.timer unattended-upgrades snapd 2>/dev/null | tr "\n" " "; echo; uname -r; dmesg 2>/dev/null | grep -ci "killed process" || true' > "$OUT/previas.txt" 2>&1 || true
echo "desfase_reloj_ms=$desfase" >> "$OUT/previas.txt"
[ "${desfase#-}" -lt 1000 ] || falla "la hora de la máquina difiere $desfase ms de la del anfitrión (tope 1000 ms)"

# ── 2. Arranque de Docker y de la plataforma; la sonda publica desde el mismo instante ──
T0=$(ms)
"${GEN[@]}" --modo sonda --salida "$OUT/sonda" > "$OUT/sonda/sonda.log" 2>&1 & SONDA_PID=$!
p_arrancar > "$OUT/arranque.log" 2>&1 || true
en 'nohup setsid docker events --format "{{.Time}} {{.Type}} {{.Action}} {{.Actor.Attributes.name}}" > ~/eventos.log 2>&1 < /dev/null & echo $! > ~/eventos.pid'
LISTA=
while [ $(( $(ms) - T0 )) -lt 600000 ]; do
  sleep 5
  p_guardados "$T0" "$(( $(ms) + 60000 ))" tt40-sonda > "$OUT/sonda/guardados.csv" || true
  LISTA=$(python3 -I "$AQUI/evaluar.py" lista "$OUT")
  [ -n "$LISTA" ] && break
done
if [ -n "$LISTA" ]; then
  echo "  lista en $(( (LISTA - T0) / 1000 )) s"
else
  echo "  NO quedó lista en 600 s"
fi
fase "$F" hasta_lista "$T0"

python3 -I - "$OUT/meta.json" <<PY
import json, sys
json.dump({"id": "$ID", "plataforma": "$PLAT", "fila": "$FILA", "ram_gb": $RAM, "repeticion": $REP, "piloto": bool($PILOTO), "semilla": $SEMILLA,
           "s1_s": $S1, "s2_s": $S2, "escenarios": ["s1"] + (["s2"] if $CON_S2 else []), "t0_docker_ms": $T0, "desfase_reloj_ms": $desfase,
           "ranura": $RANURA, "nucleos": open("$CACHE/maquinas/$MAQ/arranque.txt").read().split("nucleos=")[1].split()[0],
           "disco_instalado": "$P_DISCO", "anfitrion_nucleo": "$(uname -r)", "qemu": "$(qemu-system-x86_64 --version | head -1)"},
          open(sys.argv[1], "w"), indent=1, ensure_ascii=False)
PY

if [ -n "$LISTA" ]; then
  # ── 3. S1: reposo con la escala del campus (10 dispositivos, uno cada 60 s) ──
  t=$(ms); "${GEN[@]}" --dispositivos 10 --periodo-ms 60000 --duracion-s "$S1" --salida "$OUT/s1" > "$OUT/s1/generador.log" 2>&1 || true
  fase "$F" s1 "$t"; tail -n 1 "$OUT/s1/generador.log"
  # ── 4. S2: un inicio de sesión y una consulta de historial, y 100 dispositivos a ≈ 50 mensajes/s ──
  if [ "$CON_S2" = 1 ]; then
    t=$(ms); p_sesion_historial > "$OUT/s2/sesion.csv" 2>&1 || true
    "${GEN[@]}" --dispositivos 100 --periodo-ms 2000 --duracion-s "$S2" --salida "$OUT/s2" > "$OUT/s2/generador.log" 2>&1 || true
    fase "$F" s2 "$t"; tail -n 1 "$OUT/s2/generador.log"
  fi
fi
kill "$SONDA_PID" 2>/dev/null || true; wait "$SONDA_PID" 2>/dev/null || true; SONDA_PID=

# ── 5. Conteo estable: 60 s sin cambios, tope 600 s (ThingsBoard escribe por lotes) ──
t=$(ms); ant=; igual_desde=$(ms)
while [ $(( $(ms) - t )) -lt 600000 ]; do
  c=$(p_conteo "$T0" || echo "?")
  if [ "$c" != "$ant" ]; then ant=$c; igual_desde=$(ms); fi
  [ $(( $(ms) - igual_desde )) -ge 60000 ] && break
  sleep 10
done
fase "$F" conteo_estable "$t"; echo "  filas de la corrida en la base: $ant"
for e in s1 s2; do
  [ -f "$OUT/$e/resumen.json" ] || continue
  read -r d h < <(python3 -I -c 'import json,sys; r=json.load(open(sys.argv[1])); print(r["ventana_desde_ms"], r["ventana_hasta_ms"] + 5000)' "$OUT/$e/resumen.json")
  p_guardados "$d" "$h" 'tt40-d%' > "$OUT/$e/guardados.csv"
done
p_guardados "$T0" "$(ms)" tt40-sonda > "$OUT/sonda/guardados.csv" || true
p_extra > "$OUT/extra.csv" || true

# ── 6. Estado final: reinicios y muertes por memoria por contenedor, eventos, núcleo, imágenes ──
# Por pid, nunca con pkill -f: la orden remota contiene el mismo texto y se mataba a sí misma (pilotos 1 y 2: la corrida moría aquí).
en 'kill $(cat ~/muestreo.pid) $(cat ~/eventos.pid) 2>/dev/null; sleep 2; true' || true
bash "$AQUI/vm.sh" ssh "$RANURA" 'tar -C ~ -cf - muestras eventos.log muestreo.log' | tar -C "$OUT" -xf - 2>/dev/null || true
{ echo "contenedor,reinicios,oom,estado"; en 'docker inspect -f "{{.Name}},{{.RestartCount}},{{.State.OOMKilled}},{{.State.Status}}" $(docker ps -aq) | sed "s#^/##"'; } > "$OUT/estado-final.csv"
en 'sudo dmesg | grep -iE "out of memory|oom-kill|killed process" || true' > "$OUT/oom-nucleo.txt"
en 'docker image ls --digests --format "{{.Repository}} {{.Digest}} {{.Size}}"; docker version --format "docker {{.Server.Version}}"; uname -r' > "$OUT/versiones.txt"

# ── 7. Contador plantado (opcional): borrar un punto de S1 y evaluar de nuevo; debe NO aprobar ──
if [ "$PLANTAR" = 1 ] && [ -f "$OUT/s1/resumen.json" ]; then
  python3 -I "$AQUI/evaluar.py" corrida "$OUT" > "$OUT/evaluacion.txt" || true
  cp "$OUT/resultado.json" "$OUT/resultado-antes-de-plantar.json"
  read -r d h < <(python3 -I -c 'import json,sys; r=json.load(open(sys.argv[1])); print(r["ventana_desde_ms"], r["ventana_hasta_ms"] + 5000)' "$OUT/s1/resumen.json")
  borrados=$(p_plantar_borrar "$d" "$h" | grep -cx 1 || true)
  mkdir -p "$OUT/plantado"; cp -r "$OUT"/{meta.json,sonda,s2,muestras,estado-final.csv} "$OUT/plantado/" 2>/dev/null || true
  mkdir -p "$OUT/plantado/s1"; cp "$OUT"/s1/{resumen.json,confirmados.csv} "$OUT/plantado/s1/"
  p_guardados "$d" "$h" 'tt40-d%' > "$OUT/plantado/s1/guardados.csv"
  rc=0; python3 -I "$AQUI/evaluar.py" corrida "$OUT/plantado" > "$OUT/plantado/evaluacion.txt" 2>&1 || rc=$?
  # Solo vale «NO aprueba POR el punto borrado»: un error del evaluador también sale distinto de 0 y no prueba nada.
  if [ "$borrados" != 1 ]; then
    echo "  CONTADOR PLANTADO: FALLA (se borraron $borrados filas, se esperaba 1)" | tee "$OUT/plantado/veredicto.txt"
  elif [ "$rc" = 0 ]; then
    echo "  CONTADOR PLANTADO: FALLA (se borraron $borrados filas y la corrida sigue aprobando)" | tee "$OUT/plantado/veredicto.txt"
  elif [ "$rc" != 1 ] || ! grep -q 's1: 1 puntos confirmados que no están guardados' "$OUT/plantado/evaluacion.txt"; then
    echo "  CONTADOR PLANTADO: FALLA (el evaluador salió con $rc sin nombrar el punto borrado: ver $OUT/plantado/evaluacion.txt)" | tee "$OUT/plantado/veredicto.txt"
  else
    echo "  contador plantado: OK (se borró $borrados punto de S1 y la evaluación NO aprueba: $(grep -o 's1: [0-9]* puntos[^,;]*' "$OUT/plantado/evaluacion.txt" | head -1))" | tee "$OUT/plantado/veredicto.txt"
  fi
fi

t=$(ms); vm apagar "$MAQ" || true; fase "$F" apagado "$t"
vm borrar "$MAQ"; trap - EXIT
python3 -I "$AQUI/evaluar.py" corrida "$OUT" | tee "$OUT/evaluacion.txt" || true
echo "datos: $OUT"
