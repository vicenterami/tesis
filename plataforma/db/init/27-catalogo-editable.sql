-- 27 · Catálogo editable: rango cierto y sugeridos en la magnitud, alias de claves y recetas de decodificación declarativas (TT-12;
--      diseñado el 20/11/2026: docs/08 §8, docs/10 §8.4 punto 69, docs/19 §4 bloque T y docs/20 §6).
--   · magnitud: umbral_alto_sugerido y umbral_bajo_sugerido (nulos: sin umbral de ese lado) e histeresis_sugerida (≥ 0, 0 por omisión),
--     dentro del rango y con bajo < alto. El rango pasa a ser obligatorio, finito y con rango_min < rango_max (hoy un NaN pasaría y el
--     filtro 3 aceptaría cualquier valor; las 10 sembradas en las migraciones 01, 05, 17 y 18 traen los dos extremos). El código de una
--     magnitud nueva, con la forma ^[a-z][a-z0-9_]{0,39}$ (las 10 sembradas ya la cumplen). La unidad canónica sale de una lista cerrada
--     del backend, no de aquí.
--   · magnitud_alias: «clave del JSON decodificado → magnitud» para los formatos de pasarela (milesight y chirpstack). La clave primaria
--     garantiza que una clave apunte a una sola magnitud en todo el catálogo; en minúsculas, con forma acotada y sin las claves que esos
--     formatos usan para otra cosa. Sembrada con las 8 del código (mapa-claves.ts).
--   · receta_decodificacion y receta_campo: lo que la migración 17 llamaba «perfil de decodificación», ahora como dato y no como código
--     (una receta que se ejecutara sería ejecución remota en manos de quien edita el catálogo). valor = (crudo + sumar_antes) ×
--     multiplicar_por ÷ dividir_por, de izquierda a derecha; los tres int4, nunca numeric ni bigint (node-postgres los entrega como texto
--     y 143 + '200' concatena). Cada campo copia largo_bytes por una clave foránea compuesta (el recurso de la migración 15) para que un
--     CHECK asegure que cabe en la trama. Escritura única: una receta no se edita ni se borra; corregirla es crear la -v2 y «reemplazar
--     por». Sembrada: campus-heltec-v3-v1, la misma decodificación que hoy hace el código (perfiles.ts).
--   · dispositivo.decodificador: el CHECK contra la lista del código (migración 17) pasa a ser clave foránea a la receta, ON DELETE
--     RESTRICT. La receta se siembra ANTES del cambio, y el bloque de la 17 que redefinía el CHECK corre solo si esta clave no existe.
--   · Permisos de plataforma_app (mínimo privilegio, migración 14; se repiten allí, cuyo REVOKE ALL los borraría al reejecutarla):
--     INSERT de magnitud y de magnitud_alias por columnas; UPDATE de magnitud solo en nombre, rango y sugeridos (nunca codigo ni
--     unidad_canonica); ningún INSERT directo en las recetas y ningún DELETE. Lo demás, por dos funciones del dueño, SECURITY DEFINER y
--     acotadas como fn_quitar_reglas (migración 23): fn_crear_receta (la receta con sus campos, juntos y una sola vez) y fn_quitar_alias.
--   · Quién cambió el catálogo: un evento catalogo_cambio con dispositivo_id nulo, que escribe la aplicación en la misma transacción
--     (evento.tipo no tiene CHECK; nada que cambiar aquí).
-- Aditiva y reaplicable sin daño (la comprueba `banco.sh migraciones`). Convenciones de docs/08 §6: idempotente; nombres
-- pk_/fk_/uq_/ck_/idx_/fn_; timestamptz; COMMENT ON.
-- Base existente (un contenedor nuevo la aplica solo, desde db/init; antes, un respaldo):
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/27-catalogo-editable.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── magnitud: rango cierto, forma del código y sugeridos ──────────────────────────────────────────────────────────────────────────
ALTER TABLE magnitud ADD COLUMN IF NOT EXISTS umbral_alto_sugerido double precision;
ALTER TABLE magnitud ADD COLUMN IF NOT EXISTS umbral_bajo_sugerido double precision;
ALTER TABLE magnitud ADD COLUMN IF NOT EXISTS histeresis_sugerida double precision NOT NULL DEFAULT 0;
DO $$ BEGIN
  -- 'NaN' es mayor que todo número en PostgreSQL: se excluye aparte, además de los infinitos.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_magnitud_rango' AND conrelid = 'magnitud'::regclass) THEN
    ALTER TABLE magnitud ADD CONSTRAINT ck_magnitud_rango CHECK (
      rango_min IS NOT NULL AND rango_max IS NOT NULL
      AND rango_min <> 'NaN' AND rango_max <> 'NaN'
      AND rango_min > '-Infinity' AND rango_max < 'Infinity'
      AND rango_min < rango_max);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_magnitud_codigo' AND conrelid = 'magnitud'::regclass) THEN
    ALTER TABLE magnitud ADD CONSTRAINT ck_magnitud_codigo CHECK (codigo ~ '^[a-z][a-z0-9_]{0,39}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_magnitud_sugeridos' AND conrelid = 'magnitud'::regclass) THEN
    ALTER TABLE magnitud ADD CONSTRAINT ck_magnitud_sugeridos CHECK (
      (umbral_alto_sugerido IS NULL OR (umbral_alto_sugerido <> 'NaN' AND umbral_alto_sugerido BETWEEN rango_min AND rango_max))
      AND (umbral_bajo_sugerido IS NULL OR (umbral_bajo_sugerido <> 'NaN' AND umbral_bajo_sugerido BETWEEN rango_min AND rango_max))
      AND (umbral_alto_sugerido IS NULL OR umbral_bajo_sugerido IS NULL OR umbral_bajo_sugerido < umbral_alto_sugerido));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_magnitud_histeresis_sugerida' AND conrelid = 'magnitud'::regclass) THEN
    ALTER TABLE magnitud ADD CONSTRAINT ck_magnitud_histeresis_sugerida CHECK (
      histeresis_sugerida <> 'NaN' AND histeresis_sugerida >= 0 AND histeresis_sugerida < 'Infinity');
  END IF;
END $$;
COMMENT ON COLUMN magnitud.umbral_alto_sugerido IS
  'Umbral alto sugerido para los canales de esta magnitud; nulo = sin sugerido de ese lado. No crea reglas: «Usar el sugerido» lo copia al editor de reglas del canal (P6). Dentro del rango (migración 27, docs/10 §8.4 punto 69 iv).';
COMMENT ON COLUMN magnitud.umbral_bajo_sugerido IS
  'Umbral bajo sugerido; nulo = sin sugerido de ese lado; menor que el alto si los dos existen. Dentro del rango (migración 27, docs/10 §8.4 punto 69 iv).';
COMMENT ON COLUMN magnitud.histeresis_sugerida IS
  'Histéresis sugerida (≥ 0, 0 por omisión), en la unidad canónica: la condición de restauración que acompaña a los umbrales sugeridos (migración 27).';

-- ── magnitud_alias ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS magnitud_alias (
  clave           text        CONSTRAINT pk_magnitud_alias PRIMARY KEY,
  magnitud_codigo text        NOT NULL CONSTRAINT fk_magnitud_alias_magnitud REFERENCES magnitud (codigo) ON DELETE CASCADE,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_magnitud_alias_clave CHECK (clave ~ '^[a-z0-9_.-]{1,64}$'),
  CONSTRAINT ck_magnitud_alias_reservada CHECK (clave NOT IN ('deveui', 'devicename', 'applicationid', 'applicationname', 'fcnt', 'fport',
                                                              'data', 'time', 'rxinfo', 'txinfo', 'deviceinfo', 'object'))
);
CREATE INDEX IF NOT EXISTS idx_magnitud_alias_magnitud_codigo ON magnitud_alias (magnitud_codigo);
COMMENT ON TABLE magnitud_alias IS
  'Alias de claves del JSON decodificado por la pasarela (formatos milesight y chirpstack) hacia una magnitud del catálogo; una clave, una sola magnitud. Se leen con cada trama, sin memoria (migración 27, docs/10 §8.4 punto 69 v). Quitar uno: fn_quitar_alias.';
COMMENT ON COLUMN magnitud_alias.clave IS
  'La clave tal como llega, en minúsculas (^[a-z0-9_.-]{1,64}$), sin las reservadas de los formatos de pasarela.';
INSERT INTO magnitud_alias (clave, magnitud_codigo) VALUES
    ('temperature', 'temperatura'), ('temperatura', 'temperatura'),
    ('humidity', 'humedad'),        ('humedad', 'humedad'),
    ('battery', 'bateria'),         ('bateria', 'bateria'),
    ('pressure', 'presion'),        ('presion', 'presion')
ON CONFLICT (clave) DO NOTHING;

-- ── receta_decodificacion y receta_campo ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS receta_decodificacion (
  codigo      text        CONSTRAINT pk_receta_decodificacion PRIMARY KEY,
  nombre      text        NOT NULL,
  largo_bytes integer     NOT NULL,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_receta_decodificacion_codigo CHECK (codigo ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  CONSTRAINT ck_receta_decodificacion_nombre CHECK (length(btrim(nombre)) BETWEEN 1 AND 120),
  CONSTRAINT ck_receta_decodificacion_largo_bytes CHECK (largo_bytes BETWEEN 1 AND 255),
  -- Destino de la clave foránea compuesta de receta_campo (el largo viaja con cada campo).
  CONSTRAINT uq_receta_decodificacion_codigo_largo UNIQUE (codigo, largo_bytes)
);
COMMENT ON TABLE receta_decodificacion IS
  'Receta de decodificación: cómo leer la data en base64 de un nodo LoRaWAN cuando su pasarela la entrega sin decodificar. Solo dato (sin expresiones); escritura única: no se edita ni se borra, se crea la -v2 y se usa «reemplazar por» (migración 27, docs/10 §8.4 punto 69 vi y vii). Se crea solo por fn_crear_receta.';
COMMENT ON COLUMN receta_decodificacion.largo_bytes IS
  'Largo exacto de la trama en bytes (1 a 255): una trama de otro largo es malformada.';

CREATE TABLE IF NOT EXISTS receta_campo (
  receta_codigo   text    NOT NULL,
  largo_bytes     integer NOT NULL,
  orden           integer NOT NULL,
  magnitud_codigo text    NOT NULL CONSTRAINT fk_receta_campo_magnitud REFERENCES magnitud (codigo),
  desplazamiento  integer NOT NULL,
  tipo            text    NOT NULL,
  sumar_antes     integer NOT NULL DEFAULT 0,
  multiplicar_por integer NOT NULL DEFAULT 1,
  dividir_por     integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_receta_campo PRIMARY KEY (receta_codigo, orden),
  CONSTRAINT uq_receta_campo_magnitud UNIQUE (receta_codigo, magnitud_codigo),
  CONSTRAINT fk_receta_campo_receta FOREIGN KEY (receta_codigo, largo_bytes)
    REFERENCES receta_decodificacion (codigo, largo_bytes),
  CONSTRAINT ck_receta_campo_orden CHECK (orden BETWEEN 1 AND 32),
  CONSTRAINT ck_receta_campo_tipo CHECK (tipo IN ('u8', 'i8', 'u16be', 'u16le', 'i16be', 'i16le', 'u32be', 'u32le', 'i32be', 'i32le')),
  CONSTRAINT ck_receta_campo_cabe CHECK (desplazamiento >= 0 AND desplazamiento
    + CASE WHEN tipo IN ('u8', 'i8') THEN 1 WHEN tipo IN ('u16be', 'u16le', 'i16be', 'i16le') THEN 2 ELSE 4 END <= largo_bytes),
  CONSTRAINT ck_receta_campo_factores CHECK (sumar_antes BETWEEN -1000000 AND 1000000
    AND multiplicar_por BETWEEN 1 AND 1000000 AND dividir_por BETWEEN 1 AND 1000000)
);
CREATE INDEX IF NOT EXISTS idx_receta_campo_magnitud_codigo ON receta_campo (magnitud_codigo);
COMMENT ON TABLE receta_campo IS
  'Un campo de una receta: valor = (crudo + sumar_antes) × multiplicar_por ÷ dividir_por, de izquierda a derecha, en la unidad canónica de su magnitud. Cada campo cabe en largo_bytes (copiado de la receta por clave foránea compuesta); a lo más 32 por receta y una vez cada magnitud (migración 27).';
COMMENT ON COLUMN receta_campo.tipo IS
  'Entero que se lee en desplazamiento: u = sin signo, i = con signo; 8, 16 o 32 bits; be/le = orden big-endian o little-endian.';

-- ── fn_crear_receta y fn_quitar_alias: las dos puertas del dueño ───────────────────────────────────────────────────────────────────
-- campos: arreglo JSON de objetos {magnitud_codigo, desplazamiento, tipo, sumar_antes?, multiplicar_por?, dividir_por?}; el orden es el
-- del arreglo. La receta y sus campos se insertan en una sola transacción (la del que llama): un código repetido da unique_violation
-- (23505) y cualquier campo fuera de sus CHECK aborta todo. Devuelve cuántos campos guardó.
-- Antes de insertar, la forma de cada campo: un objeto con solo esas seis claves, textos donde van textos y enteros donde van números.
-- Una clave mal escrita («dividir_pro») no se ignora: tomaría el valor por omisión y, como la receta no se edita, quedaría mal para
-- siempre (revisión del 23/11/2026). Todo rechazo de forma sale como check_violation con el prefijo «fn_crear_receta:».
CREATE OR REPLACE FUNCTION fn_crear_receta(codigo text, nombre text, largo_bytes integer, campos jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer; e jsonb; k text; x numeric; i integer := 0;
BEGIN
  IF campos IS NULL OR jsonb_typeof(campos) <> 'array' OR jsonb_array_length(campos) NOT BETWEEN 1 AND 32 THEN
    RAISE EXCEPTION 'fn_crear_receta: una receta lleva de 1 a 32 campos' USING ERRCODE = 'check_violation';
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(campos) LOOP
    i := i + 1;
    IF jsonb_typeof(e) <> 'object' THEN
      RAISE EXCEPTION 'fn_crear_receta: el campo % no es un objeto', i USING ERRCODE = 'check_violation';
    END IF;
    SELECT min(c) INTO k FROM jsonb_object_keys(e) AS c
     WHERE c NOT IN ('magnitud_codigo', 'desplazamiento', 'tipo', 'sumar_antes', 'multiplicar_por', 'dividir_por');
    IF k IS NOT NULL THEN
      RAISE EXCEPTION 'fn_crear_receta: el campo % trae una clave desconocida: %', i, k USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(e->'magnitud_codigo') IS DISTINCT FROM 'string' OR jsonb_typeof(e->'tipo') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'fn_crear_receta: el campo % necesita magnitud_codigo y tipo como texto', i USING ERRCODE = 'check_violation';
    END IF;
    FOREACH k IN ARRAY ARRAY['desplazamiento', 'sumar_antes', 'multiplicar_por', 'dividir_por'] LOOP
      CONTINUE WHEN k <> 'desplazamiento' AND NOT e ? k;
      IF jsonb_typeof(e->k) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'fn_crear_receta: el campo % necesita % como número', i, k USING ERRCODE = 'check_violation';
      END IF;
      x := (e->>k)::numeric;
      IF x <> trunc(x) OR abs(x) > 1000000 THEN
        RAISE EXCEPTION 'fn_crear_receta: el campo % necesita % entero, de −1000000 a 1000000', i, k USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END LOOP;
  INSERT INTO receta_decodificacion (codigo, nombre, largo_bytes) VALUES (codigo, nombre, largo_bytes);
  INSERT INTO receta_campo (receta_codigo, largo_bytes, orden, magnitud_codigo, desplazamiento, tipo, sumar_antes, multiplicar_por, dividir_por)
  SELECT fn_crear_receta.codigo, fn_crear_receta.largo_bytes, c.orden::integer, c.e->>'magnitud_codigo', (c.e->>'desplazamiento')::integer,
         c.e->>'tipo', coalesce((c.e->>'sumar_antes')::integer, 0), coalesce((c.e->>'multiplicar_por')::integer, 1),
         coalesce((c.e->>'dividir_por')::integer, 1)
    FROM jsonb_array_elements(campos) WITH ORDINALITY AS c(e, orden);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
COMMENT ON FUNCTION fn_crear_receta(text, text, integer, jsonb) IS
  'Única puerta de alta de recetas para la aplicación: la receta y sus 1 a 32 campos, juntos y una sola vez (migración 27, docs/10 §8.4 punto 69 vii).';
REVOKE ALL ON FUNCTION fn_crear_receta(text, text, integer, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION fn_quitar_alias(clave text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF clave IS NULL THEN RAISE EXCEPTION 'fn_quitar_alias: falta la clave'; END IF;
  DELETE FROM magnitud_alias a WHERE a.clave = fn_quitar_alias.clave;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
COMMENT ON FUNCTION fn_quitar_alias(text) IS
  'Única puerta de borrado de alias para la aplicación: uno, por su clave (migración 27, docs/10 §8.4 punto 69 v y ix).';
REVOKE ALL ON FUNCTION fn_quitar_alias(text) FROM PUBLIC;

-- ── Receta sembrada (antes de la clave foránea de dispositivo) ────────────────────────────────────────────────────────────────────
-- Nodos de la red del campus, 10 bytes: temperatura i16be en el byte 5, ÷ 100; humedad u16be en el 7, ÷ 100; tensión u8 en el 9,
-- + 200, ÷ 100 (captura del 15/10: 02 00 00 00 8f 07 18 19 98 af → 18,16 °C; 65,52 %; 3,75 V). Bytes 0 a 4: identificador y secuencia.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM receta_decodificacion WHERE codigo = 'campus-heltec-v3-v1') THEN
    PERFORM fn_crear_receta('campus-heltec-v3-v1', 'Nodos Heltec V3 de la red del campus', 10, '[
      {"magnitud_codigo": "temperatura", "desplazamiento": 5, "tipo": "i16be", "dividir_por": 100},
      {"magnitud_codigo": "humedad",     "desplazamiento": 7, "tipo": "u16be", "dividir_por": 100},
      {"magnitud_codigo": "tension",     "desplazamiento": 9, "tipo": "u8",    "sumar_antes": 200, "dividir_por": 100}
    ]'::jsonb);
  END IF;
END $$;

-- ── dispositivo.decodificador: del CHECK de la lista del código a la clave foránea ───────────────────────────────────────────────
ALTER TABLE dispositivo DROP CONSTRAINT IF EXISTS ck_dispositivo_decodificador;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_dispositivo_decodificador' AND conrelid = 'dispositivo'::regclass) THEN
    ALTER TABLE dispositivo ADD CONSTRAINT fk_dispositivo_decodificador FOREIGN KEY (decodificador)
      REFERENCES receta_decodificacion (codigo) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_dispositivo_decodificador ON dispositivo (decodificador) WHERE decodificador IS NOT NULL;
COMMENT ON COLUMN dispositivo.decodificador IS
  'Receta con que la plataforma decodifica la data en base64 de un nodo LoRaWAN cuando su pasarela la entrega sin decodificar; nulo = sin receta. Clave foránea a receta_decodificacion desde la migración 27 (antes, CHECK contra la lista del código, migración 17); solo en la vía lorawan (ck_dispositivo_decodificador_via).';

-- ── Permisos de la aplicación (repetidos en la migración 14, cuyo REVOKE ALL los borraría al reejecutarla) ────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plataforma_app') THEN
    GRANT INSERT (codigo, nombre, unidad_canonica, rango_min, rango_max, umbral_alto_sugerido, umbral_bajo_sugerido, histeresis_sugerida)
      ON magnitud TO plataforma_app;
    GRANT UPDATE (nombre, rango_min, rango_max, umbral_alto_sugerido, umbral_bajo_sugerido, histeresis_sugerida) ON magnitud TO plataforma_app;
    GRANT INSERT (clave, magnitud_codigo) ON magnitud_alias TO plataforma_app;
    GRANT EXECUTE ON FUNCTION fn_crear_receta(text, text, integer, jsonb) TO plataforma_app;
    GRANT EXECUTE ON FUNCTION fn_quitar_alias(text) TO plataforma_app;
  END IF;
END $$;
COMMIT;
