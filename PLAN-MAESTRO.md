# Plan maestro — Trabajo de Título INFO-1197

> Documento de gobierno del proyecto. Define **cómo** se trabaja, **cuándo** se entrega y **dónde**
> vive cada cosa. Se actualiza al cerrar cada etapa.
>
> Última actualización: **jueves 1 de octubre de 2026** (§1). Las secciones de planificación de la Etapa 1 se conservan como registro.

---

## 1. Tema y alcance

**Título (desde el 30/09, tras la reunión con el profesor guía):** Sistema integrado para el registro, gestión
y monitoreo de dispositivos IoT; caso de validación: Campus Dr. Luis Rivas del Canto de la UCT.

**Enunciado en una frase:**

> Un prototipo de sistema integrado para el registro, gestión y monitoreo en tiempo real de dispositivos IoT,
> con un dashboard que centralice sus datos, estado y alertas, para facilitar su aprovechamiento en
> actividades de investigación de la Facultad de Ingeniería de la UCT, diseñado bajo la metodología **PPDIOO**.
> (Objetivo general vigente desde el 30/09; el enunciado de agosto, basado en Contact ID, se descartó el 02/09.)

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

> ✅ **RESUELTO el 24 de agosto de 2026.** El profesor del curso publicó la pauta oficial con las
> fechas 2026. Ninguno de los dos escenarios que se manejaban resultó exacto: las fechas reales dan
> **una semana más** que el escenario exigente con el que se venía planificando. El riesgo R3 se cierra.

**Calendario oficial** (pauta del 17 de agosto de 2026, publicada el 24):

| Etapa | Semanas del sprint | Entrega (viernes) |
|---|---|---|
| **1** — Problema, objetivos, requerimientos | 17 ago – 4 sep | **4 de septiembre** |
| **2** — Diseño e implementación inicial | 7 sep – 2 oct | **2 de octubre** |
| **3** — Mejoras, pruebas, validación preliminar | 5 oct – 30 oct | **30 de octubre** (entrega aplazada al 5 de noviembre) |
| **4** — Validación final e informe | 2 nov – 4 dic | **4 de diciembre** |

**Indicación adicional del curso:** el informe tiene un **límite blando de 30 páginas**; el resto va a
anexos o al repositorio. Formato recomendado: plantilla LaTeX oficial + estructura de la Figura 3.1 de
la guía de Cardiff, de común acuerdo con el profesor guía. Seguir los estándares IEEE (SWEBOK v4) en la
medida de lo posible.

### Umbral de aprobación

Se aprueba con **70 % de logro**, no con 50 %. La nota P solo procede si el avance supera el 70 % de
los hitos establecidos. **Consecuencia de diseño:** el alcance de cada etapa se dimensiona para
superar cómodamente ese umbral, no para maximizar ambición.

### Presupuesto de tiempo real

Jornada laboral completa. El tiempo de tesis es de **14-16 h por semana**, en bloques cortos (validación, decisiones,
redacción, commits) y bloques largos de trabajo profundo (construcción, pruebas).

De aquí al 4 de diciembre (calendario oficial): ~14,5 semanas ≈ **215 horas**. Es un presupuesto suficiente **si no se
desperdicia en rehacer trabajo perdido entre dispositivos** — de ahí la sección 4.

---

## 4. Flujo de trabajo: una sola fuente de verdad

### El principio

> **La fuente de verdad es este repositorio git.** Todo lo demás —artifacts, chats, Overleaf, notas
> del teléfono— es vista, borrador o respaldo. Nada importante vive fuera del repo.

El repositorio git es la única fuente de verdad del proyecto. Cualquier borrador, nota o material de
apoyo que no esté versionado aquí se considera desechable: lo que no está en el repo, no existe.

### Qué se puede hacer desde dónde

| Dispositivo / entorno | Qué hacer ahí | Cómo |
|---|---|---|
| **Portátil principal (Ubuntu)** | **Todo**: redactar, compilar LaTeX, programar, commitear | Trabajo local sobre `~/tesis` |
| **Otro portátil** | **Todo**, si tiene el entorno | `git clone git@github.com:vicenterami/tesis.git` |
| **Teléfono — app o web de GitHub** | **Leer** documentos, **anotar** en `bitacora/INBOX.md`, revisar el backlog | GitHub permite editar archivos `.md` desde el navegador y commitear |
| **Teléfono** | Anotar ideas rápidas y revisar documentos | ⚠️ lo que no se copie a un archivo del repo el mismo día se pierde |

**Regla de oro:** **producir solo donde hay git; en el teléfono, capturar.** El teléfono sirve para no
perder una idea, nunca para tomar una decisión que después no quede registrada.

**Mecanismo de captura:** el archivo `bitacora/INBOX.md` es la bandeja de entrada. Se le agregan
líneas sueltas desde cualquier parte, y se vacía procesándolas hacia su documento definitivo.

### Flujo LaTeX

Los entregables formales se redactan en LaTeX. Para que Overleaf no se convierta en un punto ciego:

```
historico/informe-v1/   (informe v1, previo a la plantilla oficial)
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

## 5. Prioridades de la Etapa 1 (entrega viernes 4 de septiembre)

Ponderación oficial y orden de ataque:

| Prioridad | Entregable | Peso | Depende de | Estado |
|---|---|---|---|---|
| **1** | Definición del problema + validación con partes interesadas | **10 %** | Entrevistas | 🟡 redactado, faltan entrevistas |
| **2** | Objetivos SMART + matriz de trazabilidad objetivo ↔ problema | **25 %** | Prioridad 1 | ✅ `docs/01-problema-y-objetivos.md` |
| **3** | Análisis de requerimientos: base teórica, estudio de mercado, **evaluación crítica de alternativas de protocolo** | **45 %** | Prioridades 1-2 | 🟡 alternativas de protocolo listas en `docs/05-…`; falta el catálogo de requerimientos |
| **4** | Backlog: épicas, historias, tareas, criterios de aceptación, estimaciones | **20 %** | Prioridades 2-3 | ✅ `docs/04-backlog.md` |

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
| Lun 17 – mar 18 | Marco: problema, alcance, objetivos SMART, decisión metodológica | Estudiante |
| **Lun 17 – mar 18** | 📧 **Contactar partes interesadas de la universidad** + confirmar fechas con Mario | **Estudiante** |
| Mié 19 – jue 20 | Investigación del protocolo: Contact ID vs alternativas + perfil preliminar | Estudiante |
| Vie 21 – dom 23 | Requerimientos funcionales y no funcionales, trazabilidad, alojamiento y costos | Estudiante |
| Lun 24 – mar 25 | Backlog completo con criterios de aceptación y estimaciones | Estudiante |
| **Mié 26** | **Revisión con Mario del borrador completo** | Estudiante y profesor guía |
| Jue 27 | Incorporar retroalimentación, compilar LaTeX, exportar PDF | Estudiante |
| **Vie 4 sep** | **Entrega** | Estudiante y profesor guía |

---

## 6. Pendientes abiertos

- [x] ~~Confirmar fechas de las cuatro etapas~~ ✅ 24/08 — pauta oficial: 4 sep · 2 oct · 30 oct · 4 dic.
- [ ] Identificar el interlocutor concreto de la universidad: departamento, sensores, cantidad, tipo.
- [ ] Confirmar el entregable final exigido por la carrera: prototipo, documento, o ambos.
- [x] ~~Crear el repositorio privado `tesis` en GitHub (`vicenterami`) y agregar el remoto.~~ ✅ 17/08/2026 — `git@github.com:vicenterami/tesis.git`, privado, conectado por SSH.
- [x] ~~Instalar LaTeX local (`texlive` + `latexmk`).~~ ✅ 17/08/2026 — TeX Live 2025, con `pdflatex`, `latexmk` y `biber`.
- [ ] Verificar si la UCT tiene licencia institucional de Overleaf.
- [ ] Definir horario de la revisión semanal, compatible con la jornada laboral.
- [ ] 🔴 **Validar con Mario el uso del campo de datos extendidos de DC-09** (pregunta P3 de `docs/03-instrumentos-levantamiento.md`).
- [ ] 🔴 **Aclarar si el trabajo del compañero es tesis conjunta o separada.** Afecta la restricción RE-02 y exige un contrato de interfaz entre su firmware y esta plataforma, que hoy no está en el backlog.
- [ ] Obtener acceso al estándar SIA DC-03 para verificar su sintaxis de valores (pendiente P8); si resultara más eficiente, sería la alternativa preferente.
- [ ] Hardware para el prototipo: qué hay disponible, qué se necesita comprar, presupuesto.
