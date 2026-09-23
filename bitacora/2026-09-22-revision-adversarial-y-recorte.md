# Revisión adversarial de la Etapa 2 y recorte a 30 páginas — 22-23 de septiembre de 2026

- **Sesión de trabajo individual;** registro de decisiones, no de la jornada.

## 1. Qué se hizo

Revisión con seis lentes independientes (rúbrica, redes, arquitectura de software, redacción,
coherencia numérica, retroalimentación del profesor guía) sobre el informe compilado, cada hallazgo
verificado por dos escépticos aparte antes de contar. Detalle completo en `privado/REVISION-ETAPA2.md`
(no versionado: contiene decisiones a medio tomar).

## 2. Decisiones tomadas

| # | Decisión | Por qué | Dónde queda |
|---|---|---|---|
| 1 | Corregir la trazabilidad diseño→requerimientos (fuente única `docs/10` §7) | Tres lentes independientes encontraron el mismo error de citas RF/RNF | `docs/10`, `cap-diseno.tex`, anexo de evaluación |
| 2 | Agregar RNF-17 (faltaba en el anexo) y RNF-18 (disponibilidad, nuevo) al catálogo | OE5 citaba un umbral de disponibilidad sin requerimiento de respaldo, justo la observación 6 del profesor guía | `docs/02`, anexo de requerimientos, cap. 1 y 3 |
| 3 | Quitar vocabulario del protocolo descartado y los términos vetados que quedaban en cuatro documentos | Contradice el propio pivote del 2/09 y la instrucción explícita del profesor | `docs/00`, `docs/01`, `docs/02`, `PLAN-MAESTRO.md`, glosario |
| 4 | Unificar las cifras del backlog con la fuente que las suma de verdad (63 elementos, 275 h) | El informe y `docs/04` decían números distintos | `cap4.tex`, anexo de backlog |
| 5 | Quitar el canal de órdenes de la ACL del broker | Autobucle real: el backend suscrito a todo habría recibido sus propias órdenes como trama ajena | `mosquitto/config/acl`, `broker.service.ts` |
| 6 | Corregir una cita que sostenía más de lo que su resumen dice | Verificado leyendo el abstract real del artículo | `cap1.tex` |
| 7 | Recortar el cuerpo de 31 a 30 páginas fusionando dos párrafos de la conclusión y acortando frases en cap. 1 y 3 | Límite blando del proyecto; una sola línea sobrante obligó a localizar la página exacta y cortar ahí | `conclusion.tex`, `cap1.tex`, `cap3.tex`, `cap-diseno.tex` |

## 3. Pendiente (decisiones del estudiante, no aplicadas)

Diez puntos detallados en `privado/REVISION-ETAPA2.md`; los dos de mayor peso: (a) el capítulo de
diseño presenta como construido un despliegue de cinco contenedores cuando hoy corren dos —riesgo
directo para el 55 % del criterio de diseño—; (b) el código ejecuta las alertas antes que la
supervisión, al revés de lo que documenta el diseño.

## 4. Lección de método (registrada en las reglas de trabajo personales, fuera del repositorio)

Cortar página por página a ciegas no funciona: hubo que compilar, ubicar exactamente qué línea
sobraba en qué página, y cortar ahí. También: un dato con forma de dato real (una MAC de ejemplo con
prefijo de fabricante real) se trata como dato real aunque sea ficticio.

## 5. Verificaciones

- `actualizar.sh --completo`: TODO OK, cuerpo en 30 páginas, 0 referencias rotas.
- `verificar-todo.sh`: TODO EN CONCORDANCIA (esquema, migraciones, entidades, diagramas).
