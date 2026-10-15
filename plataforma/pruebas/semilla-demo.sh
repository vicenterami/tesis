#!/usr/bin/env bash
# Carga la semilla de demostración (db/semillas/demo.sql) y verifica que quedó lo que su cabecera promete.
#   bash plataforma/pruebas/semilla-demo.sh             la mínima del guion de docs/15 (dev-0001)
#   bash plataforma/pruebas/semilla-demo.sh --completa  además db/semillas/demo-completa.sql: todos los estados, vías, condiciones y
#                                                       límites, con el resultado esperado en su cabecera; la aplica
#                                                       DOS veces y exige el mismo resultado (reconstruye su escenario, no acumula)
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
comprobar "código del sitio (tópico)" "SELECT codigo FROM sitio WHERE id='00000000-0000-0000-0000-000000000001'" uct
comprobar "zona Laboratorio"        "SELECT count(*) FROM zona WHERE id='00000000-0000-0000-0000-000000000002'" 1
comprobar "dispositivo $DISP activo, intervalo 5 s" \
  "SELECT count(*) FROM dispositivo WHERE id_fisico='$DISP' AND estado='activo' AND intervalo_esperado_s=5" 1
comprobar "canal temperatura de $DISP" \
  "SELECT count(*) FROM canal c JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='$DISP' AND c.magnitud_codigo='temperatura'" 1
comprobar "regla de umbral 30/2 sobre ese canal" \
  "SELECT count(*) FROM regla_umbral r JOIN canal c ON c.id=r.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='$DISP' AND r.umbral_alto=30 AND r.histeresis=2" 1

if [ "${1:-}" = "--completa" ]; then
  echo; echo "══ semilla completa: plataforma/db/semillas/demo-completa.sql (dos veces) ══"
  L="'demo-aire-01','demo-suelo-01','demo-silencioso','demo-mantenimiento','demo-baja','demo-http-01','demo-lora-01','demo-lora-02','d03','demo-identificador-en-el-limite-de-sesenta-y-tres-caracteres-ok','demo-mag-01'"
  for vuelta in 1 2; do psql_ < plataforma/db/semillas/demo-completa.sql >/dev/null || { echo "FALLA la semilla completa no se aplicó (vuelta $vuelta)"; exit 1; }; done
  comprobar "11 dispositivos de la semilla (tras aplicarla dos veces: no acumula)" "SELECT count(*) FROM dispositivo WHERE id_fisico IN ($L)" 11
  comprobar "estados: 9 activos, 1 mantenimiento, 1 baja" "SELECT string_agg(estado||'='||n, ',' ORDER BY estado) FROM (SELECT estado, count(*) n FROM dispositivo WHERE id_fisico IN ($L) GROUP BY 1) x" "activo=9,baja=1,mantenimiento=1"
  comprobar "vías: 2 lorawan, 8 mqtt, 1 http" "SELECT string_agg(via||'='||n, ',' ORDER BY via) FROM (SELECT via, count(*) n FROM dispositivo WHERE id_fisico IN ($L) GROUP BY 1) x" "http=1,lorawan=2,mqtt=8"
  comprobar "en línea 8, fuera 2, nunca visto 1" "SELECT count(*) FILTER (WHERE e.visto_por_ultima_vez >= now() - d.intervalo_esperado_s * 2 * INTERVAL '1 second')||'/'||count(*) FILTER (WHERE e.visto_por_ultima_vez < now() - d.intervalo_esperado_s * 2 * INTERVAL '1 second')||'/'||count(*) FILTER (WHERE e.dispositivo_id IS NULL) FROM dispositivo d LEFT JOIN estado_dispositivo e ON e.dispositivo_id = d.id WHERE d.id_fisico IN ($L)" "8/2/1"
  comprobar "condiciones abiertas: bateria, sin_comunicacion, umbral" "SELECT string_agg(tipo, ',' ORDER BY tipo) FROM condicion c JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico IN ($L) AND cerrada_en IS NULL" "bateria,sin_comunicacion,umbral"
  comprobar "los cuatro tipos de condición presentes" "SELECT count(DISTINCT tipo) FROM condicion c JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico IN ($L)" 4
  comprobar "cuarentena: un motivo por fila y una por HTTP" "SELECT string_agg(origen||':'||motivo, ',' ORDER BY origen, motivo) FROM cuarentena WHERE dispositivo_id IN (SELECT id FROM dispositivo WHERE id_fisico IN ($L)) OR topico='sitio/uct/dispositivo/desconocido-01/temperatura'" "http:malformada,mqtt:dado_de_baja,mqtt:invalida,mqtt:malformada,mqtt:no_registrado"
  comprobar "demo-aire-01: 30 días por hora menos el hueco de 48 h, en 3 canales" "SELECT count(*) FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='demo-aire-01'" 2019
  comprobar "un solo pico de 38,5 °C" "SELECT count(*) FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico='demo-aire-01' AND m.valor=38.5" 1
  comprobar "sin mediciones fuera del rango de su magnitud" "SELECT count(*) FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN magnitud g ON g.codigo=c.magnitud_codigo JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico IN ($L) AND (m.valor < g.rango_min OR m.valor > g.rango_max)" 0
  comprobar "límites: identificadores de 3 y 63 caracteres, nombre de 80" "SELECT string_agg(length(id_fisico)||'/'||length(nombre), ',' ORDER BY length(id_fisico)) FROM dispositivo WHERE id_fisico IN ('d03','demo-identificador-en-el-limite-de-sesenta-y-tres-caracteres-ok')" "3/1,63/80"
  comprobar "pasarela inactiva presente (un alta lorawan con ella debe dar 400)" "SELECT count(*) FROM pasarela WHERE id_fisico='demo-pasarela-02' AND NOT activo" 1
  comprobar "sitio con otra zona horaria" "SELECT zona_horaria FROM sitio WHERE codigo='magallanes'" America/Punta_Arenas
  comprobar "condición del sistema de la semilla, cerrada" "SELECT count(*) FROM condicion_sistema WHERE detalle->>'origen'='semilla' AND cerrada_en IS NOT NULL" 1
  comprobar "credenciales: ninguna verificable (hash de semilla)" "SELECT count(*) FROM credencial c JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico IN ($L) AND c.hash <> 'scrypt\$semilla\$sin-secreto-inutilizable'" 0
  # La API dice lo mismo que la base (lo que ve el panel): en_linea por dispositivo.
  api=$(curl -s -m 5 http://127.0.0.1:3000/dispositivos | python3 -I -c "
import sys, json
r = {d['id_fisico']: d['en_linea'] for d in json.load(sys.stdin)}
esperado = {'demo-aire-01': True, 'demo-suelo-01': True, 'demo-silencioso': False, 'demo-mantenimiento': True, 'demo-baja': False,
            'demo-http-01': None, 'demo-lora-01': True, 'demo-lora-02': True, 'd03': True, 'demo-identificador-en-el-limite-de-sesenta-y-tres-caracteres-ok': True, 'demo-mag-01': True}
malos = [f'{k}: API {r.get(k, \"ausente\")}, esperado {v}' for k, v in esperado.items() if r.get(k, 'ausente') != v]
print('; '.join(malos) or 'ok')" 2>&1)
  [ "$api" = ok ] && echo "OK    GET /dispositivos: en_linea de los 11 como dice la cabecera" || { echo "FALLA GET /dispositivos: $api"; fallos=$((fallos+1)); }
fi

echo; [[ $fallos -eq 0 ]] && echo "SEMILLA LISTA: el guion de docs/15 puede empezar" || { echo "$fallos comprobación(es) con falla"; exit 1; }
