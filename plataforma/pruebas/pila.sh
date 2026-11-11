#!/usr/bin/env bash
# Levantar la pila y leer sus registros sin adivinar (docs/10 §6, docs/15 §0). Desde cualquier carpeta:
#   bash plataforma/pruebas/pila.sh encender            construye, levanta, espera «healthy», muestra estado
#   bash plataforma/pruebas/pila.sh estado              contenedores y GET /salud
#   bash plataforma/pruebas/pila.sh logs [servicio]     sigue en vivo (Ctrl+C sale) y copia a privado/logs/;
#                                                       oculta el chequeo de salud (PILA_TODO=1 lo muestra)
#   bash plataforma/pruebas/pila.sh buscar TEXTO [min]  busca TEXTO en los últimos min minutos (30)
#   bash plataforma/pruebas/pila.sh resumen [min]       qué hizo el backend en los últimos min minutos (60)
#   bash plataforma/pruebas/pila.sh sql ["CONSULTA"]    consulta la base (sin texto: consola interactiva, \q sale)
#   bash plataforma/pruebas/pila.sh detener             detiene los contenedores (stop: NO borra nada)
# Los instantes se muestran en UTC (sufijo Z), como todo instante de la plataforma (docs/13).
set -u
YO="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"   # ruta absoluta: sigue valiendo tras el cd
cd "$(dirname "$0")/.."                       # plataforma/: aquí están el compose y su override
dc() { docker compose "$@"; }
LOGS="../privado/logs"

# Una línea cruda de `docker compose logs -t` → «hh:mm:ssZ servicio NIVEL [contexto] mensaje».
# El backend escribe JSON (LOG_FORMATO=json); la base y el broker, texto: los dos se muestran igual.
legible() {
  while IFS= read -r l; do
    svc=${l%%|*}; svc=${svc// /}; resto=${l#*| }; ts=${resto%% *}; msg=${resto#* }
    if [[ $msg == \{* ]]; then
      jq -r --arg s "$svc" --arg t "${ts:11:8}Z" \
        '"\($t) \($s) \(.level|ascii_upcase) [\(.context // "-")] \(.message)"' <<<"$msg" 2>/dev/null || echo "$l"
    else echo "${ts:11:8}Z $svc $msg"; fi
  done
}

# Quita de la vista el ruido del chequeo de salud: las líneas de `sonda` y el «New connection from»
# que precede a cada cliente (el cliente real se sigue viendo en su línea «New client connected … u'id'»).
ruido() { if [ "${PILA_TODO:-0}" = 1 ]; then cat; else grep --line-buffered -vE "sonda|New connection from"; fi; }

case "${1:-}" in
  encender)
    t0=$SECONDS
    # El commit corto para «Acerca de» (docker-compose.yml lo pasa como ARG COMMIT al construir el backend). Si git falla (sin repositorio,
    # o sin git), vacío: la página dice commit null en vez de inventarlo.
    COMMIT=$(git rev-parse --short HEAD 2>/dev/null || true); export COMMIT
    dc up -d --build || exit 1
    echo "esperando «healthy» (máx. 90 s)…"
    sano=0
    for _ in $(seq 1 90); do
      [ -z "$(dc ps --format '{{.Status}}' | grep -v '(healthy)')" ] && { sano=1; break; }; sleep 1
    done
    # Cuánto tardó, medido cada vez (08/10/2026: con la pila detenida, ≈ 21 s hasta todo «healthy»; solo el backend, ≈ 5 s).
    if [ "$sano" = 1 ]; then echo "pila sana en $((SECONDS - t0)) s (construcción incluida)"
    else echo "AVISO tras $((SECONDS - t0)) s hay servicios sin «healthy»: revisar con «pila.sh estado» y «pila.sh logs»"; fi
    bash "$YO" estado ;;
  estado)
    dc ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'
    printf 'GET /salud → '; curl -s -m 3 http://127.0.0.1:3000/salud || echo "sin respuesta"; echo ;;
  logs)
    mkdir -p "$LOGS"; f="$LOGS/pila-$(date +%F-%H%M%S).log"
    echo "copia cruda en $f (Ctrl+C para salir)"
    # El chequeo de salud del broker (usuario `sonda`) se conecta cada 15 s: en la vista se oculta,
    # en la copia cruda queda todo. PILA_TODO=1 lo muestra también en la vista.
    dc logs -f -t --no-color --since 1m "${@:2}" | tee -a "$f" | ruido | legible ;;
  buscar)
    [ -n "${2:-}" ] || { echo "uso: pila.sh buscar TEXTO [minutos]"; exit 1; }
    dc logs -t --no-color --since "${3:-30}m" | grep -i -- "$2" | legible ;;
  resumen)
    m="${2:-60}"
    echo "backend, últimos $m min:"
    dc logs --no-color --since "${m}m" backend | sed 's/^[^|]*| //' | grep '^{' | jq -rs '
      "  por nivel:    " + (group_by(.level) | map("\(.[0].level)=\(length)") | join("  ")),
      "  guardadas:    " + ([.[] | select(.message | test("lecturas guardadas"))] | length | tostring) + " tramas",
      "  cuarentena:   " + ([.[] | select(.message | test("^cuarentena"))] | group_by(.message | capture("\\((?<m>[a-z]+)\\)").m)
                            | map("\(.[0].message | capture("\\((?<m>[a-z]+)\\)").m)=\(length)") | join("  ") | if . == "" then "0" else . end),
      "  condiciones:  " + ([.[] | select(.message | test("condición abierta"))] | length | tostring) + " abiertas, "
                         + ([.[] | select(.message | test("condición cerrada"))] | length | tostring) + " cerradas",
      "  errores:      " + ([.[] | select(.level == "error")] | length | tostring)' ;;
  sql)
    # La base vive dentro de su contenedor: psql se corre ahí, con el usuario de la plataforma.
    if [ -n "${2:-}" ]; then dc exec -T timescaledb psql -U plataforma -d plataforma -c "$2"
    else dc exec timescaledb psql -U plataforma -d plataforma; fi ;;
  detener)
    dc stop ;;
  *)
    sed -n '2,11p' "$YO"; exit 1 ;;
esac
