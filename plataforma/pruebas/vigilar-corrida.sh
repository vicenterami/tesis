#!/usr/bin/env bash
# Vigila, durante una corrida larga, las condiciones que el nodo real necesita para seguir llegando al portátil (docs/16, TT-32):
# que la IP y la red Wi-Fi del portátil sigan siendo las del arranque, que la puerta de enlace no cambie, que el proxy siga escuchando
# en esa IP (8883), que el backend responda `/salud`, que el inhibidor de suspensión siga vivo y que haya corriente. Cada cambio se
# registra con hora y se avisa en el escritorio (notify-send, si existe); cada 10 min escribe una línea «OK» para dejar constancia de que
# vigiló. Solo lee; no corrige nada: el remedio (regrabar secretos.h, recrear el proxy, volver a la red) es de la persona.
#   bash plataforma/pruebas/vigilar-corrida.sh <registro> [intervalo_s=60]
# Para probarlo: VIGILAR_VUELTAS=3 limita el número de vueltas (si no, corre hasta Ctrl+C).
set -uo pipefail
REG=${1:?uso: vigilar-corrida.sh <archivo de registro> [intervalo_s]}; INT=${2:-60}
[[ "$INT" =~ ^[0-9]{1,5}$ ]] || { echo "FALLA el intervalo debe ser un entero en segundos"; exit 1; }
mkdir -p "$(dirname "$REG")" || exit 1
IFAZ=$(ip -4 route show default | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1); exit}')
[ -n "$IFAZ" ] || { echo "FALLA no hay ruta por defecto (¿sin red?)"; exit 1; }
ip_actual()   { ip -4 -o addr show "$IFAZ" | awk '{print $4}' | cut -d/ -f1 | head -1; }
gw_actual()   { ip -4 route show default | awk '{print $3; exit}'; }
ssid_actual() { nmcli -t -f GENERAL.CONNECTION dev show "$IFAZ" 2>/dev/null | cut -d: -f2; }
proxy_escucha() { ss -ltn 2>/dev/null | awk '{print $4}' | grep -qx "$1:8883"; }
salud_ok()    { curl -s -m 5 http://127.0.0.1:3000/salud 2>/dev/null | grep -q '"estado":"ok"'; }
inhibidor()   { systemd-inhibit --list --no-pager 2>/dev/null | grep -q 'handle-lid-switch'; }
enchufado()   { cat /sys/class/power_supply/AC*/online 2>/dev/null | grep -q 1; }
avisar() { echo "$(date -Is) ALERTA $*" | tee -a "$REG"; command -v notify-send >/dev/null && notify-send -u critical "Corrida 24 h" "$*" 2>/dev/null; printf '\a'; }
IP0=$(ip_actual); GW0=$(gw_actual); SSID0=$(ssid_actual)
[ -n "$IP0" ] || { echo "FALLA la interfaz $IFAZ no tiene IPv4"; exit 1; }
{ echo "$(date -Is) INICIO interfaz=$IFAZ ip=$IP0 puerta=$GW0 red=$SSID0 intervalo=${INT}s"; } | tee -a "$REG"
vuelta=0; ultimo_ok=0
while :; do
  vuelta=$((vuelta+1)); fallas=()
  ip=$(ip_actual); gw=$(gw_actual); ssid=$(ssid_actual)
  [ "$ip" = "$IP0" ]     || fallas+=("la IP cambió: $IP0 → ${ip:-ninguna} (regrabar secretos.h y recrear el proxy)")
  [ "$ssid" = "$SSID0" ] || fallas+=("la red cambió: $SSID0 → ${ssid:-ninguna}")
  [ "$gw" = "$GW0" ]     || fallas+=("la puerta de enlace cambió: $GW0 → ${gw:-ninguna}")
  proxy_escucha "$IP0"   || fallas+=("el proxy no escucha en $IP0:8883 (¿se recreó sin PROXY_IP_DISPOSITIVOS?)")
  salud_ok               || fallas+=("el backend no responde /salud con estado ok")
  inhibidor              || fallas+=("no hay inhibidor de suspensión vivo (systemd-inhibit del anexo del LAB)")
  enchufado              || fallas+=("sin corriente: el portátil está en batería")
  if [ ${#fallas[@]} -gt 0 ]; then for f in "${fallas[@]}"; do avisar "$f"; done
  elif [ $((vuelta - ultimo_ok)) -ge $((600 / INT)) ] || [ "$vuelta" -eq 1 ]; then
    echo "$(date -Is) OK ip=$ip red=$ssid proxy=8883 salud=ok inhibidor=sí corriente=sí" | tee -a "$REG"; ultimo_ok=$vuelta
  fi
  [ -n "${VIGILAR_VUELTAS:-}" ] && [ "$vuelta" -ge "$VIGILAR_VUELTAS" ] && break
  sleep "$INT"
done
