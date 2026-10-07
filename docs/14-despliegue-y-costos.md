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
| Cómputo (vCPU, memoria) | Procesos que corren y su techo de memoria | 5 contenedores, techo 1,95 GB, consumo en reposo ≈ 120 MB medido el 27/09 (base 61, backend 53, broker 8) → **el rubro dominante y el más acotado** |
| Almacenamiento | Filas × tamaño × retención (sin compresión) | Pequeño (§2) |
| Base de datos gestionada | Solo si se externaliza | No: TimescaleDB va en el mismo servidor (RNF-17) |
| Tráfico de salida | GB que salen a Internet | Mínimo: el panel y la API sirven agregados, no datos crudos |
| Observabilidad | Logs y métricas por volumen | `docker compose logs` y `docker stats`; sin servicio externo |
| Dominio y TLS | Registro anual; certificados | Dominio ~USD 10–15/año; TLS gratuito (Let's Encrypt, emitido por el proxy) |

## 2. Modelo de volumen y política de retención

**Escenario del núcleo demostrativo:** 50 canales (sensor × magnitud) reportando cada 5 minutos.

| Magnitud | Cálculo | Valor |
|---|---|---|
| Filas por día | 50 × (86 400 / 300) | 14 400 |
| Filas por año | 14 400 × 365 | ≈ 5,3 millones |
| Tamaño por fila sin comprimir | `uuid` 16 + `timestamptz` 8 + `float` 8 + `text` ≈ 6 + cabecera ≈ 24 | ≈ 62 B |
| Crudo por año, sin comprimir | 5,3 M × 62 B | ≈ 330 MB (+ ~40 % de índice) |
| Compresión | **No se usa** desde el 06/10/2026: la compresión de TimescaleDB es Timescale License y el sistema adopta la edición Apache (`docs/02`, RNF-15). Diez años del escenario ≈ 3,3 GB + índices ≈ 4,6 GB | — |

**Política en capas** (la parte que hay que decidir **antes** de recibir datos; después es migración):

| Capa | Qué | Retención | Cómo |
|---|---|---|---|
| Crudo | Cada lectura, sin comprimir | 2 años | fragmentos de 7 días (ya configurado) |
| Agregado horario | mín, máx, promedio, cuenta por canal y hora, en la zona del sitio | indefinido | vista materializada refrescada por tarea programada (Etapa 3; el agregado continuo es Timescale License) |
| Agregado diario | ídem por día | indefinido | vista materializada refrescada por tarea (Etapa 3) |
| Crudo antiguo | > 2 años | se borra con `drop_chunks` (función Apache) desde una tarea programada del backend, o se exporta a archivo antes | tarea de retención (Etapa 3; la política automática es Timescale License) |

Con esto, **diez años de operación del escenario ocupan ≈ 4,6 GB sin compresión** (330 MB por año más ≈ 40 % de
índices). El almacenamiento no es el problema; el consumo de memoria RAM sí: RNF-17 lo acota a 2 GB en un servidor de 4 GB.

**Qué se guarda y qué no.** Un sensor que reporta cada segundo un fenómeno que cambia cada cinco
minutos multiplica el costo por trescientos sin agregar información. El intervalo lo fija el
`intervalo_esperado_s` de cada dispositivo, y el catálogo de magnitudes define qué medir; la
plataforma no guarda tramas rechazadas en las series (van a cuarentena, que sí tiene retención corta).

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
reintroduce la causa C4 salvo que lo administre la unidad de TI del campus.

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
cumple RNF-17 con holgura (4 GB para un techo de 1,95 GB), cuesta del orden de **CLP 6 000 al mes
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
necesidad a esta escala), ni Kubernetes (un orquestador para cinco contenedores en un servidor es
complejidad sin retorno).

## 6. Pendiente

- [ ] Recotizar en la calculadora de cada proveedor la semana previa a contratar; registrar fecha.
- [ ] Vistas materializadas horaria y diaria, y tarea de retención de 2 años con `drop_chunks` (Etapa 3; edición Apache, decisión del 06/10/2026).
- [ ] Medir el consumo real bajo carga en el banco de pruebas (Etapa 4) y contrastar con el plan elegido.
