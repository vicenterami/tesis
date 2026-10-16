#!/usr/bin/env bash
# CA de DESARROLLO para probar el proxy con TLS en el portátil (docs/10 §8.4 decisiones 10 y 22). NUNCA en producción.
#   bash plataforma/proxy/ca-desarrollo.sh [carpeta]     → ca.crt, ca.key, servidor.crt, servidor.key (por defecto en
#                                                          privado/certs-desarrollo, fuera del repositorio y del respaldo)
#   CA_IP_EXTRA=<IPv4> bash plataforma/proxy/ca-desarrollo.sh   → además vale para esa dirección: una pasarela en la misma red
#                                                          local que se conecta por IP y verifica el certificado (docs/10 §8.4 punto 47)
# El certificado del servidor vale para localhost, 127.0.0.1 y el nombre de servicio «proxy» (clientes dentro de la red
# de Docker). Los clientes confían con `--cafile ca.crt` (mosquitto_pub) o `--cacert ca.crt` (curl). Reejecutable: la CA
# se conserva si ya existe (así los clientes no tienen que volver a confiar); el certificado del servidor se renueva.
set -euo pipefail
DIR="${1:-$(cd "$(dirname "$0")/../.." && pwd)/privado/certs-desarrollo}"
mkdir -p "$DIR"; chmod 700 "$DIR"; cd "$DIR"
if [ ! -f ca.key ]; then
  openssl req -x509 -newkey rsa:3072 -nodes -days 825 -subj "/CN=CA de desarrollo (plataforma IoT)" \
    -keyout ca.key -out ca.crt 2>/dev/null
  echo "CA nueva: $DIR/ca.crt"
fi
# La dirección extra llega por variable, nunca escrita en el repositorio; solo IPv4 con cuatro octetos de 0 a 255.
SAN="DNS:localhost,DNS:proxy,IP:127.0.0.1"
if [ -n "${CA_IP_EXTRA:-}" ]; then
  [[ "$CA_IP_EXTRA" =~ ^((25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])$ ]] || { echo "FALLA CA_IP_EXTRA no es una IPv4: ${CA_IP_EXTRA:0:40}"; exit 1; }
  SAN="$SAN,IP:$CA_IP_EXTRA"
fi
openssl req -newkey rsa:2048 -nodes -subj "/CN=localhost" -keyout servidor.key -out servidor.csr 2>/dev/null
printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$SAN" > san.ext
openssl x509 -req -in servidor.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 398 -extfile san.ext -out servidor.crt 2>/dev/null
rm -f servidor.csr san.ext
chmod 600 ./*.key
openssl verify -CAfile ca.crt servidor.crt
echo "servidor: $(openssl x509 -in servidor.crt -noout -ext subjectAltName | tail -1 | sed 's/^ *//') · vence $(openssl x509 -in servidor.crt -noout -enddate | cut -d= -f2)"
