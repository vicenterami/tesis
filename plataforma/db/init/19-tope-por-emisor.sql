-- 19 · Tope por emisor para todas las vías (decidido el 17/10/2026: docs/10 §8.4 punto 53).
--   · estado_dispositivo.ventana_*: los contadores de la hora en curso de cada dispositivo (inicio de la ventana, lecturas aceptadas,
--     tramas guardadas en cuarentena, tramas rechazadas por el tope y tramas rechazadas que no se guardaron por la cuota). Los lee la
--     consulta del filtro 1 y los escribe el filtro 6 en el mismo INSERT … ON CONFLICT de siempre: persistentes y atómicos, sin una
--     consulta más por trama. Sin ventana (NULL) no hay contadores: así una fila vieja no miente.
--   · cuarentena.motivo admite «tope» (la trama que no cabe en el presupuesto de lecturas de la hora) y condicion.tipo admite
--     «tope_superado». Cada regla se reemplaza entera, con los dos nombres que pudo tener (el de la migración 05 y el automático):
--     la última migración que la define manda, como ck_canal_escala en la 18.
-- Idempotente. En una base existente (un contenedor nuevo la aplica solo, desde db/init):
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/19-tope-por-emisor.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

-- a) Contadores de la ventana horaria.
ALTER TABLE estado_dispositivo ADD COLUMN IF NOT EXISTS ventana_inicio     timestamptz;
ALTER TABLE estado_dispositivo ADD COLUMN IF NOT EXISTS ventana_lecturas   integer NOT NULL DEFAULT 0;
ALTER TABLE estado_dispositivo ADD COLUMN IF NOT EXISTS ventana_cuarentena integer NOT NULL DEFAULT 0;
ALTER TABLE estado_dispositivo ADD COLUMN IF NOT EXISTS ventana_sobre_tope integer NOT NULL DEFAULT 0;
ALTER TABLE estado_dispositivo ADD COLUMN IF NOT EXISTS ventana_omitidas   integer NOT NULL DEFAULT 0;
ALTER TABLE estado_dispositivo DROP CONSTRAINT IF EXISTS ck_estado_dispositivo_ventana;
ALTER TABLE estado_dispositivo ADD CONSTRAINT ck_estado_dispositivo_ventana
    CHECK (ventana_lecturas >= 0 AND ventana_cuarentena >= 0 AND ventana_sobre_tope >= 0 AND ventana_omitidas >= 0
           AND (ventana_inicio IS NOT NULL
                OR (ventana_lecturas = 0 AND ventana_cuarentena = 0 AND ventana_sobre_tope = 0 AND ventana_omitidas = 0)));
COMMENT ON COLUMN estado_dispositivo.ventana_inicio IS
    'Hora del reloj (UTC, truncada a la hora) de la ventana cuyos contadores siguen; NULL si nunca se contó.';
COMMENT ON COLUMN estado_dispositivo.ventana_lecturas IS
    'Lecturas examinadas (aceptadas o rechazadas por el filtro 3: cada una costó una consulta) en la ventana. Contra el presupuesto de la hora (docs/10 §8.4 punto 53).';
COMMENT ON COLUMN estado_dispositivo.ventana_cuarentena IS
    'Tramas de este dispositivo guardadas en cuarentena en la ventana. Contra la cuota de la hora.';
COMMENT ON COLUMN estado_dispositivo.ventana_sobre_tope IS
    'Tramas rechazadas enteras en la ventana porque no cabían en el presupuesto (motivo «tope»).';
COMMENT ON COLUMN estado_dispositivo.ventana_omitidas IS
    'Tramas rechazadas en la ventana que no se guardaron en cuarentena por la cuota: solo se contaron.';

-- b) El motivo «tope» en la cuarentena.
ALTER TABLE cuarentena DROP CONSTRAINT IF EXISTS cuarentena_motivo_chk;
ALTER TABLE cuarentena DROP CONSTRAINT IF EXISTS ck_cuarentena_motivo;
ALTER TABLE cuarentena ADD CONSTRAINT ck_cuarentena_motivo
    CHECK (motivo IN ('no_registrado', 'dado_de_baja', 'malformada', 'invalida', 'tope'));

-- c) La condición «tope_superado» del dispositivo (una abierta a la vez: el índice único parcial condicion_abierta_unica ya lo exige).
ALTER TABLE condicion DROP CONSTRAINT IF EXISTS condicion_tipo_check;
ALTER TABLE condicion DROP CONSTRAINT IF EXISTS ck_condicion_tipo;
ALTER TABLE condicion ADD CONSTRAINT ck_condicion_tipo
    CHECK (tipo IN ('sin_comunicacion', 'umbral', 'bateria', 'manipulacion', 'tope_superado'));
COMMIT;
