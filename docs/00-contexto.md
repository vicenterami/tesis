# Contexto de la tesis — punto de partida

> Documento de traspaso. Léelo al iniciar una sesión nueva dedicada a la tesis.


## Idea central

Plataforma web (dashboard) para **gestionar la conectividad de una flota de sensores IoT** en entornos de producción, integrando dispositivos que llegan por distintas redes: radio LoRa/LoRaWAN, WiFi local y redes remotas.

El aporte no está en mostrar el dato del sensor (eso ya lo hace la competencia), sino en la **capa de administración de red**: qué dispositivos existen, por qué red llegan, si el enlace está sano, y cómo se incorpora uno nuevo de forma segura. Es la vista del administrador TI, no la del operario que mira una temperatura.

**Una frase para defenderla:** *una plataforma que permite a un administrador de TI ver, aprovisionar y diagnosticar la conectividad de sensores heterogéneos —LoRa, WiFi, remotos— bajo criterios de entorno de producción: segmentación, seguridad y monitoreo del enlace.*

## Contexto académico

- **Profesor guía:** especialista en Cisco, redes y conexiones. Es el eje de la tesis — el enfoque debe inclinarse a redes, no a electrónica.
- **Profesor secundario:** consultas sobre sensores, Arduino y hardware.
- **Ubicación:** La Araucanía, Chile. Región agrícola y de pymes productivas, lo que da casos de uso reales (invernaderos, bodegas, cámaras de frío, estanques).

## Fundamentos técnicos ya investigados

- **LoRa** es la capa física de radio (modulación *Chirp Spread Spectrum*, patente Semtech): largo alcance, bajo consumo, poquísimos datos.
- **LoRaWAN** es el protocolo de red encima: registro de dispositivos (OTAA/ABP), cifrado AES-128 extremo a extremo, clases A/B/C.
- Analogía útil para el profesor guía: *LoRa es a LoRaWAN lo que 802.11 es a TCP/IP*.
- **Banda en Chile:** 915–928 MHz (plan AU915), espectro libre sin licencia.
- **Alcance:** 2–5 km urbano, 10–15 km rural. **Velocidad:** 0,3–27 kbps (solo lecturas y alertas, nunca video).
- **Topología:** estrella de estrellas. Los nodos no se conectan entre sí ni al WiFi; hablan por radio con cualquier gateway al alcance. El gateway solo traduce radio→IP sin descifrar nada.
- **Cadena completa:** nodo sensor → gateway → servidor de red (ChirpStack) → MQTT → dashboard.

## Ángulo de redes (lo que sostiene la tesis)

- **Misma red local:** descubrimiento y monitoreo directo, latencia mínima, sin depender de internet.
- **Redes distintas / remotas:** los nodos no son alcanzables por NAT/firewall. La solución correcta es que el dispositivo **inicie la conexión saliente** hacia un broker MQTT central — nunca abrir puertos hacia adentro.
- **Segmentación:** los dispositivos IoT van en su propia VLAN, aislados de la red corporativa (material Cisco directo: VLANs, ACLs, 802.1X).
- **Seguridad:** AES-128 en LoRaWAN + TLS para MQTT (puerto 8883), certificados por dispositivo, rotación de claves.
- **Métricas de salud del enlace:** RSSI, SNR, paquetes perdidos, última vez visto, nivel de batería.

## Competencia regional

| Empresa | Qué hace | Dónde queda el espacio |
|---|---|---|
| [IoT3.cl](https://iot3.cl/) | Monitoreo y automatización en tiempo real; sensores + controladores + plataforma web. Fuerte en agricultura. | Vende la solución completa por proyecto. No se posiciona en gestión de conectividad. |
| [ControlTec.cl](https://www.controltec.cl/) (SpA, 2021) | Telemetría industrial inalámbrica: estanques, combustible, climatización. Supervisión desde el celular. | Panel de telemetría, no herramienta de administración de red. |

## Stack candidato (todo open source, instalable localmente)

- `ChirpStack` — servidor de red LoRaWAN
- `Mosquitto` — broker MQTT
- `InfluxDB` o `TimescaleDB` — base de datos de series de tiempo
- Aplicación web propia — **aquí está el aporte original de la tesis**

## Hardware mínimo para demostrar

- 1 gateway LoRaWAN (Dragino o RAK, ~USD 100–200)
- 3–4 nodos: ESP32/Arduino + módulo LoRa (RFM95 o placas Heltec)
- Sensores: magnético de puerta (reed switch), movimiento PIR, temperatura/humedad (DHT22 o SHT31), micrófono para nivel de ruido en dB

## Estado actual y próximos pasos

Todo lo anterior es investigación de base ya hecha. **Nada está comprometido con los profesores todavía.** Lo que sigue:

1. Definir el alcance con el profesor guía: ¿el MVP gestiona solo LoRaWAN o también sensores WiFi/MQTT desde el inicio? (Recomendación: ambos, con un caso simple de cada uno — es justamente lo que hace tesis a la idea.)
2. Conseguir el hardware mínimo.
3. Levantar ChirpStack + Mosquitto y lograr la primera lectura de extremo a extremo.
4. Diseñar el modelo de datos: dispositivo, red, sitio, métrica de salud, evento, alerta.
5. Redactar el anteproyecto: problema, objetivo general, objetivos específicos, metodología.

## Preguntas abiertas

- ¿Hay un caso real (empresa, predio, bodega) donde se pueda instalar el piloto?
- ¿El profesor guía prefiere que el énfasis sea diseño de red o desarrollo de la plataforma?
- ¿Qué exige la carrera como entregable: prototipo funcional, documento, o ambos?

## Recursos


