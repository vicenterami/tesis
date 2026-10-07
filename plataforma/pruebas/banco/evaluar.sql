-- Evalúa una corrida del emulador (TT-28/TT-29) cruzando el CSV de envíos (tabla banco.envio, cargada por banco.sh;
-- en su propio esquema para no alterar el conteo de tablas de /salud) con lo que quedó en la base del banco.
-- Cada fila de salida es un hecho medido, con su criterio al lado. Lo lee banco.sh evaluar; el criterio de RNF-01
-- (sin pérdida) y RNF-02 (p95 ≤ 2 s) viene de docs/02.
WITH e AS (
  SELECT v.*, c.id AS canal_id
    FROM banco.envio v
    JOIN dispositivo d ON d.id_fisico = v.id
    JOIN canal c ON c.dispositivo_id = d.id AND c.magnitud_codigo = v.magnitud
), publicadas AS (
  SELECT * FROM e WHERE estado IN ('publicada', 'rafaga')
), cruce AS (
  SELECT p.*, m.recibido_en, m.origen_tiempo, m.tiempo AS tiempo_guardado
    FROM publicadas p
    LEFT JOIN medicion m ON m.canal_id = p.canal_id AND m.tiempo = p.tiempo
), desde AS (
  SELECT min(enviado_en) AS t0 FROM banco.envio
), nodos AS (
  SELECT d.id, d.id_fisico, d.intervalo_esperado_s,
         EXISTS (SELECT 1 FROM banco.envio v WHERE v.id = d.id_fisico AND v.estado = 'rafaga') AS tuvo_caida
    FROM dispositivo d WHERE d.id_fisico LIKE 'emu-%'
)
SELECT 'lecturas publicadas (filas del CSV con PUBACK pedido)' AS hecho, count(*)::text AS valor, '' AS criterio FROM publicadas
UNION ALL
SELECT 'lecturas presentes en medicion', count(recibido_en)::text, '' FROM cruce
UNION ALL
SELECT 'lecturas con marca plausible NO guardadas (pérdida real)', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK RNF-01: sin pérdida' ELSE 'FALLA RNF-01' END
  FROM cruce c WHERE recibido_en IS NULL AND c.id NOT IN ('emu-0001', 'emu-0002')
UNION ALL
SELECT 'lecturas de los dos relojes rotos (su marca se descarta: no se cruzan por tiempo)', count(*)::text,
       'esperado: todas en medicion con origen recepcion (ver fila siguiente)'
  FROM publicadas WHERE id IN ('emu-0001', 'emu-0002')
UNION ALL
SELECT 'mediciones de los relojes rotos guardadas con origen recepcion', count(*)::text, ''
  FROM medicion m JOIN canal c ON c.id = m.canal_id JOIN dispositivo d ON d.id = c.dispositivo_id
 WHERE d.id_fisico IN ('emu-0001', 'emu-0002') AND m.origen_tiempo = 'recepcion' AND m.recibido_en >= (SELECT t0 FROM desde)
UNION ALL
SELECT 'mediciones con origen dispositivo (marca del nodo aceptada)', count(*)::text, ''
  FROM medicion m JOIN canal c ON c.id = m.canal_id JOIN dispositivo d ON d.id = c.dispositivo_id
 WHERE d.id_fisico LIKE 'emu-%' AND m.origen_tiempo = 'dispositivo' AND m.recibido_en >= (SELECT t0 FROM desde)
UNION ALL
SELECT 'latencia envío→recepción en el backend, p50 (ms)', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM recibido_en - enviado_en) * 1000)::numeric)::text, ''
  FROM cruce WHERE recibido_en IS NOT NULL AND estado = 'publicada'
UNION ALL
SELECT 'latencia envío→recepción, p95 (ms)', round(percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM recibido_en - enviado_en) * 1000)::numeric)::text,
       CASE WHEN percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM recibido_en - enviado_en)) <= 2 THEN 'OK RNF-02: p95 <= 2 s' ELSE 'FALLA RNF-02' END
  FROM cruce WHERE recibido_en IS NOT NULL AND estado = 'publicada'
UNION ALL
SELECT 'latencia envío→recepción, máx (ms)', round(max(extract(epoch FROM recibido_en - enviado_en) * 1000)::numeric)::text, ''
  FROM cruce WHERE recibido_en IS NOT NULL AND estado = 'publicada'
UNION ALL
SELECT 'deriva medida (recibido_en − tiempo) p95 (ms), solo origen dispositivo', round(percentile_cont(0.95) WITHIN GROUP (ORDER BY abs(extract(epoch FROM recibido_en - tiempo)) * 1000)::numeric)::text, 'la que la vista de salud mostrará (RF-47)'
  FROM medicion m JOIN canal c ON c.id = m.canal_id JOIN dispositivo d ON d.id = c.dispositivo_id
 WHERE d.id_fisico LIKE 'emu-%' AND m.origen_tiempo = 'dispositivo' AND m.recibido_en >= (SELECT t0 FROM desde)
UNION ALL
SELECT 'tramas crudas guardadas (trama)', count(*)::text, 'esperado ≈ tramas publicadas con al menos una lectura nueva'
  FROM trama t JOIN dispositivo d ON d.id = t.dispositivo_id WHERE d.id_fisico LIKE 'emu-%' AND t.recibido_en >= (SELECT t0 FROM desde)
UNION ALL
SELECT 'filas en cuarentena de emulados', count(*)::text, 'esperado 0 (las tramas son válidas)'
  FROM cuarentena q JOIN dispositivo d ON d.id = q.dispositivo_id WHERE d.id_fisico LIKE 'emu-%' AND q.recibido_en >= (SELECT t0 FROM desde)
UNION ALL
SELECT 'condiciones sin_comunicacion abiertas alguna vez en nodos CON caída', count(*)::text, 'esperado > 0: la caída debe detectarse (RNF-03)'
  FROM condicion k JOIN nodos n ON n.id = k.dispositivo_id WHERE k.tipo = 'sin_comunicacion' AND n.tuvo_caida AND k.abierta_en >= (SELECT t0 FROM desde)
UNION ALL
SELECT 'condiciones sin_comunicacion en nodos SIN caída (falsos positivos: jitter + pérdidas)', count(*)::text, 'docs/10 §9.6: medir; el factor 2 de RF-24 es fijo'
  FROM condicion k JOIN nodos n ON n.id = k.dispositivo_id WHERE k.tipo = 'sin_comunicacion' AND NOT n.tuvo_caida AND k.abierta_en >= (SELECT t0 FROM desde)
UNION ALL
SELECT 'condiciones de umbral abiertas alguna vez (nodos calientes)', count(*)::text, 'esperado > 0'
  FROM condicion k JOIN nodos n ON n.id = k.dispositivo_id WHERE k.tipo = 'umbral' AND k.abierta_en >= (SELECT t0 FROM desde)
UNION ALL
SELECT 'condiciones de umbral abiertas AHORA por dispositivo (máximo)', coalesce(max(n_abiertas), 0)::text, 'esperado <= 1 por regla (índice único)'
  FROM (SELECT dispositivo_id, count(*) AS n_abiertas FROM condicion WHERE tipo = 'umbral' AND cerrada_en IS NULL GROUP BY dispositivo_id) x
UNION ALL
SELECT 'eventos registrados en la corrida', count(*)::text, '' FROM evento WHERE ocurrido_en >= (SELECT t0 FROM desde);
