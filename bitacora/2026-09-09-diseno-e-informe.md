# Diseño, API de consulta e informe de la Etapa 2 — 9 y 10 de septiembre de 2026

- **Sesión de trabajo individual;** registro de decisiones, no de la jornada.

## 1. Decisiones tomadas

| # | Decisión | Por qué | Dónde queda |
|---|---|---|---|
| 1 | El material del enfoque previo (Contact ID) se mueve a `historico/` con `git mv` | El repositorio debe leerse enfocado en el trabajo actual; la historia se conserva como evidencia | `historico/README.md` |
| 2 | API de consulta de solo lectura (M5): dispositivos, ficha, histórico agregado, condiciones, cuarentena | Es lo que el panel consumirá (patrón B) y demuestra `time_bucket` en la zona del sitio | `backend/src/consulta`, `docs/12` |
| 3 | **Reglas de tiempo y zonas horarias** (13 reglas, tres familias de fecha, casos de sensores) tras estudiar casos reales de la industria | Chile alterna UTC−4/UTC−3; un desfase fijo o un «día» calculado en el código produce errores silenciosos | `docs/13`, migración 04 (`iso_utc`), `tiempoPlausible` |
| 4 | Las marcas de tiempo antiguas de un nodo se respetan; solo se descartan las anteriores a 2000 o futuras (> 2 min) | Un nodo que acumuló lecturas sin cobertura reporta tiempos legítimamente viejos | filtro 4 |
| 5 | **Las figuras del informe se generan desde una fuente única** (Mermaid de `docs/10`; el ER desde el esquema real) con `mermaid-cli` en Docker; un guardián falla si informe ≠ docs ≠ base | Dibujar a mano en TikZ produjo solapes, notaciones mezcladas y columnas omitidas; la concordancia no se logra «con cuidado» sino con una sola fuente | `figuras/generar-figuras.sh`, `db/pruebas/er-mermaid.sql` |
| 6 | Numeración de módulos vuelve a la canónica de `docs/02`: M4 supervisión, M5 persistencia y consulta, M6 alertas | `docs/10` y el código la tenían distinta | docs, código, README |
| 7 | Informe de la Etapa 2 = mismo documento ampliado con el capítulo «Diseño de la plataforma» | La pauta describe un informe que crece por etapas; Cardiff pide un capítulo de diseño con varias vistas | `cap-diseno.tex` |
| 8 | Para respetar 30 páginas: cuadros de evaluación al anexo, antecedentes condensados, seguimiento del backlog como `longtable` en anexo | Recortar sin perder contenido ni tocar la plantilla oficial | anexos C y D |
| 9 | `actualizar.sh`: figuras + compilación + comprobaciones en un comando; git sigue siendo manual | Un solo paso reproducible; el repositorio se controla a mano | `informe-oficial/actualizar.sh` |

## 2. Verificaciones

- Pruebas SQL de zonas horarias: 10/10 (día de 23 h el 6-sep-2026, buckets en UTC−4 y UTC−3, otra zona con el mismo código, guardias de tipo).
- Prueba de humo de la API: 12/12, incluidas entradas hostiles (400) y formato `Z` uniforme.
- Guardián de concordancia informe = docs = base: en verde. Informe: 0 referencias rotas, 0 etiquetas duplicadas, cuerpo 30 páginas.
- Discrepancias detectadas y corregidas por el método: 5 en el modelo de datos documentado vs. implementado, la numeración de módulos, un volumen inexistente en el despliegue, una figura duplicada.

## 3. Pendientes que deja la sesión

- [ ] Escribir al profesor guía: retroalimentación de la Etapa 1, borrador de la Etapa 2, propuesta de visita.
- [ ] Escribir al compañero: nombres de campos de su JSON, unidad, sensores y magnitudes del primer nodo, fecha de primeras tramas.
- [ ] TT-24, TT-25, TT-26: alternativas de alojamiento, costos CLP/USD, recomendación (`docs/14` + sección en el informe).
- [ ] TT-13: contrato OpenAPI desde el código. TT-03: ESLint y primeras pruebas unitarias.
- [ ] Lectura crítica del borrador por el autor; incorporar la retroalimentación cuando llegue.
