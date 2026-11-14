-- Semilla del histórico del sitio en el banco (docs/19 §4, M6; docs/16 §68): `dias` días a una lectura cada `paso` segundos en el canal de
-- temperatura de cada emulado, sin tramas (GET /sitios/{id}/historico solo lee `medicion`), y el intervalo esperado de los emulados igual a
-- `paso`, como el de un equipo real: la lectura vigente del promedio por dispositivos depende de él (dos intervalos esperados).
-- Solo para la base desechable del banco (datos en RAM), nunca en la pila de desarrollo ni en un servidor. Después de `banco.sh encender N`:
--   docker compose -p banco -f docker-compose.yml -f pruebas/banco/compose.banco.yml --env-file <banco.env> exec -T timescaledb \
--     psql -U plataforma -d plataforma -v ON_ERROR_STOP=1 -v paso=3600 -v dias=30 < pruebas/banco/tablero-semilla-historico.sql
-- Borra ANTES todas las mediciones y tramas del banco (TRUNCATE): con 2 000 emulados, 30 días cada 3 600 s son 1,44 millones de lecturas, y
-- junto con otra serie no caben en los 768 MB de la base. Siembra día por día con un CHECKPOINT entre cada uno (la lección de
-- tablero-semilla-ahora.sql: de una vez, el registro de escritura, también en RAM, pasaba el techo).
-- Guarda: la misma de tablero-semilla-ahora.sql (los datos en tmpfs y el sitio «banco»); si no, aborta sin tocar nada.
\set ON_ERROR_STOP on
DO $guarda$
DECLARE montaje text;
BEGIN
  SELECT split_part(l, ' ', 3) INTO montaje FROM regexp_split_to_table(pg_read_file('/proc/self/mounts'), E'\n') l
   WHERE split_part(l, ' ', 2) = current_setting('data_directory');
  IF montaje IS DISTINCT FROM 'tmpfs' OR NOT EXISTS (SELECT 1 FROM sitio WHERE codigo = 'banco') THEN
    RAISE EXCEPTION 'tablero-semilla-historico.sql es solo para la base desechable del banco (datos en %, sitio «banco» %): no se toca nada',
      coalesce(montaje, 'un montaje desconocido'), CASE WHEN EXISTS (SELECT 1 FROM sitio WHERE codigo = 'banco') THEN 'presente' ELSE 'ausente' END;
  END IF;
END $guarda$;
\timing on
TRUNCATE medicion, trama;
UPDATE dispositivo SET intervalo_esperado_s = :paso, creado_en = least(creado_en, now() - (:dias + 1) * INTERVAL '1 day') WHERE id_fisico LIKE 'emu-%';
SELECT now() AS t0 \gset
-- Cada emulado con su desfase dentro del paso (por su número), para que no reporten todos en el mismo segundo, como en la realidad.
SELECT format($f$INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo)
  SELECT c.id, t, 20 + 5 * sin(extract(epoch FROM t) / 3600.0) + random(), 'Cel', t, 'dispositivo'
    FROM canal c JOIN dispositivo d ON d.id = c.dispositivo_id
   CROSS JOIN LATERAL generate_series(%L::timestamptz - %s * INTERVAL '1 day' + %s * INTERVAL '1 day'
                                        + (substring(d.id_fisico FROM 5)::int %% %s) * INTERVAL '1 second',
                                      %L::timestamptz - %s * INTERVAL '1 day' + %s * INTERVAL '1 day' - INTERVAL '1 microsecond',
                                      %s * INTERVAL '1 second') t
   WHERE c.magnitud_codigo = 'temperatura' AND d.id_fisico LIKE 'emu-%%' AND t < %L::timestamptz$f$,
       :'t0', :dias, k, :paso, :'t0', :dias, k + 1, :paso, :'t0'), 'CHECKPOINT'
  FROM generate_series(0, :dias - 1) k \gexec
ANALYZE medicion;
SELECT :paso AS paso_s, :dias AS dias, (SELECT count(*) FROM medicion) AS mediciones,
       (SELECT count(DISTINCT canal_id) FROM medicion) AS canales, iso_utc(:'t0'::timestamptz) AS hasta;
