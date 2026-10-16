-- Migración 05. Convenciones del esquema (docs/08 §6), idempotente:
--   a) toda restricción con nombre explícito y prefijo (pk_, fk_, uq_, ck_); los nombres que
--      Postgres inventa (tabla_col_fkey) no dicen qué protegen ni se pueden citar en un informe;
--   b) un índice por cada clave foránea: Postgres no lo crea solo y sin él cada JOIN y cada
--      ON DELETE recorre la tabla completa;
--   c) auditoría mínima: actualizado_en con disparador en toda tabla mutable;
--   d) baja lógica (activo) en sitio y usuario, como ya tenía dispositivo con su estado;
--   e) COMMENT ON en las columnas cuya razón de ser no es obvia: el comentario viaja con la base;
--   f) catálogo: magnitudes de material particulado (sensores del primer nodo del compañero).
-- Base existente: docker compose exec -T timescaledb psql -U plataforma -d plataforma < db/init/05-convenciones-esquema.sql

-- a) renombrar restricciones autogeneradas a la convención. Solo las que no llevan prefijo (las que nombró Postgres): un nombre
--    con prefijo lo eligió una migración y otras lo buscan por él. Hasta el 16/10/2026 se renombraba también ese, y reaplicar la 05
--    después de la 08, 13, 15 y 16 cambiaba sus nombres y esas migraciones, al no encontrarlos, duplicaban la restricción
--    (lo encontró banco.sh migraciones; docs/16 §37).
DO $$
DECLARE r record; nuevo text;
BEGIN
  FOR r IN
    SELECT c.oid, c.conname, c.contype, c.conrelid::regclass::text AS tabla,
           (SELECT string_agg(a.attname, '_' ORDER BY k.ord)
              FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = 'public' AND c.contype IN ('p','f','u','c') AND c.conname !~ '^(pk|fk|uq|ck)_'
  LOOP
    nuevo := CASE r.contype
      WHEN 'p' THEN 'pk_' || r.tabla
      WHEN 'f' THEN 'fk_' || r.tabla || '_' || regexp_replace(r.cols, '_(id|codigo)$', '')
      WHEN 'u' THEN 'uq_' || r.tabla || '_' || r.cols
      WHEN 'c' THEN 'ck_' || r.tabla || '_' || coalesce(r.cols, 'regla') END;
    IF r.conname <> nuevo AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = nuevo) THEN
      EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', r.tabla, r.conname, nuevo);
    END IF;
  END LOOP;
END $$;

-- b) índice por cada clave foránea que no lo tenga
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tabla, a.attname AS col
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE n.nspname = 'public' AND c.contype = 'f'
       AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = a.attnum)
  LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (%I)', 'idx_' || r.tabla || '_' || r.col, r.tabla, r.col);
  END LOOP;
END $$;

-- c) auditoría: actualizado_en + disparador en tablas mutables (no en las de solo inserción)
CREATE OR REPLACE FUNCTION fn_set_actualizado_en() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.actualizado_en := now(); RETURN NEW; END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sitio','zona','dispositivo','canal','credencial','magnitud','regla_umbral','usuario','usuario_sitio']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS actualizado_en timestamptz NOT NULL DEFAULT now()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_actualizado_en ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_actualizado_en BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en()', t, t);
  END LOOP;
END $$;

-- d) baja lógica
ALTER TABLE sitio   ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;

-- e) documentación en el modelo (lo no obvio)
COMMENT ON COLUMN medicion.unidad IS 'FOTO de la unidad canónica al momento de guardar. Se copia desde magnitud.unidad_canonica: cambiar el catálogo no reinterpreta mediciones ya guardadas.';
COMMENT ON COLUMN medicion.tiempo IS 'Instante (UTC). Es la marca del emisor si es plausible (>= 2000, <= ahora + 2 min); si no, la hora de recepción. Ver docs/13.';
COMMENT ON COLUMN dispositivo.visto_por_ultima_vez IS 'Derivado: última trama aceptada por el pipeline. Lo actualiza el filtro 5; el supervisor periódico lo compara con intervalo_esperado_s.';
COMMENT ON COLUMN dispositivo.estado IS 'Dominio cerrado interpretado por el código (activo/mantenimiento/baja): por eso es CHECK y no catálogo. baja = baja lógica, nunca DELETE.';
COMMENT ON COLUMN condicion.cerrada_en IS 'NULL = condición abierta. El índice único parcial impide dos abiertas del mismo tipo y regla por dispositivo.';
COMMENT ON COLUMN condicion.regla_id IS 'Procedencia: qué regla disparó la condición. El valor del umbral en ese momento está en evento.detalle (foto), no aquí.';
COMMENT ON COLUMN evento.detalle IS 'FOTO en JSON de los valores al ocurrir el evento (valor, umbral, unidad). Solo reproduce; para consultar se usan las FK.';
COMMENT ON COLUMN cuarentena.payload_crudo IS 'Trama tal como llegó (bytes), sin interpretar. Evidencia para diagnóstico; nunca se reprocesa automáticamente.';
COMMENT ON COLUMN sitio.zona_horaria IS 'Nombre IANA (America/Santiago). Toda pregunta de "día" se responde en esta zona dentro de la base (docs/13).';
COMMENT ON TABLE credencial IS 'Solo el hash. La credencial en claro se muestra una vez al dar de alta; se rota, no se recupera.';

-- f) catálogo: material particulado (µg/m³ en SenML: ug/m3)
INSERT INTO magnitud (codigo, nombre, unidad_canonica, rango_min, rango_max) VALUES
    ('pm2_5', 'Material particulado fino (PM2,5)',  'ug/m3', 0, 1000),
    ('pm10',  'Material particulado grueso (PM10)', 'ug/m3', 0, 2000)
ON CONFLICT (codigo) DO NOTHING;
