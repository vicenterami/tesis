-- Semilla de las listas por clave del tablero v2 en el banco (docs/16 §61; docs/10 §8.4 punto 58): 200 000 condiciones cerradas repartidas en
-- los 120 emulados (una cada 13 s hacia atrás) y 200 000 eventos de emu-0001. Solo para la base desechable del banco, después de
-- `banco.sh encender 120`; no cabe junto con tablero-semilla-serie.sql en los 768 MB de la base (ver allí). Los planes, tablero-explicar.sql.
\timing on
INSERT INTO condicion (dispositivo_id, tipo, abierta_en, cerrada_en)
SELECT d.id, 'bateria', now() - (n * INTERVAL '13 seconds'), now() - (n * INTERVAL '13 seconds') + INTERVAL '5 seconds'
  FROM generate_series(1, 200000) n
  JOIN LATERAL (SELECT id FROM dispositivo WHERE id_fisico = 'emu-' || lpad((1 + n % 120)::text, 4, '0')) d ON true;
INSERT INTO evento (dispositivo_id, tipo, detalle, ocurrido_en)
SELECT (SELECT id FROM dispositivo WHERE id_fisico = 'emu-0001'), 'prueba_keyset', jsonb_build_object('n', n), now() - n * INTERVAL '13 seconds'
  FROM generate_series(1, 200000) n;
ANALYZE condicion; ANALYZE evento;
SELECT (SELECT count(*) FROM condicion) AS condiciones, (SELECT count(*) FROM evento) AS eventos;
