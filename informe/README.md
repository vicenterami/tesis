# Informe en LaTeX

## Compilar

```bash
cd informe
latexmk -pdf -outdir=build main.tex     # genera build/main.pdf
latexmk -C -outdir=build                # limpia los archivos generados
```

## Estructura

| Archivo | Contenido |
|---|---|
| `main.tex` | Documento maestro: carga el preámbulo y ordena las secciones |
| `datos.tex` | **Datos del trabajo.** Editar aquí nombre, carrera, profesor y fecha |
| `preambulo.tex` | Paquetes, colores, estilos de tabla y cajas destacadas |
| `portada.tex` | Portada |
| `secciones/` | Una sección por archivo, en orden de aparición |
| `anexos/` | Catálogo completo de requerimientos y backlog |
| `build/` | Salida de compilación (ignorada por git) |

## Datos pendientes de completar

Los valores por confirmar están en `datos.tex` y aparecen **marcados en rojo en el PDF**, para que
no pasen inadvertidos:

- `\datoFacultad` — nombre de la facultad
- `\datoCarrera` — nombre exacto de la carrera
- `\datoProfesor` — apellido del profesor guía
- `\datoEstudiante` — verificar que el nombre esté completo
- `\datoFechaEntrega` — confirmar 28 de agosto frente a 11 de septiembre

## Regenerar los anexos

Los anexos se generan desde `docs/02-requerimientos.md` y `docs/04-backlog.md` para evitar errores de
transcripción. Si esos documentos cambian, hay que regenerarlos antes de compilar.
