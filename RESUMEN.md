# Resumen del proyecto

> El documento de cinco minutos. Actualizado: **27 de septiembre de 2026**.

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
| Frontera con el compañero de la red LoRaWAN | **el tópico MQTT** + emulador de respaldo | — |
| ~~Contact ID~~ | **descartado 02/09** por el profesor guía (eventos vs. monitoreo continuo) | evidencia en `historico/docs/05` y anexo D del informe |

## Competencia

Mapa del informe §1.2 (30/09/2026), solo con hechos citados de fuentes oficiales: **de código abierto,
autoalojables** — OpenRemote (AGPL 3.0, la más completa), Magistrala (núcleo Apache 2.0; paneles y alarmas
de pago), ThingsBoard (código abierto hasta la v4.3; desde la v4.4, Business Source License) · **atadas al
fabricante o al servicio** — Milesight IoT Cloud (solo equipos Milesight), Energetika (Chile) · **nube
comercial** — Ubidots, TagoIO. Apuesta de este trabajo: fácil de operar para personal no técnico y datos
listos para investigación, exportables en formato abierto.

## Estado (entrega Etapa 2: viernes 2 de octubre)

Informe de 30 páginas con el capítulo de diseño y seis anexos; núcleo construido y ensayado de punta a
punta (recepción MQTT, seis filtros, supervisión, alertas, API). Pendiente que no depende del código:
**entrevistas** (observación 1 del profesor guía, 21/09). Guías: `docs/03` (guion), `docs/15` (demostración).

## Dónde está cada cosa

`PLAN-MAESTRO.md` método y calendario · `docs/01` problema y objetivos · `docs/02` requerimientos ·
`docs/04` backlog · `docs/06` evaluación de comunicación · `informe-oficial/glosario.tex` glosario ·
`bitacora/` reuniones · `informe-oficial/` **el entregable**.
