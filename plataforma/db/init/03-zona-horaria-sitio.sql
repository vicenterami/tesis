-- Migración 03. Cada sitio declara su zona horaria con nombre IANA (incluye las reglas de horario
-- de verano). Los filtros por día/semana/mes se resuelven en esta zona dentro de la base (docs/13).
-- Base existente: docker compose exec -T timescaledb psql -U plataforma -d plataforma < db/init/03-zona-horaria-sitio.sql

ALTER TABLE sitio ADD COLUMN IF NOT EXISTS zona_horaria text NOT NULL DEFAULT 'America/Santiago';

-- Solo se admiten nombres que PostgreSQL conozca (evita desfases fijos como '-03').
-- Un CHECK no puede consultar otras tablas, por eso se valida con un disparador.
CREATE OR REPLACE FUNCTION validar_zona_horaria() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.zona_horaria) THEN
        RAISE EXCEPTION 'zona_horaria desconocida: %', NEW.zona_horaria
            USING HINT = 'usar un nombre IANA, p. ej. America/Santiago';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sitio_zona_horaria_valida ON sitio;
CREATE TRIGGER sitio_zona_horaria_valida
    BEFORE INSERT OR UPDATE OF zona_horaria ON sitio
    FOR EACH ROW EXECUTE FUNCTION validar_zona_horaria();
