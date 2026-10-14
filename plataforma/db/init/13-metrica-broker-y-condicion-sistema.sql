-- 13 · Métricas del broker y condiciones del sistema (decisión del 12/10/2026, docs/10 §8.4 punto 43; implementado el 13/10).
--   · metrica_broker: una muestra por minuto de los contadores $SYS que el manual de Mosquitto documenta (descartes por
--     límites de cola, mensajes y bytes en el almacén, clientes conectados, memoria), tomada por la conexión administradora
--     del backend. Hypertable (fragmentos de 7 días) con retención de 90 días por drop_chunks (RetencionService).
--   · condicion_sistema: un estado anómalo de la plataforma, sin dispositivo (hoy un solo tipo: broker_descarte, que se abre
--     cuando el contador de descartes crece entre dos muestras o la cola supera el 80 % de su tope, y se cierra sola al
--     normalizarse). Misma forma que `condicion` (abierta_en, cerrada_en): una sola abierta por tipo.
-- Convenciones de docs/08 §6: idempotente; nombres pk_/ck_/uq_; COMMENT ON en lo que no es obvio.
-- Base existente:
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/13-metrica-broker-y-condicion-sistema.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS metrica_broker (
    tiempo                timestamptz NOT NULL CONSTRAINT pk_metrica_broker PRIMARY KEY,
    mensajes_descartados  bigint  NOT NULL CONSTRAINT ck_metrica_broker_descartados CHECK (mensajes_descartados >= 0),
    mensajes_en_cola      integer NOT NULL CONSTRAINT ck_metrica_broker_en_cola CHECK (mensajes_en_cola >= 0),
    bytes_en_cola         bigint  NOT NULL CONSTRAINT ck_metrica_broker_bytes CHECK (bytes_en_cola >= 0),
    clientes_conectados   integer NOT NULL CONSTRAINT ck_metrica_broker_clientes CHECK (clientes_conectados >= 0),
    memoria_bytes         bigint
);
SELECT create_hypertable('metrica_broker', 'tiempo', if_not_exists => TRUE, chunk_time_interval => INTERVAL '7 days');
COMMENT ON TABLE metrica_broker IS
  'Una muestra por minuto de los contadores $SYS del broker (docs/10 §8.4 punto 43), tomada por la conexión administradora del backend. Retención 90 días (drop_chunks).';
COMMENT ON COLUMN metrica_broker.mensajes_descartados IS
  '$SYS/broker/publish/messages/dropped: acumulado desde que arrancó el broker (se reinicia con él). La alarma mira el DELTA entre muestras.';
COMMENT ON COLUMN metrica_broker.mensajes_en_cola IS '$SYS/broker/store/messages/count: mensajes en el almacén del broker (la cola, si el backend se atrasa).';
COMMENT ON COLUMN metrica_broker.bytes_en_cola IS '$SYS/broker/store/messages/bytes.';
COMMENT ON COLUMN metrica_broker.clientes_conectados IS '$SYS/broker/clients/connected.';
COMMENT ON COLUMN metrica_broker.memoria_bytes IS '$SYS/broker/heap/current; NULL si el broker no publica ese tópico (compilado sin seguimiento de memoria).';

CREATE TABLE IF NOT EXISTS condicion_sistema (
    id          uuid NOT NULL DEFAULT gen_random_uuid() CONSTRAINT pk_condicion_sistema PRIMARY KEY,
    tipo        text NOT NULL CONSTRAINT ck_condicion_sistema_tipo CHECK (tipo IN ('broker_descarte')),
    detalle     jsonb,
    abierta_en  timestamptz NOT NULL DEFAULT now(),
    cerrada_en  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_condicion_sistema_abierta ON condicion_sistema (tipo) WHERE cerrada_en IS NULL;
COMMENT ON TABLE condicion_sistema IS
  'Estado anómalo de la plataforma, sin dispositivo (docs/10 §8.4 punto 43): broker_descarte se abre cuando el broker descarta mensajes o la cola pasa el 80 % del tope, y se cierra sola al normalizarse. Una abierta por tipo.';
COMMENT ON COLUMN condicion_sistema.detalle IS 'Foto al abrir y al cerrar: motivo (descartes o cola_alta), delta de descartes, mensajes en cola y tope.';

COMMIT;
