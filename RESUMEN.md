# Resumen del proyecto

> **Para qué sirve este documento:** explicar el proyecto completo a alguien en cinco minutos — qué se
> hace, por qué, y con qué decisiones. Es el documento que se muestra primero. Se actualiza cuando una
> decisión cambia; el detalle vive en `docs/`.
>
> Trabajo de Título INFO-1197 · Universidad Católica de Temuco · Profesor guía: Mario
> **Última actualización: 18 de agosto de 2026**

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
| **Protocolo: Contact ID (SIA DC-05) sobre DC-09** | Ganó una evaluación de **7 alternativas sobre 6 criterios ponderados** con 4,45 sobre 5. Único candidato que combina un mensaje de **8 bytes** con un **vocabulario semántico normalizado**: los formatos compactos no normalizan semántica, y los que normalizan no son compactos |
| **Dos planos: eventos + telemetría** | Contact ID **no puede transportar "23,4 °C"** — solo eventos codificados. Se declara el límite y se resuelve por diseño: eventos con entrega confirmada, mediciones con pérdida tolerable |
| **Metodología: PPDIOO, no Scrum** | Es de Cisco, es el marco del dominio de redes, y sus fases **coinciden con las cuatro etapas de evaluación**. Se descartan las ceremonias de Scrum (proyecto unipersonal) pero **se conserva el backlog**, porque la pauta lo evalúa con un 20 % |
| **Multiprotocolo, no solo LoRa** | Indicación del profesor guía, y respaldada por la industria: Verisure opera GSM **más** Sigfox como canal secundario. Quien se juega la continuidad del servicio no se ata a un transporte |
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

---

## Cómo se demuestra

**El prototipo prueba la tesis si:** recibe eventos por **al menos dos transportes distintos**, los
normaliza a un formato único, **detecta que un dispositivo dejó de reportar**, lo muestra en una
interfaz de gestión con el estado de cada enlace, y permite **exportar los datos en formato abierto**.

Son **20 requerimientos** de los 68 catalogados. El resto es mejora del producto, no demostración.

---

## Estado

| Etapa | Entrega | Estado |
|---|---|---|
| **1** — Problema, objetivos y requerimientos | viernes 28 de agosto | 🟡 **~65 %** |
| 2 — Diseño e implementación inicial | viernes 25 de septiembre | ⬜ |
| 3 — Mejoras, pruebas y validación preliminar | viernes 23 de octubre | ⬜ |
| 4 — Validación final e informe | viernes 20 de noviembre | ⬜ |

### Etapa 1 en detalle

| Criterio | Peso | Estado |
|---|---|---|
| Definición del problema | 10 % | 🟡 redactado · **faltan las entrevistas** |
| Objetivos SMART y trazabilidad | 25 % | ✅ 6 objetivos, cada uno con indicador medible |
| Análisis de requerimientos | 45 % | ✅ 68 requerimientos · 7 protocolos evaluados · alternativas de infraestructura decididas |
| Backlog priorizado | 20 % | ⬜ siguiente |

### Lo que bloquea

1. 🔴 **Entrevistar al responsable de los sensores de la universidad.** Vale el 10 % directo y respalda
   el 45 %. **Nadie más puede hacerlo.**
2. 🔴 **Confirmar las fechas con Mario:** ¿Etapa 1 el 28 de agosto o el 11 de septiembre?
3. 🟡 **Validar la arquitectura de dos planos con Mario** — si exige Contact ID puro para todo, hay que
   rediseñar el tratamiento de la telemetría.

---

## Dónde está cada cosa

| Documento | Contenido |
|---|---|
| [`PLAN-MAESTRO.md`](PLAN-MAESTRO.md) | Metodología, calendario, forma de trabajo |
| [`docs/01-problema-y-objetivos.md`](docs/01-problema-y-objetivos.md) | Árbol de problemas, 6 objetivos SMART, trazabilidad, riesgos |
| [`docs/02-requerimientos.md`](docs/02-requerimientos.md) | 68 requerimientos, MoSCoW, alternativas de infraestructura |
| [`docs/05-protocolo-contactid.md`](docs/05-protocolo-contactid.md) | El protocolo: cómo funciona, por qué este, y el perfil CID-IoT |
| [`plataforma/herramientas/contactid.py`](plataforma/herramientas/contactid.py) | Genera y valida mensajes reales. `python3 contactid.py` |
| [`bitacora/`](bitacora/) | Qué dijo Mario y qué se cambió por eso |
