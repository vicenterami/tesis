-- Migración 02. El índice único original permitía UNA condición abierta por (dispositivo, tipo).
-- Para el tipo 'umbral' eso es insuficiente: un dispositivo con dos canales vigilados (temperatura
-- y humedad) puede tener ambos umbrales cruzados a la vez. La unicidad pasa a incluir la regla.
-- Para tipos sin regla (sin_comunicacion, bateria, manipulacion) regla_id es NULL y se normaliza a
-- un UUID fijo, manteniendo "una sola condición abierta por dispositivo y tipo".
--
-- Instalación nueva: se ejecuta solo tras 01-esquema.sql.
-- Base existente:    docker compose exec -T timescaledb psql -U plataforma -d plataforma < db/init/02-condicion-por-regla.sql

DROP INDEX IF EXISTS condicion_abierta_unica;
CREATE UNIQUE INDEX condicion_abierta_unica
    ON condicion (dispositivo_id, tipo, COALESCE(regla_id, '00000000-0000-0000-0000-000000000000'))
    WHERE cerrada_en IS NULL;
