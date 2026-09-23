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
# `tsc` con salida 0 no prueba nada si no revisó archivos (tsconfig mal apuntado): se exige un mínimo.
if command -v pnpm >/dev/null; then (cd plataforma/backend && n=$(pnpm -s exec tsc --listFiles --noEmit 2>/dev/null | grep -c "/src/"); [[ ${n:-0} -ge 10 ]] && echo "tsc revisó $n archivos de src" || { echo "FALLA tsc revisó solo ${n:-0} archivos de src"; exit 1; }) || fallos=$((fallos+1)); fi
if command -v pnpm >/dev/null; then (cd plataforma/backend && pnpm verificar 2>&1 | grep -E "^\$ |Tests:|error|✖|FAIL"; exit "${PIPESTATUS[0]}") || fallos=$((fallos+1)); else echo "omitida: pnpm no está en el PATH"; fi

paso "1. Esquema: guardias de tipo y zonas horarias (db/pruebas/zonas-horarias.sql)"
docker compose -f plataforma/docker-compose.yml exec -T timescaledb psql -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA -F ' · ' \
  < plataforma/db/pruebas/zonas-horarias.sql | tee /tmp/vt-sql.txt
grep -q FALLA /tmp/vt-sql.txt && fallos=$((fallos+1))

paso "2. Migraciones aplicadas = archivos en db/init (cada NN-*.sql debe estar reflejado en la base)"
# 02: índice por regla · 03: zona_horaria · 04: iso_utc · 05: convenciones (disparadores actualizado_en, pm2_5) · 06: índice único de medicion · 07: CHECK de cuarentena.motivo
docker compose -f plataforma/docker-compose.yml exec -T timescaledb psql -U plataforma -d plataforma -tA <<'SQL' | tee /tmp/vt-mig.txt
SELECT CASE WHEN indexdef LIKE '%COALESCE(regla_id%' THEN 'OK    02 condicion_abierta_unica por regla' ELSE 'FALLA 02 indice viejo' END FROM pg_indexes WHERE indexname='condicion_abierta_unica';
SELECT CASE WHEN count(*)=1 THEN 'OK    03 sitio.zona_horaria' ELSE 'FALLA 03 falta sitio.zona_horaria' END FROM information_schema.columns WHERE table_name='sitio' AND column_name='zona_horaria';
SELECT CASE WHEN count(*)=1 THEN 'OK    04 funcion iso_utc' ELSE 'FALLA 04 falta iso_utc' END FROM pg_proc WHERE proname='iso_utc';
SELECT CASE WHEN count(*)=1 THEN 'OK    06 uq_medicion_canal_tiempo (idempotencia)' ELSE 'FALLA 06 falta el indice unico de medicion' END FROM pg_indexes WHERE indexname='uq_medicion_canal_tiempo' AND indexdef LIKE 'CREATE UNIQUE%';
SELECT CASE WHEN count(*)>=9 AND (SELECT count(*) FROM magnitud WHERE codigo IN ('pm2_5','pm10'))=2 THEN 'OK    05 convenciones: '||count(*)||' disparadores actualizado_en y pm2_5/pm10' ELSE 'FALLA 05 convenciones incompletas' END FROM pg_trigger WHERE tgname LIKE 'trg_%_actualizado_en';
SELECT CASE WHEN count(*)=1 THEN 'OK    07 cuarentena.motivo con CHECK (dominio cerrado)' ELSE 'FALLA 07 falta el CHECK de cuarentena.motivo' END FROM pg_constraint WHERE conname='cuarentena_motivo_chk' AND contype='c';
SQL
grep -q FALLA /tmp/vt-mig.txt && fallos=$((fallos+1))

paso "2b. Número de entidades: la base manda; informe y estado deben decir el mismo número"
n=$(docker compose -f plataforma/docker-compose.yml exec -T timescaledb psql -U plataforma -d plataforma -tA -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
for f in informe-oficial/cap-diseno.tex informe-oficial/anexos/e-seguimiento.tex docs/12-estado-etapa2.md docs/08-modelo-datos.md; do
  if grep -qE "[0-9]+ entidades" "$f"; then
    if grep -qE "\b$n entidades" "$f" && ! grep -E "[0-9]+ entidades" "$f" | grep -vqE "\b$n entidades"; then echo "OK    $f dice $n entidades"; else echo "FALLA $f no dice $n entidades: $(grep -oE '[0-9]+ entidades' "$f" | sort -u | tr '\n' ' ')"; fallos=$((fallos+1)); fi
  fi
done

paso "2c. Términos vetados por el profesor guía: cero apariciones en docs e informe"
if grep -rniE "ingesta|heterog[eé]ne" docs/ informe-oficial/*.tex informe-oficial/anexos/*.tex PLAN-MAESTRO.md 2>/dev/null | grep -v "sin «heterogéneo» ni «ingesta»" | grep -q .; then
  echo "FALLA aparecen términos vetados:"; grep -rniE "ingesta|heterog[eé]ne" docs/ informe-oficial/*.tex informe-oficial/anexos/*.tex PLAN-MAESTRO.md 2>/dev/null | grep -v "sin «heterogéneo» ni «ingesta»" | cut -c1-120
  fallos=$((fallos+1))
else echo "OK    sin «ingesta» ni «heterogéneo»"; fi

paso "2d. Variables de entorno: toda variable que lee el backend está declarada en plataforma/.env.example (docs/11 §7)"
leidas=$(grep -rhoE "(config\.get(OrThrow)?(<[^>]+>)?\(\s*'|process\.env\.)[A-Z_]+" plataforma/backend/src --include=*.ts | grep -v spec | grep -oE "[A-Z_]{3,}$" | grep -vx TZ | sort -u)
declaradas=$(grep -oE "^#?[A-Z_]+=" plataforma/.env.example | tr -d '#=' | sort -u)
faltan=$(comm -23 <(echo "$leidas") <(echo "$declaradas"))
if [ -n "$faltan" ]; then
  echo "FALLA variables leídas por el código sin declarar en .env.example:"; echo "$faltan" | sed 's/^/  /'
  fallos=$((fallos+1))
else echo "OK    $(echo "$leidas" | wc -l) variables leídas, todas declaradas en .env.example"; fi

paso "2e. Orden de los filtros: la figura TikZ del cap. 3 y docs/06 dicen 5 alertar / 6 supervisar (docs/10 §8.2)"
if grep -q "5/{alertar}" informe-oficial/figuras/pipeline.tex && grep -q "6/{supervisar}" informe-oficial/figuras/pipeline.tex \
   && grep -qE "^\s*5 alertar" docs/06-evaluacion-comunicacion.md && grep -qE "^\s*6 supervisar" docs/06-evaluacion-comunicacion.md \
   && grep -q "participant F5 as 5 Alertar" docs/10-arquitectura.md && grep -q "participant F6 as 6 Supervisar" docs/10-arquitectura.md; then
  echo "OK    5 alertar / 6 supervisar en pipeline.tex, docs/06 y docs/10"
else
  echo "FALLA el orden de los filtros 5/6 difiere entre pipeline.tex, docs/06 y docs/10"; fallos=$((fallos+1))
fi

paso "2f. Repositorio público: ningún archivo versionado menciona herramientas de asistencia ni rutas personales"
# El patrón se arma por partes para que este mismo archivo no lo contenga literal (y no se detecte a sí mismo).
P="\\bcl""aude\\b|\\bfa""ble\\b|\\bson""net\\b|co-auth""ored-by|asistente de ""ia|modelo de ""lenguaje|~/\\.cl""aude"
if git ls-files | grep -v "^historico/" | xargs grep -lniE "$P" 2>/dev/null | grep -q .; then
  echo "FALLA archivos versionados con menciones prohibidas:"; git ls-files | grep -v "^historico/" | xargs grep -lniE "$P" 2>/dev/null | sed 's/^/  /'
  fallos=$((fallos+1))
else echo "OK    sin menciones a herramientas ni rutas personales en $(git ls-files | wc -l) archivos versionados"; fi

paso "3. Diagramas: informe = docs = base (generar-figuras.sh --verificar)"
bash informe-oficial/figuras/generar-figuras.sh --verificar || fallos=$((fallos+1))

paso "4. API (si el backend está corriendo en 127.0.0.1:3000)"
if curl -s -m 2 http://127.0.0.1:3000/salud >/dev/null; then bash plataforma/pruebas/api-smoke.sh || fallos=$((fallos+1)); else echo "omitida: backend no está corriendo"; fi

echo; [[ $fallos -eq 0 ]] && echo "TODO EN CONCORDANCIA" || { echo "$fallos bloque(s) con fallas"; exit 1; }
