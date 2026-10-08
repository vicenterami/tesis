#!/usr/bin/env bash
# CA de DESARROLLO para probar el proxy con TLS en el portátil (docs/10 §8.4 decisiones 10 y 22). NUNCA en producción.
#   bash plataforma/proxy/ca-desarrollo.sh [carpeta]     → ca.crt, ca.key, servidor.crt, servidor.key (por defecto en
#                                                          privado/certs-desarrollo, fuera del repositorio y del respaldo)
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
openssl req -newkey rsa:2048 -nodes -subj "/CN=localhost" -keyout servidor.key -out servidor.csr 2>/dev/null
printf 'subjectAltName=DNS:localhost,DNS:proxy,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' > san.ext
openssl x509 -req -in servidor.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 398 -extfile san.ext -out servidor.crt 2>/dev/null
rm -f servidor.csr san.ext
chmod 600 ./*.key
openssl verify -CAfile ca.crt servidor.crt
echo "servidor: $(openssl x509 -in servidor.crt -noout -ext subjectAltName | tail -1 | sed 's/^ *//') · vence $(openssl x509 -in servidor.crt -noout -enddate | cut -d= -f2)"
