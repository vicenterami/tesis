# Decisiones de diseño para la Etapa 3 — 6 de octubre de 2026

- **Sesión de trabajo individual;** origen: la entrevista del 05/10 y el acceso a la nube del fabricante de los
  equipos de la Facultad (evaluada con capturas; evidencia en el registro privado).

## Decisiones (detalle y fuentes en `docs/10 §8.4` y `docs/08 §8`)
1. Tiempo real por **SSE**, no WebSocket: flujo unidireccional y poco frecuente; reconexión por norma; misma
   sesión y proxy que la API.
2. **Segunda ruta de entrada**: pasarela LoRaWAN con servidor de red embebido → MQTT/TLS → broker propio.
   ChirpStack pasa a alternativa.
3. **Adaptador «milesight»** sobre JSON ya decodificado en la pasarela; no se copian decodificadores GPL-3.0.
4. **Confirmar al broker después de persistir** (cierra la limitación «si cae la base, se pierde»).
5. **Trama cruda aceptada** guardada con retención configurable (30 días).
6. **Vista pública de solo lectura por enlace**, sin datos crudos, en vez de un tercer rol.
7. **Unidades propias en el catálogo** (radón en Bq/m³); nuevas magnitudes del caso de uso.
8. **Entidad pasarela y ubicación geográfica** en el modelo.
9. **Plan de la Etapa 3 ordenado por el peso de la rúbrica** (`docs/04 §7`): 79 h contra ~60 h; se recorta por
   el final de cada criterio, nunca las pruebas.

## Qué sigue el diseño y qué no (control)
El código se cambia **después** de estas decisiones, cada una con su prueba (plantar la violación, ver la
falla) y su entrada en el cuadro de mejoras del informe (antes/después).

## Añadido la misma noche

- **El proxy inverso entra en la vista de contenedores** (`docs/10 §2`, figura 4.1): es el único contenedor expuesto.
  Puertos fijados por escenario: 443 y 8883 siempre; 1700/udp solo si ChirpStack corre en este servidor (ruta A).
  Siete escenarios de entrada en tabla, y la respuesta a «¿cualquier dispositivo?»: dos puertas estándar (MQTT/TLS y
  HTTPS) probadas con la matriz de TT-32; lo que no las habla entra por una pasarela.
- **La cola del broker, con números** (`docs/10 §4.1`, `docs/11 §4`): 1000 mensajes por cliente y sin tope de bytes
  por defecto, descartes silenciosos al superarse, guardado a disco cada 1800 s; el archivo de configuración del
  proyecto no fija ninguno de esos valores. Consecuencias de diseño registradas como pendientes.
- **SSE reemplaza a WebSocket** en la figura de tiempo real (E.4) y en `docs/10 §5`.
- **Hora de medición frente a hora de recepción**: propuesta en `docs/08 §8` (`medicion.recibido_en` y
  `origen_tiempo`), pendiente de decisión.
- Figuras regeneradas desde la fuente única; informe recompilado en 30 páginas sin desbordes; guardián en verde.
