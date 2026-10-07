#!/usr/bin/env bash
# Prueba de humo de la API de consulta. Requiere la pila arriba y el backend corriendo en 127.0.0.1:3000.
# Uso: bash pruebas/api-smoke.sh            (solo lectura; no toca la base ni el broker)
# Imprime una línea por caso: OK / FALLA. Sale con código 1 si algo falla.
set -u
API="${API:-http://127.0.0.1:3000}"
# openapi.json versionado: se regenera a mano con `pnpm openapi` (docs/openapi.ts); esta ruta lo ubica
# relativo al script, no al directorio desde el que se invoque.
OPENAPI_COMMITTED="${OPENAPI_COMMITTED:-$(dirname "$0")/../backend/openapi.json}"
fallos=0
caso() { # nombre · url · expresión python sobre `r` (json) o código HTTP esperado
  local nombre="$1" url="$2" check="$3"
  local out code
  out=$(curl -s -w '\n%{http_code}' "$API$url"); code=${out##*$'\n'}; body=${out%$'\n'*}
  if [[ "$check" =~ ^[0-9]{3}$ ]]; then
    [[ "$code" == "$check" ]] && echo "OK    $nombre" || { echo "FALLA $nombre (HTTP $code, esperado $check)"; fallos=$((fallos+1)); }
  else
    if python3 -c "import sys,json; r=json.loads(sys.stdin.read()); sys.exit(0 if ($check) else 1)" <<<"$body" 2>/dev/null; then
      echo "OK    $nombre"
    else echo "FALLA $nombre (HTTP $code) → ${body:0:160}"; fallos=$((fallos+1)); fi
  fi
}
# Cuántas tablas debe ver /salud: las que crean las migraciones EN DISCO, no un número escrito a mano (07/10: decía
# «>= 13» y habría seguido en verde con la tabla 14 sin aplicar). Fuente independiente de la base que se prueba.
N_ESQUEMA=$(cat "$(dirname "$0")"/../db/init/*.sql | grep -ciE '^\s*CREATE TABLE')
caso "salud responde y ve las $N_ESQUEMA tablas de las migraciones" /salud "r['estado']=='ok' and r['tablas']==$N_ESQUEMA"
caso "dispositivos es una lista con zona IANA"  /dispositivos     "isinstance(r,list) and all('/' in d['zona_horaria'] for d in r)"
caso "fechas de la API terminan en Z"           /dispositivos     "all((d['visto_por_ultima_vez'] or 'Z').endswith('Z') for d in r)"
CANAL=$(curl -s "$API/dispositivos" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r[0]['canales'][0]['id'] if r and r[0]['canales'] else '')")
if [[ -n "$CANAL" ]]; then
  caso "historico por día devuelve columnas alineadas" "/canales/$CANAL/historico?intervalo=1%20day" "len(r['tiempos'])==len(r['valores'])==len(r['muestras'])==r['puntos']"
  caso "historico: inicio de bucket diario cae a medianoche de la zona del sitio" "/canales/$CANAL/historico?intervalo=1%20day&desde=2026-09-01T00:00:00Z" "all(__import__('datetime').datetime.fromtimestamp(t, __import__('zoneinfo').ZoneInfo(r['zona_horaria'])).strftime('%H:%M')=='00:00' for t in r['tiempos'])"
  caso "última medición dentro de JSON también termina en Z" "/dispositivos/$(curl -s "$API/dispositivos" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")" "all((c['ultima_medicion'] or {}).get('tiempo','Z').endswith('Z') for c in r['canales'])"
  caso "intervalo fuera de la lista → 400"   "/canales/$CANAL/historico?intervalo=1%20year" 400
  caso "fecha no ISO → 400"                  "/canales/$CANAL/historico?desde=ayer" 400
fi
caso "UUID inválido → 400"                    /dispositivos/no-es-uuid 400
caso "limite fuera de rango → 400"            "/condiciones?limite=99999" 400
caso "condiciones abiertas es lista con duracion_s" "/condiciones?abiertas=true" "isinstance(r,list) and all(isinstance(c['duracion_s'],int) for c in r)"
caso "contrato OpenAPI servido con 6 rutas"      /docs/openapi.json "len(r['paths'])==6 and r['openapi'].startswith('3.')"
# El servido (generado en caliente desde los decoradores) vs. el versionado en el repo (se
# desincroniza si alguien cambia una ruta y olvida correr `pnpm openapi` antes de commitear).
caso "OpenAPI servido == OpenAPI versionado (mismas rutas y métodos)" /docs/openapi.json \
  "sorted((p,m) for p,ops in r['paths'].items() for m in ops if m in {'get','post','put','patch','delete'}) == sorted((p,m) for p,ops in json.load(open('$OPENAPI_COMMITTED'))['paths'].items() for m in ops if m in {'get','post','put','patch','delete'})"
caso "cuarentena limitada a 2"                "/cuarentena?limite=2" "isinstance(r,list) and len(r)<=2"
# Cabeceras de seguridad (docs/11 §3). Se leen con -I; el helper `caso` mira cuerpos, así que van aparte.
cab=$(curl -s -I --max-time 10 "$API/dispositivos" | tr -d '\r')
cabecera() { # nombre · regex que debe (o no) aparecer · esperado: si|no
  local nombre="$1" re="$2" esperado="$3"; local hay=no
  echo "$cab" | grep -qiE "^$re" && hay=si
  [ "$hay" = "$esperado" ] && { echo "OK    $nombre"; } || { echo "FALLA $nombre (esperado $esperado, hay $hay)"; fallos=$((fallos+1)); }
}
cabecera "sin X-Powered-By (no revela la pila)"                    "x-powered-by:" no
cabecera "Content-Security-Policy presente y con default-src 'self'" "content-security-policy: .*default-src 'self'" si
cabecera "X-Content-Type-Options: nosniff"                          "x-content-type-options: *nosniff" si
cabecera "X-Frame-Options presente"                                 "x-frame-options:" si
cabecera "Referrer-Policy presente"                                 "referrer-policy:" si
cabecera "Permissions-Policy niega cámara, micrófono y ubicación"  "permissions-policy: .*camera=\(\)" si
# HSTS lo pone el proxy, no el backend (una sola capa): aquí debe estar ausente.
cabecera "sin HSTS en el backend (lo pondrá el proxy TLS)"          "strict-transport-security:" no
echo; [[ $fallos -eq 0 ]] && echo "TODO OK" || { echo "$fallos caso(s) con falla"; exit 1; }
