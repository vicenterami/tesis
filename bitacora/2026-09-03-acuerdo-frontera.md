# Acuerdo de frontera con el compañero de tesis — jueves 3 de septiembre de 2026

- **Con:** el compañero de tesis (trabajos separados y coordinados)
- **Medio:** coordinación por mensajería; registro del acuerdo técnico, no de la conversación.

## 1. El acuerdo

| Tramo | Responsable | Detalle acordado |
|---|---|---|
| Nodo → gateway (radio) | **El compañero** | LoRaWAN AU915 con activación OTAA, trama estándar en modo *Confirmed Uplink*, payload binario compacto |
| Decodificación binario → JSON | **El compañero** | Su decodificador produce un JSON con los tres campos exigidos: identificador del nodo, marca temporal y valor medido |
| Publicación en MQTT | **El compañero** | El JSON se publica en el tópico acordado — **esta es la frontera entre ambos trabajos** |
| Del tópico hacia adentro | **Vicente** | Recepción, adaptación, normalización, almacenamiento, supervisión, alertas y panel |

## 2. Decisiones de esta plataforma derivadas del acuerdo

1. **El JSON de tres campos del compañero se acepta tal cual** y se convierte al contrato SenML
   mediante un **adaptador de formato** — primer caso real de la capa de adaptadores (RF-04), lo
   que demuestra la extensibilidad con un formato externo verdadero y no uno inventado.
2. **ChirpStack correrá en el servidor de la plataforma** como servidor de red de la rama LoRa
   (algunos gateways traen servidor de red embebido; se prefiere centralizarlo para administrar
   los nodos y las claves desde la propia plataforma).
3. El *Confirmed Uplink* es decisión del lado del nodo (confiabilidad en el aire); se complementa
   con el QoS de MQTT y la validación del pipeline: cadena de entrega cubierta de extremo a extremo.

## 3. Dato transmitido de tercera mano, por confirmar con el profesor guía

- «La entrega del viernes va **sin entrevista**» y «los validadores le dan lo mismo, él lo revisa».
  El informe ya declara la brecha de entrevistas, así que no altera la entrega; la entrevista se
  mantiene en el plan de la Etapa 2. **Confirmar qué significaba «validadores».**

## 4. Pendientes del acuerdo

- [ ] Nombre exacto del tópico MQTT (propuesta: `sitio/<id>/dispositivo/<id>/medicion`).
- [ ] Proponer al compañero los nombres de campo SenML (`bn`, `bt`, `v`, `u`) — si los adopta, el
      adaptador se vuelve trivial; si no, el adaptador ya lo cubre.
- [ ] ¿Incluirá la unidad de medida en su JSON? (SenML la trae; los tres campos exigidos no).
- [ ] Nivel de QoS a usar en la publicación.
