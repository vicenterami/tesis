#!/usr/bin/env bash
# La zona de tasa de la vista pública en el proxy (docs/19 §4, O, punto 7; docs/11 §4; docs/16 §79), con un nginx DESECHABLE:
#   bash plataforma/pruebas/publico-proxy.sh
# Qué hace:
#   1. con la imagen del proxy (plataforma-proxy:local o, si no está, la construye de proxy/) levanta dos contenedores en una red propia: el
#      proxy con la plantilla real (proxy/nginx.conf) y certificados de un día generados al vuelo, y un «backend» de prueba (otro nginx de la
#      misma imagen) que responde 200 en JSON a todo;
#   2. comprueba la zona `publico` (5 r/s, ráfaga 60, su 429 en JSON y sin caché ni indexación), que las escrituras sobre los enlaces caen en la
#      zona de administración, que las lecturas de la lista no se limitan y que el registro del proxy no guarda el token;
#   3. borra contenedores, red y certificados. No toca la pila ni ningún volumen: se puede correr con la pila en uso.
# Sale 0 solo si todas las comprobaciones dan OK. Variables: PUBLICO_PROXY_IMAGEN (la imagen del proxy), PUBLICO_PROXY_PREFIJO (nombre de los
# contenedores y la red; por omisión publico-proxy).
set -uo pipefail
cd "$(dirname "$0")/.."                       # plataforma/
P="${PUBLICO_PROXY_PREFIJO:-publico-proxy}-$$"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/publico-proxy.XXXXXX") || { echo "FALLA no pude crear la carpeta de trabajo"; exit 1; }
limpiar() { docker rm -f "$P-proxy" "$P-backend" >/dev/null 2>&1; docker network rm "$P-red" >/dev/null 2>&1; rm -rf "$TMP"; }
trap limpiar EXIT
fallos=0; n=0
ok() { n=$((n + 1)); echo "OK    $1"; }
falla() { n=$((n + 1)); fallos=$((fallos + 1)); echo "FALLA $1"; }

IMAGEN="${PUBLICO_PROXY_IMAGEN:-}"
if [ -z "$IMAGEN" ]; then
  if docker image inspect plataforma-proxy:local >/dev/null 2>&1; then IMAGEN=plataforma-proxy:local
  else IMAGEN=$(docker build -q proxy) || { echo "FALLA no pude construir la imagen del proxy (proxy/)"; exit 1; }; fi
fi
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TMP/servidor.key" -out "$TMP/servidor.crt" -days 1 -subj "/CN=prueba.example" >/dev/null 2>&1 \
  || { echo "FALLA no pude generar el certificado de prueba"; exit 1; }
chmod 644 "$TMP/servidor.key"
cat > "$TMP/backend.conf" <<'NGINX'
events {}
http { server { listen 3000; location / { default_type application/json; return 200 '{"respuesta":"backend de prueba"}'; } } }
NGINX
docker network create "$P-red" >/dev/null || { echo "FALLA no pude crear la red de prueba"; exit 1; }
docker run -d --rm --name "$P-backend" --network "$P-red" --network-alias backend -v "$TMP/backend.conf:/prueba/backend.conf:ro" \
  "$IMAGEN" nginx -c /prueba/backend.conf -g 'daemon off;' >/dev/null || { echo "FALLA no pude levantar el backend de prueba"; exit 1; }
docker run -d --rm --name "$P-proxy" --network "$P-red" -p 127.0.0.1::443 -v "$PWD/proxy/nginx.conf:/plantilla/nginx.conf.template:ro" -v "$TMP:/certs:ro" \
  -e NGINX_ENVSUBST_TEMPLATE_DIR=/plantilla -e NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx -e NGINX_ENVSUBST_FILTER=^PROXY_ \
  -e PROXY_NOMBRE=prueba.example -e PROXY_SECRETO=secreto-de-prueba-solo-para-este-guion "$IMAGEN" >/dev/null \
  || { echo "FALLA no pude levantar el proxy de prueba"; exit 1; }
PUERTO=""
for _ in $(seq 1 20); do PUERTO=$(docker port "$P-proxy" 443/tcp 2>/dev/null | head -1 | sed 's/.*://'); [[ "$PUERTO" =~ ^[0-9]+$ ]] && curl -sk -o /dev/null --resolve "prueba.example:$PUERTO:127.0.0.1" "https://prueba.example:$PUERTO/salud" && break; sleep 1; done
[[ "$PUERTO" =~ ^[0-9]+$ ]] || { echo "FALLA el proxy de prueba no respondió"; docker logs --tail 20 "$P-proxy" 2>&1 | sed 's/^/      /'; exit 1; }
U="https://prueba.example:$PUERTO"
c() { curl -sk --resolve "prueba.example:$PUERTO:127.0.0.1" "$@"; }
TOKEN=$(head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=')   # con la forma de un token; el backend de prueba no lo valida

cod=$(c -o /dev/null -w '%{http_code}' -H "X-Enlace-Publico: $TOKEN" "$U/publico?ventana=24h&carga=si")
[ "$cod" = 200 ] && ok "GET /publico con su cabecera llega al backend (200)" || falla "GET /publico dio $cod"
codigos=$(seq 1 80 | xargs -P 80 -I{} curl -sk --resolve "prueba.example:$PUERTO:127.0.0.1" -o /dev/null -w '%{http_code}\n' -H "X-Enlace-Publico: $TOKEN" "$U/publico")
n200=$(grep -c '^200$' <<<"$codigos"); n429=$(grep -c '^429$' <<<"$codigos")
[ "$n200" -ge 50 ] && [ "$n200" -le 61 ] && [ "$n429" -ge 19 ] && ok "80 peticiones simultáneas a /publico desde una dirección: $n200 con 200 y $n429 con 429 (5 r/s, ráfaga 60)" \
  || falla "80 a /publico: $n200 con 200 y $n429 con 429 (esperado 50 a 61 y el resto 429)"
c -D "$TMP/cab" -o "$TMP/cuerpo" -H "X-Enlace-Publico: $TOKEN" "$U/publico" >/dev/null
if grep -q '^HTTP/[0-9.]* 429' "$TMP/cab" && python3 -I -c "import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d.get('statusCode')==429 else 1)" "$TMP/cuerpo" \
   && grep -qi '^cache-control: no-store' "$TMP/cab" && grep -qi '^x-robots-tag: noindex' "$TMP/cab" && grep -qi '^strict-transport-security:' "$TMP/cab" \
   && grep -qi '^x-content-type-options: nosniff' "$TMP/cab"; then
  ok "el 429 de /publico va en JSON, sin caché, sin indexar, con nosniff y con HSTS"
else falla "el 429 de /publico: $(head -1 "$TMP/cab") $(head -c 120 "$TMP/cuerpo")"; fi
codigos=$(seq 1 30 | xargs -P 30 -I{} curl -sk --resolve "prueba.example:$PUERTO:127.0.0.1" -o /dev/null -w '%{http_code}\n' -X POST "$U/sitios/x/enlaces/vista-previa")
n200=$(grep -c '^200$' <<<"$codigos"); n429=$(grep -c '^429$' <<<"$codigos")
[ "$n429" -gt 0 ] && [ "$n200" -ge 10 ] && [ "$n200" -le 16 ] && ok "30 POST simultáneos a la vista previa de un sitio: $n200 pasan y $n429 con 429 (zona de administración, 5 r/s, ráfaga 10)" \
  || falla "30 POST a la vista previa: $n200 pasan y $n429 con 429 (esperado 10 a 16 y algún 429)"
codigos=$(seq 1 30 | xargs -P 30 -I{} curl -sk --resolve "prueba.example:$PUERTO:127.0.0.1" -o /dev/null -w '%{http_code}\n' "$U/sitios/x/enlaces")
n429=$(grep -c '^429$' <<<"$codigos")
[ "$n429" = 0 ] && ok "30 lecturas simultáneas de la lista de enlaces: ninguna limitada (solo la zona general)" || falla "la lista de enlaces recibió $n429 con 429"
registro=$(docker logs "$P-proxy" 2>/dev/null)
grep -q '"ruta":"/publico"' <<<"$registro" && ! grep -qF "$TOKEN" <<<"$registro" \
  && ok "el registro del proxy guarda la ruta /publico y nunca el token" || falla "registro del proxy: sin la ruta /publico o con el token"

[ "$fallos" = 0 ] && echo "$n de $n comprobaciones" || echo "$fallos de $n comprobaciones fallaron"
[ "$fallos" = 0 ]
