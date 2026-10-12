#!/usr/bin/env bash
# Comprueba, con el servidor de desarrollo de Vite real, lo que docs/11 §3 promete del reenvío al backend (12/10/2026):
#   (a) conserva el Host (el backend compara Origin con Host en el canal en vivo: por el 5173 debe dar 200 con el Origin
#       propio y 403 con otro); (b) no retiene los eventos del canal (el primer byte llega enseguida y el latido, a los 25 s);
#   (c) el panel se sirve bajo /panel/. Y, con el build real servido por el backend: /panel/ con la CSP del backend, los
#   archivos con hash y ningún .map publicado (docs/11 §4). Requiere la pila de desarrollo arriba (backend en 127.0.0.1:3000).
# Uso: bash plataforma/pruebas/panel-desarrollo.sh [rapido]   (rapido: no espera el latido de 25 s)
set -u
cd "$(dirname "$0")/../backend/panel" || exit 1
API="${API:-http://127.0.0.1:3000}"; DEV="http://127.0.0.1:5173"; fallos=0
ok() { echo "OK    $1"; }; falla() { echo "FALLA $1"; fallos=$((fallos+1)); }
curl -fs -m 5 "$API/salud" >/dev/null || { echo "FALLA el backend no responde en $API"; exit 1; }
T=$(mktemp -d); trap 'kill "${VITE_PID:-}" 2>/dev/null; rm -rf "$T"' EXIT
# El binario directo, no `pnpm exec`: así $! es el PID de Vite y el trap lo mata de verdad (revisión del 12/10).
node_modules/.bin/vite --logLevel error > "$T/vite.log" 2>&1 & VITE_PID=$!
for _ in $(seq 1 40); do curl -s -o /dev/null -m 1 "$DEV/panel/" && break; sleep 0.25; done
curl -s -m 5 "$DEV/panel/" | grep -q '<div id="app">' && ok "Vite sirve el panel en /panel/" || falla "Vite no sirvió /panel/ ($(tail -2 "$T/vite.log"))"
# (a) Host conservado: Origin propio por el 5173 → 200; otro origen → 403. Si Vite cambiara el Host (changeOrigin), el
#     backend vería Host 127.0.0.1:3000 y rechazaría también el origen propio.
c=$(curl -s -o /dev/null -w '%{http_code}' -m 3 -H "Origin: $DEV" "$DEV/eventos"); [ "$c" = 200 ] && ok "reenvío conserva el Host: Origin propio por el 5173 → 200" || falla "Origin propio por el 5173 → $c (esperado 200)"
c=$(curl -s -o /dev/null -w '%{http_code}' -m 3 -H "Origin: https://otro.example" "$DEV/eventos"); [ "$c" = 403 ] && ok "otro Origin por el 5173 → 403 (el control actúa a través del reenvío)" || falla "otro Origin por el 5173 → $c (esperado 403)"
# Un Host ajeno: Vite trae su propia lista de nombres (server.allowedHosts, desde la 6.0.9, por el mismo DNS rebinding) y
# responde 403 «not allowed» antes de reenviar; si la saltara, el backend respondería 421. Lo que no puede pasar es un 200.
c=$(curl -s -o "$T/host" -w '%{http_code}' -m 3 -H "Host: ataque.example:5173" "$DEV/salud")
if [ "$c" = 421 ]; then ok "un Host ajeno por el 5173 llega al backend y recibe 421"
elif [ "$c" = 403 ] && grep -qi "not allowed" "$T/host"; then ok "un Host ajeno por el 5173 lo corta Vite (403, lista propia); el backend daría 421"
else falla "Host ajeno por el 5173 → $c (esperado 421 del backend o 403 de Vite)"; fi
# (b) Sin búfer: el primer byte del flujo llega enseguida; el latido, a los 25 s.
: > "$T/sse"; curl -s -N -m 30 "$DEV/eventos" > "$T/sse" & SSE_PID=$!
for _ in $(seq 1 20); do [ -s "$T/sse" ] && break; sleep 0.25; done
[ -s "$T/sse" ] && ok "canal en vivo por el 5173: primer byte en menos de 5 s (sin búfer)" || falla "canal en vivo por el 5173: nada en 5 s (¿Vite retiene el flujo?)"
if [ "${1:-}" != rapido ]; then wait "$SSE_PID" 2>/dev/null; grep -q "event: latido" "$T/sse" && ok "latido recibido a través de Vite (30 s de escucha)" || falla "sin latido en 30 s a través de Vite"; else kill "$SSE_PID" 2>/dev/null; fi
kill "$VITE_PID" 2>/dev/null; wait "$VITE_PID" 2>/dev/null; VITE_PID=
sleep 0.5; [ "$(ss -ltn 2>/dev/null | grep -c ':5173 ')" = 0 ] && ok "Vite terminado: el 5173 queda libre" || falla "el 5173 sigue ocupado tras matar a Vite"
# Build real servido por el backend (docs/11 §4): CSP del backend, archivos con hash, sin .map.
cab=$(curl -s -D - -o "$T/index.html" -m 5 "$API/panel/" | tr -d '\r')
grep -q '<div id="app">' "$T/index.html" && ok "el backend sirve /panel/ (build real)" || falla "el backend no sirvió /panel/ (¿construido? pnpm --filter panel build y reconstruir la imagen)"
grep -qi "content-security-policy: .*default-src 'self'" <<<"$cab" && ok "/panel/ lleva la CSP del backend" || falla "/panel/ sin CSP"
js=$(grep -oE '/panel/assets/[^"]+\.js' "$T/index.html" | head -1)
[ -n "$js" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$API$js")" = 200 ] && ok "el paquete con hash responde 200 ($js)" || falla "paquete del panel no encontrado"
[ "$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$API$js.map")" = 404 ] && ok "ningún .map publicado" || falla "se publica un .map"
grep -q "<script[^>]*>[^<]" "$T/index.html" && falla "index.html trae un script en línea (la CSP lo bloquearía)" || ok "sin scripts en línea en index.html"
echo; [ $fallos -eq 0 ] && echo "PANEL OK" || { echo "$fallos comprobación(es) con falla"; exit 1; }
