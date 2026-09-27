#!/usr/bin/env bash
# Carga la semilla de demostración (db/semillas/demo.sql) y verifica que quedó lo que su cabecera promete.
#   bash plataforma/pruebas/semilla-demo.sh
# Requiere la pila arriba (docker compose up -d en plataforma/). Idempotente: correrla dos veces da lo mismo.
# Para probar que la verificación de verdad verifica: SEMILLA_DISPOSITIVO=dev-9999 bash … → debe FALLAR.
set -u
cd "$(dirname "$0")/../.."
DISP="${SEMILLA_DISPOSITIVO:-dev-0001}"
psql_() { docker compose -f plataforma/docker-compose.yml exec -T timescaledb psql -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA "$@"; }

echo "══ semilla: plataforma/db/semillas/demo.sql ══"
psql_ < plataforma/db/semillas/demo.sql >/dev/null || { echo "FALLA no se pudo aplicar la semilla"; exit 1; }

fallos=0
comprobar() { # nombre · consulta que devuelve un número · esperado
  local real; real=$(psql_ -c "$2" | tr -d '[:space:]')
  if [ "$real" = "$3" ]; then echo "OK    $1 ($real)"; else echo "FALLA $1: esperado $3, hay ${real:-nada}"; fallos=$((fallos+1)); fi
}
comprobar "sitio del campus"        "SELECT count(*) FROM sitio WHERE id='00000000-0000-0000-0000-000000000001'" 1
comprobar "zona Laboratorio"        "SELECT count(*) FROM zona WHERE id='00000000-0000-0000-0000-000000000002'" 1
comprobar "dispositivo $DISP activo, intervalo 5 s" \
  "SELECT count(*) FROM dispositivo WHERE id_fisico='$DISP' AND estado='activo' AND intervalo_esperado_s=5" 1
comprobar "canal temperatura de $DISP" \
  "SELECT count(*) FROM canal c JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='$DISP' AND c.magnitud_codigo='temperatura'" 1
comprobar "regla de umbral 30/2 sobre ese canal" \
  "SELECT count(*) FROM regla_umbral r JOIN canal c ON c.id=r.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='$DISP' AND r.umbral_alto=30 AND r.histeresis=2" 1

echo; [[ $fallos -eq 0 ]] && echo "SEMILLA LISTA: el guion de docs/15 puede empezar" || { echo "$fallos comprobación(es) con falla"; exit 1; }
