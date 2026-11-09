-- 22 · Sesión de personas, usuarios y bitácora de accesos (diseño del 12/10/2026: docs/20 §2 a §5; docs/10 §8.4 puntos 36, 41 y 43;
--      implementado el 08/11/2026: M7, HU-18, RF-41, RF-43, RF-44 y RF-46).
--   · usuario: `activo` y `actualizado_en` (con su disparador) existen desde la migración 05 y aquí se aseguran con la misma forma. Se
--     agregan `clave_temporal` (la persona debe cambiarla al entrar) y `clave_temporal_vence_en` (la temporal vale 24 h: docs/20 §4), con
--     un CHECK que las ata: las dos o ninguna. El email es el nombre de inicio de sesión: se guarda en minúsculas y sin espacios (CHECK),
--     así la unicidad de la migración 01 no deja pasar «Ana@x» junto a «ana@x».
--   · usuario_sitio.activo (decidido al implementar, 08/11/2026): quitarle un sitio a una persona es una baja lógica, como en el resto
--     del esquema; la aplicación no tiene DELETE en ninguna tabla (migración 14) y así sigue.
--   · sesion: una fila por sesión abierta. Su `id` es el hash SHA-256 (hexadecimal) del identificador aleatorio que viaja en la cookie:
--     la base nunca guarda lo que autentica (docs/20 §3). Sin `actualizado_en`, a propósito, como estado_dispositivo: la escribe el
--     sistema en cada petición; `ultima_actividad` y `revocada_en` dicen cuándo cambió (docs/08 §6). Índices por usuario (cerrar en todos
--     lados) y por vencimiento (limpieza: fn_limpiar_sesiones, más abajo).
--   · acceso (RF-46): un intento de inicio de sesión o un cierre por fila. Hypertable por `instante` (fragmentos de 7 días) con retención
--     de 90 días por drop_chunks desde RetencionService (RETENCION_ACCESO_DIAS), la misma de la auditoría de operaciones (punto 43). Sin
--     clave foránea a sesion: los intentos fallidos no tienen sesión y las sesiones vencidas se limpian antes que la bitácora.
--   · Permisos de plataforma_app (mínimo privilegio, migración 14): INSERT en usuario, usuario_sitio, sesion y acceso; UPDATE solo en las
--     columnas que el código cambia. Nada de DELETE: la limpieza de sesiones la hace una función del dueño, acotada.
-- Convenciones de docs/08 §6: idempotente; nombres pk_/fk_/uq_/ck_/idx_/trg_/fn_; text con CHECK de largo; timestamptz; COMMENT ON.
-- Base existente (un contenedor nuevo la aplica solo, desde db/init):
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/22-sesion-usuarios.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── usuario ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS actualizado_en timestamptz NOT NULL DEFAULT now();
CREATE OR REPLACE TRIGGER trg_usuario_actualizado_en BEFORE UPDATE ON usuario FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS clave_temporal boolean NOT NULL DEFAULT false;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS clave_temporal_vence_en timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_usuario_clave_temporal' AND conrelid = 'usuario'::regclass) THEN
    ALTER TABLE usuario ADD CONSTRAINT ck_usuario_clave_temporal
      CHECK ((clave_temporal AND clave_temporal_vence_en IS NOT NULL) OR (NOT clave_temporal AND clave_temporal_vence_en IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_usuario_email' AND conrelid = 'usuario'::regclass) THEN
    ALTER TABLE usuario ADD CONSTRAINT ck_usuario_email
      CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_usuario_nombre' AND conrelid = 'usuario'::regclass) THEN
    ALTER TABLE usuario ADD CONSTRAINT ck_usuario_nombre CHECK (char_length(btrim(nombre)) BETWEEN 1 AND 80);
  END IF;
END $$;
COMMENT ON COLUMN usuario.email IS 'Nombre de inicio de sesión: en minúsculas y sin espacios en los bordes (ck_usuario_email); único (docs/20 §2).';
COMMENT ON COLUMN usuario.hash_password IS
  'scrypt de node:crypto con N = 2^17, r = 8, p = 1, sal de 16 bytes: «scrypt$N$r$p$sal$hash» en base64 (docs/20 §4). Nunca la clave.';
COMMENT ON COLUMN usuario.activo IS 'Baja lógica (docs/20 §4): un usuario se desactiva, no se borra; su rastro en evento y acceso lo necesita. Inactivo = no entra y sus sesiones dejan de valer.';
COMMENT ON COLUMN usuario.clave_temporal IS
  'La clave vigente la asignó un administrador (alta o «olvidé mi clave»): la sesión solo sirve para cambiarla (docs/20 §4).';
COMMENT ON COLUMN usuario.clave_temporal_vence_en IS 'Vencimiento de la clave temporal: 24 h después de asignarla (docs/20 §4). Vencida, no abre sesión. Nulo si la clave no es temporal.';

-- ── usuario_sitio ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE usuario_sitio ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN usuario_sitio.activo IS
  'Baja lógica del acceso a un sitio (decidido al implementar, 08/11/2026): falso = el sitio ya no entra en la sesión de la persona. Se reactiva con PATCH /usuarios/{id}.';
COMMENT ON COLUMN usuario_sitio.rol IS 'administrador o consulta (RF-44); la tabla de permisos por acción vive en el backend (sesion/permisos.ts, docs/20 §6).';

-- ── sesion ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sesion (
    id                text NOT NULL CONSTRAINT pk_sesion PRIMARY KEY CONSTRAINT ck_sesion_id CHECK (id ~ '^[0-9a-f]{64}$'),
    usuario_id        uuid NOT NULL CONSTRAINT fk_sesion_usuario REFERENCES usuario(id) ON DELETE CASCADE,
    creada_en         timestamptz NOT NULL DEFAULT now(),
    ultima_actividad  timestamptz NOT NULL DEFAULT now(),
    expira_en         timestamptz NOT NULL,
    revocada_en       timestamptz,
    ip                inet,
    agente            text CONSTRAINT ck_sesion_agente CHECK (char_length(agente) <= 200),
    CONSTRAINT ck_sesion_tiempos CHECK (expira_en > creada_en AND ultima_actividad >= creada_en)
);
CREATE INDEX IF NOT EXISTS idx_sesion_usuario_id ON sesion (usuario_id);
CREATE INDEX IF NOT EXISTS idx_sesion_expira_en ON sesion (expira_en);
COMMENT ON TABLE sesion IS
  'Sesión de una persona en el panel (M7, docs/20 §3): cookie opaca con estado en el servidor. Vence a los 30 min sin actividad o a las 8 h de creada; cerrar la revoca de verdad.';
COMMENT ON COLUMN sesion.id IS 'SHA-256 en hexadecimal del identificador de 32 bytes que viaja en la cookie `sesion`. La base nunca guarda el identificador.';
COMMENT ON COLUMN sesion.ultima_actividad IS 'Última petición con esta sesión; el guardia la renueva como mucho una vez por minuto (acota las escrituras). Con 30 min sin renovarse, la sesión vence.';
COMMENT ON COLUMN sesion.expira_en IS 'Vencimiento absoluto: creada_en + 8 h (docs/20 §3). No se extiende con la actividad.';
COMMENT ON COLUMN sesion.revocada_en IS 'Cierre de sesión (DELETE /sesion), cambio de clave, desactivación del usuario o «cerrar en todos lados». Nulo = no revocada.';
COMMENT ON COLUMN sesion.agente IS 'User-Agent del navegador, acotado a 200 caracteres: solo para que la persona reconozca sus sesiones.';

-- ── acceso (RF-46) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS acceso (
    instante         timestamptz NOT NULL DEFAULT now(),
    usuario_id       uuid CONSTRAINT fk_acceso_usuario REFERENCES usuario(id),
    email_intentado  text CONSTRAINT ck_acceso_email CHECK (char_length(email_intentado) <= 254),
    ip               inet,
    resultado        text NOT NULL CONSTRAINT ck_acceso_resultado CHECK (resultado IN ('ok', 'clave_incorrecta', 'bloqueado', 'inactivo', 'cierre')),
    sesion_id        text CONSTRAINT ck_acceso_sesion CHECK (sesion_id ~ '^[0-9a-f]{64}$')
);
-- Sin los índices por defecto de TimescaleDB (llevarían un nombre fuera de la convención): los dos de aquí cubren el tiempo y la FK.
SELECT create_hypertable('acceso', 'instante', if_not_exists => TRUE, chunk_time_interval => INTERVAL '7 days', create_default_indexes => FALSE);
CREATE INDEX IF NOT EXISTS idx_acceso_instante ON acceso (instante DESC);
CREATE INDEX IF NOT EXISTS idx_acceso_usuario_id ON acceso (usuario_id, instante DESC);
COMMENT ON TABLE acceso IS
  'Bitácora de accesos (RF-46, docs/20 §2): cada intento de inicio de sesión y cada cierre. Solo inserción. Hypertable con retención de 90 días (RETENCION_ACCESO_DIAS).';
COMMENT ON COLUMN acceso.usuario_id IS 'Nulo si el email no corresponde a ningún usuario (el cliente recibe la misma respuesta en los dos casos: docs/20 §4).';
COMMENT ON COLUMN acceso.email_intentado IS 'Lo que se escribió como email, en minúsculas, solo si tiene forma de correo y hasta 254 caracteres; otro texto no se guarda (podría ser una clave pegada en el campo equivocado). Dato personal: 90 días.';
COMMENT ON COLUMN acceso.ip IS 'Dirección completa del cliente (registro de seguridad: distingue atacantes dentro de una misma red). Dato personal: 90 días; a los registros de la aplicación va truncada a /24.';
COMMENT ON COLUMN acceso.resultado IS 'ok, clave_incorrecta (también usuario inexistente o clave temporal vencida), bloqueado (por usuario o por IP), inactivo, cierre.';
COMMENT ON COLUMN acceso.sesion_id IS 'Hash de la sesión abierta (ok) o cerrada (cierre); nulo en los intentos fallidos. Sin clave foránea: la sesión se limpia antes.';

-- ── Limpieza de sesiones vencidas ──────────────────────────────────────────────────────────────────────────────────────────────
-- La aplicación no tiene DELETE (migración 14). Como fn_retencion_drop_chunks, una función del dueño hace esto y nada más: borra
-- sesiones vencidas o revocadas hace más de N días (mínimo 1). La llama RetencionService con el plazo de `acceso`.
CREATE OR REPLACE FUNCTION fn_limpiar_sesiones(dias integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF dias IS NULL OR dias < 1 THEN
    RAISE EXCEPTION 'fn_limpiar_sesiones: % días no es un plazo válido', dias;
  END IF;
  DELETE FROM sesion
   WHERE least(expira_en, coalesce(revocada_en, expira_en), ultima_actividad + INTERVAL '30 minutes') < now() - make_interval(days => dias);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
COMMENT ON FUNCTION fn_limpiar_sesiones(integer) IS
  'Borra sesiones que dejaron de valer hace más de N días (migración 22): la única puerta de la aplicación para borrar en sesion.';
REVOKE ALL ON FUNCTION fn_limpiar_sesiones(integer) FROM PUBLIC;

-- La lista blanca de la retención suma `acceso` (la función es de la migración 14, que también la incluye desde hoy).
CREATE OR REPLACE FUNCTION fn_retencion_drop_chunks(tabla text, dias integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF tabla IS NULL OR tabla NOT IN ('medicion', 'trama', 'cuarentena', 'metrica_broker', 'acceso') THEN
    RAISE EXCEPTION 'fn_retencion_drop_chunks: tabla «%» fuera de la lista blanca', tabla;
  END IF;
  IF dias IS NULL OR dias < 7 OR (tabla = 'medicion' AND dias < 30) THEN
    RAISE EXCEPTION 'fn_retencion_drop_chunks: % días no es un plazo válido para %', dias, tabla;
  END IF;
  SELECT count(*) INTO n FROM drop_chunks(tabla::regclass, older_than => now() - make_interval(days => dias));
  RETURN n;
END $$;
COMMENT ON FUNCTION fn_retencion_drop_chunks(text, integer) IS
  'Única puerta con permiso de dueño para la aplicación: borra fragmentos vencidos de una de cinco hypertables (migraciones 14 y 22, docs/10 §8.4 punto 44).';
REVOKE ALL ON FUNCTION fn_retencion_drop_chunks(text, integer) FROM PUBLIC;

-- ── Permisos de la aplicación (repetidos en la migración 14, cuyo REVOKE ALL los borraría al reejecutarla) ────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plataforma_app') THEN
    GRANT EXECUTE ON FUNCTION fn_retencion_drop_chunks(text, integer) TO plataforma_app;
    GRANT EXECUTE ON FUNCTION fn_limpiar_sesiones(integer) TO plataforma_app;
    GRANT SELECT ON usuario, usuario_sitio, sesion, acceso TO plataforma_app;
    GRANT INSERT ON usuario, usuario_sitio, sesion, acceso TO plataforma_app;
    GRANT UPDATE (nombre, hash_password, activo, clave_temporal, clave_temporal_vence_en) ON usuario TO plataforma_app;
    GRANT UPDATE (rol, activo) ON usuario_sitio TO plataforma_app;
    GRANT UPDATE (ultima_actividad, revocada_en) ON sesion TO plataforma_app;
  END IF;
END $$;
COMMIT;
