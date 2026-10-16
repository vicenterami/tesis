-- 17 · Perfil de decodificación del nodo, contador de trama y magnitud «tension» (decidido el 16/10/2026: docs/10 §8.4 punto 47 y §4.1).
--   · dispositivo.decodificador: el perfil con que la plataforma decodifica la `data` en base64 de un nodo LoRaWAN cuando su pasarela
--     la entrega sin decodificar (la UG65 del campus publica así). Nulo = sin perfil. Dominio cerrado contra la lista que implementa el
--     código (PERFILES en recepcion/adaptadores/perfiles.ts; una prueba unitaria compara las dos listas) y solo en la vía lorawan.
--   · estado_dispositivo.ultimo_fcnt: el contador de la última trama LoRaWAN guardada del nodo (32 bits sin signo en el servidor de
--     red). El filtro 3 descarta la trama que repite ese contador; uno menor se acepta (el nodo se volvió a unir a la red).
--   · magnitud tension (V, de 0 a 5): la tensión de batería que reportan esos nodos. Pasarla a porcentaje exigiría una curva de
--     descarga que nadie ha declarado.
-- Idempotente. En una base existente (un contenedor nuevo la aplica solo, desde db/init):
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/17-decodificador-y-fcnt.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

-- a) Perfil de decodificación. La última migración que define la lista la reemplaza (como ck_dispositivo_formato en la 15).
ALTER TABLE dispositivo ADD COLUMN IF NOT EXISTS decodificador text;
ALTER TABLE dispositivo DROP CONSTRAINT IF EXISTS ck_dispositivo_decodificador;
ALTER TABLE dispositivo ADD CONSTRAINT ck_dispositivo_decodificador CHECK (decodificador IN ('campus-heltec-v3-v1'));
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_dispositivo_decodificador_via') THEN
    ALTER TABLE dispositivo ADD CONSTRAINT ck_dispositivo_decodificador_via CHECK (decodificador IS NULL OR via = 'lorawan');
  END IF;
END $$;
COMMENT ON COLUMN dispositivo.decodificador IS
  'Perfil con que la plataforma decodifica la data en base64 de un nodo LoRaWAN cuando su pasarela la entrega sin decodificar; nulo = sin perfil (lo interpreta el código, docs/08 §6; docs/10 §8.4 punto 47).';

-- b) Contador de la última trama guardada. Lo escribe el filtro 6, después de guardar las lecturas (docs/10 §4.1).
ALTER TABLE estado_dispositivo ADD COLUMN IF NOT EXISTS ultimo_fcnt bigint
  CONSTRAINT ck_estado_dispositivo_ultimo_fcnt CHECK (ultimo_fcnt BETWEEN 0 AND 4294967295);
COMMENT ON COLUMN estado_dispositivo.ultimo_fcnt IS
  'Derivado: contador de trama (fCnt) de la última trama LoRaWAN que dejó al menos una lectura guardada. El filtro 3 descarta la que lo repite (docs/10 §4.1).';

-- c) Catálogo.
INSERT INTO magnitud (codigo, nombre, unidad_canonica, rango_min, rango_max) VALUES
    ('tension', 'Tensión de batería', 'V', 0, 5)
ON CONFLICT (codigo) DO NOTHING;
COMMIT;
