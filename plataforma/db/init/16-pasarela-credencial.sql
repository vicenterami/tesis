-- 16 · Credencial propia de la pasarela y permisos de la aplicación sobre `pasarela` (decidido el 15/10/2026: docs/10 §8.4 punto 47).
--   · credencial: el titular es un dispositivo o una pasarela, exactamente uno (ck_credencial_titular). La pasarela guarda su hash en la
--     misma tabla, con el mismo historial activa/inactiva que un dispositivo; el secreto nunca se guarda.
--   · plataforma_app gana INSERT en pasarela (el alta) y UPDATE solo de la columna activo (la baja). Nada más: un error o una inyección no
--     podría cambiar sitio_id, id_fisico ni formato, que se propaga en cascada a los nodos (mínimo privilegio, migración 14; revisión del 15/10).
-- Idempotente. En una base existente (un contenedor nuevo la aplica solo, desde db/init):
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/16-pasarela-credencial.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE credencial ADD COLUMN IF NOT EXISTS pasarela_id uuid
  CONSTRAINT fk_credencial_pasarela REFERENCES pasarela(id) ON DELETE CASCADE;
ALTER TABLE credencial ALTER COLUMN dispositivo_id DROP NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_credencial_titular') THEN
    ALTER TABLE credencial ADD CONSTRAINT ck_credencial_titular CHECK (num_nonnulls(dispositivo_id, pasarela_id) = 1);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_credencial_pasarela_id ON credencial (pasarela_id);
COMMENT ON COLUMN credencial.pasarela_id IS
  'Titular cuando la credencial es de una pasarela (rutas B y C); exactamente uno de dispositivo_id y pasarela_id (docs/10 §8.4 punto 47).';

-- Una versión anterior de esta migración daba UPDATE en toda la tabla: se revoca antes, así reejecutarla deja solo la columna.
REVOKE UPDATE ON pasarela FROM plataforma_app;
GRANT INSERT ON pasarela TO plataforma_app;
GRANT UPDATE (activo) ON pasarela TO plataforma_app;
COMMIT;
