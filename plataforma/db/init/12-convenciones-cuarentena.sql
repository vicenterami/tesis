-- 12 · El CHECK de los motivos de cuarentena con el nombre de la convención (docs/08 §6): ck_cuarentena_motivo.
-- Las migraciones 07 y 09 lo llamaron cuarentena_motivo_chk, después de que la 05 renombrara las restricciones anteriores;
-- lo detectó la comprobación de convenciones del guardián (paso 1b, 09/10/2026). Solo cambia el nombre: ni la regla ni los
-- datos. Repetible. Desde el 09/10 la 07 y la 09 ya crean la regla con este nombre: esta migración solo actúa en las bases
-- migradas antes.
-- Base existente:
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/12-convenciones-cuarentena.sql
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cuarentena_motivo_chk' AND conrelid = 'cuarentena'::regclass)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cuarentena_motivo' AND conrelid = 'cuarentena'::regclass) THEN
    ALTER TABLE cuarentena RENAME CONSTRAINT cuarentena_motivo_chk TO ck_cuarentena_motivo;
  END IF;
END $$;
COMMIT;
