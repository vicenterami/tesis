#!/usr/bin/env bash
# Escanea las imágenes de la pila buscando vulnerabilidades conocidas (docs/11 §4; resultados en docs/16 §12). Antes de
# desplegar y al cambiar una imagen. Construye con `--pull --no-cache` y baja de nuevo las imágenes de registro, para escanear
# lo que se desplegaría hoy (una etiqueta puede reconstruirse con parches y la capa de parches no se rehace sola).
# Trivy (Apache-2.0: https://github.com/aquasecurity/trivy/blob/main/LICENSE) fijado por digest. En marzo de 2026 se
# publicaron versiones maliciosas: la 0.69.4 (binarios e imágenes) y las imágenes 0.69.5 y 0.69.6 de Docker Hub
# (https://github.com/advisories/GHSA-69fq-xp46-6x23); sus propios avisos están corregidos desde 0.72.0. Dependabot no ve
# este digest: se revisa a mano cada mes (docs/11 §4). Corre desechable:
# cada imagen entra como archivo, solo lectura, sin acceso a Docker, sin privilegios, con el usuario de quien lo corre y solo
# el escáner de vulnerabilidades (no el de secretos).
# Sale 1 si alguna imagen tiene vulnerabilidades altas o críticas con versión corregida publicada (hay algo que hacer), si
# un escaneo no se entendió o si se escanearon menos imágenes de las que declara el compose. Los residuos documentados
# salen como AVISO: no se esconden.
# Después de la tabla, una comprobación propia (13/11/2026): Trivy lee los paquetes del sistema, no el servidor PostgreSQL compilado en
# /usr/local de la imagen de la base, así que se compara su PG_VERSION con la de postgres:<mayor>-alpine (la última publicada de su serie)
# y con la de timescale/timescaledb:latest-pg<mayor>-oss: al día → OK; hay una nueva y TimescaleDB ya la trae → HAY QUE ACTUAR (subir la
# huella; sale 1); hay una nueva y TimescaleDB aún no → AVISO (riesgo aceptado transitorio, docs/11 §4; no cambia la salida); no se pudo
# consultar → FALLA (sale 1). Construye con COMMIT exportado, como pila.sh: la imagen del backend que deja lleva el commit de «Acerca de».
#   bash plataforma/pruebas/escanear-imagenes.sh
#   bash plataforma/pruebas/escanear-imagenes.sh --probar-pg   sin red ni Docker: la comparación contra ocho casos plantados (los cuatro
#                                                              veredictos, el orden 16.9 < 16.10 y dos versiones ilegibles); sale 1 si uno falla
set -u -o pipefail
cd "$(dirname "$0")/.." || { echo "FALLA no se encontró plataforma/"; exit 1; }
# comparar_pg NUESTRA OFICIAL TIMESCALE → escribe el veredicto y devuelve 0 (al día o aviso) o 1 (hay que actuar o no se pudo comparar).
comparar_pg() {
  local nuestra=$1 oficial=$2 ts=$3 forma='^[0-9]+\.[0-9]+$'
  if ! [[ "$nuestra" =~ $forma && "$oficial" =~ $forma && "$ts" =~ $forma ]]; then
    echo "FALLA no se pudo comparar el servidor PostgreSQL de la imagen (imagen «${nuestra:-?}», oficial «${oficial:-?}», TimescaleDB «${ts:-?}»)"; return 1
  fi
  local mayor; mayor=$(printf '%s\n%s\n' "$nuestra" "$oficial" | sort -V | tail -1)
  if [ "$mayor" = "$nuestra" ]; then echo "OK    el servidor PostgreSQL de la imagen de la base es $nuestra, la última publicada de su serie"; return 0; fi
  if [ "$(printf '%s\n%s\n' "$nuestra" "$ts" | sort -V | tail -1)" != "$nuestra" ]; then
    echo "HAY QUE ACTUAR: el servidor PostgreSQL de la imagen de la base es $nuestra y ya hay una imagen de TimescaleDB con $ts: subir la huella (docs/11 §4)"; return 1
  fi
  echo "AVISO el servidor PostgreSQL de la imagen de la base es $nuestra y ya se publicó $oficial; TimescaleDB todavía no trae una imagen con ella (la última, $ts): riesgo declarado en docs/11 §4; repetir este guion cada día"
  return 0
}
if [ "${1:-}" = --probar-pg ]; then
  # NUESTRA OFICIAL TIMESCALE · salida esperada · comienzo esperado del veredicto
  mal=0
  while read -r nu of ts sal ver; do
    [ "$nu" = - ] && nu=""; [ "$of" = - ] && of=""; [ "$ts" = - ] && ts=""
    v=$(comparar_pg "$nu" "$of" "$ts"); r=$?
    if [ "$r" = "$sal" ] && [[ "$v" == "$ver"* ]]; then echo "OK    ${nu:-?} · ${of:-?} · ${ts:-?} → $ver (salida $r)"; else echo "FALLA ${nu:-?} · ${of:-?} · ${ts:-?} → salida $r «$v» (esperado $sal y «$ver…»)"; mal=1; fi
  done <<'CASOS'
16.15 16.15 16.15 0 OK
16.16 16.15 16.15 0 OK
16.15 16.16 16.16 1 HAY QUE ACTUAR
16.15 16.17 16.16 1 HAY QUE ACTUAR
16.15 16.16 16.15 0 AVISO
16.9 16.10 16.9 0 AVISO
16.15 - 16.15 1 FALLA
16.15-r0 16.16 16.15 1 FALLA
CASOS
  exit "$mal"
fi
TRIVY=ghcr.io/aquasecurity/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969
# Residuos documentados en docs/11 §4 (08/10/2026): gosu, binario de Go precompilado de la imagen de la base que el arranque
# usa para bajar privilegios y que no recibe datos de afuera; corregirlo exige recompilarlo. Se quita de la lista cuando la
# imagen oficial lo traiga corregido.
RESIDUALES="usr/local/bin/gosu"
TRAB=$(mktemp -d "${TMPDIR:-/tmp}/escaneo-imagenes.XXXXXX") || { echo "FALLA no se pudo crear la carpeta de trabajo"; exit 1; }
trap 'rm -rf "$TRAB"' EXIT
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/trivy-plataforma"; mkdir -p "$CACHE"
dc() { docker compose -f docker-compose.yml -f proxy/compose.proxy.yml "$@"; }
# El commit corto para «Acerca de», como pila.sh: sin él, esta reconstrucción dejaba la imagen del backend con commit null.
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || true); export COMMIT
if ! dc build --pull --no-cache -q > "$TRAB/build.log" 2>&1; then
  echo "FALLA no se pudieron construir las imágenes (docker compose build):"; tail -5 "$TRAB/build.log" | sed 's/^/  /'; exit 1
fi
docker pull -q "$TRIVY" >/dev/null || { echo "FALLA no se pudo bajar $TRIVY"; exit 1; }
imgs=$(dc config --images | sort -u); esperadas=$(wc -w <<<"$imgs"); escaneadas=0; accion=0
# Las imágenes de registro son las de los servicios sin `build`: esas se bajan de nuevo (las construidas aquí ya usaron --pull).
registro=$(dc config --format json | jq -r '.services[] | select(.build == null) | .image')
printf '%-46s %8s %6s %11s\n' imagen críticas altas "con parche"
for i in $imgs; do
  case "$i" in *:*) ;; *) i="$i:latest" ;; esac   # sin etiqueta, docker save exportaría todas las de ese nombre juntas
  n=$(tr '/:' '__' <<<"$i")
  if grep -qxF -e "$i" -e "${i%:latest}" <<<"$registro"; then
    docker pull -q "$i" >/dev/null || { echo "FALLA no se pudo bajar $i"; accion=1; continue; }
  fi
  docker save -o "$TRAB/$n.tar" "$i" || { echo "FALLA no se pudo exportar $i"; accion=1; continue; }
  if ! docker run --rm --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges --read-only \
       --tmpfs /tmp -e HOME=/tmp -v "$TRAB:/imagenes:ro" -v "$CACHE:/cache" "$TRIVY" image \
       --cache-dir /cache --scanners vuln --input "/imagenes/$n.tar" --format json --quiet > "$TRAB/$n.json"; then
    echo "FALLA trivy no pudo escanear $i"; accion=1; continue
  fi
  rm -f "$TRAB/$n.tar"
  # Un escaneo que no reconoció el sistema operativo o no trae resultados no prueba nada.
  if ! jq -e '.Metadata.OS.Family and (.Results | type == "array")' "$TRAB/$n.json" >/dev/null 2>&1; then
    echo "FALLA el escaneo de $i no reconoció el sistema operativo o no trae resultados"; accion=1; continue
  fi
  read -r c a p r < <(jq -r --arg res "$RESIDUALES" '($res | split(" ")) as $r | [.Results[]? | .Target as $t
      | .Vulnerabilities[]? | select(.Severity == "CRITICAL" or .Severity == "HIGH")
      | {s: .Severity, fix: ((.FixedVersion // "") != ""), residual: ($r | index($t) != null)}]
    | "\(map(select(.s == "CRITICAL")) | length) \(map(select(.s == "HIGH")) | length) \(map(select(.fix and (.residual | not))) | length) \(map(select(.residual)) | length)"' \
    "$TRAB/$n.json")
  if ! [[ "${c:-}" =~ ^[0-9]+$ && "${a:-}" =~ ^[0-9]+$ && "${p:-}" =~ ^[0-9]+$ && "${r:-}" =~ ^[0-9]+$ ]]; then
    echo "FALLA no se pudo leer el resultado de $i"; accion=1; continue
  fi
  escaneadas=$((escaneadas+1))
  printf '%-46s %8s %6s %11s\n' "$i" "$c" "$a" "$p"
  [ "$r" -gt 0 ] && echo "  AVISO $r en residuos documentados (docs/11 §4): $RESIDUALES"
  [ "$p" -gt 0 ] && accion=1
done
if [ "$escaneadas" -lt "$esperadas" ]; then echo "FALLA se escanearon $escaneadas de $esperadas imágenes del compose"; accion=1; fi
# El servidor PostgreSQL de la imagen de la base (ver la cabecera): su PG_VERSION frente a la publicada.
img_base=$(dc config --format json | jq -r '.services.timescaledb.image // empty')
plataforma=$(docker version -f '{{.Server.Os}}/{{.Server.Arch}}' 2>/dev/null || echo linux/amd64)
env_de() { docker buildx imagetools inspect --format '{{json .Image}}' "$1" 2>/dev/null \
  | jq -r --arg p "$plataforma" 'if has("config") then .config.Env else .[$p].config.Env end | .[]? | select(startswith("PG_VERSION=")) | ltrimstr("PG_VERSION=")'; }
nuestra=$( [ -n "$img_base" ] && docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$img_base" 2>/dev/null | sed -n 's/^PG_VERSION=//p')
mayor_pg=${nuestra%%.*}
oficial=$( [[ "$mayor_pg" =~ ^[0-9]+$ ]] && env_de "postgres:$mayor_pg-alpine")
ultima_ts=$( [[ "$mayor_pg" =~ ^[0-9]+$ ]] && env_de "timescale/timescaledb:latest-pg$mayor_pg-oss")
comparar_pg "$nuestra" "$oficial" "$ultima_ts" || accion=1
if [ "$accion" -eq 0 ]; then echo "OK    $escaneadas imágenes: ninguna vulnerabilidad alta o crítica con versión corregida publicada fuera de los residuos documentados"
else echo "HAY QUE ACTUAR: vulnerabilidades altas o críticas con versión corregida publicada, o un escaneo que no se completó (ver arriba)"; fi
exit "$accion"
