# Arquitectura del sistema (Etapa 2 — Diseño)

> **Sustenta:** OE2 y OE3 · criterio «diseña según estándares de calidad» (55 %) de la Etapa 2.
> **Notación:** vista de contenedores del modelo C4 (Brown) para la estructura; diagramas de
> secuencia UML para el comportamiento; vista de despliegue para la infraestructura. Todos son
> Mermaid: se ven en GitHub y `informe-oficial/figuras/generar-figuras.sh` los renderiza a PDF para el informe
> desde esta misma fuente (el modelo de datos se genera desde la base real). Versión: 8 de septiembre de 2026.
> **Depende de:** `docs/06` (pipeline), `docs/07` (stack y patrón B), `docs/08` (modelo de datos).

---

## 1. Vista de contenedores (C4, nivel 2)

Qué piezas ejecutables existen y cómo se hablan. La **frontera** del trabajo es el tópico MQTT: a la
izquierda está la red de sensores (lado del compañero); a la derecha, la plataforma. Los módulos M1–M8
son los del análisis de requerimientos (`docs/02` §3); M3 (aprovisionamiento), M7 (seguridad e
identidad) y M8 (interfaz) no aparecen como cajas porque son transversales o viven en el cliente.

```mermaid
flowchart TB
    subgraph RED["Red de sensores · lado del compañero"]
        direction LR
        N1["Nodo sensor LoRa<br/>ESP32 + sensores"] -- "LoRa (radio)" --> GW["Gateway LoRaWAN"]
        N2["Nodo sensor Wi-Fi<br/>MQTT directo"]
    end

    subgraph SRV["Servidor de la plataforma · contenedores Docker"]
        direction TB
        CS["ChirpStack<br/>servidor de red LoRaWAN"]
        MQ["Mosquitto<br/>broker MQTT · TLS"]
        subgraph BE["Backend · NestJS"]
            direction LR
            M1["M1 Recepción<br/>suscriptor MQTT"] --> M2["M2 Normalización<br/>pipeline de 6 filtros"]
            M2 --> M4["M4 Supervisión<br/>de salud"] --> M6["M6 Alertas<br/>umbrales, condiciones"]
            M5["M5 Persistencia y consulta<br/>API REST + WebSocket"]
        end
        DB[("TimescaleDB<br/>series de tiempo + tablas relacionales")]
    end

    subgraph CLI["Cliente"]
        direction LR
        U(["Usuario<br/>navegador"]) --- FE["Panel web<br/>Svelte + uPlot"]
    end

    GW -- "UDP/IP → Internet" --> CS
    CS -- "publica JSON decodificado" --> MQ
    N2 -- "MQTT/TLS 8883" --> MQ
    MQ -- "suscripción sitio/#" --> M1
    M2 -- "INSERT medicion" --> DB
    M6 -- "condiciones, eventos" --> DB
    M5 -- "SQL · time_bucket" --> DB
    FE -- "HTTPS 443 · REST histórico · WS tiempo real" --> M5
```

**Decisiones visibles en el diagrama:**

- **Un solo punto de entrada para personas (443)** y **un solo punto de entrada para máquinas (8883)**.
  La base de datos y ChirpStack no se exponen a Internet.
- **El navegador nunca toca el broker** (patrón B, `docs/07`): consume la API del backend, que ya
  filtró y normalizó. Así la trama cruda jamás llega al cliente y las credenciales MQTT no viajan en
  JavaScript.
- **ChirpStack es un productor más** hacia el broker: para la plataforma, una trama LoRaWAN y una
  trama Wi-Fi son indistinguibles después del filtro 2 (adaptador). Eso es lo que resuelve la causa
  C2 (hardware atado a la plataforma).

## 2. Topología de red y segmentación

Vista de red de la solución: qué segmentos existen, qué puertos cruzan cada frontera y qué queda
aislado. Sustenta los RNF de seguridad (TLS obligatorio, mínimo privilegio, conexión saliente de los
dispositivos para no requerir NAT — RNF-10).

```mermaid
flowchart TB
    subgraph CAMPO["Segmento de campo (sitio del cliente)"]
        S1["Nodos LoRa"] -- radio --> G["Gateway"]
        S2["Nodos Wi-Fi"] --> R["Router del sitio\n(NAT, sin puertos abiertos)"]
        G --> R
    end

    INET(("Internet"))

    subgraph DMZ["Servidor · red pública (expuesta)"]
        RP["Proxy inverso / TLS\n:443 → panel y API\n:8883 → broker (mTLS opcional)\n:1700/udp → ChirpStack (solo gateway)"]
    end

    subgraph INT["Servidor · red interna Docker (no expuesta)"]
        MQ["Mosquitto :1883"]
        CS["ChirpStack :8080"]
        BE["Backend :3000"]
        DB[("TimescaleDB :5432")]
    end

    R -- "salientes únicamente" --> INET
    INET --> RP
    RP --> MQ
    RP --> CS
    RP --> BE
    CS --> MQ
    MQ --> BE
    BE --> DB

    NAV(["Navegador del usuario"]) -- "HTTPS :443" --> INET
```

| Frontera | Cruza | No cruza | Por qué |
|---|---|---|---|
| Sitio → Internet | Conexiones **salientes** de nodos y gateway | Nada entrante | Los dispositivos inician la conexión: no hay que abrir puertos en el router del cliente (RNF-10) |
| Internet → servidor | 443 (personas), 8883 (dispositivos), 1700/udp (gateway) | 5432, 1883, 8080, 3000 | Solo se expone lo que necesita hablar con el exterior; todo lo demás vive en la red interna de Docker |
| Red interna | Tráfico entre contenedores por nombre de servicio | Acceso desde fuera | La base de datos solo es alcanzable desde el backend |

**Sobre las alternativas descartadas:** exponer el broker por WebSocket al navegador (patrón A)
habría abierto un puerto más y puesto credenciales en el cliente; una VPN habría exigido
configuración en cada sitio (reintroduce la causa C4, falta de personal técnico).

## 3. Secuencia: aprovisionamiento de un dispositivo (dar de alta)

Cómo un dispositivo pasa de desconocido a reconocido. Es el flujo que ataca directamente la causa
C4: debe poder hacerlo una persona sin perfil técnico, desde el panel.

```mermaid
sequenceDiagram
    actor Admin as Administrador de sitio
    participant FE as Panel web
    participant API as Backend · API
    participant DB as TimescaleDB
    participant MQ as Broker
    participant Dev as Dispositivo

    Admin->>FE: Asistente "nuevo dispositivo"
    FE->>API: POST /dispositivos {zona, id_fisico, canales[]}
    API->>DB: INSERT dispositivo, canal×N
    API->>API: genera credencial (secreto aleatorio)
    API->>DB: INSERT credencial (solo el hash)
    API->>MQ: registra usuario MQTT + ACL al tópico del dispositivo
    API-->>FE: 201 {id, credencial en claro — se muestra UNA vez}
    FE-->>Admin: Muestra credencial + tópico + ejemplo de trama
    Admin->>Dev: Carga credencial en el firmware (o la entrega al compañero)
    Dev->>MQ: CONNECT (id_fisico, credencial) · TLS
    MQ->>MQ: valida credencial y ACL
    Dev->>MQ: PUBLISH sitio/…/dispositivo/<id>/<magnitud>
    MQ->>API: entrega la trama (suscriptor)
    API->>DB: UPDATE dispositivo.visto_por_ultima_vez
    API-->>FE: WS "dispositivo en línea"
    FE-->>Admin: Estado: en línea ✅
```

**Puntos de diseño:**

- La credencial **se muestra una sola vez** y en la base solo queda su **hash** (misma política que
  una contraseña). Si se pierde, se **rota** (nueva fila en `credencial`), no se recupera.
- La **ACL del broker** limita a cada dispositivo a publicar solo en su propio tópico: un nodo
  comprometido no puede suplantar a otro.
- El estado "en línea" se deduce del **primer mensaje autenticado**, no de la alta: dar de alta un
  dispositivo que aún no transmite lo deja en "esperando primer contacto".

## 4. Secuencia: recepción de una trama (pipeline de seis filtros)

Comportamiento del núcleo del trabajo. Cada filtro tiene una salida "feliz" (sigue) y una de rechazo
(cuarentena o descarte), y ninguna trama llega a las series de tiempo sin pasar los seis.

```mermaid
sequenceDiagram
    participant MQ as Broker
    participant F1 as 1 Autenticar
    participant F2 as 2 Analizar (adaptador)
    participant F3 as 3 Validar
    participant F4 as 4 Normalizar
    participant F5 as 5 Supervisar
    participant F6 as 6 Alertar
    participant DB as TimescaleDB
    participant Q as Cuarentena

    MQ->>F1: trama cruda + tópico + identidad
    alt dispositivo desconocido o dado de baja
        F1->>Q: guarda cruda, motivo "desconocido"
    else conocido y activo
        F1->>F2: trama + dispositivo
        F2->>F2: elige adaptador por origen (SenML nativo / JSON del compañero / ChirpStack)
        alt formato irreconocible
            F2->>Q: motivo "malformada"
        else parseada
            F2->>F3: lecturas {canal, valor, unidad, tiempo}
            F3->>DB: consulta magnitud (unidad canónica, rango)
            alt fuera de rango, unidad incompatible o canal no declarado
                F3->>Q: motivo "inválida"
            else válida
                F3->>F4: lecturas válidas
                F4->>F4: convierte unidad, ajusta marca de tiempo (sin reloj → hora de recepción)
                F4->>DB: INSERT medicion (hypertable)
                F4->>F5: lecturas normalizadas
                F5->>DB: UPDATE visto_por_ultima_vez · cierra condición "sin_comunicacion" si estaba abierta
                F5->>F6: lecturas + reglas de umbral del canal
                alt cruza umbral (con histéresis)
                    F6->>DB: abre/cierra condicion, INSERT evento
                    F6-->>MQ: notifica (WS al panel · correo si configurado)
                end
            end
        end
    end
```

**Por qué el orden importa:** autenticar primero evita gastar CPU en tramas de desconocidos
(resistencia a ruido); validar antes de normalizar evita convertir basura; supervisar después de
guardar garantiza que "visto por última vez" refleje una lectura real, no un intento fallido.

**Un supervisor aparte, por tiempo:** el filtro 5 solo corre cuando *llega* una trama. Para detectar
el caso contrario —un dispositivo que **dejó de** transmitir— hay una tarea periódica (cada minuto)
que compara `visto_por_ultima_vez` contra `intervalo_esperado_s` y abre la condición
`sin_comunicacion`. Sin ella, un sensor caído sería invisible.

## 5. Secuencia: panel en tiempo real (patrón B)

```mermaid
sequenceDiagram
    actor U as Usuario
    participant FE as Panel (Svelte)
    participant API as Backend
    participant DB as TimescaleDB

    U->>FE: abre la vista de un dispositivo
    FE->>API: GET /canales/{id}/historico?desde=-24h&bucket=15m
    API->>DB: SELECT time_bucket('15 min', tiempo), avg(valor) …
    DB-->>API: ~100 puntos agregados
    API-->>FE: [[tiempos],[valores]]
    FE->>FE: uPlot dibuja el histórico
    FE->>API: WS suscribe {canal_id}
    loop cada trama nueva que pasa el pipeline
        API-->>FE: WS {canal_id, valor, tiempo}
        FE->>FE: uPlot.setData (añade el punto)
    end
```

El histórico viene **agregado por la base de datos** (`time_bucket`), no crudo: el navegador recibe
cientos de puntos, no millones, sin importar cuánto tiempo lleve el sensor transmitiendo.

## 6. Vista de despliegue (Docker Compose)

```mermaid
flowchart TB
    subgraph HOST["Servidor Ubuntu · Docker Engine · red interna «plataforma»"]
        direction LR
        subgraph SVC["Contenedores (versión fijada · no-new-privileges · reinicio automático)"]
            direction TB
            C5["proxy<br/>Caddy · TLS automático<br/>límite 0,1 GB · publica 443, 8883, 1700/udp"]
            C1["mosquitto<br/>eclipse-mosquitto 2.0.22<br/>límite 0,25 GB"]
            C2["chirpstack<br/>+ redis propio<br/>límite 0,35 GB"]
            C4["backend<br/>imagen propia: NestJS + panel estático<br/>límite 0,5 GB · sin estado"]
            C3["timescaledb<br/>timescale/timescaledb 2.24.0-pg16<br/>límite 0,75 GB"]
        end
        V4[("vol: certificados")]
        V2[("vol: datos-mosquitto")]
        V1[("vol: datos-timescale<br/>todo el dato · base «chirpstack» aparte")]
    end
    C5 --- V4
    C1 --- V2
    C3 --- V1
    C2 -. "base propia en el mismo PostgreSQL" .-> C3
```

| Servicio | Persistencia | Reinicio | Expuesto |
|---|---|---|---|
| proxy | certificados | `unless-stopped` | 443, 8883, 1700/udp |
| mosquitto | retenidos + ACL | `unless-stopped` | no (vía proxy) |
| chirpstack | base `chirpstack` en el mismo PostgreSQL (volumen datos-timescale) + redis | `unless-stopped` | no (vía proxy) |
| timescaledb | **todo el dato** | `unless-stopped` | no |
| backend | ninguna (sin estado) | `unless-stopped` | no (vía proxy) |

**Suma de límites: ~1,95 GB** — coherente con RNF-17 (operar en ≤ 2 GB en reposo; los límites son
techos, no consumo). Los límites de recursos cumplen doble función: proteger al servidor y ser el
**entorno de referencia** del banco de pruebas (`docs/09`). **ChirpStack comparte el servidor PostgreSQL** (una base y un rol propios, aislados de la base de la
plataforma) en lugar de traer un segundo PostgreSQL: ahorra ~100 MB de memoria en reposo, un
respaldo cubre todo, y la extensión TimescaleDB no interfiere (ChirpStack solo necesita `pg_trgm` y
`hstore`, presentes en la imagen). Redis sí es propio: ChirpStack lo exige y es pequeño (~10 MB).
El backend **no guarda estado**: se puede
destruir y recrear sin perder nada, lo que simplifica actualizaciones y pruebas.

## 7. Trazabilidad con los requerimientos

| Elemento de diseño | Requerimientos que materializa |
|---|---|
| Un punto de entrada TLS para máquinas (8883) y otro para personas (443) | RNF-08, RNF-09, RNF-10 |
| Adaptadores por origen (filtro 2) | RF-01, RF-02, RF-04 (recepción multiprotocolo) |
| Cuarentena separada de las series | RF-11, RF-12, RF-13 |
| Supervisor periódico de `sin_comunicacion` | RF-22, RF-24, RF-25 |
| Credencial de un solo vistazo + ACL por dispositivo | RF-40, RF-41, RF-42 |
| Histórico agregado con `time_bucket` + WS del backend | RF-29, RNF-04, RNF-17 |
| Límites de recursos por contenedor | RNF-17, protocolo de validación |

## 8. Pendiente

- [ ] Confirmar con el compañero el tópico exacto y la forma de su JSON para escribir el adaptador
      (filtro 2) — ver bitácora de acuerdos.
- [ ] Decidir el proxy inverso definitivo (Caddy por TLS automático vs. Nginx por familiaridad).
- [ ] Llevar los diagramas a TikZ para el informe de la Etapa 2 con la regla de anchos de `main.tex`.
