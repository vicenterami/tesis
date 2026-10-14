-- 14 · Rol de la aplicación con mínimo privilegio (decisión del 13/10/2026: docs/10 §8.4 punto 44, regla R1; docs/11 §4 fila 6 y §9).
-- Hasta aquí el backend entraba como `plataforma`, dueño de todo y superusuario: podía borrar tablas, cambiar el esquema o leer
-- cualquier cosa del servidor de base de datos. Desde esta migración entra como `plataforma_app`, que solo puede LEER, INSERTAR y
-- ACTUALIZAR filas, y cada permiso solo en las tablas donde el código lo usa (contado el 14/10 en backend/src): ni DELETE, ni
-- TRUNCATE, ni DROP, ni ALTER, ni crear nada; UPDATE solo en 5 tablas e INSERT solo en 11. Así `evento`, el registro de lo que
-- pasó (incluidas las corridas de limpieza), y las series (`medicion`, `trama`) no se pueden reescribir: solo agregar. El dueño `plataforma` queda para migraciones y semillas.
--   · La retención usa drop_chunks, que exige ser DUEÑO de la hypertable (verificado: «must be owner of hypertable»). En vez de darle
--     propiedad a la aplicación, una sola función del dueño, SECURITY DEFINER, hace eso y nada más: lista blanca de tablas, mínimo de
--     días (30 para las mediciones, como el backend) y search_path fijo. La aplicación solo puede EJECUTARLA.
--   · El rol se crea con LOGIN y SIN clave: nadie entra hasta que la persona fija la clave con `pruebas/base-rol-app.sh` (lee
--     DB_APP_CLAVE del .env, que escribe la persona). Idempotente.
-- Base existente:
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/14-rol-aplicacion.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plataforma_app') THEN
    CREATE ROLE plataforma_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
-- Si alguna vez se le dio algo de más, se le quita antes de dar lo justo (repetible sin acumular permisos).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM plataforma_app;
REVOKE CREATE ON SCHEMA public FROM plataforma_app;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO plataforma_app', current_database()); END $$;
GRANT USAGE ON SCHEMA public TO plataforma_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO plataforma_app;
GRANT INSERT ON dispositivo, canal, credencial, medicion, trama, cuarentena, evento, condicion, estado_dispositivo,
                metrica_broker, condicion_sistema TO plataforma_app;
GRANT UPDATE ON dispositivo, credencial, condicion, estado_dispositivo, condicion_sistema TO plataforma_app;
-- Las tablas que creen migraciones futuras (siempre las crea el dueño) nacen solo legibles: la migración que las crea dice qué
-- más necesita la aplicación (mínimo privilegio por defecto, no por excepción).
ALTER DEFAULT PRIVILEGES FOR ROLE plataforma IN SCHEMA public REVOKE INSERT, UPDATE ON TABLES FROM plataforma_app;
ALTER DEFAULT PRIVILEGES FOR ROLE plataforma IN SCHEMA public GRANT SELECT ON TABLES TO plataforma_app;

CREATE OR REPLACE FUNCTION fn_retencion_drop_chunks(tabla text, dias integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF tabla IS NULL OR tabla NOT IN ('medicion', 'trama', 'cuarentena', 'metrica_broker') THEN
    RAISE EXCEPTION 'fn_retencion_drop_chunks: tabla «%» fuera de la lista blanca', tabla;
  END IF;
  -- Mínimos fuera del alcance del backend: 30 días las mediciones, 7 lo demás (un backend comprometido no puede borrar la última
  -- semana de diagnóstico, que es justo la que serviría para investigarlo).
  IF dias IS NULL OR dias < 7 OR (tabla = 'medicion' AND dias < 30) THEN
    RAISE EXCEPTION 'fn_retencion_drop_chunks: % días no es un plazo válido para %', dias, tabla;
  END IF;
  SELECT count(*) INTO n FROM drop_chunks(tabla::regclass, older_than => now() - make_interval(days => dias));
  RETURN n;
END $$;
COMMENT ON FUNCTION fn_retencion_drop_chunks(text, integer) IS
  'Única puerta con permiso de dueño para la aplicación: borra fragmentos vencidos de una de cuatro hypertables (migración 14, docs/10 §8.4 punto 44).';
REVOKE ALL ON FUNCTION fn_retencion_drop_chunks(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_retencion_drop_chunks(text, integer) TO plataforma_app;

COMMIT;
