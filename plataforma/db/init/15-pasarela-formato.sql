-- 15 · El formato lo declara la pasarela y sus nodos LoRaWAN lo heredan (decidido el 15/10/2026: docs/10 §8.4 punto 47).
--   · pasarela.formato: milesight (servidor de red embebido en la pasarela, ruta B) o chirpstack (servidor de red externo,
--     ruta C). Sin valor por defecto: una pasarela nueva lo declara. Las filas que ya existían quedan en milesight, lo que eran.
--   · dispositivo.formato admite chirpstack. Un dispositivo directo (mqtt, http) declara senml o plano; uno lorawan tiene el
--     de su pasarela, y lo garantiza una clave foránea compuesta (pasarela_id, formato) → pasarela (id, formato) en cascada:
--     corregir el formato de una pasarela corrige el de sus nodos en la misma sentencia, sin un disparador con lógica.
-- Idempotente. En una base existente (un contenedor nuevo la aplica solo, desde db/init):
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/15-pasarela-formato.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Antes de cambiar nada (docs/08 §6, cambio sobre datos reales): lo que la regla nueva rechazaría se cuenta y detiene la
-- migración con un motivo claro, en vez de que lo descubra un ALTER a mitad de camino.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM dispositivo WHERE (via = 'lorawan') <> (formato IN ('milesight', 'chirpstack'));
  IF n > 0 THEN
    RAISE EXCEPTION '15: % dispositivo(s) con un formato que no corresponde a su vía (lorawan con milesight o chirpstack; mqtt y http con senml o plano): corregirlos antes de migrar', n;
  END IF;
END $$;

-- a) Formato de la pasarela. El DEFAULT solo rellena las filas existentes y se quita en la misma transacción.
ALTER TABLE pasarela ADD COLUMN IF NOT EXISTS formato text NOT NULL DEFAULT 'milesight';
ALTER TABLE pasarela ALTER COLUMN formato DROP DEFAULT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_pasarela_formato') THEN
    ALTER TABLE pasarela ADD CONSTRAINT ck_pasarela_formato CHECK (formato IN ('milesight', 'chirpstack'));
  END IF;
  -- La clave foránea compuesta exige una restricción única sobre las mismas columnas; id ya es único, esta lo repite a propósito.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_pasarela_id_formato') THEN
    ALTER TABLE pasarela ADD CONSTRAINT uq_pasarela_id_formato UNIQUE (id, formato);
  END IF;
END $$;
COMMENT ON TABLE pasarela IS
  'Quien publica en nombre de los nodos LoRaWAN: una pasarela con servidor de red embebido (ruta B) o un servidor de red externo (ruta C), bajo sitio/<codigo>/pasarela/<id_fisico>/<deveui>/<evento> (docs/10 §8.4 puntos 24, 45 y 47).';
COMMENT ON COLUMN pasarela.formato IS
  'Formato de lo que publica: milesight (servidor de red embebido) o chirpstack (servidor de red externo). Sus nodos lo heredan por fk_dispositivo_pasarela_formato (docs/10 §8.4 punto 47).';

-- b) Formato del dispositivo. La última migración que define la regla la reemplaza; la 11 solo la crea si la columna no existe.
ALTER TABLE dispositivo DROP CONSTRAINT IF EXISTS ck_dispositivo_formato;
ALTER TABLE dispositivo ADD CONSTRAINT ck_dispositivo_formato CHECK (formato IN ('senml', 'plano', 'milesight', 'chirpstack'));
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_dispositivo_via_formato') THEN
    ALTER TABLE dispositivo ADD CONSTRAINT ck_dispositivo_via_formato
      CHECK ((via = 'lorawan') = (formato IN ('milesight', 'chirpstack')));
  END IF;
  -- MATCH SIMPLE (por defecto): sin pasarela_id no se comprueba, así que solo alcanza a los nodos lorawan. Su índice es el de
  -- pasarela_id (idx_dispositivo_pasarela_id, migración 11): la cascada busca por esa columna primero.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_dispositivo_pasarela_formato') THEN
    ALTER TABLE dispositivo ADD CONSTRAINT fk_dispositivo_pasarela_formato
      FOREIGN KEY (pasarela_id, formato) REFERENCES pasarela (id, formato) ON UPDATE CASCADE;
  END IF;
END $$;
COMMENT ON COLUMN dispositivo.formato IS
  'Código del adaptador que entiende sus tramas (lo interpreta el código, docs/08 §6): senml o plano si llega directo (mqtt, http); en la vía lorawan, el de su pasarela (fk_dispositivo_pasarela_formato, docs/10 §8.4 punto 47).';
COMMIT;
