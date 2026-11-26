#!/usr/bin/env bash
# Prueba del resumen de la ventana de 72 horas (resumen.sh; LEEME.md de esta carpeta; docs/16 §104). Arma CSV sintéticos de la sonda, el
# emisor y los confirmados en una carpeta temporal y exige, caso por caso, la salida, el texto y el NÚMERO de minutos no disponibles. NO
# toca la base: el camino de la consulta (--sitio) se prueba con un `docker` falso en el PATH que devuelve una salida de psql conocida
# (todos presentes, falta uno, sobran ajenos, vacía). Correrla antes de arrancar una medición; también la corre el verificador.
#   bash plataforma/pruebas/ventana/resumen-prueba.sh            (o RESUMEN=<otro resumen.sh> para plantar una versión anterior)
# Sale 0 si todos los casos dan lo esperado, 1 si alguno no y 3 si falta python3.
set -u
AQUI=$(cd "$(dirname "$0")" && pwd)
RESUMEN="${RESUMEN:-$AQUI/resumen.sh}"
command -v python3 >/dev/null || { echo "omitida: falta python3"; exit 3; }
T=$(mktemp -d "${TMPDIR:-/tmp}/resumen-prueba.XXXXXX") || exit 1
trap 'rm -rf "$T"' EXIT
# docker falso: a `docker compose exec … psql …` le responde con el archivo de $FALSO_PSQL (lo que psql imprimiría); nada más.
mkdir -p "$T/bin"
printf '%s\n' '#!/usr/bin/env bash' 'case " $* " in *" psql "*) cat "${FALSO_PSQL:?}"; exit 0 ;; esac' 'echo "docker falso: orden no prevista" >&2; exit 1' > "$T/bin/docker"
chmod +x "$T/bin/docker"

# Generador: gen <carpeta> <minutos> '<opciones JSON>'. Inicio 2026-11-01 00:00Z. El equipo j publica una vez por minuto a los 6·j s; cada
# mensaje confirmado deja una marca (equipo, ms) en confirmados.csv y suma en emisor.csv. Opciones: equipos (10), conf (equipos con marca
# por minuto), env (enviados por minuto), conectados, mudo (equipos que nunca confirman), artefacto ([minuto, equipo]: su marca pasa al
# minuto siguiente, que queda con dos; artefactos: una lista de esos), atraso ([desde el minuto, equipo, segundos]: el temporizador del equipo se atrasa esos segundos
# desde ese minuto, como un setInterval que acumula atraso), quitar y duplicar ([[minuto, equipo], …]: una marca menos o repetida tal
# cual), em_doble (minutos con dos líneas en emisor.csv: un reinicio), espera ([[minuto, equipo, ms], …]: el PUBACK de esa marca llega esos
# ms después del envío; por omisión, 40 ms), malos / dobles / vacio / faltan_sonda / frescura (como antes),
# sonda_desde y em_desde (primer
# minuto con línea; negativo = antes del inicio), emisor ('ok'|'none'), conf_csv ('ok'|'vacio'|'corto'|'none'), nan_en, periodo,
# psql ('todos'|'vacio'|'falta_uno'|'ajenos').
gen() {
  python3 -I - "$@" <<'PY'
import json, os, sys
from datetime import datetime, timedelta, timezone
d, mins, op = sys.argv[1], int(sys.argv[2]), json.loads(sys.argv[3])
os.makedirs(d, exist_ok=True)
t0 = datetime(2026, 11, 1, tzinfo=timezone.utc)
svc = ['timescaledb', 'mosquitto', 'backend', 'proxy', 'emisor']
cj = lambda k: set(op.get(k, []))
malos, dobles, vacio, faltan = cj('malos'), cj('dobles'), cj('vacio'), cj('faltan_sonda')
with open(f'{d}/sonda.csv', 'w') as f:
    f.write('hora_utc,salud_codigo,salud_ms,frescura_s,disco_libre_mib' + ''.join(f',{s}_estado,{s}_salud,{s}_reinicios,{s}_arriba_s,{s}_mem_mib' for s in svc) + '\n')
    for i in range(op.get('sonda_desde', 0), mins):
        if i in faltan: continue
        t = t0 + timedelta(minutes=i, seconds=1)
        def linea(ok, vac=False):
            st, sa = ('', '') if vac else ('running', 'healthy')
            return f"{t:%Y-%m-%dT%H:%M:%SZ},{'200' if ok else '000'},{12 if ok else ''},{op.get('frescura', 60)},50000" + ''.join(f',{st},{sa},0,{i * 60},100.0' for s in svc) + '\n'
        if i in vacio: f.write(linea(True, True))
        elif i in dobles: f.write(linea(False)); f.write(linea(True))
        else: f.write(linea(i not in malos))
eq = op.get('equipos', 10); conf = op.get('conf', eq); env = op.get('env', eq); con = op.get('conectados', eq); per = op.get('periodo', 60)
mudo = cj('mudo'); atr = op.get('atraso')
arts = {tuple(x) for x in op.get('artefactos', [])} | ({tuple(op['artefacto'])} if op.get('artefacto') else set())
quitar = {tuple(x) for x in op.get('quitar', [])}; duplicar = {tuple(x) for x in op.get('duplicar', [])}
espera = {(x[0], x[1]): x[2] for x in op.get('espera', [])}
marcas = {}
for i in range(op.get('em_desde', 0), mins):
    t = t0 + timedelta(minutes=i)
    for j in range(conf):
        if j in mudo or (i, j) in quitar: continue
        ms = int((t + timedelta(seconds=6 * j)).timestamp() * 1000)
        if (i, j) in arts: ms += 60000 + 3000   # cruza el borde: cae en el minuto siguiente, que queda con dos
        if atr and i >= atr[0] and j == atr[1]: ms += atr[2] * 1000   # temporizador atrasado
        lleg = ms + espera.get((i, j), 40)
        marcas.setdefault((ms // 60000) * 60000, []).append((f'e{j:02d}', ms, lleg))
        if (i, j) in duplicar: marcas[(ms // 60000) * 60000].append((f'e{j:02d}', ms, lleg))
lineas = [m for k in sorted(marcas) for m in marcas[k]]
if op.get('emisor', 'ok') != 'none':
    with open(f'{d}/emisor.csv', 'w') as fe:
        fe.write('hora_utc,enviados,confirmados,reconexiones,conectados,en_vuelo,equipos,periodo_s\n')
        for i in range(op.get('em_desde', 0), mins):
            t = t0 + timedelta(minutes=i); k = int(t.timestamp() * 1000)
            c = 'nan' if i == op.get('nan_en') else str(len(marcas.get(k, [])))
            fe.write(f"{t:%Y-%m-%dT%H:%M:%SZ},{env},{c},0,{con},0,{eq},{per}\n")
            if i in set(op.get('em_doble', [])): fe.write(f"{t:%Y-%m-%dT%H:%M:%SZ},0,0,0,{con},0,{eq},{per}\n")
modo = op.get('conf_csv', 'ok')
if modo != 'none':
    with open(f'{d}/confirmados.csv', 'w') as fc:
        if modo == 'ok': sel = lineas
        elif modo == 'corto': sel = lineas[:len(lineas) // 2]
        else: sel = []
        fc.writelines(f'{e},{ms},{ll}\n' for e, ms, ll in sel)
pm = op.get('psql', 'todos')
with open(f'{d}/psql.txt', 'w') as fp:
    sel = [] if pm == 'vacio' else lineas[1:] if pm == 'falta_uno' else list(dict.fromkeys(lineas))
    fp.writelines(f'{e} {ms}\n' for e, ms, _ in sel)
    if pm == 'ajenos': fp.writelines(f'otro-{j} {ms + 1}\n' for j, (_, ms, _) in enumerate(lineas[:500]))
    fp.write(f'resumen {eq} {2 * len(sel)} 0\n')
PY
}

pasan=0; total=0
# caso <nombre> <salida> <texto que debe aparecer> <texto que NO debe aparecer o -> <minutos no disponibles o -> <minutos> '<opciones>' <args…>
caso() {
  local nombre="$1" esperada="$2" debe="$3" nodebe="$4" nodisp="$5" mins="$6" op="$7"; shift 7
  local d="$T/$nombre" salida r obt
  gen "$d" "$mins" "$op"
  salida=$(FALSO_PSQL="$d/psql.txt" PATH="$T/bin:$PATH" bash "$RESUMEN" --datos "$d" "$@" 2>&1); r=$?
  obt=$(grep -oE '^\| Minutos no disponibles \| [0-9]+' <<<"$salida" | grep -oE '[0-9]+$')
  total=$((total+1))
  if [ "$r" = "$esperada" ] && grep -qF -- "$debe" <<<"$salida" && { [ "$nodebe" = - ] || ! grep -qF -- "$nodebe" <<<"$salida"; } \
     && { [ "$nodisp" = - ] || [ "$obt" = "$nodisp" ]; }; then
    pasan=$((pasan+1)); echo "OK    $nombre: salida $r, «$debe»$([ "$nodisp" = - ] || echo ", $obt no disponibles")"
  else
    echo "FALLA $nombre: esperaba salida $esperada, «$debe»$([ "$nodebe" = - ] || echo ", sin «$nodebe»")$([ "$nodisp" = - ] || echo ", $nodisp no disponibles"); obtuvo salida $r, ${obt:-?} no disponibles: $(grep -E 'Veredicto|Resultado|SIN VEREDICTO|NO CUBRE|FALLA' <<<"$salida" | head -2 | tr '\n' ' ' | cut -c1-160)"
  fi
}
B=(--desde 2026-11-01T00:00Z --horas 72 --equipos 10 --sitio prueba)
rango() { python3 -I -c "import json,sys; print(json.dumps(list(range(int(sys.argv[1]), int(sys.argv[2])))))" "$1" "$2"; }

# Aprueba o no, por la regla (el camino de la base, con el docker falso).
caso limpio-72h               0 '**APRUEBA**'                 - 0    4320 '{}' "${B[@]}"
caso marca-que-cruza-el-borde 0 '**APRUEBA**'                 - 1    4320 '{"artefacto": [1000, 3]}' "${B[@]}"
caso temporizador-atrasado    0 '**APRUEBA**'                 - 1    4320 '{"atraso": [2000, 9, 7]}' "${B[@]}"
caso patron-0-2-1             0 '**NO APRUEBA**'              - 1440 4320 "{\"artefactos\": $(python3 -I -c 'import json; print(json.dumps([[m, 4] for m in range(0, 4320, 3)]))')}" "${B[@]}"
caso linea-repetida-afuera    0 '**APRUEBA**'                 - 1    4380 '{"quitar": [[4319, 5]], "duplicar": [[4320, 5]]}' "${B[@]}"
caso reinicio-del-emisor      0 '**APRUEBA**'                 - 0    4320 '{"em_doble": [1500]}' "${B[@]}"
caso reinicio-con-perdida     0 '**APRUEBA**'                 - 1    4320 '{"em_doble": [1500], "quitar": [[1500, 2]], "duplicar": [[1501, 2]]}' "${B[@]}"
caso borde-43-de-4320         0 '**APRUEBA**'                 - 43   4320 "{\"malos\": $(rango 100 143)}" "${B[@]}"
caso borde-44-de-4320         0 '**NO APRUEBA**'              - 44   4320 "{\"malos\": $(rango 100 144)}" "${B[@]}"
caso base-sin-guardados       0 'faltan 43200 mensajes'       '**APRUEBA**' 0 4320 '{"psql": "vacio"}' "${B[@]}"
caso base-falta-uno           0 'faltan 1 mensajes'           '**APRUEBA**' 0 4320 '{"psql": "falta_uno"}' "${B[@]}"
caso base-sobran-ajenos       0 '**APRUEBA**'                 - 0    4320 '{"psql": "ajenos"}' "${B[@]}"
caso dato-atrasado            0 '**NO APRUEBA**'              - 4320 4320 '{"frescura": 9000}' "${B[@]}"
caso emisor-1-hora            0 '**NO APRUEBA**'              - 4260 4320 '{"em_desde": 4260}' "${B[@]}"
caso uno-de-diez-confirmado   0 '**NO APRUEBA**'              - 4320 4320 '{"conf": 1}' "${B[@]}"
caso nueve-y-ocho-por-minuto  0 '**NO APRUEBA**'              - 4320 4320 '{"env": 9, "conf": 8}' "${B[@]}"
caso un-equipo-mudo           0 '**NO APRUEBA**'              - 4320 4320 '{"mudo": [4]}' "${B[@]}"
caso equipos-desconectados    0 '**NO APRUEBA**'              - 4320 4320 '{"conectados": 9}' "${B[@]}"
caso linea-buena-y-mala       0 '300 minuto(s) con más de una línea' '**APRUEBA**' 300 4320 "{\"dobles\": $(rango 1000 1300)}" "${B[@]}"
caso estado-vacio             0 '**NO APRUEBA**'              - 50   4320 "{\"vacio\": $(rango 500 550)}" "${B[@]}"
caso planeadas-no-descuentan  0 '**NO APRUEBA**'              - 50   4320 "{\"malos\": $(python3 -I -c 'import json; print(json.dumps(list(range(600,640))+list(range(1200,1210))))')}" "${B[@]}" --planeada 2026-11-01T10:00Z --planeada 2026-11-01T20:00Z
caso hueco-en-medio           0 '**NO APRUEBA**'              - 50   4320 "{\"faltan_sonda\": $(rango 2000 2050)}" "${B[@]}"
caso 100-horas-60-seguidos    0 'la peor de las 1681 posibles' '**APRUEBA**' 60 6000 "{\"malos\": $(rango 3000 3060)}" --desde 2026-11-01T00:00Z --horas 100 --equipos 10 --sitio prueba
caso emisor-antes-de-la-sonda 0 '**APRUEBA**'                 'FUERA DE LA VENTANA' 0 4350 '{"sonda_desde": 30}' --desde 2026-11-01T00:30Z --horas 72 --equipos 10 --sitio prueba
# Sin veredicto (salida 3), o ensayo, o error de uso.
caso un-solo-equipo           3 'SIN VEREDICTO'               '**APRUEBA**' - 4320 '{"equipos": 1}' "${B[@]}"
caso sin-emisor-csv           3 'no hay emisor.csv'           '**APRUEBA**' - 4320 '{"emisor": "none"}' "${B[@]}"
caso sin-confirmados-csv      3 'no hay confirmados.csv'      '**APRUEBA**' - 4320 '{"conf_csv": "none"}' "${B[@]}"
caso confirmados-vacio        3 'no trae ninguna confirmación' '**APRUEBA**' - 4320 '{"conf_csv": "vacio"}' "${B[@]}"
caso confirmados-corto        3 'no cuadra con emisor.csv'    '**APRUEBA**' - 4320 '{"conf_csv": "corto"}' "${B[@]}"
caso valor-no-numerico        3 'valor no válido'             '**APRUEBA**' - 4320 '{"nan_en": 77}' "${B[@]}"
caso periodo-mayor-a-60       3 'período ≤ 60 s'              '**APRUEBA**' - 4320 '{"periodo": 120}' "${B[@]}"
caso guardados-a-mano         3 'se dio a mano'               '**APRUEBA**' - 4320 '{}' --desde 2026-11-01T00:00Z --horas 72 --equipos 10 --guardados 43200
caso sin-guardados-ni-sitio   3 'no hay guardados'            '**APRUEBA**' - 4320 '{}' --desde 2026-11-01T00:00Z --horas 72 --equipos 10
caso sonda-con-horas-previas  0 '**APRUEBA**'                 - 0    4500 '{}' --desde 2026-11-01T03:00Z --horas 72 --equipos 10 --sitio prueba
caso mejores-72-de-80-horas   0 '**NO APRUEBA**'              - 0    4800 "{\"malos\": $(rango 0 480)}" --desde 2026-11-01T08:00Z --horas 72 --equipos 10 --sitio prueba
caso mejores-72-con-motivo    0 '**NO APRUEBA**'              - 0    4800 "{\"malos\": $(rango 0 480)}" --desde 2026-11-01T08:00Z --horas 72 --equipos 10 --sitio prueba --fuera-motivo '.'
caso horas-previas-con-nota   0 'Nota: «la sonda se arrancó 3 h antes para comprobarla»' - 0 4500 '{}' --desde 2026-11-01T03:00Z --horas 72 --equipos 10 --sitio prueba --fuera-motivo 'la sonda se arrancó 3 h antes para comprobarla'
caso sonda-despues-del-fin    0 '**APRUEBA**'                 - 0    4500 '{}' "${B[@]}"
caso ensayo-previo-con-hueco  0 'Corrida anterior, no juzgada' 'NO APRUEBA' 0 4320 "{\"sonda_desde\": -180, \"em_desde\": -180, \"faltan_sonda\": $(rango -120 0)}" "${B[@]}"
caso ensayo-dos-dias-antes    0 'Corrida anterior, no juzgada' 'NO APRUEBA' 0 4320 "{\"sonda_desde\": -2880, \"em_desde\": -5, \"faltan_sonda\": $(rango -2870 0)}" "${B[@]}"
caso corte-30-s-en-un-minuto  0 '**APRUEBA**'                 - 1    4320 "{\"espera\": $(python3 -I -c 'import json; print(json.dumps([[1000, j, 35000 - 6000 * (j - 2)] for j in range(2, 7)]))')}" "${B[@]}"
caso confirmacion-a-tiempo    0 '**APRUEBA**'                 - 0    4320 "{\"espera\": $(python3 -I -c 'import json; print(json.dumps([[1000, j, 4000] for j in range(10)]))')}" "${B[@]}"
caso ventana-de-1-hora        0 'sin veredicto del requisito' '**APRUEBA**' 0 60 '{}' --desde 2026-11-01T00:00Z --horas 1 --equipos 10 --sitio prueba
caso criticos-recortados      2 'no puede quitar'             '**APRUEBA**' - 4320 '{}' "${B[@]}" --criticos backend
caso sin-equipos              2 'falta --equipos'             '**APRUEBA**' - 4320 '{}' --desde 2026-11-01T00:00Z --horas 72 --sitio prueba
caso sonda-empieza-tarde      1 'NO CUBRE LA VENTANA PEDIDA'  '**APRUEBA**' 10 4320 "{\"faltan_sonda\": $(rango 0 10)}" "${B[@]}"

echo
[ "$pasan" = "$total" ] && echo "RESUMEN DE LA VENTANA: $pasan de $total casos" || { echo "$((total - pasan)) de $total casos con falla"; exit 1; }
