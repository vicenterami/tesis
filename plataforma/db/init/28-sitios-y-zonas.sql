-- 28 · Sitios y zonas desde el panel (diseñado el 24/11/2026: docs/19 §4 bloques U y U2, docs/20 §6, docs/08; HU-12, RF-21).
--   · zona.activo: una zona no se borra, se retira (`activo = false`), y solo si no tiene dispositivos activos (lo comprueba el backend en
--     PATCH /zonas/{id}, en la misma transacción); los dados de baja conservan su historia en dispositivo_zona. Las existentes nacen activas.
--   · uq_zona_sitio_nombre_normalizado: el nombre de una zona no se repite en su sitio sin distinguir mayúsculas ni espacios en los extremos
--     («Norte» y «norte » son la misma), para que el alta masiva que crea zonas (U2) no duplique una que ya existe escrita distinto. Antes de
--     crearlo comprueba los datos: si dos zonas de un sitio chocan, ABORTA nombrándolas (no elige ni renombra sola; se corrige a mano y se
--     reaplica). El UNIQUE (sitio_id, nombre) de la migración 01 se mantiene: el nuevo es más estricto y lo contiene.
--   · Permisos de plataforma_app (mínimo privilegio, migración 14), por columna: crear un sitio (nombre, codigo, zona_horaria, descripcion;
--     el resto toma sus valores por omisión) y cambiar su nombre y descripción; crear una zona (sitio_id, nombre) y cambiar su nombre y
--     activo. Ningún DELETE. Quién puede llamar a esas rutas lo decide el backend (acción `sistema` para sitios, `ajustes` para zonas).
--     Se repiten en la 14.
-- Aditiva: una columna NOT NULL con su valor por omisión, un índice y permisos, en una transacción. Reaplicable sin daño. Convenciones de
-- docs/08 §6: idempotente; nombre uq_; COMMENT ON.
-- Base existente (un contenedor nuevo la aplica solo, desde db/init; antes, un respaldo):
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/28-sitios-y-zonas.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── zona.activo ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE zona ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN zona.activo IS
  'false = zona retirada: no se ofrece en el alta ni al configurar, y se sigue viendo en la historia. Solo se retira sin dispositivos activos (PATCH /zonas/{id}); nunca se borra (migración 28, docs/19 §4 U).';

-- ── Nombre único por sitio, sin distinguir mayúsculas ni espacios en los extremos ────────────────────────────────────────────────
DO $$
DECLARE choques text;
BEGIN
  SELECT string_agg(format('sitio %s: %s', sitio_id, nombres), '; ') INTO choques
    FROM (SELECT sitio_id, string_agg(format('«%s»', nombre), ', ' ORDER BY nombre) AS nombres
            FROM zona GROUP BY sitio_id, lower(btrim(nombre)) HAVING count(*) > 1) d;
  IF choques IS NOT NULL THEN
    RAISE EXCEPTION 'migración 28: hay zonas con el mismo nombre en un sitio (sin distinguir mayúsculas ni espacios): %. Renombra una de cada par y reaplica.', choques;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_zona_sitio_nombre_normalizado ON zona (sitio_id, lower(btrim(nombre)));
COMMENT ON INDEX uq_zona_sitio_nombre_normalizado IS
  'El nombre de una zona no se repite en su sitio sin distinguir mayúsculas ni espacios en los extremos (migración 28, docs/19 §4 U2).';

-- ── Permisos de la aplicación (repetidos en la migración 14, cuyo REVOKE ALL los borraría al reejecutarla) ────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plataforma_app') THEN
    GRANT INSERT (nombre, codigo, zona_horaria, descripcion) ON sitio TO plataforma_app;
    GRANT UPDATE (nombre, descripcion) ON sitio TO plataforma_app;
    GRANT INSERT (sitio_id, nombre) ON zona TO plataforma_app;
    GRANT UPDATE (nombre, activo) ON zona TO plataforma_app;
  END IF;
END $$;
COMMIT;
