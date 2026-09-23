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

## 3. Totales que cambian (recalculados sumando las filas)

| Conjunto | Antes | Ahora |
|---|---|---|
| Elementos del backlog | 63 | 64 |
| Horas totales | 275 | 279 |
| Alcance condicional | 30 elementos, 110 h | 31 elementos, 114 h |
| Núcleo demostrativo | 33 elementos, 165 h | sin cambio |
| Exceso del backlog completo sobre el presupuesto | 37 % | 39 % |

## 4. Pendiente

- [ ] Dockerfile del backend y su servicio en el compose (`docs/10 §8.3`).
- [ ] Decidir WebSocket o SSE antes de implementar TT-39 (Etapa 3).
- [ ] Plan B para el riesgo R1 (hardware): nodo propio publicando SenML por Wi-Fi, con fecha límite de activación.
- [ ] Entrevistas: a la espera de los contactos solicitados el 22/09.
