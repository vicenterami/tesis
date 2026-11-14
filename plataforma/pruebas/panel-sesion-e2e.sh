#!/usr/bin/env bash
# Paso 4c del guardián: P10 (sesión del panel) de extremo a extremo en navegadores reales, contra la pila de desarrollo (docs/19 §4 y §6;
# docs/20; docs/16 §59). Por cada navegador (Chromium y Firefox, los de Playwright) y cada ancho (390 px, teléfono; 1280 px, escritorio):
# entrar con la clave temporal, cambiarla, inventario y quién soy, ficha y exportar CSV, la sesión que vence y vuelve a la misma ficha,
# salir; en el ancho de escritorio, además, la pantalla de usuarios (alta con la temporal mostrada una vez) y la persona de consulta con
# la exportación desactivada. Desde el 11/11/2026 también las pantallas del tablero v2 (docs/19 §7): legal antes de entrar y la
# aceptación obligatoria de los términos; el tablero (indicadores que suman el inventario); P6 (validación en vivo, guardar y el 409 con
# otra escritura entretanto); P7 (asistente con vía HTTP y alta masiva por archivo, sin tocar el broker); P13 (°F en la ficha sin cambiar la base) y
# P14 (el cambio de umbrales con la persona que lo hizo). Desde el 13/11/2026, el tablero v3 (docs/19 §4, bloque L, punto 7): las tres
# pestañas, el menú contraído, el cajón con el teclado y el tema; y, si la semilla completa está cargada (los 8 dispositivos `demo-*` del
# sitio `uct`), una persona de CONSULTA de descarte en ese sitio mide el alto de la pestaña Resumen a 390 × 844 (≤ 2 532 px) y el
# desplazamiento horizontal de cada pestaña a 390 y 1 280 px en los dos temas; sin la semilla, esas comprobaciones se dicen omitidas
# (nunca «OK»). El recorrido lo hace backend/panel/e2e/sesion.mjs.
#   bash plataforma/pruebas/panel-sesion-e2e.sh
#   E2E_CAPTURAS=docs/capturas/panel-sesion bash plataforma/pruebas/panel-sesion-e2e.sh   (guarda capturas; por defecto, ninguna)
#   E2E_NAVEGADORES=chromium bash …                                                       (uno solo)
# Salida: 0 todo bien; 1 alguna falla; 3 OMITIDO (sin backend en 127.0.0.1:3000 o sin los navegadores de Playwright): el guardián lo
# cuenta como omitido, nunca como aprobado. Requiere el panel compilado DENTRO de la imagen del backend (docker compose up -d --build backend).
# Datos de prueba propios y desechables: un sitio pe-NNNNNN con una zona, un dispositivo HTTP con un canal y 6 mediciones de la última
# hora, y personas @ejemplo.invalid (dominio reservado, RFC 2606). Todo se borra al salir, también si algo falla (trap).
# Las claves se generan aquí (openssl rand, a la salida estándar) y quedan solo en variables de este bash; al backend, a python3 y a node
# llegan por la entrada estándar, nunca como argumento de un proceso (visible en `ps -eo args`); no se imprimen.
set -u
set +x
AQUI="$(cd "$(dirname "$0")" && pwd)"
PLAT="$AQUI/.."
PANEL="$PLAT/backend/panel"
API="http://127.0.0.1:3000"
. "$AQUI/lib-personas.sh"
sql() { docker compose -f "$PLAT/docker-compose.yml" exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA -q "$@"; }

omitir() { echo "OMITIDO $1"; exit 3; }
curl -fs -m 3 "$API/salud" >/dev/null || omitir "el backend no responde en $API (docker compose up -d en plataforma/)"
curl -fs -m 3 "$API/panel/" | grep -q '<div id="app">' || omitir "el backend no sirve el panel en /panel/ (¿imagen sin construir?)"
[ -x "$PANEL/node_modules/.bin/vitest" ] || omitir "sin las dependencias del panel (pnpm install en plataforma/backend)"
NAVS="${E2E_NAVEGADORES:-chromium firefox}"
for n in $NAVS; do
  # El ejecutable que Playwright espera para su versión fijada; si no está, «playwright install <navegador>» lo descarga (no se hace aquí).
  (cd "$PANEL" && node -e "const fs=require('node:fs');const p=require('playwright')['$n'];if(!p||!fs.existsSync(p.executablePath()))process.exit(1)") 2>/dev/null \
    || omitir "no está el navegador $n de Playwright (cd plataforma/backend/panel && pnpm exec playwright install $n)"
done

N=$(date +%s%N | tail -c 7)
SITIO="pe-$N"; DOM="-$N@ejemplo.invalid"
CAPT="${E2E_CAPTURAS:-}"
[ -n "$CAPT" ] && { mkdir -p "$CAPT" && CAPT="$(cd "$CAPT" && pwd)"; }
T=$(mktemp -d "${TMPDIR:-/tmp}/panel-e2e.XXXXXX") || exit 1

limpiar() {
  sql <<SQL >/dev/null 2>"$T/limpieza.txt" || { echo "AVISO no se pudo limpiar todo lo de la corrida $N: $(head -c 300 "$T/limpieza.txt" | tr '\n' ' ')"; }
BEGIN;
CREATE TEMP TABLE u_e2e AS SELECT id FROM usuario WHERE email LIKE '%$DOM';
DELETE FROM medicion WHERE canal_id IN (SELECT c.id FROM canal c JOIN dispositivo d ON d.id = c.dispositivo_id JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo = '$SITIO');
DELETE FROM evento WHERE dispositivo_id IN (SELECT d.id FROM dispositivo d JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo = '$SITIO')
   OR (tipo LIKE 'usuario_%' AND detalle->>'usuario_id' IN (SELECT id::text FROM u_e2e));
DELETE FROM estado_dispositivo WHERE dispositivo_id IN (SELECT d.id FROM dispositivo d JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo = '$SITIO');
DELETE FROM canal WHERE dispositivo_id IN (SELECT d.id FROM dispositivo d JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo = '$SITIO');
DELETE FROM dispositivo WHERE zona_id IN (SELECT z.id FROM zona z JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo = '$SITIO');
DELETE FROM zona WHERE sitio_id IN (SELECT id FROM sitio WHERE codigo = '$SITIO');
DELETE FROM acceso WHERE email_intentado LIKE '%$DOM' OR usuario_id IN (SELECT id FROM u_e2e);
-- 11/11/2026: lo que dejan las pantallas nuevas (términos aceptados, preferencias, soporte) y apunta a la persona
DELETE FROM evento WHERE usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM preferencia WHERE usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM mensaje_soporte WHERE usuario_id IN (SELECT id FROM u_e2e);
UPDATE usuario SET desactivado_por = NULL WHERE desactivado_por IN (SELECT id FROM u_e2e);
DELETE FROM usuario WHERE id IN (SELECT id FROM u_e2e);
DELETE FROM sitio WHERE codigo = '$SITIO';
COMMIT;
SQL
  rm -rf "$T"
}
trap limpiar EXIT

# ── Datos: sitio, zona, dispositivo con un canal y 6 mediciones de la última hora (el CSV de «24 horas» trae filas) ─────────────────
IDS=$(sql <<SQL
WITH s AS (INSERT INTO sitio (nombre, codigo) VALUES ('Prueba e2e del panel', '$SITIO') RETURNING id),
     z AS (INSERT INTO zona (sitio_id, nombre) SELECT id, 'zona e2e' FROM s RETURNING id),
     d AS (INSERT INTO dispositivo (zona_id, id_fisico, nombre, via, formato, intervalo_esperado_s) SELECT id, 'te-$N', 'nodo e2e', 'http', 'senml', 60 FROM z RETURNING id),
     c AS (INSERT INTO canal (dispositivo_id, magnitud_codigo) SELECT id, 'temperatura' FROM d RETURNING id),
     m AS (INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo)
           SELECT c.id, now() - (k * interval '10 minutes'), 20 + k, 'Cel', now() - (k * interval '10 minutes'), 'dispositivo' FROM c, generate_series(0, 5) k RETURNING 1)
SELECT concat_ws(' ', (SELECT id FROM d), (SELECT count(*) FROM m));
SQL
)
read -r DISP NMED <<<"$IDS"
[ "${NMED:-0}" = 6 ] || { echo "FALLA no se pudieron crear los datos de prueba ($IDS)"; exit 1; }
echo "datos de prueba: sitio $SITIO, dispositivo te-$N con 6 mediciones; personas *$DOM"
# La semilla completa (bash plataforma/pruebas/semilla-demo.sh --completa) deja 8 dispositivos demo-* en «uct»: sin ellos, la medición
# del alto no dice nada y se omite.
NUCT=$(sql -c "SELECT count(*) FROM dispositivo d JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo = 'uct' AND d.id_fisico LIKE 'demo-%'" 2>/dev/null || echo 0)
if [ "${NUCT:-0}" = 8 ]; then echo "semilla completa: cargada (8 dispositivos demo-* en uct)"; else echo "semilla completa: no está (${NUCT:-0} dispositivos demo-* en uct; se esperan 8)"; fi

fallos=0; total_ok=0; total=0
for n in $NAVS; do
  # Una persona administradora por ancho (cada una entra con su temporal y la cambia); la de escritorio, además, da de alta a una de consulta.
  # Las claves solo viven en variables del propio bash (builtins: nunca en `ps`) y viajan por la entrada estándar: una línea por ancho con
  # «ancho TAB temporal TAB nueva TAB nueva-de-consulta TAB clave-mala»; un solo python3 arma el JSON y node lo lee por su entrada estándar.
  lineas=""
  for ancho in 390 1280; do
    email="adm-$n-$ancho$DOM"; tmp=$(clave_temporal); nueva=$(clave_temporal)$(clave_temporal)
    persona_temporal "Administración e2e" "$email" "$SITIO" administrador <<<"$tmp" >/dev/null || { echo "FALLA no se pudo crear $email"; exit 1; }
    cnueva=""; [ "$ancho" = 1280 ] && cnueva=$(clave_temporal)$(clave_temporal)
    mala=""; [ "$ancho" = 390 ] && mala="no-es-la-clave-$N"
    lineas+="$ancho"$'\t'"$tmp"$'\t'"$nueva"$'\t'"$cnueva"$'\t'"$mala"$'\n'
  done
  if [ "${NUCT:-0}" = 8 ]; then
    email="uct-$n$DOM"; tmp=$(clave_temporal); nueva=$(clave_temporal)$(clave_temporal)
    persona_temporal "Consulta e2e" "$email" uct consulta <<<"$tmp" >/dev/null || { echo "FALLA no se pudo crear $email en uct"; exit 1; }
    lineas+="uct"$'\t'"$tmp"$'\t'"$nueva"$'\t\t'$'\n'
  fi
  entrada=$(python3 -I -c '
import json, sys
base, nav, disp, idf, capt, n, dom, sitio = sys.argv[1:9]
casos = []
uct = None
for l in sys.stdin.read().splitlines():
    if not l: continue
    ancho, tmp, nueva, cnueva, mala = l.split("\t")
    if ancho == "uct":
        uct = {"email": f"uct-{n}{dom}", "temporal": tmp, "nueva": nueva}
        continue
    casos.append({"ancho": int(ancho), "email": f"adm-{n}-{ancho}{dom}", "nombre": "Administración e2e", "temporal": tmp, "nueva": nueva,
                  "consulta": {"nombre": "Consulta e2e", "email": f"con-{n}{dom}", "nueva": cnueva} if cnueva else None, "claveMala": mala or None})
print(json.dumps({"base": base, "navegador": nav, "dispositivo": disp, "idFisico": idf, "sitio": sitio, "capturas": capt or None, "casos": casos,
                  "uct": uct, "uctMotivo": "la semilla completa no está cargada (bash plataforma/pruebas/semilla-demo.sh --completa)"}))
' "$API" "$n" "$DISP" "te-$N" "$CAPT" "$n" "$DOM" "$SITIO" <<<"$lineas")
  unset lineas tmp nueva cnueva
  (cd "$PANEL" && node e2e/sesion.mjs <<<"$entrada") > "$T/$n.txt" 2>&1; r=$?
  cat "$T/$n.txt"
  [ "$r" = 0 ] || fallos=$((fallos+1))
  total_ok=$((total_ok + $(grep -c '^OK ' "$T/$n.txt"))); total=$((total + $(grep -cE '^(OK|FALLA) ' "$T/$n.txt")))
done
[ -n "$CAPT" ] && echo "capturas: $CAPT"
echo
if [ "$fallos" = 0 ] && [ "$total" -gt 0 ]; then echo "TODO OK ($total_ok de $total comprobaciones del panel con sesión, en: $NAVS)"; else echo "FALLA $((total - total_ok)) de $total comprobaciones (navegadores con falla: $fallos)"; exit 1; fi
