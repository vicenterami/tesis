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

## 3. Cotización (8 de octubre de 2026)

Precios vistos en la página de cada tienda; cada precio se comprobó en el HTML de esa página el mismo día. En las páginas de
Afel aparecen a la vez «Agotado» y «N en existencias»: **confirmar el stock al comprar**. ✅ = recomendada.

| # | Pieza | Tienda · producto | Precio (CLP) | ¿Cumple? | URL |
|---|---|---|---|---|---|
| 2 | Cable micro-USB de datos | ✅ MCI · Cable Micro USB 1 m Mlab | 4 990 | Sí: «transferencia de datos» | https://mcielectronics.cl/shop/product/cable-usb-a-micro-usb-negro/ |
| 3 | BME280 | ✅ Afel · Sensor Barométrico BME280 | 8 650 | Sí: BME280, con humedad | https://afel.cl/products/sensor-barometrico-bme280 |
| 4 | Protoboard 830 | ✅ MCI · Protoboard 830 pts MB-102 | 2 990 | Sí | https://mcielectronics.cl/shop/product/protoboard-de-tamano-completo-830pts-mb-102-23380/ |
| 5 | Dupont macho-macho | ✅ MCI · Pack 40, 20 cm (alternativa: Afel, pack 20, 1 000) | 2 990 | Sí | https://mcielectronics.cl/shop/product/cable-dupont-macho-macho-20cm-pack-40-unidades-2/ |
| 5 | Dupont macho-hembra | ✅ Afel · Pack 20, 20 cm (MCI: pack 40, la ficha dice 20 y 10 cm) | 1 000 | Sí | https://afel.cl/products/pack-20-cables-de-conexion-macho-hembra |
| 6 | DS18B20 sumergible | ✅ MCI · DS18B20 resistente al agua, 1 m | 2 690 | Sí: acero, 1 m | https://mcielectronics.cl/shop/product/sensor-de-temperatura-ds18b20-resistente-al-agua-1m-25764/ |
| 7 | Humedad de suelo capacitivo | — sin opción adecuada: el Sonoff MS01 (12 590) es accesorio de otra marca; el Grove no declara el tipo; el de Afel es resistivo | — | No | — |
| 8 | Radio LoRa 915 MHz (solo si hay pasarela) | Afel · SX1276 915 MHz + antena helicoidal | 18 000 | Sí: 915 MHz con antena | https://afel.cl/products/modulo-rf-lora-sx1276-915mhz-v2-0-spi-antena-helicoidal |
| 8 | (alternativas) | MCI · SX1276 915 MHz sin antena declarada (14 990) · MCI · Heltec WiFi LoRa 32 **V2** 915 MHz (35 990) | — | Parcial | — |
| 9 | Batería protegida | — sin opción con protección declarada | — | No | — |
| — | Referencia: pasarela LoRaWAN AU915 | MCI · Milesight UG65 4G AU915 (439 990) · UG63 v2 (194 990, AU915 sin confirmar en el SKU) | — | — | — |

**Total de lo imprescindible y recomendado con stock confirmable (piezas 2 a 6): CLP 23 310.** Falta un sensor capacitivo de
suelo genérico (buscar «sensor capacitivo humedad suelo v1.2») y, solo si se confirma una pasarela, la radio de 915 MHz.
