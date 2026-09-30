# Reunión con el profesor guía — martes 29 de septiembre de 2026

- **Profesor guía:** Mario
- **Modalidad:** presencial, en su oficina (viaje a Temuco)
- **Etapa en curso:** 2 (entrega oficial el viernes 2 de octubre) | **Fase PPDIOO:** Design

## 1. Qué se presentó
- El borrador del informe de la Etapa 2 (30 páginas) y la demostración de la plataforma según `docs/15`,
  ensayada esa misma mañana (registros y consultas en `privado/`, fuera del repositorio).
- La situación de las entrevistas (observación 1 de la Etapa 1): sin contactos hasta hoy.

## 2. Retroalimentación recibida
Sobre el informe, en el orden en que la dio:
- **Título:** «Sistema integrado para el registro, gestión y monitoreo de sensores». Es un *sistema integrado*,
  no «una plataforma web»: esa expresión suena a «solo una página web», y es más que eso. El orden de las
  tres palabras es fijo: registro, gestión, monitoreo.
- **Objetivo general:** demasiado largo y disperso; «TCP/IP está de más»; debe decir solo qué se resuelve.
  Propuso una redacción centrada en una plataforma centralizada para registrar dispositivos y almacenar,
  gestionar y visualizar sus datos en un panel, al servicio de futuras actividades de investigación de la
  Facultad de Ingeniería; mencionó también la palabra «prototipo».
- **Objetivos específicos:** muy extensos, se dispersan.
- **Problema:** «solo se habla del problema», mala redacción; debe entenderse desde el primer párrafo cuál es
  el problema que se ataca.
- **Estado del arte:** se lee generado, con frases fragmentadas; no se entiende el contexto ni quiénes son
  los competidores. Debe contextualizar la oferta de **sistemas integrados** de registro, gestión y monitoreo
  de sensores (ThingsBoard y similares), no proveedores de sensores: el trabajo parte de que los sensores ya
  existen. Evitar términos que desvían del tema (TCP/IP, detalles de hardware).
- **Resumen:** mejorarlo en la misma línea.
- **Extensión:** el informe es demasiado extenso.

Sobre las entrevistas: entregó el contacto de un académico de la UCT que va a incorporar sensores en su
trabajo, y recomendó hacer la entrevista **por correo**, no presencial.

## 3. Cambios derivados de esta retroalimentación
> Esta sección es **evidencia directamente evaluada**: las Etapas 2, 3 y 4 asignan un 20 % a
> «incorpora la retroalimentación», y piden «ejemplos específicos de cambios en el proyecto».

| Indicación recibida | Cambio realizado | Dónde queda la evidencia (archivo / commit) |
|---|---|---|
| Entrevista por correo al académico referido | Correo enviado el 29/09 a las 23:20, con copia al profesor guía: 10 preguntas (perfil, magnitudes, cantidad, conectividad, uso, tiempo real, alertas, portabilidad de datos, acceso, disposición a probar) y solicitud de autorización para citar por rol | este registro; la respuesta se registrará con la plantilla de `docs/03 §3` |
| Título y objetivo general | pendiente: se fija primero, y después se propaga a todo lo que lo repite (resumen, cap. 1, conclusión, `docs/01`, `docs/02`, `RESUMEN.md`, `PLAN-MAESTRO.md`, `README.md`) | — |
| Estado del arte con competidores claros | pendiente: mapa en tres grupos (integradas de código abierto, integradas comerciales en la nube, oferta local atada a hardware) | — |
| Problema y objetivos específicos | pendiente: primera oración de cada sección dice qué se ataca; recortar | — |
| Extensión | pendiente: al corregir se recorta, no se agrega | — |

## 4. Pendientes
- [ ] Fijar título y objetivo general (decisión del estudiante sobre las redacciones propuestas; incluir «en tiempo real»).
- [ ] Reescribir estado del arte, problema, objetivos específicos y resumen con el criterio anterior.
- [ ] Propagar título y objetivo a todo el repositorio; correr el guardián.
- [ ] Registrar la respuesta del académico el día que llegue (`docs/03 §3`) e incorporarla (`docs/03 §4`).
- [ ] Si no responde antes del 2/10: informar por escrito al profesor guía antes de la entrega (`docs/03 §5`).

## 5. Compromiso para la próxima revisión
Entrega oficial de la Etapa 2 el viernes 2 de octubre con las correcciones de redacción incorporadas y la
entrevista registrada si hubo respuesta; si no, con el intento documentado.
