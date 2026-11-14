-- Semilla de demostración COMPLETA (escenarios con el resultado esperado escrito en la cabecera: escenarios con el resultado esperado escrito
-- aquí, nunca datos armados a mano). Se aplica DESPUÉS de demo.sql: `bash plataforma/pruebas/semilla-demo.sh --completa`.
-- Reconstruye su escenario en cada corrida, en una transacción: borra y vuelve a crear SOLO los 11 dispositivos de la lista de abajo
-- (nunca dev-0001 ni uno real), con sus canales, mediciones, tramas, cuarentena, condiciones, eventos y credenciales. Correrla dos veces
-- el mismo día da lo mismo; correrla otro día corre las fechas (todo es relativo a hoy). Ninguno tiene cliente en el broker: no publican.
-- Desde el 13/11/2026 el sitio «uct» es la vitrina —lo que ve el administrador de demostración— y los casos límite (identificadores y
-- nombres en los topes) viven en un sitio aparte de pruebas; y cada medición tiene su trama: la entrega por dispositivo del tablero es la
-- de una red real (distinta entre dispositivos) y «Tramas (24 h)» no es casi cero.
--
-- RESULTADO ESPERADO al terminar (lo comprueba semilla-demo.sh --completa; «ahora» = el momento de la corrida):
--   sitios     3: «uct» (America/Santiago; la vitrina), «magallanes» (America/Punta_Arenas: otra zona horaria, sin horario de verano) y
--              «pruebas-limite» (Sitio de pruebas: casos límite; America/Santiago); las personas de demostración solo están en «uct»
--   zonas      Laboratorio (de demo.sql), Invernadero y Parcela norte en uct; Caseta en magallanes; Casos límite en pruebas-limite
--   pasarelas  2 en uct, ambas formato milesight (migración 15): demo-pasarela-01 activa y demo-pasarela-02 INACTIVA (un alta lorawan con ella debe dar 400)
--   dispositivos de la semilla: 11 (8 en uct, 1 en magallanes, 2 en pruebas-limite)
--     id_fisico            sitio           vía/formato        estado         en_linea  abiertas  entrega 24 h  qué prueba
--     demo-aire-01         uct             mqtt/senml         activo         sí        0         100 %         30 días por hora (una trama por hora), hueco de 2 días, un pico de 38,5 °C con su condición cerrada; 2 credenciales (1 rotada)
--     demo-suelo-01        uct             mqtt/senml         activo         sí        1 umbral  91,7 %        cada hora menos 2 tramas perdidas; humedad bajo el umbral bajo 20 desde hace 5 h: condición abierta
--     demo-silencioso      uct             mqtt/plano         activo         no        1 sin_com 0 %           cada 300 s durante el día anterior a quedarse callado, visto hace 2 días
--     demo-mantenimiento   uct             mqtt/senml         mantenimiento  sí        0         —             batería y RSSI cada hora; el supervisor no lo mira
--     demo-baja            uct             mqtt/senml         baja           no        0         —             credencial inactiva, cuarentena «dado_de_baja», condición cerrada al darlo de baja
--     demo-http-01         uct             http/senml         activo         null      0         —             nunca visto: «esperando la primera trama»
--     demo-lora-01         uct             lorawan/milesight  activo         sí        0         97,5 %        con pasarela; cada 180 s (la alarma abre a 2 × intervalo, 6 min), 12 de 480 tramas perdidas
--     demo-lora-02         uct             lorawan/milesight  activo         sí        1 batería 37,5 %        cada 180 s, pierde 5 de cada 8 tramas; condición de batería abierta (ningún código la abre aún) y manipulación cerrada
--     demo-mag-01          magallanes      mqtt/senml         activo         sí        0         100 %         otro sitio y otra zona horaria; PM2,5 y PM10
--     d03                  pruebas-limite  mqtt/plano         activo         sí        0         100 %         identificador de 3 caracteres (mínimo) y nombre de 1 («Ñ»)
--     demo-identificador-e…  pruebas-limite  mqtt/senml       activo         sí        0         100 %         identificador de 63 caracteres (máximo) y nombre de 80 con acentos
--   en línea 8 · fuera de línea 2 · nunca vistos 1 · con condición abierta 3 (umbral, sin_comunicacion, bateria)
--   mediciones y tramas: cada trama lleva las lecturas de sus mediciones (SenML, plano o el JSON de la pasarela, según el formato) y se
--     recibió 2 s después de la marca del emisor (en «plano», sin marca, la de recepción); la última es `visto_por_ultima_vez`
--   cuarentena de la semilla: 5 filas, una por motivo (no_registrado, dado_de_baja, malformada, invalida) y una por HTTP
--   metrica_broker: 7 muestras hace 3 h a 2 h (los descartes saltan de 0 a 1 200); condicion_sistema: 1 broker_descarte cerrada
-- Lo que debe mostrar el panel (recorrerlo y anotar cada diferencia como hallazgo): P2 inventario de uct con 8 de la semilla (más dev-0001 y
-- lo que la persona haya dado de alta), semáforo según la tabla, demo-http-01 como «esperando la primera trama», demo-baja y
-- demo-mantenimiento distinguibles; el tablero de uct con la entrega de la tabla y unas 700 tramas en 24 h; P3 ficha de demo-aire-01 con
-- el hueco y el pico en el rango de 30 días y de demo-mag-01 con la hora de Punta Arenas; los nombres en los topes, en el sitio de pruebas
-- (lo ve el administrador del sistema), sin romper la tabla; P4 condiciones con los 4 tipos (dos de ellos, batería y manipulación, que el
-- backend todavía no abre).
-- Ventanas que cambian solas: lora-01 y lora-02 (intervalo 180 s) pasan a «sin comunicación» a los 6 min, y los de 3 600 s a las 2 h,
-- porque nadie publica; con las horas, la entrega de 24 h baja y las tramas salen de la ventana; volver a correr la semilla lo repone.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 0. Borrar el escenario anterior, solo de esta lista ──────────────────────────────────────────────────────────────────
CREATE TEMP TABLE semilla_lista ON COMMIT DROP AS SELECT id FROM dispositivo WHERE id_fisico IN ('demo-aire-01', 'demo-suelo-01', 'demo-silencioso', 'demo-mantenimiento', 'demo-baja', 'demo-http-01', 'demo-lora-01', 'demo-lora-02', 'd03', 'demo-identificador-en-el-limite-de-sesenta-y-tres-caracteres-ok', 'demo-mag-01');
DELETE FROM medicion   WHERE canal_id IN (SELECT c.id FROM canal c WHERE c.dispositivo_id IN (SELECT id FROM semilla_lista));
DELETE FROM trama      WHERE dispositivo_id IN (SELECT id FROM semilla_lista);
DELETE FROM cuarentena WHERE dispositivo_id IN (SELECT id FROM semilla_lista) OR topico = 'sitio/uct/dispositivo/desconocido-01/temperatura';
DELETE FROM evento     WHERE dispositivo_id IN (SELECT id FROM semilla_lista);
DELETE FROM dispositivo WHERE id IN (SELECT id FROM semilla_lista);   -- canal, regla, condición, credencial y estado van en cascada
DELETE FROM pasarela   WHERE id_fisico IN ('demo-pasarela-01', 'demo-pasarela-02');
DELETE FROM condicion_sistema WHERE detalle->>'origen' = 'semilla';
-- Muestras sembradas del broker: su huella es clientes_conectados = 14 y memoria_bytes = 880000 a la vez (una muestra real con
-- esos valores exactos a la vez es improbable). Sin esto, correr la semilla a otra hora acumulaba 7 filas por corrida (corrección
-- del 13/10). La huella son cuatro columnas, no dos, para no borrar por accidente una muestra real.
DELETE FROM metrica_broker WHERE clientes_conectados = 14 AND memoria_bytes = 880000 AND mensajes_descartados IN (0, 1200)
  AND bytes_en_cola IN (420, 610000, 1450000);

-- ── 1. Sitios, zonas y pasarelas ────────────────────────────────────────────────────────────────────────────────────
INSERT INTO sitio (id, nombre, codigo, zona_horaria) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Estación de referencia Magallanes', 'magallanes', 'America/Punta_Arenas'),
  ('00000000-0000-0000-0000-0000000000b1', 'Sitio de pruebas: casos límite', 'pruebas-limite', 'America/Santiago')
  ON CONFLICT DO NOTHING;
INSERT INTO zona (id, sitio_id, nombre) VALUES
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'Invernadero'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000001', 'Parcela norte'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1', 'Caseta'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1', 'Casos límite')
  ON CONFLICT DO NOTHING;
INSERT INTO pasarela (sitio_id, id_fisico, nombre, activo, formato) VALUES
  ('00000000-0000-0000-0000-000000000001', 'demo-pasarela-01', 'Pasarela de demostración (techo del pabellón)', true, 'milesight'),
  ('00000000-0000-0000-0000-000000000001', 'demo-pasarela-02', 'Pasarela retirada', false, 'milesight');

-- ── 2. Dispositivos ─────────────────────────────────────────────────────────────────────────────────────────────────
-- El intervalo esperado de cada uno es el ritmo al que se siembran sus tramas (sección 4): la entrega del tablero cuenta con él.
INSERT INTO dispositivo (zona_id, id_fisico, nombre, estado, intervalo_esperado_s, via, formato, pasarela_id, creado_en)
SELECT z::uuid, f, n, e, i, v, fo, (SELECT id FROM pasarela WHERE id_fisico = p), now() - c * INTERVAL '1 day'
FROM (VALUES
  ('00000000-0000-0000-0000-000000000002', 'demo-aire-01',       'Aire del laboratorio',          'activo',        3600, 'mqtt',    'senml',     NULL, 31),
  ('00000000-0000-0000-0000-0000000000a2', 'demo-suelo-01',      'Suelo del invernadero',         'activo',        3600, 'mqtt',    'senml',     NULL, 20),
  ('00000000-0000-0000-0000-0000000000a2', 'demo-silencioso',    'Nodo que dejó de reportar',     'activo',         300, 'mqtt',    'plano',     NULL, 15),
  ('00000000-0000-0000-0000-0000000000a3', 'demo-mantenimiento', 'Nodo en mantenimiento',         'mantenimiento', 3600, 'mqtt',    'senml',     NULL, 12),
  ('00000000-0000-0000-0000-0000000000a3', 'demo-baja',          'Nodo retirado',                 'baja',          3600, 'mqtt',    'senml',     NULL, 25),
  ('00000000-0000-0000-0000-000000000002', 'demo-http-01',       'Nodo por HTTP recién instalado','activo',         600, 'http',    'senml',     NULL,  0),
  ('00000000-0000-0000-0000-0000000000a3', 'demo-lora-01',       'LoRaWAN parcela norte',         'activo',         180, 'lorawan', 'milesight', 'demo-pasarela-01', 10),
  ('00000000-0000-0000-0000-0000000000a3', 'demo-lora-02',       'LoRaWAN con batería baja',      'activo',         180, 'lorawan', 'milesight', 'demo-pasarela-01', 10),
  ('00000000-0000-0000-0000-0000000000b2', 'd03',              'Ñ',                             'activo',        3600, 'mqtt',    'plano',     NULL,  5),
  ('00000000-0000-0000-0000-0000000000b2', 'demo-identificador-en-el-limite-de-sesenta-y-tres-caracteres-ok', 'Estación del pabellón de Química — sensor con ñ, tildes, «comillas» y señal débi', 'activo', 3600, 'mqtt', 'senml', NULL, 5),
  ('00000000-0000-0000-0000-0000000000a4', 'demo-mag-01',        'Calidad del aire, Magallanes',  'activo',        3600, 'mqtt',    'senml',     NULL,  8)
) AS t(z, f, n, e, i, v, fo, p, c);

-- Canales: (id_fisico, magnitud, etiqueta)
INSERT INTO canal (dispositivo_id, magnitud_codigo, etiqueta)
SELECT d.id, m, et FROM (VALUES
  ('demo-aire-01', 'temperatura', NULL), ('demo-aire-01', 'humedad', NULL), ('demo-aire-01', 'presion', NULL),
  ('demo-suelo-01', 'temperatura', 'suelo'), ('demo-suelo-01', 'humedad', 'suelo'),
  ('demo-silencioso', 'temperatura', NULL),
  ('demo-mantenimiento', 'bateria', NULL), ('demo-mantenimiento', 'rssi', NULL),
  ('demo-baja', 'temperatura', NULL),
  ('demo-http-01', 'temperatura', NULL),
  ('demo-lora-01', 'temperatura', NULL), ('demo-lora-01', 'humedad', NULL),
  ('demo-lora-02', 'humedad', 'suelo'), ('demo-lora-02', 'bateria', NULL),
  ('d03', 'temperatura', NULL),
  ('demo-identificador-en-el-limite-de-sesenta-y-tres-caracteres-ok', 'temperatura', 'etiqueta de cuarenta caracteres exactos.'),
  ('demo-mag-01', 'pm2_5', NULL), ('demo-mag-01', 'pm10', NULL)
) AS t(f, m, et) JOIN dispositivo d ON d.id_fisico = t.f;

-- Reglas de umbral: alto con histéresis, bajo, y una sin condición abierta.
INSERT INTO regla_umbral (canal_id, umbral_alto, umbral_bajo, histeresis)
SELECT c.id, a, b, h FROM (VALUES
  ('demo-aire-01', 'temperatura', 30::float8, NULL::float8, 2::float8),
  ('demo-suelo-01', 'humedad', NULL, 20, 3),
  ('demo-mag-01', 'pm2_5', 50, NULL, 5)
) AS t(f, m, a, b, h) JOIN dispositivo d ON d.id_fisico = t.f JOIN canal c ON c.dispositivo_id = d.id AND c.magnitud_codigo = t.m;

-- ── 3. Estado: cuándo se recibió la última trama de cada uno (demo-http-01 nunca: sin fila) ────────────────────────────────────
-- demo-aire-01 manda a la hora en punto (su serie de 30 días está alineada a la hora): su última trama llegó 2 s después.
INSERT INTO estado_dispositivo (dispositivo_id, visto_por_ultima_vez)
SELECT d.id, CASE WHEN t.f = 'demo-aire-01' THEN date_trunc('hour', now()) + INTERVAL '2 seconds' ELSE now() - s * INTERVAL '1 second' END FROM (VALUES
  ('demo-aire-01', 0), ('demo-suelo-01', 120), ('demo-silencioso', 172800), ('demo-mantenimiento', 300), ('demo-baja', 432000),
  ('demo-lora-01', 30), ('demo-lora-02', 45), ('d03', 90), ('demo-identificador-en-el-limite-de-sesenta-y-tres-caracteres-ok', 90), ('demo-mag-01', 200)
) AS t(f, s) JOIN dispositivo d ON d.id_fisico = t.f;

-- ── 4. Tramas y sus mediciones ──────────────────────────────────────────────────────────────────────────────────────
-- Una fila por trama recibida (`recibido`, instante de recepción) con `k`, cuántos intervalos antes de la última. demo-aire-01: 30 días por
-- hora con un hueco (de hace 12 a hace 10 días). El resto: el día anterior a su última trama, a su intervalo esperado, menos las perdidas
-- de cada uno (la entrega de 24 h de la cabecera): demo-suelo-01 pierde 2 de 24; demo-lora-01, 1 de cada 40; demo-lora-02, 5 de cada 8.
CREATE TEMP TABLE semilla_trama ON COMMIT DROP AS
SELECT d.id AS dispositivo_id, d.id_fisico, d.nombre, d.formato, h + INTERVAL '2 seconds' AS recibido,
       (extract(epoch FROM date_trunc('hour', now()) - h) / 3600)::int AS k
  FROM dispositivo d
 CROSS JOIN generate_series(date_trunc('hour', now()) - INTERVAL '30 days', date_trunc('hour', now()), INTERVAL '1 hour') AS h
 WHERE d.id_fisico = 'demo-aire-01'
   AND NOT (h >= date_trunc('day', now()) - INTERVAL '12 days' AND h < date_trunc('day', now()) - INTERVAL '10 days')
UNION ALL
SELECT d.id, d.id_fisico, d.nombre, d.formato, e.visto_por_ultima_vez - k * d.intervalo_esperado_s * INTERVAL '1 second', k
  FROM dispositivo d JOIN estado_dispositivo e ON e.dispositivo_id = d.id
 CROSS JOIN LATERAL generate_series(0, 86400 / d.intervalo_esperado_s - 1) AS k
 WHERE d.id IN (SELECT id FROM dispositivo WHERE id_fisico IN ('demo-aire-01', 'demo-suelo-01', 'demo-silencioso', 'demo-mantenimiento', 'demo-baja', 'demo-http-01', 'demo-lora-01', 'demo-lora-02', 'd03', 'demo-identificador-en-el-limite-de-sesenta-y-tres-caracteres-ok', 'demo-mag-01'))
   AND d.id_fisico <> 'demo-aire-01'
   AND NOT (d.id_fisico = 'demo-suelo-01' AND k IN (7, 15))
   AND NOT (d.id_fisico = 'demo-lora-01' AND k % 40 = 17)
   AND NOT (d.id_fisico = 'demo-lora-02' AND k % 8 NOT IN (0, 3, 5));

-- Las lecturas de cada trama, una por canal, dentro del rango de su magnitud. La marca del emisor es 2 s anterior a la recepción, salvo en
-- «plano» (este nodo no manda marca: vale la de recepción, como en el pipeline). Los valores siguen el día (seno de 24 h) con un desfase por
-- dispositivo; demo-aire-01 conserva su serie y su pico de 38,5 °C (hace 6 días a las 15 h); demo-suelo-01 se seca: cruza el umbral bajo
-- de 20 hace 5 h; demo-lora-02 se queda sin batería.
INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo)
SELECT c.id, x.tiempo,
       CASE
         WHEN x.id_fisico = 'demo-aire-01' THEN CASE c.magnitud_codigo
           WHEN 'temperatura' THEN CASE WHEN x.tiempo = date_trunc('day', now()) - INTERVAL '6 days' + INTERVAL '15 hours' THEN 38.5
                                        ELSE round((16 + 6 * sin(2 * pi() * extract(hour FROM x.tiempo) / 24))::numeric, 2)::float8 END
           WHEN 'humedad'     THEN round((60 - 15 * sin(2 * pi() * extract(hour FROM x.tiempo) / 24))::numeric, 1)::float8
           ELSE round((1013 + 4 * cos(2 * pi() * extract(epoch FROM x.tiempo) / 259200))::numeric, 1)::float8 END
         WHEN x.id_fisico = 'demo-suelo-01' AND c.magnitud_codigo = 'humedad' THEN round((13.9 + 1.1 * x.k)::numeric, 1)::float8
         WHEN c.magnitud_codigo = 'bateria' THEN CASE WHEN x.id_fisico = 'demo-lora-02' THEN round((8 + 4.0 * x.k / 480)::numeric, 1)::float8 ELSE 76 END
         WHEN c.magnitud_codigo = 'rssi' THEN -99 + x.k % 5
         WHEN c.magnitud_codigo = 'humedad' THEN round((58 - 12 * x.dia + x.desfase)::numeric, 1)::float8
         WHEN c.magnitud_codigo = 'pm2_5' THEN round((18 + 4 * x.dia + x.desfase)::numeric, 1)::float8
         WHEN c.magnitud_codigo = 'pm10' THEN round((31 + 6 * x.dia + x.desfase)::numeric, 1)::float8
         ELSE round((15 + 5 * x.dia + x.desfase)::numeric, 2)::float8 END,
       m.unidad_canonica, x.recibido,
       CASE WHEN x.formato = 'milesight' THEN 'pasarela' WHEN x.formato = 'plano' THEN 'recepcion' ELSE 'dispositivo' END
  FROM (SELECT t.*, CASE WHEN t.formato = 'plano' THEN t.recibido ELSE t.recibido - INTERVAL '2 seconds' END AS tiempo,
               sin(2 * pi() * (extract(epoch FROM t.recibido) / 86400 - 0.375)) AS dia,
               (abs(hashtext(t.id_fisico)) % 30) / 10.0 AS desfase
          FROM semilla_trama t) x
  JOIN canal c ON c.dispositivo_id = x.dispositivo_id JOIN magnitud m ON m.codigo = c.magnitud_codigo;

-- La trama cruda de cada recepción, con las mismas lecturas que dejó en `medicion`: SenML con el nombre y la hora base del emisor; «plano»,
-- un valor por tópico; LoRaWAN, el JSON que entrega la pasarela con el códec y los metadatos (devEUI, deviceName, applicationID).
INSERT INTO trama (dispositivo_id, recibido_en, topico, payload, adaptador)
SELECT t.dispositivo_id, t.recibido,
       CASE t.formato WHEN 'milesight' THEN 'sitio/' || s.codigo || '/pasarela/demo-pasarela-01/' || t.id_fisico || '/up'
                      ELSE 'sitio/' || s.codigo || '/dispositivo/' || t.id_fisico || '/' || min(c.magnitud_codigo) END,
       convert_to(CASE t.formato
         WHEN 'senml' THEN jsonb_set(jsonb_set(jsonb_agg(jsonb_build_object('n', c.magnitud_codigo, 'u', x.unidad, 'v', x.valor) ORDER BY c.magnitud_codigo),
                                               '{0,bt}', to_jsonb(extract(epoch FROM min(x.tiempo))::bigint)), '{0,bn}', to_jsonb(t.id_fisico))::text
         WHEN 'plano' THEN jsonb_build_object('valor', min(x.valor))::text
         ELSE (jsonb_build_object('devEUI', t.id_fisico, 'deviceName', t.nombre, 'applicationID', '1')
               || jsonb_object_agg(CASE c.magnitud_codigo WHEN 'temperatura' THEN 'temperature' WHEN 'humedad' THEN 'humidity' WHEN 'bateria' THEN 'battery'
                                   ELSE c.magnitud_codigo END, x.valor))::text END, 'UTF8'),
       t.formato
  FROM semilla_trama t
  JOIN dispositivo d ON d.id = t.dispositivo_id JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id
  JOIN canal c ON c.dispositivo_id = t.dispositivo_id
  JOIN medicion x ON x.canal_id = c.id AND x.recibido_en = t.recibido
 GROUP BY t.dispositivo_id, t.recibido, t.formato, t.id_fisico, t.nombre, s.codigo;

-- ── 5. Condiciones (los cuatro tipos; abiertas y cerradas) ────────────────────────────────────────────────────────────
INSERT INTO condicion (dispositivo_id, regla_id, tipo, abierta_en, cerrada_en)
SELECT d.id, r.id, t.tipo, t.ab, t.ce FROM (VALUES
  ('demo-aire-01',   'temperatura', 'umbral',           date_trunc('day', now()) - INTERVAL '6 days' + INTERVAL '15 hours', date_trunc('day', now()) - INTERVAL '6 days' + INTERVAL '16 hours'),
  ('demo-suelo-01',  'humedad',     'umbral',           now() - INTERVAL '5 hours',  NULL::timestamptz),
  ('demo-silencioso', NULL,         'sin_comunicacion', now() - INTERVAL '2 days' + INTERVAL '600 seconds', NULL),
  ('demo-baja',       NULL,         'sin_comunicacion', now() - INTERVAL '5 days' + INTERVAL '7200 seconds', now() - INTERVAL '1 day'),
  ('demo-lora-02',    NULL,         'bateria',          now() - INTERVAL '1 day',    NULL),
  ('demo-lora-02',    NULL,         'manipulacion',     now() - INTERVAL '3 days',   now() - INTERVAL '3 days' + INTERVAL '20 minutes')
) AS t(f, m, tipo, ab, ce)
JOIN dispositivo d ON d.id_fisico = t.f
LEFT JOIN canal c ON c.dispositivo_id = d.id AND c.magnitud_codigo = t.m
LEFT JOIN regla_umbral r ON r.canal_id = c.id AND t.tipo = 'umbral';

-- ── 6. Credenciales: hash con forma de scrypt que no verifica nada (ningún secreto existe) ───────────────────────────────
INSERT INTO credencial (dispositivo_id, hash, activa, creada_en)
SELECT d.id, 'scrypt$semilla$sin-secreto-inutilizable', t.a, now() - t.dias * INTERVAL '1 day' FROM (VALUES
  ('demo-aire-01', false, 31), ('demo-aire-01', true, 2), ('demo-suelo-01', true, 20), ('demo-baja', false, 25), ('demo-http-01', true, 0)
) AS t(f, a, dias) JOIN dispositivo d ON d.id_fisico = t.f;

-- ── 7. Cuarentena: un motivo por fila ────────────────────────────────────────────────────────────────────────────────
INSERT INTO cuarentena (origen, topico, motivo, payload_crudo, recibido_en, detalle, dispositivo_id)
SELECT o, tp, mo, convert_to(pl, 'UTF8'), now() - h * INTERVAL '1 hour', de, (SELECT id FROM dispositivo WHERE id_fisico = f) FROM (VALUES
  ('mqtt', 'sitio/uct/dispositivo/desconocido-01/temperatura', 'no_registrado', '[{"n":"temperatura","v":20}]', 3, 'id_fisico=desconocido-01 no está registrado', NULL),
  ('mqtt', 'sitio/uct/dispositivo/demo-baja/temperatura', 'dado_de_baja', '[{"n":"temperatura","v":19}]', 30, 'id_fisico=demo-baja: revocar su credencial en el broker', 'demo-baja'),
  ('mqtt', 'sitio/uct/dispositivo/demo-aire-01/temperatura', 'malformada', '[{"n":"temperatura","v":', 6, 'JSON incompleto', 'demo-aire-01'),
  ('mqtt', 'sitio/uct/dispositivo/demo-suelo-01/humedad', 'invalida', '[{"n":"humedad","u":"%RH","v":140}]', 9, 'humedad 140 fuera del rango [0, 100]', 'demo-suelo-01'),
  ('http', NULL, 'malformada', 'no-es-json', 1, 'cuerpo no es JSON (vía http)', 'demo-http-01')
) AS t(o, tp, mo, pl, h, de, f);

-- ── 8. Eventos (alta de todos; mantenimiento; baja; rotación) ───────────────────────────────────────────────────────────
INSERT INTO evento (dispositivo_id, tipo, detalle, ocurrido_en)
SELECT d.id, 'alta', jsonb_build_object('via', d.via, 'formato', d.formato, 'origen', 'semilla'), d.creado_en FROM dispositivo d WHERE d.id_fisico IN ('demo-aire-01', 'demo-suelo-01', 'demo-silencioso', 'demo-mantenimiento', 'demo-baja', 'demo-http-01', 'demo-lora-01', 'demo-lora-02', 'd03', 'demo-identificador-en-el-limite-de-sesenta-y-tres-caracteres-ok', 'demo-mag-01');
INSERT INTO evento (dispositivo_id, tipo, detalle, ocurrido_en)
SELECT d.id, t.tipo, jsonb_build_object('origen', 'semilla'), now() - t.h * INTERVAL '1 hour' FROM (VALUES
  ('demo-mantenimiento', 'mantenimiento', 4), ('demo-baja', 'baja', 24), ('demo-aire-01', 'rotacion', 48)
) AS t(f, tipo, h) JOIN dispositivo d ON d.id_fisico = t.f;

-- ── 9. Métricas del broker y una condición del sistema cerrada ─────────────────────────────────────────────────────────
INSERT INTO metrica_broker (tiempo, mensajes_descartados, mensajes_en_cola, bytes_en_cola, clientes_conectados, memoria_bytes)
SELECT date_trunc('hour', now()) - INTERVAL '3 hours' + k * INTERVAL '10 minutes',
       CASE WHEN k >= 3 THEN 1200 ELSE 0 END, CASE WHEN k = 3 THEN 10000 WHEN k = 4 THEN 4200 ELSE 3 END,
       CASE WHEN k = 3 THEN 1450000 WHEN k = 4 THEN 610000 ELSE 420 END, 14, 880000
FROM generate_series(0, 6) AS k
ON CONFLICT (tiempo) DO NOTHING;
INSERT INTO condicion_sistema (tipo, detalle, abierta_en, cerrada_en) VALUES
  ('broker_descarte', '{"origen":"semilla","motivos":["descartes","cola_alta"],"descartes_delta":1200,"mensajes_en_cola":10000,"tope":10000}',
   date_trunc('hour', now()) - INTERVAL '150 minutes', date_trunc('hour', now()) - INTERVAL '130 minutes');

COMMIT;
