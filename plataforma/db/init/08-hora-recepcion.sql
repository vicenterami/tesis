-- 08 · Hora de recepción y origen de la marca de tiempo (docs/10 §8.4 punto 12; docs/08 §8).
-- medicion.tiempo guarda el instante de la medición según la regla 7 de docs/13 (marca del emisor si es
-- plausible; si no, la hora de recepción), pero la fila no decía cuál de las dos se usó ni cuánto
-- difieren. Con estas dos columnas la deriva (recibido_en − tiempo) por dispositivo se calcula en la
-- vista de salud (RF-47). El broker no marca la hora (MQTT no la añade): la pone el backend al recibir.
--
-- Todo DDL va dentro de una transacción con lock_timeout (docs/10 §8.4 punto 15): un ALTER que espera
-- un candado encola detrás de sí todas las lecturas; mejor fallar a los 5 s y reintentar. SET LOCAL
-- solo vale dentro de BEGIN … COMMIT: fuera de una transacción PostgreSQL lo ignora con un WARNING.
-- Base existente: docker compose exec -T timescaledb psql -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/08-hora-recepcion.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE medicion ADD COLUMN IF NOT EXISTS recibido_en   timestamptz;
ALTER TABLE medicion ADD COLUMN IF NOT EXISTS origen_tiempo text;

-- Obligatorias para toda fila nueva. NOT VALID: no se revisan las filas anteriores a esta migración, que no
-- tienen cómo saber su origen (quedan NULL = «desconocido», nunca un valor inventado). En una instalación
-- nueva la tabla está vacía y la restricción rige desde la primera fila.
ALTER TABLE medicion DROP CONSTRAINT IF EXISTS ck_medicion_recepcion;
ALTER TABLE medicion ADD CONSTRAINT ck_medicion_recepcion
    CHECK (recibido_en IS NOT NULL AND origen_tiempo IN ('dispositivo', 'pasarela', 'recepcion')) NOT VALID;

COMMENT ON COLUMN medicion.recibido_en IS
    'Instante (UTC) en que el backend recibió la trama. Lo pone el pipeline, no el emisor. Con tiempo da la deriva del reloj del emisor (RF-47).';
COMMENT ON COLUMN medicion.origen_tiempo IS
    'De dónde salió tiempo: dispositivo (marca del nodo) | pasarela (marca de la pasarela LoRaWAN) | recepcion (marca ausente o no plausible, docs/13 regla 7). Lo declara el adaptador.';

COMMIT;
