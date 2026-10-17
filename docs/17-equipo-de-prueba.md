# Equipo de prueba: nodo propio para TT-32 (Wi-Fi y, si hay pasarela, LoRaWAN)

> **Sustenta:** TT-32 (sensor físico de extremo a extremo, `docs/04`), escenarios 1 y 3 de `docs/10 §2`, validación
> preliminar de la Etapa 3. Versión: 8 de octubre de 2026; estado del equipo al 14 de octubre. Los precios son una cotización con fecha, no un compromiso.
>
> **Estado (14/10/2026):** todo el equipo recibido: la placa, anotada el 12/10, y las piezas 2 a 7, el 13/10 (§3). Fase 0 completa el
> 14/10: la placa se reconoce y se identificó (§3, primera conexión). Falta la fase 1: cablear los sensores. Guía de manejo seguro en §4.

## 1. Para qué sirve y por qué estas piezas

El sistema no fabrica sensores: recibe de los que ya existen. El nodo propio es **un dispositivo de prueba más**, para demostrar
con hardware real que la recepción, la validación, las alertas y la supervisión funcionan de punta a punta. Las piezas se
eligieron para que coincidan con el caso de uso levantado:

- **Variables:** la entrevista al Académico/Investigador en Ingeniería Civil Geológica declara como necesarias, para corregir las mediciones de gases, la presión
  atmosférica, la temperatura del aire y del suelo y la humedad del suelo (`docs/03`). El nodo mide exactamente esas.
- **Vías:** Wi-Fi (escenario 1) desde el primer día; LoRaWAN por la pasarela (escenario 3) solo si hay una pasarela al
  alcance, porque la radio sola no entrega datos a nadie.
- **Banda:** en Chile, LoRaWAN usa 915–928 MHz (plan AU915); un módulo de 433 o de 868 MHz no sirve.

## 2. Lista de materiales

| # | Pieza | Para qué | Qué verificar al comprar | Cant. | Prioridad |
|---|---|---|---|---|---|
| 1 | Placa «NodeMCU ESP-32S V1.1» (serigrafía trasera) con módulo genérico «ESP-32 WiFi+BT SoC Inside», no de marca Espressif; chip ESP32-D0WD-V3 leído con esptool; 38 pines, **conector USB tipo C**, conversor USB-serie Silicon Labs CP2102; leído en la placa el 14/10) | Microcontrolador con Wi-Fi y TLS | — (ya comprada) | 1 | — |
| 2 | Cable **USB tipo C de datos** (a USB-A, o tipo C a tipo C si la placa enciende con él) | Programar y alimentar la placa | Que transfiera datos: muchos cables solo cargan y el computador no ve la placa. **Corrección del 14/10:** aquí decía micro-USB, sin haber revisado el conector de la placa comprada, que es tipo C | 1 | Imprescindible |
| 3 | Módulo **BME280** (I2C, 3,3 V) | Presión, temperatura y humedad del aire | Que diga BME280: el BMP280 se ve igual y **no mide humedad** | 1 | Imprescindible |
| 4 | Protoboard de 400 u 830 puntos | Conectar sin soldar | — | 1 | Imprescindible |
| 5 | Cables dupont macho-macho y macho-hembra (20 cm) | Conexiones | Paquetes de 20 o 40 | 1 + 1 | Imprescindible |
| 6 | Sonda **DS18B20** sumergible (≈ 1 m) + resistencia de 4,7 kΩ | Temperatura del suelo | Versión encapsulada en acero (sumergible) | 1 | Recomendada |
| 7 | Sensor **capacitivo** de humedad de suelo (v1.2 o similar) | Humedad del suelo | Capacitivo, no el resistivo de dos patas (se corroe) | 1 | Recomendada |
| 8 | Radio LoRa **915 MHz** (módulo SX1276/SX1262, o placa ESP32 con LoRa integrada) + antena de 915 MHz | Probar la vía LoRaWAN con un nodo propio | Banda 915 MHz; **nunca transmitir sin antena** | 1 | Solo si hay pasarela |
| 9 | Batería 18650 con portapilas protegido, o power bank | Demostración «de terreno» sin cable | Protección contra sobredescarga | 1 | Opcional |

## 3. Cotización (8 de octubre de 2026, revisada en la tarde)

Siete tiendas chilenas comparadas pieza por pieza. Precio y stock leídos en la página de cada producto (datos estructurados
de la ficha o texto visible) el mismo día; los de las dos compras de abajo, comprobados uno por uno. MercadoLibre no se pudo
leer (bloquea las consultas automáticas). **Ninguna tienda publica la tarifa de despacho a regiones**: se calcula en el carro
con la comuna de destino, así que el costo final se confirma al comprar.

**Recomendada: una sola tienda y un despacho (MechatronicStore), CLP 26 130**, todo en stock. Supera su umbral de envío
gratis («Envío GRATIS a todo Chile en pedidos web desde $19.990»); confirmar en el carro que aplica al destino elegido.

| # | Pieza | Producto | CLP | URL |
|---|---|---|---|---|
| 2 | ~~Cable micro-USB de datos~~ **error: la placa es tipo C** | Cable micro USB para cargar y transferir datos (largo no declarado en el texto); el correcto, «Cable USB Tipo C a USB Tipo A 1mt», CLP 2 190, no declara en su página si transfiere datos (leído el 14/10) | 2 190 | https://www.mechatronicstore.cl/cable-micro-usb-de-datos/ |
| 3 | BME280 | Sensor BME280, 3,3 V: **elegir la variante «I2C»** (la «I2C/SPI» figura sin stock) | 8 690 | https://www.mechatronicstore.cl/sensor-barometrico-bme280-spi-i2c-3-3v/ |
| 4 | Protoboard 830 | Breadboard MB102, 830 puntos | 3 790 | https://www.mechatronicstore.cl/breadboard-830-puntos-mb102/ |
| 5 | Dupont macho-macho | 40 piezas, 20 cm | 2 990 | https://www.mechatronicstore.cl/cable-macho-macho-40-piezas-20cm/ |
| 5 | Dupont macho-hembra | 40 piezas, 20 cm | 2 990 | https://www.mechatronicstore.cl/cable-macho-hembra-40-piezas-20-cm/ |
| 6 | DS18B20 sumergible | En tubo de acero (largo no declarado en el texto) | 2 990 | https://www.mechatronicstore.cl/sensor-de-temperatura-ds18b20-tipo-termocupla-arduino-pic/ |
| 6 | Resistencia de 4,7 kΩ | 1/4 W, por unidad (elegir el valor) | 100 | https://www.mechatronicstore.cl/resistencia/ |
| 7 | Humedad de suelo **capacitivo** | Analógico capacitivo v1.2, 3,3 a 5,5 V | 2 390 | https://www.mechatronicstore.cl/sensor-de-humedad-del-suelo-analogico-capacitivo-3-3-5-5v/ |

**Alternativa más barata en piezas, con dos despachos: CLP 18 835 más dos envíos.** Altronics: cable plano de 1 m (1 332),
BME280 (8 236), pack de 10 resistencias de 4,7 kΩ (491) y sensor capacitivo (2 776); Afel: protoboard de 400 (1 500), dupont
macho-macho y macho-hembra de 20 (1 000 cada uno) y DS18B20 de 1 m en acero (2 500). Conviene solo si los dos envíos suman
menos de CLP 7 295.

**Trampas comprobadas en las páginas:** el «Cable Micro USB de 80cm» de MCI dice «Solo carga (No datos)»; el «Sensor Humedad
Suelo Higrometro» de Afel es resistivo («midiendo la conductividad eléctrica entre sus dos sondas»). En las fichas de Afel la
palabra «Agotado» aparece aunque el producto tenga stock: manda el botón de compra.

**Al recibir:** el BME280 se reconoce por software: su registro de identificación (`0xD0`) vale `0x60`; un BMP280, que se ve
igual y no mide humedad, devuelve `0x58` (bibliotecas de Adafruit para BME280 y BMP280). La sonda DS18B20 llega sin conector
(soldar o usar bornera) y necesita la resistencia de 4,7 kΩ entre datos y 3,3 V. El sensor de suelo se alimenta a 3,3 V con el
ESP32 y se calibra (seco y en agua).

**Recepción (anotado el 12/10/2026).** La placa ESP32 (pieza 1, comprada aparte el 07/10) ya llegó: el vendedor la describía con módulo ESP-WROOM-32 (el 14/10 la serigrafía mostró un módulo genérico: fila 1), 38 pines,
convertidor USB-serie Silicon Labs CP2102 y conector tipo C (corregido el 14/10 leyendo la placa: antes decía CH9102F y micro-USB; en Linux lo atiende el controlador `cp210x` del núcleo sin instalar nada; al conectarla, `dmesg` dice si aparece como
`/dev/ttyUSB0` o `/dev/ttyACM0`, y el usuario debe pertenecer al grupo `dialout`). El pedido de las piezas 2 a 7 (una tienda, un despacho; CLP 26 530 con cinco resistencias de 4,7 kΩ) llegó completo el 13/10/2026; el cable era micro-USB y no sirve para esta placa (fila 2 de la cotización). Al llegar el BME280, lo primero es leer su registro de
identificación (párrafo anterior).

**Piezas 8 y 9** (solo si hay pasarela / opcional), sin cambios respecto de la revisión de la mañana: radio SX1276 de 915 MHz
con antena helicoidal en Afel, CLP 18 000; batería con protección declarada, sin opción encontrada. Referencia: pasarela
Milesight UG65 4G AU915 en MCI, CLP 439 990.

**Primera conexión (14/10/2026).** La placa se reconoce como `/dev/ttyUSB0` con el controlador `cp210x` del núcleo, sin instalar
nada. `esptool` 5.5.0 identifica un ESP32-D0WD-V3 (revisión 3.1, doble núcleo, 240 MHz, Wi-Fi y Bluetooth), cristal de 40 MHz y
memoria flash de 4 MB. Dos hallazgos para quien repita. De tres cables tipo C, dos eran solo de carga: con ellos el LED enciende y el sistema no ve nada
(se prueba cada cable con un teléfono, mirando `journalctl -k -f`); sirvió uno de tipo C a tipo C. Y a la velocidad por defecto
la comunicación falló; con `--baud 115200` funcionó siempre.

## 4. Seguridad al manipular el equipo de prueba (12/10/2026)

Todo lo de esta lista funciona a **5 V por USB y a 3,3 V en los sensores**. Nada del proyecto se conecta a la red de 220 V: lo
único enchufado al tomacorriente es el cargador del computador, con su certificación. A esas tensiones **no existe riesgo de
electrocución**; el riesgo real es otro: **quemar la placa, un sensor o el puerto USB del computador** por un cable mal puesto.
Esta sección dice cómo evitarlo. Cifras de la hoja de datos del fabricante (ESP32 Series Datasheet v5.3, tablas 3-1, 5-1, 5-2 y
5-3, consultada el 12/10/2026); lo que la hoja no trata se marca.

### 4.1 Lo que daña la placa o el computador, y la regla que lo evita
| # | Qué pasa | Por qué | Regla |
|---|---|---|---|
| 1 | Cortocircuito entre `3V3` (o `5V`/`VIN`) y `GND` | El regulador de la placa o el puerto USB entregan toda la corriente que pueden y se calientan | Cablear **siempre con el USB desconectado**; antes de conectar, mirar que ningún cable rojo toque uno negro ni una fila compartida de la protoboard |
| 2 | 5 V en un pin de señal (GPIO) | La hoja de datos admite en una entrada hasta `VDD + 0,3 V`, o sea **3,6 V** con 3,3 V de alimentación (tabla 5-3); los pines de alimentación del chip toleran como máximo 3,6 V (tabla 5-1) | El pin `5V`/`VIN` solo alimenta; **nunca** va a un GPIO ni a `3V3`. Los tres sensores de esta lista se alimentan de `3V3` |
| 3 | Demasiada corriente por un pin | Por pin, la hoja de datos da 40 mA de fuente y 28 mA de sumidero (tabla 5-3) y 1 200 mA acumulados en todos los IO (tabla 5-1) | Regla práctica del proyecto: **nada que pida más de 12 mA de un pin**; un LED siempre con resistencia (≥ 220 Ω); motores, relés, bombas o tiras LED **jamás** desde un GPIO ni desde el USB del computador |
| 4 | Dos alimentaciones a la vez | USB y `VIN` juntos ponen dos fuentes en paralelo contra el mismo regulador | Una sola fuente: durante toda la Etapa 3, el USB del computador |
| 5 | Sensor conectado al revés | Un sensor con `VCC` y `GND` invertidos consume corriente y se calienta en segundos | Confirmar la polaridad **tres veces** contra la serigrafía del sensor antes de dar corriente; el DS18B20 sin conector es el más fácil de invertir |
| 6 | Agua en la electrónica | La placa y las cabezas de los sensores no son estancas | Solo la punta del sensor de suelo entra en tierra o agua; la zona de los componentes queda seca. El DS18B20 en tubo de acero es el único sumergible |
| 7 | Electricidad estática | Un chispazo imperceptible puede dañar un pin | Tocar algo metálico grande antes de tomar la placa; guardarla en su bolsa antiestática; evitar alfombra y ropa sintética al manipular |
| 8 | Sobrecargar el puerto USB del computador | La hoja de datos pide una fuente capaz de **0,5 A** (tabla 5-2); un puerto USB común entrega eso, suficiente para el ESP32 con Wi-Fi y estos tres sensores, no para nada más | Solo la placa y los sensores de esta lista cuelgan del USB; para proteger el computador, un concentrador USB con fuente propia o un cargador de celular certificado (la programación sigue por el computador) |
| 9 | Cables sueltos con la placa encendida | Un cable Dupont que cae sobre dos pines hace un corto | Nunca cambiar cables con el USB conectado; un cambio = desconectar, cablear, revisar, conectar |

### 4.2 Rutina de cada sesión de laboratorio
1. USB desconectado. Placa sobre la protoboard (no sobre una mesa metálica ni sobre papeles con grapas).
2. Cablear según el diagrama de la sesión: primero `GND` común, después `3V3` a cada `VCC`, al final las señales.
3. Revisar con la lista: ¿ningún rojo con negro? ¿nada en `5V`/`VIN`? ¿polaridad de cada sensor confirmada? ¿los extremos de los
   Dupont no se tocan entre sí?
4. Conectar el USB y mirar 10 segundos: el LED de alimentación encendido, **nada tibio, ningún olor**. Si algo se calienta o huele,
   desconectar el USB de inmediato y buscar el error con la placa fría.
5. Comprobar que el sistema la ve (`dmesg` justo después de conectar: aparece como `/dev/ttyUSB0` o `/dev/ttyACM0`; el usuario
   debe estar en el grupo `dialout`).
6. Al terminar: desconectar el USB antes de desarmar; sensores de vuelta a su bolsa.

### 4.3 Pines del ESP32 que se evitan o se cuidan
- **Pines de arranque (tabla 3-1):** `GPIO0`, `GPIO2`, `GPIO5`, `GPIO12` (MTDI) y `GPIO15` (MTDO) deciden cómo arranca el chip. Un
  sensor conectado ahí puede impedir que la placa arranque o que se programe. No se usan para sensores en este proyecto.
- **Pines de solo entrada:** `GPIO34` a `GPIO39` no tienen etapa de salida ni resistencias internas de polarización (nota de la
  tabla IO_MUX); sirven para leer, nunca para encender nada, y necesitan resistencia externa si se usan como entrada digital.
- **Pines de la memoria flash:** los rotulados `CLK`, `CMD`, `D0`–`D3` (`SD_CLK`, `SD_CMD`, `SD_DATA_0..3`, que en el módulo van a la
  flash interna) no se conectan a nada. El módulo es genérico (sin hoja propia del fabricante); la regla viene de la hoja del chip (ESP32 Series v5.3) y de la del
  módulo de referencia ESP32-WROOM-32E, que se cita al hacer el
  laboratorio (TT-32).
- **Conversor analógico:** el sensor de suelo se lee en un pin del ADC1 (`GPIO32` a `GPIO39`). La documentación de ESP-IDF indica
  que el ADC2 no está disponible mientras el Wi-Fi está activo; la hoja de datos no lo trata, así que **se comprueba en el
  laboratorio** midiendo con Wi-Fi conectado.
- **I2C (BME280):** por defecto en Arduino-ESP32, `SDA = GPIO21` y `SCL = GPIO22`. **1-Wire (DS18B20):** cualquier GPIO de salida (por
  ejemplo `GPIO4`), con la resistencia de 4,7 kΩ entre datos y `3V3`.

### 4.4 Cada sensor, sin dañarlo
| Sensor | Alimentación | Señal | Cuidados |
|---|---|---|---|
| BME280 (I2C, 3,3 V) | `3V3` y `GND` | `SDA` → GPIO21, `SCL` → GPIO22 | Comprobar primero el registro de identificación (§3: `0x60` BME280, `0x58` BMP280). Dirección I2C `0x76` o `0x77` según el módulo: se lee con un barrido I2C, no se adivina |
| DS18B20 (tubo de acero) | `3V3` y `GND` | datos → GPIO4 con 4,7 kΩ a `3V3` | Tres cables sin conector: identificar `GND`, `DQ` y `VDD` por su color según el vendedor **y verificarlo con la hoja de datos del sensor** antes de dar corriente; soldar o usar bornera, nunca cables enroscados a mano |
| Humedad de suelo capacitivo (3,3–5,5 V) | `3V3` y `GND` | salida analógica → GPIO34 (ADC1) | Alimentado a 3,3 V su salida nunca supera 3,3 V, seguro para el pin. Se calibra con dos lecturas: al aire (seco) y en un vaso de agua (solo la punta, hasta la línea marcada) |

**Lo que no se compra ni se conecta en esta etapa:** baterías de litio (el único elemento de esta lista con riesgo de incendio;
si alguna vez se usa, con placa de protección y cargador dedicados), fuentes de 220 V, relés, motores. Si el proyecto los
necesitara, se escribe antes aquí cómo se manejan.

**Fuentes.** Espressif, *ESP32 Series Datasheet* v5.3 (consultada el 12/10/2026): tabla 5-1 (tensión máxima en pines de
alimentación −0,3 a 3,6 V; corriente acumulada de salida 1 200 mA), tabla 5-2 (alimentación recomendada 3,0–3,6 V; fuente de
0,5 A), tabla 5-3 (VIH máx. VDD + 0,3 V; IOH 40 mA; IOL 28 mA), tabla 3-1 (pines de arranque), nota de la tabla IO_MUX (GPIO34–39
solo entrada). Lo del ADC2 y los pines de la flash: por verificar con la fuente al hacer el laboratorio (marcado arriba).

## 5. Herramienta del firmware (decidida el 13/10/2026)

El nodo se programa con **PlatformIO Core** (línea de comandos) y el framework **Arduino-ESP32**: el archivo `platformio.ini`
versionado fija la plataforma y cada biblioteca, así cualquiera reproduce el firmware sin un entorno gráfico. Alternativas
consideradas: `arduino-cli` (mismo framework, versiones fijadas por comandos en vez de un archivo) y MicroPython (ciclo más corto,
pero el TLS con CA propia no está verificado para esta placa). Las versiones exactas de la plataforma, del framework y de cada
biblioteca se anotan aquí el día de instalarlas, desde su documentación oficial. Llegada de las piezas 2 a 7: 13/10/2026.

**Versiones fijadas el 16/10/2026** (`plataforma/firmware/platformio.ini`; fechas del registro oficial de PlatformIO, todas
publicadas hace más de dos semanas; licencias leídas en los archivos de cada paquete):

| Pieza | Versión | Publicada | Licencia |
|---|---|---|---|
| PlatformIO Core | 6.2.0 | 05/09/2026 | Apache 2.0 |
| Plataforma `platformio/espressif32` | 7.1.3 | 11/09/2026 | (trae el núcleo `framework-arduinoespressif32` 4.20017.260907) |
| Adafruit BME280 Library | 2.3.0 | 30/04/2025 | BSD |
| Adafruit Unified Sensor | 1.1.15 | 06/01/2025 | Apache 2.0 |
| Adafruit BusIO | 1.17.4 | 22/09/2025 | MIT |
| OneWire (Paul Stoffregen) | 2.3.8 | 08/02/2024 | permiso estilo MIT en el código fuente (sin archivo de licencia) |
| DallasTemperature | 4.0.6 | 24/01/2026 | MIT |

Todas abiertas y permisivas (RNF-15). El firmware de diagnóstico compila sin avisos con `-Wall -Wextra` (13,5 % de la RAM, 58,5 %
de la memoria de programa).

## 6. Firmware por fases (16/10/2026)

Dos fases, para que una falla diga dónde está: si la fase 1 no ve un sensor, el problema es el sensor o su cableado, nunca la red.

- **Fase 1, diagnóstico** (`pio run -e diagnostico`, `src/diagnostico.cpp`): solo puerto serie, Wi-Fi apagado. Barre el bus I2C y lee el
  registro de identificación `0xD0` del módulo de aire (`0x60` BME280, `0x58` BMP280, que no mide humedad: §2); cuenta las sondas
  DS18B20 y lee la primera; lee el sensor de suelo en mV (promedio de 16) para anotar el valor al aire y con la punta en agua, que son
  los dos extremos de su calibración. No imprime identificadores de hardware: la dirección ROM de la sonda es única, como una MAC.
- **Fase 2, publicación**: Wi-Fi, TLS con la CA propia, MQTT con la credencial del alta y SenML en `sitio/<sitio>/dispositivo/<id>/<magnitud>`,
  con la marca de tiempo del nodo sincronizada por NTP (regla 7 de `docs/13`). Antes de publicar el suelo hacen falta sus magnitudes en el
  catálogo (`temperatura_suelo`, `humedad_suelo`: `docs/08 §8`) y la curva de calibración de la fase 1. Se diseña aquí antes de escribirla;
  la credencial y la red Wi-Fi viven en un archivo local que git ignora, nunca en el código.

