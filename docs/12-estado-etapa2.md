# Estado de la Etapa 2 — corte al 9 de septiembre de 2026

> Entrega: viernes 2 de octubre de 2026 (quedan 23 días). Fase PPDIOO: *Design* (con implementación
> inicial adelantada). Este documento se actualiza en cada corte; la bitácora guarda el detalle diario.

## 1. Qué evalúa la Etapa 2 y cómo vamos

| Criterio de la rúbrica | Peso | Estado | Qué falta para el puntaje completo |
|---|---|---|---|
| Diseña según estándares de calidad | **55 %** | 🟢 avanzado | Diagramas en notación reconocida (C4, UML, ER) generados desde una fuente única y ya renderizados para el informe (§6); **falta redactar el capítulo de diseño** que los integre |
| Incorpora la retroalimentación | 20 % | ⚪ bloqueado | Sin retroalimentación aún del profesor guía sobre la Etapa 1. Al llegar: registrar cada observación → cambio concreto (bitácora + informe) |
| Avanza en el diseño según backlog | 10 % | 🟢 avanzado | Ver §3: ítems de diseño de la Etapa 2 casi cerrados; queda TT-26 (recomendación de despliegue) |
| Documenta en repositorio | 15 % | 🟢 cumplido | Commits descriptivos, docs/07–12, bitácora, READMEs. Mantener el ritmo |

**Prioridad para la nota, en orden:** (1) informe de la Etapa 2 con los diagramas y el diseño
redactado — es el 55 %; (2) recomendación de despliegue y costos (OE4) — cierra el 10 %; (3) seguir
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

## 3. Seguimiento del backlog (ítems tocados)

| Ítem | Estado | Evidencia / nota |
|---|---|---|
| TT-11 contrato del tópico y modelo interno | ✅ hecho | `docs/08`, `docs/10 §1`, tópico `sitio/<s>/dispositivo/<id>/<magnitud>` |
| TT-12 catálogo de magnitudes con umbrales | 🟡 parcial | 5 magnitudes con rango; umbrales por regla en `regla_umbral`. Falta ampliar el catálogo con los sensores reales del compañero |
| TT-14 política de QoS, reintento y cuarentena | ✅ hecho | QoS 1 en el suscriptor; cuarentena con motivo; reconexión cada 2 s |
| TT-16 analizador SenML | ✅ hecho | `adaptadores/senml.adaptador.ts` |
| TT-17 pipeline de 6 filtros | ✅ hecho | `recepcion.service.ts` + `alertas` + `supervision` |
| TT-18 marcas temporales sin reloj confiable | ✅ hecho | tiempo del emisor si es plausible; futuro → hora de recepción |
| TT-19 esquema y migraciones | ✅ hecho | `db/init/01`, `02` |
| TT-20 autenticación de la recepción | ✅ hecho (mejor que lo planeado) | credencial **por dispositivo** + ACL, no solo por sitio |
| HU-03 publicar por MQTT | ✅ hecho | probado con `mosquitto_pub` |
| HU-01 publicar SenML por MQTT **o HTTP** | 🟡 parcial | MQTT sí; la entrada HTTP queda para la Etapa 3 |
| HU-04 adaptador para formato no SenML | 🟡 parcial | `plano` con nombres tolerantes; se fija con la primera trama real del compañero |
| HU-06 umbrales por dispositivo | 🟡 parcial | motor listo (filtro 6); falta la interfaz para configurarlos |
| TT-08 diagrama de flujo de recepción | ✅ hecho | `docs/10 §4` (secuencia UML) |
| TT-26 recomendación de despliegue justificada | ⬜ pendiente | **prioritario**: alimenta OE4 y el 10 % |
| TT-22 TLS | ⬜ Etapa 3 | diseñado (`docs/11`), no implementado |
| TT-27 pruebas automatizadas del contrato | ⬜ pendiente | hoy las pruebas son manuales reproducibles; automatizarlas en la Etapa 3 |

**Adelantado respecto del plan:** el backlog ubicaba TT-17, TT-18, TT-20 y HU-06 en la Etapa 3;
están hechos en la 2. Ese margen se invierte en el informe, no en más código.

## 4. ¿Vamos pesados? — medición real

| Componente | Memoria en reposo | Techo |
|---|---|---|
| TimescaleDB | ~26 MB | 768 MB |
| Mosquitto | ~2,4 MB | 256 MB |
| Backend (Node, modo desarrollo) | decenas de MB | 512 MB previsto |
| **Total plataforma** | **< 100 MB** | ≤ 2 GB (RNF-17) |

Contra el referente: ThingsBoard exige ≥ 4 GB solo para arrancar. Dependencias del backend:
8 de ejecución (mínimas: Nest, `pg`, `mqtt`, config) + 11 de desarrollo que **no van a producción**.
El `node_modules` (187 MB) es disco de desarrollo, no memoria ni parte del despliegue. **No hay
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
| Contenedores C4, topología de red, 3 secuencias UML, despliegue | `docs/10-arquitectura.md` §1–§6 | ✅ `figuras/render/*.pdf`, generados por `generar-figuras.sh` desde la misma fuente |
| Pipeline de 6 filtros, árbol del problema (Etapa 1) | `informe-oficial/figuras/pipeline.tex`, `arbol.tex` | ✅ TikZ |

**Método (09/09):** una sola fuente por diagrama (Mermaid en `docs/`; el ER sale del esquema de la base),
render automático a PDF con `mermaid-cli` en Docker, y un guardián (`generar-figuras.sh --verificar`) que
falla si informe, docs y base difieren. Sin dibujos a mano: sin solapes ni columnas olvidadas.

## 7. Lo que frena hoy

1. **Retroalimentación de la Etapa 1**: no ha llegado; condiciona el 20 %. Acción: preguntar al
   profesor guía en la próxima comunicación; mientras, avanzar con lo que no depende de ella.
2. **Formato real del compañero**: sin su primera trama no se fija el adaptador ni el catálogo de
   sensores. Acción: pedir nombres de campos, unidad y sensores del primer nodo.
3. **Entrevistas con partes interesadas**: brecha declarada en la Etapa 1, sigue abierta.
4. Tiempo: ~15 h semanales; el informe de la Etapa 2 necesita al menos 12 h de redacción y figuras.

## 8. Plan hasta el 2 de octubre

| Semana | Foco | Entregable |
|---|---|---|
| 9–14 sep | API de consulta (`time_bucket`), recomendación de despliegue y costos (TT-26) | endpoints probados ✅; `docs/14-despliegue-y-costos.md` |
| 15–21 sep | **Informe Etapa 2**: capítulo de diseño con las figuras generadas, incorporar retroalimentación si llegó | borrador completo |
| 22–28 sep | Aprovisionamiento por API (M3); pulir informe; **visita presencial a Temuco para mostrar avances** (a coordinar con el profesor guía) | demostración en vivo del pipeline |
| 29 sep–2 oct | Revisión final, compilación, entrega | PDF Etapa 2 |
