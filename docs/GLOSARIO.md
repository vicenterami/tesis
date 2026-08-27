# Fundamentos y glosario

> **Para qué sirve:** entender y poder **explicar** cada pieza del proyecto. Si no puedes explicarle
> algo a Mario en dos frases, está en este documento.
>
> Versión: 21 de agosto de 2026

---

# 1. La idea que hay que entender antes que todas las demás

## Los protocolos se apilan, no compiten

Esta es **la confusión más común** y la que hay que tener clarísima, porque es lo que hace que la tesis
tenga sentido.

Cuando decimos «WiFi», «LoRaWAN» y «Contact ID», parece que fueran tres opciones entre las cuales hay
que elegir. **No lo son: están en niveles distintos y funcionan juntos.**

| Nivel | Qué responde | Ejemplos |
|---|---|---|
| **Aplicación** | ¿Qué **significa** el mensaje? | **Contact ID**, JSON, MQTT, SenML |
| **Red / transporte** | ¿Cómo **llega** de un punto a otro? | IP, TCP, UDP, **LoRaWAN** |
| **Física / radio** | ¿Cómo **viajan los bits** por el aire o el cable? | **WiFi (802.11)**, **LoRa**, Ethernet, 4G |

**La analogía:** una carta.

- **El idioma en que está escrita** = protocolo de aplicación → *Contact ID*
- **El sistema de direcciones y el correo** = red → *LoRaWAN, IP*
- **El camión, el avión, el cartero** = capa física → *WiFi, LoRa, cable*

La misma carta en español puede viajar en camión, avión o bicicleta. **El idioma no cambia porque
cambie el vehículo.**

> ### Y esa frase es literalmente tu tesis:
> **El mismo mensaje Contact ID llega por LoRa, por WiFi o por cable, y la plataforma lo entiende igual
> en los tres casos.** Eso es lo que ninguna plataforma comercial hace hoy.

---

# 2. Tus preguntas, respondidas

## 2.1 ¿DC-05 es un estándar? ¿Es lo mismo que decir Contact ID?

**Sí a las dos cosas, con un matiz de vocabulario.**

- **Contact ID** es el **nombre del protocolo**. Lo inventó la empresa Ademco en los años 80.
- **DC-05** es el **nombre del documento del estándar** que lo formaliza, publicado por la SIA
  (*Security Industry Association*). Su título completo es *«SIA DC-05: Ademco Contact ID Protocol»*.

Es la misma relación que en:

| Nombre popular | Nombre del estándar |
|---|---|
| Wi-Fi | IEEE 802.11 |
| Bluetooth | IEEE 802.15.1 |
| **Contact ID** | **SIA DC-05** |

**En una frase:** *Contact ID es el protocolo; DC-05 es el papel que lo define.* Decir «DC-05» suena
más formal y académico, y es lo correcto en el informe. Decir «Contact ID» es lo que se usa hablando.

**Y sí, es un estándar de verdad:** está publicado por una asociación de industria y **DC-09 —el
estándar hermano que lo transporta por internet— tiene aprobación ANSI**, que es el organismo de
normalización de Estados Unidos. No es un formato propietario.

## 2.2 ¿Contact ID viajaba por telefonía móvil?

**Casi. Empezó por telefonía fija y después se adaptó a la móvil.** El orden histórico importa:

| Época | Transporte | Cómo |
|---|---|---|
| **Años 80-2000** | **Línea telefónica fija** (PSTN) | El panel **literalmente llamaba por teléfono** a la central y «tocaba» los 16 dígitos como tonos del teclado (DTMF) |
| 2000-2020 | **Red celular** (2G/3G) | Un módem celular hace la misma llamada, con los mismos tonos. **El mensaje no cambió, cambió el vehículo** |
| **Hoy** | **Internet** (IP), con el estándar **DC-09** | El mensaje viaja como datos, cifrado con AES |

> **Aquí está el dato que más impresiona de tu tesis:** el mensaje tiene **16 dígitos y ni uno más**
> porque tenía que caber en tonos telefónicos por una línea analógica de los años 80.
>
> **Y esa restricción de hace cuarenta años es exactamente la que hoy lo hace perfecto para LoRa**, que
> también es un canal estrechísimo. Un formato diseñado para el teléfono de tu abuela resulta ideal
> para el internet de las cosas.

**Importante para tu diseño:** tú **no** vas a usar tonos telefónicos. Usas **DC-09 sobre internet**,
que es a donde migró la industria (las redes 2G y 3G se están apagando en todo el mundo). Solo
conservas el **formato del mensaje**.

## 2.3 ¿WiFi son solo señales de radiofrecuencia?

**Sí, correcto.** WiFi es radio: ondas electromagnéticas en 2,4 GHz y 5 GHz.

El nombre técnico es **IEEE 802.11**, y define dos cosas: cómo se modulan las ondas (capa física) y
cómo varios dispositivos comparten el aire sin pisarse (capa de enlace).

Sobre WiFi **no viaja información con significado por sí sola**: viaja IP, y sobre IP van HTTP, MQTT o
lo que sea. WiFi es el camión, no la carta.

## 2.4 ¿LoRaWAN son señales de radiofrecuencia de largo alcance y bajo consumo?

**Correcto en el fondo, pero hay una distinción que Mario te va a pedir**, porque es de su especialidad:

| | Qué es | Analogía |
|---|---|---|
| **LoRa** | La **radio**: la técnica de modulación (*Chirp Spread Spectrum*, patentada por Semtech). Solo define cómo viajan los bits por el aire | Es el **802.11** de LoRaWAN |
| **LoRaWAN** | El **protocolo de red** encima de esa radio: cómo se registran los dispositivos, cómo se cifra, cómo se evitan colisiones, cómo llega el dato al servidor | Es el **TCP/IP** de LoRa |

**La frase para Mario:** *«LoRa es a LoRaWAN lo que 802.11 es a TCP/IP.»* Es exacta y le va a gustar,
porque traduce IoT a su vocabulario de redes.

### Los números de LoRa

| Característica | Valor | Comparación con WiFi |
|---|---|---|
| Alcance | 2–5 km urbano, 10–15 km rural | WiFi: 30–100 m |
| Velocidad | 0,3–27 kbps | WiFi: cientos de Mbps |
| Consumo | Años con dos pilas AA | WiFi: horas o días |
| Banda en Chile | 915–928 MHz, **libre y sin licencia** | 2,4 y 5 GHz, también libre |
| Costo mensual | Cero (red propia) | Cero |

**El intercambio (*trade-off*) es brutal y hay que entenderlo:** LoRa cambia **velocidad** por
**alcance y batería**. Es entre mil y cien mil veces más lento que WiFi, y a cambio llega mil veces más
lejos con una milésima del consumo.

> **Por eso LoRa no sirve para video ni para datos pesados.** Sirve para *«cada 10 minutos envío una
> lectura de pocos bytes»* o *«aviso de inmediato cuando pasa algo»*. Que es exactamente el patrón de
> un sensor de puerta, de temperatura o de nivel de estanque.

---

# 3. Las piezas del sistema

## 3.1 MQTT — el cartero del IoT

**Qué es:** un protocolo de mensajería con un patrón llamado **publicar/suscribir**.

**Cómo funciona.** En vez de que cada dispositivo hable directamente con cada programa que necesita sus
datos, todos hablan con un intermediario llamado **broker**:

```
  sensor 1 ──publica──▶ ┌───────────┐ ──▶ el dashboard      (suscrito)
  sensor 2 ──publica──▶ │  BROKER   │ ──▶ la base de datos  (suscrita)
  sensor 3 ──publica──▶ │ MQTT      │ ──▶ el motor de       (suscrito)
                        └───────────┘     alertas
```

Los mensajes se organizan en **tópicos**, que son como rutas de carpetas:

```
sitio/temuco/invernadero-2/sensor-007/temperatura
```

Quien se suscribe a `sitio/temuco/#` recibe **todo** lo de ese sitio, sin saber qué sensores existen.

**Por qué se usa en IoT:**

| Ventaja | Por qué importa |
|---|---|
| Muy liviano | Cabe en un microcontrolador de pocos kilobytes |
| El dispositivo **inicia la conexión saliente** | **Esto es clave para tu tesis (RNF-10):** no hay que abrir puertos hacia el sensor. Funciona detrás de cualquier NAT o cortafuegos |
| Desacopla emisor y receptor | Agregar un consumidor nuevo no obliga a tocar los sensores |
| Tiene *Last Will and Testament* | El broker avisa automáticamente si un cliente se desconecta sin despedirse — **tú lo usas para generar el evento 381** |

> **El detalle del *Last Will* es oro para tu tesis.** MQTT te avisa gratis cuando un dispositivo se cae,
> y tú traduces ese aviso al código 381 de Contact ID. Está en tu tabla de mapeo.

**En tu proyecto:** MQTT es cómo ChirpStack te entrega los datos de LoRa, y también una de las tres
vías de ingesta directa. **Mosquitto** es el broker que vas a usar: la implementación de MQTT más
liviana y madura.

## 3.2 ChirpStack — el cerebro de la red LoRaWAN

**El problema que resuelve.** En una red LoRaWAN, entre el sensor y tu plataforma hay más piezas de lo
que parece:

```
  ┌──────────┐   radio    ┌──────────┐  internet  ┌─────────────┐  MQTT  ┌───────────┐
  │  NODOS   │  915 MHz   │ GATEWAY  │            │ SERVIDOR DE │        │    TU     │
  │ sensores │ ─────────▶ │ (antena) │ ─────────▶ │     RED     │ ─────▶ │PLATAFORMA │
  └──────────┘            └──────────┘            │ ChirpStack  │        └───────────┘
                                                  └─────────────┘
```

**El gateway es un traductor tonto.** Recibe la señal de radio, la empaqueta y la reenvía por internet.
**No descifra nada** — no tiene las claves. Su único trabajo es escuchar el aire.

**ChirpStack es el que piensa.** Es el **servidor de red LoRaWAN**, y hace todo lo que el gateway no
puede:

| Función | Qué significa |
|---|---|
| **Descifra** los mensajes | El cifrado es de extremo a extremo, del nodo al servidor. Solo él tiene las claves |
| **Deduplica** | Si tres gateways oyeron el mismo mensaje, entrega uno solo |
| **Administra dispositivos** | Registro, alta, baja, claves de cada nodo |
| **Verifica integridad** | Comprueba el código de autenticación y descarta lo corrupto |
| **Controla el orden** | Contadores para detectar mensajes repetidos o perdidos |
| **Reporta calidad** | Te entrega RSSI y SNR de cada recepción — **tus métricas de salud de enlace** |
| **Publica en MQTT** | Te entrega el dato limpio en un tópico. **Ahí lo tomas tú** |

**Por qué ChirpStack y no otro:**

| Alternativa | Por qué no |
|---|---|
| **The Things Network** (red pública gratuita) | Tus datos pasarían por servidores de terceros. Contradice tu requisito de control del dato |
| The Things Stack (autoalojado) | Equivalente, pero más pesado de operar |
| Hacerlo tú | Reimplementar LoRaWAN te consumiría toda la tesis, y **no es tu aporte** |

**ChirpStack es código abierto, corre en tu propio servidor, y publica en MQTT nativamente** — que es
justo lo que necesitas. Con él, tu adaptador de LoRa se reduce a *«suscribirme a un tópico»*.

## 3.3 TimescaleDB — y la buena noticia para ti

### La respuesta corta a tu pregunta

> **TimescaleDB es PostgreSQL. Es relacional. Es SQL.**
>
> **Si sabes SQL, ya sabes usarlo.** No es una tecnología nueva que tengas que aprender de cero: es una
> **extensión** que se instala sobre PostgreSQL y le agrega capacidades para datos con fecha y hora.

### Ubícalo respecto de lo que ya conoces

| Lo que conoces | Equivalente aquí |
|---|---|
| MySQL / MariaDB | **PostgreSQL** — mismo tipo de base de datos, mismo SQL, distinta implementación |
| phpMyAdmin | **pgAdmin** (o DBeaver, que sirve para ambas) |
| `SELECT * FROM tabla WHERE ...` | **Exactamente igual.** El SQL es el mismo |

**PostgreSQL y MariaDB son primos.** Ambos relacionales, ambos SQL, ambos con tablas, claves y JOIN.
Las diferencias son de detalle: PostgreSQL es más estricto con los tipos, tiene funciones más
avanzadas, y —esto es lo que importa— **admite extensiones** que le agregan capacidades.

**Viniendo de MySQL, la curva de aprendizaje de PostgreSQL se mide en horas, no en semanas.**

### Qué agrega la extensión Timescale

El problema de los datos de sensores es que **son muchísimos y siempre llevan fecha**. Cincuenta
sensores midiendo cada cinco minutos son 5 millones de filas al año. Con una tabla normal, consultar
*«dame el promedio por hora del último mes»* se vuelve lento.

TimescaleDB resuelve eso con tres cosas:

| Función | Qué hace | Sin ella tendrías que… |
|---|---|---|
| **Hypertables** | Parte la tabla automáticamente por rangos de fecha, por debajo. **Tú sigues viendo una sola tabla** | Crear y gestionar tablas por mes a mano |
| **`time_bucket()`** | Agrupa por intervalos de tiempo en una línea de SQL | Escribir consultas de agrupación complicadas |
| **Retención y compresión** | «Borra lo de más de 2 años», «comprime lo de más de 3 meses», automático | Programar tareas de limpieza |

Ejemplo de lo que te ahorra — promedio de temperatura por hora del último día:

```sql
SELECT time_bucket('1 hour', hora) AS franja,
       AVG(valor) AS promedio
FROM mediciones
WHERE dispositivo = '007' AND hora > now() - interval '1 day'
GROUP BY franja
ORDER BY franja;
```

Eso es **SQL normal**, con una sola función añadida (`time_bucket`). Nada exótico.

### Por qué esta y no otra: la razón real

| Alternativa | Por qué se descartó |
|---|---|
| **InfluxDB** (base de datos de series de tiempo pura) | Es **más rápida** escribiendo mediciones, pero **no es relacional**: no sirve para tu inventario de dispositivos, sitios, usuarios y permisos. Tendrías que **operar DOS bases de datos**: InfluxDB para las mediciones y una relacional para todo lo demás. **Dos motores que respaldar, dos que mantener, dos que consultar — trabajando tú solo, con 15 horas semanales** |
| **MariaDB o PostgreSQL sin extensión** | Funcionaría, pero tendrías que gestionar a mano el crecimiento de la tabla de mediciones y escribir las agregaciones temporales tú |

> **El argumento decisivo no fue el rendimiento, fue la carga operativa.** TimescaleDB te da **una sola
> base de datos** para las dos cosas que necesitas: lo relacional (dispositivos, sitios, usuarios) y las
> series de tiempo (mediciones). Un solo motor, un solo respaldo, un solo lenguaje.

### Y una nota honesta

**A la escala de tu prototipo, MariaDB también funcionaría.** Tu volumen está muy por debajo del punto
donde estas diferencias se notan. Si prefirieras quedarte con lo que ya conoces, sería una decisión
defendible — perderías `time_bucket` y la partición automática, y tendrías que escribirlas a mano.

**Mi recomendación sigue siendo TimescaleDB**, por tres razones:

1. La curva desde MySQL es de horas.
2. Es más defendible académicamente: es la herramienta correcta para el tipo de dato, y puedes
   justificarlo.
3. En la tesis quedas mejor mostrando que evaluaste y elegiste, que usando lo cómodo.

Pero es tu decisión, y si la cambias, se documenta y se sigue.

---

# 4. La pregunta clave: si no uso Contact ID puro, ¿qué uso?

Esta es la pregunta más importante que has hecho. La respuesta:

> ## Usas **dos** protocolos, uno para cada tipo de información.

| | **Plano de eventos** | **Plano de telemetría** |
|---|---|---|
| **Protocolo** | **Contact ID (DC-05)** sobre DC-09 | **CayenneLPP** (en LoRa) · **SenML** (en IP) |
| **Qué transporta** | *«Algo pasó»* | *«El valor es X»* |
| **Ejemplo** | «Temperatura alta en zona 3» | «23,4 °C a las 14:05» |
| **Tamaño** | 8 bytes | 4 bytes por medición |
| **Requisito de entrega** | **Confirmada.** Un evento perdido es una alarma que no suena | **Pérdida tolerable.** Una lectura perdida entre mil no cambia la tendencia |

## La analogía que lo explica todo

**Un monitor cardíaco en un hospital.**

- La **pantalla con la línea del pulso** subiendo y bajando continuamente → **telemetría**. Si se pierde
  medio segundo de gráfico, no pasa nada.
- La **alarma que suena** cuando el pulso se sale del rango → **evento**. Si esa alarma no suena, alguien
  se muere.

**Son dos cosas distintas, con dos requisitos distintos, y por eso viajan por caminos distintos.** Nadie
diseñaría un monitor cardíaco que mandara la alarma por el mismo canal «best effort» que el gráfico.

## Actualización del 21 de agosto: un mensaje, no dos

La investigación posterior encontró que **el estándar DC-09 ya define el mecanismo para evitar dos
implementaciones**: un campo de datos extendidos con la forma `[<identificador A-Z><datos ASCII>]`, cuyo
formato **lo determina el implementador**.

```
Mensaje DC-09
  token   : *ADM-CID          Contact ID cifrado con AES
  msgdata : 123418138100007B  el evento
  extdata : [T23.4]           el valor medido
```

**Consecuencia:** los dos planos siguen existiendo, pero como **separación lógica en la plataforma**, no
como dos caminos en el dispositivo. El nodo emite **un solo mensaje** y quien programa el firmware
implementa **una sola rutina**.

Y una receptora de alarmas que no interprete ese campo simplemente lo ignora y procesa el evento igual —
que es el comportamiento previsto por la norma para datos definidos por el fabricante.

**El costo verificado:** el mensaje pasa de 8 bytes (solo evento) a 13–19 bytes (con valor). No cabe en
los 11 bytes del enlace de alcance máximo, así que **el valor es opcional**: cuando el canal se estrecha
se manda solo el evento.

## Un contenido, dos envolturas — y quién traduce

**DC-09 es un formato de internet. Un nodo LoRa no lo genera** (una trama DC-09 completa pesa más de
50 bytes). Lo que viaja por el aire es mucho más simple:

```
   POR EL AIRE (LoRa)                          POR INTERNET (DC-09)
   lo que emite el nodo                        lo que arma la plataforma si reenvía
   ┌──────────────┬────────┐                   token   : *ADM-CID
   │ 8 bytes BCD  │ valor  │  ─ChirpStack─▶    msgdata : 1234181158010037
   │ 12 34 18 11  │ 2-7 B  │  ─MQTT──────▶     extdata : [T23.4]
   │ 58 01 00 37  │        │                   + AES, secuencia, CRC
   └──────────────┴────────┘
```

- **16 dígitos, no 16 bits:** cada dígito ocupa medio byte → 16 dígitos = 8 bytes = 64 bits.
- **El valor va después, en el mismo paquete.** LoRaWAN es una bolsa de bytes de hasta 51 (11 en la tasa
  más lenta): el nodo la llena como quiera. Con valor son 13–19 bytes → cabe en operación normal, no en
  la tasa lenta → el valor es opcional.
- **«Datos extendidos» es el nombre que DC-09 da al concepto.** En el aire son simplemente «los bytes
  que siguen al evento». El formato exacto (ASCII `[T23.4]` o binario de 2–3 bytes) **se decide en la
  Etapa 2 con quien programe el firmware.**
- **La plataforma es la traductora:** recibe, separa evento y valor en los dos planos, guarda, y solo si
  debe hablar con una central de alarmas externa envuelve en DC-09.

### El sensor emite, no se suscribe

El sensor **publica**. Suscribirse es lo que hace la plataforma. Y el nodo LoRa **jamás toca MQTT**:
en su firmware hay una función que llena un arreglo de bytes y se lo pasa a la librería LoRaWAN del chip,
que hace la radio. MQTT ocurre entre ChirpStack y la plataforma, en servidores. Un nodo **WiFi** (ESP32)
sí puede hablar MQTT/HTTP directo porque tiene internet.

**El contrato con quien haga el firmware, en una frase:** *«un arreglo de 8 bytes con el evento y, si hay
medición, los bytes del valor a continuación; la tabla exacta se define en la Etapa 2 y se entrega con
la función de referencia en Python para verificar la implementación».*

### La analogía 802.11 / TCP-IP, aterrizada

| Mundo del portátil | Mundo del sensor | Qué hace |
|---|---|---|
| **802.11** (WiFi) | **LoRa** | La radio: cómo viajan los bits por el aire |
| **TCP/IP** | **LoRaWAN** | La red: quién es cada dispositivo, cifrado, cómo llega al servidor |
| La página web | **Contact ID** | El contenido, que no cambia según el medio |

La misma página web llega igual por WiFi, cable o 4G: TCP/IP no cambia, solo el tramo de radio de abajo.

## Qué significaría «Contact ID puro»

Si Mario exigiera que absolutamente todo pase por Contact ID:

| Podrías hacer | No podrías hacer |
|---|---|
| Avisar «temperatura alta en zona 3» | Guardar «23,4 °C» |
| Avisar «el nodo 007 se cayó» | Mostrar un gráfico de temperatura |
| Avisar «batería baja» | Decir «la batería está al 23 %» |
| Avisar «volvió a la normalidad» | Analizar tendencias o promedios |

**Perderías todos los gráficos y todo el análisis histórico.** La plataforma sería un panel de alarmas,
no una plataforma de gestión de datos — que es lo que la universidad pidió.

**Hay una salida técnica si insiste**, y conviene tenerla preparada: meter el valor numérico en el campo
`CCC` (3 dígitos). Pero ese campo es el que identifica **cuál dispositivo** reportó, así que ganarías el
valor a cambio de perder la identidad del sensor. **Es posible y es peor.** Si Mario lo pide, se hace y
se documenta como su decisión.

## Cómo se lo explicas a Mario en tres frases

> *«Contact ID es un protocolo de eventos: dice que algo pasó, no cuánto vale. Por eso lo uso para todo
> lo que es evento y alarma —incluida la salud de los sensores, que es donde su vocabulario ya trae los
> códigos que necesito— y uso un formato complementario para las mediciones con valor, que Contact ID
> no puede transportar. Los dos se correlacionan por la identidad del dispositivo, así que en la
> plataforma se ven como una sola historia.»*

---

# 5. Glosario rápido

| Término | En una línea |
|---|---|
| **Contact ID** | Protocolo de mensajes de evento de 16 dígitos, de la industria de alarmas. Tu protocolo |
| **SIA DC-05** | El estándar que define Contact ID. Mismo protocolo, nombre formal |
| **SIA DC-09** | El estándar que transporta Contact ID por internet, con cifrado AES. Tu transporte |
| **SIA DC-03** | El otro formato SIA: bloques variables, texto ASCII, códigos de dos letras. Lleva valores nativamente. Quedó segundo en la evaluación |
| **Datos extendidos** | El campo `[<A-Z><datos>]` que DC-09 reserva para el implementador. Ahí viaja tu valor medido |
| **DTMF** | Los tonos del teclado telefónico. Cómo viajaba Contact ID originalmente |
| ***Kissoff*** | El «recibido» que la central devuelve si el checksum es correcto. Confirmación de entrega |
| **Checksum** | Dígito de verificación. Si un dígito se corrompe, no cuadra y el mensaje se rechaza |
| **LoRa** | La radio: largo alcance, poquísimos datos, años de batería. Capa física |
| **LoRaWAN** | El protocolo de red sobre LoRa: registro, cifrado, entrega. Capa de red |
| **AU915** | El plan de frecuencias de 915–928 MHz que usa Chile |
| **Gateway** | La antena que oye a los nodos y reenvía por internet. No descifra nada |
| **ChirpStack** | El servidor de red LoRaWAN: descifra, deduplica, administra, publica en MQTT |
| **MQTT** | Protocolo de mensajería publicar/suscribir. El cartero del IoT |
| **Mosquitto** | La implementación de MQTT que vas a usar. Liviana y madura |
| **Broker** | El intermediario de MQTT: recibe de los que publican, entrega a los suscritos |
| **Tópico** | La «ruta» de un mensaje MQTT: `sitio/temuco/sensor-007/temperatura` |
| ***Last Will*** | El aviso automático de MQTT cuando un cliente se desconecta sin despedirse |
| **PostgreSQL** | Base de datos relacional SQL. El primo de MariaDB que vas a usar |
| **TimescaleDB** | Extensión de PostgreSQL para datos con fecha. Sigue siendo SQL relacional |
| **Hypertable** | La tabla de TimescaleDB que se parte por fechas automáticamente. Tú ves una sola |
| **SenML** | Formato estándar (RFC 8428) para mediciones con valor, unidad y hora. Tu telemetría en IP |
| **CayenneLPP** | Formato binario compacto para LoRa: 4 bytes por medición. Tu telemetría en LoRa |
| **RSSI** | Potencia de la señal recibida. Métrica de salud del enlace |
| **SNR** | Relación señal/ruido. Métrica de calidad del enlace |
| **NAT** | Traducción de direcciones del router. Por eso el dispositivo debe iniciar la conexión |
| **PPDIOO** | La metodología de ciclo de vida de redes de Cisco. Tu marco de trabajo |
| **MoSCoW** | Priorización: *Must*, *Should*, *Could*, *Won't* |
| **CID-IoT** | El nombre de tu perfil: Contact ID adaptado a gestión de sensores. **Tu aporte** |
