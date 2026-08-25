# Materiales del curso INFO-1197

> Los archivos originales (PDF y plantilla) viven en `recursos-uct/`, carpeta local que git
> ignora porque no son nuestros para redistribuir. Aquí queda el resumen propio de cada uno.

## 1. Pauta y rúbrica oficial (17 de agosto de 2026)

**Fechas oficiales de las cuatro etapas** (todas viernes):

| Etapa | Fecha límite | Contenido evaluado |
|---|---|---|
| **1** | **4 de septiembre** | Problema (10 %), objetivos SMART (25 %), requerimientos (45 %), backlog (20 %) |
| **2** | **2 de octubre** | Retroalimentación (20 %), avance de diseño (10 %), calidad del diseño (55 %), documentación (15 %) |
| **3** | **30 de octubre** | Retroalimentación (20 %), mejoras (15 %), 50 % implementación (10 %), pruebas iniciales (30 %), validación preliminar (10 %), documentación (15 %) |
| **4** | **4 de diciembre** | Retroalimentación (20 %), 100 % implementación (10 %), pruebas exhaustivas (50 %), informe final (10 %), conclusiones (10 %) |

Reglas: aprobación con **70 % de logro**; nota P solo sobre ese umbral. Los criterios son
idénticos a la versión 2025 de la pauta — solo cambiaron las fechas.

**Indicación adicional del profesor del curso (24-08):** el informe tiene un **límite blando de
30 páginas**; lo demás va a anexos o al repositorio.

## 2. Guía de Cardiff — *A Short Guide to Writing Your Final Year Project Report* (2011)

Guía de redacción de la School of Computer Science de Cardiff University. Lo recomendado es
seguir su **Figura 3.1**, la estructura para proyectos que implementan software:

1. Introduction · 2. Background · 3. Specification · 4. Design · 5. Implementation ·
6. Results and Evaluation · 7. Future Work · 8. Conclusions · 9. Reflection on Learning
+ Glossary, Abbreviations, Appendices, References.

## 3. SWEBOK v4.0 (IEEE, 2025)

*Guide to the Software Engineering Body of Knowledge*: el cuerpo de conocimiento de ingeniería
de software de la IEEE, 411 páginas, 18 áreas. Las áreas que tocan directamente este trabajo:

| Área SWEBOK | Dónde aplica en la tesis |
|---|---|
| Cap. 1 — Software Requirements | `docs/02-requerimientos.md` (elicitación, análisis, validación) |
| Cap. 2 — Software Architecture | Diseño de la Etapa 2 |
| Cap. 3 — Software Design | Diseño de la Etapa 2 |
| Cap. 5 — Software Testing | Pruebas de las Etapas 3 y 4 |
| Cap. 7 — Software Configuration Management | Este repositorio y su flujo |
| Cap. 12 — Software Security | RNF-08/09/10 y el diseño de red |

## 4. Plantilla LaTeX oficial (`Modelo_Trabajo_Titulo_LaTeX`)

Clase `memoir` 12pt, bibliografía **biblatex estilo APA**, estructura de capítulos con portada,
comisión, profesor guía/informante, resumen, abstract y anexos. Es la base a la que debe
migrar `informe/`.
