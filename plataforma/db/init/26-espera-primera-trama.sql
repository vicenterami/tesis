-- 26 · «En servicio desde» del dispositivo y espera de la primera trama del sitio (decidido el 18/11/2026: docs/19 §2 y §4, P;
--      docs/10 §8.4 punto 68; RF-24).
--   · dispositivo.en_servicio_desde: el instante desde el cual se espera que el equipo reporte. Nace con el alta (DEFAULT now(), también en
--     el alta masiva) y el backend lo pone en now() cuando el estado pasa de `mantenimiento` a `activo` (PATCH /dispositivos/{id}, en la
--     misma transacción que el cambio). Lo usan tres cosas: el plazo de la primera trama de quien nunca envió una; el silencio que vigila el
--     supervisor (desde el más reciente entre la última trama y este instante: volver de mantenimiento no abre una alarma falsa en el primer
--     barrido); y las tramas esperadas de la entrega. Las filas que ya existían toman su `creado_en` (lo que la entrega usaba hasta hoy).
--   · sitio.espera_primera_trama_h: cuántas horas espera el sitio la primera trama de un equipo antes de darlo por «Sin señal» y abrir la
--     condición de falta de comunicación; de 1 a 2 160 (90 días), 168 (7 días) por omisión: un alta masiva suele ir días antes de instalar.
--     Lo fija quien administra el sitio (PUT /sitios/{id}/espera-primera-trama, con su evento).
--   · Permisos de plataforma_app (mínimo privilegio, migración 14): UPDATE de la columna nueva de `sitio` (las demás de `sitio`, no). La de
--     `dispositivo` no necesita nada: la aplicación ya inserta y actualiza esa tabla. Se repiten en la 14.
-- Efecto único al aplicarla: el relleno de `en_servicio_desde` es un UPDATE de todas las filas de `dispositivo` y dispara el disparador de
-- `actualizado_en` (05-convenciones-esquema.sql), así que cambia UNA vez la marca de bloqueo optimista de todos los equipos: un formulario de
-- configuración abierto durante el despliegue recibirá un 409 una vez (recargar). El despliegue reinicia el backend igual.
-- Aditiva: dos columnas NOT NULL con su valor para las filas existentes, en la misma transacción. Reaplicable sin daño: una segunda pasada
-- no toca ningún valor (ni los `en_servicio_desde` que el backend ya movió, ni un plazo que el administrador ya fijó). Convenciones de
-- docs/08 §6: idempotente; nombre ck_; timestamptz; COMMENT ON.
-- Base existente (un contenedor nuevo la aplica solo, desde db/init; antes, un respaldo):
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/26-espera-primera-trama.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── dispositivo.en_servicio_desde ────────────────────────────────────────────────────────────────────────────────────────────────
-- Se agrega sin valor por omisión, se llena con `creado_en` y recién después recibe el DEFAULT y el NOT NULL: así ninguna fila existente
-- queda con la hora de la migración. En una segunda pasada la columna ya existe y no tiene nulos: el UPDATE no toca nada.
ALTER TABLE dispositivo ADD COLUMN IF NOT EXISTS en_servicio_desde timestamptz;
UPDATE dispositivo SET en_servicio_desde = creado_en WHERE en_servicio_desde IS NULL;
ALTER TABLE dispositivo ALTER COLUMN en_servicio_desde SET DEFAULT now();
ALTER TABLE dispositivo ALTER COLUMN en_servicio_desde SET NOT NULL;
COMMENT ON COLUMN dispositivo.en_servicio_desde IS
  'Desde cuándo se espera que el equipo reporte: el alta y cada vuelta a activo desde mantenimiento (lo mueve el backend, PATCH /dispositivos/{id}). De aquí se cuentan el plazo de la primera trama (sitio.espera_primera_trama_h), el silencio que vigila el supervisor y las tramas esperadas de la entrega (migración 26, docs/10 §8.4 punto 68).';

-- ── sitio.espera_primera_trama_h ─────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE sitio ADD COLUMN IF NOT EXISTS espera_primera_trama_h integer NOT NULL DEFAULT 168;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sitio_espera_primera_trama_h' AND conrelid = 'sitio'::regclass) THEN
    ALTER TABLE sitio ADD CONSTRAINT ck_sitio_espera_primera_trama_h CHECK (espera_primera_trama_h BETWEEN 1 AND 2160);
  END IF;
END $$;
COMMENT ON COLUMN sitio.espera_primera_trama_h IS
  'Horas que el sitio espera la primera trama de un equipo desde dispositivo.en_servicio_desde; vencidas, el equipo pasa a «Sin señal» y el supervisor abre sin_comunicacion. De 1 a 2 160, 168 por omisión; lo fija quien administra el sitio, con su evento espera_primera_trama (migración 26, docs/19 §2).';

-- ── Permisos de la aplicación (repetidos en la migración 14, cuyo REVOKE ALL los borraría al reejecutarla) ────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plataforma_app') THEN
    GRANT UPDATE (espera_primera_trama_h) ON sitio TO plataforma_app;
  END IF;
END $$;
COMMIT;
