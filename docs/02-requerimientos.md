> ⚠️ **ACTUALIZADO AL PIVOTE DEL 02/09/2026:** el contrato de entrada es **SenML (RFC 8428) sobre
> MQTT**, con HTTP como vía secundaria y adaptadores por formato; Contact ID quedó descartado
> (evaluación nueva en `docs/06`). El término anterior se reemplazó por «recepción» en todo el catálogo.

# Análisis de requerimientos

> **Cubre:** criterio 3 de la Etapa 1 (**45 %**, el de mayor peso) · sustenta **OE1**
> **Fase PPDIOO:** Prepare + Plan
> **Versión:** borrador 1 — 18 de agosto de 2026
>
> La rúbrica exige que los requerimientos estén «completos, bien documentados, claramente vinculados a
> los objetivos del proyecto, y adecuadamente justificados con datos o teorías sólidas», con «una
> evaluación crítica de alternativas consideradas y las razones para la selección final». Este
> documento se organiza en torno a esas dos exigencias.

---

## Índice

1. [Metodología del levantamiento y fuentes](#1-metodología-del-levantamiento-y-fuentes)
2. [Requerimientos funcionales](#2-requerimientos-funcionales)
3. [Requerimientos no funcionales](#3-requerimientos-no-funcionales)
4. [Priorización y alcance del producto mínimo](#4-priorización-y-alcance-del-producto-mínimo)
5. [Matriz de trazabilidad](#5-matriz-de-trazabilidad)
6. [Evaluación crítica de alternativas de solución](#6-evaluación-crítica-de-alternativas-de-solución)
7. [Restricciones y supuestos](#7-restricciones-y-supuestos)

---

# 1. Metodología del levantamiento y fuentes

## 1.1 Fuentes utilizadas

Cada requerimiento declara su origen. Se emplean cuatro tipos de fuente, con distinto peso probatorio:

| Código | Fuente | Peso probatorio |
|---|---|---|
| **[PO]** | **Solicitud del propietario del proyecto** — indicaciones de la universidad transmitidas por el profesor guía, registradas en `bitacora/2026-08-17-reunion-mario.md` | Alto: es requerimiento declarado, no inferido |
| **[EM]** | **Estudio de mercado** — análisis de la oferta regional (IoT3, ControlTec) y del sector de alarmas monitoreadas | Medio-alto: evidencia de lo que el mercado cubre y no cubre |
| **[BT]** | **Base teórica** — estándares (SIA DC-05, DC-09, LoRaWAN RP002, ISO/IEC 25010, RFC 8428) y literatura técnica | Alto para requerimientos técnicos |
| **[DP]** | **Derivación del problema** — consecuencia lógica de una causa identificada en `docs/01-problema-y-objetivos.md` | Medio: requiere que la causa esté bien fundada |

> 🔴 **Brecha declarada.** Falta la fuente **[ENT]** — entrevistas directas a las partes interesadas.
> Las entrevistas al responsable técnico de los sensores de la universidad están pendientes. Hasta
> obtenerlas, los requerimientos marcados **[PO]** se sustentan en la indicación transmitida por el
> profesor guía, no en el levantamiento directo. **Esta brecha se declara explícitamente en lugar de
> disimularla**, y su cierre es la acción prioritaria de la Etapa 1.
>
> **Actualización 21/09/2026:** el profesor guía pidió realizar y documentar las entrevistas de inmediato.
> Plan: dos perfiles (responsable de laboratorios de la Facultad; dirección de informática), contactos
> solicitados al profesor guía, primera entrevista dentro de la Etapa 2 y catálogo validado al 30/10 (OE1,
> hito 2). Guion y registro: `docs/03` §2 y §3. Detalle: `bitacora/2026-09-21-retroalimentacion-etapa1.md`.

## 1.2 Convención de identificación

- **RF-nn** — requerimiento funcional
- **RNF-nn** — requerimiento no funcional
- Prioridad **MoSCoW**: **M** (*Must*, indispensable para el MVP de la tesis) · **S** (*Should*,
  importante pero postergable) · **C** (*Could*, deseable) · **W** (*Won't*, fuera de alcance
  declarado)

## 1.3 Módulos de la solución

| Módulo | Responsabilidad |
|---|---|
| **M1** | Recepción multiprotocolo |
| **M2** | Normalización de eventos y telemetría |
| **M3** | Inventario y aprovisionamiento de dispositivos |
| **M4** | Supervisión de salud de enlace |
| **M5** | Persistencia y consulta |
| **M6** | Alertas y notificación |
| **M7** | Seguridad, identidad y multi-tenencia |
| **M8** | Interfaz de administración |

---

# 2. Requerimientos funcionales

## M1 — Recepción multiprotocolo

| ID | Requerimiento | Fuente | Causa | Prior. |
|---|---|---|---|:---:|
| **RF-01** | El sistema debe exponer un punto de recepción **HTTP** que acepte tramas de medición en **SenML (RFC 8428)** | [PO] [BT] | C1 | **M** |
| **RF-02** | El sistema debe poder recibir mediciones de la **rama LoRaWAN** a través del servidor de red, que las publica en MQTT (obligatoria desde el 08/10/2026: ruta B, pasarela con servidor de red embebido) | [PO] [BT] | C1, C2 | **M** |
| **RF-03** | El sistema debe recibir eventos publicados en un **broker MQTT**, suscribiéndose a los tópicos configurados por sitio | [PO] | C1, C2 | **M** |
| **RF-04** | El sistema debe admitir **adaptadores de formato por fuente** que traduzcan al modelo interno tramas que no lleguen en SenML, sin modificar el núcleo | [EM] [BT] | C2 | **S** |
| **RF-05** | El sistema debe **validar cada trama** contra el esquema SenML y contra el registro del dispositivo, rechazando las inválidas sin contaminar las series | [BT] | C1 | **M** |
| **RF-06** | El sistema debe **confirmar la recepción** al emisor: nivel de QoS acordado en MQTT y código de respuesta en HTTP | [BT] | C1 | **M** |
| **RF-07** | El sistema debe **poner en cuarentena** las tramas rechazadas —crudas, con su motivo— y registrar los intentos de dispositivos desconocidos | [DP] | C5 | **S** |
| **RF-08** | El sistema debe aceptar **múltiples mediciones por trama** (lista SenML con nombre, valor, unidad y tiempo por medición) | [BT] | C1 | **M** |
| **RF-09** | El sistema debe **preservar los metadatos del transporte** de cada recepción (RSSI, SNR, gateway, identificador del nodo) asociándolos al evento | [BT] [DP] | C5 | **M** |
| **RF-10** | El sistema debe **descartar duplicados** cuando el mismo evento llegue por más de un camino o gateway | [BT] | C1 | **S** |

**Justificación ampliada de RF-04.** Es el requerimiento que distingue la solución de la oferta
existente. El análisis del sector muestra que las centrales de monitoreo en operación hablan Contact
ID sobre DC-09, y ni IoT3 ni ControlTec ofrecen un punto de recepción compatible. Aceptar mensajes de
paneles instalados **sin modificarlos** convierte al parque existente en fuente de datos, en lugar de
exigir su reemplazo. Se prioriza como *Should* y no *Must* porque el MVP puede demostrarse sin él,
pero su valor demostrativo es alto.

## M2 — Normalización de eventos y telemetría

| ID | Requerimiento | Fuente | Causa | Prior. |
|---|---|---|---|:---:|
| **RF-11** | El sistema debe **normalizar toda trama aceptada al modelo interno único** (dispositivo, magnitud, unidad, valor, marca temporal), venga de la vía y formato que venga | [PO] [BT] | C1 | **M** |
| **RF-12** | El sistema debe mantener **condiciones abiertas y cerradas** por dispositivo: el cruce de umbral abre la condición y la vuelta al rango la cierra | [BT] | C1, C5 | **M** |
| **RF-13** | El sistema debe **generar eventos por umbral** cuando una medición cruce un límite configurado | [PO] | C1 | **M** |
| **RF-14** | El sistema debe permitir **configurar umbrales de disparo y de restauración por dispositivo**, con banda de histéresis para evitar oscilación | [BT] | C5 | **S** |
| **RF-15** | El sistema debe **correlacionar eventos con telemetría** mediante el identificador del dispositivo (`bn` / `id_fisico`) y la marca temporal, para reconstruir el contexto de un evento | [DP] | C1 | **S** |
| **RF-16** | El sistema debe **normalizar las marcas temporales** a un huso único, tolerando que el nodo no disponga de reloj confiable y usando la hora de recepción cuando corresponda | [BT] | C1 | **M** |
| **RF-17** | El sistema debe **resolver la identidad del dispositivo** desde los metadatos del transporte cuando el mensaje no la incluya explícitamente | [DP] | C1 | **M** |

## M3 — Inventario y aprovisionamiento de dispositivos

| ID | Requerimiento | Fuente | Causa | Prior. |
|---|---|---|---|:---:|
| **RF-18** | El sistema debe mantener un **inventario de dispositivos** con tipo, ubicación, sitio, zona lógica, transporte de llegada y estado | [PO] | C4, C5 | **M** |
| **RF-19** | El sistema debe permitir **registrar un dispositivo nuevo** asignándole su identificador físico, credencial y canales, sin intervenir la consola del servidor de red | [PO] [EM] | C4 | **M** |
| **RF-20** | El sistema debe **rechazar el registro** de un dispositivo cuyo identificador físico ya exista | [BT] | C1 | **S** |
| **RF-21** | El sistema debe permitir **agrupar dispositivos por sitio y por zona lógica**, y presentar la vista agrupada | [PO] | C4 | **M** |
| **RF-22** | El sistema debe permitir **marcar un dispositivo en mantenimiento**, suprimiendo sus alertas y dejando registro del período | [BT] | C5 | **C** |
| **RF-23** | El sistema debe registrar **quién realizó cada cambio de configuración de un dispositivo y cuándo** | [BT] | C5 | **S** |

## M4 — Supervisión de salud de enlace

| ID | Requerimiento | Fuente | Causa | Prior. |
|---|---|---|---|:---:|
| **RF-24** | El sistema debe **detectar la pérdida de comunicación** de un dispositivo cuando no reporte durante un número configurable de intervalos, y abrir la condición correspondiente | [PO] [BT] | **C5** | **M** |
| **RF-25** | El sistema debe **detectar la restauración** del dispositivo y cerrar la condición, registrando la duración de la interrupción | [BT] | C5 | **M** |
| **RF-26** | El sistema debe registrar la **última vez que se recibió** comunicación de cada dispositivo | [PO] | C5 | **M** |
| **RF-27** | El sistema debe **presentar la calidad del enlace** por dispositivo (RSSI, SNR y porcentaje de recepción) cuando el transporte la provea | [BT] | C5 | **M** |
| **RF-28** | El sistema debe **procesar lecturas de batería bajo el umbral configurado** (magnitud `bateria`) y exponer los dispositivos que requieren mantenimiento | [PO] [BT] | C5 | **M** |
| **RF-29** | El sistema debe **aprovechar el *keep-alive* y el *Last Will* de MQTT** como evidencia de conexión y aviso inmediato de desconexión | [BT] | C5 | **M** |
| **RF-30** | El sistema debe presentar un **indicador agregado de salud por sitio**: total de dispositivos, en línea, con condición abierta y sin supervisión | [PO] | C4, C5 | **M** |

**Justificación ampliada del módulo M4.** Responde directamente a la causa C5. (En la Etapa 1 se justificó
además como diferencia frente a la oferta regional; no lo es frente a todos los competidores: ThingsBoard, por
ejemplo, marca como inactivo a un dispositivo sin actividad, según su documentación de *connectivity status*.
El posicionamiento vigente está en el informe §1.2.) La causa C5 —el silencio de un sensor es indistinguible de la ausencia de novedades— solo se
resuelve con supervisión activa, no con visualización de mediciones. Todos los requerimientos de este
módulo salvo uno son *Must*.

## M5 — Persistencia y consulta

| ID | Requerimiento | Fuente | Causa | Prior. |
|---|---|---|---|:---:|
| **RF-31** | El sistema debe **almacenar de forma persistente** todo evento aceptado, conservando el mensaje original íntegro junto a su interpretación | [BT] [DP] | C1 | **M** |
| **RF-32** | El sistema debe **almacenar series de tiempo** de telemetría con valor, unidad y marca temporal | [PO] | C1 | **M** |
| **RF-33** | El sistema debe permitir **consultar el historial** de eventos y mediciones de un dispositivo en un rango de fechas | [PO] | C4 | **M** |
| **RF-34** | El sistema debe permitir **exportar** los datos de un sitio en formatos abiertos (CSV, XLSX y JSON) | [PO] [EM] | **C3, C5** | **M** |
| **RF-35** | El sistema debe exponer una **API de consulta** que permita a sistemas externos acceder a los datos del sitio | [PO] | C3 | **S** |

**Justificación ampliada de RF-34.** La exportación en formato abierto no es una comodidad: es el
requerimiento que **materializa la ausencia de dependencia de proveedor** (causa C3, efecto E5). Una
plataforma que declara ser abierta y no permite retirar los datos reproduce el problema que pretende
resolver. Es *Must* por coherencia con la propuesta de valor.

## M6 — Alertas y notificación

| ID | Requerimiento | Fuente | Causa | Prior. |
|---|---|---|---|:---:|
| **RF-36** | El sistema debe **notificar** cuando se abra una condición de severidad configurada como notificable | [PO] | C5 | **M** |
| **RF-37** | El sistema debe permitir **configurar los destinatarios** de notificación por sitio | [PO] | C4 | **S** |
| **RF-38** | El sistema debe **agrupar notificaciones repetidas** del mismo dispositivo en una ventana temporal, para evitar saturación | [BT] | C5 | **S** |
| **RF-39** | El sistema debe permitir **reconocer una alerta**, registrando quién y cuándo | [BT] | C5 | **C** |

## M7 — Seguridad, identidad y multi-tenencia

| ID | Requerimiento | Fuente | Causa | Prior. |
|---|---|---|---|:---:|
| **RF-40** | El sistema debe **autenticar toda recepción** mediante credencial por sitio, rechazando mensajes sin credencial válida | [BT] | C1 | **M** |
| **RF-41** | El sistema debe **aislar los datos entre sitios**: ningún usuario de un sitio puede acceder a datos de otro | [BT] [DP] | C3 | **M** |
| **RF-42** | El sistema debe **cifrar el transporte** de toda comunicación externa: TLS para HTTP y MQTT (la rama LoRaWAN trae AES-128 de fábrica) | [BT] | C1 | **M** |
| **RF-43** | El sistema debe **autenticar a los usuarios** de la interfaz de administración con credenciales individuales | [BT] | C4 | **M** |
| **RF-44** | El sistema debe distinguir al menos **dos roles**: administrador del sitio y usuario de consulta | [PO] | C4 | **S** |
| **RF-45** | El sistema debe permitir **rotar las credenciales de recepción** de un sitio sin interrumpir el servicio | [BT] | C1 | **C** |
| **RF-46** | El sistema debe **registrar en bitácora** los accesos y las operaciones sensibles | [BT] | C5 | **S** |

## M8 — Interfaz de administración

| ID | Requerimiento | Fuente | Causa | Prior. |
|---|---|---|---|:---:|
| **RF-47** | La interfaz debe presentar el **inventario de dispositivos** con su estado y transporte de llegada, filtrable por sitio, zona y estado | [PO] | C4 | **M** |
| **RF-48** | La interfaz debe presentar el **panel de salud del sitio** con semáforo por dispositivo | [PO] | C5 | **M** |
| **RF-49** | La interfaz debe presentar el **detalle de un dispositivo**: identidad, condiciones abiertas, historial de eventos y serie de mediciones | [PO] | C4 | **M** |
| **RF-50** | La interfaz debe ofrecer el **asistente de registro** de un dispositivo nuevo | [PO] | C4 | **M** |
| **RF-51** | La interfaz debe presentar la **vista agrupada por transporte de red**, mostrando cuántos dispositivos llegan por cada tecnología | [PO] [DP] | C1, C2 | **S** |
| **RF-52** | La interfaz debe ser **utilizable desde un navegador móvil** | [EM] | C4 | **S** |

**Justificación de RF-52.** El análisis de la oferta regional muestra que ControlTec destaca la
supervisión desde el teléfono como característica comercial. Es una expectativa establecida del
mercado local, no una preferencia estética.

---

# 3. Requerimientos no funcionales

Clasificados según las características de calidad de **ISO/IEC 25010**.

## 3.1 Eficiencia de desempeño

| ID | Requerimiento | Métrica de verificación | Fuente | Prior. |
|---|---|---|---|:---:|
| **RNF-01** | El sistema debe sostener la recepción de **≥ 50 eventos por segundo** sin pérdida | Prueba de carga con generador sintético | [DP] | **M** |
| **RNF-02** | El tiempo desde la recepción de un evento hasta su disponibilidad para consulta debe ser **≤ 2 segundos** en el percentil 95 | Medición instrumentada | [DP] | **M** |
| **RNF-03** | El sistema debe **detectar la pérdida de supervisión** de un dispositivo en **≤ 2 intervalos** de reporte configurados | Prueba funcional con nodo silenciado | [PO] | **M** |
| **RNF-04** | Una consulta de historial de 30 días de un dispositivo debe responder en **≤ 3 segundos** | Medición con volumen sintético | [DP] | **S** |

> **Fundamento de las cifras (agregado el 21/09/2026 tras la retroalimentación).** La carga del caso de
> validación es de 50 canales que reportan cada 5 minutos: 50 / 300 s ≈ **0,17 lecturas por segundo**,
> unas 14 400 al día y 5,3 millones al año (`docs/14`). **RNF-01 (50 mensajes/s)** es una meta de estrés
> unas 300 veces mayor que esa carga: equivale a 15 000 canales a 5 minutos, o a que los 50 canales del
> campus reenvíen una cola acumulada tras una caída de red. Se fija para demostrar holgura en el servidor
> de referencia (2 vCPU y 4 GB, `docs/14`), no para describir la operación normal; Mosquitto y
> PostgreSQL sostienen órdenes de magnitud más en ese hardware, así que la cifra es conservadora respecto
> de la capacidad y exigente respecto del caso. **RNF-02 (≤ 2 s en el percentil 95)**: el percentil 95 es
> la convención habitual para metas de latencia (el 5 % peor se excluye para no medir picos aislados); los
> 2 segundos salen del panel en tiempo real, donde una lectura debe aparecer antes de la siguiente
> actualización visible. Ambas cifras son estimaciones nuestras de la Etapa 1 y se **miden** en la Etapa 4
> (TT-29) con el emulador de nodo publicando a tasa creciente y contando filas guardadas y perdidas.

## 3.2 Fiabilidad

| ID | Requerimiento | Métrica de verificación | Fuente | Prior. |
|---|---|---|---|:---:|
| **RNF-05** | Ningún evento aceptado y confirmado puede perderse ante un reinicio del sistema | Prueba de recuperación ante falla | [BT] | **M** |
| **RNF-06** | El sistema debe **reanudar la recepción automáticamente** tras recuperarse de una interrupción, sin intervención manual | Prueba de reinicio | [BT] | **M** |
| **RNF-07** | La indisponibilidad de un adaptador de transporte **no debe afectar** la recepción por los demás | Prueba de aislamiento de fallas | [DP] | **S** |

## 3.3 Seguridad

| ID | Requerimiento | Métrica de verificación | Fuente | Prior. |
|---|---|---|---|:---:|
| **RNF-08** | Ninguna credencial debe almacenarse en texto claro, ni en base de datos ni en el repositorio de código | Inspección y revisión del repositorio | [BT] | **M** |
| **RNF-09** | Los dispositivos IoT deben poder residir en un **segmento de red separado** del segmento de usuarios, con acceso restringido solo a los puertos de recepción | Diseño de red verificado y documentado | [BT] | **M** |
| **RNF-10** | El sistema **no debe requerir puertos entrantes abiertos hacia los dispositivos**: la conexión siempre se inicia desde el dispositivo hacia la plataforma | Revisión de arquitectura | [BT] | **M** |

**Justificación de RNF-09 y RNF-10.** Son los dos requerimientos que anclan el trabajo al enfoque de
redes del profesor guía. RNF-10 en particular resuelve el problema de alcanzabilidad de dispositivos
detrás de NAT y cortafuegos: la práctica correcta es que el dispositivo establezca la conexión
saliente, nunca exponer el dispositivo a internet. RNF-09 corresponde a segmentación de red
—material de administración de infraestructura— y es lo que impide que un sensor comprometido alcance
la red corporativa.

## 3.4 Mantenibilidad

| ID | Requerimiento | Métrica de verificación | Fuente | Prior. |
|---|---|---|---|:---:|
| **RNF-11** | El código debe residir en un **repositorio git** con mensajes de commit descriptivos en la totalidad de ellos | Inspección del historial | [BT] | **M** |
| **RNF-12** | Añadir un **transporte nuevo** debe requerir implementar solo un adaptador, sin modificar el núcleo de normalización | Revisión de diseño y prueba de extensión | [DP] | **M** |
| **RNF-13** | La especificación del protocolo debe estar **documentada de forma independiente** de la implementación | Existencia del documento | [PO] | **M** |

**Justificación de RNF-12.** Es la traducción arquitectónica de la indicación del profesor guía de no
cerrarse a una sola tecnología. Si añadir un transporte obliga a modificar el núcleo, la plataforma no
es realmente multiprotocolo: es monoprotocolo con excepciones.

## 3.5 Portabilidad y compatibilidad

| ID | Requerimiento | Métrica de verificación | Fuente | Prior. |
|---|---|---|---|:---:|
| **RNF-14** | El sistema debe poder **desplegarse completo en un único servidor** con recursos modestos, sin dependencia de servicios propietarios de nube | Despliegue verificado en máquina local | [PO] | **M** |
| **RNF-15** | El sistema debe construirse **exclusivamente con componentes de código abierto**, sin licencias de pago | Inventario de dependencias | [PO] | **M** |
| **RNF-17** | La plataforma completa (broker, base de datos, backend, interfaz y, de existir, el servidor de red) debe **consumir a lo más 2 GB de memoria RAM**, en reposo y bajo carga, en un servidor de 4 GB (la mitad del servidor recomendado), por debajo del mínimo que declara el referente de código abierto (ThingsBoard CE: 4 GB) | Medición de consumo en reposo y bajo carga en la Etapa 4 (`docker stats`) | [DP] [EM] | **M** |
| **RNF-18** | La recepción debe tener una **disponibilidad ≥ 99 %** en una ventana continua de 72 horas (≤ 43 min de indisponibilidad) — agregado 22/09/2026 tras la retroalimentación (observación 6), umbral de OE5 que no tenía RNF de respaldo | Emulador publicando cada minuto en el banco de pruebas de la Etapa 4; se cuentan las ventanas sin confirmación | [DP] | **M** |
| **RNF-16** | La trama nativa debe cumplir **SenML (RFC 8428)**; la rama LoRaWAN debe caber en el payload disponible del plan regional | Validación de esquema + verificación de tamaño | [BT] | **M** |

**Justificación de RNF-14 y RNF-15.** Provienen directamente de la indicación del propietario del
proyecto: plataforma «gratuita o abierta», con la universidad como destinataria. RNF-14 además habilita
la respuesta a OE3 sobre alojamiento y costo: un sistema que solo funciona en nube propietaria tiene un
costo de operación irreducible; uno que corre en un servidor propio permite el escenario de costo
marginal cero para la institución.

**Desviación de RNF-15: declarada el 30/09/2026, resuelta el 06/10/2026.** La compresión, las políticas
automáticas y los agregados continuos de TimescaleDB están bajo la *Timescale License* (gratuita y de fuente disponible,
https://github.com/timescale/timescaledb/blob/main/tsl/LICENSE-TIMESCALE; no figura entre las licencias aprobadas por la
OSI, https://opensource.org/licenses, consultada el 08/10/2026). Tras evaluar nueve bases de series de tiempo y probar la edición Apache 2.0 de
TimescaleDB con el esquema real (fallan exactamente esas funciones y nada más; laboratorio del 06/10), **se adopta la
edición Apache** (`timescale/timescaledb:2.24.0-pg16-oss`; actualizada a `2.30.2` con parches el 08/10/2026, `docs/16 §12`): hypertables, `time_bucket` con zona nombrada y
`drop_chunks` son Apache y son lo que el sistema usa. Costo aceptado: sin compresión, el escenario de `docs/14` ocupa
≈ 330 MB por año más índices (diez años ≈ 4,6 GB); la retención se ejecuta con `drop_chunks` desde una tarea
programada del backend y los agregados se materializan por tarea. RNF-15 vuelve a cumplirse en su redacción literal.
El cambio de imagen y de esquema es trabajo de la Etapa 3 (`docs/10 §8.4`, punto 11).

**Verificación automática de RNF-15 (08/10/2026).** El guardián (`plataforma/pruebas/verificar-todo.sh`, paso 2r) revisa
en cada corrida las licencias de las dependencias de producción del backend (`pnpm licenses ls --prod`) contra una lista
de licencias abiertas y permisivas (MIT, BSD, Apache, ISC y equivalentes, con Zlib desde el 08/10 porque la trae la exportación a XLSX; la lista exacta vive
en ese paso). Al 08/10 son
172 paquetes al 12/10/2026 (incluye el panel, que vive en el mismo workspace, con uPlot), todos dentro. Una licencia fuera de la lista hace fallar el paso aunque sea abierta: una dependencia copyleft (GPL, AGPL) dentro del
backend obligaría a distribuir el conjunto bajo una licencia compatible con la suya y cerraría la opción de una licencia
comercial adicional; SSPL o BUSL no son de código abierto. Esa decisión se toma a conciencia, no al agregar un paquete.

**RNF-17 (06/10/2026).** Se mantiene como requisito: la memoria es un criterio ponderado al comparar brokers y bases,
no un veto. Si la evolución del proyecto exigiera superar los 2 GB (por ejemplo, un broker con más capacidades), se
renegocia con el profesor guía antes de cambiar OE5: los requisitos evolucionan, pero no se incumplen en silencio.
Redacción corregida el 06/10/2026: decía «operar en un servidor de 2 GB de memoria», ambiguo (¿RAM o disco?) e
incoherente con OE5 («a lo más 2 GB, la mitad del servidor recomendado»). El límite es de **RAM consumida**; el
almacenamiento en disco no tiene requisito propio y se dimensiona en `docs/14 §2`.

---

# 4. Priorización y alcance del producto mínimo

## 4.1 Distribución MoSCoW

| Prioridad | Funcionales | No funcionales | Total |
|---|:---:|:---:|:---:|
| **Must** — indispensable para el producto | 35 | 16 | **51** |
| **Should** — importante, postergable | 14 | 2 | **16** |
| **Could** — deseable | 3 | 0 | **3** |
| **Won't** — fuera de alcance | — | — | ver 4.3 |
| **Total catalogado** | **52** | **18** | **70** |

> ⚠️ **Tensión detectada en la priorización, declarada explícitamente.** 51 requerimientos *Must*
> representan un alcance considerable frente a la restricción **RE-01** (~15 horas semanales) y al
> riesgo **R4**. La lectura correcta es que los *Must* definen **el producto que la tesis propone**,
> mientras que el **núcleo demostrativo** de la sección 4.2 —el conjunto mínimo que prueba la
> hipótesis— es un subconjunto más reducido. Si al cerrar la Etapa 2 el avance sugiere que el alcance
> es excesivo, **el recorte debe hacerse sobre los *Must* no pertenecientes al núcleo demostrativo**,
> documentando la decisión y su justificación. La pauta evalúa el porcentaje de tareas del backlog
> completadas: un alcance sobredimensionado penaliza más que un alcance recortado y justificado.

## 4.2 Definición del producto mínimo

> **El MVP demuestra la tesis si**: recibe tramas de sensores por **al menos dos transportes
> distintos**, los normaliza a un único formato, detecta que un dispositivo dejó de reportar, lo
> muestra en una interfaz de gestión con el estado de cada dispositivo y su enlace, y permite exportar
> los datos en formato abierto.

**Núcleo demostrativo** — los requerimientos cuya ausencia invalidaría la demostración:

| Qué demuestra | Requerimientos del núcleo |
|---|---|
| Recepción por más de un transporte | RF-01, RF-02 *o* RF-03, RF-05, RF-06 |
| Normalización a formato único | RF-11, RF-12, RF-16, RF-17 |
| Supervisión de salud del enlace | RF-24, RF-25, RF-26, RF-30 |
| Persistencia y consulta | RF-31, RF-33 |
| Interfaz de gestión | RF-47, RF-48, RF-49 |
| Ausencia de dependencia de proveedor | RF-34 |
| Seguridad mínima | RF-40, RF-42, RNF-08, RNF-10 |
| Extensibilidad verificable | RNF-12 |

Son **20 requerimientos**. Ese conjunto cubre las cinco causas del problema y es alcanzable con el
presupuesto de tiempo disponible. Todo lo demás es mejora del producto, no demostración de la tesis.

## 4.3 Fuera de alcance declarado (*Won't*)

Declarar los límites es parte del análisis: evita que la ausencia de una funcionalidad se interprete
como omisión.

| Fuera de alcance | Razón |
|---|---|
| Analítica predictiva o aprendizaje automático sobre los datos | No aborda ninguna causa identificada; ampliaría el alcance sin fortalecer la tesis |
| Actuación remota sobre dispositivos (*downlink*, control) | La plataforma es de gestión de datos y conectividad, no de control de procesos |
| Aplicación móvil nativa | RF-52 se satisface con interfaz web adaptativa |
| Facturación o gestión comercial de suscripciones | El producto se define como abierto y sin costo de licencia |
| Firmware de grado comercial para los nodos | Solo el nodo de prueba necesario para la validación |
| Alta disponibilidad y redundancia geográfica | Excede el alcance de un prototipo de titulación; se documenta como trabajo futuro |
| Certificación normativa del equipamiento | No corresponde a un trabajo de titulación |

---

# 5. Matriz de trazabilidad

## 5.1 Cobertura de causas por requerimiento

| Causa del problema | Requerimientos que la abordan | Nº |
|---|---|:---:|
| **C1** Fragmentación de protocolos y formatos | RF-01…RF-06, RF-08, RF-10…RF-17, RF-20, RF-31, RF-40, RF-42, RF-45, RF-51, RNF-16 | **24** |
| **C2** Acoplamiento hardware-plataforma | RF-02, RF-03, RF-04, RF-51, RNF-12 | **5** |
| **C3** Costo y dependencia de plataformas SaaS | RF-34, RF-35, RF-41, RNF-14, RNF-15 | **5** |
| **C4** Ausencia de capacidad técnica interna | RF-18, RF-19, RF-21, RF-30, RF-33, RF-43, RF-44, RF-47, RF-49, RF-50, RF-52 | **11** |
| **C5** Falta de visibilidad de la conectividad | RF-07, RF-12, RF-14, RF-22, RF-23, RF-24…RF-30, RF-34, RF-36, RF-38, RF-39, RF-46, RF-48, RNF-03 | **20** |

**Verificación:** ninguna causa queda sin requerimientos asociados, y ningún requerimiento del catálogo
carece de causa declarada.

## 5.2 Trazabilidad requerimiento → objetivo → etapa

| Objetivo | Módulos que lo materializan | Requerimientos | Etapa |
|---|---|---|:---:|
| **OE1** Caracterizar y levantar requerimientos | — | *este documento* | 1 |
| **OE2** Especificar el protocolo | M2 | RF-05, RF-06, RF-11, RF-12, RF-16, RNF-13, RNF-16 | 2 |
| **OE3** Diseñar arquitectura, red y despliegue | M1, M7 | RF-01…RF-04, RF-40…RF-42, RNF-09, RNF-10, RNF-12, RNF-14, RNF-15 | 2 |
| **OE4** Implementar la plataforma | M1…M8 | todos los *Must* | 3 · 4 |
| **OE5** Validar en entorno realista | — | RNF-01…RNF-07 | 4 |

## 5.3 Requerimientos que sustentan la diferenciación competitiva

> **Nota (01/10/2026):** sección de la Etapa 1, conservada como registro. Sus afirmaciones sobre competidores no tienen fuente verificada y varias quedaron superadas; el estado del arte vigente, con fuentes oficiales, está en el informe §1.2 (`informe-oficial/cap1.tex`). No citarla. Se reescribe en la Etapa 3 como los requerimientos que sustentan la apuesta del trabajo (operación por personal no técnico, datos listos para investigación).

Del análisis de mercado se desprende que el valor diferencial no está distribuido de forma uniforme.
Estos son los requerimientos que ningún competidor regional identificado satisface:

| Requerimiento | Por qué diferencia |
|---|---|
| **RF-04** Adaptadores de formato por fuente | Admite sensores de distintos fabricantes y formatos sin modificar el núcleo |
| **RF-24, RF-27, RF-30** Supervisión de salud de enlace | La oferta regional muestra el dato del sensor, no el estado del dispositivo |
| **RF-34** Exportación en formato abierto | Elimina la dependencia de proveedor |
| **RF-51** Vista agrupada por transporte | Ninguna plataforma presenta la flota organizada por tecnología de red |
| **RNF-12** Extensibilidad por adaptador | Las soluciones cerradas no admiten hardware de terceros |
| **RNF-15** Solo componentes abiertos | Elimina el costo de licencia por dispositivo |

---

# 6. Evaluación crítica de alternativas de solución

La rúbrica exige «una evaluación crítica de alternativas consideradas y las razones para la selección
final». La evaluación de **transporte y formato de trama** —la decisión de mayor peso, vigente tras
el pivote del 2 de septiembre— está desarrollada en `docs/06-evaluacion-comunicacion.md` y se resume
en el capítulo 3 y el anexo C del informe. El camino evaluado y descartado antes del pivote —el
protocolo Contact ID frente a otros siete formatos de evento, ocho alternativas sobre seis criterios
ponderados— queda como evidencia en `historico/docs/05-protocolo-contactid.md`, sección 2. Esta
sección cubre las decisiones restantes de infraestructura.

## 6.1 Servidor de red LoRaWAN

| Alternativa | Ventajas | Desventajas | Decisión |
|---|---|---|---|
| Servidor de red embebido en la pasarela (p. ej., Milesight UG65) | Sin contenedor ni puerto extra: la pasarela publica por MQTT sobre TLS al broker como un cliente más, con su propia credencial | Cada pasarela es su propio servidor de red: administración por pasarela; el caso de dos pasarelas que oyen al mismo nodo está por verificar | **✅ Ruta B: la vía LoRaWAN del sistema** (prevista desde el 06/10/2026 y obligatoria desde el 08/10/2026: `docs/10 §8.4` puntos 2 y 24) |
| **ChirpStack** | Código abierto, autoalojable, publica en MQTT de forma nativa, gestión de dispositivos completa, se ejecuta en un servidor modesto | Requiere operar el componente | **✅ Seleccionado si se necesita un servidor de red propio (ruta A, opcional)** |
| The Things Stack (open source) | Funcionalmente equivalente, comunidad amplia | Despliegue autoalojado más exigente en recursos | Descartado |
| The Things Network (servicio público) | Sin operación propia, gratuito | Los datos transitan por infraestructura de terceros: contradice RNF-14 y el control del dato | Descartado |
| Desarrollo propio | Control total | Reimplementar LoRaWAN no es el aporte de la tesis y consumiría todo el presupuesto de tiempo | Descartado |

**Razón de la selección:** ChirpStack satisface RNF-14 y RNF-15, y su publicación nativa en MQTT
encaja directamente con RF-02 y RF-03, reduciendo el adaptador de LoRaWAN a un consumidor de tópicos.
**Actualización del 06/10/2026:** las pasarelas con servidor de red embebido publican al broker por la misma vía
y sin un contenedor más, así que esa es la ruta B, la del sistema (obligatoria desde el 08/10/2026, `docs/10 §8.4` punto 24), y ChirpStack queda para cuando las pasarelas no
traigan servidor de red propio o se quiera administrar varias desde un punto (ruta A, opcional; `docs/10 §8.4` punto 2).

## 6.2 Motor de persistencia

| Alternativa | Ventajas | Desventajas | Decisión |
|---|---|---|---|
| **TimescaleDB** (extensión de PostgreSQL) | **Un solo motor** para datos relacionales (inventario, sitios, usuarios, condiciones) y series de tiempo. SQL estándar. Edición Apache 2.0 (imagen `-oss`) desde el 06/10/2026: sin compresión ni agregados continuos, que son Timescale License (ver RNF-15) | Menos optimizado que InfluxDB en escritura masiva pura | **✅ Seleccionado** |
| InfluxDB | Muy eficiente en series de tiempo | Obliga a operar **dos motores** en paralelo, porque el inventario y la identidad son relacionales | Descartado |
| PostgreSQL sin extensión | Máxima simplicidad | Sin optimización de series de tiempo ni políticas de retención automáticas | Descartado |

**Razón de la selección:** el factor decisivo es operativo, no de rendimiento. Este es un **proyecto
unipersonal con ~15 horas semanales**: operar, respaldar y consultar dos motores de base de datos
distintos duplica la carga de mantenimiento sin beneficio proporcional a la escala del prototipo. El
volumen esperado —decenas de dispositivos reportando cada pocos minutos— está muy por debajo del punto
donde la ventaja de InfluxDB se vuelve relevante. **Se documenta explícitamente que a escala mayor la
decisión podría invertirse**, lo que constituye una recomendación de trabajo futuro.

## 6.3 Broker MQTT

| Alternativa | Ventajas | Desventajas | Decisión |
|---|---|---|---|
| **Mosquitto** | Ligero, maduro, TLS y autenticación estándar, consumo mínimo | Sin agrupamiento ni funciones empresariales | **✅ Seleccionado** |
| EMQX | Agrupamiento, reglas, alta concurrencia | Complejidad y consumo desproporcionados para la escala | Descartado |

## 6.4 Estrategia de despliegue

| Alternativa | Ventajas | Desventajas | Decisión |
|---|---|---|---|
| **Contenedores orquestados por Docker Compose** | Despliegue reproducible con un comando; **habilita que la validación de la Etapa 4 se ejecute en cualquier máquina**; aísla los componentes | Capa adicional de abstracción | **✅ Seleccionado** |
| Instalación directa en el sistema operativo | Sin capa intermedia | Frágil de reproducir; complica la evidencia de validación | Descartado |

**Razón de la selección:** la reproducibilidad no es una preferencia técnica, es un requisito de la
evaluación. La Etapa 4 exige demostrar el funcionamiento «bajo condiciones operativas realistas»; que
el sistema completo se levante con un comando en una máquina distinta a la de desarrollo es evidencia
directa de ello.

## 6.5 Lenguaje y marco de trabajo de la aplicación

> **Corrección respecto de la versión anterior de este documento.** El borrador inicial recomendaba
> Python + FastAPI asumiendo desconocido el perfil del desarrollador. Confirmada su experiencia previa
> con **Node.js y pnpm**, la evaluación se rehace incorporando ese dato — que en un proyecto
> unipersonal con plazos cerrados es un criterio de primer orden, no una preferencia — y **el resultado
> cambia**. La decisión anterior queda registrada como desviación justificada del plan original.

### 6.5.1 Criterios y ponderación

| # | Criterio | Peso | Fundamento del peso |
|---|---|---|---|
| **L-A** | **Experiencia previa del desarrollador** | **25 %** | Restricción RE-01 y RE-02: un desarrollador único con ~15 h semanales y cuatro entregas evaluadas. El tiempo de aprendizaje se descuenta directamente del tiempo de construcción |
| **L-B** | **Correspondencia entre estructura del código y arquitectura documentable** | **15 %** | La Etapa 2 asigna el **55 %** a «diseña adecuadamente según estándares de calidad». Si los módulos del código corresponden a los módulos del diseño, los diagramas describen el sistema real en lugar de una idealización |
| **L-C** | **Generación automática de especificación OpenAPI** | **15 %** | El contrato de la API es entregable de la Etapa 2. Si se genera desde el código, deja de ser trabajo adicional y no puede desincronizarse de la implementación |
| **L-D** | **Unificación del lenguaje con el frontend** | **15 %** | La interfaz de administración (M8) será una aplicación web. Un solo lenguaje en todo el sistema permite **compartir las definiciones de tipos** de la trama SenML y el modelo interno entre backend y frontend, definiéndolas una sola vez |
| **L-E** | **Madurez de bibliotecas para MQTT, PostgreSQL/TimescaleDB y validación de esquema** | **15 %** | RF-02 exige recibir la rama LoRaWAN (payload que el servidor de red ya decodifica: la pasarela en la ruta B o ChirpStack en la A); RF-03 exige cliente MQTT; RF-05 exige validar cada trama contra el esquema SenML; toda la persistencia es PostgreSQL |
| **L-F** | **Tipado estático** | **10 %** | El sistema manipula mensajes de formato estricto donde un campo mal posicionado es un error silencioso. El tipado traslada esos errores a tiempo de compilación |
| **L-G** | **Rendimiento en tiempo de ejecución** | **5 %** | Peso bajo deliberadamente: RNF-01 exige 50 eventos/segundo, cifra que **todas** las alternativas alcanzan holgadamente. El cuello de botella del proyecto es el tiempo del desarrollador, no la CPU |

### 6.5.2 Matriz comparativa ponderada

| Alternativa | L-A 25 % | L-B 15 % | L-C 15 % | L-D 15 % | L-E 15 % | L-F 10 % | L-G 5 % | **Total** |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **TypeScript + NestJS** | 4 | 5 | 5 | 5 | 5 | 5 | 4 | **4,70** |
| TypeScript + Fastify | 5 | 3 | 4 | 5 | 5 | 5 | 5 | **4,55** |
| Python + FastAPI | 3 | 3 | 5 | 2 | 5 | 4 | 3 | **3,55** |
| Java + Spring Boot | 2 | 5 | 4 | 1 | 5 | 5 | 4 | **3,45** |
| Go + Echo | 1 | 3 | 3 | 1 | 4 | 5 | 5 | **2,65** |
| Rust + Axum | 1 | 3 | 3 | 1 | 4 | 5 | 5 | **2,65** |

### 6.5.3 Justificación de las puntuaciones determinantes

**Sobre L-A, el criterio de mayor peso.** La experiencia declarada es Node.js con pnpm. NestJS obtiene
4 y no 5 porque su modelo de módulos e inyección de dependencias supone una curva de aprendizaje
adicional, aunque sobre un ecosistema ya conocido. Fastify obtiene 5 por ser conceptualmente cercano a
Express. Go y Rust obtienen 1: aprender un lenguaje nuevo consumiría semanas del presupuesto de 195 horas
restantes.

> **Rust se incorporó a la matriz el 23/09/2026.** Era la preferencia personal del desarrollador y no había
> sido evaluada: un análisis de alternativas que omite la que el autor prefería está incompleto. Con los
> mismos criterios queda igual que Go (2,65): excelente en tipado y rendimiento (5 y 5), con bibliotecas
> maduras para MQTT y PostgreSQL (`rumqttc`, `sqlx`; 4), pero sin experiencia previa (1), sin imponer una
> estructura de módulos que corresponda al análisis (3), con OpenAPI por macros de anotación (`utoipa`; 3)
> y sin unificar el lenguaje con el frontend (1). Se registra para que la decisión muestre la alternativa
> considerada y por qué se descartó, no para reabrirla: el criterio que la descarta es el tiempo de
> aprendizaje frente a un presupuesto cerrado, no su calidad técnica.

**Sobre L-B, el criterio que decide el resultado.** El análisis de requerimientos identificó **ocho
módulos** (M1 a M8) con responsabilidades separadas. NestJS impone una estructura de módulos con
dependencias explícitas que **corresponde uno a uno con esa descomposición**: cada módulo del análisis
se convierte en un módulo del código, y los diagramas de arquitectura de la Etapa 2 describen la
estructura real del sistema. Fastify no impone estructura, de modo que la correspondencia habría que
construirla y mantenerla por convención. Es la diferencia entre documentar lo que existe y confiar en
que lo que existe se parezca a lo documentado.

**Sobre L-D, una ventaja concreta y medible.** Una lectura normalizada tiene una estructura estricta
(canal, valor, unidad, marca de tiempo) y el *pack* SenML un conjunto fijo de campos (RFC 8428). Con un solo lenguaje en todo el sistema, esa estructura se define **una vez** y la usan
el validador de recepción, la capa de persistencia, la API y la interfaz. En dos lenguajes hay que
definirla dos veces y mantenerlas sincronizadas manualmente — una fuente de errores permanente por el
resto del proyecto. Esto penaliza a Python (2) y a Java, Go y Rust (1) con independencia de sus méritos.

**Sobre L-G y por qué su peso es bajo.** Go, Rust y Fastify obtienen 5 en rendimiento, y es irrelevante:
RNF-01 pide 50 eventos por segundo, un orden de magnitud por debajo de lo que cualquiera de estas
alternativas sostiene. Ponderar el rendimiento por encima de la velocidad de desarrollo sería optimizar
el recurso abundante a costa del escaso.

### 6.5.4 Decisión

> **Se selecciona TypeScript + NestJS** para el backend, con la interfaz de administración en
> TypeScript sobre el mismo repositorio, compartiendo las definiciones de tipos del dominio.

**La diferencia con Fastify es de 0,15 puntos, lo que no constituye una ventaja decisiva.** Se declara
explícitamente: ambas opciones son defendibles, y el criterio que inclina la balanza es la
correspondencia entre estructura del código y arquitectura documentable (L-B), por su peso en la
evaluación de la Etapa 2. **Si durante la Etapa 2 la curva de aprendizaje de NestJS resulta más costosa
de lo previsto, migrar a Fastify es una desviación aceptable** —el resto del stack no cambia— y quedaría
documentada como tal.

**Nota histórica sobre la herramienta de verificación en Python.** `historico/herramientas/contactid.py`
fue la implementación de referencia para validar por comparación cruzada el protocolo Contact ID,
antes del pivote del 2 de septiembre. Con el protocolo descartado (anexo del camino evaluado y
descartado, `historico/docs/05`), esa validación cruzada no aplica a la implementación vigente: las
pruebas automatizadas del contrato de trama SenML (TT-27) verifican la especificación real, no un
protocolo que ya no se implementa.

## 6.6 Componentes de la interfaz de administración

Decisión diferida a la Etapa 2, una vez definido el diseño de las vistas. Restricciones ya
establecidas: TypeScript (por la decisión 6.5), componentes de código abierto (RNF-15), y
funcionamiento en navegador móvil (RF-52). Las alternativas a evaluar serán marcos de componentes
(React, Svelte, Vue) y bibliotecas de visualización de series de tiempo.

---

# 7. Restricciones y supuestos

## 7.1 Restricciones

| # | Restricción | Origen | Consecuencia |
|---|---|---|---|
| **RE-01** | Presupuesto de tiempo de ~15 horas semanales | Jornada laboral completa del estudiante | El alcance se limita a los requerimientos *Must* |
| **RE-02** | Proyecto unipersonal | Condición del trabajo de título | Se descartan alternativas que exijan operar múltiples componentes complejos |
| **RE-03** | Sin licencias de pago | [PO] — producto abierto | Solo componentes de código abierto (RNF-15) |
| **RE-04** | Banda 915–928 MHz, plan AU915, sin licencia de espectro | Normativa chilena | Payload limitado; verificado como suficiente (RNF-16) |
| **RE-05** | Cuatro entregas evaluadas con umbral de aprobación del 70 % | Pauta del curso | El alcance se dimensiona para superar el umbral, no para maximizar funcionalidad |
| **RE-06** | Disponibilidad de hardware de sensores no confirmada | Riesgo R1 | La validación debe funcionar con emulación por software |

## 7.2 Supuestos

| # | Supuesto | Riesgo si no se cumple |
|---|---|---|
| **SU-01** | La universidad dispone de sensores accesibles para el caso de validación | Se recurre a nodos propios y emulación; debilita la evidencia del propietario del proyecto |
| **SU-02** | El profesor guía acepta la arquitectura de dos planos | Rediseño del tratamiento de la telemetría (pendiente P5) |
| **SU-03** | Es posible obtener al menos una entrevista con una parte interesada | Compromete el 10 % del criterio 1 y el respaldo del 45 % del criterio 3 |
| **SU-04** | Los estándares SIA son accesibles al menos vía documentación secundaria verificable | Ya mitigado: el formato está documentado en múltiples fuentes independientes |

---

# 8. Estado del documento

| Sección | Estado |
|---|---|
| 1 Metodología y fuentes | ✅ Completo, con la brecha de entrevistas declarada |
| 2 Requerimientos funcionales (52) | ✅ Completo, sujeto a ajuste tras las entrevistas |
| 3 Requerimientos no funcionales (18) | ✅ Completo |
| 4 Priorización MoSCoW y MVP | ✅ Completo |
| 5 Matriz de trazabilidad | ✅ Completo, cobertura de las 5 causas verificada |
| 6 Evaluación de alternativas | ✅ Completo. 6.5 resuelto con la experiencia del desarrollador confirmada; 6.6 diferido a la Etapa 2 |
| 7 Restricciones y supuestos | ✅ Completo |

**Total catalogado: 70 requerimientos**, frente a los 20 que definen el núcleo mínimo demostrable
(sección 4.2): ningún objetivo específico compromete una cifra mínima de requerimientos catalogados.
