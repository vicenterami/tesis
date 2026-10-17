# Avisos de terceros del firmware

El código propio de esta carpeta es AGPL-3.0-only, como el resto de la plataforma (`../LICENSE`). El firmware compilado incluye
además el software de terceros de esta tabla, cada uno con su licencia. Qué hay que entregar con un binario, más abajo.
Licencias leídas el 16/10/2026 en los archivos de cada paquete descargado por PlatformIO (`pio run` los deja en `.pio/libdeps/` y en
su carpeta de paquetes, donde se pueden volver a leer) y, para el núcleo, también en su repositorio oficial.

| Paquete | Versión | Licencia | Aviso de copyright (tal como lo trae el paquete) | Origen |
|---|---|---|---|---|
| Núcleo Arduino-ESP32 (`framework-arduinoespressif32`) | 4.20017.260907 (con la plataforma `espressif32` 7.1.3) | LGPL-2.1-or-later | Según cada archivo fuente | https://github.com/espressif/arduino-esp32 |
| Bibliotecas Wi-Fi precompiladas de Espressif (las enlaza el núcleo) | las de la plataforma | Apache 2.0 (repositorio oficial `esp32-wifi-lib`) | Espressif Systems | https://github.com/espressif/esp32-wifi-lib |
| Adafruit BME280 Library | 2.3.0 | BSD | Copyright (c) 2015, Limor Fried & Kevin Townsend for Adafruit Industries | https://github.com/adafruit/Adafruit_BME280_Library |
| Adafruit Unified Sensor | 1.1.15 | Apache 2.0 (sin archivo NOTICE) | Adafruit Industries | https://github.com/adafruit/Adafruit_Sensor |
| Adafruit BusIO | 1.17.4 | MIT | Copyright (c) 2017 Adafruit Industries | https://github.com/adafruit/Adafruit_BusIO |
| OneWire | 2.3.8 | permiso estilo MIT, en `OneWire.cpp` (sin archivo de licencia) | Copyright (c) 2007, Jim Studt (original old version - many contributors since) | https://github.com/PaulStoffregen/OneWire |
| DallasTemperature | 4.0.6 | MIT | Copyright (c) 2024 Miles Burton | https://github.com/milesburton/Arduino-Temperature-Control-Library |

**Antes de distribuir un binario** (no se distribuye ninguno hoy): acompañarlo de este archivo, de una copia del texto de cada licencia
(LGPL-2.1, Apache 2.0, BSD y MIT, tal como vienen en cada paquete o en su repositorio) y, por la LGPL, del código fuente del núcleo
en la versión usada o una oferta escrita de entregarlo; el `platformio.ini` fija esa versión (la plataforma `espressif32` 7.1.3 trae el
núcleo `4.20017.260907+sha.dcc1105b`: su versión lleva el identificador del commit del repositorio oficial).

**Permiso de OneWire** (no trae archivo de licencia; el permiso está en la cabecera de `OneWire.cpp` y debe acompañar las copias):

```
Copyright (c) 2007, Jim Studt  (original old version - many contributors since)

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

**LGPL del núcleo.** Al distribuir un binario que enlaza una biblioteca LGPL, esa licencia pide permitir que quien lo reciba vuelva a
enlazarlo con otra versión de la biblioteca; con el código fuente de este firmware y su `platformio.ini` publicados, cualquiera puede
recompilarlo con otra versión del núcleo. La FSF declara la LGPL-2.1 «compatible with GPLv2 and GPLv3»
(https://www.gnu.org/licenses/license-list.html, consultada el 16/10/2026); su combinación con la AGPL-3.0 de este proyecto pasa por
la GPLv3 y queda por confirmar en el texto de la AGPL antes de publicar binarios.

**Las bibliotecas Wi-Fi:** que el núcleo use exactamente las del repositorio `esp32-wifi-lib` es lo que declara Espressif para ESP-IDF;
la versión concreta que trae la plataforma no se verificó archivo por archivo.
