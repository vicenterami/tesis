-- 23 · Tablero v2: retardo de activación, «quién lo hizo» en los eventos e índices de las listas por cursor (diseñado el 11/11/2026:
--      docs/19 §4, bloque «Tablero v2», I; docs/10 §8.4 puntos 58 y 65; RF-14, HU-11, RF-57).
--   · regla_umbral.retardo_s (punto 65 vi; RF-14): la condición de umbral se abre solo cuando la medición lleva al menos ese tiempo fuera
--     de la banda; 0 = como hasta ahora (abre con la primera lectura que cruza). CHECK 0..86400, el mismo tope que valida la API.
--   · regla_umbral.fuera_de_banda_desde: desde cuándo la medición está fuera de la banda sin condición abierta. Vive en la base y no en la
--     memoria del backend para que un reinicio no reinicie la cuenta; la escribe el filtro alertar (nulo = dentro de la banda).
--   · evento.usuario_id (punto 65 v; HU-11): quién hizo el cambio cuando lo hizo una persona con sesión; nulo = el sistema (el pipeline,
--     el supervisor, la retención, o la clave de administrador por cabecera, que no es una fila de `usuario`). Con su índice (docs/08 §6).
--   · Índices de las listas por cursor (punto 58): orden fijo (tiempo, id) descendente y la página siguiente con
--     `WHERE (tiempo, id) < ($1, $2)` y `ORDER BY tiempo DESC, id DESC`: condicion (abierta_en DESC, id DESC), cuarentena (recibido_en
--     DESC, id DESC), evento (dispositivo_id, ocurrido_en DESC, id DESC). El id va en el mismo sentido que el tiempo: con `id` ascendente
--     el índice no sirve al desempate y la base ordena aparte. Los que ya había (cuarentena_recibido_en_idx, idx_evento_dispositivo_id)
--     no llevan el id.
--   · dispositivo.intervalo_esperado_s: CHECK 1..86400 (nadie divide por cero). La API exige 5..86400; la base admite desde 1 porque el
--     banco de pruebas siembra emulados con 1 a 6 s para comprimir el tiempo (emulador semilla: periodo × factor).
--   · fn_quitar_reglas (PUT /canales/{id}/reglas reemplaza las reglas de un canal): la aplicación no tiene DELETE en ninguna tabla
--     (migración 14, docs/08 §6). Como fn_retencion_drop_chunks, una sola función del dueño, SECURITY DEFINER, acotada: borra las reglas de
--     UN canal que no estén en la lista que se conserva, y nada más. Las condiciones de esas reglas las cierra antes la aplicación (con su
--     evento); su regla_id queda nulo (ON DELETE SET NULL) y el umbral vigente sigue en el `detalle` del evento que las abrió.
--   · Permisos de plataforma_app (mínimo privilegio, migración 14): INSERT en regla_umbral; UPDATE en sus columnas configurables y en
--     fuera_de_banda_desde; UPDATE de canal.etiqueta (la edita la misma pantalla); EXECUTE de fn_quitar_reglas. Se repiten en la 14.
-- Convenciones de docs/08 §6: idempotente; nombres pk_/fk_/uq_/ck_/idx_/trg_/fn_; timestamptz; COMMENT ON.
-- Base existente (un contenedor nuevo la aplica solo, desde db/init):
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/23-tablero.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── regla_umbral ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE regla_umbral ADD COLUMN IF NOT EXISTS retardo_s integer NOT NULL DEFAULT 0;
ALTER TABLE regla_umbral ADD COLUMN IF NOT EXISTS fuera_de_banda_desde timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_regla_umbral_retardo_s' AND conrelid = 'regla_umbral'::regclass) THEN
    ALTER TABLE regla_umbral ADD CONSTRAINT ck_regla_umbral_retardo_s CHECK (retardo_s BETWEEN 0 AND 86400);
  END IF;
END $$;
COMMENT ON COLUMN regla_umbral.retardo_s IS
  'Retardo de activación en segundos (RF-14; docs/10 §8.4 punto 65 vi): la condición se abre cuando la medición lleva al menos este tiempo fuera de la banda; 0 = abre con la primera lectura que cruza. La histéresis la cierra.';
COMMENT ON COLUMN regla_umbral.fuera_de_banda_desde IS
  'Desde cuándo la medición está fuera de la banda sin condición abierta; nulo = dentro. La escribe el filtro alertar, en la base para que un reinicio no reinicie la cuenta del retardo.';

-- ── dispositivo.intervalo_esperado_s ─────────────────────────────────────────────────────────────────────────────────────────────
-- El inventario y el supervisor dividen por él: un 0 escrito a mano en la base daba «división por cero» en GET /dispositivos (revisión del
-- 11/11/2026; la consulta además usa NULLIF). Desde 1 y no desde 5, el mínimo de la API (POST y PATCH /dispositivos): la semilla del banco
-- de pruebas usa emulados de 1 a 6 s y con 5 dejaba de sembrar (comprobado el mismo día). El techo, el de la API: un día.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_dispositivo_intervalo_esperado_s' AND conrelid = 'dispositivo'::regclass) THEN
    ALTER TABLE dispositivo ADD CONSTRAINT ck_dispositivo_intervalo_esperado_s CHECK (intervalo_esperado_s BETWEEN 1 AND 86400);
  END IF;
END $$;
COMMENT ON CONSTRAINT ck_dispositivo_intervalo_esperado_s ON dispositivo IS
  'Intervalo esperado entre 1 s y 1 día (la API exige al menos 5; el banco de pruebas siembra emulados más rápidos): el inventario y el supervisor dividen por él (migración 23).';

-- ── evento ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE evento ADD COLUMN IF NOT EXISTS usuario_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_evento_usuario' AND conrelid = 'evento'::regclass) THEN
    ALTER TABLE evento ADD CONSTRAINT fk_evento_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_evento_usuario_id ON evento (usuario_id);
COMMENT ON COLUMN evento.usuario_id IS
  'Quién lo hizo, si fue una persona con sesión (HU-11; docs/10 §8.4 punto 65 v); nulo = el sistema (pipeline, supervisor, retención o la clave de administrador por cabecera). El usuario no se borra: se anonimiza (docs/20 §11).';

-- ── Índices de las listas por cursor (punto 58) ──────────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_condicion_abierta_en_id ON condicion (abierta_en DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_cuarentena_recibido_en_id ON cuarentena (recibido_en DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_evento_dispositivo_ocurrido_en_id ON evento (dispositivo_id, ocurrido_en DESC, id DESC);
COMMENT ON INDEX idx_condicion_abierta_en_id IS 'Keyset de GET /condiciones: orden (abierta_en, id) descendente (docs/10 §8.4 punto 58).';
COMMENT ON INDEX idx_cuarentena_recibido_en_id IS 'Keyset de GET /cuarentena: orden (recibido_en, id) descendente (docs/10 §8.4 punto 58).';
COMMENT ON INDEX idx_evento_dispositivo_ocurrido_en_id IS 'Keyset de GET /dispositivos/{id}/eventos: orden (ocurrido_en, id) descendente por dispositivo (docs/10 §8.4 punto 58).';

-- ── fn_quitar_reglas ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_quitar_reglas(canal uuid, conservar uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF canal IS NULL THEN RAISE EXCEPTION 'fn_quitar_reglas: falta el canal'; END IF;
  DELETE FROM regla_umbral r WHERE r.canal_id = canal AND NOT (r.id = ANY (coalesce(conservar, '{}'::uuid[])));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
COMMENT ON FUNCTION fn_quitar_reglas(uuid, uuid[]) IS
  'Única puerta de borrado de reglas para la aplicación: las de UN canal que no estén en `conservar` (PUT /canales/{id}/reglas; migración 23, docs/10 §8.4 punto 65).';
REVOKE ALL ON FUNCTION fn_quitar_reglas(uuid, uuid[]) FROM PUBLIC;

-- ── Permisos de la aplicación (repetidos en la migración 14, cuyo REVOKE ALL los borraría al reejecutarla) ────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plataforma_app') THEN
    GRANT EXECUTE ON FUNCTION fn_quitar_reglas(uuid, uuid[]) TO plataforma_app;
    GRANT INSERT ON regla_umbral TO plataforma_app;
    GRANT UPDATE (umbral_alto, umbral_bajo, histeresis, retardo_s, fuera_de_banda_desde) ON regla_umbral TO plataforma_app;
    GRANT UPDATE (etiqueta) ON canal TO plataforma_app;
  END IF;
END $$;
COMMIT;
