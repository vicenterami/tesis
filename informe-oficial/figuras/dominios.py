#!/usr/bin/env python3
"""Deriva los diagramas por dominio del modelo de datos desde DOS fuentes: el ER completo que sale de la base
(modelo-datos.mmd) y la tabla «Dominios del modelo» de docs/08, que es la única fuente del dominio de cada tabla.

Escribe en la carpeta dada:
  dominios.mmd         cuerpo del informe: un flowchart con un subgraph por dominio, solo entidades y claves foráneas
  modelo-<slug>.mmd    anexo: un erDiagram por dominio con las columnas de sus tablas; las tablas de otros dominios a las
                       que apunta una clave foránea aparecen sin columnas (el slug sale del nombre del dominio)
  modelo-<slug>-<n>.mmd  si la celda de tablas de un dominio tiene grupos separados por «;», una figura por grupo (un dominio
                       de muchas columnas no cabe legible en una sola: cada grupo es una parte del mismo dominio)
  modelo-anexo.tex     las figuras del anexo (un \\begin{figure} por archivo anterior; el pie sale de la columna «De qué se ocupa» de docs/08)

Sale 1 y dice qué falla si una tabla de la base no tiene dominio, tiene dos, o un dominio nombra una tabla que no existe.
Uso: dominios.py <modelo-datos.mmd> <docs/08-modelo-datos.md> <carpeta_salida>
"""
import re
import sys
import unicodedata
from pathlib import Path

er = Path(sys.argv[1]).read_text()
doc = Path(sys.argv[2]).read_text()
out = Path(sys.argv[3])

# --- ER completo (lo que dice la base): tablas con sus columnas y claves foráneas (hija -> padre)
cols: dict[str, list[str]] = {}
for m in re.finditer(r"^    (\w+) \{\n(.*?)\n    \}$", er, re.S | re.M):
    cols[m.group(1)] = m.group(2).split("\n")
rels = sorted(set(re.findall(r"^    (\w+) \|\|--o\{ (\w+) : \w+$", er, re.M)))  # (padre, hija)
tablas = set(cols)
assert tablas and rels, "el ER de la base no trae tablas o relaciones: ¿cambió el formato de er-mermaid.sql?"

# --- Reparto en dominios (docs/08): única fuente
sec = re.search(r"^### Dominios del modelo\n(.*?)(?=^## |^### )", doc, re.S | re.M)
if not sec:
    sys.exit("FALLA docs/08 no tiene la sección «Dominios del modelo»")
filas3 = re.findall(r"^\| \*\*(.+?)\*\* \| (.+?) \| (.+) \|$", sec.group(1), re.M)
# Cada fila de datos (empieza por «| **») debe haberse leído: una con espacios de más, fin de línea de Windows o un formato roto no se descarta en silencio.
n_filas = len(re.findall(r"^\| \*\*", sec.group(1), re.M))
if n_filas != len(filas3):
    leidas = {n for n, _, _ in filas3}
    sys.exit(f"FALLA docs/08 «Dominios del modelo»: {n_filas} filas «| **…» y solo {len(filas3)} legibles (forma esperada: «| **Dominio** | `tabla`, `tabla` | texto |»; sin leer: "
             + ", ".join(l[:40] for l in re.findall(r"^\| \*\*.*$", sec.group(1), re.M) if not any(l.startswith(f"| **{n}** |") for n in leidas)) + ")")
filas = [(n, c) for n, c, _ in filas3]
que_hace = {n: t for n, _, t in filas3}
if not filas:
    sys.exit("FALLA la sección «Dominios del modelo» de docs/08 no tiene filas «| **Dominio** | `tablas` | … |»")


def slug(n: str) -> str:
    n = unicodedata.normalize("NFD", n.lower())
    return re.sub(r"[^a-z0-9]+", "-", "".join(c for c in n if not unicodedata.combining(c))).strip("-")


dominios: dict[str, list[str]] = {}
partes: dict[str, list[list[str]]] = {}
for nombre, celda in filas:
    if nombre in dominios:
        sys.exit(f"FALLA el dominio «{nombre}» aparece dos veces en docs/08")
    partes[nombre] = [re.findall(r"`(\w+)`", g) for g in celda.split(";")]
    for g, ts in zip(celda.split(";"), partes[nombre]):
        if not ts:
            sys.exit(f"FALLA docs/08: el dominio «{nombre}» tiene una parte sin tablas (¿un «;» de más?)")
        resto = re.sub(r"`\w+`", "", g).replace(",", "").strip()
        if resto:
            sys.exit(f"FALLA docs/08: el dominio «{nombre}» tiene texto que no es una tabla entre comillas invertidas: «{resto[:40]}»")
    dominios[nombre] = [t for g in partes[nombre] for t in g]
dueño: dict[str, list[str]] = {}
for d, ts in dominios.items():
    for t in ts:
        dueño.setdefault(t, []).append(d)

malos = []
malos += [f"la tabla {t} de la base no tiene dominio en docs/08" for t in sorted(tablas - set(dueño))]
malos += [f"la tabla {t} está en dos dominios en docs/08: {' y '.join(ds)}" for t, ds in sorted(dueño.items()) if len(ds) > 1]
malos += [f"el dominio «{d}» de docs/08 nombra {t}, que no existe en la base" for d, ts in dominios.items() for t in ts if t not in tablas]
if malos:
    sys.exit("FALLA reparto en dominios (docs/08 «Dominios del modelo» vs base):\n  " + "\n  ".join(malos))
dom = {t: ds[0] for t, ds in dueño.items()}

out.mkdir(parents=True, exist_ok=True)

# --- Cuerpo: flowchart con un subgraph por dominio (mermaid erDiagram no agrupa; flowchart sí). Medido el 18/11 con la imagen del
#     proyecto: dagre solapa los grupos y cruza las flechas por encima de las cajas; ELK las ordena. Los dominios se apilan en el orden
#     de docs/08 (aristas invisibles entre ellos) porque en horizontal el diagrama mide ≈ 100 veces la altura de la letra de ancho y
#     queda en ≈ 4 pt; en columna, ≈ 45. Sin mergeEdges: con una flecha por par de dominios ya no hace falta
#     compartir tronco, y cada flecha se sigue de punta a punta. El orden de los recuadros (el de docs/08) pone primero a «Cuentas», cuyas
#     flechas hacia el resto son las que menos rodean el dibujo (medido el 18/11). Letra grande con separaciones fijas: a igual dibujo, la letra sale mayor en el informe.
#     Dentro de un dominio, una flecha por par de tablas relacionadas por clave foránea (el ER de la base hace un SELECT DISTINCT del par: dos
#     claves entre las mismas tablas son una flecha), de la tabla referida (el «uno») a la que la tiene (los «muchos»): la cardinalidad
#     es la misma en todas (||--o{ del ER completo) y se dice en el pie de la figura. Entre dominios, UNA flecha por par (del dominio de la
#     tabla referida al de la que la tiene), de recuadro a recuadro y con las tablas referidas por nombre: 29 flechas de tabla a tabla
#     rodeaban el dibujo por los bordes y no se sabía qué apuntaba a qué (revisión del 18/11). El detalle por tabla está en el anexo.
L = ["---", "config:", "  layout: elk", "  elk:", "    mergeEdges: false", "---",
     '%%{init: {"themeVariables": {"fontSize": "28px"}, "flowchart": {"nodeSpacing": 14, "rankSpacing": 30, "padding": 4}}}%%',
     "flowchart TB"]
for i, (d, ts) in enumerate(dominios.items()):
    L.append(f'    subgraph D{i}["{d}"]')
    L += [f"        {t}" for t in ts]
    L.append("    end")
idx = {d: i for i, d in enumerate(dominios)}
L += [f"    {padre} --> {hija}" for padre, hija in rels if dom[padre] == dom[hija]]
cruces: dict[tuple[str, str], list[str]] = {}
for padre, hija in rels:
    if dom[padre] != dom[hija]:
        cruces.setdefault((dom[padre], dom[hija]), []).append(padre)
for (dp, dh), ps in cruces.items():
    L.append(f'    D{idx[dp]} -- "{", ".join(sorted(set(ps)))}" --> D{idx[dh]}')
L += [f"    D{i} ~~~ D{i + 1}" for i in range(len(dominios) - 1)]
(out / "dominios.mmd").write_text("\n".join(L) + "\n")

# --- Anexo: un erDiagram por dominio (o por parte), con columnas solo las tablas propias.
#     Medido el 18/11 con la imagen del proyecto: el diseño ELK con las tablas en columnas o en filas según la figura (ORIENTACION) y
#     sin texto en las relaciones (el nombre de la tabla hija, que repetía lo que ya dice la caja) es el que más estrecha el dibujo.
#     Una orientación que ya no sea la mejor tras un cambio de esquema no rompe nada: la letra estimada que imprime generar-figuras.sh
#     lo dice.
ORIENTACION = {"modelo-cuentas-y-sesion-1": "LR", "modelo-cuentas-y-sesion-2": "LR", "modelo-recepcion-y-mediciones": "LR"}   # el resto, TB
for d, grupos in partes.items():
    for k, ts in enumerate(grupos, 1):
        propias = set(ts)
        # claves foráneas que llegan a una tabla propia: la otra punta, si es de otro dominio o de otra parte, va sin columnas
        rr = [(p, h) for p, h in rels if h in propias]
        ajenas = sorted({p for p, h in rr if p not in propias})
        nombre = f"modelo-{slug(d)}" + (f"-{k}" if len(grupos) > 1 else "")
        E = ["---", "config:", "  layout: elk", "  er:", "    entityPadding: 6", "    minEntityWidth: 60", "---", "erDiagram"]
        if ORIENTACION.get(nombre) == "LR":
            E.append("    direction LR")
        E += [f'    {p} ||--o{{ {h} : ""' for p, h in rr]
        for t in sorted(propias):
            E += [f"    {t} {{", *cols[t], "    }"]
        E += [f"    {t}" for t in ajenas]
        E += [f"    style {t} fill:#F2F4F3,stroke:#55635B,stroke-dasharray:4 3" for t in ajenas]
        (out / f"{nombre}.mmd").write_text("\n".join(E) + "\n")

# --- El anexo del informe: una figura por archivo, con el pie sacado de docs/08 (así el texto tampoco tiene una segunda fuente)
def tex(t: str) -> str:
    return t.replace("\\", r"\textbackslash{}").replace("_", r"\_").replace("%", r"\%").replace("&", r"\&")


def tt(ts: list[str]) -> str:
    return ", ".join(r"\texttt{" + tex(t) + "}" for t in ts)


T = ["% Generado por informe-oficial/figuras/dominios.py (lo llama generar-figuras.sh) desde el ER de la base y la tabla «Dominios del modelo»",
     "% de docs/08. No editar a mano: lo comprueba generar-figuras.sh --verificar.", ""]
for d, grupos in partes.items():
    for k, ts in enumerate(grupos, 1):
        nombre = f"modelo-{slug(d)}" + (f"-{k}" if len(grupos) > 1 else "")
        parte = f" (parte {k} de {len(grupos)})" if len(grupos) > 1 else ""
        ajenas = sorted({p for p, h in rels if h in set(ts) and p not in set(ts)})
        resto = (" Con borde punteado y sin columnas, las tablas a las que apuntan claves foráneas de estas y que se dibujan en otra figura: "
                 + tt(ajenas) + ".") if ajenas else ""
        T += [r"\begin{figure}[!htbp]", r"\centering",
              r"\includegraphics[width=\linewidth,height=0.82\textheight,keepaspectratio]{figuras/render/" + nombre + ".pdf}",
              r"\caption[Modelo de datos: " + tex(d) + parte + "]{Modelo de datos, dominio «" + tex(d) + "»" + parte + ". "
              + (tex(que_hace[d].rstrip(".")) + ". " if k == 1 else "") + "Tablas de esta figura: " + tt(ts) + "." + resto + "}",
              r"\label{fig:" + nombre + "}", r"\end{figure}", ""]
(out / "modelo-anexo.tex").write_text("\n".join(T))
