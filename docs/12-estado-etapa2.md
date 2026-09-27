# Estado de la Etapa 2 — corte al 23 de septiembre de 2026

> Entrega: viernes 2 de octubre de 2026 (quedan 9 días), según la pauta oficial del 17 de agosto. Fase PPDIOO: *Design* (con implementación
> inicial adelantada). Este documento se actualiza en cada corte; la bitácora guarda el detalle diario.

## 1. Qué evalúa la Etapa 2 y cómo vamos

| Criterio de la rúbrica | Peso | Estado | Qué falta para el puntaje completo |
|---|---|---|---|
| Diseña según estándares de calidad | **55 %** | 🟢 avanzado | Diagramas en notación reconocida (C4, UML, ER) generados desde una fuente única e **integrados en el capítulo 4 «Diseño de la plataforma»** del informe (borrador completo, 30 págs. de cuerpo); falta pulir redacción e incorporar la retroalimentación |
| Incorpora la retroalimentación | 20 % | 🟢 en curso | Recibida el 21/09 (Etapa 1: 6,0). Seis observaciones → seis cambios en el informe (cap. 5 §5.4, cuadro) y en docs/01, 02, 04; bitácora del 21/09. Contactos para entrevistas solicitados el 22/09; falta realizarlas, que es la observación 1 |
| Avanza en el diseño según backlog | 10 % | 🟢 avanzado | Ver §3: 18/22 ítems de la Etapa 2 hechos, 4 parciales (TT-12, TT-15, HU-01, TT-35); TT-26 ya está hecho |
| Documenta en repositorio | 15 % | 🟢 cumplido | Commits descriptivos, docs/07–12, bitácora, READMEs. Mantener el ritmo |

**Prioridad para la nota, en orden:** (1) informe de la Etapa 2 con los diagramas y el diseño
redactado — es el 55 %; (2) recomendación de despliegue y costos (OE3) — cierra el 10 %; (3) seguir
implementando solo lo que **sustente el diseño** (API de consulta, que demuestra `time_bucket`);
(4) el panel puede esperar a la Etapa 3.

## 2. Lo construido y probado (evidencia en `bitacora/2026-09-08`)

| Pieza | Estado | Prueba |
|---|---|---|
| Docker Compose: TimescaleDB + Mosquitto, límites, healthchecks, override de desarrollo | ✅ | ambos `healthy` |
| Esquema de 13 tablas + hypertable + migración 02 | ✅ | `\dt` = 13 |
| Broker: sin anónimos, hash, ACL por dispositivo | ✅ | anónimo/clave mala rechazados; suplantación bloqueada |
| Backend NestJS: conexión a base y broker, `GET /salud` | ✅ | `{"estado":"ok","tablas":13}` |
| Pipeline **completo** (6 filtros) + cuarentena | ✅ | 7 casos de formato/rango/unidad; umbral con histéresis; silencio detectado y cerrado |
| Adaptadores: SenML (nativo) y plano | ✅ | 2 lecturas de un pack SenML; Kelvin → Celsius |
| Rotación de credenciales probada | ✅ | claves viejas rechazadas, nuevas aceptadas |
| Backend en contenedor (Dockerfile multi-stage, usuario sin privilegios, healthcheck a `/salud`) | ✅ 23/09 | `healthy` con la pila completa; probado apagando la base y el broker por separado: cero reinicios, se recupera solo |
| Dependencias sin vulnerabilidades conocidas (`pnpm audit` en el CI) | ✅ 23/09 | de 22 avisos (10 altos) a 0; NestJS 11.2.5, tres *overrides* documentados |
| Guardianes de concordancia 2d (variables de entorno), 2e (orden de los filtros), 2f (sin menciones a herramientas en archivos versionados) | ✅ 23/09 | cada uno probado plantando la violación |

## 3. Seguimiento del backlog (corte 23 de septiembre)

**Etapa 2 planificada: 22 ítems, 84 h.** Hechos: 18 (64 h) · parciales: 4 · pendientes: 0.

| Ítem | Tarea | Pr. | h | Estado | Evidencia |
|---|---|---|---|---|---|
| TT-01 | Componer el entorno con contenedores: TimescaleDB, Mosquitto y ChirpStack orquestados, con un único comando de arranque | M | 6 | ✅ | docker-compose con TimescaleDB y Mosquitto; ChirpStack diseñado, pendiente de gateway |
| TT-02 | Inicializar el proyecto TypeScript + NestJS con estructura de módulos correspondiente a M1–M8 | M | 4 | ✅ | backend NestJS con módulos M1, M2, M4, M5, M6 |
| TT-03 | Configurar verificación automática: tipos, formato y ejecución de pruebas | S | 3 | ✅ | `pnpm verificar`: tsc + ESLint (typescript-eslint, reglas con tipos) + 49 pruebas jest (funciones puras, contrato del pipeline, barrido de supervisión, interfaz de escucha); `pnpm audit` en el CI; guardianes de concordancia en `verificar-todo.sh` |
| TT-04 | Documentar el procedimiento de puesta en marcha en el repositorio | M | 1 | ✅ | READMEs de plataforma y backend |
| TT-05 | Diagrama de arquitectura de componentes, con los ocho módulos y sus dependencias | M | 5 | ✅ | vista de contenedores C4 (cap. 4) |
| TT-06 | Diagrama de topología de red con segmentación de dispositivos IoT (RNF-09) y sentido de las conexiones (RNF-10) | M | 6 | ✅ | topología de red (anexo de figuras complementarias) |
| TT-07 | Modelo de datos entidad-relación con al menos ocho entidades | M | 6 | ✅ | ER de 13 entidades generado desde la base (cap. 4) |
| TT-08 | Diagrama de flujo de recepción, desde la recepción hasta la persistencia, para los tres transportes | M | 4 | ✅ | pipeline (fig. 3.1, cap. 3) y secuencia UML apaisada (anexo de figuras); orden real 5 alertar / 6 supervisar desde el 23/09 |
| TT-09 | Diagrama de secuencia del aprovisionamiento de un dispositivo nuevo | M | 3 | ✅ | secuencia de aprovisionamiento (anexo de figuras complementarias) |
| TT-10 | Registro de decisiones de diseño con su justificación | M | 2 | ✅ | tablas de decisiones en el cap. 4 y bitácora |
| TT-11 | Esquema del modelo interno y contrato del tópico MQTT (nombres, unidades, identidad) | M | 3 | ✅ | docs/08, docs/10 §1; tópico sitio/·/dispositivo/·/magnitud |
| TT-12 | Catálogo de tipos de sensor y unidades aceptadas, con umbrales de disparo y restauración | M | 6 | 🟡 | 5 magnitudes con rango; ampliar con los sensores reales |
| TT-13 | Especificación del contrato de la API en OpenAPI, generada desde el código | M | 3 | ✅ | `@nestjs/swagger`: `/docs` y `backend/openapi.json` (6 rutas), generado desde los decoradores |
| TT-14 | Política de QoS, reintento y cuarentena | M | 2 | ✅ | QoS 1 con sesión persistente (cola en el broker si el backend cae); INSERT idempotente sobre `(canal, tiempo)` (migración 06); cuarentena con motivo; `docs/10 §4.1` |
| TT-15 | Procedimiento de asignación de identidad y gestión de claves AES por sitio | S | 2 | 🟡 | gestión de credenciales documentada (docs/11 §7); claves LoRaWAN dependen de ChirpStack |
| HU-01 | Como integrador, quiero publicar una trama SenML por MQTT o HTTP, para reportar desde un sensor sin infraestructura intermedia | M | 6 | 🟡 | MQTT sí; HTTP en la Etapa 3 |
| TT-16 | Validador de esquema SenML y analizador de tramas | M | 3 | ✅ | adaptador SenML |
| TT-19 | Esquema de base de datos y migraciones versionadas | M | 5 | ✅ | esquema + 7 migraciones (05 convenciones de calidad, 06 clave natural única de la serie, 07 dominio cerrado de cuarentena.motivo) |
| TT-24 | Comparar al menos tres alternativas de alojamiento con criterios ponderados | M | 4 | ✅ | `docs/14 §3–§4`: cinco alternativas, seis criterios |
| TT-25 | Cuantificar el costo mensual y anual de operación en CLP y USD | M | 3 | ✅ | `docs/14 §3`: precios fechados y convertidos con dólar observado |
| TT-26 | Redactar la recomendación de despliegue justificada | M | 1 | ✅ | `docs/14 §5` y cap. 4 del informe |
| TT-35 | Documento de diseño de la Etapa 2, con todos los diagramas | M | 6 | 🟡 | borrador completo del informe (30 págs.); falta pulir e incorporar retroalimentación |

**Adelantados desde las Etapas 3 y 4:**

| Ítem | Tarea | Plan. | Estado | Evidencia |
|---|---|---|---|---|
| HU-03 | Como integrador, quiero publicar eventos en MQTT, para integrar dispositivos que ya usan ese transporte | E3 | ✅ | publicado y probado con mosquitto_pub |
| HU-04 | Como integrador, quiero un adaptador para un formato no SenML, para demostrar la extensibilidad de la capa de recepción | E4 | 🟡 | adaptador plano; se cierra con la trama real |
| TT-17 | Pipeline de normalización al modelo interno (los 6 filtros) con cuarentena | E3 | ✅ | seis filtros verificados |
| HU-06 | Como administrador de sitio, quiero configurar umbrales por dispositivo, para que se genere un evento cuando una medición los cruce | E3 | 🟡 | motor listo; falta interfaz |
| TT-18 | Normalización de marcas temporales, tolerando nodos sin reloj confiable | E3 | ✅ | tiempoPlausible |
| TT-20 | Autenticación de la recepción mediante credencial por sitio | E4 | ✅ | credencial por dispositivo + ACL |

**Pendiente para cerrar la etapa:** completar los parciales — TT-35 (pulir informe e incorporar retroalimentación), TT-12 (catálogo con los sensores reales), TT-15 (claves LoRaWAN, depende de ChirpStack) y HU-01 (entrada HTTP, Etapa 3).

## 4. ¿Vamos pesados? — medición real

| Componente | Memoria en reposo | Techo |
|---|---|---|
| TimescaleDB | ~26 MB | 768 MB |
| Mosquitto | ~2,4 MB | 256 MB |
| Backend (contenedor, en reposo, 23/09) | ~56 MB | 512 MB |
| **Total plataforma** | **~85 MB** | ≤ 2 GB (RNF-17) |

Contra el referente: ThingsBoard exige ≥ 4 GB solo para arrancar. Dependencias del backend (23/09):
9 de ejecución (Nest, `pg`, `mqtt`, config, swagger, rxjs, reflect-metadata) + 14 de desarrollo que **no van a
producción**: la imagen final se construye con `--prod` y pesa 468 MB en disco, de los cuales 59 MB son
`node_modules` y el resto es la imagen base de Node. El `node_modules` de desarrollo (247 MB) es disco del
portátil, no memoria ni parte del despliegue. **No hay
sobrepeso**; la regla sigue siendo agregar dependencias solo con justificación escrita.

## 5. Coherencia con lo acordado

- Patrón B (navegador solo con el backend): respetado; aún no hay panel.
- Términos vetados: sin «heterogéneo» ni «ingesta» en documentos ni código.
- Seguridad en capas: `docs/11` con controles verificados; secretos fuera del repositorio.
- Flujo de commits: el estudiante ejecuta git; mensajes en imperativo, sin ruido.
- Un solo modelo interno; adaptadores por formato; cuarentena separada de las series.

## 6. Dónde están los diagramas

| Diagrama | Dónde (se renderiza en GitHub) | En el informe |
|---|---|---|
| Entidad-relación (13 entidades) | `docs/08-modelo-datos.md` §3 — **generado desde la base real** | ✅ `figuras/render/modelo-datos.pdf` |
| Contenedores C4, topología de red, 3 secuencias UML, despliegue | `docs/10-arquitectura.md` §1–§6 | ✅ `figuras/render/*.pdf`, generados por `generar-figuras.sh` desde la misma fuente; las secuencias van apaisadas en el anexo desde el 23/09 para que se lean |
| Pipeline de 6 filtros, árbol del problema (Etapa 1) | `informe-oficial/figuras/pipeline.tex`, `arbol.tex` | ✅ TikZ, **a mano**: son las dos únicas figuras sin fuente única; el orden de los filtros en `pipeline.tex` lo vigila el guardián 2e (el 23/09 se encontró desactualizada) |

**Método (09/09):** una sola fuente por diagrama (Mermaid en `docs/`; el ER sale del esquema de la base),
render automático a PDF con `mermaid-cli` en Docker, y un guardián (`generar-figuras.sh --verificar`) que
falla si informe, docs y base difieren. Sin dibujos a mano: sin solapes ni columnas olvidadas.

## 7. Lo que frena hoy

1. **Entrevistas con partes interesadas**: brecha declarada en la Etapa 1; contactos solicitados al
   profesor guía el 22/09 tras su retroalimentación (recibida e incorporada el 21/09); sin respuesta aún.
2. **Formato real del compañero**: respondió el 10/09 — sensores de temperatura y material particulado;
   primeras tramas en octubre (Etapa 3). El adaptador se cierra con la trama real. **Plan B (23/09)**: si al
   8 de octubre no hay hardware LoRaWAN confirmado, un nodo Wi-Fi propio cubre el sensor real que OE4
   promete para el 30 de octubre (`docs/04` §6.5, anexo E, riesgo R1).
3. **Decisiones de Etapa 3 que ya tienen tarea reservada**: WebSocket o SSE (TT-39), proxy TLS.
4. Tiempo: ~15 h semanales; el informe de la Etapa 2 necesita al menos 12 h de redacción y figuras.

## 8. Plan hasta el 2 de octubre

| Semana | Foco | Entregable |
|---|---|---|
| 9–14 sep | ~~API de consulta~~ ✅ · ~~capítulo de diseño~~ ✅ (borrador completo, 30 págs.) · **TT-24/25/26 alojamiento y costos** · TT-13 OpenAPI · escribir a profesor guía y compañero | `docs/14-despliegue-y-costos.md`; correos enviados |
| 15–21 sep | ~~Actualización del sistema, laboratorio de entrega (sesión persistente e idempotencia), lectura crítica hasta 4.1~~ ✅ · **retroalimentación recibida el 21/09 e incorporada** | informe v2 (30 págs.) |
| 22–28 sep | **Entrevistas** si llegan los contactos · ~~concordancia diseño↔código~~ ✅ 23/09 · ~~Dockerfile del backend~~ ✅ 23/09 (probado con caída de base y de broker) · terminar la lectura crítica (4.2 → anexos) · ensayar la demostración · autoevaluación del núcleo | registro de la primera entrevista |
| 29 sep–2 oct | Incorporar la entrevista si ocurrió (fuente [ENT]); revisión final; compilación; **entrega oficial el viernes 2 de octubre** | PDF Etapa 2 |
