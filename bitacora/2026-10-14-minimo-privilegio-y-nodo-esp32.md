# Mínimo privilegio en la base, figuras por vía de entrada y primera conexión del nodo ESP32 — 14 de octubre de 2026

- **Sesión de trabajo individual.** Se terminó el rol de la aplicación con mínimo privilegio, se reorganizaron las
  figuras de contenedores y red por vía de entrada, se midió el costo del canal en vivo y se conectó por primera vez la placa del
  nodo de prueba. Lo medido está en `docs/16 §24` y `§25`; la placa, en `docs/17 §3`.

## Base de datos con mínimo privilegio (`docs/10 §8.4` punto 44, migración 14)
- El backend entra como `plataforma_app`: lee todo, inserta solo en las 11 tablas donde el código inserta y actualiza solo en 5.
  El registro de eventos y las series de mediciones y tramas solo admiten agregar, nunca reescribir.
- La limpieza programada (retención) pasa por una única función del dueño de la base, porque `drop_chunks` exige ser dueño de la
  tabla (verificado). Sus mínimos, 30 días para las mediciones y 7 para lo demás, los impone la base y el backend no puede
  saltárselos.
- Al revisar lo hecho aparecieron y se corrigieron, entre otros: una verificación que entraba por `127.0.0.1`, donde la imagen
  oficial no pide clave, y por eso «probaba» una clave que no estaba puesta; un paso del banco que no se detenía si el rol fallaba;
  y tres guiones que solo funcionaban llamados desde una carpeta (guardia nueva 2y).

## Figuras, proxy y tiempo real
- La figura de contenedores agrupa a un lado todo lo que entra por MQTT/TLS 8883 (Wi-Fi, rutas B y C) y al otro la ruta A,
  punteada; la de red muestra que la ruta A también viaja por Internet o por la red del campus.
- Quedó escrito cómo el proxy decide a dónde mandar cada conexión (por puerto, y en el 443 por nombre) y cómo vuelve la respuesta.
- Medido: 50 flujos SSE abiertos con 20 dispositivos emulados suman unos 5 MiB y un punto y medio de CPU al backend; el 51 se
  rechaza. **Decisión del día:** el canal en vivo del panel migrará a WebSocket para dejarlo listo para ida y vuelta (`docs/10 §8.4`
  punto 46); se medirá con la misma prueba antes de retirar el SSE.
- La limpieza programada y la cola vigilada ahora se cambian desde el `.env`: el compose no les pasaba esas variables al backend
  (guardia nueva 2z).

## Nodo de prueba ESP32
- La placa es una «NodeMCU ESP-32S V1.1» con conector **tipo C** y conversor CP2102. La lista de compras indicaba un cable
  micro-USB, por un error al copiar la descripción del vendedor sin contrastarla con la pieza; se corrigió y no hubo que comprar
  nada: sirvió un cable tipo C a tipo C de datos. De tres cables, dos eran solo de carga.
- Primera conexión: chip ESP32-D0WD-V3, cristal de 40 MHz, memoria de 4 MB; con esta placa la comunicación exige 115200 baudios.
- Hojas de datos del fabricante descargadas y contrastadas con cada pieza; lo que solo declara la tienda queda marcado como tal.

## Pendientes
- [ ] Código de la ruta C (adaptador del servidor de red del campus).
- [ ] Capítulo de pruebas del informe.
- [ ] Migración del canal en vivo a WebSocket y medición comparativa.
- [ ] Fase 1 del nodo: los tres sensores, uno por uno.
