# Verificación de la bibliografía y cierre del día — 23 de septiembre de 2026

- **Sesión de trabajo individual;** registro de decisiones, no de la jornada. Sonnet 5, esfuerzo medio.

## 1. Qué se hizo

Verificadas contra su fuente original las 23 referencias que el informe cita: tres artículos por DOI
(vía Crossref), dos RFC, una especificación de la OMG, una de OpenAPI, un estándar OASIS y siete sitios
web. Corregido lo que la fuente contradecía. Corregida además una tabla del backlog que listaba
elementos del núcleo como recortables, encontrada al revisar el orden de los filtros con el estudiante.

## 2. Decisiones y hallazgos

| # | Decisión / hallazgo | Por qué | Dónde queda |
|---|---|---|---|
| 1 | UML 2.5.1: número de documento corregido de «formal/2017-12-05» a «formal/17-12-05» | Formato real de la OMG, verificado en su sitio | `referencias.bib` |
| 2 | SWEBOK: año corregido de 2025 a 2024, editor Hironori Washizaki agregado | La propia página del IEEE Computer Society da el año y el editor; la cita pasa de un año sin autor a «(Washizaki, 2024)» | `referencias.bib` |
| 3 | Nueve entradas nunca citadas (ocho del protocolo Contact ID descartado el 02/09, una de la guía de Cardiff citada solo en comentario) movidas a `historico/`, no borradas | El `.bib` activo del informe no debe cargar referencias muertas de un camino abandonado; el registro de esa fase ya vive aparte | `historico/docs/referencias-contactid.bib` |
| 4 | **Hallazgo del estudiante, verificado con `git log`:** el puerto 1700/udp en la topología de red no es nuevo — está en el primer commit de la arquitectura, 08/09/2026. Es el puerto del *Semtech UDP Packet Forwarder* que usan los *gateways* LoRaWAN del compañero para hablar con ChirpStack | Confirmar con la fuente antes de sospechar un cambio no avisado | sin cambios; documentado aquí para que quede la verificación |
| 5 | `docs/04 §6.5` («qué se recorta») tenía cinco elementos del núcleo (HU-11, HU-21, TT-28, TT-29, TT-33) listados como recortables, contradiciendo la regla de que el núcleo no se recorta nunca; su lista «Resto» además omitía seis tareas técnicas por un rango escrito a mano e incompleto. Recalculado sumando directamente las filas: 30 elementos fuera de núcleo, 111 h exactos, sin núcleo mezclado | Encontrado al corregir anoche solo TT-28/TT-29; verificar la lista completa mostró que el problema era más grande | `docs/04 §6.5` |
| 6 | `docs/15` (guion de demostración) y `privado/AUTOEVALUACION-NUCLEO.md` actualizados: numeración real de los filtros, el backend también corre en contenedor, y una pregunta nueva de defensa sobre la resiliencia probada anoche (la base cae, el sistema avisa y no se cae entero) | Documentos de estudio y demostración no pueden quedar desactualizados frente a lo que cambió hoy | `docs/15`, `privado/AUTOEVALUACION-NUCLEO.md` |

## 3. Verificación

- Guardián completo (`verificar-todo.sh`), 28 pasos en verde.
- Informe recompilado tras los cambios de bibliografía: 30 páginas, cero referencias rotas, sin advertencias de cita indefinida en el log de LaTeX.

## 4. Pendiente

- [ ] WebSocket o SSE: se decide y se documenta en la Etapa 3 (TT-39), no antes.
- [ ] Repaso de la defensa oral, con el estudiante haciendo de profesor adversarial.
- [ ] Volver a probar toda la pila de punta a punta tras los cambios de hoy, antes de dar por cerrada la Etapa 2.
