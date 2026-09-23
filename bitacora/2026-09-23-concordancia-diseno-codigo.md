# Concordancia diseño ↔ código y canal de tiempo real — 23 de septiembre de 2026

- **Sesión de trabajo individual;** registro de decisiones, no de la jornada.

## 1. Qué se hizo

Revisión del diseño contra el código con la regla de concordancia fijada ayer (manda el diseño
documentado; el código lo sigue). Se compararon el diagrama de secuencia del pipeline (`docs/10 §4`),
el servicio de recepción del backend y las variables de entorno que el código lee frente a las que el
repositorio documenta. Se investigó, con fuentes primarias, la seguridad del canal de tiempo real hacia
el navegador (OWASP, documentación de Docker, Node y NestJS).

## 2. Decisiones tomadas

| # | Decisión | Por qué | Dónde queda |
|---|---|---|---|
| 1 | Numerar los filtros como se ejecutan: **5 alertar, 6 supervisar** | Las alertas se evalúan por lectura dentro del bucle; la supervisión cierra la trama una vez al final. El diagrama decía lo contrario | `docs/10 §4` y `§8.2`, figura `sec-pipeline`, comentarios del backend, `docs/06` |
| 2 | El código sigue al diseño: tras autenticar, el filtro de supervisión corre **aunque la trama sea malformada** | El diseño dice que «vivo» es salud del enlace, no calidad del dato; el código cortaba el pipeline en el filtro 2 y no marcaba vivo al dispositivo | `recepcion.service.ts`, prueba unitaria nueva, `docs/10 §8.2` |
| 3 | Canal de tiempo real **del backend y autenticado**; tarea técnica nueva **TT-39** (Etapa 3, 4 h); WebSocket o SSE queda abierto para la Etapa 3 | El navegador nunca toca el broker (patrón B, 04/09); WebSocket no trae autenticación propia y exige `wss`, sesión en el apretón de manos, lista blanca de `Origin` y límites (OWASP) | `docs/10 §5`, `docs/11 §4`, `docs/04` EP-09, anexo B, cap. 4 |
| 4 | El backend escucha en `127.0.0.1` fuera de Docker y en la red interna dentro del contenedor (`HTTP_INTERFAZ`), sin `ports` | Sin eso el proxy no lo alcanza; con `ports` ausente Docker no lo hace visible fuera del servidor. No afecta al escalado, que se documenta aparte como una sola instancia deliberada | `docs/10 §6`, `docs/11 §2 y §4`, `.env.example` |
| 5 | **Rust** entra a la matriz de tecnología con los mismos criterios | Era la preferencia personal del autor y no había sido evaluada; queda igual que Go (2,65): lo descarta el tiempo de aprendizaje, no su calidad | `docs/02 §6.5`, anexo C |
| 6 | `.env.example` declara las diez variables que el backend lee y un guardián lo verifica | Faltaban siete, una obligatoria: quien clonara el repo no arrancaba el backend | `plataforma/.env.example`, `verificar-todo.sh` 2d, `docs/11 §7` |
| 7 | Quitar los vestigios del protocolo descartado que quedaban en el backlog y en el catálogo | Contradecían el pivote del 02/09 (criterio del MVP, HU-04, HU-08, ventaja L-D) | `docs/02`, `docs/04` |
| 8 | **Auditar dependencias en el CI** (`pnpm audit --audit-level=high`) y cerrar los 22 avisos (10 altos) que había | Tipos, lint y pruebas estaban en verde y aun así el backend arrastraba vulnerabilidades conocidas: «verde» no incluía dependencias. NestJS 11.2.5 (no 11.2.6, publicada ese día: pnpm exige 24 h de antigüedad y esa guardia no se salta), CLI 11.0.24 y tres *overrides* dejan 0 | `docs/11 §4`, workflow del CI, `package.json`, `pnpm-workspace.yaml` |
| 9 | El backend lee `HTTP_INTERFAZ` (por defecto solo este equipo; `0.0.0.0` en contenedor), con `\|\|` y no `??` | Probado en ejecución: una variable vacía habría abierto todas las interfaces en silencio. Cuatro pruebas unitarias | `src/arranque.ts`, `main.ts`, `.env.example`, `docs/10 §6` |
| 10 | **Revisión del estudiante sobre el PDF:** la Figura 3.1 (TikZ del cap. 3, de la Etapa 1) seguía diciendo «5 supervisar, 6 alertar», ponía la cuarentena «malformada» bajo el filtro 3 y la serie de tiempo saliendo del filtro 6. Reescrita con el orden real, una sola cuarentena para los filtros 1–3, la serie desde el 4 y las condiciones desde 5 y 6. Guardián 2e nuevo (probado plantando la violación) para que las tres casas del orden —figura, `docs/06`, `docs/10`— no vuelvan a separarse | La renumeración del punto 1 se aplicó al diagrama Mermaid y al código, pero no a esta figura dibujada a mano: una casa más de la que no se tenía inventario | `figuras/pipeline.tex`, `verificar-todo.sh` 2e |
| 11 | Leyenda de la Figura 4.1 y `docs/10 §1` descritas por rol, no por posición («a la izquierda… a la derecha» no coincidía con el dibujo, cuya distribución la decide Mermaid). Se añade que ChirpStack se aloja en el servidor pero está del lado de los sensores en la frontera, que cada usuario ve solo su sitio (RF-41) y qué módulos se dibujan | Hallazgo del estudiante al revisar el PDF | `figuras/contenedores.tex`, `docs/10 §1` |
| 12 | Fundamentar por qué QoS 1 y no QoS 2: la garantía de QoS 2 es por salto cliente–broker, no hasta la base; el receptor idempotente es necesario igual y con él QoS 1 da «exactamente una vez» por diseño | Pregunta del estudiante sobre «al menos una vez / exactamente una vez»; verificado en la especificación OASIS §4.3 | `docs/10 §4.1`, `cap-diseno`, glosario |
| 13 | **Legibilidad de las figuras generadas.** Revisadas las once figuras del PDF renderizadas página a página. Las de Mermaid se encogían hasta ser ilegibles en papel (la secuencia del pipeline, 2 636 pt de ancho nativo, cabía en 384 pt: letra de ~2 pt). Medidas: mensajes largos partidos con saltos de línea en la fuente única, configuración de secuencia más compacta (`tema.json`: sin actores duplicados abajo, márgenes menores), los tres diagramas de secuencia apaisados en el anexo (`rotating`), el del pipeline trasladado del cuerpo al anexo (en el cuerpo queda la Figura 3.1, legible), el ER a 0,74 del alto con permiso de página de flotantes contigua, red y despliegue más grandes | El estudiante pidió revisar «algún diagrama que se vea mal»; medir el factor de escala mostró que ninguna corrección de estilo bastaba sin cambiar la forma de los diagramas | `docs/10` (mensajes), `tema.json`, `figuras/*.tex`, `main.tex`, `cap-diseno`, anexo F |

## 3. Totales que cambian (recalculados sumando las filas)

| Conjunto | Antes | Ahora |
|---|---|---|
| Elementos del backlog | 63 | 64 |
| Horas totales | 275 | 279 |
| Alcance condicional | 30 elementos, 110 h | 31 elementos, 114 h |
| Núcleo demostrativo | 33 elementos, 165 h | sin cambio |
| Exceso del backlog completo sobre el presupuesto | 37 % | 39 % |

## 4. Pendiente

- [x] Dockerfile del backend — ver `bitacora/2026-09-23-dockerfile-backend.md`.
- [ ] Decidir WebSocket o SSE antes de implementar TT-39. Se ve en la Etapa 3, no antes.
- [x] Plan B para el riesgo R1 — ver `bitacora/2026-09-23-plan-b-r1-y-redistribucion.md`.
- [ ] Entrevistas: a la espera de los contactos solicitados el 22/09.
