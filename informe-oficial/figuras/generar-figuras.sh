#!/usr/bin/env bash
# Genera las figuras del informe desde UNA fuente: los bloques Mermaid de docs/ y, para el modelo de
# datos, el esquema REAL de la base. Renderiza a PDF vectorial con mermaid-cli dentro de Docker
# (nada que instalar). Con --verificar solo comprueba que informe, docs y base siguen coincidiendo.
#
#   bash informe-oficial/figuras/generar-figuras.sh              # regenera todo
#   bash informe-oficial/figuras/generar-figuras.sh --verificar  # guardián: sale 1 si algo difiere
#   bash informe-oficial/figuras/generar-figuras.sh --forzar     # re-renderiza todo aunque no haya cambios
set -euo pipefail
cd "$(dirname "$0")/../.."
MMD=informe-oficial/figuras/mermaid; OUT=informe-oficial/figuras/render
IMG=minlag/mermaid-cli:11.17.0@sha256:a6fb0574dded4086888b5e38476899c9aff8963196f689f11a0f8fceee588ce1   # etiqueta legible + digest (docs/11 §4); Dependabot no lo ve: se revisa a mano cada mes
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# 1) Modelo de datos: desde la base (requiere la pila arriba)
docker compose -f plataforma/docker-compose.yml exec -T timescaledb \
  psql -U plataforma -d plataforma -tA < plataforma/db/pruebas/er-mermaid.sql > "$TMP/modelo-datos.mmd"

# 2) Arquitectura: los siete bloques de docs/10, en su orden (26/10: «resumen», la vista resumida para las láminas, va primero)
python3 - "$TMP" <<'PY'
import re, sys, pathlib
tmp = pathlib.Path(sys.argv[1])
bloques = re.findall(r"```mermaid\n(.*?)```", pathlib.Path("docs/10-arquitectura.md").read_text(), re.S)
nombres = ["resumen", "contenedores", "red", "sec-alta", "sec-pipeline", "sec-tiemporeal", "despliegue"]
assert len(bloques) == len(nombres), f"docs/10 tiene {len(bloques)} bloques; se esperaban {len(nombres)}"
for n, b in zip(nombres, bloques): (tmp / f"{n}.mmd").write_text(b)
PY

if [[ "${1:-}" == "--verificar" ]]; then
  fallo=0
  for f in "$TMP"/*.mmd; do
    n=$(basename "$f")
    if ! diff -q "$f" "$MMD/$n" >/dev/null 2>&1; then echo "DIFIERE  $n (docs/base vs informe)"; fallo=1; else echo "OK       $n"; fi
  done
  # docs/08 debe contener exactamente el ER de la base
  python3 - "$TMP/modelo-datos.mmd" <<'PY' || fallo=1
import re, sys, pathlib
er = pathlib.Path(sys.argv[1]).read_text().strip()
doc = pathlib.Path("docs/08-modelo-datos.md").read_text()
m = re.search(r"```mermaid\n(.*?)```", doc, re.S)
ok = m and m.group(1).strip() == er
print(("OK       " if ok else "DIFIERE  ") + "docs/08 §3 vs base de datos"); sys.exit(0 if ok else 1)
PY
  exit $fallo
fi

# 3) Copiar fuentes al informe (anotando cuáles cambiaron) y actualizar docs/08 §3 con el ER real
#    Los PDF de mermaid-cli no son deterministas (bytes distintos con el mismo dibujo): solo se
#    renderiza lo que cambió o no existe, para no ensuciar git en cada corrida.
CAMBIADOS=""
for f in "$TMP"/*.mmd; do n=$(basename "$f" .mmd)
  if ! diff -q "$f" "$MMD/$n.mmd" >/dev/null 2>&1 || [[ ! -f "$OUT/$n.pdf" ]]; then CAMBIADOS="$CAMBIADOS $n"; fi
done
# Las fuentes se copian al informe DESPUÉS de renderizar cada una (paso 4). Hasta el 09/10 se copiaban antes: un render que
# fallaba dejaba la fuente nueva con el PDF viejo, y la corrida siguiente (y --verificar) decía «sin cambios».
python3 - "$TMP/modelo-datos.mmd" <<'PY'
import re, sys, pathlib
er = pathlib.Path(sys.argv[1]).read_text().strip()
p = pathlib.Path("docs/08-modelo-datos.md"); doc = p.read_text()
nuevo = "```mermaid\n" + er + "\n```"
doc2, n = re.subn(r"```mermaid\n.*?```", lambda m: nuevo, doc, count=1, flags=re.S)
assert n == 1
aviso = "> Diagrama **generado desde la base de datos real** por `informe-oficial/figuras/generar-figuras.sh` (`db/pruebas/er-mermaid.sql`). No editar a mano: si el esquema cambia, se regenera.\n\n"
if "generado desde la base de datos real" not in doc2:
    doc2 = doc2.replace("```mermaid\nerDiagram", aviso + "```mermaid\nerDiagram", 1)
p.write_text(doc2)
PY

# 4) Render a PDF (vectorial) y PNG (revisión)
mkdir -p "$OUT" privado/previsualizaciones
[[ "${1:-}" == "--forzar" ]] && CAMBIADOS=$(cd "$TMP" && ls *.mmd | sed 's/\.mmd$//')
[[ -z "$CAMBIADOS" ]] && echo "figuras sin cambios: no se vuelve a renderizar (usa --forzar para rehacerlas)"
cp "$MMD/tema.json" "$TMP/tema.json"
for n in $CAMBIADOS; do
  docker run --rm -u "$(id -u):$(id -g)" -v "$TMP:/in:ro" -v "$PWD/$OUT:/out" "$IMG" \
    -i "/in/$n.mmd" -o "/out/$n.pdf" -c /in/tema.json --pdfFit -q
  # Sin fecha ni hora en los metadatos (17/10): Chromium escribe CreationDate y ModDate, y un PDF versionado no debe decir a qué hora
  # se trabajó (guardián 2f4). Ghostscript lo reescribe sin fechas, sin ID y sin XMP: mismo dibujo, mismo tamaño de página, misma fuente.
  # Rutas absolutas: con -dSAFER, Ghostscript no abre un archivo de salida dado con ruta relativa fuera de la carpeta actual.
  abs=$(realpath "$OUT"); gs -q -o "$abs/$n.sinfecha.pdf" -sDEVICE=pdfwrite -dOmitInfoDate=true -dOmitID=true -dOmitXMP=true "$abs/$n.pdf" && mv "$abs/$n.sinfecha.pdf" "$abs/$n.pdf"
  docker run --rm -u "$(id -u):$(id -g)" -v "$TMP:/in:ro" -v "$PWD/privado/previsualizaciones:/out" "$IMG" \
    -i "/in/$n.mmd" -o "/out/$n.png" -c /in/tema.json -w 2000 -b white -q
  cp "$TMP/$n.mmd" "$MMD/"   # solo tras renderizarla bien (set -e corta en el primer fallo)
  echo "render   $n"
done
cp "$TMP"/*.mmd "$MMD/"   # las que no cambiaron: mismo contenido
# Legibilidad, medida y no supuesta (07/10): a 13,5 cm de ancho (383,8 pt) la letra del diagrama (≈ 12 pt en el PDF
# generado) queda en 12 × 383,8 / ancho. Las apaisadas (sec-*) disponen del alto de página: no se estiman aquí.
for f in "$OUT"/*.pdf; do
  n=$(basename "$f" .pdf); [[ $n == sec-* ]] && continue
  ancho=$(pdfinfo "$f" 2>/dev/null | awk '/Page size/{print $3}')
  [ -n "$ancho" ] && printf 'letra    %-14s ≈ %s pt en el informe (ancho %s pt)\n' "$n" "$(awk -v a="$ancho" 'BEGIN{printf "%.1f", 12*383.8/a}')" "$ancho"
done
echo "listo: $OUT/*.pdf (para LaTeX) y privado/previsualizaciones/*.png (para revisar)"
