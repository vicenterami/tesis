# Pruebas iniciales, edición Apache y proxy — 7 de octubre de 2026

- **Sesión de trabajo individual** (6 y 7 de octubre); origen: las decisiones 10 a 15 del 06/10. Todo el código
  siguió al diseño documentado; cada cambio entró con su prueba y con la violación plantada para ver la falla.

## Implementado (detalle en `docs/10 §8.4`, puntos 16 a 23; `docs/16`)
1. **Edición Apache 2.0 de TimescaleDB** en el compose y el esquema (sin compresión, sin trabajos de fondo ni telemetría
   de la extensión); migración 08 (hora de recepción y origen de la marca de tiempo, declarado por cada adaptador);
   migración 09 (tabla `trama`; `cuarentena` como hypertable, una fila por trama con el detalle del rechazo y el
   dispositivo; motivos `no_registrado` y `dado_de_baja`); retención con `drop_chunks` desde el backend (`trama` y
   `cuarentena` 30 días; mediciones sin vencimiento, decisión del estudiante), con cada corrida registrada en `evento`.
2. **Tope de 64 KiB por mensaje** en el broker (sin él aceptaba 50 MiB, observado).
3. **Un mensaje a la vez y confirmación al broker después de guardar** (decisión 4): si la base no responde, el mensaje se
   reintenta y, agotados los reintentos, no se confirma y el cliente reconecta para que el broker lo reenvíe.
4. **RF-22**: un dispositivo en mantenimiento sigue entregando lecturas pero no abre condiciones de umbral.
5. **Capa del proxy nginx con TLS** (variante A): 443 → backend, 8883 → broker, HSTS, registro JSON; probada de punta a
   punta en un banco con una CA de desarrollo que vive fuera del repositorio.

## Pruebas (`docs/16`)
- **Banco desechable**: una segunda pila Compose con la misma configuración y techos de recursos, datos en RAM y broker
  sin credenciales solo ahí; **emulador de nodos** (TT-28) con el tráfico irregular de `docs/10 §9.6`, determinista por
  semilla, con evaluador SQL.
- Cuatro corridas de 100–120 nodos: **59,7 tramas/s sostenidas 90 s, pico 81, cero pérdidas, p95 de 1 a 3 ms, 174 MiB
  en total** (RNF-01, RNF-02 y RNF-17, en el portátil).
- **Pruebas de carrera**: veinte copias de la misma lectura y cinco cruces de umbral simultáneos. Destaparon un defecto
  real (la segunda apertura de condición rompía con clave duplicada y abortaba el pipeline), corregido con `ON CONFLICT`
  sobre el índice único; la comprobación «una sola trama cruda» quedó roja a propósito hasta implementar la decisión 4,
  y pasó con ella.
- **Hallazgo de diseño**: con `intervalo_esperado_s` igual al periodo y 1 % de pérdida, 108 alarmas de silencio falsas
  en 90 s; declarado como 2 × periodo, 3. Decisión: el intervalo esperado es el **silencio máximo normal** del
  dispositivo, no su periodo (migración 10 lo fija en la base; RNF-03 no cambia).
- TLS: el cliente con la CA llega; sin la CA es rechazado; sin TLS el 8883 rechaza; HSTS presente.

## Guardianes nuevos
Licencia e imagen de la base (2k), tope del broker (2l), `nginx -t` (2m), registros acotados (2n), informe compilado y
sano después del último cambio (3b), figuras acotadas al ancho de texto (3c). Cada uno probado plantando su violación.

## Decisiones del día
Plan B activado: nodo propio ESP32 con sensor BME280 por Wi-Fi, sin descartar las pasarelas de la Facultad (TT-32).
Rotación de registros de Docker en todos los servicios. Leyendas y frases del informe actualizadas con lo decidido el
06/10 (SSE, dos puertas siempre y tres a lo sumo, ChirpStack opcional, 285 h, RNF-15 resuelta). Pendiente con el
profesor guía: de dónde saldrá el certificado TLS del servidor (DNS público o CA propia).
