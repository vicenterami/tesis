-- 06 · Una lectura por canal e instante (RF-10: descartar duplicados).
-- MQTT con QoS 1 garantiza "al menos una vez": tras una reconexión el broker puede reentregar una
-- trama ya procesada, y un nodo que reenvía su cola repite lecturas. La clave natural de la serie es
-- (canal, instante); con este índice único el INSERT del pipeline usa ON CONFLICT DO NOTHING y la
-- reentrega no duplica la serie ni vuelve a evaluar umbrales. En una hypertable el índice único debe
-- incluir la columna de particionado (tiempo): la incluye. Reemplaza al índice no único equivalente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_medicion_canal_tiempo ON medicion (canal_id, tiempo DESC);
DROP INDEX IF EXISTS medicion_canal_tiempo_idx;
COMMENT ON INDEX uq_medicion_canal_tiempo IS
  'Clave natural de la serie: una lectura por canal e instante. Sostiene la idempotencia del pipeline ante reentregas QoS 1.';
