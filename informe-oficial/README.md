# Informe oficial (el entregable)

Basado en la plantilla oficial del curso (clase `memoir`, bibliografía APA) con la estructura de la
Figura 3.1 de la guía de Cardiff adaptada a la Etapa 1. Cuerpo ~22 páginas (límite blando: 30);
el detalle completo va en los anexos y en `docs/` del repositorio.

```bash
cd informe-oficial
latexmk -pdf -outdir=build main.tex     # SIEMPRE desde esta carpeta, nunca desde build/
```

| Archivo | Contenido |
|---|---|
| `cap1.tex` | Introducción: problema, estado del arte, objetivos (estructura de la plantilla) |
| `cap2.tex` | Antecedentes: pila de protocolos, LoRa/LoRaWAN, MQTT, Contact ID |
| `cap3.tex` | Especificación: requerimientos y evaluación de alternativas |
| `cap4.tex` | Metodología y planificación verificada |
| `conclusion.tex` | Conclusiones de la etapa |
| `anexos/` | Catálogo de 68 requerimientos, backlog de 63 elementos, detalle del protocolo |
| `referencias.bib` | Bibliografía en biblatex/APA |

La versión extendida de cada sección vive en `docs/`; la primera versión del informe está en `historico/informe-v1/`.
