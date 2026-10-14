# Baja y rotación de credencial por API, respuestas sobre la red LoRaWAN del campus y recepción del equipo de prueba — 13 de octubre de 2026

- **Sesión de trabajo individual (tarde-noche).** Se completó el aprovisionamiento por API con la baja y la rotación de la
  credencial, probadas con pruebas unitarias y de punta a punta en el banco; llegaron las respuestas del compañero a cargo de
  la red LoRaWAN del campus, que cambian la ruta prevista; y llegaron las piezas del nodo de prueba (`docs/17`). Lo medido está
  en `docs/16 §21`.

## Baja y rotación por API (`docs/10 §3`; completan HU-11 y RF-45)
- `DELETE /dispositivos/{id}` es una baja lógica: estado `baja`, credenciales inactivas, condiciones abiertas cerradas y evento, en
  una transacción, con el cliente del broker borrado dentro de ella. La fila y su historial quedan; lo que llegue después va a
  cuarentena como `dado_de_baja`. Repetir la baja responde 409; un cliente que el broker ya no tiene cuenta como borrado, así una
  baja repetida tras un corte termina igual.
- `POST /dispositivos/{id}/credencial` rota: nueva fila de credencial (la anterior inactiva), evento y cambio de clave en el broker
  antes de confirmar. Si el broker no tenía al cliente, se crea con su rol: rotar es también la reparación. Si la respuesta no
  llega, se repite la rotación: la clave anterior puede haber dejado de valer y la nueva nunca se mostró.
- Las tres rutas comparten la guardia por cabecera, el tope de dos operaciones a la vez y el bloqueo de la fila del dispositivo.
- Pruebas: 13 unitarias nuevas (185 en total); el banco pasó de 19 a 38 comprobaciones (con la credencial anterior el broker ya
  no deja conectar, con la nueva publica, dado de baja no entra, 409/404/401 en cada borde); humo con las dos rutas sin cabecera.
- Corrección de nombre: estas dos tareas figuraban como «HU-12» y «HU-13» en el diseño, la seguridad, el informe de pruebas y la
  bitácora del 12/10; en el backlog esas historias son agrupar por sitio y zona y marcar en mantenimiento. Se corrigió en los
  cuatro documentos.
- La primera corrida del banco falló tres comprobaciones por el guion de prueba, no por el código: una función de shell reenviaba
  su primer argumento dos veces y la credencial rotada quedaba vacía; con el patrón vacío, la búsqueda «el secreto no está en el
  registro» casaba con todo. Se corrigió el guion y la segunda corrida pasó completa.

## Respuestas sobre la red LoRaWAN del campus (preguntas C1–C5 del 13/10)
- La pasarela instalada es una Milesight UG63 Mini (SX1302, AU915 sub-banda 2) conectada por Packet Forwarder UDP a un
  **ChirpStack v4 institucional**; faltan los nodos y los sensores. La pasarela no publica JSON: lo publica ChirpStack tras
  decodificar el payload binario. No hay trama real todavía.
- Periodo de reporte de los nodos: 60 s. Pérdida en terreno aún sin medir (laboratorio sin pérdidas; objetivo de terreno
  PL ≤ 10 %). Con ese objetivo, un intervalo esperado de 2 × periodo dispararía una alarma por cada dos tramas seguidas perdidas
  (≈ 1 %); se propone declarar 300 s (5 × periodo) al dar de alta esos nodos. No cambia la definición de intervalo esperado.
- TLS con CA propia: no probado por él (validó en claro por 1883). Se verificó en la documentación oficial de ChirpStack que la
  integración MQTT admite `ca_cert`, `tls_cert` y `tls_key`, y que el tópico de eventos es una plantilla configurable
  (`event_topic`); la opción `topic_prefix` que citaba un resumen de su respuesta no existe en la configuración de ChirpStack.
- Consecuencia: la red real es la **ruta A** (ChirpStack), no la ruta B decidida el 08/10. Queda abierta la decisión de tratar al
  ChirpStack institucional como pasarela lógica del sistema (formato propio, sin desplegar nada nuevo) y de informar el cambio al
  profesor guía. Sigue bloqueando que el servidor sea alcanzable desde esa red.

## Equipo de prueba recibido
- Módulo BME/BMP280 de 4 pines (cuál de los dos es se sabe leyendo su registro de identificación), sonda DS18B20 en acero con
  cinco resistencias de 4,7 kΩ, sensor capacitivo de suelo v1.2, protoboard de 830 puntos, cables dupont de los tres tipos y
  cable micro-USB. La placa ESP32 había llegado el 09/10. Laboratorio en fases: fase 0 (reconocer las piezas, permiso del puerto
  serie, identificación del chip, sin cablear nada), fase 1 (cada sensor por separado), fase 2 (Wi-Fi, TLS y MQTT con la credencial
  del alta), fase 3 (de punta a punta, TT-32). Queda por decidir con qué herramienta se programa el nodo.

## Pendientes
- [ ] Decidir y aplicar la ruta LoRaWAN real (ChirpStack como pasarela lógica) e informar al profesor guía.
- [ ] Decidir la herramienta del firmware; ejecutar la fase 0 del laboratorio.
- [ ] Cola del broker vigilada (topes explícitos, muestreo de `$SYS`, alarma de descartes).
- [ ] Semilla de demostración completa con el resultado esperado en su cabecera.
- [ ] Prueba de dos altas simultáneas del mismo identificador.
