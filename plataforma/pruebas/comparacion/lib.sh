# Funciones comunes de los guiones de la comparación (docs/23). Se carga con `. lib.sh` después de fijar RANURA.
# Nunca imprime una clave: las que se generan van a archivos 600 en la caché, y a la máquina por la entrada estándar.
AQUI=${AQUI:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}
. "$AQUI/versiones.env"
CACHE=${BANCO_CACHE:-$HOME/.cache/tesis-comparacion}
PBASE=${BANCO_PUERTO_BASE:-42000}
INST="$CACHE/instalaciones"          # credenciales y datos de cada instalación (fuera del repositorio)
DATOS=${BANCO_DATOS:-$CACHE/datos}   # datos crudos de cada corrida
umask 077                            # antes de crear nada: carpetas 700 y archivos 600 (discos, credenciales, datos)
mkdir -p "$INST" "$DATOS"

puerto() { echo $((PBASE + 100 * RANURA + $1)); }
vm() { bash "$AQUI/vm.sh" "$@"; }
en() { bash "$AQUI/vm.sh" ssh "$RANURA" "$@"; }             # en la máquina de la RANURA
ms() { date +%s%3N; }
clave_nueva() { openssl rand -base64 24 | tr '+/' '-_'; }    # 32 caracteres del alfabeto de base64 para URL (sin comillas ni barras)
# fase ARCHIVO NOMBRE T0_MS: anota cuánto duró una fase (CSV fase,inicio_utc,segundos)
fase() { local s; s=$(LC_ALL=C awk -v a="$3" -v b="$(ms)" 'BEGIN{printf "%.1f", (b-a)/1000}'); echo "$2,$(date -u -d @$(($3/1000)) +%FT%TZ),$s" >> "$1"; echo "  fase $2: $s s"; }
falla() { echo "FALLA $*" >&2; exit 1; }
# esperar_http URL TOPE_S [opciones curl…]: hasta que responda 2xx
esperar_http() { local u=$1 tope=$2 t0=$SECONDS; shift 2; while [ $((SECONDS - t0)) -lt "$tope" ]; do curl -fsS -o /dev/null -m 5 "$@" "$u" 2>/dev/null && return 0; sleep 2; done; return 1; }
