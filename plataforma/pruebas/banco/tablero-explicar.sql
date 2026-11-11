-- Planes de las listas por clave del tablero v2 (docs/16 §61), con las sentencias que corre el backend (consulta.service.ts y
-- tablero.service.ts: las condiciones con sus JOIN a dispositivo, zona, regla y canal), sobre la semilla de tablero-semilla-listas.sql. Página de 50
-- desde el principio, la misma página a la mitad por clave y, para comparar, a la mitad por desplazamiento (lo que el punto 58 evita).
SELECT id AS disp FROM dispositivo WHERE id_fisico = 'emu-0001' \gset
SELECT abierta_en AS t_mitad, id AS id_mitad FROM condicion ORDER BY abierta_en DESC, id DESC OFFSET 100000 LIMIT 1 \gset
\echo '== GET /condiciones?limite=50 (primera página)'
EXPLAIN (ANALYZE, BUFFERS, SUMMARY ON)
SELECT c.id, c.tipo, c.abierta_en, c.cerrada_en, extract(epoch FROM coalesce(c.cerrada_en, now()) - c.abierta_en)::int AS duracion_s,
       d.id AS dispositivo_id, d.id_fisico, d.nombre AS dispositivo, r.umbral_alto, r.umbral_bajo, ca.magnitud_codigo AS magnitud
  FROM condicion c JOIN dispositivo d ON d.id = c.dispositivo_id JOIN zona z ON z.id = d.zona_id
  LEFT JOIN regla_umbral r ON r.id = c.regla_id LEFT JOIN canal ca ON ca.id = r.canal_id
 ORDER BY c.abierta_en DESC, c.id DESC LIMIT 50;
\echo '== GET /condiciones?limite=50&cursor= (a la mitad, por clave)'
EXPLAIN (ANALYZE, BUFFERS, SUMMARY ON)
SELECT c.id, c.tipo, c.abierta_en, c.cerrada_en, extract(epoch FROM coalesce(c.cerrada_en, now()) - c.abierta_en)::int AS duracion_s,
       d.id AS dispositivo_id, d.id_fisico, d.nombre AS dispositivo, r.umbral_alto, r.umbral_bajo, ca.magnitud_codigo AS magnitud
  FROM condicion c JOIN dispositivo d ON d.id = c.dispositivo_id JOIN zona z ON z.id = d.zona_id
  LEFT JOIN regla_umbral r ON r.id = c.regla_id LEFT JOIN canal ca ON ca.id = r.canal_id
 WHERE (c.abierta_en, c.id) < (:'t_mitad'::timestamptz, :'id_mitad'::uuid)
 ORDER BY c.abierta_en DESC, c.id DESC LIMIT 50;
\echo '== la misma página por desplazamiento (OFFSET 100000), solo para comparar'
EXPLAIN (ANALYZE, BUFFERS, SUMMARY ON)
SELECT c.id, c.tipo, c.abierta_en, c.cerrada_en, d.id AS dispositivo_id, d.id_fisico, d.nombre AS dispositivo, r.umbral_alto, r.umbral_bajo, ca.magnitud_codigo
  FROM condicion c JOIN dispositivo d ON d.id = c.dispositivo_id JOIN zona z ON z.id = d.zona_id
  LEFT JOIN regla_umbral r ON r.id = c.regla_id LEFT JOIN canal ca ON ca.id = r.canal_id
 ORDER BY c.abierta_en DESC, c.id DESC OFFSET 100000 LIMIT 50;
\echo '== GET /dispositivos/{id}/eventos?limite=50 (30 días)'
EXPLAIN (ANALYZE, BUFFERS, SUMMARY ON)
SELECT ev.id, ev.tipo, ev.detalle, ev.ocurrido_en, CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('id', u.id, 'nombre', u.nombre) END AS usuario
  FROM evento ev LEFT JOIN usuario u ON u.id = ev.usuario_id
 WHERE ev.dispositivo_id = :'disp' AND ev.ocurrido_en >= now() - INTERVAL '30 days' AND ev.ocurrido_en < now()
 ORDER BY ev.ocurrido_en DESC, ev.id DESC LIMIT 50;
