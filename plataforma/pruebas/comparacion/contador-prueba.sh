#!/usr/bin/env bash
# Prueba plantada del contador y del veredicto (docs/23 §5.6), con datos sintéticos y sin máquina: N mensajes confirmados y sus 2N puntos
# guardados APRUEBAN; quitando un punto, NO; un repetido o un punto ajeno no compensan un faltante; un mensaje sin PUBACK, un reinicio, una
# muerte por memoria o «lista» después de 600 s, tampoco aprueban; ni una carga enviada a medias, un dispositivo sin conectar, una corrida
# sin muestras del sistema o sin estado final de los contenedores. Sale con 0 solo si todas las comprobaciones dan lo esperado, y cada caso
# que no debe aprobar exige además su MOTIVO en resultado.json (un error del evaluador también sale con 1 y no es lo que se prueba).
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
N=20; fallos=0; total=0
armar() { # carpeta limpia que aprueba: N mensajes de 2 dispositivos, 2N puntos guardados
  local d=$1; rm -rf "$d"; mkdir -p "$d"/{sonda,s1,muestras}
  echo '{"id":"sintetica","plataforma":"x","fila":"a","ram_gb":2,"repeticion":1,"piloto":true,"escenarios":["s1"],"t0_docker_ms":1000000}' > "$d/meta.json"
  printf 'id,ts_ms,enviado_ms,puback_ms\ntt40-sonda,1005000,1005000,1005010\n' > "$d/sonda/sonda.csv"
  printf 'tt40-sonda,temperatura,1005000\ntt40-sonda,humedad,1005000\n' > "$d/sonda/guardados.csv"
  echo '{"dispositivos":2,"periodo_ms":60000,"enviados":20,"confirmados":20,"reconexiones":0,"errores":{},"atraso_max_ms":3,"conectados_al_empezar":2,"ventana_desde_ms":1200000,"ventana_hasta_ms":1800000}' > "$d/s1/resumen.json"
  echo 'id,ts_ms,enviado_ms,puback_ms' > "$d/s1/confirmados.csv"; : > "$d/s1/guardados.csv"
  for k in $(seq 0 $((N / 2 - 1))); do for i in 1 2; do
    ts=$((1200000 + k * 60000 + i * 30000)); echo "tt40-d00$i,$ts,$ts,$((ts + 5))" >> "$d/s1/confirmados.csv"
    printf 'tt40-d00%s,temperatura,%s\ntt40-d00%s,humedad,%s\n' "$i" "$ts" "$i" "$ts" >> "$d/s1/guardados.csv"
  done; done
  printf 't_ms,mem_total_kb,mem_disponible_kb,mem_usada_kb,psi_mem_some_us,psi_mem_full_us,psi_cpu_some_us,oom_kill_total\n1200000,2000000,1500000,500000,0,0,0,0\n1800000,2000000,1400000,600000,0,0,0,0\n' > "$d/muestras/sistema.csv"
  echo "t_ms,contenedor,memory_current_b,memory_peak_b,oom_kill" > "$d/muestras/contenedores.csv"
  printf 'contenedor,reinicios,oom,estado\nplataforma-1,0,false,running\n' > "$d/estado-final.csv"
}
caso() { # descripción · salida esperada (0 aprueba, 1 no) · carpeta · [texto que debe traer algún motivo]
  total=$((total + 1)); rm -f "$3/resultado.json"
  python3 -I "$AQUI/evaluar.py" corrida "$3" > "$T/salida.txt" 2>&1; local c=$?
  if [ "$c" = "$2" ] && [ -n "${4:-}" ] && ! python3 -I -c 'import json,sys; sys.exit(0 if any(sys.argv[2] in m for m in json.load(open(sys.argv[1]))["motivos"]) else 1)' "$3/resultado.json" "$4" 2>/dev/null; then
    echo "FALLA $1: no aprueba, pero no por «$4» ($(cut -c1-200 "$T/salida.txt"))"; fallos=$((fallos + 1))
  elif [ "$c" = "$2" ]; then echo "OK    $1 → $(cut -c1-150 "$T/salida.txt")"; else echo "FALLA $1: salió $c, esperado $2 ($(cat "$T/salida.txt"))"; fallos=$((fallos + 1)); fi
}
D="$T/c"
armar "$D"; caso "N=$N mensajes, $((2 * N)) puntos guardados" 0 "$D"
total=$((total + 1))
[ "$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["escenarios"]["s1"]["puntos_esperados"])' "$D/resultado.json")" = $((2 * N)) ] \
  && echo "OK    el evaluador cuenta $((2 * N)) puntos esperados" || { echo "FALLA el evaluador no cuenta $((2 * N)) puntos esperados"; fallos=$((fallos + 1)); }
armar "$D"; sed -i '7d' "$D/s1/guardados.csv"; caso "quitando un punto guardado" 1 "$D" "puntos confirmados que no están guardados"
armar "$D"; sed -i '7d' "$D/s1/guardados.csv"; sed -n 1p "$D/s1/guardados.csv" >> "$D/s1/guardados.csv"; caso "un faltante y un repetido (mismo total bruto)" 1 "$D" "puntos confirmados que no están guardados"
armar "$D"; sed -i '7d' "$D/s1/guardados.csv"; echo "tt40-d009,humedad,1260000" >> "$D/s1/guardados.csv"; caso "un faltante y un punto ajeno (mismo total)" 1 "$D" "puntos confirmados que no están guardados"
armar "$D"; sed -i 's/"enviados":20/"enviados":21/' "$D/s1/resumen.json"; caso "un mensaje enviado sin PUBACK" 1 "$D" "sin PUBACK"
armar "$D"; sed -i 's/plataforma-1,0,false/plataforma-1,1,false/' "$D/estado-final.csv"; caso "un reinicio de contenedor" 1 "$D" "reinicios"
armar "$D"; sed -i '$ s/,0$/,1/' "$D/muestras/sistema.csv"; caso "una muerte por memoria del núcleo" 1 "$D" "muertes por memoria"
armar "$D"; sed -i 's/1005010/1700000/' "$D/sonda/sonda.csv"; caso "lista a los 700 s" 1 "$D" "lista en"
armar "$D"; sed -i 's/"ventana_hasta_ms":1800000/"ventana_hasta_ms":1920000/' "$D/s1/resumen.json"; caso "carga enviada a medias (20 de 24 declarados, todos guardados)" 1 "$D" "de la carga declarada"
armar "$D"; sed -i 's/"conectados_al_empezar":2/"conectados_al_empezar":1/' "$D/s1/resumen.json"; caso "un dispositivo sin conectar al empezar" 1 "$D" "conectados al empezar"
armar "$D"; rm "$D/muestras/sistema.csv"; caso "sin muestras del sistema" 1 "$D" "sin muestras del sistema"
armar "$D"; sed -i '2,$d' "$D/estado-final.csv"; caso "sin estado final de los contenedores" 1 "$D" "sin estado final"
armar "$D"; sed -i 's/^1200000,/1100000,/' "$D/muestras/sistema.csv"; caso "sin muestras dentro de la ventana de S1" 1 "$D" "sin muestras de memoria en su ventana"
[ "$fallos" = 0 ] && echo "contador-prueba: $total de $total comprobaciones" || echo "contador-prueba: $fallos FALLAS de $total comprobaciones"
exit $((fallos > 0))
