-- Huella de una base para comparar un respaldo con su restauración (docs/10 §9.5; TT-46). Una línea por hecho, en orden estable:
--   tabla <nombre>|<filas>|<suma>   cada tabla de `public`; la suma se calcula fila por fila y no depende del orden
--   agregado, extension, hipertabla, trozos, trabajo, objetos, permisos: lo que TimescaleDB y el esquema deben conservar
-- Dos bases con la misma huella tienen las mismas filas, con el mismo contenido, en las mismas tablas. Solo lee: no cambia nada.
-- La usan `pruebas/respaldar.sh` (sobre la base viva, en la misma instantánea que el volcado) y `pruebas/simulacro-restauracion.sh`
-- (sobre la base restaurada). Uso suelto: psql -X -U <usuario> -d <base> -f db/pruebas/huella-respaldo.sql
\set QUIET on
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
\pset fieldsep '|'

-- El texto de una fila depende de cómo la sesión escribe fechas, números y bytes: se fija aquí, para que la base viva y la restaurada
-- (que no hereda los ajustes de la primera) escriban igual lo que es igual.
SET timezone = 'UTC';
SET datestyle = 'ISO, YMD';
SET intervalstyle = 'postgres';
SET extra_float_digits = 1;
SET bytea_output = 'hex';

-- Una consulta por tabla, generada desde el catálogo (así una tabla nueva entra sola) y ejecutada con \gexec. Los trozos de las
-- hipertablas viven en otro esquema y se leen a través de su tabla madre. La suma toma 64 bits del resumen de cada fila.
SELECT format('SELECT %L, count(*), coalesce(sum((''x'' || substr(md5(t::text), 1, 16))::bit(64)::bigint), 0) FROM %I.%I t',
              'tabla ' || c.relname, n.nspname, c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
 ORDER BY c.relname
\gexec

-- Los agregados continuos son vistas sobre datos materializados en otro esquema: se leen por la vista, igual que una tabla.
SELECT format('SELECT %L, count(*), coalesce(sum((''x'' || substr(md5(t::text), 1, 16))::bit(64)::bigint), 0) FROM %I.%I t',
              'agregado ' || view_name, view_schema, view_name)
  FROM timescaledb_information.continuous_aggregates
 ORDER BY view_schema, view_name
\gexec

SELECT 'extension ' || extname || ' ' || extversion FROM pg_extension ORDER BY extname;

SELECT 'hipertabla ' || h.hypertable_name || ' dimensiones=' || h.num_dimensions || ' compresion=' || h.compression_enabled
    || ' intervalo=' || coalesce((SELECT string_agg(d.time_interval::text, ',' ORDER BY d.dimension_number)
                                    FROM timescaledb_information.dimensions d
                                   WHERE d.hypertable_schema = h.hypertable_schema AND d.hypertable_name = h.hypertable_name), '-')
  FROM timescaledb_information.hypertables h WHERE h.hypertable_schema = 'public' ORDER BY h.hypertable_name;

SELECT 'trozos ' || hypertable_name || ' ' || count(*)
  FROM timescaledb_information.chunks WHERE hypertable_schema = 'public' GROUP BY hypertable_name ORDER BY hypertable_name;

SELECT 'trabajo ' || proc_name || ' ' || coalesce(hypertable_name, '-') || ' cada ' || schedule_interval
  FROM timescaledb_information.jobs ORDER BY proc_name, hypertable_name;

SELECT 'objetos indices=' || (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public')
    || ' restricciones=' || (SELECT count(*) FROM pg_constraint k JOIN pg_namespace n ON n.oid = k.connamespace WHERE n.nspname = 'public')
    || ' funciones=' || (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public')
    || ' disparadores=' || (SELECT count(*) FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                             WHERE n.nspname = 'public' AND NOT g.tgisinternal)
    || ' vistas=' || (SELECT count(*) FROM pg_views WHERE schemaname = 'public')
    || ' valores_por_omision=' || (SELECT count(*) FROM pg_attrdef a JOIN pg_class c ON c.oid = a.adrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                                    WHERE n.nspname = 'public')
    || ' secuencias=' || (SELECT count(*) FROM pg_sequences WHERE schemaname = 'public');

-- Los permisos del rol de la aplicación (mínimo privilegio, docs/10 §8.4 punto 44): si no se restauran, el backend no lee ni escribe.
SELECT 'permisos ' || grantee || ' ' || privilege_type || ' ' || count(*)
  FROM information_schema.role_table_grants WHERE table_schema = 'public'
 GROUP BY grantee, privilege_type ORDER BY grantee, privilege_type;
