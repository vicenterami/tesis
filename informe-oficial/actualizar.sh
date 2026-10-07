#!/usr/bin/env bash
# Actualiza TODO lo derivado en un solo paso, en este orden:
#   1) figuras desde la fuente única (docs/10 + esquema real de la base)  → figuras/render/*.pdf, docs/08
#   2) informe con latexmk                                                → build/main.pdf
#   3) comprobaciones: cero desbordes > 6 pt, cero referencias rotas, guardián de concordancia
#   4) copia del PDF a privado/previsualizaciones para revisarlo
# Lo que NO hace, por regla del proyecto: git add/commit/push (eso lo ejecuta el estudiante).
#   bash informe-oficial/actualizar.sh            # todo
#   bash informe-oficial/actualizar.sh --sin-figuras   # solo compilar y comprobar (si la pila no está arriba)
#   bash informe-oficial/actualizar.sh --completo      # fuerza recompilación total (tras cambiar bibliografía o preámbulo)
set -uo pipefail
cd "$(dirname "$0")/.."
fallos=0
if [[ "${1:-}" != "--sin-figuras" && "${1:-}" != "--completo" ]]; then
  echo "══ 1. figuras ══"; bash informe-oficial/figuras/generar-figuras.sh || fallos=$((fallos+1))
fi
echo "══ 2. informe ══"
G=""; [[ "${1:-}" == "--completo" ]] && G="-g"
( cd informe-oficial && latexmk $G -pdf -interaction=nonstopmode -outdir=build main.tex >build/log.txt 2>&1 ) && echo "compilado" || { echo "FALLA compilación (ver informe-oficial/build/log.txt)"; fallos=$((fallos+1)); }
echo "══ 3. comprobaciones ══"
# El chequeo vive en comprobar-compilacion.py: lo comparte verificar-todo.sh (paso 3b), una sola casa (07/10).
python3 informe-oficial/comprobar-compilacion.py || fallos=$((fallos+1))
if [[ "${1:-}" != "--sin-figuras" && "${1:-}" != "--completo" ]]; then bash informe-oficial/figuras/generar-figuras.sh --verificar | tail -1 || fallos=$((fallos+1)); fi
mkdir -p privado/previsualizaciones && cp informe-oficial/build/main.pdf privado/previsualizaciones/informe-borrador.pdf
echo "══ 4. privado/previsualizaciones/informe-borrador.pdf actualizado ══"
[[ $fallos -eq 0 ]] && echo "TODO OK — revisa el PDF y luego commitea" || { echo "$fallos paso(s) con falla"; exit 1; }
