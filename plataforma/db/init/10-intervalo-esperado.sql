-- 10 · Qué significa dispositivo.intervalo_esperado_s (decisión del 07/10/2026; docs/10 §8.4 punto 23; docs/16 §6.1).
-- El supervisor abre «sin comunicación» cuando el silencio supera 2 × este valor (RF-24, RNF-03). Medido en el banco con
-- 1 % de pérdida: declarado igual al periodo de reporte dio 108 alarmas falsas en 90 s; declarado como 2 × periodo, 3.
-- No cambia el tipo ni el código: fija en la base, donde lo lee cualquiera, qué número hay que poner al dar de alta.
-- Base existente: docker compose exec -T timescaledb psql -U plataforma -d plataforma -v ON_ERROR_STOP=1 < db/init/10-intervalo-esperado.sql
BEGIN;
SET LOCAL lock_timeout = '5s';
COMMENT ON COLUMN dispositivo.intervalo_esperado_s IS
    'Silencio máximo normal del dispositivo, en segundos: su periodo de reporte MÁS las pérdidas que admite el medio (regla práctica: 2 × periodo; LoRaWAN pierde más que Wi-Fi). No es el periodo. El supervisor abre sin_comunicacion al superar 2 × este valor (RF-24, RNF-03). Medido el 07/10/2026 (docs/16): igual al periodo con 1 % de pérdida → 108 alarmas falsas en 90 s; 2 × periodo → 3.';
COMMIT;
