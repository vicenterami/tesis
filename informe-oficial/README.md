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
| `anexos/` | Catálogo de 70 requerimientos, backlog de 64 elementos, detalle del protocolo |
| `referencias.bib` | Bibliografía en biblatex/APA |

La versión extendida de cada sección vive en `docs/`; la primera versión del informe está en `historico/informe-v1/`.

## Figuras generadas (fuente única)

Las figuras de diseño **no se dibujan a mano**: `figuras/generar-figuras.sh` toma los bloques Mermaid de
`docs/10-arquitectura.md`, genera el modelo de datos desde el esquema real de la base
(`plataforma/db/pruebas/er-mermaid.sql`) y los renderiza a PDF vectorial en `figuras/render/` con
`mermaid-cli` dentro de Docker (imagen fijada; nada que instalar). Los `.tex` de `figuras/` solo
incluyen el PDF con su leyenda APA.

```bash
bash informe-oficial/figuras/generar-figuras.sh              # regenerar (requiere la pila arriba)
bash informe-oficial/figuras/generar-figuras.sh --verificar  # guardián: informe = docs = base
```

Si un diagrama debe cambiar, se edita **en `docs/10`** (o se migra el esquema) y se regenera; nunca el PDF.
Las figuras de la Etapa 1 (`arbol`, `pipeline`, `pila`, `mqtt`, `lorawan`) siguen en TikZ.
