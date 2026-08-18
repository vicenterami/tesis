# Etapa 1 — Definición del problema y objetivos

> **Curso:** Trabajo de Título INFO-1197 · Universidad Católica de Temuco
> **Profesor guía:** Mario · **Fase PPDIOO:** Prepare + Plan
> **Cubre:** criterio 1 (definición del problema, 10 %) y criterio 2 (objetivos SMART, 25 %) = **35 % de la etapa**
> **Versión:** borrador 1 — 17 de agosto de 2026

---

# 1. Definición del problema

## 1.1 Contexto

La Región de La Araucanía concentra actividad agrícola, agroindustrial y de pequeñas y medianas
empresas productivas. En los últimos años la adopción de sensores para monitoreo —temperatura en
cámaras de frío e invernaderos, nivel en estanques, consumo eléctrico, apertura de accesos, humedad
de suelo— dejó de ser una barrera económica: un nodo sensor con radio de largo alcance cuesta entre
USD 5 y 30, y las bandas de radio de uso libre (915–928 MHz en Chile, plan AU915) no requieren
licencia de espectro.

El resultado es que **la barrera se desplazó**. Ya no está en adquirir el sensor, sino en qué hacer
con lo que el sensor emite.

## 1.2 Enunciado del problema central

> **Las organizaciones que ya poseen sensores IoT no logran convertir los datos que estos generan en
> información utilizable, porque carecen de una plataforma que unifique la ingesta, la normalización
> y la gestión de dispositivos que se comunican mediante tecnologías y formatos distintos entre sí.**

Formulado desde la perspectiva del afectado: *«tengo los sensores instalados y funcionando, pero no
tengo dónde recibir sus datos, ni cómo administrarlos, ni cómo saber si siguen reportando».*

## 1.3 Análisis de causas

| # | Causa | Descripción |
|---|---|---|
| **C1** | **Fragmentación de protocolos y formatos** | Cada fabricante define su propio esquema de datos. Un sensor LoRaWAN entrega una trama binaria propietaria; uno WiFi publica un JSON con nombres de campo arbitrarios; otro expone una API REST distinta. No existe vocabulario común entre ellos. |
| **C2** | **Acoplamiento entre hardware y plataforma** | La oferta comercial regional vende solución cerrada llave en mano: el panel funciona con el hardware del propio proveedor. Un sensor ya instalado de otra marca no se integra. |
| **C3** | **Costo y dependencia de plataformas SaaS comerciales** | Las alternativas de mercado cobran licencia por dispositivo o por volumen de datos, y alojan la información en infraestructura de terceros fuera del control de la organización. |
| **C4** | **Ausencia de capacidad técnica interna** | Construir la capa de ingesta, normalización y almacenamiento requiere competencias de redes, protocolos y desarrollo que las organizaciones destinatarias no tienen internamente. |
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
 PROBLEMA│ Quien ya posee sensores heterogéneos no puede convertir sus datos  │
 CENTRAL │ en información utilizable: falta una plataforma que unifique la    │
        │ ingesta, la normalización y la gestión de dispositivos.             │
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

**Relevancia regional.** La estructura productiva de La Araucanía —predios agrícolas dispersos,
agroindustria, pymes con instalaciones distribuidas— genera condiciones donde el monitoreo remoto
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
| **Pymes productivas de la región** | Beneficiario potencial | Aprovechar sensores ya adquiridos sin rehacer la inversión | Caracterización indirecta vía análisis de oferta |
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

# 2. Objetivos

## 2.1 Criterio de redacción

Conforme a la indicación del profesor guía, cada objetivo explicita **qué se hará**, **cómo se hará**
y **qué resultado verificable se obtendrá**, con un indicador medible y un plazo. La estructura
aplicada es:

> *[verbo en infinitivo] + [objeto] + [mediante qué método] + [para obtener qué resultado
> verificable] + [en qué plazo].*

## 2.2 Objetivo general

> **Diseñar, implementar y validar una plataforma web abierta para la gestión de datos de redes de
> sensores IoT heterogéneas, que unifique la ingesta mediante un protocolo de comunicación basado en
> el estándar Contact ID (SIA DC-05), aplicando la metodología PPDIOO, de modo que una organización
> que ya posee sensores de distintas tecnologías pueda centralizar, normalizar y administrar sus
> datos desde una única interfaz, validada sobre un caso de uso con sensores reales al término del
> semestre académico 2026.**

## 2.3 Objetivos específicos

Cada objetivo se presenta con su desglose SMART y su indicador de cumplimiento.

---

### OE1 — Caracterizar el problema y establecer los requerimientos

> **Caracterizar** la situación actual de gestión de datos de sensores en la organización
> destinataria, **mediante** entrevistas semiestructuradas a las partes interesadas, revisión de
> literatura técnica y análisis de la oferta regional, **para obtener** un catálogo de requerimientos
> funcionales y no funcionales íntegramente trazables a las causas del problema, **al 28 de agosto de
> 2026**.

| Criterio | Concreción |
|---|---|
| **S** — Específico | Catálogo de requerimientos con trazabilidad explícita causa → requerimiento |
| **M** — Medible | ≥ 2 entrevistas a partes interesadas · ≥ 20 requerimientos documentados · **100 %** de los requerimientos trazados a al menos una causa (C1–C5) · ≥ 2 competidores analizados |
| **A** — Alcanzable | Requiere gestión de entrevistas y trabajo documental, sin dependencia de hardware |
| **R** — Relevante | Aborda C4 y sustenta los criterios 1 y 3 de la Etapa 1 (55 % de la etapa) |
| **T** — Temporizado | Viernes 28 de agosto de 2026 (Etapa 1) |

**Fase PPDIOO:** Prepare

---

### OE2 — Especificar el protocolo de comunicación sensor ↔ plataforma

> **Especificar** un protocolo de comunicación entre sensor y plataforma basado en el estándar
> Contact ID (SIA DC-05), **mediante** un análisis comparativo ponderado frente a alternativas
> vigentes y la definición de un perfil de aplicación con su mapeo de códigos de evento, **para
> obtener** un documento de especificación que incluya la gramática del mensaje, la tabla de
> equivalencias y el contrato de la API de ingesta, **al 25 de septiembre de 2026**.

| Criterio | Concreción |
|---|---|
| **S** — Específico | Especificación formal del protocolo y de la API, no una descripción general |
| **M** — Medible | ≥ 6 alternativas evaluadas con matriz de criterios ponderados (MQTT+JSON, CoAP, LwM2M, Sparkplug B, SenML, SIA DC-09) · ≥ 25 códigos de evento mapeados · mensaje de evento **≤ 11 bytes**, verificado contra el payload útil mínimo de LoRaWAN · gramática del mensaje formalizada |
| **A** — Alcanzable | El estándar SIA DC-05 es público y documentado; el trabajo es de análisis y diseño |
| **R** — Relevante | Aborda directamente C1, y responde a la instrucción explícita del profesor guía de justificar la elección del protocolo frente a otros |
| **T** — Temporizado | Viernes 25 de septiembre de 2026 (Etapa 2) |

**Fase PPDIOO:** Plan + Design

---

### OE3 — Diseñar la arquitectura de la plataforma y su red de soporte

> **Diseñar** la arquitectura de la plataforma y el diseño de red que la soporta, **mediante** la
> aplicación de la fase *Design* de PPDIOO y el uso de notaciones de modelado reconocidas, **para
> obtener** un conjunto de diagramas, un modelo de datos y una especificación de seguridad y
> segmentación que cubra la totalidad de los requerimientos levantados, **al 25 de septiembre de
> 2026**.

| Criterio | Concreción |
|---|---|
| **S** — Específico | Diagramas de arquitectura, topología de red, modelo de datos y diseño de seguridad |
| **M** — Medible | ≥ 5 diagramas en notación estándar (arquitectura de componentes, topología de red con segmentación, modelo entidad-relación, flujo de ingesta, secuencia de aprovisionamiento) · **100 %** de los requerimientos de OE1 asignados a un componente · modelo de datos con ≥ 8 entidades |
| **A** — Alcanzable | Trabajo de diseño documental, sin dependencia de adquisiciones |
| **R** — Relevante | Aborda C2 y C5; constituye el 55 % de la Etapa 2 («diseña adecuadamente según estándares de calidad») |
| **T** — Temporizado | Viernes 25 de septiembre de 2026 (Etapa 2) |

**Fase PPDIOO:** Design

---

### OE4 — Determinar el modelo de despliegue y el costo de operación

> **Determinar** la alternativa de alojamiento de la plataforma y su costo total de operación,
> **mediante** la comparación de al menos tres opciones de despliegue bajo criterios de costo,
> soberanía del dato y sostenibilidad, **para obtener** una recomendación justificada con el costo
> mensual y anual estimado del producto, **al 25 de septiembre de 2026**.

| Criterio | Concreción |
|---|---|
| **S** — Específico | Recomendación única de despliegue con costo cuantificado |
| **M** — Medible | ≥ 3 alternativas comparadas (infraestructura propia de la universidad, servidor virtual arrendado, nivel gratuito de proveedor de nube) · costo mensual y anual expresado en CLP y USD · matriz de criterios ponderados |
| **A** — Alcanzable | Información de precios públicamente disponible |
| **R** — Relevante | Responde a la instrucción explícita del profesor guía: definir dónde estará alojada y cuánto costará el producto aunque sea abierto. Aborda C3 |
| **T** — Temporizado | Viernes 25 de septiembre de 2026 (Etapa 2) |

**Fase PPDIOO:** Plan

---

### OE5 — Implementar la plataforma y sus adaptadores multiprotocolo

> **Implementar** la API de ingesta, el motor de normalización y la interfaz web de gestión, junto
> con adaptadores para al menos dos transportes distintos, **mediante** desarrollo incremental guiado
> por el backlog priorizado y versionado en repositorio git, **para obtener** un prototipo funcional
> capaz de recibir, normalizar, almacenar y presentar datos de sensores de tecnologías diferentes,
> **al 20 de noviembre de 2026**, con el 50 % de avance verificable al 23 de octubre de 2026.

| Criterio | Concreción |
|---|---|
| **S** — Específico | Prototipo funcional con API, normalización, persistencia e interfaz de gestión |
| **M** — Medible | **50 %** de las tareas de implementación del backlog al 23/10 y **100 %** al 20/11 · ≥ 2 transportes operativos · ≥ 1 sensor físico reportando de extremo a extremo · historial de commits con mensaje descriptivo en el 100 % de ellos |
| **A** — Alcanzable | ⚠️ Condicionado a la disponibilidad de hardware; ver riesgo R1 |
| **R** — Relevante | Materializa la solución al problema central. Constituye el 10 % de la Etapa 3 y el 10 % de la Etapa 4 |
| **T** — Temporizado | 23 de octubre (50 %) y 20 de noviembre de 2026 (100 %) |

**Fase PPDIOO:** Implement

---

### OE6 — Validar la plataforma en condiciones que replican el entorno operativo

> **Validar** el funcionamiento de la plataforma en condiciones que replican el entorno operativo
> real, **mediante** una batería de pruebas funcionales, de carga y de recuperación ante fallas, con
> comparación cuantitativa antes y después de las optimizaciones aplicadas, **para obtener** un
> informe de validación que acredite el cumplimiento de los requerimientos establecidos en OE1, **al
> 20 de noviembre de 2026**.

| Criterio | Concreción |
|---|---|
| **S** — Específico | Informe de validación con datos cuantitativos y trazabilidad a requerimientos |
| **M** — Medible | ≥ 15 casos de prueba documentados · ≥ 90 % de casos aprobados · ingesta sostenida de ≥ 50 mensajes/segundo sin pérdida · detección de sensor caído en ≤ 2 intervalos de reporte · ≥ 3 comparaciones cuantitativas antes/después de optimización |
| **A** — Alcanzable | Las pruebas de carga se ejecutan con generadores de tráfico sintético, sin requerir sensores físicos masivos |
| **R** — Relevante | Aborda C5 y E4. Constituye el 30 % de la Etapa 3 y el 50 % de la Etapa 4 |
| **T** — Temporizado | Viernes 20 de noviembre de 2026 (Etapa 4) |

**Fase PPDIOO:** Operate + Optimize

---

## 2.4 Matriz de trazabilidad

Vinculación de cada objetivo específico con las causas del problema que aborda, los efectos que
mitiga, la fase metodológica y la etapa de evaluación correspondiente.

| Objetivo | Causas que aborda | Efectos que mitiga | Fase PPDIOO | Etapa | Entregable verificable |
|---|---|---|---|---|---|
| **OE1** Caracterizar y levantar requerimientos | C4, y diagnostica C1–C5 | E1, E3 | Prepare | 1 | Catálogo de requerimientos + registro de entrevistas |
| **OE2** Especificar el protocolo | **C1** | E2, E5 | Plan · Design | 2 | Especificación del protocolo + contrato de API |
| **OE3** Diseñar arquitectura y red | C2, C5 | E2, E4 | Design | 2 | Diagramas + modelo de datos + diseño de seguridad |
| **OE4** Modelo de despliegue y costo | **C3** | E1, E5 | Plan | 2 | Matriz comparativa + recomendación con costo |
| **OE5** Implementar la plataforma | C1, C2, C4 | E1, E2, E3 | Implement | 3 · 4 | Prototipo funcional + repositorio git |
| **OE6** Validar en entorno realista | C5 | E4 | Operate · Optimize | 4 | Informe de validación con datos cuantitativos |

**Verificación de cobertura:** las cinco causas (C1–C5) y los cinco efectos (E1–E5) están cubiertos
por al menos un objetivo específico. Ninguna causa queda sin objetivo asociado y ningún objetivo
carece de vínculo con el problema.

| Causa | Objetivos que la abordan | | Efecto | Objetivos que lo mitigan |
|---|---|---|---|---|
| C1 Fragmentación de protocolos | OE1, **OE2**, OE5 | | E1 Inversión inmovilizada | OE1, OE4, OE5 |
| C2 Acoplamiento hardware-plataforma | **OE3**, OE5 | | E2 Datos perdidos | OE2, OE3, OE5 |
| C3 Costo y dependencia SaaS | **OE4** | | E3 Decisiones sin dato | OE1, OE5 |
| C4 Falta de capacidad técnica | **OE1**, OE5 | | E4 Fallas detectadas tarde | OE3, **OE6** |
| C5 Sin visibilidad de conectividad | OE3, **OE6** | | E5 Dependencia de proveedor | OE2, OE4 |

---

# 3. Riesgos identificados

| # | Riesgo | Impacto | Probabilidad | Mitigación |
|---|---|---|---|---|
| **R1** | No disponer del hardware de sensores a tiempo | Alto — bloquea OE5 y OE6 | Media | Diseñar la validación para que funcione con un emulador de nodo por software; el sensor físico demuestra el caso, el emulador demuestra la carga |
| **R2** | No lograr acceso a las partes interesadas de la universidad | Alto — compromete el 10 % del criterio 1 y el respaldo del 45 % del criterio 3 | Media | Escalar la solicitud a través del profesor guía; documentar el intento y usar fuentes secundarias como respaldo parcial |
| **R3** | Ambigüedad en las fechas de las etapas | Alto — invalida la planificación completa | **Alta, sin resolver** | Planificar contra el escenario más exigente (28 de agosto). Confirmar con el profesor guía en la primera oportunidad |
| **R4** | Alcance excesivo para el tiempo disponible (≈15 h semanales) | Medio — riesgo de no superar el 70 % de logro | Media | Backlog priorizado con corte explícito de alcance mínimo viable; el umbral de aprobación es 70 %, no 100 % |
| **R5** | Contact ID resulta insuficiente para casos de telemetría continua | Medio | **Ya identificado** | Arquitectura de dos planos: eventos en Contact ID, mediciones con valor en formato complementario. Documentado como decisión de diseño, no como hallazgo tardío |

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
`docs/05-protocolo-contactid.md` (evaluación de alternativas que sustenta OE2).
