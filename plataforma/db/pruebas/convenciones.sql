-- Convenciones del esquema (docs/08 §6) medidas en la base real: una línea OK o FALLA por regla. Solo lectura.
-- Las corre el guardián (paso 1b): docs/08 §6 ya no escribe cifras a mano que nadie recalcula.

-- Toda restricción del esquema público lleva su prefijo: pk_, fk_, uq_ o ck_.
SELECT CASE WHEN count(*) = 0
            THEN 'OK    restricciones con nombre: las ' || (SELECT count(*) FROM pg_constraint c2 JOIN pg_namespace n2 ON n2.oid = c2.connamespace
                                                          WHERE n2.nspname = 'public' AND c2.contype IN ('p', 'f', 'u', 'c')) || ' con prefijo pk_, fk_, uq_ o ck_'
            ELSE 'FALLA restricciones sin el prefijo de la convención: ' || string_agg(c.conrelid::regclass::text || '.' || c.conname, ', ') END
  FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
 WHERE n.nspname = 'public' AND c.contype IN ('p', 'f', 'u', 'c') AND c.conname !~ '^(pk|fk|uq|ck)_';

-- Toda clave foránea tiene un índice que empieza por su columna (Postgres no lo crea solo).
SELECT CASE WHEN count(*) = 0 THEN 'OK    toda clave foránea tiene su índice'
            ELSE 'FALLA claves foráneas sin índice: ' || string_agg(tabla || '.' || col, ', ') END
  FROM (SELECT c.conrelid::regclass::text AS tabla, a.attname AS col
          FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         WHERE n.nspname = 'public' AND c.contype = 'f'
           AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = a.attnum)) x;

-- Toda tabla con actualizado_en tiene su disparador trg_<tabla>_actualizado_en (las de solo inserción y estado_dispositivo
-- no llevan la columna, a propósito: docs/08 §6).
SELECT CASE WHEN count(*) FILTER (WHERE NOT tiene) = 0
            THEN 'OK    las ' || count(*) || ' tablas con actualizado_en tienen su disparador'
            ELSE 'FALLA tablas con actualizado_en sin disparador: ' || string_agg(tabla, ', ') FILTER (WHERE NOT tiene) END
  FROM (SELECT col.table_name AS tabla,
               EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = ('public.' || quote_ident(col.table_name))::regclass
                                                    AND t.tgname = 'trg_' || col.table_name || '_actualizado_en') AS tiene
          FROM information_schema.columns col
         WHERE col.table_schema = 'public' AND col.column_name = 'actualizado_en') x;

-- Índices, disparadores y funciones del proyecto también llevan prefijo (idx_/uq_/pk_, trg_, fn_). Las excepciones van con
-- nombre y motivo, para que no crezcan en silencio: tres objetos anteriores a la convención (migraciones 02, 03 y 04) y uno
-- posterior que se le escapó (09) se renombran en la próxima migración de esquema; los índices que crea TimescaleDB al
-- convertir una tabla en hypertable llevan el nombre que él les pone. (Medido el 09/10: antes no se comprobaba.)
SELECT CASE WHEN count(*) = 0 THEN 'OK    índices con prefijo idx_, uq_ o pk_ (salvo las excepciones escritas aquí)'
            ELSE 'FALLA índices sin prefijo: ' || string_agg(nombre, ', ') END
  FROM (SELECT i.indexrelid::regclass::text AS nombre
          FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
           AND i.indexrelid::regclass::text !~ '^(idx|uq|pk)_'
           AND i.indexrelid::regclass::text NOT IN ('condicion_abierta_unica',  -- 02, anterior a la convención
                 'medicion_tiempo_idx', 'trama_recibido_en_idx', 'cuarentena_recibido_en_idx')) x;  -- de create_hypertable

SELECT CASE WHEN count(*) = 0 THEN 'OK    disparadores con prefijo trg_ (salvo las excepciones escritas aquí)'
            ELSE 'FALLA disparadores sin prefijo trg_: ' || string_agg(nombre, ', ') END
  FROM (SELECT t.tgrelid::regclass::text || '.' || t.tgname AS nombre
          FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgname !~ '^trg_'
           AND t.tgname NOT IN ('sitio_zona_horaria_valida')) x;  -- 03, anterior a la convención

-- Las funciones de las extensiones (pgcrypto, timescaledb) viven en el mismo esquema y no son del proyecto: se excluyen.
SELECT CASE WHEN count(*) = 0 THEN 'OK    funciones del proyecto con prefijo fn_ (salvo las excepciones escritas aquí)'
            ELSE 'FALLA funciones sin prefijo fn_: ' || string_agg(p.proname, ', ') END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname !~ '^fn_'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
   AND p.proname NOT IN ('validar_zona_horaria', 'iso_utc',  -- 03 y 04, anteriores a la convención
                         'payload_legible');                -- 09, se le escapó a la convención

-- Tipos: text (nunca varchar) y timestamptz (nunca timestamp sin zona).
SELECT CASE WHEN count(*) = 0 THEN 'OK    tipos: ninguna columna varchar ni timestamp sin zona'
            ELSE 'FALLA columnas con tipo fuera de la convención: ' || string_agg(table_name || '.' || column_name || ' ' || data_type, ', ') END
  FROM information_schema.columns
 WHERE table_schema = 'public' AND data_type IN ('character varying', 'character', 'timestamp without time zone');
