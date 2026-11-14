#!/usr/bin/env bash
# El promedio del sitio es el de sus dispositivos (docs/19 §4, M7; docs/16 §68), contra la base y el backend del banco, con datos sembrados a
# propósito. Se corre con `bash plataforma/pruebas/banco/banco.sh historico` (el banco arriba). Siembra un sitio propio, «m7-promedio»
# (zona America/Santiago), con ocho dispositivos de prueba (id_fisico «m7-…») en cuatro magnitudes, una por caso, alrededor de una
# ventana de 75 minutos que termina hace dos horas en punto (cinco tramos de 15 minutos), y pide GET /sitios/{id}/historico de cada una:
#   1. temperatura: uno cada 3 minutos y dos cada hora, como en la tabla de M → en los cinco tramos aportan tres y el promedio no salta.
#   2. presión: uno cada 10 minutos que deja de reportar → aporta mientras su última lectura tiene menos de dos intervalos esperados al
#      empezar el tramo (exactamente dos ya no) y después `n` baja; otro cada minuto, siempre.
#   3. humedad: uno cada 5 s junto a uno cada hora → el promedio del tramo es el de los dos dispositivos, no el de sus 181 lecturas.
#   4. temperatura (el mismo sitio del caso 1): el primer tramo usa la lectura anterior a la ventana de uno que reporta cada hora.
#   5. PM10: uno cada 5 minutos con lecturas solo en el primer y el último tramo → los tramos sin aportes no tienen punto.
# Cada caso tiene su falla plantada en docs/16 §68. Todo vive en la base del banco (datos en RAM) y desaparece con `banco.sh apagar`;
# antes de sembrar se borra lo sembrado por una corrida anterior (solo las filas de «m7-…»). La clave de administrador del banco entra a
# curl por la entrada estándar, nunca por argumento.
set -u; export LC_ALL=C
cd "$(dirname "$0")/../.."   # plataforma/
ENV="${XDG_RUNTIME_DIR:-$HOME/.cache}/plataforma-banco/banco.env"
[ -f "$ENV" ] || { echo "FALLA sin $ENV: primero banco.sh encender"; exit 1; }
B=http://127.0.0.1:3001
psql_() { docker compose -p banco -f docker-compose.yml -f pruebas/banco/compose.banco.yml --env-file "$ENV" exec -T timescaledb \
            psql -U plataforma -d plataforma -X -q -v ON_ERROR_STOP=1 "$@"; }
api() { printf 'X-Clave-Admin: %s\n' "$(grep -E '^HTTP_CLAVE_ADMIN=' "$ENV" | cut -d= -f2-)" | curl -s -H @- "$@"; }
fallos=0; ok() { echo "OK    $1"; }; falla() { echo "FALLA $1"; fallos=$((fallos + 1)); }

# Las horas, relativas a t0 (la hora en punto de hace dos horas). La guarda del banco (tablero-semilla-ahora.sql): datos en tmpfs y sitio «banco».
T0=$(psql_ -tA -c "SELECT iso_utc(date_trunc('hour', now()) - INTERVAL '2 hours')") || { echo "FALLA la base del banco no responde"; exit 1; }
psql_ -v t0="$T0" >/dev/null <<'SQL' || { echo "FALLA no se pudo sembrar el caso"; exit 1; }
DO $guarda$
DECLARE montaje text;
BEGIN
  SELECT split_part(l, ' ', 3) INTO montaje FROM regexp_split_to_table(pg_read_file('/proc/self/mounts'), E'\n') l
   WHERE split_part(l, ' ', 2) = current_setting('data_directory');
  IF montaje IS DISTINCT FROM 'tmpfs' OR NOT EXISTS (SELECT 1 FROM sitio WHERE codigo = 'banco') THEN
    RAISE EXCEPTION 'historico-sitio.sh es solo para la base desechable del banco: no se toca nada';
  END IF;
END $guarda$;
BEGIN;
DELETE FROM medicion WHERE canal_id IN (SELECT c.id FROM canal c JOIN dispositivo d ON d.id = c.dispositivo_id WHERE d.id_fisico LIKE 'm7-%');
DELETE FROM estado_dispositivo WHERE dispositivo_id IN (SELECT id FROM dispositivo WHERE id_fisico LIKE 'm7-%');
DELETE FROM condicion WHERE dispositivo_id IN (SELECT id FROM dispositivo WHERE id_fisico LIKE 'm7-%');
DELETE FROM canal WHERE dispositivo_id IN (SELECT id FROM dispositivo WHERE id_fisico LIKE 'm7-%');
DELETE FROM dispositivo WHERE id_fisico LIKE 'm7-%';
INSERT INTO sitio (codigo, nombre, zona_horaria) VALUES ('m7-promedio', 'Banco: promedio por dispositivos', 'America/Santiago') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO zona (sitio_id, nombre) SELECT id, 'Casos de M7' FROM sitio WHERE codigo = 'm7-promedio' ON CONFLICT (sitio_id, nombre) DO NOTHING;
-- (id_fisico, intervalo esperado en s, magnitud)
INSERT INTO dispositivo (zona_id, id_fisico, nombre, intervalo_esperado_s, via, formato)
SELECT z.id, v.id_fisico, v.id_fisico, v.intervalo, 'http', 'senml'
  FROM zona z JOIN sitio s ON s.id = z.sitio_id AND s.codigo = 'm7-promedio'
 CROSS JOIN (VALUES ('m7-a', 180), ('m7-b', 3600), ('m7-c', 3600), ('m7-d', 5), ('m7-e', 3600), ('m7-f', 600), ('m7-g', 60), ('m7-h', 300)) v(id_fisico, intervalo)
 WHERE z.nombre = 'Casos de M7';
INSERT INTO canal (dispositivo_id, magnitud_codigo)
SELECT d.id, CASE WHEN d.id_fisico IN ('m7-a', 'm7-b', 'm7-c') THEN 'temperatura' WHEN d.id_fisico IN ('m7-d', 'm7-e') THEN 'humedad'
                  WHEN d.id_fisico IN ('m7-f', 'm7-g') THEN 'presion' ELSE 'pm10' END
  FROM dispositivo d WHERE d.id_fisico LIKE 'm7-%';
-- (id_fisico, minutos desde t0, valor); las series largas, con generate_series.
INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo)
SELECT c.id, :'t0'::timestamptz + l.min * INTERVAL '1 minute', l.valor, m.unidad_canonica, :'t0'::timestamptz + l.min * INTERVAL '1 minute', 'dispositivo'
  FROM (SELECT 'm7-a' AS id_fisico, g::numeric AS min, 11.5::float AS valor FROM generate_series(-30, 72, 3) g   -- cada 3 minutos
        UNION ALL VALUES ('m7-b', -50, 17.0), ('m7-b', 62, 19.0), ('m7-c', 5, 14.0), ('m7-c', 65, 13.0)                 -- cada hora
        UNION ALL SELECT 'm7-d', g / 12.0, 40.0 FROM generate_series(0, 179) g                                           -- cada 5 s, en el primer tramo
        UNION ALL VALUES ('m7-e', 1, 80.0)
        UNION ALL VALUES ('m7-f', -5, 1000.0), ('m7-f', 5, 1000.0), ('m7-f', 15, 1000.0), ('m7-f', 25, 1000.0)           -- cada 10 minutos, hasta t0+25
        UNION ALL SELECT 'm7-g', g, 1010.0 FROM generate_series(-5, 74) g                                                -- cada minuto
        UNION ALL VALUES ('m7-h', 1, 20.0), ('m7-h', 61, 30.0)) l
  JOIN dispositivo d ON d.id_fisico = l.id_fisico JOIN canal c ON c.dispositivo_id = d.id JOIN magnitud m ON m.codigo = c.magnitud_codigo;
COMMIT;
SQL
SITIO=$(psql_ -tA -c "SELECT id FROM sitio WHERE codigo = 'm7-promedio'")
H=$(date -u -d "$T0 + 75 minutes" +%Y-%m-%dT%H:%M:%SZ)
pedir() { api "$B/sitios/$SITIO/historico?magnitud=$1&desde=$T0&hasta=$H&intervalo=15%20minutes"; }
# comprobar NOMBRE MAGNITUD EXPRESIÓN: la expresión (Python) sobre `r` (la respuesta) y `t` (los cinco inicios de tramo, segundos Unix).
comprobar() {
  local r; r=$(pedir "$2")
  if python3 -I -c "import json,sys; r=json.loads(sys.argv[1]); t0=int(sys.argv[2]); t=[t0+900*i for i in range(5)]; sys.exit(0 if ($3) else 1)" \
       "$r" "$(date -u -d "$T0" +%s)" 2>/dev/null; then ok "$1"; else falla "$1 → ${r:0:300}"; fi
}
echo "ventana: 5 tramos de 15 minutos desde t0 (la hora en punto de hace dos horas); sitio m7-promedio"
comprobar "1. temperatura (uno cada 3 min, dos cada hora): en los cinco tramos aportan 3 y el promedio no salta (14,167 ×4 y 14,5)" temperatura \
  "r['tiempos']==t and r['n']==[3,3,3,3,3] and r['valores']==[14.167,14.167,14.167,14.167,14.5] and r['dispositivos']==3"
comprobar "1b. temperatura: la banda es entre dispositivos (11,5–17 y, en el último, 11,5–19) y las muestras son solo las lecturas reales (6, 5, 5, 5, 7)" temperatura \
  "r['minimos']==[11.5]*5 and r['maximos']==[17,17,17,17,19] and r['muestras']==[6,5,5,5,7]"
comprobar "2. presión: el de 10 min aporta mientras su última lectura (t0+25) tiene menos de dos intervalos al empezar el tramo; en t0+45 (justo dos) ya no: n = 2, 2, 2, 1, 1" presion \
  "r['n']==[2,2,2,1,1] and r['valores']==[1005,1005,1005,1010,1010] and r['dispositivos']==2"
comprobar "3. humedad: uno cada 5 s (40) junto a uno cada hora (80) → 60 en el primer tramo, no 40,22 (el promedio de las 181 lecturas)" humedad \
  "r['valores'][0]==60 and r['muestras'][0]==181 and r['n'][0]==2"
comprobar "3b. humedad: el de 5 s arrastra su última lectura (5 s antes del tramo) solo al tramo siguiente; después aporta solo el de cada hora" humedad \
  "r['n']==[2,2,1,1,1] and r['valores']==[60,60,80,80,80]"
comprobar "4. temperatura: el primer tramo usa la lectura anterior a la ventana (17, de t0−50 min, de uno que reporta cada hora)" temperatura \
  "r['tiempos'][0]==t[0] and r['n'][0]==3 and r['maximos'][0]==17 and r['muestras'][0]==6"
comprobar "5. PM10: uno cada 5 min con lecturas en el primer y el último tramo → sin punto en los tres de en medio (no son 0)" pm10 \
  "r['tiempos']==[t[0],t[4]] and r['puntos']==2 and r['valores']==[20,30] and r['n']==[1,1]"
echo; [ $fallos -eq 0 ] && echo "PROMEDIO POR DISPOSITIVOS OK (7 de 7 comprobaciones)" || { echo "$fallos de 7 comprobaciones con falla"; exit 1; }
