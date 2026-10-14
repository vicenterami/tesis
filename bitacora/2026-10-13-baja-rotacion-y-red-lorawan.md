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
- Pruebas: 13 unitarias nuevas (185 en total); el banco pasó de 19 a 38 comprobaciones (40 por la noche, con las de mínimo privilegio) (con la credencial anterior el broker ya
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
- Consecuencia: la red del campus no usa la ruta B decidida el 08/10 ni la ruta A (un ChirpStack nuestro), sino un servidor de
  red externo. Por la noche se decidió agregarla como **ruta C** sin quitar las otras dos (abajo). Sigue bloqueando que el servidor
  sea alcanzable desde esa red.

## Equipo de prueba recibido
- Módulo BME/BMP280 de 4 pines (cuál de los dos es se sabe leyendo su registro de identificación), sonda DS18B20 en acero con
  cinco resistencias de 4,7 kΩ, sensor capacitivo de suelo v1.2, protoboard de 830 puntos, cables dupont de los tres tipos y
  cable micro-USB. La placa ESP32 había llegado el 09/10. Laboratorio en fases: fase 0 (reconocer las piezas, permiso del puerto
  serie, identificación del chip, sin cablear nada), fase 1 (cada sensor por separado), fase 2 (Wi-Fi, TLS y MQTT con la credencial
  del alta), fase 3 (de punta a punta, TT-32). Queda por decidir con qué herramienta se programa el nodo.

## Por la noche: ruta C, mínimo privilegio y correcciones
- **Ruta C** (`docs/10 §8.4` punto 45): el servidor de red del campus publica por su integración MQTT en nuestro broker, con TLS y
  credencial propia. Se agrega a las rutas A y B, que siguen contempladas; B y C solo difieren en el adaptador. Figuras, informe y
  documentos se actualizaron juntos, y la regla del guardián que vigila cómo se nombra ChirpStack ahora acepta la ruta C.
- **Una regla de identidad, cifrado y mínimo privilegio para todos los tramos** (punto 44, `docs/11 §9`): identidad propia siempre,
  TLS en todo lo que sale del servidor. Aplicada: el administrador del broker ya no puede leer las tramas, y el backend entra a la
  base con un rol que solo lee, inserta y actualiza (migración 14). La retención pasa por una única función acotada del dueño,
  porque `drop_chunks` exige serlo (verificado). El banco desde cero lo probó todo con el rol nuevo.
- La primera corrida con el rol nuevo falló: el banco fijaba la clave antes de un arranque que recrea la base en memoria, y la
  verificación entraba por `127.0.0.1`, que la imagen oficial acepta sin clave. Ahora la clave se fija después de ese arranque y la
  verificación entra por la red y comprueba también que una clave equivocada no entra.
- Se corrigieron además 15 problemas encontrados al revisar lo hecho en el día: una muestra del broker podía guardarse con datos viejos tras una
  desconexión, el contador de la cola es el del almacén entero y no el de una sesión, la documentación de la API estaba desfasada,
  `GET /salud` expone conteos sin sesión (aceptado hasta la sesión, anotado en `docs/11 §9`) y cifras y nombres desincronizados. Se
  corrigieron todos.

## Pendientes
- [ ] Decidir y aplicar la ruta LoRaWAN real (ChirpStack como pasarela lógica) e informar al profesor guía.
- [ ] Decidir la herramienta del firmware; ejecutar la fase 0 del laboratorio.
- [x] Cola del broker vigilada (hecha el mismo día: `docs/16 §22`).
- [x] Semilla de demostración completa (hecha el mismo día: `docs/16 §23`).
- [ ] Prueba de dos altas simultáneas del mismo identificador.
