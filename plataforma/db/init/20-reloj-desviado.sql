-- 20 · Tolerancia de desvío de la marca de pasarela (decidido el 21/10/2026: docs/10 §8.4 punto 54; docs/13 regla 18).
--   · condicion.tipo admite «reloj_desviado»: la abre el pipeline cuando la marca de tiempo de una pasarela difiere más de 10 minutos
--     de la hora de recepción (la medición queda con origen_tiempo = recepcion) y la cierra la primera trama del mismo dispositivo con
--     marca de pasarela plausible. Una abierta a la vez por dispositivo: el índice único parcial condicion_abierta_unica ya lo exige.
--     La regla se reemplaza entera, con los dos nombres que pudo tener (el de la migración 05 y el automático): la última migración
--     que la define manda, como en la 19.
-- Idempotente. En una base existente (un contenedor nuevo la aplica solo, desde db/init):
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/20-reloj-desviado.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE condicion DROP CONSTRAINT IF EXISTS condicion_tipo_check;
ALTER TABLE condicion DROP CONSTRAINT IF EXISTS ck_condicion_tipo;
ALTER TABLE condicion ADD CONSTRAINT ck_condicion_tipo
    CHECK (tipo IN ('sin_comunicacion', 'umbral', 'bateria', 'manipulacion', 'tope_superado', 'reloj_desviado'));
COMMIT;
