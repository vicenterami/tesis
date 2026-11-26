-- 29 · Relación señal/ruido del enlace (diseñado el 25/11/2026: docs/10 §8.4 punto 71, docs/19 §4 bloque AA, docs/08; HU-15, RF-27).
--   · magnitud `snr`: «Relación señal/ruido», dB, de −32 a 32. Contiene lo medido en el servidor el 24/11/2026 (de −18,5 a 14,5 dB) con
--     margen. Sin umbral sugerido: no se clasifica la señal en buena o mala sin una fuente que lo sostenga.
--   · `rssi` ya existe desde la migración 01 (dBm, −150 a 0). Un nodo guarda la señal de cada trama solo si declara esos canales (en el
--     alta, o después con POST /dispositivos/{id}/canales): ninguna fila de `canal` se crea aquí.
--   · Permisos: ninguno nuevo. plataforma_app ya inserta en `canal` (migración 14) y la magnitud la siembra el dueño en esta migración;
--     nada que repetir en la 14.
-- Aditiva e idempotente: un INSERT con ON CONFLICT DO NOTHING (no pisa un `snr` creado antes desde el catálogo editable). Convenciones de
-- docs/08 §6. Base existente (un contenedor nuevo la aplica solo, desde db/init; antes, un respaldo):
--   docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/29-relacion-senal-ruido.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO magnitud (codigo, nombre, unidad_canonica, rango_min, rango_max) VALUES
    ('snr', 'Relación señal/ruido', 'dB', -32, 32)
ON CONFLICT (codigo) DO NOTHING;

COMMIT;
