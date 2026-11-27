# Protocolo de validación y comparación (Etapa 4 — se diseña ahora)

> Registra tres decisiones de método que condicionan cómo se medirá la plataforma. Se documentan en
> la Etapa 2 aunque las pruebas se ejecuten en la Etapa 4, para que el diseño las contemple desde el
> inicio. Versión: 8 de septiembre de 2026; §1, §2 y §3 actualizados el 25 de noviembre de 2026 (comparación
> con los referentes en una máquina virtual por plataforma, `docs/23`).

---

## 1. El hardware de prueba no debe ser el del desarrollador

El equipo de desarrollo es de gama alta y **no representa** el servidor modesto ni la red de un
usuario final. Medir el rendimiento «a pelo» en él daría cifras irreales y favorables.

**Decisión:** las pruebas de rendimiento y el banco de comparación se ejecutan en un **entorno de
referencia acotado y declarado**, no en la máquina de desarrollo tal cual. Dos usos distintos, cada
uno con su forma:

- **La plataforma propia sola (RNF-17, RNF-18):** en el servidor de prueba real, con sus techos de
  memoria y CPU por contenedor (`deploy.resources.limits`) y `docker stats` (`docs/16 §104`). Este
  método no cambia.
- **La comparación con los referentes (TT-40):** **una máquina virtual idéntica por plataforma**
  (2 vCPU; 2 o 4 GB de RAM; sin intercambio; misma imagen de Ubuntu Server y misma versión de Docker),
  con el generador de carga fuera de la máquina. El resultado principal es por tamaño de servidor:
  **arranca y guarda toda la carga, sí o no**. El protocolo completo está en `docs/23`.

**Por qué la comparación cambió de método (25/11/2026).** Hasta esa fecha este punto decía que
bastaban los límites de Docker. Para comparar con un referente no bastan: una JVM lee el techo de su
contenedor, pero no existe un techo **común** a todos los servicios de una plataforma que cada proceso
vea como «la memoria del servidor»; con techos por contenedor habría que repartir la memoria entre los
servicios del referente, y ese reparto sería una decisión nuestra. Sin techo, la JVM toma su fracción
de la RAM del anfitrión (ThingsBoard: «caps the heap at 25% of the machine’s RAM»,
https://thingsboard.io/docs/installation/ubuntu/). En una máquina virtual cada plataforma ve el
servidor que se le da y se configura sola, como en un servidor real de ese tamaño.

El entorno exacto (núcleos, memoria, versión de SO y de Docker) se declara junto a cada resultado,
para que la medición sea interpretable y repetible.

## 2. La comparación con ThingsBoard debe ser justa y no favorecer a la plataforma propia

El referente de código abierto es **ThingsBoard Community Edition 4.3** (Apache 2.0; desde la 4.4, del 29/09/2026, pasó a la Business Source License, ver informe §1.2). La comparación solo tiene valor
si es imparcial y reproducible.

**Reglas del banco de comparación:**

1. **Mismo hardware** para ambas plataformas (el entorno de referencia del punto 1).
2. **Mismo flujo de entrada:** un único generador de carga neutro (`docs/23 §5.1`) produce la misma carga y la
   envía a ambas por su vía nativa.
3. **Mismas métricas, mismas herramientas:** en la comparación, memoria del sistema y de cada cgroup
   muestreada dentro de cada máquina, y lo guardado contado con SQL en la base de cada plataforma; la
   carga, con el mismo generador. Los pasos de alta se reportan de forma descriptiva, con la guía
   oficial de cada plataforma citada y sin puntaje (`docs/23 §5.4`).
4. **Protocolo escrito antes de ver los resultados**, para no ajustar las reglas al resultado deseado.
5. **Scripts versionados y reproducibles:** cualquiera puede re-ejecutar el banco y obtener lo mismo.
6. **Se reportan también los casos donde la plataforma propia pierda:** un resultado desfavorable es
   un hallazgo válido, no algo a ocultar.

Resultado del banco (`docs/23 §7`): por plataforma y tamaño de servidor, **arranca y guarda toda la
carga: sí o no**. Como descripción: memoria en reposo y con carga (en MiB, nunca como «X veces»), tiempo
de puesta en marcha y llamadas o pasos para dar de alta un dispositivo. Cada referente se mide en dos
filas: su Compose por omisión y lo que prescribe su propia documentación. La comparación de alerta y
exportación que nombraba TT-40 se recorta y se declara (`docs/23 §13`).

## 3. Contenedores (Docker) para desplegar; máquinas virtuales solo para comparar

**Decisión: Docker sobre el Ubuntu del servidor, no virtualización completa, para DESPLEGAR la
plataforma.** Razones: los contenedores comparten el núcleo del sistema y consumen una fracción de lo
que consume una máquina virtual con su propio sistema operativo; es el modo estándar de desplegar este
stack (Mosquitto, TimescaleDB, backend y, solo en la ruta A, ChirpStack); y `docker compose` da un
despliegue reproducible con un comando, con reinicio automático ante fallas.

**Para COMPARAR con un referente sí se usa virtualización** (desde el 25/11/2026; antes este punto
decía que para simular un servidor limitado bastaban los límites de Docker): una máquina virtual por
plataforma, por el motivo de §1. La máquina no cambia cómo se despliega nada: dentro de ella cada
plataforma corre con su propio Docker Compose, la propia tal como se despliega en el servidor
(`docs/23 §4`).

**Qué gana este proyecto en concreto** (el detalle de cada punto vive donde se indica): el mismo
`docker compose` levanta la pila idéntica en el portátil y en el servidor, con versiones fijadas de cada
imagen (`docs/10 §6`); el límite de memoria por servicio hace que RNF-17 se **mida** con `docker stats` y
no se estime (`docs/14`); la red interna deja la base sin ningún puerto hacia afuera (`docs/11 §2`); y
`restart: unless-stopped` más los chequeos de salud recuperan un servicio caído sin intervención
(`docs/10 §6`). Para una persona sola sin equipo de operaciones (causa C4), eso es lo que hace viable operar.

## 4. Pendientes

- [x] Definir el entorno de referencia exacto: servidor de prueba real para la plataforma propia; una
  máquina virtual por plataforma para la comparación (`docs/23`, 25/11/2026).
- [x] Escribir los guiones del banco de comparación (TT-40): `plataforma/pruebas/comparacion/`.
- [x] Fijar la carga de la comparación: S1 (10 dispositivos cada 60 s, 20 min) y S2 (100 a ≈ 50 mensajes/s, 15 min) (`docs/23 §5.3`).
