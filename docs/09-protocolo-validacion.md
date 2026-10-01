# Protocolo de validación y comparación (Etapa 4 — se diseña ahora)

> Registra tres decisiones de método que condicionan cómo se medirá la plataforma. Se documentan en
> la Etapa 2 aunque las pruebas se ejecuten en la Etapa 4, para que el diseño las contemple desde el
> inicio. Versión: 8 de septiembre de 2026.

---

## 1. El hardware de prueba no debe ser el del desarrollador

El equipo de desarrollo es de gama alta y **no representa** el servidor modesto ni la red de un
usuario final. Medir el rendimiento «a pelo» en él daría cifras irreales y favorables.

**Decisión:** las pruebas de rendimiento y el banco de comparación se ejecutan en un **entorno de
referencia acotado y declarado**, no en la máquina de desarrollo tal cual. Dos formas equivalentes:

- **Límites de recursos de Docker** (`deploy.resources.limits`): capar cada servicio a, por ejemplo,
  2 vCPU y 2 GB de memoria, replicando un VPS o mini-PC modesto. Es lo más simple y reproducible.
- **VPS real modesto** (2 vCPU / 2 GB): la prueba definitiva, en hardware ajeno al del desarrollador.

El entorno exacto (núcleos, memoria, versión de SO) se declara junto a cada resultado, para que la
medición sea interpretable y repetible.

## 2. La comparación con ThingsBoard debe ser justa y no favorecer a la plataforma propia

El referente de código abierto es **ThingsBoard Community Edition 4.3** (Apache 2.0; desde la 4.4, del 29/09/2026, pasó a la Business Source License, ver informe §1.2). La comparación solo tiene valor
si es imparcial y reproducible.

**Reglas del banco de comparación:**

1. **Mismo hardware** para ambas plataformas (el entorno de referencia del punto 1).
2. **Mismo flujo de entrada:** un único emulador de nodos genera el mismo dataset de tramas y lo
   envía a ambas por su vía nativa.
3. **Mismas métricas, mismas herramientas:** memoria y CPU con `docker stats`; latencia y pérdida con
   el mismo generador; pasos de alta de un sensor contados por un tercero.
4. **Protocolo escrito antes de ver los resultados**, para no ajustar las reglas al resultado deseado.
5. **Scripts versionados y reproducibles:** cualquiera puede re-ejecutar el banco y obtener lo mismo.
6. **Se reportan también los casos donde la plataforma propia pierda:** un resultado desfavorable es
   un hallazgo válido, no algo a ocultar.

Métricas objetivo del banco: memoria en reposo, memoria bajo carga, tiempo de puesta en marcha
(arranque en frío), tasa de tramas por segundo sin pérdida, y número de pasos para dar de alta un
sensor y verlo graficado.

## 3. Contenedores (Docker), no máquinas virtuales

**Decisión: Docker sobre el Ubuntu del servidor, no virtualización completa.** Razones: los
contenedores comparten el núcleo del sistema y consumen una fracción de lo que consume una máquina
virtual con su propio sistema operativo; es el modo estándar de desplegar este stack (Mosquitto,
TimescaleDB, ChirpStack, backend); y `docker compose` da un despliegue reproducible con un comando,
con reinicio automático ante fallas.

La virtualización solo aparecería para **simular** un servidor limitado, y para eso bastan los
límites de recursos de Docker del punto 1 —más simples que administrar una VM—. Se documenta la
alternativa para justificar por qué no se eligió.

**Qué gana este proyecto en concreto** (el detalle de cada punto vive donde se indica): el mismo
`docker compose` levanta la pila idéntica en el portátil y en el servidor, con versiones fijadas de cada
imagen (`docs/10 §6`); el límite de memoria por servicio hace que RNF-17 se **mida** con `docker stats` y
no se estime (`docs/14`); la red interna deja la base sin ningún puerto hacia afuera (`docs/11 §2`); y
`restart: unless-stopped` más los chequeos de salud recuperan un servicio caído sin intervención
(`docs/10 §6`). Para una persona sola sin equipo de operaciones (causa C4), eso es lo que hace viable operar.

## 4. Pendientes

- [ ] Definir el entorno de referencia exacto (¿límites de Docker o VPS arrendado?) en la Etapa 4.
- [ ] Escribir los scripts del emulador y del banco de comparación (backlog TT-28, TT-39).
- [ ] Fijar el dataset de prueba (cuántos nodos, qué frecuencia, cuánto tiempo).
