-- 30 · «Elegir qué ver» por persona (diseñado el 25/11/2026 tras la refutación: docs/10 §8.4 punto 72 ii, docs/19 §4 bloque AA punto 7,
--      docs/08; RF-56 y HU-29, puestos al día antes).
--   · preferencia.magnitudes_ocultas: los códigos de magnitud que la persona NO quiere ver en el Resumen y en «Tendencias». Vacía por
--     omisión (nada oculto); a lo más 50. No se exige que cada código exista en el catálogo: uno que ya no existe no coincide con ningún
--     canal y no hace daño; la forma la valida el backend (la de ck_magnitud_codigo, migración 27).
--   · Permisos de plataforma_app: UPDATE de esa columna (el INSERT de preferencia ya es de toda la fila, migración 24). Se repite en la 14.
-- Aditiva e idempotente: una columna NOT NULL con su valor por omisión, su CHECK y el permiso, en una transacción. Convenciones de
-- docs/08 §6: nombre ck_; COMMENT ON. Base existente (un contenedor nuevo la aplica solo, desde db/init; antes, un respaldo):
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/30-magnitudes-ocultas.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE preferencia ADD COLUMN IF NOT EXISTS magnitudes_ocultas text[] NOT NULL DEFAULT '{}';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_preferencia_magnitudes_ocultas' AND conrelid = 'preferencia'::regclass) THEN
    ALTER TABLE preferencia ADD CONSTRAINT ck_preferencia_magnitudes_ocultas CHECK (cardinality(magnitudes_ocultas) <= 50);
  END IF;
END $$;
COMMENT ON COLUMN preferencia.magnitudes_ocultas IS
  'Códigos de magnitud que la persona no quiere ver en el Resumen («Ahora») ni en «Tendencias»; vacía = ve todo. La ficha y «Red» muestran siempre todo (migración 30, docs/10 §8.4 punto 72 ii).';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plataforma_app') THEN
    GRANT UPDATE (magnitudes_ocultas) ON preferencia TO plataforma_app;
  END IF;
END $$;
COMMIT;
