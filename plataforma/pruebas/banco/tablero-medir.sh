#!/usr/bin/env bash
# Mediciones del tablero v2 contra el backend del banco (docs/16 §61, §65, §66 y §68). `tiempos` requiere `banco.sh encender 120` y la semilla de la
# serie (tablero-semilla-serie.sql); `lote` y `verificacion`, solo `banco.sh encender`. Lee y escribe como usuario del sistema con la clave
# de descarte del banco, por la entrada estándar de curl; los tokens creados para medir viajan igual y nunca se imprimen. Lo que se crea
# vive en el banco (datos en RAM) y desaparece con `banco.sh apagar`.
#   bash plataforma/pruebas/banco/tablero-medir.sh tiempos          mediana de 10 peticiones (tras una de calentamiento) por ruta y rango
#   bash plataforma/pruebas/banco/tablero-medir.sh ahora [CÓDIGO]   «Ahora» (docs/16 §66): en la misma corrida, la mediana del resumen (24 h) y
#                                                                   de GET /sitios/{id}/ahora sin tendencia, con ella y con ella y limite=60, del
#                                                                   sitio CÓDIGO («banco», el de los emulados, por defecto; §66 mide también uno de
#                                                                   2 000 dispositivos); el ritmo lo pone tablero-semilla-ahora.sql
#   bash plataforma/pruebas/banco/tablero-medir.sh historico [CÓDIGO] [HASTA]  el histórico del sitio (docs/19 §4, M6) con los cuatro rangos del panel y
#                                                                   un `hasta` fijo, para medir el antes y el después sobre la misma ventana
#   bash plataforma/pruebas/banco/tablero-medir.sh lote N P [VIA]   POST /dispositivos/lote?modo=crear con N filas de vía VIA (http, por
#                                                                   defecto: sin broker, solo el costo del resumen de cada credencial; mqtt:
#                                                                   además las órdenes al broker) e id_fisico P-0000…; a los 2 s, un alta
#                                                                   individual a la vez: cuánto espera detrás del lote
#   bash plataforma/pruebas/banco/tablero-medir.sh verificacion K P K dispositivos http (lote) y, por cada uno, POST /recepcion: la primera
#                                                                   trama (verifica la huella), la segunda (ya verificada) y un token
#                                                                   equivocado; más K identificadores inexistentes. Mediana de cada grupo
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
  ahora)
    SITIO=$(api "$B/sitios" | python3 -I -c 'import json,sys; print([s["id"] for s in json.load(sys.stdin) if s["codigo"]==sys.argv[1]][0])' "${2:-banco}")
    mediana() { api -o /dev/null "$1"; for _ in $(seq 10); do api -o /dev/null -w '%{time_total} %{size_download} %{http_code}\n' "$1"; done \
      | sort -n | awk '{a[NR]=$1; b=$2; c=$3} END {printf "%.1f ms  %s B  HTTP %s\n", (a[5]+a[6])/2*1000, b, c}'; }
    api "$B/sitios/$SITIO/ahora" | python3 -I -c 'import json,sys; r=json.load(sys.stdin); print("reportan", r["reportan"], "· sin señal", r["sin_senal"], "· por magnitud", [(m["codigo"], m["canales"]) for m in r["por_magnitud"]])'
    echo "resumen (24 h): $(mediana "$B/sitios/$SITIO/resumen")"
    echo "ahora: $(mediana "$B/sitios/$SITIO/ahora")"
    echo "ahora?tendencia=si: $(mediana "$B/sitios/$SITIO/ahora?tendencia=si")"
    echo "ahora?tendencia=si&limite=60: $(mediana "$B/sitios/$SITIO/ahora?tendencia=si&limite=60")" ;;
  historico)
    # docs/19 §4, M6: GET /sitios/{id}/historico con los cuatro rangos del panel (1 h · 1 minuto, 24 h · 15 minutos, 7 días · 1 hora y 30 días
    # · 6 horas), del sitio CÓDIGO, con un `hasta` FIJO (HASTA, ISO; por defecto, ahora): así el antes y el después leen exactamente la misma
    # ventana aunque se midan con horas de diferencia. Con GUARDAR=<carpeta> deja además cada respuesta en <carpeta>/<rango>.json (para
    # comparar el antes y el después campo a campo); esa carpeta va fuera del repositorio.
    SITIO=$(api "$B/sitios" | python3 -I -c 'import json,sys; print([s["id"] for s in json.load(sys.stdin) if s["codigo"]==sys.argv[1]][0])' "${2:-banco}")
    H="${3:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"; MAG="${MAGNITUD:-temperatura}"
    mediana() { api -o /dev/null "$1"; for _ in $(seq 10); do api -o /dev/null -w '%{time_total} %{size_download} %{http_code}\n' "$1"; done \
      | sort -n | awk '{a[NR]=$1; b=$2; c=$3} END {printf "%.1f ms  %s B  HTTP %s\n", (a[5]+a[6])/2*1000, b, c}'; }
    echo "sitio ${2:-banco} · magnitud $MAG · hasta $H"
    for r in "1h|1 hour|1%20minute" "24h|24 hours|15%20minutes" "7d|7 days|1%20hour" "30d|30 days|6%20hours"; do
      IFS='|' read -r clave atras inter <<< "$r"
      u="$B/sitios/$SITIO/historico?magnitud=$MAG&desde=$(date -u -d "$H - $atras" +%Y-%m-%dT%H:%M:%SZ)&hasta=$H&intervalo=$inter"
      [ -n "${GUARDAR:-}" ] && api -o "$GUARDAR/$clave.json" "$u"
      echo "histórico del sitio $clave · ${inter//%20/ }: $(mediana "$u")"
    done ;;
  lote)
    N="${2:?N filas}"; P="${3:?prefijo de id_fisico}"; VIA="${4:-http}"; T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
    [[ "$VIA" =~ ^(http|mqtt)$ ]] || { echo "FALLA vía «$VIA»: http o mqtt"; exit 1; }
    ZONA=$(api "$B/sitios" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)[0]["zonas"][0]["id"])')
    python3 -I -c "import json,sys; n,p,v=int(sys.argv[1]),sys.argv[2],sys.argv[4]; print(json.dumps({'filas':[{'id_fisico':'%s-%04d'%(p,i),'nombre':'lote','zona':sys.argv[3],'via':v,'intervalo_esperado_s':'60','canales':'temperatura:Cel'} for i in range(n)]}))" "$N" "$P" "$ZONA" "$VIA" > "$T/lote.json"
    ( sleep 2; api -o /dev/null -w "alta individual a la vez: %{time_total} s · HTTP %{http_code}\n" -X POST "$B/dispositivos" -H 'Content-Type: application/json' \
        -d "{\"id_fisico\":\"$P-solo\",\"nombre\":\"solo\",\"zona_id\":\"$ZONA\",\"via\":\"$VIA\",\"intervalo_esperado_s\":60,\"canales\":[{\"magnitud\":\"temperatura\"}]}" ) &
    api -o "$T/r.json" -w "lote de $N ($VIA), modo=crear: %{time_total} s · HTTP %{http_code}\n" -X POST "$B/dispositivos/lote?modo=crear" -H 'Content-Type: application/json' --data-binary @"$T/lote.json"
    wait
    python3 -I -c "import json,sys; r=json.load(open(sys.argv[1])); print('creadas:', sum(f['resultado']=='creada' for f in r['filas']))" "$T/r.json" 2>/dev/null || echo "sin informe (¿se cortó la conexión?)" ;;
  verificacion)
    K="${2:?K dispositivos}"; P="${3:?prefijo de id_fisico}"; T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
    # Menos de 50 fallos por dirección en total (2K < 50): el tope grueso por dirección (docs/10 §8.4 punto 52 (c)) no entra en la medida.
    [ "$K" -ge 1 ] && [ $((2 * K)) -lt 50 ] || { echo "FALLA K entre 1 y 24 (2K fallos desde una dirección; el tope es 50)"; exit 1; }
    ZONA=$(api "$B/sitios" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)[0]["zonas"][0]["id"])')
    python3 -I -c "import json,sys; k,p=int(sys.argv[1]),sys.argv[2]; print(json.dumps({'filas':[{'id_fisico':'%s-%04d'%(p,i),'nombre':'verificacion','zona':sys.argv[3],'via':'http','intervalo_esperado_s':'60','canales':'temperatura:Cel'} for i in range(k)]}))" "$K" "$P" "$ZONA" > "$T/lote.json"
    api -s -o "$T/r.json" -X POST "$B/dispositivos/lote?modo=crear" -H 'Content-Type: application/json' --data-binary @"$T/lote.json"
    # id_fisico TAB token, a un archivo de la carpeta temporal (modo 600 por mktemp -d); nunca a la salida.
    python3 -I -c "import json,sys; r=json.load(open(sys.argv[1])); [print(f['id_fisico']+'\t'+f['credencial']) for f in r['filas'] if f['resultado']=='creada']" "$T/r.json" > "$T/tokens" \
      || { echo "FALLA el lote no devolvió credenciales"; exit 1; }
    [ "$(wc -l < "$T/tokens")" = "$K" ] || { echo "FALLA se crearon $(wc -l < "$T/tokens") de $K"; exit 1; }
    trama() { printf 'Authorization: Bearer %s\n' "$2" | curl -s -o /dev/null -w '%{time_total} %{http_code}\n' -H @- -X POST "$B/recepcion/$1" \
      -H 'Content-Type: application/senml+json' --data-binary "[{\"n\":\"temperatura\",\"u\":\"Cel\",\"v\":21.5,\"bt\":$(date +%s)}]"; }
    while IFS=$'\t' read -r id tok; do trama "$id" "$tok" >> "$T/primera"; done < "$T/tokens"
    sleep 1.2   # el ritmo admite una trama por segundo por dispositivo (punto 52 (e))
    while IFS=$'\t' read -r id tok; do trama "$id" "$tok" >> "$T/segunda"; done < "$T/tokens"
    while IFS=$'\t' read -r id _; do trama "$id" "token-equivocado-con-32-simbolos" >> "$T/equivocado"; done < "$T/tokens"
    for i in $(seq "$K"); do trama "$P-nadie-$i" "token-equivocado-con-32-simbolos" >> "$T/inexistente"; done
    for g in primera segunda equivocado inexistente; do
      sort -n "$T/$g" | awk -v g="$g" '{a[NR]=$1; c[$2]++} END {m=(NR%2)?a[(NR+1)/2]:(a[NR/2]+a[NR/2+1])/2; s=""; for (k in c) s=s k "×" c[k] " ";
        printf "%-12s mediana %.1f ms · mín %.1f · máx %.1f · HTTP %s\n", g, m*1000, a[1]*1000, a[NR]*1000, s}'
    done ;;
  *) sed -n '2,21p' "$0"; exit 1 ;;
esac
