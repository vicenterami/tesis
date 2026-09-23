# Plan B del riesgo R1 y una redistribución del backlog que nunca se ejecutó — 23 de septiembre de 2026

- **Sesión de trabajo individual;** registro de decisiones, no de la jornada.

## 1. Qué se hizo

Al preparar el plan B del riesgo R1 (hardware no disponible), se verificó primero que el objetivo
específico 4 (OE4, cap1.tex) promete un sensor real de extremo a extremo al 30 de octubre, y se
comprobó contra el backlog real qué tarea lo garantiza. La verificación destapó un problema mayor que
el que se estaba resolviendo.

## 2. Hallazgo: una corrección escrita el 22/09 nunca se aplicó a los datos

`docs/04 §6.4` describe, con justificación caso por caso, el traslado de ocho elementos del núcleo
(TT-20, TT-21, TT-22, HU-07, HU-08, HU-20, TT-27, HU-16; 37 h) de la Etapa 3 a la Etapa 4, y presenta
una tabla "Distribución del núcleo tras la corrección" (Etapa 3: 60 h). **Esa tabla era ficticia**:
las ocho filas seguían con `Etapa 3` en el backlog real. Sumando las filas de verdad (no las tablas de
resumen), la Etapa 3 tenía 97 h de núcleo contra 60 disponibles, un 62 % de sobrecarga real, exactamente
el problema que la sección decía haber resuelto.

## 3. Decisiones

| # | Decisión | Por qué | Dónde queda |
|---|---|---|---|
| 1 | Ejecutar en las filas la redistribución que ya estaba decidida y justificada por escrito | La decisión ya existía; solo faltaba aplicarla a los datos | `docs/04` (9 filas), `anexo B` |
| 2 | **Plan B de R1**, aprobado por el estudiante: fecha gatillo **8 de octubre**. Si no hay confirmación del hardware LoRaWAN del compañero, se usa un nodo Wi-Fi propio (ESP32 + sensor), ya soportado como entrada de primera clase en la arquitectura (`docs/10`, nodo N2) | OE4 promete «un sensor real», no específicamente LoRaWAN; el plan B no depende de nadie más | `docs/04` (nota de TT-28/TT-32), `anexo E` (R1) |
| 3 | **TT-32 promovida a núcleo y adelantada de la Etapa 4 a la Etapa 3** | Sin esto, nada en el backlog garantizaba un sensor real antes del 30 de octubre, pese a que el objetivo ya lo prometía | `docs/04`, `anexo B`, `cap4.tex` |
| 4 | TT-32 retirada de la lista de elementos recortables (§6.5): un elemento núcleo no puede estar también en la lista de lo que se recorta si falta tiempo | Contradicción directa detectada al revisar esa lista | `docs/04 §6.5` |
| 5 | Aceptar honestamente que la Etapa 3 queda 3 h sobre su presupuesto (63 h contra 60, −5 %) en vez de mover otro elemento para forzar un 0 % artificial | Es una sobrecarga real y pequeña; ocultarla corriendo otra pieza sería menos honesto que declararla | `docs/04 §6.4` |

## 4. Segundo hallazgo, menor, dejado como pendiente (no resuelto hoy)

El párrafo de verificación del umbral de la Etapa 3 decía «Implementación total (EP-01, 04–11) = 165 h»,
pero la suma real de esas épicas específicas es **118 h**, no 165. El 165 h (ahora 168 h) es el total del
núcleo en **todas** las épicas, no solo EP-01 y EP-04–11. El cálculo del 50 % sigue cumpliéndose con
cualquiera de las dos lecturas (54 % o más), así que no cambia la conclusión, pero el estudiante debe
decidir cuál lectura quiere sostener frente al profesor guía. Documentado en `docs/04`, sin resolver.

## 5. Totales que cambian (recalculados desde las filas, con un script, no a mano)

| Conjunto | Antes | Ahora |
|---|---|---|
| Núcleo demostrativo | 33 elementos, 165 h | 34 elementos, 168 h |
| Alcance condicional | 31 elementos, 114 h | 30 elementos, 111 h |
| Holgura del núcleo | +18 % | +16 % |
| Núcleo en la Etapa 3 (real, no el de la tabla ficticia) | 97 h (−62 %, nunca corregido) | 63 h (−5 %, corregido y con TT-32) |
| Núcleo en la Etapa 4 | 11 h (fila ficticia decía 48 h) | 48 h (ahora sí real) |
| Total del backlog (63 elementos, 277 h ⇒ 64/279 con TT-38 aparte) | sin cambio | sin cambio |

## 6. Verificación

- Guardián completo (`verificar-todo.sh`), 28 pasos en verde.
- Informe recompilado: 30 páginas, cero referencias rotas.
- Cero apariciones de las cifras antiguas fuera de contexto histórico explícito, verificado con `grep` en todo el repositorio.

## 7. Pendiente

- [ ] Fecha gatillo del plan B: **8 de octubre**. Si no hay hardware LoRaWAN confirmado, comprar el ESP32.
- [ ] Decidir la lectura del párrafo de la Etapa 3 (punto 4 de esta bitácora).
- [ ] Nota menor: TT-28 y TT-29 (núcleo 🎯) aparecen listadas dentro del "Resto" de §6.5, que se supone recortable. Contradicción de redacción, sin efecto en los totales; revisar cuando haya tiempo.
