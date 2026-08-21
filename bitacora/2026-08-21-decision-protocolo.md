# Decisión técnica — Unificación del mensaje mediante datos extendidos de DC-09

- **Fecha:** viernes 21 de agosto de 2026
- **Tipo:** decisión de diseño, no reunión
- **Origen:** cuestionamiento del estudiante sobre si dos planos de comunicación eran necesarios

---

## 1. La pregunta que originó la revisión

> *¿Existe realmente algún protocolo que resuelva todos los requerimientos y haga innecesario usar dos
> planos, uno de eventos con Contact ID y otro que entregue los datos en bruto?*

Cuestionamiento pertinente: dos planos implicarían dos implementaciones en el firmware del nodo, con el
doble de trabajo para quien lo desarrolle.

## 2. Alternativas investigadas

| Alternativa | Resultado |
|---|---|
| **LwM2M** | Unifica gestión y telemetría, pero su vocabulario no es el de la industria de alarmas: **se pierde el criterio de interoperabilidad con la infraestructura instalada**, que es el diferenciador del trabajo. Descartada |
| **SIA DC-03** | El otro formato SIA. Bloques de longitud variable, texto ASCII, admite valores nativamente, y **tiene el código `XL` que Contact ID no tiene**. Puntúa 3,95. Descartada por tamaño (15-25 B frente a 8) y porque **su sintaxis exacta para valores no pudo verificarse** |
| **Contact ID con campo extra propio** | Dejaría de ser estándar. Descartada |
| **Campo de datos extendidos de DC-09** | ✅ **Seleccionada.** El estándar ya define el mecanismo |

## 3. La decisión

**El estándar DC-09 define un campo de datos extendidos** con la forma `[<identificador A-Z><datos
ASCII>]`, y establece que **la longitud, el formato y el algoritmo de los datos los determina el
implementador**, con la única restricción de no admitir contenido binario.

En consecuencia: **la medición no requiere un protocolo aparte.** Viaja en un campo que la propia norma
reserva. El nodo emite un solo mensaje y el firmware implementa una sola rutina.

| Qué se conserva | Qué cambia |
|---|---|
| Contact ID (DC-05) como formato del evento | El valor medido deja de necesitar un segundo protocolo |
| La interoperabilidad con receptoras: las que no interpreten el campo lo ignoran | El nodo emite un mensaje y no dos |
| La separación entre eventos y telemetría, ahora **lógica**, en la plataforma | El firmware implementa una rutina y no dos |

## 4. Hallazgo de la verificación

Al implementar el campo en `plataforma/herramientas/contactid.py` y medirlo:

| Mensaje | Tamaño |
|---|---|
| Solo evento | 8 B |
| Evento + batería `[B12]` | 13 B |
| Evento + temperatura `[T23.4]` | 15 B |
| Evento + RSSI y SNR `[S-103/4.2]` | 19 B |

**El mensaje con valor no cabe en los 11 bytes del enlace de alcance máximo**, aunque sí en los 51 a 53
de operación normal.

**Decisión derivada: el valor es opcional.** En la tasa más lenta el nodo transmite solo el evento; la
medición viaja cuando el canal lo permite. La degradación prioriza el evento sobre la medición, que es el
criterio correcto: un evento no entregado es una alarma que no suena, mientras que una medición ausente
solo interrumpe una serie.

## 5. Efecto en la evaluación de alternativas

| | Antes | Después |
|---|---|---|
| Contact ID + DC-09 | 4,45 (criterio C-E = 1) | **4,75** (C-E = 4) |
| Alternativas evaluadas | 7 | **8** |
| SIA DC-03 | no evaluada | 3,95, segunda posición |

La corrección de la puntuación C-E se documenta explícitamente en el informe, para que no se interprete
como un ajuste a conveniencia.

## 6. Sobre la disponibilidad del estándar

Verificación realizada, con dos precisiones que corrigen una afirmación previa:

- Los **documentos** de los estándares SIA (DC-03, DC-05, DC-09) **son de pago**.
- La implementación de referencia de DC-09 publicada por la SIA en agosto de 2025 **no es software libre
  en sentido estricto**: usa licencia *Polyform Noncommercial*, que **admite uso no comercial** —
  categoría que comprende un trabajo de titulación — y exige licencia aparte para uso comercial.

**Ninguna de las dos cosas bloquea el proyecto**, porque el formato está documentado en fuentes
secundarias independientes y **la implementación del trabajo es propia y está verificada**. Ver
sección 6 del informe.

## 7. Pendiente de validación

Falta la aprobación del profesor guía. La pregunta está formulada en
`docs/03-instrumentos-levantamiento.md`, pregunta **P3**, con las respuestas posibles y su implicación.
