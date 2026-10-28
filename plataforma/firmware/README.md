# Firmware del nodo de prueba (ESP32)

Nodo propio para probar el sistema con hardware real (TT-32): ESP32 con BME280 (aire), DS18B20 (temperatura del suelo) y un sensor
capacitivo de humedad de suelo. Piezas, seguridad y pines: `docs/17`. Diseño por fases: `docs/17 §6`.

| Entorno | Qué hace | Estado |
|---|---|---|
| `diagnostico` | Fase 1: identifica el módulo de aire (registro `0xD0`), lee la sonda y el suelo por el puerto serie, sin Wi-Fi | Listo |
| `nodo` | Fase 2: Wi-Fi, TLS con la CA propia, MQTT con QoS 1 y un pack SenML cada 60 s hacia la plataforma (`docs/17 §6.2`) | Compila; contrato probado en el banco (`docs/16 §44`); con la placa, pendiente |

Requiere PlatformIO Core 6.2.0 (`pip install platformio==6.2.0`; no se fija en `platformio.ini`); las versiones de la plataforma
y de cada biblioteca sí están fijadas ahí. Licencias y avisos de copyright de terceros: `AVISOS-DE-TERCEROS.md`.

```
pio run -e diagnostico -t upload && pio device monitor
```

Fase 2: copiar `include/secretos.h.ejemplo` a `include/secretos.h` (git lo ignora) y completar la red Wi-Fi, la dirección del proxy, el
sitio, el `id_fisico` y la credencial que devolvió el alta (`POST /dispositivos`, seis canales) y la CA de desarrollo; después:

```
pio run -e nodo -t upload && pio device monitor
```

El binario compilado (`.pio/build/nodo/firmware.bin`, `.elf`) lleva esos secretos en claro: no se entrega, no se sube ni se adjunta
a nada (`.pio/` está ignorado por git).

Esquema de cableado de la fase 1, editable en diagrams.net (archivo `.drawio`, sin comprimir): `cableado-fase-1.drawio`. Se abre con
«Archivo → Abrir desde → Dispositivo» o arrastrándolo al lienzo; exportar a PNG para una figura.

## Segunda placa (ESP32-S3 con radio LoRa, 28/10/2026)

El mismo firmware de la fase 2 corre en una Heltec WiFi LoRa 32 V3 como otro dispositivo (`nodo-0002`), con su propia alta y credencial en
`include/secretos-s3.h` (copiar `secretos.h` y cambiar `DISPOSITIVO_ID` y `DISPOSITIVO_CLAVE`; git lo ignora). Qué cambia y por qué:
`platformio.ini`, entorno `nodo-s3`, y `docs/17 §6.3`.

```
pio run -e nodo-s3 -t upload && pio device monitor -e nodo-s3
```
