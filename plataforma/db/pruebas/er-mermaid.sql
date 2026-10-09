-- Genera el diagrama entidad-relacion (Mermaid, notacion crow's foot) desde el esquema REAL.
-- Es la fuente unica del modelo de datos: docs/08 y el informe se generan de aqui
-- (informe-oficial/figuras/generar-figuras.sh). Nunca editar el diagrama a mano.
WITH cols AS (
  SELECT c.table_name, c.column_name, c.ordinal_position,
         CASE c.data_type WHEN 'timestamp with time zone' THEN 'timestamptz' WHEN 'double precision' THEN 'float'
              WHEN 'character varying' THEN 'text' WHEN 'integer' THEN 'int' WHEN 'boolean' THEN 'bool' ELSE c.data_type END AS tipo,
         EXISTS (SELECT 1 FROM information_schema.key_column_usage k JOIN information_schema.table_constraints tc USING (constraint_name, table_schema)
                 WHERE tc.constraint_type='PRIMARY KEY' AND k.table_name=c.table_name AND k.column_name=c.column_name) AS pk,
         EXISTS (SELECT 1 FROM information_schema.key_column_usage k JOIN information_schema.table_constraints tc USING (constraint_name, table_schema)
                 WHERE tc.constraint_type='FOREIGN KEY' AND k.table_name=c.table_name AND k.column_name=c.column_name) AS fk,
         -- Una columna DEPRECADA (su COMMENT lo dice) sigue en la base hasta que una migración la quite: la figura la marca
         -- para que no se lea como una segunda fuente del mismo dato (docs/08 §6).
         coalesce(col_description(('public.' || quote_ident(c.table_name))::regclass, c.ordinal_position::int) LIKE 'DEPRECADA%', false) AS deprecada
  FROM information_schema.columns c WHERE c.table_schema='public'
), rels AS (
  SELECT DISTINCT tc.table_name AS hija, ccu.table_name AS padre
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name
  WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
)
SELECT 'erDiagram'
UNION ALL SELECT '    ' || padre || ' ||--o{ ' || hija || ' : ' || hija FROM rels
UNION ALL SELECT string_agg(l, E'\n') FROM (
  SELECT '    ' || table_name || ' {' || E'\n' ||
         string_agg('        ' || tipo || ' ' || column_name || CASE WHEN pk AND fk THEN ' PK,FK' WHEN pk THEN ' PK' WHEN fk THEN ' FK' ELSE '' END
                    || CASE WHEN deprecada THEN ' "deprecada"' ELSE '' END, E'\n' ORDER BY ordinal_position)
         || E'\n    }' AS l
  FROM cols GROUP BY table_name ORDER BY table_name) s;
