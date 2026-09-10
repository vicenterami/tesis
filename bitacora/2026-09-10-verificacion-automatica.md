# Verificación automática y una regla que no se podía probar — 10 de septiembre de 2026

- **Sesión de trabajo individual;** registro de decisiones, no de la jornada.

## 1. Decisiones tomadas

| # | Decisión | Por qué | Dónde queda |
|---|---|---|---|
| 1 | Verificación del backend en tres capas con un solo comando (`pnpm verificar`): tipos estrictos, ESLint con reglas que usan la información de tipos, pruebas unitarias | Cada capa atrapa una clase distinta de error; corre en segundos y sin base ni broker, así que se ejecuta antes de cada commit | `backend/eslint.config.mjs`, `*.spec.ts`, README del backend |
| 2 | Las pruebas unitarias cubren solo **funciones puras** del pipeline (tiempo, unidades, adaptadores); lo que depende de la pila lo cubre `verificar-todo.sh` | Una prueba que necesita base y broker es lenta y frágil; las reglas de negocio viven en funciones sin efectos y se prueban aisladas | `recepcion/tiempo.ts`, `unidades.ts`, `adaptadores/` |
| 3 | **Regla 7 de tiempo corregida:** un adelanto de hasta 2 min ahora conserva la marca del emisor; antes la tolerancia devolvía la hora de recepción, igual que el rechazo | Al cambiar la tolerancia a 20 min ninguna prueba falló: la regla, tal como estaba escrita en `docs/13` y en el código, no producía dos comportamientos distintos. Conservar la marca mantiene el espaciado real entre lecturas del nodo | `docs/13` regla 7, `tiempo.ts`, `tiempo.spec.ts` |
| 4 | Cada corrida del verificador se registra con fecha, hora y commit en una carpeta local ignorada por git | Constancia de qué se verificó y cuándo, sin ruido en el repositorio | `verificar-todo.sh` |
| 5 | El capítulo de diseño cita los estándares y notaciones que usa (ISO/IEC/IEEE 42010, C4, ER de Chen, UML 2.5.1, *pipes and filters*, SenML, OpenAPI 3.0, ISO 8601 y RFC 3339) | El criterio de mayor peso de la Etapa 2 es «diseña según estándares»: nombrarlos sin citarlos no basta | `cap-diseno.tex`, `referencias.bib` |

## 2. Lección

Una prueba que pasa no demuestra nada por sí sola: hay que **romper la regla a propósito** y ver que la
prueba falle. Así se descubrió la decisión 3. La rutina queda: escribir la prueba, alterar la constante,
verla fallar, restaurar.

## 3. Verificaciones

- `pnpm verificar`: tipos y lint limpios; 19 pruebas en verde; con la tolerancia alterada, 1 falla (la esperada).
- `verificar-todo.sh`: esquema, migraciones, diagramas y API en concordancia.
- Cierra TT-03. Etapa 2: 18 ítems hechos, 4 parciales, 0 pendientes.
