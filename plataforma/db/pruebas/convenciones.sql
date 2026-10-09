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
