# 28/10/2026 — Presentación de avances en Temuco: la demo en terreno y lo que enseñó

**Contexto.** Presentación de avances al profesor guía, con el sistema completo corriendo en el portátil, el nodo propio publicando en vivo y
el panel abierto también desde un teléfono. La sala no tenía la red de desarrollo: montar la demo en terreno obligó a resolver en el día tres
problemas de despliegue que el diseño no había enfrentado todavía, y cada uno quedó convertido en documentación, guion o pendiente.

## 1. Qué se mostró
- **Inventario y ficha del nodo** (`nodo-0001`): seis magnitudes en vivo cada 60 s (aire, suelo y señal), gráfico con lectura en vivo, estado
  «Normal · ahora».
- **Las tres señales de falla, con casos reales del día**: trama **rechazada** (una presión fuera del rango físico, de una prueba anterior), canal
  **callado** (el módulo de aire se aflojó en el transporte: tres canales sin lectura mientras los otros tres seguían; al reasentarlo, el
  firmware lo volvió a encontrar sin reiniciar, como prevé `docs/17 §6`) y **sin comunicación** (la condición que se abrió al apagar el nodo
  para viajar y se cerró sola al volver a publicar).
- **El panel en un teléfono sin cable**, por HTTPS a través del proxy, dentro de una red privada de demostración.
- **Calibración del suelo**: la tensión del sensor capacitivo y su porcentaje según los dos extremos medidos en la fase 1.

## 2. Qué se hizo hoy
- **Segunda placa, mismo firmware** (commit `4fc1407`, `docs/17 §6.3`): entorno `nodo-s3` para una placa ESP32-S3 con radio LoRa, con otra
  identidad (`nodo-0002`), pines válidos en ese chip y la lectura de suelo omitida porque no tiene el sensor cableado. Compila; queda por
  grabar y dar de alta.
- **Proxy restaurado sin red al encender**: Docker levantó los cuatro contenedores segundos después del arranque, antes de que existiera la
  dirección en la que el proxy publica el 8883, y el contenedor quedó «Up» pero fuera de la red de Compose. Un reinicio no lo repara; recrearlo
  sí (queda pendiente: que la pila no dependa de esa dirección al arrancar y que `pila.sh estado` avise «contenedor sin red»).
- **Red de demostración**: un guion privado de montaje y retorno con comprobaciones (red, dirección fija, regrabación del nodo, proxy,
  backend, nodo publicando) y una orden de vuelta a un estado conocido.

- **Vía LoRaWAN real, sin interrumpir al dueño de la pasarela**: la aplicación de la pasarela admite un solo destino MQTT y ya lo usa su
  administrador, así que la copia hacia la plataforma se obtuvo, con su administrador presente y de acuerdo, con un flujo en el Node-RED que la propia pasarela incorpora (nodo «LoRa
  Input» → función → «mqtt out» por 8883 con TLS, autenticado como la pasarela registrada). Resultado: un nodo del campus en línea con sus
  tres lecturas por trama, y los nodos no dados de alta en cuarentena «no registrado», como manda el diseño. En el mismo inventario quedaron
  un nodo por la vía Wi-Fi/MQTT y otro por la vía LoRaWAN.

## 3. Lecciones técnicas
1. **Una red local sin nombre DNS choca con tres protecciones pensadas para el servidor público**: el proxy rechaza saludos TLS sin SNI y los
   navegadores no mandan SNI hacia una IP; la política de contenido del backend (`upgrade-insecure-requests`) deja el panel en blanco por HTTP
   fuera de la propia máquina; y el certificado de desarrollo no trae la dirección de la red del momento. Las tres son correctas y se quedan;
   lo que falta es un **modo local** documentado para laboratorios y terreno sin DNS (queda pendiente).
2. **Quien da la red no puede ser a la vez su cliente**: el portátil como punto de acceso y el teléfono como fuente de Internet forman un lazo
   si el teléfono entra a esa Wi-Fi; y un teléfono no enruta desde sus aplicaciones hacia los equipos de su propio anclaje. La forma estable
   es que **un solo equipo dé la red y todos los demás sean clientes**.
3. **Un contenedor «Up» y «healthy» puede no tener red**: la señal fue un `docker port` vacío y un `resolv.conf` del anfitrión dentro del
   contenedor. Se agrega al guardián de estado.
4. **El firmware es portable entre redes y placas** cambiando solo los secretos (red, clave, dirección del proxy) y, para otro chip, tarjeta y
   pines: el certificado se verifica por el nombre del proxy, no por su dirección.

## 4. Retroalimentación del profesor
<Por anotar tras la presentación.>

## 5. Pendientes que deja el día
184 (evento/trama), 185 (navegadores de Playwright), 186 (eje con un solo punto), 187 (guardián de figuras), 188 (proxy al arrancar),
189 (punto de acceso), 190 (modo local sin DNS). Entrega de la Etapa 3: viernes 30/10.
