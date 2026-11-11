-- 24 · Cinco perfiles, baja con motivo, anonimización, preferencias, términos de uso y soporte (diseño del 08/11/2026 y del 11/11/2026:
--      docs/20 §2, §6, §11 y §12; docs/21 §2 y §7; docs/19 §4, P11, P13 y H; docs/10 §8.4 puntos 62 y 64; HU-26 a HU-29 y HU-31;
--      implementado el 11/11/2026).
--   · usuario_sitio.rol: el CHECK ck_usuario_sitio_rol pasa de dos a cuatro valores (administrador, investigador, operador, consulta).
--     `administrador` conserva nombre y significado (de sitio): las filas de hoy siguen valiendo sin migrar datos.
--   · usuario.administrador_sistema: el perfil global (docs/20 §2). Una columna y no una fila por sitio: alcanza también a los sitios
--     creados después. La tabla de permisos vive en el backend (sesion/permisos.ts).
--   · Baja con motivo (conocimiento-portable, baja lógica §2): desactivado_en, desactivado_por y motivo_baja, con un CHECK de coherencia
--     (activo ⇔ sin fecha ni motivo; inactivo ⇔ con fecha y motivo). desactivado_por puede quedar nulo: la clave de administrador por
--     cabecera no es una fila de `usuario`. Las filas inactivas de antes de esta migración reciben un motivo fijo que lo dice.
--   · usuario.anonimizado_en (docs/20 §11): instante de la baja por anonimización; una cuenta anonimizada no se reactiva (CHECK).
--   · Términos (docs/20 §12): terminos_version_aceptada y terminos_aceptados_en, las dos o ninguna. La versión vigente es una constante
--     del backend (legal/terminos.ts, TERMINOS_VERSION).
--   · preferencia (docs/19 §4, H): una fila por persona; la crea el primer PUT /preferencias. Unidades, zona horaria («sitio» o una IANA,
--     validada en el backend contra Intl.supportedValuesOf), tema, tipos de condición con notificación, vistas guardadas y el sitio por
--     defecto. Con actualizado_en y su disparador (bloqueo optimista).
--   · mensaje_soporte (RF-61, HU-31): texto acotado a 2 000 caracteres, quién y cuándo; leido_en lo marcará el administrador del
--     sistema. Índice por (creado_en, id) para la lista por cursor y por usuario_id (la baja los borra).
--   · acceso.id: identificador de cada fila de la bitácora, para la lista de actividad por cursor (instante, id), que mezcla `evento` y
--     `acceso` (docs/19 §4, G). Las filas ya guardadas reciben uno al agregar la columna.
--   · fn_anonimizar_usuario (docs/20 §11; docs/10 §8.4 punto 62): función del dueño, SECURITY DEFINER, como fn_limpiar_sesiones. La baja
--     tiene que borrar las preferencias y los mensajes de soporte de la persona y la aplicación no tiene DELETE en ninguna tabla
--     (migración 14); por eso la anonimización entera vive aquí, en una sola sentencia transaccional, y la aplicación solo la EJECUTA
--     dentro de su transacción, después de verificar la clave y de tomar el candado de los administradores (decidido al implementar).
--     Desde la corrección del 11/11/2026 la función exige `por`, toma ella misma el candado, rechaza la baja del último administrador
--     del sistema activo, y anula el correo tecleado en `acceso` y el `motivo` de los eventos usuario_cambio de esa persona.
--   · Permisos de plataforma_app (mínimo privilegio, migración 14): INSERT en preferencia y mensaje_soporte; UPDATE de las columnas que el
--     código cambia; EXECUTE de fn_anonimizar_usuario. Se repiten en la 14.
-- Convenciones de docs/08 §6: idempotente; nombres pk_/fk_/uq_/ck_/idx_/trg_/fn_; text con CHECK de largo; timestamptz; COMMENT ON.
-- Base existente (un contenedor nuevo la aplica solo, desde db/init):
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/24-perfiles-cuenta-legal.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── usuario_sitio.rol: cuatro perfiles de sitio ──────────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_usuario_sitio_rol' AND conrelid = 'usuario_sitio'::regclass
                  AND pg_get_constraintdef(oid) LIKE '%investigador%') THEN
    ALTER TABLE usuario_sitio DROP CONSTRAINT IF EXISTS ck_usuario_sitio_rol;
    ALTER TABLE usuario_sitio ADD CONSTRAINT ck_usuario_sitio_rol CHECK (rol IN ('administrador', 'investigador', 'operador', 'consulta'));
  END IF;
END $$;
COMMENT ON COLUMN usuario_sitio.rol IS
  'Perfil de la persona en el sitio (docs/20 §2, desde la migración 24): administrador (de sitio), investigador, operador (técnico) o consulta. La tabla de permisos vive en el backend (sesion/permisos.ts, docs/20 §6).';

-- ── usuario: perfil global, baja con motivo, anonimización y términos ───────────────────────────────────────────────────────────
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS administrador_sistema boolean NOT NULL DEFAULT false;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS desactivado_en timestamptz;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS desactivado_por uuid;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS motivo_baja text;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS anonimizado_en timestamptz;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS terminos_version_aceptada integer;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS terminos_aceptados_en timestamptz;
-- Las inactivas de antes no tienen fecha ni motivo: se completan antes del CHECK, con un motivo que dice de dónde salió.
UPDATE usuario SET desactivado_en = actualizado_en, motivo_baja = 'desactivada antes de la migración 24 (sin motivo registrado)'
 WHERE NOT activo AND (desactivado_en IS NULL OR motivo_baja IS NULL);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_usuario_desactivado_por' AND conrelid = 'usuario'::regclass) THEN
    ALTER TABLE usuario ADD CONSTRAINT fk_usuario_desactivado_por FOREIGN KEY (desactivado_por) REFERENCES usuario(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_usuario_motivo_baja' AND conrelid = 'usuario'::regclass) THEN
    ALTER TABLE usuario ADD CONSTRAINT ck_usuario_motivo_baja CHECK (char_length(btrim(motivo_baja)) BETWEEN 1 AND 300);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_usuario_baja' AND conrelid = 'usuario'::regclass) THEN
    ALTER TABLE usuario ADD CONSTRAINT ck_usuario_baja CHECK (
      (activo AND desactivado_en IS NULL AND motivo_baja IS NULL AND desactivado_por IS NULL)
      OR (NOT activo AND desactivado_en IS NOT NULL AND motivo_baja IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_usuario_anonimizado' AND conrelid = 'usuario'::regclass) THEN
    ALTER TABLE usuario ADD CONSTRAINT ck_usuario_anonimizado CHECK (anonimizado_en IS NULL OR (NOT activo AND NOT administrador_sistema));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_usuario_terminos' AND conrelid = 'usuario'::regclass) THEN
    ALTER TABLE usuario ADD CONSTRAINT ck_usuario_terminos CHECK (
      (terminos_version_aceptada IS NULL AND terminos_aceptados_en IS NULL)
      OR (terminos_version_aceptada >= 1 AND terminos_aceptados_en IS NOT NULL));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_usuario_desactivado_por ON usuario (desactivado_por);
COMMENT ON COLUMN usuario.administrador_sistema IS
  'Perfil global (docs/20 §2): usuarios, sitios, límites, estado del sistema y auditoría de todos los sitios. No puede quedar la plataforma sin ninguno si había (409).';
COMMENT ON COLUMN usuario.desactivado_en IS 'Cuándo se desactivó la cuenta; nulo si está activa (ck_usuario_baja). Al reactivar se limpia: el motivo queda en el evento usuario_cambio.';
COMMENT ON COLUMN usuario.desactivado_por IS 'Quién la desactivó; nulo si fue la clave de administrador por cabecera, la propia baja o una baja anterior a la migración 24.';
COMMENT ON COLUMN usuario.motivo_baja IS 'Por qué se desactivó (1 a 300 caracteres), obligatorio al desactivar (PATCH /usuarios/{id}, docs/20 §10).';
COMMENT ON COLUMN usuario.anonimizado_en IS
  'Baja por anonimización (docs/20 §11): sin nombre, correo ni clave; la fila queda para que evento, acceso y la auditoría sigan enlazados. No se reactiva.';
COMMENT ON COLUMN usuario.terminos_version_aceptada IS
  'Versión de los términos de uso que aceptó (docs/20 §12); si es menor que la vigente (TERMINOS_VERSION del backend), la sesión queda restringida.';
COMMENT ON COLUMN usuario.terminos_aceptados_en IS 'Cuándo aceptó esa versión. Se conserva tras la anonimización (docs/21 §2).';

-- ── preferencia (una fila por persona) ───────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS preferencia (
    usuario_id           uuid NOT NULL CONSTRAINT pk_preferencia PRIMARY KEY CONSTRAINT fk_preferencia_usuario REFERENCES usuario(id),
    unidad_temperatura   text NOT NULL DEFAULT 'C' CONSTRAINT ck_preferencia_unidad_temperatura CHECK (unidad_temperatura IN ('C', 'F')),
    unidad_longitud      text NOT NULL DEFAULT 'm' CONSTRAINT ck_preferencia_unidad_longitud CHECK (unidad_longitud IN ('mm', 'm', 'km')),
    zona_horaria         text NOT NULL DEFAULT 'sitio' CONSTRAINT ck_preferencia_zona_horaria CHECK (char_length(zona_horaria) BETWEEN 1 AND 64),
    tema                 text NOT NULL DEFAULT 'sistema' CONSTRAINT ck_preferencia_tema CHECK (tema IN ('sistema', 'claro', 'oscuro')),
    notificar            text[] NOT NULL DEFAULT '{}' CONSTRAINT ck_preferencia_notificar CHECK (cardinality(notificar) <= 10),
    vistas               jsonb NOT NULL DEFAULT '[]' CONSTRAINT ck_preferencia_vistas CHECK (jsonb_typeof(vistas) = 'array' AND pg_column_size(vistas) <= 16384),
    sitio_predeterminado uuid CONSTRAINT fk_preferencia_sitio REFERENCES sitio(id),
    creado_en            timestamptz NOT NULL DEFAULT now(),
    actualizado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_preferencia_sitio_predeterminado ON preferencia (sitio_predeterminado);
CREATE OR REPLACE TRIGGER trg_preferencia_actualizado_en BEFORE UPDATE ON preferencia FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();
COMMENT ON TABLE preferencia IS
  'Preferencias de visualización de una persona (docs/19 §4, H; HU-29, RF-56): la base guarda siempre la unidad estándar; la conversión ocurre solo al mostrar. Se borran con la baja (docs/20 §11).';
COMMENT ON COLUMN preferencia.zona_horaria IS '«sitio» (la del sitio, por defecto) o una zona IANA; la valida el backend contra Intl.supportedValuesOf(''timeZone'').';
COMMENT ON COLUMN preferencia.notificar IS 'Tipos de condición para los que la persona quiere además la notificación del navegador (HU-24); los valida el backend contra ck_condicion_tipo.';
COMMENT ON COLUMN preferencia.vistas IS 'Vistas guardadas [{nombre, pantalla, parametros}] (filtros de P2, rango y resolución de P3), hasta 16 KiB; las valida el backend.';
COMMENT ON COLUMN preferencia.actualizado_en IS 'Bloqueo optimista de PUT /preferencias (docs/10 §8.4 punto 28).';

-- ── mensaje_soporte ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mensaje_soporte (
    id          uuid NOT NULL DEFAULT gen_random_uuid() CONSTRAINT pk_mensaje_soporte PRIMARY KEY,
    usuario_id  uuid NOT NULL CONSTRAINT fk_mensaje_soporte_usuario REFERENCES usuario(id),
    texto       text NOT NULL CONSTRAINT ck_mensaje_soporte_texto CHECK (char_length(btrim(texto)) BETWEEN 1 AND 2000),
    creado_en   timestamptz NOT NULL DEFAULT now(),
    leido_en    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_mensaje_soporte_creado_en_id ON mensaje_soporte (creado_en DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_mensaje_soporte_usuario_id ON mensaje_soporte (usuario_id);
COMMENT ON TABLE mensaje_soporte IS
  'Mensajes del formulario de soporte (RF-61, HU-31; docs/19 §4, P11). Los lee el administrador del sistema. Se conservan mientras exista la cuenta y se borran con su baja (docs/21 §2).';
COMMENT ON COLUMN mensaje_soporte.texto IS 'Texto libre de la persona, 1 a 2 000 caracteres, sin adjuntos. Puede contener datos personales: lo ve solo el administrador del sistema.';
COMMENT ON COLUMN mensaje_soporte.leido_en IS 'Cuándo lo marcó leído el administrador del sistema; nulo = sin leer.';

-- ── acceso.id (lista de actividad por cursor) ────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE acceso ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
COMMENT ON COLUMN acceso.id IS 'Identificador de la fila (migración 24): desempate del cursor (instante, id) de GET /sitios/{id}/actividad. Sin índice propio: la lista filtra por persona (idx_acceso_usuario_id).';

-- ── fn_anonimizar_usuario (docs/20 §11) ──────────────────────────────────────────────────────────────────────────────────────────
-- Una sola sentencia transaccional: nombre y correo pasan a marcadores derivados del id (el correo, en el dominio reservado .invalid:
-- se siguen cumpliendo ck_usuario_email y la unicidad), el hash a un valor que ninguna clave verifica (no tiene la forma scrypt$…),
-- las sesiones se revocan, las membresías quedan inactivas, se borran las preferencias y los mensajes de soporte, se anulan el correo
-- tecleado en sus intentos de acceso y el motivo de baja escrito en sus eventos usuario_cambio (texto libre), y queda la marca.
-- Devuelve el instante, o lanza si la cuenta no existe o ya estaba anonimizada. La clave actual la comprueba el backend; el último
-- administrador del sistema lo comprueban el backend (409 con su mensaje) Y esta función (revisión del 11/11/2026: es SECURITY DEFINER,
-- y una regla que solo vive en quien la llama no protege de otro llamador), con el mismo candado de los administradores.
CREATE OR REPLACE FUNCTION fn_anonimizar_usuario(persona uuid, por uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ahora timestamptz := now(); corto text; viejo text;
BEGIN
  IF persona IS NULL THEN RAISE EXCEPTION 'fn_anonimizar_usuario: falta la persona'; END IF;
  IF por IS NULL THEN RAISE EXCEPTION 'fn_anonimizar_usuario: falta quién da la baja'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('administradores')); -- el mismo candado que el backend (CANDADO_ADMINISTRADORES); reentrante
  IF EXISTS (SELECT 1 FROM usuario WHERE id = persona AND administrador_sistema AND activo)
     AND NOT EXISTS (SELECT 1 FROM usuario WHERE id <> persona AND administrador_sistema AND activo) THEN
    RAISE EXCEPTION 'fn_anonimizar_usuario: es el último administrador del sistema activo' USING ERRCODE = 'check_violation';
  END IF;
  SELECT email INTO viejo FROM usuario WHERE id = persona;
  corto := substr(replace(persona::text, '-', ''), 1, 8);
  UPDATE usuario
     SET nombre = 'Cuenta dada de baja · ' || substr(corto, 1, 4),
         email = 'baja-' || replace(persona::text, '-', '') || '@cuenta-anonimizada.invalid',
         hash_password = 'anonimizada$sin-clave',
         clave_temporal = false, clave_temporal_vence_en = NULL,
         administrador_sistema = false,
         activo = false, desactivado_en = ahora, desactivado_por = por, motivo_baja = 'baja de la cuenta (anonimizada)',
         anonimizado_en = ahora
   WHERE id = persona AND anonimizado_en IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'fn_anonimizar_usuario: la cuenta no existe o ya está anonimizada'; END IF;
  UPDATE sesion SET revocada_en = ahora WHERE usuario_id = persona AND revocada_en IS NULL;
  UPDATE usuario_sitio SET activo = false WHERE usuario_id = persona AND activo;
  DELETE FROM preferencia WHERE usuario_id = persona;
  DELETE FROM mensaje_soporte WHERE usuario_id = persona;
  -- El correo tecleado en sus intentos (la IP y el agente caducan a los 90 días con la fila) y el motivo de sus bajas anteriores, que es
  -- texto libre: el rastro sigue enlazado por el id, sin texto que la identifique.
  UPDATE acceso SET email_intentado = NULL WHERE (usuario_id = persona OR email_intentado = viejo) AND email_intentado IS NOT NULL;
  UPDATE evento SET detalle = jsonb_set(detalle, '{motivo}', 'null'::jsonb)
   WHERE tipo = 'usuario_cambio' AND detalle->>'usuario_id' = persona::text AND detalle->>'motivo' IS NOT NULL;
  RETURN ahora;
END $$;
COMMENT ON FUNCTION fn_anonimizar_usuario(uuid, uuid) IS
  'Baja por anonimización (docs/20 §11, migración 24): la única puerta de la aplicación para borrar en preferencia y mensaje_soporte, y solo las filas de esa persona.';
REVOKE ALL ON FUNCTION fn_anonimizar_usuario(uuid, uuid) FROM PUBLIC;

-- ── Permisos de la aplicación (repetidos en la migración 14, cuyo REVOKE ALL los borraría al reejecutarla) ────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plataforma_app') THEN
    GRANT EXECUTE ON FUNCTION fn_anonimizar_usuario(uuid, uuid) TO plataforma_app;
    GRANT SELECT ON preferencia, mensaje_soporte TO plataforma_app;
    GRANT INSERT ON preferencia, mensaje_soporte TO plataforma_app;
    GRANT UPDATE (unidad_temperatura, unidad_longitud, zona_horaria, tema, notificar, vistas, sitio_predeterminado) ON preferencia TO plataforma_app;
    GRANT UPDATE (leido_en) ON mensaje_soporte TO plataforma_app;
    GRANT UPDATE (administrador_sistema, desactivado_en, desactivado_por, motivo_baja, terminos_version_aceptada, terminos_aceptados_en) ON usuario TO plataforma_app;
  END IF;
END $$;
COMMIT;
