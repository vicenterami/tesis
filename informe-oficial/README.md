# Informe oficial (el entregable)

Basado en la plantilla oficial del curso (clase `memoir`, bibliografía APA) con la estructura de la
Figura 3.1 de la guía de Cardiff, adaptada a la Etapa 3. Cuerpo 30 páginas (límite blando); el
detalle completo va en los anexos y en `docs/` del repositorio.

```bash
cd informe-oficial
latexmk -pdf -outdir=build main.tex     # SIEMPRE desde esta carpeta, nunca desde build/
```

| Archivo | Contenido |
|---|---|
| `resumen.tex` | Resumen ejecutivo |
| `cap1.tex` | Introducción: problema, objetivos (uno general, cinco específicos), trazabilidad |
| `cap2.tex` | Antecedentes: pila de protocolos, LoRa/LoRaWAN, MQTT, persistencia y seguridad del transporte |
| `cap3.tex` | Especificación: catálogo de requerimientos, contrato SenML, evaluación de alternativas |
| `cap-diseno.tex` | Diseño de la plataforma: vistas C4, modelo de datos, red y seguridad, comportamiento, despliegue |
| `cap-pruebas.tex` | Implementación y pruebas iniciales: estado por módulo, método, resultados por requisito, validación preliminar |
| `cap4.tex` | Metodología: backlog, viabilidad, seguimiento, retroalimentación y riesgos |
| `conclusion.tex` | Conclusiones de la etapa |
| `glosario.tex` | Glosario de términos y API |
| `anexos/a-requerimientos.tex` | Catálogo completo: 70 requerimientos (52 RF + 18 RNF) |
| `anexos/b-backlog.tex` | Backlog completo: 65 elementos (25 historias y 40 tareas) en 14 épicas |
| `anexos/c-evaluacion.tex` | Evaluación detallada de transporte, formato, infraestructura, tiempo y alojamiento |
| `anexos/d-contactid.tex` | Camino evaluado y descartado: el protocolo Contact ID |
| `anexos/e-seguimiento.tex` | Seguimiento de las Etapas 2 y 3, retroalimentación, calendario y riesgos |
| `anexos/g-pruebas.tex` | Detalle de cada prueba y cómo repetirla |
| `anexos/f-figuras.tex` | Figuras complementarias del capítulo de diseño |
| `referencias.bib` | Bibliografía en biblatex/APA |

El logo del departamento (`images/Logo_depto_ing_informatica.png`) no se versiona porque es de la plantilla del curso: quien
tenga la plantilla lo copia ahí; sin él, la portada compila sin logo.

La versión extendida de cada sección vive en `docs/`; la primera versión del informe (Etapa 1) está
en `historico/informe-v1/`.

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
