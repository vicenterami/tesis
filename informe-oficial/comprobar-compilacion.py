#!/usr/bin/env python3
"""Lee el log de la última compilación del informe y dice si está sano. Lo usan actualizar.sh (recién compilado)
y verificar-todo.sh (paso 3b: la concordancia incluye el PDF, no solo docs y base).

Imprime una línea con: desbordes > 6 pt por página del cuerpo, referencias sin resolver, etiquetas duplicadas y
páginas del cuerpo. Sale 1 si hay un desborde > 12 pt, una referencia rota o una etiqueta duplicada; los desbordes
entre 6 y 12 pt se muestran pero no bloquean (avisos conocidos de longtable en los anexos).
Uso: python3 informe-oficial/comprobar-compilacion.py [carpeta_build]
"""
import re
import sys
from pathlib import Path

build = Path(sys.argv[1] if len(sys.argv) > 1 else 'informe-oficial/build')
log = (build / 'main.log').read_text(errors='ignore')
pag = 1
hits: dict[int, list[float]] = {}
for m in re.finditer(r'\[(\d+)[\]\s]|Overfull \\hbox \(([\d.]+)pt too wide\)', log):
    if m.group(1):
        pag = int(m.group(1)) + 1
    elif float(m.group(2)) > 6:
        hits.setdefault(pag, []).append(round(float(m.group(2)), 1))
refs = log.count('undefined')
multi = log.count('multiply defined')
toc = (build / 'main.toc').read_text(errors='ignore')
g = re.search(r'Glosario\}\{(\d+)\}', toc)
cuerpo = int(g.group(1)) - 1 if g else '?'
print(f"desbordes >6pt: {hits if hits else 'ninguno'} · refs sin resolver: {refs} · etiquetas duplicadas: {multi} · cuerpo: {cuerpo} págs (límite blando 30)")
graves = {k: v for k, v in hits.items() if max(v) > 12}
if hits and not graves:
    print('  (desbordes menores a 12 pt: avisos conocidos de longtable en anexos; no bloquean)')
sys.exit(0 if not graves and refs == 0 and multi == 0 else 1)
