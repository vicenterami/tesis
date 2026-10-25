#!/usr/bin/env bash
# Vigila, durante una corrida larga, las condiciones que el nodo real necesita para seguir llegando al portátil (docs/16, TT-32):
# que la IP y la red Wi-Fi del portátil sigan siendo las del arranque, que la puerta de enlace no cambie, que el proxy siga escuchando
# en esa IP (8883), que el backend responda `/salud`, que el inhibidor de suspensión siga vivo y que haya corriente. Cada cambio se
# registra con hora y se avisa en el escritorio (notify-send, si existe); cada 10 min escribe una línea «OK» para dejar constancia de que
# vigiló. Solo lee; no corrige nada: el remedio (regrabar secretos.h, recrear el proxy, volver a la red) es de la persona.
# La IP, la puerta de enlace y el nombre de la red se comparan con los del arranque, pero NO se escriben en el registro, la
# terminal ni las notificaciones: lo que se pega de una corrida termina en documentos (docs/17 §6.2, qué imprime el nodo).
#   bash plataforma/pruebas/vigilar-corrida.sh privado/corridas/<fecha>-vigilancia.log [intervalo_s=60]
# El registro va a privado/ o con extensión .log (ambos ignorados por git) y se crea legible solo por su dueño.
# El inhibidor que se vigila es uno cuyo «quién» contiene «corrida», lanzado en otra terminal:
#   systemd-inhibit --what=handle-lid-switch:sleep:idle --who="corrida larga" --why="nodo reportando al portátil" --mode=block sleep 26h
# /salud se pide en 127.0.0.1:3000, que publica docker-compose.override.yml (otro destino: VIGILAR_SALUD_URL).
# Para probarlo: VIGILAR_VUELTAS=3 limita el número de vueltas (si no, corre hasta Ctrl+C).
set -uo pipefail
umask 077
REG=${1:?uso: vigilar-corrida.sh <archivo de registro> [intervalo_s]}; INT=${2:-60}
[[ "$INT" =~ ^[1-9][0-9]{0,4}$ ]] || { echo "FALLA el intervalo debe ser un entero de segundos mayor que 0, sin ceros a la izquierda"; exit 1; }
SALUD_URL=${VIGILAR_SALUD_URL:-http://127.0.0.1:3000/salud}
mkdir -p "$(dirname "$REG")" || exit 1
IFAZ=$(ip -4 route show default | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1); exit}')
[ -n "$IFAZ" ] || { echo "FALLA no hay ruta por defecto (¿sin red?)"; exit 1; }
ip_actual()   { ip -4 -o addr show "$IFAZ" | awk '{print $4}' | cut -d/ -f1 | head -1; }
gw_actual()   { ip -4 route show default | awk '{print $3; exit}'; }
ssid_actual() { nmcli -t -f GENERAL.CONNECTION dev show "$IFAZ" 2>/dev/null | cut -d: -f2; }
# El proxy escucha en la IP del arranque o en todas (PROXY_IP_DISPOSITIVOS=0.0.0.0, proxy/compose.proxy.yml); -F: los puntos de la IP, literales.
proxy_escucha() { ss -ltn 2>/dev/null | awk '{print $4}' | grep -qxF -e "$1:8883" -e "0.0.0.0:8883" -e "*:8883"; }
salud_ok()    { curl -s -m 5 "$SALUD_URL" 2>/dev/null | grep -q '"estado":"ok"'; }
# Solo el inhibidor de la corrida: GNOME pone otro de handle-lid-switch con un monitor externo, y ese no cuenta.
inhibidor()   { systemd-inhibit --list --no-pager 2>/dev/null | grep 'handle-lid-switch' | grep -q 'corrida'; }
enchufado()   { cat /sys/class/power_supply/AC*/online 2>/dev/null | grep -q 1; }
avisar() { echo "$(date -Is) ALERTA $*" | tee -a "$REG"; command -v notify-send >/dev/null && notify-send -u critical "Corrida 24 h" "$*" 2>/dev/null; printf '\a'; }
IP0=$(ip_actual); GW0=$(gw_actual); SSID0=$(ssid_actual)
[ -n "$IP0" ] || { echo "FALLA la interfaz $IFAZ no tiene IPv4"; exit 1; }
{ echo "$(date -Is) INICIO interfaz=$IFAZ intervalo=${INT}s (IP, puerta y red anotadas para comparar, no se registran)"; } | tee -a "$REG"
vuelta=0; ultimo_ok=0
while :; do
  vuelta=$((vuelta+1)); fallas=()
  ip=$(ip_actual); gw=$(gw_actual); ssid=$(ssid_actual)
  # Los valores no se escriben: solo el hecho (si hay uno nuevo, se consulta a mano con ip o nmcli).
  if [ "$ip" != "$IP0" ]; then
    if [ -n "$ip" ]; then fallas+=("la IP del portátil cambió (verla con: ip -4 addr): regrabar secretos.h y recrear el proxy")
    else fallas+=("el portátil se quedó sin IP en $IFAZ"); fi
  fi
  if [ "$ssid" != "$SSID0" ]; then
    if [ -n "$ssid" ]; then fallas+=("la red Wi-Fi cambió (verla con: nmcli dev)"); else fallas+=("el portátil no está en ninguna red Wi-Fi"); fi
  fi
  if [ "$gw" != "$GW0" ]; then
    if [ -n "$gw" ]; then fallas+=("la puerta de enlace cambió"); else fallas+=("no hay puerta de enlace (sin ruta por defecto)"); fi
  fi
  proxy_escucha "$IP0"   || fallas+=("el proxy no escucha en la IP del arranque, puerto 8883 (¿se recreó sin PROXY_IP_DISPOSITIVOS?)")
  salud_ok               || fallas+=("el backend no responde /salud con estado ok")
  inhibidor              || fallas+=("no hay inhibidor de suspensión de la corrida vivo (el systemd-inhibit de la cabecera)")
  enchufado              || fallas+=("sin corriente: el portátil está en batería")
  if [ ${#fallas[@]} -gt 0 ]; then for f in "${fallas[@]}"; do avisar "$f"; done
  elif [ $((vuelta - ultimo_ok)) -ge $((600 / INT)) ] || [ "$vuelta" -eq 1 ]; then
    echo "$(date -Is) OK ip=igual red=igual puerta=igual proxy=8883 salud=ok inhibidor=sí corriente=sí" | tee -a "$REG"; ultimo_ok=$vuelta
  fi
  [ -n "${VIGILAR_VUELTAS:-}" ] && [ "$vuelta" -ge "$VIGILAR_VUELTAS" ] && break
  sleep "$INT"
done
