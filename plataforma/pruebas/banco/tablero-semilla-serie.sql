-- Semilla de las mediciones del tablero v2 en el banco (docs/16 §61). Solo para la base desechable del banco (datos en RAM), nunca en la
-- pila de desarrollo ni en un servidor. Se aplica después de `banco.sh encender 120`:
--   docker compose -p banco -f docker-compose.yml -f pruebas/banco/compose.banco.yml --env-file <banco.env> exec -T timescaledb \
--     psql -U plataforma -d plataforma -v ON_ERROR_STOP=1 < pruebas/banco/tablero-semilla-serie.sql
-- (1) Serie: 30 días a una lectura cada 300 s en el canal de temperatura de cada emulado (120 × 8 640 = 1 036 800 mediciones) y una trama
--     por lectura (1 036 800 tramas). Es lo que cabe en el techo de 768 MB de la base: tramas y mediciones viven en tmpfs dentro de ella.
-- Las listas por clave van en tablero-semilla-listas.sql y NO caben junto con esta serie: la base se cortó por memoria (OOM) al sumarlas el
-- 11/11/2026. Para ellas, un banco nuevo o vaciar antes `trama` (TRUNCATE trama, solo en el banco).
-- Los dispositivos se fechan 31 días atrás para que la entrega cuente la ventana entera.
\timing on
UPDATE dispositivo SET creado_en = now() - INTERVAL '31 days' WHERE id_fisico LIKE 'emu-%';
INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo)
SELECT c.id, t, 20 + 5 * sin(extract(epoch FROM t) / 3600.0) + random(), 'Cel', t, 'dispositivo'
  FROM canal c JOIN dispositivo d ON d.id = c.dispositivo_id
 CROSS JOIN generate_series(now() - INTERVAL '30 days', now() - INTERVAL '5 minutes', INTERVAL '300 seconds') t
 WHERE c.magnitud_codigo = 'temperatura' AND d.id_fisico LIKE 'emu-%';
INSERT INTO trama (dispositivo_id, recibido_en, topico, payload, adaptador)
SELECT d.id, t, 'sitio/banco/dispositivo/' || d.id_fisico || '/senml', convert_to('[{"n":"temperatura","u":"Cel","v":21.5}]', 'UTF8'), 'senml'
  FROM dispositivo d CROSS JOIN generate_series(now() - INTERVAL '30 days', now() - INTERVAL '5 minutes', INTERVAL '300 seconds') t
 WHERE d.id_fisico LIKE 'emu-%';
ANALYZE medicion; ANALYZE trama;
SELECT (SELECT count(*) FROM medicion) AS mediciones, (SELECT count(*) FROM trama) AS tramas;
