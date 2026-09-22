# Retroalimentación del profesor guía sobre la Etapa 1 — lunes 21 de septiembre de 2026

- **Profesor guía:** Mario
- **Modalidad:** escrita, por mensajería, sobre el borrador enviado el 10 de septiembre (78 páginas, que
  incluía ya el capítulo de diseño de la Etapa 2)
- **Etapa en curso:** 2  |  **Fase PPDIOO:** Design
- **Calificación de la Etapa 1:** 6,0

## 1. Qué se presentó

El informe de la Etapa 1 (problema, objetivos, requerimientos, backlog) ampliado con el capítulo de
diseño y el seguimiento del backlog de la Etapa 2, enviado el 10/09 junto con la solicitud de
retroalimentación y la propuesta de una visita presencial.

## 2. Retroalimentación recibida (transcripción)

> El trabajo posee una propuesta técnica amplia, bien estructurada y con una delimitación funcional
> clara: recibir, normalizar, almacenar y supervisar telemetría de sensores. Destacan el árbol de
> problemas, la trazabilidad, la definición del núcleo demostrativo y la conciencia explícita del riesgo
> de sobredimensionar el alcance.
>
> **Descripción y fundamentación del problema.** El problema está claramente expresado y sus
> causas/efectos son comprensibles. La delimitación respecto del trabajo coordinado es buena. Sin
> embargo, el diagnóstico directo con la organización destinataria aún está pendiente, por lo que la
> percepción de stakeholders —evidencia requerida por la rúbrica— no está disponible. Además, se alterna
> entre organizaciones de La Araucanía y la UCT como destinatario principal, lo que difumina el contexto
> real del problema.
>
> **Objetivo general y objetivos específicos.** Objetivos coherentes, secuenciados y mayoritariamente
> SMART. Incluyen productos, fechas, métodos y criterios de validación. La matriz de trazabilidad es una
> fortaleza. Debe corregirse la coherencia temporal de OE1, pues fija el levantamiento con partes
> interesadas al 4 de septiembre, pero el propio documento declara que dicho levantamiento sigue
> pendiente.
>
> **Lo bueno:** árbol de problemas claro, con causas y efectos relacionados con la solución propuesta ·
> delimitación técnica precisa: plataforma de gestión de telemetría, no electrónica de sensores ni red
> LoRa · buena formulación del objetivo general y secuencia lógica de los objetivos específicos ·
> trazabilidad explícita entre causas, efectos, objetivos y etapas metodológicas · identificación
> responsable del alcance excesivo: separa un núcleo demostrativo viable del alcance condicional · estado
> del arte y análisis de alternativas útiles para justificar MQTT, SenML y el descarte de ThingsBoard
> como base principal.
>
> **Hay que mejorar:**
> 1. Realizar y documentar inmediatamente las entrevistas o reuniones con la UCT como propietario del
>    problema. Debe incluir participantes, necesidades, problemas actuales, prioridades y evidencia
>    verificable.
> 2. Definir una sola organización destinataria principal. Si la UCT es el caso de validación y las
>    pymes/agricultura regional el público objetivo, debe explicarse claramente la relación entre ambos;
>    si no, conviene centrar el problema solo en la UCT.
> 3. Respaldar las causas del problema con evidencia más allá de la oferta comercial: datos de usuarios,
>    estudios sobre interoperabilidad IoT, costos de operación, pérdida de telemetría o dificultades de
>    administración.
> 4. Ajustar OE1: al estar pendiente el levantamiento, debe programarse como actividad efectiva de la
>    siguiente etapa o explicitar qué evidencia fue recogida antes de esta entrega.
> 5. Acotar el alcance funcional comprometido. Aunque se declara un núcleo de 155 horas, la plataforma
>    sigue involucrando recepción multiprotocolo, normalización, series de tiempo, supervisión,
>    seguridad, interfaz y validación. La prioridad debe recaer en demostrar recepción, normalización,
>    supervisión de caída y consulta básica.
> 6. Precisar en OE5 los umbrales de validación: carga, recuperación, latencia, disponibilidad, consumo
>    de recursos y número de casos de prueba.

## 3. Cambios derivados de esta retroalimentación

> Esta sección es **evidencia directamente evaluada**: la Etapa 2 asigna un 20 % a «incorpora la
> retroalimentación» y pide ejemplos específicos de cambios en el proyecto.

| # | Indicación recibida | Cambio realizado | Dónde queda la evidencia |
|---|---|---|---|
| 1 | Entrevistas con la UCT como propietario del problema | Entrevistas planificadas para las Etapas 2 y 3 (**no realizadas aún**) con dos perfiles (responsable de laboratorios de la Facultad; dirección de informática), contactos solicitados al profesor guía el 21/09. Guion, registro y forma de incorporar los resultados ya definidos (`docs/03`). Al realizarse habilitan la fuente `[ENT]` en el catálogo | `informe-oficial/cap1.tex` (OE1), `cap3.tex` §3.1, `cap4.tex` §5.5 y riesgo R2; `docs/03` |
| 2 | Una sola organización destinataria | Opción elegida: **solo la UCT**, con el campus como caso de validación. Se quita el contexto regional (predios, agroindustria, pymes) de la definición del problema, porque ninguna otra organización ha manifestado interés; la generalización queda fuera del alcance (una frase en la conclusión); se quita «La Araucanía» de las palabras clave | `cap1.tex` §1.1, `resumen.tex`; `docs/01` |
| 3 | Evidencia de las causas más allá de la oferta comercial | Párrafo «Evidencia de las causas» con literatura revisada por pares sobre interoperabilidad y fragmentación en IoT (Al-Fuqaha et al., 2015; Noura et al., 2019) para C1 y C2, requisitos publicados del referente para C4 y costos de operación cuantificados en esta etapa para C3; la evidencia directa (pérdida de telemetría, dificultades de administración) se asigna al levantamiento | `cap1.tex` §1.1, `referencias.bib`; anexo C |
| 4 | Coherencia temporal de OE1 | OE1 con un solo plazo, 30 de octubre (Etapa 3); la evidencia recogida antes del 4/09 (indicaciones del profesor guía del 17/08 y 02/09, estudio de mercado, base teórica) se explicita en cap. 3 §3.1; los hitos y metas numéricas viven en `docs/01` §2.3, no en el enunciado del objetivo | `cap1.tex` §1.3; `cap3.tex` §3.1; `docs/01` §2.3 |
| 5 | Acotar el alcance funcional comprometido | Criterio de demostración en dos niveles: **núcleo mínimo demostrable** = recepción MQTT + normalización + supervisión de caída + consulta básica por API (los cuatro ya construidos y verificados), y **segundo nivel** condicional = HTTP, alertas, panel, exportación. OE4 reescrito en ese orden; el backlog marca el subconjunto | `cap1.tex` (OE4), `cap4.tex` §5.3; `docs/04` sección final; `docs/01` |
| 6 | Umbrales de validación en OE5 | OE5 con umbrales explícitos: ≥ 15 casos de prueba con ≥ 90 % aprobados; ≥ 50 mensajes/s sin pérdida; latencia recepción→consulta ≤ 2 s (p95); detección de caída ≤ 2 intervalos; recuperación automática tras reinicio sin perder mensajes confirmados; disponibilidad ≥ 99 % en 7 días; memoria total ≤ 2 GB. Todos provienen de los RNF ya catalogados | `cap1.tex` (OE5); `docs/01` §2.3; `docs/02` RNF-01 a 06 y 17 |

Además, para mantener el cuerpo en 30 páginas tras agregar la sección de retroalimentación: las
figuras de red, aprovisionamiento, tiempo real y despliegue pasaron al anexo de figuras complementarias (quedan en el cuerpo C4,
modelo de datos y pipeline); el calendario y el registro de riesgos pasaron al anexo de seguimiento; se condensaron
el estado del arte y el marco metodológico.

## 4. Pendientes

- [ ] Recibir los contactos del profesor guía y agendar las dos entrevistas (meta: primera antes del 2/10).
- [ ] Realizarlas con el guion de `docs/03` §2; registrar con la plantilla del §3.
- [ ] Incorporar citas y requerimientos `[ENT]` al catálogo y al informe (Etapa 3 a más tardar).
- [ ] Entrega oficial de la Etapa 2: viernes 2 de octubre de 2026 (pauta del 17/08). No hay envíos intermedios comprometidos.

## 5. Nota técnica de la sesión

Tras la actualización del sistema a TeX Live 2025 (núcleo LaTeX 2025-11-01), la compilación terminaba
con error aunque generaba PDF: el estilo de citas APA de biblatex engancha la macro de leyendas
(`\@makecaption`) y la definición de memoir no podía re-tokenizarse. Se envolvió la macro en una
definición equivalente en `main.tex`; el guardián de compilación vuelve a exigir cero errores.
