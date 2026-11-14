-- Semilla de «Ahora» en el banco (docs/16 §66): las últimas 24 h de los 120 emulados a un ritmo dado, para medir GET /sitios/{id}/ahora con
-- y sin tendencia junto al resumen. Solo para la base desechable del banco (datos en RAM), nunca en la pila de desarrollo ni en un servidor.
-- Se aplica después de `banco.sh encender 120` (y, para la primera medición, de tablero-semilla-serie.sql), con el psql del banco:
--   docker compose -p banco -f docker-compose.yml -f pruebas/banco/compose.banco.yml --env-file <banco.env> exec -T timescaledb \
--     psql -U plataforma -d plataforma -v ON_ERROR_STOP=1 -v paso=60 -v paso_trama=60 -v vaciar=0 < pruebas/banco/tablero-semilla-ahora.sql
-- paso: segundos entre lecturas del canal de temperatura de cada emulado; paso_trama: entre tramas (igual a paso, salvo cuando no caben);
-- vaciar=1 borra ANTES todas las mediciones y tramas del banco (con 5 s, las 24 h de 120 fuentes no caben junto con la serie de 30 días en los
-- 768 MB de la base). Deja la última trama de cada emulado como `visto_por_ultima_vez` y su intervalo esperado en 3 600 s: nadie publica
-- en el banco, y con el intervalo igual a `paso` el supervisor los pasaría a «sin señal» a los 2 × paso, en plena medición, y «Ahora» leería
-- menos de lo que mide (visto el 13/11/2026 con 60 s: 120 sin señal antes de la primera petición). Así los 120 «reportan» y su última
-- lectura es vigente; el costo de las dos rutas no depende del intervalo (solo lo usan para calcular, no para leer).
-- Guarda (13/11/2026): antes solo un comentario impedía correrlo contra otra base, y con vaciar=1 trunca `medicion` y `trama`. Se aborta si
-- la base no es la del banco, con las dos marcas con que lo distinguen esta carpeta y sus guiones: los datos en tmpfs, en RAM
-- (compose.banco.yml; la pila de desarrollo y el servidor guardan en disco) y el sitio de los emulados, código «banco» (emulador.ts semilla;
-- tablero-medir.sh lo busca por ese código). ON_ERROR_STOP va aquí mismo, para que el error detenga el guion aunque se olvide en la línea de psql.
\set ON_ERROR_STOP on
DO $guarda$
DECLARE montaje text;
BEGIN
  SELECT split_part(l, ' ', 3) INTO montaje FROM regexp_split_to_table(pg_read_file('/proc/self/mounts'), E'\n') l
   WHERE split_part(l, ' ', 2) = current_setting('data_directory');
  IF montaje IS DISTINCT FROM 'tmpfs' OR NOT EXISTS (SELECT 1 FROM sitio WHERE codigo = 'banco') THEN
    RAISE EXCEPTION 'tablero-semilla-ahora.sql es solo para la base desechable del banco (datos en %, sitio «banco» %): no se toca nada',
      coalesce(montaje, 'un montaje desconocido'), CASE WHEN EXISTS (SELECT 1 FROM sitio WHERE codigo = 'banco') THEN 'presente' ELSE 'ausente' END;
  END IF;
END $guarda$;
\timing on
SELECT CASE WHEN :vaciar = 1 THEN 'vaciar' ELSE 'conservar' END AS modo \gset
\if :vaciar
TRUNCATE medicion, trama;
\else
DELETE FROM medicion WHERE tiempo >= now() - INTERVAL '24 hours'
   AND canal_id IN (SELECT c.id FROM canal c JOIN dispositivo d ON d.id = c.dispositivo_id WHERE d.id_fisico LIKE 'emu-%');
DELETE FROM trama WHERE recibido_en >= now() - INTERVAL '24 hours'
   AND dispositivo_id IN (SELECT id FROM dispositivo WHERE id_fisico LIKE 'emu-%');
\endif
UPDATE dispositivo SET intervalo_esperado_s = 3600, creado_en = least(creado_en, now() - INTERVAL '31 days') WHERE id_fisico LIKE 'emu-%';
-- Por hora y con un CHECKPOINT tras cada una: de una vez, con 5 s, el registro de escritura (WAL, también en RAM) más los datos pasaban el
-- techo de la base y el contenedor se reiniciaba vacío (13/11/2026). Todas las horas parten del mismo instante `t0`.
SELECT now() AS t0 \gset
SELECT format($f$INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo)
  SELECT c.id, t, 20 + 5 * sin(extract(epoch FROM t) / 3600.0) + random(), 'Cel', t, 'dispositivo'
    FROM canal c JOIN dispositivo d ON d.id = c.dispositivo_id
   CROSS JOIN generate_series(%L::timestamptz - INTERVAL '24 hours' + INTERVAL '1 second' + %s * INTERVAL '1 hour',
                              least(%L::timestamptz, %L::timestamptz - INTERVAL '23 hours' + %s * INTERVAL '1 hour'), %s * INTERVAL '1 second') t
   WHERE c.magnitud_codigo = 'temperatura' AND d.id_fisico LIKE 'emu-%%' AND t < %L::timestamptz - INTERVAL '23 hours' + %s * INTERVAL '1 hour'$f$,
       :'t0', h, :'t0', :'t0', h, :paso, :'t0', h), 'CHECKPOINT'
  FROM generate_series(0, 23) h \gexec
INSERT INTO trama (dispositivo_id, recibido_en, topico, payload, adaptador)
SELECT d.id, t, 'sitio/banco/dispositivo/' || d.id_fisico || '/senml', convert_to('[{"n":"temperatura","u":"Cel","v":21.5}]', 'UTF8'), 'senml'
  FROM dispositivo d CROSS JOIN generate_series(:'t0'::timestamptz - INTERVAL '24 hours' + INTERVAL '1 second', :'t0'::timestamptz, :paso_trama * INTERVAL '1 second') t
 WHERE d.id_fisico LIKE 'emu-%';
CHECKPOINT;
INSERT INTO estado_dispositivo (dispositivo_id, visto_por_ultima_vez)
SELECT d.id, (SELECT max(recibido_en) FROM trama t WHERE t.dispositivo_id = d.id) FROM dispositivo d WHERE d.id_fisico LIKE 'emu-%'
ON CONFLICT (dispositivo_id) DO UPDATE SET visto_por_ultima_vez = EXCLUDED.visto_por_ultima_vez;
ANALYZE medicion; ANALYZE trama;
SELECT :paso AS paso_s, :paso_trama AS paso_trama_s, :'modo' AS modo,
       (SELECT count(*) FROM medicion) AS mediciones, (SELECT count(*) FROM trama) AS tramas,
       (SELECT count(*) FROM medicion WHERE tiempo >= now() - INTERVAL '24 hours') AS mediciones_24h;
