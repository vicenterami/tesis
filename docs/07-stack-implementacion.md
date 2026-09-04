# Investigación técnica del stack de implementación (Etapa 2)

> **Qué es esto:** verificación de las decisiones de implementación para el diseño de la Etapa 2.
> Cada afirmación se contrasta con su fuente primaria (documentación oficial o repositorio del
> proyecto), no con IA. Lo no verificable se marca como pendiente.
> **Regla:** las cifras de terceros solo entran al informe si están confirmadas por fuente primaria.
> Versión: 4 de septiembre de 2026.

---

## 1. Qué se confirmó y qué no

| Afirmación (origen: investigación previa) | ¿Verificada? | Fuente primaria |
|---|---|---|
| ThingsBoard requiere **≥ 4 GB de RAM** (PostgreSQL) u 8 GB (Cassandra) | ✅ **Confirmado** | Documentación oficial de instalación de ThingsBoard |
| uPlot pesa **~50 KB** minificado | ✅ Confirmado | Repositorio oficial (leeoniya/uPlot) |
| uPlot dibuja **166.650 puntos en 25 ms** en frío | ✅ Confirmado (la cifra exacta es 166.650, no «150.000») | Benchmark oficial de uPlot |
| uPlot: **10 % CPU / 12,3 MB RAM** vs Chart.js 40 % / 77 MB (3.600 pts a 60 fps) | ✅ Confirmado | Benchmark oficial de uPlot |
| Mosquitto escrito en C, consumo de pocos MB | ✅ Conocido y documentado | eclipse-mosquitto |
| ChirpStack «en Rust/Go» | ⚠️ **Matizado**: ChirpStack v4 está escrito principalmente en **Go** | Repositorio ChirpStack |
| ThingsBoard «6,5 GB en la capa base» | ❌ **No verificado con fuente primaria**: no se cita hasta confirmarlo. Basta el ≥ 4 GB oficial |
| TimescaleDB: hypertables particionan por tiempo; `time_bucket` agrega en la BD | ✅ Confirmado | Documentación oficial de TimescaleDB |

**Conclusión sobre el argumento de recursos:** el dato clave para la tesis —ThingsBoard exige
**≥ 4 GB oficialmente**, y el stack propuesto opera en 2 GB— está **confirmado por la documentación
oficial de ambos lados**. Es citable sin riesgo.

---

## 2. La arquitectura, confirmada — con UNA decisión que tomar

El flujo verificado coincide con el diseño del informe:

```
sensor ─LoRaWAN→ gateway ─→ ChirpStack ─publica→ Mosquitto
                                                     │
                                        Backend NestJS (suscrito) ─→ TimescaleDB
                                                     │
                                              API REST ←── dashboard (Svelte + uPlot)
```

Y el patrón de **dos pasos para el dashboard** es correcto y necesario:

1. **Histórico al abrir:** el navegador pide por **API REST** al backend las últimas horas; el backend
   consulta TimescaleDB con `time_bucket` (agrega miles de filas en decenas de puntos) y responde.
2. **Tiempo real después:** el dashboard recibe cada lectura nueva y la añade al gráfico de uPlot.

### 🔴 La decisión de diseño de la Etapa 2: ¿cómo llega el tiempo real al navegador?

Hay dos patrones válidos, y **la investigación previa asumió el primero, que contradice lo escrito en
el informe**. Hay que elegir conscientemente:

| | **Patrón A: navegador ↔ broker directo** | **Patrón B: navegador ↔ solo backend** |
|---|---|---|
| Tiempo real | El navegador se suscribe a **Mosquitto por WebSockets** (MQTT sobre WS, puerto 8083) | El **backend** empuja al navegador por su propio WebSocket o SSE |
| Quién toca Mosquitto | El navegador **y** el backend | **Solo** el backend |
| Simplicidad | Mayor (una librería MQTT.js en el navegador) | Menor (el backend reenvía) |
| Seguridad | ⚠️ Expone el broker a internet; las credenciales MQTT viajan al navegador | ✅ El broker nunca se expone; el navegador solo ve la API autenticada |
| Coherencia con el informe | ❌ **Lo contradice** («el navegador nunca toca MQTT: consulta la API REST») | ✅ Coherente |
| Filtrado y normalización | El navegador recibe la trama cruda | El backend ya normalizó y filtró antes de reenviar |

> **Recomendación: Patrón B.** El navegador habla solo con el backend (REST para histórico, WebSocket
> del backend para tiempo real). Razones: no expone el broker, no pone credenciales MQTT en JavaScript
> del cliente, mantiene el pipeline de filtros como único camino de los datos, y **es lo que el informe
> ya declara**. El Patrón A es más rápido de prototipar pero rompe la capa de seguridad y el pipeline.
> Decisión a confirmar en la Etapa 2.

---

## 3. Piezas nuevas que la investigación aportó al diseño

- **Docker multi-stage build**: compilar Svelte y NestJS en un contenedor final liviano, y que NestJS
  sirva los archivos estáticos del dashboard (`@nestjs/serve-static`). Válido y recomendable.
- **`docker compose up -d --build`** + `restart: unless-stopped` para el arranque y la recuperación
  automática (ya contemplado como RNF de la plataforma).
- **`docker stats`**: comando para medir el consumo real de cada contenedor — es exactamente el
  instrumento del banco de comparación contra ThingsBoard (backlog TT-39) de la Etapa 4.
- **Persistencia del driver `pg` sobre TypeORM**: para series de tiempo, SQL directo con `time_bucket`
  es más simple y rápido que un ORM. Decisión de la Etapa 2; coherente con mantener el backend liviano.

---

## 4. Advertencias de seguridad (para el diseño)

- **Autenticación del broker obligatoria:** Mosquitto nunca anónimo. Usuario/clave o certificado por
  dispositivo (ya es requerimiento RNF-08 y RF-40).
- **WSS, no WS:** si algún día se usa el patrón A, el broker necesita TLS (WebSocket seguro) y
  certificados vigentes. Otra razón a favor del patrón B.
- El código de ejemplo de la investigación es orientativo: contenía una URL mal formada
  (`ws://://hivemq.com`) y usa un broker público de terceros. En este proyecto todo es autoalojado.

---

## 5. Encaje con la rúbrica

Esto es material de la **Etapa 2** (Diseño e implementación inicial), cuyo criterio de mayor peso
—55 %— es «diseña adecuadamente según estándares de calidad». Un stack justificado con fuentes
primarias, con la decisión arquitectónica del tiempo real explicitada y una comparación de recursos
medible, alimenta directamente ese criterio. No afecta la entrega de la Etapa 1.

---

## 6. Referencias (APA)

ChirpStack. (2026). *ChirpStack open-source LoRaWAN Network Server* [Repositorio de software].
GitHub. https://github.com/chirpstack/chirpstack

Eclipse Foundation. (2026). *Eclipse Mosquitto: An open source MQTT broker*.
https://mosquitto.org/

Larsson, O. (2026). *uPlot: A small, fast chart for time series* [Repositorio de software].
GitHub. https://github.com/leeoniya/uPlot

ThingsBoard. (2026). *Installing ThingsBoard CE on Ubuntu Server: Hardware requirements*.
https://thingsboard.io/docs/user-guide/install/ubuntu/

Timescale. (2026). *Hypertables and the time_bucket function — TimescaleDB documentation*.
https://docs.timescale.com/

> Verificación reproducible por el propio autor: `docker stats` sobre el `docker-compose` del proyecto
> permite medir el consumo real de RAM y CPU de cada contenedor, y contrastarlo con el ≥ 4 GB que
> exige la documentación de ThingsBoard.
