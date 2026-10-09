# Equipo de prueba: nodo propio para TT-32 (Wi-Fi y, si hay pasarela, LoRaWAN)

> **Sustenta:** TT-32 (sensor físico de extremo a extremo, `docs/04`), escenarios 1 y 3 de `docs/10 §2`, validación
> preliminar de la Etapa 3. Versión: 8 de octubre de 2026. Los precios son una cotización con fecha, no un compromiso.

## 1. Para qué sirve y por qué estas piezas

El sistema no fabrica sensores: recibe de los que ya existen. El nodo propio es **un dispositivo de prueba más**, para demostrar
con hardware real que la recepción, la validación, las alertas y la supervisión funcionan de punta a punta. Las piezas se
eligieron para que coincidan con el caso de uso levantado:

- **Variables:** la entrevista al académico declara como necesarias, para corregir las mediciones de gases, la presión
  atmosférica, la temperatura del aire y del suelo y la humedad del suelo (`docs/03`). El nodo mide exactamente esas.
- **Vías:** Wi-Fi (escenario 1) desde el primer día; LoRaWAN por la pasarela (escenario 3) solo si hay una pasarela al
  alcance, porque la radio sola no entrega datos a nadie.
- **Banda:** en Chile, LoRaWAN usa 915–928 MHz (plan AU915); un módulo de 433 o de 868 MHz no sirve.

## 2. Lista de materiales

| # | Pieza | Para qué | Qué verificar al comprar | Cant. | Prioridad |
|---|---|---|---|---|---|
| 1 | Placa ESP32 DevKit (ESP-WROOM-32, conversor USB CH9102F) | Microcontrolador con Wi-Fi y TLS | — (ya comprada) | 1 | — |
| 2 | Cable micro-USB **de datos** | Programar y alimentar la placa | Que diga «datos» o «sincronización»: muchos cables solo cargan y el computador no ve la placa | 1 | Imprescindible |
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
| 2 | Cable micro-USB de datos | Cable micro USB para cargar y transferir datos (largo no declarado en el texto) | 2 190 | https://www.mechatronicstore.cl/cable-micro-usb-de-datos/ |
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

**Piezas 8 y 9** (solo si hay pasarela / opcional), sin cambios respecto de la revisión de la mañana: radio SX1276 de 915 MHz
con antena helicoidal en Afel, CLP 18 000; batería con protección declarada, sin opción encontrada. Referencia: pasarela
Milesight UG65 4G AU915 en MCI, CLP 439 990.
