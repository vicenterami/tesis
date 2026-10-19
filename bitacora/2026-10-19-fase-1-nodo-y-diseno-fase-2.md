# 18–19/10/2026 — Fase 1 del nodo ESP32 con hardware real y diseño de la fase 2

**Contexto.** El equipo del nodo propio (TT-32) estaba completo desde el 13/10 y la fase 0 (placa reconocida) cerrada el 14/10. El fin
de semana se cableó el protoboard y se corrió el firmware de diagnóstico de la fase 1 (`docs/17 §6`): la pregunta era si cada sensor
responde y entrega valores creíbles, sin red de por medio.

## Fase 1: lo que se midió (`docs/16 §43`)

- **Pines confirmados contra la serigrafía** de la placa (NodeMCU ESP-32S V1.1, 38 pines): `3V3` y `P34` en la fila del `5V`; `P4`, `P21`
  y `P22` en la fila del `CLK`. Esquema editable en `plataforma/firmware/cableado-fase-1.drawio`.
- **Sonda DS18B20:** responde y mide con pasos de 0,06 °C; siguió el agua fría (18,0 °C) y la mano (23,6 °C).
- **Sensor de suelo:** 2205 mV al aire y ≈ 1170 mV con la punta en agua, ambos dentro del rango preciso del ADC: no hace falta divisor.
  Son los dos extremos de la calibración del canal `humedad_suelo` (`escala_cero` 2,205 V, `escala_cien` 1,170 V).
- **Módulo de aire (BME280):** en la primera corriente, «nadie responde» en el bus I2C. No era soldadura ni cables: el módulo estaba mal
  asentado en el protoboard. Reasentado, responde en `0x76` con registro `0xD0 = 0x60` y mide 20,6 °C, 61 %HR y 984,3 hPa.
- **Cristal:** `esptool` lo estimó en 26 MHz un día y en 40 MHz otro (estima por la velocidad de la conexión); la ROM habla legible a
  115200 y el firmware, que desde hoy imprime el valor que lee la placa, dice 40 MHz. Zanjado.
- **Dos tropiezos sin consecuencias:** se mojó la sonda de temperatura en vez del sensor de humedad (sirvió para ver que la sonda mide de
  verdad), y el monitor serie dejaba la placa reiniciándose por las líneas DTR/RTS; quedó configurado para no tocarlas y se reinicia con `EN`.

## Fase 2: diseño antes del código (`docs/17 §6.2`)

Decisiones con su porqué: biblioteca MQTT con **QoS 1** (la que exige `docs/10` a los nodos Wi-Fi; la más difundida solo publica con QoS 0 y
se descartó); **TLS con la CA propia verificando el nombre `proxy`** del certificado aunque el nodo se conecte por IP (el TLS del núcleo
compara el nombre solo con entradas DNS del certificado, no con IP); **hora solo por NTP**: con hora, el pack lleva `bt`; sin hora, no
lleva `bt` y el backend pone la hora de recepción, nunca una hora inventada; **un pack SenML por ciclo** con seis registros (aire, suelo
y la intensidad Wi-Fi como `rssi`), el suelo en V; un sensor que falla se omite del pack. El firmware `nodo` compila (72 % de la flash)
y su **contrato se probó sin la placa en el banco** (`banco.sh nodo`, `docs/16 §44`): alta con seis canales, calibración, el mismo pack
→ seis mediciones con la hora del `bt`, porcentaje en la ficha, pack sin `bt` → hora de recepción, pack con un sensor omitido → cinco.
La prueba con la placa queda para la sesión siguiente, con laboratorio guiado.

## Revisión de cierre del bloque (hallazgos verificados antes de corregir)

Doce hallazgos, ninguno de seguridad alto, todos ciertos y corregidos el mismo día: el firmware publicaba en ráfaga los ciclos
perdidos tras un corte (ahora se pierden, como dice el diseño); «con hora» se decidía por la fecha del reloj, que sobrevive a un
reinicio por software sin resincronizar (ahora solo cuando SNTP avisa); el saludo TLS podía bloquear dos minutos (tope de 10 s); el
esquema de cableado tenía el cable a tierra saliendo del pin P35 en vez del GND (la ficha cuenta los pines desde la antena y el esquema
desde el USB: el mismo número, otro pin); el suelo y la intensidad Wi-Fi nunca se omitían aunque el documento lo prometiera; el banco
no daba de baja su dispositivo de prueba; y tres afirmaciones se verificaron contra la fuente (la comparación del nombre en mbedTLS
2.28.7, descargada; el tiempo de espera del constructor de TLS, que era 30 s y no 0; y el riesgo de que, sin revisar fechas, un
certificado vencido se acepte, anotado como control pendiente en `docs/11 §4`).

## Pendiente que deja

La calibración por canal se fija por SQL porque el alta no recibe `escala_cero`/`escala_cien`: admitirlas en la API es un cambio chico
que se diseña en `docs/10 §8.4` punto 51 antes del código.
