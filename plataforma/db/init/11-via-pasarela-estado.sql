-- 11 · Vía, formato y pasarela en el alta; estado del dispositivo aparte; código del sitio (decisiones del 08/10/2026:
-- docs/10 §8.4 puntos 24, 25 y 27; modelo en docs/08 §2 y §8).
--   · sitio.codigo: el segmento del tópico (sitio/<codigo>/…). La ACL deja pasar cualquier sitio en ese nivel (+), así que
--     el filtro 1 exige que coincida con el sitio registrado del dispositivo (punto 24).
--   · pasarela: la vía LoRaWAN del sistema (ruta B). Su id_fisico es también su usuario del broker.
--   · dispositivo.via, .formato y .pasarela_id, obligatoria si la vía es lorawan (punto 25).
--   · estado_dispositivo: lo que el sistema escribe en cada trama sale de la fila que edita una persona (punto 27). Sin
--     disparador de actualizado_en, a propósito: es la excepción declarada a la convención de auditoría (docs/08 §6).
--   · Identificador del broker: lista blanca [a-z0-9-] (se sustituye con %u dentro del tópico de la ACL) y único entre
--     dispositivos y pasarelas, con un bloqueo por identificador para que dos altas simultáneas no se crucen.
-- Convenciones de docs/08 §6: idempotente (se puede repetir sin duplicar ni pisar nada); cuenta antes y después lo que
-- traslada, en la misma transacción; y dispositivo.visto_por_ultima_vez NO se borra aquí (deprecación): queda comentada
-- como DEPRECADA y se elimina en una migración posterior, cuando ningún backend desplegado la lea.
-- Base existente:
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/11-via-pasarela-estado.sql
-- Después, la semilla de la demo (pruebas/semilla-demo.sh): fija en «uct» el código del sitio de la demo.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Código del sitio. En una base existente se deriva del nombre; la semilla de la demo lo fija en «uct». Si dos sitios
-- dieran el mismo código, la migración se detiene entera (uq_sitio_codigo) y no queda a medias.
ALTER TABLE sitio ADD COLUMN IF NOT EXISTS codigo text;
UPDATE sitio SET codigo = left(trim(both '-' from regexp_replace(lower(nombre), '[^a-z0-9]+', '-', 'g')), 63)
 WHERE codigo IS NULL;
ALTER TABLE sitio ALTER COLUMN codigo SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sitio_codigo') THEN
    ALTER TABLE sitio ADD CONSTRAINT ck_sitio_codigo CHECK (codigo ~ '^[a-z0-9][a-z0-9-]{1,62}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_sitio_codigo') THEN
    ALTER TABLE sitio ADD CONSTRAINT uq_sitio_codigo UNIQUE (codigo);
  END IF;
END $$;
COMMENT ON COLUMN sitio.codigo IS
  'Segmento del tópico MQTT (sitio/<codigo>/…). El filtro 1 exige que coincida con el sitio registrado del dispositivo: la ACL acepta cualquiera en ese nivel (docs/10 §8.4 punto 24).';

-- Pasarela LoRaWAN (ruta B): tabla mutable, con creado_en, actualizado_en y su disparador, y baja lógica (docs/08 §6).
CREATE TABLE IF NOT EXISTS pasarela (
    id                   uuid NOT NULL DEFAULT gen_random_uuid() CONSTRAINT pk_pasarela PRIMARY KEY,
    sitio_id             uuid NOT NULL CONSTRAINT fk_pasarela_sitio REFERENCES sitio(id),
    id_fisico            text NOT NULL CONSTRAINT uq_pasarela_id_fisico UNIQUE
                         CONSTRAINT ck_pasarela_id_fisico CHECK (id_fisico ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
    nombre               text NOT NULL,
    activo               boolean NOT NULL DEFAULT true,
    visto_por_ultima_vez timestamptz,
    creado_en            timestamptz NOT NULL DEFAULT now(),
    actualizado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pasarela_sitio_id ON pasarela (sitio_id);
CREATE OR REPLACE TRIGGER trg_pasarela_actualizado_en BEFORE UPDATE ON pasarela
  FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();
COMMENT ON TABLE pasarela IS
  'Pasarela LoRaWAN con servidor de red embebido (ruta B): publica bajo sitio/<codigo>/pasarela/<id_fisico>/…, con el DevEUI de cada nodo en el cuerpo (docs/10 §8.4 punto 24).';
COMMENT ON COLUMN pasarela.id_fisico IS 'EUI o número de serie de la pasarela; también su usuario del broker (único también frente a dispositivo.id_fisico).';

-- Vía, formato y pasarela del dispositivo (punto 25). El filtro 2 todavía prueba los adaptadores en orden; usar el formato
-- declarado llega con el adaptador de la pasarela (HU-02), junto con separar el dispositivo de la demo, que manda SenML y plano.
ALTER TABLE dispositivo
  ADD COLUMN IF NOT EXISTS via text NOT NULL DEFAULT 'mqtt'
      CONSTRAINT ck_dispositivo_via CHECK (via IN ('mqtt', 'http', 'lorawan')),
  ADD COLUMN IF NOT EXISTS formato text NOT NULL DEFAULT 'senml'
      CONSTRAINT ck_dispositivo_formato CHECK (formato IN ('senml', 'plano', 'milesight')),
  ADD COLUMN IF NOT EXISTS pasarela_id uuid CONSTRAINT fk_dispositivo_pasarela REFERENCES pasarela(id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_dispositivo_via_pasarela_id') THEN
    ALTER TABLE dispositivo ADD CONSTRAINT ck_dispositivo_via_pasarela_id CHECK (via <> 'lorawan' OR pasarela_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_dispositivo_id_fisico') THEN
    ALTER TABLE dispositivo ADD CONSTRAINT ck_dispositivo_id_fisico CHECK (id_fisico ~ '^[a-z0-9][a-z0-9-]{2,62}$');
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_dispositivo_pasarela_id ON dispositivo (pasarela_id);
COMMENT ON COLUMN dispositivo.via IS 'Cómo llega: mqtt (su propia credencial del broker), http (un token) o lorawan (la autentica su pasarela).';
COMMENT ON COLUMN dispositivo.formato IS 'Código del adaptador que entiende sus tramas (lo interpreta el código, docs/08 §6).';

-- Identificador del broker único entre dispositivos y pasarelas. El bloqueo por identificador serializa dos altas
-- simultáneas con el mismo nombre en tablas distintas (sin él, las dos verían «libre» a la vez).
CREATE OR REPLACE FUNCTION fn_id_fisico_unico_en_broker() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('id_fisico:' || NEW.id_fisico));
  IF (TG_TABLE_NAME = 'dispositivo' AND EXISTS (SELECT 1 FROM pasarela WHERE id_fisico = NEW.id_fisico))
     OR (TG_TABLE_NAME = 'pasarela' AND EXISTS (SELECT 1 FROM dispositivo WHERE id_fisico = NEW.id_fisico)) THEN
    RAISE EXCEPTION 'id_fisico «%» ya lo usa otra entidad como usuario del broker', NEW.id_fisico
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_dispositivo_id_fisico_unico BEFORE INSERT OR UPDATE OF id_fisico ON dispositivo
  FOR EACH ROW EXECUTE FUNCTION fn_id_fisico_unico_en_broker();
CREATE OR REPLACE TRIGGER trg_pasarela_id_fisico_unico BEFORE INSERT OR UPDATE OF id_fisico ON pasarela
  FOR EACH ROW EXECUTE FUNCTION fn_id_fisico_unico_en_broker();

-- Estado del dispositivo (punto 27): una fila por dispositivo, la escribe el pipeline.
CREATE TABLE IF NOT EXISTS estado_dispositivo (
    dispositivo_id       uuid NOT NULL CONSTRAINT pk_estado_dispositivo PRIMARY KEY
                         CONSTRAINT fk_estado_dispositivo_dispositivo REFERENCES dispositivo(id) ON DELETE CASCADE,
    visto_por_ultima_vez timestamptz NOT NULL
);
COMMENT ON TABLE estado_dispositivo IS
  'Lo que escribe el sistema sobre cada dispositivo (última trama aceptada). Sin actualizado_en, a propósito: la fila de dispositivo queda para lo que edita una persona y el bloqueo optimista no da conflictos falsos (docs/10 §8.4 puntos 27 y 28).';
COMMENT ON COLUMN estado_dispositivo.visto_por_ultima_vez IS 'Derivado: última trama aceptada por el pipeline (filtro 6). Lo lee el supervisor para detectar silencios.';

-- Traslado del «visto», contado antes y después. Si se repite, conserva el más reciente de los dos.
DO $$
DECLARE n_antes int; n_despues int;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dispositivo' AND column_name = 'visto_por_ultima_vez') THEN
    EXECUTE 'SELECT count(*) FROM dispositivo WHERE visto_por_ultima_vez IS NOT NULL' INTO n_antes;
    EXECUTE 'INSERT INTO estado_dispositivo (dispositivo_id, visto_por_ultima_vez)
               SELECT id, visto_por_ultima_vez FROM dispositivo WHERE visto_por_ultima_vez IS NOT NULL
             ON CONFLICT (dispositivo_id) DO UPDATE
               SET visto_por_ultima_vez = greatest(estado_dispositivo.visto_por_ultima_vez, EXCLUDED.visto_por_ultima_vez)';
    SELECT count(*) INTO n_despues FROM estado_dispositivo;
    RAISE NOTICE 'visto trasladado: % dispositivo(s) con visto antes; % fila(s) en estado_dispositivo después', n_antes, n_despues;
    IF n_despues < n_antes THEN RAISE EXCEPTION 'el traslado perdió filas (% antes, % después)', n_antes, n_despues; END IF;
    EXECUTE $c$COMMENT ON COLUMN dispositivo.visto_por_ultima_vez IS
      'DEPRECADA el 08/10/2026: la reemplaza estado_dispositivo.visto_por_ultima_vez (migración 11). El backend ya no la escribe; se elimina en una migración posterior.'$c$;
  END IF;
END $$;

COMMIT;
