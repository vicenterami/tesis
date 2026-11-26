#!/usr/bin/env bash
# La calidad del enlace y lo configurable de la vista (docs/19 §4 AA, puntos 3 a 8), de extremo a extremo en navegadores reales contra la pila
# de desarrollo. Por cada navegador (Chromium y Firefox, los de Playwright) y cada ancho (390 px, teléfono; 1 280 px, escritorio), un operador
# técnico de descarte usa «Elegir qué ver» en el Resumen, mira «Red → Calidad del enlace», agrega una magnitud desde «Lo que la trama trae y no
# se guarda» en Configurar y abre «Magnitudes que ves» en Preferencias; sin desplazamiento horizontal, con objetivos táctiles de al menos
# 24 × 24 px y sin errores de JavaScript. El recorrido lo hace backend/panel/e2e/enlace.mjs.
#   bash plataforma/pruebas/panel-enlace-e2e.sh
#   E2E_CAPTURAS=<carpeta> bash plataforma/pruebas/panel-enlace-e2e.sh      (guarda capturas; por defecto, ninguna)
#   E2E_NAVEGADORES=chromium bash …                                         (uno solo)
# Salida: 0 todo bien; 1 alguna falla (también si algo quedó en la base al salir); 3 OMITIDO (sin backend, sin la ruta nueva o sin los navegadores
# de Playwright): nunca se cuenta como aprobado. Datos propios y desechables: un sitio en<NNNNNN> con la zona «Norte», una pasarela chirpstack y un
# nodo LoRaWAN en<NNNNNN>-<navegador>-<ancho> por caso (canales temperatura y rssi, mediciones de la última hora y una trama cruda con co2 y la señal en rxInfo), y personas
# @ejemplo.invalid (RFC 2606). La limpieza la hace como dueño de la base, al salir, también si algo falla (trap), y cuenta lo que quedó: debe ser 0.
# Las claves se generan aquí y viajan por la entrada estándar. No corre la semilla ni toca otras cuentas ni otros sitios.
set -u
set +x
AQUI="$(cd "$(dirname "$0")" && pwd)"
PLAT="$AQUI/.."
PANEL="$PLAT/backend/panel"
API="http://127.0.0.1:3000"
BASE="${E2E_PANEL:-$API}"
. "$AQUI/lib-personas.sh"
sql() { docker compose -f "$PLAT/docker-compose.yml" exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA -q "$@"; }

omitir() { echo "OMITIDO $1"; exit 3; }
curl -fs -m 3 "$API/salud" >/dev/null || omitir "el backend no responde en $API (docker compose up -d en plataforma/)"
curl -fs -m 3 "$BASE/panel/" | grep -q '<div id="app">' || omitir "no hay panel en $BASE/panel/ (¿imagen sin construir o pnpm dev sin arrancar?)"
curl -s -m 3 -o /dev/null -w '%{http_code}' "$API/dispositivos/00000000-0000-4000-8000-000000000000/sin-guardar" | grep -qE '^(401|403|404)$' \
  || omitir "el backend no tiene GET /dispositivos/{id}/sin-guardar (¿imagen anterior al bloque de la calidad del enlace?)"
NAVS="${E2E_NAVEGADORES:-chromium firefox}"
for n in $NAVS; do case "$n" in chromium|firefox) ;; *) echo "FALLA E2E_NAVEGADORES admite chromium y firefox (recibí «$n»)"; exit 2 ;; esac; done
for n in $NAVS; do
  (cd "$PANEL" && node -e "const fs=require('node:fs');const p=require('playwright')['$n'];if(!p||!fs.existsSync(p.executablePath()))process.exit(1)") 2>/dev/null \
    || omitir "no está el navegador $n de Playwright (cd plataforma/backend/panel && pnpm exec playwright install $n)"
done

nueva_corrida() { N=$(date +%s%N | tail -c 7); P="en$N"; SA="$P"; NOMBRE_SITIO="Prueba e2e del enlace $N"; DOM="-$N@ejemplo.invalid"; }
nueva_corrida
CAPT="${E2E_CAPTURAS:-}"
[ -n "$CAPT" ] && { mkdir -p "$CAPT" && CAPT="$(cd "$CAPT" && pwd)"; }

restos() {
  sql -F ' ' -c "SELECT (SELECT count(*) FROM sitio WHERE codigo = '$SA'), (SELECT count(*) FROM pasarela WHERE id_fisico LIKE '$P-%'),
    (SELECT count(*) FROM dispositivo WHERE id_fisico LIKE '$P-%'), (SELECT count(*) FROM usuario WHERE email LIKE '%$DOM'),
    (SELECT count(*) FROM evento WHERE usuario_id IN (SELECT id FROM usuario WHERE email LIKE '%$DOM')),
    (SELECT count(*) FROM preferencia pr JOIN usuario u ON u.id = pr.usuario_id WHERE u.email LIKE '%$DOM');"
}
limpiar() {
  sql <<SQL >/dev/null 2>"$T/limpieza.txt" || echo "AVISO no se pudo limpiar todo lo de la corrida $N: $(head -c 300 "$T/limpieza.txt" | tr '\n' ' ')"
BEGIN;
CREATE TEMP TABLE u_e2e AS SELECT id FROM usuario WHERE email LIKE '%$DOM';
CREATE TEMP TABLE d_e2e AS SELECT id FROM dispositivo WHERE id_fisico LIKE '$P-%';
DELETE FROM medicion WHERE canal_id IN (SELECT id FROM canal WHERE dispositivo_id IN (SELECT id FROM d_e2e));
DELETE FROM trama WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM cuarentena WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM evento WHERE dispositivo_id IN (SELECT id FROM d_e2e) OR usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM condicion WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM estado_dispositivo WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM regla_umbral WHERE canal_id IN (SELECT id FROM canal WHERE dispositivo_id IN (SELECT id FROM d_e2e));
DELETE FROM canal WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM dispositivo_zona WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM dispositivo WHERE id IN (SELECT id FROM d_e2e);
DELETE FROM pasarela WHERE id_fisico LIKE '$P-%';
DELETE FROM zona WHERE sitio_id IN (SELECT id FROM sitio WHERE codigo = '$SA');
DELETE FROM acceso WHERE email_intentado LIKE '%$DOM' OR usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM sesion WHERE usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM preferencia WHERE usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM usuario_sitio WHERE usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM usuario WHERE id IN (SELECT id FROM u_e2e);
DELETE FROM sitio WHERE codigo = '$SA';
COMMIT;
SQL
  local r
  r=$(restos)
  echo "lo que quedó de la corrida $N (sitios pasarelas dispositivos personas eventos preferencias): $r"
  rm -rf "$T"
  [ "$r" = "0 0 0 0 0 0" ] || { echo "FALLA quedaron filas de la corrida $N en la base"; exit 1; }
}
# El identificador tiene que estar libre ANTES de armar la limpieza: si ya hay algo con él, la limpieza lo borraría sin haberlo creado.
libre=""
for intento in 1 2 3 4 5; do
  r=$(restos 2>/dev/null) || { echo "FALLA no se pudo comprobar en la base si el identificador de la corrida está libre"; exit 1; }
  [ "$r" = "0 0 0 0 0 0" ] && { libre=1; break; }
  echo "AVISO el identificador $P ya está en uso en la base ($r): se elige otro"
  nueva_corrida
done
[ -n "$libre" ] || { echo "FALLA no se encontró un identificador de corrida libre en 5 intentos; no se crea ni se limpia nada"; exit 1; }
T=$(mktemp -d "${TMPDIR:-/tmp}/panel-enlace-e2e.XXXXXX") || exit 1
trap limpiar EXIT

# ── Datos: el sitio y la pasarela; un nodo POR CASO (navegador × ancho), con temperatura y rssi, 12 lecturas de la última hora y la
#    trama cruda de la última: «Agregar snr» cambia el nodo, y el caso siguiente debe encontrar el suyo sin tocar ──
sql >/dev/null <<SQL || { echo "FALLA no se pudieron crear el sitio y la pasarela de prueba"; exit 1; }
WITH s AS (INSERT INTO sitio (nombre, codigo, zona_horaria) VALUES ('$NOMBRE_SITIO', '$SA', 'America/Santiago') RETURNING id),
     z AS (INSERT INTO zona (sitio_id, nombre) SELECT s.id, 'Norte' FROM s RETURNING id)
INSERT INTO pasarela (sitio_id, id_fisico, nombre, formato) SELECT s.id, '$P-pas', 'Pasarela e2e', 'chirpstack' FROM s;
SQL
# crear_nodo SUFIJO NOMBRE → imprime el UUID del nodo nuevo
crear_nodo() {
  local id
  id=$(sql <<SQL
INSERT INTO dispositivo (zona_id, id_fisico, nombre, intervalo_esperado_s, via, formato, pasarela_id)
SELECT z.id, '$P-$1', '$2', 300, 'lorawan', 'chirpstack', p.id FROM zona z JOIN sitio s ON s.id = z.sitio_id, pasarela p
 WHERE s.codigo = '$SA' AND p.id_fisico = '$P-pas' RETURNING id;
SQL
)
  [[ "$id" =~ ^[0-9a-f-]{36}$ ]] || return 1
  sql >/dev/null <<SQL || return 1
BEGIN;
INSERT INTO canal (dispositivo_id, magnitud_codigo) VALUES ('$id', 'temperatura'), ('$id', 'rssi');
INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo)
SELECT c.id, now() - k * INTERVAL '5 minutes', CASE c.magnitud_codigo WHEN 'rssi' THEN -95 + k % 4 ELSE 18 + k % 3 END,
       CASE c.magnitud_codigo WHEN 'rssi' THEN 'dBm' ELSE 'Cel' END, now() - k * INTERVAL '5 minutes', 'pasarela'
  FROM canal c CROSS JOIN generate_series(0, 11) AS k WHERE c.dispositivo_id = '$id';
INSERT INTO trama (dispositivo_id, recibido_en, topico, payload, adaptador)
VALUES ('$id', now(), 'sitio/$SA/pasarela/$P-pas/$P-$1/up',
        convert_to(json_build_object('time', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'deviceInfo', json_build_object('devEui', '$P-$1'),
          'object', json_build_object('temperature', 18, 'co2', 415), 'rxInfo', json_build_array(json_build_object('gatewayId', 'aaaaaaaaaaaaaaaa', 'rssi', -95, 'snr', -4.5)))::text, 'UTF8'),
        'chirpstack');
INSERT INTO estado_dispositivo (dispositivo_id, visto_por_ultima_vez) VALUES ('$id', now());
COMMIT;
SQL
  printf '%s' "$id"
}
echo "datos de prueba: sitio $SA, un nodo $P-<navegador>-<ancho> por caso; personas *$DOM; panel en $BASE"

fallos=0; total_ok=0; total=0
for n in $NAVS; do
  lineas=""
  for ancho in 390 1280; do
    email="enl-$n-$ancho$DOM"; tmp=$(clave_temporal); nueva=$(clave_temporal)$(clave_temporal)
    persona_temporal "Enlace e2e" "$email" "$SA" operador <<<"$tmp" >/dev/null || { echo "FALLA no se pudo crear $email"; exit 1; }
    sql -c "INSERT INTO preferencia (usuario_id, sitio_predeterminado) SELECT u.id, s.id FROM usuario u, sitio s WHERE u.email = '$email' AND s.codigo = '$SA' ON CONFLICT (usuario_id) DO UPDATE SET sitio_predeterminado = EXCLUDED.sitio_predeterminado" >/dev/null \
      || { echo "FALLA no se pudo fijar el sitio predeterminado de $email"; exit 1; }
    nodo=$(crear_nodo "$n-$ancho" "Nodo e2e del enlace $n $ancho") || { echo "FALLA no se pudo crear el nodo de $n a $ancho px"; exit 1; }
    lineas+="$ancho"$'\t'"$email"$'\t'"$tmp"$'\t'"$nueva"$'\t'"$nodo"$'\t'"Nodo e2e del enlace $n $ancho"$'\n'
  done
  entrada=$(python3 -I -c '
import json, sys
base, nav, sitio, nombre, capt = sys.argv[1:6]
casos = []
for l in sys.stdin.read().splitlines():
    if not l: continue
    ancho, email, tmp, nueva, nodo, nombre_nodo = l.split("\t")
    casos.append({"ancho": int(ancho), "email": email, "temporal": tmp, "nueva": nueva, "nodo": {"id": nodo, "nombre": nombre_nodo}})
print(json.dumps({"base": base, "navegador": nav, "sitio": sitio, "nombre_sitio": nombre, "capturas": capt or None, "casos": casos}))
' "$BASE" "$n" "$SA" "$NOMBRE_SITIO" "$CAPT" <<<"$lineas")
  unset lineas tmp nueva
  (cd "$PANEL" && node e2e/enlace.mjs <<<"$entrada") > "$T/$n.txt" 2>&1; r=$?
  unset entrada
  cat "$T/$n.txt"
  [ "$r" = 0 ] || fallos=$((fallos+1))
  total_ok=$((total_ok + $(grep -c '^OK ' "$T/$n.txt"))); total=$((total + $(grep -cE '^(OK|FALLA) ' "$T/$n.txt")))
done
[ -n "$CAPT" ] && echo "capturas: $CAPT"
echo
if [ "$fallos" = 0 ] && [ "$total" -gt 0 ]; then echo "TODO OK ($total_ok de $total comprobaciones del enlace y la vista, en: $NAVS)"; else echo "FALLA $((total - total_ok)) de $total comprobaciones del enlace y la vista"; exit 1; fi
