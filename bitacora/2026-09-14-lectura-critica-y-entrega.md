# Lectura crítica del borrador y política de entrega — 14 de septiembre de 2026

- **Sesión de trabajo individual;** primera lectura crítica completa del borrador de la Etapa 2 (capítulos 1 a 4.1).
- El profesor guía y el compañero aún no responden; el trabajo avanza sobre lo que no depende de ellos.

## 1. Hallazgos de la lectura

| # | Observación propia | Qué se hizo |
|---|---|---|
| 1 | El capítulo 4 abría explicando cómo se generan las figuras; es método, no diseño | Reducido a una frase; el método vive en el repositorio |
| 2 | En la vista de contenedores no se veía dónde quedan M3, M7 y M8 | Párrafo que reparte los ocho módulos y dice por qué tres no son cajas |
| 3 | No estaba dicho qué pasa si una trama llega dos veces, ni qué garantiza el QoS 1 cuando el backend cae | Ver decisión 1 y 2 |
| 4 | No se declaraba el grado de normalización del modelo | Tercera forma normal explícita; redundancias solo como «foto por valor» |
| 5 | Dudas de fondo para la defensa (por qué NestJS, por qué TimescaleDB, orden de los filtros, colas, sesiones, TLS, límites de tasa) | Respondidas en una guía de estudio local; lo que es diseño de la Etapa 3 y 4 quedó anotado como tal |

## 2. Decisiones tomadas

| # | Decisión | Por qué | Dónde queda |
|---|---|---|---|
| 1 | **Sesión MQTT persistente** en el backend (`clientId` fijo, `clean: false`) | Con sesión limpia, «al menos una vez» solo valía mientras la conexión viviera: si el backend caía, el broker descartaba la cola. Ahora la conserva y la entrega al reconectar | `broker.service.ts`, `docs/10 §4.1` |
| 2 | **Inserción idempotente** en `medicion`: índice único `(canal_id, tiempo)` + `ON CONFLICT DO NOTHING`; la repetida no reevalúa umbrales | La contraparte de «al menos una vez» son las reentregas; la clave natural de la serie las neutraliza (RF-10). Probado: el segundo INSERT devuelve 0 filas y conserva el valor original | migración 06, `recepcion.service.ts` |
| 3 | Caída de la base con mensaje ya confirmado al broker: **limitación conocida**, se resuelve en la Etapa 3 confirmando después del INSERT | Hoy base y backend comparten servidor; el caso importa cuando se separen | `docs/10 §4.1` |
| 4 | Dos sensores cercanos que miden lo mismo **no son duplicados**: dos canales, dos series | Correlacionar es análisis, no recepción | `docs/10 §4.1` |
| 5 | Redis, balanceador, API gateway: **fuera de alcance** por RNF-17 y por la escala (50 canales cada 5 min ≈ 0,2 mensajes/s); la cola es el propio broker | Agregar piezas que la carga no justifica contradice el objetivo de ligereza; se documenta cuándo sí harían falta | guía local; `docs/14 §6` para la escala |

## 3. Verificaciones

- `pnpm verificar`: tipos, lint y 19 pruebas en verde. `verificar-todo.sh`: migraciones 02 a 06 aplicadas, diagramas y esquema en concordancia.
- Informe: 0 referencias rotas, cuerpo en 30 páginas.
