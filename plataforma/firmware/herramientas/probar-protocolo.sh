#!/usr/bin/env bash
# Compila y corre en el computador las pruebas del protocolo de configuración por el puerto serie (include/protocolo.h; docs/17 §6.4).
# No necesita la placa ni PlatformIO: solo g++ (o el compilador que diga CXX). Salida esperada, al final: «N de N comprobaciones».
set -euo pipefail
cd "$(dirname "$0")/.."
salida=$(mktemp -d)
trap 'rm -rf "$salida"' EXIT
"${CXX:-g++}" -std=c++17 -Wall -Wextra -Werror -O1 -I include herramientas/prueba-protocolo.cpp -o "$salida/prueba"
"$salida/prueba"
