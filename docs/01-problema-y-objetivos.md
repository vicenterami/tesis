> ⚠️ **ACTUALIZADO AL PIVOTE DEL 02/09/2026 Y A LA RETROALIMENTACIÓN DEL 21/09/2026.** Título vigente:
> *Plataforma web para el registro, monitoreo y gestión de datos de sensores* (sin alcance regional en
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

> **La UCT, que ya posee sensores IoT en el Campus Dr. Luis Rivas del Canto, no logra convertir los
> datos que estos generan en información utilizable, porque carece de una plataforma que unifique la
> recepción, la normalización y la gestión de dispositivos que se comunican mediante tecnologías y
> formatos distintos entre sí.**

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

**Vacío en la oferta existente.** El análisis de la oferta regional identifica dos actores:

| Proveedor | Qué ofrece | Modelo | Qué queda sin cubrir |
|---|---|---|---|
| [IoT3.cl](https://iot3.cl/) | Monitoreo y automatización en tiempo real: sensores, controladores y plataforma web. Fuerte en agricultura. | Solución llave en mano por proyecto | Si el hardware ya está instalado y es de otra marca, no hay integración |
| [ControlTec.cl](https://www.controltec.cl/) (SpA, 2021) | Telemetría industrial inalámbrica: estanques, combustible, climatización. Supervisión desde el celular. | Telemetría de bajo costo, hardware propio | Panel de telemetría acoplado a su hardware, no plataforma de ingesta abierta |

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
- La plataforma de ingesta, normalización, almacenamiento y gestión de datos de sensores.
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

---

# 2. Objetivos (versión del 02/09, pivote incorporado)

## 2.1 Criterio de redacción

Un solo objetivo general (indicación del profesor guía), con verbo de la taxonomía de Bloom;
específicos que explicitan qué se hace, mediante qué método y con qué resultado verificable.

## 2.2 Objetivo general (único)

> **Desarrollar una plataforma web para el registro, monitoreo y gestión de datos de sensores, que reciba las tramas de distintos sensores a través de TCP/IP, las normalice a un
> modelo interno único, almacene las mediciones como series de tiempo, supervise el estado de cada
> dispositivo y presente la información en un panel de control, validada con un caso de uso con
> sensores reales al término del semestre académico 2026.**

## 2.3 Objetivos específicos (5)

| | Objetivo | Método | Resultado verificable | Plazo |
|---|---|---|---|---|
| **OE1** | Caracterizar la situación de gestión de datos de sensores en la organización destinataria y establecer sus requerimientos | Revisión de literatura, análisis de la oferta nacional e internacional y entrevistas semiestructuradas a las partes interesadas | **Hito 1 (cumplido):** catálogo preliminar 100 % trazable a las causas, con fuentes secundarias e indicaciones del profesor guía. **Hito 2:** catálogo validado con ≥ 2 entrevistas documentadas (participantes, necesidades, problemas actuales, prioridades), la primera dentro de la Etapa 2 | 4 sep 2026 / 30 oct 2026 |
| **OE2** | Evaluar y seleccionar el mecanismo de transporte y el formato de trama, y especificar el contrato de entrada y sus adaptadores | Matrices de criterios ponderados con nombre legible (≥ 5 transportes, ≥ 4 formatos); especificación del contrato | Documento de especificación: tópicos, esquema de trama, política de cuarentena y adaptadores | 2 oct 2026 |
| **OE3** | Diseñar la arquitectura de la plataforma, su modelo de datos y su despliegue con costo cuantificado | Fase *Design* de PPDIOO, notaciones estándar; comparación de ≥ 3 alternativas de alojamiento | ≥ 5 diagramas; modelo de datos ≥ 8 entidades; costo mensual y anual en CLP y USD | 2 oct 2026 |
| **OE4** | Implementar la plataforma en dos niveles: **núcleo mínimo demostrable** (recepción MQTT, normalización, supervisión de caída, consulta básica por API) y luego HTTP, alertas y panel | Desarrollo incremental guiado por el backlog, versionado en git; el segundo nivel se ejecuta contra la holgura verificada al cierre de cada etapa | Núcleo mínimo con ≥ 1 sensor real de extremo a extremo al 30 oct; segundo nivel al 4 dic | 30 oct / 4 dic 2026 |
| **OE5** | Validar la plataforma en condiciones que replican el entorno operativo (servidor modesto, no el equipo de desarrollo) | Pruebas funcionales, de carga y de recuperación; comparaciones antes/después; protocolo escrito antes de medir (`docs/09`) | ≥ 15 casos de prueba con ≥ 90 % aprobados · ≥ 50 mensajes/s sin pérdida (RNF-01) · latencia recepción→consulta ≤ 2 s p95 (RNF-02) · caída detectada ≤ 2 intervalos (RNF-03) · recuperación automática tras reinicio sin perder mensajes confirmados (RNF-05/06) · disponibilidad de la recepción ≥ 99 % en 7 días · memoria total ≤ 2 GB (RNF-17) | 4 dic 2026 |

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
