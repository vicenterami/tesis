# Bloqueo de fila sin frenar las tramas y diseño de la recepción LoRaWAN por formato declarado — 15 de octubre de 2026

- **Sesión de trabajo individual.** Se corrigió un bloqueo de fila que frenaba la recepción durante la baja o la
  rotación de un dispositivo, se verificaron en las fuentes oficiales los formatos que publican ChirpStack v4 y el servidor de red
  embebido de la pasarela Milesight UG63, y con eso se escribió el diseño de la recepción LoRaWAN por las rutas B y C antes del código.
  Lo medido está en `docs/16 §26`; el diseño, en `docs/10 §8.4` punto 47.

## Bloqueo de fila: `FOR NO KEY UPDATE`
- La baja y la rotación tomaban la fila del dispositivo con `FOR UPDATE` mientras la transacción esperaba la respuesta del broker. Toda
  trama o evento de ese dispositivo apunta a esa fila por clave foránea y quedaba esperando; como la recepción procesa un mensaje a la
  vez, esperaban las de todos los dispositivos.
- Medido con dos sesiones contra la base de desarrollo, todo con `ROLLBACK`, con un guion que mide el tiempo dentro de la base
  (`plataforma/pruebas/medir-bloqueo-fila.sh`): con `FOR UPDATE` una trama hija esperó y se canceló a los 1 020 ms; con
  `FOR NO KEY UPDATE` entró en unos 20 ms. La primera medición, a mano, sumaba el arranque del contenedor y dio 1 069 y 68 ms. El
  guion y las pruebas de baja y rotación fallan si el código vuelve al modo anterior.

## Red del campus y fuentes oficiales
- El compañero a cargo de la red LoRaWAN ofreció reenviar los datos desde el servidor de red interno de su pasarela para una prueba y
  preguntó si el sistema sale a Internet. Hoy nada está expuesto: los tres contenedores escuchan solo en la interfaz local y el proxy
  con TLS, probado en el banco, no corre en la pila de desarrollo. La prueba se hará en la misma red local, por el 8883 del proxy con TLS, la semana del 20/10 y el
  despliegue continuo depende de una máquina en la red del campus, que se pedirá en persona al profesor guía.
- Verificado en la guía de la UG63: un solo tipo de destino de reenvío (activar el servidor embebido deja de alimentar su ChirpStack),
  y el servidor embebido publica por MQTT con usuario, clave y TLS con una CA propia. Verificado en ChirpStack v4: el evento `up` se
  publica en JSON con nombres en camelCase, el objeto decodificado existe solo si el perfil tiene decodificador, y la integración se
  suscribe a su tópico de comandos aunque nadie le mande nada. Las fuentes quedaron descargadas fuera del repositorio.

## Diseño antes del código (`docs/10 §8.4` punto 47)
- Un solo tópico de pasarela para las rutas B y C, con el DevEUI del nodo en el tópico y en el cuerpo; solo el evento `up` entra al
  pipeline. El formato lo declara la pasarela al registrarse por API y sus nodos lo heredan; el filtro 2 usa el formato declarado para
  todos los dispositivos y deja de probar adaptadores en orden.
- Las claves del JSON decodificado se traducen a magnitudes con un mapa que hoy vive en el código detrás de una sola función; pasa al
  catálogo de magnitudes cuando el panel lo administre (Etapa 4), sin tocar los adaptadores. `rssi` y `snr` quedan en la trama cruda.
- La hora de una trama LoRaWAN la pone el servidor de red: la de ChirpStack lleva zona y se acepta; la de la pasarela Milesight llega
  sin zona y se descarta hasta verificarla en terreno (`docs/13`, regla 17).
- Regla general aplicada: el candado del padre no debe frenar a quien solo lo referencia; y una fuente verificada se
  guarda el mismo día.
- El guardián que compara las rutas citadas en la prosa con las que sirve la API acepta ahora una ruta marcada «(ruta prevista)» y
  exige quitar la marca en cuanto la ruta existe: la excepción se vacía sola. Probado plantando una marca vencida y una ruta inexistente.

## Pendientes
- [ ] Migración 15, despacho por formato, adaptadores `chirpstack` y `milesight`, pasarelas por API, emulador y `banco.sh lorawan`.
- [ ] Laboratorio de la prueba en la misma red local (por el 8883 del proxy, con TLS), ensayado antes de la prueba.
- [ ] Capítulo de pruebas del informe.
- [ ] Mapa de claves al catálogo de magnitudes (Etapa 4, obligatorio).
