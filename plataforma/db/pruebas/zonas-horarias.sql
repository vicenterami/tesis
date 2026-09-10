-- Pruebas de zona horaria (solo lectura, sin datos). Cada fila debe decir OK.
-- Ejecutar: docker compose exec -T timescaledb psql -U plataforma -d plataforma < db/pruebas/zonas-horarias.sql
-- Cubre las reglas de docs/13: día en la zona del sitio, horario de verano, meses, otras zonas, guardia de tipos.
WITH casos(nombre, obtenido, esperado) AS (VALUES
  ('día de Santiago en invierno (UTC-4) empieza 04:00Z',
     time_bucket('1 day', '2026-04-15 12:00Z'::timestamptz, 'America/Santiago')::text, '2026-04-15 04:00:00+00'),
  ('día de Santiago en verano (UTC-3) empieza 03:00Z',
     time_bucket('1 day', '2026-09-15 12:00Z'::timestamptz, 'America/Santiago')::text, '2026-09-15 03:00:00+00'),
  ('23:30 del 4-sep en Santiago pertenece al 4-sep (no al 5 como diría ::date en UTC)',
     (time_bucket('1 day', '2026-09-05 03:30Z'::timestamptz, 'America/Santiago') AT TIME ZONE 'America/Santiago')::date::text, '2026-09-04'),
  ('el domingo del cambio de hora (6-sep-2026) dura 23 h',
     (time_bucket('1 day', '2026-09-07 12:00Z'::timestamptz,'America/Santiago') - time_bucket('1 day', '2026-09-06 12:00Z'::timestamptz,'America/Santiago'))::text, '23:00:00'),
  ('mes de agosto 2026 en Santiago empieza el 1 a las 04:00Z',
     time_bucket('1 month', '2026-08-20 12:00Z'::timestamptz, 'America/Santiago')::text, '2026-08-01 04:00:00+00'),
  ('otra zona con el mismo código: Madrid en verano (UTC+2) empieza el día a las 22:00Z de la víspera',
     time_bucket('1 day', '2026-07-15 12:00Z'::timestamptz, 'Europe/Madrid')::text, '2026-07-14 22:00:00+00'),
  ('iso_utc emite Z y milisegundos',
     iso_utc('2026-09-10 00:50:26.608048+00'::timestamptz), '2026-09-10T00:50:26.608Z'),
  ('guardia: cero columnas timestamp sin zona o time',
     (SELECT count(*)::text FROM information_schema.columns WHERE table_schema='public'
        AND (data_type='timestamp without time zone' OR data_type LIKE 'time %' OR data_type='time without time zone')), '0'),
  ('guardia: toda columna de instante es timestamptz (creado_en, *_en, tiempo, visto_por_ultima_vez)',
     (SELECT count(*)::text FROM information_schema.columns WHERE table_schema='public'
        AND (column_name LIKE '%\_en' OR column_name IN ('tiempo','visto_por_ultima_vez'))
        AND data_type <> 'timestamp with time zone'), '0'),
  ('guardia: todo sitio tiene zona IANA válida',
     (SELECT count(*)::text FROM sitio s WHERE NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = s.zona_horaria)), '0')
)
SELECT CASE WHEN obtenido = esperado THEN 'OK  ' ELSE 'FALLA' END AS resultado, nombre,
       CASE WHEN obtenido = esperado THEN '' ELSE 'obtenido=' || obtenido || ' esperado=' || esperado END AS detalle
FROM casos;
