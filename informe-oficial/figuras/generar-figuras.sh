#!/usr/bin/env bash
# Genera las figuras del informe desde UNA fuente: los bloques Mermaid de docs/ y, para el modelo de
# datos, el esquema REAL de la base. Renderiza a PDF vectorial con mermaid-cli dentro de Docker
# (nada que instalar). Con --verificar solo comprueba que informe, docs y base siguen coincidiendo.
#
#   bash informe-oficial/figuras/generar-figuras.sh              # regenera todo
#   bash informe-oficial/figuras/generar-figuras.sh --verificar  # guardián: sale 1 si algo difiere
set -euo pipefail
cd "$(dirname "$0")/../.."
MMD=informe-oficial/figuras/mermaid; OUT=informe-oficial/figuras/render
IMG=minlag/mermaid-cli:11.17.0
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# 1) Modelo de datos: desde la base (requiere la pila arriba)
docker compose -f plataforma/docker-compose.yml exec -T timescaledb \
  psql -U plataforma -d plataforma -tA < plataforma/db/pruebas/er-mermaid.sql > "$TMP/modelo-datos.mmd"

# 2) Arquitectura: los seis bloques de docs/10, en su orden
python3 - "$TMP" <<'PY'
import re, sys, pathlib
tmp = pathlib.Path(sys.argv[1])
bloques = re.findall(r"```mermaid\n(.*?)```", pathlib.Path("docs/10-arquitectura.md").read_text(), re.S)
nombres = ["contenedores", "red", "sec-alta", "sec-pipeline", "sec-tiemporeal", "despliegue"]
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

# 3) Copiar fuentes al informe y actualizar docs/08 §3 con el ER real
cp "$TMP"/*.mmd "$MMD/"
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
for f in "$MMD"/*.mmd; do
  n=$(basename "$f" .mmd)
  docker run --rm -u "$(id -u):$(id -g)" -v "$PWD/$MMD:/in" -v "$PWD/$OUT:/out" "$IMG" \
    -i "/in/$n.mmd" -o "/out/$n.pdf" -c /in/tema.json --pdfFit -q
  docker run --rm -u "$(id -u):$(id -g)" -v "$PWD/$MMD:/in" -v "$PWD/privado/previsualizaciones:/out" "$IMG" \
    -i "/in/$n.mmd" -o "/out/$n.png" -c /in/tema.json -w 2000 -b white -q
  echo "render   $n"
done
echo "listo: $OUT/*.pdf (para LaTeX) y privado/previsualizaciones/*.png (para revisar)"
