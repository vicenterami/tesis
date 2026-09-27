#!/usr/bin/env bash
# Levantar la pila y leer sus registros sin adivinar (docs/10 §6, docs/15 §0). Desde cualquier carpeta:
#   bash plataforma/pruebas/pila.sh encender            construye, levanta, espera «healthy», muestra estado
#   bash plataforma/pruebas/pila.sh estado              contenedores y GET /salud
#   bash plataforma/pruebas/pila.sh logs [servicio]     sigue en vivo (Ctrl+C sale) y copia a privado/logs/
#   bash plataforma/pruebas/pila.sh buscar TEXTO [min]  busca TEXTO en los últimos min minutos (30)
#   bash plataforma/pruebas/pila.sh resumen [min]       qué hizo el backend en los últimos min minutos (60)
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

case "${1:-}" in
  encender)
    dc up -d --build || exit 1
    echo "esperando «healthy» (máx. 90 s)…"
    for _ in $(seq 1 30); do
      [ -z "$(dc ps --format '{{.Status}}' | grep -v '(healthy)')" ] && break; sleep 3
    done
    bash "$YO" estado ;;
  estado)
    dc ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'
    printf 'GET /salud → '; curl -s -m 3 http://127.0.0.1:3000/salud || echo "sin respuesta"; echo ;;
  logs)
    mkdir -p "$LOGS"; f="$LOGS/pila-$(date +%F-%H%M%S).log"
    echo "copia cruda en $f (Ctrl+C para salir)"
    dc logs -f -t --no-color --since 1m "${@:2}" | tee -a "$f" | legible ;;
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
  detener)
    dc stop ;;
  *)
    sed -n '2,9p' "$YO"; exit 1 ;;
esac
