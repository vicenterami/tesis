"""Conteo y veredicto de UNA corrida de la comparación medida (docs/23 §5.5 y §7). Solo lee los datos crudos de la carpeta de la corrida.

  python3 -I evaluar.py lista CARPETA      instante (ms) en que la plataforma quedó «lista»: el PUBACK del primer mensaje de la sonda que
                                           además está guardado (sus dos magnitudes); vacío si todavía no hay ninguno
  python3 -I evaluar.py corrida CARPETA    escribe CARPETA/resultado.json y lo resume en una línea; sale con 0 si aprueba, 1 si no

Punto = dispositivo × magnitud × instante. Cada mensaje confirmado (PUBACK, QoS 1) vale 2 puntos en todas las plataformas. Se comparan
CONJUNTOS (no totales): faltantes = puntos de mensajes confirmados que no están en la base; ajenos = puntos en la base que no vienen de un
mensaje confirmado (por ejemplo, uno guardado cuyo PUBACK no llegó); repetidos = filas brutas menos distintas.
Aprobado (docs/23 §7.1): lista en 600 s o menos, ni una muerte por memoria (núcleo ni contenedor), ni un reinicio de contenedor, todos los
mensajes enviados confirmados y CERO puntos faltantes en cada escenario. Además, la corrida tiene que haber medido lo que dice: en cada
escenario se envió TODA la carga declarada (dispositivos × instantes de la ventana) con todos los dispositivos conectados al empezar, y
existen las muestras del sistema (también dentro de la ventana de cada escenario) y el estado final de los contenedores; sin eso no hay
cómo afirmar que no hubo muertes por memoria ni reinicios. Los MiB son descriptivos y no entran al veredicto.
"""
import csv
import json
import os
import statistics
import sys

MAGS = ("temperatura", "humedad")


def leer_csv(ruta):
    if not os.path.exists(ruta):
        return []
    with open(ruta, newline="") as f:
        return list(csv.DictReader(f))


def leer_filas(ruta):  # sin cabecera: id,magnitud,ts_ms
    if not os.path.exists(ruta):
        return []
    with open(ruta) as f:
        return [tuple(l.strip().split(",")) for l in f if l.strip()]


def lista(carpeta):
    conf = sorted(leer_csv(os.path.join(carpeta, "sonda", "sonda.csv")), key=lambda r: int(r["puback_ms"]))
    g = {}
    for i, m, ts in leer_filas(os.path.join(carpeta, "sonda", "guardados.csv")):
        g.setdefault(int(ts), set()).add(m)
    for r in conf:
        if set(MAGS) <= g.get(int(r["ts_ms"]), set()):
            return int(r["puback_ms"])
    return None


def escenario(carpeta, nombre):
    d = os.path.join(carpeta, nombre)
    if not os.path.exists(os.path.join(d, "resumen.json")):
        return None
    res = json.load(open(os.path.join(d, "resumen.json")))
    conf = leer_csv(os.path.join(d, "confirmados.csv"))
    esperados = {(r["id"], m, int(r["ts_ms"])) for r in conf for m in MAGS}
    filas = [(i, m, int(ts)) for i, m, ts in leer_filas(os.path.join(d, "guardados.csv"))]
    guardados = set(filas)
    falt = esperados - guardados
    dur_ms = res["ventana_hasta_ms"] - res["ventana_desde_ms"]
    dur_s = dur_ms / 1000
    # La carga declarada: cada dispositivo i publica en los instantes k·P + fase_i de la ventana, con fase_i = round(i/N · P) (generador.mjs).
    n, p = res["dispositivos"], res["periodo_ms"]
    declarados = sum(max(0, -(-(dur_ms - round(i / n * p)) // p)) for i in range(n)) if n and p else 0
    return {
        "dispositivos": res["dispositivos"], "periodo_ms": res["periodo_ms"], "duracion_s": dur_s,
        "ventana_desde_ms": res["ventana_desde_ms"], "ventana_hasta_ms": res["ventana_hasta_ms"],
        "declarados": declarados, "enviados": res["enviados"], "confirmados": res["confirmados"], "sin_confirmar": res["enviados"] - res["confirmados"],
        "mensajes_por_s": round(res["enviados"] / dur_s, 2) if dur_s else None,
        "puntos_esperados": len(esperados), "puntos_guardados_distintos": len(guardados & esperados),
        "filas_brutas": len(filas), "repetidos": len(filas) - len(guardados), "ajenos": len(guardados - esperados),
        "faltantes": len(falt), "faltantes_ejemplo": sorted(falt)[:5],
        "guardado_pct": round(100 * len(guardados & esperados) / len(esperados), 4) if esperados else None,
        "reconexiones": res["reconexiones"], "errores_cliente": res["errores"], "atraso_max_ms": res["atraso_max_ms"],
        "conectados_al_empezar": res["conectados_al_empezar"],
    }


def memoria(carpeta, desde, hasta):
    s = [r for r in leer_csv(os.path.join(carpeta, "muestras", "sistema.csv")) if desde <= int(r["t_ms"]) < hasta]
    if not s:
        return None
    usada = [int(r["mem_usada_kb"]) / 1024 for r in s]
    return {"muestras": len(s), "usada_mediana_mib": round(statistics.median(usada), 1), "usada_max_muestreada_mib": round(max(usada), 1),
            "mem_total_mib": round(int(s[0]["mem_total_kb"]) / 1024, 1),
            "disponible_min_mib": round(min(int(r["mem_disponible_kb"]) for r in s) / 1024, 1),
            "psi_mem_full_s": round((int(s[-1]["psi_mem_full_us"] or 0) - int(s[0]["psi_mem_full_us"] or 0)) / 1e6, 3),
            "psi_cpu_some_s": round((int(s[-1]["psi_cpu_some_us"] or 0) - int(s[0]["psi_cpu_some_us"] or 0)) / 1e6, 3)}


def corrida(carpeta):
    meta = json.load(open(os.path.join(carpeta, "meta.json")))
    t0 = meta["t0_docker_ms"]
    l = lista(carpeta)
    r = {"meta": meta, "lista_ms": l, "lista_s": round((l - t0) / 1000, 1) if l else None, "escenarios": {}, "memoria": {}}
    for e in ("s1", "s2"):
        x = escenario(carpeta, e)
        if x:
            r["escenarios"][e] = x
            r["memoria"][e] = memoria(carpeta, x["ventana_desde_ms"], x["ventana_hasta_ms"])
    sis = leer_csv(os.path.join(carpeta, "muestras", "sistema.csv"))
    oom_nucleo = (int(sis[-1]["oom_kill_total"]) - int(sis[0]["oom_kill_total"])) if sis else None
    cont = leer_csv(os.path.join(carpeta, "muestras", "contenedores.csv"))
    pico, oom_c = {}, {}
    for c in cont:
        if c["memory_peak_b"]:
            pico[c["contenedor"]] = max(pico.get(c["contenedor"], 0), int(c["memory_peak_b"]))
        oom_c[c["contenedor"]] = int(c["oom_kill"] or 0)
    r["memoria"]["pico_por_contenedor_mib"] = {k: round(v / 2**20, 1) for k, v in sorted(pico.items())}
    r["memoria"]["toda_la_corrida"] = memoria(carpeta, 0, 2**62)
    reinicios = {}
    estado_final = leer_csv(os.path.join(carpeta, "estado-final.csv"))
    for c in estado_final:
        reinicios[c["contenedor"]] = {"reinicios": int(c["reinicios"]), "oom": c["oom"] == "true", "estado": c["estado"]}
    r["contenedores"] = reinicios
    r["oom_nucleo"] = oom_nucleo
    r["oom_contenedores"] = sum(oom_c.values())
    motivos = []
    if not l:
        motivos.append("no quedó lista")
    elif r["lista_s"] > 600:
        motivos.append(f"lista en {r['lista_s']} s (> 600)")
    if not sis:
        motivos.append("sin muestras del sistema (no se puede afirmar que no hubo muertes por memoria)")
    if not estado_final:
        motivos.append("sin estado final de los contenedores (no se puede afirmar que no hubo reinicios)")
    if oom_nucleo:
        motivos.append(f"{oom_nucleo} muertes por memoria (núcleo)")
    if r["oom_contenedores"] or any(v["oom"] for v in reinicios.values()):
        motivos.append("muerte por memoria de un contenedor")
    if any(v["reinicios"] for v in reinicios.values()):
        motivos.append("reinicios: " + ", ".join(f"{k} {v['reinicios']}" for k, v in reinicios.items() if v["reinicios"]))
    for e in meta.get("escenarios", ["s1", "s2"]):
        x = r["escenarios"].get(e)
        if not x:
            motivos.append(f"{e} no corrió")
            continue
        if x["enviados"] != x["declarados"]:
            motivos.append(f"{e}: se enviaron {x['enviados']} mensajes de los {x['declarados']} de la carga declarada")
        if x["conectados_al_empezar"] != x["dispositivos"]:
            motivos.append(f"{e}: {x['conectados_al_empezar']} de {x['dispositivos']} dispositivos conectados al empezar")
        if not r["memoria"].get(e):
            motivos.append(f"{e}: sin muestras de memoria en su ventana")
        if x["sin_confirmar"]:
            motivos.append(f"{e}: {x['sin_confirmar']} mensajes sin PUBACK")
        if x["faltantes"]:
            motivos.append(f"{e}: {x['faltantes']} puntos confirmados que no están guardados")
    r["aprobado"] = not motivos
    r["motivos"] = motivos
    json.dump(r, open(os.path.join(carpeta, "resultado.json"), "w"), indent=1, ensure_ascii=False)
    e = r["escenarios"]
    print(f"{meta['id']}: {'APRUEBA' if r['aprobado'] else 'NO APRUEBA'}; lista {r['lista_s']} s; "
          + "; ".join(f"{k}: {v['puntos_guardados_distintos']}/{v['puntos_esperados']} puntos" for k, v in e.items())
          + (f"; motivos: {', '.join(motivos)}" if motivos else ""))
    return 0 if r["aprobado"] else 1


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("lista", "corrida"):
        print(__doc__)
        sys.exit(2)
    if sys.argv[1] == "lista":
        v = lista(sys.argv[2])
        print(v if v else "")
    else:
        sys.exit(corrida(sys.argv[2]))
