#!/usr/bin/env bash
# «Cualquier trama y cualquier serie de cualquier sensor es consultable» (docs/02, RF de consulta; docs/16 §48):
# para CADA dispositivo que lista la API recorre inventario → ficha → histórico de cada canal en los cuatro rangos del panel →
# exportación CSV y JSON → condiciones → cuarentena, y falla si alguna ruta responde con error, con una forma que no es la
# esperada, o si un dispositivo que SÍ tiene mediciones devuelve un histórico vacío en 24 h. Un dispositivo sin mediciones
# (recién dado de alta) legítimamente devuelve series vacías: se cuenta aparte, no falla.
#   bash plataforma/pruebas/banco/consultable.sh [URL]      (por defecto http://127.0.0.1:3000; sirve contra la pila o contra el banco)
set -euo pipefail
API="${1:-http://127.0.0.1:3000}"
# Desde el 08/11/2026 las lecturas exigen sesión (docs/20 §6): se lee como «usuario del sistema» con la clave de administrador
# (docs/20 §5) del .env que corresponde (el del banco si la URL es la suya, el de la pila si no). Entra a curl por la entrada estándar.
AQUI="$(cd "$(dirname "$0")" && pwd)"
. "$AQUI/../lib-dynsec.sh"
case "$API" in *:3001*) ENV_CLAVE="${XDG_RUNTIME_DIR:-$HOME/.cache}/plataforma-banco/banco.env" ;; *) ENV_CLAVE="$AQUI/../../.env" ;; esac
CLAVE=$(leer_env "$ENV_CLAVE" HTTP_CLAVE_ADMIN 2>/dev/null || true)
[ -n "$CLAVE" ] || { echo "FALLA sin HTTP_CLAVE_ADMIN en $ENV_CLAVE: las lecturas exigen sesión o esa clave"; exit 1; }
ok=0; fallos=0; sin_datos=0
ok() { echo "OK    $*"; ok=$((ok+1)); }
falla() { echo "FALLA $*"; fallos=$((fallos+1)); }
get() { printf 'X-Clave-Admin: %s\n' "$CLAVE" | curl -sS -m 20 -H @- -o "$2" -w '%{http_code}' "$API$1" || true; }   # ruta, archivo de salida → código (000 si no responde: se cuenta como FALLA, no mata el guion)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
AHORA=$(date -u +%FT%TZ)
desde() { date -u -d "$AHORA - $1" +%FT%TZ; }   # «1 hour», «24 hours», «7 days», «30 days»

c=$(get /dispositivos "$T/inv.json"); [ "$c" = 200 ] || { falla "inventario: $c"; echo "$ok OK, $fallos FALLA"; exit 1; }
n=$(jq 'length' "$T/inv.json"); [ "$n" -gt 0 ] && ok "inventario: $n dispositivos" || falla "inventario vacío: nada que recorrer"
for id in $(jq -r '.[].id' "$T/inv.json"); do
  idf=$(jq -r --arg id "$id" '.[]|select(.id==$id)|.id_fisico' "$T/inv.json")
  c=$(get "/dispositivos/$id" "$T/f.json")
  [ "$c" = 200 ] && jq -e '.id and .canales' "$T/f.json" >/dev/null && ok "$idf: ficha" || { falla "$idf: ficha → $c"; continue; }
  tiene=0
  for cid in $(jq -r '.canales[].id' "$T/f.json"); do fc=0
    for r in "1 hour:1 minute" "24 hours:15 minutes" "7 days:1 hour" "30 days:6 hours"; do   # los cuatro rangos del panel (docs/19)
      rango=${r%%:*}; paso=${r##*:}
      c=$(get "/canales/$cid/historico?desde=$(desde "$rango")&hasta=$AHORA&intervalo=${paso// /%20}" "$T/h.json")
      # forma del histórico (docs/10 §4.2): objeto con `puntos` (cuántos), `tiempos` y `valores` (listas del mismo largo), `unidad` y `zona_horaria`
      if [ "$c" != 200 ] || ! jq -e '(.puntos|type=="number") and (.tiempos|type=="array") and (.valores|type=="array") and (.tiempos|length)==(.valores|length) and (.tiempos|length)==.puntos' "$T/h.json" >/dev/null; then falla "$idf: histórico $rango → $c (forma inesperada)"; fc=$((fc+1)); continue; fi
      pts=$(jq '.puntos' "$T/h.json")
      [ "$rango" = "24 hours" ] && [ "$pts" -gt 0 ] && tiene=1
    done
    [ "$fc" = 0 ] && ok "$idf: histórico del canal ${cid:0:8} en los cuatro rangos"
  done
  for f in csv json; do
    c=$(get "/dispositivos/$id/exportar?formato=$f&desde=$(desde "30 days")&hasta=$AHORA" "$T/e.$f")
    [ "$c" = 200 ] && [ -s "$T/e.$f" ] && ok "$idf: exportar $f" || falla "$idf: exportar $f → $c"
  done
  c=$(get "/condiciones?dispositivo=$id&limite=500" "$T/c.json"); [ "$c" = 200 ] && jq -e 'type=="array"' "$T/c.json" >/dev/null && ok "$idf: condiciones" || falla "$idf: condiciones → $c"
  c=$(get "/cuarentena?dispositivo=$id&limite=500" "$T/q.json"); [ "$c" = 200 ] && jq -e 'type=="array"' "$T/q.json" >/dev/null && ok "$idf: cuarentena" || falla "$idf: cuarentena → $c"
  ultima=$(jq -r '.visto_por_ultima_vez // empty' "$T/f.json")
  if [ -n "$ultima" ] && [ "$tiene" = 0 ]; then
    # vista pero sin puntos en 24 h: solo es falla si la última vez vista cae dentro de las últimas 24 h
    if [ "$(date -u -d "$ultima" +%s)" -gt "$(date -u -d "$AHORA - 24 hours" +%s)" ]; then falla "$idf: visto hace menos de 24 h y el histórico de 24 h está vacío en todos sus canales"; fi
  fi
  [ "$tiene" = 0 ] && sin_datos=$((sin_datos+1))
done
echo "consultable: $ok OK, $fallos FALLA, $sin_datos dispositivo(s) sin mediciones en las últimas 24 h (no es falla)"
[ "$fallos" -eq 0 ] && echo "CONSULTABLE OK" || exit 1
