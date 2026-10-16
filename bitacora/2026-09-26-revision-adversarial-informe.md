# Revisión adversarial del informe entregable — 26 de septiembre de 2026

- **Sesión de trabajo individual;** registro de decisiones, no de la jornada.

## 1. Qué se hizo

Barrido de concordancia entre el informe (`.tex`), `docs/` y el estado real del disco y la API,
independiente de los guardianes existentes: se leyó completo el informe y se cruzaron sus cifras y
referencias contra el catálogo de requerimientos, el backlog, las migraciones aplicadas y el
contrato OpenAPI del backend. Seis hallazgos se verificaron contra la fuente y se corrigieron
(10 archivos, +60/−25 líneas, `git diff --stat`). El resto de lo detectado —principalmente en
`docs/`, no en el informe— queda pendiente para la próxima sesión (§4).

## 2. Hallazgos verificados y corregidos

| # | Hallazgo | Corrección | Dónde |
|---|---|---|---|
| 1 | TT-20 (autenticación de la recepción) figuraba «planificado Etapa 3» en el anexo de seguimiento y en `docs/12`; el backlog y el anexo B ya lo tenían en la Etapa 4 desde la redistribución del 23/09 | Corregido a E4 en ambos lugares; la conclusión ya no agrupaba bajo una sola etiqueta de etapa elementos que son de etapas distintas | `anexos/e-seguimiento.tex`, `docs/12`, `conclusion.tex` |
| 2 | El anexo del camino descartado (Contact ID) afirmaba que RF-24 a RF-30 estaban «hoy resueltos»; el capítulo de diseño y `docs/10` dicen que RF-29 (testamento de MQTT) sigue pendiente, y RF-27, RF-28 y RF-30 no tienen rastro en el backend | Acotada la afirmación a RF-24–26 (supervisor periódico); RF-27 a RF-30 quedan explícitos como pendientes | `anexos/d-contactid.tex` |
| 3 | El informe y `docs/12` contaban seis migraciones; en disco hay siete desde el 23/09 (la 07, CHECK de `cuarentena.motivo`) | Agregada a la enumeración en los tres lugares | `cap-diseno.tex`, `anexos/e-seguimiento.tex`, `docs/12` |
| 4 | El glosario citaba `GET /mediciones`, ruta que nunca existió en el backend | Corregida a la ruta real, `GET /canales/{id}/historico`, verificada contra el OpenAPI servido | `glosario.tex` |
| 5 | El anexo de evaluación detallada tenía tres referencias que apuntaban al propio anexo en el que ya estaban, un título de sección que no correspondía a su contenido, dos párrafos en futuro para una decisión ya tomada, y una sección de costos preliminar (6–20 USD/mes) que contradecía a la comparación fechada del 10/09 | Referencias directas a los cuadros (se agregó `\label` a las matrices de backend e interfaz, que no tenían); sección renombrada; verbos en pasado; costos preliminares marcados como superados con remisión al cuadro vigente | `anexos/c-evaluacion.tex` |
| 6 | Dos desbordes de tabla (`Overfull \hbox`) mayores a 6 pt en el mismo anexo: una cabecera de columna más ancha que su columna, y una `longtable` con 13 cm de columnas contra el límite de 12 cm del repo para tablas que cruzan página | Columna ensanchada; `longtable` con `\tabcolsep` de 4 pt y columnas a 11,9 cm | `anexos/c-evaluacion.tex` |

Verificación: recompilado a 30 páginas de cuerpo, cero desbordes >6 pt, cero referencias sin
resolver (`actualizar.sh`). Guardián completo en verde, 46 pasos (`verificar-todo.sh`).

## 3. Guardianes nuevos (para que este tipo de hallazgo se detecte solo)

Los seis hallazgos de arriba comparten un patrón: un hecho (una etapa, un conteo, una ruta) se citó
en prosa en más de un lugar, y solo uno de los lugares se actualizó cuando el hecho cambió. Ningún
paso del guardián existente lo cubría, porque verificaba el esquema y la base, no las cifras que el
informe *dice sobre* ellos. Se agregan tres pasos mecánicos, cada uno probado plantando la violación
de hoy antes de incorporarlo (falla con el motivo real; pasa con el estado corregido):

- **2g:** toda mención de «N migraciones» en `docs/` y el informe debe coincidir con el número de
  archivos `NN-*.sql` en disco.
- **2h:** toda ruta HTTP citada en prosa (glosario, `docs/10`, `docs/12`, `docs/15`) debe existir en
  el OpenAPI versionado (`plataforma/backend/openapi.json`).
- **`api-smoke.sh`, dentro del paso 4 (con el backend corriendo):** el OpenAPI que sirve el backend
  en caliente debe tener las mismas rutas y métodos que el archivo versionado, para que un cambio de
  ruta en el código que olvide `pnpm openapi` no pase inadvertido (el paso 2h por sí solo no lo
  detectaría, porque compara la prosa contra el archivo versionado, no contra el código real).

Guardián completo, con la pila y el backend corriendo: 47 pasos, `TODO EN CONCORDANCIA`.

## 4. Segunda tanda del mismo día: concordancia de `docs/` con el informe

Con el informe ya corregido, se resolvió el resto de lo encontrado por el barrido, casi todo en
`docs/02` y `docs/04` (no tocaba el informe entregable):

- **Cinco objetivos, no seis.** `docs/02` y `docs/04` seguían con OE1–OE6 (despliegue como OE4
  aparte); el informe y `docs/01` ya fusionaron arquitectura y despliegue en un solo OE3 desde antes.
  Renumerada la tabla de trazabilidad de `docs/02`, la tabla de épicas de `docs/04`, y dos
  referencias sueltas (una de ellas, «mínimo de 20 comprometido en OE1», no correspondía a ningún
  objetivo: es la cifra del núcleo mínimo demostrable, no un compromiso de OE1).
- **EP-09: 16 h → 20 h.** La fila resumen no se actualizó cuando TT-39 se agregó el 23/09; verificado
  sumando los cinco elementos reales de la épica. De paso, la columna Etapa de EP-06 a EP-09 se
  recalculó de la misma forma (fila por fila), no se copió del hallazgo original sin verificar.
- **El umbral de la Etapa 3**, cerrado en una sola cifra (168 h del núcleo) por decisión explícita;
  la comparación descartada también tenía la aritmética mal (169 h, no 165 ni 118, para las épicas
  completas EP-01 y EP-04–11).
- **Seis criterios de aceptación del backlog** (HU-01, HU-02, HU-05, HU-11, HU-14, TT-07, TT-12)
  seguían en vocabulario Contact ID (tripleta ACCT/GG/CCC, checksum de 16 dígitos, BCD, `Q=1`/`Q=3`,
  código 381, *heartbeat* 602/603) sin rastro en el backend real; reescritos en SenML/MQTT contra
  el modelo de datos verificado en `docs/08`.
- **`docs/02 §6`** apuntaba solo al protocolo descartado como «la decisión de mayor peso»; corregido
  para anteponer la evaluación vigente (`docs/06`) y el conteo real de alternativas (ocho, no siete).
- Un 49 % de *Must* corregido a 51 % (ya decía 51 en la tabla de la misma sección); restaurada una
  frase que un reemplazo literal de la palabra vetada rompió dentro de su propio aviso; el
  `README.md` del informe, que describía la Etapa 1, reescrito con la estructura real (30 páginas,
  seis anexos).

Verificación: guardián completo, 47 pasos, `TODO EN CONCORDANCIA` tras cada bloque de cambios.

## 5. Pendiente para la próxima sesión

Lo que no se tocó hoy por estar fuera de esta revisión (no son hallazgos nuevos, son los pendientes
ya registrados): el contraste de las lecciones de método con el código (
seguridad HTTP/CORS/CSP), la lectura crítica desde 4.2, y las decisiones propias del texto de Rust
y la fecha gatillo del plan B.
