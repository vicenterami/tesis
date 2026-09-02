# Reunión con el profesor guía — miércoles 2 de septiembre de 2026 (PIVOTE)

- **Participantes:** Mario Villanueva (profesor guía); aportes referidos del profesor Caro
  (especialista en sensores). La reunión planificada para el jueves 27/08 no se realizó por
  ausencia del profesor; se concretó hoy.
- **Sin grabación** (no autorizada). Registro reconstruido de notas del estudiante.
- **Entrega de la Etapa 1: viernes 4 de septiembre** (pauta oficial vigente).

## 1. Decisión principal: se descarta Contact ID como eje del protocolo

**Argumento del profesor:** Contact ID y el mundo Verisure están orientados a **sensores de
eventos y alarmas** (pasó / no pasó algo). El propósito de esta tesis son **sensores que
monitorean continuamente** — lecturas cada 5 a 30 minutos — donde lo central es la serie de
mediciones, no el evento discreto. Para ese patrón, Contact ID no es el instrumento adecuado.

**Consecuencia:** la evaluación de alternativas de protocolo debe rehacerse con criterios
ponderados para telemetría continua sobre TCP/IP. El trabajo previo sobre Contact ID queda
documentado en el repositorio como camino evaluado y descartado, con su justificación.

## 2. Reenfoque del trabajo del estudiante

- Centro: **el dashboard, la base de datos, el servidor y el tratamiento de las tramas de
  distintos sensores**, recibidas principalmente por **TCP/IP**; LoRa queda acotado como vía
  complementaria (lado del compañero).
- **Advertencia explícita del profesor:** si el trabajo se reduce a «solo un dashboard», la
  tesis se rechaza por simpleza. La sustancia debe estar en la plataforma: recepción
  multiprotocolo, normalización de tramas, supervisión, almacenamiento y alertas.
- El compañero (Eduardo) se orienta a sensores y radio; los sensores concretos están **por
  definir entre ambos** (el profesor guía no lo define).

## 3. Indicaciones de forma y lenguaje

| Indicación | Detalle |
|---|---|
| **Título** | Debe ser del tipo «plataforma de gestión y monitoreo de sensores», no ambiguo, situado en **La Araucanía** |
| **«Heterogéneo»** | No usarlo: «no dice nada» |
| **«Ingesta»** | No usarlo: «ingesta se bebe», no va con sensores. Usar recepción / adquisición |
| **Objetivo general** | **Uno solo**, luego los específicos |
| **Figuras** | Norma **APA**: el detalle de la figura va en el texto, no como descripción en la imagen |

## 4. Ideas técnicas aportadas (vía profesor Caro)

1. **Puente ESP32 universal:** los sensores hablan por serial; una placa con ESP32 en medio
   actúa como nodo/gateway y envía la información casi depurada a la aplicación. Riesgo
   señalado: carga casi todo el trabajo en el compañero y deja al estudiante «solo el
   dashboard» — exactamente lo que provocaría el rechazo.
2. **Mini-PC de campo:** placa con sensor conectada a un mini-PC accesible por SSH,
   monitorización cada pocos segundos, prototipado en Python y luego compilado.

Ambas se incorporan como **alternativas de arquitectura de adquisición** a evaluar con pros y
contras detallados.

## 5. Tareas derivadas (para la entrega del viernes 4)

- [ ] Redefinir título, problema, objetivo general único y objetivos específicos, sin los
      términos vetados.
- [ ] Rehacer la evaluación de alternativas de protocolo para telemetría continua
      (MQTT, HTTP/REST, CoAP, TCP directo, WebSocket) y de arquitectura de adquisición
      (ESP32 puente, mini-PC, sensor con red propia), con pros y contras.
- [ ] Reevaluar el catálogo de requerimientos bajo el nuevo enfoque; reemplazar «ingesta»
      por «recepción/adquisición» en todos los documentos.
- [ ] Ajustar figuras a norma APA.
- [ ] Acordar con Eduardo los sensores y el reparto exacto.
- [ ] Documentar el descarte de Contact ID como decisión con evidencia.
