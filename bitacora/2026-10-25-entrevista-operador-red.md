# Entrevista — Operador de la red LoRaWAN del campus — 25 de octubre de 2026

- **Modalidad:** cuestionario escrito por mensaje (ocho preguntas y una de cierre; las preguntas están en `docs/03 §2b`), sobre lo vivido al integrar su
  pasarela al sistema el 20/10/2026; respuesta recibida el 25/10/2026 · **Autorización de cita:** sí, anonimizada, como «operador de la
  red LoRaWAN del campus».
- **Contexto declarado:** administra la pasarela y los nodos LoRaWAN del campus para su propia investigación, con un broker y un tablero
  propios. Es el primer usuario externo que conectó una red real al sistema (`docs/16 §45`).

## Inventario declarado
- **Red:** dos nodos LoRaWAN (uno con línea de vista y otro sin ella), banda AU915, sub-banda 2; una pasarela Milesight UG65 con servidor
  de red embebido que publica por MQTT a un broker propio.
- **Datos:** carga binaria de 10 bytes con temperatura, humedad y tensión de batería (la descripción de bytes que entregó el 15/10 es la
  que usa el perfil `campus-heltec-v3-v1`); los metadatos de radio (RSSI, SNR) los agrega la pasarela.
- **Uso:** un servidor propio decodifica, guarda en una base local y muestra un tablero con exportación CSV. Envío nominal cada 60 s;
  en campañas experimentales, cada 12 a 15 s, con tramas confirmadas y sin confirmar.

## Citas textuales
- «Ingresar 50 nodos de forma manual uno por uno en la interfaz web es inviable» (pregunta 3).
- «Lo óptimo sería subir una plantilla CSV […] o que la pasarela capture los Join-Request no registrados y los liste en una bandeja de
  "Nodos detectados pendientes de aprobación" para autorizarlos con un clic» (pregunta 3).
- «Como operador de red, mi prioridad inmediata es el estado operativo y las alertas (Online / Offline / Batería crítica), seguido
  inmediatamente por la calidad del enlace de radio (RSSI y SNR)» (pregunta 4).
- «Para el usuario común lo llamativo son las curvas de temperatura y humedad, pero para quien administra la red, las curvas son
  secundarias si el enlace físico está degradado» (pregunta 4).
- «Si el sistema externo aplica downsampling (promediar las lecturas cada 10 minutos para ahorrar espacio), me destruye el análisis de
  retardo y tasa de pérdida de paquetes» (pregunta 5).
- «necesito garantías de exportación total sin trabas: poder descargar en cualquier momento mi dataset completo en CSV/JSON» (pregunta 5).
- «Preferiría siempre mantener ambos (enfoque híbrido)» (pregunta 7, sobre dejar su broker propio).
- «Cuando la pasarela perdía el enlace o fallaba el socket, no había ninguna alerta evidente en la pantalla; el flujo simplemente se
  detenía en silencio» (pregunta 8, sobre su propio sistema).
- «Sin monitoreo del estado de energía, los nodos mueren en terreno sin previo aviso» (cierre).

## Incidentes relatados
Sobre la integración del 20/10 relata dificultades con el TLS, el reloj de la pasarela y el tópico. Donde su relato y lo registrado por
la plataforma difieren, este registro se atiene a lo medido (`docs/16 §45`): la pasarela conectó verificando solo la CA del sistema, con
usuario y credencial; el reloj estaba cuatro días atrasado (motivó la regla de tolerancia de `docs/16 §46`); el tópico con el marcador
`$devEUI` en mayúsculas se publicó literal y fue a cuarentena, y con `$deveui` entró todo; y cuando la pasarela dejó de reenviar 27 min,
la plataforma abrió «sin comunicación» a los 6 min y la cerró al volver, justo el aviso que él echa de menos en su sistema.

## Requerimientos que valida o refuta
| Cita o hecho | Causa | Requerimiento |
|---|---|---|
| Estado y alertas primero; después RSSI y SNR | C5 | RF-24, RF-25, RF-48 — **valida**; RF-27 (calidad del enlace) y RF-09 (metadatos del transporte) — **valida** y fija su prioridad |
| Dar de alta 50 nodos uno por uno «es inviable»; plantilla CSV o bandeja de detectados | C4 | RF-19, RF-50 — **amplía**: alta masiva por archivo y aprobación desde la cuarentena de identificadores sin alta (RF-07) |
| Dato crudo sin promediar y exportación completa | C1, C3 | RF-31 (mensaje original íntegro), RF-34 — **valida** |
| Siempre ambos sistemas | C1, C2 | RF-02, RF-03 — **valida** la coexistencia con otro broker (vía de la pasarela por HTTPS, `docs/10`) |
| Aviso de caída con su motivo; distinguir el nodo que calla de la pasarela que calla | C5 | RF-24, RF-30 — **valida y amplía**: agrupar por pasarela |
| Tensión de la batería y reinicios del nodo | C5 | RF-28 — **valida** |
| Tiempo en el aire de las confirmaciones | — | Fuera del alcance: es del servidor de red, no de la plataforma |

## Requerimientos nuevos [ENT]
1. Alta masiva por archivo (CSV) con vista previa, filas rechazadas con su motivo y una carga a la vez (amplía RF-19 y RF-50).
2. Bandeja de identificadores detectados sin alta, para darlos de alta con un clic desde la cuarentena (amplía RF-07 y RF-50).
3. Estado por pasarela: si todos los nodos de una pasarela callan a la vez, avisar de la pasarela o la red, no de cada nodo (amplía RF-30).
Los tres van al plan de la Etapa 4 (`docs/04 §8`, bloques 2 y 5).

## Contactos derivados (solo roles)
Ninguno nuevo.

## Cómo entra (docs/03 §4)
Con esta entrevista se cumple la meta de dos de `docs/03 §1` y TT-33; la fuente `[ENT]` queda marcada en `docs/02` en los requerimientos
de esta tabla y de la entrevista del 5/10 (`bitacora/2026-10-05-entrevista-academico-geologia.md`).
