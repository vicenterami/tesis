# Protocolo de comunicación sensor ↔ plataforma

> **Sustenta:** OE2 · criterio 3 de la Etapa 1 (análisis de requerimientos, **45 %**)
> **Fase PPDIOO:** Plan + Design
> **Instrucción del profesor guía (17/08/2026):** *«debo generar un protocolo de comunicación con
> Contact ID protocol; averiguar cómo es el proceso, tenerlo definido, y el porqué se usa este en vez
> de otro»*
> **Versión:** borrador 1 — 17 de agosto de 2026

---

## Índice

1. [Qué es Contact ID y cómo funciona](#1-qué-es-contact-id-y-cómo-funciona)
   · [1.6 El protocolo en la industria: el caso de las alarmas monitoreadas](#16-el-protocolo-en-la-industria-por-qué-el-ejemplo-de-las-alarmas-monitoreadas-es-pertinente)
2. [Evaluación de alternativas](#2-evaluación-de-alternativas)
3. [Verificación de la restricción de tamaño](#3-verificación-de-la-restricción-de-tamaño)
4. [La limitación de Contact ID y la arquitectura de dos planos](#4-la-limitación-de-contact-id-y-la-arquitectura-de-dos-planos)
5. [Perfil de aplicación propuesto](#5-perfil-de-aplicación-propuesto-el-aporte)
6. [Contrato preliminar de la API de ingesta](#6-contrato-preliminar-de-la-api-de-ingesta)
7. [Pendientes de verificación](#7-pendientes-de-verificación)
8. [Referencias](#8-referencias)

---

# 1. Qué es Contact ID y cómo funciona

## 1.1 Origen y posición en la familia de estándares SIA

**Contact ID** es un protocolo de reporte de eventos creado por Ademco para que los paneles de alarma
comuniquen sucesos a las centrales de monitoreo. Fue formalizado por la **Security Industry
Association (SIA)** como estándar **DC-05**, cuya edición vigente es **DC-05-2016**.

Conviene distinguir tres estándares SIA que se confunden con frecuencia, porque **no compiten entre sí
sino que se apilan**:

| Estándar | Capa | Qué define |
|---|---|---|
| **DC-05** (Contact ID) | **Aplicación** | El **formato del mensaje de evento**: qué campos tiene y qué significa cada código |
| DC-03 (SIA) | Aplicación | Formato alternativo, más expresivo pero más extenso |
| **DC-09** | **Transporte** | Cómo se **transportan** mensajes DC-05 o DC-03 **sobre IP** (TCP o UDP), con cifrado AES opcional |

> **Consecuencia de diseño importante:** la elección no es «Contact ID *versus* DC-09». Contact ID es
> el formato del mensaje y DC-09 es su transporte moderno sobre redes IP. **Se usan juntos.**

La revisión **DC-09-2026**, publicada en marzo de 2026 con aprobación ANSI, incorpora dos elementos
directamente pertinentes a este trabajo: **auto-comisionamiento** de dispositivos y **rotación de
claves de cifrado**. Ambos corresponden a preocupaciones de administración de red —aprovisionamiento
seguro y gestión del ciclo de vida de credenciales— que son precisamente el eje del proyecto.

## 1.2 Gramática del mensaje

Un mensaje Contact ID es una secuencia de **16 dígitos** con la siguiente estructura:

```
   ACCT      MT    Q    XYZ     GG    CCC    S
  ┌────┐   ┌──┐  ┌─┐  ┌───┐   ┌──┐  ┌───┐  ┌─┐
  │1234│   │18│  │1│  │381│   │00│  │007│  │B│
  └────┘   └──┘  └─┘  └───┘   └──┘  └───┘  └─┘
    │       │     │     │      │     │      │
    │       │     │     │      │     │      └─ checksum
    │       │     │     │      │     └──────── zona 007 (el dispositivo)
    │       │     │     │      └────────────── grupo/partición 00
    │       │     │     └───────────────────── código de evento: 381
    │       │     └─────────────────────────── calificador: 1 = nuevo evento
    │       └───────────────────────────────── tipo de mensaje: 18
    └───────────────────────────────────────── cuenta/abonado 1234

  Lectura: «en la cuenta 1234 se produjo un nuevo evento de pérdida de
            supervisión RF en el dispositivo 007»
```

| Campo | Dígitos | Contenido |
|---|---|---|
| **ACCT** | 4 | Número de abonado (cuenta) |
| **MT** | 2 | Tipo de mensaje. Siempre `18` (preferido) o `98` (opcional) |
| **Q** | 1 | Calificador del evento: **1** = nuevo evento o apertura · **3** = restauración o cierre · **6** = estado previo aún presente |
| **XYZ** | 3 | Código de evento |
| **GG** | 2 | Grupo o partición. `00` indica que no aplica |
| **CCC** | 3 | Número de zona (para eventos) o de usuario (para aperturas/cierres). `000` si no aplica |
| **S** | 1 | Checksum |

**El calificador `Q` merece atención especial.** Es lo que convierte un simple aviso en una **máquina
de estados**: el mensaje `1` abre una condición y el `3` la cierra. Aplicado a la gestión de
sensores, esto significa que el protocolo distingue nativamente entre *«el nodo 007 dejó de
reportar»* (`Q=1`, código 381) y *«el nodo 007 volvió a reportar»* (`Q=3`, código 381). La plataforma
no necesita inferir el fin de una condición: el protocolo lo declara.

## 1.3 Alfabeto y cálculo del checksum

Contact ID no usa el alfabeto decimal habitual, porque su transporte original fue **DTMF** (los tonos
del teclado telefónico), donde no existe un tono para el cero. El alfabeto es de **15 símbolos**:

| Símbolo | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | **0** | **B** | **C** | **D** | **E** | **F** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Valor** | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | **10** | **11** | **12** | **13** | **14** | **15** |

El **checksum** `S` es el símbolo que satisface:

```
(suma de los valores de los 15 dígitos del cuerpo + valor de S)  mod 15  =  0
```

### Ejemplo trabajado

Mensaje: cuenta `1234`, nuevo evento (`Q=1`), código `381` (pérdida de supervisión RF), grupo `00`,
zona `007`.

| Dígito | 1 | 2 | 3 | 4 | 1 | 8 | 1 | 3 | 8 | 1 | 0 | 0 | 0 | 0 | 7 | **Σ** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Valor | 1 | 2 | 3 | 4 | 1 | 8 | 1 | 3 | 8 | 1 | **10** | **10** | **10** | **10** | 7 | **79** |

`79 mod 15 = 4` → falta `15 − 4 = 11` para completar el múltiplo → el símbolo de valor 11 es **`B`**.

**Mensaje completo:** `123418138100007B` — verificado: `79 + 11 = 90`, y `90 mod 15 = 0`. ✅

> **Verificación empírica.** El cálculo no se asume: la herramienta
> `historico/herramientas/contactid.py` genera y valida mensajes, y comprueba que la alteración de un
> solo dígito invalida el checksum. Ejecutable con `python3 historico/herramientas/contactid.py`.

**Capacidad de detección de errores.** El checksum módulo 15 detecta cualquier error de un solo
dígito, pero **no detecta transposiciones** (intercambiar dos dígitos no altera la suma). Es una
limitación a documentar: sobre un transporte con integridad propia —LoRaWAN aporta un MIC de 4 bytes,
TLS aporta su propio MAC— el checksum funciona como verificación de sanidad de la capa de aplicación,
no como el único mecanismo de integridad.

## 1.4 El proceso de transmisión

### Transporte histórico: DTMF sobre línea telefónica

El proceso original, que explica el diseño del formato:

```
  Panel                                          Receptora
    │                                                │
    │──── descuelga y marca ────────────────────────▶│
    │                                                │
    │◀─── handshake: tonos 1400 Hz + 2300 Hz ────────│  «estoy lista, hablo Contact ID»
    │                                                │
    │──── 16 dígitos DTMF (~1,6 s) ─────────────────▶│
    │                                                │
    │◀─── kissoff: tono 1400 Hz ─────────────────────│  «recibido y con checksum válido»
    │                                                │
    │──── cuelga ───────────────────────────────────▶│
```

El **kissoff** es el elemento relevante: la receptora solo lo emite si el checksum es correcto. Si el
panel no lo recibe, **reintenta**. Es decir, el protocolo incorpora **confirmación explícita a nivel
de aplicación**, independiente del transporte. Ese comportamiento se conserva en el diseño propuesto.

### Transporte moderno: SIA DC-09 sobre IP

DC-09 encapsula el mensaje DC-05 en una trama sobre **TCP o UDP**, identificando el formato mediante
un token:

| Token | Significado |
|---|---|
| `ADM-CID` | Ademco Contact ID, sin cifrar |
| `*ADM-CID` | Ademco Contact ID **cifrado con AES** |
| `SIA-DCS` / `*SIA-DCS` | Formato DC-03, sin cifrar / cifrado |

El asterisco indica cifrado. DC-09 admite **AES-128, AES-192 y AES-256**, con clave precompartida
expresada en hexadecimal (32, 48 o 64 caracteres respectivamente). La revisión **DC-09-2026** añade
rotación de claves.

**Esto resuelve la objeción de seguridad de forma nativa:** no hace falta inventar una capa de cifrado
para el protocolo, porque el estándar ya la define, y con un algoritmo coherente con el que LoRaWAN
usa de fábrica (AES-128).

## 1.5 Vocabulario de códigos de evento aplicable a gestión de sensores

Este es el punto que hace a Contact ID inesperadamente apropiado para el problema: **su vocabulario ya
incluye los eventos de salud de dispositivos inalámbricos** que un sistema de gestión de sensores
necesita reportar.

### Códigos de estado del dispositivo y del enlace

| Código | Significado | Uso en la plataforma |
|---|---|---|
| **381** | Pérdida de supervisión RF | **El nodo dejó de reportar.** Con `Q=3`, se restableció |
| **384** | Batería baja en zona RF | Mantenimiento preventivo del nodo |
| **383** | Manipulación de sensor (*tamper*) | Intervención física del dispositivo |
| **380** | Problema de sensor / avería | Falla del elemento sensor |
| **344** | Interferencia en receptor RF (*jamming*) | Degradación del medio radioeléctrico |
| **302** | Batería baja del sistema | Alimentación del gateway |
| **301** | Pérdida de alimentación de red | Corte eléctrico en el sitio |
| **350** | Problema de comunicación | Falla del enlace del gateway |
| **602** | Reporte de prueba periódico | *Heartbeat*: confirma que el sistema vive |
| **603** | Transmisión RF periódica | *Heartbeat* de nodo por radio |
| **305** | Reinicio del sistema | Detección de reinicios anómalos |

### Códigos de condición medida y de acceso

| Código | Significado | Caso de uso regional |
|---|---|---|
| **158** | Temperatura alta | Cámara de frío, invernadero, sala de servidores |
| **159** | Temperatura baja | Riesgo de helada, cadena de frío |
| **154** | Fuga de agua | Estanques, riego, sala técnica |
| **161** | Pérdida de flujo de aire | Ventilación, climatización |
| **134** | Intrusión entrada/salida | Apertura de puerta de bodega |
| **132** | Intrusión perimetral | Perímetro de predio |
| **130** | Intrusión | Alarma general |
| **150** | Alarma auxiliar 24 h | Condición genérica configurable |
| **400** | Apertura / cierre | Acceso autorizado, con identificación de usuario en `CCC` |
| **570** | Zona anulada (*bypass*) | Nodo puesto en mantenimiento |

> **Observación central del análisis.** Los códigos 381, 384, 344, 602 y 603 constituyen, en conjunto,
> un **vocabulario normalizado de salud de enlace de dispositivos inalámbricos** que existe desde
> antes de que el término «IoT» se acuñara. La industria de seguridad electrónica resolvió el problema
> de supervisar miles de nodos de radio a batería décadas atrás, y estandarizó su vocabulario. Este
> trabajo lo reutiliza en lugar de inventar uno nuevo.

## 1.6 El protocolo en la industria: por qué el ejemplo de las alarmas monitoreadas es pertinente

El profesor guía señaló como referencia los sensores de empresas de alarmas monitoreadas —**Verisure**
entre ellas— y su comunicación «tipo llamada celular». Conviene precisar el mecanismo, porque explica
el diseño del formato y valida la elección.

### La cadena de comunicación de una alarma monitoreada

```
  Sensores inalámbricos           Panel /                    Central receptora
  a batería (868/915 MHz)         comunicador                (ARC · CMS)
        │                              │                            │
        │─── radio propietaria ───────▶│                            │
        │                              │                            │
        │                              │── PSTN: DTMF ─────────────▶│  ← histórico
        │                              │── GSM/GPRS: DTMF o datos ──▶│  ← «llamada celular»
        │                              │── IP: SIA DC-09 ──────────▶│  ← actual
        │                              │                            │
        │                              │   en los tres casos el mensaje de
        │                              │   aplicación es CONTACT ID
```

**La «comunicación celular» que mencionó el profesor es un cambio de transporte, no de protocolo.**
Los comunicadores GSM del sector convierten la marcación DTMF de línea fija en marcación DTMF sobre
red celular (2G/3G/4G) **conservando el mensaje Contact ID intacto**. El protocolo de aplicación es el
mismo desde 1985: cambió el medio, no el formato.

Esto explica por qué el mensaje tiene **16 dígitos y no un objeto JSON**: tenía que caber en tonos
telefónicos por una línea analógica. **Y esa restricción de hace cuatro décadas es exactamente la que
hoy lo hace apropiado para LoRa.** El protocolo fue diseñado para un canal estrecho, poco fiable y
costoso por transmisión — la misma descripción del enlace de un nodo LoRa a batería.

### El caso Verisure, y por qué es el ejemplo del problema *y* de la solución

Verisure Securitas Direct opera con **GSM como canal principal** y añadió **Sigfox como canal
secundario** en su parque instalado: cuando el panel detecta la **pérdida de señal GSM** —señal de un
intento de interferencia o *jamming*— emite la alerta por la red alternativa para garantizar
continuidad del servicio.

Dos observaciones que interesan directamente a este trabajo:

1. **Es multiprotocolo por diseño, y por la razón correcta.** Un operador que se juega la continuidad
   del servicio no se ata a un solo transporte. Refuerza el requisito de no cerrarse a una sola
   tecnología de radio, que fue una indicación explícita del profesor guía.
2. **La condición que detecta —pérdida del enlace por interferencia— es el código 344 de Contact ID.**
   El vocabulario del protocolo ya contempla exactamente ese evento. No hay que inventar nada para
   expresarlo.

**Y aquí está la observación central:** Verisure, como el resto del sector, es un **sistema cerrado y
verticalmente integrado**. Sus sensores solo hablan con su panel; su panel solo reporta a su central;
el cliente no puede llevarse sus datos ni conectar un sensor de otra marca. **Eso es literalmente la
causa C2 (acoplamiento hardware-plataforma) y la causa C3 (dependencia de proveedor) del problema
definido en `docs/01-problema-y-objetivos.md`.**

> **El planteamiento del trabajo, en una línea:** la industria de la seguridad electrónica resolvió
> hace décadas el problema de supervisar flotas de sensores inalámbricos a batería, y estandarizó su
> vocabulario en un protocolo **abierto** (ANSI/SIA DC-05) — pero lo aplica dentro de **sistemas
> cerrados**. Este trabajo toma ese protocolo estándar y lo usa como contrato de interoperabilidad de
> una **plataforma abierta**, extendiendo su transporte a LoRaWAN, WiFi/HTTP y MQTT, para que quien ya
> posee sensores administre sus propios datos.

### Sobre el transporte celular por voz: por qué el diseño usa DC-09 y no DTMF

El transporte DTMF sobre llamada celular está en retirada porque **las redes 2G y 3G están siendo
desactivadas** por los operadores a nivel mundial, y la transmisión de tonos de voz depende de un
canal conmutado que ya no está garantizado. La migración del sector va hacia **datos sobre IP con
DC-09**, que es el transporte que este trabajo adopta.

> ⚠️ **Pendiente de verificación** (P6): estado del apagado de 2G/3G en Chile por operador. No afecta
> la decisión de diseño —DC-09 sobre IP es la opción correcta en cualquier caso— pero es un dato de
> contexto que fortalece la justificación.

### Consecuencia para la ingesta de sensores WiFi

La pregunta de fondo era si el enfoque sirve también para sensores WiFi. **Sí, y sin fricción.** El
mensaje Contact ID es agnóstico del transporte: son 16 dígitos. Un nodo WiFi (por ejemplo un ESP32)
puede construir el mensaje y enviarlo por **HTTP a la API** (vía C de la sección 5.3), sin línea
telefónica, sin módem celular y sin gateway LoRa.

Es decir: **el mismo formato de evento llega por tres caminos distintos y se almacena una sola vez,
normalizado.** Esa convergencia es el resultado que la plataforma debe demostrar.

---

# 2. Evaluación de alternativas

Esta sección responde la pregunta del profesor guía: **por qué este protocolo y no otro.**

## 2.1 Criterios de evaluación y su ponderación

Los pesos derivan de las causas del problema identificadas en `docs/01-problema-y-objetivos.md` y de
las restricciones técnicas del entorno.

| # | Criterio | Peso | Fundamento del peso |
|---|---|---|---|
| **C-A** | **Compacidad del mensaje** | **25 %** | Restricción dura: el payload útil de LoRaWAN puede bajar a 11 bytes. Un protocolo que no quepa queda descartado por física, no por preferencia |
| **C-B** | **Normalización semántica de eventos** | **20 %** | Es la causa **C1** del problema: la fragmentación de formatos. Un protocolo sin vocabulario cerrado reproduce el problema en lugar de resolverlo |
| **C-C** | **Interoperabilidad con infraestructura instalada** | **15 %** | El problema se define sobre organizaciones que **ya tienen** equipamiento. Poder hablar con lo instalado es parte de la solución |
| **C-D** | **Seguridad nativa del transporte** | **15 %** | Requisito de entorno de producción y eje del enfoque de redes del trabajo |
| **C-E** | **Soporte de telemetría con valor y unidad** | **10 %** | Necesario, pero resoluble con un plano complementario (ver sección 4) |
| **C-F** | **Costo de implementación en nodo restringido** | **15 %** | Los nodos son microcontroladores con memoria de kilobytes y presupuesto energético estricto |

Escala de puntuación: **1** (inadecuado) a **5** (óptimo).

## 2.2 Alternativas consideradas

| Alternativa | Descripción | Referencia |
|---|---|---|
| **MQTT + JSON ad hoc** | Publicación de objetos JSON con esquema definido por cada fabricante. Es el estado actual del problema | ISO/IEC 20922 |
| **CoAP** | Protocolo tipo REST binario sobre UDP, diseñado para dispositivos restringidos | RFC 7252 |
| **LwM2M** | Modelo de gestión de dispositivos de OMA sobre CoAP, con objetos estandarizados | OMA LwM2M 1.2 |
| **Sparkplug B** | Especificación sobre MQTT con Protocol Buffers, orientada a industria y SCADA | Eclipse Sparkplug 3.0 |
| **SenML** | Formato de representación de mediciones con unidad y marca temporal | RFC 8428 |
| **CayenneLPP** | Formato binario compacto de facto en el ecosistema LoRaWAN | The Things Network |
| **SIA DC-03** | El otro formato SIA: bloques de longitud variable en texto ASCII, códigos de dos letras | SIA DC-03-2017 |
| **Contact ID + DC-09** | Formato de eventos DC-05 sobre transporte IP DC-09 con AES | SIA DC-05-2016 · DC-09-2026 |

## 2.3 Matriz comparativa ponderada

| Alternativa | C-A 25 % | C-B 20 % | C-C 15 % | C-D 15 % | C-E 10 % | C-F 15 % | **Total** |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| MQTT + JSON ad hoc | 1 | 1 | 3 | 4 | 5 | 3 | **2,45** |
| CoAP | 4 | 1 | 2 | 4 | 4 | 3 | **2,95** |
| SenML | 3 | 3 | 2 | 2 | 5 | 3 | **2,90** |
| Sparkplug B | 2 | 4 | 3 | 4 | 5 | 2 | **3,15** |
| LwM2M | 3 | 4 | 3 | 5 | 5 | 2 | **3,55** |
| CayenneLPP | 5 | 2 | 2 | 3 | 4 | 5 | **3,55** |
| SIA DC-03 | 3 | 5 | 5 | 4 | 4 | 3 | **3,95** |
| **Contact ID + DC-09 con datos extendidos** | **5** | **5** | **5** | **4** | **4** | **5** | **4,75** |

> **Nota sobre la puntuación de Contact ID en el criterio C-E.** En la primera versión de este análisis
> Contact ID obtuvo **1** en soporte de telemetría, porque el mensaje DC-05 no tiene campo para un valor
> medido. Esa puntuación se corrige a **4** al verificarse que **el estándar de transporte DC-09 define un
> campo de datos extendidos** destinado precisamente a información adicional definida por el
> implementador (sección 4.3). El valor medido no requiere un protocolo aparte: cabe en un campo que el
> propio estándar reserva. No alcanza 5 porque ese campo admite solo texto ASCII, lo que resulta menos
> compacto que un formato binario dedicado.

### Justificación de las puntuaciones determinantes

**MQTT + JSON ad hoc (2,45) — es el problema, no la solución.** Obtiene 1 en normalización semántica
porque cada implementación define sus propios nombres de campo: es exactamente la causa C1. Y 1 en
compacidad: un objeto JSON típico de telemetría ocupa entre 60 y 150 bytes, muy por encima del
payload disponible en LoRaWAN. Puntúa alto solo en telemetría, donde cualquier formato libre puntúa
alto.

**CayenneLPP (3,55) — el rival más serio en compacidad.** Con 4 bytes por medición y una
implementación trivial, es imbatible en C-A y C-F. Pero puntúa 2 en normalización porque estandariza
**tipos de dato** (temperatura, humedad, presencia), **no eventos ni estados de salud del
dispositivo**: no tiene forma de expresar «este nodo dejó de reportar» ni «este nodo tiene la batería
baja». Y puntúa 2 en interoperabilidad porque vive exclusivamente dentro del ecosistema LoRaWAN,
contradiciendo el requisito de no cerrarse a una sola tecnología de radio.

**LwM2M (3,55) — técnicamente superior, operativamente desproporcionado.** Es la alternativa más
completa: modelo de objetos estandarizado, gestión del ciclo de vida del dispositivo, DTLS con
*bootstrap* de credenciales. Puntúa 5 en seguridad y telemetría. Su penalización está en C-F: la pila
completa es exigente en memoria de programa y complejidad para un nodo mínimo, y su despliegue real
se concentra en redes celulares (NB-IoT, LTE-M) más que en radio de banda libre. **Es la alternativa
que hay que reconocer honestamente como la más robusta si el proyecto tuviera un presupuesto de
hardware mayor y un solo transporte celular.**

**Contact ID + DC-09 (4,45) — gana en cinco de seis criterios y pierde estrepitosamente en uno.**

- **C-A = 5:** 8 bytes verificados empíricamente (sección 3).
- **C-B = 5:** vocabulario cerrado de códigos, con eventos de salud de radio ya definidos.
- **C-C = 5:** cualquier central de monitoreo de alarmas en operación lo interpreta. Ninguna otra
  alternativa tiene una base instalada comparable **en Chile**.
- **C-D = 4:** AES-128/192/256 definido por DC-09, con rotación de claves desde la revisión 2026. No
  llega a 5 porque el cifrado es opcional y depende de clave precompartida, sin el *bootstrap*
  automático de credenciales de LwM2M.
- **C-E = 4:** el mensaje DC-05 no transporta valores, pero **el campo de datos extendidos de DC-09 sí**,
  y su formato lo define el implementador. Ver sección 4.3.
- **C-F = 5:** aritmética de enteros y concatenación de dígitos. No requiere parser, ni biblioteca de
  serialización, ni asignación dinámica de memoria.

## 2.4 Decisión

> **Se adopta Contact ID (SIA DC-05) sobre transporte DC-09 como protocolo único del perfil.** Los
> eventos se expresan en el mensaje DC-05 y las mediciones con valor viajan en el **campo de datos
> extendidos que DC-09 define** para información determinada por el implementador (sección 4.3). La
> separación entre eventos y telemetría se mantiene como **separación lógica** —tienen requisitos de
> entrega distintos— pero **no se traduce en dos implementaciones en el dispositivo.**

Argumento sintético defendible ante el profesor guía:

1. **Restricción física:** es el único candidato que combina un mensaje de 8 bytes con un vocabulario
   semántico normalizado. Los formatos compactos no normalizan semántica; los que normalizan semántica
   no son compactos.
2. **Alineación con el problema:** su vocabulario ya contiene los eventos de salud de nodos de radio a
   batería —381, 384, 344, 602, 603— que son exactamente las métricas que la plataforma debe gestionar.
3. **Interoperabilidad real:** es un estándar ANSI/SIA con base instalada, no un formato propio. La
   plataforma puede recibir eventos de paneles de alarma existentes sin modificarlos.
4. **Honestidad técnica:** se adopta reconociendo explícitamente su límite y resolviéndolo por diseño,
   no ignorándolo.

---

# 3. Verificación de la restricción de tamaño

## 3.1 Payload disponible en LoRaWAN AU915

Chile opera en la banda 915–928 MHz bajo el plan regional **AU915**. El payload de aplicación
disponible depende del *data rate* y de si aplica restricción de **tiempo de permanencia en canal**
(*dwell time*):

Chile autoriza la banda 915–928 MHz para uso libre mediante la **Resolución 737 de Subtel**, y admite
tanto el plan **AU915** como el plan **US915**. La diferencia entre ambos es relevante:

| Plan | Condición | DR0 | DR1 | DR2 | Observación |
|---|---|:---:|:---:|:---:|---|
| **AU915** | Sin restricción de *dwell time* | 51 B | 51 B | 51 B | |
| **AU915** | Con restricción de *dwell time* | no disp. | no disp. | **11 B** | AU915 la asume activa por omisión |
| **US915** | Norma FCC, sin *dwell time* | **11 B** | **53 B** | 125 B | DR0 es la tasa de máximo alcance |

> **Precisión respecto de la primera versión de este documento.** La restricción de 11 bytes no es un
> techo permanente: corresponde a la **tasa de datos más lenta**, que es la empleada para obtener el
> alcance máximo. En operación normal el payload disponible es de **51 a 53 bytes**. El diseño se
> dimensiona igualmente contra los 11 bytes, porque un protocolo que solo funcione en tasas altas
> renunciaría al alcance que justifica el uso de LoRa.

> ⚠️ **Pendiente de verificación** (P1): confirmar cuál de los dos planes regionales corresponde emplear
> en Chile según la Resolución 737, y si aplica restricción de *dwell time*. No altera la viabilidad del
> diseño, solo el margen disponible.

## 3.2 Tamaño del mensaje Contact ID

Resultados obtenidos con `historico/herramientas/contactid.py`:

| Representación | Tamaño | Comentario |
|---|---|---|
| 16 dígitos en ASCII | 16 bytes | No cabe en el peor caso |
| **16 dígitos en BCD comprimido** | **8 bytes** | Dos dígitos por byte; los símbolos `B`–`F` ocupan los nibbles `0xB`–`0xF` |

**Verificación:** 8 bytes en un payload de 11 bytes deja **3 bytes de margen**, suficientes para un
contador de secuencia de 1 byte y una marca temporal relativa de 2 bytes.

### Ejemplos verificados

| Evento | Mensaje | BCD (8 bytes) |
|---|---|---|
| Nodo 007 dejó de reportar (381, `Q=1`) | `1234 18 1 381 00 007 B` | `12 34 18 13 81 00 00 7B` |
| Nodo 007 volvió a reportar (381, `Q=3`) | `1234 18 3 381 00 007 9` | `12 34 18 33 81 00 00 79` |
| Batería baja en nodo 012 (384) | `1234 18 1 384 00 012 7` | `12 34 18 13 84 00 01 27` |
| Temperatura alta, zona 003 (158) | `1234 18 1 158 01 003 7` | `12 34 18 11 58 01 00 37` |
| Puerta abierta, zona 021 (134) | `1234 18 1 134 02 021 7` | `12 34 18 11 34 02 02 17` |
| *Heartbeat* periódico (602) | `1234 18 1 602 00 000 2` | `12 34 18 16 02 00 00 02` |
| Interferencia RF en gateway (344) | `1234 18 1 344 00 000 9` | `12 34 18 13 44 00 00 09` |

Todos con checksum válido, verificado programáticamente.

## 3.3 Comparación de tamaño frente a las alternativas

| Alternativa | Tamaño típico de un evento equivalente | ¿Cabe en 11 B? |
|---|---|---|
| **Contact ID en BCD** | **8 B** | ✅ con 3 B de margen |
| CayenneLPP (una medición) | 4 B | ✅ pero no expresa el evento |
| CoAP (cabecera + payload mínimo) | ~10–20 B | ⚠️ al límite |
| LwM2M sobre CoAP con CBOR | ~20–40 B | ❌ |
| SenML en CBOR | ~25–40 B | ❌ |
| Sparkplug B (Protobuf) | ~40–80 B | ❌ |
| JSON ad hoc | ~60–150 B | ❌ |

---

# 4. La limitación de Contact ID y la arquitectura de dos planos

## 4.1 El límite, enunciado sin rodeos

**Contact ID transporta eventos discretos codificados, no valores analógicos.**

Puede expresar *«temperatura alta en la zona 003»* (código 158). **No puede expresar** *«23,4 °C»*. El
campo `CCC` identifica la zona, no contiene una magnitud. No hay ningún campo para un valor medido.

Existen además dos límites de direccionamiento derivados del tamaño de los campos:

| Límite | Valor | Cálculo |
|---|---|---|
| Cuentas distintas | **50 625** | 15⁴ (alfabeto de 15 símbolos, 4 dígitos) |
| Zonas por cuenta | **3 375** | 15³ · en la práctica 999 si se restringe a dígitos decimales |

Para el alcance de este trabajo —una universidad y organizaciones productivas regionales— estos
techos son holgados. **Se documentan como límites conocidos del diseño**, no como problemas
pendientes: es información que el profesor guía puede preguntar y que debe estar respondida de
antemano.

## 4.2 La solución: dos planos con correlación por identidad

```
                 ┌───────────────────────────────────────────────┐
                 │              NODO SENSOR                      │
                 └────────────────┬──────────────────────────────┘
                                  │
              ┌───────────────────┴───────────────────┐
              │                                       │
    ┌─────────▼──────────┐                ┌───────────▼───────────┐
    │  PLANO DE EVENTOS  │                │ PLANO DE TELEMETRÍA   │
    ├────────────────────┤                ├───────────────────────┤
    │ Contact ID DC-05   │                │ CayenneLPP  (LoRa)    │
    │ sobre DC-09/AES    │                │ SenML       (IP)      │
    │                    │                │                       │
    │ 8 bytes            │                │ 4 bytes por medición  │
    │ vocabulario cerrado│                │ valor + unidad + hora │
    │ máquina de estados │                │ serie de tiempo       │
    │ confirmado (kissoff)│               │ best effort            │
    └─────────┬──────────┘                └───────────┬───────────┘
              │                                       │
              │   correlación por (ACCT, GG, CCC)     │
              └───────────────────┬───────────────────┘
                                  │
                 ┌────────────────▼──────────────────────────────┐
                 │   PLATAFORMA: normalización y persistencia    │
                 └───────────────────────────────────────────────┘
```

**Criterio de asignación:** qué viaja por cada plano.

| Va por el plano de eventos | Va por el plano de telemetría |
|---|---|
| Cruce de umbral (temperatura alta, nivel bajo) | Valor medido periódico |
| Cambio de estado (puerta abierta/cerrada) | Serie de tiempo para gráficos y análisis |
| Salud del dispositivo (batería baja, sin supervisión) | Nivel exacto de batería en porcentaje |
| Salud del enlace (jamming, sin comunicación) | RSSI y SNR numéricos por recepción |
| *Heartbeat* de supervisión | — |
| Manipulación, avería, anulación | — |

**La correlación entre planos** se realiza por la tripleta de identidad `(ACCT, GG, CCC)` más marca
temporal. Un evento de temperatura alta y las mediciones que lo rodean quedan vinculados al mismo
dispositivo, permitiendo reconstruir el contexto: *«el código 158 se disparó cuando la serie venía
subiendo desde hace 40 minutos»*.

**Ventaja operativa de la separación.** Los dos planos tienen requisitos distintos, y separarlos
permite tratarlos distinto: el plano de eventos exige **entrega confirmada** (un evento perdido es
una alarma que no suena) y el de telemetría admite **pérdida tolerable** (una lectura perdida en una
serie de mil no cambia la tendencia). Esta distinción es argumentable como decisión de ingeniería de
redes, no como una concesión ante una limitación.

## 4.3 El mecanismo del estándar: campo de datos extendidos de DC-09

La separación en dos planos responde a una necesidad real de diseño —eventos y mediciones tienen
requisitos de entrega distintos— pero **no obliga a que el dispositivo implemente dos protocolos
distintos.** El estándar de transporte DC-09 provee el mecanismo para evitarlo.

### Qué define el estándar

DC-09 especifica un **campo de datos extendidos** con la siguiente estructura:

```
[<identificador><datos>]

  identificador : un carácter ASCII mayúscula, de «A» a «Z»
  datos         : caracteres ASCII; el formato lo determina el implementador
  terminación   : el carácter «]», incluido en el mensaje transmitido
```

El estándar establece que **la longitud, el formato y el algoritmo de los datos de este campo los
determina el fabricante**, con una única restricción: **no se admite contenido binario**.

### Consecuencia para el diseño

El valor medido no requiere un protocolo aparte. Viaja en un campo que el propio estándar reserva para
información definida por el implementador:

```
Mensaje DC-09
  token    : *ADM-CID              Contact ID cifrado con AES
  msgdata  : 123418138100007B      el evento, 16 dígitos DC-05
  extdata  : [T23.4]               el valor medido
              │└──── dato en ASCII
              └───── identificador asignado por el perfil (T = temperatura)
```

**Tres propiedades que esto conserva:**

| Propiedad | Por qué se conserva |
|---|---|
| **No se sale del estándar** | El campo está definido por DC-09; solo se elige qué poner dentro |
| **La interoperabilidad queda intacta** | Una receptora que no interprete el campo lo ignora y procesa el evento igual. Es el comportamiento previsto para datos definidos por el fabricante |
| **El dispositivo implementa un solo formato** | Una sola rutina de composición de mensaje, con el valor como parámetro opcional |

### Cómo queda la implementación en cada transporte

| Transporte | Cómo viaja el evento y el valor |
|---|---|
| **HTTP y DC-09 sobre IP** | Mensaje DC-09 completo, con el evento en `msgdata` y el valor en `extdata`. Nativo del estándar |
| **LoRaWAN** | El nodo no genera tramas DC-09 —son demasiado extensas para el payload disponible—: emite **un único mensaje** con el evento en 8 bytes y el valor en el mismo paquete. **La plataforma** compone el DC-09 cuando debe reenviar a una receptora externa |
| **MQTT** | Igual que HTTP, o el formato compacto según la capacidad del cliente |

> **La distinción que importa.** Los dos planos siguen existiendo como **separación lógica**, con sus
> requisitos de entrega diferenciados, porque esa separación es correcta desde el punto de vista de
> ingeniería. Lo que se elimina es la **duplicación de implementación**: el dispositivo emite un mensaje,
> no dos, y quien programa el firmware implementa una rutina, no dos.

Esta distinción entre separación lógica y unificación de la implementación es la que responde a la
objeción legítima de que dos planos suponen el doble de trabajo en el nodo. **No lo suponen.**

### Verificación del tamaño del mensaje unificado

El campo de datos extendidos aumenta el tamaño del mensaje, porque el estándar exige texto ASCII y no
admite formato binario. Valores obtenidos con `historico/herramientas/contactid.py`:

| Mensaje | Evento | Valor | Total |
|---|:---:|:---:|:---:|
| Solo evento (`381`) | 8 B | — | **8 B** |
| Evento con batería (`[B12]`) | 8 B | 5 B | **13 B** |
| Evento con temperatura (`[T23.4]`) | 8 B | 7 B | **15 B** |
| Evento con RSSI y SNR (`[S-103/4.2]`) | 8 B | 11 B | **19 B** |

> 🔴 **Consecuencia verificada: el valor debe ser opcional.** El mensaje unificado ocupa 13 a 19 bytes, de
> modo que **no cabe en los 11 bytes de la tasa más lenta**, aunque sí en los 51-53 de operación normal.
>
> **Decisión derivada:** el valor es **opcional**. En la tasa de alcance máximo el nodo transmite solo el
> evento de 8 bytes; la medición se envía cuando el canal lo permite o en un mensaje separado de menor
> frecuencia.
>
> La degradación es deliberada y coherente con la jerarquía de requisitos: **el evento es lo que no puede
> perderse**, porque un evento no entregado es una alarma que no suena, mientras que una medición ausente
> solo interrumpe una serie. Cuando el canal se estrecha, se sacrifica la medición y se preserva el evento.

### Identificadores del perfil

El perfil CID-IoT reserva los siguientes identificadores del campo de datos extendidos. La tabla
completa se cierra en la Etapa 2.

| Id. | Contenido | Ejemplo |
|:---:|---|---|
| `T` | Temperatura en grados Celsius | `[T23.4]` |
| `H` | Humedad relativa en por ciento | `[H67]` |
| `N` | Nivel en por ciento o centímetros | `[N45]` |
| `B` | Batería en por ciento | `[B87]` |
| `V` | Tensión en voltios | `[V3.28]` |
| `S` | Calidad de señal: RSSI y SNR | `[S-103/4.2]` |
| `Q` | Contador de secuencia del nodo | `[Q1042]` |

> ⚠️ **Pendiente de verificación** (P7): determinar si DC-09 impone un límite de longitud al campo de
> datos extendidos, y si existen identificadores ya asignados por convención que deban evitarse.

---

# 5. Perfil de aplicación propuesto (el aporte)

Lo que se especifica aquí es el **aporte original del trabajo**: no el uso de Contact ID, sino un
**perfil de aplicación** que define cómo eventos de sensores heterogéneos se mapean a un vocabulario
Contact ID unificado, y cómo se transportan sobre redes que el protocolo original no contemplaba.

Nombre de trabajo: **CID-IoT** — perfil Contact ID para gestión de sensores heterogéneos.

## 5.1 Asignación del espacio de identidad

| Campo Contact ID | Uso original | **Uso en CID-IoT** |
|---|---|---|
| `ACCT` | Número de abonado | **Sitio u organización** registrada en la plataforma |
| `GG` | Partición del panel | **Zona lógica** dentro del sitio (edificio, sector, invernadero) |
| `CCC` | Zona o usuario | **Dispositivo** dentro de la zona lógica |
| `MT` | Tipo de mensaje | Se conserva `18`, para compatibilidad con receptoras existentes |
| `Q` | Calificador | Se conserva íntegro: la máquina de estados es funcionalidad deseada |
| `XYZ` | Código de evento | Se conserva el vocabulario DC-05, sin códigos inventados |
| `S` | Checksum | Se conserva el algoritmo módulo 15 |

> **Decisión de diseño:** el perfil **no inventa códigos nuevos** dentro del rango estándar. Todo
> evento se expresa con un código DC-05 existente. Esta restricción es deliberada: es lo que preserva
> la interoperabilidad con receptoras instaladas, que es el criterio C-C por el que el protocolo fue
> elegido. Inventar códigos propios convertiría el estándar en un formato ad hoc y anularía su ventaja.

## 5.2 Tabla de mapeo: de sensor heterogéneo a evento normalizado

Ejemplos del mapeo que constituye el núcleo del perfil. La tabla completa se desarrolla en la Etapa 2.

| Transporte de origen | Señal del sensor | Condición detectada | Código | `Q` |
|---|---|---|---|:---:|
| LoRaWAN | Nodo sin *uplink* en 3 intervalos | Pérdida de supervisión | **381** | 1 |
| LoRaWAN | Reaparece *uplink* del nodo | Restauración de supervisión | **381** | 3 |
| LoRaWAN | Campo de batería < umbral | Batería baja de nodo | **384** | 1 |
| LoRaWAN | *Uplink* programado recibido | *Heartbeat* de nodo | **603** | 1 |
| LoRaWAN | Gateway reporta SNR bajo persistente | Interferencia en receptor RF | **344** | 1 |
| MQTT | Mensaje *Last Will and Testament* recibido | Cliente desconectado sin aviso | **381** | 1 |
| MQTT | Reconexión del cliente | Restauración | **381** | 3 |
| MQTT / HTTP | Lectura de temperatura > umbral configurado | Temperatura alta | **158** | 1 |
| MQTT / HTTP | Temperatura vuelve al rango | Restauración | **158** | 3 |
| WiFi / GPIO | *Reed switch* abierto | Apertura de acceso | **134** | 1 |
| WiFi / GPIO | *Reed switch* cerrado | Cierre de acceso | **134** | 3 |
| Cualquiera | Sensor de humedad detecta agua | Fuga de agua | **154** | 1 |
| Cualquiera | Dispositivo puesto en mantenimiento | Zona anulada | **570** | 1 |
| Panel de alarma existente | Ya emite Contact ID nativo | *(sin traducción)* | — | — |

**La última fila es el argumento comercial y académico del perfil:** un panel de alarma existente no
necesita traducción. Ya habla el protocolo. La plataforma lo ingiere sin adaptador.

## 5.3 Extensión de transporte

El perfil define tres vías de ingesta, todas convergiendo al mismo formato de evento:

| Vía | Transporte | Uso |
|---|---|---|
| **A** | Payload LoRaWAN de 8 bytes en BCD, vía *webhook* del servidor de red | Nodos LoRa propios |
| **B** | DC-09 nativo sobre TCP/UDP con AES | Paneles de alarma e infraestructura instalada |
| **C** | API HTTP, mensaje en texto de 16 dígitos | Sensores WiFi, integraciones, pruebas |

**La vía B es el diferenciador:** ningún competidor regional identificado ofrece un punto de ingesta
compatible con la infraestructura de monitoreo de alarmas ya desplegada.

## 5.4 Elementos que el perfil debe especificar en la Etapa 2

- [ ] Gramática formal del mensaje en notación ABNF.
- [ ] Tabla de mapeo completa, con umbral de disparo y de restauración por tipo de sensor.
- [ ] Política de reintento y confirmación, equivalente funcional del *kissoff*.
- [ ] Procedimiento de aprovisionamiento: asignación de `ACCT`, `GG` y `CCC` a un dispositivo nuevo.
- [ ] Gestión de claves AES por sitio, con política de rotación alineada a DC-09-2026.
- [ ] Máquina de estados de las condiciones abiertas, con tratamiento de eventos huérfanos.
- [ ] Tratamiento de la desincronización temporal: el nodo no tiene reloj confiable.
- [ ] Comportamiento ante desbordamiento del espacio de direcciones.

---

# 6. Contrato preliminar de la API de ingesta

Especificación inicial, a formalizar en la Etapa 2 con OpenAPI.

## 6.1 Ingesta de eventos

```
POST /api/v1/eventos
Content-Type: application/json
Authorization: Bearer <credencial del sitio>

{
  "mensaje": "123418138100007B",
  "origen":  "lorawan",
  "recibido_en": "2026-08-17T21:40:00-04:00",
  "metadatos_transporte": {
    "deveui": "<identificador del nodo>",
    "rssi": -103,
    "snr": 4.2,
    "gateway": "gw-temuco-01"
  }
}
```

**Respuesta 202 — equivalente del *kissoff*:**

```json
{
  "aceptado": true,
  "checksum_valido": true,
  "evento_id": "evt_01J...",
  "interpretacion": {
    "sitio": "1234",
    "zona_logica": "00",
    "dispositivo": "007",
    "codigo": "381",
    "descripcion": "Pérdida de supervisión RF",
    "calificador": "nuevo evento",
    "estado_condicion": "abierta"
  }
}
```

**Respuesta 422 — checksum inválido:** el mensaje se rechaza y no se persiste como evento válido, pero
se registra el intento para diagnóstico. El emisor debe reintentar.

## 6.2 Ingesta de telemetría

```
POST /api/v1/telemetria
```

Cuerpo en **SenML** (RFC 8428) para clientes IP, o payload **CayenneLPP** para nodos LoRaWAN, con la
identidad del dispositivo resuelta desde los metadatos del transporte.

## 6.3 Consulta de estado — la vista de gestión

```
GET /api/v1/dispositivos?estado=sin_supervision
GET /api/v1/dispositivos/{acct}/{gg}/{ccc}/condiciones
GET /api/v1/sitios/{acct}/salud
```

El endpoint de salud del sitio es el que alimenta el panel de gestión: qué dispositivos hay, cuáles
tienen condiciones abiertas, cuáles dejaron de reportar y cuándo se los vio por última vez.

---

# 7. Pendientes de verificación

| # | Pendiente | Impacto si la respuesta es adversa |
|---|---|---|
| **P1** | ¿La normativa de Subtel impone *dwell time* en 915–928 MHz en Chile? | Ninguno sobre la viabilidad: el diseño ya usa el peor caso de 11 bytes. Solo cambia el margen |
| ~~**P2**~~ | ~~Acceso al texto íntegro de SIA DC-05 y DC-09~~ **RESUELTO**: en agosto de 2025 la SIA publicó una **implementación de referencia de DC-09 de código consultable** (licencia *Polyform Noncommercial*, que admite uso académico), y el formato está documentado en fuentes secundarias independientes. La implementación del proyecto es propia y verificada, de modo que la norma no es una dependencia | — |
| **P3** | ¿Existe alguna central de monitoreo en La Araucanía dispuesta a validar la interoperabilidad? | Debilitaría la evidencia del criterio C-C, aunque no la argumentación |
| **P4** | Confirmar el listado exacto de códigos DC-05 usados, contra al menos dos fuentes de fabricante | Riesgo de citar un código con significado inexacto |
| **P5** | Validar con el profesor guía que el enfoque de dos planos es aceptable | Si exige Contact ID puro, hay que rediseñar el tratamiento de la telemetría |
| **P6** | Estado del apagado de 2G/3G en Chile por operador | Ninguno sobre el diseño; es dato de contexto que refuerza la elección de DC-09 sobre IP frente al DTMF celular |
| **P7** | Límite de longitud del campo de datos extendidos de DC-09 e identificadores ya asignados por convención | Podría obligar a acortar la codificación de valores o a reasignar identificadores del perfil |
| **P9** | **Formato exacto de los bytes del valor en el aire (LoRa):** ASCII como en DC-09 o binario compacto (TLV de 2–3 bytes). Decidir con quien implemente el firmware | Define el contrato del firmware; el nodo nunca genera DC-09, la plataforma traduce |
| **P8** | Gramática exacta de SIA DC-03 para valores numéricos, si se obtiene acceso al estándar | Si resultara más eficiente de lo estimado, DC-03 pasaría a ser la alternativa preferente |

---

# 8. Referencias

**Estándares**

- Security Industry Association. *DC-05-2016: Ademco® Contact ID Protocol for Alarm System Communications.* [securityindustry.org](https://www.securityindustry.org/industry-standards/dc-05-2016/)
- Security Industry Association. *DC-03-2017: DCS SIA Format Standard.* [securityindustry.org](https://www.securityindustry.org/industry-standards/dc-03-2017/)
- Security Industry Association. *Implementación de referencia de ANSI/SIA DC-09*, publicada por el subcomité de intrusión en agosto de 2025. Licencia *Polyform Noncommercial 1.0.0*: admite uso no comercial, requiere licencia aparte para uso comercial. [github.com/Swissdotnet/sia-dc-09-library](https://github.com/Swissdotnet/sia-dc-09-library) · [anuncio](https://www.securityindustry.org/2025/08/26/sia-releases-open-source-library-for-ansi-sia-dc-09-implementation/)
- *Listado completo de códigos de evento SIA DC-03.* [peoplecall.com](https://peoplecall.com/dc03-sia-codes/)
- Certificación Telecom. *LoRa Chile: LoRaWAN 915 MHz AU915, Resolución 737 de Subtel.* [certificacion-telecom.cl](https://certificacion-telecom.cl/tecnologia/lora/)
- Security Industry Association. *DC-09: Internet Protocol Event Reporting.* Revisión 2026 con aprobación ANSI, auto-comisionamiento y rotación de claves. [securitytoday.com](https://securitytoday.com/articles/2026/03/04/sia-updates-dc-09-standard-for-enhanced-alarm-communication.aspx) · [pavion.com](https://pavion.com/resource/what-the-new-ansi-sia-dc-09-2026-standard-means-for-modern-alarm-monitoring/)
- LoRa Alliance. *RP002-1.0.3 LoRaWAN® Regional Parameters.* [lora-alliance.org](https://lora-alliance.org/wp-content/uploads/2021/05/RP002-1.0.3-FINAL-1.pdf)
- IETF. *RFC 8428 — Sensor Measurement Lists (SenML).*
- IETF. *RFC 7252 — The Constrained Application Protocol (CoAP).*

**Documentación técnica del formato**

- *Digital Communication Standard — Ademco® Contact ID Protocol* (especificación del formato y checksum). [voip-sip-sdk.com](https://www.voip-sip-sdk.com/attachments/583/contact_id.pdf)
- *Contact ID Event Definition Codes* (listado de códigos de evento). [fss-slc.com](http://www.fss-slc.com/manuals/A-C/Alarm%20Panels-Dialers/List-of-Contact-ID-codes.PDF)
- GeoArm Security. *What Is Contact ID — Contact ID Report Codes.* [support.geoarm.com](https://support.geoarm.com/geoarm/faqgeoarm/whatiscontactid-contactidreportcodes)
- FortSense. *SIA DC-09 Protocol: Implementation Design Guide.* [fortsense.net](https://fortsense.net/blog/sia-dc-09-protocol-for-alarm-transmission)
- The Things Network. *Regional Parameters — US902-928 / AU915.* [thethingsnetwork.org](https://www.thethingsnetwork.org/docs/lorawan/regional-parameters/us915/)
- Business Wire. *Verisure Securitas Direct Connects 200,000 Alarm Systems to the SIGFOX IoT Network* (canal secundario ante pérdida de señal GSM por interferencia). [businesswire.com](https://www.businesswire.com/news/home/20160222005802/en/Verisure-Securitas-Direct-Connects-200000-Alarm-Systems)
- Roombanker. *Contact ID Protocol: How a Security System Sends Alarm Info to ARC/CMS* (descomposición del mensaje DTMF de 16 dígitos). [roombanker.com](https://www.roombanker.com/blog/ademco-contact-id-protocol/)

**Verificación propia**

- `historico/herramientas/contactid.py` — generador y validador de mensajes Contact ID. Todos los
  ejemplos y tamaños de este documento fueron calculados con esta herramienta, no estimados.
