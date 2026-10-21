# 20/10/2026 — Prueba de campo: la red LoRaWAN del campus publicando en el sistema

**Contexto.** Primera prueba con una red LoRaWAN real de terceros (`docs/10 §8.4` punto 47, ruta B): la pasarela Milesight UG65 del
compañero, con su servidor de red embebido, dos nodos Heltec LoRa 32 V3 (uno con sensor real, otro con datos simulados) y el
portátil con la pila completa (proxy TLS, broker, backend, base y panel) en la misma red local, sin internet para la pasarela.

## Qué funcionó
- **Certificado con la IP del portátil, proxy en 8883 y verificación con nuestra CA** desde la pasarela: la UG65 conectó con TLS
  («Self signed certificates» con solo `ca.crt`), usuario y credencial creados por la API (`POST /pasarelas`), QoS 1, sin retención.
- **Alta de la pasarela y de los dos nodos por API** con su DevEUI, el perfil de decodificación `campus-heltec-v3-v1` y tres canales.
- **De punta a punta:** cada trama de cada nodo (una cada ≈ 17 s) pasó los seis filtros y quedó en la base y en el panel: «3/3
  lecturas guardadas vía milesight», 810 mediciones en tres horas, ficha con las tres series, inventario en verde.
- **La supervisión abrió y cerró sola** la condición `sin_comunicacion` de los dos nodos cuando la pasarela dejó de reenviar
  27 minutos y cuando volvió.

## Lo que el sistema dejó a la vista (evidencia, no fallas nuestras)
- **Comodín mal escrito → cuarentena.** El tópico con `$devEUI` (mayúsculas, el que sugiere nuestra plantilla del alta) la UG65 lo
  publicó literal; el filtro 1 mandó esas tramas a cuarentena `no_registrado` con la carga completa, en vez de perderlas o aceptarlas
  sin identidad. Con `$deveui` en minúsculas (lo que documenta Milesight para la UG65) entró todo. Queda corregir la plantilla.
- **Reloj de la pasarela atrasado cuatro días** (sin NTP): las mediciones quedaron fechadas el 16/10 con origen `pasarela`, el panel
  mostró «última trama: ahora» junto a «medición hace 4 d», y el histórico de la última hora salió vacío hasta corregir la hora en la
  pasarela. Guardar el origen de la hora hizo visible el problema; falta una tolerancia de desvío para marcas de pasarela.
- **Un solo destino MQTT por aplicación** en la UG65 (el segundo solo puede ser HTTP o HTTPS): la pasarela no puede publicar a dos
  brokers a la vez, así que la coexistencia con el broker del compañero exige un puente desde su Mosquitto (no se logró hoy en su
  equipo) o la recepción HTTPS de reportes de pasarela en nuestro sistema (vía E, pendiente desde el 15/10: hoy sube de prioridad).
- Al cambiar la hora de la pasarela, su cliente MQTT cerró la sesión y no reconectó solo: hubo que guardar la aplicación de nuevo.

## Errores de operación, corregidos en el momento
Un alta con el nombre del nodo en vez del DevEUI (baja y alta de nuevo); una credencial pegada dos veces en un chat (rotada dos veces);
el pendrive con una imagen de instalación no servía para pasar `ca.crt` (se sirvió por HTTP en la red local).

## Lo que no se probó
La ruta C (ChirpStack): quedó preparado en el portátil (configuración oficial de ChirpStack v4 con región AU915, puente Semtech UDP e
integración MQTT hacia el sistema) para la próxima sesión; exige las claves OTAA del nodo y moverlo del servidor embebido.
