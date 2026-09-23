# Revisión final de concordancia del día — 23 de septiembre de 2026

- **Sesión de trabajo individual;** registro de decisiones, no de la jornada.

## 1. Qué se hizo

Revisión adversarial de todo lo cambiado hoy (12 commits, 69 archivos) con tres lentes independientes
—diseño↔código, documentación↔informe, seguridad↔método— y verificación de cada hallazgo contra la
fuente antes de corregir. Dos hallazgos de los revisores resultaron falsos al verificarlos (el techo de
memoria del backend sí se aplica: 536 870 912 bytes en `docker inspect`; y los commits con menciones
sí estaban ya en `origin`, no «sin pushear»): un revisor también se equivoca, y por eso se verifica.

## 2. Hallazgos verificados y corregidos

| # | Hallazgo | Corrección | Dónde |
|---|---|---|---|
| 1 | El análisis de viabilidad (§6.3, §6.4, §6.6) seguía con el presupuesto del escenario exigente (21/60/60/60 = 201 h) aunque §6.2 lo había reemplazado el 24/08 por el calendario oficial (45/60/60/75 = 240 h). El cap. 4 del informe decía 240 h en una línea y 201 h veinte líneas después | Propagado el presupuesto oficial, recalculando desde las filas: backlog completo −16 % (no −39 %), núcleo +30 % (no +16 %), reserva 72 h | `docs/04 §6.3–6.6`, `cap4.tex` |
| 2 | La tabla MoSCoW de docs/02 decía 68 requerimientos y 16 RNF; el catálogo tiene 70 y 18 (RNF-17 y RNF-18, del 22/09, nunca se sumaron). El informe ya decía 70 | Recalculada desde el catálogo con un script: 52 RF (35 M, 14 S, 3 C) + 18 RNF (16 M, 2 S) = 70; Must 51 | `docs/02 §4.1, §8` |
| 3 | Sin pruebas automáticas del filtro 3 (validar) ni del 5 (alertar): el ✅ de docs/11 se apoyaba solo en una tabla manual | 11 pruebas nuevas: canal no declarado, unidad no convertible, fuera de rango, camino feliz, tópico fuera del patrón, cuerpo vacío, e histéresis completa (35 abre, 29 nada, 27 cierra, 35 con abierta no duplica, 25 nada). 40 pruebas en total | `recepcion.service.spec.ts`, `alertas.service.spec.ts`, `docs/11 §3` |
| 4 | `cuarentena.motivo` sin `CHECK`, contra la regla de docs/08 §6 (dominio que el código interpreta → `CHECK`) | Migración 07, aplicada a la base y probada insertando un motivo inventado (rechazado); guardián paso 2 la exige | `db/init/07-cuarentena-motivo.sql`, `verificar-todo.sh` |
| 5 | Casos anormales sin decisión escrita: tópico fuera del patrón (no estaba en el diagrama), dos lecturas del mismo canal en la misma trama sin marca, reentrega masiva sin *backpressure*, trama con miles de lecturas | Rama nueva en el diagrama de secuencia (antes del filtro 1) y cuatro filas nuevas en la tabla de caídas y duplicados, cada una con su decisión o su límite declarado | `docs/10 §4, §4.1`, `docs/11 §4` |
| 6 | Cinco filtraciones del nombre de la herramienta en archivos versionados: cabecera de tres bitácoras, una ruta personal en otra, el `.gitignore`, y «de un asistente» en docs/11 | Quitadas; la exclusión personal pasa a `.git/info/exclude` (no versionado); guardián 2f nuevo revisa los 189 archivos rastreados y falla si alguno las menciona | bitácoras, `docs/11`, `.gitignore`, `verificar-todo.sh` |
| 7 | `Dockerfile` con imagen base flotante (`node:22-slim`) mientras el compose fija versiones exactas; `.dockerignore` sin secretos | Fijada a `node:22.23.2-slim` (construida y verificada); `.dockerignore` excluye `.env*`, claves y `passwd` | `Dockerfile`, `.dockerignore` |
| 8 | Guardián 2d ciego a lecturas sin genérico (`config.get('X')`) | Regex con genérico opcional; probado plantando la violación | `verificar-todo.sh` |
| 9 | `docs/GLOSARIO.md` (21/08) describía Contact ID como «tu protocolo» y seguía enlazado como vigente | Movido a `historico/docs/GLOSARIO-contactid.md` con aviso; README y RESUMEN apuntan al glosario del informe | `historico/`, `README.md`, `RESUMEN.md` |
| 10 | «Doble punto de entrada TLS» en la trazabilidad del cap. de diseño, cuando el mismo capítulo dice tres | «los puntos de entrada TLS y UDP» | `cap-diseno.tex` |
| 11 | Amenaza A7 insertada fuera de orden en la tabla de docs/11; comentario de `app.module.ts` listaba módulos que no importa directamente; cifras viejas en docs/12 y docs/15 (19 pruebas, 8+11 dependencias, 187 MB) | Reordenada; comentario corregido; docs/12 al corte del 23/09 con cifras medidas (9+14 dependencias, 247 MB, 56 MB en reposo del backend) | `docs/11`, `app.module.ts`, `docs/12`, `docs/15` |
| 12 | Dos commits de hoy sin bitácora: el aviso accionable de datos inválidos (`docs/10 §8.1`) y la corrección de «dos puntos de entrada» con la amenaza A7 | Registrados aquí: la propuesta §8.1 queda como propuesta para la Etapa 3; la amenaza A7 documenta que el protocolo de *gateway* LoRaWAN no autentica ni cifra y que la defensa es el contenedor sin privilegios, el límite de tasa y el filtro 1 | esta bitácora |

## 3. Aceptado con límite declarado (no se cambia)

- `pnpm audit` audita todo el árbol, incluidas herramientas de desarrollo: corren en el portátil y en el CI, y un compromiso ahí también cuenta.
- Sin marca de tiempo del emisor, dos lecturas del mismo canal en la misma trama se guardan ambas: sin identidad no hay deduplicación posible (`docs/10 §4.1`).
- El historial de git ya publicado contiene menciones a la herramienta en cuatro commits; se limpia junto con el resto del historial antes de hacer público el repositorio, no con un commit encima.

## 4. Verificación

- 40 pruebas unitarias en verde; `pnpm audit` sin avisos.
- Guardián completo en verde, con los pasos nuevos 2f (menciones) y 07 (CHECK de cuarentena).
- Informe recompilado: 30 páginas, cero referencias rotas.
