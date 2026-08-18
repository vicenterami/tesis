# Plan maestro — Trabajo de Título INFO-1197

> Documento de gobierno del proyecto. Define **cómo** se trabaja, **cuándo** se entrega y **dónde**
> vive cada cosa. Se actualiza al cerrar cada etapa.
>
> Última actualización: **lunes 17 de agosto de 2026**

---

## 1. Tema y alcance

**Título de trabajo:** Plataforma abierta de gestión e interoperabilidad de datos para redes de
sensores IoT heterogéneas.

**Enunciado en una frase:**

> Una plataforma abierta (sin costo de licencia) que permite a organizaciones que **ya poseen
> sensores** heterogéneos —LoRa/LoRaWAN, WiFi, MQTT— **ingerir, normalizar, gestionar y explotar**
> sus datos a través de un **protocolo de comunicación unificado basado en Contact ID (SIA DC-05)**,
> diseñado bajo la metodología **PPDIOO**.

**El problema no es la falta de sensores, es la falta de destino para sus datos.** Quien ya invirtió
en sensores se encuentra con que cada uno habla distinto y no tiene una plataforma neutral donde
recibirlos, normalizarlos y gestionarlos.

**Parte interesada principal / propietario del proyecto:** la universidad, que necesita enviar los
datos de sus sensores a una API y administrarlos.

---

## 2. Metodología: PPDIOO + backlog

### La decisión y su justificación

Se adopta **PPDIOO** (Cisco) como **ciclo de vida de ingeniería**, por tres razones: es el marco
propio del dominio de redes, corresponde al perfil del profesor guía, y sus fases coinciden
naturalmente con las cuatro etapas de evaluación de la pauta.

Se **descarta Scrum como marco de gestión de equipo** —el proyecto es unipersonal, por lo que las
ceremonias (daily standup, retrospectiva grupal, roles de Product Owner y Scrum Master) no tienen
sentido— pero **se conservan sus artefactos de planificación**: el **backlog** con épicas, historias
de usuario, tareas, criterios de aceptación y estimaciones.

> **Por qué se conserva el backlog:** no es una concesión, es un requisito evaluado. La pauta asigna
> el **20 % de la Etapa 1** al backlog («historias de usuario, épicas y tareas, priorizadas […]
> incluyendo criterios de aceptación y estimaciones iniciales de esfuerzo») y mide el avance de las
> Etapas 2, 3 y 4 como **porcentaje de tareas del backlog completadas**. Sin backlog no existe
> instrumento de medición del avance.

**Formulación defendible:** *PPDIOO define qué fases hay y en qué orden, con el rigor propio de la
ingeniería de redes; el backlog define cómo se prioriza y cómo se mide el avance. Son
complementarios, no alternativos.*

### Mapeo de fases a etapas de evaluación

| Etapa | Fase PPDIOO | Actividad principal | Entregable |
|---|---|---|---|
| **1** | **Prepare + Plan** | Levantamiento del problema, requerimientos y planificación | Documento de definición + backlog |
| **2** | **Design** | Arquitectura, modelo de datos, especificación del protocolo | Diagramas y especificación técnica |
| **3** | **Implement** | Construcción del prototipo y pruebas iniciales | Prototipo funcional + informe de pruebas |
| **4** | **Operate + Optimize** | Validación en condiciones realistas y optimización | Informe final + validación |

---

## 3. Calendario

### Reglas de cadencia

- **Miércoles = revisión con Mario.** Se presenta avance, se recibe retroalimentación, se registra en
  `bitacora/` el mismo día.
- **Viernes de cierre de etapa = entrega formal.**
- El miércoles **19 de agosto de 2026 no cuenta**: la reunión de esa semana se realizó el lunes 17.

### Hitos

> ⚠️ **Pendiente de confirmar con Mario.** El PDF de la pauta está fechado el 13/08/2025 y sus hitos
> son de 2025. Las fechas siguientes son las equivalentes en el calendario 2026 (todas viernes, como
> exige la pauta). **Confirmarlas es la primera gestión de la semana.**

| Etapa | Revisiones (miércoles) | Entrega (viernes) |
|---|---|---|
| **1** — Problema, objetivos, requerimientos | **26 de agosto** | **28 de agosto** |
| **2** — Diseño e implementación inicial | 2, 9, 16, 23 de septiembre | **25 de septiembre** |
| **3** — Mejoras, pruebas, validación preliminar | 30 sep · 7, 14, 21 de octubre | **23 de octubre** |
| **4** — Validación final e informe | 28 oct · 4, 11, 18 de noviembre | **20 de noviembre** |

### Umbral de aprobación

Se aprueba con **70 % de logro**, no con 50 %. La nota P solo procede si el avance supera el 70 % de
los hitos establecidos. **Consecuencia de diseño:** el alcance de cada etapa se dimensiona para
superar cómodamente ese umbral, no para maximizar ambición.

### Presupuesto de tiempo real

Jornada laboral en la empresa de horario de oficina, lunes a viernes. El tiempo de tesis es:

| Franja | Horas | Uso previsto |
|---|---|---|
| Tardes hábiles (L-V) | ~2,5 h × 5 = **12,5 h** | Validación, decisiones, redacción corta, commits |
| Sábado y domingo | ~4 h × 2 = **8 h** | Bloques de trabajo profundo: construcción, pruebas |
| **Total semanal realista** | **14-16 h** | |

De aquí al 20 de noviembre: ~13,5 semanas ≈ **200 horas**. Es un presupuesto suficiente **si no se
desperdicia en rehacer trabajo perdido entre dispositivos** — de ahí la sección 4.

---

## 4. Flujo de trabajo: una sola fuente de verdad

### El principio

> **La fuente de verdad es este repositorio git.** Todo lo demás —artifacts, chats, Overleaf, notas
> del teléfono— es vista, borrador o respaldo. Nada importante vive fuera del repo.

Razón concreta y verificada: las **conversaciones de claude.ai no son legibles** por el asistente
(devuelven HTTP 403). Los **artifacts publicados sí** lo son. Y los artifacts se alojan en la cuenta
de Claude **de la empresa** (`[correo retirado]`), por lo que **no pueden ser almacenamiento de la
tesis**: son vista regenerable, y se perderían al dejar la empresa.

### Qué se puede hacer desde dónde

| Dispositivo / entorno | Qué hacer ahí | Cómo |
|---|---|---|
| **Portátil ASUS (Ubuntu)** — principal | **Todo**: redactar, compilar LaTeX, programar, commitear | Claude Code local sobre `~/tesis` |
| **Otro portátil** | **Todo**, si tiene el entorno | `git clone git@github.com:vicenterami/tesis.git` |
| **Teléfono — app o web de GitHub** | **Leer** documentos, **anotar** en `bitacora/INBOX.md`, revisar el backlog | GitHub permite editar archivos `.md` desde el navegador y commitear |
| **Teléfono — app de Claude** | Consultas puntuales, dictar ideas | ⚠️ **lo que se converse ahí no es recuperable después.** Todo lo valioso debe copiarse a un archivo del repo el mismo día |
| **Navegador — claude.ai/code** | Trabajar sobre el repo con contexto completo | Requiere conectar GitHub a la cuenta de Claude. ⚠️ es cuenta corporativa: decisión a evaluar |

**Regla de oro:** **producir solo donde hay git; en el teléfono, capturar.** El teléfono sirve para no
perder una idea, nunca para tomar una decisión que después no quede registrada.

**Mecanismo de captura:** el archivo `bitacora/INBOX.md` es la bandeja de entrada. Se le agregan
líneas sueltas desde cualquier parte, y se vacía procesándolas hacia su documento definitivo.

### Flujo LaTeX

Los entregables formales se redactan en LaTeX. Para que Overleaf no se convierta en un punto ciego:

```
informe/
├── main.tex              ← documento maestro
├── secciones/*.tex       ← una sección por archivo
├── bibliografia.bib      ← referencias
├── img/                  ← figuras y diagramas
└── build/                ← PDF compilado (ignorado por git)
```

- **Los `.tex` viven en el repositorio** y se compilan localmente: `latexmk -pdf -outdir=build main.tex`
- **Markdown** para el trabajo diario (`docs/`, `bitacora/`): rápido de escribir, legible desde el
  teléfono en GitHub.
- **LaTeX** solo para los entregables formales al profesor.
- **Overleaf** queda como editor/visor **secundario y opcional**. Su sincronización con GitHub
  requiere plan pagado — **verificar si la UCT tiene licencia institucional** con el correo
  `@alu.uct.cl`. Sin licencia: importar/exportar ZIP puntualmente.

### Reglas de operación

1. **Un commit por unidad de trabajo con sentido**, no uno al final del día. Mensaje en español, en
   imperativo, con cuerpo que explique **por qué** —la pauta evalúa «comentarios adecuados para todos
   los commits».
2. **Cada miércoles, bitácora el mismo día.** Copiar `bitacora/plantilla-reunion.md`.
3. **Toda retroalimentación de Mario genera una fila** en la tabla «cambios derivados» de la bitácora,
   con el archivo o commit donde queda la evidencia.
4. **Nunca versionar credenciales.** El `.gitignore` las excluye, pero la responsabilidad es al
   escribir.
5. **El repositorio en GitHub es privado.**

---

## 5. Prioridades de la Etapa 1 (entrega viernes 28 de agosto)

Ponderación oficial y orden de ataque:

| Prioridad | Entregable | Peso | Depende de | Estado |
|---|---|---|---|---|
| **1** | Definición del problema + validación con partes interesadas | **10 %** | Entrevistas | ⬜ |
| **2** | Objetivos SMART + matriz de trazabilidad objetivo ↔ problema | **25 %** | Prioridad 1 | ⬜ |
| **3** | Análisis de requerimientos: base teórica, estudio de mercado, **evaluación crítica de alternativas de protocolo** | **45 %** | Prioridades 1-2 | ⬜ |
| **4** | Backlog: épicas, historias, tareas, criterios de aceptación, estimaciones | **20 %** | Prioridades 2-3 | ⬜ |

**El criterio 3 vale casi la mitad de la etapa.** Ahí entra la justificación de Contact ID frente a
MQTT+JSON, CoAP, LwM2M, Sparkplug B, SenML y SIA DC-09, que es exactamente lo que Mario pidió
averiguar y tener definido.

### 🔴 Lo único que no puede delegarse

**Las entrevistas a las partes interesadas.** Valen el 10 % directo y sustentan el 45 % de
requerimientos. La rúbrica pide literalmente «la percepción de las partes interesadas para validar la
relevancia del problema» y «solicitudes del propietario del proyecto». Sin al menos una cita textual
de alguien de la universidad describiendo el problema en sus propias palabras, esos puntos no se
recuperan.

**Acción inmediata:** identificar y escribir al responsable de los sensores de la universidad.

### Reparto de los 11 días

| Días | Trabajo | Responsable |
|---|---|---|
| Lun 17 – mar 18 | Marco: problema, alcance, objetivos SMART, decisión metodológica | Asistente redacta / él valida |
| **Lun 17 – mar 18** | 📧 **Contactar partes interesadas de la universidad** + confirmar fechas con Mario | **Él** |
| Mié 19 – jue 20 | Investigación del protocolo: Contact ID vs alternativas + perfil preliminar | Asistente |
| Vie 21 – dom 23 | Requerimientos funcionales y no funcionales, trazabilidad, alojamiento y costos | Asistente |
| Lun 24 – mar 25 | Backlog completo con criterios de aceptación y estimaciones | Asistente redacta / él prioriza |
| **Mié 26** | **Revisión con Mario del borrador completo** | Él |
| Jue 27 | Incorporar retroalimentación, compilar LaTeX, exportar PDF | Ambos |
| **Vie 28** | **Entrega** | Él |

---

## 6. Pendientes abiertos

- [ ] **Confirmar fechas de las cuatro etapas** con Mario (pauta fechada en 2025).
- [ ] Identificar el interlocutor concreto de la universidad: departamento, sensores, cantidad, tipo.
- [ ] Confirmar el entregable final exigido por la carrera: prototipo, documento, o ambos.
- [ ] Crear el repositorio privado `tesis` en GitHub (`vicenterami`) y agregar el remoto.
- [ ] Instalar LaTeX local (`texlive` + `latexmk`) — pendiente de autorización.
- [ ] Verificar si la UCT tiene licencia institucional de Overleaf.
- [ ] Definir horario de la revisión de los miércoles, compatible con jornada horario laboral.
- [ ] Hardware para el prototipo: qué hay disponible, qué se necesita comprar, presupuesto.
