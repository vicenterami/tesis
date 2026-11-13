#!/usr/bin/env bash
# La semilla de demostración respeta la clave de quien ya eligió la suya (docs/15 §0, docs/16 §65): prueba de persona_temporal
# (lib-personas.sh) en sus dos modos, con una persona de DESCARTE en un sitio propio, contra la pila de desarrollo. Paso 4d del guardián.
#   bash plataforma/pruebas/personas-semilla-prueba.sh
#   PERSONAS_PLANTAR=1 bash plataforma/pruebas/personas-semilla-prueba.sh   la violación plantada: donde va «conservar» usa «rotar» (lo
#                                                                            que hacía la semilla antes del 13/11/2026) → debe FALLAR
# Recorrido: crear → nueva; repetir en conservar → vigente y la huella igual; marcarla como clave propia → propia, la huella igual y una
# sesión abierta sigue sin revocar; con clave propia y desactivada → rotada (una cuenta desactivada se reactiva siempre con una clave
# temporal nueva), huella nueva y la sesión revocada; vencer la temporal → rotada y la sesión revocada; en rotar → rotada y la sesión revocada.
# Nunca toca las cuentas de demostración (*-demo@ejemplo.invalid): la persona es prueba-s-NNNNNN@ejemplo.invalid, el sitio ps-NNNNNN, y
# todo se borra al salir, también si algo falla (trap). Las claves se generan aquí, viajan por la entrada estándar y no se imprimen; de
# las huellas solo se compara si cambiaron (un md5 de ellas en una variable).
# Salida: 0 todo bien; 1 alguna falla; 3 OMITIDO (sin backend en 127.0.0.1:3000): el guardián lo cuenta como omitido, nunca como aprobado.
set -u
set +x
AQUI="$(cd "$(dirname "$0")" && pwd)"
PLAT="$AQUI/.."
API="http://127.0.0.1:3000"
. "$AQUI/lib-personas.sh"
sql() { docker compose -f "$PLAT/docker-compose.yml" exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA -q "$@"; }
curl -fs -m 3 "$API/salud" >/dev/null || { echo "OMITIDO el backend no responde en $API (docker compose up -d en plataforma/)"; exit 3; }

N=$(date +%s%N | tail -c 7)
SITIO="ps-$N"; EMAIL="prueba-s-$N@ejemplo.invalid"
CONSERVAR=conservar; [ "${PERSONAS_PLANTAR:-0}" = 1 ] && { CONSERVAR=rotar; echo "PLANTADA: «conservar» se corre como «rotar» (lo de antes)"; }

limpiar() {
  sql <<SQL >/dev/null 2>&1 || echo "AVISO no se pudo limpiar todo lo de la corrida $N (sitio $SITIO, persona $EMAIL)"
BEGIN;
CREATE TEMP TABLE u_ps AS SELECT id FROM usuario WHERE email = '$EMAIL';
DELETE FROM acceso WHERE email_intentado = '$EMAIL' OR usuario_id IN (SELECT id FROM u_ps);
DELETE FROM evento WHERE usuario_id IN (SELECT id FROM u_ps) OR (tipo LIKE 'usuario_%' AND detalle->>'usuario_id' IN (SELECT id::text FROM u_ps));
DELETE FROM preferencia WHERE usuario_id IN (SELECT id FROM u_ps);
DELETE FROM mensaje_soporte WHERE usuario_id IN (SELECT id FROM u_ps);
UPDATE usuario SET desactivado_por = NULL WHERE desactivado_por IN (SELECT id FROM u_ps);
DELETE FROM usuario WHERE id IN (SELECT id FROM u_ps);
DELETE FROM sitio WHERE codigo = '$SITIO';
COMMIT;
SQL
  local queda; queda=$(sql -c "SELECT (SELECT count(*) FROM usuario WHERE email = '$EMAIL') + (SELECT count(*) FROM sitio WHERE codigo = '$SITIO')" 2>/dev/null | tr -d '[:space:]')
  [ "$queda" = 0 ] && echo "limpieza: persona y sitio de la prueba borrados" || echo "AVISO quedaron $queda fila(s) de la corrida $N"
}
trap limpiar EXIT

sql -c "INSERT INTO sitio (nombre, codigo) VALUES ('Prueba de personas de la semilla', '$SITIO')" >/dev/null || { echo "FALLA no se pudo crear el sitio de la prueba"; exit 1; }

fallos=0; total=0
ok() { total=$((total+1)); echo "OK    $1"; }
falla() { total=$((total+1)); fallos=$((fallos+1)); echo "FALLA $1"; }
# correr MODO → «resultado» que escribió persona_temporal (o vacío si falló); deja la huella anterior en la tabla temporal de la base
correr() { local r; r=$(persona_temporal "Prueba de la semilla" "$EMAIL" "$SITIO" consulta "$1" <<<"$(clave_temporal)") || return 1; printf '%s' "${r##* }"; }
# ¿Cambió la huella? Se compara un md5 de ella guardado en una variable de este bash (nunca se imprime ni sale a un archivo).
MARCA=""
marcar() { MARCA=$(sql -c "SELECT md5(hash_password) FROM usuario WHERE email = '$EMAIL'" | tr -d '[:space:]'); }
igual() { local ahora; ahora=$(sql -c "SELECT md5(hash_password) FROM usuario WHERE email = '$EMAIL'" | tr -d '[:space:]'); [ -n "$MARCA" ] && [ "$ahora" = "$MARCA" ] && echo t || echo f; }
sesion() { sql -c "INSERT INTO sesion (id, usuario_id, expira_en) SELECT md5(random()::text) || md5(random()::text), id, now() + interval '1 hour' FROM usuario WHERE email = '$EMAIL'" >/dev/null; }
abiertas() { sql -c "SELECT count(*) FROM sesion s JOIN usuario u ON u.id = s.usuario_id WHERE u.email = '$EMAIL' AND s.revocada_en IS NULL" | tr -d '[:space:]'; }
estado() { sql -c "SELECT activo::text || '/' || clave_temporal::text || '/' || coalesce((clave_temporal_vence_en > now())::text, '-') || '/' || (SELECT rol FROM usuario_sitio us JOIN sitio s ON s.id = us.sitio_id WHERE us.usuario_id = u.id AND s.codigo = '$SITIO' AND us.activo) FROM usuario u WHERE email = '$EMAIL'" | tr -d '[:space:]'; }

r=$(correr "$CONSERVAR"); [ "$r" = nueva ] && [ "$(estado)" = true/true/true/consulta ] && ok "cuenta nueva → «nueva», activa, con su rol y la temporal vigente" || falla "crear: «$r», estado $(estado)"
marcar; sesion
r=$(correr "$CONSERVAR"); [ "$r" = vigente ] && [ "$(igual)" = t ] && [ "$(abiertas)" = 1 ] && ok "otra corrida con la temporal vigente → «vigente»: la huella no cambió y la sesión sigue abierta" || falla "vigente: «$r», huella igual $(igual), sesiones abiertas $(abiertas)"
sql -c "UPDATE usuario SET clave_temporal = false, clave_temporal_vence_en = NULL WHERE email = '$EMAIL'; UPDATE usuario_sitio SET rol = 'operador' WHERE usuario_id = (SELECT id FROM usuario WHERE email = '$EMAIL')" >/dev/null
marcar
r=$(correr "$CONSERVAR"); [ "$r" = propia ] && [ "$(igual)" = t ] && [ "$(abiertas)" = 1 ] && [ "$(estado)" = true/false/-/consulta ] && ok "ya eligió su clave y la cuenta está activa → «propia»: la huella no cambió, la sesión abierta sigue sin revocar, y conserva el rol pedido" || falla "propia: «$r», huella igual $(igual), sesiones abiertas $(abiertas), estado $(estado)"
sql -c "UPDATE usuario SET activo = false, desactivado_en = now(), motivo_baja = 'prueba de la semilla' WHERE email = '$EMAIL'" >/dev/null
marcar
r=$(correr "$CONSERVAR"); [ "$r" = rotada ] && [ "$(igual)" = f ] && [ "$(abiertas)" = 0 ] && [ "$(estado)" = true/true/true/consulta ] && ok "ya eligió su clave pero la cuenta está desactivada → «rotada»: se reactiva con una temporal nueva y vigente, nunca con la huella de antes, y la sesión revocada" || falla "desactivada: «$r», huella igual $(igual), sesiones abiertas $(abiertas), estado $(estado)"
sql -c "UPDATE usuario SET clave_temporal = true, clave_temporal_vence_en = now() - interval '1 minute' WHERE email = '$EMAIL'" >/dev/null
marcar; sesion
r=$(correr "$CONSERVAR"); [ "$r" = rotada ] && [ "$(igual)" = f ] && [ "$(abiertas)" = 0 ] && [ "$(estado)" = true/true/true/consulta ] && ok "temporal vencida → «rotada»: huella nueva, temporal vigente otra vez y la sesión revocada" || falla "vencida: «$r», huella igual $(igual), sesiones abiertas $(abiertas), estado $(estado)"
marcar; sesion
r=$(correr rotar); [ "$r" = rotada ] && [ "$(igual)" = f ] && [ "$(abiertas)" = 0 ] && ok "modo rotar (SEMILLA_ROTAR_CLAVES=1 y el e2e) con la temporal vigente → «rotada»: huella nueva y la sesión revocada" || falla "rotar: «$r», huella igual $(igual), sesiones abiertas $(abiertas)"
r=$(persona_temporal "Prueba de la semilla" "$EMAIL" "$SITIO" consulta otro <<<"$(clave_temporal)" 2>&1); [[ "$r" == *"modo «otro»"* ]] && ok "un modo desconocido se rechaza sin tocar nada" || falla "modo desconocido: «${r:0:120}»"

echo
if [ "$fallos" = 0 ] && [ "$total" -gt 0 ]; then echo "PERSONAS DE LA SEMILLA OK ($total de $total comprobaciones)"; else echo "FALLA $fallos de $total comprobaciones"; exit 1; fi
