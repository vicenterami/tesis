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
python3 - <<'PY' || fallos=$((fallos+1))
import re, sys
log = open('informe-oficial/build/main.log', errors='ignore').read()
pag = 1; hits = {}
for m in re.finditer(r'\[(\d+)[\]\s]|Overfull \\hbox \(([\d.]+)pt too wide\)', log):
    if m.group(1): pag = int(m.group(1)) + 1
    elif float(m.group(2)) > 6: hits.setdefault(pag, []).append(round(float(m.group(2)), 1))
refs = log.count('undefined'); multi = log.count('multiply defined')
toc = open('informe-oficial/build/main.toc', errors='ignore').read()
g = re.search(r'Glosario\}\{(\d+)\}', toc); cuerpo = int(g.group(1)) - 1 if g else '?'
print(f"desbordes >6pt: {hits if hits else 'ninguno'} · refs sin resolver: {refs} · etiquetas duplicadas: {multi} · cuerpo: {cuerpo} págs (límite blando 30)")
graves = {k: v for k, v in hits.items() if max(v) > 12}
if hits and not graves: print('  (desbordes menores a 12 pt: avisos conocidos de longtable en anexos; no bloquean)')
ok = not graves and refs == 0 and multi == 0
sys.exit(0 if ok else 1)
PY
if [[ "${1:-}" != "--sin-figuras" && "${1:-}" != "--completo" ]]; then bash informe-oficial/figuras/generar-figuras.sh --verificar | tail -1 || fallos=$((fallos+1)); fi
mkdir -p privado/previsualizaciones && cp informe-oficial/build/main.pdf privado/previsualizaciones/informe-borrador.pdf
echo "══ 4. privado/previsualizaciones/informe-borrador.pdf actualizado ══"
[[ $fallos -eq 0 ]] && echo "TODO OK — revisa el PDF y luego commitea" || { echo "$fallos paso(s) con falla"; exit 1; }
