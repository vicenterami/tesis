#!/usr/bin/env bash
# Fija la clave del rol de la aplicación (`plataforma_app`, migración 14) a partir de DB_APP_CLAVE del .env y verifica que entra y
# que NO puede lo que no le corresponde (docs/10 §8.4 punto 44; docs/11 §9). Lo corre la persona: la clave la escribe ella en el
# .env (24 caracteres o más; `openssl rand -base64 24`). La clave viaja por la entrada estándar, nunca por argumentos ni pantalla.
#   bash plataforma/pruebas/base-rol-app.sh            pila de desarrollo
#   BASE_DC="docker compose -p banco …" bash …         otro proyecto (lo usa banco.sh)
set -u
AQUI=$(cd "$(dirname "$0")" && pwd) || exit 1      # ruta absoluta del guion: funciona desde cualquier carpeta (14/10)
cd "$AQUI/.." || exit 1                           # plataforma/
. "$AQUI/lib-dynsec.sh"
ENVF="${BASE_ENV:-.env}"
DC="${BASE_DC:-docker compose}"
C=$(leer_env "$ENVF" DB_APP_CLAVE)
[ -n "$C" ] && [ "$C" != CAMBIAR_ESTA_CLAVE ] || { echo "FALLA DB_APP_CLAVE vacía o sin cambiar en $ENVF"; exit 1; }
[ ${#C} -ge 24 ] || { echo "FALLA DB_APP_CLAVE tiene ${#C} caracteres; se exigen 24 o más"; exit 1; }
DUENO=$(leer_env "$ENVF" DB_USUARIO); BASE=$(leer_env "$ENVF" DB_NOMBRE)
$DC exec -T timescaledb psql -X -U "$DUENO" -d "$BASE" -tAq -c "SELECT 1 FROM pg_roles WHERE rolname='plataforma_app'" | grep -q 1 \
  || { echo "FALLA no existe el rol plataforma_app: aplicar antes db/init/14-rol-aplicacion.sql"; exit 1; }
printf '\\set c %s\nALTER ROLE plataforma_app WITH LOGIN PASSWORD :%sc%s;\n' "'$C'" "'" "'" \
  | $DC exec -T timescaledb psql -X -U "$DUENO" -d "$BASE" -q -v ON_ERROR_STOP=1 >/dev/null || { echo "FALLA no se pudo fijar la clave"; exit 1; }
# Verificar el resultado: entrar por TCP con la clave (como el backend) y probar lo permitido y lo prohibido.
# Por la IP de la red interna, NO por 127.0.0.1: la imagen oficial acepta 127.0.0.1 sin clave («trust» en pg_hba.conf), y así se
# «verificaba» una clave que nunca había quedado puesta (13/10). Por la red rige scram-sha-256, como para el backend.
como_app() { PGPASSWORD="$C" $DC exec -T -e PGPASSWORD timescaledb sh -c 'psql -X -h "$(hostname -i | cut -d" " -f1)" -U plataforma_app -d "$1" -tAq -c "$2" 2>&1' sh "$BASE" "$1"; }
fallos=0; ok() { echo "OK    $1"; }; falla() { echo "FALLA $1"; fallos=$((fallos+1)); }
[ "$(como_app 'SELECT 1')" = 1 ] && ok "plataforma_app entra con la clave del .env" || { echo "FALLA plataforma_app no entra"; exit 1; }
r=$(PGPASSWORD="clave-equivocada-de-prueba-xxxxxx" $DC exec -T -e PGPASSWORD timescaledb sh -c 'psql -X -h "$(hostname -i | cut -d" " -f1)" -U plataforma_app -d "$1" -tAq -c "SELECT 1" 2>&1' sh "$BASE")
grep -q 'password authentication failed' <<<"$r" && ok "con otra clave NO entra (la verificación de arriba de verdad prueba la clave)" || falla "con otra clave: ${r:0:80}"
[ "$(como_app "SELECT rolsuper FROM pg_roles WHERE rolname = current_user")" = f ] && ok "no es superusuario" || falla "es superusuario"
r=$(como_app 'SELECT count(*) FROM dispositivo'); [[ "$r" =~ ^[0-9]+$ ]] && ok "lee (SELECT dispositivo: $r)" || falla "no lee: $r"
for s in 'DELETE FROM evento WHERE false' 'TRUNCATE trama' 'DROP TABLE trama' 'CREATE TABLE intrusa (x int)' 'ALTER TABLE dispositivo ADD COLUMN x int' \
         "SELECT drop_chunks('trama'::regclass, older_than => now() - INTERVAL '3650 days')" "SELECT fn_retencion_drop_chunks('dispositivo', 30)" "SELECT fn_retencion_drop_chunks('medicion', 7)"; do
  r=$(como_app "$s"); grep -qiE 'permission denied|must be owner|lista blanca|plazo válido' <<<"$r" && ok "rechazado: $s" || falla "NO rechazado: $s → ${r:0:80}"
done
r=$(como_app "SELECT fn_retencion_drop_chunks('trama', 3650)"); [[ "$r" =~ ^[0-9]+$ ]] && ok "la retención sí puede recortar por su función ($r fragmentos)" || falla "la retención no puede recortar: ${r:0:100}"
echo; [ $fallos -eq 0 ] && echo "ROL DE APLICACIÓN OK" || { echo "$fallos comprobación(es) con falla"; exit 1; }
