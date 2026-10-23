-- 21 · Calibración por API con bloqueo optimista (decidido el 22/10/2026: docs/10 §8.4 punto 51 (ii) y (iii)).
--   · canal.actualizado_en, `timestamptz NOT NULL DEFAULT now()`, con el disparador BEFORE UPDATE que lo pone en now(): así lo mantienen
--     la API, la vía por SQL y cualquier escritor futuro. La columna y el disparador (trg_canal_actualizado_en, función
--     fn_set_actualizado_en) ya existen desde la migración 05, que los puso en toda tabla mutable: aquí se aseguran con la misma forma
--     (repetible, sin duplicar nada) y se documenta su segundo uso, la marca del bloqueo optimista de PATCH /canales/{id}.
--   · Permiso de la aplicación: `plataforma_app` (migración 14) no podía actualizar ninguna columna de canal. Recibe UPDATE solo en
--     escala_cero y escala_cien: ni el dispositivo, ni la magnitud, ni actualizado_en, que pone el disparador (un disparador no exige
--     permiso sobre las columnas que cambia en NEW). La migración 14 lo repite si la columna existe, porque su REVOKE ALL lo borraría
--     al reejecutarla después de esta.
-- Idempotente. En una base existente (un contenedor nuevo la aplica solo, desde db/init):
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/21-canal-actualizado-en.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE canal ADD COLUMN IF NOT EXISTS actualizado_en timestamptz NOT NULL DEFAULT now();
CREATE OR REPLACE TRIGGER trg_canal_actualizado_en BEFORE UPDATE ON canal FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();
COMMENT ON COLUMN canal.actualizado_en IS
  'Último cambio de la fila; lo pone el disparador trg_canal_actualizado_en en cada UPDATE. Es la marca del bloqueo optimista de PATCH /canales/{id}: el cambio exige el valor que entregó la ficha, con sus microsegundos (docs/10 §8.4 punto 51).';

GRANT UPDATE (escala_cero, escala_cien) ON canal TO plataforma_app;
COMMIT;
