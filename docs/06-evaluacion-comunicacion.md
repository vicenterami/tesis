# Evaluación: comunicación, formato de trama y arquitectura de adquisición

> **Contexto:** tras el pivote del 02/09 (se descarta Contact ID; el foco es telemetría continua
> cada 5–30 min), esta evaluación reemplaza a la de `docs/05`. Aquella queda como evidencia del
> camino evaluado y descartado.
> **Regla de presentación:** criterios con nombre legible (nada de «C-A»), pesos justificados,
> pros y contras en palabras. Versión: 2 de septiembre de 2026.

---

## 1. El marco: tres decisiones distintas que no hay que mezclar

| Decisión | Pregunta que responde | Candidatos |
|---|---|---|
| **A. Mecanismo de transporte** | ¿Cómo viaja el mensaje del dispositivo al servidor? | MQTT · HTTP/REST · CoAP · WebSocket · socket TCP propio |
| **B. Formato de la trama** | ¿Cómo se escriben los datos dentro del mensaje? | JSON libre · **SenML** (JSON estándar) · binario/hexadecimal propio · CBOR |
| **C. Arquitectura de adquisición** | ¿Qué hardware conecta el sensor a la red? | Puente ESP32 · mini-PC de campo · sensor con red propia |

Son independientes: se puede mandar SenML por MQTT o por HTTP; un ESP32 puede hablar MQTT o
sockets. Evaluarlas juntas fue parte de la confusión anterior.

---

## 2. Decisión A — Mecanismo de transporte

### 2.1 Criterios y pesos (con su porqué)

| Criterio | Peso | Por qué este peso |
|---|---|---|
| **Entrega confiable** (¿me entero si un dato se perdió?) | 25 % | El monitoreo continuo tolera perder una lectura, pero la plataforma debe *saber* qué llegó y qué no; y las alertas no pueden perderse |
| **Detección de dispositivo caído** | 20 % | «El silencio de un sensor es indistinguible de la ausencia de novedades» sigue siendo la causa C5, con o sin Contact ID |
| **Costo en el nodo** (memoria, batería, complejidad en ESP32) | 20 % | Los nodos son microcontroladores; el compañero implementa este lado |
| **Facilidad en el backend** (librerías, integración con la plataforma) | 15 % | Proyecto unipersonal del lado servidor |
| **Sobrecarga por mensaje** (cabeceras vs. dato útil) | 10 % | Relevante en radio y en enlaces pobres; menos crítico en WiFi/Ethernet. La objeción del profesor a HTTP vive aquí |
| **Funciona tras NAT sin abrir puertos** | 10 % | Requisito RNF-10; los sensores están en redes ajenas |

### 2.2 La tabla

| | MQTT | HTTP/REST | CoAP | WebSocket | Socket TCP propio |
|---|:---:|:---:|:---:|:---:|:---:|
| Entrega confiable | **5** — QoS 0/1/2 integrado | 3 — reintento manual | 3 — confirmable opcional | 2 — a mano | 1 — todo a mano |
| Detección de caído | **5** — LWT + keep-alive | 2 — solo timeout | 2 | 3 — ping/pong | 2 |
| Costo en el nodo | 4 — librerías maduras ESP32 | 4 | 4 | 3 | **5** — mínimo absoluto |
| Facilidad backend | **5** — suscribirse y listo | **5** | 2 — poco ecosistema | 3 | 1 — parser propio, sesiones propias |
| Sobrecarga por mensaje | **5** — cabecera de 2 bytes | 2 — cientos de bytes de cabeceras | **5** | 4 | **5** |
| Tras NAT sin abrir puertos | **5** | **5** | 4 (UDP a veces filtrado) | **5** | **5** |
| **Total ponderado** | **4,85** | 3,45 | 3,05 | 3,05 | 2,60 |

### 2.3 Pros y contras en palabras

**MQTT (4,85) — el diseñado exactamente para esto.**
Pros: publicar/suscribir desacopla sensores de consumidores; **QoS** da tres niveles de garantía de
entrega sin programar nada; **LWT** avisa solo cuando un dispositivo se desconecta sin despedirse
(la detección de caída sale gratis); cabecera de 2 bytes (la respuesta a la objeción del profesor
sobre las cabeceras de HTTP); conexión saliente y persistente → RNF-10; nació para IoT en redes
inestables. Contras: exige operar un broker (Mosquitto: un contenedor, consumo mínimo); el
navegador no habla MQTT nativo (irrelevante: el dashboard consulta a la API, no al broker).

**HTTP/REST (3,45) — la puerta universal, no la principal.**
Pros: cualquier dispositivo y cualquier integrador sabe hacer un POST; sin broker; trivial de
probar con curl. Contras: **cabeceras de cientos de bytes por mensaje para 20 bytes de dato** (la
crítica del profesor es correcta); sin entrega garantizada ni noción de "cliente conectado" → la
caída solo se infiere por silencio; cada envío abre conexión (o exige mantener keep-alive a mano).
Veredicto: **vía secundaria de integración**, no el camino de los sensores propios.

**CoAP (3,05):** el "HTTP compacto" sobre UDP pensado para nodos mínimos; técnicamente digno, pero
ecosistema pequeño, UDP a veces bloqueado, y sin ventaja real sobre MQTT en este caso.
**WebSocket (3,05):** canal persistente pensado para navegadores; para sensores obliga a inventar
encima lo que MQTT ya trae (temas, QoS, LWT). Útil solo como túnel de MQTT para dashboards en vivo.
**Socket TCP propio (2,60):** máxima ligereza y control total, al precio de reinventar sesiones,
reconexión, confirmaciones y formato — meses de trabajo para lograr un MQTT peor. Se descarta con
argumento, no por pereza.

### 2.4 Recomendación A

> **MQTT como vía principal** (broker Mosquitto), **HTTP/REST como vía secundaria** para
> integraciones y pruebas, y la rama LoRa entra por **ChirpStack, que ya publica en MQTT**: converge
> sola a la vía principal. El navegador nunca toca MQTT: consulta la API del backend.

---

## 3. Decisión B — Formato de la trama

### 3.1 ¿Comprimido/hexadecimal o legible?

La intuición «que viaje en hexadecimal y yo lo traduzco» es correcta **para radio** (LoRa: payload
de 11–51 bytes) e innecesaria **para WiFi/Ethernet** (paquetes de miles de bytes; un JSON de 120
bytes es irrelevante y se depura leyéndolo a ojo). Regla adoptada: **binario solo donde el canal lo
exige; legible donde no.**

| | JSON libre | **SenML (JSON, RFC 8428)** | Binario/hex propio | CBOR (binario estándar) |
|---|---|---|---|---|
| Qué es | Campos que cada uno inventa | **Estándar IETF para listas de mediciones**: nombre, valor, unidad, tiempo | Bytes definidos por nosotros | "JSON en binario", estándar |
| Pro | Flexible, universal | Formato definido por norma → nadie pregunta «¿por qué ese campo?»; unidades y tiempo resueltos; sigue siendo JSON legible | Mínimo peso | Compacto y estándar |
| Contra | **Reproduce la causa C1**: cada sensor con sus nombres | Levemente más verboso que JSON ad hoc | Indocumentado, indepurable, hay que especificarlo y mantenerlo | Ilegible a ojo; librería extra en el nodo |
| Veredicto | ❌ es el problema | ⭐ **para MQTT/HTTP** | solo rama LoRa | opcional futuro |

**SenML no es de pago:** los RFC de la IETF (el organismo que estandariza internet: IP, TCP, HTTP
son RFCs) son **públicos y gratuitos** — al contrario que los estándares SIA. Ejemplo de trama:

```json
[
  {"bn":"urn:dev:ow:10e2073a01080063", "bt":1756857600},
  {"n":"temperatura", "u":"Cel",  "v":23.4},
  {"n":"humedad",     "u":"%RH",  "v":67},
  {"n":"bateria",     "u":"%EL",  "v":87}
]
```
`bn` = nombre base (identidad del dispositivo, p. ej. su MAC), `bt` = tiempo base, y cada medición
con nombre, unidad estándar y valor. **La identificación viene dentro de la trama** y se cruza con
el registro de dispositivos de la plataforma.

### 3.2 Identificación y tipos de sensor (la pregunta del MAC)

Ambas cosas, combinadas:
1. **Registro (aprovisionamiento):** al dar de alta un dispositivo en la plataforma se declara su
   identidad (MAC o ID), su **tipo** (temperatura, luz, ruido…), ubicación y credencial. La
   plataforma sabe *qué esperar* de él.
2. **Autoidentificación en cada trama:** el mensaje trae la identidad (`bn`) y cada medición trae
   su nombre y unidad. La plataforma **valida contra el registro**: dispositivo desconocido →
   rechazado; unidad que no calza con el tipo → cuarentena.

Así un sensor nuevo no exige tocar código: se registra, y sus tramas ya se entienden.

---

## 4. Decisión C — Arquitectura de adquisición y frontera con el compañero

```
LADO EDUARDO (hasta el tópico MQTT)
  sensor ─serial→ ESP32 ─WiFi→ ┐
  sensor LoRa ─radio→ gateway  │
       └→ ChirpStack ─publica→ ┤
                               ▼
        ═════ FRONTERA: el tópico MQTT ═════
                               ▼
LADO VICENTE (desde el tópico hacia adentro)
  broker Mosquitto
     │ (también entra HTTP POST por la API)
     ▼
  BACKEND — el pipeline de 6 filtros:
     1 autenticar (TLS + credencial)
     2 analizar la trama
     3 validar contra el registro
     4 normalizar al modelo interno
     5 supervisar (¿quién calla?)
     6 alertar
     ▼
  TimescaleDB ←→ API REST ←→ dashboard
```

- **Frontera contractual:** Eduardo entrega mensajes SenML publicados en un tópico MQTT acordado
  (`sitio/<id>/dispositivo/<id>/medicion`). Todo lo anterior al tópico es suyo; todo lo posterior,
  tuyo. Si Eduardo se atrasa, un **emulador de nodo** publica en el mismo tópico y tu tesis no
  depende de él.
- **ChirpStack y Mosquitto viven en tu servidor** como contenedores junto a la base de datos —
  no son "la nube de alguien": son procesos tuyos. ChirpStack solo existe si la rama LoRa se
  concreta; **es middleware del lado de la plataforma**, no del nodo.
- Los **filtros** del tratamiento son las 6 etapas del recuadro: ese pipeline es tu sustancia de
  ingeniería (y responde «cuántos filtros pasa la data»).

### Las tres arquitecturas de nodo (pros/contras pedidos por el profesor)

| | **Puente ESP32** | **Mini-PC de campo** | **Sensor con red propia** |
|---|---|---|---|
| Costo por punto | ~5–10 USD | ~80–200 USD | según fabricante |
| Consumo | Bajo (batería posible) | Alto (enchufado) | variable |
| Flexibilidad | Cualquier sensor serial/analógico | Máxima (Python, SSH) | Nula: lo que el fabricante dio |
| Trabajo del lado nodo | Medio (firmware) | Bajo (script) | Ninguno |
| Rol propuesto | **Nodo estándar del proyecto** | **Banco de pruebas/desarrollo** | Caso de integración vía HTTP |

---

## 5. Competencia — ampliada, con el elefante incluido

| Competidor | Qué es | Qué NO cubre (tu espacio) |
|---|---|---|
| **ThingsBoard** (CE) | ⚠️ **El rival serio**: plataforma IoT open source, autoalojable, MQTT/HTTP/CoAP, dashboards, multi-tenant | Genérica y pesada: curva de aprendizaje alta, en inglés, sobredimensionada para una pyme regional; sin acompañamiento local. **Hay que citarla en el estado del arte antes de que la comisión la nombre** |
| Node-RED + InfluxDB + Grafana | Trío DIY de prototipado | Es un kit de piezas, no un producto: sin multi-usuario coherente, sin aprovisionamiento, cada instalación es artesanal |
| **Ubidots** (SaaS) | Plataforma en la nube (Colombia) | De pago por dispositivo; datos fuera del país; gratis solo 3 dispositivos |
| ThingSpeak (SaaS) | Canales + MATLAB | Orientada a académicos/hobby; límites de tasa; nube ajena |
| **Instacrops** (Chile) | Agtech con IA: sensores+app+servicio | Vertical agrícola llave en mano, con SU hardware y suscripción |
| **WiseConn** (Chile) | Riego de precisión (DropControl) | Vertical riego, hardware propio, foco en grandes fruticultores |
| IoT-monitor.cl | Monitoreo industrial | Servicio por proyecto, no plataforma abierta |
| IoT3 / ControlTec (Araucanía) | (ya analizados) | Solución cerrada acoplada a su hardware |

**El posicionamiento de la tesis (borrador para debatir):** entre el SaaS caro que se lleva los
datos, la vertical agrícola con hardware propio y el ThingsBoard genérico que exige un ingeniero
para configurarlo, falta una **plataforma liviana, en español, autoalojable en un servidor modesto,
acotada a registro–monitoreo–supervisión–alerta**, que acepte sensores de cualquier procedencia vía
MQTT/HTTP con formato estándar, pensada para organizaciones de La Araucanía. El aporte de ingeniería:
la **capa de recepción y normalización multiprotocolo** y la **supervisión de salud** como función de
primera clase — no solo gráficos.

---

## 6. Seguridad (dónde queda cada pieza)

| Capa | Mecanismo | Quién lo hace |
|---|---|---|
| Transporte WiFi/Ethernet | **TLS** en MQTT (puerto 8883) y HTTPS | Mosquitto/backend — configuración, no desarrollo |
| Radio LoRa | **AES-128 de fábrica** en LoRaWAN, extremo a extremo | Ya viene en el estándar |
| Identidad de dispositivo | **Credencial por dispositivo** (usuario/clave o token en el registro) | Plataforma (aprovisionamiento) |
| Usuarios del dashboard | Sesiones + roles (admin/consulta) | Backend |
| Red | Segmento propio para IoT; **solo conexiones salientes** desde los nodos | Diseño de red (RNF-09/10) |

El cifrado "tipo AES" que preguntas ya está cubierto: **TLS lo incluye** en TCP/IP y LoRaWAN lo trae
de fábrica. No hay que inventar cifrado propio (nunca hay que inventar cifrado propio).

---

## 7. Impacto en horas y backlog (preliminar)

El pivote **simplifica** la implementación: desaparecen el codificador BCD, el receptor DC-09 y el
mapeo de códigos (≈ −16 h) y entra el módulo de tramas SenML + registro de tipos (≈ +8 h). El núcleo
demostrativo baja de ~165 h a ~155 h estimadas — **la holgura mejora**. El backlog se recalcula en
detalle al aprobar esta evaluación.

## 8. Pendientes de esta evaluación

- [ ] Visto bueno del estudiante a las recomendaciones A (MQTT+HTTP), B (SenML) y C (ESP32 nodo
      estándar + emulador).
- [ ] Acordar con Eduardo el tópico y la trama de frontera (el «contrato»).
- [ ] Sensores concretos a usar (decisión conjunta, pendiente del profesor Caro).
- [ ] Reescribir informe y docs 01/02/04 con el nuevo eje y sin los términos vetados.
