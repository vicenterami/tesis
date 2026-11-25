#!/usr/bin/env bash
# Sonda de la ventana de 72 horas (LEEME.md de esta carpeta; docs/16 §104). UNA ejecución = UNA línea CSV; pensada para `cron` cada minuto
# (sin proceso residente: un hueco en sus líneas ES la medida de una caída del equipo). Sin sudo, sin credenciales de la plataforma.
#   bash sonda.sh                       (lee la configuración de $VENTANA_CONF o de ~/ventana-72h/ventana.conf)
#   bash sonda.sh --cabecera            (solo imprime la cabecera, para revisar las columnas)
# Columnas: hora_utc · salud_codigo y salud_ms (GET /salud por HTTPS a través del proxy, verificando el certificado) · frescura_s (segundos
# desde el último dato del sitio de la prueba según su vista pública, GET /publico con el token del enlace; ultimo_dato es el inicio del tramo
# de 5 min de la lectura más reciente y la respuesta se guarda 60 s en el backend: con datos al día, entre 0 y unos 420 s) · disco_libre_mib
# (el sistema de archivos de Docker) · por cada servicio: estado, salud, reinicios (RestartCount), arriba_s (segundos desde su arranque) y
# mem_mib (docker stats). Si algo no responde, la línea se escribe igual con ese campo vacío; los errores van a sonda.err.
# Configuración (archivo de variables; todas opcionales salvo las del proxy):
#   VENTANA_DATOS   carpeta de salida (~/ventana-72h/datos): sonda.csv y sonda.err
#   VENTANA_NOMBRE  nombre del certificado del proxy (PROXY_NOMBRE)   VENTANA_IP  dirección donde escucha el 443 (PROXY_IP_PERSONAS; 127.0.0.1)
#   VENTANA_PUERTO_HTTPS (443)   VENTANA_CA  la CA que firmó el certificado (vacía: las del sistema)
#   VENTANA_TOKEN   archivo (600) con el token del enlace público del sitio de la prueba (nunca se imprime; viaja en una cabecera leída de archivo)
#   VENTANA_SERVICIOS  «proyecto/servicio …» (plataforma/timescaledb plataforma/mosquitto plataforma/backend plataforma/proxy ventana/emisor);
#                   solo servicios de la plataforma, más el emisor (que el resumen separa del total): sus nombres pasan a las columnas
#                   del CSV y al resumen
#   VENTANA_DISCO   ruta cuyo espacio libre se mide (la carpeta de datos de Docker)
# Topes: curl 10 s por petición, docker 10 s (stats 20 s), df 5 s; en el crontab, además, un tope global (`timeout 55 bash sonda.sh`, LEEME):
# una corrida que no termina a tiempo deja su minuto sin línea, y eso cuenta como no disponible (no se puede afirmar que estuviera arriba).
# sonda.err guarda los errores con su hora y se recorta solo a sus últimas 2000 líneas; de las respuestas guarda solo el código HTTP.
set -u
export PATH=/usr/local/bin:/usr/bin:/bin:$PATH LC_ALL=C   # cron trae un PATH mínimo; LC_ALL=C: punto decimal en todo número
CONF="${VENTANA_CONF:-$HOME/ventana-72h/ventana.conf}"
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"
DATOS="${VENTANA_DATOS:-$HOME/ventana-72h/datos}"
NOMBRE="${VENTANA_NOMBRE:-localhost}"; IP="${VENTANA_IP:-127.0.0.1}"; PUERTO="${VENTANA_PUERTO_HTTPS:-443}"
CA="${VENTANA_CA:-}"; TOKEN="${VENTANA_TOKEN:-}"
SERVICIOS="${VENTANA_SERVICIOS:-plataforma/timescaledb plataforma/mosquitto plataforma/backend plataforma/proxy ventana/emisor}"

cabecera() {
  local s n
  printf 'hora_utc,salud_codigo,salud_ms,frescura_s,disco_libre_mib'
  for s in $SERVICIOS; do n=${s#*/}; printf ',%s_estado,%s_salud,%s_reinicios,%s_arriba_s,%s_mem_mib' "$n" "$n" "$n" "$n" "$n"; done
  printf '\n'
}
[ "${1:-}" = "--cabecera" ] && { cabecera; exit 0; }

mkdir -p "$DATOS" || exit 1
CSV="$DATOS/sonda.csv"; ERR="$DATOS/sonda.err"
# Tope del registro de errores (antes de abrirlo: si no, se seguiría escribiendo en el archivo reemplazado): una falla sostenida 72 h no
# lo hace crecer sin límite.
if [ "$( { wc -l < "$ERR"; } 2>/dev/null || echo 0)" -gt 2000 ]; then tail -n 1000 "$ERR" > "$ERR.tmp" && mv "$ERR.tmp" "$ERR"; fi
exec 2>>"$ERR"
command -v jq >/dev/null || echo "$(date -u +%FT%TZ) falta jq: la frescura queda vacía" >&2
# Una sola a la vez: si una corrida se alarga (Docker colgado), la siguiente no se encima; sale sin escribir y el minuto queda como hueco.
exec 9>"$DATOS/.sonda.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) otra sonda sigue corriendo: se omite este minuto" >&2; exit 0; }
HORA=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CURL=(curl -sS -m 10 --resolve "$NOMBRE:$PUERTO:$IP")
[ -n "$CA" ] && CURL+=(--cacert "$CA")
URL="https://$NOMBRE:$PUERTO"

# Salud: código y milisegundos (time_total en segundos con decimales). Sin respuesta (000), el código queda 000 y los ms vacíos.
r=$("${CURL[@]}" -o /dev/null -w '%{http_code} %{time_total}' "$URL/salud" 2>>"$ERR")
codigo=${r%% *}; ms=""
[[ "$codigo" =~ ^[0-9]{3}$ ]] || codigo=000
[ "$codigo" != 000 ] && ms=$(awk -v t="${r#* }" 'BEGIN { printf "%d", t * 1000 + 0.5 }')

# Frescura: la vista pública del sitio de la prueba, sin credenciales; el token entra a curl desde un archivo (no queda en ps ni aquí).
frescura=""
if [ -n "$TOKEN" ] && [ -r "$TOKEN" ]; then
  cuerpo=$(printf 'X-Enlace-Publico: %s\n' "$(tr -d '[:space:]' < "$TOKEN")" | "${CURL[@]}" -H @- -w '\n%{http_code}' "$URL/publico?ventana=24h" 2>>"$ERR")
  cod_pub=${cuerpo##*$'\n'}; cuerpo=${cuerpo%$'\n'*}
  ultimo=$(jq -r '.ultimo_dato // empty' <<<"$cuerpo" 2>/dev/null)
  if [ -n "$ultimo" ]; then
    t=$(date -u -d "$ultimo" +%s 2>/dev/null) && frescura=$(( $(date -u +%s) - t ))
  else echo "$HORA la vista pública no trajo ultimo_dato (HTTP $cod_pub)" >&2; fi
  unset cuerpo
fi

# Disco libre (MiB) donde Docker guarda volúmenes y registros; df sobre la ruta no necesita permisos de lectura en ella.
DISCO="${VENTANA_DISCO:-$(timeout 10 docker info -f '{{.DockerRootDir}}' 2>/dev/null)}"
disco=$(timeout 5 df -Pm "${DISCO:-/}" 2>/dev/null | awk 'NR == 2 { print $4 }')

# Servicios: un solo `docker ps -a` por proyecto y servicio (etiquetas de Compose) y un solo `docker stats` para todos.
stats=$(timeout 20 docker stats --no-stream --format '{{.ID}} {{.MemUsage}}' 2>>"$ERR")
ahora=$(date -u +%s)
linea="$HORA,$codigo,$ms,$frescura,$disco"
for s in $SERVICIOS; do
  p=${s%%/*}; n=${s#*/}
  id=$(timeout 10 docker ps -aq --no-trunc --filter "label=com.docker.compose.project=$p" --filter "label=com.docker.compose.service=$n" --filter "label=com.docker.compose.oneoff=False" 2>>"$ERR" | head -1)
  estado=""; salud=""; reinicios=""; arriba=""; mem=""
  if [ -n "$id" ]; then
    read -r estado salud reinicios desde < <(timeout 10 docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}sin_chequeo{{end}} {{.RestartCount}} {{.State.StartedAt}}' "$id" 2>>"$ERR")
    if [ "$estado" = running ] && [ -n "${desde:-}" ]; then t=$(date -u -d "$desde" +%s 2>/dev/null) && arriba=$((ahora - t)); fi
    # MemUsage: «123.4MiB / 512MiB» (o kB, GiB): a MiB con un decimal.
    mem=$(awk -v id="${id:0:12}" '$1 == substr(id, 1, length($1)) && length($1) >= 12 {
            v = $2; u = v; sub(/[0-9.]+/, "", u); sub(/[A-Za-z]+$/, "", v)
            f = (u == "B") ? 1/1048576 : (u == "kB" || u == "KiB") ? 1/1024 : (u == "MB" || u == "MiB") ? 1 : (u == "GB" || u == "GiB") ? 1024 : -1
            if (f > 0) printf "%.1f", v * f; exit }' <<<"$stats")
  fi
  linea+=",$estado,$salud,$reinicios,$arriba,$mem"
done
[ -s "$CSV" ] || cabecera > "$CSV"
printf '%s\n' "$linea" >> "$CSV"
