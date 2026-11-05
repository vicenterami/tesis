# Despliegue, costos y retención (TT-24, TT-25, TT-26 — OE3)

> **Sustenta:** OE3 (modelo de despliegue y costo de operación) · criterio «avanza en el diseño según
> backlog» (10 %). Todo precio lleva **proveedor, plan, fecha y fuente**; sin esos datos un número no se
> sostiene en una defensa. Los precios cambian: antes de contratar se recotiza en la calculadora del
> proveedor. Versión: 10 de septiembre de 2026.

---

## 1. Qué determina el costo en una plataforma de sensores

En un sistema de gestión el costo lo mueve la cantidad de usuarios. Aquí lo mueve **la tasa de
recepción por la retención**: cuántas lecturas por segundo, guardadas por cuánto tiempo. De ahí salen
los gigabytes, y de los gigabytes casi todo lo demás. Rubros y qué los mueve:

| Rubro | Qué lo mueve | En esta plataforma |
|---|---|---|
| Cómputo (vCPU, memoria) | Procesos que corren y su techo de memoria | 4 contenedores en las rutas B y C (techo 1,6 GB); 5 con ChirpStack si se activa la ruta A (techo 1,95 GB); consumo en reposo ≈ 120 MB medido el 27/09 (base 61, backend 53, broker 8) → **el rubro dominante y el más acotado** |
| Almacenamiento | Filas × tamaño × retención (sin compresión) | Pequeño (§2) |
| Registros | Rotación de Docker: 10 MB × 5 por servicio (`docs/11 §4`, 07/10/2026) | ≤ 200 MB en total, fijo |
| Base de datos gestionada | Solo si se externaliza | No: TimescaleDB va en el mismo servidor (RNF-17) |
| Tráfico de salida | GB que salen a Internet | Mínimo: el panel y la API sirven agregados, no datos crudos |
| Observabilidad | Logs y métricas por volumen | `docker compose logs` y `docker stats`; además un vigilante externo por latido, gratuito (§7.2): un servidor caído no puede avisar por sí mismo |
| Dominio y TLS | Registro anual; certificados | Dominio ~USD 10–15/año; TLS gratuito (Let's Encrypt por ACME en el proxy) o CA propia si el servidor no es público (servidor de prueba: CA propia del servidor, §7; Let's Encrypt cuando exista nombre público) |

## 2. Modelo de volumen y política de retención

**Escenario del núcleo demostrativo:** 50 canales (sensor × magnitud) reportando cada 5 minutos.

| Magnitud | Cálculo | Valor |
|---|---|---|
| Filas por día | 50 × (86 400 / 300) | 14 400 |
| Filas por año | 14 400 × 365 | ≈ 5,3 millones |
| Tamaño por lectura, **medido** (24/10/2026) | 504 000 lecturas en el banco con el esquema y los dos índices de `medicion` (50 canales cada 60 s, 7 días): 93 B de fila y 85 B de índices; en la base de desarrollo, la semana de la corrida de 24 h (9 113 lecturas) da 192 B | **≈ 180 B** con índices |
| Crudo por año, sin comprimir | 5,3 M × 180 B | ≈ **0,95 GB** con índices |
| Compresión | **No se usa** desde el 06/10/2026: la compresión de TimescaleDB es Timescale License y el sistema adopta la edición Apache (`docs/02`, RNF-15). Diez años del escenario ≈ 9,5 GB con índices | — |

**Política en capas** (la parte que hay que decidir **antes** de recibir datos; después es migración):

| Capa | Qué | Retención | Cómo |
|---|---|---|---|
| Crudo | Cada lectura, sin comprimir | 2 años | fragmentos de 7 días (ya configurado) |
| Agregado horario | mín, máx, promedio, cuenta por canal y hora, en la zona del sitio | indefinido | vista materializada refrescada por tarea programada (Etapa 3; el agregado continuo es Timescale License) |
| Agregado diario | ídem por día | indefinido | vista materializada refrescada por tarea (Etapa 3) |
| Crudo antiguo | no vence por defecto (07/10, `docs/10 §8.4` punto 19) | si se define `RETENCION_MEDICION_DIAS`, se borra con `drop_chunks` (función Apache) desde la tarea de retención del backend; exportar a archivo antes | `RetencionService` (la política automática es Timescale License) |

Con esto, **diez años de operación del escenario ocupan ≈ 9,5 GB sin compresión** (≈ 0,95 GB por año con índices).
Corrección del 24/10/2026: hasta ese día este documento estimaba 62 B por fila más un 40 % de índices (≈ 87 B), sin contar
`recibido_en`, `origen_tiempo` ni el segundo índice; medido, es el doble. El almacenamiento no es el problema; el consumo de memoria RAM sí: RNF-17 lo acota a 2 GB en un servidor de 4 GB.

**Qué se guarda y qué no.** Un sensor que reporta cada segundo un fenómeno que cambia cada cinco
minutos multiplica el costo por trescientos sin agregar información. El intervalo lo fija el
`intervalo_esperado_s` de cada dispositivo, y el catálogo de magnitudes define qué medir; la
plataforma no guarda tramas rechazadas en las series (van a cuarentena, que sí tiene retención corta).

### 2.1 Una flota: cuánto ocupa y cuánto procesa (medido el 24/10/2026)

Las cuentas salen de tres mediciones, no de supuestos: **180 B por lectura** (arriba), **≈ 610 B por trama cruda**
guardada (tabla `trama`, con sus tres índices: 1 440 tramas SenML del nodo propio ocupan 884 736 B; se retienen 30 días,
`RETENCION_TRAMA_DIAS`) y el procesamiento de `docs/16 §10`: **sin pérdida hasta 409 tramas por segundo, de 2 lecturas cada una (≈ 818 lecturas/s)**, en el equipo de desarrollo, con
los techos de `docs/10 §6` (la base usa su núcleo entero: el límite es la CPU de la base, no la memoria), y 324 MiB de memoria
sumada en el pico. En reposo, con un nodo, la pila completa usaba 193 MiB (`docker stats`, 24/10, en reposo).

Fórmulas: lecturas por día = canales × 86 400 / intervalo; tramas por segundo = nodos / intervalo; disco por año = lecturas
por día × 365 × 180 B; tramas retenidas = nodos × (86 400 / intervalo) × 30 × 610 B (fijo, no crece).

| Flota (cada nodo con 6 canales) | Intervalo | Tramas/s | Lecturas por día | Disco de mediciones por año | Tramas retenidas (30 días) |
|---|---|---|---|---|---|
| 1 nodo (el propio, `docs/17`) | 60 s | 0,017 | 8 640 | 0,57 GB | 26 MB |
| 100 nodos (un sector) | 60 s | 1,7 | 864 000 | 57 GB | 2,6 GB |
| 100 nodos | 300 s | 0,33 | 172 800 | 11 GB | 0,5 GB |
| 1 000 nodos (diez sectores de 100) | 60 s | 16,7 | 8,6 millones | 568 GB | 26 GB |
| 1 000 nodos | 300 s | 3,3 | 1,7 millones | 114 GB | 5,3 GB |

Con un disco de 40 GB (el del servidor de referencia, §3): 100 nodos cada 5 min suman ≈ 11,5 GB por año (mediciones más tramas retenidas), es decir ≈ 3,5 años; ≈ 3 años contando sistema, imágenes, cuarentena y registros (≤ 200 MB, §1). Es la cifra de la presentación.

**Lo que dice la tabla.** (1) La CPU y la memoria sobran: mil nodos de 6 canales cada minuto son 100 lecturas/s, ≈ 12 % de las ≈ 818 medidas (4 % si se cuenta en tramas, pero cada trama de 6 lecturas pesa más que las de 2 del emulador). (2) El
que manda es el **disco**, y lo mueve el intervalo: pasar de 60 a 300 s lo divide por cinco; por eso el intervalo se declara
en el alta y se elige según lo que cambia el fenómeno (§2). (3) Desde un centenar de nodos cada minuto, el crudo sin
vencimiento deja de caber en un VPS de 40 GB (§3): se define `RETENCION_MEDICION_DIAS` y se conservan los agregados, o se
suma disco (precio a cotizar al contratar).
(4) En Kubernetes (§6) esto es el tamaño del volumen persistente de la base y el pedido de CPU de su réplica.

**Lo que no mide:** el procesamiento se midió en el equipo de desarrollo, no en el servidor de 2 vCPU de §3, y con tramas de 2 lecturas (el techo con 6 por trama no está medido); el tamaño por
lectura cambia si cambia el esquema; la cuarentena y los registros (≤ 200 MB, §1) no están en la tabla. Por sector y por cliente
el sistema todavía no guarda su propio consumo (filas por día, disco y tramas por segundo por sitio): es la decisión pendiente
sobre el historial de consumo para administradores.

## 3. Alternativas de alojamiento

Todas ejecutan el mismo `docker-compose.yml`: la decisión es **reversible**. Precios consultados el
10 de septiembre de 2026; conversión con **dólar observado 925,65 CLP** (9-sep-2026, SII) y **euro
1 081,86 CLP** (6-sep-2026); se redondea.

| Alt. | Descripción | Plan de referencia (≥ 4 GB de RAM para un consumo ≤ 2 GB, RNF-17) | Costo mensual | Costo anual | Fuente |
|---|---|---|---|---|---|
| **A** | VPS internacional (Europa) | Hetzner CX23, 2 vCPU · 4 GB · 40 GB, o CAX11 ARM 2 vCPU · 4 GB | €5,49–5,99 ≈ **CLP 5 900–6 500** | ≈ CLP 71 000–78 000 | [Hetzner, precios 2026](https://bestusavps.com/reviews/hetzner/); [comparativa](https://www.bitdoze.com/hetzner-cloud-cost-optimized-plans/) |
| **A'** | VPS internacional (EE. UU.) | DigitalOcean Basic 2 vCPU · 4 GB | USD 24 ≈ **CLP 22 200** | ≈ CLP 266 600 | [DigitalOcean 2026](https://infratally.com/articles/digitalocean-droplet-pricing-guide-2026/) |
| **B** | VPS nacional (datacenter en Santiago) | Planes de 2–4 GB de proveedores chilenos | **CLP 26 000–40 000** (hasta ~100 000 en tradicionales) | ≈ CLP 312 000–480 000 | [Nova Imago](https://www.novaimagodigital.com/comprar-vps-chile-2026/); [Vínculo](https://vinculo.cl/vps); [WireNet](https://www.wirenetchile.com/vps-chile/) |
| **C** | Servidor propio en el campus (mini-PC) | Equipo de 8–16 GB (capital único) + electricidad (~10 W) | Capital ≈ CLP 250 000–400 000 + ≈ CLP 1 500/mes de energía | Año 1 ≈ CLP 270 000–420 000; años siguientes ≈ CLP 18 000 | estimación de mercado, a cotizar |
| **D** | Nube gratuita | Oracle Cloud *Always Free* ARM (desde junio 2026: 2 OCPU · 12 GB) | **CLP 0** | CLP 0 | [InfoQ](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/); [detalle](https://terminalbytes.com/oracle-cloud-free-tier-changes-2026/) |

Notas de riesgo: en A, los planes compartidos de Hetzner aparecían **sin disponibilidad** a inicios de
septiembre de 2026 y subieron 30–38 % en junio (fuente citada); en D, la capacidad ARM gratuita suele
estar agotada y el límite se redujo sin aviso: no hay garantía de servicio. En C, la operación depende
de la red institucional (IP pública o túnel de salida) y de que alguien mantenga el equipo, lo que
reintroduce la causa C4 salvo que lo administre la unidad de TI del campus. Desde el 01/11/2026 la alternativa C está en marcha como
**servidor de prueba** (§7): la administración va por una red privada cifrada de salida entre equipos propios, que no exige puertos de
entrada en la red institucional.

## 4. Criterios ponderados y evaluación

| Criterio | Peso | Por qué |
|---|---|---|
| Costo mensual | 30 % | Objetivo explícito del trabajo (OE3, RNF-17: operar barato) |
| Garantía de disponibilidad | 20 % | Un servicio de monitoreo que se cae no monitorea |
| Facilidad de operación | 20 % | Causa C4: sin personal técnico |
| Ubicación de los datos | 15 % | Datos ambientales institucionales; preferencia por jurisdicción nacional si el cliente lo exige |
| Escalabilidad | 10 % | Pasar de 50 a 500 canales sin rehacer |
| Latencia | 5 % | MQTT y el panel toleran 150–200 ms sin efecto perceptible |

| Alt. | Costo (30) | Disponib. (20) | Operación (20) | Ubicación (15) | Escala (10) | Latencia (5) | **Total** |
|---|---|---|---|---|---|---|---|
| A Hetzner | 5 | 4 | 5 | 2 | 5 | 3 | **4,30** |
| A' DigitalOcean | 3 | 5 | 5 | 2 | 5 | 3 | 3,95 |
| B VPS nacional | 3 | 4 | 4 | 5 | 3 | 5 | 3,80 |
| C Mini-PC campus | 4 | 2 | 2 | 5 | 2 | 5 | 3,25 |
| D Oracle gratuito | 5 | 1 | 3 | 2 | 3 | 3 | 3,05 |

Escala 1–5. Total = Σ (puntaje × peso).

## 5. Recomendación (TT-26)

**Para la validación de la Etapa 4 y un piloto de un sitio: alternativa A** (Hetzner CX23 o CAX11):
cumple RNF-17 con holgura (4 GB para un techo de 1,6 GB, o de 1,95 GB con ChirpStack en la ruta A), cuesta del orden de **CLP 6 000 al mes
(≈ CLP 75 000 al año)** —menos que un plan de telefonía— y la operación se reduce a `docker compose
up -d`. La plataforma completa cuesta así **menos de la décima parte** de un VPS nacional de similar
capacidad y una fracción de cualquier licencia comercial del rubro.

**Si el cliente exige datos en Chile: alternativa B**, con el mismo Compose y un costo del orden de
CLP 30 000 al mes. **La decisión es reversible en horas** gracias a los contenedores: migrar es copiar
volúmenes y repetir el despliegue.

**Recomendación de arquitectura de CPU:** las imágenes usadas (PostgreSQL/TimescaleDB, Mosquitto,
Node) existen para ARM64 y el plan ARM es el más barato por unidad de cómputo; la única precaución es
la lección de la industria sobre binarios nativos: **las dos etapas de la imagen del backend deben
compartir la misma base** (glibc con glibc), porque un binario compilado en la etapa de construcción
contra una librería C distinta de la de ejecución falla solo en producción. Hoy el backend no tiene
dependencias nativas, así que el riesgo es nulo, pero la regla queda escrita para cuando las haya.

**Lo que no se hace:** contratar una base de datos gestionada aparte (multiplica el costo por 3–5 sin
necesidad a esta escala), ni Kubernetes por ahora (un orquestador para cuatro o cinco contenedores en un servidor es
complejidad sin retorno; el diseño para cuando exista un clúster está en §6).

## 6. Despliegue en Kubernetes: qué significa aquí y cuándo (decidido el 21/10/2026)

**La pregunta** que motivó esta sección: «usar el estándar de contenedores para pasar el sistema a Kubernetes, balancear carga, escalar
ante picos y respaldar». **Hecho verificable:** las imágenes que construye `docker compose build` ya son imágenes **OCI** (*Open
Container Initiative*: el estándar de imagen y de *runtime* que Kubernetes ejecuta con `containerd`). No hay otro estándar que adoptar.
Lo que falta no es el formato, sino (a) la **descripción del despliegue** (hoy, Compose) y (b) el **diseño del estado** para que más de
una réplica del backend no se pise. La decisión: **A ahora, B diseñada** (decisión del 21/10/2026).

### 6.1 Lo que impone el estado de cada pieza
| Pieza | ¿Con estado? | Por qué | En Kubernetes |
|---|---|---|---|
| Proxy (nginx) | No | no guarda nada entre peticiones; cualquier réplica atiende cualquier conexión | `Deployment`, N réplicas; puede escalar con `HorizontalPodAutoscaler` sin diseño nuevo |
| Backend (NestJS) | **Hoy sí** | topes por par y por dirección, caché de verificaciones, cupo de `scrypt` y `enCursoHttp` viven en la memoria del proceso (`docs/10 §8.4` puntos 52 y 53), y hay **una sola suscripción MQTT con sesión persistente** (`clientId` fijo, `clean: false`, MQTT 3.1.1) | `Deployment` con **una réplica** (opción A) y sondas `liveness`/`readiness` sobre `/salud`; N réplicas solo con la opción B |
| Mosquitto | Sí | `mosquitto.db` (sesiones persistentes, mensajes en cola) y `dynamic-security.json` (credenciales y ACL) | `StatefulSet` de 1 réplica con volumen persistente; sin réplicas (un broker en clúster es otra pieza: `docs/10 §8.4` punto 10) |
| TimescaleDB | Sí | todo el dato | `StatefulSet` de 1 réplica con volumen persistente; respaldo con `CronJob` (`pg_dump`) y retención (§2); réplica de lectura asíncrona solo si §9.4 de `docs/10` lo pide |

**Vocabulario.** *Con estado*: la pieza guarda datos que no pueden perderse entre peticiones. *Sin estado*: cualquier réplica atiende
cualquier petición. *`StatefulSet`*: objeto de Kubernetes para piezas con estado (identidad fija y volumen propio por réplica).
*`Deployment`*: réplicas intercambiables. *Sesión persistente* son dos cosas distintas: la del **broker** (el broker guarda suscripciones
y mensajes si el backend cae) y la de **personas** (`docs/20`: cookie `HttpOnly` + `SameSite`).

### 6.2 Opción A (ahora): Compose en un servidor; Kubernetes solo como diseño
Los cuatro contenedores en un servidor con `docker compose up -d` (§5) siguen siendo la recomendación para la Etapa 4 y el piloto, por
tres hechos: (1) **el orquestador cuesta memoria**: la distribución ligera k3s declara como mínimo para un nodo servidor **2 núcleos y 2 GB
de RAM** (y 1 núcleo y 512 MB por nodo agente), según su documentación oficial (docs.k3s.io, *Requirements*, leída el 22/10/2026), es
decir, tanto como el techo completo de RNF-17 para la plataforma entera; en el plan de 4 GB de §5 cabrían ambos, pero sin la holgura que
§5 reserva; (2) **no hay segundo nodo**: balancear y tolerar la caída de un nodo exige al menos dos máquinas, y la Facultad ofrece una (M7);
(3) **lo que Kubernetes daría gratis ya está resuelto a esta escala**: reinicio automático (`restart: unless-stopped`), sondas de salud
(`healthcheck` de cada servicio), límites de memoria y CPU, secretos fuera del repositorio y registros acotados (`docs/11 §4`). Lo que sí
se deja escrito, para que el paso sea mecánico cuando haya clúster, es la **tabla de equivalencias** entre lo que hoy declara Compose y
el objeto de Kubernetes que lo reemplaza:

| Hoy (Compose) | Kubernetes (k3s de un nodo o el clúster institucional) |
|---|---|
| `services.proxy` con `ports: 443, 8883, 80` | `Deployment` + `Service` tipo `LoadBalancer` (o `Ingress` solo para 443; el 8883 es TCP crudo y va por `Service`, no por `Ingress`) |
| `services.backend` | `Deployment` (1 réplica), `readinessProbe`/`livenessProbe` → `GET /salud`, `resources.limits` = los de `docs/10 §6` |
| `services.mosquitto`, `services.timescaledb` | `StatefulSet` (1 réplica cada uno) + `PersistentVolumeClaim` por volumen de Compose |
| `.env` | `Secret` (las mismas variables; el `PROXY_SECRETO` y las claves se escriben una vez, nunca en el manifiesto versionado) |
| `proxy/nginx.conf`, `mosquitto/config/mosquitto.conf` | `ConfigMap` montado en la misma ruta |
| `restart: unless-stopped`, `healthcheck` | `restartPolicy: Always` + sondas |
| `security_opt: no-new-privileges`, `cap_drop` | `securityContext` (`allowPrivilegeEscalation: false`, `capabilities.drop`) |
| respaldo manual de la base (§2) | `CronJob` con `pg_dump` y retención de 7 diarios y 4 semanales (§2) |
| `docker compose logs` | registros por `stdout` igual; la recolección (Loki u otra) es decisión del clúster, no del sistema |

Distribución y licencias: **k3s** y **Helm** son Apache-2.0 (archivo `LICENSE` de cada repositorio oficial, leído el 22/10/2026),
compatibles con la AGPL-3.0 del sistema; un *chart* de Helm es opcional y se escribiría a partir de esta tabla.

### 6.3 Opción B (diseñada para la Etapa 4): N réplicas del backend
Para que varias réplicas no dupliquen tramas ni partan los topes, hacen falta cuatro cambios, cada uno con diseño antes de código:
1. **Suscripciones compartidas de MQTT 5** (`$share/<grupo>/sitio/#`): el broker entrega cada mensaje a **una sola** réplica del grupo, así
   no se paga el doble. Mosquitto 2.x las soporta; nuestro cliente se conecta hoy **a propósito en MQTT 3.1.1** (`protocolVersion: 4`,
   fijado con una prueba y su motivo en `broker.service.spec.ts`): pasar a 5 es un cambio con pruebas, no un interruptor.
2. **Lo que vive en memoria pasa a un lugar compartido** (Redis, o una tabla con `UPDATE … RETURNING`): topes por par y por dirección,
   caché de verificaciones, cupo y `enCursoHttp`. Redis suma una pieza y memoria (RNF-17): se mide antes de elegir.
3. **La comparación del contador de trama se vuelve atómica en SQL** (`docs/10 §4.1` ya lo anota: «procesamiento en paralelo con comparación
   atómica del contador»), porque dos réplicas pueden recibir dos tramas del mismo nodo a la vez.
4. **Lo que no cambia** y por eso B es viable: la consistencia la da la base, no el backend (transacciones; índice único `(canal_id, tiempo)`
   con `ON CONFLICT DO NOTHING`; `FOR NO KEY UPDATE` en el alta y la baja). El orden de llegada entre réplicas no está garantizado y la base
   lo absorbe. Pros: paralelismo real, caída de una réplica sin corte. Contras: una pieza más, MQTT 5 en el cliente, pruebas nuevas.

**Qué se actualiza al pasar a B:** `docs/10` (§4.1, §6 y punto nuevo en §8.4), `docs/07` (Redis si entra), `docs/11 §4` (una réplica
menos no es un riesgo nuevo, pero Redis sí tiene su fila), `docs/04` (elemento de la Etapa 4) y este documento.

## 7. Instalación en un servidor de prueba: procedimiento (decidido el 01/11/2026)

La alternativa C de §3 se pone en marcha como **servidor de prueba**: un equipo reutilizado (8–16 GB de RAM, 2–4 núcleos), en la red de
una institución, sin nombre DNS público y, en principio, sin puertos de entrada desde Internet. No hay usuarios todavía: es un entorno para
probar la instalación, la operación y el acceso remoto antes de llamarlo producción. El procedimiento vale para cualquier servidor Linux
con Docker; lo que cambia entre uno y otro son los datos (nombres, direcciones, credenciales), que viven fuera del repositorio. Las
decisiones están en `docs/10 §8.4` punto 55 y los controles que exige, en `docs/11 §8`.

| Pieza | Decisión | Por qué |
|---|---|---|
| Sistema operativo | Una distribución LTS con soporte de seguridad vigente (Ubuntu Server 26.04 LTS si se instala desde cero; si el equipo trae uno, se acepta solo si pasa la lista de §7.1), instalación estándar, disco **sin cifrar**, parches de seguridad automáticos con reinicio a una hora fija en UTC, registros del sistema acotados | Soporte hasta 2031 sin migrar; Docker y el cliente de la red privada publican paquetes para esa versión (verificado el 01/11/2026); el servidor reinicia solo, y cifrar el disco exigiría teclear una frase en cada arranque; los datos son de prueba |
| Acceso de administración | **Red privada cifrada (WireGuard) entre los equipos del operador y el servidor, de salida**: SSH y los puertos de personas (443 y 80) se publican **solo en la dirección de esa red**. Nada de administración se expone a Internet ni a la red institucional. Mientras la institución no reenvíe un puerto UDP, la red la coordina un servicio de terceros (Tailscale, plan Personal gratuito para uso no comercial, hasta 6 usuarios: [precios](https://tailscale.com/pricing), consultado el 01/11/2026); cuando lo reenvíe, WireGuard propio sin terceros, preparado desde el primer día (las dos conviven) | No depende de que la institución abra puertos; cumple `docs/11 §8` («la API no se publica en 443 antes de M7»): el panel no está en Internet, está en la red privada; cada equipo entra con su propia llave y se revoca por separado; el servicio de coordinación reparte llaves y atraviesa el NAT, pero el tráfico va cifrado de extremo a extremo y no pasa por él |
| Puerto de dispositivos 8883 | Publicado en todas las interfaces | Es el único puerto que el diseño expone (`docs/10 §2`): lo alcanzan la pasarela de la red local y los equipos de la red privada; TLS, credencial por dispositivo y topes del proxy |
| Certificado | CA propia **del servidor de prueba**, distinta de la de desarrollo, creada fuera del servidor (su clave privada no viaja); un solo certificado con SAN para el nombre interno `proxy` (lo verifica el nodo), la dirección de la red local (la verifica la pasarela) y la dirección y el nombre de la red privada (los verifican los navegadores); la raíz se instala una vez en cada cliente | Un solo certificado sirve a los tres tipos de cliente sin tocar la configuración del proxy. Let's Encrypt sigue siendo la meta con nombre público: la imagen del proxy ya trae el módulo ACME nativo de nginx (`ngx_http_acme_module`, verificado el 01/11/2026 en la imagen fijada por digest) y el puerto 80 ya redirige; faltan el nombre y el puerto 80 de entrada |
| Secretos | Generados **en el servidor** con `openssl rand`; nunca se copia el `.env` de desarrollo | `docs/11 §8` y `docs/11 §5`: un `.env` por entorno |
| Forma de producción | `COMPOSE_FILE=docker-compose.yml:proxy/compose.proxy.yml` en el `.env` del servidor | Compose ignora el `override` de desarrollo aunque esté en el árbol (verificado el 01/11/2026: `docker compose config` publica solo los tres puertos del proxy) |
| Arranque | `restart: unless-stopped`, `live-restore` del demonio, el demonio espera a la red privada (`After=`) y `net.ipv4.ip_nonlocal_bind=1` | Corrección candidata del hallazgo de la demostración del 28/10/2026 (un proxy «Up» sin red porque su dirección aún no existía al arrancar, `bitacora/2026-10-28`); se verifica reiniciando dos veces |
| Respaldo | `pg_dump -Fc` diario más el archivo del plugin del broker, 30 días en el servidor, copia periódica fuera por la red privada, **restauración probada** (`timescaledb_pre_restore` → `pg_restore` → `timescaledb_post_restore`), **sin cifrado en reposo todavía** (pendiente, `docs/10 §9.5`) | `docs/10 §9.5` (RPO 24 h, RTO 1 h) y `docs/11 §8` |
| Avisos | Vigilante externo por latido (§7.2) | Un servidor caído no puede avisar que se cayó |
| Actualizar | `git pull --ff-only` con una llave de despliegue de solo lectura → `escanear-imagenes.sh` → `docker compose up -d --build` → `GET /salud` | Lo construido se escanea antes de correr (`docs/11 §8`); en un paso con `desplegar.sh` (Etapa 4). Las migraciones no llevan tabla de versiones: `db/init` corre solo con el volumen vacío; en una base existente se aplican a mano y el guardián (paso 2) las verifica por huella |

### 7.1 Orden de instalación

El detalle con salidas esperadas es operación y no se versiona; el orden sí, porque cada paso protege al siguiente:

1. **Equipo:** encendido automático al volver la energía, contraseña de configuración del firmware, arranque solo desde el disco. Sin
   cifrado de disco, la contraseña del firmware es lo que impide arrancar otro sistema desde un USB.
2. **Sistema:** si el equipo trae uno, se acepta solo si (a) tiene soporte de seguridad vigente, (b) el operador obtiene `sudo`, (c) no hay
   usuarios, llaves SSH ni servicios escuchando hacia afuera que no se puedan explicar, (d) el disco está sano (SMART) y (e) se puede
   actualizar; si falla una, se reinstala. Un disco mecánico viejo se reemplaza por un SSD antes de confiarle datos: el tamaño no importa
   (§2), la edad sí.
3. **SSH y cortafuegos:** solo con llave, un usuario, sin root; entrada denegada salvo SSH por la interfaz de la red privada. El cortafuegos
   del anfitrión no filtra lo que Docker publica: el control de los puertos de la plataforma es la dirección en la que se publican
   (`docs/11 §8`).
4. **Red privada, parches automáticos, Docker** desde el repositorio oficial, `live-restore`.
5. **Plataforma:** repositorio con llave de solo lectura; `.env` nuevo; certificado; `docker compose config` revisado: tres puertos publicados y
   todos del proxy (443, 8883 y el 80, que solo redirige a 443).
6. **Construir, escanear, levantar;** prueba de reinicio; sitio, zona, pasarela y dispositivos de prueba.
7. **Respaldo con restauración probada; latido probado;** rotación de todo antes de llamarlo producción (`docs/11 §7`).

### 7.2 Vigilante externo por latido («hombre muerto»)

La plataforma vigila a sus propios servicios (`docs/10 §6`), pero esos chequeos viven dentro del servidor: si se apaga o pierde la red,
nadie los ve. Un temporizador del sistema consulta `GET /salud` cada 5 minutos y, **solo si responde `ok`**, envía un latido a un servicio
externo; si pasan 10 minutos sin latido, el servicio avisa por correo y por mensajería. Un solo chequeo cubre las dos caídas: servidor
apagado o sin red, y plataforma enferma. Servicio elegido: Healthchecks.io, plan gratuito de 20 chequeos
([precios](https://healthchecks.io/pricing), consultado el 01/11/2026), código abierto bajo licencia BSD de tres cláusulas y autoalojable si algún día se
prefiere. La URL del chequeo es un secreto de operación (`docs/11 §4`). La prueba de que avisa es parte de la instalación: detener el
backend durante el tiempo de gracia y recibir el aviso.

### 7.3 Lo que este servidor de prueba no cubre

Acceso de terceros al panel (M7), nombre público y Let's Encrypt (`docs/10 §8.4` punto 22), un nodo fuera de la red institucional
publicando al servidor (necesita un puerto de entrada) y alta disponibilidad (§6.2). Costo: el equipo existía; energía del orden de la
fila C de §3; red privada y avisos, CLP 0 en sus planes gratuitos.

### 7.4 Cómo quedó en la práctica (03–04/11/2026)

El equipo que apareció ya tenía responsable, otro servicio corriendo y SSH solo con llave. La lista de §7.1 se aplicó con una diferencia
explícita: los usuarios y servicios ajenos se explicaron y el equipo se acepta como **compartido**. Consecuencias frente a lo planeado:
- **Del responsable, no nuestros:** cortafuegos del anfitrión, demonio de Docker (sin `live-restore` ni espera a la red privada), parches del
  sistema y reinicio del equipo. Nuestra parte es un usuario propio con Docker, la pila dentro de su proyecto de Compose y un `sysctl`
  (`ip_nonlocal_bind`). Ningún comando sobre contenedores ajenos.
- **Sin llave de despliegue:** el repositorio es público desde el 03/11; el clon del servidor es anónimo (actualiza, no empuja).
- **Riesgo aceptado del equipo compartido:** quien administra el anfitrión tiene `root` y puede leer el `.env`, el entorno de los contenedores, la
  base y los respaldos. Por eso los secretos son propios de este entorno y no se reutilizan, se rotan al dejar el equipo, y no se cargan datos
  reales mientras sea compartido (`docs/11 §4`).
- **Igual que lo planeado:** red privada de administración (SSH y 443/80 solo ahí; llave sin expiración, nombres de la red, aprobación manual
  de equipos), CA propia creada fuera del servidor con la clave cifrada, secretos generados en el servidor, `COMPOSE_FILE` sin override, 8883
  en todas las interfaces, respaldo diario con restauración probada y copia fuera del servidor (sin cifrado en reposo aún).
- **Verificado en ejecución** (bitácora del 03–04/11, tabla de §4): las dos vías de dispositivo con TLS, los rechazos sin credencial, con
  credencial incorrecta, sin TLS y sin token, solo los puertos del contrato, TLS 1.1 fuera, la pila que vuelve sola tras `docker compose restart`,
  y la restauración del respaldo con los mismos conteos.
- **Pendiente:** latido del vigilante (§7.2), reinicio del equipo con su responsable, cifrado en reposo del respaldo (`docs/10 §9.5`), y una
  dirección de entrada desde Internet (pedida a la institución) para dispositivos fuera de la red del campus.

En paralelo, la institución entregó un namespace de Kubernetes para estudiantes: medido en 17 pruebas (bitácora del 03/11), cabe en cuota y
ejecuta, pero sin dirección de entrada ni cupo de volúmenes persistentes; queda como entorno de desarrollo y como diseño B de §6 hasta que
el administrador conceda ambas cosas.

## 8. Pendiente

- [ ] Recotizar en la calculadora de cada proveedor la semana previa a contratar; registrar fecha.
- [ ] Vistas materializadas horaria y diaria (Etapa 3; edición Apache). La tarea de retención ya existe (`RetencionService`, 07/10): `trama` y `cuarentena` a 30 días; mediciones sin límite salvo que se configure.
- [ ] Medir el consumo real bajo carga en el banco de pruebas (Etapa 4) y contrastar con el plan elegido.
