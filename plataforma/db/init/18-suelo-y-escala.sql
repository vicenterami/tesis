-- 18 · Suelo del nodo propio y calibración por canal (decidido el 16/10/2026: docs/10 §8.4 punto 51).
--   · magnitud temperatura_suelo (Cel, −55 a 125: el rango de medida del DS18B20 según su hoja de datos).
--   · magnitud humedad_suelo (V, 0 a 3,3): la tensión cruda del sensor capacitivo, en la unidad SenML sin prefijo (RFC 8428; «mV» es
--     unidad secundaria, RFC 8798). El porcentaje no se guarda: se calcula con la calibración del canal.
--   · canal.escala_cero y canal.escala_cien: el valor de la magnitud que corresponde al 0 % y al 100 %. Las dos o ninguna, finitas y distintas;
--     el orden no importa (en el suelo, el 100 % —en agua— es la tensión más baja). Las edita una persona: el canal ya tiene
--     actualizado_en y su disparador (migración 05).
-- Idempotente. En una base existente (un contenedor nuevo la aplica solo, desde db/init):
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/18-suelo-y-escala.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

-- a) Catálogo.
INSERT INTO magnitud (codigo, nombre, unidad_canonica, rango_min, rango_max) VALUES
    ('temperatura_suelo', 'Temperatura del suelo', 'Cel', -55, 125),
    ('humedad_suelo', 'Humedad del suelo (tensión del sensor capacitivo)', 'V', 0, 3.3)
ON CONFLICT (codigo) DO NOTHING;

-- b) Calibración lineal a porcentaje, por canal.
ALTER TABLE canal ADD COLUMN IF NOT EXISTS escala_cero double precision;
ALTER TABLE canal ADD COLUMN IF NOT EXISTS escala_cien double precision;
-- Finitas: double precision admite NaN e infinitos, y con ellos el % sería basura. En PostgreSQL NaN es mayor que todo número, así que
-- «< 'Infinity'» también lo excluye (revisión del 16/10, comprobado en el banco: sin esto se aceptaban NaN e Infinity). La regla se
-- reemplaza entera (la última migración que la define manda, como ck_dispositivo_formato en la 15).
ALTER TABLE canal DROP CONSTRAINT IF EXISTS ck_canal_escala;
ALTER TABLE canal ADD CONSTRAINT ck_canal_escala CHECK (
  (escala_cero IS NULL AND escala_cien IS NULL)
  OR (escala_cero IS NOT NULL AND escala_cien IS NOT NULL   -- explícito: con un NULL, la comparación de abajo daría «desconocido» y el
                                                            -- CHECK lo da por cumplido (lo detectó el caso 20 el 16/10)
      AND escala_cero > '-Infinity'::float8 AND escala_cero < 'Infinity'::float8
      AND escala_cien > '-Infinity'::float8 AND escala_cien < 'Infinity'::float8
      AND escala_cero <> escala_cien));
COMMENT ON COLUMN canal.escala_cero IS
  'Valor de la magnitud (en su unidad canónica) que corresponde al 0 %; con escala_cien, el porcentaje es 100 × (v − cero) / (cien − cero), recortado a [0, 100] (docs/10 §8.4 punto 51). Nulo = sin calibración.';
COMMENT ON COLUMN canal.escala_cien IS
  'Valor de la magnitud que corresponde al 100 %; puede ser menor que escala_cero (sensor que baja al crecer lo medido, como el de suelo capacitivo).';
COMMIT;
