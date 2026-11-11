#!/usr/bin/env bash
# Mediciones del tablero v2 contra el backend del banco (docs/16 §61). Requiere `banco.sh encender 120` y la semilla de la serie
# (tablero-semilla-serie.sql). Lee como usuario del sistema con la clave de descarte del banco, por la entrada estándar de curl.
#   bash plataforma/pruebas/banco/tablero-medir.sh tiempos      mediana de 10 peticiones (tras una de calentamiento) por ruta y rango
#   bash plataforma/pruebas/banco/tablero-medir.sh lote N P      POST /dispositivos/lote?modo=crear con N filas (vía http, sin broker:
#                                                               solo el costo de scrypt) e id_fisico P-0000…; a los 2 s, un alta
#                                                               individual a la vez: cuánto espera su scrypt detrás del lote
set -u; export LC_ALL=C
ENV="${XDG_RUNTIME_DIR:-$HOME/.cache}/plataforma-banco/banco.env"
[ -f "$ENV" ] || { echo "FALLA sin $ENV: primero banco.sh encender"; exit 1; }
api() { printf 'X-Clave-Admin: %s\n' "$(grep -E '^HTTP_CLAVE_ADMIN=' "$ENV" | cut -d= -f2-)" | curl -s -H @- "$@"; }
B=http://127.0.0.1:3001
d() { date -u -d "$1" +%Y-%m-%dT%H:%M:%SZ; }
case "${1:-}" in
  tiempos)
    SITIO=$(api "$B/sitios" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)[0]["id"])')
    DISP=$(api "$B/dispositivos?q=emu-0001" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)[0]["id"])')
    H=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    mediana() { api -o /dev/null "$1"; for _ in $(seq 10); do api -o /dev/null -w '%{time_total} %{size_download} %{http_code}\n' "$1"; done \
      | sort -n | awk '{a[NR]=$1; b=$2; c=$3} END {printf "%.1f ms  %s B  HTTP %s\n", (a[5]+a[6])/2*1000, b, c}'; }
    for r in "1 hour ago" "24 hours ago" "7 days ago" "30 days ago"; do echo "resumen [$r]: $(mediana "$B/sitios/$SITIO/resumen?desde=$(d "$r")&hasta=$H")"; done
    echo "resumen 30 días · 1 hora: $(mediana "$B/sitios/$SITIO/resumen?desde=$(d '30 days ago')&hasta=$H&intervalo=1%20hour")"
    for i in "6%20hours" "1%20hour"; do echo "histórico del sitio 30 días · $i: $(mediana "$B/sitios/$SITIO/historico?magnitud=temperatura&desde=$(d '30 days ago')&hasta=$H&intervalo=$i")"; done
    echo "histórico del sitio 24 h · 5 minutos: $(mediana "$B/sitios/$SITIO/historico?magnitud=temperatura&desde=$(d '24 hours ago')&hasta=$H&intervalo=5%20minutes")"
    echo "histórico del dispositivo 30 días · 1 hora: $(mediana "$B/dispositivos/$DISP/historico?desde=$(d '30 days ago')&hasta=$H&intervalo=1%20hour")"
    echo "inventario: $(mediana "$B/dispositivos")"
    echo "inventario orden=entrega limite=50: $(mediana "$B/dispositivos?orden=entrega&limite=50")" ;;
  lote)
    N="${2:?N filas}"; P="${3:?prefijo de id_fisico}"; T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
    ZONA=$(api "$B/sitios" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)[0]["zonas"][0]["id"])')
    python3 -I -c "import json,sys; n,p=int(sys.argv[1]),sys.argv[2]; print(json.dumps({'filas':[{'id_fisico':'%s-%04d'%(p,i),'nombre':'lote','zona':sys.argv[3],'via':'http','intervalo_esperado_s':'60','canales':'temperatura:Cel'} for i in range(n)]}))" "$N" "$P" "$ZONA" > "$T/lote.json"
    ( sleep 2; api -o /dev/null -w "alta individual a la vez: %{time_total} s · HTTP %{http_code}\n" -X POST "$B/dispositivos" -H 'Content-Type: application/json' \
        -d "{\"id_fisico\":\"$P-solo\",\"nombre\":\"solo\",\"zona_id\":\"$ZONA\",\"via\":\"http\",\"intervalo_esperado_s\":60,\"canales\":[{\"magnitud\":\"temperatura\"}]}" ) &
    api -o "$T/r.json" -w "lote de $N, modo=crear: %{time_total} s · HTTP %{http_code}\n" -X POST "$B/dispositivos/lote?modo=crear" -H 'Content-Type: application/json' --data-binary @"$T/lote.json"
    wait
    python3 -I -c "import json,sys; r=json.load(open(sys.argv[1])); print('creadas:', sum(f['resultado']=='creada' for f in r['filas']))" "$T/r.json" 2>/dev/null || echo "sin informe (¿se cortó la conexión?)" ;;
  *) sed -n '2,8p' "$0"; exit 1 ;;
esac
