#!/usr/bin/env bash
# Mide si el bloqueo de la fila del dispositivo que toman la baja y la rotación frena la inserción de una trama hija
# (docs/16 §26; docs/10 §3). Dos sesiones contra la base de la pila que esté arriba: A retiene la fila 4 s con el modo dado y B
# inserta una trama de ese dispositivo con lock_timeout de 1 s. Todo ocurre en transacciones que terminan en ROLLBACK, y al final
# se comprueba que no quedó ninguna fila de la prueba. Lo esperado: con FOR UPDATE, B se cancela por el lock_timeout (la clave
# foránea pide FOR KEY SHARE sobre la fila del padre); con FOR NO KEY UPDATE, B entra sin esperar. Sale 1 si algo no da lo esperado.
#   bash plataforma/pruebas/medir-bloqueo-fila.sh
set -u
cd "$(dirname "$0")/.." || exit 1   # plataforma/
DC=${BASE_DC:-docker compose}
q() { $DC exec -T timescaledb sh -c 'exec psql -X -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh "$@"; }
fallos=0; ok() { echo "OK    $1"; }; falla() { echo "FALLA $1"; fallos=$((fallos+1)); }

grep -q 'FOR NO KEY UPDATE OF d' backend/src/alta/alta.service.ts && ok "el código bloquea con FOR NO KEY UPDATE (alta.service.ts)" \
  || falla "alta.service.ts ya no bloquea con FOR NO KEY UPDATE"
ID=$(q -Atc "SELECT id FROM dispositivo ORDER BY id LIMIT 1" 2>/dev/null)
[[ "$ID" =~ ^[0-9a-f-]{36}$ ]] || { echo "FALLA no hay dispositivo en la base (¿pila apagada o sin semilla?)"; exit 1; }
TRAMA="INSERT INTO trama (dispositivo_id, recibido_en, topico, payload, adaptador) VALUES ('$ID', now(), 'prueba/bloqueo-fila', '\\x00', 'senml')"

# A se identifica por su nombre de aplicación; B espera a verla dormida en pg_sleep, es decir, con la fila ya tomada (docker compose
# exec tarda en arrancar y sin esta espera B podía correr antes que A: medido el 15/10). El tiempo de B lo mide la base
# (clock_timestamp), no el reloj del equipo, que suma el arranque del contenedor. Al terminar B, A se cancela: no hace falta
# esperar su pg_sleep y su transacción se deshace igual.
qa() { $DC exec -T -e PGAPPNAME=medir-bloqueo-a timescaledb sh -c 'exec psql -X -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh "$@"; }
medir() { # modo de bloqueo de la sesión A → «ms resultado» de la sesión B
  qa -c "BEGIN; SELECT id FROM dispositivo WHERE id = '$ID' $1; SELECT pg_sleep(8); ROLLBACK;" >/dev/null 2>&1 &
  local a=$! listo=0
  for _ in $(seq 1 30); do
    [ "$(q -Atc "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'medir-bloqueo-a' AND wait_event = 'PgSleep'")" = 1 ] && { listo=1; break; }
    sleep 0.3
  done
  if [ "$listo" = 1 ]; then
    q -c "BEGIN; SET LOCAL lock_timeout = '1s'; DO \$\$ DECLARE t0 timestamptz := clock_timestamp(); BEGIN $TRAMA;
      RAISE NOTICE 'resultado entra %', round(1000 * extract(epoch FROM clock_timestamp() - t0));
      EXCEPTION WHEN lock_not_available THEN RAISE NOTICE 'resultado cancelada %', round(1000 * extract(epoch FROM clock_timestamp() - t0));
      END \$\$; ROLLBACK;" 2>&1 | grep -oE 'resultado (entra|cancelada) [0-9]+' | awk '{print $3, $2}'
  else
    echo "0 sin-candado"
  fi
  q -Atc "SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE application_name = 'medir-bloqueo-a'" >/dev/null 2>&1
  wait "$a" 2>/dev/null
}
# $(…) espera a que medir termine (también la cancelación de A); con < <(…) la medición siguiente arrancaba antes (15/10).
r=$(medir "FOR UPDATE"); read -r ms res <<<"$r"
[ "$res" = cancelada ] && [ "$ms" -ge 900 ] && ok "FOR UPDATE en A: la trama de B espera y se cancela por el lock_timeout (${ms} ms)" \
  || falla "FOR UPDATE en A: se esperaba la cancelación de B a los 1000 ms y dio «${res:-nada}» en ${ms:-?} ms"
r=$(medir "FOR NO KEY UPDATE"); read -r ms res <<<"$r"
[ "$res" = entra ] && [ "$ms" -lt 200 ] && ok "FOR NO KEY UPDATE en A: la trama de B entra sin esperar (${ms} ms)" \
  || falla "FOR NO KEY UPDATE en A: se esperaba que B entrara en menos de 200 ms y dio «${res:-nada}» en ${ms:-?} ms"
n=$(q -Atc "SELECT count(*) FROM trama WHERE topico = 'prueba/bloqueo-fila'")
[ "$n" = 0 ] && ok "no quedó ninguna fila de la prueba en la base" || falla "quedaron $n filas de la prueba (¿COMMIT en vez de ROLLBACK?)"
echo; [ "$fallos" -eq 0 ] && echo "BLOQUEO DE FILA OK" || { echo "$fallos comprobación(es) con falla"; exit 1; }
