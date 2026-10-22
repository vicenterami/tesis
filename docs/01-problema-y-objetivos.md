> ⚠️ **ACTUALIZADO AL PIVOTE DEL 02/09/2026 Y A LA RETROALIMENTACIÓN DEL 21/09/2026.** Título vigente:
> *Sistema integrado para el registro, gestión y monitoreo de dispositivos IoT* (título fijado el 30/09/2026 tras la reunión con el profesor guía; sin alcance regional en
> el título: la UCT es la única organización destinataria, ver §1.1 y la actualización al final). Se
> descartó Contact ID (ver `bitacora/2026-09-02-reunion-pivote.md` y `docs/06`); el eje es la telemetría
> continua y el pipeline de recepción y normalización de tramas. El árbol de causas y efectos sigue vigente.

# Etapa 1 — Definición del problema y objetivos

> **Curso:** Trabajo de Título INFO-1197 · Universidad Católica de Temuco
> **Profesor guía:** Mario · **Fase PPDIOO:** Prepare + Plan
> **Cubre:** criterio 1 (definición del problema, 10 %) y criterio 2 (objetivos SMART, 25 %) = **35 % de la etapa**
> **Versión:** borrador 1 — 17 de agosto de 2026

---

# 1. Definición del problema

## 1.1 Contexto

La Universidad Católica de Temuco es la organización destinataria y dueña del problema: dispone de
sensores en el Campus Dr. Luis Rivas del Canto y no tiene dónde recibir sus datos ni cómo
administrarlos (§1.6). El contexto regional —La Araucanía concentra actividad agrícola, agroindustrial
y pequeñas y medianas empresas donde la adopción de sensores dejó de ser una barrera económica (un
nodo con radio de largo alcance cuesta entre USD 5 y 30, bandas 915–928 MHz sin licencia de espectro)—
es la motivación y el ámbito de generalización posible, **no el problema que este trabajo valida**
(actualización del 21/09, ver el final de este documento).

El resultado es que **la barrera se desplazó**. Ya no está en adquirir el sensor, sino en qué hacer
con lo que el sensor emite.

## 1.2 Enunciado del problema central

> **La organización que ya posee dispositivos IoT no logra convertir sus datos en información utilizable,
> porque carece de un sistema integrado que los registre, reciba y unifique sus datos, vigile su estado y
> los presente en un solo lugar.** (Enunciado vigente desde el 01/10/2026, igual al del informe §1.1; el árbol
> en texto de abajo conserva la redacción anterior: la vigente es la figura 1.1 del informe.)

Formulado desde la perspectiva del afectado: *«tengo los sensores instalados y funcionando, pero no
tengo dónde recibir sus datos, ni cómo administrarlos, ni cómo saber si siguen reportando».*

## 1.3 Análisis de causas

| # | Causa | Descripción |
|---|---|---|
| **C1** | **Fragmentación de protocolos y formatos** | Cada fabricante define su propio esquema de datos. Un sensor LoRaWAN entrega una trama binaria propietaria; uno WiFi publica un JSON con nombres de campo arbitrarios; otro expone una API REST distinta. No existe vocabulario común entre ellos. |
| **C2** | **Acoplamiento entre hardware y plataforma** | La oferta comercial regional vende solución cerrada llave en mano: el panel funciona con el hardware del propio proveedor. Un sensor ya instalado de otra marca no se integra. |
| **C3** | **Costo y dependencia de plataformas SaaS comerciales** | Las alternativas de mercado cobran licencia por dispositivo o por volumen de datos, y alojan la información en infraestructura de terceros fuera del control de la organización. |
| **C4** | **Ausencia de capacidad técnica interna** | Construir la capa de recepción, normalización y almacenamiento requiere competencias de redes, protocolos y desarrollo que la organización destinataria no tiene internamente. |
| **C5** | **Falta de visibilidad del estado de la conectividad** | Sin una capa de gestión, no se detecta que un sensor dejó de reportar, que su batería se agotó o que el enlace de radio se degradó. El silencio de un sensor es indistinguible de la ausencia de novedades. |

## 1.4 Efectos observables

| # | Efecto | Consecuencia |
|---|---|---|
| **E1** | Inversión en sensores subutilizada o inmovilizada | Equipamiento adquirido que no produce retorno |
| **E2** | Datos que se pierden o nunca se almacenan | Imposibilidad de análisis histórico o de tendencias |
| **E3** | Decisiones operativas que siguen tomándose sin dato | El sensor existe pero no informa la decisión |
| **E4** | Fallas de sensores detectadas tardíamente | Pérdida de continuidad del monitoreo sin que nadie lo advierta |
| **E5** | Dependencia de proveedor (*vendor lock-in*) | Cada ampliación obliga a comprar al mismo proveedor |

```
                    ┌─────────────────────────────────────────────┐
   EFECTOS          │ E1 inversión     E2 datos      E3 decisiones│
                    │    inmovilizada     perdidos      sin dato  │
                    │        E4 fallas tardías   E5 lock-in       │
                    └──────────────────────▲──────────────────────┘
                                           │
        ┌──────────────────────────────────┴──────────────────────────────────┐
 PROBLEMA│ Quien ya posee sensores de distintos fabricantes no puede convertir │
 CENTRAL │ sus datos en información utilizable: falta una plataforma que      │
        │ unifique la recepción, la normalización y la gestión de dispositivos│
        └──────────────────────────────────▲──────────────────────────────────┘
                                           │
                    ┌──────────────────────┴──────────────────────┐
   CAUSAS           │ C1 fragmentación   C2 acoplamiento          │
                    │    de protocolos      hardware-plataforma   │
                    │ C3 costo/dependencia  C4 falta de capacidad │
                    │       SaaS               técnica interna    │
                    │        C5 sin visibilidad de conectividad   │
                    └─────────────────────────────────────────────┘
```

## 1.5 Justificación de relevancia e impacto

**Relevancia para el propietario del proyecto.** La Universidad Católica de Temuco cuenta con
sensores desplegados y requiere un destino para sus datos: una API a la cual enviarlos y una
plataforma desde la cual administrarlos. Esta necesidad, manifestada por el profesor guía en la
reunión del 17 de agosto de 2026, constituye la solicitud que origina el proyecto.

> ⚠️ **Pendiente de completar:** esta sección debe incorporar la **percepción directa de las partes
> interesadas** —la rúbrica lo exige literalmente— mediante entrevistas al responsable de los
> sensores de la universidad. Ver sección 1.6.

**Relevancia regional (motivación, no objeto de validación — ver actualización del 21/09).** La
estructura productiva de La Araucanía —predios agrícolas dispersos, agroindustria, pymes con
instalaciones distribuidas— genera condiciones donde el monitoreo remoto
tiene valor operativo directo, y donde los sensores de largo alcance y bajo consumo son técnicamente
apropiados.

> **Nota (01/10/2026):** sección de la Etapa 1, conservada como registro. Sus afirmaciones sobre competidores no tienen fuente verificada y varias quedaron superadas; el estado del arte vigente, con fuentes oficiales, está en el informe §1.2 (`informe-oficial/cap1.tex`). No citarla.

**Vacío en la oferta existente.** El análisis de la oferta regional identifica dos actores:

| Proveedor | Qué ofrece | Modelo | Qué queda sin cubrir |
|---|---|---|---|
| [IoT3.cl](https://iot3.cl/) | Monitoreo y automatización en tiempo real: sensores, controladores y plataforma web. Fuerte en agricultura. | Solución llave en mano por proyecto | Si el hardware ya está instalado y es de otra marca, no hay integración |
| [ControlTec.cl](https://www.controltec.cl/) (SpA, 2021) | Telemetría industrial inalámbrica: estanques, combustible, climatización. Supervisión desde el celular. | Telemetría de bajo costo, hardware propio | Panel de telemetría acoplado a su hardware, no plataforma de recepción abierta |

**Ambos venden la solución completa acoplada a su propio hardware.** Ninguno ofrece la **capa de
gestión desacoplada del equipamiento**: una plataforma neutral que reciba datos de sensores que la
organización ya posee, cualquiera sea su procedencia. Ese es el espacio que este trabajo aborda.

**Relevancia académica.** La interoperabilidad entre protocolos IoT es un problema abierto: la
proliferación de estándares de aplicación no convergentes obliga a resolver la normalización en la
capa de plataforma. El aporte de este trabajo consiste en especificar y validar un mecanismo concreto
de normalización basado en un estándar de industria ya existente y ampliamente desplegado, en lugar
de proponer un formato nuevo.

## 1.6 Partes interesadas

| Parte interesada | Rol | Interés en el problema | Estado del levantamiento |
|---|---|---|---|
| **Universidad Católica de Temuco** | Propietaria del proyecto | Enviar los datos de sus sensores a una API y administrarlos | ⚠️ Entrevista pendiente |
| **Responsable técnico de los sensores** | Usuario administrador | Saber qué dispositivos hay, si reportan y cómo incorporar uno nuevo | ⚠️ Por identificar |
| **Usuario operativo** | Consumidor de la información | Consultar mediciones y recibir alertas | ⚠️ Por identificar |
| Pymes productivas de la región *(contexto regional, fuera de la validación desde el 21/09)* | Generalización posible | Aprovechar sensores ya adquiridos sin rehacer la inversión | No se valida en este trabajo |
| **Profesor guía (Mario)** | Supervisor académico | Rigor metodológico y enfoque en redes | Reunión del 17/08/2026 registrada en `bitacora/` |

> 🔴 **Acción crítica de la semana:** identificar y entrevistar al responsable de los sensores de la
> universidad. La rúbrica asigna el 10 % del criterio 1 a la validación del problema con las partes
> interesadas, y el criterio 3 (45 %) exige «solicitudes del propietario del proyecto» como respaldo
> de los requerimientos. Sin al menos una declaración textual de una parte interesada, ambos criterios
> quedan sin evidencia.

## 1.7 Delimitación del alcance

**El trabajo abarca:**
- La plataforma de recepción, normalización, almacenamiento y gestión de datos de sensores.
- La especificación del protocolo de comunicación sensor ↔ plataforma y su API.
- Adaptadores para al menos dos transportes distintos, demostrando la capacidad multiprotocolo.
- El diseño de red asociado: segmentación, seguridad del transporte y monitoreo del estado del enlace.
- La validación en un caso de uso con sensores reales.

**El trabajo no abarca:**
- Fabricación o comercialización de sensores.
- Desarrollo de firmware de grado comercial (solo el nodo de prueba necesario para validar).
- Analítica avanzada, aprendizaje automático o predicción sobre los datos.
- Despliegue productivo a escala ni operación continua post-entrega.
- Certificación normativa del equipamiento.

## 1.8 Referentes con datos, no con opinión (22/10/2026)

Cuatro plataformas que el estado del arte del informe nombra, comparadas con este sistema en siete criterios medibles. Cada celda se
sostiene en una afirmación verificada en la documentación oficial (cita literal, URL y fecha en el registro de evidencia del proyecto,
fuera del repositorio; el identificador entre paréntesis es el de esa fila). «No declarado» significa que la página revisada no lo dice,
no que no exista. Versiones: ThingsBoard CE, última publicada v4.4.0.1 mientras sus guías instalan la v4.3.1.7; OpenRemote, documentación 1.32.0.

| Referente | (a) RAM mínima local | (b) Vías de entrada | (c) Pasos de alta de UN dispositivo | (d) Formatos de trama | (e) Licencia | (f) TLS y credencial | (g) Exportación |
|---|---|---|---|---|---|---|---|
| **ThingsBoard CE** | Guía v4.3.1.7: 4 GB en desarrollo/PoC, 8 GB en producción pequeña (N-TB-03; B-TB-02, B-TB-03). Para la 4.4: no declarado (B-TB-12) | MQTT v3.1/3.1.1/5.0 (N-TB-04); HTTP, CoAP y LwM2M directos (N-TB-05); LoRaWAN solo por integración de plataforma, que es de la edición Professional (N-TB-06) | Guía «Getting Started», Step 1: 2 subpasos; el 1.1 son 5 acciones (menú Entities, + Add device, nombre, perfil, Add) y el 1.2 verifica conectividad (N-TB-09) | JSON por defecto y Protocol Buffers binario (N-TB-07); SenML: no declarado (N-TB-08); biblioteca de decodificadores por fabricante (C-TB-02) | BUSL-1.1 desde la 4.4.0 (D-TB-10), cada versión pasa a Apache-2.0 a los cuatro años (D-TB-11); ≤ 4.3: Apache-2.0 (D-TB-12); archivo LICENSE del repositorio (N-TB-14) | TLS en 8883; credencial por dispositivo: token de acceso (usuario MQTT sin clave), MQTT básico o X.509 (N-TB-10); ACL por tópico: no declarado (N-TB-11) | CSV, XLS y XLSX desde un widget (N-TB-12); API REST de series por ventana y agregación (N-TB-13) |
| **OpenRemote** | Instancia central: no declarado (A-04); pasarela de borde: 4 GB con Keycloak o 2 GB con identidad básica (A-01) | API HTTP, MQTT y WebSocket del manager (A-36); agentes HTTP, MQTT, SNMP, Modbus, LoRaWAN, TCP, UDP y otros (A-35, A-19, A-22); CoAP y LwM2M: no declarado (A-37) | Tutorial «Connect your MQTT Client»: 5 pasos rotulados (N-OR-03); alta manual por interfaz (A-16); alta automática por certificado X.509 (A-17, N-OR-05) | JSON del valor de cada atributo (N-OR-04; A-38); SenML: no declarado (A-42) | AGPL-3.0, archivo LICENSE.txt (N-OR-09, A-48); licencia comercial opcional (A-49) | TLS en 8883 (N-OR-01); un usuario de servicio por cliente con usuario y secreto (N-OR-02); certificado X.509 único por cliente en el alta automática (N-OR-05); ACL por tópico: no declarado (N-OR-06) | API de exportación en ZIP (N-OR-07); API de consulta del histórico de un atributo (N-OR-08); CSV con tope de 1 M de datos (A-54); exportación completa por SQL (A-55) |
| **Magistrala** | No declarado (B-MG-01) | HTTP, MQTT, CoAP y WebSocket (N-MG-01); LoRaWAN: adaptador obsoleto en `magistrala-contrib` (N-MG-03); LwM2M: no declarado (N-MG-04) | «Quick Start Guide» sin lista numerada: secciones Create a Group, Create a Device, Create a Channel, Create a Rule (EE) y Send a Message (N-MG-08); guardar mensajes exige una regla del Rules Engine, de la edición Enterprise (N-MG-09) | SenML en arreglo, JSON o CBOR (N-MG-05; C-MG-03) | Núcleo Apache-2.0 (D-MG-05); interfaz web: contradictorio (D-MG-04) | TLS y DTLS (N-MG-02); identificador y secreto por dispositivo como usuario y clave MQTT (N-MG-06); permiso de publicar o suscribir por dispositivo y canal, no por tópico (N-MG-07) | Descarga CSV de mensajes filtrados en la interfaz (D-MG-08); API de lectura de mensajes de un canal (N-MG-10) |
| **Milesight IoT Cloud** | No declarado (servicio en la nube, sin instalación local publicada: N-MS-07) | Pasarelas y controladores celulares Milesight por MQTT (N-MS-01); solo equipos Milesight: «can only work with all Milesight LoRaWAN products and Milesight UC300/UC3X cellular controllers» (FAQ oficial, C-MS-01); un sensor LoRaWAN solo llega por una pasarela Milesight (C-MS-03); sin API hacia otras plataformas: «Does Milesight IoT Cloud provide API to connect to other platform or database? Not support now» (C-MS-02b) | Guía «How to Add a Device»: 3 pasos rotulados (estado de la pasarela, agregar con el número de serie, configurar); «It does not support adding other brand devices» (N-MS-03) | No declarado (N-MS-05) | No declarado (N-MS-07) | Certificado y OAuth 2.0 sobre el mecanismo de AWS, puerto 8883 (N-MS-02); credencial por dispositivo y ACL por tópico: no declarado (N-MS-04) | Descarga CSV de datos históricos, 3 meses por descarga (N-MS-06); sin API hacia otras plataformas (C-MS-02b) |
| **Este sistema** | ≤ 2 GB por RNF-17; medido en el banco: 174 MiB con carga sostenida (backend, base y broker) y 324 MiB en el pico con el proxy (`docs/16 §3`) | MQTT 3.1.1 o 5 sobre TLS 8883; HTTPS 443 (`POST /recepcion/{id}` con token); LoRaWAN por pasarela con servidor embebido (ruta B, probada en terreno el 20/10) o por ChirpStack (ruta C), ambas por MQTT; reporte HTTPS de la pasarela previsto | 1 llamada: `POST /dispositivos` con la clave de administrador crea el dispositivo con sus canales y devuelve la credencial una sola vez (todo o nada con el broker, `docs/10 §3`); pasarelas igual | SenML nativo; `plano`; JSON de Milesight y de ChirpStack con perfil de decodificación (los 10 bytes del campus) | AGPL-3.0-only (código, `plataforma/LICENSE`); la de los textos se fija antes de publicar el repositorio | TLS 1.2+ en 443 y 8883; credencial por dispositivo (hash en el broker, `scrypt` en la base para HTTP) y ACL por rol: publica solo bajo su propio identificador (`docs/11 §3`) | CSV y JSON por dispositivo y rango, en flujo (`GET /dispositivos/{id}/exportar`); histórico por canal con `time_bucket` |

**Lo que la tabla deja ver:** (1) ninguna de las cuatro declara una instalación central local de 2 GB (OpenRemote declara 2 GB solo para su pasarela de borde con identidad básica); (2) de las tres de código abierto, ThingsBoard tiene
LoRaWAN en la edición de pago, Magistrala en un adaptador obsoleto y OpenRemote como agente; (3) de las cuatro, solo Magistrala declara SenML (en las otras, no declarado); (4) la
nube del fabricante acepta solo sus equipos y no exporta hacia otras plataformas; (5) un alta aquí es una llamada, frente a 3 a 5 pasos o
secciones en las demás. Lo que no se afirma: cuál es «mejor»; la comparación es por criterio y con fuente.

**Fuentes revisadas** (documentación oficial, leída el 22/10/2026 salvo las filas anteriores, del 30/09 y del 08/10):
- **Magistrala:** https://github.com/absmach/magistrala/blob/main/LICENSE · https://github.com/absmach/magistrala/blob/main/README.md · https://www.absmach.eu/docs/magistrala/community/dev-guide/api/ · https://www.absmach.eu/docs/magistrala/community/dev-guide/architecture/ · https://www.absmach.eu/docs/magistrala/community/dev-guide/extensions/lora/ · https://www.absmach.eu/docs/magistrala/community/user-guide/device-management/devices/ · https://www.absmach.eu/docs/magistrala/community/user-guide/messaging/ · https://www.absmach.eu/docs/magistrala/community/user-guide/users-quick-start/ · https://www.absmach.eu/products/magistrala/
- **Milesight:** https://support.milesight-iot.com/support/solutions/articles/73000514209-how-to-add-a-device-to-milesight-iot-cloud · https://support.milesight-iot.com/support/solutions/articles/73000603114-milesight-iot-cloud-faq
- **OpenRemote:** https://docs.openremote.io/docs/rest-api/get-datapoint-export/ · https://docs.openremote.io/docs/rest-api/get-datapoints/ · https://docs.openremote.io/docs/tutorials/connect-your-mqtt-client/ · https://docs.openremote.io/docs/user-guide/gateways-and-devices/auto-provisioning/ · https://docs.openremote.io/docs/user-guide/manager-apis/ · https://github.com/openremote/openremote/blob/master/LICENSE.txt · https://github.com/openremote/openremote/blob/master/profile/deploy.yml · https://openremote.io/open-source/ · https://openremote.io/product/ · https://raw.githubusercontent.com/openremote/openremote/master/LICENSE.txt
- **ThingsBoard:** https://github.com/thingsboard/thingsboard/blob/master/LICENSE · https://github.com/thingsboard/thingsboard/blob/v4.3.1.6/LICENSE · https://github.com/thingsboard/thingsboard/blob/v4.4/LICENSE · https://raw.githubusercontent.com/thingsboard/thingsboard/master/LICENSE · https://thingsboard.io/docs/connect-iot-devices/ · https://thingsboard.io/docs/getting-started/1/ · https://thingsboard.io/docs/installation/ubuntu/ · https://thingsboard.io/docs/reference/mqtt-api/getting-connected/ · https://thingsboard.io/docs/reference/rest-api/ · https://thingsboard.io/docs/user-guide/csv-xls-data-export/ · https://thingsboard.io/docs/user-guide/integrations/

---

# 2. Objetivos (versión del 02/09, pivote incorporado)

## 2.1 Criterio de redacción

Un solo objetivo general (indicación del profesor guía), con verbo de la taxonomía de Bloom;
específicos que explicitan qué se hace, mediante qué método y con qué resultado verificable.

## 2.2 Objetivo general (único)

> **Desarrollar un prototipo de sistema integrado para el registro, gestión y monitoreo en tiempo real de
> dispositivos IoT, con un dashboard que centralice sus datos, estado y alertas, para facilitar su
> aprovechamiento en actividades de investigación de la Facultad de Ingeniería de la Universidad
> Católica de Temuco.** (Fijado el 30/09/2026 tras la reunión con el profesor guía del 29/09.)

## 2.3 Objetivos específicos (5)

| | Objetivo | Método | Resultado verificable | Plazo |
|---|---|---|---|---|
| **OE1** | Caracterizar las necesidades de la Facultad y establecer sus requerimientos | Revisión de literatura, análisis de la oferta nacional e internacional y entrevistas semiestructuradas a las partes interesadas | **Hito 1 (cumplido):** catálogo preliminar 100 % trazable a las causas, con fuentes secundarias e indicaciones del profesor guía. **Hito 2:** catálogo validado con ≥ 2 entrevistas documentadas (participantes, necesidades, problemas actuales, prioridades), la primera dentro de la Etapa 2 | 4 sep 2026 / 30 oct 2026 |
| **OE2** | Evaluar y seleccionar el transporte y el formato de los datos, y especificar la recepción | Matrices de criterios ponderados con nombre legible (≥ 5 transportes, ≥ 4 formatos); especificación del contrato | Documento de especificación: tópicos, esquema de trama, política de cuarentena y adaptadores | 2 oct 2026 |
| **OE3** | Diseñar la arquitectura, el modelo de datos y el despliegue del sistema, con costo cuantificado | Fase *Design* de PPDIOO, notaciones estándar; comparación de ≥ 3 alternativas de alojamiento | ≥ 5 diagramas; modelo de datos ≥ 8 entidades; costo mensual y anual en CLP y USD | 2 oct 2026 |
| **OE4** | Implementar el sistema en dos niveles: **núcleo mínimo** (recepción, unificación de los datos, supervisión y consulta) y luego registro de dispositivos, alertas y dashboard | Desarrollo incremental guiado por el backlog, versionado en git; el segundo nivel se ejecuta contra la holgura verificada al cierre de cada etapa | Núcleo mínimo con ≥ 1 sensor real de extremo a extremo al 30 oct; segundo nivel al 4 dic | 30 oct / 4 dic 2026 |
| **OE5** | Validar el sistema en condiciones que replican el entorno operativo (servidor modesto, no el equipo de desarrollo) | Pruebas funcionales, de carga, de recuperación y de uso con personal no técnico de la Facultad; comparaciones antes/después; protocolo escrito antes de medir (`docs/09`) | ≥ 15 casos de prueba con ≥ 90 % aprobados · ≥ 50 mensajes/s sin pérdida (RNF-01) · latencia recepción→consulta ≤ 2 s p95 (RNF-02) · caída detectada ≤ 2 intervalos (RNF-03) · recuperación automática tras reinicio sin perder mensajes confirmados (RNF-05/06) · disponibilidad de la recepción ≥ 99 % en 72 horas (RNF-18) · memoria total ≤ 2 GB (RNF-17), la mitad del servidor recomendado en `docs/14` · prueba de uso con personal no técnico (umbral a fijar en un RNF nuevo, Etapa 3) | 4 dic 2026 |

## 2.4 Matriz de trazabilidad

| Objetivo | Causas | Efectos | Fase PPDIOO | Etapa |
|---|---|---|---|---|
| OE1 | C4 (diagnostica C1–C5) | E1, E3 | Prepare | 1 |
| OE2 | **C1** | E2, E5 | Plan · Design | 2 |
| OE3 | C2, C3, C5 | E1, E4, E5 | Design · Plan | 2 |
| OE4 | C1, C2, C4 | E1–E3 | Implement | 3 · 4 |
| OE5 | C5 | E4 | Operate · Optimize | 4 |

Las cinco causas y los cinco efectos quedan cubiertos.

# 3. Riesgos identificados

| # | Riesgo | Impacto | Probabilidad | Mitigación |
|---|---|---|---|---|
| **R1** | No disponer del hardware de sensores a tiempo | Alto — bloquea OE5 y OE6 | Media | Diseñar la validación para que funcione con un emulador de nodo por software; el sensor físico demuestra el caso, el emulador demuestra la carga |
| **R2** | No lograr acceso a las partes interesadas de la universidad | Alto — compromete el 10 % del criterio 1 y el respaldo del 45 % del criterio 3 | Media | Escalar la solicitud a través del profesor guía; documentar el intento y usar fuentes secundarias como respaldo parcial |
| **R3** | ~~Ambigüedad en las fechas de las etapas~~ | — | **CERRADO 24/08** | La pauta oficial fijó las fechas: 4 sep · 2 oct · 30 oct · 4 dic. La planificación contra el escenario exigente dejó una semana de holgura adicional |
| **R4** | Alcance excesivo para el tiempo disponible (≈15 h semanales) | Medio — riesgo de no superar el 70 % de logro | Media | Backlog priorizado con corte explícito de alcance mínimo viable; el umbral de aprobación es 70 %, no 100 % |
| **R5** | ~~Contact ID insuficiente para telemetría continua~~ | — | **CERRADO 02/09**: el profesor guía descartó Contact ID por esta misma razón; el protocolo pasó a MQTT + SenML (`docs/06`) | El riesgo anticipado se materializó y está resuelto |

---

# 4. Estado de este documento

| Sección | Estado |
|---|---|
| 1.1 – 1.4 Contexto, problema, causas y efectos | ✅ Completo |
| 1.5 Justificación | 🟡 Falta la percepción directa de las partes interesadas |
| 1.6 Partes interesadas | 🔴 Entrevistas pendientes |
| 1.7 Delimitación | ✅ Completo |
| 2.2 – 2.3 Objetivos general y específicos | ✅ Completo, sujeto a validación del profesor guía |
| 2.4 Matriz de trazabilidad | ✅ Completo |
| 3 Riesgos | ✅ Completo |

**Siguiente documento:** `docs/02-requerimientos.md` (criterio 3, 45 % de la etapa) y
`historico/docs/05-protocolo-contactid.md` (evaluación de alternativas que sustenta OE2).

---

## Retroalimentación del profesor guía incorporada (21 de septiembre de 2026)

Seis observaciones sobre la Etapa 1 (`bitacora/2026-09-21-retroalimentacion-etapa1.md`) produjeron
estos cambios en este documento y en el informe:

1. **Destinatario único.** La Universidad Católica de Temuco es la organización destinataria y dueña del
   problema; el Campus Dr. Luis Rivas del Canto es el caso de validación. El problema se centra **solo en la
   UCT**: ninguna otra organización ha manifestado interés. La sección «Relevancia regional» de este
   documento queda como antecedente histórico de la motivación; en el informe no forma parte del problema
   y la generalización se menciona una vez, como fuera de alcance, en la conclusión.
2. **Evidencia de las causas** más allá de la oferta comercial: literatura revisada por pares sobre
   interoperabilidad y fragmentación en IoT (Al-Fuqaha et al., 2015, *IEEE Communications Surveys &
   Tutorials*; Noura, Atiquzzaman y Gaedke, 2019, *Mobile Networks and Applications*) para C1 y C2;
   requisitos publicados del referente abierto para C4; costos de operación cuantificados (`docs/14`) para
   C3. La evidencia directa de la organización es el objeto del levantamiento.
3. **OE1 en dos hitos** (tabla §2.3), con la evidencia recogida antes del 4/09 explicitada.
4. **OE4 en dos niveles**: núcleo mínimo demostrable primero.
5. **OE5 con umbrales**, todos tomados de los RNF ya catalogados.
6. **Levantamiento programado**: perfiles, guion y registro en `docs/03`; contactos gestionados vía
   profesor guía.
