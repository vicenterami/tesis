#!/usr/bin/env bash
# Actualiza TODO lo derivado en un solo paso, en este orden:
#   1) figuras desde la fuente única (docs/10 + esquema real de la base)  → figuras/render/*.pdf, docs/08
#   2) informe con latexmk                                                → build/main.pdf
#   3) comprobaciones: cero desbordes > 6 pt, cero referencias rotas, guardián de concordancia
#   4) copia del PDF a privado/previsualizaciones para revisarlo
#   5) PDF con los cambios marcados (latexdiff): contra la última entrega y, si hay cambios sin commitear, contra HEAD
# Lo que NO hace, por regla del proyecto: git add/commit/push (eso se hace a mano).
#   bash informe-oficial/actualizar.sh            # todo
#   bash informe-oficial/actualizar.sh --sin-figuras   # solo compilar y comprobar (si la pila no está arriba)
#   bash informe-oficial/actualizar.sh --completo      # fuerza recompilación total (tras cambiar bibliografía o preámbulo)
#   BASE_CAMBIOS=<commit> bash informe-oficial/actualizar.sh   # compara contra otro commit; --sin-cambios lo omite
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
# 5. Cambios visibles (08/10/2026): lo borrado en rojo tachado y lo nuevo en azul, para revisar de un vistazo qué cambió.
# La base es la última entrega (cambiar al entregar la siguiente etapa). Se arma en una carpeta desechable con la versión
# de la base (git archive, solo lectura) y la actual; un fallo aquí avisa pero no cuenta como falla del informe.
# 15/10: latexdiff marca mal un borrado grande que cruza un \\textbf y pdflatex se detiene; se fuerza (-f) y se avisa, porque
# este PDF es solo una ayuda para revisar: la compilación que vale es la del paso 2.
BASE_CAMBIOS="${BASE_CAMBIOS:-bc7cfdf}"   # entrega de la Etapa 2, 02/10/2026
cambios() { # cambios BASE SALIDA
  local T r; T=$(mktemp -d) || return 1; mkdir -p "$T/viejo" "$T/nuevo"
  git archive "$1" informe-oficial | tar -x -C "$T/viejo" && cp -r informe-oficial "$T/nuevo/" && rm -rf "$T/nuevo/informe-oficial/build" \
    && latexdiff --flatten --graphics-markup=0 --math-markup=whole -c "PICTUREENV=(?:picture|tikzpicture|DIFnomarkup)[\w\d*@]*" \
         "$T/viejo/informe-oficial/main.tex" "$T/nuevo/informe-oficial/main.tex" > "$T/nuevo/informe-oficial/cambios.tex" 2>/dev/null \
    && { ( cd "$T/nuevo/informe-oficial" && latexmk -f -pdf -interaction=nonstopmode -outdir=build-cambios cambios.tex > /dev/null 2>&1 ) \
         || { cp "$T/nuevo/informe-oficial/build-cambios/cambios.log" "${2%.pdf}.log" 2>/dev/null
              echo "AVISO el PDF de cambios salió con errores (registro en ${2%.pdf}.log); el informe vale por el paso 2, que compiló aparte"; }; } \
    && [ -s "$T/nuevo/informe-oficial/build-cambios/cambios.pdf" ] && cp "$T/nuevo/informe-oficial/build-cambios/cambios.pdf" "$2" \
    && { ! command -v pdfinfo >/dev/null || { pc=$(pdfinfo "$2" 2>/dev/null | awk '/^Pages/{print $2}'); pm=$(pdfinfo informe-oficial/build/main.pdf 2>/dev/null | awk '/^Pages/{print $2}')
         [ "${pc:-0}" -ge "${pm:-1}" ] || echo "AVISO el PDF de cambios tiene ${pc:-0} páginas y el informe ${pm:-?}: puede estar incompleto"; }; }
  r=$?; rm -rf "$T"; return $r; }
if [[ " $* " == *" --sin-cambios "* ]]; then echo "══ 5. cambios visibles: omitido (--sin-cambios) ══"
elif ! command -v latexdiff >/dev/null; then echo "══ 5. cambios visibles: omitido, falta latexdiff (sudo apt install latexdiff) ══"
elif ! git cat-file -e "$BASE_CAMBIOS^{commit}" 2>/dev/null; then echo "AVISO la base $BASE_CAMBIOS no es un commit de este repositorio"
else
  if cambios "$BASE_CAMBIOS" privado/previsualizaciones/informe-cambios-desde-entrega.pdf; then
    echo "══ 5. privado/previsualizaciones/informe-cambios-desde-entrega.pdf (contra $BASE_CAMBIOS) ══"
  else echo "AVISO no se pudo generar el PDF de cambios contra $BASE_CAMBIOS (el informe sí está bien)"; fi
  if git status --porcelain -- informe-oficial | grep -qE '\.(tex|bib|mmd)$'; then
    if cambios HEAD privado/previsualizaciones/informe-cambios-sin-commitear.pdf; then
      echo "   y privado/previsualizaciones/informe-cambios-sin-commitear.pdf (contra el último commit)"
    else echo "AVISO no se pudo generar el PDF de cambios contra HEAD"; fi
  else
    # Sin cambios por commitear, el PDF anterior mostraría cambios que ya están en el commit: se quita para no confundir.
    rm -f privado/previsualizaciones/informe-cambios-sin-commitear.pdf
  fi
fi
[[ $fallos -eq 0 ]] && echo "TODO OK — revisa el PDF y luego commitea" || { echo "$fallos paso(s) con falla"; exit 1; }
