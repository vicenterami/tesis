# Instrumentos de levantamiento

> **Para qué sirve:** guion operativo para conseguir la evidencia que falta en la Etapa 1. Contiene a
> quién entrevistar, qué preguntar, y qué implica cada respuesta posible.
>
> **Cierra:** la brecha de fuente `[ENT]` de `docs/02-requerimientos.md` y el criterio 1 de la Etapa 1.
> **Versión:** 18 de agosto de 2026

---

# Parte 1 — Preguntas para el profesor guía

**Mario Villanueva es la llave de acceso a todo lo demás.** Sin resolver estas preguntas, las entrevistas
no se pueden agendar y la planificación no se puede cerrar. Van ordenadas por criticidad, no por orden de
conversación.

## 🔴 P1. ¿A quién debo entrevistar?

> *«Necesito recoger la percepción de las partes interesadas, que la rúbrica exige para el criterio 1.
> ¿Quién en la universidad tiene sensores desplegados y podría describirme el problema en sus propias
> palabras? ¿Me puede presentar o autorizar el contacto?»*

**Por qué es la más crítica:** es la única pregunta que **bloquea trabajo de otra persona**. Las demás las
puedes resolver solo o asumiendo un supuesto; esta no. Y de ella depende el 10 % del criterio 1 más el
respaldo del 45 % del criterio 3.

| Respuesta posible | Qué implica | Acción |
|---|---|---|
| Da uno o más nombres concretos | Ideal. Camino despejado | Pedir que envíe un correo de presentación el mismo día |
| «Habla con la Dirección de Informática» o similar, sin nombre | Hay que hacer el trabajo de identificación | Pedir al menos el área y llegar por ahí; ver Parte 2 |
| «Todavía no hay un caso concreto» | 🔴 **Riesgo R2 activado.** El propietario del proyecto es hipotético | Cambiar de estrategia: entrevistar externos (empresa de alarmas, pyme agrícola) y reformular a la universidad como usuario potencial, no como propietario. **Decírselo explícitamente para que quede constancia** |
| «No necesitas entrevistas» | La rúbrica sí las pide, textualmente | Mostrarle la frase de la pauta: *«Debe incluirse también la percepción de las partes interesadas para validar la relevancia del problema»*. No es negociable desde su lado; es del curso |

## 🔴 P2. ¿La Etapa 1 vence el 28 de agosto o el 11 de septiembre?

> *«La pauta que tengo está fechada el 13 de agosto de 2025 y sus hitos son de ese año. Con el calendario
> 2026 hay dos lecturas: si los sprints se cuentan desde el inicio del semestre, la Etapa 1 vence el
> viernes 28 de agosto; si se cuentan desde esta semana, el viernes 11 de septiembre. ¿Cuál es la
> correcta?»*

**Por qué es crítica:** invalida o valida toda la planificación, y son dos semanas de diferencia.

| Respuesta | Qué implica |
|---|---|
| 28 de agosto | El plan actual está correcto. Quedan ~10 días |
| 11 de septiembre | **Se ganan dos semanas.** Muy valioso dado el hallazgo de sobrecarga: pasan de 201 h a ~231 h de presupuesto, y la holgura del núcleo sube del 18 % al 29 % |
| «Las fechas cambiaron, son estas otras» | Recalcular todo el calendario. Es un comando |
| «No te preocupes de la fecha exacta» | 🔴 No aceptar esa respuesta. Insistir: sin fecha no hay planificación medible, y la nota P depende de superar el 70 % de los hitos **en plazo** |

## 🔴 P3. ¿Acepta la arquitectura de dos planos?

> *«Contact ID transporta eventos codificados, pero no puede transportar un valor: puede decir
> "temperatura alta en la zona 3", no "23,4 grados". Propongo dos planos: los eventos y alarmas en Contact
> ID con entrega confirmada, y las mediciones con valor en un formato complementario, correlacionados por
> la identidad del dispositivo. ¿Le parece correcto, o espera que todo pase por Contact ID?»*

**Por qué es crítica:** si responde que quiere Contact ID puro para todo, **hay que rediseñar** el
tratamiento de la telemetría, y eso afecta los requerimientos, la arquitectura y el backlog.

| Respuesta | Qué implica | Acción |
|---|---|---|
| «Correcto, así debe ser» | Lo esperado. El diseño queda validado | Registrarlo en bitácora como decisión aprobada |
| «Quiero Contact ID para todo» | Rediseño del plano de telemetría | Explicar el límite técnico con el ejemplo concreto. Si insiste, se puede codificar el valor en el campo `CCC` a costa de perder la identificación de zona: es posible pero **degrada el protocolo**. Documentarlo como decisión del profesor guía |
| «¿Y no sería mejor otro protocolo?» | Está cuestionando la elección | Para eso existe la matriz de 7 alternativas de la sección 6. Llevar el informe impreso |

**Preparación:** ten a mano el dato de que **Contact ID ocupa 8 bytes y el payload mínimo de LoRaWAN es
11**, mientras un JSON equivalente ocupa 60 a 150. Es el argumento más contundente.

## 🟡 P4. ¿Qué exige la carrera como entregable final?

> *«¿La entrega final es un prototipo funcional, un documento, o ambos? ¿Hay defensa oral o comisión?»*

| Respuesta | Qué implica |
|---|---|
| Prototipo + documento | El plan actual es correcto |
| Solo documento | Se puede reducir el peso de la implementación y reforzar diseño y validación. **Cambiaría el reparto de las 165 h** |
| Prototipo + defensa ante comisión | Hay que reservar tiempo para preparar la presentación, que hoy **no está en el backlog**. Añadir ~8 h |

## 🟡 P5. ¿Acepta que el alcance se acote al núcleo demostrativo?

> *«Estimé el backlog en horas y sumé: el alcance completo son 275 horas contra 201 disponibles con mi
> jornada laboral, un 37 % de exceso. El núcleo que demuestra la tesis son 165 horas y sí cabe, con 18 %
> de holgura. Propongo comprometer el núcleo y tratar el resto como alcance condicional. ¿Le parece?»*

**Por qué importa:** es una conversación que **te conviene tener ahora y no en octubre**. Además te posiciona
bien: muy pocos estudiantes llegan con una verificación numérica de su propio plan.

| Respuesta | Qué implica |
|---|---|
| «Bien, es lo razonable» | Queda documentado y protegido. **Registrarlo en bitácora con fecha** |
| «Deberías poder hacer más» | Pedirle que indique **qué elementos del alcance condicional considera indispensables**, y ajustar. Si añade, hay que quitar de otro lado |
| «Dedica más horas» | Es incompatible con jornada laboral completa. Exponerlo con la restricción RE-01 del documento |

## 🟡 P6. ¿Hay hardware disponible, o presupuesto para comprarlo?

> *«Para validar necesito al menos un gateway LoRaWAN y dos o tres nodos: unos 150 a 250 dólares. ¿La
> universidad tiene equipos disponibles en laboratorio, hay algún fondo, o corre por mi cuenta?»*

| Respuesta | Qué implica |
|---|---|
| Hay equipos en laboratorio | **Riesgo R1 desactivado.** Confirmar modelos exactos, porque el plan de frecuencias importa (AU915) |
| Hay presupuesto o fondo concursable | Iniciar el trámite de inmediato: los plazos de compra y envío pueden ser de semanas |
| Corre por tu cuenta | Decisión económica tuya. **El emulador de software (TT-28) mantiene la validación viable sin hardware**; el sensor físico solo añade la demostración |
| No hay nada | Riesgo R1 activo pero mitigado. Documentarlo como restricción, no como fracaso |

## 🟢 P7 a P10 — Preguntas de ajuste

| # | Pregunta | Qué implica la respuesta |
|---|---|---|
| **P7** | *¿Seis objetivos específicos son demasiados, o le parece bien el nivel de detalle?* | Si los ve excesivos, OE3 y OE4 se fusionan en «diseño de la solución y su despliegue». Cambio de 10 minutos |
| **P8** | *¿Los umbrales que puse son razonables? 50 eventos por segundo, 15 casos de prueba, detección de caída en 2 intervalos* | Si los considera altos, se bajan ahora. **Es mejor bajarlos antes de firmarlos que incumplirlos después** |
| **P9** | *¿Tiene preferencia de tecnología de implementación? Elegí TypeScript con NestJS por una matriz de 7 criterios* | Si tiene preferencia, se documenta como restricción del propietario. Si no, la matriz queda como justificación |
| **P10** | *¿Hay profesor secundario para las consultas de sensores y electrónica?* | Define a quién dirigir las dudas de hardware sin gastar el tiempo de Mario |

## Estrategia para la reunión del miércoles 26

Tienes una reunión, no diez. Reparte así:

1. **Entrega el PDF impreso al empezar.** Que lo tenga en la mano mientras conversan.
2. **P1 y P2 primero, siempre.** Si la reunión se corta, esas dos son las que no pueden quedar sin
   respuesta.
3. **P3 y P5 en el cuerpo de la conversación** — son las que generan discusión técnica y donde tu trabajo
   luce.
4. **P4, P6 a P10 al final**, o por correo si no alcanza el tiempo.
5. **Registra todo en bitácora el mismo día**, con la tabla «indicación recibida → cambio realizado →
   evidencia». Eso es el 20 % de las etapas siguientes.

---

# Parte 2 — A quién entrevistar

## 2.1 Prioridad: dentro de la universidad

El propietario declarado del proyecto es la universidad, así que la evidencia más valiosa viene de ahí.
Perfiles a buscar, en orden de utilidad:

| # | Perfil | Por qué sirve | Cómo llegar |
|---|---|---|---|
| **1** | **Encargado de laboratorios de la Facultad de Ingeniería** | Suele custodiar el equipamiento que ya se compró y quedó sin uso. Es la fuente más probable de la frase *«tenemos sensores y no sabemos qué hacer con ellos»* | Vía Mario, o directamente en la facultad |
| **2** | **Dirección de Informática / TI de la universidad** | Es el rol del administrador de red de tu tesis. Valida RNF-09 (segmentación) y RNF-10 (conexión saliente), que son tus requerimientos de anclaje al enfoque de redes | Vía Mario; puede requerir autorización formal |
| **3** | **Académico investigador con proyecto que use sensores** | En una universidad regional agrícola, las áreas de agronomía, recursos naturales y ciencias ambientales suelen tener sensores de campo. Muy probable que tengan datos que no procesan | Buscar en la página de proyectos de investigación de la UCT |
| **4** | **Encargado de mantención o servicios generales** | Cámaras de frío, salas de servidores, riego de áreas verdes, consumo eléctrico. Necesidades reales, no hipotéticas | Vía administración |
| **5** | **Vinculación con el medio / transferencia tecnológica** | Conocen empresas de la región con este problema. Puerta a un caso externo real | Vía Mario |

**Meta mínima: dos entrevistas.** Es lo que comprometiste en OE1. Con una del grupo 1 o 3 y una del
grupo 2 tienes cubierta tanto la perspectiva del dueño del dato como la del administrador de red.

## 2.2 Complemento: fuera de la universidad

Refuerzan el estudio de mercado y validan decisiones técnicas concretas. **No sustituyen las internas.**

| Perfil | Qué valida | Pregunta clave |
|---|---|---|
| **Empresa de alarmas o central de monitoreo de Temuco** | Valida el criterio C-C: interoperabilidad con lo instalado. **Confirma empíricamente que Contact ID sigue vigente en Chile** | *«¿Qué protocolo reciben sus paneles en la central? ¿Contact ID, SIA, ambos? ¿Por IP o por celular?»* |
| **Agricultor o pyme con sensores instalados** | Valida las causas C2 y C3 con un caso real y externo | *«¿Puede sacar sus datos de la plataforma del proveedor?»* |
| **Integrador o proveedor local de IoT** | Contrasta el análisis de competencia | *«¿Qué le piden los clientes que hoy no pueden ofrecer?»* |

> **Una sola entrevista con una central de monitoreo local vale mucho.** Si te confirman que reciben
> Contact ID a diario, tu criterio C-C deja de ser argumentado y pasa a ser verificado en terreno. Es el
> tipo de evidencia que distingue un trabajo de titulación de un ensayo.

---

# Parte 3 — Guion de entrevista

**Formato:** semiestructurada, 25 a 40 minutos. Las preguntas son guía, no cuestionario: si la persona se
va por un camino interesante, seguirlo.

**Regla de oro:** ellos hablan, tú anotas. Si hablas más del 30 % del tiempo, la entrevista falló.

## Bloque 0 — Apertura (2 min)

> *«Estoy haciendo mi trabajo de título sobre una plataforma para administrar datos de sensores. No vengo
> a ofrecerle nada ni a venderle nada: vengo a entender si el problema que creo que existe, existe de
> verdad. ¿Le molesta si anoto lo que me diga y cito alguna frase suya en el informe? Puedo mantenerlo
> anónimo si prefiere.»*

**Por qué así:** pedir permiso explícito para citar es lo que te habilita a usar la cita textual en el
informe. Sin eso, no puedes citarla.

## Bloque 1 — Inventario actual (5 min)

*Objetivo: saber qué hay. Sin juicio, solo hechos.*

1. ¿Qué sensores o dispositivos de medición tienen instalados hoy?
2. ¿Cuántos, aproximadamente? ¿Dónde están?
3. ¿Cómo se comunican? ¿WiFi, cable, radio, tarjeta SIM? ¿Lo sabe, o lo instaló un tercero?
4. ¿Hace cuánto están? ¿Quién los eligió?
5. ¿Están todos funcionando hoy?

> **Pregunta 5 es más reveladora de lo que parece.** Si la respuesta es *«no sé»* o *«creo que algunos
> no»*, acabas de obtener evidencia directa de la causa **C5**.

## Bloque 2 — Qué pasa con los datos (10 min) — *el bloque central*

6. ¿Dónde llegan los datos que generan esos sensores?
7. ¿Quién los mira? ¿Con qué frecuencia?
8. ¿Puede ver el historial de hace tres meses? ¿Cómo?
9. **¿Podría descargar todos sus datos y llevárselos a otra parte?**
10. Si mañana quisiera agregar un sensor de otra marca, ¿qué pasaría?
11. ¿Paga algo mensual por la plataforma o el servicio?

| Pregunta | Causa que valida |
|---|---|
| 6, 7, 8 | **C1** fragmentación · **C4** falta de capacidad interna |
| **9** | **C3** dependencia comercial · **E5** dependencia de proveedor |
| **10** | **C2** acoplamiento hardware-plataforma |
| 11 | **C3** costo |

> **La pregunta 9 es la más importante de toda la entrevista.** Si la respuesta es *«no sé»*, *«creo que
> no»* o *«habría que pedirle al proveedor»*, tienes validada la causa C3 con evidencia de campo. Y es la
> pregunta que justifica tu requerimiento **RF-34** (exportación en formato abierto).

## Bloque 3 — El dolor concreto (8 min)

12. ¿Le ha pasado que un sensor deje de reportar y se enteren tarde?
13. ¿Cómo se enteraron? ¿Alguien lo notó, o falló algo primero?
14. ¿Cuánto tiempo pasó entre que dejó de funcionar y que lo supieron?
15. ¿Qué consecuencia tuvo?
16. ¿Hay alguna decisión que hoy tomen «a ojo» y que preferirían tomar con dato?

> **Las preguntas 12 a 15 son la mina de oro.** Un incidente concreto con consecuencia concreta convierte
> la causa C5 de afirmación teórica en hecho documentado. Si te cuentan uno, **pide detalles y anota
> literalmente**.

## Bloque 4 — Validación de requerimientos (8 min)

*Aquí contrastas tu catálogo con la realidad. Describe la capacidad, no el requerimiento.*

17. Si existiera una pantalla que le mostrara todos sus sensores y cuáles están respondiendo, ¿la usaría?
    ¿Con qué frecuencia?
18. ¿Preferiría que le avise por correo, por mensaje, o que simplemente quede registrado?
19. ¿Le sirve poder agrupar los sensores por edificio, sector o proyecto?
20. ¿Qué es más importante: ver el valor exacto, o que le avisen cuando algo se sale del rango?
21. ¿Quién debería poder ver estos datos y quién no?

| Pregunta | Requerimientos que valida |
|---|---|
| 17 | RF-47, RF-48, HU-19 |
| 18 | RF-36, RF-37, HU-24 |
| 19 | RF-21, HU-12 |
| **20** | **Valida directamente la arquitectura de dos planos** |
| 21 | RF-41, RF-44 (multi-tenencia y roles) |

> **La pregunta 20 es tu validación de diseño.** Si responden que lo importante es *«que me avisen cuando
> algo se sale del rango»*, eso respalda la primacía del plano de eventos y por tanto la elección de
> Contact ID. Si responden que necesitan el valor exacto permanentemente, refuerza el plano de telemetría.
> **Cualquiera de las dos respuestas te sirve**; lo que importa es tenerla documentada.

## Bloque 5 — Cierre (3 min)

22. Si esto existiera y fuera gratis, ¿lo probaría? ¿Con qué sensores empezaría?
23. ¿Hay alguien más con quien debería hablar sobre esto?
24. ¿Puedo volver a consultarle si me surgen dudas durante el desarrollo?

> **La pregunta 23 multiplica tus entrevistas.** Y la 24 te abre la puerta para las Etapas 3 y 4, cuando
> necesites validar el prototipo con un usuario real: eso es exactamente lo que la Etapa 4 pide como
> «necesidades del usuario final».

## La pregunta que cierra el criterio 1

Si la entrevista se corta y solo puedes hacer una pregunta, es esta:

> ### *«¿Qué es lo más frustrante de tener estos sensores instalados?»*

Es abierta, invita a desahogarse, y la respuesta suele venir en la forma exacta de cita textual que la
rúbrica pide: la percepción de la parte interesada, en sus propias palabras.

---

# Parte 4 — Cómo registrar y convertir en evidencia

## 4.1 Durante la entrevista

- **Anota frases textuales, no resúmenes.** «Nadie revisa eso» vale más que «no hay revisión periódica».
- Marca con comillas lo literal y con corchetes lo que interpretaste.
- Si autorizan grabar, graba; si no, dedica los 5 minutos siguientes a completar las notas antes de que
  se enfríen.
- **No corrijas al entrevistado** aunque diga algo técnicamente impreciso. Su percepción *es* el dato.

## 4.2 Después: el archivo de registro

Crear un archivo por entrevista en `bitacora/`, con este formato:

```
bitacora/2026-08-XX-entrevista-<rol>.md

# Entrevista — <rol o cargo> — <fecha>
- Modalidad, duración
- Autorización de cita: sí / sí anonimizada / no

## Inventario declarado
## Citas textuales
> «...»                       <- literal, entre comillas
## Incidentes relatados
## Requerimientos que valida o refuta
| Cita o hecho | Causa que valida | Requerimiento afectado |
## Requerimientos nuevos que surgieron
## Contactos derivados
```

## 4.3 Cómo se incorpora al informe

| Destino | Qué se agrega |
|---|---|
| `docs/01-problema-y-objetivos.md`, secc. 1.5 | Las citas textuales, como validación de relevancia |
| `docs/01-problema-y-objetivos.md`, secc. 1.6 | Estado del levantamiento: de «pendiente» a «realizado» |
| `docs/02-requerimientos.md`, secc. 1.1 | Habilitar la fuente `[ENT]` y reasignar los requerimientos que ahora tengan respaldo directo |
| `docs/02-requerimientos.md` | Agregar los requerimientos nuevos que hayan surgido |
| `informe/secciones/02-problema.tex` | Reemplazar el recuadro rojo de brecha por las citas obtenidas |
| `bitacora/` | El registro completo, como anexo de evidencia |

> **Un requerimiento que nazca de una entrevista es más valioso que diez derivados de la teoría.** Si
> alguien pide algo que no está en el catálogo, **agrégalo y déjalo marcado como `[ENT]`**: es la prueba
> de que el levantamiento sirvió para algo y no fue un trámite.

## 4.4 Si las entrevistas no se consiguen

Plan de contingencia, en orden:

1. **Documentar el intento**: a quién se escribió, cuándo, qué respondieron. Un intento documentado vale
   más que un silencio.
2. **Sustituir por fuentes externas**: empresa de alarmas, pyme, integrador. Es evidencia de campo aunque
   no sea del propietario declarado.
3. **Reformular el rol de la universidad** en el informe: de «propietario del proyecto» a «usuario
   potencial identificado», y declarar el cambio como desviación justificada.
4. **Informar a Mario por escrito** antes de la entrega, no después. Que la limitación sea conocida y no
   descubierta.
