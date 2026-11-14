#!/usr/bin/env bash
# Prueba de humo de la API de consulta. Requiere la pila arriba y el backend corriendo en 127.0.0.1:3000.
# Uso: bash pruebas/api-smoke.sh            (solo lectura; no toca la base ni el broker)
# Imprime una línea por caso: OK / FALLA. Sale con código 1 si algo falla.
# Desde el 08/11/2026 toda lectura exige sesión (docs/20 §6): aquí se lee como el «usuario del sistema», con la cabecera X-Clave-Admin
# (docs/20 §5), cuyo valor sale de HTTP_CLAVE_ADMIN del .env y entra a curl por la entrada estándar (nunca en la línea de órdenes ni
# en la salida). La matriz completa de sesión × rol la recorre sesion-smoke.sh (paso 4b del guardián).
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
. "$AQUI/lib-dynsec.sh"
API="${API:-http://127.0.0.1:3000}"
CLAVE=$(leer_env "${ENV_PILA:-$AQUI/../.env}" HTTP_CLAVE_ADMIN 2>/dev/null)
[ -n "$CLAVE" ] || { echo "FALLA sin HTTP_CLAVE_ADMIN en el .env de la pila: las lecturas exigen sesión o esa clave (docs/20 §5)"; exit 1; }
# curl con la clave de administrador por la entrada estándar.
ck() { printf 'X-Clave-Admin: %s\n' "$CLAVE" | curl -H @- "$@"; }
# openapi.json versionado: se regenera a mano con `pnpm openapi` (docs/openapi.ts); esta ruta lo ubica
# relativo al script, no al directorio desde el que se invoque.
OPENAPI_COMMITTED="${OPENAPI_COMMITTED:-$(dirname "$0")/../backend/openapi.json}"
fallos=0
caso() { # nombre · url · expresión python sobre `r` (json) o código HTTP esperado
  local nombre="$1" url="$2" check="$3"
  local out code
  out=$(ck -s -w '\n%{http_code}' "$API$url"); code=${out##*$'\n'}; body=${out%$'\n'*}
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
CANAL=$(ck -s "$API/dispositivos" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r[0]['canales'][0]['id'] if r and r[0]['canales'] else '')")
if [[ -n "$CANAL" ]]; then
  caso "historico por día devuelve columnas alineadas" "/canales/$CANAL/historico?intervalo=1%20day" "len(r['tiempos'])==len(r['valores'])==len(r['muestras'])==r['puntos']"
  caso "historico: inicio de bucket diario cae a medianoche de la zona del sitio" "/canales/$CANAL/historico?intervalo=1%20day&desde=2026-09-01T00:00:00Z" "all(__import__('datetime').datetime.fromtimestamp(t, __import__('zoneinfo').ZoneInfo(r['zona_horaria'])).strftime('%H:%M')=='00:00' for t in r['tiempos'])"
  caso "última medición dentro de JSON también termina en Z" "/dispositivos/$(ck -s "$API/dispositivos" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")" "all((c['ultima_medicion'] or {}).get('tiempo','Z').endswith('Z') for c in r['canales'])"
  caso "intervalo fuera de la lista → 400"   "/canales/$CANAL/historico?intervalo=1%20year" 400
  caso "fecha no ISO → 400"                  "/canales/$CANAL/historico?desde=ayer" 400
  caso "ventana de más de 5 000 cubos → 400"  "/canales/$CANAL/historico?intervalo=1%20minute&desde=2026-09-01T00:00:00Z" 400
  caso "ventana de más de 366 días → 400"     "/canales/$CANAL/historico?intervalo=1%20day&desde=2025-01-01T00:00:00Z" 400
fi
caso "UUID inválido → 400"                    /dispositivos/no-es-uuid 400
caso "limite fuera de rango → 400"            "/condiciones?limite=99999" 400
caso "condiciones abiertas es lista con duracion_s" "/condiciones?abiertas=true" "isinstance(r,list) and all(isinstance(c['duracion_s'],int) for c in r)"
caso "contrato OpenAPI servido con 38 rutas (47 operaciones: alta, baja y rotación de dispositivos y de pasarelas, la calibración de un canal, la recepción por HTTP, la sesión, los usuarios, el tablero v2, desde el 11/11/2026 la cuenta propia, lo legal, el soporte y la actividad, y desde el 13/11/2026 «Ahora» incluidos), con el canal /eventos como text/event-stream" /docs/openapi.json "len(r['paths'])==38 and sum(1 for p in r['paths'].values() for m in p if m in {'get','post','put','patch','delete'})==47 and 'get' in r['paths']['/sitios/{id}/resumen'] and 'get' in r['paths']['/sitios/{id}/ahora'] and 'put' in r['paths']['/canales/{id}/reglas'] and 'patch' in r['paths']['/dispositivos/{id}'] and 'post' in r['paths']['/dispositivos/lote'] and {'post','get','delete'} <= set(r['paths']['/sesion']) and 'patch' in r['paths']['/usuarios/{id}'] and 'post' in r['paths']['/dispositivos'] and 'delete' in r['paths']['/dispositivos/{id}'] and 'post' in r['paths']['/dispositivos/{id}/credencial'] and 'patch' in r['paths']['/canales/{id}'] and r['openapi'].startswith('3.') and 'text/event-stream' in r['paths']['/eventos']['get']['responses']['200']['content']"
# El servido (generado en caliente desde los decoradores) vs. el versionado en el repo (se
# desincroniza si alguien cambia una ruta y olvida correr `pnpm openapi` antes de commitear).
caso "OpenAPI servido == OpenAPI versionado (mismas rutas y métodos)" /docs/openapi.json \
  "sorted((p,m) for p,ops in r['paths'].items() for m in ops if m in {'get','post','put','patch','delete'}) == sorted((p,m) for p,ops in json.load(open('$OPENAPI_COMMITTED'))['paths'].items() for m in ops if m in {'get','post','put','patch','delete'})"
caso "cuarentena limitada a 2"                "/cuarentena?limite=2" "isinstance(r,list) and len(r)<=2"
# Alta por API (HU-11, docs/10 §8.4 punto 41): sin la cabecera, 401 (clave configurada) o 503 (sin configurar); nunca 2xx ni 404.
# Con clave incorrecta, lo mismo. El alta completa, con el broker y la base, la prueba el banco (banco.sh alta): aquí no se
# crea ningún dispositivo en la pila de desarrollo.
post_code() { curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' "$@" "$API/dispositivos"; }
code=$(post_code -d '{}')
[[ "$code" == 401 || "$code" == 503 ]] && echo "OK    POST /dispositivos sin X-Clave-Admin → $code" || { echo "FALLA POST /dispositivos sin clave → HTTP $code (esperado 401 o 503)"; fallos=$((fallos+1)); }
code=$(post_code -H 'X-Clave-Admin: no-es-la-clave-de-nadie-123456' -d '{}')
[[ "$code" == 401 || "$code" == 503 ]] && echo "OK    POST /dispositivos con clave incorrecta → $code" || { echo "FALLA POST /dispositivos con clave incorrecta → HTTP $code (esperado 401 o 503)"; fallos=$((fallos+1)); }
code=$(post_code -H 'X-Clave-Admin: a' -H 'X-Clave-Admin: b' -d '{}')
[[ "$code" == 401 || "$code" == 503 ]] && echo "OK    POST /dispositivos con la cabecera repetida → $code" || { echo "FALLA cabecera repetida → HTTP $code"; fallos=$((fallos+1)); }
# La baja y la rotación (13/10) llevan la misma guardia, y antes que cualquier otra cosa: sin clave no se aprende ni si el UUID existe.
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/dispositivos/no-es-uuid")
[[ "$code" == 401 || "$code" == 503 ]] && echo "OK    DELETE /dispositivos/{id} sin X-Clave-Admin → $code (antes de mirar el UUID)" || { echo "FALLA DELETE sin clave → HTTP $code (esperado 401 o 503)"; fallos=$((fallos+1)); }
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/dispositivos/no-es-uuid/credencial")
[[ "$code" == 401 || "$code" == 503 ]] && echo "OK    POST /dispositivos/{id}/credencial sin X-Clave-Admin → $code" || { echo "FALLA rotación sin clave → HTTP $code (esperado 401 o 503)"; fallos=$((fallos+1)); }
# Pasarelas (docs/10 §8.4 punto 47, 15/10): la lista es de lectura; las tres rutas que escriben exigen la clave, antes de mirar el UUID.
caso "pasarelas es una lista con formato y nodos" /pasarelas "isinstance(r,list) and all(p['formato'] in ('milesight','chirpstack') and isinstance(p['nodos'],int) for p in r)"
# La calibración de un canal (docs/10 §8.4 punto 51, 22/10) también escribe: la misma guardia, antes de mirar el UUID.
for ruta in "POST /pasarelas" "DELETE /pasarelas/no-es-uuid" "POST /pasarelas/no-es-uuid/credencial" "PATCH /canales/no-es-uuid"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X "${ruta%% *}" -H 'Content-Type: application/json' -d '{}' "$API${ruta#* }")
  [[ "$code" == 401 || "$code" == 503 ]] && echo "OK    $ruta sin X-Clave-Admin → $code" || { echo "FALLA $ruta sin clave → HTTP $code (esperado 401 o 503)"; fallos=$((fallos+1)); }
done
# Filtro por dispositivo (ficha del panel, docs/19 P3; 12/10): solo lo de ese dispositivo, y un valor que no es UUID → 400.
DISP=$(ck -s "$API/dispositivos" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')")
DISP_FIS=$(ck -s "$API/dispositivos" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id_fisico'] if d else '')")
if [ -n "$DISP" ]; then
  caso "condiciones filtradas por dispositivo: todas de ese dispositivo" "/condiciones?dispositivo=$DISP" "isinstance(r,list) and all(c['dispositivo_id']=='$DISP' for c in r)"
  caso "cuarentena filtrada por dispositivo: todas atribuidas a él" "/cuarentena?dispositivo=$DISP&limite=5" "isinstance(r,list) and len(r)<=5 and all(c['dispositivo']=='$DISP_FIS' for c in r)"
fi
caso "condiciones con dispositivo que no es UUID → 400" "/condiciones?dispositivo=dev-0001" 400
caso "cuarentena con dispositivo que no es UUID → 400"  "/cuarentena?dispositivo=x" 400
# Nest usa el analizador «simple» de consultas: `?x=a&x=b` llega como arreglo (`?x[]=a` NO: queda como clave literal).
caso "parámetro repetido (llega como arreglo) → 400, no 500" "/cuarentena?dispositivo=$DISP&dispositivo=$DISP" 400
caso "limite repetido → 400"                            "/condiciones?limite=5&limite=6" 400
# Exportación (RF-34, HU-08; 12/10): CSV estándar con cabecera fija y descarga; JSON como lista; formato o fechas inválidos → 400.
if [ -n "$DISP" ]; then
  exp=$(ck -s -D - -m 20 "$API/dispositivos/$DISP/exportar?formato=csv" | tr -d '\r')
  grep -q "^tiempo_utc,magnitud,valor,unidad,canal_id$" <<<"$exp" && echo "OK    exportar csv: cabecera fija" || { echo "FALLA exportar csv: sin cabecera → $(head -c 160 <<<"$exp")"; fallos=$((fallos+1)); }
  grep -qi "^content-disposition: attachment; filename=\".*\.csv\"$" <<<"$exp" && echo "OK    exportar csv: descarga con nombre .csv" || { echo "FALLA exportar csv: sin Content-Disposition"; fallos=$((fallos+1)); }
  # El instante viaja como texto exacto de la base (6 decimales): con milisegundos, la última fila de cada tanda se repetía.
  fila1=$(ck -s -m 20 "$API/dispositivos/$DISP/exportar?formato=csv&desde=2026-01-01T00:00:00Z" | sed -n 2p)
  if [ -z "$fila1" ]; then echo "OK    exportar csv: sin filas en el rango (no se puede comprobar el instante)"; elif grep -qE "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z," <<<"$fila1"; then echo "OK    exportar csv: instante con microsegundos"; else echo "FALLA exportar csv: instante sin microsegundos → ${fila1:0:60}"; fallos=$((fallos+1)); fi
  caso "exportar json: lista de filas con tiempo_utc y valor" "/dispositivos/$DISP/exportar?formato=json&desde=2026-01-01T00:00:00Z" "isinstance(r,list) and all('tiempo_utc' in x and 'valor' in x for x in r)"
  caso "exportar con formato desconocido → 400" "/dispositivos/$DISP/exportar?formato=xlsx" 400
  caso "exportar con desde posterior a hasta → 400" "/dispositivos/$DISP/exportar?desde=2026-10-02T00:00:00Z&hasta=2026-10-01T00:00:00Z" 400
fi
caso "exportar un dispositivo inexistente → 404" "/dispositivos/00000000-0000-4000-8000-000000000000/exportar" 404
# Tablero v2 (docs/19 §4, I; docs/10 §8.4 punto 65; docs/16 §61). Lecturas: forma de cada respuesta nueva, cabeceras X-Total y
# X-Siguiente, y los 400 de entrada. Las escrituras (PATCH, PUT de reglas, lote) se prueban con datos inválidos o una marca vieja: 400
# y 409 sin cambiar nada; la creación real por lote la mide docs/16 §61 en el banco.
SITIO=$(ck -s "$API/sitios" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r[0]['id'] if r else '')")
caso "sitios: lista con código, zona horaria, rol y zonas" /sitios "isinstance(r,list) and len(r)>=1 and all({'id','codigo','nombre','zona_horaria','rol','zonas'} <= set(s) for s in r)"
if [[ -n "$SITIO" ]]; then
  caso "resumen del sitio: exactamente los campos del contrato" "/sitios/$SITIO/resumen" "set(r)=={'sitio','ventana','dispositivos','salud','condiciones_abiertas','tramas','atencion','magnitudes','entrega','total_activos'} and len(r['entrega'])<=50 and len(r['entrega'])==min(50, r['total_activos']) and set(r['dispositivos'])=={'total','normal','alerta','sin_senal','inactivo'} and set(r['salud'])=={'reportan','supervisados','porcentaje'} and set(r['tramas'])=={'recibidas','rechazadas','cubos'} and len(r['atencion'])<=10"
  caso "resumen: los cuatro estados suman el total" "/sitios/$SITIO/resumen" "sum(r['dispositivos'][k] for k in ('normal','alerta','sin_senal','inactivo'))==r['dispositivos']['total']"
  caso "resumen: los indicadores suman el inventario del sitio" "/sitios/$SITIO/resumen" "r['dispositivos']['total']==$(ck -s -D - -o /dev/null "$API/dispositivos?sitio=$SITIO&limite=1" | tr -d '\r' | awk 'tolower($1)=="x-total:"{print $2}')"
  # «Ahora» (docs/19 §4, L6): la forma, los conteos que cuadran con el resumen, el orden (alerta primero), el tope de tres canales con la
  # salud al final, la tendencia de 24 cubos solo cuando se pide y los 400 de limite.
  caso "ahora: exactamente los campos del contrato, sin tendencia" "/sitios/$SITIO/ahora" "set(r)=={'reportan','sin_senal','por_magnitud','dispositivos','tendencia'} and r['tendencia'] is False and len(r['dispositivos'])==min(24, r['reportan']) and all(set(d)=={'id','nombre','zona','estado_visual','visto_por_ultima_vez','intervalo_esperado_s','canales_total','canales'} and d['estado_visual'] in ('normal','alerta') and len(d['canales'])==min(3, d['canales_total']) and all(set(c)=={'id','magnitud','magnitud_nombre','unidad','salud','ultima'} for c in d['canales']) for d in r['dispositivos']) and all(set(m)=={'codigo','nombre','unidad','salud','canales','promedio','minimo','maximo'} and m['minimo']<=m['promedio']<=m['maximo'] for m in r['por_magnitud'])"
  caso "ahora: reportan y sin_senal cuadran con el resumen del sitio" "/sitios/$SITIO/ahora" "(r['reportan'], r['sin_senal'])==$(ck -s "$API/sitios/$SITIO/resumen" | python3 -I -c "import sys,json; r=json.load(sys.stdin)['dispositivos']; print((r['normal']+r['alerta'], r['sin_senal']))")"
  caso "ahora: alerta primero y, en cada tarjeta, la salud del equipo al final" "/sitios/$SITIO/ahora?limite=60" "[d['estado_visual'] for d in r['dispositivos']]==sorted((d['estado_visual'] for d in r['dispositivos']), key=lambda e: e!='alerta') and all([c['salud'] for c in d['canales']]==sorted(c['salud'] for c in d['canales']) for d in r['dispositivos'])"
  caso "ahora?tendencia=si: tendencia true, chispa de 24 cubos de una hora arriba y en cada canal" "/sitios/$SITIO/ahora?tendencia=si" "r['tendencia'] is True and r['chispa']['puntos']==24 and r['chispa']['intervalo']=='1 hour' and r['chispa']['desde'].endswith(':00:00.000Z') and all(len(c['chispa'])==24 for d in r['dispositivos'] for c in d['canales'])"
  caso "ahora con limite=0 → 400" "/sitios/$SITIO/ahora?limite=0" 400
  caso "ahora con limite=61 → 400" "/sitios/$SITIO/ahora?limite=61" 400
  caso "histórico del sitio: columnas alineadas con mín, máx y n" "/sitios/$SITIO/historico?magnitud=temperatura&intervalo=1%20hour" "len(r['tiempos'])==len(r['valores'])==len(r['minimos'])==len(r['maximos'])==len(r['n'])==r['puntos'] and r['magnitud']=='temperatura' and r['unidad']=='Cel'"
  caso "histórico del sitio sin magnitud → 400" "/sitios/$SITIO/historico" 400
  caso "histórico del sitio con ventana de más de 366 días → 400" "/sitios/$SITIO/historico?magnitud=temperatura&desde=2024-01-01T00:00:00Z&intervalo=1%20day" 400
  # El del sitio lee todos los canales de la magnitud: su tope es 31 días (docs/16 §61); 31 pasa y 32 no.
  caso "histórico del sitio con 31 días → 200" "/sitios/$SITIO/historico?magnitud=temperatura&desde=2026-10-01T00:00:00Z&hasta=2026-11-01T00:00:00Z&intervalo=1%20day" "r['magnitud']=='temperatura'"
  caso "histórico del sitio con 31 días y 1 hora → 400 (tope de la ruta)" "/sitios/$SITIO/historico?magnitud=temperatura&desde=2026-10-01T00:00:00Z&hasta=2026-11-01T01:00:00Z&intervalo=1%20day" 400
  caso "detectados del sitio: sitio, emisor, tópico, tramas y última" "/cuarentena/detectados?sitio=$SITIO" "isinstance(r,list) and all({'sitio_codigo','emisor','topico','tramas','ultima'}==set(x) for x in r)"
fi
caso "resumen de un sitio inexistente → 404" "/sitios/00000000-0000-4000-8000-000000000000/resumen" 404
caso "ahora de un sitio inexistente → 404" "/sitios/00000000-0000-4000-8000-000000000000/ahora" 404
caso "inventario: cada fila suma estado_visual (cuatro valores) y entrega" /dispositivos "all(d['estado_visual'] in ('inactivo','sin_senal','alerta','normal') and (d['entrega'] is None or 0<=d['entrega']<=100) for d in r)"
caso "inventario: un dispositivo inactivo no tiene entrega" /dispositivos "all(d['entrega'] is None for d in r if d['estado']!='activo')"
caso "inventario filtrado por estado: solo ese estado" "/dispositivos?estado=sin_senal" "all(d['estado_visual']=='sin_senal' for d in r)"
caso "inventario con estado desconocido → 400" "/dispositivos?estado=rojo" 400
caso "inventario orden=entrega: de peor a mejor, sin cálculo al final" "/dispositivos?orden=entrega" "(lambda e: e==sorted(e, key=lambda x: (x is None, x or 0)))([d['entrega'] for d in r])"
caso "inventario con orden desconocido → 400" "/dispositivos?orden=estado" 400
caso "inventario orden=atencion: sin señal, alerta, normal, inactivo; dentro, por nombre" "/dispositivos?orden=atencion" "(lambda k: k==sorted(k))([(['sin_senal','alerta','normal','inactivo'].index(d['estado_visual']), d['nombre']) for d in r])"
# Estado visual (docs/19 §2): el SQL del servidor y la regla escrita, comparados fila por fila con lo que dicen /dispositivos y las
# condiciones abiertas (la misma regla que estadoVisual() del panel, aquí en python). Así se prueban entre sí de verdad (docs/10 punto 65 ii).
ABIERTAS=$(mktemp); ck -s "$API/condiciones?abiertas=true&limite=500" > "$ABIERTAS"
caso "estado visual del servidor = la regla de docs/19 §2 recalculada, fila por fila" /dispositivos "(lambda ab: all(d['estado_visual']==('inactivo' if d['estado']!='activo' else 'sin_senal' if ('sin_comunicacion' in ab.get(d['id'],[]) or d['en_linea'] is False) else 'alerta' if any(t in ('umbral','bateria','manipulacion','tope_superado','reloj_desviado') for t in ab.get(d['id'],[])) else 'normal') for d in r))((lambda cs: {c['dispositivo_id']: [x['tipo'] for x in cs if x['dispositivo_id']==c['dispositivo_id']] for c in cs})(json.load(open('$ABIERTAS'))))"
rm -f "$ABIERTAS"
xtotal=$(ck -s -D - -o /dev/null "$API/dispositivos?limite=1" | tr -d '\r' | awk 'tolower($1)=="x-total:"{print $2}')
ntodos=$(ck -s "$API/dispositivos" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
[[ -n "$xtotal" && "$xtotal" == "$ntodos" ]] && echo "OK    inventario paginado: X-Total ($xtotal) = filas sin paginar" || { echo "FALLA X-Total «$xtotal» ≠ $ntodos filas"; fallos=$((fallos+1)); }
if [[ -n "$CANAL" ]]; then
  caso "histórico de un canal: minimos y maximos alineados" "/canales/$CANAL/historico?intervalo=1%20day" "len(r['minimos'])==len(r['maximos'])==r['puntos'] and all(a<=b for a,b in zip(r['minimos'],r['maximos']))"
fi
esc() { ck -s -o /dev/null -w '%{http_code}' -X "$1" -H 'Content-Type: application/json' --data-binary "$3" "$API$2"; }
if [[ -n "${DISP:-}" ]]; then
  caso "histórico del dispositivo: un eje de tiempos y una serie por canal, con muestras" "/dispositivos/$DISP/historico?intervalo=1%20day&desde=$(date -u -d '30 days ago' +%FT%TZ)" "all(len(c['valores'])==len(c['muestras'])==len(r['tiempos']) for c in r['canales']) and r['puntos']==len(r['tiempos']) and all((m==0)==(v is None) for c in r['canales'] for v,m in zip(c['valores'],c['muestras']))"
  caso "eventos del dispositivo: id, tipo, detalle, ocurrido_en, usuario" "/dispositivos/$DISP/eventos?desde=2026-01-01T00:00:00Z" "isinstance(r,list) and all({'id','tipo','detalle','ocurrido_en','usuario'}==set(e) for e in r)"
  # Keyset (punto 58): dos páginas seguidas no se repiten y, juntas, son la lista sin paginar.
  sig=$(ck -s -D - -o /dev/null "$API/dispositivos/$DISP/eventos?desde=2026-01-01T00:00:00Z&limite=2" | tr -d '\r' | awk 'tolower($1)=="x-siguiente:"{print $2}')
  if [[ -n "$sig" ]]; then
    caso "eventos por cursor: la página 2 sigue a la 1 sin repetir" "/dispositivos/$DISP/eventos?desde=2026-01-01T00:00:00Z&limite=2&cursor=$sig" "[e['id'] for e in r]==[e['id'] for e in $(ck -s "$API/dispositivos/$DISP/eventos?desde=2026-01-01T00:00:00Z&limite=4" | python3 -c 'import sys,json; print(json.dumps(json.load(sys.stdin)))')][2:4]"
  fi
  # Escrituras con datos que no deben pasar: nada cambia.
  code=$(esc PATCH "/dispositivos/$DISP" '{"actualizado_en":"2001-01-01T00:00:00.000001Z","nombre":"x"}')
  [ "$code" = 409 ] && echo "OK    PATCH /dispositivos/{id} con marca vieja → 409 (nada se pisa)" || { echo "FALLA PATCH con marca vieja → $code"; fallos=$((fallos+1)); }
  code=$(esc PATCH "/dispositivos/$DISP" '{"actualizado_en":"2001-01-01T00:00:00.000001Z","estado":"baja"}')
  [ "$code" = 400 ] && echo "OK    PATCH /dispositivos/{id} a «baja» → 400 (la baja es DELETE)" || { echo "FALLA PATCH estado baja → $code"; fallos=$((fallos+1)); }
fi
if [[ -n "$CANAL" ]]; then
  code=$(esc PUT "/canales/$CANAL/reglas" '{"actualizado_en":"2001-01-01T00:00:00.000001Z","reglas":[{"umbral_alto":10,"umbral_bajo":20}]}')
  [ "$code" = 400 ] && echo "OK    PUT /canales/{id}/reglas con bajo ≥ alto → 400" || { echo "FALLA PUT reglas inválidas → $code"; fallos=$((fallos+1)); }
  code=$(esc PUT "/canales/$CANAL/reglas" '{"actualizado_en":"2001-01-01T00:00:00.000001Z","reglas":[]}')
  [ "$code" = 409 ] && echo "OK    PUT /canales/{id}/reglas con marca vieja → 409 (nada se pisa)" || { echo "FALLA PUT reglas marca vieja → $code"; fallos=$((fallos+1)); }
fi
caso_lote() { # nombre · cuerpo · expresión sobre r o código
  local out code body; out=$(ck -s -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary "$2" "$API/dispositivos/lote?modo=validar"); code=${out##*$'\n'}; body=${out%$'\n'*}
  if [[ "$3" =~ ^[0-9]{3}$ ]]; then [[ "$code" == "$3" ]] && echo "OK    $1" || { echo "FALLA $1 (HTTP $code, esperado $3)"; fallos=$((fallos+1)); }
  elif python3 -c "import sys,json; r=json.loads(sys.stdin.read()); sys.exit(0 if ($3) else 1)" <<<"$body" 2>/dev/null; then echo "OK    $1"
  else echo "FALLA $1 (HTTP $code) → ${body:0:160}"; fallos=$((fallos+1)); fi
}
caso_lote "lote validar: una fila rechazada no bloquea a la otra, y nada se crea" '{"filas":[{"id_fisico":"lote-humo-01","nombre":"Humo","zona":"Laboratorio","via":"mqtt","intervalo_esperado_s":"60","canales":"temperatura:Cel"},{"id_fisico":"Malo_2","nombre":"x","zona":"Laboratorio","via":"mqtt","intervalo_esperado_s":"60","canales":"temperatura"}]}' "[f['resultado'] for f in r['filas']]==['valida','rechazada'] and r['validas']==1 and r['rechazadas']==1 and r['filas'][1]['n']==3"
caso_lote "lote de 501 filas → 413" "{\"filas\":[$(python3 -c "print(','.join(['{}']*501))")]}" 413
code=$(ck -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary '{"filas":[{}]}' "$API/dispositivos/lote?modo=borrar")
[ "$code" = 400 ] && echo "OK    lote con modo desconocido → 400" || { echo "FALLA lote modo → $code"; fallos=$((fallos+1)); }
DESC=$(ck -s "$API/dispositivos?q=lote-humo-01" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
[ "$DESC" = 0 ] && echo "OK    validar no creó nada (lote-humo-01 no existe)" || { echo "FALLA validar creó $DESC"; fallos=$((fallos+1)); }
caso "condiciones en una ventana (desde, hasta): solo las que se superponen con ella" "/condiciones?desde=2026-10-01T00:00:00Z&hasta=2026-10-02T00:00:00Z&limite=500" "all(c['abierta_en'] < '2026-10-02T00:00:00' and (c['cerrada_en'] is None or c['cerrada_en'] >= '2026-10-01T00:00:00') for c in r)"
caso "condiciones con desde que no es fecha → 400" "/condiciones?desde=ayer" 400
caso "condiciones con cursor manipulado → 400" "/condiciones?cursor=no-es-un-cursor%25" 400
# Un cursor con buena forma y un día que no existe (o el año 0000) era 500 (la base respondía 22008); el punto 58 pide 400.
caso "condiciones con cursor del 30 de febrero → 400" "/condiciones?cursor=$(printf '["2026-02-30T00:00:00Z","11111111-1111-4111-8111-111111111111"]' | base64 -w0 | tr '+/' '-_' | tr -d '=')" 400
caso "condiciones con cursor del año 0000 → 400" "/condiciones?cursor=$(printf '["0000-01-01T00:00:00Z","11111111-1111-4111-8111-111111111111"]' | base64 -w0 | tr '+/' '-_' | tr -d '=')" 400
# Tope de 100 KiB también por trozos (sin Content-Length): antes regía el de 512 KiB del lote en todas las rutas.
# Los cuerpos van en archivos temporales: la entrada estándar de curl ya la ocupa la clave (ck).
if [[ -n "$CANAL" ]]; then
  TROZOS=$(mktemp); trap 'rm -f "$TROZOS"' EXIT
  head -c $((200*1024)) /dev/zero | tr '\0' 'a' > "$TROZOS"
  code=$(ck -s -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/json' -H 'Transfer-Encoding: chunked' --data-binary @"$TROZOS" "$API/canales/$CANAL/reglas")
  [ "$code" = 413 ] && echo "OK    PUT /canales/{id}/reglas con 200 KiB por trozos (sin Content-Length) → 413" || { echo "FALLA 200 KiB por trozos → $code (esperado 413)"; fallos=$((fallos+1)); }
  printf '{"actualizado_en":"2001-01-01T00:00:00.000001Z","reglas":[]}' > "$TROZOS"
  code=$(ck -s -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/json' -H 'Transfer-Encoding: chunked' --data-binary @"$TROZOS" "$API/canales/$CANAL/reglas")
  [ "$code" = 409 ] && echo "OK    el mismo PUT chico por trozos pasa el tope (409 por la marca vieja)" || { echo "FALLA PUT chico por trozos → $code (esperado 409)"; fallos=$((fallos+1)); }
fi
caso "cuarentena con cursor manipulado → 400" "/cuarentena?cursor=eyJ4IjoxfQ" 400
# Cabeceras de seguridad (docs/11 §3). Se leen con -I; el helper `caso` mira cuerpos, así que van aparte.
cab=$(ck -s -I --max-time 10 "$API/dispositivos" | tr -d '\r')
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
# Canal de tiempo real (TT-39, docs/10 §5). Un flujo SSE no termina solo: se leen las cabeceras y curl corta a los 2 s.
cab=$(ck -s -N --max-time 2 -D - -o /dev/null "$API/eventos" | tr -d '\r')
cabecera "SSE: /eventos abre un flujo text/event-stream"              "content-type: text/event-stream" si
cabecera "SSE: le pide al proxy no retenerlo (X-Accel-Buffering: no)" "x-accel-buffering: no" si
cabecera "SSE: sin CORS (una página de otro sitio no puede leerlo)"   "access-control-allow-origin:" no
pagina() { # nombre · cabecera que pondría el navegador · código esperado
  local code; code=$(ck -s -o /dev/null -w '%{http_code}' --max-time 2 -H "$2" "$API/eventos")
  [[ "$code" == "$3" ]] && echo "OK    $1" || { echo "FALLA $1 (HTTP $code, esperado $3)"; fallos=$((fallos+1)); }
}
pagina "SSE: Origin de otro sitio → 403"                                 "Origin: https://otro.example" 403
pagina "SSE: Origin igual al propio (mismo host y puerto) → 200"           "Origin: $API" 200
pagina "SSE: sin Origin pero Sec-Fetch-Site: cross-site (imagen de otro sitio) → 403" "Sec-Fetch-Site: cross-site" 403
pagina "SSE: Sec-Fetch-Site: same-origin (el propio panel) → 200"          "Sec-Fetch-Site: same-origin" 200
caso "SSE: filtro que no es un UUID → 400"                      "/eventos?dispositivo=no-es-uuid" 400
# Lista de nombres de host (docs/11 §3, docs/10 §8.4 punto 40): una página que hace DNS rebinding llega con SU nombre en Host, aunque apunte a
# 127.0.0.1; el backend responde 421 antes de cualquier ruta. El puerto no cuenta; los nombres locales siempre pasan.
conhost() { # nombre · valor de Host · código esperado (en /salud, la ruta más barata)
  local code; code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H "Host: $2" "$API/salud")
  [[ "$code" == "$3" ]] && echo "OK    $1" || { echo "FALLA $1 (HTTP $code, esperado $3)"; fallos=$((fallos+1)); }
}
conhost "Host: nombre de una página ajena (DNS rebinding) → 421"      "ataque.example:3000" 421
conhost "Host: subdominio que termina en localhost → 421"             "localhost.ataque.example" 421
conhost "Host: localhost con otro puerto (Vite, banco) → 200"         "localhost:5173" 200
conhost "Host: 127.0.0.1 con puerto → 200"                            "127.0.0.1:3000" 200
conhost "Host: LOCALHOST en mayúsculas → 200"                         "LOCALHOST:3000" 200
conhost "Host: ilegible (usuario@) → 421"                             "usuario@localhost" 421
# Sin sesión ni clave (docs/20 §6, columna «Sin sesión»): toda lectura y el canal en vivo → 401 con el cuerpo fijo; /salud sigue abierta.
for ruta in /dispositivos "/dispositivos/${DISP:-00000000-0000-4000-8000-000000000000}" "/dispositivos/${DISP:-00000000-0000-4000-8000-000000000000}/exportar" \
            "/canales/${CANAL:-00000000-0000-4000-8000-000000000000}/historico" /condiciones /cuarentena /pasarelas /eventos /usuarios /sesion \
            /sitios "/sitios/${SITIO:-00000000-0000-4000-8000-000000000000}/resumen" "/sitios/${SITIO:-00000000-0000-4000-8000-000000000000}/ahora" /cuarentena/detectados \
            "/dispositivos/${DISP:-00000000-0000-4000-8000-000000000000}/eventos"; do
  r=$(curl -s -m 3 -w '\n%{http_code}' "$API$ruta"); code=${r##*$'\n'}; cuerpo=${r%$'\n'*}
  if [ "$code" = 401 ] && grep -q '"message":"sesión requerida"' <<<"$cuerpo"; then echo "OK    sin sesión: GET $ruta → 401 «sesión requerida»"
  else echo "FALLA sin sesión: GET $ruta → HTTP $code ${cuerpo:0:80} (esperado 401 «sesión requerida»)"; fallos=$((fallos+1)); fi
done
code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 "$API/salud"); [ "$code" = 200 ] && echo "OK    sin sesión: GET /salud → 200 (pública)" || { echo "FALLA GET /salud sin sesión → $code"; fallos=$((fallos+1)); }
echo; [[ $fallos -eq 0 ]] && echo "TODO OK" || { echo "$fallos caso(s) con falla"; exit 1; }
