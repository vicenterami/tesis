"""Tabla y CSV de la figura de la comparación medida, a partir de los datos crudos (docs/23 §7.2). Solo lee <carpeta>/*/resultado.json.

  python3 -I tabla.py CARPETA_DATOS SALIDA [--pilotos] [--corridas ARCHIVO]

Escribe SALIDA/tabla.md (una fila por plataforma, fila y tamaño: aprueba k de n, lista en s, puntos guardados/esperados, memoria mediana y
máxima muestreada en S1 y S2, motivos de cada corrida que no aprobó) y SALIDA/figura.csv (una fila por corrida). Sin --pilotos, las corridas
marcadas como piloto se excluyen; con --pilotos SOLO entran los pilotos (nunca se mezclan). Los MiB son descripción, no veredicto.
Con --corridas (el registro que deja noche.sh: «plataforma fila RAM repetición id salida» por línea) entran SOLO las corridas de ese plan,
y la que no dejó resultado.json cuenta como no aprobada con el motivo «no completó»: una corrida que abortó no desaparece del «k de n».
"""
import csv
import glob
import json
import os
import sys


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    datos, salida = sys.argv[1], sys.argv[2]
    pilotos = "--pilotos" in sys.argv
    os.makedirs(salida, exist_ok=True)
    corridas = []
    if "--corridas" in sys.argv:
        for linea in open(sys.argv[sys.argv.index("--corridas") + 1]):
            if not linea.strip():
                continue
            p, fi, ram, rep, ident, rc = linea.split()
            ruta = os.path.join(datos, ident, "resultado.json")
            if ident != "-" and os.path.exists(ruta):
                corridas.append(json.load(open(ruta)))
            else:
                corridas.append({"meta": {"plataforma": p, "fila": fi, "ram_gb": int(ram), "repeticion": int(rep), "piloto": pilotos,
                                          "id": ident if ident != "-" else f"{p}-{fi}-{ram}g-r{rep} (sin id)"},
                                 "aprobado": False, "lista_s": None, "escenarios": {}, "memoria": {},
                                 "motivos": [f"no completó: no dejó resultado.json (corrida.sh salió con {rc})"]})
    else:
        for ruta in sorted(glob.glob(os.path.join(datos, "*", "resultado.json"))):
            r = json.load(open(ruta))
            if bool(r["meta"].get("piloto")) != pilotos:
                continue
            corridas.append(r)
    if not corridas:
        print("no hay corridas " + ("piloto" if pilotos else "válidas") + f" en {datos}")
        return 1

    def m(r, e, k):
        x = (r.get("memoria") or {}).get(e)
        return x.get(k) if x else None

    with open(os.path.join(salida, "figura.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["plataforma", "fila", "ram_gb", "repeticion", "piloto", "aprobado", "lista_s", "mem_total_mib",
                    "s1_mediana_mib", "s1_max_mib", "s2_mediana_mib", "s2_max_mib", "s1_guardado_pct", "s2_guardado_pct", "id"])
        for r in corridas:
            me = r["meta"]
            e = r["escenarios"]
            w.writerow([me["plataforma"], me["fila"], me["ram_gb"], me["repeticion"], me.get("piloto", False), r["aprobado"], r["lista_s"],
                        m(r, "toda_la_corrida", "mem_total_mib"), m(r, "s1", "usada_mediana_mib"), m(r, "s1", "usada_max_muestreada_mib"),
                        m(r, "s2", "usada_mediana_mib"), m(r, "s2", "usada_max_muestreada_mib"),
                        e.get("s1", {}).get("guardado_pct"), e.get("s2", {}).get("guardado_pct"), me["id"]])

    grupos = {}
    for r in corridas:
        me = r["meta"]
        grupos.setdefault((me["plataforma"], me["fila"], me["ram_gb"]), []).append(r)
    L = ["| Plataforma | Fila | RAM | Aprueba | Lista (s) | S1 puntos | S2 puntos | S1 MiB mediana / máx. | S2 MiB mediana / máx. |",
         "|---|---|---|---|---|---|---|---|---|"]
    notas = []
    for (p, fi, ram), rs in sorted(grupos.items()):
        rs.sort(key=lambda r: r["meta"]["repeticion"])
        k = sum(r["aprobado"] for r in rs)

        def lista(campo, fmt=str):
            return " · ".join(fmt(campo(r)) for r in rs)

        def pts(e):
            return lambda r: (f"{r['escenarios'][e]['puntos_guardados_distintos']}/{r['escenarios'][e]['puntos_esperados']}"
                              if e in r["escenarios"] else "—")

        def mem(e):
            return lambda r: (f"{m(r, e, 'usada_mediana_mib'):.0f} / {m(r, e, 'usada_max_muestreada_mib'):.0f}"
                              if m(r, e, "usada_mediana_mib") is not None else "—")
        L.append(f"| {p} | {fi.upper()} | {ram} GB | {k} de {len(rs)} | {lista(lambda r: r['lista_s'] if r['lista_s'] is not None else '—')} | {lista(pts('s1'))} | "
                 f"{lista(pts('s2'))} | {lista(mem('s1'))} | {lista(mem('s2'))} |")
        for r in rs:
            if not r["aprobado"]:
                notas.append(f"- {r['meta']['id']}: {'; '.join(r['motivos'])}")
    texto = ["# Comparación medida" + (" — PILOTOS (no son resultados)" if pilotos else ""), "",
             "Generada por `tabla.py` desde los `resultado.json` de cada corrida. Varios valores en una celda: uno por repetición, en orden.",
             "MiB = MemTotal − MemAvailable de la máquina, mediana y máximo muestreado cada 1 s (el máximo es una cota inferior). Descriptivo.", ""]
    texto += L
    if notas:
        texto += ["", "Corridas que no aprobaron:"] + notas
    open(os.path.join(salida, "tabla.md"), "w").write("\n".join(texto) + "\n")
    print("\n".join(texto))
    return 0


if __name__ == "__main__":
    sys.exit(main())
