#!/usr/bin/env bash
# Corre TODOS los guardianes de concordancia y las pruebas de solo lectura. Sale 1 si algo falla.
#   bash plataforma/pruebas/verificar-todo.sh
# Requiere la pila arriba (docker compose up -d en plataforma/) y, para la API, el backend corriendo.
set -u
cd "$(dirname "$0")/../.."
# Cada corrida queda registrada (fecha y hora en el nombre) en una carpeta que git ignora.
LOG_DIR="${VERIFICAR_LOG_DIR:-privado/logs}"; mkdir -p "$LOG_DIR"
exec > >(tee "$LOG_DIR/verificar-$(date +%F-%H%M%S).log") 2>&1
echo "verificar-todo · $(date -Is) · commit $(git rev-parse --short HEAD 2>/dev/null || echo ?)"
fallos=0
paso() { echo; echo "══ $1 ══"; }

paso "0. Backend: tipos, lint y pruebas unitarias (pnpm verificar) — no necesita base ni broker"
if command -v pnpm >/dev/null; then (cd plataforma/backend && pnpm verificar 2>&1 | grep -E "^\$ |Tests:|error|✖|FAIL"; exit "${PIPESTATUS[0]}") || fallos=$((fallos+1)); else echo "omitida: pnpm no está en el PATH"; fi

paso "1. Esquema: guardias de tipo y zonas horarias (db/pruebas/zonas-horarias.sql)"
docker compose -f plataforma/docker-compose.yml exec -T timescaledb psql -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA -F ' · ' \
  < plataforma/db/pruebas/zonas-horarias.sql | tee /tmp/vt-sql.txt
grep -q FALLA /tmp/vt-sql.txt && fallos=$((fallos+1))

paso "2. Migraciones aplicadas = archivos en db/init (cada NN-*.sql debe estar reflejado en la base)"
# 02: índice por regla · 03: zona_horaria · 04: iso_utc
docker compose -f plataforma/docker-compose.yml exec -T timescaledb psql -U plataforma -d plataforma -tA <<'SQL' | tee /tmp/vt-mig.txt
SELECT CASE WHEN indexdef LIKE '%COALESCE(regla_id%' THEN 'OK    02 condicion_abierta_unica por regla' ELSE 'FALLA 02 indice viejo' END FROM pg_indexes WHERE indexname='condicion_abierta_unica';
SELECT CASE WHEN count(*)=1 THEN 'OK    03 sitio.zona_horaria' ELSE 'FALLA 03 falta sitio.zona_horaria' END FROM information_schema.columns WHERE table_name='sitio' AND column_name='zona_horaria';
SELECT CASE WHEN count(*)=1 THEN 'OK    04 funcion iso_utc' ELSE 'FALLA 04 falta iso_utc' END FROM pg_proc WHERE proname='iso_utc';
SQL
grep -q FALLA /tmp/vt-mig.txt && fallos=$((fallos+1))

paso "3. Diagramas: informe = docs = base (generar-figuras.sh --verificar)"
bash informe-oficial/figuras/generar-figuras.sh --verificar || fallos=$((fallos+1))

paso "4. API (si el backend está corriendo en 127.0.0.1:3000)"
if curl -s -m 2 http://127.0.0.1:3000/salud >/dev/null; then bash plataforma/pruebas/api-smoke.sh || fallos=$((fallos+1)); else echo "omitida: backend no está corriendo"; fi

echo; [[ $fallos -eq 0 ]] && echo "TODO EN CONCORDANCIA" || { echo "$fallos bloque(s) con fallas"; exit 1; }
