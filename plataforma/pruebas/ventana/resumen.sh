#!/usr/bin/env bash
# Resumen de la ventana de 72 horas (LEEME.md de esta carpeta; docs/16 §104): de sonda.csv, emisor.csv y confirmados.csv saca la tabla para
# el informe y, si la ventana es de 72 horas o más, el veredicto de RNF-18.
#   bash resumen.sh --datos <carpeta> --desde <ISO UTC> (--hasta <ISO UTC> | --horas <N>) --equipos <N> (--sitio <código> | --guardados <N>)
#                   [--planeada <ISO UTC>]… [--fuera-motivo «texto»] [--plataforma <carpeta con el compose de la pila>]
#                   [--umbral-frescura <s>] [--umbral-disco <MiB>] [--criticos «servicio …»]
# Escribe en <carpeta>: resumen.md (Markdown para pegar en docs/16; también a la salida estándar) y memoria.csv (memoria por servicio y total
# de la plataforma por minuto, para la figura). Salidas:
#   0  resumen completo: con veredicto si la ventana tiene 72 h o más (con más, se juzga la PEOR ventana deslizante de 4 320 minutos y se
#      dice cuál); con menos, «ensayo del instrumento: sin veredicto del requisito»;
#   1  la sonda no cubre la ventana pedida: sin veredicto (el resumen se escribe igual, con los minutos sin línea como no disponibles);
#   2  error de uso (falta --equipos, o se intentó quitar el broker o la base de --criticos);
#   3  sin veredicto: falta emisor.csv o confirmados.csv, o no tienen las columnas o el formato esperados, o traen valores que no son
#      números; el emisor no tiene equipos, son más o menos que --equipos, o su período pasa de 60 s; confirmados.csv está vacío o no cuadra
#      con emisor.csv; lo guardado se dio a mano (--guardados) o no se pudo consultar; o la sonda tiene líneas más de 2 minutos fuera de la
#      ventana sin --fuera-motivo. Con varias causas a la vez, manda la 3.
# Regla de DISPONIBLE (la misma que dicen docs/02, RNF-18, el LEEME.md y docs/16 §104). Un minuto UTC de la ventana es disponible solo si:
#   1. tiene al menos una línea de la sonda y TODAS sus líneas cumplen 2, 3 y 5 (si hay más de una, manda la peor; se avisa cuántas hubo);
#   2. /salud respondió 200 a través del proxy;
#   3. los servicios críticos están arriba y sanos (por omisión y como mínimo, el broker y la base: «mosquitto timescaledb»);
#   4. hay línea del emisor para ese minuto, con TODOS sus equipos conectados y a lo más 1 mensaje en vuelo al cerrarlo, y CADA equipo tiene
#      en confirmados.csv un mensaje confirmado con marca de tiempo en ese minuto (o es el artefacto de borde: le falta en este minuto y
#      tiene dos en el minuto vecino, porque su temporizador cruzó el borde);
#   5. los datos llegan: la frescura del último dato del sitio (vista pública) existe y no pasa de --umbral-frescura (480 s).
# Tolerancias, con su fundamento. En vuelo al cerrar el minuto: 1 mensaje (los equipos publican desfasados período / equipos, 6 s con 10
# equipos cada 60 s, y un PUBACK tarda milisegundos: en el instante del borde cabe a lo más uno). Presupuesto TOTAL de marcas faltantes en la
# ventana: 2 por equipo (uno en cada extremo: el mensaje de un equipo puede caer justo fuera de la ventana por el desfase de su temporizador);
# es decir, confirmados con marca en la ventana ≥ equipos × minutos − 2 × equipos. Consistencia: las marcas de la ventana y la suma de
# confirmados de emisor.csv en esos minutos difieren a lo más en 2 × equipos (los mismos bordes: emisor.csv cuenta por el minuto del PUBACK y
# confirmados.csv por la marca del mensaje), y no pueden ser 0.
# Umbral de frescura: ultimo_dato es el inicio del tramo de 5 min de la lectura más reciente y la respuesta se guarda 60 s, así que con
# datos al día queda entre 0 y unos 420 s; 480 s deja un minuto de margen. Una frescura vacía (sin respuesta o sin dato) no es disponible.
# Además, el veredicto exige que lo GUARDADO cubra lo CONFIRMADO: cada mensaje confirmado (confirmados.csv: equipo y marca de tiempo, escrito
# en el instante del PUBACK) con marca de tiempo en la ventana debe estar en `medicion` (--sitio: consulta de solo lectura, uno por uno, por
# equipo y marca de tiempo). Tolerancia 0: los dos lados se atribuyen por la marca de tiempo del mensaje. Con --guardados N (un número dado a
# mano: para la prueba y un ensayo sin base) se compara la cantidad y NO hay veredicto. El veredicto se calcula con enteros (aprueba si los
# minutos no disponibles de la ventana de 72 h juzgada son a lo más el 1 % redondeado hacia abajo, 43 de 4 320, no se pasa el presupuesto
# de marcas y no falta ningún confirmado en la base); el porcentaje se muestra truncado.
# La ventana es la PEDIDA, nunca la que la sonda alcanzó a escribir. Fuera de ella cuentan solo los minutos con línea de la sonda: si la
# sonda escribió más de 2 minutos antes del inicio o después del fin, no hay veredicto salvo que --fuera-motivo declare por qué (el motivo
# queda escrito en el resumen). Las líneas del emisor fuera de la ventana no cuentan (arranca antes que la sonda y se detiene después).
# --planeada (repetible) marca una caída provocada: se le atribuye solo un incidente que EMPIEZA entre su minuto y dos minutos después, con
# su tiempo de detección; si no hay, se dice. Las caídas planeadas NO se descuentan. Detener el emisor antes del resumen.
set -u
export LC_ALL=C
DATOS=""; SITIO=""; DESDE=""; HASTA=""; HORAS=""; PLANEADAS=(); GUARDADOS=""; UMBRAL=480; UMBRAL_DISCO=1024; CRITICOS="mosquitto timescaledb"
EQUIPOS=""; MOTIVO_FUERA=""
PLAT="$(cd "$(dirname "$0")/../.." && pwd)"
uso() { sed -n '4,6p' "$0" | sed 's/^# *//'; exit 2; }
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || uso
  case "$1" in
    --datos) DATOS=$2 ;; --sitio) SITIO=$2 ;; --desde) DESDE=$2 ;; --hasta) HASTA=$2 ;; --horas) HORAS=$2 ;;
    --planeada) PLANEADAS+=("$2") ;; --guardados) GUARDADOS=$2 ;; --plataforma) PLAT=$2 ;; --criticos) CRITICOS=$2 ;;
    --umbral-frescura) UMBRAL=$2 ;; --umbral-disco) UMBRAL_DISCO=$2 ;; --equipos) EQUIPOS=$2 ;; --fuera-motivo) MOTIVO_FUERA=$2 ;;
    *) uso ;;
  esac
  shift 2
done
[ -n "$DATOS" ] && [ -s "$DATOS/sonda.csv" ] || { echo "FALLA no encuentro $DATOS/sonda.csv (--datos <carpeta>)"; exit 2; }
command -v python3 >/dev/null || { echo "FALLA falta python3: copia los CSV al portátil y corre el resumen allí con --guardados N"; exit 2; }
FECHA='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?Z$'
[ -n "$DESDE" ] || { echo "FALLA falta --desde: el instante UTC en que empezó la ventana (no se toma de la primera línea de la sonda)"; exit 2; }
if [ -n "$HORAS" ]; then
  [ -z "$HASTA" ] || { echo "FALLA --hasta o --horas, no los dos"; exit 2; }
  [[ "$HORAS" =~ ^[0-9]+$ ]] && [ "$HORAS" -ge 1 ] || { echo "FALLA --horas debe ser un entero positivo"; exit 2; }
fi
[ -n "$HASTA" ] || [ -n "$HORAS" ] || { echo "FALLA falta --hasta (o --horas): el instante UTC en que terminó la ventana"; exit 2; }
[[ "$EQUIPOS" =~ ^[1-9][0-9]*$ ]] || { echo "FALLA falta --equipos N: cuántos equipos publica el emisor (debe coincidir con lo que escribe en emisor.csv)"; exit 2; }
for v in "$DESDE" "$HASTA" "${PLANEADAS[@]}"; do
  [ -z "$v" ] || [[ "$v" =~ $FECHA ]] || { echo "FALLA fecha «$v»: AAAA-MM-DDTHH:MM[:SS]Z (UTC)"; exit 2; }
done
INI=$(date -u -d "$DESDE" +%Y-%m-%dT%H:%M:00Z) || exit 2
if [ -n "$HORAS" ]; then FIN=$(date -u -d "$INI + $HORAS hours" +%Y-%m-%dT%H:%M:00Z) || exit 2
else FIN=$(date -u -d "$HASTA" +%Y-%m-%dT%H:%M:00Z) || exit 2; fi
[ "$(date -u -d "$FIN" +%s)" -gt "$(date -u -d "$INI" +%s)" ] || { echo "FALLA la ventana no tiene minutos (--hasta debe ser posterior a --desde)"; exit 2; }
[ -z "$GUARDADOS" ] || [[ "$GUARDADOS" =~ ^[0-9]+$ ]] || { echo "FALLA --guardados debe ser un entero"; exit 2; }
[[ "$UMBRAL" =~ ^[0-9]+$ ]] || { echo "FALLA --umbral-frescura debe ser un entero de segundos"; exit 2; }
[[ "$UMBRAL_DISCO" =~ ^[0-9]+$ ]] || { echo "FALLA --umbral-disco debe ser un entero de MiB"; exit 2; }
[[ "$CRITICOS" =~ ^[a-z0-9_-]+(\ [a-z0-9_-]+)*$ ]] || { echo "FALLA --criticos: nombres de servicio separados por un espacio"; exit 2; }
for s in mosquitto timescaledb; do
  [[ " $CRITICOS " == *" $s "* ]] || { echo "FALLA --criticos no puede quitar «$s»: el broker y la base son críticos siempre (se pueden agregar otros)"; exit 2; }
done

# Lo guardado en la base: solo lectura, por equipo y marca de tiempo (ms), con marca de tiempo en [INI, FIN). Va a un archivo temporal.
GUARD=""; BASE_RES=""
if [ -z "$GUARDADOS" ] && [ -n "$SITIO" ]; then
  [[ "$SITIO" =~ ^[a-z0-9][a-z0-9-]{1,62}$ ]] || { echo "FALLA código de sitio inválido"; exit 2; }
  GUARD=$(mktemp) || exit 2; trap 'rm -f "$GUARD"' EXIT
  if (cd "$PLAT" && docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA -q -F ' ' -v sitio="$SITIO" -v ini="$INI" -v fin="$FIN" <<'SQL'
BEGIN READ ONLY;
SELECT DISTINCT d.id_fisico, round(extract(epoch FROM m.tiempo) * 1000)::bigint
  FROM medicion m JOIN canal c ON c.id = m.canal_id JOIN dispositivo d ON d.id = c.dispositivo_id
  JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id
 WHERE s.codigo = :'sitio' AND m.tiempo >= :'ini'::timestamptz AND m.tiempo < :'fin'::timestamptz;
SELECT 'resumen', (SELECT count(*) FROM dispositivo d JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo = :'sitio'),
       (SELECT count(*) FROM medicion m JOIN canal c ON c.id = m.canal_id JOIN dispositivo d ON d.id = c.dispositivo_id JOIN zona z ON z.id = d.zona_id
         JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo = :'sitio' AND m.tiempo >= :'ini'::timestamptz AND m.tiempo < :'fin'::timestamptz),
       (SELECT count(*) FROM cuarentena q JOIN dispositivo d ON d.id = q.dispositivo_id JOIN zona z ON z.id = d.zona_id JOIN sitio s ON s.id = z.sitio_id WHERE s.codigo = :'sitio');
COMMIT;
SQL
  ) > "$GUARD" 2>&1; then BASE_RES=sitio
  else echo "AVISO no se pudo consultar la base: $(head -c 200 "$GUARD")"; : > "$GUARD"; fi
fi

python3 -I - "$DATOS" "$INI" "$FIN" "$GUARDADOS" "$GUARD" "$BASE_RES" "$SITIO" "$UMBRAL" "$UMBRAL_DISCO" "$CRITICOS" "$EQUIPOS" "$MOTIVO_FUERA" "${PLANEADAS[@]}" <<'PY'
import csv, math, os, re, statistics, sys
from datetime import datetime, timezone, timedelta
datos, desde, hasta, guardados, ruta_guard, base_res, sitio, umbral, umbral_disco, criticos, equipos_arg, motivo_fuera = sys.argv[1:13]
planeadas = sys.argv[13:]; N = int(equipos_arg)
umbral = int(umbral); umbral_disco = int(umbral_disco); criticos = criticos.split()
UN_MIN = timedelta(minutes=1); TOL = 1; MIN_72H = 72 * 60
ENTERO = re.compile(r'^[0-9]+$')
def t(s):
    s = (s or '').strip()
    if not s: return None
    f = '%Y-%m-%dT%H:%M:%SZ' if s.count(':') == 2 else '%Y-%m-%dT%H:%MZ'
    try: return datetime.strptime(s, f).replace(tzinfo=timezone.utc)
    except ValueError: return None
def minuto(d): return d.replace(second=0, microsecond=0)
def h(d): return d.strftime('%Y-%m-%d %H:%M') + 'Z'
def num(x):   # solo números finitos: «nan», «inf» o texto cuentan como ausentes
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError): return None
def p95(xs):
    xs = sorted(xs)
    return xs[math.ceil(0.95 * len(xs)) - 1] if xs else None
def pct(a, b): return f'{math.floor(10000 * a / b) / 100:.2f}' if b else '—'
sin_veredicto = []   # motivos de la salida 3

ini = t(desde); fin_excl = t(hasta)
grilla = []
m = ini
while m < fin_excl: grilla.append(m); m += UN_MIN
total = len(grilla); fin = grilla[-1]; en_ventana = lambda d: ini <= d <= fin

# ── Sonda ──
with open(os.path.join(datos, 'sonda.csv'), newline='') as f:
    todas = [r for r in csv.DictReader(f) if r.get('hora_utc')]
for r in todas: r['_t'] = t(r['hora_utc'])
todas = [r for r in todas if r['_t'] is not None]
servicios = [c[:-len('_estado')] for c in (todas[0].keys() if todas else []) if c.endswith('_estado')]
plataforma = [s for s in servicios if s != 'emisor']
por_min_todo = {}
for r in todas: por_min_todo.setdefault(minuto(r['_t']), []).append(r)
primera = min(por_min_todo) if por_min_todo else None
ultima = max(por_min_todo) if por_min_todo else None
cubre = bool(todas) and primera <= ini and ultima >= fin
filas = [r for r in todas if en_ventana(minuto(r['_t']))]
por_min = {k: v for k, v in por_min_todo.items() if en_ventana(k)}
dobles = sum(1 for v in por_min.values() if len(v) > 1)
def sano(r, s): return r.get(f'{s}_estado') == 'running' and r.get(f'{s}_salud') in ('healthy', 'sin_chequeo')
def fresca(r):
    v = num(r.get('frescura_s'))
    return v is not None and v <= umbral
def linea_ok(r): return r.get('salud_codigo') == '200' and all(sano(r, s) for s in criticos) and fresca(r)
def sonda_ok(mm, tabla): return bool(tabla.get(mm)) and all(linea_ok(r) for r in tabla[mm])

# ── Emisor: emisor.csv (una línea por minuto) y confirmados.csv (una por mensaje confirmado) ──
COLS = ['hora_utc', 'enviados', 'confirmados', 'reconexiones', 'conectados', 'en_vuelo', 'equipos', 'periodo_s']
em_min_todo = {}; periodo = None; equipos_n = None
ruta_em = os.path.join(datos, 'emisor.csv')
if not (os.path.exists(ruta_em) and os.path.getsize(ruta_em) > 0):
    sin_veredicto.append('no hay emisor.csv (o está vacío)')
else:
    with open(ruta_em, newline='') as f:
        lector = csv.DictReader(f)
        if [c for c in COLS if c not in (lector.fieldnames or [])]:
            sin_veredicto.append(f'emisor.csv no trae las columnas {", ".join(c for c in COLS if c not in (lector.fieldnames or []))} (¿emisor anterior?)')
        else:
            for n_linea, r in enumerate(lector, 2):
                d = t(r.get('hora_utc'))
                malos = [c for c in COLS[1:] if not ENTERO.match((r.get(c) or '').strip())]
                if d is None or malos:
                    sin_veredicto.append(f'emisor.csv, línea {n_linea}: valor no válido en {", ".join(malos) or "hora_utc"}'); break
                x = em_min_todo.setdefault(minuto(d), {'enviados': 0, 'confirmados': 0, 'reconexiones': 0, 'conectados': None, 'en_vuelo': 0, 'equipos': 0})
                for k in ('enviados', 'confirmados', 'reconexiones'): x[k] += int(r[k])
                x['conectados'] = int(r['conectados']) if x['conectados'] is None else min(x['conectados'], int(r['conectados']))
                x['en_vuelo'] = max(x['en_vuelo'], int(r['en_vuelo'])); x['equipos'] = max(x['equipos'], int(r['equipos']))
                periodo = int(r['periodo_s']) if periodo is None else max(periodo, int(r['periodo_s']))
                equipos_n = int(r['equipos']) if equipos_n is None else max(equipos_n, int(r['equipos']))
if periodo is not None and periodo > 60:
    sin_veredicto.append(f'el emisor publica cada {periodo} s: el resumen exige un envío por equipo y minuto (período ≤ 60 s)')
if equipos_n == 0: sin_veredicto.append('el emisor no tiene equipos')
elif equipos_n is not None and any(x['equipos'] != N for x in em_min_todo.values()):
    sin_veredicto.append(f'el emisor escribe {sorted({x["equipos"] for x in em_min_todo.values()})} equipos y --equipos dice {N}')
em_min = {k: v for k, v in em_min_todo.items() if en_ventana(k)}

conf_set = set(); marcas = {}; ids = set()
ruta_conf = os.path.join(datos, 'confirmados.csv')
if not os.path.exists(ruta_conf):
    sin_veredicto.append('no hay confirmados.csv (el emisor lo escribe junto a emisor.csv)')
else:
    for n_linea, linea in enumerate(open(ruta_conf), 1):
        linea = linea.strip()
        if not linea: continue
        mt = re.fullmatch(r'([A-Za-z0-9][A-Za-z0-9._-]{0,62}),([0-9]{10,16})', linea)
        if not mt: sin_veredicto.append(f'confirmados.csv, línea {n_linea}: no es «equipo,marca_ms»'); break
        bt = datetime.fromtimestamp(int(mt.group(2)) / 1000, tz=timezone.utc)
        if (mt.group(1), int(mt.group(2))) in conf_set: continue
        ids.add(mt.group(1)); k = (mt.group(1), minuto(bt)); marcas[k] = marcas.get(k, 0) + 1
        if ini <= bt < fin_excl: conf_set.add((mt.group(1), int(mt.group(2))))
conf = len(conf_set)
if len(ids) > N: sin_veredicto.append(f'confirmados.csv trae {len(ids)} equipos distintos y --equipos dice {N}')
suma_em = sum(x['confirmados'] for x in em_min.values())
if os.path.exists(ruta_conf) and em_min_todo:
    if conf == 0: sin_veredicto.append('confirmados.csv no trae ninguna confirmación en la ventana')
    elif abs(conf - suma_em) > 2 * N:
        sin_veredicto.append(f'confirmados.csv ({conf} en la ventana) no cuadra con emisor.csv ({suma_em}): la diferencia pasa de 2 × {N} (los bordes)')
def faltan_marcas(mm):   # equipos sin marca en el minuto, salvo el artefacto de borde (dos marcas en un minuto vecino)
    f = sum(1 for e in ids if marcas.get((e, mm), 0) == 0 and marcas.get((e, mm - UN_MIN), 0) < 2 and marcas.get((e, mm + UN_MIN), 0) < 2)
    return f + max(0, N - len(ids))
def emisor_ok(mm, tabla):
    x = tabla.get(mm)
    if x is None or not x['equipos']: return False
    return x['conectados'] == x['equipos'] and x['en_vuelo'] <= TOL and faltan_marcas(mm) == 0
presupuesto = N * total - 2 * N
fuera_presupuesto = max(0, presupuesto - conf)

# ── Guardados ──
msjs = None; faltan = None; lect = nd = cuar = None
if base_res == 'sitio':
    db_set = set()
    for linea in open(ruta_guard):
        p = linea.split()
        if len(p) == 4 and p[0] == 'resumen': nd, lect, cuar = int(p[1]), int(p[2]), int(p[3])
        elif len(p) == 2 and ENTERO.match(p[1]): db_set.add((p[0], int(p[1])))
    msjs = len(db_set); faltan = len(conf_set - db_set)
elif guardados:
    msjs = int(guardados); faltan = max(0, conf - msjs)
    sin_veredicto.append('lo guardado se dio a mano (--guardados): sirve para la prueba y un ensayo sin base, no para el veredicto; usar --sitio')
else:
    sin_veredicto.append('no hay guardados: --sitio (consulta de solo lectura) o --guardados N')

# ── Disponibilidad ──
def disponible(mm, tabla_s, tabla_e): return sonda_ok(mm, tabla_s) and emisor_ok(mm, tabla_e)
estado = [(mm, disponible(mm, por_min, em_min)) for mm in grilla]
ok = sum(1 for _, d in estado if d); no = total - ok
sin_linea = sum(1 for mm in grilla if mm not in por_min)
tope = total // 100
ok_emisor = sum(1 for mm in grilla if emisor_ok(mm, em_min))
sin_em = sum(1 for mm in grilla if mm not in em_min)
ok_salud = sum(1 for mm in grilla if por_min.get(mm) and all(r.get('salud_codigo') == '200' for r in por_min[mm]))
es_72h = total >= MIN_72H
# Con más de 72 h se juzga la PEOR ventana deslizante de 4 320 minutos (una caída no se diluye en una ventana más larga).
peor_no, peor_ini = no, ini
if total > MIN_72H:
    malos = [0 if d else 1 for _, d in estado]
    s = sum(malos[:MIN_72H]); peor_no, peor_ini = s, grilla[0]
    for k in range(MIN_72H, total):
        s += malos[k] - malos[k - MIN_72H]
        if s > peor_no: peor_no, peor_ini = s, grilla[k - MIN_72H + 1]
tope = MIN_72H // 100 if total >= MIN_72H else total // 100
aprueba = peor_no <= tope and (faltan or 0) == 0 and fuera_presupuesto == 0

# Fuera de la ventana: solo los minutos con línea de la sonda (el emisor arranca antes y se detiene después, a propósito).
fuera = sorted(k for k in por_min_todo if not en_ventana(k))
fuera_no = sum(1 for k in fuera if not disponible(k, por_min_todo, em_min_todo))
antes = [k for k in fuera if k < ini]; despues = [k for k in fuera if k > fin]
lejos = [k for k in fuera if k < ini - 2 * UN_MIN or k > fin + 2 * UN_MIN]
if lejos and not motivo_fuera.strip():
    sin_veredicto.append(f'la sonda tiene {len(lejos)} minuto(s) con línea a más de 2 minutos de la ventana pedida, sin --fuera-motivo')

def causa(ms):
    partes = []
    faltan_s = sum(1 for mm in ms if mm not in por_min)
    if faltan_s: partes.append(f'{faltan_s} min sin línea de la sonda')
    codigos = sorted({r['salud_codigo'] for mm in ms for r in por_min.get(mm, []) if r.get('salud_codigo') != '200'})
    if codigos: partes.append('salud ' + '/'.join(c if c != '000' else 'sin respuesta' for c in codigos))
    caidos = sorted({s for mm in ms for r in por_min.get(mm, []) for s in plataforma if not sano(r, s)})
    if caidos: partes.append('servicios no sanos: ' + ', '.join(caidos))
    nf = sum(1 for mm in ms if por_min.get(mm) and not all(fresca(r) for r in por_min[mm]))
    if nf: partes.append(f'{nf} min con el dato atrasado o sin frescura')
    ne = sum(1 for mm in ms if not emisor_ok(mm, em_min))
    if ne: partes.append(f'{ne} min con el emisor sin línea, con equipos desconectados o sin la confirmación de algún equipo')
    return '; '.join(partes) or 'sin datos'
incidentes = []; racha = []
for mm, d in estado + [(None, True)]:
    if not d: racha.append(mm)
    elif racha: incidentes.append(racha); racha = []
notas = {}; sin_incidente = []
for i, p in enumerate(planeadas, 1):
    tp = t(p)
    cands = [k for k, r in enumerate(incidentes) if k not in notas and minuto(tp) <= r[0] <= minuto(tp) + 2 * UN_MIN]
    if not cands: sin_incidente.append(tp); continue
    k = cands[0]
    vistas = [x['_t'] for mm in incidentes[k] for x in por_min.get(mm, []) if not linea_ok(x) and x['_t'] >= tp]
    det = f'detectada a los {(min(vistas) - tp).total_seconds():.0f} s' if vistas else 'la sonda no vio el problema: solo el emisor'
    notas[k] = f'caída provocada {i} de {len(planeadas)} ({h(tp)}); {det}'

salud_ms = [num(r['salud_ms']) for r in filas if r.get('salud_codigo') == '200' and num(r.get('salud_ms')) is not None]
fres = [(r['_t'], num(r['frescura_s'])) for r in filas if num(r.get('frescura_s')) is not None]
fres_altos = [x for x in fres if x[1] > umbral]
mem = {s: [num(r.get(f'{s}_mem_mib')) for r in filas if num(r.get(f'{s}_mem_mib')) is not None] for s in servicios}
totales = []
for r in filas:
    vs = [num(r.get(f'{s}_mem_mib')) for s in plataforma]
    if all(v is not None for v in vs): totales.append(sum(vs))
def reinicios(s):
    rc = [int(num(r.get(f'{s}_reinicios'))) for r in filas if num(r.get(f'{s}_reinicios')) is not None]
    vistos = [a for a in (num(r.get(f'{s}_arriba_s')) for r in filas) if a is not None]
    return (max(rc) - min(rc) if rc else None), sum(1 for a, b in zip(vistos, vistos[1:]) if b < a)
disco = [num(r['disco_libre_mib']) for r in filas if num(r.get('disco_libre_mib')) is not None]
disco_bajo = [r for r in filas if num(r.get('disco_libre_mib')) is not None and num(r['disco_libre_mib']) < umbral_disco]
env = sum(x['enviados'] for x in em_min.values()); conf_min = sum(x['confirmados'] for x in em_min.values())
recon = sum(x['reconexiones'] for x in em_min.values())

o = []
o.append(f'**Ventana pedida:** {h(ini)} a {h(fin_excl)} ({total} minutos); la sonda escribió {len(filas)} líneas en ella.\n')
if lejos:
    o.append(f'**FUERA DE LA VENTANA PEDIDA HAY LÍNEAS DE LA SONDA:** {len(antes)} minuto(s) antes del inicio ({len(antes) / 60:.1f} h) y'
             f' {len(despues)} después del fin ({len(despues) / 60:.1f} h); de esos {len(fuera)} minutos, **{fuera_no} no eran disponibles**.'
             + (f' Motivo declarado: «{motivo_fuera.strip()}».' if motivo_fuera.strip() else ' Sin --fuera-motivo no hay veredicto: la ventana no se elige a conveniencia.') + '\n')
elif fuera:
    o.append(f'La sonda escribió {len(fuera)} minuto(s) en los 2 minutos de borde fuera de la ventana (arranque y cierre): no cuentan.\n')
if not cubre:
    o.append(f'**NO CUBRE LA VENTANA PEDIDA:** la sonda empieza después del inicio o termina antes del fin (primera línea '
             f'{h(primera) if primera else "ninguna"}, última {h(ultima) if ultima else "ninguna"}); los minutos sin línea cuentan como no disponibles.\n')
if dobles:
    o.append(f'**AVISO:** {dobles} minuto(s) con más de una línea de la sonda (¿dos sondas a la vez?); en cada uno mandó la peor.\n')
for mot in sin_veredicto:
    o.append(f'**SIN VEREDICTO:** {mot}.\n')
o.append('| Medida | Valor |')
o.append('|---|---|')
o.append(f'| **Disponibilidad** (regla completa: sonda con /salud 200, {" y ".join(criticos)} sanos y el dato al día; emisor con todos sus equipos conectados y la confirmación de cada uno en el minuto) | {ok} de {total} (**{pct(ok, total)} %**) |')
if sin_veredicto:
    o.append(f'| **Veredicto RNF-18 (≥ 99 %)** | **SIN VEREDICTO**: {"; ".join(sin_veredicto)} |')
elif not cubre:
    o.append(f'| **Veredicto RNF-18 (≥ 99 %)** | **SIN VEREDICTO**: la sonda no cubre la ventana pedida ({no} minutos no disponibles contando los que no tienen línea) |')
elif not es_72h:
    o.append(f'| **Resultado** | **Ensayo del instrumento: sin veredicto del requisito** (la ventana tiene {total} minutos; RNF-18 pide 72 h, {MIN_72H} minutos). {no} minutos no disponibles |')
else:
    juzgada = f'la ventana de 72 h juzgada es la peor de las {total - MIN_72H + 1} posibles, desde {h(peor_ini)}: ' if total > MIN_72H else ''
    motivo = (f'{juzgada}{peor_no} minutos no disponibles; el 99 % admite {tope} de {MIN_72H}'
              + (f'; **faltan {fuera_presupuesto} marcas de confirmación más allá del presupuesto**' if fuera_presupuesto else '')
              + (f'; **faltan {faltan} mensajes confirmados en la base**' if faltan else '; no falta ningún confirmado en la base'))
    o.append(f'| **Veredicto RNF-18 (≥ 99 %)** | **{"APRUEBA" if aprueba else "NO APRUEBA"}**: {motivo} |')
o.append(f'| Solo el emisor (minutos con su línea, todos los equipos conectados, a lo más {TOL} en vuelo y la marca confirmada de cada equipo) | {ok_emisor} de {total} ({pct(ok_emisor, total)} %); {sin_em} minutos sin línea del emisor |')
o.append(f'| Solo /salud (200 por el proxy en todas las líneas del minuto) | {ok_salud} de {total} ({pct(ok_salud, total)} %) |')
o.append(f'| Minutos no disponibles | {no} (de ellos, {sin_linea} sin línea de la sonda) en {len(incidentes)} incidente(s) |')
o.append(f'| Tiempo de respuesta de /salud | p95 {p95(salud_ms):.0f} ms (rango más cercano); mediana {statistics.median(salud_ms):.0f} ms ({len(salud_ms)} respuestas 200) |' if salud_ms else '| Tiempo de respuesta de /salud | sin respuestas 200 |')
o.append(f'| Frescura del último dato (vista pública) | mediana {statistics.median([x[1] for x in fres]):.0f} s; máxima {max(x[1] for x in fres):.0f} s; {len(fres_altos)} línea(s) sobre {umbral} s; {len(filas) - len(fres)} sin dato |' if fres else '| Frescura del último dato (vista pública) | sin datos |')
for s in servicios:
    rc, saltos = reinicios(s)
    o.append(f'| Memoria de {s} | mediana {statistics.median(mem[s]):.1f} MiB; máxima {max(mem[s]):.1f} MiB; reinicios automáticos {rc}; arranques vistos {saltos} |' if mem[s] else f'| Memoria de {s} | sin datos; reinicios automáticos {rc}; arranques vistos {saltos} |')
if totales:
    o.append(f'| Memoria total de la plataforma ({", ".join(plataforma)}) | mediana {statistics.median(totales):.1f} MiB; máxima **{max(totales):.1f} MiB** (RNF-17: ≤ 2048 MiB) |')
if disco:
    o.append(f'| Disco libre | de {disco[0]:.0f} a {disco[-1]:.0f} MiB (crecimiento del uso: {disco[0] - disco[-1]:.0f} MiB; mínimo {min(disco):.0f} MiB; {len(disco_bajo)} línea(s) bajo {umbral_disco} MiB) |')
if em_min:
    o.append(f'| Emisor: enviados / confirmados en el minuto (PUBACK) | {env} / {conf_min}; reconexiones: {recon}; {equipos_n} equipos cada {periodo} s (una marca por equipo y minuto) |')
o.append(f'| Confirmados con marca de tiempo en la ventana (confirmados.csv) | {conf} de {N * total} esperados ({N} equipos × {total} minutos); presupuesto de faltantes 2 × {N} = {2 * N}: {"dentro" if not fuera_presupuesto else f"**se pasa en {fuera_presupuesto}**"}; emisor.csv suma {suma_em} |')
if msjs is not None:
    origen = f'consulta de solo lectura, sitio {sitio}, {nd} equipos, {lect} lecturas, {cuar} en cuarentena' if base_res == 'sitio' else 'dato entregado a mano'
    o.append(f'| Guardados con marca de tiempo en la ventana ({origen}) | {msjs} mensajes distintos; **{"no falta ningún confirmado" if not faltan else f"faltan {faltan} confirmados"}**'
             + (f' ({msjs - conf} guardados que no constan como confirmados)' if msjs > conf else '') + ' |')
o.append('')
if incidentes:
    o.append('| # | Desde (UTC) | Hasta (UTC) | Minutos | Causa vista en las líneas | Nota |')
    o.append('|---|---|---|---|---|---|')
    for k, r in enumerate(incidentes):
        o.append(f'| {k + 1} | {h(r[0])} | {h(r[-1] + UN_MIN)} | {len(r)} | {causa(r)} | {notas.get(k, "")} |')
else:
    o.append('Sin incidentes: todos los minutos de la ventana fueron disponibles.')
for tp in sin_incidente:
    o.append(f'\nLa caída provocada de {h(tp)} no produjo ningún incidente que empiece en sus dos minutos siguientes.')
if fres_altos:
    o.append('\n' + f'Frescura sobre {umbral} s: ' + ', '.join(f'{h(a)} ({b:.0f} s)' for a, b in fres_altos[:20]) + (' …' if len(fres_altos) > 20 else ''))
if disco_bajo:
    o.append('\n' + f'Disco libre bajo {umbral_disco} MiB (incidente): desde {h(disco_bajo[0]["_t"])}, {len(disco_bajo)} línea(s).')
texto = '\n'.join(o) + '\n'
open(os.path.join(datos, 'resumen.md'), 'w').write(texto)
with open(os.path.join(datos, 'memoria.csv'), 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['hora_utc'] + [f'{s}_mib' for s in servicios] + ['total_plataforma_mib'])
    for r in filas:
        tp_ = [num(r.get(f'{s}_mem_mib')) for s in plataforma]
        w.writerow([r['hora_utc']] + [r.get(f'{s}_mem_mib', '') for s in servicios] + ([f'{sum(tp_):.1f}'] if all(v is not None for v in tp_) else ['']))
sys.stdout.write(texto)
print(f'\n(resumen.md y memoria.csv en {datos})')
if sin_veredicto:
    print('SIN VEREDICTO: ' + '; '.join(sin_veredicto)); sys.exit(3)
if not cubre:
    print(f'FALLA la sonda no cubre la ventana pedida ({h(ini)} a {h(fin_excl)})'); sys.exit(1)
PY
