# Trabajo de Título — INFO-1197

Plataforma web para el registro, monitoreo y gestión de datos de sensores: recepción de tramas por
TCP/IP (MQTT y HTTP), normalización a un modelo interno único, series de tiempo, supervisión del
estado de cada dispositivo y panel de control. Caso de validación: Campus Dr. Luis Rivas del Canto (UCT).

**Universidad Católica de Temuco** · Profesor guía: Mario · Semestre en curso: agosto – noviembre de 2026

---

## Estado

| Etapa | Entrega | Estado |
|---|---|---|
| 1 — Problema, objetivos y requerimientos | viernes 4 de septiembre de 2026 | ✅ entregada |
| 2 — Diseño e implementación inicial | viernes 2 de octubre de 2026 | 🟡 en curso — ver [`docs/12`](docs/12-estado-etapa2.md) |
| 3 — Mejoras, pruebas y validación preliminar | viernes 30 de octubre de 2026 | ⬜ |
| 4 — Validación final e informe | viernes 4 de diciembre de 2026 | ⬜ |

**Próximo hito:** revisión con el profesor guía el **miércoles 26 de agosto de 2026**.

## Por dónde empezar

| Si buscas… | Ve a |
|---|---|
| **Qué es el proyecto y por qué estas decisiones** | **[`RESUMEN.md`](RESUMEN.md)** ← empieza aquí |
| Cómo se trabaja, calendario y prioridades | [`PLAN-MAESTRO.md`](PLAN-MAESTRO.md) |
| Contexto técnico y de negocio acumulado | [`docs/00-contexto.md`](docs/00-contexto.md) |
| Problema, objetivos SMART y trazabilidad | [`docs/01-problema-y-objetivos.md`](docs/01-problema-y-objetivos.md) |
| Catálogo de requerimientos y alternativas | [`docs/02-requerimientos.md`](docs/02-requerimientos.md) |
| Backlog con estimaciones y viabilidad | [`docs/04-backlog.md`](docs/04-backlog.md) |
| Evaluación de comunicación y formato de trama | [`docs/06-evaluacion-comunicacion.md`](docs/06-evaluacion-comunicacion.md) |
| Stack de implementación verificado (Etapa 2) | [`docs/07-stack-implementacion.md`](docs/07-stack-implementacion.md) |
| Modelo de datos (Etapa 2) | [`docs/08-modelo-datos.md`](docs/08-modelo-datos.md) |
| Protocolo de validación y banco de comparación | [`docs/09-protocolo-validacion.md`](docs/09-protocolo-validacion.md) |
| Arquitectura: C4, secuencias y despliegue (Etapa 2) | [`docs/10-arquitectura.md`](docs/10-arquitectura.md) |
| Seguridad en capas: amenazas y controles verificados | [`docs/11-seguridad.md`](docs/11-seguridad.md) |
| Estado de la Etapa 2: avance, backlog, prioridades | [`docs/12-estado-etapa2.md`](docs/12-estado-etapa2.md) |
| Reglas de tiempo y zonas horarias (UTC, IANA por sitio) | [`docs/13-tiempo-y-zonas-horarias.md`](docs/13-tiempo-y-zonas-horarias.md) |
| Fundamentos y glosario para explicar el proyecto | [`docs/GLOSARIO.md`](docs/GLOSARIO.md) |
| Preguntas al profesor guía y guion de entrevistas | [`docs/03-instrumentos-levantamiento.md`](docs/03-instrumentos-levantamiento.md) |
| Enfoque previo (Contact ID), conservado como evidencia | [`historico/`](historico/README.md) |
| Qué dijo el profesor y qué se cambió por eso | [`bitacora/`](bitacora/) |
| La pauta de evaluación oficial | [`referencias/`](referencias/) |

## Estructura

```
docs/            documentos de trabajo por etapa (Markdown)
bitacora/        reuniones con el profesor guía y retroalimentación incorporada
referencias/     índice propio de los materiales del curso
informe-oficial/ EL ENTREGABLE: plantilla oficial del curso, cuerpo ≤30 páginas + anexos
historico/       enfoque previo a la redefinición (Contact ID, informe v1)
plataforma/      código del prototipo y herramientas de verificación
privado/         (local, no versionada) notas sensibles
recursos-uct/    (local, no versionada) materiales originales del curso
```

## Regla de trabajo fundamental

> **Este repositorio es la única fuente de verdad.** Los borradores y las notas sueltas son material
> de apoyo desechable: lo que no está versionado aquí, no existe. Ver la sección 4 de `PLAN-MAESTRO.md`.
