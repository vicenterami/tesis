-- Semilla de demostración COMPLETA (pendiente 78; kit metodo/probar-sin-miedo.md §2: escenarios con el resultado esperado escrito
-- aquí, nunca datos armados a mano). Se aplica DESPUÉS de demo.sql: `bash plataforma/pruebas/semilla-demo.sh --completa`.
-- Reconstruye su escenario en cada corrida: borra y vuelve a crear SOLO los 11 dispositivos de la lista de abajo (nunca dev-0001
-- ni uno real), con sus canales, mediciones, tramas, cuarentena, condiciones, eventos y credenciales. Correrla dos veces el mismo
-- día da lo mismo; correrla otro día corre las fechas (todo es relativo a hoy). Ninguno tiene cliente en el broker: no publican.
--
-- RESULTADO ESPERADO al terminar (lo comprueba semilla-demo.sh --completa; «ahora» = el momento de la corrida):
--   sitios     2: «uct» (America/Santiago) y «magallanes» (America/Punta_Arenas: otra zona horaria, sin horario de verano)
--   zonas      Laboratorio (de demo.sql), Invernadero y Parcela norte en uct; Caseta en magallanes
--   pasarelas  2 en uct: demo-pasarela-01 activa y demo-pasarela-02 INACTIVA (un alta lorawan con ella debe dar 400)
--   dispositivos de la semilla: 11
--     id_fisico            vía/formato        estado         en_linea  abiertas  qué prueba
--     demo-aire-01         mqtt/senml         activo         sí        0         30 días por hora, hueco de 2 días, un pico de 38,5 °C con su condición cerrada; 2 credenciales (1 rotada)
--     demo-suelo-01        mqtt/senml         activo         sí        1 umbral  humedad del suelo 12 % bajo el umbral bajo 20: condición abierta hace 5 h
--     demo-silencioso      mqtt/plano         activo         no        1 sin_com visto hace 2 días con intervalo 300 s
--     demo-mantenimiento   mqtt/senml         mantenimiento  sí        0         batería y RSSI; el supervisor no lo mira
--     demo-baja            mqtt/senml         baja           no        0         credencial inactiva, cuarentena «dado_de_baja», condición cerrada al darlo de baja
--     demo-http-01         http/senml         activo         null      0         nunca visto: «esperando la primera trama»
--     demo-lora-01         lorawan/milesight  activo         sí        0         con pasarela; intervalo 300 s (5 × 60 s, pendiente 85)
--     demo-lora-02         lorawan/milesight  activo         sí        1 batería condición de batería abierta (ningún código la abre aún) y manipulación cerrada
--     d03                  mqtt/plano         activo         sí        0         identificador de 3 caracteres (mínimo) y nombre de 1 («Ñ»)
--     demo-identificador-e…  mqtt/senml         activo         sí        0         identificador de 63 caracteres (máximo) y nombre de 80 con acentos
--     demo-mag-01          mqtt/senml         activo         sí        0         otro sitio y otra zona horaria; PM2,5 y PM10
--   en línea 8 · fuera de línea 2 · nunca vistos 1 · con condición abierta 3 (umbral, sin_comunicacion, bateria)
--   cuarentena de la semilla: 5 filas, una por motivo (no_registrado, dado_de_baja, malformada, invalida) y una por HTTP
--   metrica_broker: 7 muestras hace 3 h a 2 h (los descartes saltan de 0 a 1 200); condicion_sistema: 1 broker_descarte cerrada
-- Lo que debe mostrar el panel (recorrerlo y anotar cada diferencia como hallazgo): P2 inventario con los 11 (más dev-0001),
-- semáforo según la tabla, demo-http-01 como «esperando la primera trama», demo-baja y demo-mantenimiento distinguibles; P3 ficha de
-- demo-aire-01 con el hueco y el pico en el rango de 30 días y de demo-mag-01 con la hora de Punta Arenas; nombres largos sin romper
-- la tabla; P4 condiciones con los 4 tipos (dos de ellos, batería y manipulación, que el backend todavía no abre).
-- Ventanas que cambian solas: lora-01 y lora-02 (intervalo 300 s) pasan a «sin comunicación» a los 10 min, y los de 3 600 s a las
-- 2 h, porque nadie publica; volver a correr la semilla los deja en línea otra vez.

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
-- esos dos valores exactos es improbable). Sin esto, correr la semilla a otra hora acumulaba 7 filas por corrida (revisión 13/10).
DELETE FROM metrica_broker WHERE clientes_conectados = 14 AND memoria_bytes = 880000;

-- ── 1. Sitios, zonas y pasarelas ────────────────────────────────────────────────────────────────────────────────────
INSERT INTO sitio (id, nombre, codigo, zona_horaria) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Estación de referencia Magallanes', 'magallanes', 'America/Punta_Arenas')
  ON CONFLICT DO NOTHING;
INSERT INTO zona (id, sitio_id, nombre) VALUES
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'Invernadero'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000001', 'Parcela norte'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1', 'Caseta')
  ON CONFLICT DO NOTHING;
INSERT INTO pasarela (sitio_id, id_fisico, nombre, activo) VALUES
  ('00000000-0000-0000-0000-000000000001', 'demo-pasarela-01', 'Pasarela de demostración (techo del pabellón)', true),
  ('00000000-0000-0000-0000-000000000001', 'demo-pasarela-02', 'Pasarela retirada', false);

-- ── 2. Dispositivos ─────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO dispositivo (zona_id, id_fisico, nombre, estado, intervalo_esperado_s, via, formato, pasarela_id, creado_en)
SELECT z::uuid, f, n, e, i, v, fo, (SELECT id FROM pasarela WHERE id_fisico = p), now() - c * INTERVAL '1 day'
FROM (VALUES
  ('00000000-0000-0000-0000-000000000002', 'demo-aire-01',       'Aire del laboratorio',          'activo',        3600, 'mqtt',    'senml',     NULL, 31),
  ('00000000-0000-0000-0000-0000000000a2', 'demo-suelo-01',      'Suelo del invernadero',         'activo',        3600, 'mqtt',    'senml',     NULL, 20),
  ('00000000-0000-0000-0000-0000000000a2', 'demo-silencioso',    'Nodo que dejó de reportar',     'activo',         300, 'mqtt',    'plano',     NULL, 15),
  ('00000000-0000-0000-0000-0000000000a3', 'demo-mantenimiento', 'Nodo en mantenimiento',         'mantenimiento', 3600, 'mqtt',    'senml',     NULL, 12),
  ('00000000-0000-0000-0000-0000000000a3', 'demo-baja',          'Nodo retirado',                 'baja',          3600, 'mqtt',    'senml',     NULL, 25),
  ('00000000-0000-0000-0000-000000000002', 'demo-http-01',       'Nodo por HTTP recién instalado','activo',         600, 'http',    'senml',     NULL,  0),
  ('00000000-0000-0000-0000-0000000000a3', 'demo-lora-01',       'LoRaWAN parcela norte',         'activo',         300, 'lorawan', 'milesight', 'demo-pasarela-01', 10),
  ('00000000-0000-0000-0000-0000000000a3', 'demo-lora-02',       'LoRaWAN con batería baja',      'activo',         300, 'lorawan', 'milesight', 'demo-pasarela-01', 10),
  ('00000000-0000-0000-0000-000000000002', 'd03',              'Ñ',                             'activo',        3600, 'mqtt',    'plano',     NULL,  5),
  ('00000000-0000-0000-0000-000000000002', 'demo-identificador-en-el-limite-de-sesenta-y-tres-caracteres-ok', 'Estación del pabellón de Química — sensor con ñ, tildes, «comillas» y señal débi', 'activo', 3600, 'mqtt', 'senml', NULL, 5),
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

-- ── 3. Estado: cuándo se vio cada uno (demo-http-01 nunca: sin fila) ───────────────────────────────────────────────────
INSERT INTO estado_dispositivo (dispositivo_id, visto_por_ultima_vez)
SELECT d.id, now() - s * INTERVAL '1 second' FROM (VALUES
  ('demo-aire-01', 60), ('demo-suelo-01', 120), ('demo-silencioso', 172800), ('demo-mantenimiento', 300), ('demo-baja', 432000),
  ('demo-lora-01', 30), ('demo-lora-02', 45), ('d03', 90), ('demo-identificador-en-el-limite-de-sesenta-y-tres-caracteres-ok', 90), ('demo-mag-01', 200)
) AS t(f, s) JOIN dispositivo d ON d.id_fisico = t.f;

-- ── 4. Mediciones ───────────────────────────────────────────────────────────────────────────────────────────────────
-- demo-aire-01: 30 días por hora, con un hueco (de hace 12 a hace 10 días) y un pico de 38,5 °C hace 6 días a las 15 h.
INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo)
SELECT c.id, t,
       CASE c.magnitud_codigo
         WHEN 'temperatura' THEN CASE WHEN t = date_trunc('day', now()) - INTERVAL '6 days' + INTERVAL '15 hours' THEN 38.5
                                      ELSE round((16 + 6 * sin(2 * pi() * extract(hour FROM t) / 24))::numeric, 2)::float8 END
         WHEN 'humedad'     THEN round((60 - 15 * sin(2 * pi() * extract(hour FROM t) / 24))::numeric, 1)::float8
         ELSE round((1013 + 4 * cos(2 * pi() * extract(epoch FROM t) / 259200))::numeric, 1)::float8 END,
       m.unidad_canonica, t + INTERVAL '2 seconds', 'dispositivo'
FROM dispositivo d JOIN canal c ON c.dispositivo_id = d.id JOIN magnitud m ON m.codigo = c.magnitud_codigo
CROSS JOIN generate_series(date_trunc('hour', now()) - INTERVAL '30 days', date_trunc('hour', now()), INTERVAL '1 hour') AS t
WHERE d.id_fisico = 'demo-aire-01'
  AND NOT (t >= date_trunc('day', now()) - INTERVAL '12 days' AND t < date_trunc('day', now()) - INTERVAL '10 days');

-- El resto: las últimas 24 h por hora (los vistos), con valores dentro del rango de cada magnitud.
INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo)
SELECT c.id, t,
       CASE
         WHEN d.id_fisico = 'demo-suelo-01' AND c.magnitud_codigo = 'humedad' THEN greatest(12, 35 - extract(epoch FROM t - (now() - INTERVAL '24 hours')) / 3600)
         WHEN c.magnitud_codigo = 'bateria' THEN CASE WHEN d.id_fisico = 'demo-lora-02' THEN 8 ELSE 76 END
         WHEN c.magnitud_codigo = 'rssi' THEN -97
         WHEN c.magnitud_codigo = 'humedad' THEN 55
         WHEN c.magnitud_codigo = 'pm2_5' THEN 18 + (extract(hour FROM t) % 5)
         WHEN c.magnitud_codigo = 'pm10' THEN 31 + (extract(hour FROM t) % 7)
         ELSE 14 + (extract(hour FROM t) % 6) END,
       m.unidad_canonica, t + INTERVAL '3 seconds',
       CASE WHEN d.via = 'lorawan' THEN 'pasarela' WHEN d.formato = 'plano' THEN 'recepcion' ELSE 'dispositivo' END
FROM dispositivo d JOIN canal c ON c.dispositivo_id = d.id JOIN magnitud m ON m.codigo = c.magnitud_codigo
JOIN estado_dispositivo e ON e.dispositivo_id = d.id
CROSS JOIN generate_series(date_trunc('hour', e.visto_por_ultima_vez) - INTERVAL '23 hours', date_trunc('hour', e.visto_por_ultima_vez), INTERVAL '1 hour') AS t
WHERE d.id IN (SELECT id FROM dispositivo WHERE id_fisico IN ('demo-aire-01', 'demo-suelo-01', 'demo-silencioso', 'demo-mantenimiento', 'demo-baja', 'demo-http-01', 'demo-lora-01', 'demo-lora-02', 'd03', 'demo-identificador-en-el-limite-de-sesenta-y-tres-caracteres-ok', 'demo-mag-01')) AND d.id_fisico <> 'demo-aire-01';

-- Tramas crudas aceptadas (las últimas 3 de demo-aire-01): auditoría y re-decodificación.
INSERT INTO trama (dispositivo_id, recibido_en, topico, payload, adaptador)
SELECT d.id, date_trunc('hour', now()) - k * INTERVAL '1 hour' + INTERVAL '2 seconds', 'sitio/uct/dispositivo/demo-aire-01/temperatura',
       convert_to('[{"n":"temperatura","u":"Cel","v":21.5}]', 'UTF8'), 'senml'
FROM dispositivo d CROSS JOIN generate_series(0, 2) AS k WHERE d.id_fisico = 'demo-aire-01';

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
