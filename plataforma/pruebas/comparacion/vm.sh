#!/usr/bin/env bash
# Máquinas virtuales de la comparación medida (docs/23 §3). QEMU directo con KVM, sin privilegios: red de usuario (sin puentes ni tap),
# disco qcow2 con cache=none, 2 vCPU, RAM por parámetro, sin globo de memoria (-nodefaults no agrega ningún dispositivo que no esté aquí),
# sin intercambio. Todo lo pesado vive en BANCO_CACHE (por omisión ~/.cache/tesis-comparacion), nunca en el repositorio.
#
#   bash vm.sh base                       descarga la imagen de la nube (comprueba la suma), crea la base con cloud-init (Docker fijado,
#                                         temporizadores apagados) y la deja apagada: maquinas/base/disco.qcow2
#   bash vm.sh crear NOMBRE PADRE         disco nuevo NOMBRE, instantánea encima del disco de la máquina PADRE (qemu-img, copia en escritura)
#   bash vm.sh arrancar NOMBRE RAM_GB RANURA   arranca NOMBRE con RAM_GB GiB en la RANURA de puertos (0, 1, 2…) y espera SSH (máx. 180 s)
#   bash vm.sh ssh RANURA [orden…]        entra (o corre la orden) como `banco`
#   bash vm.sh copiar RANURA ORIGEN… DESTINO   scp hacia la máquina (DESTINO relativo a /home/banco)
#   bash vm.sh apagar NOMBRE              apagado limpio (ACPI); si en 120 s no se apaga, lo corta y sale con 1
#   bash vm.sh borrar NOMBRE              borra la carpeta de la máquina (solo si está apagada y no es la base)
#   bash vm.sh lista                      máquinas y si están encendidas
#
# Puertos de la RANURA r en el anfitrión, solo en 127.0.0.1 (base B = BANCO_PUERTO_BASE + 100·r, 42000 por omisión):
#   B+22 → 22 (SSH) · B+43 → 443 (HTTPS) · B+80 → 8080 (HTTP) · B+83 → 8883 y B+18 → 1883 por la red A · B+84 → 8883 y B+19 → 1883 por la red B
# Las dos redes de usuario tienen subred propia, internas de QEMU (no existen fuera de él): se usan los bloques de documentación del
# RFC 5737 (192.0.2.0/24 y 198.51.100.0/24) para no escribir direcciones privadas reales. Las dos direcciones MAC de las tarjetas llevan el
# prefijo 52:54:00, el que QEMU usa por convención (bit de administración local activo: no son de ningún fabricante ni identifican un equipo);
# están fijas porque maquina/network-config elige cada tarjeta por su MAC. Lo que entra por la red A llega a la máquina
# desde la puerta de esa subred (.2) y lo que entra por la B, desde la de la otra (docs/23 §3.3).
# Núcleos: la ranura r se fija a los hilos BANCO_CPUS_r (por omisión r=0 → 2,3; r=1 → 4,5; r=2 → 6,7), con taskset sobre todos los hilos de QEMU.
set -euo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
. "$AQUI/versiones.env"
CACHE=${BANCO_CACHE:-$HOME/.cache/tesis-comparacion}
MAQ="$CACHE/maquinas"
LLAVE="$CACHE/llave-banco"
PBASE=${BANCO_PUERTO_BASE:-42000}
mkdir -p "$MAQ"

puerto() { echo $((PBASE + 100 * $1 + $2)); }
nucleos() { local v="BANCO_CPUS_$1"; [ -n "${!v:-}" ] && { echo "${!v}"; return; }; echo "$((2 + 2 * $1)),$((3 + 2 * $1))"; }
opciones_ssh() { echo "-i $LLAVE -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5 -o ServerAliveInterval=15"; }
encendida() { local p="$MAQ/$1/qemu.pid"; [ -f "$p" ] && kill -0 "$(cat "$p")" 2>/dev/null; }
monitor() { python3 -I -c 'import socket,sys,time
s=socket.socket(socket.AF_UNIX); s.settimeout(10); s.connect(sys.argv[1]); time.sleep(0.2); s.recv(4096)
s.sendall((sys.argv[2]+"\n").encode()); time.sleep(0.3); s.close()' "$MAQ/$1/monitor.sock" "$2"; }

llave() { [ -f "$LLAVE" ] || ssh-keygen -q -t ed25519 -N '' -C banco-comparacion -f "$LLAVE"; }

# lanzar NOMBRE RAM_GB RANURA [semilla.iso]
lanzar() {
  local n=$1 ram=$2 r=$3 semilla=${4:-} d="$MAQ/$1"
  [ -f "$d/disco.qcow2" ] || { echo "FALLA no existe el disco de $n"; exit 1; }
  encendida "$n" && { echo "FALLA $n ya está encendida"; exit 1; }
  local fa="hostfwd=tcp:127.0.0.1:$(puerto "$r" 22)-:22,hostfwd=tcp:127.0.0.1:$(puerto "$r" 43)-:443,hostfwd=tcp:127.0.0.1:$(puerto "$r" 80)-:8080"
  fa="$fa,hostfwd=tcp:127.0.0.1:$(puerto "$r" 83)-:8883,hostfwd=tcp:127.0.0.1:$(puerto "$r" 18)-:1883"
  local fb="hostfwd=tcp:127.0.0.1:$(puerto "$r" 84)-:8883,hostfwd=tcp:127.0.0.1:$(puerto "$r" 19)-:1883"
  local extra=()
  [ -n "$semilla" ] && extra=(-drive "file=$semilla,if=virtio,format=raw,readonly=on")
  rm -f "$d/monitor.sock"
  qemu-system-x86_64 -name "tt40-$n" -machine q35,accel=kvm -cpu host -smp 2 -m "${ram}G" -nodefaults -display none -vga none \
    -drive "file=$d/disco.qcow2,if=virtio,format=qcow2,cache=none,aio=native" "${extra[@]}" \
    -netdev "user,id=na,net=192.0.2.0/24,$fa" -device virtio-net-pci,netdev=na,mac=52:54:00:40:00:0a \
    -netdev "user,id=nb,net=198.51.100.0/24,$fb" -device virtio-net-pci,netdev=nb,mac=52:54:00:40:00:0b \
    -object rng-random,filename=/dev/urandom,id=rng0 -device virtio-rng-pci,rng=rng0 \
    -serial "file:$d/serial.log" -monitor "unix:$d/monitor.sock,server,nowait" -pidfile "$d/qemu.pid" -daemonize
  taskset -a -cp "$(nucleos "$r")" "$(cat "$d/qemu.pid")" >/dev/null
  { echo "nombre=$n"; echo "ram_gb=$ram"; echo "ranura=$r"; echo "nucleos=$(nucleos "$r")"; echo "arranque_utc=$(date -u +%FT%TZ)"; } > "$d/arranque.txt"
}

esperar_ssh() { # RANURA TOPE_S
  local t0=$SECONDS
  while [ $((SECONDS - t0)) -lt "$2" ]; do
    # shellcheck disable=SC2046
    ssh $(opciones_ssh) -p "$(puerto "$1" 22)" banco@127.0.0.1 true 2>/dev/null && return 0
    sleep 2
  done
  return 1
}

esperar_apagado() { # NOMBRE TOPE_S
  local t0=$SECONDS
  while encendida "$1"; do [ $((SECONDS - t0)) -ge "$2" ] && return 1; sleep 1; done
}

case "${1:-}" in
  base)
    llave
    img="$CACHE/$IMAGEN_NUBE_ARCHIVO"
    if [ ! -f "$img" ]; then curl -fsSL -o "$img.parcial" "$IMAGEN_NUBE_URL" && mv "$img.parcial" "$img"; fi
    echo "$IMAGEN_NUBE_SHA256  $img" | sha256sum -c --quiet - || { echo "FALLA la suma de la imagen de la nube no coincide"; exit 1; }
    d="$MAQ/base"; [ -e "$d/disco.qcow2" ] && { echo "FALLA ya existe la base ($d): bórrala a mano si quieres rehacerla"; exit 1; }
    mkdir -p "$d/semilla"
    LLAVE_PUBLICA=$(cat "$LLAVE.pub") DOCKER_CE=$DOCKER_CE CONTAINERD=$CONTAINERD COMPOSE_PLUGIN=$COMPOSE_PLUGIN \
      BUILDX_PLUGIN=$BUILDX_PLUGIN DOCKER_GPG_HUELLA=$DOCKER_GPG_HUELLA \
      envsubst '${LLAVE_PUBLICA} ${DOCKER_CE} ${CONTAINERD} ${COMPOSE_PLUGIN} ${BUILDX_PLUGIN} ${DOCKER_GPG_HUELLA}' \
      < "$AQUI/maquina/user-data.plantilla" > "$d/semilla/user-data"
    cp "$AQUI/maquina/network-config" "$d/semilla/network-config"
    printf 'instance-id: tt40-base\nlocal-hostname: tt40\n' > "$d/semilla/meta-data"
    genisoimage -quiet -output "$d/semilla.iso" -volid cidata -joliet -rock "$d/semilla/user-data" "$d/semilla/meta-data" "$d/semilla/network-config"
    qemu-img create -q -f qcow2 -b "$img" -F qcow2 "$d/disco.qcow2" 20G
    t0=$SECONDS
    lanzar base "${BANCO_RAM_INSTALAR:-4}" "${BANCO_RANURA:-0}" "$d/semilla.iso"
    echo "base: primer arranque con cloud-init (instala Docker; se apaga sola al terminar)…"
    esperar_apagado base 1200 || { echo "FALLA la base no se apagó en 20 min: ver $d/serial.log"; exit 1; }
    # El marcador solo se imprime si `docker version` respondió (&& en user-data); se exige además la línea con la versión del servidor.
    grep -q BANCO-BASE-LISTA "$d/serial.log" && grep -aqE 'BANCO docker [0-9]' "$d/serial.log" || { echo "FALLA cloud-init no terminó o Docker no quedó instalado: ver $d/serial.log"; exit 1; }
    echo "base lista en $((SECONDS - t0)) s ($(grep -a -o 'BANCO docker [0-9.]*' "$d/serial.log" | head -1))" ;;
  crear)
    n=${2:?NOMBRE}; p=${3:?PADRE}; d="$MAQ/$n"
    [ -f "$MAQ/$p/disco.qcow2" ] || { echo "FALLA no existe el disco de $p"; exit 1; }
    encendida "$p" && { echo "FALLA $p está encendida: no se crea una instantánea encima de un disco en uso"; exit 1; }
    [ -e "$d" ] && { echo "FALLA ya existe $d"; exit 1; }
    mkdir -p "$d"; qemu-img create -q -f qcow2 -b "$MAQ/$p/disco.qcow2" -F qcow2 "$d/disco.qcow2"
    echo "$p" > "$d/padre" ;;
  arrancar)
    n=${2:?NOMBRE}; ram=${3:?RAM_GB}; r=${4:?RANURA}; llave
    lanzar "$n" "$ram" "$r"
    esperar_ssh "$r" 180 || { echo "FALLA $n no respondió por SSH en 180 s"; exit 1; } ;;
  ssh)
    r=${2:?RANURA}; shift 2
    # shellcheck disable=SC2046
    exec ssh $(opciones_ssh) -p "$(puerto "$r" 22)" banco@127.0.0.1 "$@" ;;
  copiar)
    r=${2:?RANURA}; shift 2; dest=${*: -1}; set -- "${@:1:$#-1}"
    # shellcheck disable=SC2046
    exec scp -q -r $(opciones_ssh) -P "$(puerto "$r" 22)" "$@" "banco@127.0.0.1:$dest" ;;
  apagar)
    n=${2:?NOMBRE}
    encendida "$n" || exit 0
    monitor "$n" system_powerdown
    esperar_apagado "$n" 120 && exit 0
    echo "AVISO $n no se apagó en 120 s: se corta"; monitor "$n" quit || kill "$(cat "$MAQ/$n/qemu.pid")"; exit 1 ;;
  borrar)
    n=${2:?NOMBRE}
    [ "$n" = base ] && { echo "FALLA la base no se borra con este guion"; exit 1; }
    encendida "$n" && { echo "FALLA $n está encendida"; exit 1; }
    hijos=$(grep -lx "$n" "$MAQ"/*/padre 2>/dev/null || true)
    [ -n "$hijos" ] && { echo "FALLA $n es padre de: $hijos"; exit 1; }
    rm -f "$MAQ/$n/disco.qcow2" "$MAQ/$n/qemu.pid" "$MAQ/$n/monitor.sock" "$MAQ/$n/serial.log" "$MAQ/$n/arranque.txt" "$MAQ/$n/padre"
    rmdir "$MAQ/$n" ;;
  lista)
    for d in "$MAQ"/*/; do n=$(basename "$d"); if encendida "$n"; then echo "$n encendida"; else echo "$n apagada"; fi; done ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
