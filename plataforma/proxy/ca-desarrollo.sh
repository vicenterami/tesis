#!/usr/bin/env bash
# CA PROPIA para probar el proxy con TLS (docs/10 §8.4 decisiones 10 y 22). Dos usos, nunca producción con nombre público (ahí va
# Let's Encrypt, docs/10 §8.4 punto 22): (1) desarrollo en el portátil (por defecto); (2) un servidor de PRUEBA sin DNS público, con otra carpeta y otro
# nombre de CA (CA_NOMBRE), cuya raíz se instala una vez en los clientes que deben confiar en él (navegadores, pasarela, nodo).
#   bash plataforma/proxy/ca-desarrollo.sh [carpeta]     → ca.crt, ca.key, servidor.crt, servidor.key (por defecto en
#                                                          privado/certs-desarrollo, fuera del repositorio y del respaldo)
#   CA_IP_EXTRA=<IPv4>[,<IPv4>…] bash …                  → además vale para esas direcciones: una pasarela en la misma red
#                                                          local que se conecta por IP y verifica el certificado (docs/10 §8.4 punto 47)
#   CA_DNS_EXTRA=<nombre>[,<nombre>…] bash …             → además vale para esos nombres de host (el del servidor en la red privada
#                                                          de administración, por ejemplo); letras, dígitos, puntos y guiones
#   CA_NOMBRE="CA de prueba (servidor X)" bash …         → nombre de la CA cuando se crea (por defecto, la de desarrollo)
# El certificado del servidor vale siempre para localhost, 127.0.0.1 y el nombre de servicio «proxy» (clientes dentro de la red
# de Docker; el nodo ESP32 verifica ese nombre, docs/17 §6.2). Los clientes confían con `--cafile ca.crt` (mosquitto_pub) o
# `--cacert ca.crt` (curl). Reejecutable: la CA se conserva si ya existe (así los clientes no tienen que volver a confiar); el
# certificado del servidor se renueva. Las direcciones y nombres extra llegan por variable, nunca escritos en el repositorio.
set -euo pipefail
# Primero se validan las entradas: una variable mal escrita no deja una CA a medio crear.
SAN="DNS:localhost,DNS:proxy,IP:127.0.0.1"
IFS=',' read -ra IPS <<<"${CA_IP_EXTRA:-}"
for ip in "${IPS[@]}"; do
  [ -n "$ip" ] || continue
  [[ "$ip" =~ ^((25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])$ ]] || { echo "FALLA CA_IP_EXTRA no es una IPv4: ${ip:0:40}"; exit 1; }
  SAN="$SAN,IP:$ip"
done
IFS=',' read -ra NOMBRES <<<"${CA_DNS_EXTRA:-}"
for n in "${NOMBRES[@]}"; do
  [ -n "$n" ] || continue
  [[ "$n" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$ ]] || { echo "FALLA CA_DNS_EXTRA no es un nombre de host: ${n:0:60}"; exit 1; }
  SAN="$SAN,DNS:$n"
done
DIR="${1:-$(cd "$(dirname "$0")/../.." && pwd)/privado/certs-desarrollo}"
mkdir -p "$DIR"; chmod 700 "$DIR"; cd "$DIR"
if [ ! -f ca.key ]; then
  openssl req -x509 -newkey rsa:3072 -nodes -days 825 -subj "/CN=${CA_NOMBRE:-CA de desarrollo (plataforma IoT)}" \
    -keyout ca.key -out ca.crt 2>/dev/null
  echo "CA nueva: $DIR/ca.crt"
fi
openssl req -newkey rsa:2048 -nodes -subj "/CN=localhost" -keyout servidor.key -out servidor.csr 2>/dev/null
printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$SAN" > san.ext
openssl x509 -req -in servidor.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 398 -extfile san.ext -out servidor.crt 2>/dev/null
rm -f servidor.csr san.ext
chmod 600 ./*.key
openssl verify -CAfile ca.crt servidor.crt
echo "servidor: $(openssl x509 -in servidor.crt -noout -ext subjectAltName | tail -1 | sed 's/^ *//') · vence $(openssl x509 -in servidor.crt -noout -enddate | cut -d= -f2)"
