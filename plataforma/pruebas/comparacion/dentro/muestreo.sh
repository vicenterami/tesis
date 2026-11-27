#!/usr/bin/env bash
# Muestreo DENTRO de la máquina medida, cada 1 s (docs/23 §6.2). Solo lectura de archivos del núcleo, sin lanzar un cliente por muestra
# (por eso no usa `docker stats`): /proc/meminfo, /proc/pressure/{memory,cpu}, /proc/vmstat (oom_kill) y, por contenedor, los archivos de
# su cgroup v2 (memory.current, memory.peak, memory.events: oom_kill). El máximo muestreado es una cota inferior del máximo real (entre
# dos muestras puede haber un pico más alto); memory.peak del cgroup sí guarda el máximo real de cada contenedor.
#   bash muestreo.sh CARPETA            hasta recibir SIGTERM; escribe CARPETA/sistema.csv y CARPETA/contenedores.csv
# Los contenedores se descubren cada 5 s (pueden aparecer después de que arranque Docker); su nombre sale de `docker ps` en ese momento.
set -u
D=${1:?CARPETA}; mkdir -p "$D"
S="$D/sistema.csv"; C="$D/contenedores.csv"
echo "t_ms,mem_total_kb,mem_disponible_kb,mem_usada_kb,psi_mem_some_us,psi_mem_full_us,psi_cpu_some_us,oom_kill_total" > "$S"
echo "t_ms,contenedor,memory_current_b,memory_peak_b,oom_kill" > "$C"
declare -A RUTA=()
descubrir() {
  local id nom
  command -v docker >/dev/null || return 0
  while read -r id nom; do
    [ -n "$id" ] || continue
    for p in /sys/fs/cgroup/system.slice/docker-"$id"*.scope; do [ -d "$p" ] && RUTA[$nom]=$p; done
  done < <(docker ps --no-trunc --format '{{.ID}} {{.Names}}' 2>/dev/null)
}
psi_total() { local l; while read -r l; do case $l in "$2"*) l=${l##*total=}; echo "$l"; return;; esac; done < "$1"; echo; }
seguir=1; trap 'seguir=0' TERM INT
n=0
while [ $seguir = 1 ]; do
  t=$(date +%s%3N)
  tot= dis=
  while read -r k v _; do case $k in MemTotal:) tot=$v;; MemAvailable:) dis=$v; break;; esac; done < /proc/meminfo
  oom=; while read -r k v; do [ "$k" = oom_kill ] && { oom=$v; break; }; done < /proc/vmstat
  echo "$t,$tot,$dis,$((tot - dis)),$(psi_total /proc/pressure/memory some),$(psi_total /proc/pressure/memory full),$(psi_total /proc/pressure/cpu some),$oom" >> "$S"
  [ $((n % 5)) = 0 ] && descubrir
  for nom in "${!RUTA[@]}"; do
    p=${RUTA[$nom]}; [ -r "$p/memory.current" ] || continue
    read -r cur < "$p/memory.current"; pk=; [ -r "$p/memory.peak" ] && read -r pk < "$p/memory.peak"
    ok=; while read -r k v; do [ "$k" = oom_kill ] && ok=$v; done < "$p/memory.events"
    echo "$t,$nom,$cur,$pk,$ok" >> "$C"
  done
  n=$((n + 1))
  # Al próximo segundo entero: el muestreo no se corre por lo que tardó la vuelta.
  ahora=$(date +%s%3N); espera=$(( 1000 - ahora % 1000 )); sleep "0.$(printf '%03d' $((espera == 1000 ? 999 : espera)))"
done
