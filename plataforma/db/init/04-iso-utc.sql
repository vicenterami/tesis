-- Migración 04. Instantes serializados desde SQL con un único formato.
-- json_build_object / json_agg emiten un timestamptz como '2026-09-10T00:50:26.608048+00:00',
-- mientras que el resto de la API emite ISO 8601 con 'Z'. Dos formatos para lo mismo es una fuente
-- clásica de errores en el cliente. Toda fecha que viaje dentro de JSON armado en SQL pasa por aquí.
-- Base existente: docker compose exec -T timescaledb psql -U plataforma -d plataforma < db/init/04-iso-utc.sql

CREATE OR REPLACE FUNCTION iso_utc(t timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE WHEN t IS NULL THEN NULL
                ELSE to_char(t AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
$$;
COMMENT ON FUNCTION iso_utc(timestamptz) IS
    'Instante en ISO 8601 UTC con sufijo Z. Solo para timestamptz: sobre un timestamp sin zona la Z mentiría.';
