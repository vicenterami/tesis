# Resumen del proyecto

> **Para qué sirve este documento:** explicar el proyecto completo a alguien en cinco minutos — qué se
> hace, por qué, y con qué decisiones. Es el documento que se muestra primero. Se actualiza cuando una
> decisión cambia; el detalle vive en `docs/`.
>
> Trabajo de Título INFO-1197 · Universidad Católica de Temuco · Profesor guía: Mario
> **Última actualización: 24 de agosto de 2026**

---

## La tesis en una frase

> Una **plataforma abierta** que permite a quien **ya tiene sensores** —LoRa, WiFi, MQTT o paneles de
> alarma— **recibir, unificar, gestionar y exportar sus propios datos**, usando como contrato de
> comunicación un estándar de industria ya existente: **Contact ID (SIA DC-05)**.

---

## El problema

**No es que falten sensores. Es que sobran formatos.**

Un sensor cuesta entre 5 y 30 dólares y la banda de radio es libre. La barrera se movió: quien ya
invirtió en sensores descubre que cada uno habla distinto, que la plataforma del proveedor solo
funciona con el hardware del proveedor, y que **no tiene dónde recibir sus datos ni cómo saber si sus
sensores siguen vivos**.

Dicho por el afectado:

> *«Tengo los sensores instalados y funcionando, pero no tengo dónde recibir sus datos, ni cómo
> administrarlos, ni cómo saber si siguen reportando.»*

**Cinco causas** → fragmentación de protocolos · hardware acoplado a la plataforma · costo y
dependencia de plataformas comerciales · falta de capacidad técnica interna · **sin visibilidad del
estado de la conectividad**.

**El efecto que resume todo:** *el silencio de un sensor es indistinguible de la ausencia de novedades.*

---

## Qué se construye

Una plataforma con ocho módulos, de los cuales estos son el corazón:

```
   Sensores LoRa ──┐
   Sensores WiFi ──┼──▶  INGESTA  ──▶  NORMALIZACIÓN  ──▶  ┌─ inventario de dispositivos
   Sensores MQTT ──┤     3 vías        a Contact ID        ├─ salud de cada enlace
   Paneles alarma ─┘                                        ├─ historial y series de tiempo
                                                            ├─ alertas
                                                            └─ exportación abierta (CSV/JSON)
```

**Lo que la hace distinta de la competencia regional:** IoT3 y ControlTec muestran **el dato del
sensor**. Esta plataforma además muestra **el estado del dispositivo y de su enlace** — y acepta
hardware que no vendió ella.

---

## Las decisiones, y por qué

| Decisión | Por qué esta y no otra |
|---|---|
| **Protocolo: Contact ID (SIA DC-05) sobre DC-09** | Ganó una evaluación de **8 alternativas sobre 6 criterios ponderados** con 4,75 sobre 5. Único candidato que combina un mensaje de **8 bytes** con un **vocabulario semántico normalizado**: los formatos compactos no normalizan semántica, y los que normalizan no son compactos |
| **Un mensaje, dos planos lógicos** | Contact ID **no puede transportar "23,4 °C"**, pero **DC-09 define un campo de datos extendidos** cuyo formato determina el implementador. El valor viaja ahí: **el nodo emite un mensaje y el firmware implementa una rutina**. La separación entre eventos y telemetría se conserva como separación lógica en la plataforma, con requisitos de entrega distintos |
| **Metodología: PPDIOO, no Scrum** | Es de Cisco, es el marco del dominio de redes, y sus fases **coinciden con las cuatro etapas de evaluación**. Se descartan las ceremonias de Scrum (proyecto unipersonal) pero **se conserva el backlog**, porque la pauta lo evalúa con un 20 % |
| **Multiprotocolo, no solo LoRa** | Indicación del profesor guía, y respaldada por la industria: Verisure opera GSM **más** Sigfox como canal secundario. Quien se juega la continuidad del servicio no se ata a un transporte |
| **Lenguaje: TypeScript + NestJS** | Ganó una matriz de **5 alternativas sobre 7 criterios** (4,70). Decisivo: sus módulos **corresponden uno a uno** con los 8 módulos del análisis, así que los diagramas de la Etapa 2 describen el sistema real; y un solo lenguaje permite **definir los tipos del evento una sola vez** para backend y frontend |
| **Persistencia: TimescaleDB** | **Un solo motor** para inventario relacional y series de tiempo. InfluxDB obligaría a operar dos bases de datos: inaceptable en un proyecto de una persona con 15 h semanales |
| **Servidor LoRaWAN: ChirpStack** | Abierto, autoalojable, publica en MQTT de forma nativa. La red pública de TTN haría transitar los datos por terceros |
| **Despliegue: contenedores** | La Etapa 4 exige demostrar funcionamiento «en condiciones operativas realistas». Que el sistema se levante con un comando en otra máquina **es** esa evidencia |
| **Solo software abierto, sin licencias** | Requisito del propietario del proyecto: la plataforma debe ser gratuita o abierta |

### El argumento central, en un párrafo

> La industria de la seguridad electrónica resolvió hace décadas el problema de supervisar flotas de
> sensores inalámbricos a batería —cuál dejó de reportar, cuál tiene la batería baja, cuál está siendo
> interferido— y estandarizó su vocabulario en un protocolo **abierto**: ANSI/SIA DC-05. Pero lo aplica
> dentro de **sistemas cerrados**: un cliente de Verisure no puede llevarse sus datos ni conectar un
> sensor de otra marca. **Este trabajo toma ese protocolo estándar y lo usa como contrato de
> interoperabilidad de una plataforma abierta**, extendiendo su transporte a LoRaWAN, WiFi/HTTP y MQTT.

### El dato que más convence

El mensaje Contact ID nació en 1985 para caber en **tonos telefónicos** por una línea analógica: 16
dígitos, ni uno más. Esa restricción de hace cuatro décadas es exactamente la que hoy lo hace
apropiado para LoRa.

```
Mensaje Contact ID:                       8 bytes  (verificado con código, no estimado)
Payload LoRaWAN AU915, peor caso:        11 bytes
                                    ───────────────
                                     cabe con 3 bytes de margen
```

Para comparar: un JSON equivalente ocupa entre **60 y 150 bytes**. No cabe.

Con el valor medido incluido el mensaje sube a **13–19 bytes**, que no cabe en los 11 del enlace de
alcance máximo pero sí en los 51–53 de operación normal. **De ahí que el valor sea opcional:** cuando el
canal se estrecha se sacrifica la medición y se preserva el evento, porque un evento perdido es una
alarma que no suena.

---

## Cómo se demuestra

**El prototipo prueba la tesis si:** recibe eventos por **al menos dos transportes distintos**, los
normaliza a un formato único, **detecta que un dispositivo dejó de reportar**, lo muestra en una
interfaz de gestión con el estado de cada enlace, y permite **exportar los datos en formato abierto**.

Son **20 requerimientos** de los 68 catalogados, que se traducen en **33 elementos del backlog y 165
horas** de trabajo. El resto es mejora del producto, no demostración.

**Verificación de viabilidad:** el backlog completo suma **275 h** contra **201 h disponibles** (15 h
semanales) — un **37 % de exceso** contra el presupuesto con que se planificó. El núcleo, en cambio,
cabe holgado: con el calendario oficial del 24/08 (~240 h hasta el 4 de diciembre) su holgura es de **+31 %**. Por eso el compromiso es el núcleo, y el resto es alcance condicional.

---

## Estado

| Etapa | Entrega | Estado |
|---|---|---|
| **1** — Problema, objetivos y requerimientos | **viernes 4 de septiembre** | 🟡 **~90 %** — falta el levantamiento con partes interesadas y migrar al formato oficial |
| 2 — Diseño e implementación inicial | viernes 2 de octubre | ⬜ |
| 3 — Mejoras, pruebas y validación preliminar | viernes 30 de octubre | ⬜ |
| 4 — Validación final e informe | viernes 4 de diciembre | ⬜ |

### Etapa 1 en detalle

| Criterio | Peso | Estado |
|---|---|---|
| Definición del problema | 10 % | 🟡 redactado · **faltan las entrevistas** |
| Objetivos SMART y trazabilidad | 25 % | ✅ 6 objetivos, cada uno con indicador medible |
| Análisis de requerimientos | 45 % | ✅ 68 requerimientos · 7 protocolos evaluados · alternativas de infraestructura decididas |
| Backlog priorizado | 20 % | ✅ 63 elementos, 275 h estimadas, viabilidad verificada |

### Lo que bloquea

1. 🔴 **Entrevistar al responsable de los sensores de la universidad.** Vale el 10 % directo y respalda
   el 45 %. **Nadie más puede hacerlo.**
2. ✅ ~~Confirmar las fechas~~ — resuelto por la pauta oficial: Etapa 1 el 4 de septiembre.
3. 🟡 **Validar con Mario el uso del campo de datos extendidos de DC-09** para llevar la medición. La
   pregunta está formulada en `docs/03-instrumentos-levantamiento.md`, P3.
4. 🟡 **Aclarar si el trabajo del compañero es tesis conjunta o separada** — afecta la restricción RE-02
   y exige un contrato de interfaz entre su firmware y esta plataforma.

---

## Dónde está cada cosa

| Documento | Contenido |
|---|---|
| [`PLAN-MAESTRO.md`](PLAN-MAESTRO.md) | Metodología, calendario, forma de trabajo |
| [`docs/01-problema-y-objetivos.md`](docs/01-problema-y-objetivos.md) | Árbol de problemas, 6 objetivos SMART, trazabilidad, riesgos |
| [`docs/02-requerimientos.md`](docs/02-requerimientos.md) | 68 requerimientos, MoSCoW, alternativas de infraestructura y de lenguaje |
| [`docs/04-backlog.md`](docs/04-backlog.md) | 14 épicas, 25 historias, 38 tareas, estimaciones y verificación de viabilidad |
| [`docs/05-protocolo-contactid.md`](docs/05-protocolo-contactid.md) | El protocolo: cómo funciona, por qué este, y el perfil CID-IoT |
| [`docs/GLOSARIO.md`](docs/GLOSARIO.md) | Fundamentos y glosario: para poder explicar cada pieza |
| [`docs/03-instrumentos-levantamiento.md`](docs/03-instrumentos-levantamiento.md) | Preguntas para el profesor guía y guion de entrevistas |
| [`plataforma/herramientas/contactid.py`](plataforma/herramientas/contactid.py) | Genera y valida mensajes reales. `python3 contactid.py` |
| [`bitacora/`](bitacora/) | Qué dijo Mario y qué se cambió por eso |
