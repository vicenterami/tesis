#!/usr/bin/env bash
# Carga la semilla de demostración (db/semillas/demo.sql) y verifica que quedó lo que su cabecera promete.
#   bash plataforma/pruebas/semilla-demo.sh             la mínima del guion de docs/15 (dev-0001)
#   bash plataforma/pruebas/semilla-demo.sh --completa  además db/semillas/demo-completa.sql: todos los estados, vías, condiciones y
#                                                       límites, con el resultado esperado en su cabecera; la aplica
#                                                       DOS veces y exige el mismo resultado (reconstruye su escenario, no acumula);
#                                                       desde el 13/11/2026, los casos límite en su propio sitio de pruebas y una
#                                                       trama por cada medición (entrega por dispositivo distinta y creíble)
# Requiere la pila arriba (docker compose up -d en plataforma/). Idempotente: correrla dos veces da lo mismo. Desde el 13/11/2026 respeta
# las claves: a quien ya eligió la suya no se la toca ni se le cortan las sesiones, y una temporal aún vigente se deja como está; solo se
# asigna una temporal nueva a la cuenta que no existía o cuya temporal venció (persona_temporal … conservar, lib-personas.sh). Una cuenta
# desactivada se reactiva siempre con una clave temporal nueva (y sus sesiones cortadas), aunque hubiera elegido la suya.
#   SEMILLA_ROTAR_CLAVES=1 bash plataforma/pruebas/semilla-demo.sh   lo de antes: temporal nueva para las cinco y sesiones cortadas
# Para probar que la verificación de verdad verifica: SEMILLA_DISPOSITIVO=dev-9999 bash … → debe FALLAR.
# Personas de demostración (desde el 08/11/2026, docs/20 §4; desde el 11/11/2026, una por perfil de docs/20 §2: administrador del sistema,
# administrador, investigador, operador técnico y consulta del sitio uct; la del sistema, además, con el perfil global), con correos de
# dominio reservado (@ejemplo.invalid) y una clave TEMPORAL al crearse (vigencia: la del backend, CLAVE_TEMPORAL_HORAS, 2 h por defecto), impresa una sola vez al final
# y solo si quedó en uso; al entrar al panel (P10) se elige una propia. Solo para desarrollo y demostración: SEMILLA_SIN_PERSONAS=1 las omite. Como sus correos son fijos y adivinables, la temporal
# dura CLAVE_TEMPORAL_HORAS (2 h por defecto) y una corrida reactiva la cuenta si existía, SOLO se crean con el backend en bucle local (API=http://127.0.0.1:3000, la de
# por defecto, o localhost); con cualquier otra dirección (un servidor) se omiten con aviso, salvo SEMILLA_PERSONAS=1 explícito
# (revisión de seguridad del 08/11/2026).
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
. "$AQUI/lib-dynsec.sh"
PLAT="$AQUI/.."
. "$AQUI/lib-personas.sh"
cd "$(dirname "$0")/../.."
DISP="${SEMILLA_DISPOSITIVO:-dev-0001}"
API="${API:-http://127.0.0.1:3000}"
# ¿Backend en bucle local? Solo el anfitrión exacto 127.0.0.1, localhost o [::1] (no «127.0.0.1.ejemplo», no una IP de la red).
es_local() { [[ "$1" =~ ^https?://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?(/.*)?$ ]]; }
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
  # Desde el 13/11/2026 los casos límite viven en el sitio de pruebas: la vitrina (uct, lo que ven las personas de demostración) no tiene
  # ninguno, ni de la semilla ni con la forma de uno (identificador en un tope o nombre de 1 u 80 caracteres).
  comprobar "casos límite en el sitio de pruebas: los 2" "SELECT count(*) FROM dispositivo d JOIN zona z ON z.id=d.zona_id JOIN sitio s ON s.id=z.sitio_id WHERE s.codigo='pruebas-limite' AND d.id_fisico IN ('d03','demo-identificador-en-el-limite-de-sesenta-y-tres-caracteres-ok')" 2
  comprobar "el sitio uct no tiene ningún caso límite" "SELECT count(*) FROM dispositivo d JOIN zona z ON z.id=d.zona_id JOIN sitio s ON s.id=z.sitio_id WHERE s.codigo='uct' AND (d.id_fisico IN ('d03','demo-identificador-en-el-limite-de-sesenta-y-tres-caracteres-ok') OR length(d.id_fisico) IN (3, 63) OR length(d.nombre) IN (1, 80))" 0
  comprobar "dispositivos de la semilla por sitio: 8 en uct, 1 en magallanes, 2 en pruebas-limite" "SELECT string_agg(codigo||'='||n, ',' ORDER BY codigo) FROM (SELECT s.codigo, count(*) n FROM dispositivo d JOIN zona z ON z.id=d.zona_id JOIN sitio s ON s.id=z.sitio_id WHERE d.id_fisico IN ($L) GROUP BY 1) x" "magallanes=1,pruebas-limite=2,uct=8"
  # Tramas coherentes con las mediciones: cada medición de la semilla tiene su trama (mismo instante de recepción), la última trama es
  # visto_por_ultima_vez, y la entrega de 24 h (recibidas ÷ esperadas, la regla de consulta/tablero.ts) es la de la cabecera.
  comprobar "toda medición de la semilla tiene su trama" "SELECT count(*) FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico IN ($L) AND NOT EXISTS (SELECT 1 FROM trama t WHERE t.dispositivo_id=d.id AND t.recibido_en=m.recibido_en)" 0
  comprobar "la última trama de cada uno es su visto_por_ultima_vez" "SELECT count(*) FROM dispositivo d JOIN estado_dispositivo e ON e.dispositivo_id=d.id WHERE d.id_fisico IN ($L) AND e.visto_por_ultima_vez IS DISTINCT FROM (SELECT max(recibido_en) FROM trama t WHERE t.dispositivo_id=d.id)" 0
  ENTREGA="SELECT d.id_fisico, round(least(100, round(1000.0 * (SELECT count(*) FROM trama t WHERE t.dispositivo_id=d.id AND t.recibido_en >= now() - INTERVAL '24 hours') / floor(86400.0 / d.intervalo_esperado_s)) / 10), 1) AS p FROM dispositivo d WHERE d.id_fisico IN ($L) AND d.estado='activo' AND d.creado_en <= now() - INTERVAL '24 hours'"
  comprobar "entrega de 24 h por dispositivo, la de la cabecera" "SELECT string_agg(id_fisico||'='||p, ',' ORDER BY id_fisico) FROM ($ENTREGA) x WHERE id_fisico IN ('demo-aire-01','demo-suelo-01','demo-silencioso','demo-lora-01','demo-lora-02')" "demo-aire-01=100.0,demo-lora-01=97.5,demo-lora-02=37.5,demo-silencioso=0.0,demo-suelo-01=91.7"
  comprobar "al menos tres valores de entrega distintos entre los dispositivos de la semilla" "SELECT (count(DISTINCT p) >= 3)::int FROM ($ENTREGA) x" 1
  comprobar "tramas de las últimas 24 h en uct: las de la cabecera (no casi cero)" "SELECT count(*) FROM trama t JOIN dispositivo d ON d.id=t.dispositivo_id JOIN zona z ON z.id=d.zona_id JOIN sitio s ON s.id=z.sitio_id WHERE s.codigo='uct' AND d.id_fisico IN ($L) AND t.recibido_en >= now() - INTERVAL '24 hours'" 718
  comprobar "pasarela inactiva presente (un alta lorawan con ella debe dar 400)" "SELECT count(*) FROM pasarela WHERE id_fisico='demo-pasarela-02' AND NOT activo" 1
  comprobar "sitio con otra zona horaria" "SELECT zona_horaria FROM sitio WHERE codigo='magallanes'" America/Punta_Arenas
  comprobar "las personas de demostración no tienen membresía fuera de uct" "SELECT count(*) FROM usuario_sitio us JOIN usuario u ON u.id=us.usuario_id JOIN sitio s ON s.id=us.sitio_id WHERE u.email LIKE '%-demo@ejemplo.invalid' AND s.codigo <> 'uct'" 0
  comprobar "condición del sistema de la semilla, cerrada" "SELECT count(*) FROM condicion_sistema WHERE detalle->>'origen'='semilla' AND cerrada_en IS NOT NULL" 1
  comprobar "credenciales: ninguna verificable (hash de semilla)" "SELECT count(*) FROM credencial c JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico IN ($L) AND c.hash <> 'scrypt\$semilla\$sin-secreto-inutilizable'" 0
  # La API dice lo mismo que la base (lo que ve el panel): en_linea por dispositivo.
  # Desde el 08/11/2026 la lista exige sesión (docs/20 §6): se lee con la clave de administrador del .env (usuario del sistema).
  api=$(printf 'X-Clave-Admin: %s\n' "$(leer_env "$AQUI/../.env" HTTP_CLAVE_ADMIN 2>/dev/null)" | curl -s -m 5 -H @- "$API/dispositivos" | python3 -I -c "
import sys, json
r = {d['id_fisico']: d['en_linea'] for d in json.load(sys.stdin)}
esperado = {'demo-aire-01': True, 'demo-suelo-01': True, 'demo-silencioso': False, 'demo-mantenimiento': True, 'demo-baja': False,
            'demo-http-01': None, 'demo-lora-01': True, 'demo-lora-02': True, 'd03': True, 'demo-identificador-en-el-limite-de-sesenta-y-tres-caracteres-ok': True, 'demo-mag-01': True}
malos = [f'{k}: API {r.get(k, \"ausente\")}, esperado {v}' for k, v in esperado.items() if r.get(k, 'ausente') != v]
print('; '.join(malos) or 'ok')" 2>&1)
  [ "$api" = ok ] && echo "OK    GET /dispositivos: en_linea de los 11 como dice la cabecera" || { echo "FALLA GET /dispositivos: $api"; fallos=$((fallos+1)); }
fi

# Personas de demostración: se crean (o, según el modo, se les asigna una temporal nueva) al final, y lo que pasó con cada una se imprime
# después de las comprobaciones (así no se mezcla con la salida que se pega en un informe). Sin matrices asociativas (bash 3.2).
ADMIN_DEMO=admin-demo@ejemplo.invalid; CONSULTA_DEMO=consulta-demo@ejemplo.invalid; T_ADMIN=; T_CONSULTA=
INVESTIGADOR_DEMO=investigador-demo@ejemplo.invalid; OPERADOR_DEMO=operador-demo@ejemplo.invalid; SISTEMA_DEMO=sistema-demo@ejemplo.invalid
T_INVESTIGADOR=; T_OPERADOR=; T_SISTEMA=
R_ADMIN=; R_CONSULTA=; R_INVESTIGADOR=; R_OPERADOR=; R_SISTEMA=
MODO=conservar; [ "${SEMILLA_ROTAR_CLAVES:-0}" = 1 ] && MODO=rotar
# persona NOMBRE EMAIL ROL CLAVE → escribe el resultado de persona_temporal (nueva, rotada, propia o vigente), o nada si falló.
persona() { local r; r=$(persona_temporal "$1" "$2" uct "$3" "$MODO" <<<"$4") || return 1; r=${r##* }; [[ "$r" =~ ^(nueva|rotada|propia|vigente)$ ]] || return 1; printf '%s' "$r"; }
PERSONAS=1
if [ "${SEMILLA_SIN_PERSONAS:-0}" = 1 ]; then PERSONAS=0
elif ! es_local "$API" && [ "${SEMILLA_PERSONAS:-0}" != 1 ]; then
  PERSONAS=0
  echo; echo "AVISO personas de demostración OMITIDAS: el backend no está en bucle local (API no es 127.0.0.1 ni localhost); sus correos son"
  echo "      fijos y adivinables. Si de verdad las quieres ahí: SEMILLA_PERSONAS=1 bash plataforma/pruebas/semilla-demo.sh"
fi
if [ "$PERSONAS" = 1 ]; then
  echo; echo "══ personas de demostración (docs/20 §4; modo $MODO) ══"
  T_ADMIN=$(clave_temporal); T_CONSULTA=$(clave_temporal); T_INVESTIGADOR=$(clave_temporal); T_OPERADOR=$(clave_temporal); T_SISTEMA=$(clave_temporal)
  R_ADMIN=$(persona "Administración de demostración" "$ADMIN_DEMO" administrador "$T_ADMIN") || { echo "FALLA no se pudo crear $ADMIN_DEMO"; fallos=$((fallos+1)); }
  R_CONSULTA=$(persona "Consulta de demostración" "$CONSULTA_DEMO" consulta "$T_CONSULTA") || { echo "FALLA no se pudo crear $CONSULTA_DEMO"; fallos=$((fallos+1)); }
  R_INVESTIGADOR=$(persona "Investigación de demostración" "$INVESTIGADOR_DEMO" investigador "$T_INVESTIGADOR") || { echo "FALLA no se pudo crear $INVESTIGADOR_DEMO"; fallos=$((fallos+1)); }
  R_OPERADOR=$(persona "Operación de demostración" "$OPERADOR_DEMO" operador "$T_OPERADOR") || { echo "FALLA no se pudo crear $OPERADOR_DEMO"; fallos=$((fallos+1)); }
  # El administrador del sistema: consulta en uct (para tener un sitio por defecto) y el perfil global (usuario.administrador_sistema).
  R_SISTEMA=$(persona "Sistema de demostración" "$SISTEMA_DEMO" consulta "$T_SISTEMA") \
    && psql_ -c "UPDATE usuario SET administrador_sistema = true WHERE email = '$SISTEMA_DEMO'" >/dev/null || { echo "FALLA no se pudo crear $SISTEMA_DEMO"; fallos=$((fallos+1)); R_SISTEMA=; }
  EMAILS="'$ADMIN_DEMO', '$CONSULTA_DEMO', '$INVESTIGADOR_DEMO', '$OPERADOR_DEMO', '$SISTEMA_DEMO'"
  ESPERADO="$ADMIN_DEMO=administrador,$CONSULTA_DEMO=consulta,$INVESTIGADOR_DEMO=investigador,$OPERADOR_DEMO=operador,$SISTEMA_DEMO=consulta+sistema"
  ROLES="SELECT string_agg(u.email||'='||us.rol||CASE WHEN u.administrador_sistema THEN '+sistema' ELSE '' END, ',' ORDER BY u.email) FROM usuario u JOIN usuario_sitio us ON us.usuario_id = u.id AND us.activo JOIN sitio s ON s.id = us.sitio_id AND s.codigo = 'uct' WHERE u.email IN ($EMAILS) AND u.activo"
  comprobar "personas de demostración: una por perfil del sitio uct, activas, con su rol y con clave propia o temporal vigente" \
    "$ROLES AND (NOT u.clave_temporal OR u.clave_temporal_vence_en > now())" "$ESPERADO"
  if [ "$MODO" = rotar ]; then
    comprobar "SEMILLA_ROTAR_CLAVES=1: las cinco con una temporal recién asignada" \
      "$ROLES AND u.clave_temporal AND u.clave_temporal_vence_en > now() + make_interval(hours => $(horas_clave_temporal)) - interval '5 minutes'" "$ESPERADO"
  fi
fi

echo; [[ $fallos -eq 0 ]] && echo "SEMILLA LISTA: el guion de docs/15 puede empezar" || { echo "$fallos comprobación(es) con falla"; exit 1; }
# Por persona, O su clave temporal nueva (solo si quedó en uso: cuenta nueva o rotada), O qué conserva. Nunca una clave que no quedó en uso.
clave_de() { case "$1" in nueva|rotada) printf 'clave temporal: %s' "$2" ;; propia) printf 'conserva la clave que eligió' ;;
  vigente) printf 'conserva su clave temporal, aún vigente' ;; *) printf 'sin cambios (no se pudo crear)' ;; esac; }
if [ "$PERSONAS" = 1 ]; then
  echo
  echo "Para entrar al panel ($API/panel/), solo desarrollo. Las claves TEMPORALES de abajo se muestran esta única vez y vencen en $(horas_clave_temporal) h"
  echo "(CLAVE_TEMPORAL_HORAS); al entrar, el panel pide elegir una propia y aceptar los términos de uso. Quien ya eligió la suya la conserva."
  echo "Si se pierde una temporal, se espera a que venza y se vuelve a correr la semilla, o SEMILLA_ROTAR_CLAVES=1 (asigna otras a las cinco y corta sus sesiones)."
  echo "  administrador del sistema:      $SISTEMA_DEMO        $(clave_de "$R_SISTEMA" "$T_SISTEMA")"
  echo "  administrador del sitio uct:    $ADMIN_DEMO          $(clave_de "$R_ADMIN" "$T_ADMIN")"
  echo "  investigador del sitio uct:     $INVESTIGADOR_DEMO   $(clave_de "$R_INVESTIGADOR" "$T_INVESTIGADOR")"
  echo "  operador técnico del sitio uct: $OPERADOR_DEMO      $(clave_de "$R_OPERADOR" "$T_OPERADOR")"
  echo "  consulta del sitio uct:         $CONSULTA_DEMO       $(clave_de "$R_CONSULTA" "$T_CONSULTA")"
fi
unset T_ADMIN T_CONSULTA T_INVESTIGADOR T_OPERADOR T_SISTEMA
