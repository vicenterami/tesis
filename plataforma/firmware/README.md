# Firmware del nodo de prueba (ESP32)

Nodo propio para probar el sistema con hardware real (TT-32): ESP32 con BME280 (aire), DS18B20 (temperatura del suelo) y un sensor
capacitivo de humedad de suelo. Piezas, seguridad y pines: `docs/17`. Diseño por fases: `docs/17 §6`.

| Entorno | Qué hace | Estado |
|---|---|---|
| `diagnostico` | Fase 1: identifica el módulo de aire (registro `0xD0`), lee la sonda y el suelo por el puerto serie, sin Wi-Fi | Listo |
| `nodo` | Fase 2: Wi-Fi, TLS con la CA propia, MQTT con QoS 1 y un pack SenML cada 60 s hacia la plataforma (`docs/17 §6.2`); configuración por USB (`docs/17 §6.4`) | Compila. Publicación probada con la placa (24 h el 23 y 24/10/2026, `docs/16 §53`); contrato probado en el banco (`docs/16 §44`). Configuración por USB probada sin placa (`docs/16 §105`); con la placa, pendiente |

Requiere PlatformIO Core 6.2.0 (`pip install platformio==6.2.0`; no se fija en `platformio.ini`); las versiones de la plataforma
y de cada biblioteca sí están fijadas ahí. Licencias y avisos de copyright de terceros: `AVISOS-DE-TERCEROS.md`.

```
pio run -e diagnostico -t upload && pio device monitor
```

Fase 2: copiar `include/secretos.h.ejemplo` a `include/secretos.h` (git lo ignora) y pegar la CA de la instalación; después:

```
pio run -e nodo -t upload && pio device monitor
```

Desde el 25/11/2026 la red Wi-Fi, el servidor, el sitio, el `id_fisico` y la credencial del alta **se cargan por USB** y quedan en la
memoria no volátil del equipo (`docs/17 §6.4`): desde el panel («Cargar en el equipo», en un navegador con Web Serial: Chrome, Edge y Opera, y Firefox de escritorio desde la 151; `docs/19 §4`, Z) o desde una
terminal (Linux o macOS, Python 3 sin bibliotecas externas; las claves se piden sin mostrarlas, nunca por argumentos):

```
python3 herramientas/cargar-equipo.py --puerto /dev/ttyUSB0 cargar --credenciales credenciales-AAAA-MM-DD.csv --id nodo-0001 --red "nombre-de-la-red" --servidor direccion-del-servidor
```

`hola`, `estado` y `borrar` usan el mismo guion; `borrar` borra la partición de datos entera y el equipo arranca con lo que traiga su
imagen (las macros de `secretos.h`, si las tiene; si no, sin configurar). Para dar de baja o entregar un equipo, además se rotan su
credencial y la clave de la red (`docs/11 §7`). Si el equipo ya está cargado con otro identificador, `cargar` exige `--reemplazar <actual>`.
El protocolo es el 2 (firmware 2.1.0): `hola` trae un número de arranque que cambia en cada inicio. Así la imagen es una por instalación y no lleva secretos de ningún
equipo. Las macros de `secretos.h` (comentadas en la plantilla) siguen sirviendo como valores por omisión; si se usan, el binario
(`.pio/build/nodo/firmware.bin`, `.elf`) las lleva en claro: no se entrega, no se sube ni se adjunta a nada (`.pio/` está ignorado por git).

Pruebas sin placa: `bash herramientas/probar-protocolo.sh` (el analizador de órdenes y la validación, compilados con g++) y
`python3 -I herramientas/prueba_cargar_equipo.py` (el guion contra un equipo simulado en una pseudoterminal); las dos leen los casos de
validación que comparten con el panel (`herramientas/casos-validacion.txt`).

Esquema de cableado de la fase 1, editable en diagrams.net (archivo `.drawio`, sin comprimir): `cableado-fase-1.drawio`. Se abre con
«Archivo → Abrir desde → Dispositivo» o arrastrándolo al lienzo; exportar a PNG para una figura.

## Segunda placa (ESP32-S3 con radio LoRa, 28/10/2026)

El mismo firmware de la fase 2 corre en una Heltec WiFi LoRa 32 V3 como otro dispositivo (`nodo-0002`), con su propia alta y credencial en
`include/secretos-s3.h` (copiar `secretos.h`; git lo ignora); desde el 25/11/2026 su identidad se carga por USB como la de cualquier equipo. Qué cambia y por qué:
`platformio.ini`, entorno `nodo-s3`, y `docs/17 §6.3`.

```
pio run -e nodo-s3 -t upload && pio device monitor -e nodo-s3
```
