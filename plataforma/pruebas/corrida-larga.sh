#!/usr/bin/env bash
# Resumen de una corrida larga de un dispositivo real (TT-32; docs/16): cuántas lecturas entraron por canal, el intervalo entre lecturas
# de cada canal (por la marca de la medición; el «intervalo observado» de la ficha es entre tramas recibidas, por `trama.recibido_en`),
# los huecos mayores que dos intervalos esperados (pérdidas o desconexiones; también el del final hasta ahora: un canal que calló), las alarmas de silencio abiertas y
# cerradas en la ventana (reconexiones), el origen de la marca de tiempo y, por canal, mínimo, máximo y último valor (por ejemplo, el
# % de humedad del suelo al mojar). Solo lee la base; sirve contra la pila de desarrollo (por defecto) o contra el banco (-p banco).
#   bash plataforma/pruebas/corrida-larga.sh <id_fisico> [horas=24] [proyecto=plataforma]
set -euo pipefail
cd "$(dirname "$0")/.."                      # plataforma/
ID=${1:?uso: corrida-larga.sh <id_fisico> [horas] [proyecto]}; H=${2:-24}; P=${3:-plataforma}
[[ "$ID" =~ ^[a-z0-9-]{1,64}$ ]] || { echo "FALLA id_fisico fuera de la lista blanca [a-z0-9-]"; exit 1; }
[[ "$H" =~ ^[0-9]{1,4}$ ]] || { echo "FALLA horas debe ser un entero"; exit 1; }
# El identificador y las horas entran a psql como variables (:'id' y :h) por la entrada estándar (-f -), nunca interpolados en el SQL;
# la lista blanca de arriba es validación de entrada, no la única defensa (revisión del 22/10).
sql() { docker compose -p "$P" exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 -v id="$ID" -v h="$H" "$@" -f -; }
echo "── $ID · últimas $H h (proyecto $P) ──"
if ! cab=$(sql -tA -F ' · ' <<'SQL'
SELECT 'intervalo esperado ' || COALESCE(intervalo_esperado_s::text, '?') || ' s', 'vía ' || via,
       'visto por última vez ' || COALESCE(to_char(e.visto_por_ultima_vez AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), 'nunca') || ' UTC'
FROM dispositivo d LEFT JOIN estado_dispositivo e ON e.dispositivo_id = d.id WHERE d.id_fisico = :'id';
SQL
); then echo "FALLA la base no respondió (¿pila apagada o proyecto equivocado? -p $P)"; exit 1; fi
[ -n "$cab" ] || { echo "FALLA no existe el dispositivo $ID"; exit 1; }; echo "$cab"
echo "── lecturas por canal, intervalo observado (mediana entre lecturas) y huecos > 2 × esperado (incluido el del final: canal que calló) ──"
sql <<'SQL'
WITH d AS (SELECT id, intervalo_esperado_s FROM dispositivo WHERE id_fisico = :'id'),
m AS (SELECT c.magnitud_codigo AS canal, m.tiempo, m.valor, m.origen_tiempo,
             m.tiempo - lag(m.tiempo) OVER (PARTITION BY c.id ORDER BY m.tiempo) AS dt
      FROM medicion m JOIN canal c ON c.id = m.canal_id JOIN d ON d.id = c.dispositivo_id
      WHERE m.tiempo > now() - make_interval(hours => :h))
SELECT canal, count(*) AS lecturas,
       round(EXTRACT(epoch FROM percentile_cont(0.5) WITHIN GROUP (ORDER BY dt))) AS intervalo_obs_s,
       (SELECT intervalo_esperado_s FROM d) AS esperado_s,
       count(*) FILTER (WHERE dt > 2 * make_interval(secs => (SELECT intervalo_esperado_s FROM d)))
         + (now() - max(tiempo) > 2 * make_interval(secs => (SELECT intervalo_esperado_s FROM d)))::int AS huecos,
       round(EXTRACT(epoch FROM GREATEST(max(dt), now() - max(tiempo)))) AS hueco_max_s,
       round(min(valor)::numeric, 2) AS minimo, round(max(valor)::numeric, 2) AS maximo,
       round((array_agg(valor ORDER BY tiempo DESC))[1]::numeric, 2) AS ultimo,
       string_agg(DISTINCT origen_tiempo, ',') AS origen
FROM m GROUP BY canal ORDER BY canal;
SQL
echo "── alarmas de silencio en la ventana (una fila por apertura; cerrada = reconexión vista) ──"
sql <<'SQL'
SELECT co.abierta_en AT TIME ZONE 'UTC' AS abierta_utc, co.cerrada_en AT TIME ZONE 'UTC' AS cerrada_utc,
       round(EXTRACT(epoch FROM (COALESCE(co.cerrada_en, now()) - co.abierta_en))) AS duracion_s
FROM condicion co JOIN dispositivo d ON d.id = co.dispositivo_id
WHERE d.id_fisico = :'id' AND co.tipo = 'sin_comunicacion' AND co.abierta_en > now() - make_interval(hours => :h)
ORDER BY co.abierta_en;
SQL
echo "── tramas en cuarentena y otras condiciones en la ventana ──"
sql -tA -F ' · ' <<'SQL'
SELECT 'cuarentena: ' || count(*) FROM cuarentena q JOIN dispositivo d ON d.id = q.dispositivo_id
 WHERE d.id_fisico = :'id' AND q.recibido_en > now() - make_interval(hours => :h)
UNION ALL
SELECT 'condiciones ' || co.tipo || ': ' || count(*) FROM condicion co JOIN dispositivo d ON d.id = co.dispositivo_id
 WHERE d.id_fisico = :'id' AND co.tipo <> 'sin_comunicacion' AND co.abierta_en > now() - make_interval(hours => :h) GROUP BY co.tipo;
SQL
