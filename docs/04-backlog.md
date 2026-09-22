> ⚠️ **ACTUALIZADO AL PIVOTE DEL 02/09/2026:** los elementos ligados a Contact ID se reformularon
> hacia el contrato SenML/MQTT y el pipeline de normalización. Efecto neto: el núcleo baja de 165 h
> a ~155 h y la holgura mejora.

# Backlog del proyecto

> **Cubre:** criterio 4 de la Etapa 1 (**20 %**) · sustenta el seguimiento de las Etapas 2, 3 y 4
> **Fase PPDIOO:** Plan
> **Versión:** borrador 1 — 18 de agosto de 2026

---

## 1. Naturaleza y propósito de este backlog

Este backlog es el **instrumento de planificación y medición** del proyecto, no la adopción de Scrum.
La metodología de ciclo de vida es **PPDIOO** (ver `PLAN-MAESTRO.md`, sección 2): se descartan las
ceremonias de gestión de equipo por tratarse de un proyecto unipersonal, y se conservan los artefactos
de planificación porque la pauta los evalúa y porque sin ellos no existe forma de medir el avance.

**Función que cumple en cada etapa:**

| Etapa | Uso del backlog en la evaluación |
|---|---|
| 1 | Criterio 4 (20 %): existencia, priorización, criterios de aceptación y estimaciones |
| 2 | Criterio 2 (10 %): **100 % de las tareas de diseño** completadas |
| 3 | Criterio 3 (10 %): **50 % de las tareas de implementación** completadas |
| 4 | Criterio 2 (10 %): **100 % de las tareas de implementación** completadas |

## 2. Convenciones

- **EP-nn** épica · **HU-nn** historia de usuario · **TT-nn** tarea técnica
- **Estimación en horas ideales de trabajo efectivo**, no en puntos de historia. La razón es
  verificabilidad: el presupuesto disponible se conoce (~15 h semanales), de modo que las horas
  permiten comprobar si el alcance cabe en el tiempo, lo que los puntos abstractos no permiten.
- **Prioridad** heredada del catálogo de requerimientos (`docs/02-requerimientos.md`): **M**ust ·
  **S**hould · **C**ould.
- **🎯 Núcleo** marca los elementos pertenecientes al núcleo demostrativo: aquellos cuya ausencia
  invalidaría la demostración de la tesis.
- **Grado de refinamiento:** los elementos del núcleo llevan criterios de aceptación detallados; los de
  prioridad menor quedan deliberadamente sin refinar hasta que su ejecución se aproxime. Refinar todo
  por adelantado sería trabajo perdido si el alcance se ajusta.

## 3. Roles de usuario

| Rol | Descripción |
|---|---|
| **Administrador de sitio** | Responsable técnico de la infraestructura de sensores de una organización. Registra dispositivos, vigila la salud de los enlaces, configura umbrales |
| **Usuario de consulta** | Persona que consulta mediciones e historial sin capacidad de modificar la configuración |
| **Integrador** | Quien conecta un sensor o sistema externo a la plataforma. Consume la API y la especificación del protocolo |

---

# 4. Épicas

| Épica | Nombre | Módulos | Objetivo | Etapa | Horas |
|---|---|---|---|:---:|:---:|
| **EP-01** | Infraestructura y entorno de desarrollo | — | OE5 | 2 | 14 |
| **EP-02** | Diseño de arquitectura, red y datos | — | OE3 | 2 | 26 |
| **EP-03** | Especificación del contrato de trama y adaptadores | M2 | OE2 | 2 | 16 |
| **EP-04** | Recepción multiprotocolo | M1 | OE5 | 2 · 3 | 26 |
| **EP-05** | Normalización y máquina de estados | M2 | OE5 | 3 | 19 |
| **EP-06** | Persistencia y consulta | M5 | OE5 | 2 · 3 | 17 |
| **EP-07** | Inventario y aprovisionamiento | M3 | OE5 | 3 | 15 |
| **EP-08** | Supervisión de salud de enlace | M4 | OE5 | 3 | 18 |
| **EP-09** | Seguridad y multi-tenencia | M7 | OE5 | 3 | 16 |
| **EP-10** | Interfaz de administración | M8 | OE5 | 3 · 4 | 30 |
| **EP-11** | Alertas y notificación | M6 | OE5 | 4 | 10 |
| **EP-12** | Modelo de despliegue y análisis de costos | — | OE4 | 2 | 8 |
| **EP-13** | Validación y pruebas | — | OE6 | 3 · 4 | 26 |
| **EP-14** | Documentación y entregables académicos | — | todos | 1–4 | 34 |

---

# 5. Elementos del backlog

## EP-01 · Infraestructura y entorno de desarrollo

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **TT-01** | 🎯 Componer el entorno con contenedores: TimescaleDB, Mosquitto y ChirpStack orquestados, con un único comando de arranque | M | 2 | **6** |
| **TT-02** | 🎯 Inicializar el proyecto TypeScript + NestJS con estructura de módulos correspondiente a M1–M8 | M | 2 | **4** |
| **TT-03** | Configurar verificación automática: tipos, formato y ejecución de pruebas | S | 2 | 3 |
| **TT-04** | Documentar el procedimiento de puesta en marcha en el repositorio | M | 2 | 1 |

**TT-01 — criterios de aceptación** 🎯

- Un único comando levanta los cuatro servicios y todos quedan operativos.
- La base de datos aplica sus migraciones automáticamente en el primer arranque.
- El entorno se levanta correctamente en una máquina distinta a la de desarrollo, sin ajustes manuales.
- Ninguna credencial aparece en los archivos versionados (RNF-08); se leen de variables de entorno.

**TT-02 — criterios de aceptación** 🎯

- Existe un módulo por cada módulo del análisis (M1 a M8), con dependencias declaradas explícitamente.
- El proyecto compila sin errores de tipos y arranca respondiendo a una petición de verificación de estado.
- La estructura de carpetas es la que se documentará como arquitectura en la Etapa 2 (RNF-12).

## EP-02 · Diseño de arquitectura, red y datos

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **TT-05** | 🎯 Diagrama de arquitectura de componentes, con los ocho módulos y sus dependencias | M | 2 | 5 |
| **TT-06** | 🎯 Diagrama de topología de red con segmentación de dispositivos IoT (RNF-09) y sentido de las conexiones (RNF-10) | M | 2 | 6 |
| **TT-07** | 🎯 Modelo de datos entidad-relación con al menos ocho entidades | M | 2 | 6 |
| **TT-08** | Diagrama de flujo de recepción, desde la recepción hasta la persistencia, para los tres transportes | M | 2 | 4 |
| **TT-09** | Diagrama de secuencia del aprovisionamiento de un dispositivo nuevo | M | 2 | 3 |
| **TT-10** | Registro de decisiones de diseño con su justificación | M | 2 | 2 |

**TT-06 — criterios de aceptación** 🎯

- El diagrama muestra los dispositivos IoT en un segmento separado del segmento de usuarios.
- Toda flecha de conexión se origina en el dispositivo y termina en la plataforma; ninguna en sentido inverso (RNF-10).
- Se identifican los puertos expuestos y su protocolo de cifrado.
- Se justifica la segmentación en términos de contención de un dispositivo comprometido.

**TT-07 — criterios de aceptación** 🎯

- Incluye al menos: sitio, zona lógica, dispositivo, tipo de dispositivo, evento, condición abierta, medición, usuario, credencial de recepción.
- La identidad del dispositivo admite la tripleta `(ACCT, GG, CCC)` con su restricción de unicidad.
- Los eventos conservan el mensaje original íntegro junto a su interpretación (RF-31).
- Las mediciones son una tabla optimizada para series de tiempo, con política de retención definida.

## EP-03 · Especificación del contrato de trama y adaptadores

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **TT-11** | 🎯 Esquema del modelo interno y contrato del tópico MQTT (nombres, unidades, identidad) | M | 2 | 3 |
| **TT-12** | 🎯 Catálogo de tipos de sensor y unidades aceptadas, con umbrales de disparo y restauración | M | 2 | 6 |
| **TT-13** | 🎯 Especificación del contrato de la API en OpenAPI, generada desde el código | M | 2 | 3 |
| **TT-14** | Política de QoS, reintento y cuarentena | M | 2 | 2 |
| **TT-15** | Procedimiento de asignación de identidad y gestión de claves AES por sitio | S | 2 | 2 |

**TT-12 — criterios de aceptación** 🎯

- Cubre al menos 25 códigos de evento con su condición de disparo.
- Cada entrada indica el transporte de origen, la señal, la condición, el código y el calificador.
- Los eventos con restauración declaran explícitamente su condición de cierre (`Q=3`).
- No se introduce ningún código ajeno al estándar DC-05.
- Los umbrales incluyen banda de histéresis para evitar oscilación (RF-14).

## EP-04 · Recepción multiprotocolo

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **HU-01** | 🎯 **Como integrador**, quiero publicar una trama SenML por MQTT o HTTP, para reportar desde un sensor sin infraestructura intermedia | M | 2 | **6** |
| **HU-02** | 🎯 **Como integrador**, quiero que mis eventos LoRaWAN lleguen a la plataforma, para aprovechar los nodos de radio ya instalados | M | 3 | **6** |
| **HU-03** | 🎯 **Como integrador**, quiero publicar eventos en MQTT, para integrar dispositivos que ya usan ese transporte | M | 3 | **4** |
| **TT-16** | 🎯 Validador de esquema SenML y analizador de tramas | M | 2 | 3 |
| **HU-04** | **Como integrador**, quiero un adaptador para un formato no SenML, para demostrar la extensibilidad de la capa de recepción | S | 4 | 7 |

**HU-01 — criterios de aceptación** 🎯

- Un `POST` con un mensaje de 16 dígitos y checksum válido responde `202` y persiste el evento.
- Un mensaje con checksum inválido responde `422`, **no** persiste el evento, y registra el intento con su motivo (RF-05, RF-07).
- Un mensaje sin credencial válida responde `401` (RF-40).
- La respuesta incluye la interpretación del mensaje: sitio, zona, dispositivo, código, descripción y estado de la condición (RF-06).
- Los metadatos del transporte recibidos se almacenan asociados al evento (RF-09).
- La operación es idempotente: reenviar el mismo evento no lo duplica (RF-10).

**HU-02 — criterios de aceptación** 🎯

- La plataforma recibe el evento a través de la integración del servidor de red, sin conexión directa al nodo.
- El payload de 8 bytes en BCD se decodifica correctamente a los 16 dígitos.
- RSSI, SNR, identificador del nodo y gateway quedan asociados al evento (RF-09).
- Un evento recibido por dos gateways se almacena una sola vez (RF-10).
- Un payload de longitud o contenido inválido se rechaza sin interrumpir la recepción de los demás (RNF-07).

## EP-05 · Normalización y máquina de estados

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **TT-17** | 🎯 Pipeline de normalización al modelo interno (los 6 filtros) con cuarentena | M | 3 | 6 |
| **HU-05** | 🎯 **Como administrador de sitio**, quiero que la plataforma sepa qué condiciones están abiertas en cada dispositivo, para no tener que deducirlo del historial | M | 3 | **7** |
| **HU-06** | **Como administrador de sitio**, quiero configurar umbrales por dispositivo, para que se genere un evento cuando una medición los cruce | M | 3 | 4 |
| **TT-18** | 🎯 Normalización de marcas temporales, tolerando nodos sin reloj confiable | M | 3 | 2 |

**HU-05 — criterios de aceptación** 🎯

- Un evento con `Q=1` abre una condición asociada al dispositivo, con su instante de apertura.
- El mismo código con `Q=3` cierra la condición, registrando su duración.
- Un `Q=3` sin condición abierta previa se registra como evento huérfano y no genera estado inconsistente.
- Un `Q=1` repetido sobre una condición ya abierta no crea una segunda: actualiza la existente.
- Es posible consultar todas las condiciones abiertas de un sitio en una sola operación.

## EP-06 · Persistencia y consulta

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **TT-19** | 🎯 Esquema de base de datos y migraciones versionadas | M | 2 | 5 |
| **HU-07** | 🎯 **Como usuario de consulta**, quiero ver el historial de eventos y mediciones de un dispositivo en un rango de fechas | M | 3 | 4 |
| **HU-08** | 🎯 **Como administrador de sitio**, quiero exportar los datos de mi sitio en CSV y JSON, para no depender de la plataforma para conservarlos | M | 3 | **4** |
| **HU-09** | **Como integrador**, quiero consultar los datos del sitio por API, para alimentar sistemas propios | S | 4 | 4 |

**HU-08 — criterios de aceptación** 🎯

- La exportación incluye eventos y mediciones del rango solicitado, en CSV y en JSON.
- Los eventos exportados conservan el mensaje Contact ID original, no solo su interpretación.
- La exportación contiene únicamente datos del sitio del solicitante (RF-41).
- Un archivo exportado puede reimportarse sin pérdida de información.

> **Nota sobre HU-08.** Su valor no es técnico sino argumental: es el requerimiento que **demuestra** la
> ausencia de dependencia de proveedor (causa C3, efecto E5). Una plataforma que se declara abierta y no
> permite retirar los datos reproduce el problema que pretende resolver.

## EP-07 · Inventario y aprovisionamiento

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **HU-10** | 🎯 **Como administrador de sitio**, quiero ver el inventario de mis dispositivos con su estado y el transporte por el que llegan | M | 3 | **5** |
| **HU-11** | 🎯 **Como administrador de sitio**, quiero registrar un dispositivo nuevo desde la plataforma, para no tener que operar la consola del servidor de red | M | 3 | **5** |
| **HU-12** | **Como administrador de sitio**, quiero agrupar dispositivos por sitio y zona lógica, para reconocer mi instalación física | M | 3 | 3 |
| **HU-13** | **Como administrador de sitio**, quiero marcar un dispositivo en mantenimiento, para que no genere alertas mientras lo intervengo | C | 4 | 2 |

**HU-11 — criterios de aceptación** 🎯

- El registro asigna la tripleta `(ACCT, GG, CCC)` y valida su unicidad, rechazando duplicados (RF-20).
- Advierte cuando el espacio de direcciones del sitio se aproxima a su límite.
- Deja registro de quién realizó el registro y cuándo (RF-23).
- Tras el registro, el dispositivo aparece en el inventario y acepta eventos inmediatamente.
- No requiere intervenir la configuración del servidor de red por separado.

## EP-08 · Supervisión de salud de enlace

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **HU-14** | 🎯 **Como administrador de sitio**, quiero que la plataforma detecte que un dispositivo dejó de reportar, porque el silencio de un sensor es indistinguible de que no haya novedades | M | 3 | **7** |
| **HU-15** | 🎯 **Como administrador de sitio**, quiero ver la calidad del enlace de cada dispositivo, para anticipar fallas antes de que ocurran | M | 3 | **4** |
| **HU-16** | 🎯 **Como administrador de sitio**, quiero un indicador agregado de salud de mi sitio, para saber de un vistazo si algo requiere atención | M | 3 | **4** |
| **HU-17** | **Como administrador de sitio**, quiero saber qué dispositivos tienen la batería baja, para planificar el mantenimiento | M | 3 | 3 |

**HU-14 — criterios de aceptación** 🎯 — *elemento central de la tesis*

- La plataforma emite el código **381** cuando un dispositivo no reporta durante el número configurado de intervalos.
- La detección ocurre en **≤ 2 intervalos** de reporte (RNF-03).
- El intervalo esperado es configurable por dispositivo, no global.
- Al reaparecer el dispositivo, la condición se cierra con `Q=3` y se registra la duración de la interrupción (RF-25).
- Los *heartbeat* (códigos 602 y 603) cuentan como evidencia de supervisión activa (RF-29).
- La detección funciona con independencia del transporte de llegada del dispositivo.
- Un dispositivo en mantenimiento no genera esta condición (RF-22).

## EP-09 · Seguridad y multi-tenencia

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **TT-20** | 🎯 Autenticación de la recepción mediante credencial por sitio | M | 3 | 4 |
| **TT-21** | 🎯 Aislamiento de datos entre sitios, verificado con pruebas | M | 3 | 5 |
| **TT-22** | 🎯 Cifrado del transporte: TLS para HTTP y MQTT | M | 3 | 4 |
| **HU-18** | **Como administrador de sitio**, quiero iniciar sesión con mis credenciales y que existan roles distintos de administración y consulta | M | 3 | 3 |

**TT-21 — criterios de aceptación** 🎯

- Existe una prueba automatizada que verifica que un usuario de un sitio recibe `403` o `404` al solicitar datos de otro sitio.
- El aislamiento se aplica en la capa de acceso a datos, no únicamente en la de presentación.
- La exportación y las consultas de API respetan el aislamiento.

## EP-10 · Interfaz de administración

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **HU-19** | 🎯 **Como administrador de sitio**, quiero un panel de salud del sitio con semáforo por dispositivo | M | 3 | **9** |
| **HU-20** | 🎯 **Como administrador de sitio**, quiero la vista de inventario filtrable por sitio, zona, estado y transporte | M | 3 | **7** |
| **HU-21** | 🎯 **Como usuario de consulta**, quiero el detalle de un dispositivo con sus condiciones abiertas, historial y serie de mediciones | M | 4 | **7** |
| **HU-22** | **Como administrador de sitio**, quiero un asistente guiado para registrar un dispositivo nuevo | M | 4 | 4 |
| **HU-23** | **Como administrador de sitio**, quiero ver mi flota agrupada por tecnología de red, para entender por dónde llega cada cosa | S | 4 | 3 |

**HU-19 — criterios de aceptación** 🎯

- Presenta el total de dispositivos, cuántos en línea, cuántos con condición abierta y cuántos sin supervisión.
- Cada dispositivo muestra un estado visual de tres niveles: normal, advertencia, crítico.
- Indica el momento de la última comunicación de cada dispositivo.
- Es utilizable en un navegador móvil sin desplazamiento horizontal (RF-52).
- Refleja los cambios de estado sin requerir recarga manual de la página.

## EP-11 · Alertas y notificación

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **HU-24** | **Como administrador de sitio**, quiero recibir una notificación cuando se abra una condición crítica | M | 4 | 5 |
| **HU-25** | **Como administrador de sitio**, quiero configurar los destinatarios de notificación de mi sitio | S | 4 | 3 |
| **TT-23** | Agrupación de notificaciones repetidas en una ventana temporal | S | 4 | 2 |

## EP-12 · Modelo de despliegue y análisis de costos

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **TT-24** | Comparar al menos tres alternativas de alojamiento con criterios ponderados | M | 2 | 4 |
| **TT-25** | Cuantificar el costo mensual y anual de operación en CLP y USD | M | 2 | 3 |
| **TT-26** | Redactar la recomendación de despliegue justificada | M | 2 | 1 |

## EP-13 · Validación y pruebas

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **TT-27** | 🎯 Pruebas automatizadas del contrato de trama (esquema, cuarentena, adaptadores) | M | 3 | 5 |
| **TT-28** | 🎯 Emulador de nodo por software, que genera eventos y telemetría sintéticos | M | 3 | **5** |
| **TT-29** | 🎯 Prueba de carga: sostener ≥ 50 eventos/segundo sin pérdida (RNF-01) | M | 4 | 4 |
| **TT-30** | Prueba de recuperación: ningún evento confirmado se pierde ante reinicio (RNF-05, RNF-06) | M | 4 | 4 |
| **TT-31** | Batería de al menos 15 casos de prueba funcionales documentados | M | 4 | 5 |
| **TT-32** | Validación de extremo a extremo con al menos un sensor físico | M | 4 | 3 |

> **TT-28 es mitigación del riesgo R1.** El emulador desacopla la validación de la disponibilidad de
> hardware: permite ejecutar las pruebas de carga y de recuperación sin sensores físicos. El sensor real
> (TT-32) demuestra el caso de uso; el emulador demuestra el comportamiento bajo carga. **Si el hardware
> no llega, la validación sigue siendo posible** — solo pierde la demostración física.

## EP-14 · Documentación y entregables académicos

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **TT-33** | 🎯 Entrevistas a partes interesadas y consolidación de sus declaraciones | M | 1 | **4** |
| **TT-34** | Armar el documento LaTeX de la Etapa 1 y compilar el PDF de entrega | M | 1 | 5 |
| **TT-35** | Documento de diseño de la Etapa 2, con todos los diagramas | M | 2 | 6 |
| **TT-36** | Informe de pruebas y validación preliminar de la Etapa 3 | M | 3 | 5 |
| **TT-37** | Informe final: problema, requerimientos, diseño, implementación, pruebas y conclusiones | M | 4 | 12 |
| **TT-38** | Bitácora de reuniones y trazabilidad de retroalimentación incorporada | M | 1–4 | 2 |

**TT-33 — criterios de aceptación** 🎯

- Al menos dos entrevistas realizadas y registradas.
- Se obtiene al menos una declaración textual que describa el problema en palabras de la parte interesada.
- Las declaraciones se vinculan a requerimientos concretos del catálogo, cerrando la brecha de fuente `[ENT]`.

---

# 6. Verificación de viabilidad del alcance

> Todas las cifras de esta sección se obtuvieron **sumando programáticamente** las estimaciones de los
> 63 elementos del backlog, no estimando el total a ojo. El procedimiento es reproducible sobre este
> mismo documento.

## 6.1 Esfuerzo estimado

| | Elementos | Horas |
|---|:---:|:---:|
| **Núcleo demostrativo** 🎯 | 33 | **165** |
| Fuera del núcleo | 30 | 110 |
| **Total del backlog** | **63** | **275** |

Por prioridad: **Must** 55 elementos / 249 h · **Should** 7 / 24 h · **Could** 1 / 2 h.

## 6.2 Presupuesto disponible

Cuatro semanas por etapa a ~15 horas semanales (restricción RE-01):

| Etapa | Ventana (calendario oficial 24/08) | Presupuesto |
|---|---|:---:|
| 1 | 17 de agosto – 4 de septiembre | ~45 h |
| 2 | 7 de septiembre – 2 de octubre | ~60 h |
| 3 | 5 – 30 de octubre | ~60 h |
| 4 | 2 de noviembre – 4 de diciembre (5 semanas) | ~75 h |
| **Total** | | **~240 h** |

> **Actualización del 24 de agosto:** la pauta oficial dio una semana más que el escenario exigente con
> que se planificó, y la Etapa 4 dura cinco semanas. El presupuesto sube de ~201 h a ~240 h: la holgura
> del núcleo pasa de +18 % a **+31 %**, y parte del alcance condicional vuelve a ser ejecutable.

## 6.3 🔴 Hallazgo: el backlog completo no cabe en el tiempo disponible

| Etapa | Backlog completo | Solo el núcleo | Presupuesto | Holgura (completo) | Holgura (núcleo) |
|---|:---:|:---:|:---:|:---:|:---:|
| 1 | 10 h | 4 h | 21 h | +52 % | +81 % |
| 2 | 84 h | 53 h | 60 h | **−40 %** | +12 % |
| 3 | **115 h** | **97 h** | 60 h | **−92 %** | **−62 %** |
| 4 | 66 h | 11 h | 60 h | −10 % | +82 % |
| **Total** | **275 h** | **165 h** | **201 h** | **−37 %** | **+18 %** |

**Dos conclusiones, y la segunda es la que importa:**

1. **El backlog completo excede el presupuesto en un 37 %.** No es viable ejecutarlo entero.
2. **El núcleo demostrativo sí cabe: 165 h contra 201 disponibles, con 18 % de holgura.** La tesis es
   demostrable dentro del plazo — pero **solo si el alcance se limita al núcleo** y los 110 h restantes
   se tratan como alcance opcional, no comprometido.

> **Decisión de planificación derivada:** el **núcleo (165 h) constituye el compromiso**; los 30
> elementos fuera del núcleo son **alcance condicional**, ejecutables únicamente contra holgura real
> verificada al cierre de cada etapa. Comprometerse con los 275 h produciría un incumplimiento del
> 37 % — y la pauta mide el avance como porcentaje de tareas completadas, de modo que un alcance
> sobredimensionado penaliza más que un alcance acotado y justificado.

## 6.4 🔴 Segundo hallazgo: el núcleo está mal distribuido en el tiempo

Aun limitándose al núcleo, la distribución es defectuosa: **la Etapa 3 concentra 97 h contra 60
disponibles (−62 %), mientras la Etapa 4 usa 11 h de 60 (+82 %)**. El problema no es el volumen total,
es su reparto.

La causa es que la asignación inicial situó toda la implementación en la Etapa 3, cuando **la pauta solo
exige el 50 % de la implementación en esa etapa y el 100 % en la Etapa 4**. Reservar la Etapa 4 casi
íntegramente para validación e informe desaprovecha 49 horas.

### Redistribución correctiva

Se trasladan de la Etapa 3 a la Etapa 4 los siguientes elementos del núcleo (~37 h), escogidos porque
**no forman parte de la cadena mínima que hay que demostrar funcionando al cierre de la Etapa 3**:

| Elemento | Horas | Por qué puede esperar |
|---|:---:|---|
| **TT-20** Autenticación de recepción | 4 | La cadena funcional se demuestra antes de endurecerla |
| **TT-21** Aislamiento entre sitios | 5 | Ídem; se valida con pruebas en la Etapa 4 |
| **TT-22** Cifrado TLS del transporte | 4 | Ídem |
| **HU-07** Consulta de historial | 4 | El dato se persiste en la Etapa 3; consultarlo puede seguir |
| **HU-08** Exportación abierta | 4 | Requiere que existan datos acumulados: es natural en la Etapa 4 |
| **HU-20** Vista de inventario filtrable | 7 | El panel de salud (HU-19) basta para la demostración intermedia |
| **TT-27** Pruebas del protocolo y validación cruzada | 5 | Corresponde al ciclo de validación de la Etapa 4 |
| **HU-16** Indicador agregado de salud del sitio | 4 | Depende de que la supervisión ya funcione |

**Distribución del núcleo tras la corrección:**

| Etapa | Núcleo | Presupuesto | Holgura |
|---|:---:|:---:|:---:|
| 1 | 4 h | 21 h | +81 % |
| 2 | 53 h | 60 h | ✅ +12 % |
| 3 | **60 h** | 60 h | ⚠️ 0 % |
| 4 | **48 h** | 60 h | ✅ +20 % |
| **Total** | **165 h** | **201 h** | ✅ **+18 %** |

**Verificación del umbral de la Etapa 3.** La pauta exige el **50 % de las tareas de implementación**
completadas. Implementación total (EP-01, 04–11) = 165 h. Ejecutado al cierre de la Etapa 3: ~28 h
adelantadas en la Etapa 2 más 60 h de la Etapa 3 = **88 h ≈ 53 %**. ✅ El umbral se cumple.

## 6.5 Qué se recorta y en qué orden

Los 110 h fuera del núcleo se ordenan por valor decreciente. Se ejecutan de arriba hacia abajo, solo
contra holgura verificada:

| Orden | Elementos | Horas | Valor si se ejecuta |
|:---:|---|:---:|---|
| 1 | **HU-04** Receptor DC-09 nativo | 7 | **Alto** — es el diferenciador frente a la competencia regional |
| 2 | **TT-32** Validación con sensor físico | 3 | **Alto** — evidencia empírica de extremo a extremo |
| 3 | **HU-11, HU-12** Aprovisionamiento y agrupación | 8 | Medio-alto — completa la vista de administrador |
| 4 | **HU-24** Notificación de condición crítica | 5 | Medio — funcionalidad esperada de una plataforma de este tipo |
| 5 | **HU-23** Vista por tecnología de red | 3 | Medio — refuerza el argumento multiprotocolo |
| 6 | **HU-09** API de consulta externa | 4 | Bajo para la demostración |
| 7 | Resto (HU-06, 13, 17, 18, 21, 22, 25, TT-03, 23, 24-26, 28-31, 33-38) | 80 | Variable |

> **Lo que no se recorta bajo ninguna circunstancia:** los 33 elementos marcados 🎯. Su ausencia
> invalidaría la demostración en lugar de reducirla. Si el tiempo no alcanza para el núcleo completo, el
> problema no se resuelve recortando: hay que **renegociar el alcance con el profesor guía y documentar
> la desviación**, que es lo que la pauta valora frente a un incumplimiento silencioso.

## 6.6 Actualización del riesgo R4

El riesgo R4 («alcance excesivo para el tiempo disponible») pasa de probabilidad **media** a
**confirmado**: la verificación numérica demuestra que el alcance completo no es ejecutable. Se
mantiene bajo control mediante la separación explícita entre **núcleo comprometido** y **alcance
condicional**, y mediante la revisión de holgura al cierre de cada etapa.

**Reserva para imprevistos:** el 18 % de holgura del núcleo (36 h) constituye la única reserva. No se
infló ninguna estimación individual: hacerlo habría producido un plan con apariencia de viabilidad sin
mejorarla, y habría impedido detectar la sobrecarga que esta sección documenta.

---

# 7. Priorización: cómo se ordenó y por qué

El orden de ejecución no sigue el número de las épicas, sino tres reglas:

1. **Primero lo que desbloquea:** el entorno (EP-01) y el esquema de datos (TT-19) condicionan todo lo
   demás. Sin ellos ninguna historia puede completarse.
2. **Después lo que demuestra la tesis:** la cadena recepción → normalización → supervisión → interfaz
   (EP-04, EP-05, EP-08, EP-10). Es el recorrido que un evaluador seguirá en una demostración.
3. **Al final lo que mejora el producto:** alertas avanzadas, DC-09, API de consulta. Valiosos, pero su
   ausencia no invalida la demostración.

**Regla de decisión ante retraso:** se sacrifica amplitud antes que profundidad. Es preferible una
cadena completa con dos transportes y supervisión funcionando de extremo a extremo, que cuatro
transportes a medio terminar. Un recorrido completo demuestra la hipótesis; cuatro recorridos parciales
no demuestran ninguna.

---

# 8. Estado del backlog

| Aspecto | Estado |
|---|---|
| Épicas definidas | ✅ 14, todas vinculadas a un objetivo específico |
| Historias de usuario | ✅ 25, con rol, capacidad y beneficio |
| Tareas técnicas | ✅ 38 |
| Elementos del núcleo demostrativo | ✅ 33 elementos, 165 h |
| Criterios de aceptación | ✅ Detallados en los elementos del núcleo; deliberadamente sin refinar en el resto |
| Estimaciones | ✅ 63 elementos estimados, **275 h** en total, sumadas programáticamente |
| Priorización | ✅ MoSCoW heredado del catálogo, más orden de ejecución justificado |
| Verificación de viabilidad | 🔴 **Realizada. El backlog completo excede el presupuesto en 37 %; el núcleo cabe con 18 % de holgura. Redistribución correctiva definida** |

## Seguimiento de ejecución

El estado de cada ítem tocado (hecho / parcial / pendiente, con su evidencia) se lleva en
`docs/12-estado-etapa2.md` §3 y se actualiza en cada corte. Esta tabla conserva la planificación
original para poder comparar lo previsto con lo ejecutado.

---

## Núcleo mínimo demostrable (retroalimentación del 21 de septiembre de 2026)

El profesor guía pidió acotar el alcance comprometido: «la prioridad debe recaer en demostrar
recepción, normalización, supervisión de caída y consulta básica». Dentro del núcleo demostrativo 🎯 se
distingue desde ahora un **primer nivel**, que es el compromiso mínimo, y un **segundo nivel** que se
ejecuta contra la holgura verificada al cierre de cada etapa.

| Nivel | Capacidad | Ítems | Estado al 21/09 |
|---|---|---|---|
| **1. Núcleo mínimo** | Recepción por MQTT autenticada | HU-03, TT-11, TT-20, TT-01, TT-02 | ✅ |
| **1. Núcleo mínimo** | Normalización al modelo interno | TT-16, TT-17, TT-18, TT-19, TT-12 | ✅ (TT-12 parcial: sensores reales) |
| **1. Núcleo mínimo** | Supervisión de caída | HU-14, HU-05 | ✅ |
| **1. Núcleo mínimo** | Consulta básica por API | HU-07, TT-13 | ✅ |
| **1. Núcleo mínimo** | Sensor real de extremo a extremo | HU-02 (vía ChirpStack) o HU-03 con el nodo del compañero | ⬜ octubre |
| 2. Segundo nivel | Entrada HTTP | HU-01 | ⬜ E3 |
| 2. Segundo nivel | Alertas por umbral con interfaz | HU-06 | 🟡 motor listo |
| 2. Segundo nivel | Aprovisionamiento desde la plataforma | HU-10, HU-11 | ⬜ E3 |
| 2. Segundo nivel | Cifrado del transporte | TT-22 | ⬜ E3 |
| 2. Segundo nivel | Panel de control | HU-19, HU-20, HU-21 | ⬜ E3/E4 |
| 2. Segundo nivel | Exportación en formato abierto | HU-08 | ⬜ E4 |
| 2. Segundo nivel | Validación formal | TT-27, TT-28, TT-29 | ⬜ E4 |

El criterio de demostración del informe (cap. 5 §5.3) y OE4 (`docs/01`) siguen este orden.
