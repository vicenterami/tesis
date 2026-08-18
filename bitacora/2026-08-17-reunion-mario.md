# Reunión con el profesor guía — lunes 17 de agosto de 2026

- **Profesor guía:** Mario
- **Modalidad:** presencial, sin portátil (notas tomadas en el teléfono)
- **Contexto:** primera reunión del semestre. Reemplaza la revisión del miércoles 19 de agosto.

---

## 1. Indicaciones recibidas (transcripción de las notas)

### Sobre la redacción de objetivos
- Los objetivos deben ser **SMART**.
- En la redacción debe quedar explícito: **qué se va a hacer**, **cómo se hará** y **qué resultado** se obtendrá.
- Deben ser **medibles**.

### Sobre la metodología
- Usar **PPDIOO**, no Scrum, porque el proyecto es **unipersonal**.
- PPDIOO es de **Cisco** y está orientada a **redes**.

### Sobre el alcance tecnológico
- **No cerrarse solo a LoRa/LoRaWAN.** Tampoco solo a WiFi, ni solo a MQTT.
- El problema real: **hay gente que ya tiene sensores y no tiene cómo procesar los datos.**

### Sobre el protocolo de comunicación
- Debe definirse un **protocolo de comunicación sensor ↔ plataforma**.
- Se debe **generar un protocolo de comunicación** usando **Contact ID protocol**.
- Hay que **hacer la API** con esto.
- Tarea explícita: **averiguar cómo es el proceso, tenerlo definido, y justificar por qué se usa este protocolo y no otro.**

### Sobre el modelo de producto
- Orientada a **plataforma como servicio (tipo SaaS) pero gratuita o abierta**.
- **La universidad necesita este dashboard** para enviar los datos de sus sensores a esta API y poder manejarlos.
- Debe definirse **dónde estará alojada la plataforma** y **cuánto costará finalmente el producto**, aunque sea abierto.
- La plataforma sirve para **administrar y gestionar los datos**: la gente ya tiene sensores pero no sabe qué hacer con ellos. La solución es dar una plataforma para gestionar esos datos, y definir **de qué forma**.

### Sobre la competencia en La Araucanía
- **IoT3** — competencia.
- **ControlTec** — competencia.

---

## 2. Interpretación y decisiones derivadas

| Indicación | Decisión tomada | Justificación |
|---|---|---|
| «PPDIOO, no Scrum» | PPDIOO como **ciclo de vida de ingeniería**; se conserva el **backlog** como instrumento de planificación y medición | La pauta asigna **20 %** de la Etapa 1 al backlog con épicas, historias, criterios de aceptación y estimaciones, y mide el avance de las Etapas 2-4 como porcentaje de tareas del backlog. Lo que se descarta son las **ceremonias** de Scrum (daily, retrospectiva, roles), no sus artefactos de planificación. |
| «Contact ID» | Se adopta como **plano de eventos**, complementado con un **plano de telemetría** | Contact ID (SIA DC-05) transporta eventos discretos codificados, no valores analógicos: puede expresar «temperatura alta en zona 007» pero no «23,4 °C». Ver `docs/05-protocolo-contactid.md`. |
| «No cerrarse a LoRa» | Arquitectura **multiprotocolo** con adaptadores de ingesta por transporte (LoRaWAN, MQTT, HTTP) | El aporte pasa de un protocolo a la **capa de normalización** entre transportes heterogéneos. |
| «La universidad necesita el dashboard» | La universidad se declara **propietaria del proyecto / parte interesada principal** | La rúbrica exige explícitamente «percepción de las partes interesadas» (Etapa 1, criterio 1) y «solicitudes del propietario del proyecto» (criterio 3). |

---

## 3. Pendientes de la reunión

- [ ] **Confirmar las fechas de las cuatro etapas.** El PDF de la pauta está fechado el 13/08/2025 y sus hitos son de 2025. Verificar si se replican al calendario 2026.
- [ ] **Identificar el interlocutor concreto en la universidad**: qué departamento, laboratorio o carrera tiene sensores desplegados, cuántos y de qué tipo.
- [ ] **Confirmar el entregable final exigido por la carrera**: prototipo funcional, documento, o ambos.
- [ ] **Definir el horario de la revisión de los miércoles** (compatible con jornada laboral horario laboral).
- [ ] Preguntar si Mario tiene preferencia sobre el alojamiento de la plataforma o si es decisión del estudiante.

## 4. Compromiso para la próxima revisión (miércoles 26 de agosto)

Presentar el borrador completo de la Etapa 1: definición del problema con validación de partes interesadas, objetivos SMART con matriz de trazabilidad, análisis de requerimientos con evaluación de alternativas de protocolo, y backlog priorizado.
