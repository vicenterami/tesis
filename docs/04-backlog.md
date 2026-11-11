> ⚠️ **ACTUALIZADO AL PIVOTE DEL 02/09/2026:** los elementos ligados a Contact ID se reformularon
> hacia el contrato SenML/MQTT y el pipeline de normalización. Las cifras vigentes son las de §6.1,
> calculadas sumando las filas: **66 elementos, 287 h; núcleo 34 elementos, 168 h** (una estimación
> preliminar de ~155 h del 02/09 quedó superada y se corrigió el 22/09 para que informe y backlog
> digan lo mismo; TT-39 agregada el 23/09; TT-32 promovida a núcleo y adelantada a la Etapa 3, y la
> redistribución de §6.4 —decidida por escrito el 22/09 pero nunca aplicada a las filas— ejecutada,
> el 23/09: la Etapa 3 tenía en realidad 97 h de núcleo, no las 60 que este documento afirmaba).
> **08/11/2026:** el plan de la Etapa 4, versión 2 (§8), agregó 13 elementos fuera del núcleo (HU-26 a HU-31 y TT-42 a TT-48, 60 h)
> y la épica EP-15: las cifras de §6.1 son ahora **79 elementos, 347 h; núcleo 34 elementos, 168 h** (el núcleo no cambia).

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
| **EP-01** | Infraestructura y entorno de desarrollo | — | OE4 | 2 | 14 |
| **EP-02** | Diseño de arquitectura, red y datos | — | OE3 | 2 | 26 |
| **EP-03** | Especificación del contrato de trama y adaptadores | M2 | OE2 | 2 | 16 |
| **EP-04** | Recepción multiprotocolo | M1 | OE4 | 2 · 3 | 26 |
| **EP-05** | Normalización y máquina de estados | M2 | OE4 | 3 | 19 |
| **EP-06** | Persistencia y consulta | M5 | OE4 | 2 · 4 | 17 |
| **EP-07** | Inventario y aprovisionamiento | M3 | OE4 | 3 · 4 | 15 |
| **EP-08** | Supervisión de salud de enlace | M4 | OE4 | 3 · 4 | 18 |
| **EP-09** | Seguridad y multi-tenencia | M7 | OE4 | 3 · 4 | 34 |
| **EP-10** | Interfaz de administración | M8 | OE4 | 3 · 4 | 48 |
| **EP-11** | Alertas y notificación | M6 | OE4 | 4 | 10 |
| **EP-12** | Modelo de despliegue y análisis de costos | — | OE3 | 2 · 3 · 4 | 16 |
| **EP-13** | Validación y pruebas | — | OE5 | 3 · 4 | 26 |
| **EP-14** | Documentación y entregables académicos | — | todos | 1–4 | 34 |
| **EP-15** | Operación y confiabilidad (agregada el 08/11/2026) | — | OE5 | 4 | 28 |

---

# 5. Elementos del backlog

## EP-01 · Infraestructura y entorno de desarrollo

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **TT-01** | 🎯 Componer el entorno con contenedores: TimescaleDB y Mosquitto orquestados (ChirpStack, solo si se activa la ruta A), con un único comando de arranque | M | 2 | **6** |
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
- La identidad del dispositivo es su identificador físico (MAC/DevEUI), con su restricción de unicidad por sitio (RF-20).
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

- Cubre el catálogo de magnitudes soportadas (temperatura, humedad, batería…), cada una con su
  unidad canónica y su condición de disparo.
- Cada entrada indica la magnitud, la unidad aceptada y el rango válido.
- Cada umbral declara explícitamente su condición de restauración, no solo la de disparo (RF-14).
- No se introduce ninguna magnitud fuera del catálogo declarado.
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

- Un `POST` con una trama SenML válida (RFC 8428) responde `202` y persiste la medición.
- Una trama que no valida contra el esquema SenML responde `422`, **no** persiste la medición, y va a cuarentena con su motivo (RF-05, RF-07).
- Un mensaje sin credencial válida responde `401` (RF-40).
- La confirmación de recepción usa el mecanismo del transporte: QoS acordado en MQTT, código de respuesta en HTTP (RF-06).
- Los metadatos del transporte recibidos se almacenan asociados al evento (RF-09).
- La operación es idempotente: reenviar el mismo evento no lo duplica (RF-10).

**HU-02 — criterios de aceptación** 🎯

- La plataforma recibe el evento a través de la integración del servidor de red, sin conexión directa al nodo.
- El payload decodificado por el servidor de red (la pasarela en la ruta B; el servidor de red externo en la ruta C, la del campus; ChirpStack propio en la ruta A, opcional) se normaliza correctamente al modelo interno (SenML).
- RSSI, SNR, identificador del nodo y gateway quedan asociados al evento (RF-09).
- Un evento recibido por dos gateways se almacena una sola vez (RF-10).
- Una trama LoRaWAN que repite el contador de trama (`fCnt`) de la última guardada del nodo se descarta sin ir a cuarentena, y el nodo se marca vivo (RF-10; 16/10/2026, `docs/10 §4.1`).
- Un uplink que la pasarela entrega sin decodificar se decodifica con el perfil declarado en el alta del nodo, si lo tiene; si no, va a cuarentena diciendo qué activar (RF-04; 16/10/2026, `docs/10 §8.4` punto 47).
- Un payload de longitud o contenido inválido se rechaza sin interrumpir la recepción de los demás (RNF-07).
- La pasarela o el servidor de red externo se registra por API con credencial propia y declara el formato de sus tramas; sus nodos lo heredan en el alta (15/10/2026, `docs/10 §8.4` punto 47).

## EP-05 · Normalización y máquina de estados

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **TT-17** | 🎯 Pipeline de normalización al modelo interno (los 6 filtros) con cuarentena | M | 3 | 6 |
| **HU-05** | 🎯 **Como administrador de sitio**, quiero que la plataforma sepa qué condiciones están abiertas en cada dispositivo, para no tener que deducirlo del historial | M | 3 | **7** |
| **HU-06** | **Como administrador de sitio**, quiero configurar umbrales por dispositivo, para que se genere un evento cuando una medición los cruce | M | 4 | 4 |
| **TT-18** | 🎯 Normalización de marcas temporales, tolerando nodos sin reloj confiable | M | 3 | 2 |

**HU-05 — criterios de aceptación** 🎯

- Una medición que cruza el umbral de disparo abre una condición asociada al dispositivo, con su instante de apertura (RF-14).
- Una medición que cruza el umbral de restauración cierra la condición, registrando su duración (RF-25).
- Una restauración sin condición abierta previa no genera estado inconsistente: se ignora sin error.
- Un disparo repetido sobre una condición ya abierta no crea una segunda: la existente no se duplica.
- Es posible consultar todas las condiciones abiertas de un sitio en una sola operación.

## EP-06 · Persistencia y consulta

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **TT-19** | 🎯 Esquema de base de datos y migraciones versionadas | M | 2 | 5 |
| **HU-07** | 🎯 **Como usuario de consulta**, quiero ver el historial de eventos y mediciones de un dispositivo en un rango de fechas | M | 4 | 4 |
| **HU-08** | 🎯 **Como administrador de sitio**, quiero exportar los datos de mi sitio en CSV, XLSX y JSON, para no depender de la plataforma para conservarlos | M | 3 | **4** |
| **HU-09** | **Como integrador**, quiero consultar los datos del sitio por API, para alimentar sistemas propios | S | 4 | 4 |

**HU-08 — criterios de aceptación** 🎯

- La exportación incluye eventos y mediciones del rango solicitado, en CSV, XLSX y JSON.
- Los eventos exportados conservan la trama original íntegra (RF-31), no solo su interpretación.
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
| **HU-12** | **Como administrador de sitio**, quiero agrupar dispositivos por sitio y zona lógica, para reconocer mi instalación física | M | 4 | 3 |
| **HU-13** | **Como administrador de sitio**, quiero marcar un dispositivo en mantenimiento, para que no genere alertas mientras lo intervengo | C | 4 | 2 |

**HU-11 — criterios de aceptación** 🎯

- El registro asigna el identificador físico (MAC/DevEUI) y valida su unicidad, rechazando duplicados (RF-20).
- Deja registro de quién realizó el registro y cuándo (RF-23).
- Tras el registro, el dispositivo aparece en el inventario y acepta eventos inmediatamente.
- No requiere intervenir la configuración del servidor de red por separado.

## EP-08 · Supervisión de salud de enlace

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **HU-14** | 🎯 **Como administrador de sitio**, quiero que la plataforma detecte que un dispositivo dejó de reportar, porque el silencio de un sensor es indistinguible de que no haya novedades | M | 3 | **7** |
| **HU-15** | 🎯 **Como administrador de sitio**, quiero ver la calidad del enlace de cada dispositivo, para anticipar fallas antes de que ocurran | M | 4 | **4** |
| **HU-16** | 🎯 **Como administrador de sitio**, quiero un indicador agregado de salud de mi sitio, para saber de un vistazo si algo requiere atención | M | 4 | **4** |
| **HU-17** | **Como administrador de sitio**, quiero saber qué dispositivos tienen la batería baja, para planificar el mantenimiento | M | 4 | 3 |
**HU-14 — criterios de aceptación** 🎯 — *elemento central de la tesis*

- La plataforma abre una condición `sin_comunicacion` cuando un dispositivo no reporta durante el número configurado de intervalos (RF-24).
- La detección ocurre en **≤ 2 intervalos** de reporte (RNF-03).
- El intervalo esperado es configurable por dispositivo, no global.
- Al reaparecer el dispositivo, la condición se cierra y se registra la duración de la interrupción (RF-25).
- El *keep-alive* y el testamento (*Last Will*) de MQTT cuentan como evidencia de supervisión activa (RF-29).
- La detección funciona con independencia del transporte de llegada del dispositivo.
- Un dispositivo en mantenimiento no genera esta condición (RF-22).

## EP-09 · Seguridad y multi-tenencia

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **TT-20** | 🎯 Autenticación de la recepción mediante credencial por sitio | M | 4 | 4 |
| **TT-21** | 🎯 Aislamiento de datos entre sitios, verificado con pruebas | M | 4 | 5 |
| **TT-22** | 🎯 Cifrado del transporte: TLS para HTTP y MQTT | M | 4 | 4 |
| **HU-18** | **Como administrador de sitio**, quiero iniciar sesión con mis credenciales y que existan roles distintos de administración y consulta | M | 4 | 3 |
| **TT-39** | Canal de tiempo real autenticado hacia el panel (SSE tras el proxy TLS, `docs/10 §8.4` punto 1): sesión del panel verificada al abrir (desde M7, en la Etapa 4; antes, solo en la red local, `docs/10 §5`), `Origin` del propio panel, lista de nombres de host (421, `docs/10 §8.4` punto 40), filtros validados y tope de flujos abiertos; límite por usuario y de tasa con la sesión (RF-43, RNF-08; `docs/11 §3` y §4) — agregada el 23/09/2026 | M | 3 | 4 |
| **HU-26** | **Como administrador del sistema**, quiero dar a cada persona uno de los cinco perfiles (administrador del sistema, administrador de sitio, investigador, operador técnico, consulta), para que cada una vea y haga solo lo que le corresponde (RF-44; `docs/20 §2` y §6) — agregada el 08/11/2026 | S | 4 | 6 |
| **HU-27** | **Como persona usuaria**, quiero aceptar los términos de uso al primer ingreso y consultar desde el panel la privacidad, los términos, los avisos de terceros y la versión, para saber qué se hace con mis datos (RF-53, RF-54; `docs/21`) — agregada el 08/11/2026 | M | 4 | 5 |
| **HU-28** | **Como persona usuaria**, quiero dar de baja mi propia cuenta, sabiendo que mis datos personales se anonimizan y el historial del sitio se conserva (RF-55; `docs/20 §11`) — agregada el 08/11/2026 | S | 4 | 3 |

**TT-32 — criterios de aceptación** 🎯

- Un sensor físico (LoRaWAN si el compañero lo entrega a tiempo; si no, el ESP32 por Wi-Fi del plan B)
  publica al menos una trama que el pipeline recibe, normaliza y guarda.
- La medición guardada es consultable por la API con su valor, unidad y marca de tiempo reales.
- Queda registrado (captura o registro) para poder mostrarse en la defensa.

**TT-21 — criterios de aceptación** 🎯

- Existe una prueba automatizada que verifica que un usuario de un sitio recibe `403` o `404` al solicitar datos de otro sitio.
- El aislamiento se aplica en la capa de acceso a datos, no únicamente en la de presentación.
- La exportación y las consultas de API respetan el aislamiento.

## EP-10 · Interfaz de administración

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **HU-19** | 🎯 **Como administrador de sitio**, quiero un panel de salud del sitio con semáforo por dispositivo | M | 3 | **9** |
| **HU-20** | 🎯 **Como administrador de sitio**, quiero la vista de inventario filtrable por sitio, zona, estado y transporte | M | 3 | **7** |
| **HU-21** | 🎯 **Como usuario de consulta**, quiero el detalle de un dispositivo con sus condiciones abiertas, historial y serie de mediciones | M | 3 | **7** |
| **HU-22** | **Como administrador de sitio**, quiero un asistente guiado para registrar un dispositivo nuevo | M | 4 | 4 |
| **HU-23** | **Como administrador de sitio**, quiero ver mi flota agrupada por tecnología de red, para entender por dónde llega cada cosa | S | 4 | 3 |
| **HU-29** | **Como persona usuaria**, quiero elegir las unidades de visualización (°C o °F; mm, m o km), mi zona horaria y guardar vistas, para leer los datos a mi manera sin cambiar lo que guarda la base (RF-56; `docs/19 §4`, P13) — agregada el 08/11/2026 | S | 4 | 5 |
| **HU-31** | **Como persona usuaria**, quiero enviar un mensaje de soporte desde el panel y ver el contacto del responsable de la instancia (RF-61; `docs/19 §4`, P11) — agregada el 08/11/2026 | C | 4 | 2 |
| **TT-42** | Paginación: keyset con cursor opaco sobre `(tiempo, id)` en cuarentena, condiciones, accesos, auditoría y eventos; desplazamiento con total en usuarios e inventario (RF-57; `docs/10 §8.4` punto 58) — agregada el 08/11/2026; al 11/11/2026 faltan accesos y auditoría (keyset) y usuarios (desplazamiento) | M | 4 | 4 |
| **TT-43** | Componentes reutilizables con etiqueta de texto y ayuda accesible (`Boton`, `Tooltip`, `Aviso`) extendidos a tablas y formularios (RF-58; `docs/19 §6`) — agregada el 08/11/2026 | M | 4 | 4 |
| **TT-44** | Comparativa previa de referentes y de normas de usabilidad (WCAG 2.2), cada afirmación con su fuente, antes de rediseñar el tablero y las gráficas (`docs/19 §4`, P1) — agregada el 08/11/2026 | S | 4 | 3 |

**HU-19 — criterios de aceptación** 🎯

- Presenta el total de dispositivos, cuántos en línea, cuántos con condición abierta y cuántos sin supervisión.
- Cada dispositivo muestra un estado visual de cuatro valores: Normal, Alerta, Sin señal e Inactivo (`docs/19 §2`; decidido el 12/10/2026 a partir de una nube comercial de referencia, en reemplazo de los tres niveles del borrador).
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
| **TT-40** | Despliegue comparativo en el banco de pruebas: ThingsBoard CE, OpenRemote y Magistrala con el mismo emulador (TT-28) y las mismas métricas (memoria en reposo y bajo carga, pasos para dar de alta un dispositivo y para una alerta, exportación), con datos propios en vez de cifras declaradas por el fabricante (decisión del 06/10/2026, `docs/10 §8.4` punto 14) | S | 4 | 6 |
| **TT-41** | Diseño del despliegue en Kubernetes: equivalencias Compose → k3s, estado por pieza (qué escala y qué no), N réplicas con suscripciones compartidas y respaldos (`docs/14 §6`) | C | 3 | 2 |

## EP-13 · Validación y pruebas

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **TT-27** | 🎯 Pruebas automatizadas del contrato de trama (esquema, cuarentena, adaptadores) | M | 4 | 5 |
| **TT-28** | 🎯 Emulador de nodo por software, que genera eventos y telemetría sintéticos | M | 3 | **5** |
| **TT-29** | 🎯 Prueba de carga: sostener ≥ 50 tramas por segundo sin pérdida (RNF-01) | M | 4 | 4 |
| **TT-30** | Prueba de recuperación: ningún evento confirmado se pierde ante reinicio (RNF-05, RNF-06) | M | 4 | 4 |
| **TT-31** | Batería de al menos 15 casos de prueba funcionales documentados | M | 4 | 5 |
| **TT-32** | 🎯 Validación de extremo a extremo con al menos un sensor físico (plan B activado el 07/10/2026: ESP32 + BME280 por Wi-Fi, sin descartar las pasarelas de la Facultad) | M | 3 | 3 |

> **TT-28 es mitigación del riesgo R1.** El emulador desacopla la validación de la disponibilidad de
> hardware: permite ejecutar las pruebas de carga y de recuperación sin sensores físicos. El sensor real
> (TT-32) demuestra el caso de uso; el emulador demuestra el comportamiento bajo carga.
>
> **Plan B de R1 (decidido el 23/09/2026).** El objetivo OE4 promete «un sensor real de extremo a
> extremo» al 30 de octubre; TT-32 no exige que ese sensor sea LoRaWAN. La arquitectura ya trata un
> nodo Wi-Fi directo como entrada de primera clase (`docs/10` §1, nodo N2): tras el filtro de análisis,
> una trama LoRaWAN y una Wi-Fi son indistinguibles. **Fecha gatillo: 8 de octubre.** Si para entonces
> no hay confirmación de acceso al hardware LoRaWAN del compañero, se compra un ESP32 con un sensor de
> temperatura barato y se publica SenML por MQTT/TLS directo al broker, sin depender de nadie más. Si
> el LoRaWAN del compañero llega después, se suma como evidencia adicional para la defensa del 4 de
> diciembre, no como condición para el 30 de octubre. Por eso **TT-32 se promovió a núcleo y se
> adelantó de la Etapa 4 a la Etapa 3**: sin eso, nada en el backlog garantizaba un sensor real antes
> del 30 de octubre, aunque el objetivo ya lo prometiera (hallazgo del 23/09).

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

## EP-15 · Operación y confiabilidad

> Épica agregada el 08/11/2026 con el plan de la Etapa 4, versión 2 (§8, bloque B4): lo que hace falta para operar el sistema con datos
> reales sin depender de terceros (RNF-17, RNF-20) y saber cuándo algo falla antes de que lo note quien lo usa.

| ID | Elemento | Prior. | Etapa | Horas |
|---|---|:---:|:---:|:---:|
| **HU-30** | **Como administrador del sistema**, quiero una pantalla «Estado del sistema» con los recursos por contenedor, los errores y el último respaldo, y ajustar desde el panel los límites de los servicios (RF-59, RF-60; `docs/19 §4`, P12) — agregada el 08/11/2026 | M | 4 | 5 |
| **TT-45** | Monitorización propia en la base: `error_sistema` con un filtro global de excepciones, errores del navegador sin datos personales y con límite de tasa, colector de recursos por cgroups a `metrica_recurso` (sin `docker.sock`), condiciones `error_repetido`, `memoria_alta` y `respaldo_atrasado`, latido externo (RNF-19; `docs/10 §8.4` puntos 60 y 61) — agregada el 08/11/2026 | M | 4 | 8 |
| **TT-46** | Respaldos: cifrado en reposo, guion versionado, simulacro mensual de borrado accidental con restauración, guardia «último respaldo de menos de 26 h» y papelera de dispositivos de 30 días (`docs/10 §9.5`) — agregada el 08/11/2026 | M | 4 | 8 |
| **TT-47** | Backend en ES modules (`docs/10 §8.4` punto 63) — agregada el 08/11/2026; ✅ hecha el 11/11/2026 (`docs/16 §60`) | C | 4 | 4 |
| **TT-48** | Pruebas de extremo a extremo en el CI, las que corran sin hardware ni secretos — agregada el 08/11/2026 | S | 4 | 3 |

---

# 6. Verificación de viabilidad del alcance

> Todas las cifras de esta sección se obtuvieron **sumando programáticamente** las estimaciones de los
> elementos del backlog, no estimando el total a ojo. El procedimiento es reproducible sobre este
> mismo documento. §6.1 está al día (79 elementos desde el 08/11/2026); §6.3 a §6.6 conservan el análisis de
> viabilidad con los 66 elementos de entonces, y la cuenta de la Etapa 4 que rige es la de §8.

## 6.1 Esfuerzo estimado

| | Elementos | Horas |
|---|:---:|:---:|
| **Núcleo demostrativo** 🎯 | 34 | **168** |
| Fuera del núcleo | 45 | 179 |
| **Total del backlog** | **79** | **347** |

Por prioridad: **Must** 62 elementos / 287 h · **Should** 13 / 50 h · **Could** 4 / 10 h. Por etapa: la 4 tiene 37 elementos y 164 h.
Hasta el 08/11/2026 eran 66 elementos y 287 h (Must 56 / 253 h · Should 8 / 30 h · Could 2 / 4 h); las 13 filas nuevas de la
Etapa 4 (§8) suman 60 h, todas fuera del núcleo. La épica EP-12 decía 8 h y sus filas suman 16 desde que se agregaron TT-40 y TT-41
(22/10/2026): corregido el 08/11/2026.

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
> del núcleo pasa de +16 % a **+30 %**, y parte del alcance condicional vuelve a ser ejecutable.

## 6.3 🔴 Hallazgo: el backlog completo no cabe en el tiempo disponible

| Etapa | Backlog completo | Solo el núcleo | Presupuesto | Holgura (completo) | Holgura (núcleo) |
|---|:---:|:---:|:---:|:---:|:---:|
| 1 | 9 h | 4 h | 45 h | +80 % | +91 % |
| 2 | 84 h | 53 h | 60 h | **−40 %** | +12 % |
| 3 | 88 h | 77 h | 60 h | **−47 %** | **−28 %** |
| 4 | 104 h | 34 h | 75 h | **−39 %** | +55 % |
| 1–4 (`TT-38`, bitácora) | 2 h | — | — | — | — |
| **Total** | **287 h** | **168 h** | **240 h** | **−20 %** | **+30 %** |

> Presupuesto por etapa según el calendario oficial del 24/08 (§6.2): 45, 60, 60 y 75 h, ~240 h en total.
> 12/10/2026: HU-20, HU-21 y HU-08 (18 h del núcleo) pasaron de la Etapa 4 a la 3 por decisión del estudiante (`docs/18 §3`): la
> Etapa 3 queda sobre su presupuesto también en el núcleo; lo que no alcance vuelve a la Etapa 4 el 27/10.
> Hasta el 23/09 esta tabla y las de §6.4 y §6.6 seguían con el escenario exigente anterior (21/60/60/60,
> 201 h) aunque §6.2 ya lo había reemplazado; se propagó hoy (hallazgo de la revisión de concordancia).

> `TT-38` (2 h, bitácora, Etapa «1–4») no se asigna a una sola etapa: va en su propia fila para que el
> total cuadre con §6.1 (66 elementos, 287 h) sin inflar ninguna etapa. Esta tabla ya incorpora, al
> 23/09/2026, la redistribución de §6.4 (antes solo escrita, no aplicada a las filas) y la promoción
> de TT-32 (plan B de R1).

**Dos conclusiones, y la segunda es la que importa:**

1. **El backlog completo excede el presupuesto en un 20 %.** No es viable ejecutarlo entero.
2. **El núcleo demostrativo sí cabe: 168 h contra 240 disponibles, con 30 % de holgura.** La tesis es
   demostrable dentro del plazo — pero **solo si el alcance se limita al núcleo** y los 119 h restantes
   se tratan como alcance opcional, no comprometido.

> **Decisión de planificación derivada:** el **núcleo (168 h) constituye el compromiso**; los 32
> elementos fuera del núcleo son **alcance condicional**, ejecutables únicamente contra holgura real
> verificada al cierre de cada etapa. Comprometerse con las 287 h produciría un incumplimiento del
> 20 % — y la pauta mide el avance como porcentaje de tareas completadas, de modo que un alcance
> sobredimensionado penaliza más que un alcance acotado y justificado.

## 6.4 🔴 Segundo hallazgo: el núcleo estaba mal distribuido en el tiempo (corregido el 23/09/2026)

Aun limitándose al núcleo, la distribución era defectuosa: **la Etapa 3 concentraba 97 h contra 60
disponibles (−62 %), mientras la Etapa 4 usaba 11 h de 75 (+85 %)**. El problema no era el volumen
total, era su reparto. La redistribución de más abajo se decidió el 22/09 pero, hasta el 23/09, **nunca
se aplicó a las filas del backlog**: seguían con Etapa 3, así que esta sección describía una corrección
de papel, no una real. Se corrigió y se verificó recalculando desde las filas (§6.3).

La causa es que la asignación inicial situó toda la implementación en la Etapa 3, cuando **la pauta solo
exige el 50 % de la implementación en esa etapa y el 100 % en la Etapa 4**. Reservar la Etapa 4 casi
íntegramente para validación e informe desaprovechaba 64 horas.

### Redistribución correctiva

Se trasladan de la Etapa 3 a la Etapa 4 los siguientes elementos del núcleo (~26 h; eran ~37 con HU-20 y HU-08, que volvieron a la Etapa 3 el 12/10), escogidos porque
**no forman parte de la cadena mínima que hay que demostrar funcionando al cierre de la Etapa 3**:

| Elemento | Horas | Por qué puede esperar |
|---|:---:|---|
| **TT-20** Autenticación de recepción | 4 | La cadena funcional se demuestra antes de endurecerla |
| **TT-21** Aislamiento entre sitios | 5 | Ídem; se valida con pruebas en la Etapa 4 |
| **TT-22** Cifrado TLS del transporte | 4 | Ídem |
| **HU-07** Consulta de historial | 4 | El dato se persiste en la Etapa 3; consultarlo puede seguir |
| **TT-27** Pruebas automatizadas del contrato de trama (esquema, cuarentena, adaptadores) | 5 | Corresponde al ciclo de validación de la Etapa 4 |
| **HU-16** Indicador agregado de salud del sitio | 4 | Depende de que la supervisión ya funcione |

**Distribución real del núcleo (recalculada desde las filas el 23/09/2026):**

| Etapa | Núcleo | Presupuesto | Holgura |
|---|:---:|:---:|:---:|
| 1 | 4 h | 45 h | +91 % |
| 2 | 53 h | 60 h | ✅ +12 % |
| 3 | **77 h** | 60 h | **−28 %** |
| 4 | **34 h** | 75 h | ✅ +55 % |
| **Total** | **168 h** | **240 h** | ✅ **+30 %** |

Desde el corte del 08/10 (`docs/18 §3`), la Etapa 3 tenía **59 h de núcleo frente a 60 disponibles (+2 %)**; con el adelanto
del 12/10 (HU-20, HU-21 y HU-08, 18 h de núcleo, `docs/18 §3`) queda en **77 h (−28 %)**, una sobrecarga decidida a sabiendas: lo que no
alcance vuelve a la Etapa 4 el 27/10. En el corte del 08/10, HU-06,
HU-12, HU-15, HU-17 y HU-18 pasaron a la Etapa 4 (17 h; 4 de núcleo, las de HU-15). Antes del corte eran 63 h (−5 %): las 60 h
de la redistribución del 23/09 más las 3 h de TT-32 (plan B de R1), una sobrecarga aceptada entonces frente al riesgo de no
tener un sensor real para el 30 de octubre.

**Verificación del umbral de la Etapa 3.** La pauta exige el **50 % de las tareas de implementación**
completadas. La base es el **núcleo completo (168 h)**: es el compromiso declarado en todo el informe
y el backlog (§6.3, §6.6; cap. 4 del informe), y medir el avance contra la misma cifra que se
prometió es la única lectura que no exige sostener dos números distintos del mismo compromiso ante el
profesor guía. **Corregido el 26/09/2026:** una versión anterior de este párrafo comparaba contra
«Implementación total (EP-01, 04–11) = 165 h»; la suma real de esas épicas completas (núcleo más
alcance condicional) es **169 h**, no 165 ni 118 — ese subconjunto de épicas no se usa como base,
precisamente para no tener dos cifras del mismo umbral. Ejecutado al cierre de la Etapa 3: ~28 h
adelantadas en la Etapa 2 más 77 h de la Etapa 3 (tras el corte del 08/10 y el adelanto del 12/10) = **105 h ≈ 63 %**; si HU-20,
HU-21 y HU-08 no alcanzan y vuelven a la Etapa 4, son 87 h ≈ 52 %. ✅ El umbral se cumple en los dos casos.

## 6.5 Qué se recorta y en qué orden

Los 119 h fuera del núcleo se ordenan por valor decreciente. Se ejecutan de arriba hacia abajo, solo
contra holgura verificada. **Corregido el 23/09/2026:** esta tabla incluía HU-11, TT-28, TT-29 y TT-33
—los cuatro marcados 🎯 (núcleo)— como si fueran recortables, contradiciendo la regla de que el núcleo
no se recorta bajo ninguna circunstancia. El "Resto" también omitía TT-04, TT-08 a TT-10 y TT-14 a
TT-15 por un rango escrito a mano e incompleto. Recalculado sumando directamente las filas del backlog
(32 elementos fuera de núcleo, 119 h exactos, sin excepciones; recalculado el 22/10/2026 al sumar TT-40 y TT-41: el «Resto» llevaba 89 h cuando las filas daban 95 y hoy dan 97):

| Orden | Elementos | Horas | Valor si se ejecuta |
|:---:|---|:---:|---|
| 1 | **HU-04** Adaptador para un formato no SenML | 7 | **Alto** — demuestra la extensibilidad por adaptador (RNF-12), el argumento contra el hardware atado a la plataforma |
| 2 | **HU-12** Agrupación de dispositivos por sitio y zona | 3 | Medio-alto — completa la vista de administrador |
| 3 | **HU-24** Notificación de condición crítica | 5 | Medio — funcionalidad esperada de una plataforma de este tipo |
| 4 | **HU-23** Vista por tecnología de red | 3 | Medio — refuerza el argumento multiprotocolo |
| 5 | **HU-09** API de consulta externa | 4 | Bajo para la demostración |
| 6 | Resto (HU-06, 13, 17, 18, 22, 25, TT-03–04, 08–10, 14–15, 23–26, 30–31, 34–41) | 97 | Variable |

> **Lo que no se recorta bajo ninguna circunstancia:** los 34 elementos marcados 🎯. Su ausencia
> invalidaría la demostración en lugar de reducirla. Si el tiempo no alcanza para el núcleo completo, el
> problema no se resuelve recortando: hay que **renegociar el alcance con el profesor guía y documentar
> la desviación**, que es lo que la pauta valora frente a un incumplimiento silencioso.

## 6.6 Actualización del riesgo R4

El riesgo R4 («alcance excesivo para el tiempo disponible») pasa de probabilidad **media** a
**confirmado**: la verificación numérica demuestra que el alcance completo no es ejecutable. Se
mantiene bajo control mediante la separación explícita entre **núcleo comprometido** y **alcance
condicional**, y mediante la revisión de holgura al cierre de cada etapa.

**Reserva para imprevistos:** el 30 % de holgura del núcleo (72 h) constituye la única reserva. No se
infló ninguna estimación individual: hacerlo habría producido un plan con apariencia de viabilidad sin
mejorarla, y habría impedido detectar la sobrecarga que esta sección documenta.

---

# 7. Priorización: cómo se ordenó y por qué

El orden de ejecución no sigue el número de las épicas, sino tres reglas:

1. **Primero lo que desbloquea:** el entorno (EP-01) y el esquema de datos (TT-19) condicionan todo lo
   demás. Sin ellos ninguna historia puede completarse.
2. **Después lo que demuestra la tesis:** la cadena recepción → normalización → supervisión → interfaz
   (EP-04, EP-05, EP-08, EP-10). Es el recorrido que un evaluador seguirá en una demostración.
3. **Al final lo que mejora el producto:** alertas avanzadas, adaptadores adicionales, API de consulta. Valiosos, pero su
   ausencia no invalida la demostración.

**Regla de decisión ante retraso:** se sacrifica amplitud antes que profundidad. Es preferible una
cadena completa con dos transportes y supervisión funcionando de extremo a extremo, que cuatro
transportes a medio terminar. Un recorrido completo demuestra la hipótesis; cuatro recorridos parciales
no demuestran ninguna.

---

# 8. Estado del backlog

| Aspecto | Estado |
|---|---|
| Épicas definidas | ✅ 15 (EP-15 desde el 08/11/2026), todas vinculadas a un objetivo específico |
| Historias de usuario | ✅ 31, con rol, capacidad y beneficio (HU-26 a HU-31, agregadas el 08/11/2026) |
| Tareas técnicas | ✅ 48 (TT-42 a TT-48, agregadas el 08/11/2026) |
| Elementos del núcleo demostrativo | ✅ 34 elementos, 168 h |
| Criterios de aceptación | ✅ Detallados en los elementos del núcleo; deliberadamente sin refinar en el resto |
| Estimaciones | ✅ 79 elementos estimados, **347 h** en total, sumadas programáticamente (66 y 287 h hasta el 08/11/2026) |
| Priorización | ✅ MoSCoW heredado del catálogo, más orden de ejecución justificado |
| Verificación de viabilidad | 🔴 **Realizada. El backlog completo excede el presupuesto en 19 %; el núcleo cabe con 30 % de holgura. Redistribución correctiva definida.** La Etapa 4 tiene su propia cuenta, con las horas decididas el 08/11/2026 (§8) |

## 7. Plan de la Etapa 3 ordenado por criterio de la rúbrica (06/10/2026)

> **Superado en parte por el corte del 08/10/2026** (`docs/18 §3`): HU-06, HU-12, HU-15, HU-17 y HU-18 pasaron a la Etapa 4.
> Esta tabla queda como el plan del 06/10; el vigente, con su estado medido, es el de `docs/18`.

La pauta de la Etapa 3 pesa: pruebas iniciales 30 %, retroalimentación 20 %, mejoras del diseño 15 %,
documentación 15 %, 50 % de implementación 10 %, validación preliminar 10 %. El orden de trabajo sigue ese
peso, no la numeración de las épicas. Incluye los parciales de la Etapa 2 (TT-12, TT-15, HU-01) y lo que la
entrevista del 05/10 hizo subir (exportación, estados, correo por silencio) o bajar (tiempo real).

| Peso | Criterio | Qué se hace (ítems) | Horas |
|---|---|---|---|
| 30 % | Pruebas iniciales | TT-28 emulador de nodos ✅ (07/10); pruebas de carrera ✅ (07/10: misma lectura ×20 y umbral ×5; destaparon y corrigieron la carrera al abrir condiciones); TT-29 carga ✅ preliminar (59,7 tramas/s sostenidas 90 s sin pérdida, en el portátil); TT-27 pruebas del contrato (parcial: 172 unitarias, sin matriz); TT-36 informe de pruebas → `docs/16` (preliminar). Falta: repetir en el servidor con TLS | 5 + 4 + 3 + 5 = 17 |
| 20 % | Retroalimentación | Registrar la retroalimentación del profesor guía sobre la Etapa 2 cuando llegue; incorporar la entrevista (`docs/03 §4`: fuente [ENT] en `docs/02`, citas en `docs/01`, informe) | 4 |
| 15 % | Mejoras del diseño | Confirmación al broker tras el COMMIT; ACL de `backend` y `sonda`; estado `mantenimiento` sin alertas (RF-22) ✅ (07/10: no abre condiciones, sí las cierra; el registro del período llega con M3); `ON CONFLICT` al abrir condiciones ✅ (07/10); SSE decidido; unidades propias; entidad `pasarela`, ubicación y tabla `trama` (`docs/08 §8`), cada una con antes/después; **edición Apache de TimescaleDB y migración 08 con hora de recepción** (`docs/10 §8.4` puntos 11–12, decididos el 06/10) | 13 |
| 15 % | Documentación | `docs/10 §8.4`, `docs/08 §8`, figuras con la segunda ruta de entrada, matriz de la pila (RNF-15), bitácoras | 6 |
| 10 % | 50 % de implementación | En este orden: HU-08 exportación CSV (traída de la Etapa 4; XLSX candidato) · HU-10 inventario con estados y última actualización · HU-25 destinatarios + correo por silencio (traída) · HU-11 registro de dispositivo · HU-18 sesión y roles · adaptador «milesight» (nuevo) · TT-39 tiempo real como SSE · HU-02 ruta LoRaWAN | 4 + 5 + 3 + 5 + 3 + 4 + 4 + 6 = 34 |
| 10 % | Validación preliminar | TT-32 extremo a extremo con un equipo real (Milesight o del compañero); TT-12 catálogo con los sensores reales; TT-15 claves; cata de TT-40: levantar ThingsBoard CE en el portátil y medir su memoria | 3 + 3 + 2 + 2 = 10 |

**Total: 84 h contra ~60 h disponibles** (§6.2). No cabe todo: los últimos ítems de implementación (SSE, ruta
LoRaWAN) y HU-19 (panel de salud, 9 h) se ejecutan solo contra holgura; qué pasa a la Etapa 4 se decide con el corte medido de
`docs/18 §3`. La regla sigue
siendo la de §6.5: se recorta por el final de cada criterio, nunca las pruebas.

## 8. Plan de la Etapa 4, versión 2 (08/11/2026)

La Etapa 4 va del 06/11 (tras la entrega de la Etapa 3) al 04/12/2026. El 08/11/2026 se reordenó el plan del 01/11 (la versión 1,
resumida al final de esta sección) para poner **primero lo que la persona ve y opera** —el panel, la configuración por usuario, los
perfiles y el alta masiva— y **después los datos, la operación y el cierre**. Responde a la pregunta de la presentación del 05/11 (cómo
dar de alta una flota completa y si cada usuario configurará sus dispositivos, `docs/18 §1`). **Regla de cada bloque:** diseño en el
documento que corresponde (`docs/10`, `docs/19`, `docs/20`, `docs/21`, `docs/14`) → código → prueba que planta la falla → revisión
independiente → medición en `docs/16` → verificador en verde. Las horas de las filas son las de este backlog; las de los bloques, estimadas.

| Bloque | Qué entra | h | Iteración |
|---|---|---|---|
| **B1 · Identidad, legal y auditoría** | ✅ Sesión y roles (HU-18) y pantalla de entrada (P10, `docs/19 §4`), **08/11/2026**; ✅ aislamiento entre sitios (TT-21 🎯), probado el **08/11/2026** con la matriz del paso 4b del guardián; ✅ clave temporal configurable de 1 a 72 h, 2 por defecto (`docs/20 §4`), **08/11/2026**. Falta: auditoría de operaciones (`docs/10 §8.4` punto 43) y «quién lo registró» (HU-11); los **cinco perfiles** en código y en pantalla (HU-26; `docs/20 §2`, §5 y §6; `docs/10 §8.4` punto 64); términos con versión y aceptación al primer ingreso, privacidad generada desde el inventario de `docs/21` y «Acerca de» con versión, commit, aviso AGPL y avisos de terceros generados en la compilación (HU-27; `docs/20 §12`); soporte con formulario en la base y contacto configurable (HU-31); baja de la cuenta por anonimización (HU-28; `docs/20 §11`) | ≈ 30 | 0 |
| **B2 · Panel y experiencia** | Componentes con etiqueta y ayuda accesible, extendidos a tablas y formularios (TT-43); paginación keyset en las listas por tiempo y con total en las chicas (TT-42; `docs/10 §8.4` punto 58); renderizado optimista solo en acciones rápidas y reversibles (`docs/19 §6`); preferencias por usuario: °C o °F, mm, m o km, zona horaria y vistas guardadas, con la base siempre en la unidad estándar (HU-29); umbrales con histéresis y notificaciones en pantalla (HU-06, HU-24, HU-25; RF-14); asistente de alta (HU-22), **alta masiva por archivo** y bandeja de detectados (decididas el 25/10/2026; controles en `docs/11 §4`); tablero y gráficas rediseñados (zoom, rango, varias series, agregados, responsivas) después de una comparativa de referentes y de WCAG 2.2 con fuente (TT-44; `docs/19 §4`, P1); salud del sitio, calidad del enlace e historial por rango (HU-16 🎯, HU-15 🎯, HU-07 🎯); todo probado en teléfono, con evidencia | ≈ 60 | 1 (HU-07, HU-15 y HU-16, en la 0) |
| **B3 · Datos y consultas** | Barrido de supervisión sin N+1 (un `INSERT … SELECT` y los eventos por `UNNEST`) y guardia de «consultas por petición» (`docs/10 §8.4` punto 59); asincronía medida (`Promise.all` en lecturas independientes, cancelación con `AbortController`, `AsyncLocalStorage` para el identificador de petición); agregados por tarea a 7 y 30 días; exportación XLSX (HU-08 🎯); catálogo editable (TT-12 🎯); contrato de trama (TT-27 🎯); ruta C de punta a punta (HU-02 🎯) | ≈ 25 | 2 |
| **B4 · Operación y confiabilidad** | ✅ Parches de seguridad de las cuatro imágenes, **09/11/2026** (`docs/16 §12`); ✅ backend en ES modules (TT-47; `docs/10 §8.4` punto 63), **11/11/2026** (`docs/16 §60`). Falta: monitorización propia (TT-45; `docs/10 §8.4` puntos 60 y 61) y pantalla «Estado del sistema» con los límites configurables (HU-30; `docs/19 §4`, P12); respaldos cifrados, con guion versionado, simulacro mensual, guardia de 26 h y papelera de dispositivos (TT-46); e2e en el CI donde quepan (TT-48); CSP definitiva y sistema de archivos de solo lectura (`docs/11 §4`); carga y recuperación repetidas en el servidor (TT-29, TT-30; OE5) | ≈ 40 | 1 (monitorización y respaldos); 2 (el resto) |
| **B5 · Cierre** | Informe final de 30 páginas como máximo, con todo lo no hecho declarado (TT-37), láminas, revisión de entrega en tres frentes (seguridad, concordancia, privacidad) y entrega el 04/12 | ≈ 15 | Cierre |

**Iteraciones, cada una entregable por sí sola.** **0:** B1 completo y lo que el panel necesita para mostrar datos con sentido (HU-07,
HU-15 y HU-16). **1:** el resto de B2 —con el alta masiva— y la monitorización y los respaldos de B4. **2:** lo demás: e2e en
el CI, ruta C, XLSX, contrato de trama (TT-27), catálogo editable, certificado de cliente por dispositivo (`docs/10 §8.4` punto 57),
Kubernetes, la comparación completa con los referentes (TT-40) y lo de la versión 1 que esta tabla no nombra (abajo). Una iteración no
empieza hasta que la anterior está probada y documentada. **Trabajo futuro, con diseño ya escrito:** la ruta A con Basics Station
(`docs/10 §8.4` punto 56), Kubernetes con escalado probado (`docs/14 §6`), TLS mutuo si no entra en la iteración 2 (`docs/10 §8.4`
punto 57) y la recuperación a un instante con el archivado del WAL (`docs/10 §9.5`).

**La cuenta.** Disponibilidad decidida el 08/11/2026: **≈ 30 h por semana, ≈ 110 h hasta el 04/12** (el doble de las 15 h de RE-01, con
que §6.2 calculó ≈ 75 h para esta etapa). Los bloques suman **≈ 170 h**. La iteración 0 son ≈ 42 h (B1 con lo ya hecho, más las 12 h de
HU-07, HU-15 y HU-16), la 1 ≈ 69 h (las 48 h que quedan de B2 y ≈ 21 h de monitorización y respaldos) y el cierre ≈ 15 h: ≈ 126 h, más
que las ≈ 110 disponibles. Caben la iteración 0, el cierre y la mayor parte de la 1; lo que no alcance, empezando por lo último de la 1,
pasa a la 2, y lo que no se haga se **declara en el informe final con su diseño escrito**, nunca a medias. De esas ≈ 126 h, ≈ 10 ya están
hechas (B1), así que lo pendiente ronda las 116. **Decisión del 09/11/2026:** los cuatro elementos del núcleo que habían quedado en la
iteración 2 (HU-02, HU-08, TT-12 y TT-27; 21 h) **suben a la iteración 1**, porque el núcleo es el compromiso (§6.3); a cambio bajan a la 2
las preferencias de unidades y zona horaria (HU-29), la papelera de dispositivos y la comparativa completa de referentes (lo que exceda a
lo necesario para el tablero). El certificado público de TT-22 sigue en la 2. Cada viernes se mide el avance contra este plan.

**Decisiones del 08/11/2026 que el plan supone** (cada una escrita donde manda):
1. **Cinco perfiles con roles fijos y la matriz en el código** (`docs/20 §2`, §5 y §6; `docs/10 §8.4` punto 64): administrador del
   sistema, administrador de sitio, investigador, operador técnico y consulta; el invitado es la vista pública por enlace, sin cuenta.
   «Exportar» pasa a administrador de sitio e investigador.
2. **Baja de la cuenta por anonimización** (`docs/20 §11`; `docs/10 §8.4` punto 62).
3. **Monitorización propia, sin terceros y dentro de RNF-17** (`docs/10 §8.4` puntos 60 y 61).
4. **Soporte:** formulario guardado en la base (`mensaje_soporte`, con límite de tasa y sin adjuntos) que ve el administrador del
   sistema, más un contacto configurable (`docs/19 §4`, P11).
5. **ES modules en el backend:** bloque propio; adelantado de la iteración 2 y hecho el 11/11/2026, porque `@nestjs/config` 12 se publica
   solo como ES module (`docs/10 §8.4` punto 63).
6. **Paginación:** keyset en cuarentena, condiciones, accesos, auditoría y eventos; desplazamiento con total en usuarios e inventario
   (`docs/10 §8.4` punto 58).
7. **Clave temporal:** 2 h por defecto, configurable de 1 a 72 h (hecho el 08/11/2026, `docs/20 §4`).
8. **Consentimiento y permisos del navegador:** solo la cookie estrictamente necesaria, sin scripts ni SDK de terceros, permisos pedidos
   al activar la función; inventario en `docs/21`.
9. **Páginas legales:** términos con versión y aceptación obligatoria al primer ingreso (`docs/20 §12`); privacidad generada desde el
   inventario, con responsable y contacto configurables; «Acerca de» con avisos de terceros generados desde `pnpm licenses` y
   comprobados por el verificador (`docs/21 §7`).

**Filas nuevas (08/11/2026):** HU-26 a HU-31 y TT-42 a TT-48 (13 elementos, 60 h, Etapa 4, fuera del núcleo) y la épica EP-15; los
requisitos RF-53 a RF-61, RNF-19 y RNF-20 en `docs/02`.

**Versión 1 (01/11/2026), conservada como registro.** Escrita el 24/10 y ajustada hasta el 01/11, ordenaba la etapa en siete bloques
—seguridad, usuarios y roles (≈ 34 h, con el certificado de cliente por dispositivo); panel para operar una flota con pocos clics
(≈ 63 h, con el alta masiva); salud de los datos (≈ 27 h: canal callado y valor congelado, ciclo de vida de las alertas, alias de claves,
notificaciones, testamento de MQTT); lo que pidió el entrevistado del 05/10 (≈ 13 h: XLSX, magnitudes de gases, vista pública, transporte
celular); LoRaWAN completo (≈ 18 h); despliegue, escala y operación (≈ 39 h: servidor con certificado, Kubernetes, respaldos, consumo y
costo por sitio, dimensionar el proxy); pruebas e informe (≈ 30 h)— que sumaban ≈ 224 h frente a ≈ 75 h a 15 h por semana. Su iteración 0
era el mínimo (≈ 70 h: el núcleo pendiente, la sesión, el servidor de prueba y el informe), la 1 el certificado de cliente, la cata de
ThingsBoard CE en el servidor y el ciclo de vida de las alertas, y la 2, trabajo futuro con diseño escrito, incluía el alta masiva. La
versión 2 cambia tres cosas: más horas por semana, el panel y la identidad primero, y **el alta masiva pasa de la iteración 2 a la 1**. Lo
de la versión 1 que la tabla de arriba no nombra (canal callado y valor congelado, ciclo de vida de las alertas, alias de claves,
testamento de MQTT, vista pública por enlace, magnitudes de gases, transporte celular, canal en vivo por WebSocket, costo por sitio,
dimensionar el proxy, rotación con dos valores vigentes, escaneo de secretos en el CI) no se descarta: queda en la iteración 2, con su
diseño donde ya estaba escrito.

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
| **1. Núcleo mínimo** | Sensor real de extremo a extremo | HU-02 (ruta B: pasarela con servidor de red embebido; ChirpStack solo en la ruta A) o HU-03 con el nodo del compañero | ⬜ octubre |
| 2. Segundo nivel | Entrada HTTP | HU-01 | ✅ 16/10 (`docs/16 §41`) |
| 2. Segundo nivel | Alertas por umbral con interfaz | HU-06 | 🟡 motor listo |
| 2. Segundo nivel | Aprovisionamiento desde la plataforma | HU-10, HU-11 | ✅ 12/10 (API; la pantalla es HU-22, E4) |
| 2. Segundo nivel | Cifrado del transporte | TT-22 | ⬜ E3 |
| 2. Segundo nivel | Panel de control | HU-19, HU-20, HU-21 | ✅ 24/10; 🟡 12/10 (P2 y P3 hechas; HU-20 parcial); HU-21 y HU-20 cerradas el 16/10 (`docs/16 §39` y §40) y HU-19 el 24/10 (`docs/16 §53` y §54; estado al día: `docs/18`) |
| 2. Segundo nivel | Exportación en formato abierto | HU-08 | 🟡 E3 (CSV y JSON el 12/10; XLSX en la E4) |
| 2. Segundo nivel | Validación formal | TT-27, TT-28, TT-29 | ⬜ E4 |

El criterio de demostración del informe (cap. 5 §5.2) y OE4 (`docs/01`) siguen este orden.
