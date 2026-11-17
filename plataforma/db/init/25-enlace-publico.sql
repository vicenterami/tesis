-- 25 · Vista pública por enlace (diseño del 16/11/2026: docs/19 §4, O, puntos 4 y 8; docs/20 §2 y §7; docs/21 §2; RF-62, HU-32;
--      implementado el 17/11/2026, la parte de la base y del backend).
--   · enlace_publico: lo que un administrador de sitio publica. El token aleatorio de 32 bytes viaja solo en la dirección que se comparte;
--     la base guarda su resumen SHA-256 en hexadecimal (`token_hash`, índice único), como la sesión (migración 22): nunca lo que da acceso.
--     Las magnitudes publicadas (códigos del catálogo, de 1 a 12; el backend las valida contra `magnitud`), la ventana máxima de la lista
--     cerrada (24h, 7d, 30d), las zonas publicadas con el nombre que tenían al publicar ([{id, nombre}], hasta 20; vacío = sin desglose),
--     el mínimo de dispositivos k (1 a 20; el valor por omisión y el piso los fija el despliegue), el título (1 a 80) y la descripción
--     (hasta 300) públicos, quién lo creó y cuándo, cuándo vence (obligatorio: todo enlace vence), la última renovación, y cuándo se revocó
--     y por quién. Un CHECK impide que el vencimiento pase de 180 días desde la creación o la última renovación (el plazo más largo de la
--     lista; el máximo del despliegue, PUBLICO_VENCIMIENTO_MAX_DIAS, puede ser menor y lo aplica el backend). `creado_por` y `revocado_por`
--     pueden quedar nulos: la clave de administrador por cabecera no es una fila de `usuario`. Un disparador (trg_enlace_publico_tiempos;
--     revisión del 17/11/2026) protege el registro: una revocación no se deshace ni se cambia, creado_en, renovado_en y revocado_en no
--     pueden quedar en el futuro (con la hora del reloj, clock_timestamp()), y un enlace revocado o anonimizado no cambia su vencimiento.
--   · Retención (decidido el 17/11/2026): pasados `retencion_dias` desde que el enlace dejó de valer (venció o se revocó, lo que pasó
--     primero), su título, su descripción y los nombres de zona publicados se anonimizan (fn_anonimizar_enlaces_publicos, desde
--     RetencionService) y queda `anonimizado_en`; la fila sigue, para que la actividad del sitio conserve quién publicó qué y cuándo. El
--     plazo lo elige el administrador del sitio al publicar: 90 días por omisión, de 31 (más que los 30 en que aún se puede renovar) a 365.
--   · enlace_publico_acceso: cuántas veces se cargó la pantalla de cada enlace, por día en la zona horaria del sitio. Sin direcciones ni
--     identificador de quien visita (docs/21 §2). El backend cuenta en memoria y vuelca una vez por minuto sumando (INSERT … ON CONFLICT).
--     Las filas de más de 90 días las borra fn_limpiar_accesos_publicos, desde RetencionService.
--   · Permisos de plataforma_app (mínimo privilegio, migración 14): SELECT e INSERT en las dos tablas; UPDATE solo de lo que el código
--     cambia (renovar y revocar; sumar la cuenta); EXECUTE de la función de limpieza. Nada de DELETE. Se repiten en la 14.
--   · dispositivo_zona (decidido el 17/11/2026, tras la tercera revisión): en qué zona estuvo cada dispositivo y desde cuándo, una fila por
--     estadía, la abierta con `hasta` nulo. La llena un disparador (SECURITY DEFINER) al crear un dispositivo y al cambiarle la zona (o el
--     sitio, que va con la zona); la aplicación no la escribe. La vista pública atribuye cada lectura a la zona donde estaba el equipo
--     cuando se tomó: mover un equipo no cambia el pasado de ninguna zona ni del total (docs/19 §4, O, punto 2). Las estadías de un equipo
--     no se solapan (EXCLUDE con btree_gist) y la historia no se borra en cascada (ON DELETE RESTRICT: borrar un dispositivo o una zona con
--     historia exige borrar antes su historia, a propósito). Reemplaza a dispositivo.zona_desde, de una versión anterior de esta migración,
--     que se quita (con su disparador) si existe.
--   · sitio.publico_minimo_dispositivos (decidido el 17/11/2026, tras la tercera revisión): k es del sitio, no del enlace; lo fija su
--     administrador (1 a 20); nulo = PUBLICO_MINIMO_DISPOSITIVOS. Empieza nulo en todos los sitios (falla cerrado: no se copia el k de
--     ningún enlace, que podría ser el de uno vencido o muerto; bajarlo es decisión del administrador, con su evento).
--     enlace_publico.minimo_dispositivos queda DEPRECADA (sin uso, admite nulo; no se borra para no perder lo que se eligió).
--   · sitio.enlaces_publicos_max (decidido el 17/11/2026): cuántos enlaces vivos admite el sitio, lo fija su administrador dentro del techo
--     del despliegue (PUBLICO_MAX_ENLACES_TECHO, lo comprueba el backend); nulo = el valor por omisión (PUBLICO_MAX_ENLACES_POR_SITIO). La
--     aplicación puede cambiar esa columna y ninguna otra de `sitio`.
-- Aditiva: no borra ni cambia nada de las migraciones anteriores; a `sitio` le suma dos columnas que admiten nulo; activa la extensión
-- btree_gist (de PostgreSQL). Reaplicable sobre una base con cualquiera de las versiones anteriores de esta misma migración. Convenciones de docs/08 §6: idempotente; nombres pk_/fk_/uq_/ck_/idx_/fn_; text con CHECK de
-- largo; timestamptz; COMMENT ON.
-- Base existente (un contenedor nuevo la aplica solo, desde db/init):
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/25-enlace-publico.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── enlace_publico ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enlace_publico (
    id                   uuid NOT NULL DEFAULT gen_random_uuid() CONSTRAINT pk_enlace_publico PRIMARY KEY,
    sitio_id             uuid NOT NULL CONSTRAINT fk_enlace_publico_sitio REFERENCES sitio(id),
    token_hash           text NOT NULL CONSTRAINT ck_enlace_publico_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    magnitudes           text[] NOT NULL CONSTRAINT ck_enlace_publico_magnitudes
                           CHECK (cardinality(magnitudes) BETWEEN 1 AND 12 AND array_position(magnitudes, NULL) IS NULL),
    ventana_maxima       text NOT NULL CONSTRAINT ck_enlace_publico_ventana_maxima CHECK (ventana_maxima IN ('24h', '7d', '30d')),
    zonas                jsonb NOT NULL DEFAULT '[]' CONSTRAINT ck_enlace_publico_zonas
                           CHECK (jsonb_typeof(zonas) = 'array' AND jsonb_array_length(zonas) <= 20),
    minimo_dispositivos  smallint NOT NULL CONSTRAINT ck_enlace_publico_minimo_dispositivos CHECK (minimo_dispositivos BETWEEN 1 AND 20),
    titulo               text NOT NULL CONSTRAINT ck_enlace_publico_titulo CHECK (char_length(btrim(titulo)) BETWEEN 1 AND 80),
    descripcion          text CONSTRAINT ck_enlace_publico_descripcion CHECK (char_length(descripcion) <= 300),
    creado_por           uuid CONSTRAINT fk_enlace_publico_creado_por REFERENCES usuario(id),
    creado_en            timestamptz NOT NULL DEFAULT now(),
    expira_en            timestamptz NOT NULL,
    renovado_en          timestamptz,
    revocado_en          timestamptz,
    revocado_por         uuid CONSTRAINT fk_enlace_publico_revocado_por REFERENCES usuario(id),
    retencion_dias       smallint NOT NULL DEFAULT 90 CONSTRAINT ck_enlace_publico_retencion_dias CHECK (retencion_dias BETWEEN 31 AND 365),
    anonimizado_en       timestamptz,
    CONSTRAINT ck_enlace_publico_vencimiento
      CHECK (expira_en > creado_en AND expira_en <= coalesce(renovado_en, creado_en) + INTERVAL '180 days'),
    CONSTRAINT ck_enlace_publico_revocado CHECK (revocado_por IS NULL OR revocado_en IS NOT NULL)
);
-- Reaplicable sobre una base con una versión anterior de esta migración: lo agregado después se suma aquí, y el CHECK de k se amplía a 20.
ALTER TABLE enlace_publico ADD COLUMN IF NOT EXISTS retencion_dias smallint NOT NULL DEFAULT 90;
ALTER TABLE enlace_publico ADD COLUMN IF NOT EXISTS anonimizado_en timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_enlace_publico_retencion_dias' AND conrelid = 'enlace_publico'::regclass) THEN
    ALTER TABLE enlace_publico ADD CONSTRAINT ck_enlace_publico_retencion_dias CHECK (retencion_dias BETWEEN 31 AND 365);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_enlace_publico_minimo_dispositivos' AND conrelid = 'enlace_publico'::regclass
                  AND pg_get_constraintdef(oid) LIKE '%20%') THEN
    ALTER TABLE enlace_publico DROP CONSTRAINT IF EXISTS ck_enlace_publico_minimo_dispositivos;
    ALTER TABLE enlace_publico ADD CONSTRAINT ck_enlace_publico_minimo_dispositivos CHECK (minimo_dispositivos BETWEEN 1 AND 20);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_enlace_publico_token_hash ON enlace_publico (token_hash);
CREATE INDEX IF NOT EXISTS idx_enlace_publico_sitio_id ON enlace_publico (sitio_id);
CREATE INDEX IF NOT EXISTS idx_enlace_publico_creado_por ON enlace_publico (creado_por);
CREATE INDEX IF NOT EXISTS idx_enlace_publico_revocado_por ON enlace_publico (revocado_por);
COMMENT ON TABLE enlace_publico IS
  'Vista pública por enlace (RF-62, HU-32; docs/19 §4, O): solo promedios de lo publicado; un valor de menos de k dispositivos sale oculto al servir. Todo enlace vence; se renueva sin cambiar el token y se revoca (migración 25).';
COMMENT ON COLUMN enlace_publico.token_hash IS 'SHA-256 en hexadecimal del token de 32 bytes que viaja en la dirección compartida (…/panel/#/v/<token>). La base nunca guarda el token.';
COMMENT ON COLUMN enlace_publico.magnitudes IS 'Códigos del catálogo `magnitud` publicados, en el orden en que se muestran (1 a 12); los valida el backend.';
COMMENT ON COLUMN enlace_publico.ventana_maxima IS 'La ventana más larga que puede pedir quien visita: 24h, 7d o 30d (lista cerrada; nunca fechas libres).';
COMMENT ON COLUMN enlace_publico.zonas IS 'Desglose por zona fijado al publicar: [{id, nombre}] con el nombre que la zona tenía entonces (una zona renombrada conserva el publicado). Vacío = sin desglose.';
ALTER TABLE enlace_publico ALTER COLUMN minimo_dispositivos DROP NOT NULL;
COMMENT ON COLUMN enlace_publico.minimo_dispositivos IS 'DEPRECADA (17/11/2026): k es del sitio (sitio.publico_minimo_dispositivos). Queda el valor que se eligió en los enlaces creados antes; los nuevos la dejan nula.';
COMMENT ON COLUMN enlace_publico.titulo IS 'Título público (1 a 80 caracteres): lo ve cualquiera con el enlace; la pantalla pide escribirlo sin nombres de personas ni datos personales.';
COMMENT ON COLUMN enlace_publico.descripcion IS 'Descripción pública (hasta 300 caracteres), con el mismo aviso que el título. Nula = sin descripción.';
COMMENT ON COLUMN enlace_publico.creado_por IS 'Quién lo publicó; nulo si fue la clave de administrador por cabecera.';
COMMENT ON COLUMN enlace_publico.expira_en IS 'Vencimiento obligatorio: al crear o renovar, ahora + 7, 30, 90 o 180 días, sin pasar PUBLICO_VENCIMIENTO_MAX_DIAS. Vencido, el enlace responde 404 como uno inexistente.';
COMMENT ON COLUMN enlace_publico.renovado_en IS 'Última renovación (el token no cambia). Nula si nunca se renovó.';
COMMENT ON COLUMN enlace_publico.revocado_en IS 'Revocación: corta en la petición siguiente y no se deshace. Nula = no revocado.';
COMMENT ON COLUMN enlace_publico.retencion_dias IS 'Días que se conservan título, descripción y nombres de zona después de que el enlace deja de valer (31 a 365; 90 por omisión): los elige el administrador del sitio al publicar.';
COMMENT ON COLUMN enlace_publico.anonimizado_en IS 'Cuándo fn_anonimizar_enlaces_publicos reemplazó título, descripción y nombres de zona; nulo mientras se conservan.';
COMMENT ON COLUMN enlace_publico.revocado_por IS 'Quién lo revocó; nulo si fue la clave de administrador por cabecera o si no está revocado.';

-- El registro del enlace no se reescribe (docs/19 §4, O, «Decidido al implementar»): ni siquiera el dueño, por error, deshace una revocación
-- o fecha algo en el futuro. «En el futuro» se mide con la hora del reloj (clock_timestamp) y unos segundos de margen, no con la del inicio
-- de la transacción: si no, renovar y revocar a la vez chocarían con la hora que escribió la otra (tercera revisión del 17/11/2026).
CREATE OR REPLACE FUNCTION fn_enlace_publico_tiempos() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.revocado_en IS NOT NULL
     AND (NEW.revocado_en IS DISTINCT FROM OLD.revocado_en OR NEW.revocado_por IS DISTINCT FROM OLD.revocado_por) THEN
    RAISE EXCEPTION 'enlace_publico: una revocación no se deshace ni se cambia (enlace %)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.revocado_en IS NOT NULL OR OLD.anonimizado_en IS NOT NULL)
     AND (NEW.expira_en IS DISTINCT FROM OLD.expira_en OR NEW.renovado_en IS DISTINCT FROM OLD.renovado_en) THEN
    RAISE EXCEPTION 'enlace_publico: un enlace revocado o anonimizado no cambia su vencimiento ni su renovación (enlace %)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.creado_en > clock_timestamp() + INTERVAL '5 seconds' OR NEW.renovado_en > clock_timestamp() + INTERVAL '5 seconds'
     OR NEW.revocado_en > clock_timestamp() + INTERVAL '5 seconds' THEN
    RAISE EXCEPTION 'enlace_publico: creado_en, renovado_en y revocado_en no pueden quedar en el futuro (enlace %)', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  -- Segunda revisión del 17/11/2026: un enlace nace ahora (no con una fecha de creación inventada), y una revocación nueva se fecha en el
  -- último minuto (no en el pasado, que la haría parecer anterior a lo que ya se sirvió).
  IF TG_OP = 'INSERT' AND NEW.creado_en < now() - INTERVAL '1 minute' THEN
    RAISE EXCEPTION 'enlace_publico: creado_en debe ser la hora de la creación (enlace %)', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.revocado_en IS NULL AND NEW.revocado_en IS NOT NULL AND NEW.revocado_en < now() - INTERVAL '1 minute' THEN
    RAISE EXCEPTION 'enlace_publico: una revocación se fecha en el momento en que se hace (enlace %)', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION fn_enlace_publico_tiempos() IS
  'Disparador de enlace_publico (migración 25): una revocación no se deshace ni se cambia y se fecha al hacerla; creado_en es la hora de la creación; nada queda en el futuro; un enlace revocado o anonimizado no cambia su vencimiento.';
CREATE OR REPLACE TRIGGER trg_enlace_publico_tiempos BEFORE INSERT OR UPDATE ON enlace_publico FOR EACH ROW EXECUTE FUNCTION fn_enlace_publico_tiempos();

-- ── En qué zona estuvo cada dispositivo, y desde cuándo (decidido el 17/11/2026, tras la tercera revisión; docs/19 §4, O, punto 2) ─────
-- Una fila por estadía; la abierta, con `hasta` nulo (una sola por dispositivo). Cada lectura cuenta en la zona donde estaba el equipo cuando
-- se tomó: mover un equipo no cambia el pasado de ninguna zona ni del total (si siguiera a la zona actual, comparar la serie de antes y la
-- de después lo despejaría). La primera estadía empieza en -infinity: toda la historia previa es de la zona en que se creó.
CREATE TABLE IF NOT EXISTS dispositivo_zona (
    dispositivo_id  uuid NOT NULL CONSTRAINT fk_dispositivo_zona_dispositivo REFERENCES dispositivo(id) ON DELETE RESTRICT,
    zona_id         uuid NOT NULL CONSTRAINT fk_dispositivo_zona_zona REFERENCES zona(id) ON DELETE RESTRICT,
    desde           timestamptz NOT NULL,
    hasta           timestamptz,
    CONSTRAINT pk_dispositivo_zona PRIMARY KEY (dispositivo_id, desde),
    CONSTRAINT ck_dispositivo_zona_intervalo CHECK (hasta IS NULL OR hasta > desde)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispositivo_zona_abierta ON dispositivo_zona (dispositivo_id) WHERE hasta IS NULL;
-- Revisión final del 17/11/2026. (1) La historia no se borra en cascada: la versión anterior de esta migración tenía ON DELETE CASCADE;
-- se cambia a RESTRICT si hace falta (reaplicable). La aplicación no borra dispositivos ni zonas (las bajas son de estado); los guiones de
-- prueba y la semilla borran la historia antes. (2) Las estadías de un equipo no se solapan: una lectura cae en a lo más una.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT * FROM (VALUES ('fk_dispositivo_zona_dispositivo', 'dispositivo_id', 'dispositivo'), ('fk_dispositivo_zona_zona', 'zona_id', 'zona')) v(nombre, columna, tabla)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = f.nombre AND conrelid = 'dispositivo_zona'::regclass AND confdeltype <> 'r') THEN
      EXECUTE format('ALTER TABLE dispositivo_zona DROP CONSTRAINT %I', f.nombre);
      EXECUTE format('ALTER TABLE dispositivo_zona ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE RESTRICT', f.nombre, f.columna, f.tabla);
    END IF;
  END LOOP;
END $$;
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_dispositivo_zona_sin_solape' AND conrelid = 'dispositivo_zona'::regclass) THEN
    ALTER TABLE dispositivo_zona ADD CONSTRAINT uq_dispositivo_zona_sin_solape
      EXCLUDE USING gist (dispositivo_id WITH =, tstzrange(desde, hasta) WITH &&);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_dispositivo_zona_zona_id ON dispositivo_zona (zona_id);
COMMENT ON TABLE dispositivo_zona IS
  'En qué zona estuvo cada dispositivo y desde cuándo (migración 25): la llena trg_dispositivo_zona_historia; la vista pública atribuye cada lectura a la zona donde se tomó. La aplicación no la escribe.';
COMMENT ON COLUMN dispositivo_zona.desde IS 'Inicio de la estadía en la zona; -infinity en la primera (toda la historia previa).';
COMMENT ON COLUMN dispositivo_zona.hasta IS 'Fin de la estadía (cuando cambió de zona); nulo = la zona actual.';
-- La hora del cambio es la del reloj (clock_timestamp()), no la del inicio de la transacción (revisión final del 17/11/2026): una
-- transacción larga no fecha el cambio antes de hacerlo. Un segundo cambio en la MISMA transacción (la estadía abierta la escribió esta
-- transacción: su xmin es el de esta) solo corrige su zona. Límite: una fila escrita dentro de un SAVEPOINT lleva el xid de la
-- subtransacción, así que ahí el segundo cambio cierra la estadía y abre otra (queda una estadía de microsegundos sin lecturas; el CHECK
-- y el EXCLUDE se cumplen y nada se cuenta dos veces). Dos transacciones que mueven el mismo equipo se ordenan por el candado de la
-- fila de `dispositivo`, y el cierre nunca queda antes del inicio (greatest), así que el CHECK y el EXCLUDE se cumplen.
CREATE OR REPLACE FUNCTION fn_dispositivo_zona_historia() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ahora timestamptz := clock_timestamp();
  cierre timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO dispositivo_zona (dispositivo_id, zona_id, desde) VALUES (NEW.id, NEW.zona_id, '-infinity') ON CONFLICT DO NOTHING;
  ELSIF NEW.zona_id IS DISTINCT FROM OLD.zona_id THEN
    UPDATE dispositivo_zona SET zona_id = NEW.zona_id
     WHERE dispositivo_id = NEW.id AND hasta IS NULL AND xmin = pg_current_xact_id()::xid;
    IF NOT FOUND THEN
      UPDATE dispositivo_zona SET hasta = greatest(ahora, desde + INTERVAL '1 microsecond')
       WHERE dispositivo_id = NEW.id AND hasta IS NULL RETURNING hasta INTO cierre;
      INSERT INTO dispositivo_zona (dispositivo_id, zona_id, desde) VALUES (NEW.id, NEW.zona_id, coalesce(cierre, ahora));
    END IF;
  END IF;
  RETURN NULL;
END $$;
COMMENT ON FUNCTION fn_dispositivo_zona_historia() IS
  'Disparador de dispositivo (migración 25): abre la primera estadía al crear y, al cambiar zona_id, cierra la abierta y abre otra a la hora del reloj (un segundo cambio en la misma transacción solo corrige la zona). La única puerta para escribir dispositivo_zona.';
REVOKE ALL ON FUNCTION fn_dispositivo_zona_historia() FROM PUBLIC;
CREATE OR REPLACE TRIGGER trg_dispositivo_zona_historia AFTER INSERT OR UPDATE OF zona_id ON dispositivo FOR EACH ROW EXECUTE FUNCTION fn_dispositivo_zona_historia();
-- Relleno (reaplicable: solo los dispositivos que aún no tienen historia). Una base con la versión anterior de esta migración tiene
-- `dispositivo.zona_desde`, la hora del último cambio de zona: ese equipo entra con su zona actual desde esa hora, y sus lecturas de antes
-- siguen sin contar en ninguna zona, como hasta ahora (la zona de donde venía no se guardaba; si contaran en la actual, comparar la vista de
-- antes y la de después de migrar las despejaría). El resto, con su zona actual desde -infinity: un cambio de zona anterior a esta
-- migración no quedó guardado en ninguna parte.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dispositivo' AND column_name = 'zona_desde') THEN
    EXECUTE $q$INSERT INTO dispositivo_zona (dispositivo_id, zona_id, desde)
               SELECT d.id, d.zona_id, d.zona_desde FROM dispositivo d
                WHERE d.zona_desde > '-infinity' AND NOT EXISTS (SELECT 1 FROM dispositivo_zona x WHERE x.dispositivo_id = d.id)$q$;
  END IF;
END $$;
INSERT INTO dispositivo_zona (dispositivo_id, zona_id, desde)
SELECT d.id, d.zona_id, '-infinity' FROM dispositivo d WHERE NOT EXISTS (SELECT 1 FROM dispositivo_zona x WHERE x.dispositivo_id = d.id);
-- La marca de una versión anterior de esta migración, reemplazada por la historia: se quita si existe (era derivada, sin datos propios).
DROP TRIGGER IF EXISTS trg_dispositivo_zona_desde ON dispositivo;
DROP FUNCTION IF EXISTS fn_dispositivo_zona_desde();
ALTER TABLE dispositivo DROP COLUMN IF EXISTS zona_desde;

-- ── El tope de enlaces de cada sitio ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE sitio ADD COLUMN IF NOT EXISTS enlaces_publicos_max smallint;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sitio_enlaces_publicos_max' AND conrelid = 'sitio'::regclass) THEN
    ALTER TABLE sitio ADD CONSTRAINT ck_sitio_enlaces_publicos_max CHECK (enlaces_publicos_max BETWEEN 1 AND 1000);
  END IF;
END $$;
COMMENT ON COLUMN sitio.enlaces_publicos_max IS
  'Cuántos enlaces públicos vivos (no revocados, vigentes o aún renovables) admite el sitio; lo fija su administrador dentro de PUBLICO_MAX_ENLACES_TECHO. Nulo = PUBLICO_MAX_ENLACES_POR_SITIO.';

-- ── k de la vista pública, por sitio (decidido el 17/11/2026, tras la tercera revisión; docs/19 §4, O, punto 2) ───────────────────────
ALTER TABLE sitio ADD COLUMN IF NOT EXISTS publico_minimo_dispositivos smallint;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sitio_publico_minimo_dispositivos' AND conrelid = 'sitio'::regclass) THEN
    ALTER TABLE sitio ADD CONSTRAINT ck_sitio_publico_minimo_dispositivos CHECK (publico_minimo_dispositivos BETWEEN 1 AND 20);
  END IF;
END $$;
-- Empieza nulo (rige PUBLICO_MINIMO_DISPOSITIVOS): falla cerrado (revisión final del 17/11/2026). No se copia el k de los enlaces: el
-- menor de los no revocados podía ser el de uno vencido, muerto o anonimizado, y habría publicado hacia atrás sin rastro; bajarlo es
-- decisión del administrador (PUT /sitios/{id}/enlaces/minimo, con su evento `enlace_minimo`). Una base con la versión anterior de esta
-- migración, que sí lo copiaba: un k que nadie fijó (sin evento `enlace_minimo` del sitio) y menor que el de omisión del diseño (3) vuelve
-- a nulo; uno mayor se conserva, porque oculta más (bajarlo sin rastro sería lo mismo que se corrige). Reaplicable. Supone que `evento`
-- no se purga (docs/21: hoy no se borra), y el 3 espeja K_RECOMENDADO de backend/src/publico/publico.ts.
UPDATE sitio s SET publico_minimo_dispositivos = NULL
 WHERE s.publico_minimo_dispositivos < 3
   AND NOT EXISTS (SELECT 1 FROM evento e WHERE e.tipo = 'enlace_minimo' AND e.detalle->>'sitio_id' = s.id::text);
COMMENT ON COLUMN sitio.publico_minimo_dispositivos IS
  'k de la vista pública del sitio (1 a 20): un valor se publica solo si lo aportan al menos k dispositivos, en todos sus enlaces. Lo fija su administrador; nulo = PUBLICO_MINIMO_DISPOSITIVOS; al servir, nunca menos que el piso del despliegue.';

-- ── enlace_publico_acceso ────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enlace_publico_acceso (
    enlace_id  uuid NOT NULL CONSTRAINT fk_enlace_publico_acceso_enlace REFERENCES enlace_publico(id),
    dia        date NOT NULL,
    cuenta     integer NOT NULL CONSTRAINT ck_enlace_publico_acceso_cuenta CHECK (cuenta >= 0),
    CONSTRAINT pk_enlace_publico_acceso PRIMARY KEY (enlace_id, dia)
);
COMMENT ON TABLE enlace_publico_acceso IS
  'Cargas de la pantalla de cada enlace público por día (docs/19 §4, O, punto 8): sin direcciones ni identificador de quien visita. Se borra a los 90 días (fn_limpiar_accesos_publicos).';
COMMENT ON COLUMN enlace_publico_acceso.dia IS 'Día en la zona horaria del sitio del enlace.';
COMMENT ON COLUMN enlace_publico_acceso.cuenta IS 'Cargas de la pantalla ese día (no cada refresco). El backend suma lo contado en memoria una vez por minuto.';

-- ── Limpieza del contador ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- La aplicación no tiene DELETE (migración 14). Como fn_limpiar_sesiones, una función del dueño hace esto y nada más: borra las filas del
-- contador de más de N días (mínimo 7). La llama RetencionService con 90. El día de cada fila es el del sitio; se compara con el día UTC
-- (no con current_date, que depende de la zona de la sesión): la diferencia con la zona de un sitio es de menos de un día.
CREATE OR REPLACE FUNCTION fn_limpiar_accesos_publicos(dias integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF dias IS NULL OR dias < 7 THEN
    RAISE EXCEPTION 'fn_limpiar_accesos_publicos: % días no es un plazo válido', dias;
  END IF;
  DELETE FROM enlace_publico_acceso WHERE dia < (now() AT TIME ZONE 'UTC')::date - dias;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
COMMENT ON FUNCTION fn_limpiar_accesos_publicos(integer) IS
  'Borra las filas del contador de accesos públicos de más de N días (migración 25): la única puerta de la aplicación para borrar en enlace_publico_acceso.';
REVOKE ALL ON FUNCTION fn_limpiar_accesos_publicos(integer) FROM PUBLIC;

-- ── Retención del texto de los enlaces que ya no valen (decidido el 17/11/2026) ─────────────────────────────────────────────────
-- La aplicación no puede cambiar título, descripción ni zonas (sus permisos de UPDATE no los incluyen): lo hace esta función del dueño, y
-- nada más. Un enlace de más de `retencion_dias` desde que dejó de valer queda con un título fijo, sin descripción y con sus zonas como
-- «Zona 1», «Zona 2»…; la fila sigue (la actividad del sitio la nombra). Idempotente: uno ya anonimizado no se toca. La llama RetencionService.
CREATE OR REPLACE FUNCTION fn_anonimizar_enlaces_publicos() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE enlace_publico e
     SET titulo = 'Enlace retirado', descripcion = NULL, anonimizado_en = now(),
         zonas = (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.z->>'id', 'nombre', 'Zona ' || a.o) ORDER BY a.o), '[]'::jsonb)
                    FROM jsonb_array_elements(e.zonas) WITH ORDINALITY AS a(z, o))
   WHERE e.anonimizado_en IS NULL
     AND least(e.expira_en, coalesce(e.revocado_en, e.expira_en)) + make_interval(days => e.retencion_dias) < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
COMMENT ON FUNCTION fn_anonimizar_enlaces_publicos() IS
  'Anonimiza título, descripción y nombres de zona de los enlaces que dejaron de valer hace más de retencion_dias (migración 25): la única puerta para cambiar ese texto.';
REVOKE ALL ON FUNCTION fn_anonimizar_enlaces_publicos() FROM PUBLIC;

-- ── Permisos de la aplicación (repetidos en la migración 14, cuyo REVOKE ALL los borraría al reejecutarla) ────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plataforma_app') THEN
    GRANT EXECUTE ON FUNCTION fn_limpiar_accesos_publicos(integer) TO plataforma_app;
    GRANT EXECUTE ON FUNCTION fn_anonimizar_enlaces_publicos() TO plataforma_app;
    GRANT SELECT ON enlace_publico, enlace_publico_acceso TO plataforma_app;
    -- INSERT solo en las columnas que escribe el código (segunda revisión del 17/11/2026): ni creado_en, ni revocado_*, ni anonimizado_en.
    REVOKE INSERT ON enlace_publico FROM plataforma_app;
    GRANT INSERT (sitio_id, token_hash, magnitudes, ventana_maxima, zonas, titulo, descripcion, creado_por, expira_en, retencion_dias) ON enlace_publico TO plataforma_app;
    GRANT INSERT ON enlace_publico_acceso TO plataforma_app;
    GRANT UPDATE (expira_en, renovado_en, revocado_en, revocado_por) ON enlace_publico TO plataforma_app;
    GRANT UPDATE (cuenta) ON enlace_publico_acceso TO plataforma_app;
    GRANT UPDATE (enlaces_publicos_max, publico_minimo_dispositivos) ON sitio TO plataforma_app;
    GRANT SELECT ON dispositivo_zona TO plataforma_app;
  END IF;
END $$;
COMMIT;
