#!/usr/bin/env bash
# P15 «Zonas», P17 «Sitios» y las zonas nuevas del alta (docs/19 §4, U y U2), de extremo a extremo en navegadores reales contra la pila de
# desarrollo. Por cada navegador (Chromium y Firefox, los de Playwright) y cada ancho (390 px, teléfono; 1 280 px, escritorio), un administrador
# del sistema de descarte crea un sitio desde «Sitios» y lo edita, agrega, renombra, retira y vuelve a ofrecer zonas en sus Ajustes, crea una
# zona desde el alta de a uno, da de alta 3 equipos por lote en una zona que no existe (sin la casilla no entran; con ella, sí) y mira que
# «Actividad» lo cuente; sin desplazamiento horizontal ni errores de JavaScript. El recorrido lo hace backend/panel/e2e/estructura.mjs.
#   bash plataforma/pruebas/panel-estructura-e2e.sh
#   E2E_CAPTURAS=<carpeta> bash plataforma/pruebas/panel-estructura-e2e.sh      (guarda capturas; por defecto, ninguna)
#   E2E_NAVEGADORES=chromium bash …                                             (uno solo)
# Salida: 0 todo bien; 1 alguna falla (también si algo quedó en la base al salir); 3 OMITIDO (sin backend, sin la ruta de zonas o sin los
# navegadores de Playwright): nunca se cuenta como aprobado. Datos propios y desechables: un sitio es<NNNNNN> con la zona «Norte» (el sitio activo
# del panel de las personas de descarte), los sitios sede-e2e-es<NNNNNN>… que crea la prueba, sus zonas, sus equipos y sus eventos, y personas
# @ejemplo.invalid (RFC 2606). La aplicación no puede borrar sitios ni zonas; esta limpieza lo hace como dueño de la base, al salir, también si
# algo falla (trap), y cuenta lo que quedó: debe ser 0. Las claves se generan aquí y viajan por la entrada estándar. No corre la semilla ni toca
# otras cuentas ni otros sitios.
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
curl -s -m 3 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$API/sitios" | grep -qE '^(400|401|403)$' || omitir "el backend no tiene POST /sitios (¿imagen anterior al bloque «Sitios y zonas desde el panel»?)"
NAVS="${E2E_NAVEGADORES:-chromium firefox}"
for n in $NAVS; do case "$n" in chromium|firefox) ;; *) echo "FALLA E2E_NAVEGADORES admite chromium y firefox (recibí «$n»)"; exit 2 ;; esac; done
for n in $NAVS; do
  (cd "$PANEL" && node -e "const fs=require('node:fs');const p=require('playwright')['$n'];if(!p||!fs.existsSync(p.executablePath()))process.exit(1)") 2>/dev/null \
    || omitir "no está el navegador $n de Playwright (cd plataforma/backend/panel && pnpm exec playwright install $n)"
done

# El identificador de la corrida (es<NNNNNN>) sale del reloj; antes de armar la limpieza se comprueba que esté libre (más abajo).
nueva_corrida() {
  N=$(date +%s%N | tail -c 7)
  P="es$N"; SA="$P"; NOMBRE_BASE="Prueba e2e de sitios $N"; DOM="-$N@ejemplo.invalid"
}
nueva_corrida
CAPT="${E2E_CAPTURAS:-}"
[ -n "$CAPT" ] && { mkdir -p "$CAPT" && CAPT="$(cd "$CAPT" && pwd)"; }

restos() {
  sql -F ' ' -c "SELECT (SELECT count(*) FROM sitio WHERE codigo = '$SA' OR codigo LIKE 'sede-e2e-$P%'), (SELECT count(*) FROM zona z JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo = '$SA' OR s.codigo LIKE 'sede-e2e-$P%'),
    (SELECT count(*) FROM dispositivo WHERE id_fisico LIKE '$P%'), (SELECT count(*) FROM usuario WHERE email LIKE '%$DOM'), (SELECT count(*) FROM evento e WHERE e.detalle::text LIKE '%$P%'),
    (SELECT count(*) FROM sesion se JOIN usuario u ON u.id = se.usuario_id WHERE u.email LIKE '%$DOM'), (SELECT count(*) FROM usuario_sitio us JOIN usuario u ON u.id = us.usuario_id WHERE u.email LIKE '%$DOM'),
    (SELECT count(*) FROM preferencia pr JOIN usuario u ON u.id = pr.usuario_id WHERE u.email LIKE '%$DOM'), (SELECT count(*) FROM acceso WHERE email_intentado LIKE '%$DOM');"
}
# Lo que esta corrida escribió FUERA de sus sitios: eventos de sitio o de zona de sus personas cuyo sitio no es de la corrida, y cualquier evento
# de ellas sobre un equipo que no es de la corrida. Son la huella de una escritura en un sitio real; deben ser 0.
ajenos() {
  sql -c "SELECT count(*) FROM evento e WHERE e.usuario_id IN (SELECT id FROM usuario WHERE email LIKE '%$DOM')
    AND ((e.tipo IN ('zona_alta', 'zona_cambio', 'sitio_alta', 'sitio_cambio')
          AND COALESCE(e.detalle->>'sitio_id', '') NOT IN (SELECT id::text FROM sitio WHERE codigo = '$SA' OR codigo LIKE 'sede-e2e-$P%'))
      OR (e.dispositivo_id IS NOT NULL AND e.dispositivo_id NOT IN (SELECT d.id FROM dispositivo d LEFT JOIN zona z ON z.id = d.zona_id LEFT JOIN sitio s ON s.id = z.sitio_id
          WHERE d.id_fisico LIKE '$P-%' OR s.codigo = '$SA' OR s.codigo LIKE 'sede-e2e-$P%')));"
}
# Cuando la limpieza se detiene (escritura fuera de los sitios de la corrida, o no se pudo comprobar), las personas de descarte no pueden quedar
# como administradoras del sistema con sesión abierta: se revocan sus sesiones, se les quita `administrador_sistema` y se desactivan (si la
# base tiene la columna `activo`). No se borra nada: ni eventos ni filas; solo se cierra la puerta. Devuelve 0 si lo logró.
neutralizar() {
  sql >/dev/null 2>"$T/neutralizar.txt" <<SQL
BEGIN;
UPDATE sesion SET revocada_en = now() WHERE revocada_en IS NULL AND usuario_id IN (SELECT id FROM usuario WHERE email LIKE '%$DOM');
UPDATE usuario SET administrador_sistema = false WHERE email LIKE '%$DOM' AND administrador_sistema;
DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'usuario' AND column_name = 'activo') THEN
    UPDATE usuario SET activo = false, desactivado_en = now(), motivo_baja = 'prueba de extremo a extremo detenida: revisar a mano' WHERE email LIKE '%$DOM' AND activo;
  END IF;
END \$\$;
COMMIT;
SQL
}
neutralizado() {
  if neutralizar; then echo "se revocaron las sesiones de las personas *$DOM, se les quitó el perfil de administrador del sistema y se desactivaron (sin borrar ningún evento)"
  else echo "AVISO tampoco se pudo neutralizar a las personas *$DOM (revocar sesiones, quitar administrador del sistema): $(head -c 300 "$T/neutralizar.txt" | tr '\n' ' ')"; fi
}
limpiar() {
  # ANTES de borrar nada: si hay huella de una escritura fuera de los sitios de la corrida, no se borra ningún evento ni se sigue limpiando;
  # solo se neutraliza a las personas de descarte.
  local aj
  aj=$(ajenos 2>"$T/ajenos.txt")
  if ! [[ "$aj" =~ ^[0-9]+$ ]]; then
    echo "FALLA no se pudo comprobar si la corrida $N escribió fuera de sus sitios; no se limpia nada (revisar a mano; restos: sitios $SA y sede-e2e-$P%, personas *$DOM)"
    neutralizado
    exit 1
  fi
  if [ "$aj" != 0 ]; then
    echo "FALLA la corrida $N dejó $aj evento(s) de sitio, zona o equipo FUERA de sus sitios (una escritura en un sitio que no es de la prueba). No se borra ningún evento ni se sigue limpiando: revisar a mano (personas *$DOM, sitios $SA y sede-e2e-$P%; salidas en $T)"
    neutralizado
    exit 1
  fi
  sql <<SQL >/dev/null 2>"$T/limpieza.txt" || echo "AVISO no se pudo limpiar todo lo de la corrida $N: $(head -c 300 "$T/limpieza.txt" | tr '\n' ' ')"
BEGIN;
CREATE TEMP TABLE u_e2e AS SELECT id FROM usuario WHERE email LIKE '%$DOM';
CREATE TEMP TABLE s_e2e AS SELECT id FROM sitio WHERE codigo = '$SA' OR codigo LIKE 'sede-e2e-$P%';
CREATE TEMP TABLE d_e2e AS SELECT d.id FROM dispositivo d JOIN zona z ON z.id = d.zona_id WHERE z.sitio_id IN (SELECT id FROM s_e2e)
  UNION SELECT id FROM dispositivo WHERE id_fisico LIKE '$P-%';
DELETE FROM medicion WHERE canal_id IN (SELECT id FROM canal WHERE dispositivo_id IN (SELECT id FROM d_e2e));
DELETE FROM trama WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM cuarentena WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM evento WHERE dispositivo_id IN (SELECT id FROM d_e2e) OR usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM estado_dispositivo WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM canal WHERE dispositivo_id IN (SELECT id FROM d_e2e);
DELETE FROM dispositivo_zona WHERE dispositivo_id IN (SELECT id FROM d_e2e) OR zona_id IN (SELECT id FROM zona WHERE sitio_id IN (SELECT id FROM s_e2e));
DELETE FROM dispositivo WHERE id IN (SELECT id FROM d_e2e);
DELETE FROM zona WHERE sitio_id IN (SELECT id FROM s_e2e);
DELETE FROM acceso WHERE email_intentado LIKE '%$DOM' OR usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM sesion WHERE usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM preferencia WHERE usuario_id IN (SELECT id FROM u_e2e);
DELETE FROM usuario_sitio WHERE usuario_id IN (SELECT id FROM u_e2e);
UPDATE usuario SET desactivado_por = NULL WHERE desactivado_por IN (SELECT id FROM u_e2e);
DELETE FROM usuario WHERE id IN (SELECT id FROM u_e2e);
DELETE FROM sitio WHERE id IN (SELECT id FROM s_e2e);
COMMIT;
SQL
  local r
  r=$(restos)
  echo "lo que quedó de la corrida $N (sitios zonas dispositivos personas eventos sesiones usuario_sitio preferencias accesos): $r"
  rm -rf "$T"
  [ "$r" = "0 0 0 0 0 0 0 0 0" ] || { echo "FALLA quedaron filas de la corrida $N en la base"; exit 1; }
}
# El identificador tiene que estar libre ANTES de armar la limpieza: si ya hay algo con él (un sitio es<N> o sede-e2e-es<N>…, personas *-<N>@…,
# equipos es<N>-…, eventos que lo nombran, intentos de acceso con esos correos), la limpieza lo borraría sin haberlo creado. Se elige otro, pocas veces; si no, se sale sin limpiar.
libre=""
for intento in 1 2 3 4 5; do
  r=$(restos 2>/dev/null) || { echo "FALLA no se pudo comprobar en la base si el identificador de la corrida está libre"; exit 1; }
  [ "$r" = "0 0 0 0 0 0 0 0 0" ] && { libre=1; break; }
  echo "AVISO el identificador $P ya está en uso en la base ($r): se elige otro"
  nueva_corrida
done
[ -n "$libre" ] || { echo "FALLA no se encontró un identificador de corrida libre en 5 intentos; no se crea ni se limpia nada"; exit 1; }
T=$(mktemp -d "${TMPDIR:-/tmp}/panel-estructura-e2e.XXXXXX") || exit 1
trap limpiar EXIT

# ── Datos: el sitio de las personas, con «Norte»: es el predeterminado de ellas, o sea el sitio activo del panel en el alta masiva ──
CREADOS=$(sql <<SQL
WITH s AS (INSERT INTO sitio (nombre, codigo, zona_horaria) VALUES ('$NOMBRE_BASE', '$SA', 'America/Santiago') RETURNING id),
     z AS (INSERT INTO zona (sitio_id, nombre) SELECT s.id, 'Norte' FROM s RETURNING id)
SELECT (SELECT count(*) FROM s) || ' ' || (SELECT count(*) FROM z);
SQL
)
[ "$CREADOS" = "1 1" ] || { echo "FALLA no se pudieron crear los datos de prueba ($CREADOS)"; exit 1; }
echo "datos de prueba: sitio $SA con una zona; personas *$DOM; panel en $BASE"

fallos=0; total_ok=0; total=0
for n in $NAVS; do
  lineas=""
  for ancho in 390 1280; do
    email="est-$n-$ancho$DOM"; tmp=$(clave_temporal); nueva=$(clave_temporal)$(clave_temporal)
    persona_temporal "Sitios e2e" "$email" "$SA" administrador <<<"$tmp" >/dev/null || { echo "FALLA no se pudo crear $email"; exit 1; }
    sql -c "UPDATE usuario SET administrador_sistema = true WHERE email = '$email'" >/dev/null || { echo "FALLA no se pudo dar el perfil de administrador del sistema a $email"; exit 1; }
    sql -c "INSERT INTO preferencia (usuario_id, sitio_predeterminado) SELECT u.id, s.id FROM usuario u, sitio s WHERE u.email = '$email' AND s.codigo = '$SA' ON CONFLICT (usuario_id) DO UPDATE SET sitio_predeterminado = EXCLUDED.sitio_predeterminado" >/dev/null \
      || { echo "FALLA no se pudo fijar el sitio predeterminado de $email"; exit 1; }
    lineas+="$ancho"$'\t'"$email"$'\t'"$tmp"$'\t'"$nueva"$'\n'
  done
  entrada=$(python3 -I -c '
import json, sys
base, nav, pref, sitio, nombre, capt = sys.argv[1:7]
casos = []
for l in sys.stdin.read().splitlines():
    if not l: continue
    ancho, email, tmp, nueva = l.split("\t")
    casos.append({"ancho": int(ancho), "email": email, "temporal": tmp, "nueva": nueva})
print(json.dumps({"base": base, "navegador": nav, "prefijo": pref, "sitio_base": sitio, "nombre_base": nombre, "capturas": capt or None, "casos": casos}))
' "$BASE" "$n" "$P" "$SA" "$NOMBRE_BASE" "$CAPT" <<<"$lineas")
  unset lineas tmp nueva
  (cd "$PANEL" && node e2e/estructura.mjs <<<"$entrada") > "$T/$n.txt" 2>&1; r=$?
  unset entrada
  cat "$T/$n.txt"
  [ "$r" = 0 ] || fallos=$((fallos+1))
  total_ok=$((total_ok + $(grep -c '^OK ' "$T/$n.txt"))); total=$((total + $(grep -cE '^(OK|FALLA) ' "$T/$n.txt")))
done
[ -n "$CAPT" ] && echo "capturas: $CAPT"
echo
if [ "$fallos" = 0 ] && [ "$total" -gt 0 ]; then echo "TODO OK ($total_ok de $total comprobaciones de sitios y zonas, en: $NAVS)"; else echo "FALLA $((total - total_ok)) de $total comprobaciones de sitios y zonas"; exit 1; fi
