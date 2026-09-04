# Resumen del proyecto

> El documento de cinco minutos. Actualizado: **2 de septiembre de 2026** (pivote incorporado).

## La tesis en una frase

> Una **plataforma web para el registro, monitoreo y gestión de datos de sensores** (caso de validación: Campus Dr. Luis Rivas del Canto de la UCT): recibe
> las tramas de distintos sensores por TCP/IP (MQTT como vía principal, HTTP secundaria), las
> **normaliza a un modelo interno único** mediante un pipeline de filtros, almacena las mediciones
> como series de tiempo, **supervisa qué dispositivo dejó de reportar**, y lo presenta en un panel.

## El problema

No faltan sensores: falta dónde recibirlos, entenderlos y vigilarlos. Cinco causas (C1 fragmentación
de formatos · C2 acoplamiento al hardware del proveedor · C3 costo y dependencia de SaaS · C4 falta
de capacidad técnica · C5 sin visibilidad de la conectividad). *El silencio de un sensor es
indistinguible de la ausencia de novedades.*

## El aporte (lo que no es «solo un dashboard»)

1. **La capa de recepción y normalización**: contrato nativo **SenML (RFC 8428) sobre MQTT**,
   adaptadores por formato para lo demás, cuarentena para lo malformado, rechazo con registro para
   desconocidos.
2. **La supervisión de salud como función central**: keep-alive + Last Will de MQTT + vigilancia de
   intervalos → quién calló y desde cuándo.
3. **El método**: cada decisión con matriz de criterios ponderados y verificación.

## Decisiones vigentes

| Decisión | Selección | Rival más cercano |
|---|---|---|
| Transporte | **MQTT** (4,85) + HTTP secundaria | HTTP/REST (3,45) |
| Formato | **SenML** RFC 8428 | JSON libre (= el problema) |
| Broker | Mosquitto | EMQX (sobredimensionado) |
| Persistencia | TimescaleDB | InfluxDB (dos motores) |
| Backend | TypeScript + NestJS | Fastify (0,15 menos) |
| Frontera con Eduardo | **el tópico MQTT** + emulador de respaldo | — |
| ~~Contact ID~~ | **descartado 02/09** por el profesor guía (eventos vs. monitoreo continuo) | evidencia en `docs/05` y anexo |

## Competencia

IoT3 y ControlTec (región, solución cerrada) · **ThingsBoard** (open source genérico: pesado, en
inglés, exige ingeniero — se cita y se descarta como base con razones) · Ubidots/ThingSpeak (SaaS,
datos fuera) · Instacrops/WiseConn (verticales agrícolas con su hardware) · Node-RED+InfluxDB+Grafana
(kit DIY, no producto).

## Estado (entrega Etapa 1: viernes 4 de septiembre)

Informe oficial en plantilla del curso, reescrito al pivote. Pendiente que no depende de nadie más:
**entrevistas** (criterio 1). Guías: `docs/03` (preguntas), `docs/06` (evaluación técnica).

## Dónde está cada cosa

`PLAN-MAESTRO.md` método y calendario · `docs/01` problema y objetivos · `docs/02` requerimientos ·
`docs/04` backlog · `docs/06` evaluación de comunicación · `docs/GLOSARIO.md` conceptos ·
`bitacora/` reuniones · `informe-oficial/` **el entregable**.
