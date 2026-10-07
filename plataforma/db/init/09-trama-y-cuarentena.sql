-- 09 · Trama cruda aceptada y cuarentena como serie de tiempo (docs/10 §8.4 puntos 5 y 11; docs/08 §8).
--   a) tabla `trama`: la trama original de cada mensaje con al menos una lectura guardada, para auditoría y
--      re-decodificación si un adaptador tuvo un error. Solo inserción; vence a los 30 días.
--   b) `cuarentena` pasa a ser hypertable por recibido_en: la retención borra fragmentos enteros con drop_chunks
--      (instantáneo, sin filas muertas ni vacuum) aunque un nodo mal configurado la inunde.
--   c) `cuarentena` guarda el detalle del rechazo (hasta hoy solo iba al log, que rota) y el dispositivo cuando
--      ya pasó el filtro 1; `origen` queda como dominio cerrado.
-- Una hypertable se reparte en fragmentos (chunks) por tiempo; toda clave única debe incluir la columna de
-- particionado, por eso la clave primaria es (id, recibido_en). Fragmentos de 1 día: con 30 de retención
-- quedan ~30 fragmentos y se borra con precisión de un día.
-- Base existente: docker compose exec -T timescaledb psql -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/09-trama-y-cuarentena.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

-- a) trama
CREATE TABLE IF NOT EXISTS trama (
    id             uuid        NOT NULL DEFAULT gen_random_uuid(),
    dispositivo_id uuid        NOT NULL,
    recibido_en    timestamptz NOT NULL,
    topico         text        NOT NULL,
    payload        bytea       NOT NULL,
    adaptador      text        NOT NULL,
    CONSTRAINT pk_trama PRIMARY KEY (id, recibido_en),
    CONSTRAINT fk_trama_dispositivo FOREIGN KEY (dispositivo_id) REFERENCES dispositivo (id)
);
SELECT create_hypertable('trama', 'recibido_en', chunk_time_interval => INTERVAL '1 day', if_not_exists => true);
-- «Las últimas tramas del dispositivo X»: un solo índice sirve a la FK y a la consulta (convención 05 b).
CREATE INDEX IF NOT EXISTS idx_trama_dispositivo_id ON trama (dispositivo_id, recibido_en DESC);

COMMENT ON TABLE trama IS
    'Trama cruda de cada mensaje con al menos una lectura guardada. FOTO por valor: nunca se reinterpreta (docs/08 §7). Retención: RETENCION_TRAMA_DIAS (30).';
COMMENT ON COLUMN trama.adaptador IS
    'Qué adaptador la tradujo (senml, plano…). Lo escribe el código y nadie lo interpreta: sin CHECK. Sirve para re-decodificar lo de un adaptador con error.';

-- b) cuarentena → hypertable (solo si aún no lo es: la migración se puede reejecutar)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'cuarentena') THEN
    ALTER TABLE cuarentena DROP CONSTRAINT pk_cuarentena;
    ALTER TABLE cuarentena ADD CONSTRAINT pk_cuarentena PRIMARY KEY (id, recibido_en);
    PERFORM create_hypertable('cuarentena', 'recibido_en', chunk_time_interval => INTERVAL '1 day', migrate_data => true);
  END IF;
END $$;

-- c) detalle, dispositivo, dominio de origen y motivos que se entienden solos (07/10: «desconocido» se leía como
--    «motivo desconocido»; se separa en no_registrado y dado_de_baja). Lo que no trae credencial no tiene motivo
--    aquí porque nunca llega: lo corta el broker.
ALTER TABLE cuarentena DROP CONSTRAINT IF EXISTS cuarentena_motivo_chk;
UPDATE cuarentena SET motivo = 'no_registrado' WHERE motivo = 'desconocido';
ALTER TABLE cuarentena ADD CONSTRAINT cuarentena_motivo_chk
    CHECK (motivo IN ('no_registrado', 'dado_de_baja', 'malformada', 'invalida'));
ALTER TABLE cuarentena ADD COLUMN IF NOT EXISTS detalle        text;
ALTER TABLE cuarentena ADD COLUMN IF NOT EXISTS dispositivo_id uuid;
ALTER TABLE cuarentena DROP CONSTRAINT IF EXISTS fk_cuarentena_dispositivo;
ALTER TABLE cuarentena ADD CONSTRAINT fk_cuarentena_dispositivo
    FOREIGN KEY (dispositivo_id) REFERENCES dispositivo (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cuarentena_dispositivo_id ON cuarentena (dispositivo_id, recibido_en DESC);
ALTER TABLE cuarentena DROP CONSTRAINT IF EXISTS ck_cuarentena_origen;
ALTER TABLE cuarentena ADD CONSTRAINT ck_cuarentena_origen CHECK (origen IN ('mqtt', 'http'));

COMMENT ON COLUMN cuarentena.detalle IS
    'Por qué, en concreto: «fuera de rango: 500 Cel», «canal no declarado: presion». Una fila por trama; si varias lecturas fallan, todos los motivos aquí, separados por «; ».';
COMMENT ON COLUMN cuarentena.dispositivo_id IS
    'Dispositivo al que se atribuyó la trama (dado_de_baja, malformada, invalida). NULL si no hay a quién: no_registrado o tópico fuera del patrón. El tópico se conserva como evidencia de lo que llegó.';
COMMENT ON COLUMN cuarentena.motivo IS
    'Por qué se rechazó: no_registrado (credencial válida, sin alta), dado_de_baja (su credencial sigue viva: revocarla), malformada (tópico fuera del patrón o filtro 2), invalida (filtro 3). El porqué concreto, en detalle.';
COMMENT ON TABLE cuarentena IS
    'Tramas rechazadas por los filtros 1 a 3, crudas y con su motivo. Lo que no tiene credencial no llega aquí: lo corta el broker. Retención: RETENCION_CUARENTENA_DIAS (30).';

-- d) mostrar un payload crudo sin que una sola trama binaria tumbe la consulta completa (observado el 07/10:
--    convert_from(…, 'UTF8') sobre 0xff aborta TODO el GET /cuarentena). Texto si es UTF-8 válido; si no, hex.
CREATE OR REPLACE FUNCTION payload_legible(b bytea, max_car integer)
RETURNS TABLE (texto text, formato text) LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
  RETURN QUERY SELECT left(convert_from(b, 'UTF8'), max_car), 'utf8'::text;
EXCEPTION WHEN character_not_in_repertoire THEN   -- 22021: secuencia inválida o byte nulo
  RETURN QUERY SELECT encode(substring(b FROM 1 FOR max_car / 2), 'hex'), 'hex'::text;
END $$;
COMMENT ON FUNCTION payload_legible(bytea, integer) IS
  'Para mostrar, nunca para reprocesar: texto UTF-8 recortado a max_car caracteres o, si los bytes no son UTF-8 (binario LoRa, byte nulo), su hexadecimal con formato = hex.';

COMMIT;
